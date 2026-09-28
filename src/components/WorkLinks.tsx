import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { listWorkLinks } from '../lib/api'
import { ErrorBox, Loading, Sheet } from './ui'

/**
 * ปุ่มสายฟ้าบนหัวแอพ — ทางลัดไปลิงก์งานที่ต้องเปิดบ่อย
 *
 * ทุกคนเห็นปุ่ม แต่เห็นลิงก์ไม่เท่ากัน
 * เจ้าของระบบตั้งเป็นรายลิงก์ได้ว่าให้ทุกคนเห็น ให้เฉพาะผู้จัดการ
 * หรือเลือกเองว่าแผนกไหนและใครบ้าง
 *
 * การกรองอยู่ที่ RLS ของ work_links ไม่ใช่ที่หน้าจอ
 * หน้าจอจึงไม่ต้องรู้กติกาเลย ขอรายการมาแล้วได้อะไรก็แสดงอันนั้น
 * ถ้าย้ายกติกามาไว้ฝั่งนี้ ใครเปิด DevTools ดูก็อ่านลิงก์ที่ไม่ได้สิทธิ์ได้
 *
 * โหลดรายชื่อตอนกดเปิดเท่านั้น ไม่ได้โหลดทิ้งไว้ตั้งแต่เปิดแอพ
 * เพราะคนส่วนใหญ่เปิดแอพมาเบิกของ ไม่ได้มากดลิงก์
 */
/**
 * tone — ปุ่มนี้ไปวางได้ทั้งบนหัวสีเหลืองของแอพและบนแถบดำของหน้าเว็บ
 * ถ้าใช้สีเดียวกันทั้งสองที่ อันใดอันหนึ่งจะกลายเป็นเข้มบนเข้มจนมองไม่เห็น
 */
export function WorkLinks({ tone = 'onLight' }: { tone?: 'onLight' | 'onDark' }) {
  const [open, setOpen] = useState(false)
  const links = useAsync(
    () => (open ? listWorkLinks() : Promise.resolve([])),
    [open],
  )

  const rows = links.data ?? []

  return (
    <>
      <button
        type="button"
        aria-label="ลิงก์งาน"
        title="ลิงก์งาน"
        className={`flex h-tap w-tap items-center justify-center rounded-btn text-lg ${
          tone === 'onDark' ? 'bg-brand-500 text-ink' : 'bg-ink text-brand-500'
        }`}
        onClick={() => setOpen(true)}
      >
        {/* สายฟ้า — วาดเองไม่ใช้ไฟล์ จะได้ไม่ต้องโหลดรูปเพิ่ม */}
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
          <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor" />
        </svg>
      </button>

      <Sheet open={open} title="ลิงก์งาน" onClose={() => setOpen(false)}>
        {links.loading && <Loading />}
        {links.error && <ErrorBox message={links.error} onRetry={links.reload} />}

        {!links.loading && !links.error && rows.length === 0 && (
          <p className="rounded-card bg-surface-2 px-3 py-4 text-center text-sm text-ink-500">
            ยังไม่มีลิงก์สำหรับคุณ
            <br />
            ถ้าคิดว่าควรมี บอกแอดมินให้เปิดสิทธิ์ให้
          </p>
        )}

        <ul className="space-y-2">
          {rows.map((l) => (
            <li key={l.id}>
              <a
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-card border border-line bg-surface p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-base">{l.title}</span>
                  {l.note && <span className="block text-sm text-ink-500">{l.note}</span>}
                </span>
                <span aria-hidden className="shrink-0 text-ink-400">
                  ↗
                </span>
              </a>
            </li>
          ))}
        </ul>

        {rows.length > 0 && (
          <p className="mt-3 text-center text-xs text-ink-400">
            กดแล้วเปิดในแท็บใหม่ · แอพยังค้างอยู่ที่เดิม
          </p>
        )}
      </Sheet>
    </>
  )
}
