import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { stampLines } from '../lib/image'
import { PhotoSteps, shotsToPhotos, type Shot } from './PhotoSteps'
import { Sheet, Spinner } from './ui'
import type { IssuePhotoIn } from '../lib/api'

/**
 * กล่องเคลียร์ใบแจ้งชำรุด — ต้องมีอย่างน้อยหนึ่งอย่าง รูปหรือข้อความ
 *
 * ของเดิมกดเคลียร์ได้เลยโดยไม่ต้องมีอะไรเลย ซึ่งแปลว่าประวัติบอกได้แค่ว่า
 * "มีคนกดว่าซ่อมแล้ว" ไม่ได้บอกว่าซ่อมจริงไหมและซ่อมออกมาหน้าตาเป็นยังไง
 * พอเครื่องเดิมพังซ้ำในอีกสองอาทิตย์ จึงไล่ไม่ได้ว่ารอบที่แล้วแก้อะไรไป
 *
 * เคยบังคับถ่ายรูปอย่างเดียว แต่งานจริงหลายครั้งไม่มีอะไรให้ถ่าย
 * ส่งศูนย์เคลมไปแล้ว หรือเป็นอาการที่ถ่ายไม่ติด การบังคับในกรณีพวกนี้
 * ได้รูปเครื่องเฉย ๆ ที่ไม่บอกอะไร ส่วนคำอธิบายที่มีค่าจริงกลับไม่ถูกบังคับ
 * ตอนนี้จึงเลือกได้ว่าจะถ่ายหรือจะเขียน แต่ปล่อยว่างทั้งคู่ไม่ได้
 *
 * ใช้ตัวเดียวกันทั้งเคลียร์ใบเดียวและเคลียร์ทั้งเครื่อง
 * เขียนสองที่แล้วแก้ไม่ครบทั้งคู่คือเรื่องที่เกิดขึ้นเสมอ
 */
export function IssueFixSheet({
  open,
  title,
  hint,
  onClose,
  onSubmit,
}: {
  open: boolean
  title: string
  hint?: string
  onClose: () => void
  onSubmit: (photos: IssuePhotoIn[], note: string | null) => Promise<void>
}) {
  const { profile } = useAuth()
  const [shots, setShots] = useState<Shot[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const photos = shotsToPhotos(shots)
  const uploading = shots.some((s) => s.state === 'uploading' || s.state === 'ready')
  const failed = shots.some((s) => s.state === 'failed')
  const written = note.trim().length > 0
  const ready = (photos.length >= 1 || written) && !uploading && !failed

  const stamp = stampLines(
    profile?.full_name ?? '',
    profile?.employee_code ?? '',
    profile?.dept_code ?? profile?.hub_code ?? 'BPL',
    'ซ่อมเสร็จ',
  )

  function close() {
    setShots([])
    setNote('')
    setErr(null)
    onClose()
  }

  return (
    <Sheet open={open} title={title} onClose={close}>
      {hint && <p className="mb-3 text-sm text-ink-500">{hint}</p>}

      <p className="label">รูปตอนซ่อมเสร็จ (ถ่ายหรือไม่ถ่ายก็ได้)</p>
      <PhotoSteps
        steps={[]}
        maxFree={5}
        minFree={0}
        stamp={stamp}
        shots={shots}
        onShots={setShots}
      />

      <label className="label mt-3" htmlFor="fix-note">
        ซ่อมอะไรไป {photos.length === 0 ? '(ไม่ถ่ายรูปก็ต้องเขียนช่องนี้)' : '(ไม่บังคับ)'}
      </label>
      <input
        id="fix-note"
        className="input"
        placeholder="เช่น เปลี่ยนแบตใหม่ · ส่งศูนย์เคลม"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      {err && (
        <p className="mt-3 rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-txt">{err}</p>
      )}

      <button
        type="button"
        className="btn-primary mt-4 w-full py-4 text-md"
        disabled={busy || !ready}
        onClick={() => {
          setBusy(true)
          setErr(null)
          void (async () => {
            try {
              await onSubmit(
                photos.map((p) => ({
                  file_id: p.file_id,
                  web_link: p.web_link,
                  bytes: p.bytes,
                })),
                note.trim() || null,
              )
              close()
            } catch (e) {
              setErr((e as Error).message)
            } finally {
              setBusy(false)
            }
          })()
        }}
      >
        {busy ? <Spinner /> : null}
        {failed
          ? 'รูปส่งไม่สำเร็จ กดที่รูปเพื่อลองใหม่'
          : uploading
            ? 'กำลังส่งรูป…'
            : photos.length === 0 && !written
              ? 'ถ่ายรูป หรือเขียนว่าซ่อมอะไรไป'
              : 'ยืนยันว่าซ่อมเสร็จแล้ว'}
      </button>
    </Sheet>
  )
}
