import { useAuth } from '../lib/auth'
import { useAsync } from '../lib/useAsync'
import { listProxyHoldings } from '../lib/api'
import { fmtDateTime, relativeAge } from '../lib/format'
import { canProxy } from '../lib/roles'

/**
 * เครื่องที่เรากดเบิกให้คนอื่น
 *
 * ดูอย่างเดียว ไม่มีปุ่มคืน เพราะของไม่ได้อยู่กับเรา
 * การคืนต้องถ่ายรูปสภาพจริงตอนนั้น คนที่ไม่ได้ถือของถ่ายไม่ได้
 *
 * มีไว้ให้คนจ่ายของตามงานตัวเองได้ว่าจ่ายอะไรออกไปแล้วยังไม่กลับมาบ้าง
 * ไม่ต้องไปขอให้แอดมินเปิดหน้าให้ดู
 */
export function ProxyHoldings() {
  const { profile } = useAuth()
  const mine = useAsync(
    () => (profile?.id ? listProxyHoldings(profile.id) : Promise.resolve([])),
    [profile?.id],
  )

  if (!canProxy(profile)) return null

  const rows = mine.data ?? []
  if (rows.length === 0) return null

  return (
    <section className="mb-4">
      <h2 className="mb-1 font-display text-md">ที่คุณเบิกให้คนอื่น</h2>
      <p className="mb-2 text-sm text-ink-500">
        {rows.length} เครื่องที่ยังไม่กลับมา · คนที่ถืออยู่เป็นคนกดคืนเอง
      </p>
      <ul className="space-y-2">
        {rows.map((h) => {
          const late = h.due_at && Date.now() > Date.parse(h.due_at)
          return (
            <li
              key={h.out_item_id}
              className={`rounded-card border p-3 ${
                late ? 'border-danger/25 bg-danger-bg' : 'border-line bg-surface'
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-display">
                  {h.asset_code} · {h.type_name}
                </span>
                <span className={`text-xs ${late ? 'text-danger-txt' : 'text-ink-400'}`}>
                  {late ? 'เลยเวลาคืนแล้ว' : relativeAge(h.taken_at)}
                </span>
              </div>
              <p className="truncate text-sm">
                {h.holder_name}
                <span className="text-ink-400">
                  {' '}
                  · {h.holder_code}
                  {h.holder_dept ? ` · ${h.holder_dept}` : ''}
                </span>
              </p>
              <p className={`text-xs ${late ? 'text-danger-txt' : 'text-ink-400'}`}>
                เบิก {fmtDateTime(h.taken_at)}
                {h.due_at ? ` · กำหนดคืน ${fmtDateTime(h.due_at)}` : ''}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
