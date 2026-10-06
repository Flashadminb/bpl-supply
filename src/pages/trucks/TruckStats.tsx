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
 *
 * ไม่มีปุ่ม 7 วัน 14 วัน 1 เดือนแล้ว เพราะมีช่องเลือกวันที่อยู่ข้างบนอยู่แล้ว
 * ปุ่มลัดที่ทำสิ่งเดียวกับช่องที่อยู่ติดกัน คือของสองชิ้นที่ต้องดูแลเพื่อผลลัพธ์เดียว
 */

const iso = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d)
const shift = (days: number) => iso(new Date(Date.now() - days * 86400_000))
const p2 = (n: number) => String(n).padStart(2, '0')
const dmy = (d: Date) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`
const hm = (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}`

const INK = '#F0F4F9'
const DIM = '#AFC0D4'
const FAINT = '#5A646F'
const PANEL = '#121820'
const OK = '#35D98A'
const WARN = '#FFB038'
const BAD = '#FF5C5C'
const GOLD = '#FFC400'
const BLUE = '#49A9FF'

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
  // เร็วสุดคือจอดน้อยที่สุด ไม่ใช่เลยกำหนดน้อยที่สุด
  const fastest = dwell.length ? Math.min(...dwell) : 0
  return { n, onTime, pct: n ? Math.round((onTime / n) * 100) : 0, late: n - onTime, lateAvg, dwellAvg, fastest }
}

