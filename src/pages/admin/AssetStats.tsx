import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { assetStats } from '../../lib/api'
import { deptName, positionName } from '../../lib/deptNames'
import { DateRangePicker } from '../../components/DateRangePicker'
import { ErrorBox, Loading } from '../../components/ui'
import type { AssetStats as Stats } from '../../lib/types'

/**
 * สถิติการเบิก-คืนเครื่อง
 *
 * คิดทั้งหมดที่ฐานข้อมูลแล้วส่งมาเป็นก้อนเดียว ฝั่งหน้าจอแค่วาด
 * ถ้าดึงแถวดิบ 2,018 ครั้งมานับในเบราว์เซอร์ จะเปลืองเน็ตสิบเท่า
 * และมือถือหน้างานที่เปิดหน้านี้จะค้างทุกครั้งที่เลือกช่วงกว้าง
 *
 * ตัวเลขที่เลือกมาโชว์ ตอบคำถามที่เจ้าของระบบถามจริง ๆ ไม่ใช่ตัวเลขที่ทำง่าย
 *   ใครเบิกบ่อยสุด · ใครคืนช้าบ่อยสุด · แผนกไหนหนัก · เครื่องไหนถูกใช้หนัก
 *   คืนช้ากันกี่โมง · และเครื่องไหนไม่มีใครแตะเลย ซึ่งคือเงินที่จมอยู่เฉย ๆ
 */

const nf = (n: number) => n.toLocaleString('th-TH')

/** นาที → อ่านออก · ชั่วโมงกับนาที ไม่ใช่เลข 437 ที่ไม่มีใครแปลในหัวได้ */
function mins(n: number | null | undefined): string {
  if (!n) return '—'
  const h = Math.floor(n / 60)
  const m = n % 60
  return h > 0 ? `${h} ชม. ${m} น.` : `${m} นาที`
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

function todayISO(back = 0): string {
  const d = new Date(Date.now() - back * 86400000)
  const th = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${th.getFullYear()}-${p(th.getMonth() + 1)}-${p(th.getDate())}`
}

export function AssetStats() {
  const [from, setFrom] = useState(() => todayISO(29))
  const [to, setTo] = useState(() => todayISO(0))
  const s = useAsync(() => assetStats(from, to), [from, to])
  const [tab, setTab] = useState<'people' | 'depts' | 'assets' | 'time' | 'idle'>('people')

  const d = s.data
  const t = d?.total

  return (
    <div>
      <div className="mb-3">
        <DateRangePicker
          from={from}
          to={to}
          onChange={(a, b) => {
            setFrom(a)
            setTo(b)
          }}
        />
      </div>

      {s.loading && <Loading />}
      {s.error && <ErrorBox message={s.error} onRetry={s.reload} />}

      {d && t && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi n={nf(t.outs)} label="ครั้งที่เบิก" />
            <Kpi n={nf(t.people)} label="คนที่เบิก" />
            <Kpi n={nf(t.assets)} label="เครื่องที่ถูกใช้" />
            <Kpi n={pct(t.on_time, t.returned) + '%'} label="คืนตรงเวลา" tone="ok" />
            <Kpi n={nf(t.late)} label="คืนช้า" tone={t.late > 0 ? 'bad' : undefined} />
            <Kpi n={nf(t.open)} label="ยังไม่คืน" tone={t.open > 0 ? 'warn' : undefined} />
          </div>

          <p className="mb-3 text-sm text-ink-500">
            ถือเฉลี่ย {mins(t.avg_hold)} · ถือนานสุด {mins(t.max_hold)} · ช้าที่สุด{' '}
            {mins(t.max_late)}
          </p>

          <div className="mb-3 flex flex-wrap gap-2">
            {(
              [
                ['people', 'รายคน'],
                ['depts', 'รายแผนก'],
                ['assets', 'รายเครื่อง'],
                ['time', 'ตามเวลา'],
                ['idle', `ไม่มีใครแตะ (${d.idle.length})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`chip ${tab === k ? 'chip-on' : ''}`}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'people' && <PeopleTable rows={d.people} />}
          {tab === 'depts' && <DeptTable rows={d.depts} />}
          {tab === 'assets' && <AssetTable rows={d.assets} types={d.types} />}
          {tab === 'time' && <TimeView hours={d.by_hour} days={d.by_day} />}
          {tab === 'idle' && <IdleTable rows={d.idle} />}
        </>
      )}
    </div>
  )
}

