import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import { listTruckDone, type TruckDoneRow } from '../../lib/trucks'

/**
 * สถิติการปล่อยรถ — หน้าแยกจากกระดาน
 *
 * กระดานตอบว่า "ตอนนี้ต้องทำอะไร" ส่วนหน้านี้ตอบว่า "ที่ผ่านมาเป็นยังไง"
 * สองคำถามนี้ถามคนละเวลาและคนละคน เอามารวมจอเดียวแปลว่าทั้งสองอันถูกลดทอน
 *
 * หัวใจคือการเทียบสองช่วง ไม่ใช่ดูช่วงเดียว
 * ตัวเลข "ตรงเวลา 87%" อ่านแล้วไม่รู้ว่าดีหรือแย่ จนกว่าจะมีอะไรให้เทียบ
 */

type Preset = '7d' | '14d' | '30d' | '90d' | '180d' | '365d' | 'custom'

const PRESETS: { key: Preset; label: string; days: number }[] = [
  { key: '7d', label: '7 วัน', days: 7 },
  { key: '14d', label: '14 วัน', days: 14 },
  { key: '30d', label: '1 เดือน', days: 30 },
  { key: '90d', label: '3 เดือน', days: 90 },
  { key: '180d', label: '6 เดือน', days: 180 },
  { key: '365d', label: '12 เดือน', days: 365 },
]

const iso = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d)
const shift = (days: number) => iso(new Date(Date.now() - days * 86400_000))

interface Span {
  from: string
  to: string
}

/** ตัวเลขสรุปของหนึ่งช่วง · คิดในเบราว์เซอร์เพราะต้องหั่นหลายแบบจากข้อมูลชุดเดียว */
function summarise(rows: TruckDoneRow[]) {
  const n = rows.length
  const onTime = rows.filter((r) => r.on_time).length
  const lateRows = rows.filter((r) => !r.on_time)
  const lateAvg = lateRows.length
    ? Math.round(lateRows.reduce((a, r) => a + (r.late_min ?? 0), 0) / lateRows.length)
    : 0
  const dwell = rows.filter((r) => r.dwell_min !== null).map((r) => r.dwell_min as number)
  const dwellAvg = dwell.length ? Math.round(dwell.reduce((a, b) => a + b, 0) / dwell.length) : 0
  return {
    n,
    pct: n ? Math.round((onTime / n) * 100) : 0,
    late: n - onTime,
    lateAvg,
    dwellAvg,
  }
}

