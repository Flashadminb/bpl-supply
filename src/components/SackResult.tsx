import { useEffect, useRef, useState } from 'react'
import { buildSackCards, sackCardFilename, sackFormText } from '../lib/sackCard'
import { Spinner } from './ui'
import type { SackRow } from '../lib/types'

/**
 * ผลลัพธ์ที่เอาไปส่งต่อ — ข้อความก็อปได้ และการ์ดรูปใบเดียวจบ
 *
 * การ์ดวาดในเครื่องผู้ใช้ ไม่ได้ให้เซิร์ฟเวอร์เรนเดอร์
 *   ① ไม่กินโควต้า Supabase เลยสักหน่วย
 *   ② ได้รูปทันทีตอนกดส่ง ไม่ต้องรอรอบเซิร์ฟเวอร์
 *   ③ รูปหลักฐานยังอยู่ในเครื่องอยู่แล้วตอนเพิ่งถ่าย ไม่ต้องโหลดกลับมา
 *
 * photoUrls ต้องเป็น object URL ในเครื่อง ไม่ใช่ลิงก์ Drive
 * ลิงก์ข้ามโดเมนจะทำให้ canvas เปื้อนแล้วบันทึกรูปไม่ได้
 */
export function SackResult({
  row,
  photoUrls,
  sentBy,
  loadingPhotos,
}: {
  row: SackRow
  photoUrls: string[]
  sentBy?: string | null
  /** รูปยังโหลดไม่เสร็จ — รอก่อนค่อยวาด ไม่งั้นได้การ์ดที่รูปหาย */
  loadingPhotos?: boolean
}) {
  /**
   * การ์ดเป็นชุด ไม่ใช่ใบเดียวอีกต่อไป
   *
   * รูปละใบทำให้ทุกใบขนาดเท่ากันและเต็มจอมือถือพอดี ไม่ว่ารายการนั้นจะมีกี่รูป
   * ใบที่ไม่มีรูปยังได้ใบเดียวเหมือนเดิม
   */
  const [cards, setCards] = useState<{ blob: Blob; url: string }[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const urlsRef = useRef<string[]>([])

  const text = sackFormText(row, sentBy)

  useEffect(() => {
    if (loadingPhotos) return
    let alive = true
    setErr(null)
    buildSackCards(row, photoUrls.map((url) => ({ url })), sentBy)
      .then((blobs) => {
        const made = blobs.map((b) => ({ blob: b, url: URL.createObjectURL(b) }))
        if (!alive) {
          made.forEach((c) => URL.revokeObjectURL(c.url))
          return
        }
        urlsRef.current.forEach((u) => URL.revokeObjectURL(u))
        urlsRef.current = made.map((c) => c.url)
        setCards(made)
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : 'สร้างการ์ดไม่สำเร็จ'))
    return () => {
      alive = false
    }
    // photoUrls เป็น array ใหม่ทุกรอบเรนเดอร์ จึงผูกกับสตริงที่ต่อกันแทน
    // ไม่งั้น effect จะวนวาดการ์ดใหม่ไม่รู้จบ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, row.status, row.relay_via, photoUrls.join('|'), loadingPhotos])

  useEffect(
    () => () => {
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u))
      urlsRef.current = []
    },
    [],
  )

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // บางเบราว์เซอร์ในมือถือไม่ให้เขียนคลิปบอร์ดถ้าไม่ได้มาจากการกดโดยตรง
      // ทางสำรองคือเลือกข้อความให้เอง แล้วผู้ใช้กดคัดลอกจากเมนูของเครื่อง
      const el = document.getElementById(`sack-text-${row.id}`) as HTMLTextAreaElement | null
      el?.select()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  /** หลายใบก็บันทึกให้ครบทุกใบ ไม่ใช่ให้กดทีละใบเอง */
  function download() {
    cards.forEach((c, i) => {
      const a = document.createElement('a')
      a.href = c.url
      a.download = sackCardFilename(row, c.blob.type, cards.length > 1 ? i : undefined)
      a.click()
    })
  }

  async function share() {
    if (cards.length === 0) return
    const files = cards.map(
      (c, i) =>
        new File([c.blob], sackCardFilename(row, c.blob.type, cards.length > 1 ? i : undefined), {
          type: c.blob.type,
        }),
    )
    // navigator.share ส่งไฟล์ได้เฉพาะบางเครื่อง เช็คก่อนเสมอ ไม่งั้นจะขึ้น error เปล่า ๆ
    if (navigator.canShare?.({ files })) {
      try {
        await navigator.share({ files, text })
        return
      } catch {
        /* ผู้ใช้กดยกเลิก — ไม่ใช่ความผิดพลาด */
        return
      }
    }
    download()
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex items-end justify-between gap-2">
          <p className="label mb-0">ข้อความที่ก็อปได้</p>
          <button type="button" className="btn-ghost h-9 px-3 text-sm" onClick={copy}>
            {copied ? 'คัดลอกแล้ว ✓' : 'คัดลอก'}
          </button>
        </div>
        <textarea
          id={`sack-text-${row.id}`}
          className="input min-h-[190px] w-full resize-y font-mono text-sm leading-relaxed"
          readOnly
          value={text}
        />
      </div>

      <div>
        <div className="mb-1 flex items-end justify-between gap-2">
          <p className="label mb-0">
            การ์ดรูป{cards.length > 1 ? ` · ${cards.length} ใบ` : ''}
          </p>
          <span className="flex gap-2">
            <button
              type="button"
              className="btn-ghost h-9 px-3 text-sm"
              onClick={download}
              disabled={cards.length === 0}
            >
              {cards.length > 1 ? `บันทึก ${cards.length} รูป` : 'บันทึกรูป'}
            </button>
            <button
              type="button"
              className="btn-primary h-9 px-3 text-sm"
              onClick={share}
              disabled={cards.length === 0}
            >
              ส่งต่อ
            </button>
          </span>
        </div>

        {err ? (
          <p className="rounded-card border border-danger/25 bg-danger-bg p-3 text-sm text-danger-txt">
            {err}
          </p>
        ) : cards.length > 0 ? (
          <div className="space-y-2">
            {cards.map((c, i) => (
              <img
                key={c.url}
                src={c.url}
                alt={`การ์ดกระสอบ ${row.ref_no} ใบที่ ${i + 1}`}
                className="w-full rounded-card border border-line"
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-[180px] items-center justify-center rounded-card border border-line bg-surface-2">
            <Spinner />
          </div>
        )}
      </div>
    </div>
  )
}
