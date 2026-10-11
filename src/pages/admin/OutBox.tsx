import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import { Spinner } from '../../components/ui'
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
 * ของค้างส่งออก — หน้าเต็มจอของตัวเอง
 *
 * ใช้ชุดสีเดียวกับตารางปล่อยรถและรถรอลงงานทุกค่า ไม่ใช่ธีมหลังบ้าน
 * เพราะเป็นจอประเภทเดียวกัน คือเปิดค้างไว้ดูในคลัง ไม่ใช่หน้าตั้งค่า
 * จอในคลังอยู่ใต้ไฟแรงและคนอ่านจากไกล พื้นขาวจึงแสบตาและสะท้อน
 *
 * สองโหมด
 *   ตาราง   ค้นหาเจาะสาขา แทนการ VLOOKUP ในไฟล์
 *   จอทีวี  แยกสายหลักกับสายรองคนละฝั่ง เลื่อนเองทีละแถว
 *
 * เปิดให้เจ้าของระบบคนเดียว · ด่านจริงอยู่ที่ RLS ของ hub_out_*
 */

/* ชุดสีเดียวกับ pages/trucks · เก็บไว้ที่เดียวจะได้ไม่หลุดกันทีละจุด */
const C = {
  bg: '#0B0E11',
  panel: '#121820',
  panel2: '#151C26',
  line: '#243040',
  line2: '#1E2733',
  ink: '#F0F4F9',
  mute: '#AFC0D4',
  faint: '#5A646F',
  chip: '#1B2430',
  brand: '#FFC400',
  red: '#FF5C5C',
  redBg: '#351317',
  redInk: '#FF9A9A',
  amber: '#FFB038',
  amberBg: '#352714',
  amberInk: '#FFC77A',
  green: '#35D98A',
  greenBg: '#11301F',
  greenInk: '#8FE8BC',
  blue: '#7FD1FF',
}

const LANE: Record<'LH' | 'FD', string> = { LH: 'สายหลัก LH', FD: 'สายรอง FD' }
const DAY_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const p2 = (n: number) => String(n).padStart(2, '0')
const nf = (n: number) => n.toLocaleString('th-TH')

function thDT(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getDate()} ${TH_MON[d.getMonth()]} ${String((d.getFullYear() + 543) % 100)} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

function Delta({ now, prev }: { now: number; prev: number | null }) {
  if (prev === null)
    return (
      <span className="font-mono text-xs" style={{ color: C.faint }}>
        สาขาใหม่
      </span>
    )
  const d = now - prev
  if (d === 0)
    return (
      <span className="font-mono text-xs" style={{ color: C.faint }}>
        เท่าเดิม
      </span>
    )
  return (
    <span className="font-mono text-xs" style={{ color: d > 0 ? C.redInk : C.greenInk }}>
      {d > 0 ? `▲ +${nf(d)}` : `▼ ${nf(d)}`}
    </span>
  )
}

function Tag({ state, text }: { state: OutState; text: string }) {
  if (!text) return null
  const bg = state === 'late' ? C.redBg : state === 'soon' ? C.amberBg : state === 'clear' ? C.greenBg : C.chip
  const fg = state === 'late' ? C.redInk : state === 'soon' ? C.amberInk : state === 'clear' ? C.greenInk : C.blue
  return (
    <span
      className="inline-block whitespace-nowrap rounded-md px-2 py-[2px] font-mono text-xs"
      style={{ background: bg, color: fg }}
    >
      {text}
    </span>
  )
}

function tagText(r: OutCalc): string {
  if (r.state === 'late') return `เลยเวลา ${r.late.map((x) => x.at.slice(11, 16)).join(' ')}`
  if (r.state === 'soon') return `ใกล้ถึง ${r.soon.map((x) => x.at.slice(11, 16)).join(' ')}`
  return OUT_STATE_TH[r.state]
}

const EDGE: Record<OutState, string> = {
  late: C.red,
  soon: C.amber,
  down: C.green,
  clear: '#2A3542',
  flat: '#2A3542',
  new: '#2A3542',
}

