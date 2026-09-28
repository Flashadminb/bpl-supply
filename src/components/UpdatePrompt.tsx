import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

/**
 * แถบแจ้งว่ามีเวอร์ชันใหม่ — กดอัปเดตเองเมื่อพร้อม
 *
 * ของเดิมตั้งไว้เป็น autoUpdate ซึ่งแปลว่า พอมีโค้ดชุดใหม่ขึ้นเซิร์ฟเวอร์
 * เบราว์เซอร์จะสลับตัวคุมแล้ว "รีโหลดหน้าเองทันที" โดยไม่ถามใคร
 *
 * อาการที่ผู้ใช้เจอคือ กดเข้าหน้าเบิก แล้วจอวาบขาว เด้งกลับมาหน้าเดิม
 * เพราะจังหวะที่กดคือจังหวะที่เบราว์เซอร์ไปเช็คเวอร์ชันพอดี
 * เจอของใหม่ปุ๊บก็รีโหลดทับการกดนั้นทิ้ง — วัดได้จริงว่าเป็นแบบนี้
 * (เหตุการณ์ controllerchange เด้งตอนกด แล้ว URL ไม่ขยับไปไหน)
 *
 * อันตรายกว่าที่เห็น: ถ้าเกิดตอนกรอกฟอร์มหรือถ่ายรูปค้างไว้ ของที่ทำมาหายหมด
 *
 * จึงเปลี่ยนเป็นถามก่อน · ของใหม่จะรอจนกว่าจะกดปุ่ม หรือจนกว่าจะปิดแอปเปิดใหม่เอง
 *
 * แต่การถามก่อนมีรูรั่วที่เพิ่งเจอ
 * เบราว์เซอร์เช็คเวอร์ชันใหม่ตอนเปิดหน้าเท่านั้น
 * ในมือถือไม่มีปัญหาเพราะคนปัดปิดแอปทุกวัน
 * แต่บนคอม พนักงานเปิดแท็บค้างไว้ข้ามวันข้ามสัปดาห์ ไม่เคยเปิดใหม่เลย
 * แถบ "มีเวอร์ชันใหม่" จึงไม่เคยโผล่ ของใหม่ไม่เคยถึงมือเขา
 * อาการที่เห็นคือฟีเจอร์ใหม่ขึ้นในมือถือแต่ไม่ขึ้นในคอม
 *
 * จึงสั่งให้เช็คเองเป็นระยะ และเช็คทุกครั้งที่กลับมาที่แท็บ
 * ยังเป็นการ "ถาม" เหมือนเดิม ไม่ได้รีโหลดทับการกดของใคร
 */
export function UpdatePrompt() {
  const [ready, setReady] = useState(false)
  const [update, setUpdate] = useState<((reload?: boolean) => Promise<void>) | null>(null)

  useEffect(() => {
    let timer: number | undefined
    let stop: (() => void) | undefined

    const updateSW = registerSW({
      onNeedRefresh() {
        setUpdate(() => updateSW)
        setReady(true)
      },
      onRegisteredSW(_url, reg) {
        if (!reg) return

        // ถามเซิร์ฟเวอร์ว่ามีของใหม่ไหม — ถ้ามี onNeedRefresh จะทำงานเอง
        const look = () => {
          if (document.visibilityState === 'visible') void reg.update()
        }

        // ทุกชั่วโมง เผื่อแท็บเปิดค้างไว้ทั้งวันโดยไม่มีใครแตะ
        timer = window.setInterval(look, 60 * 60 * 1000)

        // และทุกครั้งที่กลับมาที่แท็บ ซึ่งเป็นจังหวะที่คนกำลังจะใช้งานพอดี
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
            กดอัปเดตตอนที่ว่าง · งานที่ทำค้างอยู่จะไม่หาย
          </span>
        </span>
        <button
          type="button"
          className="h-tap shrink-0 rounded-btn bg-brand-500 px-3 text-sm font-semibold text-ink"
          onClick={() => void update?.(true)}
        >
          อัปเดต
        </button>
        <button
          type="button"
          className="h-tap shrink-0 px-2 text-sm text-dark-muted"
          onClick={() => setReady(false)}
          title="ไว้ก่อน"
        >
          ไว้ก่อน
        </button>
      </div>
    </div>
  )
}
