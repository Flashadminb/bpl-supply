import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCart } from '../../lib/cart'
import { useAuth } from '../../lib/auth'
import { compressImage, prettyBytes, releaseImage, stampLines, type CompressedImage } from '../../lib/image'
import {
  MAX_PHOTOS,
  addRequisitionPhotos,
  createRequisition,
  exportToSheet,
  setSync,
  uploadEvidence,
} from '../../lib/api'
import { readableError } from '../../lib/supabase'
import type { CreateReqResult } from '../../lib/types'
import { StaffPage, TopBar } from '../../components/Shell'
import { SyncBar, type SyncMap } from '../../components/SyncBar'
import { Spinner } from '../../components/ui'

/** รูป 1 ใบพร้อมสถานะการอัปของตัวเอง กดส่งซ้ำเฉพาะใบที่พลาดได้ */
interface Shot {
  key: string
  img: CompressedImage
  from: 'camera' | 'gallery'
  state: 'ready' | 'uploading' | 'done' | 'failed'
  fileId?: string
  webLink?: string | null
  bytes?: number | null
  error?: string
}

/** ส่งพร้อมกันได้ทีละ 2 ใบ เร็วขึ้นเกือบเท่าตัวโดยไม่ถล่มเน็ตฮับ */
const CONCURRENCY = 2

