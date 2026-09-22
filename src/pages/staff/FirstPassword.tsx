import { useState, type FormEvent } from 'react'
import { useAuth } from '../../lib/auth'
import { changeMyPassword } from '../../lib/api'
import { readableError } from '../../lib/supabase'
import { Spinner } from '../../components/ui'

const MIN = 8

/**
 * หน้าบังคับตั้งรหัสผ่านเองตอนล็อกอินครั้งแรก (หรือหลังแอดมินรีเซ็ตรหัสให้)
 * ไม่มีทางกดข้าม — แอดมินจะได้ไม่รู้รหัสถาวรของพนักงาน
 */
export default function FirstPassword() {
  const { profile, refreshProfile, signOut } = useAuth()
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tooShort = pwd.length > 0 && pwd.length < MIN
  const mismatch = confirm.length > 0 && pwd !== confirm

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await changeMyPassword(pwd)
      await refreshProfile()
    } catch (err) {
      setError(readableError(err))
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <div className="safe-t bg-brand-500 px-4 pb-6 pt-8 text-ink">
        <div className="mx-auto max-w-phone">
          <h1 className="font-display text-xl font-semibold">ตั้งรหัสผ่านของคุณ</h1>
          <p className="mt-1 text-base">
            สวัสดี {profile?.full_name} — ก่อนใช้งาน ตั้งรหัสผ่านที่คุณจำได้เองก่อน
          </p>
        </div>
      </div>

      <main className="mx-auto w-full max-w-phone flex-1 px-4 py-5">
        <p className="rounded-card border border-warn/30 bg-warn-bg p-3 text-sm text-warn-txt">
          รหัสที่แอดมินให้มาเป็นรหัส<b>ชั่วคราว</b> ตั้งรหัสใหม่แล้วจะใช้รหัสเดิมไม่ได้อีก
          และแอดมินจะไม่รู้รหัสใหม่ของคุณ
        </p>

        <form onSubmit={onSubmit} className="panel mt-4 p-4">
          <label className="label" htmlFor="new">
            รหัสผ่านใหม่ <span className="font-normal text-ink-400">อย่างน้อย {MIN} ตัวอักษร</span>
          </label>
          <input
            id="new"
            type={show ? 'text' : 'password'}
            className="input"
            autoComplete="new-password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            required
          />
          {tooShort && <p className="mt-1 text-sm text-danger-txt">สั้นไป ต้องอย่างน้อย {MIN} ตัว</p>}

          <label className="label mt-4" htmlFor="confirm">
            พิมพ์อีกครั้งให้ตรงกัน
          </label>
          <input
            id="confirm"
            type={show ? 'text' : 'password'}
            className="input"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          {mismatch && <p className="mt-1 text-sm text-danger-txt">สองช่องไม่ตรงกัน</p>}

          <label className="mt-4 inline-flex min-h-tap items-center gap-2 text-base">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[var(--yellow-500)]"
              checked={show}
              onChange={(e) => setShow(e.target.checked)}
            />
            แสดงรหัสผ่าน
          </label>

          {error && <p className="mt-3 rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-txt">{error}</p>}

          <button
            type="submit"
            className="btn-primary mt-4 w-full"
            disabled={busy || pwd.length < MIN || pwd !== confirm}
          >
            {busy ? <Spinner /> : null}
            {busy ? 'กำลังบันทึก…' : 'บันทึกแล้วเริ่มใช้งาน'}
          </button>
        </form>

        <button type="button" className="btn-ghost mt-3 w-full" onClick={() => void signOut()}>
          ออกจากระบบ
        </button>
      </main>
    </div>
  )
}
