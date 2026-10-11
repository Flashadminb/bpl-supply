import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { breakStats, BREAK_CLOSE_REASONS } from '../../lib/breakPass'
import { ErrorBox, Loading } from '../../components/ui'
import type { BreakStats as Stats } from '../../lib/breakPass'

/**
 * สถิติบัตรเบรค
 *
 * แยกเวลาออกเป็นสามช่วงเสมอ เพราะสามช่วงนี้คนละคนรับผิดชอบ
 *   รอปล่อย   ยื่นบัตร → ออกประตู   · ช้าที่นี่คือคนปล่อยหรือประตู ไม่ใช่คนเบรค
 *   ข้างนอก   ออกประตู → กลับ       · อันนี้คือเวลาเบรคจริง เทียบข้ามแผนกได้
 *   เกินเวลา  กลับช้ากว่ากำหนดกี่นาที
 * ของเดิมรวมเป็นก้อนเดียว แล้วคนที่รอปล่อยนานสิบนาทีจะดูเหมือนเบรคนาน
 *
 * มีปุ่มผ่อนผัน เพราะตัวเลขดิบจะนับคนที่เกินสามสิบวินาทีรวมกับคนที่เกินยี่สิบนาที
 * แล้วรายชื่อจะยาวจนชี้ตัวคนที่มีปัญหาจริงไม่ได้ · ปรับแล้วเห็นผลทันที
 */

const nf = (n: number) => n.toLocaleString('th-TH')
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

function mins(n: number | null | undefined): string {
  if (!n) return '—'
  const h = Math.floor(n / 60)
  const m = n % 60
  return h > 0 ? `${h} ชม. ${m} น.` : `${m} นาที`
}

/**
 * ตัวเลือกผ่อนผัน · ถี่ช่วงต้น ห่างช่วงปลาย
 * เส้นที่ยุติธรรมมักอยู่ไม่เกินสิบนาที ส่วนค่าเกินครึ่งชั่วโมงมีไว้ดูว่า
 * ถ้าตัดคนที่ลืมสแกนกลับออกไปแล้ว เหลือคนที่เกินจริงกี่คน
 */
const GRACE_CHOICES = [0, 1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 45, 60, 120]

const REASON_TH: Record<string, string> = {
  ...Object.fromEntries(BREAK_CLOSE_REASONS.map((r) => [r.code, r.label])),
  ไม่ระบุ: 'ปิดก่อนมีระบบเหตุผล',
}

