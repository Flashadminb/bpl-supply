import { pushSubscribe } from './api'

/**
 * เครื่องมือเปิดแจ้งเตือนบนเครื่องนี้ · ใช้ร่วมกันระหว่างหน้าบัญชีกับกล่องที่เด้งขอ
 *
 * เขียนไว้ที่เดียวเพราะขั้นตอนมันละเอียดและพลาดง่าย
 * ขออนุญาต · สมัครกับเบราว์เซอร์ · ส่ง endpoint ขึ้นเซิร์ฟเวอร์ ต้องครบทั้งสาม
 * ถ้าแยกเขียนสองที่ วันหนึ่งจะมีที่หนึ่งลืมส่งขึ้นเซิร์ฟเวอร์
 * แล้วเครื่องนั้นจะขึ้นว่าเปิดแล้วทั้งที่ไม่มีใครส่งหาได้
 */

// กุญแจสาธารณะ ไม่ใช่ความลับ อยู่ใน bundle อยู่แล้ว
const VAPID_FALLBACK =
  'BOtpVFURNNqB-UbLcZaSquNCw0atxGz1kSliIWJYCXhk0LO45Ch5nI0jZ3PFOffce_zPsCg97JL5hg7fgXmiTm4'
export const VAPID_PUBLIC =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) || VAPID_FALLBACK

function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out.buffer
}

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true

/** เบราว์เซอร์นี้ทำได้ไหม · iPhone ที่ยังไม่ติดตั้งลงโฮมจะตอบ false ตรงนี้เลย */
export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** iPhone ที่เปิดผ่าน Safari เฉย ๆ · ต้องติดตั้งลงหน้าจอโฮมก่อนถึงจะขออนุญาตได้ */
export const iosNeedsInstall = () => isIOS() && !isStandalone()

/** เครื่องนี้สมัครไว้แล้วหรือยัง · null = ยัง */
export async function localSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  try {
    const reg = await navigator.serviceWorker.ready
    return await reg.pushManager.getSubscription()
  } catch {
    return null
  }
}

/**
 * เปิดแจ้งเตือนบนเครื่องนี้
 *
 * requestPermission ต้องถูกเรียกจากการกดของคนเท่านั้นในหลายเบราว์เซอร์
 * ยกเว้นกรณีที่เคยอนุญาตไว้แล้ว ซึ่งมันจะคืนค่า granted ทันทีโดยไม่เด้งอะไร
 * จึงเรียกเองเงียบ ๆ ได้ตอนจะซ่อมเครื่องที่ subscription หลุดไป
 */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน')
  if (!VAPID_PUBLIC) throw new Error('ยังไม่ได้ตั้งค่ากุญแจแจ้งเตือนของระบบ แจ้งผู้ดูแล')

  const perm = await Notification.requestPermission()
  if (perm !== 'granted') {
    throw new Error('ยังไม่ได้กดอนุญาต — ถ้าเผลอกดปฏิเสธไปแล้ว ต้องไปเปิดในตั้งค่าเบราว์เซอร์')
  }

  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
    }))

  const raw = sub.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } }
  if (!raw.endpoint || !raw.keys) throw new Error('เบราว์เซอร์ให้ข้อมูลไม่ครบ ลองใหม่อีกครั้ง')

  // ส่งขึ้นเซิร์ฟเวอร์เสมอ แม้เครื่องจะเคยสมัครไว้แล้ว
  // เพราะแถวฝั่งเซิร์ฟเวอร์อาจถูกลบทิ้งไปตอนส่งไม่ผ่าน ทั้งที่เบราว์เซอร์ยังจำได้อยู่
  await pushSubscribe({ endpoint: raw.endpoint, keys: raw.keys })
}
