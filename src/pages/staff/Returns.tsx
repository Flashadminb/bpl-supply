import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import { MAX_PHOTOS, createReturn, listOpenBorrowings, uploadEvidence } from '../../lib/api'
import { compressImage, prettyBytes, releaseImage, stampLines, type CompressedImage } from '../../lib/image'
import { readableError } from '../../lib/supabase'
import type { OpenBorrowing, ReturnCond } from '../../lib/types'
import { StaffPage, TopBar } from '../../components/Shell'
import { EmptyState, ErrorBox, Loading, QtyStepper, Sheet, Spinner } from '../../components/ui'
import { fmtDateTime } from '../../lib/format'

const CONDITIONS: { key: ReturnCond; label: string }[] = [
  { key: 'ok', label: 'ใช้ได้' },
  { key: 'damaged', label: 'ชำรุด' },
  { key: 'lost', label: 'สูญหาย' },
]

interface Shot {
  key: string
  img: CompressedImage
  state: 'ready' | 'uploading' | 'done' | 'failed'
  fileId?: string
  webLink?: string | null
  bytes?: number | null
  error?: string
}

const CONCURRENCY = 2

export default function Returns() {
  const { profile } = useAuth()
  const open = useAsync(() => listOpenBorrowings(true, profile?.id), [profile?.id])
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const shotsRef = useRef<Shot[]>([])

  const [target, setTarget] = useState<OpenBorrowing | null>(null)
  const [qty, setQty] = useState(1)
  const [cond, setCond] = useState<ReturnCond>('ok')
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusy] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    shotsRef.current = shots
  }, [shots])
  useEffect(() => () => shotsRef.current.forEach((s) => releaseImage(s.img)), [])

  function openSheet(b: OpenBorrowing) {
    shots.forEach((s) => releaseImage(s.img))
    setShots([])
    setTarget(b)
    setQty(b.qty_open)
    setCond('ok')
    setError(null)
  }

  function closeSheet() {
    shots.forEach((s) => releaseImage(s.img))
    shotsRef.current = []
    setShots([])
    setTarget(null)
  }

  async function onPick(files: FileList | null, from: 'camera' | 'gallery') {
    if (!files || files.length === 0) return
    setError(null)
    const room = MAX_PHOTOS - shots.length
    if (room <= 0) {
      setError(`แนบได้สูงสุด ${MAX_PHOTOS} ใบ`)
      return
    }
    setCompressing(true)
    try {
      for (const file of Array.from(files).slice(0, room)) {
        const img = await compressImage(file, {
          stamp: stampLines(
            profile?.full_name ?? '—',
            profile?.employee_code ?? '—',
            profile?.dept_code ?? profile?.hub_code ?? '—',
            from === 'gallery' ? 'คืนวัสดุ · เลือกจากคลังรูป' : 'คืนวัสดุ',
          ),
        })
        setShots((s) => [
          ...s,
          { key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, img, state: 'ready' },
        ])
      }
    } catch (e) {
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
          const up = await uploadEvidence(s.img.blob, `return-${Date.now()}-${s.key}.webp`)
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

  async function submit() {
    if (!target) return
    if (shots.length === 0) {
      setError('ต้องถ่ายรูปสภาพตอนคืนอย่างน้อย 1 ใบ')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const after = await uploadAll(shots)
      const okShots = after.filter((s) => s.state === 'done')
      const bad = after.filter((s) => s.state === 'failed')

      if (okShots.length === 0) {
        setError(`อัปรูปไม่สำเร็จ: ${bad[0]?.error ?? 'ไม่ทราบสาเหตุ'} — กดยืนยันอีกครั้งเพื่อลองใหม่`)
        setBusy(false)
        return
      }
      if (bad.length > 0) {
        setError(`อัปสำเร็จ ${okShots.length} ใบ ล้มเหลว ${bad.length} ใบ — กดยืนยันอีกครั้งเพื่อส่งเฉพาะใบที่พลาด`)
        setBusy(false)
        return
      }

      await createReturn({
        lineId: target.requisition_item_id,
        qty,
        condition: cond,
        photos: okShots.map((s) => ({
          file_id: s.fileId as string,
          web_link: s.webLink ?? null,
          bytes: s.bytes ?? null,
        })),
      })
      setDone(`คืน ${target.item_name} ${qty} ${target.unit} เรียบร้อย · แนบรูป ${okShots.length} ใบ`)
      closeSheet()
      open.reload()
      setTimeout(() => setDone(null), 4000)
    } catch (e) {
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
      <TopBar title="คืนวัสดุ" back="/" />
      <StaffPage>
        {open.loading && <Loading />}
        {open.error && <ErrorBox message={open.error} onRetry={open.reload} />}
        {done && <p className="mb-3 rounded-card bg-success-bg p-3 text-sm text-success-txt">{done}</p>}

        {!open.loading && !open.error && (open.data ?? []).length === 0 && (
          <EmptyState title="ไม่มีของค้างคืน" hint="ของประเภทยืม-คืนที่เบิกไปจะขึ้นที่นี่" />
        )}

        <ul className="space-y-2">
          {(open.data ?? []).map((b) => (
            <li key={b.requisition_item_id} className="card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-base">{b.item_name}</p>
                  <p className="truncate font-mono text-xs text-ink-400">
                    {b.sku} · {b.ref_no} · {fmtDateTime(b.created_at)}
                  </p>
                  <p className="mt-1 text-sm text-ink-500">
                    เบิกไป {b.qty_taken} · คืนแล้ว {b.qty_returned} ·{' '}
                    <b className="text-warn-txt">
                      ค้าง {b.qty_open} {b.unit}
                    </b>
                  </p>
                </div>
                <button type="button" className="btn-primary shrink-0" onClick={() => openSheet(b)}>
                  คืน
                </button>
              </div>
            </li>
          ))}
        </ul>
      </StaffPage>

      <Sheet open={Boolean(target)} onClose={closeSheet} title={target ? `คืน ${target.item_name}` : ''}>
        {target && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-base text-ink-700">จำนวนที่คืน ({target.unit})</span>
              <QtyStepper value={qty} max={target.qty_open} min={1} onChange={setQty} />
            </div>

            <span className="label mt-4">สภาพของ</span>
            <div className="flex gap-2">
              {CONDITIONS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={`chip flex-1 justify-center ${cond === c.key ? 'chip-on' : ''}`}
                  onClick={() => setCond(c.key)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {cond !== 'ok' && (
              <p className="mt-2 rounded-btn bg-warn-bg px-3 py-2 text-sm text-warn-txt">
                ของชำรุด/สูญหายจะไม่ถูกเพิ่มกลับเข้าสต็อก และจะบันทึกไว้ให้แอดมินตรวจ
              </p>
            )}

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

            <p className="label mt-4">
              รูปสภาพตอนคืน <span className="text-danger-txt">· บังคับอย่างน้อย 1 ใบ</span>
            </p>

            {shots.length > 0 && (
              <ul className="mb-2 space-y-2">
                {shots.map((s, i) => (
                  <li key={s.key} className="flex items-center gap-2 rounded-card border border-line p-2">
                    <img
                      src={s.img.objectUrl}
                      alt={`ใบที่ ${i + 1}`}
                      className="h-[48px] w-[48px] shrink-0 rounded-btn object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs text-ink-400">{prettyBytes(s.img.bytes)}</p>
                      <span className={stateClass[s.state]}>{stateLabel[s.state]}</span>
                      {s.error && <p className="text-xs text-danger-txt">{s.error}</p>}
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

            <div className="grid grid-cols-2 gap-2">
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
            <p className="mt-1 text-center text-sm text-ink-400">
              ใส่แล้ว {shots.length}/{MAX_PHOTOS} ใบ
            </p>

            {error && (
              <div className="mt-3 rounded-card border-2 border-danger bg-danger-bg p-3">
                <p className="font-display text-base text-danger-txt">⚠ ยังคืนไม่สำเร็จ</p>
                <p className="mt-1 text-sm text-danger-txt">{error}</p>
              </div>
            )}

            <button
              type="button"
              className="btn-primary mt-4 w-full"
              disabled={busy || compressing || shots.length === 0}
              onClick={() => void submit()}
            >
              {busy ? <Spinner /> : null}
              {busy ? 'กำลังบันทึก…' : shots.length === 0 ? 'ถ่ายรูปก่อนจึงยืนยันได้' : 'ยืนยันการคืน'}
            </button>
          </>
        )}
      </Sheet>
    </>
  )
}
