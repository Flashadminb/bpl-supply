import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import {
  MAX_PHOTOS,
  createReturn,
  createReturnMany,
  listOpenBorrowings,
  uploadEvidence,
} from '../../lib/api'
import { compressImage, prettyBytes, releaseImage, stampLines, type CompressedImage } from '../../lib/image'
import { readableError } from '../../lib/supabase'
import type { OpenBorrowing, ReturnCond } from '../../lib/types'
import { StaffPage, TopBar } from '../../components/Shell'
import { EmptyState, ErrorBox, Loading, QtyStepper, Sheet, Spinner } from '../../components/ui'
import { fmtDateTime } from '../../lib/format'
import { AssetReturn } from '../../components/AssetReturn'
import { HubHoldings } from '../../components/HubHoldings'
import { TransferNotices } from '../../components/TransferNotices'

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
  // คืนหลายรายการรวดเดียว · ตอนเลิกกะของกองอยู่ตรงหน้าชุดเดียว
  // ไม่มีเหตุผลต้องกดทีละอันแล้วถ่ายรูปซ้ำทุกอัน
  const [bulk, setBulk] = useState<number[]>([])
  const [bulkOpen, setBulkOpen] = useState(false)
  const [qty, setQty] = useState(1)
  const [cond, setCond] = useState<ReturnCond>('ok')
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusy] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [assetCount, setAssetCount] = useState<number | null>(null)
  // เครื่องที่คนอื่นถืออยู่ นับเฉพาะคนที่มีสิทธิ์เห็นทั้งฮับ
  const [hubCount, setHubCount] = useState(0)

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

  const bulkRows = (open.data ?? []).filter((b) => bulk.includes(b.requisition_item_id))

  function openBulk() {
    if (bulk.length === 0) return
    setShots([])
    setCond('ok')
    setError(null)
    setBulkOpen(true)
  }

  function closeBulk() {
    setBulkOpen(false)
    shots.forEach((s) => releaseImage(s.img))
    setShots([])
  }

  async function submitBulk() {
    const okShots = shots.filter((s) => s.state === 'done' && s.fileId)
    if (okShots.length === 0) {
      setError('ต้องมีรูปที่ส่งสำเร็จอย่างน้อย 1 ใบ')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await createReturnMany({
        lines: bulkRows.map((b) => ({ line_id: b.requisition_item_id, qty: b.qty_open })),
        condition: cond,
        photos: okShots.map((s) => ({
          file_id: s.fileId as string,
          web_link: s.webLink ?? null,
          bytes: s.bytes ?? null,
        })),
      })
      setDone(`คืน ${res.lines} รายการ รวม ${res.units} ชิ้น · แนบรูป ${okShots.length} ใบ`)
      setBulk([])
      closeBulk()
      open.reload()
      setTimeout(() => setDone(null), 4000)
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
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

  /** กล่องถ่ายรูป — ใช้ทั้งตอนคืนทีละรายการและคืนหลายรายการ */
  const photoBlock = (
    <>
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
    </>
  )

  return (
    <>
      <TopBar title="คืนของ" back="/" />
      <StaffPage>
        <TransferNotices />
        <AssetReturn onCount={setAssetCount} />
        <HubHoldings onCount={setHubCount} />

        {open.loading && <Loading />}
        {open.error && <ErrorBox message={open.error} onRetry={open.reload} />}
        {done && <p className="mb-3 rounded-card bg-success-bg p-3 text-sm text-success-txt">{done}</p>}

        {!open.loading && !open.error && (open.data ?? []).length === 0 && assetCount === 0 && hubCount === 0 && (
          <EmptyState
            title="ไม่มีของค้างคืน"
            hint="อุปกรณ์และวัสดุประเภทยืม-คืนที่เบิกไปจะขึ้นที่นี่"
          />
        )}

        {(open.data ?? []).length > 0 && (
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-display text-md">
              วัสดุยืม-คืน
              <span className="text-sm text-ink-400"> · {(open.data ?? []).length} รายการ</span>
            </h2>
            {(open.data ?? []).length > 1 && (
              <button
                type="button"
                className="h-tap rounded-btn px-2 text-sm underline decoration-line-2 underline-offset-2"
                onClick={() =>
                  setBulk((v) =>
                    v.length === (open.data ?? []).length
                      ? []
                      : (open.data ?? []).map((b) => b.requisition_item_id),
                  )
                }
              >
                {bulk.length === (open.data ?? []).length ? 'เอาออกทั้งหมด' : 'เลือกทั้งหมด'}
              </button>
            )}
          </div>
        )}

        <ul className="space-y-2">
          {(open.data ?? []).map((b) => (
            <li key={b.requisition_item_id} className="card p-3">
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  aria-label="เลือกคืนรายการนี้"
                  className={`mt-[2px] flex h-6 w-6 shrink-0 items-center justify-center rounded-btn border text-sm ${
                    bulk.includes(b.requisition_item_id)
                      ? 'border-ink bg-ink text-white'
                      : 'border-line-2 text-transparent'
                  }`}
                  onClick={() =>
                    setBulk((v) =>
                      v.includes(b.requisition_item_id)
                        ? v.filter((x) => x !== b.requisition_item_id)
                        : [...v, b.requisition_item_id],
                    )
                  }
                >
                  ✓
                </button>
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
        {bulk.length > 0 && (
          <div className="safe-b sticky bottom-0 z-30 -mx-4 mt-3 border-t border-line bg-surface px-4 py-3">
            <button type="button" className="btn-primary w-full py-4 text-md" onClick={openBulk}>
              คืนที่เลือก {bulk.length} รายการ — เต็มจำนวนที่ค้าง
            </button>
            <p className="mt-1 text-center text-xs text-ink-400">
              ถ้าจะคืนไม่เต็มจำนวน ให้กดปุ่ม คืน ของรายการนั้นแทน
            </p>
          </div>
        )}
      </StaffPage>

      {/* ------------------------------------------------ คืนหลายรายการรวดเดียว */}
      <Sheet
        open={bulkOpen}
        onClose={closeBulk}
        title={`คืน ${bulkRows.length} รายการ`}
      >
        <ul className="space-y-1">
          {bulkRows.map((b) => (
            <li
              key={b.requisition_item_id}
              className="flex items-baseline justify-between gap-2 rounded-card border border-line bg-surface p-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">{b.item_name}</span>
              <span className="shrink-0 font-display">
                {b.qty_open} {b.unit}
              </span>
            </li>
          ))}
        </ul>

        <span className="label mt-4">สภาพของ — ใช้กับทุกรายการที่เลือก</span>
        <div className="flex gap-2">
          {CONDITIONS.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`chip ${cond === c.key ? 'chip-on' : ''}`}
              onClick={() => setCond(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>

        <p className="mt-3 rounded-card bg-surface-2 px-3 py-2 text-sm text-ink-500">
          ถ่ายรูปกองของที่เอามาคืนชุดเดียวพอ · รูปชุดนี้จะติดกับทุกรายการที่เลือก
        </p>

        {photoBlock}

        {error && <div className="mt-3"><ErrorBox message={error} /></div>}

        <button
          type="button"
          className="btn-primary mt-3 w-full py-4 text-md"
          disabled={busy || compressing || shots.length === 0}
          onClick={() => void submitBulk()}
        >
          {busy ? <Spinner /> : null}
          {shots.length === 0 ? 'ถ่ายรูปก่อน' : `ยืนยันคืน ${bulkRows.length} รายการ`}
        </button>
      </Sheet>

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

            {photoBlock}

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
