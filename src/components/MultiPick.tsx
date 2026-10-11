import { useMemo, useState } from 'react'

export interface PickOption {
  id: string
  /** บรรทัดบน — ชื่อที่คนอ่านแล้วรู้ว่าอันไหน */
  line: string
  /** บรรทัดล่าง — รหัส แผนก หรืออะไรก็ได้ที่ช่วยแยกคนชื่อซ้ำ */
  sub?: string
  /** ข้อความที่เอาไว้ค้น — รวมทุกอย่างที่คนน่าจะพิมพ์หา */
  hay: string
}

/**
 * เลือกหลายอันจากรายการยาว ๆ
 *
 * รายการจริงในระบบมีคนเก้าสิบกว่าและเครื่องหลักร้อย
 * ถ้ากางให้หมดตั้งแต่แรก คนจะเลื่อนหาจนเลิกใช้ จึงขึ้นเฉพาะตอนพิมพ์ค้น
 * ส่วนอันที่เลือกไว้แล้วค้างเป็นชิปด้านบนเสมอ จะได้ไม่ลืมว่าตัวเองเลือกอะไรไว้
 *
 * ปุ่ม "เลือกทั้งหมดที่ค้นเจอ" คือจุดที่ทำให้เลือกยี่สิบเครื่องเร็วกว่าเลือกทีละอัน
 * แต่ขึ้นเฉพาะตอนพิมพ์ค้นแล้ว ไม่งั้นมันคือปุ่มเลือกทั้งคลังในคลิกเดียว
 */
export function MultiPick({
  label,
  hint,
  options,
  picked,
  onChange,
  placeholder,
  max = 12,
}: {
  label: string
  hint?: string
  options: PickOption[]
  picked: string[]
  onChange: (next: string[]) => void
  placeholder: string
  /** จำนวนบรรทัดที่โชว์ตอนค้น · ไม่ใช่เพดานของที่เลือกได้ */
  max?: number
}) {
  const [q, setQ] = useState('')

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options])
  const on = useMemo(() => new Set(picked), [picked])

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return options.filter((o) => o.hay.toLowerCase().includes(s))
  }, [options, q])

  const shown = hits.slice(0, max)
  const allShownOn = hits.length > 0 && hits.every((o) => on.has(o.id))

  function toggle(id: string) {
    onChange(on.has(id) ? picked.filter((x) => x !== id) : [...picked, id])
  }

  return (
    <div className="min-w-0">
      <p className="label mb-1">
        {label}
        {picked.length > 0 && <span className="ml-2 text-ink-400">เลือกไว้ {picked.length}</span>}
      </p>
      {hint && <p className="mb-1 text-xs text-ink-500">{hint}</p>}

      {picked.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {picked.map((id) => {
            const o = byId.get(id)
            return (
              <button
                key={id}
                type="button"
                className="chip chip-on text-xs"
                onClick={() => toggle(id)}
                title="กดเพื่อเอาออก"
              >
                {o?.line ?? id} ×
              </button>
            )
          })}
          <button
            type="button"
            className="chip text-xs"
            onClick={() => onChange([])}
          >
            ล้างทั้งหมด
          </button>
        </div>
      )}

      <input
        className="input h-tap w-full"
        type="search"
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {q.trim() !== '' && (
        <>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-400">พบ {hits.length}</span>
            {hits.length > 0 && (
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-xs"
                onClick={() =>
                  onChange(
                    allShownOn
                      ? picked.filter((id) => !hits.some((o) => o.id === id))
                      : [...new Set([...picked, ...hits.map((o) => o.id)])],
                  )
                }
              >
                {allShownOn ? 'เอาที่ค้นเจอออก' : `เลือกทั้งหมดที่ค้นเจอ ${hits.length}`}
              </button>
            )}
          </div>

          <ul className="mt-1 max-h-[260px] overflow-y-auto rounded-card border border-line">
            {shown.length === 0 && (
              <li className="px-3 py-2 text-sm text-ink-400">ไม่พบตามคำค้น</li>
            )}
            {shown.map((o) => (
              <li key={o.id} className="border-b border-line-2 last:border-0">
                <button
                  type="button"
                  className={`flex min-h-tap w-full items-center gap-2 px-3 py-2 text-left ${
                    on.has(o.id) ? 'bg-surface-2' : ''
                  }`}
                  onClick={() => toggle(o.id)}
                >
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                      on.has(o.id) ? 'border-ink bg-ink text-white' : 'border-line'
                    }`}
                  >
                    {on.has(o.id) ? '✓' : ''}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{o.line}</span>
                    {o.sub && (
                      <span className="block truncate font-mono text-xs text-ink-400">{o.sub}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
            {hits.length > shown.length && (
              <li className="px-3 py-2 text-xs text-ink-400">
                ยังมีอีก {hits.length - shown.length} · พิมพ์ให้แคบลง หรือกดเลือกทั้งหมดที่ค้นเจอ
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  )
}
