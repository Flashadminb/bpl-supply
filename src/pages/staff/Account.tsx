import { useState, type FormEvent } from 'react'
import { useAuth } from '../../lib/auth'
import { changeMyPassword } from '../../lib/api'
import { readableError } from '../../lib/supabase'
import { StaffPage, TopBar } from '../../components/Shell'
import { PushSetup } from '../../components/PushSetup'
import { Spinner } from '../../components/ui'
import { ROLE_TH } from '../../lib/roles'


const MIN = 8

export default function Account() {
  const { profile, hubName, signOut } = useAuth()
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const tooShort = pwd.length > 0 && pwd.length < MIN
  const mismatch = confirm.length > 0 && pwd !== confirm
  const canSubmit = pwd.length >= MIN && pwd === confirm && !busy

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setDone(false)
    setBusy(true)
    try {
      await changeMyPassword(pwd)
      setPwd('')
      setConfirm('')
      setDone(true)
    } catch (err) {
      setError(readableError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TopBar title="บัญชีของฉัน" back="/" />
      <StaffPage>
        <section className="card p-4">
          <p className="font-display text-lg">{profile?.full_name}</p>
          <p className="font-mono text-sm text-ink-400">{profile?.employee_code}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="badge-mute">{hubName}</span>
            {profile?.dept_code && (
              <span className="badge-mute">
                {profile.dept_code}
                {profile.sub_dept ? ` · ${profile.sub_dept}` : ''}
              </span>
            )}
            {profile?.shift_start && profile?.shift_end && (
              <span className="badge-mute">
                กะ {profile.shift_start.slice(0, 5)}–{profile.shift_end.slice(0, 5)}
              </span>
            )}
            <span className="badge-mute">{profile ? ROLE_TH[profile.role] : ''}</span>
            <span className={profile?.is_active ? 'badge-ok' : 'badge-dang'}>
              {profile?.is_active ? 'ใช้งานอยู่' : 'ถูกระงับ'}
            </span>
          </div>
          <p className="mt-3 text-xs text-ink-400">
            ชื่อ รหัสพนักงาน แผนก กะ และบทบาท แก้ได้โดยแอดมินเท่านั้น ถ้าข้อมูลผิดให้แจ้งแอดมิน
            {!profile?.shift_start && (
              <>
                <br />
                <span className="text-warn-txt">
                  ยังไม่ได้ตั้งกะ — ระบบจะคำนวณเวลาคืนอุปกรณ์ไม่ได้ แจ้งแอดมินให้ใส่ให้
                </span>
              </>
            )}
          </p>
        </section>

        <form onSubmit={onSubmit} className="card mt-3 p-4">
          <h2 className="font-display text-md">เปลี่ยนรหัสผ่าน</h2>
          <p className="mt-1 text-sm text-ink-400">อย่างน้อย {MIN} ตัวอักษร</p>

          <label className="label mt-3" htmlFor="new">
            รหัสผ่านใหม่
          </label>
          <input
            id="new"
            type={show ? 'text' : 'password'}
            className="input"
            autoComplete="new-password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
          />
          {tooShort && <p className="mt-1 text-sm text-danger-txt">สั้นไป ต้องอย่างน้อย {MIN} ตัว</p>}

          <label className="label mt-3" htmlFor="confirm">
            พิมพ์รหัสผ่านใหม่อีกครั้ง
          </label>
          <input
            id="confirm"
            type={show ? 'text' : 'password'}
            className="input"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {mismatch && <p className="mt-1 text-sm text-danger-txt">สองช่องไม่ตรงกัน</p>}

          <label className="mt-3 inline-flex min-h-tap items-center gap-2 text-base">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[var(--yellow-500)]"
              checked={show}
              onChange={(e) => setShow(e.target.checked)}
            />
            แสดงรหัสผ่าน
          </label>

          {error && <p className="mt-3 rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-txt">{error}</p>}
          {done && (
            <p className="mt-3 rounded-btn bg-success-bg px-3 py-2 text-sm text-success-txt">
              เปลี่ยนรหัสผ่านเรียบร้อย ครั้งหน้าใช้รหัสใหม่เข้าระบบ
            </p>
          )}

          <button type="submit" className="btn-primary mt-4 w-full" disabled={!canSubmit}>
            {busy ? <Spinner /> : null}
            {busy ? 'กำลังบันทึก…' : 'บันทึกรหัสผ่านใหม่'}
          </button>
        </form>

        <button type="button" className="btn-ghost mt-3 w-full" onClick={() => void signOut()}>
          ออกจากระบบ
        </button>

        <PushSetup />

        <p className="mt-4 text-center text-sm text-ink-400">
          ลืมรหัสผ่านจนเข้าระบบไม่ได้ ต้องให้แอดมินตั้งรหัสใหม่ให้
        </p>
      </StaffPage>
    </>
  )
}
