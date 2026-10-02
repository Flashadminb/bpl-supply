import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { stampLines } from '../lib/image'
import { PhotoSteps, shotsToPhotos, type Shot } from './PhotoSteps'
import { Sheet, Spinner } from './ui'
import type { IssuePhotoIn } from '../lib/api'

/**
 * กล่องเคลียร์ใบแจ้งชำรุด — รูปตอนซ่อมเสร็จบังคับ
 *
 * ของเดิมกดเคลียร์ได้เลยโดยไม่ต้องมีอะไรเลย ซึ่งแปลว่าประวัติบอกได้แค่ว่า
 * "มีคนกดว่าซ่อมแล้ว" ไม่ได้บอกว่าซ่อมจริงไหมและซ่อมออกมาหน้าตาเป็นยังไง
 * พอเครื่องเดิมพังซ้ำในอีกสองอาทิตย์ จึงไล่ไม่ได้ว่ารอบที่แล้วแก้อะไรไป
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
  const ready = photos.length >= 1 && !uploading && !failed

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

      <p className="label">รูปตอนซ่อมเสร็จ (บังคับ)</p>
      <PhotoSteps
        steps={[]}
        maxFree={5}
        minFree={1}
        stamp={stamp}
        shots={shots}
        onShots={setShots}
      />

      <label className="label mt-3" htmlFor="fix-note">
        บันทึกการซ่อม (ไม่บังคับ)
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
            : photos.length === 0
              ? 'ถ่ายรูปก่อน'
              : 'ยืนยันว่าซ่อมเสร็จแล้ว'}
      </button>
    </Sheet>
  )
}
