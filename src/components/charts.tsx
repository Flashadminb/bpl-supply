import { useId, useState, type ReactNode } from 'react'

/**
 * กราฟทั้งหมดวาดด้วย SVG ตรง ๆ ไม่พึ่งไลบรารีนอก
 * กติกาที่ยึด: แท่งบาง ปลายด้านข้อมูลมนเล็กน้อย เส้นกริดจาง
 * ติดป้ายตัวเลขทุกแท่ง (จำเป็น เพราะสีเขียวคอนทราสต์ต่ำกว่า 3:1 บนพื้นขาว)
 * ซีรีส์เดียวไม่ต้องมีคำอธิบายสี เพราะหัวกราฟบอกอยู่แล้วว่าคืออะไร
 */

export const SERIES = {
  primary: '#2a78d6',
  second: '#eb6834',
  third: '#1baf7a',
} as const

export const STATUS = {
  ok: '#1E7A4B',
  warn: '#B4820A',
  danger: '#B42318',
  mute: '#A8A091',
} as const

const AXIS = '#EDE7D9'
const TEXT_MUTED = '#8E8778'
const TEXT = '#4E4738'

/** สี่เหลี่ยมที่มนเฉพาะปลายด้านข้อมูล อีกด้านชิดเส้นฐานเสมอ */
function barPath(x: number, y: number, w: number, h: number, r: number, dir: 'right' | 'up'): string {
  if (w <= 0 || h <= 0) return ''
  if (dir === 'right') {
    const rr = Math.min(r, w, h / 2)
    return `M${x},${y} H${x + w - rr} A${rr},${rr} 0 0 1 ${x + w},${y + rr} V${y + h - rr} A${rr},${rr} 0 0 1 ${x + w - rr},${y + h} H${x} Z`
  }
  const rr = Math.min(r, h, w / 2)
  return `M${x},${y + h} V${y + rr} A${rr},${rr} 0 0 1 ${x + rr},${y} H${x + w - rr} A${rr},${rr} 0 0 1 ${x + w},${y + rr} V${y + h} Z`
}

export interface Datum {
  label: string
  value: number
  sub?: string
  color?: string
}

