import { useMemo, useState } from 'react'
import type { Profile } from '../lib/types'

/**
 * เลือกคนจากรายชื่อพนักงาน — พิมพ์ค้นหาได้
 *
 * ของเดิมเป็นกำแพงชิปทุกคนในฮับเรียงกันยาวเหยียด
 * ฮับนี้มีคนเป็นร้อย กดหาคนเดียวเจอยากกว่าไม่มีให้เลือกเสียอีก
 *
 * ตัวนี้แยกเป็นสองส่วน บนคือคนที่เลือกไว้แล้ว ล่างคือช่องค้นหา
 * ส่วนบนสำคัญกว่า เพราะคำถามที่ถามบ่อยที่สุดคือ "ตอนนี้ใครได้บ้าง"
 * ไม่ใช่ "จะเพิ่มใคร"
 */
export function PeoplePicker({
  people,
  selected,
  onToggle,
  disabled,
  emptyText = 'ยังไม่ได้เลือกใครเลย',
  placeholder = 'พิมพ์ชื่อหรือรหัสพนักงานเพื่อค้นหา',
}: {
  people: Profile[]
  selected: string[]
  onToggle: (userId: string, next: boolean) => void
  disabled?: boolean
  emptyText?: string
  placeholder?: string
}) {
  const [q, setQ] = useState('')

  const chosen = useMemo(
    () => people.filter((p) => selected.includes(p.id)),
    [people, selected],
  )

  // ค้นหาแล้วค่อยโชว์ ไม่เทรายชื่อทั้งฮับออกมาตั้งแต่แรก
  // พิมพ์สองตัวอักษรขึ้นไปถึงเริ่มกรอง ตัวเดียวได้ครึ่งฮับซึ่งไม่ช่วยอะไร
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (s.length < 2) return []
    return people
      .filter((p) => !selected.includes(p.id))
      .filter(
        (p) =>
          p.full_name.toLowerCase().includes(s) ||
          p.employee_code.toLowerCase().includes(s) ||
          (p.dept_code ?? '').toLowerCase().includes(s),
      )
      .slice(0, 12)
  }, [people, selected, q])

  return (
    <div>
      {chosen.length === 0 ? (
        <p className="mb-2 text-sm text-ink-400">{emptyText}</p>
      ) : (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {chosen.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              title="กดเพื่อเอาออก"
              className="flex items-center gap-1.5 rounded-btn border border-ink bg-ink px-2.5 py-1 text-xs text-white"
              onClick={() => onToggle(p.id, false)}
            >
              {p.full_name}
              <span className="opacity-60">{p.employee_code}</span>
              <span aria-hidden className="text-sm leading-none">
                ×
              </span>
            </button>
          ))}
        </div>
      )}

      <input
        className="input"
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {q.trim().length >= 2 && (
        <div className="mt-1.5 max-h-56 overflow-y-auto rounded-card border border-line">
          {hits.length === 0 ? (
            <p className="px-3 py-2 text-sm text-ink-400">ไม่พบใครที่ยังไม่ได้เลือก</p>
          ) : (
            hits.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={disabled}
                className="flex w-full items-center gap-2 border-b border-line-2 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-ink/5"
                onClick={() => {
                  onToggle(p.id, true)
                  setQ('')
                }}
              >
                <span className="min-w-0 flex-1">{p.full_name}</span>
                <span className="font-mono text-xs text-ink-400">{p.employee_code}</span>
                <span className="text-xs text-ink-400">{p.dept_code ?? '—'}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