export function BreakStats({ from, to }: { from: string; to: string }) {
  const [grace, setGrace] = useState(0)
  const s = useAsync(() => breakStats(from, to, grace), [from, to, grace])
  const [tab, setTab] = useState<'cards' | 'groups' | 'issuers' | 'reasons' | 'time'>('cards')

  const d = s.data
  const t = d?.total

  return (
    <div>
      {/*
        ดรอปดาวน์แทนชิปสี่อัน · ค่าที่ต้องลองจริงมีมากกว่าสี่ค่า
        และสี่ค่าที่เลือกไว้ให้ก่อนหน้านี้เป็นค่าที่ผมเดา ไม่ใช่ค่าที่หน้างานใช้จริง
        ให้เลือกเองละเอียดกว่า แล้วค่อยรู้ว่าเลขไหนคือเส้นที่ยุติธรรม
      */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-sm text-ink-500" htmlFor="grace">
          ผ่อนผันก่อนนับว่าเกินเวลา
        </label>
        <select
          id="grace"
          className="input w-auto"
          value={grace}
          onChange={(e) => setGrace(Number(e.target.value))}
        >
          {GRACE_CHOICES.map((g) => (
            <option key={g} value={g}>
              {g === 0 ? 'ไม่ผ่อนผัน' : g < 60 ? g + ' นาที' : g / 60 + ' ชั่วโมง'}
            </option>
          ))}
        </select>
        {grace > 0 && (
          <span className="text-xs text-ink-400">
            ใบที่เกินไม่ถึง {grace} นาที จะถูกนับว่ากลับตรงเวลา
          </span>
        )}
      </div>

      {s.loading && <Loading />}
      {s.error && <ErrorBox message={s.error} onRetry={s.reload} />}

      {d && t && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi n={nf(t.passes)} label="ใบทั้งหมด" />
            <Kpi n={nf(t.people)} label="คนที่ออกไป" />
            <Kpi n={pct(t.on_time, t.closed) + '%'} label="กลับตรงเวลา" tone="ok" />
            <Kpi n={nf(t.late)} label="เกินเวลา" tone={t.late > 0 ? 'bad' : undefined} />
            <Kpi n={nf(t.no_gate_out)} label="ไม่ได้สแกนขาออก" tone={t.no_gate_out > 0 ? 'warn' : undefined} />
            <Kpi n={nf(t.forced)} label="ปิดแทน" tone={t.forced > 0 ? 'warn' : undefined} />
          </div>

          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Band label="รอปล่อย" hint="ยื่นบัตร → ออกประตู" value={mins(t.avg_wait)} />
            <Band label="อยู่ข้างนอก" hint="ออกประตู → กลับ" value={mins(t.avg_out)} />
            <Band
              label="เกินเฉลี่ย"
              hint={`เฉพาะใบที่เกิน · นานสุด ${mins(t.max_over)}`}
              value={mins(t.avg_over)}
            />
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            {(
              [
                ['cards', 'รายบัตร'],
                ['groups', 'รายแผนก'],
                ['issuers', 'คนปล่อย'],
                ['reasons', 'ปิดแทนเพราะอะไร'],
                ['time', 'ตามเวลา'],
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

          {tab === 'cards' && <Cards rows={d.cards} />}
          {tab === 'groups' && <Groups rows={d.groups} />}
          {tab === 'issuers' && <Issuers rows={d.issuers} />}
          {tab === 'reasons' && <Reasons rows={d.reasons} forced={t.forced} />}
          {tab === 'time' && <TimeView hours={d.by_hour} days={d.by_day} />}
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

function Band({ label, hint, value }: { label: string; hint: string; value: string }) {
  return (
    <div className="rounded-card border border-line p-3">
      <p className="font-display text-base">{label}</p>
      <p className="text-xs text-ink-400">{hint}</p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
    </div>
  )
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full min-w-[560px] text-left text-sm">
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

function Bar({ n, max, tone = '#3B82F6' }: { n: number; max: number; tone?: string }) {
  const w = max > 0 ? Math.max(2, Math.round((n / max) * 100)) : 0
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-14 shrink-0 rounded-full bg-ink/10">
        <span className="block h-2 rounded-full" style={{ width: w + '%', background: tone }} />
      </span>
      <b>{nf(n)}</b>
    </span>
  )
}

function Cards({ rows }: { rows: Stats['cards'] }) {
  const max = Math.max(1, ...rows.map((r) => r.n))
  if (rows.length === 0) return <Empty />
  return (
    <>
      <p className="mb-2 text-sm text-ink-500">เรียงตามใบที่เกินเวลามากสุด</p>
      <Table head={['บัตร', 'แผนก', 'ใช้ไป', 'เกินเวลา', '% เกิน', 'อยู่ข้างนอกเฉลี่ย', 'เกินนานสุด']}>
        {rows.map((r) => (
          <tr key={r.card} className="border-t border-line-2">
            <td className="px-3 py-2 font-mono font-bold">{r.card}</td>
            <td className="px-3 py-2 text-xs text-ink-500">{r.grp}</td>
            <td className="px-3 py-2">
              <Bar n={r.n} max={max} />
            </td>
            <td className="px-3 py-2">
              {r.late > 0 ? <b className="text-danger-txt">{nf(r.late)}</b> : '—'}
            </td>
            <td className="px-3 py-2">{pct(r.late, r.n)}%</td>
            <td className="px-3 py-2 text-xs">{mins(r.avg_out)}</td>
            <td className="px-3 py-2 text-xs">{mins(r.worst)}</td>
          </tr>
        ))}
      </Table>
    </>
  )
}

function Groups({ rows }: { rows: Stats['groups'] }) {
  const max = Math.max(1, ...rows.map((r) => r.n))
  if (rows.length === 0) return <Empty />
  return (
    <>
      <p className="mb-2 text-sm text-ink-500">
        เทียบกันด้วย <b>% เกิน</b> ไม่ใช่จำนวนใบ · แผนกที่ออกเบรคเยอะย่อมมีใบเกินเยอะตามจำนวน
        ซึ่งไม่ได้แปลว่าแย่กว่า
      </p>
      <Table head={['แผนกบัตร', 'ใช้ไป', 'เกินเวลา', '% เกิน', 'รอปล่อยเฉลี่ย', 'อยู่ข้างนอกเฉลี่ย']}>
        {rows.map((r) => (
          <tr key={r.grp} className="border-t border-line-2">
            <td className="px-3 py-2 font-bold">{r.grp}</td>
            <td className="px-3 py-2">
              <Bar n={r.n} max={max} />
            </td>
            <td className="px-3 py-2">
              {r.late > 0 ? <b className="text-danger-txt">{nf(r.late)}</b> : '—'}
            </td>
            <td className="px-3 py-2">
              <b>{pct(r.late, r.n)}%</b>
            </td>
            <td className="px-3 py-2 text-xs">{mins(r.avg_wait)}</td>
            <td className="px-3 py-2 text-xs">{mins(r.avg_out)}</td>
          </tr>
        ))}
      </Table>
    </>
  )
}

function Issuers({ rows }: { rows: Stats['issuers'] }) {
  const max = Math.max(1, ...rows.map((r) => r.n))
  if (rows.length === 0) return <Empty />
  return (
    <>
      <p className="mb-2 text-sm text-ink-500">
        คนที่ยื่นบัตรให้ · ช่อง “รอปล่อยเฉลี่ย” สูงแปลว่าบัตรถูกยื่นแล้วแต่กว่าจะได้ออกประตูนาน
      </p>
      <Table head={['คนปล่อย', 'ปล่อยไป', 'เกินเวลา', 'ใบที่ต้องปิดแทน', 'รอปล่อยเฉลี่ย']}>
        {rows.map((r) => (
          <tr key={r.name} className="border-t border-line-2">
            <td className="px-3 py-2">{r.name}</td>
            <td className="px-3 py-2">
              <Bar n={r.n} max={max} />
            </td>
            <td className="px-3 py-2">
              {r.late > 0 ? <b className="text-danger-txt">{nf(r.late)}</b> : '—'}
            </td>
            <td className="px-3 py-2">{r.forced > 0 ? nf(r.forced) : '—'}</td>
            <td className="px-3 py-2 text-xs">{mins(r.avg_wait)}</td>
          </tr>
        ))}
      </Table>
    </>
  )
}

function Reasons({ rows, forced }: { rows: Stats['reasons']; forced: number }) {
  const max = Math.max(1, ...rows.map((r) => r.n))
  if (rows.length === 0)
    return (
      <p className="rounded-card bg-success-bg px-3 py-3 text-sm text-success-txt">
        ช่วงนี้ไม่มีใบไหนต้องปิดแทนเลย
      </p>
    )
  return (
    <>
      <p className="mb-2 text-sm text-ink-500">
        ปิดแทนทั้งหมด {nf(forced)} ใบ · สามเหตุผลแรกคือระบบงานพลาด ไม่ใช่คนเบรคผิด
        ถ้าเหตุผลไหนกระจุกตัว แปลว่าต้องไปแก้ที่จุดนั้น ไม่ใช่ไล่ตามคน
      </p>
      <Table head={['เหตุผล', 'กี่ใบ', 'สัดส่วน']}>
        {rows.map((r) => (
          <tr key={r.code} className="border-t border-line-2">
            <td className="px-3 py-2">{REASON_TH[r.code] ?? r.code}</td>
            <td className="px-3 py-2">
              <Bar n={r.n} max={max} tone="#E8B931" />
            </td>
            <td className="px-3 py-2">{pct(r.n, forced)}%</td>
          </tr>
        ))}
      </Table>
    </>
  )
}

function TimeView({ hours, days }: { hours: Stats['by_hour']; days: Stats['by_day'] }) {
  const byHour = useMemo(() => {
    const m = new Map(hours.map((h) => [h.h, h]))
    return Array.from({ length: 24 }, (_, h) => m.get(h) ?? { h, n: 0, late: 0 })
  }, [hours])
  const max = Math.max(1, ...byHour.map((h) => h.n))
  const dmax = Math.max(1, ...days.map((d) => d.n))

  return (
    <>
      <p className="label">ยื่นบัตรกันกี่โมง · แถบแดงคือใบที่จบด้วยการกลับช้า</p>
      <div className="mb-4 overflow-x-auto rounded-card border border-line p-3">
        <div className="flex min-w-[600px] items-end gap-1" style={{ height: 150 }}>
          {byHour.map((h) => (
            <div key={h.h} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full flex-1 items-end">
                <div className="flex w-full flex-col justify-end" style={{ height: '100%' }}>
                  {h.late > 0 && (
                    <div style={{ height: `${(h.late / max) * 100}%`, background: '#EF4444' }} />
                  )}
                  <div
                    style={{ height: `${((h.n - h.late) / max) * 100}%`, background: '#3B82F6' }}
                  />
                </div>
              </div>
              <span className="text-[10px] text-ink-400">{h.h}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="label">รายวัน</p>
      <Table head={['วันที่', 'ใบ', 'เกินเวลา']}>
        {days.map((r) => (
          <tr key={r.d} className="border-t border-line-2">
            <td className="px-3 py-2">{r.d}</td>
            <td className="px-3 py-2">
              <Bar n={r.n} max={dmax} />
            </td>
            <td className="px-3 py-2">
              {r.late > 0 ? <b className="text-danger-txt">{nf(r.late)}</b> : '—'}
            </td>
          </tr>
        ))}
      </Table>
    </>
  )
}

function Empty() {
  return (
    <p className="rounded-card bg-surface-2 px-3 py-3 text-sm text-ink-500">
      ช่วงนี้ยังไม่มีใบเบรค
    </p>
  )
}
