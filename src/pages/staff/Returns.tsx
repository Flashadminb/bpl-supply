import { useRef, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import { createReturn, listOpenBorrowings, uploadEvidence } from '../../lib/api'
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

export default function Returns() {
  const { profile } = useAuth()
  const open = useAsync(() => listOpenBorrowings(true, profile?.id), [profile?.id])
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  const [target, setTarget] = useState<OpenBorrowing | null>(null)
  const [qty, setQty] = useState(1)
  const [cond, setCond] = useState<ReturnCond>('ok')
  const [img, setImg] = useState<CompressedImage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  function openSheet(b: OpenBorrowing) {
    setTarget(b)
    setQty(b.qty_open)
    setCond('ok')
    setError(null)
    releaseImage(img)
    setImg(null)
  }

  function closeSheet() {
    releaseImage(img)
    setImg(null)
    setTarget(null)
  }

  async function onPick(file: File | undefined, from: 'camera' | 'gallery') {
    if (!file) return
    try {
      releaseImage(img)
      setImg(
        await compressImage(file, {
          stamp: stampLines(
            profile?.full_name ?? '—',
            profile?.employee_code ?? '—',
            profile?.hub_code ?? '—',
            from === 'gallery' ? 'คืนวัสดุ · เลือกจากคลังรูป' : 'คืนวัสดุ',
          ),
        }),
      )
    } catch (e) {
      setError(readableError(e))
    }
  }

  async function submit() {
    if (!target) return
    setBusy(true)
    setError(null)
    try {
      let fileId: string | null = null
      let link: string | null = null
      if (img) {
        try {
          const up = await uploadEvidence(img.blob, `return-${Date.now()}.webp`)
          fileId = up.fileId
          link = up.webViewLink
        } catch (e) {
          // รูปตอนคืนไม่บังคับ — บันทึกการคืนต่อไปได้
          console.warn('[BPL] อัปรูปตอนคืนไม่สำเร็จ', e)
        }
      }
      await createReturn({ lineId: target.requisition_item_id, qty, condition: cond, fileId, link })
      setDone(`คืน ${target.item_name} ${qty} ${target.unit} เรียบร้อย`)
      closeSheet()
      open.reload()
      setTimeout(() => setDone(null), 3000)
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TopBar title="คืนวัสดุ" back="/" />
      <StaffPage>
        {open.loading && <Loading />}
        {open.error && <ErrorBox message={open.error} onRetry={open.reload} />}
        {done && (
          <p className="mb-3 rounded-card bg-success-bg p-3 text-sm text-success-txt">{done}</p>
        )}

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
                    <b className="text-warn-txt">ค้าง {b.qty_open} {b.unit}</b>
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
                void onPick(e.target.files?.[0], 'camera')
                e.target.value = ''
              }}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void onPick(e.target.files?.[0], 'gallery')
                e.target.value = ''
              }}
            />

            <p className="label mt-4">รูปสภาพตอนคืน (ไม่บังคับ)</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-ghost" onClick={() => cameraRef.current?.click()}>
                {img ? 'ถ่ายใหม่' : 'ถ่ายรูป'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => galleryRef.current?.click()}>
                เลือกจากเครื่อง
              </button>
            </div>
            {img && <p className="mt-1 font-mono text-xs text-ink-400">{prettyBytes(img.bytes)}</p>}
            {img && (
              <img src={img.objectUrl} alt="สภาพตอนคืน" className="mt-2 max-h-[180px] w-full rounded-card object-contain" />
            )}

            {error && <p className="mt-3 rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-txt">{error}</p>}

            <button type="button" className="btn-primary mt-4 w-full" disabled={busy} onClick={() => void submit()}>
              {busy ? <Spinner /> : null}
              {busy ? 'กำลังบันทึก…' : 'ยืนยันการคืน'}
            </button>
          </>
        )}
      </Sheet>
    </>
  )
}
