import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { countMyPushDevices, isMyPushEndpoint } from '../lib/api'
import { enablePush, iosNeedsInstall, localSubscription, pushSupported } from '../lib/push'
import { readableError } from '../lib/supabase'
import { Modal, Spinner } from './ui'

/**
 * เด้งขอเปิดแจ้งเตือนทุกครั้งที่เปิดแอพ ถ้าบัญชีนั้นยังไม่มีเครื่องไหนเปิดไว้เลย
 *
 * ที่ต้องเด้ง เพราะหน้าบัญชีของฉันมีปุ่มอยู่แล้วแต่ไม่มีใครเข้าไปกด
 * ผลคือทั้งฮับ 92 คน เปิดไว้ 28 คน ประกาศอะไรไปอีก 64 คนก็ไม่รู้เรื่อง
 * ของที่ต้องให้คนไปหาเอง เท่ากับของที่ไม่มี
 *
 * เงื่อนไขการเด้ง ดูที่ "ทั้งบัญชี" ไม่ใช่ "เครื่องนี้"
 * คนที่เปิดไว้บนมือถือแล้วมานั่งเครื่องกลางในออฟฟิศ ไม่ควรโดนทวงซ้ำ
 * เพราะเขารับแจ้งเตือนได้อยู่แล้ว ซึ่งเป็นเป้าหมายจริงของเรื่องนี้
 *
 * เครื่องที่เคยกดอนุญาตไว้แล้วแต่ subscription หลุด จะถูกซ่อมเงียบ ๆ ไม่เด้งถาม
 * กรณีนี้เกิดจริงเวลาล้างข้อมูลเว็บหรือถอนติดตั้งแอพแล้วลงใหม่
 *
 * ปุ่ม "ไว้ก่อน" ปิดได้แค่รอบนี้ เปิดแอพใหม่ก็เจออีก ตามที่เจ้าของระบบสั่งว่าให้เด้งเสมอ
 * แต่ต้องมีทางปิด ไม่งั้นคนที่กำลังรีบจะถูกกล่องขวางงานโดยไม่มีทางออก
 */

const SNOOZE = 'push.nag.snoozed'

/* บางเครื่องปิด storage ไว้ · อ่านไม่ได้ให้ถือว่ายังไม่เคยกดไว้ก่อน ดีกว่าพังทั้งแอพ */
const snoozed = () => {
  try {
    return sessionStorage.getItem(SNOOZE) === '1'
  } catch {
    return false
  }
}