/** แท่งแนวนอน — ใช้กับการจัดอันดับ ชื่อยาวอ่านง่ายกว่าแนวตั้ง */
export function BarsH({
  data,
  unit = '',
  max,
  emptyText = 'ยังไม่มีข้อมูล',
}: {
  data: Datum[]
  unit?: string
  max?: number
  emptyText?: string
}) {
  if (data.length === 0) return <p className="py-6 text-center text-sm text-ink-400">{emptyText}</p>

  const top = max ?? Math.max(...data.map((d) => d.value), 1)
  const rowH = 34
  const gap = 2
  const labelW = 132
  const valueW = 64
  const h = data.length * rowH
  const w = 560
  const plotW = w - labelW - valueW

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full"
      style={{ height: h }}
      role="img"
      aria-label={`กราฟแท่ง ${data.length} รายการ`}
    >
      {data.map((d, i) => {
        const y = i * rowH
        const bw = Math.max(0, (d.value / top) * plotW)
        return (
          <g key={d.label}>
            <title>{`${d.label} — ${d.value.toLocaleString('th-TH')} ${unit}`}</title>
            <text x={0} y={y + rowH / 2} dominantBaseline="middle" fontSize="12" fill={TEXT}>
              {d.label.length > 20 ? `${d.label.slice(0, 19)}…` : d.label}
            </text>
            <rect x={labelW} y={y + gap} width={plotW} height={rowH - gap * 2} fill="#F5F2EA" rx="4" />
            <path
              d={barPath(labelW, y + gap, bw, rowH - gap * 2, 4, 'right')}
              fill={d.color ?? SERIES.primary}
            />
            <text
              x={labelW + plotW + 8}
              y={y + rowH / 2}
              dominantBaseline="middle"
              fontSize="12"
              fontWeight="600"
              fill={TEXT}
            >
              {d.value.toLocaleString('th-TH')}
              {d.sub ? <tspan fill={TEXT_MUTED}> {d.sub}</tspan> : null}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** แท่งแนวตั้งตามเวลา — มี crosshair และกล่องข้อมูลตอนชี้ */
export function Columns({
  data,
  unit = '',
  emptyText = 'ยังไม่มีข้อมูล',
}: {
  data: Datum[]
  unit?: string
  emptyText?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const clipId = useId()

  if (data.length === 0) return <p className="py-6 text-center text-sm text-ink-400">{emptyText}</p>

  const w = 760
  const h = 220
  const padB = 26
  const padT = 14
  const plotH = h - padB - padT
  const top = Math.max(...data.map((d) => d.value), 1)
  const step = w / data.length
  const barW = Math.max(3, Math.min(22, step - 3))

  // เส้นกริดแนวนอน 3 เส้น จาง ๆ ไม่แย่งความสนใจจากแท่ง
  const ticks = [0, 0.5, 1].map((t) => Math.round(top * t))

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        style={{ height: h }}
        role="img"
        aria-label="กราฟแนวโน้มรายวัน"
        onMouseLeave={() => setHover(null)}
      >
        <clipPath id={clipId}>
          <rect x="0" y="0" width={w} height={h} />
        </clipPath>

        {ticks.map((t) => {
          const y = padT + plotH - (t / top) * plotH
          return (
            <g key={t}>
              <line x1="0" y1={y} x2={w} y2={y} stroke={AXIS} strokeWidth="1" />
              <text x="2" y={y - 4} fontSize="10" fill={TEXT_MUTED}>
                {t}
              </text>
            </g>
          )
        })}

        <g clipPath={`url(#${clipId})`}>
          {data.map((d, i) => {
            const bh = (d.value / top) * plotH
            const x = i * step + (step - barW) / 2
            const y = padT + plotH - bh
            const on = hover === i
            return (
              <g key={d.label} onMouseEnter={() => setHover(i)}>
                {/* พื้นที่รับเมาส์กว้างกว่าแท่ง กดง่ายแม้แท่งบาง */}
                <rect x={i * step} y={0} width={step} height={h} fill="transparent" />
                {on && <rect x={i * step} y={padT} width={step} height={plotH} fill="#1A171208" />}
                <path
                  d={barPath(x, y, barW, bh, 4, 'up')}
                  fill={on ? '#1c5cab' : SERIES.primary}
                />
              </g>
            )
          })}
        </g>

        <line x1="0" y1={padT + plotH} x2={w} y2={padT + plotH} stroke={AXIS} strokeWidth="1" />

        {data.map((d, i) =>
          // ป้ายวันที่เว้นระยะ ไม่งั้นทับกันเละ
          i % Math.ceil(data.length / 10) === 0 ? (
            <text
              key={d.label}
              x={i * step + step / 2}
              y={h - 8}
              fontSize="10"
              fill={TEXT_MUTED}
              textAnchor="middle"
            >
              {d.sub ?? d.label}
            </text>
          ) : null,
        )}
      </svg>

      {hover !== null && data[hover] && (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-btn border border-line bg-surface px-3 py-2 text-sm shadow-pop">
          <b className="font-display">{data[hover].label}</b>
          <span className="ml-2 text-ink-700">
            {data[hover].value.toLocaleString('th-TH')} {unit}
          </span>
        </div>
      )}
    </div>
  )
}

/** ตัวเลขเด่น ไม่ต้องมีกราฟ */
export function Stat({
  label,
  value,
  hint,
  tone = 'plain',
}: {
  label: string
  value: string | number
  hint?: ReactNode
  tone?: 'plain' | 'ok' | 'warn' | 'danger'
}) {
  const ring =
    tone === 'warn'
      ? 'border-warn/30 bg-warn-bg'
      : tone === 'danger'
        ? 'border-danger/25 bg-danger-bg'
        : tone === 'ok'
          ? 'border-success/25 bg-success-bg'
          : 'border-line bg-surface'
  return (
    <div className={`rounded-card border p-4 ${ring}`}>
      <p className="text-sm text-ink-500">{label}</p>
      <p className="mt-1 font-display text-xl leading-none">{value}</p>
      {hint && <p className="mt-2 text-xs text-ink-400">{hint}</p>}
    </div>
  )
}

/** ตารางข้อมูลดิบของกราฟ — จำเป็นสำหรับคนที่แยกสีไม่ออกและสำหรับก๊อปไปใช้ต่อ */
export function DataTable({
  rows,
  head,
  unit = '',
}: {
  rows: Datum[]
  head: [string, string]
  unit?: string
}) {
  const [open, setOpen] = useState(false)
  if (rows.length === 0) return null
  return (
    <div className="mt-2">
      <button
        type="button"
        className="min-h-tap text-sm text-ink-500 underline"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'ซ่อนตาราง' : 'ดูเป็นตาราง'}
      </button>
      {open && (
        <table className="mt-2 w-full text-left text-sm">
          <thead className="text-ink-500">
            <tr className="border-b border-line">
              <th className="py-1 font-medium">{head[0]}</th>
              <th className="py-1 text-right font-medium">{head[1]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-line last:border-0">
                <td className="py-1">{r.label}</td>
                <td className="py-1 text-right font-display">
                  {r.value.toLocaleString('th-TH')} {unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * โดนัท — ใช้ตอนอยากเห็นสัดส่วนของทั้งก้อน ไม่ใช่การจัดอันดับ
 * ติดป้ายชื่อกับตัวเลขไว้ข้าง ๆ เสมอ ไม่ให้ต้องเดาจากสี
 */
const DONUT = ['#2a78d6', '#eb6834', '#1baf7a', '#8B5CF6', '#B4820A', '#0EA5E9', '#B42318', '#6B6558']

export function Donut({
  data,
  unit = '',
  size = 168,
}: {
  data: Datum[]
  unit?: string
  size?: number
}) {
  const rows = data.filter((d) => d.value > 0)
  const total = rows.reduce((n, d) => n + d.value, 0)
  if (total === 0) {
    return <p className="py-6 text-center text-sm text-ink-400">ยังไม่มีข้อมูล</p>
  }

  const r = size / 2 - 12
  const c = 2 * Math.PI * r
  let acc = 0

  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <g transform={`translate(${size / 2},${size / 2}) rotate(-90)`}>
          {rows.map((d, i) => {
            const frac = d.value / total
            const dash = `${c * frac} ${c * (1 - frac)}`
            const el = (
              <circle
                key={d.label}
                r={r}
                fill="none"
                stroke={d.color ?? DONUT[i % DONUT.length]}
                strokeWidth={size / 7}
                strokeDasharray={dash}
                strokeDashoffset={-c * acc}
              />
            )
            acc += frac
            return el
          })}
        </g>
        <text
          x={size / 2}
          y={size / 2 - 2}
          textAnchor="middle"
          fontSize="20"
          fontWeight="600"
          fill={TEXT}
        >
          {total.toLocaleString('th-TH')}
        </text>
        <text x={size / 2} y={size / 2 + 16} textAnchor="middle" fontSize="11" fill={TEXT_MUTED}>
          {unit || 'รวม'}
        </text>
      </svg>

      <ul className="min-w-[150px] flex-1 space-y-1 text-sm">
        {rows.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-[3px]"
              style={{ background: d.color ?? DONUT[i % DONUT.length] }}
            />
            <span className="min-w-0 flex-1 truncate">{d.label}</span>
            <b className="font-display">{d.value.toLocaleString('th-TH')}</b>
            <span className="w-10 text-right text-xs text-ink-400">
              {Math.round((d.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** การ์ดตัวเลขใหญ่แบบมีไอคอนนำ ใช้กับตัวชี้วัดหลักบนสุดของหน้ารายงาน */
export function Kpi({
  icon,
  label,
  value,
  sub,
  tone = 'plain',
}: {
  icon: string
  label: string
  value: string | number
  sub?: ReactNode
  tone?: 'plain' | 'ok' | 'warn' | 'danger'
}) {
  const chip =
    tone === 'warn'
      ? 'bg-warn-bg text-warn-txt'
      : tone === 'danger'
        ? 'bg-danger-bg text-danger-txt'
        : tone === 'ok'
          ? 'bg-success-bg text-success-txt'
          : 'bg-brand-50 text-warn-txt'

  return (
    <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-4">
      <span
        aria-hidden
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-card text-lg ${chip}`}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm text-ink-500">{label}</span>
        <span className="block font-display text-xl leading-tight">{value}</span>
        {sub && <span className="block truncate text-xs text-ink-400">{sub}</span>}
      </span>
    </div>
  )
}
