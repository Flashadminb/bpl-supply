import type { ReactNode } from 'react'
import { CARD, DIM, INSET, LINE, nf } from './parts'

/**
 * ชิ้นส่วนกราฟของแดชบอร์ดรถรอลงงาน
 *
 * เขียนเองด้วย SVG ไม่ดึงไลบรารีกราฟเข้ามา
 * ไลบรารีตัวเล็กที่สุดก็ยังหนักกว่าทั้งหน้านี้รวมกันหลายเท่า
 * และหน้างานเปิดผ่านเน็ตในฮับซึ่งไม่นิ่ง ทุกกิโลไบต์คือเวลารอ
 *
 * กราฟในนี้มีกติกาเดียวกันหมด
 *   ① ไม่มีข้อมูลต้องบอกว่าไม่มี ไม่ใช่วาดกราฟเปล่าให้ดูเหมือนเป็นศูนย์
 *   ② ตัวเลขจริงต้องอยู่บนกราฟ ไม่ใช่ให้เดาจากความสูงของแท่ง
 *   ③ สีเดียวกันแปลว่าเรื่องเดียวกันทุกกราฟ เขียวคือทัน แดงคือไม่ทัน
 *      ฟ้าคืองาน DO ม่วงคือไม่ใช่ DO
 */

export const OK = '#22C55E'
export const BAD = '#EF4444'
export const DO_C = '#38BDF8'
export const NONDO_C = '#A78BFA'
export const BLUE = '#3B82F6'

