import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import { waitTruckCompare, waitTruckStats, type WaitStats as Stats } from '../../lib/waitTrucks'
import { DateRangePicker } from '../../components/DateRangePicker'
import { BG, CARD, DIM, LINE, nf, WaitLogo } from './parts'
import {
  BAD,
  BLUE,
  Delta,
  DO_C,
  Donut,
  Empty,
  HBars,
  Kpi,
  LinePct,
  NONDO_C,
  OK,
  Panel,
  StackBars,
} from './dash'

/**
 * แดชบอร์ดรถรอลงงาน · อยู่ฝั่งหน้างาน ไม่ใช่หลังบ้าน
 *
 * หัวหน้าหน้างานคือคนที่ต้องตอบว่าสัปดาห์นี้ดีขึ้นหรือแย่ลง และตอบตอนอยู่ในคลัง
 * ถ้าต้องเดินกลับไปเปิดหน้าแอดมินก่อน เขาจะไม่เปิดเลย แล้วก็จะเดาเอาแทน
 *
 * ทุกตัวเลขในหน้านี้ตอบคำถามที่ถูกถามจริงในที่ประชุมเช้า
 *   ทันเวลากี่เปอร์เซ็นต์ · แย่ลงหรือดีขึ้นจากช่วงก่อน
 *   เสียเวลาไปกับประเภทรถไหน · สถานีไหนเป็นต้นเหตุ
 *   ของที่ลงไปเป็นงานส่งตรงกี่ชิ้น ที่เหลือกี่ชิ้น
 *
 * ตัวที่ไม่ได้ตอบคำถามไหนเลย ไม่ได้ถูกใส่ลงมา ถึงจะวาดสวยก็ตาม
 */

const p2 = (n: number) => String(n).padStart(2, '0')