function Kpi({ n, label, tone }: { n: string; label: string; tone?: 'ok' | 'bad' | 'warn' }) {
  const cls =
    tone === 'ok'
      ? 'bg-success-bg text-success-txt'
      : tone === 'bad'
        ? 'bg-danger-bg text-danger-txt'
        : tone === 'warn'
          ? 'bg-warn-bg text-warn-txt'
          : 'bg-surface-2 text-ink-700'
  return (
    <div className={`rounded-card px-3 py-2 ${cls}`}>
      <p className="font-display text-xl font-bold leading-none">{n}</p>
      <p className="mt-1 text-xs font-bold opacity-80">{label}</p>
    </div>
  )
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-surface-2 text-ink-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

/** แถบสัดส่วนในช่อง · เห็นความต่างได้โดยไม่ต้องอ่านตัวเลขทุกแถว */
function Bar({ n, max, tone = '#3B82F6' }: { n: number; max: number; tone?: string }) {
  const w = max > 0 ? Math.max(2, Math.round((n / max) * 100)) : 0
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-16 shrink-0 rounded-full bg-ink/10">
        <span className="block h-2 rounded-full" style={{ width: w + '%', background: tone }} />
      </span>
      <b>{nf(n)}</b>
    </span>
  )
}

function PeopleTable({ rows }: { rows: Stats['people'] }) {
  const max = Math.max(1, ...rows.map((r) => r.outs))
  if (rows.length === 0) return <Empty />
  return (
    <Table head={['คน', 'แผนก · ตำแหน่ง', 'เบิก', 'เครื่อง', 'คืนช้า', '% ช้า', 'ช้าสุด', 'ถือเฉลี่ย']}>
      {rows.map((r) => (
        <tr key={r.code} className="border-t border-line-2">
          <td className="px-3 py-2">
            {r.name}
            <span className="block font-mono text-xs text-ink-400">{r.code}</span>
          </td>
          <td className="px-3 py-2 text-xs text-ink-500">
            {deptName(r.dept, '—')}
            {r.pos ? ' · ' + positionName(r.pos) : ''}
          </td>
          <td className="px-3 py-2">
            <Bar n={r.outs} max={max} />
          </td>
          <td className="px-3 py-2">{nf(r.assets)}</td>
          <td className="px-3 py-2">{r.late > 0 ? <b className="text-danger-txt">{nf(r.late)}</b> : '—'}</td>
          <td className="px-3 py-2">{r.outs > 0 ? pct(r.late, r.outs) + '%' : '—'}</td>
          <td className="px-3 py-2 text-xs">{mins(r.worst)}</td>
          <td className="px-3 py-2 text-xs">{mins(r.avg_hold)}</td>
        </tr>
      ))}
    </Table>
  )
}

function DeptTable({ rows }: { rows: Stats['depts'] }) {
  const max = Math.max(1, ...rows.map((r) => r.outs))
  if (rows.length === 0) return <Empty />
  return (
    <Table head={['แผนก', 'คน', 'เบิก', 'คืนช้า', '% ช้า', 'ถือเฉลี่ย']}>
      {rows.map((r) => (
        <tr key={r.dept ?? 'none'} className="border-t border-line-2">
          <td className="px-3 py-2">{deptName(r.dept, 'ไม่ระบุ')}</td>
          <td className="px-3 py-2">{nf(r.people)}</td>
          <td className="px-3 py-2">
            <Bar n={r.outs} max={max} />
          </td>
          <td className="px-3 py-2">{r.late > 0 ? <b className="text-danger-txt">{nf(r.late)}</b> : '—'}</td>
          <td className="px-3 py-2">{pct(r.late, r.outs)}%</td>
          <td className="px-3 py-2 text-xs">{mins(r.avg_hold)}</td>
        </tr>
      ))}
    </Table>
  )
}

