import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import { createByBarcode, listByRows } from '../../lib/api'
import { readableError } from '../../lib/supabase'
import { StaffPage, TopBar } from '../../components/Shell'
import { ErrorBox, Spinner } from '../../components/ui'
import { PhotoSteps, shotsToPhotos, type Shot } from '../../components/PhotoSteps'
import { stampLines } from '../../lib/image'
import { fmtDateTime } from '../../lib/format'

/**
 * ส่งบาร์โค้ดจาก BY
 *
 * ของบางอย่างหน้างานไม่ได้กดเบิกในระบบนี้ แค่ส่งบาร์โค้ดมาให้แอดมินสแกน
 * แล้วแอดมินไปตัดสต็อกในระบบ BY เอง หน้านี้จึงมีแค่รูปกับเหตุผล
 * ไม่มีรายการวัสดุ ไม่มีจำนวน ไม่มีการอนุมัติ
 */

const QUICK = ['เบิกใช้หน้างาน', 'ของหมดหน้างาน', 'เปลี่ยนของชำรุด', 'ลูกค้าขอเพิ่ม', 'งานด่วน']

export default function BySend() {
  const { profile } = useAuth()
  const mine = useAsync(
    () => listByRows({ mineOnly: true, userId: profile?.id, status: 'all', limit: 5 }),
    [profile?.id],
  )

  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ ref: string; photos: number } | null>(null)

  const photos = shotsToPhotos(shots)
  const uploading = shots.some((s) => s.state === 'uploading' || s.state === 'ready')
  const failed = shots.some((s) => s.state === 'failed')
  // ต้องมีรูปอย่างน้อย 1 ใบ แต่ไม่บังคับให้ถ่ายเยอะ · เกินจากนั้นแล้วแต่คน
  const ready = photos.length > 0 && reason.trim().length > 0 && !uploading && !failed

  const blockedWhy = failed
    ? 'มีรูปส่งไม่สำเร็จ กดที่รูปนั้นเพื่อส่งใหม่'
    : uploading
      ? 'กำลังส่งรูปขึ้นระบบ รอสักครู่'
      : photos.length === 0
        ? 'แนบรูปบาร์โค้ดอย่างน้อย 1 ใบ'
        : 'ใส่เหตุผลก่อน'

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await createByBarcode({
        reason: reason.trim(),
        note: note.trim() || undefined,
        photos: photos.map((p) => ({ file_id: p.file_id, web_link: p.web_link, bytes: p.bytes })),
      })
      setDone({ ref: res.ref_no, photos: res.photos })
      setShots([])
      setReason('')
      setNote('')
      mine.reload()
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-dvh bg-canvas">
        <header className="safe-t bg-success text-white">
          <div className="mx-auto max-w-phone px-4 pb-5 pt-5">
            <p className="font-display text-xl">✓ ส่งบาร์โค้ดแล้ว</p>
            <p className="mt-1 text-sm">
              {profile?.full_name} · {profile?.employee_code}
              {profile?.dept_code ? ` · ${profile.dept_code}` : ''}
            </p>
            <p className="font-mono text-xs">
              {fmtDateTime(new Date().toISOString())} · {done.ref}
            </p>
          </div>
        </header>

        <StaffPage className="-mt-3">
          <p className="rounded-card border border-line bg-surface p-4 text-center">
            ส่งรูปบาร์โค้ด <b>{done.photos} ใบ</b> ให้แอดมินแล้ว
            <br />
            <span className="text-sm text-ink-500">แอดมินจะไปตัดสต็อกในระบบ BY ให้</span>
          </p>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Link to="/" className="btn-soft py-4 text-center">
              กลับหน้าแรก
            </Link>
            <button type="button" className="btn-primary py-4" onClick={() => setDone(null)}>
              ส่งอีกรายการ
            </button>
          </div>
        </StaffPage>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <TopBar title="ส่งบาร์โค้ดจาก BY" back="/" />
      <StaffPage nav={false} className="pb-[130px]">
        <p className="mb-3 rounded-card border border-line bg-surface p-3 text-sm text-ink-500">
          ของที่ไม่ได้กดเบิกในระบบนี้ — ส่งบาร์โค้ดมา แอดมินจะตัดสต็อกในระบบ BY ให้
          <br />
          แนบรูปอย่างน้อย 1 ใบ จะกี่ใบก็ได้ ไม่ต้องถ่ายเยอะ
        </p>

        <section className="mb-3 rounded-card border border-line bg-surface p-3">
          <h2 className="font-display">รูปบาร์โค้ด</h2>
          <p className="mb-2 text-sm text-ink-400">อย่างน้อย 1 ใบ เกินจากนั้นแล้วแต่คุณ</p>
          <PhotoSteps
            steps={[]}
            maxFree={30}
            stamp={stampLines(
              profile?.full_name ?? '',
              profile?.employee_code ?? '',
              profile?.dept_code ?? 'BPL',
              'บาร์โค้ด BY',
            )}
            shots={shots}
            onShots={setShots}
          />
        </section>

        <section className="rounded-card border border-line bg-surface p-3">
          <label className="label" htmlFor="by-reason">
            เหตุผล
          </label>
          <div className="mb-2 flex flex-wrap gap-1">
            {QUICK.map((q) => (
              <button
                key={q}
                type="button"
                className={`chip ${reason === q ? 'chip-on' : ''}`}
                onClick={() => setReason(q)}
              >
                {q}
              </button>
            ))}
          </div>
          <input
            id="by-reason"
            className="input"
            placeholder="หรือพิมพ์เอง"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />

          <label className="label mt-3" htmlFor="by-note">
            หมายเหตุ (ไม่บังคับ)
          </label>
          <textarea
            id="by-note"
            className="input h-[80px] w-full"
            placeholder="อยากบอกอะไรแอดมินเพิ่ม"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </section>

        {error && (
          <div className="mt-3">
            <ErrorBox message={error} />
          </div>
        )}

        {(mine.data ?? []).length > 0 && (
          <section className="mt-5">
            <h2 className="mb-2 font-display text-md">ที่ส่งไปล่าสุด</h2>
            <ul className="space-y-1">
              {(mine.data ?? []).map((r) => (
                <li key={r.id} className="card flex items-center justify-between gap-2 p-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base">{r.reason}</span>
                    <span className="block font-mono text-xs text-ink-400">
                      {r.ref_no} · {fmtDateTime(r.created_at)} · {r.photo_count} รูป
                    </span>
                  </span>
                  <span
                    className={
                      r.status === 'done'
                        ? 'badge-ok'
                        : r.status === 'rejected'
                          ? 'badge-dang'
                          : 'badge-warn'
                    }
                  >
                    {r.status === 'done' ? 'ตัดสต็อกแล้ว' : r.status === 'rejected' ? 'ไม่รับ' : 'รอแอดมิน'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </StaffPage>

      <div className="safe-b fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface p-3 shadow-float">
        <div className="mx-auto max-w-phone">
          <button
            type="button"
            className="btn-primary w-full py-4 text-md"
            disabled={!ready || busy}
            onClick={() => void submit()}
          >
            {busy ? <Spinner /> : null}
            {busy ? 'กำลังส่ง…' : ready ? `ส่งบาร์โค้ด ${photos.length} ใบ` : blockedWhy}
          </button>
        </div>
      </div>
    </div>
  )
}