export default function OutBox() {
  const nav = useNavigate()
  const board = useAsync(() => outBoard(), [])
  const [tick, setTick] = useState(0)
  const [mode, setMode] = useState<'table' | 'tv'>('table')
  const [clock, setClock] = useState(() => new Date())

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

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

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

  const t = useMemo(() => {
    const sum = (f: (r: OutCalc) => number) => rows.reduce((n, r) => n + f(r), 0)
    return {
      inWh: sum((r) => r.in_wh),
      onTruck: sum((r) => r.on_truck),
      pIn: rows.reduce((n, r) => n + (r.prev_in ?? 0), 0),
      pOn: rows.reduce((n, r) => n + (r.prev_on ?? 0), 0),
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
      const parsed = await parseOutFile(f)
      const res = await importOut(parsed, f.name)
      setLastId(res.id)
      setMsg(
        `บันทึกรอบ ${thDT(parsed.snapIso)} แล้ว · ${res.rows} สาขา · ${res.trucks} คัน ` +
          `(ปริ้นใบแล้ว ${parsed.printed} ยังไม่ปริ้น ${parsed.notPrinted})`,
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
    ageMin < 60
      ? `${ageMin} นาทีที่แล้ว`
      : ageMin < 1440
        ? `${Math.floor(ageMin / 60)} ชั่วโมงที่แล้ว`
        : `${Math.floor(ageMin / 1440)} วันที่แล้ว`

  const box = { background: C.panel, border: `1px solid ${C.line2}` }
  const field = { background: C.panel2, border: `1px solid ${C.line2}`, color: C.ink }

  return (
    <div className="min-h-dvh" style={{ background: C.bg, color: C.ink }}>
      {/* ───────── หัว · ชุดเดียวกับตารางปล่อยรถ ───────── */}
      <header
        className="safe-t sticky top-0 z-20 flex flex-wrap items-center gap-3 px-4 py-3"
        style={{ background: C.bg, borderBottom: `1px solid ${C.line}` }}
      >
        <button
          type="button"
          aria-label="ย้อนกลับ"
          className="h-tap w-tap rounded-btn text-xl"
          style={{ color: C.mute }}
          onClick={() => nav('/')}
        >
          ←
        </button>
        <span
          className="rounded-md px-2.5 py-1 text-sm font-extrabold"
          style={{ background: C.brand, color: C.bg }}
        >
          FLASH
        </span>
        <span className="text-lg font-bold">ของค้างส่งออก · 21BPL</span>
        <span className="flex-1" />
        <span className="text-sm" style={{ color: C.mute }}>
          {DAY_TH[clock.getDay()]} {clock.getDate()} {TH_MON[clock.getMonth()]}{' '}
          {String((clock.getFullYear() + 543) % 100)}
        </span>
        <span className="font-mono text-xl font-bold" style={{ color: C.brand }}>
          {p2(clock.getHours())}:{p2(clock.getMinutes())}:{p2(clock.getSeconds())}
        </span>
      </header>

      <div className="px-4 py-4">
        {/* ───────── แถบอัปไฟล์ ───────── */}
        <section
          className="mb-3 flex flex-wrap items-center gap-3 rounded-xl px-3 py-3"
          style={{ ...box, borderLeft: `4px solid ${C.brand}` }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="h-tap rounded-btn px-5 font-bold"
            style={{ background: C.brand, color: C.bg, opacity: busy ? 0.6 : 1 }}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? <Spinner /> : null} อัปไฟล์รอบใหม่
          </button>
          <div className="min-w-[220px] flex-1 text-sm">
            {snap ? (
              <>
                <span style={{ color: C.mute }}>รอบของไฟล์ </span>
                <b className="font-mono">{thDT(snap.snap_at)}</b>
                <span style={{ color: C.faint }}> · </span>
                <span style={{ color: C.mute }}>อัปเข้าระบบ </span>
                <b className="font-mono">{thDT(snap.uploaded_at)}</b>
                <br />
                <span style={{ color: ageMin > 45 ? C.amberInk : C.faint }}>
                  {ageTxt}
                  {ageMin > 45 ? ' · เลยรอบ 30 นาทีไปแล้ว' : ''}
                </span>
                <span style={{ color: C.faint }}>
                  {' '}
                  · {snap.row_count} สาขา · {snap.truck_count} คัน
                </span>
              </>
            ) : (
              <span style={{ color: C.mute }}>
                ยังไม่มีข้อมูล · เลือกไฟล์ .xlsx จากระบบ HUB แล้วบันทึกเลย ไม่มีหน้ายืนยันคั่น
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="h-tap rounded-btn px-4 text-sm"
              style={mode === 'table' ? { background: C.brand, color: C.bg, fontWeight: 700 } : { background: C.chip, color: C.mute }}
              onClick={() => setMode('table')}
            >
              ตาราง
            </button>
            <button
              type="button"
              className="h-tap rounded-btn px-4 text-sm"
              style={mode === 'tv' ? { background: C.brand, color: C.bg, fontWeight: 700 } : { background: C.chip, color: C.mute }}
              onClick={() => setMode('tv')}
            >
              จอทีวี แยกสาย
            </button>
            {lastId !== null && (
              <button
                type="button"
                className="h-tap rounded-btn px-3 text-sm"
                style={{ background: C.chip, color: C.mute }}
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
          </div>
        </section>

        {msg && (
          <p
            className="mb-3 rounded-lg px-3 py-2 text-sm"
            style={{ background: 'rgba(53,217,138,.12)', color: C.greenInk }}
          >
            {msg}
          </p>
        )}
        {err && (
          <p
            className="mb-3 rounded-lg px-3 py-2 text-sm"
            style={{ background: 'rgba(255,92,92,.12)', color: C.redInk }}
          >
            {err}
          </p>
        )}

        {board.loading && <p style={{ color: C.mute }}>กำลังโหลด…</p>}
        {board.error && (
          <p className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,92,92,.12)', color: C.redInk }}>
            {board.error}
          </p>
        )}

        {!board.loading && !snap && (
          <p className="rounded-xl py-16 text-center text-lg" style={{ ...box, color: C.mute }}>
            ยังไม่เคยอัปไฟล์ · กดปุ่มด้านบนเพื่อเริ่ม
          </p>
        )}

        {snap && mode === 'table' && (
          <>
            <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Tile hero label="เข้าคลังแต่ไม่สแกนออก" who="ทีมคัดแยก" n={t.inWh} prev={t.pIn} color={C.blue} />
              <Tile hero label="สแกนออกแต่รถไม่ออก" who="ทีมปล่อยรถ" n={t.onTruck} prev={t.pOn} color={C.brand} />
              <Tile label="รถยังไม่ปล่อยตามแผน" who="คัน" n={t.trucks} />
              <Tile
                label="เลยเวลายังไม่ปริ้นใบ"
                who={`ยังไม่ปริ้น ${t.noPrint} · จัดหา ${t.finding}`}
                n={t.late}
                color={t.late > 0 ? C.red : undefined}
              />
              <Tile label="รอส่งออกทั้งหมด" who={`ยังไม่ถึงฮับ ${nf(t.inTransit)}`} n={t.waiting} color={C.mute} />
            </div>

            <div className="mb-3 grid gap-3 lg:grid-cols-3">
              <div className="rounded-xl p-3" style={box}>
                <h2 className="font-bold">งานเยอะสุด</h2>
                <p className="mb-2 text-xs" style={{ color: C.faint }}>
                  ตัวเลขจริงของสองช่อง พร้อมทิศทางแยกกัน
                </p>
                <ul className="space-y-2">
                  {topWork.map((r, i) => (
                    <RankItem key={r.station} r={r} i={i} max={topWork[0]?.work || 1} bar />
                  ))}
                </ul>
              </div>

              <div className="rounded-xl p-3" style={box}>
                <h2 className="font-bold">เคลียร์ได้มากสุด</h2>
                <p className="mb-2 text-xs" style={{ color: C.faint }}>
                  ลดลงจากรอบที่แล้วมากสุด · นับเฉพาะสาขาที่เคยมีของเกิน 100 ชิ้น
                </p>
                {topClear.length === 0 && (
                  <p className="text-sm" style={{ color: C.faint }}>
                    ยังเทียบไม่ได้ · ต้องมีอย่างน้อยสองรอบ
                  </p>
                )}
                <ul className="space-y-2">
                  {topClear.map((r, i) => (
                    <RankItem key={r.station} r={r} i={i} max={1} value={nf(r.chg ?? 0)} good />
                  ))}
                </ul>
              </div>

              <div className="rounded-xl p-3" style={{ background: C.panel, border: `1px solid ${C.red}55` }}>
                <h2 className="flex flex-wrap items-baseline gap-2 font-bold">
                  ต้องไปดูเดี๋ยวนี้
                  <Tag
                    state={lateRows.length ? 'late' : 'clear'}
                    text={lateRows.length ? `${lateRows.length} สาขา` : 'ยังไม่มี'}
                  />
                </h2>
                <p className="mb-2 text-xs" style={{ color: C.faint }}>
                  รถที่เลยเวลาปล่อยแล้วยังไม่ปริ้นใบ · เทียบกับเวลาที่ถ่ายไฟล์
                </p>
                <ul className="space-y-1 text-sm">
                  {lateRows.map((r) => (
                    <li key={r.station} className="flex gap-2">
                      <span className="min-w-0 flex-1 truncate">{r.station}</span>
                      <span className="font-mono text-xs" style={{ color: C.redInk }}>
                        {r.late.map((x) => x.at.slice(11, 16)).join(' · ')}
                      </span>
                    </li>
                  ))}
                  {soonRows.length > 0 && (
                    <li className="pt-1 text-xs" style={{ color: C.faint }}>
                      ใกล้ถึงเวลาภายใน {SOON_MIN / 60} ชม.
                    </li>
                  )}
                  {soonRows.slice(0, 5).map((r) => (
                    <li key={r.station} className="flex gap-2">
                      <span className="min-w-0 flex-1 truncate">{r.station}</span>
                      <span className="font-mono text-xs" style={{ color: C.amberInk }}>
                        {r.soon.map((x) => x.at.slice(11, 16)).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                className="h-tap min-w-[180px] flex-1 rounded-btn px-3 text-sm"
                style={{ ...field, maxWidth: 300 }}
                type="search"
                placeholder="พิมพ์ชื่อสาขา — แทนการ VLOOKUP"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <select
                className="h-tap rounded-btn px-3 text-sm"
                style={field}
                value={dir}
                aria-label="สาย"
                onChange={(e) => setDir(e.target.value)}
              >
                <option value="">ทุกสาย</option>
                <option value="LH">สายหลัก LH</option>
                <option value="FD">สายรอง FD</option>
              </select>
              <select
                className="h-tap rounded-btn px-3 text-sm"
                style={field}
                value={sort}
                aria-label="เรียงตาม"
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="work">งานค้างมากสุด</option>
                <option value="in">เข้าคลังไม่สแกนออก</option>
                <option value="out">สแกนออกแต่รถไม่ออก</option>
                <option value="chg">ค้างเพิ่มมากสุด</option>
                <option value="clr">เคลียร์ได้มากสุด</option>
              </select>
              <label className="flex min-h-tap items-center gap-2 text-sm" style={{ color: C.mute }}>
                <input
                  type="checkbox"
                  className="h-[18px] w-[18px]"
                  checked={onlyBad}
                  onChange={(e) => setOnlyBad(e.target.checked)}
                />
                เฉพาะที่มีปัญหา
              </label>
              <span className="font-mono text-xs" style={{ color: C.faint }}>
                {shown.length} สาขา · ค้างรวม {nf(shown.reduce((n, r) => n + r.work, 0))}
              </span>
            </div>

            <section className="overflow-x-auto rounded-xl p-2" style={box}>
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.line}`, color: C.faint }}>
                    <th className="px-3 py-2 text-xs font-medium">สาขาปลายทาง</th>
                    <th className="w-[150px] px-3 py-2 text-xs font-medium">สถานะ</th>
                    <th className="w-[110px] px-3 py-2 text-right text-xs font-medium">
                      เข้าคลัง
                      <br />
                      ไม่สแกนออก
                    </th>
                    <th className="w-[110px] px-3 py-2 text-right text-xs font-medium">
                      สแกนออก
                      <br />
                      รถไม่ออก
                    </th>
                    <th className="w-[80px] px-3 py-2 text-right text-xs font-medium">รวม</th>
                    <th className="w-[110px] px-3 py-2 text-right text-xs font-medium">เทียบรอบก่อน</th>
                    <th className="w-[70px] px-3 py-2 text-right text-xs font-medium">
                      รถยัง
                      <br />
                      ไม่ปล่อย
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <RowItem
                      key={r.dir + r.station}
                      r={r}
                      open={open === r.station}
                      onToggle={() => setOpen(open === r.station ? null : r.station)}
                    />
                  ))}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center" style={{ color: C.faint }}>
                        ไม่พบสาขาตามเงื่อนไข
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </>
        )}

        {snap && mode === 'tv' && <TvView rows={rows} snapAt={snap.snap_at} tick={tick} />}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- ชิ้นส่วน */

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
    <div className="rounded-xl p-3" style={{ background: C.panel, border: `1px solid ${hero ? C.brand : C.line2}` }}>
      <span className="block text-sm" style={{ color: C.mute }}>
        {label}
      </span>
      {who && (
        <span className="block font-mono text-[10px] uppercase tracking-wide" style={{ color: C.faint }}>
          {who}
        </span>
      )}
      <span className="mt-1 block text-3xl font-extrabold leading-none" style={{ color: color ?? C.ink }}>
        {nf(n)}
      </span>
      {prev !== undefined && <Delta now={n} prev={prev} />}
    </div>
  )
}

function RankItem({
  r,
  i,
  max,
  bar,
  value,
  good,
}: {
  r: OutCalc
  i: number
  max: number
  bar?: boolean
  value?: string
  good?: boolean
}) {
  return (
    <li>
      <div className="flex items-baseline gap-2">
        <span className="w-4 font-mono text-xs" style={{ color: C.faint }}>
          {i + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{r.station}</span>
        <span className="font-mono text-sm font-bold" style={{ color: good ? C.greenInk : C.ink }}>
          {value ?? nf(r.work)}
        </span>
      </div>
      {bar && (
        <div className="ml-6 flex h-[6px] overflow-hidden rounded" style={{ background: C.line2 }}>
          <i className="block" style={{ width: `${(r.in_wh / max) * 100}%`, background: C.blue }} />
          <i className="block" style={{ width: `${(r.on_truck / max) * 100}%`, background: C.brand }} />
        </div>
      )}
      <div className="ml-6 flex flex-wrap gap-x-3 font-mono text-xs">
        <span>
          <span style={{ color: C.faint }}>คัดแยก </span>
          <b style={{ color: C.blue }}>{nf(r.in_wh)}</b> <Delta now={r.in_wh} prev={r.prev_in} />
        </span>
        <span>
          <span style={{ color: C.faint }}>ปล่อยรถ </span>
          <b style={{ color: C.brand }}>{nf(r.on_truck)}</b> <Delta now={r.on_truck} prev={r.prev_on} />
        </span>
      </div>
    </li>
  )
}

function RowItem({ r, open, onToggle }: { r: OutCalc; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        className="cursor-pointer"
        style={{ borderBottom: `1px solid ${C.line2}`, background: open ? C.panel2 : undefined }}
        onClick={onToggle}
      >
        <td className="px-3 py-2">
          <span className="block">{r.station}</span>
          <span className="block font-mono text-xs" style={{ color: C.faint }}>
            {r.dir}
          </span>
        </td>
        <td className="px-3 py-2">
          <Tag state={r.state} text={tagText(r)} />
        </td>
        <td className="px-3 py-2 text-right text-base font-bold" style={{ color: C.blue }}>
          {nf(r.in_wh)}
        </td>
        <td className="px-3 py-2 text-right text-base font-bold" style={{ color: C.brand }}>
          {nf(r.on_truck)}
        </td>
        <td className="px-3 py-2 text-right font-mono text-xs">{nf(r.work)}</td>
        <td className="px-3 py-2 text-right">
          <Delta now={r.work} prev={r.chg === null ? null : r.work - r.chg} />
        </td>
        <td className="px-3 py-2 text-right font-mono text-xs">{r.trucks || '—'}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="px-3 py-3" style={{ background: C.panel2 }}>
            <TruckList r={r} />
          </td>
        </tr>
      )}
    </>
  )
}

function TruckList({ r }: { r: OutCalc }) {
  const lateSet = new Set(r.late.map((x) => x.at))
  const soonSet = new Set(r.soon.map((x) => x.at))
  return (
    <>
      <div className="mb-2 flex flex-wrap gap-3 font-mono text-xs" style={{ color: C.faint }}>
        <span>
          รถยังไม่ปล่อย <b style={{ color: C.ink }}>{r.trucks}</b> · หลัก {r.main_trucks} · เสริม {r.extra_trucks}
        </span>
        <span>
          ยังไม่ปริ้นใบ <b style={{ color: r.no_print ? C.redInk : C.ink }}>{r.no_print}</b>
        </span>
        <span>
          กำลังจัดหา <b style={{ color: C.ink }}>{r.finding}</b>
        </span>
        <span>
          ยังไม่มาถึงฮับ <b style={{ color: C.ink }}>{nf(r.in_transit)}</b> · ของต้นทาง
        </span>
      </div>
      <p className="mb-1 font-bold">รถของสาขานี้ {r.trucks_list.length} คัน</p>
      {r.trucks_list.length === 0 && (
        <p className="text-sm" style={{ color: C.faint }}>
          รอบนี้ไม่มีรถในแผน
        </p>
      )}
      <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {r.trucks_list.map((tk, i) => {
          const isLate = !tk.p && lateSet.has(tk.at)
          const isSoon = !tk.p && soonSet.has(tk.at)
          return (
            <li key={i} className="flex items-center gap-2 rounded-lg px-2 py-1" style={{ background: C.bg }}>
              <span
                className="font-mono text-sm font-bold"
                style={{ color: isLate ? C.redInk : isSoon ? C.amberInk : C.ink }}
              >
                {tk.at.slice(11, 16)}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs" style={{ color: C.faint }}>
                {tk.v ?? '—'}
              </span>
              <span
                className="whitespace-nowrap rounded px-2 py-[1px] font-mono text-[11px]"
                style={{
                  background: tk.p ? C.greenBg : isLate ? C.redBg : isSoon ? C.amberBg : C.chip,
                  color: tk.p ? C.greenInk : isLate ? C.redInk : isSoon ? C.amberInk : C.mute,
                }}
              >
                {tk.p ? 'ปริ้นแล้ว' : isLate ? 'เลยเวลา' : isSoon ? 'ใกล้ถึง' : 'ยังไม่ปริ้น'}
              </span>
            </li>
          )
        })}
      </ul>
    </>
  )
}

/* ---------------------------------------------------------- โหมดจอทีวี */

function TvView({ rows, snapAt, tick }: { rows: OutCalc[]; snapAt: string; tick: number }) {
  const [auto, setAuto] = useState(true)
  const [open, setOpen] = useState<string | null>(null)
  const lh = useRef<HTMLDivElement>(null)
  const fd = useRef<HTMLDivElement>(null)

  /* เลื่อนทีละแถวทุกสามวินาที · ถึงล่างแล้ววนกลับบน
     ไม่กระโดดทีละหน้า เพราะคนที่กำลังอ่านแถวล่างจะเสียที่อ่านทุกครั้ง */
  useEffect(() => {
    if (!auto || open) return
    const step = () => {
      for (const b of [lh.current, fd.current]) {
        if (!b) continue
        const items = [...b.querySelectorAll<HTMLElement>('[data-row]')]
        if (items.length < 2) continue
        const bottom = b.scrollHeight - b.clientHeight
        if (bottom <= 2) continue
        const next = items.find((el) => el.offsetTop > b.scrollTop + 4)
        b.scrollTo({ top: !next || b.scrollTop >= bottom - 2 ? 0 : next.offsetTop, behavior: 'smooth' })
      }
    }
    const id = setInterval(step, 3000)
    return () => clearInterval(id)
  }, [auto, open, tick, rows])

  const mask =
    'linear-gradient(180deg, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%)'

  return (
    <div>
      <div
        className="mb-3 flex flex-wrap items-center gap-3 rounded-xl px-3 py-2"
        style={{ background: C.panel, border: `1px solid ${C.line2}` }}
      >
        <span className="text-sm" style={{ color: C.mute }}>
          รอบของไฟล์
        </span>
        <b className="font-mono text-lg">{thDT(snapAt)}</b>
        <label className="ml-auto flex items-center gap-2 text-sm" style={{ color: C.mute }}>
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
          const g = rows
            .filter((r) => r.dir === d)
            .sort((a, b) => OUT_RANK[a.state] - OUT_RANK[b.state] || b.work - a.work)
          const gi = g.reduce((n, r) => n + r.in_wh, 0)
          const go = g.reduce((n, r) => n + r.on_truck, 0)
          const bad = g.filter((r) => r.late.length || r.soon.length).length
          return (
            <div
              key={d}
              className="rounded-2xl p-3"
              style={{ background: C.panel, border: `2px solid ${d === 'LH' ? '#27405A' : '#4A3C14'}` }}
            >
              <h3 className="mb-2 flex flex-wrap items-baseline gap-2 text-xl font-extrabold">
                {LANE[d]}
                <span className="text-sm font-normal" style={{ color: C.mute }}>
                  {g.length} สาขา{bad ? ` · ต้องดู ${bad}` : ''}
                </span>
              </h3>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl p-2" style={{ background: C.bg, border: `1px solid ${C.line2}` }}>
                  <span className="block text-sm" style={{ color: C.mute }}>
                    เข้าคลัง ไม่สแกนออก
                  </span>
                  <span className="block text-4xl font-extrabold leading-none" style={{ color: C.blue }}>
                    {nf(gi)}
                  </span>
                </div>
                <div className="rounded-xl p-2" style={{ background: C.bg, border: `1px solid ${C.line2}` }}>
                  <span className="block text-sm" style={{ color: C.mute }}>
                    สแกนออก รถไม่ออก
                  </span>
                  <span className="block text-4xl font-extrabold leading-none" style={{ color: C.brand }}>
                    {nf(go)}
                  </span>
                </div>
              </div>
              <div
                ref={d === 'LH' ? lh : fd}
                className="space-y-[6px] overflow-hidden"
                style={{ maxHeight: '58vh', scrollBehavior: 'smooth', maskImage: mask, WebkitMaskImage: mask }}
              >
                {g.map((r) => (
                  <TvRow
                    key={r.station}
                    r={r}
                    open={open === r.station}
                    onToggle={() => setOpen(open === r.station ? null : r.station)}
                  />
                ))}
                {g.length === 0 && (
                  <p className="text-sm" style={{ color: C.faint }}>
                    ไม่มีสาขาในสายนี้
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TvRow({ r, open, onToggle }: { r: OutCalc; open: boolean; onToggle: () => void }) {
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
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left"
        style={{
          background: C.bg,
          border: `2px solid ${C.line2}`,
          borderLeftWidth: 6,
          borderLeftColor: EDGE[r.state],
        }}
      >
        <span className="min-w-0 flex-1">
          <b className="block break-words text-lg font-extrabold leading-tight">{r.station}</b>
          {foot && (
            <span className="block font-mono text-xs" style={{ color: C.faint }}>
              {foot}
            </span>
          )}
        </span>
        <span className="shrink-0 text-right" style={{ minWidth: 84 }}>
          <em className="block text-2xl font-extrabold not-italic leading-none" style={{ color: C.blue }}>
            {nf(r.in_wh)}
          </em>
          <Delta now={r.in_wh} prev={r.prev_in} />
        </span>
        <span className="shrink-0 text-right" style={{ minWidth: 84 }}>
          <em className="block text-2xl font-extrabold not-italic leading-none" style={{ color: C.brand }}>
            {nf(r.on_truck)}
          </em>
          <Delta now={r.on_truck} prev={r.prev_on} />
        </span>
        <Tag state={r.state} text={tagText(r)} />
      </button>
      {open && (
        <div className="mt-1 rounded-xl p-3" style={{ background: C.panel2, border: `1px solid ${C.line2}` }}>
          <TruckList r={r} />
        </div>
      )}
    </div>
  )
}
