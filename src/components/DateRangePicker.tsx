import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * ปฏิทินเลือกช่วงวันในอันเดียว — กดวันเริ่ม แล้วกดวันจบ
 *
 * เขียนเองเพราะ <input type="date"> ของเบราว์เซอร์เลือกได้ทีละวันเท่านั้น
 * ใช้ค่าเป็นข้อความ YYYY-MM-DD ตลอด ไม่ส่ง Date ไปมา จะได้ไม่เพี้ยนเพราะเขตเวลา
 */

const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]

const pad = (n: number) => String(n).padStart(2, '0')
const key = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const todayKey = () => {
  const d = new Date()
  return key(d.getFullYear(), d.getMonth(), d.getDate())
}

/** 23 ก.ย. 69 — สั้นพอให้อยู่ในปุ่มเดียวได้ */
function short(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${String((y + 543) % 100).padStart(2, '0')}`
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return key(dt.getFullYear(), dt.getMonth(), dt.getDate())
}

const PRESETS: { label: string; calc: () => [string, string] }[] = [
  { label: 'วันนี้', calc: () => [todayKey(), todayKey()] },
  { label: '7 วันล่าสุด', calc: () => [addDays(todayKey(), -6), todayKey()] },
  { label: '30 วันล่าสุด', calc: () => [addDays(todayKey(), -29), todayKey()] },
  {
    label: 'เดือนนี้',
    calc: () => {
      const d = new Date()
      return [key(d.getFullYear(), d.getMonth(), 1), todayKey()]
    },
  },
  {
    label: 'เดือนที่แล้ว',
    calc: () => {
      const d = new Date()
      const first = new Date(d.getFullYear(), d.getMonth() - 1, 1)
      const last = new Date(d.getFullYear(), d.getMonth(), 0)
      return [
        key(first.getFullYear(), first.getMonth(), 1),
        key(last.getFullYear(), last.getMonth(), last.getDate()),
      ]
    },
  },
]

export function DateRangePicker({
  from,
  to,
  onChange,
  label = 'ช่วงวันที่',
}: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => {
    const [y, m] = (from || todayKey()).split('-').map(Number)
    return { y, m: m - 1 }
  })
  // กดครั้งแรกเลือกวันเริ่ม กดครั้งที่สองเลือกวันจบ
  const [pendingStart, setPendingStart] = useState<string | null>(null)
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

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1)
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
    const lead = first.getDay()
    const out: (string | null)[] = Array.from({ length: lead }, () => null)
    for (let d = 1; d <= daysInMonth; d++) out.push(key(view.y, view.m, d))
    return out
  }, [view])

  const lo = pendingStart ?? from
  const hi = pendingStart ? pendingStart : to

  function pick(iso: string) {
    if (!pendingStart) {
      setPendingStart(iso)
      return
    }
    const a = pendingStart
    const b = iso
    const [s, e] = a <= b ? [a, b] : [b, a]
    setPendingStart(null)
    onChange(s, e)
    setOpen(false)
  }

  function step(n: number) {
    setView((v) => {
      const d = new Date(v.y, v.m + n, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }

  return (
    <div className="relative" ref={boxRef}>
      <label className="label mb-1" htmlFor="range-btn">
        {label}
      </label>
      <button
        id="range-btn"
        type="button"
        className="input flex min-w-[210px] items-center justify-between gap-2 text-left"
        onClick={() => {
          const [y, m] = (from || todayKey()).split('-').map(Number)
          setView({ y, m: m - 1 })
          setPendingStart(null)
          setOpen((v) => !v)
        }}
      >
        <span className="truncate">
          {short(from)} <span className="text-ink-400">ถึง</span> {short(to)}
        </span>
        <span aria-hidden className="shrink-0 text-ink-400">
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[min(320px,92vw)] rounded-panel border border-line bg-surface p-3 shadow-pop">
          <div className="mb-2 flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="chip min-h-[32px] px-2 text-xs"
                onClick={() => {
                  const [s, e] = p.calc()
                  setPendingStart(null)
                  onChange(s, e)
                  setOpen(false)
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="เดือนก่อนหน้า"
              className="h-tap w-tap rounded-btn text-lg text-ink-700"
              onClick={() => step(-1)}
            >
              ‹
            </button>
            <span className="font-display text-base">
              {MONTHS[view.m]} {view.y + 543}
            </span>
            <button
              type="button"
              aria-label="เดือนถัดไป"
              className="h-tap w-tap rounded-btn text-lg text-ink-700"
              onClick={() => step(1)}
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-[2px] text-center">
            {DOW.map((d) => (
              <div key={d} className="py-1 text-xs text-ink-400">
                {d}
              </div>
            ))}

            {cells.map((iso, i) => {
              if (!iso) return <div key={`x${i}`} />
              const inRange = !pendingStart && iso >= lo && iso <= hi
              const isEdge = iso === lo || iso === hi
              const isToday = iso === todayKey()
              return (
                <button
                  key={iso}
                  type="button"
                  className={`h-[38px] rounded-btn text-sm ${
                    isEdge
                      ? 'bg-brand-500 font-display text-ink'
                      : inRange
                        ? 'bg-brand-100 text-ink'
                        : 'text-ink-700 hover:bg-surface-2'
                  } ${isToday && !isEdge ? 'ring-1 ring-ink-300' : ''}`}
                  onClick={() => pick(iso)}
                >
                  {Number(iso.slice(8))}
                </button>
              )
            })}
          </div>

          <p className="mt-2 text-center text-xs text-ink-400">
            {pendingStart
              ? `เลือกวันเริ่ม ${short(pendingStart)} แล้ว — กดวันสิ้นสุดอีกครั้ง`
              : 'กดวันเริ่ม แล้วกดวันสิ้นสุด'}
          </p>
        </div>
      )}
    </div>
  )
}