export default function TruckStats() {
  const nav = useNavigate()
  const [preset, setPreset] = useState<Preset>('30d')
  const [a, setA] = useState<Span>({ from: shift(30), to: iso(new Date()) })
  const [b, setB] = useState<Span>({ from: shift(60), to: shift(31) })
  const [compare, setCompare] = useState(true)

  function usePreset(p: (typeof PRESETS)[number]) {
    setPreset(p.key)
    setA({ from: shift(p.days), to: iso(new Date()) })
    setB({ from: shift(p.days * 2), to: shift(p.days + 1) })
  }

  const spanA = useMemo(
    () => ({ f: new Date(`${a.from}T00:00:00`).toISOString(), t: new Date(`${a.to}T23:59:59`).toISOString() }),
    [a],
  )
  const spanB = useMemo(
    () => ({ f: new Date(`${b.from}T00:00:00`).toISOString(), t: new Date(`${b.to}T23:59:59`).toISOString() }),
    [b],
  )

  const rowsA = useAsync(() => listTruckDone(spanA.f, spanA.t), [spanA])
  const rowsB = useAsync(
    () => (compare ? listTruckDone(spanB.f, spanB.t) : Promise.resolve([])),
    [spanB, compare],
  )

  const A = summarise(rowsA.data ?? [])
  const B = summarise(rowsB.data ?? [])

  return (
    <div className="min-h-dvh px-4 py-4 sm:px-6" style={{ background: '#0B0E11', color: '#F0F4F9' }}>
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-label="ย้อนกลับ"
          className="h-tap w-tap rounded-btn text-xl"
          style={{ color: '#AFC0D4' }}
          onClick={() => nav('/trucks')}
        >
          ←
        </button>
        <span className="text-xl font-bold">สถิติการปล่อยรถ</span>
        <span className="flex-1" />
        <button
          type="button"
          className="rounded-lg px-4 py-2 text-sm font-bold"
          style={{ background: '#1B2430', color: '#F0F4F9' }}
          onClick={() => nav('/trucks')}
        >
          กลับไปกระดาน
        </button>
      </header>

      {/* ───────── เลือกช่วง ───────── */}
      <div className="mb-3 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className="rounded-full px-4 py-2 text-sm font-bold"
            style={
              preset === p.key
                ? { background: '#FFC400', color: '#0B0E11' }
                : { background: '#1B2430', color: '#AFC0D4' }
            }
            onClick={() => usePreset(p)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mb-5 grid gap-3 lg:grid-cols-2">
        <RangeBox title="ช่วง A" accent="#FFC400" span={a} onChange={(v) => { setA(v); setPreset('custom') }} />
        <div className="rounded-xl p-3" style={{ background: '#121820', opacity: compare ? 1 : 0.5 }}>
          <label className="mb-2 flex items-center gap-2 text-sm font-bold">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
            />
            เทียบกับช่วง B
          </label>
          {compare && (
            <RangeInputs span={b} onChange={(v) => { setB(v); setPreset('custom') }} />
          )}
        </div>
      </div>

      {rowsA.loading && <p className="py-6" style={{ color: '#AFC0D4' }}>กำลังโหลด…</p>}
      {rowsA.error && <p className="py-6" style={{ color: '#FF9A9A' }}>{rowsA.error}</p>}

      {/* ───────── ตัวเลขเทียบกัน ───────── */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="รถทั้งหมด" a={A.n} b={compare ? B.n : null} unit="คัน" higherIsBetter />
        <Kpi label="ออกตรงเวลา" a={A.pct} b={compare ? B.pct : null} unit="%" higherIsBetter />
        <Kpi label="ตกเวลา" a={A.late} b={compare ? B.late : null} unit="คัน" />
        <Kpi label="ช้าเฉลี่ย" a={A.lateAvg} b={compare ? B.lateAvg : null} unit="นาที" />
        <Kpi label="อยู่ในคลังเฉลี่ย" a={A.dwellAvg} b={compare ? B.dwellAvg : null} unit="นาที" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="ชั่วโมงไหนตกเวลาบ่อย" hint="ยิ่งแดงยิ่งบ่อย · นับตามเวลาที่รถถึงคลัง">
          <Heat rows={rowsA.data ?? []} />
        </Panel>

        <Panel title="อันดับสาขา" hint="ออกตรงเวลากี่เปอร์เซ็นต์ · เฉพาะสาขาที่มีรถตั้งแต่ 3 คันขึ้นไป">
          <Ranking rows={rowsA.data ?? []} />
        </Panel>

        <Panel title="อยู่ในคลังจริงกี่นาที" hint="แท่งแดงคือส่วนที่เกินกำหนดของคันนั้น">
          <Dwell rows={rowsA.data ?? []} />
        </Panel>

        <Panel title="แนวโน้ม" hint="ยุบหน่วยให้เองตามความยาวช่วง · อยู่ราว 8–14 แท่งเสมอ">
          <Trend rows={rowsA.data ?? []} from={a.from} to={a.to} />
        </Panel>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- ชิ้นส่วน */

function RangeBox({
  title,
  accent,
  span,
  onChange,
}: {
  title: string
  accent: string
  span: Span
  onChange: (s: Span) => void
}) {
  return (
    <div className="rounded-xl p-3" style={{ background: '#121820', borderLeft: `4px solid ${accent}` }}>
      <p className="mb-2 text-sm font-bold">{title}</p>
      <RangeInputs span={span} onChange={onChange} />
    </div>
  )
}

function RangeInputs({ span, onChange }: { span: Span; onChange: (s: Span) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        className="rounded-lg px-3 py-2 text-sm"
        style={{ background: '#141920', border: '1px solid #2A313B', color: '#F0F4F9' }}
        value={span.from}
        onChange={(e) => onChange({ ...span, from: e.target.value })}
      />
      <span style={{ color: '#AFC0D4' }}>ถึง</span>
      <input
        type="date"
        className="rounded-lg px-3 py-2 text-sm"
        style={{ background: '#141920', border: '1px solid #2A313B', color: '#F0F4F9' }}
        value={span.to}
        onChange={(e) => onChange({ ...span, to: e.target.value })}
      />
    </div>
  )
}

function Kpi({
  label,
  a,
  b,
  unit,
  higherIsBetter,
}: {
  label: string
  a: number
  b: number | null
  unit: string
  higherIsBetter?: boolean
}) {
  const diff = b === null ? null : a - b
  // ตัวเลขที่น้อยกว่าดีกว่าโดยปริยาย เช่น ตกเวลา ช้าเฉลี่ย
  const good = diff === null || diff === 0 ? null : higherIsBetter ? diff > 0 : diff < 0
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: '#121820' }}>
      <div className="text-xs" style={{ color: '#AFC0D4' }}>
        {label}
      </div>
      <div className="text-2xl font-extrabold">
        {a}
        <span className="ml-1 text-sm font-normal" style={{ color: '#AFC0D4' }}>
          {unit}
        </span>
      </div>
      {diff !== null && (
        <div className="text-xs" style={{ color: good === null ? '#AFC0D4' : good ? '#35D98A' : '#FF5C5C' }}>
          {diff > 0 ? '▲' : diff < 0 ? '▼' : '='} {Math.abs(diff)} {unit} เทียบ B ({b})
        </div>
      )}
    </div>
  )
}

function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl p-4" style={{ background: '#121820' }}>
      <p className="text-sm font-bold">{title}</p>
      <p className="mb-3 text-xs" style={{ color: '#AFC0D4' }}>
        {hint}
      </p>
      {children}
    </section>
  )
}