export function Panel({
  title,
  right,
  children,
  className = '',
}: {
  title: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={'flex flex-col rounded-2xl p-4 ' + className}
      style={{ background: CARD, border: `1px solid ${LINE}` }}
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[16px] font-extrabold">{title}</h3>
        {right}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}

export function Empty({ text = 'ช่วงนี้ยังไม่มีข้อมูล' }: { text?: string }) {
  return (
    <p className="py-10 text-center text-sm" style={{ color: DIM }}>
      {text}
    </p>
  )
}

/* ------------------------------------------------------------------ KPI */

/**
 * การ์ดตัวเลขหลัก
 *
 * ไอคอนอยู่ในกรอบสี ตัวเลขใหญ่สีเดียวกับไอคอน และบรรทัดล่างไว้ใส่ของที่ขยายความ
 * ทรงตามแบบที่เจ้าของระบบเลือกมา
 */
export function Kpi({
  icon,
  label,
  value,
  tone,
  foot,
}: {
  icon: string
  label: string
  value: string | number
  tone: string
  foot?: ReactNode
}) {
  return (
    <div
      className="flex min-w-0 flex-col rounded-2xl px-4 py-3"
      style={{ background: CARD, border: `1px solid ${LINE}` }}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[19px]"
          style={{ background: tone + '26', border: `1px solid ${tone}55` }}
          aria-hidden
        >
          {icon}
        </span>
        <span className="min-w-0 truncate text-[15px] font-extrabold">{label}</span>
      </div>
      <div className="mt-2 text-[34px] font-extrabold leading-none" style={{ color: tone }}>
        {value}
      </div>
      {foot && (
        <div className="mt-2 text-[12px] font-bold" style={{ color: DIM }}>
          {foot}
        </div>
      )}
    </div>
  )
}

/** ป้ายส่วนต่างระหว่างสองช่วง · เขียวคือดีขึ้น แดงคือแย่ลง */
export function Delta({
  diff,
  unit = '',
  lowerIsBetter,
}: {
  diff: number
  unit?: string
  lowerIsBetter?: boolean
}) {
  if (diff === 0) {
    return (
      <span className="rounded-md px-2 py-[2px] text-[12px] font-extrabold" style={{ background: '#1F2731', color: DIM }}>
        เท่าเดิม
      </span>
    )
  }
  const better = lowerIsBetter ? diff < 0 : diff > 0
  const c = better ? OK : BAD
  return (
    <span
      className="rounded-md px-2 py-[2px] text-[12px] font-extrabold"
      style={{ background: c + '22', color: c, border: `1px solid ${c}55` }}
    >
      {diff > 0 ? '▲ +' : '▼ '}
      {nf(Math.abs(diff))}
      {diff < 0 ? '' : ''} {unit}
    </span>
  )
}

/* ---------------------------------------------------------------- โดนัท */

export function Donut({
  parts,
  center,
  centerSub,
  size = 170,
}: {
  parts: { label: string; value: number; color: string }[]
  center: string
  centerSub?: string
  size?: number
}) {
  const sum = parts.reduce((a, b) => a + b.value, 0)
  const sw = 22
  const r = (size - sw) / 2
  const circ = 2 * Math.PI * r
  let acc = 0

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1F2731" strokeWidth={sw} />
        {sum > 0 &&
          parts.map((p) => {
            const len = (p.value / sum) * circ
            const el = (
              <circle
                key={p.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={p.color}
                strokeWidth={sw}
                strokeDasharray={`${len} ${circ}`}
                strokeDashoffset={-acc}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            )
            acc += len
            return el
          })}
        <text
          x="50%"
          y="46%"
          textAnchor="middle"
          dominantBaseline="central"
          fill="#EAF0F7"
          fontSize={Math.round(size * 0.2)}
          fontWeight={800}
        >
          {center}
        </text>
        {centerSub && (
          <text
            x="50%"
            y="63%"
            textAnchor="middle"
            dominantBaseline="central"
            fill="#8A97A6"
            fontSize={Math.round(size * 0.085)}
            fontWeight={700}
          >
            {centerSub}
          </text>
        )}
      </svg>

      <div className="min-w-0 space-y-2">
        {parts.map((p) => (
          <div key={p.label} className="flex items-baseline gap-2">
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-sm"
              style={{ background: p.color }}
            />
            <span className="truncate text-[13px] font-bold" style={{ color: DIM }}>
              {p.label}
            </span>
            <span className="ml-auto text-[16px] font-extrabold">{nf(p.value)}</span>
            <span className="text-[12px] font-bold" style={{ color: DIM }}>
              {sum > 0 ? Math.round((p.value / sum) * 100) + '%' : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- แท่งตั้ง */

/**
 * แท่งตั้งซ้อนสองสี
 *
 * ใช้กับ "แต่ละวันเข้ากี่คัน ทันกี่คัน" ซึ่งเป็นคำถามเดียวไม่ใช่สองคำถาม
 * แท่งคู่กันจะตอบว่า "วันไหนเยอะกว่ากัน" ส่วนแท่งซ้อนตอบว่า "วันนั้นสัดส่วนเท่าไหร่"
 */
export function StackBars({
  rows,
  height = 190,
}: {
  rows: { label: string; a: number; b: number; note?: string }[]
  height?: number
}) {
  if (rows.length === 0) return <Empty />
  const top = Math.max(1, ...rows.map((r) => r.a + r.b))

  return (
    <>
      <div className="flex items-end gap-2 overflow-x-auto pb-1" style={{ height }}>
        {rows.map((r) => {
          const total = r.a + r.b
          const h = Math.round((total / top) * (height - 44))
          const ah = total > 0 ? Math.round((r.a / total) * h) : 0
          return (
            <div key={r.label} className="flex min-w-[40px] flex-1 flex-col items-center justify-end">
              <span className="mb-1 text-[12px] font-extrabold">{total}</span>
              <div
                className="flex w-full max-w-[46px] flex-col-reverse overflow-hidden rounded-t-md"
                style={{ height: Math.max(h, 3) }}
                title={r.note}
              >
                <div style={{ height: ah, background: OK }} />
                <div style={{ height: h - ah, background: BAD }} />
              </div>
              <span className="mt-1 text-[11px]" style={{ color: DIM }}>
                {r.label}
              </span>
            </div>
          )
        })}
      </div>
      <Legend items={[{ c: OK, t: 'ทันเวลา' }, { c: BAD, t: 'ไม่ทัน' }]} />
    </>
  )
}

/* ------------------------------------------------------------- แท่งนอน */

export function HBars({
  rows,
  unit = '',
  max,
}: {
  rows: { label: string; value: number; sub?: string; color?: string }[]
  unit?: string
  max?: number
}) {
  if (rows.length === 0) return <Empty />
  const top = max ?? Math.max(1, ...rows.map((r) => r.value))

  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <span className="w-[112px] shrink-0 truncate text-[13px] font-bold">{r.label}</span>
          <div className="h-6 min-w-0 flex-1 overflow-hidden rounded-md" style={{ background: INSET }}>
            <div
              className="h-full rounded-md"
              style={{
                width: `${Math.max(2, Math.round((r.value / top) * 100))}%`,
                background: r.color ?? BLUE,
              }}
            />
          </div>
          <span className="w-[86px] shrink-0 text-right text-[14px] font-extrabold">
            {nf(r.value)}
            <span className="ml-1 text-[11px] font-bold" style={{ color: DIM }}>{unit}</span>
          </span>
          {r.sub && (
            <span className="w-[96px] shrink-0 text-right text-[12px] font-bold" style={{ color: DIM }}>
              {r.sub}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

/* --------------------------------------------------------------- เส้น */

/**
 * เส้นแนวโน้ม · รองรับสองเส้นสำหรับโหมดเทียบช่วง
 *
 * แกนตั้งตรึงที่ 0–100 เสมอเพราะมันคือร้อยละ
 * ถ้าปล่อยให้ยืดตามข้อมูล วันที่ทุกค่าอยู่ระหว่าง 94 ถึง 97
 * กราฟจะดูเหมือนขึ้นลงรุนแรงมาก ทั้งที่จริงแทบไม่ขยับ
 */
export function LinePct({
  series,
  labels,
  height = 200,
}: {
  series: { name: string; color: string; points: (number | null)[] }[]
  labels: string[]
  height?: number
}) {
  const n = Math.max(...series.map((s) => s.points.length), 0)
  if (n === 0) return <Empty />

  const w = 760
  const padL = 34
  const padB = 26
  const padT = 10
  const innerW = w - padL - 8
  const innerH = height - padB - padT
  const x = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => padT + innerH - (v / 100) * innerH

  return (
    <>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }}>
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={padL} x2={w - 8} y1={y(g)} y2={y(g)} stroke="#1F2731" strokeWidth={1} />
            <text x={padL - 6} y={y(g)} textAnchor="end" dominantBaseline="central" fill="#5A6676" fontSize={11}>
              {g}
            </text>
          </g>
        ))}

        {series.map((s) => {
          const pts = s.points
            .map((v, i) => (v == null ? null : `${x(i)},${y(v)}`))
            .filter(Boolean)
            .join(' ')
          return (
            <g key={s.name}>
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
              {s.points.map((v, i) =>
                v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={s.color} />,
              )}
            </g>
          )
        })}

        {labels.map((l, i) => (
          <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fill="#5A6676" fontSize={11}>
            {l}
          </text>
        ))}
      </svg>
      <Legend items={series.map((s) => ({ c: s.color, t: s.name }))} />
    </>
  )
}

export function Legend({ items }: { items: { c: string; t: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-4 text-[12px] font-bold">
      {items.map((i) => (
        <span key={i.t} className="flex items-center gap-2" style={{ color: DIM }}>
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: i.c }} />
          {i.t}
        </span>
      ))}
    </div>
  )
}