export default function Evidence() {
  const cart = useCart()
  const { profile } = useAuth()
  const nav = useNavigate()
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const shotsRef = useRef<Shot[]>([])

  const [shots, setShots] = useState<Shot[]>([])
  const [sync, setSyncState] = useState<SyncMap>({})
  const liveRef = useRef<SyncMap>({})
  const [busy, setBusy] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreateReqResult | null>(null)

  useEffect(() => {
    if (cart.count === 0 && !created) nav('/cart', { replace: true })
  }, [cart.count, created, nav])

  useEffect(() => {
    shotsRef.current = shots
  }, [shots])
  // คืนหน่วยความจำรูปทุกใบเมื่อออกจากหน้า
  useEffect(() => () => shotsRef.current.forEach((s) => releaseImage(s.img)), [])

  const mark = (patch: SyncMap) => {
    liveRef.current = { ...liveRef.current, ...patch }
    setSyncState((s) => ({ ...s, ...patch }))
  }

  const uploaded = shots.filter((s) => s.state === 'done')
  const pending = shots.filter((s) => s.state !== 'done')

  /** บีบอัดทีละใบเรียงกัน ไม่ขนานกัน กันมือถือเก่าหน่วยความจำไม่พอ */
  async function onPick(files: FileList | null, from: 'camera' | 'gallery') {
    if (!files || files.length === 0) return
    setError(null)

    const room = MAX_PHOTOS - shots.length
    if (room <= 0) {
      setError(`แนบได้สูงสุด ${MAX_PHOTOS} ใบ ลบใบที่ไม่ต้องการก่อน`)
      return
    }
    const picked = Array.from(files).slice(0, room)
    if (files.length > room) {
      setError(`เลือกมา ${files.length} ใบ แต่ใส่ได้อีกแค่ ${room} ใบ ระบบเอาให้เท่าที่ใส่ได้`)
    }

    setCompressing(true)
    mark({ IMG: 'running' })
    try {
      for (const file of picked) {
        const img = await compressImage(file, {
          stamp: stampLines(
            profile?.full_name ?? '—',
            profile?.employee_code ?? '—',
            profile?.hub_code ?? '—',
            from === 'gallery' ? 'BPL SUPPLY · เลือกจากคลังรูป' : 'BPL SUPPLY',
          ),
        })
        setShots((s) => [
          ...s,
          { key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, img, from, state: 'ready' },
        ])
      }
      mark({ IMG: 'done' })
    } catch (e) {
      mark({ IMG: 'failed' })
      setError(readableError(e))
    } finally {
      setCompressing(false)
    }
  }

  function removeShot(key: string) {
    setShots((s) => {
      const hit = s.find((x) => x.key === key)
      if (hit) releaseImage(hit.img)
      return s.filter((x) => x.key !== key)
    })
  }

  /** อัปเฉพาะใบที่ยังไม่สำเร็จ ส่งพร้อมกันทีละ CONCURRENCY ใบ */
  async function uploadAll(list: Shot[]): Promise<Shot[]> {
    const todo = list.filter((s) => s.state !== 'done')
    if (todo.length === 0) return list

    const result = new Map<string, Partial<Shot>>()
    const queue = [...todo]

    const worker = async () => {
      for (;;) {
        const s = queue.shift()
        if (!s) return
        setShots((cur) => cur.map((x) => (x.key === s.key ? { ...x, state: 'uploading' } : x)))
        try {
          const up = await uploadEvidence(s.img.blob, `evidence-${Date.now()}-${s.key}.webp`)
          result.set(s.key, {
            state: 'done',
            fileId: up.fileId,
            webLink: up.webViewLink,
            bytes: up.bytes ?? s.img.bytes,
            error: undefined,
          })
        } catch (e) {
          result.set(s.key, { state: 'failed', error: readableError(e) })
        }
        const patch = result.get(s.key) as Partial<Shot>
        setShots((cur) => cur.map((x) => (x.key === s.key ? { ...x, ...patch } : x)))
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
    return list.map((s) => ({ ...s, ...(result.get(s.key) ?? {}) }))
  }

  async function submit(skipImages = false) {
    if (shots.length === 0 && !created && !skipImages) {
      setError('ถ่ายรูปหลักฐานอย่างน้อย 1 ใบก่อนยืนยัน')
      return
    }
    setBusy(true)
    setError(null)

    try {
      // ---- GDV: อัปรูปทุกใบเข้า Google Drive -------------------------
      let done: Shot[] = shots.filter((s) => s.state === 'done')

      if (!created && !skipImages && shots.length > 0) {
        mark({ GDV: 'running' })
        const after = await uploadAll(shots)
        done = after.filter((s) => s.state === 'done')
        const bad = after.filter((s) => s.state === 'failed')

        if (done.length === 0) {
          mark({ GDV: 'failed' })
          setError(
            `อัปรูปเข้า Google Drive ไม่สำเร็จสักใบ: ${bad[0]?.error ?? 'ไม่ทราบสาเหตุ'} — กดยืนยันอีกครั้งเพื่อลองใหม่ (ใบที่ขึ้นแล้วจะไม่อัปซ้ำ)`,
          )
          setBusy(false)
          return
        }
        if (bad.length > 0) {
          mark({ GDV: 'failed' })
          setError(
            `อัปสำเร็จ ${done.length} ใบ แต่ล้มเหลว ${bad.length} ใบ — กดยืนยันอีกครั้งเพื่อส่งเฉพาะใบที่พลาด`,
          )
          setBusy(false)
          return
        }
        mark({ GDV: 'done' })
      }

      const main = done[0]

      // ---- SPB: บันทึกคำขอ + ตัดสต็อกใน transaction เดียว ------------
      let result = created
      if (!result) {
        mark({ SPB: 'running' })
        result = await createRequisition({
          lines: cart.lines,
          purpose: cart.purpose,
          note: cart.note,
          evidenceFileId: main?.fileId ?? null,
          evidenceLink: main?.webLink ?? null,
          evidenceBytes: main?.bytes ?? null,
        })
        setCreated(result)
        mark({ SPB: 'done' })
      }

      // ---- แนบรูปที่เหลือเข้าคำขอ (พลาดได้ รูปหลักบันทึกไปแล้ว) -------
      if (done.length > 0) {
        try {
          await addRequisitionPhotos(
            result.id,
            done.map((s) => ({
              file_id: s.fileId as string,
              web_link: s.webLink ?? null,
              bytes: s.bytes ?? null,
            })),
          )
        } catch (e) {
          console.warn('[BPL] แนบรูปเสริมไม่สำเร็จ', e)
        }
      }

      // ---- TMP: ทิ้งไฟล์ชั่วคราวในเครื่องทันที ------------------------
      mark({ TMP: 'running' })
      shots.forEach((s) => releaseImage(s.img))
      shotsRef.current = []
      setShots([])
      const snapshot = { lines: cart.lines, purpose: cart.purpose }
      cart.clear()
      mark({ TMP: 'done' })

      // ---- GSH: ส่งลง Google Sheet (พลาดได้ ไม่ทำให้คำขอเสีย) --------
      mark({ GSH: 'running' })
      try {
        await exportToSheet({ requisitionId: result.id })
        mark({ GSH: 'done' })
        await setSync(result.id, 'GSH', 'done')
      } catch (e) {
        mark({ GSH: 'failed' })
        await setSync(result.id, 'GSH', 'failed', readableError(e))
      }

      nav(`/success/${encodeURIComponent(result.ref_no)}`, {
        replace: true,
        state: { result, lines: snapshot.lines, purpose: snapshot.purpose, sync: { ...liveRef.current } },
      })
    } catch (e) {
      mark({ SPB: 'failed' })
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  const stateLabel: Record<Shot['state'], string> = {
    ready: 'รอส่ง',
    uploading: 'กำลังส่ง…',
    done: 'ส่งแล้ว ✓',
    failed: 'ส่งไม่สำเร็จ',
  }
  const stateClass: Record<Shot['state'], string> = {
    ready: 'badge-mute',
    uploading: 'badge-warn',
    done: 'badge-ok',
    failed: 'badge-dang',
  }

  return (
    <>
      <TopBar title="ถ่ายรูปหลักฐาน" back="/cart" />
      <StaffPage nav={false}>
        {shots.length === 0 ? (
          <div className="card flex min-h-[180px] items-center justify-center p-6 text-center">
            <p className="text-sm text-ink-400">
              ถ่ายรูปของที่เบิกให้เห็นชัด
              <br />
              ใส่ได้สูงสุด {MAX_PHOTOS} ใบต่อ 1 คำขอ
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {shots.map((s, i) => (
              <li key={s.key} className="card flex items-center gap-3 p-2">
                <img
                  src={s.img.objectUrl}
                  alt={`หลักฐานใบที่ ${i + 1}`}
                  className="h-[64px] w-[64px] shrink-0 rounded-btn border border-line object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-display text-base">
                    ใบที่ {i + 1}
                    {i === 0 && <span className="ml-2 badge-mute">รูปหลัก</span>}
                  </p>
                  <p className="font-mono text-xs text-ink-400">
                    {s.img.width}×{s.img.height} · {prettyBytes(s.img.bytes)}
                    {s.from === 'gallery' ? ' · จากคลังรูป' : ''}
                  </p>
                  <span className={`mt-1 inline-block ${stateClass[s.state]}`}>{stateLabel[s.state]}</span>
                  {s.error && <p className="mt-1 text-xs text-danger-txt">{s.error}</p>}
                </div>
                <button
                  type="button"
                  aria-label={`ลบใบที่ ${i + 1}`}
                  className="h-tap w-tap shrink-0 text-ink-400"
                  disabled={busy || s.state === 'uploading'}
                  onClick={() => removeShot(s.key)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap gap-1">
          {cart.lines.map((l) => (
            <span key={l.item_id} className="badge-mute">
              {l.name} ×{l.qty}
            </span>
          ))}
        </div>

        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void onPick(e.target.files, 'camera')
            e.target.value = ''
          }}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void onPick(e.target.files, 'gallery')
            e.target.value = ''
          }}
        />

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn-ghost"
            disabled={busy || compressing || shots.length >= MAX_PHOTOS}
            onClick={() => cameraRef.current?.click()}
          >
            {compressing ? <Spinner /> : null}
            {shots.length === 0 ? 'ถ่ายรูป' : 'ถ่ายเพิ่ม'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy || compressing || shots.length >= MAX_PHOTOS}
            onClick={() => galleryRef.current?.click()}
          >
            เลือกจากเครื่อง
          </button>
        </div>

        <p className="mt-2 text-center text-sm text-ink-400">
          ใส่แล้ว {shots.length}/{MAX_PHOTOS} ใบ
          {uploaded.length > 0 && ` · ส่งขึ้นแล้ว ${uploaded.length} ใบ`}
        </p>

        <button
          type="button"
          className="btn-primary mt-3 w-full"
          disabled={busy || compressing || (shots.length === 0 && !created)}
          onClick={() => void submit()}
        >
          {busy ? <Spinner /> : null}
          {busy
            ? 'กำลังส่ง…'
            : pending.length > 0 && uploaded.length > 0
              ? `ส่งต่อ (เหลือ ${pending.length} ใบ)`
              : 'ยืนยันการเบิก'}
        </button>

        {sync.GDV === 'failed' && !created && (
          <button
            type="button"
            className="btn-soft mt-2 w-full"
            disabled={busy}
            onClick={() => void submit(true)}
          >
            บันทึกโดยไม่มีรูป (แอดมินจะเห็นว่าหลักฐานค้าง)
          </button>
        )}

        {/* หน้างานต้องรู้ทันทีว่าไม่สำเร็จ ห้ามเดินจากไปโดยคิดว่าเบิกแล้ว */}
        {error && (
          <div className="mt-4 rounded-panel border-2 border-danger bg-danger-bg p-4">
            <p className="font-display text-lg text-danger-txt">⚠ ยังเบิกไม่สำเร็จ</p>
            <p className="mt-1 text-base text-danger-txt">{error}</p>
            <p className="mt-3 rounded-btn bg-white/70 px-3 py-2 text-sm text-ink-700">
              ของยังไม่ถูกตัดออกจากสต็อก <b>อย่าเพิ่งเอาของไป</b>
              <br />
              กดยืนยันใหม่อีกครั้ง ถ้ายังไม่ได้ให้แคปหน้าจอนี้ส่งไลน์ให้แอดมิน
            </p>
          </div>
        )}

        {busy && (
          <p className="mt-3 rounded-card bg-warn-bg p-3 text-center text-base text-warn-txt">
            กำลังส่ง… อย่าปิดหน้านี้
            {shots.length > 1 ? ` · รูป ${shots.length} ใบใช้เวลานานกว่าปกติ` : ' · ถ้าเน็ตช้าอาจใช้เวลาถึงครึ่งนาที'}
          </p>
        )}

        <div className="mt-4 rounded-card border border-line bg-surface p-3">
          <p className="mb-2 text-sm text-ink-500">สถานะการส่ง</p>
          <SyncBar states={sync} refNo={created?.ref_no} />
        </div>
      </StaffPage>
    </>
  )
}