function AssetTable({ rows, types }: { rows: Stats['assets']; types: Stats['types'] }) {
  const max = Math.max(1, ...rows.map((r) => r.outs))
  const tmax = Math.max(1, ...types.map((r) => r.outs))
  if (rows.length === 0) return <Empty />
  return (
    <>
      <p className="label">ตามประเภท</p>
      <div className="mb-4">
        <Table head={['ประเภท', 'เบิก', 'คืนช้า', '% ช้า']}>
          {types.map((r) => (
            <tr key={r.type} className="border-t border-line-2">
              <td className="px-3 py-2">{r.type}</td>
              <td className="px-3 py-2">
                <Bar n={r.outs} max={tmax} />
              </td>
              <td className="px-3 py-2">{r.late > 0 ? <b className="text-danger-txt">{nf(r.late)}</b> : '—'}</td>
              <td className="px-3 py-2">{pct(r.late, r.outs)}%</td>
            </tr>
          ))}
        </Table>
      </div>

      <p className="label">รายเครื่อง · เรียงตามที่ถูกเบิกบ่อยสุด</p>
      <Table head={['เครื่อง', 'ประเภท', 'เบิก', 'คืนช้า', 'ถือเฉลี่ย']}>
        {rows.map((r) => (
          <tr key={r.code} className="border-t border-line-2">
            <td className="px-3 py-2 font-mono">{r.code}</td>
            <td className="px-3 py-2 text-xs text-ink-500">{r.type}</td>
            <td className="px-3 py-2">
              <Bar n={r.outs} max={max} />
            </td>
            <td className="px-3 py-2">{r.late > 0 ? <b className="text-danger-txt">{nf(r.late)}</b> : '—'}</td>
            <td className="px-3 py-2 text-xs">{mins(r.avg_hold)}</td>
          </tr>
        ))}
      </Table>
    </>
  )
}

function TimeView({ hours, days }: { hours: Stats['by_hour']; days: Stats['by_day'] }) {
  const byHour = useMemo(() => {
    const m = new Map(hours.map((h) => [h.h, h]))
    return Array.from({ length: 24 }, (_, h) => m.get(h) ?? { h, outs: 0, late: 0 })
  }, [hours])
  const max = Math.max(1, ...byHour.map((h) => h.outs))
  const dmax = Math.max(1, ...days.map((d) => d.outs))

  return (
    <>
      <p className="label">เบิกกันกี่โมง · แถบแดงคือครั้งที่จบด้วยการคืนช้า</p>
      <div className="mb-4 overflow-x-auto rounded-card border border-line p-3">
        <div className="flex min-w-[600px] items-end gap-1" style={{ height: 150 }}>
          {byHour.map((h) => (
            <div key={h.h} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full flex-1 items-end">
                <div className="flex w-full flex-col justify-end" style={{ height: '100%' }}>
                  {h.late > 0 && (
                    <div
                      style={{
                        height: `${(h.late / max) * 100}%`,
                        background: '#EF4444',
                      }}
                    />
                  )}
                  <div
                    style={{
                      height: `${((h.outs - h.late) / max) * 100}%`,
                      background: '#3B82F6',
                    }}
                  />
                </div>
              </div>
              <span className="text-[10px] text-ink-400">{h.h}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="label">รายวัน</p>
      <Table head={['วันที่', 'เบิก', 'คืนช้า']}>
        {days.map((r) => (
          <tr key={r.d} className="border-t border-line-2">
            <td className="px-3 py-2">{r.d}</td>
            <td className="px-3 py-2">
              <Bar n={r.outs} max={dmax} />
            </td>
            <td className="px-3 py-2">{r.late > 0 ? <b className="text-danger-txt">{nf(r.late)}</b> : '—'}</td>
          </tr>
        ))}
      </Table>
    </>
  )
}

function IdleTable({ rows }: { rows: Stats['idle'] }) {
  if (rows.length === 0)
    return (
      <p className="rounded-card bg-success-bg px-3 py-3 text-sm text-success-txt">
        ช่วงนี้ทุกเครื่องถูกใช้งานอย่างน้อยหนึ่งครั้ง
      </p>
    )
  return (
    <>
      <p className="mb-2 text-sm text-ink-500">
        เครื่องที่เปิดใช้งานอยู่แต่ไม่มีใครเบิกเลยในช่วงที่เลือก · ของที่ซื้อมาแล้วไม่ได้ใช้
        คือเงินที่จมอยู่เฉย ๆ และเป็นเครื่องที่หายไปโดยไม่มีใครรู้ตัวได้ง่ายที่สุด
      </p>
      <Table head={['เครื่อง', 'ประเภท', 'แผนก']}>
        {rows.map((r) => (
          <tr key={r.code} className="border-t border-line-2">
            <td className="px-3 py-2 font-mono">{r.code}</td>
            <td className="px-3 py-2 text-xs text-ink-500">{r.type}</td>
            <td className="px-3 py-2 text-xs text-ink-500">{deptName(r.dept, 'ส่วนกลาง')}</td>
          </tr>
        ))}
      </Table>
    </>
  )
}

function Empty() {
  return (
    <p className="rounded-card bg-surface-2 px-3 py-3 text-sm text-ink-500">
      ช่วงนี้ยังไม่มีการเบิก
    </p>
  )
}
