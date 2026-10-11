import { useEffect, useState } from 'react'
import { isMyPushEndpoint, pushTest, pushUnsubscribe } from '../lib/api'
import { useAuth } from '../lib/auth'
import { enablePush, iosNeedsInstall, pushSupported } from '../lib/push'
import { readableError } from '../lib/supabase'
import { Spinner } from './ui'

/**
 * เปิดแจ้งเตือนบนเครื่องนี้
 *
 * ข้อจำกัดที่เลี่ยงไม่ได้: iPhone จะเด้งแจ้งเตือนได้ต่อเมื่อเปิดจากไอคอน
 * บนหน้าจอโฮมเท่านั้น (Apple บังคับตั้งแต่ iOS 16.4) เปิดผ่าน Safari เฉย ๆ
 * ปุ่มขออนุญาตจะไม่มีให้กดด้วยซ้ำ จึงต้องสอนติดตั้งก่อน
 *
 * Android ไม่มีเงื่อนไข กดอนุญาตครั้งเดียวจบ
 */

export function PushSetup() {
  const { profile } = useAuth()
  const [supported, setSupported] = useState(true)
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const needsInstall = iosNeedsInstall()

  useEffect(() => {
    const ok = pushSupported()
    setSupported(ok)
    if (!ok) return
    setPermission(Notification.permission)
    // ต้องเช็คว่าเครื่องนี้ลงทะเบียนไว้ในชื่อเราจริง ไม่ใช่แค่ว่ามี subscription อยู่
    // เครื่องที่คนก่อนหน้าเคยเปิดไว้ จะขึ้นว่า "เปิดอยู่" ทั้งที่เจ้าตัวไม่ได้รับอะไรเลย
    void navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then(async (sub) => {
        if (!sub || !profile?.id) return setOn(false)
        setOn(await isMyPushEndpoint(profile.id, sub.endpoint).catch(() => false))
      })
      .catch(() => undefined)
  }, [profile?.id])

  async function enable() {
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      await enablePush()
      setPermission(Notification.permission)
      setOn(true)
      setMsg('เปิดแจ้งเตือนบนเครื่องนี้แล้ว')
    } catch (e) {
      setPermission(typeof Notification !== 'undefined' ? Notification.permission : 'default')
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await pushUnsubscribe(sub.endpoint)
        await sub.unsubscribe()
      }
      setOn(false)
      setMsg('ปิดแจ้งเตือนบนเครื่องนี้แล้ว')
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      const res = await pushTest()
      setMsg(
        res.sent > 0
          ? `ส่งทดสอบไป ${res.sent} เครื่องแล้ว — ถ้าไม่เด้งภายใน 10 วินาที แปลว่ายังมีอะไรติด`
          : 'ยังไม่มีเครื่องไหนเปิดแจ้งเตือนไว้',
      )
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card mt-4 p-4">
      <h2 className="font-display text-md">แจ้งเตือนเข้ามือถือ</h2>
      <p className="mt-1 text-sm text-ink-500">
        เตือนก่อนเลิกกะ 10 นาที · เลยเวลาคืน 15 นาทีเตือนอีกครั้ง แล้วย้ำทุก 15 นาทีจนกว่าจะกดคืน
        — ปิดแอพอยู่ก็เด้ง
      </p>

      {!supported && (
        <p className="mt-3 rounded-card bg-warn-bg px-3 py-2 text-sm text-warn-txt">
          เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน ลองใช้ Chrome บน Android หรือ Safari บน iPhone
        </p>
      )}

      {supported && needsInstall && (
        <div className="mt-3 rounded-card border border-brand-300 bg-brand-50 p-3 text-sm">
          <p className="font-display text-base">iPhone ต้องติดตั้งลงหน้าจอโฮมก่อน</p>
          <p className="mt-1 text-ink-700">
            Apple ยอมให้เว็บเด้งแจ้งเตือนเฉพาะตอนเปิดจากไอคอนบนหน้าจอโฮมเท่านั้น ทำครั้งเดียวจบ
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-700">
            <li>
              กดปุ่ม <b>แชร์</b> ข้างล่างจอ (รูปสี่เหลี่ยมมีลูกศรชี้ขึ้น)
            </li>
            <li>
              เลื่อนลงหา <b>เพิ่มไปยังหน้าจอโฮม</b> แล้วกด <b>เพิ่ม</b>
            </li>
            <li>ปิด Safari แล้วเปิดแอพจากไอคอนใหม่ที่หน้าจอโฮม</li>
            <li>กลับมาหน้านี้อีกครั้ง แล้วกดปุ่มเปิดแจ้งเตือน</li>
          </ol>
        </div>
      )}

      {supported && permission === 'denied' && (
        <p className="mt-3 rounded-card bg-danger-bg px-3 py-2 text-sm text-danger-txt">
          เครื่องนี้เคยกดปฏิเสธไว้ ต้องไปเปิดเองในตั้งค่าเบราว์เซอร์ของเครื่อง
          แล้วกลับมากดปุ่มนี้อีกครั้ง
        </p>
      )}

      {msg && (
        <p className="mt-3 rounded-card bg-success-bg px-3 py-2 text-sm text-success-txt">{msg}</p>
      )}
      {error && (
        <p className="mt-3 rounded-card bg-danger-bg px-3 py-2 text-sm text-danger-txt">{error}</p>
      )}

      {supported && !needsInstall && (
        <div className="mt-3 flex flex-wrap gap-2">
          {on ? (
            <>
              <span className="badge-ok self-center">เปิดอยู่บนเครื่องนี้</span>
              <button type="button" className="btn-soft" disabled={busy} onClick={() => void test()}>
                {busy ? <Spinner /> : null} ส่งทดสอบ
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => void disable()}
              >
                ปิดบนเครื่องนี้
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-primary w-full py-4"
              disabled={busy || permission === 'denied'}
              onClick={() => void enable()}
            >
              {busy ? <Spinner /> : null} เปิดแจ้งเตือนบนเครื่องนี้
            </button>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-ink-400">
        เปิดแยกทีละเครื่อง ถ้าใช้ทั้งมือถือและคอมให้กดเปิดทั้งสองเครื่อง
      </p>
    </section>
  )
}
