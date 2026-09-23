import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

/**
 * QR รหัสเริ่มต้นสำหรับส่งให้พนักงาน
 *
 * เดิมต้องพิมพ์รหัสพนักงานกับรหัสผ่านส่งทางแชต ซึ่งพิมพ์ผิดง่ายและเหนื่อย
 * อันนี้ทำเป็นรูปให้ก๊อปไปวางในแชตได้เลย หน้างานสแกนแล้วเข้าระบบทันที
 *
 * ข้างในเก็บรหัสผ่านจริง จึงต้องถือว่าเป็นความลับเท่ากับรหัสผ่าน
 * ส่งเป็นการส่วนตัว อย่าโพสต์ในกลุ่มที่คนนอกเห็น
 * รหัสนี้ใช้ได้ครั้งเดียวในทางปฏิบัติ เพราะระบบบังคับตั้งรหัสใหม่ทันทีที่ล็อกอิน
 */

export const LOGIN_QR_PREFIX = 'BPLLOGIN:'

export function loginQrPayload(code: string, password: string): string {
  return `${LOGIN_QR_PREFIX}${code}|${password}`
}

/** อ่านค่าจาก QR — คืน null ถ้าไม่ใช่รูปแบบของระบบนี้ */
export function parseLoginQr(raw: string): { code: string; password: string } | null {
  const t = raw.trim()
  if (!t.toUpperCase().startsWith(LOGIN_QR_PREFIX)) return null
  const body = t.slice(LOGIN_QR_PREFIX.length)
  const at = body.indexOf('|')
  if (at < 1) return null
  const code = body.slice(0, at).trim()
  const password = body.slice(at + 1)
  if (!code || !password) return null
  return { code, password }
}

export function LoginQr({
  employeeCode,
  fullName,
  password,
}: {
  employeeCode: string
  fullName?: string
  password: string
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    let alive = true
    QRCode.toDataURL(loginQrPayload(employeeCode, password), {
      width: 512,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#1A1712', light: '#FFFFFF' },
    })
      .then((d) => alive && setSrc(d))
      .catch(() => alive && setSrc(null))
    return () => {
      alive = false
    }
  }, [employeeCode, password])

  async function copyImage() {
    setMsg(null)
    try {
      if (!src) return
      const blob = await (await fetch(src)).blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      setMsg('คัดลอกรูปแล้ว วางในแชตได้เลย')
    } catch {
      setMsg('เบราว์เซอร์นี้คัดลอกรูปไม่ได้ ใช้ปุ่มดาวน์โหลด หรือคลิกขวาที่รูปแล้วคัดลอก')
    }
  }

  function download() {
    if (!src) return
    const a = document.createElement('a')
    a.href = src
    a.download = `BPL-login-${employeeCode}.png`
    a.click()
  }

  async function copyText() {
    setMsg(null)
    try {
      await navigator.clipboard.writeText(
        `BPL SUPPLY\nรหัสพนักงาน ${employeeCode}\nรหัสผ่านเริ่มต้น ${password}\n${location.origin}`,
      )
      setMsg('คัดลอกข้อความแล้ว')
    } catch {
      setMsg('คัดลอกไม่สำเร็จ ลองเลือกข้อความแล้วกดคัดลอกเอง')
    }
  }

  return (
    <div className="rounded-card border border-line bg-surface p-3 text-center">
      {src ? (
        <img
          ref={imgRef}
          src={src}
          alt={`QR เข้าระบบของ ${employeeCode}`}
          className="mx-auto h-auto w-[220px] rounded-card"
        />
      ) : (
        <div className="mx-auto aspect-square w-[220px] rounded-card bg-surface-2" />
      )}

      <p className="mt-2 font-display">
        {fullName ? `${fullName} · ` : ''}
        {employeeCode}
      </p>
      <p className="font-mono text-sm text-ink-500">รหัสผ่าน {password}</p>

      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <button type="button" className="btn-primary h-tap px-3 text-sm" onClick={() => void copyImage()}>
          คัดลอกรูป
        </button>
        <button type="button" className="btn-soft h-tap px-3 text-sm" onClick={download}>
          ดาวน์โหลดรูป
        </button>
        <button type="button" className="btn-ghost h-tap px-3 text-sm" onClick={() => void copyText()}>
          คัดลอกเป็นข้อความ
        </button>
      </div>

      {msg && <p className="mt-2 text-sm text-ink-500">{msg}</p>}

      <p className="mt-3 rounded-btn bg-danger-bg px-3 py-2 text-left text-xs text-danger-txt">
        รูปนี้มีรหัสผ่านอยู่ข้างใน ส่งให้เจ้าตัวเป็นการส่วนตัวเท่านั้น อย่าโพสต์ในกลุ่ม
        <br />
        พอเจ้าตัวล็อกอินครั้งแรก ระบบจะบังคับตั้งรหัสใหม่ทันที QR นี้ก็หมดประโยชน์ไปเอง
      </p>
    </div>
  )
}