export default function TruckStats() {
  const nav = useNavigate()
  const [a, setA] = useState<Span>({ from: shift(30), to: iso(new Date()) })
  const [b, setB] = useState<Span>({ from: shift(60), to: shift(31) })
  const [compare, setCompare] = useState(false)

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

  const listA = rowsA.data ?? []
  const listB = rowsB.data ?? []
  const A = summarise(listA)
  const B = summarise(listB)

  return (
    <div className="min-h-dvh px-4 py-4 sm:px-6" style={{ background: '#0B0E11', color: INK }}>
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-label="ย้อนกลับ"
          className="h-tap w-tap rounded-btn text-xl"
          style={{ color: DIM }}
          onClick={() => nav('/trucks')}
        >
          ←
        </button>
        <span
          className="rounded-md px-2.5 py-1 text-sm font-extrabold"
          style={{ background: GOLD, color: '#0B0E11' }}
        >
          FLASH
        </span>
        <span className="text-xl font-bold">สถิติการปล่อยรถ · 21BPL</span>
        <span className="flex-1" />
        <button
          type="button"
          className="h-tap rounded-lg px-4 text-sm font-bold"
          style={{ background: '#1B2430', color: INK }}
          onClick={() => nav('/trucks')}
        >
          กลับไปกระดาน
        </button>
      </header>

      {/* ───────── เลือกช่วง ───────── */}
      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl p-3" style={{ background: PANEL, borderLeft: `4px solid ${GOLD}` }}>
          <p className="mb-2 text-sm font-bold">ช่วงที่ดู</p>
          <RangeInputs span={a} onChange={setA} />
        </div>
        <div className="rounded-xl p-3" style={{ background: PANEL, opacity: compare ? 1 : 0.65 }}>
          <label className="mb-2 flex items-center gap-2 text-sm font-bold">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
            />
            เทียบกับอีกช่วง
          </label>
          {compare ? (
            <RangeInputs span={b} onChange={setB} />
          ) : (
            <p className="text-xs" style={{ color: DIM }}>
              ติ๊กแล้วทุกตัวเลขจะขึ้นลูกศรบอกว่าดีขึ้นหรือแย่ลงเทียบกับช่วงที่เลือกไว้
            </p>
          )}
        </div>
      </div>

      {rowsA.loading && (
        <p className="py-6" style={{ color: DIM }}>
          กำลังโหลด…
        </p>
      )}
      {rowsA.error && (
        <p className="py-6" style={{ color: '#FF9A9A' }}>
          {rowsA.error}
        </p>
      )}

      {/* ───────── การ์ดตัวเลข ───────── */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi label="รถทั้งหมด" a={A.n} b={compare ? B.n : null} unit="คัน" higherIsBetter />
        <Kpi label="ออกตรงเวลา" a={A.pct} b={compare ? B.pct : null} unit="%" higherIsBetter tone={OK} />
        <Kpi label="ตกเวลา" a={A.late} b={compare ? B.late : null} unit="คัน" tone={BAD} />
        <Kpi label="ช้าเฉลี่ย" a={A.lateAvg} b={compare ? B.lateAvg : null} unit="นาที" tone={WARN} />
        <Kpi label="อยู่ในคลังเฉลี่ย" a={A.dwellAvg} b={compare ? B.dwellAvg : null} unit="นาที" />
        <Kpi label="ออกเร็วสุด" a={A.fastest} b={compare ? B.fastest : null} unit="นาที" tone={BLUE} />
      </div>

      {/* ───────── กราฟ ───────── */}
      <div className="grid gap-4 xl:grid-cols-12">
        <Panel
          className="xl:col-span-8"
          title="แนวโน้ม"
          hint="พื้นที่ฟ้าคือจำนวนรถที่ปล่อย · เส้นเขียวคือเปอร์เซ็นต์ที่ออกตรงเวลา · ยุบหน่วยให้เองตามความยาวช่วง"
        >
          <Flow rows={listA} compare={compare ? listB : null} from={a.from} to={a.to} />
        </Panel>

        <Panel className="xl:col-span-4" title="สัดส่วนผล" hint="จากรถที่ปล่อยไปแล้วทั้งหมดในช่วงนี้">
          <div className="flex items-center justify-around gap-2 py-2">
            <Ring pct={A.pct} color={OK} label="ตรงเวลา" sub={`${A.onTime} คัน`} />
            <Ring pct={A.n ? 100 - A.pct : 0} color={BAD} label="ตกเวลา" sub={`${A.late} คัน`} />
          </div>
        </Panel>

        <Panel
          className="xl:col-span-4"
          title="ชั่วโมงไหนตกเวลาบ่อย"
          hint="นับตามเวลาที่รถถึงคลัง · ยิ่งสูงยิ่งบ่อย"
        >
          <Hours rows={listA} />
        </Panel>

        <Panel
          className="xl:col-span-4"
          title="อยู่ในคลังจริงกี่นาที"
          hint="แท่งแดงคือช่วงที่เลยกำหนดเฉลี่ยไปแล้ว"
        >
          <Dwell rows={listA} />
        </Panel>

        <Panel className="xl:col-span-4" title="ปล่อยเร็วสุด 5 คัน" hint="นับจากถึงคลังจนกดปล่อย">
          <Fastest rows={listA} />
        </Panel>

        <Panel
          className="xl:col-span-12"
          title="อันดับสาขา"
          hint="ออกตรงเวลากี่เปอร์เซ็นต์ · เรียงจากน้อยไปมาก · เฉพาะสาขาที่มีรถตั้งแต่ 3 คันขึ้นไป"
        >
          <Ranking rows={listA} />
        </Panel>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- ชิ้นส่วน */

function RangeInputs({ span, onChange }: { span: Span; onChange: (s: Span) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        className="h-tap rounded-lg px-3 text-sm"
        style={{ background: '#141920', border: '1px solid #2A313B', color: INK }}
        value={span.from}
        onChange={(e) => onChange({ ...span, from: e.target.value })}
      />
      <span style={{ color: DIM }}>ถึง</span>
      <input
        type="date"
        className="h-tap rounded-lg px-3 text-sm"
        style={{ background: '#141920', border: '1px solid #2A313B', color: INK }}
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
  tone,
}: {
  label: string
  a: number
  b: number | null
  unit: string
  higherIsBetter?: boolean
  tone?: string
}) {
  const diff = b === null ? null : a - b
  // ตัวเลขที่น้อยกว่าดีกว่าโดยปริยาย เช่น ตกเวลา ช้าเฉลี่ย ออกเร็วสุด
  const good = diff === null || diff === 0 ? null : higherIsBetter ? diff > 0 : diff < 0
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: PANEL, borderTop: `3px solid ${tone ?? '#243040'}` }}>
      <div className="text-xs" style={{ color: DIM }}>
        {label}
      </div>
      <div className="font-mono text-3xl font-extrabold" style={{ color: tone ?? INK }}>
        {a}
        <span className="ml-1 font-sans text-sm font-normal" style={{ color: DIM }}>
          {unit}
        </span>
      </div>
      {diff !== null && (
        <div className="text-xs" style={{ color: good === null ? DIM : good ? OK : BAD }}>
          {diff > 0 ? '▲' : diff < 0 ? '▼' : '='} {Math.abs(diff)} {unit} · อีกช่วง {b}
        </div>
      )}
    </div>
  )
}