const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}`
}

const dayShort = (iso: string) => {
  const [, m, d] = iso.split('-')
  return `${Number(d)}/${Number(m)}`
}

const pctNum = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0)

export default function WaitStats() {
  const nav = useNavigate()
  const [tab, setTab] = useState<'one' | 'two'>('one')

  return (
    <div className="min-h-dvh px-4 pb-16 pt-4 text-white" style={{ background: BG }}>
      <div className="mx-auto w-full max-w-[1400px] space-y-4">
        {/* แถบหัว · ชื่อจออยู่บรรทัดของตัวเอง เหมือนจอทีวี */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-4"
          style={{
            background: 'linear-gradient(90deg,#15306B 0%,#101A33 60%,#0B0F16 100%)',
            border: `1px solid ${LINE}`,
          }}
        >
          <WaitLogo size={28} title="แดชบอร์ดรถรอลงงาน" />
          <div className="flex flex-wrap gap-2">
            <NavBtn onClick={() => nav('/wait')}>← กระดาน</NavBtn>
            <NavBtn onClick={() => nav('/wait/history')}>ประวัติ</NavBtn>
            <NavBtn onClick={() => nav('/wait/tv')}>จอทีวี</NavBtn>
          </div>
        </div>

        <div className="flex gap-2">
          <TabBtn on={tab === 'one'} onClick={() => setTab('one')}>สรุปช่วงเดียว</TabBtn>
          <TabBtn on={tab === 'two'} onClick={() => setTab('two')}>เทียบสองช่วง</TabBtn>
        </div>

        {tab === 'one' ? <OneRange /> : <TwoRanges />}
      </div>
    </div>
  )
}

function NavBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-11 rounded-xl px-4 text-[13px] font-bold"
      style={{ background: '#16202F', border: `1px solid ${LINE}`, color: '#EAF0F7' }}
    >
      {children}
    </button>
  )
}

function TabBtn({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="h-11 rounded-xl px-5 text-[14px] font-extrabold"
      style={
        on
          ? { background: '#EAF0F7', color: '#101316' }
          : { background: CARD, border: `1px solid ${LINE}`, color: '#AFC0D4' }
      }
    >
      {children}
    </button>
  )
}

/** ปฏิทินของแอพเป็นธีมสว่าง · ครอบไว้ในกล่องสว่างจะได้ไม่ใช่ตัวขาวบนขาว */
function RangeBox({
  label,
  from,
  to,
  onChange,
  tone,
}: {
  label: string
  from: string
  to: string
  onChange: (a: string, b: string) => void
  tone?: string
}) {
  return (
    <span className="flex items-center gap-2 rounded-xl bg-white px-3 py-2">
      <span className="text-[12px] font-extrabold" style={{ color: tone ?? '#4B5563' }}>
        {label}
      </span>
      <DateRangePicker from={from} to={to} onChange={onChange} />
    </span>
  )
}

/* ------------------------------------------------------------ ช่วงเดียว */

function OneRange() {
  const [from, setFrom] = useState(() => addDays(todayKey(), -6))
  const [to, setTo] = useState(todayKey)
  const q = useAsync(() => waitTruckStats(from, to), [from, to])
  const s = q.data

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px]" style={{ color: DIM }}>
          นับเฉพาะคันที่กดลงงานเสร็จแล้ว · คันที่ยังค้างยังไม่มีผลแพ้ชนะ · แบ่งวันตามเวลาไทย
        </p>
        <RangeBox label="ช่วงวันที่" from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b) }} />
      </div>

      {q.loading && <Empty text="กำลังโหลด…" />}
      {q.error && <Empty text={q.error} />}
      {!q.loading && !q.error && !s && <Empty text="บัญชีนี้ยังไม่มีสิทธิ์ดูรถรอลงงาน" />}

      {s && <OneBody s={s} />}
    </>
  )
}

function OneBody({ s }: { s: Stats }) {
  const ok = pctNum(s.on_time, s.total)
  const avgPcs = s.total > 0 ? Math.round(s.parcels / s.total) : 0
  const doN = s.parcels_do ?? 0
  const ndN = s.parcels_nondo ?? 0
  const knownParcels = doN + ndN

  const days = useMemo(
    () =>
      s.by_day.map((d) => ({
        label: dayShort(d.day),
        a: d.on_time,
        b: Math.max(0, d.total - d.on_time),
        note: `${d.day} · ทัน ${d.on_time} จาก ${d.total} คัน`,
      })),
    [s.by_day],
  )

  return (
    <div className="space-y-4">
      {/* ① แถวตัวเลขหลัก */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi
          icon="🎯"
          label="ลงงานทันเวลา"
          value={s.total > 0 ? ok + '%' : '—'}
          tone={s.total === 0 ? DIM : ok >= 90 ? OK : ok >= 70 ? '#E8B931' : BAD}
          foot={`${s.on_time} จาก ${s.total} คัน`}
        />
        <Kpi icon="🚚" label="รถที่ลงงานเสร็จ" value={nf(s.total)} tone={BLUE}
             foot={s.cancelled > 0 ? `ยกเลิกอีก ${s.cancelled} คัน` : 'ไม่มีคันที่ถูกยกเลิก'} />
        <Kpi icon="⏱" label="รอเฉลี่ยต่อคัน" value={`${nf(s.avg_wait)} น.`} tone="#38BDF8"
             foot={`นานสุดเกินเกณฑ์ ${nf(s.worst)} นาที`} />
        <Kpi icon="⚠" label="ลงไม่ทันเกณฑ์" value={nf(s.total - s.on_time)} tone={BAD}
             foot={s.total > 0 ? `${100 - ok}% ของที่ลงไปแล้ว` : '—'} />
        <Kpi icon="📦" label="พัสดุที่ลงไปแล้ว" value={nf(s.parcels)} tone="#FBBF24"
             foot={`เฉลี่ย ${nf(avgPcs)} ชิ้นต่อคัน`} />
        <Kpi icon="🎁" label="งานส่งตรง DO" value={s.parcels_do == null ? '—' : nf(doN)} tone={DO_C}
             foot={knownParcels > 0 ? `${pctNum(doN, knownParcels)}% ของที่ลงไปแล้ว` : 'ไฟล์ยังไม่ได้บอก DO'} />
      </div>

      {/* ② แนวโน้มรายวัน กับ สัดส่วน */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel
          title="ลงงานทันเวลารายวัน"
          right={<span className="text-[12px] font-bold" style={{ color: DIM }}>เส้นยิ่งสูงยิ่งดี · แกนตรึง 0–100%</span>}
        >
          <LinePct
            labels={s.by_day.map((d) => dayShort(d.day))}
            series={[
              {
                name: 'ทันเวลา (%)',
                color: OK,
                points: s.by_day.map((d) => pctNum(d.on_time, d.total)),
              },
            ]}
          />
        </Panel>

        <Panel title="ทันเวลา เทียบกับ ไม่ทัน">
          <Donut
            center={s.total > 0 ? ok + '%' : '—'}
            centerSub="ทันเวลา"
            parts={[
              { label: 'ทันเวลา', value: s.on_time, color: OK },
              { label: 'ไม่ทันเกณฑ์', value: Math.max(0, s.total - s.on_time), color: BAD },
            ]}
          />
        </Panel>
      </div>

      {/* ③ รายวัน กับ สัดส่วนงาน DO */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="รถเข้าแต่ละวัน แยกทันเวลากับไม่ทัน">
          <StackBars rows={days} />
        </Panel>

        <Panel title="พัสดุที่ลงไปแล้ว แยกงานส่งตรง">
          {knownParcels === 0 ? (
            <Empty text="ไฟล์ที่นำเข้าในช่วงนี้ยังไม่ได้บอกงาน DO" />
          ) : (
            <Donut
              center={nf(knownParcels)}
              centerSub="ชิ้น"
              parts={[
                { label: 'งานส่งตรง DO', value: doN, color: DO_C },
                { label: 'ไม่ใช่งาน DO', value: ndN, color: NONDO_C },
              ]}
            />
          )}
        </Panel>
      </div>

      {/* ④ ประเภทรถ กับ สถานีต้นทาง */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="ลงงานทันเวลา แยกตามประเภทรถ"
          right={<span className="text-[12px] font-bold" style={{ color: DIM }}>แท่งยาว = ทันเยอะ</span>}
        >
          <HBars
            unit="%"
            max={100}
            rows={s.by_type.map((t) => ({
              label: `${t.vehicle_type} · ${t.total} คัน`,
              value: pctNum(t.on_time, t.total),
              sub: `รอเฉลี่ย ${t.avg_wait} น.`,
              color: pctNum(t.on_time, t.total) >= 90 ? OK : pctNum(t.on_time, t.total) >= 70 ? '#E8B931' : BAD,
            }))}
          />
        </Panel>

        <Panel
          title="สถานีต้นทางที่เสียเวลามากที่สุด"
          right={<span className="text-[12px] font-bold" style={{ color: DIM }}>เรียงตามเวลารอเฉลี่ย</span>}
        >
          <HBars
            unit="น."
            rows={[...s.by_station]
              .sort((a, b) => b.avg_wait - a.avg_wait)
              .slice(0, 8)
              .map((x) => ({
                label: x.from_station,
                value: x.avg_wait,
                sub: `${x.total} คัน · ทัน ${pctNum(x.on_time, x.total)}%`,
                color: BLUE,
              }))}
          />
        </Panel>
      </div>

      {/* ⑤ ตารางเต็มของประเภทรถ */}
      <Panel title="ตารางสรุปตามประเภทรถ">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[14px]">
            <thead>
              <tr style={{ color: DIM }}>
                {['ประเภทรถ', 'คัน', 'ทันเวลา', 'ไม่ทัน', 'ทันเวลา %', 'รอเฉลี่ย', 'เกินนานสุด', 'พัสดุ', 'งาน DO', 'ไม่ใช่ DO'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.by_type.map((t) => {
                const p = pctNum(t.on_time, t.total)
                return (
                  <tr key={t.vehicle_type} className="border-t" style={{ borderColor: LINE }}>
                    <td className="whitespace-nowrap px-3 py-2 font-extrabold">{t.vehicle_type}</td>
                    <td className="px-3 py-2 font-bold">{nf(t.total)}</td>
                    <td className="px-3 py-2 font-bold" style={{ color: OK }}>{nf(t.on_time)}</td>
                    <td className="px-3 py-2 font-bold" style={{ color: BAD }}>{nf(t.total - t.on_time)}</td>
                    <td className="px-3 py-2 font-extrabold"
                        style={{ color: p >= 90 ? OK : p >= 70 ? '#E8B931' : BAD }}>{p}%</td>
                    <td className="px-3 py-2">{nf(t.avg_wait)} น.</td>
                    <td className="px-3 py-2">{nf(t.worst)} น.</td>
                    <td className="px-3 py-2 font-bold" style={{ color: '#FFD479' }}>{nf(t.parcels)}</td>
                    <td className="px-3 py-2 font-bold" style={{ color: DO_C }}>{nf(t.parcels_do)}</td>
                    <td className="px-3 py-2 font-bold" style={{ color: NONDO_C }}>{nf(t.parcels_nondo)}</td>
                  </tr>
                )
              })}
              {s.by_type.length === 0 && (
                <tr><td colSpan={10}><Empty /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------ สองช่วง */

/**
 * เทียบสองช่วงวัน
 *
 * ฐานข้อมูลเรียกตัวนับเดียวกันสองครั้ง ไม่ได้เขียนตรรกะนับใหม่
 * ตัวเลขช่วง ก กับช่วง ข จึงมาจากนิยามเดียวกันเสมอ
 *
 * เส้นแนวโน้มวางซ้อนกันโดยนับเป็น "วันที่เท่าไหร่ของช่วง" ไม่ใช่วันที่จริง
 * เพราะสองช่วงอาจยาวไม่เท่ากันและไม่ได้อยู่ติดกัน การวางตามวันที่จริงจะอ่านไม่ได้เลย
 */
function TwoRanges() {
  const [aFrom, setAFrom] = useState(() => addDays(todayKey(), -6))
  const [aTo, setATo] = useState(todayKey)
  const [bFrom, setBFrom] = useState(() => addDays(todayKey(), -13))
  const [bTo, setBTo] = useState(() => addDays(todayKey(), -7))

  const q = useAsync(
    () => waitTruckCompare([aFrom, aTo], [bFrom, bTo]),
    [aFrom, aTo, bFrom, bTo],
  )

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <RangeBox label="ช่วง ก" tone="#1D4ED8" from={aFrom} to={aTo}
                  onChange={(x, y) => { setAFrom(x); setATo(y) }} />
        <RangeBox label="ช่วง ข" tone="#7C3AED" from={bFrom} to={bTo}
                  onChange={(x, y) => { setBFrom(x); setBTo(y) }} />
        <span className="text-[13px]" style={{ color: DIM }}>
          ป้ายส่วนต่างคิดจาก ช่วง ก ลบ ช่วง ข · เขียวคือดีขึ้น แดงคือแย่ลง
        </span>
      </div>

      {q.loading && <Empty text="กำลังโหลด…" />}
      {q.error && <Empty text={q.error} />}
      {q.data && <TwoBody a={q.data.a} b={q.data.b} />}
    </>
  )
}

function TwoBody({ a, b }: { a: Stats; b: Stats }) {
  const okA = pctNum(a.on_time, a.total)
  const okB = pctNum(b.on_time, b.total)
  const lateA = a.total - a.on_time
  const lateB = b.total - b.on_time

  const rows: {
    k: string
    a: number
    b: number
    unit: string
    low?: boolean
  }[] = [
    { k: 'ลงงานทันเวลา', a: okA, b: okB, unit: '%' },
    { k: 'รถที่ลงงานเสร็จ', a: a.total, b: b.total, unit: 'คัน' },
    { k: 'ลงไม่ทันเกณฑ์', a: lateA, b: lateB, unit: 'คัน', low: true },
    { k: 'รอเฉลี่ยต่อคัน', a: a.avg_wait, b: b.avg_wait, unit: 'นาที', low: true },
    { k: 'เกินเกณฑ์นานสุด', a: a.worst, b: b.worst, unit: 'นาที', low: true },
    { k: 'พัสดุที่ลงไปแล้ว', a: a.parcels, b: b.parcels, unit: 'ชิ้น' },
    { k: 'งานส่งตรง DO', a: a.parcels_do ?? 0, b: b.parcels_do ?? 0, unit: 'ชิ้น' },
    { k: 'ไม่ใช่งาน DO', a: a.parcels_nondo ?? 0, b: b.parcels_nondo ?? 0, unit: 'ชิ้น' },
    { k: 'ถูกยกเลิก', a: a.cancelled, b: b.cancelled, unit: 'คัน', low: true },
  ]

  const span = Math.max(a.by_day.length, b.by_day.length)
  const labels = Array.from({ length: span }, (_, i) => `วันที่ ${i + 1}`)

  // ประเภทรถที่โผล่ในช่วงใดช่วงหนึ่ง · เทียบเป็นคู่
  const types = useMemo(() => {
    const keys = new Set([...a.by_type, ...b.by_type].map((t) => t.vehicle_type))
    return [...keys].map((k) => {
      const ta = a.by_type.find((t) => t.vehicle_type === k)
      const tb = b.by_type.find((t) => t.vehicle_type === k)
      return {
        k,
        aPct: ta ? pctNum(ta.on_time, ta.total) : 0,
        bPct: tb ? pctNum(tb.on_time, tb.total) : 0,
        aN: ta?.total ?? 0,
        bN: tb?.total ?? 0,
      }
    }).sort((x, y) => y.aN + y.bN - (x.aN + x.bN))
  }, [a.by_type, b.by_type])

  return (
    <div className="space-y-4">
      {/* ① สี่ตัวเลขที่ถูกถามบ่อยที่สุด · ใหญ่คือช่วง ก เล็กคือช่วง ข */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CmpCard icon="🎯" label="ลงงานทันเวลา" a={okA} b={okB} unit="%" tone={okA >= okB ? OK : BAD} />
        <CmpCard icon="⚠" label="ลงไม่ทันเกณฑ์" a={lateA} b={lateB} unit="คัน" low tone={lateA <= lateB ? OK : BAD} />
        <CmpCard icon="⏱" label="รอเฉลี่ยต่อคัน" a={a.avg_wait} b={b.avg_wait} unit="นาที" low tone={a.avg_wait <= b.avg_wait ? OK : BAD} />
        <CmpCard icon="📦" label="พัสดุที่ลงไปแล้ว" a={a.parcels} b={b.parcels} unit="ชิ้น" tone={BLUE} />
      </div>

      {/* ② เส้นสองเส้นวางซ้อนกัน */}
      <Panel
        title="ลงงานทันเวลารายวัน · วางซ้อนสองช่วง"
        right={
          <span className="text-[12px] font-bold" style={{ color: DIM }}>
            นับเป็นวันที่เท่าไหร่ของช่วง เพราะสองช่วงยาวไม่เท่ากันได้
          </span>
        }
      >
        <LinePct
          labels={labels}
          series={[
            {
              name: `ช่วง ก · ${a.from} ถึง ${a.to}`,
              color: '#3B82F6',
              points: Array.from({ length: span }, (_, i) =>
                a.by_day[i] ? pctNum(a.by_day[i].on_time, a.by_day[i].total) : null,
              ),
            },
            {
              name: `ช่วง ข · ${b.from} ถึง ${b.to}`,
              color: '#A78BFA',
              points: Array.from({ length: span }, (_, i) =>
                b.by_day[i] ? pctNum(b.by_day[i].on_time, b.by_day[i].total) : null,
              ),
            },
          ]}
        />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* ③ ตารางส่วนต่างทุกตัวเลข */}
        <Panel title="ส่วนต่างทุกตัวเลข">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-[14px]">
              <thead>
                <tr style={{ color: DIM }}>
                  <th className="px-3 py-2 text-left font-bold">ตัวเลข</th>
                  <th className="px-3 py-2 text-right font-bold" style={{ color: '#7FA8FF' }}>ช่วง ก</th>
                  <th className="px-3 py-2 text-right font-bold" style={{ color: '#C4A2FF' }}>ช่วง ข</th>
                  <th className="px-3 py-2 text-right font-bold">ต่างกัน</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.k} className="border-t" style={{ borderColor: LINE }}>
                    <td className="px-3 py-2">{r.k}</td>
                    <td className="px-3 py-2 text-right font-extrabold">{nf(r.a)} {r.unit}</td>
                    <td className="px-3 py-2 text-right font-bold" style={{ color: DIM }}>{nf(r.b)} {r.unit}</td>
                    <td className="px-3 py-2 text-right">
                      <Delta diff={r.a - r.b} unit={r.unit} lowerIsBetter={r.low} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* ④ ประเภทรถเทียบคู่ */}
        <Panel title="ทันเวลาแยกตามประเภทรถ · เทียบคู่">
          {types.length === 0 ? (
            <Empty />
          ) : (
            <div className="space-y-3">
              {types.map((t) => (
                <div key={t.k}>
                  <div className="mb-1 flex items-baseline justify-between text-[13px]">
                    <span className="font-extrabold">{t.k}</span>
                    <span style={{ color: DIM }}>
                      ก {t.aN} คัน · ข {t.bN} คัน
                    </span>
                    <Delta diff={t.aPct - t.bPct} unit="%" />
                  </div>
                  <TwinBar a={t.aPct} b={t.bPct} />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

function CmpCard({
  icon,
  label,
  a,
  b,
  unit,
  low,
  tone,
}: {
  icon: string
  label: string
  a: number
  b: number
  unit: string
  low?: boolean
  tone: string
}) {
  return (
    <div className="rounded-2xl px-4 py-3" style={{ background: CARD, border: `1px solid ${LINE}` }}>
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
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[34px] font-extrabold leading-none" style={{ color: tone }}>
          {nf(a)}
        </span>
        <span className="text-[13px] font-bold" style={{ color: DIM }}>{unit}</span>
        <span className="ml-auto">
          <Delta diff={a - b} unit={unit} lowerIsBetter={low} />
        </span>
      </div>
      <div className="mt-2 text-[12px] font-bold" style={{ color: DIM }}>
        ช่วง ข อยู่ที่ {nf(b)} {unit}
      </div>
    </div>
  )
}

/** สองแท่งซ้อนบนล่าง · ช่วง ก อยู่บน ช่วง ข อยู่ล่าง เทียบความยาวได้ทันที */
function TwinBar({ a, b }: { a: number; b: number }) {
  return (
    <div className="space-y-1">
      {[
        { v: a, c: '#3B82F6', t: 'ก' },
        { v: b, c: '#A78BFA', t: 'ข' },
      ].map((x) => (
        <div key={x.t} className="flex items-center gap-2">
          <span className="w-4 shrink-0 text-[11px] font-bold" style={{ color: DIM }}>{x.t}</span>
          <div className="h-4 min-w-0 flex-1 overflow-hidden rounded" style={{ background: '#161B22' }}>
            <div className="h-full rounded" style={{ width: `${Math.max(2, x.v)}%`, background: x.c }} />
          </div>
          <span className="w-10 shrink-0 text-right text-[12px] font-extrabold">{x.v}%</span>
        </div>
      ))}
    </div>
  )
}
