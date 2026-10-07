import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { Spinner } from './ui'

/**
 * แถบแจ้งว่ามีเวอร์ชันใหม่ — กดอัปเดตเองเมื่อพร้อม
 *
 * ของเดิมตั้งไว้เป็น autoUpdate ซึ่งแปลว่า พอมีโค้ดชุดใหม่ขึ้นเซิร์ฟเวอร์
 * เบราว์เซอร์จะสลับตัวคุมแล้ว "รีโหลดหน้าเองทันที" โดยไม่ถามใคร
 *
 * อาการที่ผู้ใช้เจอคือ กดเข้าหน้าเบิก แล้วจอวาบขาว เด้งกลับมาหน้าเดิม
 * เพราะจังหวะที่กดคือจังหวะที่เบราว์เซอร์ไปเช็คเวอร์ชันพอดี
 * เจอของใหม่ปุ๊บก็รีโหลดทับการกดนั้นทิ้ง — วัดได้จริงว่าเป็นแบบนี้
 *
 * อันตรายกว่าที่เห็น: ถ้าเกิดตอนกรอกฟอร์มหรือถ่ายรูปค้างไว้ ของที่ทำมาหายหมด
 *
 * จึงเปลี่ยนเป็นถามก่อน · ของใหม่จะรอจนกว่าจะกดปุ่ม หรือจนกว่าจะปิดแอปเปิดใหม่เอง
 *
 * แต่การถามก่อนมีรูรั่วที่เพิ่งเจอ
 * เบราว์เซอร์เช็คเวอร์ชันใหม่ตอนเปิดหน้าเท่านั้น
 * ในมือถือไม่มีปัญหาเพราะคนปัดปิดแอปทุกวัน
 * แต่บนคอม พนักงานเปิดแท็บค้างไว้ข้ามวันข้ามสัปดาห์ ไม่เคยเปิดใหม่เลย
 * จึงสั่งให้เช็คเองทุกชั่วโมง และเช็คทุกครั้งที่กลับมาที่แท็บ
 *
 * ── รูรั่วรอบที่สอง · ที่แก้ในรอบนี้ ──
 *
 * เจ้าของระบบแจ้งว่า "กดอัปเดตแล้วไม่ยอมอัป แต่สักแป๊บก็กดได้เอง"
 * ต้นเหตุคือฟังก์ชันอัปเดตสำเร็จรูปจะทำงานก็ต่อเมื่อตัวใหม่ "ติดตั้งเสร็จและรออยู่" แล้ว
 * ถ้ากดตอนที่มันยังโหลดไฟล์ 78 ไฟล์ไม่เสร็จ ฟังก์ชันจะ "เงียบแล้วจบ" ไม่ทำอะไรเลย
 * ไม่มี error ไม่มีอะไรขยับ ปุ่มเลยเหมือนเสีย · พอโหลดเสร็จค่อยกดติด
 * ซึ่งตรงกับคำว่า "สักแป๊บก็กดได้เอง" เป๊ะ
 *
 * รอบนี้จึงไม่พึ่งฟังก์ชันนั้น แต่คุมลำดับเอง
 *   ① ไม่มีตัวใหม่รออยู่ ก็สั่งเช็คแล้วรอให้มันติดตั้งเสร็จ ไม่เกิน 20 วินาที
 *   ② บอกตัวใหม่ให้ขึ้นมาคุมทันที แล้วรอจนสลับจริง ไม่เกิน 6 วินาที
 *   ③ สลับไม่สำเร็จ ก็ถอนตัวเก่าทิ้งไปเลย รอบหน้าโหลดสดจากเซิร์ฟเวอร์แน่นอน
 *   ④ ไม่ว่าทางไหน จบด้วยการรีโหลดเสมอ
 *
 * ข้อ ④ สำคัญที่สุด · ปุ่มที่กดแล้วไม่มีอะไรขยับเลย แย่กว่าปุ่มที่กดแล้วช้า
 * เพราะคนจะกดซ้ำ แล้วเดาเอาเองว่าแอปพัง
 */