function Panel({
  title,
  hint,
  className,
  children,
}: {
  title: string
  hint: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={`rounded-xl p-4 ${className ?? ''}`} style={{ background: PANEL }}>
      <p className="text-sm font-bold">{title}</p>
      <p className="mb-3 text-xs" style={{ color: DIM }}>
        {hint}
      </p>
      {children}
    </section>
  )
}

function Empty() {
  return (
    <p className="py-6 text-center text-sm" style={{ color: FAINT }}>
      ยังไม่มีข้อมูลในช่วงนี้
    </p>
  )
}

/**
 * วงแหวนเปอร์เซ็นต์
 *
 * ใช้เส้นรอบวงเดียวจบ ไม่ต้องมีไลบรารีกราฟ
 * strokeDasharray คือความยาวเส้นรอบวง ส่วน offset คือส่วนที่ยังไม่ระบาย
 */
function Ring({ pct, color, label, sub }: { pct: number; color: string; label: string; sub: string }) {
  const R = 46
  const C = 2 * Math.PI * R
  return (
    <div className="flex flex-col items-center">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={R} fill="none" stroke="#1A222C" strokeWidth="13" />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - Math.min(100, Math.max(0, pct)) / 100)}
          transform="rotate(-90 60 60)"
        />
        <text
          x="60"
          y="58"
          textAnchor="middle"
          fontSize="26"
          fontWeight="800"
          fill={color}
          fontFamily="ui-monospace, monospace"
        >
          {pct}%
        </text>
        <text x="60" y="78" textAnchor="middle" fontSize="12" fill={DIM}>
          {sub}
        </text>
      </svg>
      <span className="text-sm font-bold">{label}</span>
    </div>
  )
}

/**
 * กราฟแนวโน้ม · พื้นที่คือจำนวนรถ เส้นคือเปอร์เซ็นต์ตรงเวลา
 *
 * สองอย่างนี้ต้องอยู่รูปเดียวกัน เพราะเปอร์เซ็นต์ล้วน ๆ โกหกได้ง่าย
 * วันที่ปล่อยรถคันเดียวแล้วตรงเวลา ขึ้นเป็นร้อยเปอร์เซ็นต์เท่ากับวันที่ปล่อยสามร้อยคัน
 * พอเห็นพื้นที่ใต้เส้นด้วย ก็รู้ทันทีว่าเปอร์เซ็นต์นั้นมีน้ำหนักแค่ไหน
 */
