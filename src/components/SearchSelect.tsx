import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * ดรอปดาวน์ที่พิมพ์ค้นได้ — ใช้กับรายการยาว ๆ อย่างรายชื่อพนักงาน 49 คน
 * <select> ธรรมดาเลื่อนหาไม่ไหว และ datalist ควบคุมค่าที่เลือกจริงไม่ได้
 */

export interface Option {
  value: string
  label: string
  /** บรรทัดเล็กใต้ชื่อ เช่น รหัสพนักงานหรือแผนก */
  hint?: string
}

export function SearchSelect({
  label,
  value,
  options,
  onChange,
  allLabel = 'ทั้งหมด',
  placeholder = 'พิมพ์เพื่อค้นหา',
  width = 'w-[230px]',
}: {
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  allLabel?: string
  placeholder?: string
  width?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return options.slice(0, 60)
    return options
      .filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(s))
      .slice(0, 60)
  }, [options, q])

  const current = options.find((o) => o.value === value)

  return (
    <div className={`relative ${width}`} ref={boxRef}>
      <label className="label mb-1">{label}</label>
      <button
        type="button"
        className="input flex h-tap w-full items-center justify-between gap-2 text-left"
        onClick={() => {
          setQ('')
          setOpen((v) => !v)
        }}
      >
        <span className="truncate">{current ? current.label : allLabel}</span>
        <span aria-hidden className="shrink-0 text-ink-400">
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-panel border border-line bg-surface p-2 shadow-pop">
          <input
            autoFocus
            className="input mb-1 h-tap w-full"
            placeholder={placeholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ul className="max-h-[260px] overflow-y-auto">
            <li>
              <button
                type="button"
                className={`w-full rounded-btn px-2 py-2 text-left text-sm ${
                  value === '' ? 'bg-brand-50 font-display' : 'hover:bg-surface-2'
                }`}
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
              >
                {allLabel}
              </button>
            </li>
            {shown.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  className={`w-full rounded-btn px-2 py-2 text-left text-sm ${
                    value === o.value ? 'bg-brand-50 font-display' : 'hover:bg-surface-2'
                  }`}
                  onClick={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                >
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-xs text-ink-400">{o.hint}</span>}
                </button>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="px-2 py-3 text-center text-sm text-ink-400">ไม่พบชื่อที่ค้น</li>
            )}
          </ul>
          {options.length > shown.length && !q && (
            <p className="mt-1 px-2 text-xs text-ink-400">
              แสดง {shown.length} จาก {options.length} — พิมพ์เพื่อค้นหาที่เหลือ
            </p>
          )}
        </div>
      )}
    </div>
  )
}
