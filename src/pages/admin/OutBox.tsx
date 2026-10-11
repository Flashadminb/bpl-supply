import { useEffect, useMemo, useRef, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { ErrorBox, Loading, Spinner } from '../../components/ui'
import { readableError } from '../../lib/supabase'
import {
  OUT_RANK,
  OUT_STATE_TH,
  SOON_MIN,
  calcOut,
  importOut,
  outBoard,
  outLatest,
  parseOutFile,
  undoOut,
  type OutCalc,
  type OutState,
} from '../../lib/hubOut'

/**
 * ของค้างส่งออก
 *
 * หน้าเดียวจบ · อัปไฟล์อยู่บนสุดเพราะเป็นสิ่งแรกที่ทำทุกรอบ
 * แล้วไล่ลงมาเป็น ตัวเลขรวม → ใครต้องช่วย → ตารางเต็ม
 *
 * มีสองโหมด
 *   ตาราง     ค้นหาเจาะสาขา แทนการ VLOOKUP ในไฟล์
 *   จอทีวี    เปิดค้างในคลัง แยกสายหลักกับสายรองคนละฝั่ง เลื่อนเองทีละแถว
 *
 * รอบแรกเปิดให้เจ้าของระบบคนเดียว · ด่านจริงอยู่ที่ RLS ของ hub_out_*
 */

const LANE: Record<'LH' | 'FD', [string, string]> = {
  LH: ['สายหลัก LH', 'ระหว่างฮับด้วยกัน'],
  FD: ['สายรอง FD', 'เข้าสาขาปลายทาง'],
}

const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const p2 = (n: number) => String(n).padStart(2, '0')

function thDT(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getDate()} ${TH_MON[d.getMonth()]} ${String((d.getFullYear() + 543) % 100)} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

const nf = (n: number) => n.toLocaleString('th-TH')

function Delta({ now, prev }: { now: number; prev: number | null }) {
  if (prev === null) return <span className="font-mono text-xs text-ink-400">สาขาใหม่</span>
  const d = now - prev
  if (d === 0) return <span className="font-mono text-xs text-ink-400">เท่าเดิม</span>
  return (
    <span className={`font-mono text-xs ${d > 0 ? 'text-danger-txt' : 'text-success-txt'}`}>
      {d > 0 ? `▲ +${nf(d)}` : `▼ ${nf(d)}`}
    </span>
  )
}

const PILL: Record<OutState, string> = {
  late: 'badge-dang',
  soon: 'badge-warn',
  clear: 'badge-mute',
  down: 'badge-ok',
  new: 'badge-mute',
  flat: '',
}

export default function OutBox() {
  const board = useAsync(() => outBoard(), [])
  const [tick, setTick] = useState(0)
  const [mode, setMode] = useState<'table' | 'tv'>('table')
  const [q, setQ] = useState('')
  const [dir, setDir] = useState('')
  const [sort, setSort] = useState('work')
  const [onlyBad, setOnlyBad] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [lastId, setLastId] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const snap = board.data?.snapshot ?? null

  const rows = useMemo<OutCalc[]>(
    () => (snap ? calcOut(board.data?.rows ?? [], snap.snap_at) : []),
    [board.data, snap],
  )

  /* ถามแค่เวลาของรอบล่าสุดทุกสองนาที แล้วโหลดตารางใหม่เฉพาะตอนเวลาเปลี่ยน
     ไฟล์มาทุกครึ่งชั่วโมง ดึงทั้งตารางถี่กว่านี้คือกิน egress เปล่า ๆ */
  useEffect(() => {
    const t = setInterval(() => {
      void outLatest()
        .then((at) => {
          if (at && snap && at !== snap.snap_at) board.reload()
        })
        .catch(() => {})
    }, 120_000)
    return () => clearInterval(t)
  }, [snap, board])

  const totals = useMemo(() => {
    const sum = (f: (r: OutCalc) => number) => rows.reduce((n, r) => n + f(r), 0)
    const prev = (f: (r: OutCalc) => number | null) =>
      rows.reduce((n, r) => n + (f(r) ?? 0), 0)
    return {
      inWh: sum((r) => r.in_wh),
      onTruck: sum((r) => r.on_truck),
      pIn: prev((r) => r.prev_in),
      pOn: prev((r) => r.prev_on),
      trucks: sum((r) => r.trucks),
      noPrint: sum((r) => r.no_print),
      finding: sum((r) => r.finding),
      waiting: sum((r) => r.waiting),
      inTransit: sum((r) => r.in_transit),
      late: rows.filter((r) => r.late.length).length,
    }
  }, [rows])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = rows.filter(
      (r) =>
        (!dir || r.dir === dir) &&
        (!s || r.station.toLowerCase().includes(s)) &&
        (!onlyBad || r.late.length > 0 || r.soon.length > 0),
    )
    list.sort((a, b) =>
      sort === 'in'
        ? b.in_wh - a.in_wh
        : sort === 'out'
          ? b.on_truck - a.on_truck
          : sort === 'chg'
            ? (b.chg ?? -1e9) - (a.chg ?? -1e9)
            : sort === 'clr'
              ? (a.chg ?? 1e9) - (b.chg ?? 1e9)
              : b.work - a.work,
    )
    return list
  }, [rows, q, dir, sort, onlyBad])

  const topWork = useMemo(() => [...rows].sort((a, b) => b.work - a.work).slice(0, 7), [rows])
  const topClear = useMemo(
    () =>
      rows
        .filter((r) => r.chg !== null && (r.prev_in ?? 0) + (r.prev_on ?? 0) > 100)
        .sort((a, b) => (a.chg ?? 0) - (b.chg ?? 0))
        .slice(0, 7),
    [rows],
  )
  const lateRows = useMemo(() => rows.filter((r) => r.late.length), [rows])
  const soonRows = useMemo(() => rows.filter((r) => !r.late.length && r.soon.length), [rows])

  async function pickFile(f: File | null) {
    if (!f) return
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const p = await parseOutFile(f)
      const res = await importOut(p, f.name)
      setLastId(res.id)
      setMsg(
        `บันทึกรอบ ${thDT(p.snapIso)} แล้ว · ${res.rows} สาขา · ${res.trucks} คัน ` +
          `(ปริ้นใบแล้ว ${p.printed} ยังไม่ปริ้น ${p.notPrinted})`,
      )
      board.reload()
      setTick((n) => n + 1)
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const ageMin = snap ? Math.round((Date.now() - new Date(snap.snap_at).getTime()) / 60000) : 0
  const ageTxt =
    ageMin < 60 ? `${ageMin} นาทีที่แล้ว` : ageMin < 1440 ? `${Math.floor(ageMin / 60)} ชั่วโมงที่แล้ว` : `${Math.floor(ageMin / 1440)} วันที่แล้ว`

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-lg">ของค้างส่งออก</h1>
          <p className="text-sm text-ink-500">
            ของที่ต้องออกจากฮับไปสาขาปลายทาง ตอนนี้ค้างอยู่ตรงไหน · เห็นเฉพาะเจ้าของระบบ
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`chip ${mode === 'table' ? 'chip-on' : ''}`}
            onClick={() => setMode('table')}
          >
            ตาราง
          </button>
          <button
            type="button"
            className={`chip ${mode === 'tv' ? 'chip-on' : ''}`}
            onClick={() => setMode('tv')}
          >
            จอทีวี แยกสาย
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------- อัปไฟล์ */}
      <section className="panel mb-4 flex flex-wrap items-center gap-3 border-l-4 border-l-brand-500 p-3">
        <input
          ref={fileRef}
          id="outfile"
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          className="btn-primary h-tap px-5"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? <Spinner /> : null} อัปไฟล์รอบใหม่
        </button>
        <div className="min-w-[200px] flex-1 text-sm">
          {snap ? (
            <>
              <span className="text-ink-500">รอบของไฟล์ </span>
              <b className="font-mono">{thDT(snap.snap_at)}</b>
              <span className="text-ink-300"> · </span>
              <span className="text-ink-500">อัปเข้าระบบ </span>
              <b className="font-mono">{thDT(snap.uploaded_at)}</b>
              <br />
              <span className={ageMin > 45 ? 'text-warn-txt' : 'text-ink-400'}>
                {ageTxt}
                {ageMin > 45 ? ' · เลยรอบ 30 นาทีไปแล้ว' : ''}
              </span>
              <span className="text-ink-400">
                {' '}
                · {snap.row_count} สาขา · {snap.truck_count} คัน
              </span>
            </>
          ) : (
            <span className="text-ink-500">
              ยังไม่มีข้อมูล · เลือกไฟล์ .xlsx ที่ส่งออกจากระบบ HUB แล้วบันทึกเลย ไม่มีหน้ายืนยันคั่น
            </span>
          )}
        </div>
        {lastId !== null && (
          <button
            type="button"
            className="btn-soft h-tap px-3 text-sm"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void undoOut(lastId)
                .then(() => {
                  setMsg('ถอนรอบที่เพิ่งอัปแล้ว')
                  setLastId(null)
                  board.reload()
                })
                .catch((e) => setErr(readableError(e)))
                .finally(() => setBusy(false))
            }}
          >
            ถอนรอบที่เพิ่งอัป
          </button>
        )}
      </section>

      {msg && (
        <p className="mb-3 rounded-card bg-success-bg px-3 py-2 text-sm text-success-txt">{msg}</p>
      )}
      {err && (
        <div className="mb-3">
          <ErrorBox message={err} />
        </div>
      )}

      {board.loading && <Loading />}
      {board.error && <ErrorBox message={board.error} onRetry={board.reload} />}

      {!board.loading && !snap && (
        <p className="panel p-6 text-center text-ink-500">
          ยังไม่เคยอัปไฟล์ · กดปุ่มด้านบนเพื่อเริ่ม
        </p>
      )}

      {snap && mode === 'table' && (
        <TableView
          rows={shown}
          all={rows}
          totals={totals}
          topWork={topWork}
          topClear={topClear}
          lateRows={lateRows}
          soonRows={soonRows}
          q={q}
          setQ={setQ}
          dir={dir}
          setDir={setDir}
          sort={sort}
          setSort={setSort}
          onlyBad={onlyBad}
          setOnlyBad={setOnlyBad}
          open={open}
          setOpen={setOpen}
        />
      )}

      {snap && mode === 'tv' && <TvView rows={rows} snapAt={snap.snap_at} tick={tick} />}
    </div>
  )
}