function Heat({ rows }: { rows: TruckDoneRow[] }) {
  const late = new Array(24).fill(0)
  rows.forEach((r) => {
    if (!r.on_time) late[new Date(r.arrived_at).getHours()] += 1
  })
  const max = Math.max(1, ...late)
  if (rows.length === 0) return <p className="text-sm" style={{ color: '#AFC0D4' }}>ยังไม่มีข้อมูล</p>
  return (
    <>
      {[0, 1].map((half) => (
        <div key={half}>
          <div className="mb-[2px] flex gap-[2px]">
            {late.slice(half * 12, half * 12 + 12).map((v, i) => (
              <div
                key={i}
                title={`${half * 12 + i}:00 ตกเวลา ${v} คัน`}
                className="h-[22px] flex-1 rounded-[2px]"
                style={{ background: v === 0 ? '#1A222C' : `rgba(255,92,92,${(0.18 + (v / max) * 0.82).toFixed(2)})` }}
              />
            ))}
          </div>
          <div className="mb-2 flex gap-[2px]">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="flex-1 text-center text-[10px]" style={{ color: '#AFC0D4' }}>
                {half * 12 + i}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

function Ranking({ rows }: { rows: TruckDoneRow[] }) {
  const by = new Map<string, { n: number; ok: number }>()
  rows.forEach((r) => {
    const k = r.branch_name
    const v = by.get(k) ?? { n: 0, ok: 0 }
    v.n += 1
    if (r.on_time) v.ok += 1
    by.set(k, v)
  })
  const list = [...by.entries()]
    .filter(([, v]) => v.n >= 3)
    .map(([k, v]) => ({ k, pct: Math.round((v.ok / v.n) * 100), n: v.n }))
    .sort((x, y) => x.pct - y.pct)
    .slice(0, 10)

  if (list.length === 0) return <p className="text-sm" style={{ color: '#AFC0D4' }}>ยังไม่มีสาขาที่มีรถถึง 3 คัน</p>
  return (
    <>
      {list.map((x) => {
        const c = x.pct >= 90 ? '#35D98A' : x.pct >= 80 ? '#FFB038' : '#FF5C5C'
        return (
          <div key={x.k} className="mb-[7px] flex items-center gap-2">
            <span className="w-[100px] truncate text-xs">{x.k}</span>
            <span className="h-[7px] flex-1 overflow-hidden rounded-full" style={{ background: '#1A222C' }}>
              <span className="block h-full rounded-full" style={{ width: `${x.pct}%`, background: c }} />
            </span>
            <span className="w-[56px] text-right font-mono text-xs" style={{ color: c }}>
              {x.pct}% · {x.n}
            </span>
          </div>
        )
      })}
    </>
  )
}

function Dwell({ rows }: { rows: TruckDoneRow[] }) {
  const d = rows.filter((r) => r.dwell_min !== null)
  if (d.length === 0) return <p className="text-sm" style={{ color: '#AFC0D4' }}>ยังไม่มีข้อมูล</p>
  const STEP = 15
  const N = 13 // 0-195 นาที
  const buckets = new Array(N).fill(0)
  d.forEach((r) => {
    const i = Math.min(N - 1, Math.floor((r.dwell_min as number) / STEP))
    buckets[i] += 1
  })
  const max = Math.max(1, ...buckets)
  const avgAllow = Math.round(rows.reduce((a, r) => a + r.allow_min, 0) / rows.length)
  return (
    <>
      <div className="flex h-[92px] items-end gap-[3px]">
        {buckets.map((v, i) => (
          <div
            key={i}
            title={`${i * STEP}–${(i + 1) * STEP} นาที · ${v} คัน`}
            className="flex-1 rounded-t-[2px]"
            style={{ height: `${(v / max) * 100}%`, background: i * STEP >= avgAllow ? '#FF5C5C' : '#35D98A' }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px]" style={{ color: '#AFC0D4' }}>
        <span>0</span>
        <span>90</span>
        <span style={{ color: '#FFC400' }}>กำหนดเฉลี่ย {avgAllow}</span>
        <span>195+</span>
      </div>
    </>
  )
}

function Trend({ rows, from, to }: { rows: TruckDoneRow[]; from: string; to: string }) {
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400_000) + 1)
  // ยุบหน่วยให้เอง · ช่วงยาวแค่ไหนก็อยู่ราวสิบกว่าแท่งเสมอ ไม่รก
  const groupDays = days <= 14 ? 1 : days <= 90 ? 7 : 30
  const unit = groupDays === 1 ? 'วัน' : groupDays === 7 ? 'สัปดาห์' : 'เดือน'

  const buckets = new Map<number, { n: number; ok: number }>()
  const start = Date.parse(`${from}T00:00:00`)
  rows.forEach((r) => {
    const i = Math.floor((Date.parse(r.arrived_at) - start) / (groupDays * 86400_000))
    const v = buckets.get(i) ?? { n: 0, ok: 0 }
    v.n += 1
    if (r.on_time) v.ok += 1
    buckets.set(i, v)
  })
  const list = [...buckets.entries()].sort((a, b) => a[0] - b[0]).slice(-14)

  if (list.length === 0) return <p className="text-sm" style={{ color: '#AFC0D4' }}>ยังไม่มีข้อมูล</p>
  return (
    <>
      <div className="flex h-[92px] items-end gap-1">
        {list.map(([i, v]) => {
          const pct = Math.round((v.ok / v.n) * 100)
          const c = pct >= 90 ? '#35D98A' : pct >= 80 ? '#FFB038' : '#FF5C5C'
          return (
            <div key={i} className="flex h-full flex-1 flex-col justify-end">
              <div className="text-center text-[10px]" style={{ color: '#AFC0D4' }}>
                {pct}
              </div>
              <div
                className="rounded-t-[2px]"
                style={{ height: `${Math.max(4, pct)}%`, background: c }}
                title={`${v.ok}/${v.n} คัน`}
              />
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-xs" style={{ color: '#AFC0D4' }}>
        ยุบเป็นราย{unit} · {list.length} แท่ง
      </p>
    </>
  )
}