export function PushNag() {
  const { session, profile, loading } = useAuth()
  const [show, setShow] = useState(false)
  /** 'ask' ขออนุญาตได้ · 'denied' เคยปฏิเสธไว้ · 'ios' ต้องติดตั้งลงโฮมก่อน */
  const [mode, setMode] = useState<'ask' | 'denied' | 'ios'>('ask')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (loading || !session || !profile) return
    if (snoozed()) return

    let dead = false
    void (async () => {
      // iPhone ที่ยังไม่ติดตั้งลงโฮม · ขออนุญาตไม่ได้เลย ต้องสอนติดตั้งก่อน
      if (iosNeedsInstall()) {
        const n = await countMyPushDevices(profile.id).catch(() => 1)
        if (!dead && n === 0) {
          setMode('ios')
          setShow(true)
        }
        return
      }
      if (!pushSupported()) return

      const sub = await localSubscription()
      if (sub) {
        // เครื่องนี้สมัครไว้ในชื่อเราแล้ว ไม่ต้องถามอะไรทั้งนั้น
        const mine = await isMyPushEndpoint(profile.id, sub.endpoint).catch(() => true)
        if (mine) return
        // มี subscription อยู่แต่เป็นชื่อคนที่เคยล็อกอินเครื่องนี้ก่อนเรา
        // ยึดมาเป็นของคนที่ล็อกอินอยู่ตอนนี้เงียบ ๆ เพราะเขาคือคนที่ควรได้รับ
        try {
          await enablePush()
          return
        } catch {
          // ยึดไม่สำเร็จก็ไปถามตามปกติข้างล่าง
        }
      }

      // เคยอนุญาตไว้แล้วแต่ของหลุด · ซ่อมเงียบ ๆ ไม่ต้องกวนใคร
      if (Notification.permission === 'granted') {
        try {
          await enablePush()
          return
        } catch {
          // ซ่อมไม่สำเร็จก็ไปถามตามปกติข้างล่าง
        }
      }

      const n = await countMyPushDevices(profile.id).catch(() => 1)
      if (dead || n > 0) return
      setMode(Notification.permission === 'denied' ? 'denied' : 'ask')
      setShow(true)
    })()

    return () => {
      dead = true
    }
  }, [loading, session, profile])

  function snooze() {
    try {
      sessionStorage.setItem(SNOOZE, '1')
    } catch {
      // ปิด storage ไว้ก็ได้แค่ปิดกล่องรอบนี้ · เปลี่ยนหน้าแล้วเจออีกก็ยังดีกว่าพัง
    }
    setShow(false)
  }

  async function turnOn() {
    setBusy(true)
    setErr(null)
    try {
      await enablePush()
      setDone(true)
      setTimeout(() => setShow(false), 1600)
    } catch (e) {
      setErr(readableError(e))
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        setMode('denied')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!show) return null

  return (
    <Modal open onClose={snooze} title="เปิดแจ้งเตือนก่อนเริ่มงาน">
      {done ? (
        <p className="rounded-card bg-success-bg px-3 py-3 text-center text-sm font-bold text-success-txt">
          เปิดแล้ว · ต่อไปนี้มีอะไรจะเด้งบอกถึงมือถือเลย
        </p>
      ) : (
        <>
          <p className="text-sm text-ink-700">
            บัญชีนี้ยังไม่มีเครื่องไหนเปิดแจ้งเตือนไว้เลย แปลว่าตอนนี้
            <b> นัดประชุมและประกาศจากหัวหน้าจะไม่เด้งถึงคุณ</b> ต้องเปิดแอพมาดูเองเท่านั้น
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-500">
            <li>นัดประชุม · ประกาศด่วนจากหัวหน้า</li>
            <li>ของที่ยืมไปแล้วใกล้ถึงเวลาคืน</li>
            <li>เตือนก่อนเลิกกะ ถ้ายังมีของค้างอยู่ในมือ</li>
          </ul>

          {mode === 'ios' && (
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
              </ol>
            </div>
          )}

          {mode === 'denied' && (
            <div className="mt-3 rounded-card bg-danger-bg px-3 py-2 text-sm text-danger-txt">
              <b>เครื่องนี้เคยกดปฏิเสธไว้</b> เบราว์เซอร์จึงไม่ยอมให้ถามซ้ำ
              ต้องไปเปิดเองที่ตั้งค่าของเบราว์เซอร์
              <p className="mt-1">
                Chrome บน Android: แตะรูปแม่กุญแจข้างช่องที่อยู่เว็บ → การตั้งค่าเว็บไซต์ →
                การแจ้งเตือน → อนุญาต แล้วเปิดแอพใหม่
              </p>
            </div>
          )}

          {err && (
            <p className="mt-3 rounded-card bg-danger-bg px-3 py-2 text-sm text-danger-txt">{err}</p>
          )}

          <div className="mt-4 flex flex-col gap-2">
            {mode === 'ask' && (
              <button
                type="button"
                className="btn-primary w-full py-4"
                disabled={busy}
                onClick={() => void turnOn()}
              >
                {busy ? <Spinner /> : null} เปิดแจ้งเตือนเลย
              </button>
            )}
            <button type="button" className="btn-soft w-full" onClick={snooze}>
              ไว้ก่อน
            </button>
          </div>

          <p className="mt-2 text-center text-xs text-ink-400">
            กด “ไว้ก่อน” แล้วจะไม่ถามอีกจนกว่าจะเปิดแอพใหม่ · เปิดทีหลังได้ที่หน้าบัญชีของฉัน
          </p>
        </>
      )}
    </Modal>
  )
}