/* ====================================================== โหมดตาราง */

function TableView(p: {
  rows: OutCalc[]
  all: OutCalc[]
  totals: ReturnType<typeof Object> & Record<string, number>
  topWork: OutCalc[]
  topClear: OutCalc[]
  lateRows: OutCalc[]
  soonRows: OutCalc[]
  q: string
  setQ: (v: string) => void
  dir: string
  setDir: (v: string) => void
  sort: string
  setSort: (v: string) => void
  onlyBad: boolean
  setOnlyBad: (v: boolean) => void
  open: string | null
  setOpen: (v: string | null) => void
}) {
  const t = p.totals
  const maxWork = p.topWork[0]?.work || 1

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile
          hero
          label="เข้าคลังแต่ไม่สแกนออก"
          who="ทีมคัดแยก"
          n={t.inWh}
          prev={t.pIn}
          color="text-accent-500"
        />
        <Tile
          hero
          label="สแกนออกแต่รถไม่ออก"
          who="ทีมปล่อยรถ"
          n={t.onTruck}
          prev={t.pOn}
          color="text-warn-txt"
        />
        <Tile label="รถยังไม่ปล่อยตามแผน" who="คัน" n={t.trucks} />
        <Tile
          label="เลยเวลายังไม่ปริ้นใบ"
          who={`ยังไม่ปริ้น ${t.noPrint} · จัดหา ${t.finding}`}
          n={t.late}
          color={t.late > 0 ? 'text-danger-txt' : undefined}
        />
        <Tile
          label="รอส่งออกทั้งหมด"
          who={`ยังไม่ถึงฮับ ${nf(t.inTransit)}`}
          n={t.waiting}
          color="text-ink-500"
        />
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        <section className="panel p-3">
          <h2 className="font-display text-md">งานเยอะสุด</h2>
          <p className="mb-2 text-xs text-ink-400">
            ตัวเลขจริงของสองช่อง พร้อมทิศทางแยกกัน
          </p>
          <ul className="space-y-2">
            {p.topWork.map((r, i) => (
              <li key={r.station}>
                <div className="flex items-baseline gap-2">
                  <span className="w-4 font-mono text-xs text-ink-400">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{r.station}</span>
                  <span className="font-mono text-sm font-semibold">{nf(r.work)}</span>
                </div>
                <div className="ml-6 flex h-[6px] overflow-hidden rounded bg-surface-2">
                  <i className="block bg-accent-500" style={{ width: `${(r.in_wh / maxWork) * 100}%` }} />
                  <i
                    className="block bg-brand-500"
                    style={{ width: `${(r.on_truck / maxWork) * 100}%` }}
                  />
                </div>
                <div className="ml-6 flex flex-wrap gap-x-3 font-mono text-xs">
                  <span>
                    <span className="text-ink-400">คัดแยก </span>
                    <b className="text-accent-500">{nf(r.in_wh)}</b> <Delta now={r.in_wh} prev={r.prev_in} />
                  </span>
                  <span>
                    <span className="text-ink-400">ปล่อยรถ </span>
                    <b className="text-warn-txt">{nf(r.on_truck)}</b>{' '}
                    <Delta now={r.on_truck} prev={r.prev_on} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel p-3">
          <h2 className="font-display text-md">เคลียร์ได้มากสุด</h2>
          <p className="mb-2 text-xs text-ink-400">
            ลดลงจากรอบที่แล้วมากสุด · นับเฉพาะสาขาที่เคยมีของเกิน 100 ชิ้น
          </p>
          {p.topClear.length === 0 && (
            <p className="text-sm text-ink-400">ยังเทียบไม่ได้ · ต้องมีอย่างน้อยสองรอบ</p>
          )}
          <ul className="space-y-2">
            {p.topClear.map((r, i) => (
              <li key={r.station}>
                <div className="flex items-baseline gap-2">
                  <span className="w-4 font-mono text-xs text-ink-400">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{r.station}</span>
                  <span className="font-mono text-sm font-semibold text-success-txt">
                    {nf(r.chg ?? 0)}
                  </span>
                </div>
                <div className="ml-6 flex flex-wrap gap-x-3 font-mono text-xs">
                  <span>
                    <span className="text-ink-400">คัดแยก </span>
                    <b className="text-accent-500">{nf(r.in_wh)}</b> <Delta now={r.in_wh} prev={r.prev_in} />
                  </span>
                  <span>
                    <span className="text-ink-400">ปล่อยรถ </span>
                    <b className="text-warn-txt">{nf(r.on_truck)}</b>{' '}
                    <Delta now={r.on_truck} prev={r.prev_on} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel border-danger/40 p-3">
          <h2 className="font-display text-md">
            ต้องไปดูเดี๋ยวนี้{' '}
            <span className={p.lateRows.length ? 'badge-dang' : 'badge-mute'}>
              {p.lateRows.length ? `${p.lateRows.length} สาขา` : 'ยังไม่มี'}
            </span>
          </h2>
          <p className="mb-2 text-xs text-ink-400">
            รถที่เลยเวลาปล่อยแล้วยังไม่ปริ้นใบ · เทียบกับเวลาที่ถ่ายไฟล์
          </p>
          <ul className="space-y-1 text-sm">
            {p.lateRows.map((r) => (
              <li key={r.station} className="flex gap-2">
                <span className="min-w-0 flex-1 truncate">{r.station}</span>
                <span className="font-mono text-xs text-danger-txt">
                  {r.late.map((x) => x.at.slice(11, 16)).join(' · ')}
                </span>
              </li>
            ))}
            {p.soonRows.length > 0 && (
              <li className="pt-1 text-xs text-ink-400">ใกล้ถึงเวลาภายใน {SOON_MIN / 60} ชม.</li>
            )}
            {p.soonRows.slice(0, 5).map((r) => (
              <li key={r.station} className="flex gap-2">
                <span className="min-w-0 flex-1 truncate">{r.station}</span>
                <span className="font-mono text-xs text-warn-txt">
                  {r.soon.map((x) => x.at.slice(11, 16)).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input h-tap max-w-[300px]"
          type="search"
          placeholder="พิมพ์ชื่อสาขา — แทนการ VLOOKUP"
          value={p.q}
          onChange={(e) => p.setQ(e.target.value)}
        />
        <select
          className="input h-tap max-w-[150px]"
          value={p.dir}
          aria-label="สาย"
          onChange={(e) => p.setDir(e.target.value)}
        >
          <option value="">ทุกสาย</option>
          <option value="LH">สายหลัก LH</option>
          <option value="FD">สายรอง FD</option>
        </select>
        <select
          className="input h-tap max-w-[190px]"
          value={p.sort}
          aria-label="เรียงตาม"
          onChange={(e) => p.setSort(e.target.value)}
        >
          <option value="work">งานค้างมากสุด</option>
          <option value="in">เข้าคลังไม่สแกนออก</option>
          <option value="out">สแกนออกแต่รถไม่ออก</option>
          <option value="chg">ค้างเพิ่มมากสุด</option>
          <option value="clr">เคลียร์ได้มากสุด</option>
        </select>
        <label className="flex min-h-tap items-center gap-2 text-sm text-ink-500">
          <input
            type="checkbox"
            className="h-[18px] w-[18px]"
            checked={p.onlyBad}
            onChange={(e) => p.setOnlyBad(e.target.checked)}
          />
          เฉพาะที่มีปัญหา
        </label>
        <span className="font-mono text-xs text-ink-400">
          {p.rows.length} สาขา · ค้างรวม {nf(p.rows.reduce((n, r) => n + r.work, 0))}
        </span>
      </div>

      <section className="panel overflow-x-auto p-2">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="text-ink-500">
            <tr className="border-b border-line">
              <th className="px-3 py-2 font-medium">สาขาปลายทาง</th>
              <th className="w-[150px] px-3 py-2 font-medium">สถานะ</th>
              <th className="w-[110px] px-3 py-2 text-right font-medium">เข้าคลัง<br />ไม่สแกนออก</th>
              <th className="w-[110px] px-3 py-2 text-right font-medium">สแกนออก<br />รถไม่ออก</th>
              <th className="w-[80px] px-3 py-2 text-right font-medium">รวม</th>
              <th className="w-[110px] px-3 py-2 text-right font-medium">เทียบรอบก่อน</th>
              <th className="w-[70px] px-3 py-2 text-right font-medium">รถยัง<br />ไม่ปล่อย</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <RowItem
                key={r.dir + r.station}
                r={r}
                open={p.open === r.station}
                onToggle={() => p.setOpen(p.open === r.station ? null : r.station)}
              />
            ))}
            {p.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-ink-400">
                  ไม่พบสาขาตามเงื่อนไข
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  )
}

function Tile({
  label,
  who,
  n,
  prev,
  color,
  hero,
}: {
  label: string
  who?: string
  n: number
  prev?: number
  color?: string
  hero?: boolean
}) {
  return (
    <div className={`panel p-3 ${hero ? 'border-brand-500' : ''}`}>
      <span className="block text-sm text-ink-500">{label}</span>
      {who && <span className="block font-mono text-[10px] uppercase tracking-wide text-ink-400">{who}</span>}
      <span className={`mt-1 block font-display text-3xl leading-none ${color ?? ''}`}>{nf(n)}</span>
      {prev !== undefined && <Delta now={n} prev={prev} />}
    </div>
  )
}

function RowItem({ r, open, onToggle }: { r: OutCalc; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        className={`cursor-pointer border-b border-line-2 last:border-0 ${open ? 'bg-surface-2' : ''}`}
        onClick={onToggle}
      >
        <td className="px-3 py-2">
          <span className="block">{r.station}</span>
          <span className="block font-mono text-xs text-ink-400">{r.dir}</span>
        </td>
        <td className="px-3 py-2">
          {OUT_STATE_TH[r.state] && (
            <span className={PILL[r.state]}>
              {r.state === 'late'
                ? `เลยเวลา ${r.late.map((x) => x.at.slice(11, 16)).join(' ')}`
                : r.state === 'soon'
                  ? `ใกล้ถึง ${r.soon.map((x) => x.at.slice(11, 16)).join(' ')}`
                  : OUT_STATE_TH[r.state]}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right font-display text-md text-accent-500">{nf(r.in_wh)}</td>
        <td className="px-3 py-2 text-right font-display text-md text-warn-txt">{nf(r.on_truck)}</td>
        <td className="px-3 py-2 text-right font-mono text-xs">{nf(r.work)}</td>
        <td className="px-3 py-2 text-right">
          <Delta now={r.work} prev={r.chg === null ? null : r.work - r.chg} />
        </td>
        <td className="px-3 py-2 text-right font-mono text-xs">{r.trucks || '—'}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="bg-surface-2 px-3 py-3">
            <TruckList r={r} />
          </td>
        </tr>
      )}
    </>
  )
}

function TruckList({ r }: { r: OutCalc }) {
  const lateSet = new Set(r.late.map((t) => t.at))
  const soonSet = new Set(r.soon.map((t) => t.at))
  return (
    <>
      <div className="mb-2 flex flex-wrap gap-2 font-mono text-xs text-ink-500">
        <span>รถยังไม่ปล่อย <b className="text-ink">{r.trucks}</b> · หลัก {r.main_trucks} · เสริม {r.extra_trucks}</span>
        <span>ยังไม่ปริ้นใบ <b className={r.no_print ? 'text-danger-txt' : 'text-ink'}>{r.no_print}</b></span>
        <span>กำลังจัดหา <b className="text-ink">{r.finding}</b></span>
        <span>ยังไม่มาถึงฮับ <b className="text-ink">{nf(r.in_transit)}</b> · ของต้นทาง</span>
      </div>
      <p className="mb-1 font-display text-sm">รถของสาขานี้ {r.trucks_list.length} คัน</p>
      {r.trucks_list.length === 0 && <p className="text-sm text-ink-400">รอบนี้ไม่มีรถในแผน</p>}
      <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {r.trucks_list.map((t, i) => {
          const isLate = !t.p && lateSet.has(t.at)
          const isSoon = !t.p && soonSet.has(t.at)
          return (
            <li key={i} className="flex items-center gap-2 rounded-btn bg-surface px-2 py-1">
              <span
                className={`font-mono text-sm font-semibold ${isLate ? 'text-danger-txt' : isSoon ? 'text-warn-txt' : ''}`}
              >
                {t.at.slice(11, 16)}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-ink-400">{t.v ?? '—'}</span>
              <span className={t.p ? 'badge-ok' : isLate ? 'badge-dang' : isSoon ? 'badge-warn' : 'badge-mute'}>
                {t.p ? 'ปริ้นแล้ว' : isLate ? 'เลยเวลา' : isSoon ? 'ใกล้ถึง' : 'ยังไม่ปริ้น'}
              </span>
            </li>
          )
        })}
      </ul>
    </>
  )
}

/* ====================================================== โหมดจอทีวี */

function TvView({ rows, snapAt, tick }: { rows: OutCalc[]; snapAt: string; tick: number }) {
  const [auto, setAuto] = useState(true)
  const [open, setOpen] = useState<string | null>(null)
  const [clock, setClock] = useState(() => new Date())
  const lh = useRef<HTMLDivElement>(null)
  const fd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  /* เลื่อนทีละแถวทุกสามวินาที · ถึงล่างแล้ววนกลับบน
     ไม่กระโดดทีละหน้า เพราะคนที่กำลังอ่านแถวล่างจะเสียที่อ่านทุกครั้ง */
  useEffect(() => {
    if (!auto || open) return
    const step = () => {
      for (const box of [lh.current, fd.current]) {
        if (!box) continue
        const items = [...box.querySelectorAll<HTMLElement>('[data-row]')]
        if (items.length < 2) continue
        const bottom = box.scrollHeight - box.clientHeight
        if (bottom <= 2) continue
        const next = items.find((el) => el.offsetTop > box.scrollTop + 4)
        box.scrollTo({ top: !next || box.scrollTop >= bottom - 2 ? 0 : next.offsetTop, behavior: 'smooth' })
      }
    }
    const t = setInterval(step, 3000)
    return () => clearInterval(t)
  }, [auto, open, tick, rows])

  const byDir = (d: 'LH' | 'FD') =>
    rows
      .filter((r) => r.dir === d)
      .sort((a, b) => OUT_RANK[a.state] - OUT_RANK[b.state] || b.work - a.work)

  return (
    <div className="rounded-card bg-[#0B0E11] p-4 text-[#F0F4F9]">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="rounded-btn bg-brand-500 px-3 py-1 font-display text-lg text-ink">FLASH</span>
        <span className="font-display text-xl">ของค้างส่งออก 21BPL</span>
        <span className="flex-1" />
        <span className="text-[#AFC0D4]">
          {clock.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}
        </span>
        <span className="font-mono text-3xl font-bold text-brand-500">
          {p2(clock.getHours())}:{p2(clock.getMinutes())}
          <span className="text-base">:{p2(clock.getSeconds())}</span>
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-card border-2 border-[#1E2733] bg-[#121820] px-3 py-2">
        <span className="text-sm text-[#AFC0D4]">รอบของไฟล์</span>
        <b className="font-mono text-lg">{thDT(snapAt)}</b>
        <label className="ml-auto flex items-center gap-2 text-sm text-[#AFC0D4]">
          <input
            type="checkbox"
            className="h-[19px] w-[19px]"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
          />
          เลื่อนอัตโนมัติ
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {(['LH', 'FD'] as const).map((d) => {
          const g = byDir(d)
          const gi = g.reduce((n, r) => n + r.in_wh, 0)
          const go = g.reduce((n, r) => n + r.on_truck, 0)
          const bad = g.filter((r) => r.late.length || r.soon.length).length
          return (
            <div
              key={d}
              className={`rounded-card border-2 bg-[#121820] p-3 ${d === 'LH' ? 'border-[#27405A]' : 'border-[#4A3C14]'}`}
            >
              <h3 className="mb-2 flex flex-wrap items-baseline gap-2 font-display text-xl">
                {LANE[d][0]}
                <span className="text-sm font-normal text-[#AFC0D4]">
                  {g.length} สาขา{bad ? ` · ต้องดู ${bad}` : ''}
                </span>
              </h3>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="rounded-card border-2 border-[#1E2733] bg-[#0B0E11] p-2">
                  <span className="block text-sm text-[#AFC0D4]">เข้าคลัง ไม่สแกนออก</span>
                  <span className="block font-display text-4xl leading-none text-[#7FD1FF]">{nf(gi)}</span>
                </div>
                <div className="rounded-card border-2 border-[#1E2733] bg-[#0B0E11] p-2">
                  <span className="block text-sm text-[#AFC0D4]">สแกนออก รถไม่ออก</span>
                  <span className="block font-display text-4xl leading-none text-brand-500">{nf(go)}</span>
                </div>
              </div>
              <div
                ref={d === 'LH' ? lh : fd}
                className="max-h-[58vh] space-y-[6px] overflow-hidden"
                style={{ scrollBehavior: 'smooth' }}
              >
                {g.map((r) => (
                  <TvRow
                    key={r.station}
                    r={r}
                    open={open === r.station}
                    onToggle={() => setOpen(open === r.station ? null : r.station)}
                  />
                ))}
                {g.length === 0 && <p className="text-sm text-[#5A646F]">ไม่มีสาขาในสายนี้</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const EDGE: Record<OutState, string> = {
  late: '#FF5C5C',
  soon: '#FFB038',
  down: '#35D98A',
  clear: '#2A3542',
  flat: '#2A3542',
  new: '#2A3542',
}

function TvRow({ r, open, onToggle }: { r: OutCalc; open: boolean; onToggle: () => void }) {
  const tag =
    r.state === 'late'
      ? `เลยเวลา ${r.late.map((x) => x.at.slice(11, 16)).join(' ')}`
      : r.state === 'soon'
        ? `ใกล้ถึง ${r.soon.map((x) => x.at.slice(11, 16)).join(' ')}`
        : OUT_STATE_TH[r.state]
  const foot = [
    r.trucks ? `รถ ${r.trucks}` : '',
    r.no_print ? `ไม่ปริ้นใบ ${r.no_print}` : '',
    r.finding ? `จัดหา ${r.finding}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div data-row>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 rounded-card border-2 bg-[#0B0E11] px-3 py-2 text-left"
        style={{ borderColor: '#1E2733', borderLeftWidth: 6, borderLeftColor: EDGE[r.state] }}
      >
        <span className="min-w-0 flex-1">
          <b className="block break-words font-display text-lg leading-tight">{r.station}</b>
          {foot && <span className="block font-mono text-xs text-[#5A646F]">{foot}</span>}
        </span>
        <span className="shrink-0 text-right" style={{ minWidth: 84 }}>
          <em className="block font-display text-2xl not-italic leading-none text-[#7FD1FF]">
            {nf(r.in_wh)}
          </em>
          <Delta now={r.in_wh} prev={r.prev_in} />
        </span>
        <span className="shrink-0 text-right" style={{ minWidth: 84 }}>
          <em className="block font-display text-2xl not-italic leading-none text-brand-500">
            {nf(r.on_truck)}
          </em>
          <Delta now={r.on_truck} prev={r.prev_on} />
        </span>
        {tag && (
          <span
            className="shrink-0 rounded-btn px-2 py-1 font-mono text-xs"
            style={{
              background: r.state === 'late' ? '#351317' : r.state === 'soon' ? '#352714' : '#1B2430',
              color: r.state === 'late' ? '#FF9A9A' : r.state === 'soon' ? '#FFC77A' : '#7FD1FF',
            }}
          >
            {tag}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-1 rounded-card border-2 border-[#1E2733] bg-[#0E141B] p-3">
          <TruckList r={r} />
        </div>
      )}
    </div>
  )
}