export function UpdatePrompt() {
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let timer: number | undefined
    let stop: (() => void) | undefined

    registerSW({
      onNeedRefresh() {
        setReady(true)
      },
      onRegisteredSW(_url, reg) {
        if (!reg) return

        const look = () => {
          if (document.visibilityState === 'visible') void reg.update()
        }

        timer = window.setInterval(look, 60 * 60 * 1000)
        document.addEventListener('visibilitychange', look)
        stop = () => document.removeEventListener('visibilitychange', look)

        look()
      },
    })

    return () => {
      if (timer) window.clearInterval(timer)
      stop?.()
    }
  }, [])

  if (!ready) return null

  return (
    <div className="safe-b fixed inset-x-0 bottom-0 z-50 px-3 pb-3">
      <div className="mx-auto flex max-w-phone items-center gap-3 rounded-card border border-line bg-dark p-3 text-white shadow-lg">
        <span className="min-w-0 flex-1 text-sm">
          <b className="font-display">มีเวอร์ชันใหม่</b>
          <span className="block text-dark-muted">
            {busy ? 'กำลังอัปเดต · อย่าเพิ่งปิดหน้านี้' : 'กดอัปเดตตอนที่ว่าง · งานที่ทำค้างอยู่จะไม่หาย'}
          </span>
        </span>
        <button
          type="button"
          className="h-tap shrink-0 rounded-btn bg-brand-500 px-3 text-sm font-semibold text-ink disabled:opacity-60"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void applyUpdate()
          }}
        >
          {busy ? <Spinner /> : 'อัปเดต'}
        </button>
        <button
          type="button"
          className="h-tap shrink-0 px-2 text-sm text-dark-muted disabled:opacity-40"
          disabled={busy}
          onClick={() => setReady(false)}
          title="ไว้ก่อน"
        >
          ไว้ก่อน
        </button>
      </div>
    </div>
  )
}

/** รอให้ตัวใหม่ติดตั้งเสร็จจนมาอยู่สถานะ "รอคุม" · คืน null ถ้ารอแล้วไม่มา */
function waitForWaiting(
  reg: ServiceWorkerRegistration,
  ms: number,
): Promise<ServiceWorker | null> {
  if (reg.waiting) return Promise.resolve(reg.waiting)

  return new Promise((resolve) => {
    let done = false
    const finish = (sw: ServiceWorker | null) => {
      if (done) return
      done = true
      window.clearTimeout(t)
      reg.removeEventListener('updatefound', onFound)
      resolve(sw)
    }

    const watch = (sw: ServiceWorker | null) => {
      if (!sw) return
      const onState = () => {
        // installed = ติดตั้งเสร็จแล้ว รอคิวขึ้นคุมอยู่
        if (sw.state === 'installed') finish(reg.waiting ?? sw)
        // redundant = ติดตั้งไม่สำเร็จ รอต่อไปก็ไม่มีประโยชน์
        else if (sw.state === 'redundant') finish(null)
      }
      sw.addEventListener('statechange', onState)
      onState()
    }

    const onFound = () => watch(reg.installing)
    reg.addEventListener('updatefound', onFound)
    watch(reg.installing)

    const t = window.setTimeout(() => finish(null), ms)
  })
}

/** รอจนตัวใหม่ขึ้นมาคุมหน้านี้จริง · คืน false ถ้ารอแล้วไม่สลับ */
function waitForSwap(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      window.clearTimeout(t)
      navigator.serviceWorker.removeEventListener('controllerchange', onSwap)
      resolve(ok)
    }
    const onSwap = () => finish(true)
    navigator.serviceWorker.addEventListener('controllerchange', onSwap)
    const t = window.setTimeout(() => finish(false), ms)
  })
}

async function applyUpdate(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration()
      if (reg) {
        let next = reg.waiting
        if (!next) {
          try {
            await reg.update()
          } catch {
            /* เช็คไม่ได้ก็ไม่เป็นไร ข้างล่างยังรีโหลดอยู่ดี */
          }
          next = await waitForWaiting(reg, 20_000)
        }

        if (next) {
          const swapped = waitForSwap(6_000)
          next.postMessage({ type: 'SKIP_WAITING' })
          if (!(await swapped)) {
            // บอกให้สลับแล้วไม่ยอมสลับ · ถอนทิ้งไปเลย รอบหน้าโหลดสดแน่นอน
            await reg.unregister().catch(() => undefined)
          }
        } else {
          // ไม่มีตัวใหม่มารอสักที · ถอนทิ้งแล้วเริ่มใหม่ดีกว่าค้างอยู่อย่างนี้
          await reg.unregister().catch(() => undefined)
        }
      }
    }
  } catch {
    /* อะไรพลาดก็ช่าง บรรทัดล่างคือทางออกเสมอ */
  }

  window.location.reload()
}
