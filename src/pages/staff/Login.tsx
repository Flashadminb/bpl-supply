import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { rememberedCode, useAuth } from '../../lib/auth'
import { supabaseConfigured, readableError } from '../../lib/supabase'
import { Spinner } from '../../components/ui'

type InstallPrompt = Event & { prompt: () => Promise<void> }

export default function Login() {
  const { session, signIn } = useAuth()
  const nav = useNavigate()
  const [code, setCode] = useState(rememberedCode)
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(Boolean(rememberedCode()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [install, setInstall] = useState<InstallPrompt | null>(null)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setInstall(e as InstallPrompt)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  if (session) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      await signIn(code, password, remember)
      nav('/', { replace: true })
    } catch (err) {
      setError(readableError(err))
    } finally {
      setBusy(false)
    }
  }

  // ระบบไม่ผูกอีเมลจริง จึงส่งลิงก์รีเซ็ตทางอีเมลไม่ได้ — ต้องให้แอดมินตั้งรหัสใหม่ให้แทน
  function onForgot() {
    setError(null)
    setNotice(
      'แจ้งแอดมินให้ตั้งรหัสใหม่ให้ (หน้าแอดมิน → ผู้ใช้และสิทธิ์ → ตั้งรหัสใหม่) ' +
        'แล้วล็อกอินด้วยรหัสชั่วคราวที่ได้ ระบบจะให้คุณตั้งรหัสใหม่เองทันที',
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <div className="safe-t bg-brand-500 px-4 pb-6 pt-8 text-ink">
        <div className="mx-auto max-w-phone">
          <p className="font-mono text-xs tracking-widest">FLASH EXPRESS</p>
          <h1 className="mt-1 font-display text-xl font-semibold">BPL SUPPLY</h1>
          <p className="mt-1 text-base">ระบบเบิก–คืนวัสดุสิ้นเปลือง</p>
        </div>
      </div>

      <main className="mx-auto w-full max-w-phone flex-1 px-4 py-5">
        {!supabaseConfigured && (
          <div className="mb-4 rounded-card border border-warn/30 bg-warn-bg p-3 text-sm text-warn-txt">
            ยังไม่ได้ตั้งค่า <code>.env</code> — คัดลอก <code>.env.example</code> เป็น <code>.env</code> แล้วใส่ค่า
            Supabase ก่อน (ดู SETUP.md ขั้นที่ 3)
          </div>
        )}

        <form onSubmit={onSubmit} className="panel p-4">
          <label className="label" htmlFor="code">
            รหัสพนักงาน <span className="font-normal text-ink-400">Employee code</span>
          </label>
          <input
            id="code"
            className="input"
            autoComplete="username"
            inputMode="text"
            placeholder="FE-10482"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />

          <label className="label mt-4" htmlFor="pwd">
            รหัสผ่าน <span className="font-normal text-ink-400">Password</span>
          </label>
          <input
            id="pwd"
            type="password"
            className="input"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <div className="mt-4 flex items-center justify-between">
            <label className="inline-flex min-h-tap items-center gap-2 text-base">
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--yellow-500)]"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              จำฉันไว้
            </label>
            <button type="button" className="min-h-tap px-1 text-base underline" onClick={onForgot}>
              ลืมรหัสผ่าน
            </button>
          </div>

          {error && (
            <p className="mt-3 rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-txt">{error}</p>
          )}
          {notice && (
            <p className="mt-3 rounded-btn bg-success-bg px-3 py-2 text-sm text-success-txt">{notice}</p>
          )}

          <button type="submit" className="btn-primary mt-4 w-full" disabled={busy}>
            {busy ? <Spinner /> : null}
            {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-400">
          เข้าระบบด้วย QR บัตรพนักงาน — ยังไม่เปิดใช้ในเวอร์ชันนี้
        </p>

        {install && (
          <div className="card mt-5 flex items-center gap-3 p-3">
            <div className="flex-1">
              <p className="font-display text-base">ติดตั้งเป็นแอปบนมือถือ</p>
              <p className="text-sm text-ink-400">เปิดเร็วขึ้น ใช้เต็มจอ ไม่ต้องพิมพ์ลิงก์</p>
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                void install.prompt()
                setInstall(null)
              }}
            >
              ติดตั้ง
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