function Flow({
  rows,
  compare,
  from,
  to,
}: {
  rows: TruckDoneRow[]
  compare: TruckDoneRow[] | null
  from: string
  to: string
}) {
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400_000) + 1)
  const groupDays = days <= 14 ? 1 : days <= 90 ? 7 : 30
  const unit = groupDays === 1 ? 'วัน' : groupDays === 7 ? 'สัปดาห์' : 'เดือน'

  function bucket(list: TruckDoneRow[], startISO: string) {
    const start = Date.parse(`${startISO}T00:00:00`)
    const m = new Map<number, { n: number; ok: number }>()
    list.forEach((r) => {
      const i = Math.floor((Date.parse(r.arrived_at) - start) / (groupDays * 86400_000))
      const v = m.get(i) ?? { n: 0, ok: 0 }
      v.n += 1
      if (r.on_time) v.ok += 1
      m.set(i, v)
    })
    return [...m.entries()]
      .sort((x, y) => x[0] - y[0])
      .slice(-14)
      .map(([i, v]) => ({ i, ...v, pct: Math.round((v.ok / v.n) * 100), at: start + i * groupDays * 86400_000 }))
  }

  const A = bucket(rows, from)
  const B = compare ? bucket(compare, from) : []
  if (A.length === 0) return <Empty />

  const W = 760
  const H = 230
  const PAD_L = 38
  const PAD_R = 34
  const PAD_T = 12
  const PAD_B = 28
  const iw = W - PAD_L - PAD_R
  const ih = H - PAD_T - PAD_B
  const maxN = Math.max(1, ...A.map((d) => d.n), ...B.map((d) => d.n))

  const x = (k: number, len: number) => PAD_L + (len <= 1 ? iw / 2 : (k / (len - 1)) * iw)
  const yN = (n: number) => PAD_T + ih - (n / maxN) * ih
  const yP = (p: number) => PAD_T + ih - (p / 100) * ih

  const areaPts = A.map((d, k) => `${x(k, A.length)},${yN(d.n)}`).join(' ')
  const area = `M ${PAD_L},${PAD_T + ih} L ${areaPts.split(' ').join(' L ')} L ${x(A.length - 1, A.length)},${PAD_T + ih} Z`
  const lineA = A.map((d, k) => `${k === 0 ? 'M' : 'L'} ${x(k, A.length)},${yP(d.pct)}`).join(' ')
  const lineB = B.map((d, k) => `${k === 0 ? 'M' : 'L'} ${x(k, B.length)},${yP(d.pct)}`).join(' ')

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 230 }}>
        <defs>
          <linearGradient id="truckArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BLUE} stopOpacity="0.55" />
            <stop offset="100%" stopColor={BLUE} stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {/* เส้นกริดแนวนอนของเปอร์เซ็นต์ */}
        {[0, 25, 50, 75, 100].map((p) => (
          <g key={p}>
            <line x1={PAD_L} y1={yP(p)} x2={W - PAD_R} y2={yP(p)} stroke="#1C2530" strokeWidth="1" />
            <text x={W - PAD_R + 5} y={yP(p) + 4} fontSize="10" fill={FAINT}>
              {p}%
            </text>
          </g>
        ))}
        {/* แกนซ้ายคือจำนวนคัน */}
        {[0, Math.round(maxN / 2), maxN].map((n) => (
          <text key={n} x={PAD_L - 6} y={yN(n) + 4} fontSize="10" fill={FAINT} textAnchor="end">
            {n}
          </text>
        ))}

        <path d={area} fill="url(#truckArea)" />
        <polyline points={areaPts} fill="none" stroke={BLUE} strokeWidth="2" />

        {B.length > 1 && (
          <path d={lineB} fill="none" stroke={DIM} strokeWidth="2" strokeDasharray="5 4" opacity="0.8" />
        )}
        <path d={lineA} fill="none" stroke={OK} strokeWidth="3" strokeLinejoin="round" />
        {A.map((d, k) => (
          <circle key={d.i} cx={x(k, A.length)} cy={yP(d.pct)} r="3.5" fill={OK}>
            <title>{`${d.n} คัน · ตรงเวลา ${d.pct}%`}</title>
          </circle>
        ))}

        {A.map((d, k) =>
          k % Math.ceil(A.length / 7) === 0 || k === A.length - 1 ? (
            <text key={d.i} x={x(k, A.length)} y={H - 8} fontSize="10" fill={DIM} textAnchor="middle">
              {dmy(new Date(d.at))}
            </text>
          ) : null,
        )}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-4 text-xs" style={{ color: DIM }}>
        <Legend color={BLUE} text="จำนวนรถที่ปล่อย" />
        <Legend color={OK} text="ตรงเวลา %" />
        {B.length > 1 && <Legend color={DIM} text="ตรงเวลา % ของอีกช่วง" dashed />}
        <span className="flex-1" />
        <span style={{ color: FAINT }}>
          ยุบเป็นราย{unit} · {A.length} จุด
        </span>
      </div>
    </>
  )
}

