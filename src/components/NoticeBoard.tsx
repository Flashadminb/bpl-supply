import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { listAnnouncements } from '../lib/api'
import type { Announcement } from '../lib/types'

/**
 * ป้ายประกาศบนหน้าแรกของแอพ
 *
 * ตั้งใจให้ไม่มีปุ่มปิด — ประกาศหายเองเมื่อหมดอายุเท่านั้น
 * ถ้าปิดได้ คนจะปิดทิ้งตั้งแต่วินาทีแรกโดยไม่อ่าน แล้วเรื่องด่วนก็ไม่ถึงใคร
 *
 * โชว์แค่สามอันแรก ที่เหลือพับไว้
 * ป้ายที่ค้างเป็นสิบอันคือป้ายที่ไม่มีใครอ่าน ซึ่งแย่กว่าไม่มีป้ายเลย
 */

const TONE: Record<Announcement['level'], { box: string; text: string; tag: string | null }> = {
  urgent: { box: 'border-danger bg-danger-bg', text: 'text-danger-txt', tag: 'ด่วน' },
  warn: { box: 'border-warn bg-warn-bg', text: 'text-warn-txt', tag: null },
  info: { box: 'border-line-2 bg-surface-2', text: 'text-ink', tag: null },
}

function Row({ a }: { a: Announcement }) {
  const t = TONE[a.level] ?? TONE.info
  return (
    <li className={`border-l-[3px] px-3 py-2 ${t.box}`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`font-display text-base ${t.text}`}>{a.title}</p>
        {t.tag && (
          <span className={`shrink-0 text-xs ${t.text}`} aria-label="ประกาศด่วน">
            {t.tag}
          </span>
        )}
      </div>
      {a.body && <p className={`mt-[2px] whitespace-pre-line text-sm ${t.text}`}>{a.body}</p>}
    </li>
  )
}

export function NoticeBoard() {
  const feed = useAsync(() => listAnnouncements(), [])
  const [all, setAll] = useState(false)

  const rows = feed.data ?? []
  if (feed.loading || rows.length === 0) return null

  // เรียงด่วนขึ้นก่อนเสมอ ต่อให้ประกาศทีหลัง
  const order = { urgent: 0, warn: 1, info: 2 } as const
  const sorted = [...rows].sort((x, y) => order[x.level] - order[y.level])
  const shown = all ? sorted : sorted.slice(0, 3)
  const hidden = sorted.length - shown.length

  return (
    <section className="mb-3">
      <ul className="space-y-2">
        {shown.map((a) => (
          <Row key={a.id} a={a} />
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          className="mt-2 min-h-tap w-full text-sm underline decoration-line-2"
          onClick={() => setAll(true)}
        >
          ดูประกาศทั้งหมดอีก {hidden} เรื่อง
        </button>
      )}
    </section>
  )
}