function Legend({ color, text, dashed }: { color: string; text: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="inline-block h-[3px] w-5 rounded-full"
        style={{ background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 5px, transparent 5px 9px)` : color }}
      />
      {text}
    </span>
  )
}

/** ตกเวลาแยกตามชั่วโมงที่รถถึงคลัง · แท่งเต็มวัน 24 ชั่วโมง */
function Hours({ rows }: { rows: TruckDoneRow[] }) {
  if (rows.length === 0) return <Empty />
  const all = new Array(24).fill(0)
  const late = new Array(24).fill(0)
  rows.forEach((r) => {
    const h = new Date(r.arrived_at).getHours()
    all[h] += 1
    if (!r.on_time) late[h] += 1
  })
  const max = Math.max(1, ...all)
  const worst = late.indexOf(Math.max(...late))

  return (
    <>
      <div className="flex h-[120px] items-end gap-[2px]">
        {all.map((v, h) => (
          <div key={h} className="flex h-full flex-1 flex-col justify-end" title={`${h}:00 · ${v} คัน · ตกเวลา ${late[h]} คัน`}>
            <div
              className="rounded-t-[2px]"
              style={{ height: `${(late[h] / max) * 100}%`, background: BAD, minHeight: late[h] ? 2 : 0 }}
            />
            <div
              style={{
                height: `${((v - late[h]) / max) * 100}%`,
                background: '#27455E',
                minHeight: v - late[h] ? 2 : 0,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px]">
        {all.map((_, h) => (
          <div key={h} className="flex-1 text-center text-[9px]" style={{ color: FAINT }}>
            {h % 3 === 0 ? h : ''}
          </div>
        ))}
      </div>
      {Math.max(...late) > 0 && (
        <p className="mt-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(255,92,92,.12)', color: '#FF9A9A' }}>
          ชั่วโมงที่ตกเวลาบ่อยสุดคือ <b>{p2(worst)}:00</b> · {late[worst]} คัน
        </p>
      )}
    </>
  )
}

function Dwell({ rows }: { rows: TruckDoneRow[] }) {
  const d = rows.filter((r) => r.dwell_min !== null)
  if (d.length === 0) return <Empty />
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
      <div className="flex h-[120px] items-end gap-[3px]">
        {buckets.map((v, i) => (
          <div
            key={i}
            title={`${i * STEP}–${(i + 1) * STEP} นาที · ${v} คัน`}
            className="flex h-full flex-1 flex-col justify-end"
          >
            {v > 0 && (
              <div className="text-center text-[9px]" style={{ color: FAINT }}>
                {v}
              </div>
            )}
            <div
              className="rounded-t-[2px]"
              style={{
                height: `${(v / max) * 100}%`,
                background: i * STEP >= avgAllow ? BAD : OK,
                minHeight: v ? 3 : 0,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px]" style={{ color: FAINT }}>
        <span>0</span>
        <span>90</span>
        <span style={{ color: GOLD }}>กำหนดเฉลี่ย {avgAllow} นาที</span>
        <span>195+</span>
      </div>
    </>
  )
}

/**
 * ห้าคันที่ออกเร็วที่สุด
 *
 * ค่าเฉลี่ยบอกว่าปกติใช้เวลาเท่าไหร่ แต่ไม่ได้บอกว่าเร็วที่สุดเท่าไหร่ที่เคยทำได้จริง
 * ตัวเลขนั้นมีประโยชน์กว่าตอนจะตั้งเป้า เพราะมันเกิดขึ้นจริงแล้วในคลังนี้ ไม่ใช่ตัวเลขที่คิดเอา
 */
function Fastest({ rows }: { rows: TruckDoneRow[] }) {
  const list = rows
    .filter((r) => r.dwell_min !== null)
    .sort((a, b) => (a.dwell_min as number) - (b.dwell_min as number))
    .slice(0, 5)
  if (list.length === 0) return <Empty />
  const best = list[0].dwell_min as number

  return (
    <ol className="space-y-2">
      {list.map((r, i) => {
        const m = r.dwell_min as number
        const arr = new Date(r.arrived_at)
        return (
          <li key={r.id} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: '#0F141B' }}>
            <span className="font-mono text-sm font-extrabold" style={{ color: i === 0 ? GOLD : FAINT }}>
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2">
                {r.branch_code && (
                  <span className="font-mono text-sm font-extrabold" style={{ color: GOLD }}>
                    {r.branch_code}
                  </span>
                )}
                <span className="truncate text-sm font-bold">{r.branch_name}</span>
              </span>
              <span className="block text-[11px]" style={{ color: FAINT }}>
                {dmy(arr)} {hm(arr)} · {r.on_time ? 'ตรงเวลา' : `เลย ${r.late_min ?? 0} นาที`}
              </span>
            </span>
            <span className="text-right">
              <span className="font-mono text-xl font-extrabold" style={{ color: BLUE }}>
                {m}
              </span>
              <span className="ml-1 text-xs" style={{ color: DIM }}>
                นาที
              </span>
              <span className="block h-[4px] rounded-full" style={{ width: 60, background: '#1A222C' }}>
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${Math.round((best / m) * 100)}%`, background: BLUE }}
                />
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function Ranking({ rows }: { rows: TruckDoneRow[] }) {
  const by = new Map<string, { n: number; ok: number; code: string | null }>()
  rows.forEach((r) => {
    const k = r.branch_name
    const v = by.get(k) ?? { n: 0, ok: 0, code: r.branch_code }
    v.n += 1
    if (r.on_time) v.ok += 1
    by.set(k, v)
  })
  const list = [...by.entries()]
    .filter(([, v]) => v.n >= 3)
    .map(([k, v]) => ({ k, code: v.code, pct: Math.round((v.ok / v.n) * 100), n: v.n }))
    .sort((x, y) => x.pct - y.pct)
    .slice(0, 12)

  if (list.length === 0)
    return (
      <p className="py-6 text-center text-sm" style={{ color: FAINT }}>
        ยังไม่มีสาขาที่มีรถถึง 3 คันในช่วงนี้
      </p>
    )
  return (
    <div className="grid gap-x-8 gap-y-2 lg:grid-cols-2">
      {list.map((x) => {
        const c = x.pct >= 90 ? OK : x.pct >= 80 ? WARN : BAD
        return (
          <div key={x.k} className="flex items-center gap-2">
            {x.code && (
              <span className="w-[62px] shrink-0 font-mono text-xs font-extrabold" style={{ color: GOLD }}>
                {x.code}
              </span>
            )}
            <span className="w-[110px] shrink-0 truncate text-xs">{x.k}</span>
            <span className="h-[8px] flex-1 overflow-hidden rounded-full" style={{ background: '#1A222C' }}>
              <span className="block h-full rounded-full" style={{ width: `${x.pct}%`, background: c }} />
            </span>
            <span className="w-[70px] shrink-0 text-right font-mono text-xs" style={{ color: c }}>
              {x.pct}% · {x.n}
            </span>
          </div>
        )
      })}
    </div>
  )
}
