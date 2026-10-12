import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import { Spinner } from '../../components/ui'
import { readableError } from '../../lib/supabase'
import {
  OUT_RANK,
  OUT_STATE_TH,
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
 * จุดประสงค์มีข้อเดียว · ดูสองตัวเลขนี้ให้เห็นเร็วที่สุด
 *   เข้าคลังแต่ไม่สแกนออก · สแกนออกแต่รถไม่ออก
 * ที่เหลือเป็นของประกอบ อันไหนแย่งความสนใจจากสองตัวนี้ต้องตัดทิ้ง
 *
 * สามหน้า
 *   หน้าหลัก  ตัวเลขรวม แล้วกราฟแท่งสองฝั่ง LH ซ้าย FD ขวา
 *   จอทีวี    เวลาอัปเดต สาขาที่หนักสุดของแต่ละตัวเลข และบันไดรายสาขาแยกสาย
 *   ตาราง     ค้นหาเจาะสาขา แทนการ VLOOKUP ในไฟล์
 *
 * หน้าหลัก จอทีวี และจอโซน D0 สลับกันเองได้ เพื่อเปิดค้างบนจอในคลังโดยไม่ต้องมีคนกด
 *
 * ชุดสีเดียวกับตารางปล่อยรถและรถรอลงงาน เพราะเป็นจอประเภทเดียวกัน
 * เปิดให้เจ้าของระบบกับผู้ดูแลระบบ · ด่านจริงอยู่ที่ RLS ของ hub_out_* ที่ตรวจ my_can_outbox()
 */

const C = {
  bg: '#0B0E11',
  panel: '#121820',
  panel2: '#151C26',
  groove: '#0A0E13',
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
  greenBg: '#11301F',
  greenInk: '#8FE8BC',
  green: '#35D98A',
  /* สายหลัก ฟ้า · สายรอง เหลือง · สามเฉดต่อสาย ไว้ไล่สีให้แท่งนูน */
  lh: '#4FA3E3',
  lhHi: '#9BD4FF',
  lhLo: '#1E5C92',
  fd: '#F0B21E',
  fdHi: '#FFE089',
  fdLo: '#9A6E06',
}

const LANE: Record<'LH' | 'FD', string> = { LH: 'สายหลัก LH', FD: 'สายรอง FD' }
/**
 * คำจีนกำกับ · ใช้คำเดียวกับที่อยู่ในไฟล์ต้นทางของบริษัท
 *
 * หน้างานเปิดไฟล์ต้นฉบับที่เป็นจีนล้วนอยู่ทุกวัน พอมาดูจอไทยแล้วต้องแปลในหัวเอง
 * ว่าหัวข้อไหนตรงกับคอลัมน์ไหน · ใส่คำจีนที่ใช้ในไฟล์ไว้ข้าง ๆ เลย จะได้เทียบได้ทันที
 * ไม่ได้แปลเอาเอง แต่หยิบคำจากหัวคอลัมน์ในไฟล์มาตรง ๆ เช่น 入仓未发出单量 กับ 装车未出港单量
 */
const CN = {
  lane: { LH: '干线', FD: '支线' } as Record<'LH' | 'FD', string>,
  inWh: '入仓未发出',
  onTruck: '装车未出港',
  station: '下一站网点',
  update: '更新时间',
  zone: 'D0 分区',
}
const DAY_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const p2 = (n: number) => String(n).padStart(2, '0')
const nf = (n: number) => n.toLocaleString('th-TH')

function thFull(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getDate()} ${TH_MON[d.getMonth()]} ${String((d.getFullYear() + 543) % 100)} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

/** การ์ดมาตรฐานของหน้านี้ · ไล่สีอ่อน ๆ กับเงาใต้การ์ด ให้ลอยขึ้นจากพื้น */
const CARD: React.CSSProperties = {
  borderRadius: 16,
  border: `1px solid ${C.line2}`,
  background:
    'radial-gradient(120% 90% at 50% -20%, rgba(255,255,255,.045), transparent 60%), linear-gradient(180deg, #161D27, #10151C)',
  boxShadow: '0 18px 40px -22px #000, inset 0 1px 0 rgba(255,255,255,.05)',
}

function Delta({ now, prev, big }: { now: number; prev: number | null; big?: boolean }) {
  const cls = big ? 'font-mono text-sm' : 'font-mono text-xs'
  if (prev === null)
    return (
      <span className={cls} style={{ color: C.faint }}>
        สาขาใหม่
      </span>
    )
  const d = now - prev
  if (d === 0)
    return (
      <span className={cls} style={{ color: C.faint }}>
        เท่าเดิม
      </span>
    )
  return (
    <span className={cls} style={{ color: d > 0 ? C.redInk : C.greenInk }}>
      {d > 0 ? `▲ +${nf(d)}` : `▼ ${nf(d)}`}
    </span>
  )
}

function Tag({ state, text }: { state: OutState; text: string }) {
  if (!text) return null
  const bg = state === 'late' ? C.redBg : state === 'soon' ? C.amberBg : state === 'clear' ? C.greenBg : C.chip
  const fg = state === 'late' ? C.redInk : state === 'soon' ? C.amberInk : state === 'clear' ? C.greenInk : C.lhHi
  return (
    <span
      className="inline-block whitespace-nowrap rounded-md px-2 py-[2px] font-mono text-xs"
      style={{ background: bg, color: fg }}
    >
      {text}
    </span>
  )
}

/**
 * โซนที่จะโชว์ของแถวนี้
 *
 * สายหลักไม่มีโซน D0 อยู่แล้วเพราะเป็นรถหลัก ไม่ได้ขึ้นสายพานคัดแยก
 * จึงเขียนว่า LH ไปตรง ๆ ตามที่เจ้าของระบบสั่ง ไม่ใช่ปล่อยว่างหรือขึ้นว่าไม่มีโซน
 * เหลือคำว่าไม่มีโซนไว้เฉพาะสายรองที่ยังไม่ได้ตั้ง ซึ่งเป็นงานค้างจริงที่ต้องไปตั้งที่หลังบ้าน
 */
function zoneOf(r: { zone: string | null; dir: 'LH' | 'FD' }): string | null {
  const z = r.zone?.trim()
  if (z) return z
  return r.dir === 'LH' ? 'LH' : null
}

/**
 * ป้ายโซน · ติดทุกที่ที่มีชื่อสาขา
 *
 * สายหลักใช้ฟ้าของสายหลัก ส่วนโซน D0x ใช้ฟ้าเข้ม แยกให้เห็นว่าคนละชนิดกัน
 * อันหนึ่งคือสาย อีกอันคือสายพาน
 */
function Zone({ z, dim, big, huge }: { z: string | null; dim?: boolean; big?: boolean; huge?: boolean }) {
  const box = huge
    ? 'shrink-0 self-center rounded-xl px-5 py-3 text-center font-mono text-4xl font-extrabold leading-none'
    : big
      ? 'shrink-0 rounded-lg px-3 py-[6px] text-center font-mono text-base font-extrabold'
      : 'rounded px-[5px] py-[1px] font-mono text-[10px] font-bold'
  const w = huge ? { minWidth: 126 } : big ? { minWidth: 66 } : undefined

  if (!z)
    return (
      <span
        className={huge ? box.replace('text-4xl', 'text-base') : box}
        style={{ background: C.chip, color: C.faint, ...w }}
      >
        ไม่มีโซน
      </span>
    )
  if (z === 'LH')
    return (
      <span className={box} style={{ background: dim ? C.chip : '#10263C', color: C.lhHi, ...w }}>
        LH
      </span>
    )
  return (
    <span className={box} style={{ background: dim ? C.chip : '#1E3246', color: '#8FD0FF', ...w }}>
      {z}
    </span>
  )
}

/** คำจีนตัวเล็กสีจาง · อยู่ข้างคำไทยเสมอ ไม่ได้มาแทนที่ */
function Cn({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-normal" style={{ color: C.faint, fontSize: '0.78em' }}>
      {children}
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

/** ร่องของแท่ง · จมลงไปในพื้น ให้แท่งที่อยู่ข้างในดูลอยขึ้นมา */
const groove: React.CSSProperties = {
  borderRadius: 7,
  background: C.groove,
  boxShadow: 'inset 0 2px 4px rgba(0,0,0,.65), inset 0 -1px 0 rgba(255,255,255,.035)',
}

/** แท่งนูน · ไล่สีบนลงล่าง ขอบบนสว่าง ใต้แท่งมีเงา */
function barStyle(lane: 'LH' | 'FD', side: 'l' | 'r', pct: number): React.CSSProperties {
  const [hi, mid, lo] = lane === 'LH' ? [C.lhHi, C.lh, C.lhLo] : [C.fdHi, C.fd, C.fdLo]
  return {
    width: `${Math.max(1.5, pct)}%`,
    height: '100%',
    background: `linear-gradient(180deg, ${hi} 0%, ${mid} 38%, ${lo} 100%)`,
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,.55), inset 0 -2px 3px rgba(0,0,0,.35), 0 3px 7px -2px rgba(0,0,0,.75)',
    borderRadius: side === 'l' ? '7px 0 0 7px' : '0 7px 7px 0',
  }
}

export default function OutBox() {
  const nav = useNavigate()
  const board = useAsync(() => outBoard(), [])
  const [page, setPage] = useState<'main' | 'tv' | 'zone' | 'table'>('main')
  const [swap, setSwap] = useState(true)
  const [swapSec, setSwapSec] = useState(20)
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

  /* สลับสามหน้าจอวนไปเรื่อย ๆ · ไม่แตะหน้าตาราง เพราะหน้านั้นคนกำลังค้นอยู่
     ถ้าสลับทิ้งกลางคันตอนเขาพิมพ์ค้นหา คือแย่งงานจากมือคน */
  useEffect(() => {
    if (!swap || page === 'table') return
    const t = setInterval(
      () => setPage((p) => (p === 'main' ? 'tv' : p === 'tv' ? 'zone' : 'main')),
      swapSec * 1000,
    )
    return () => clearInterval(t)
  }, [swap, swapSec, page])

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
      waiting: sum((r) => r.waiting),
      inTransit: sum((r) => r.in_transit),
    }
  }, [rows])

  const topIn = useMemo(() => [...rows].sort((a, b) => b.in_wh - a.in_wh)[0] ?? null, [rows])
  const topOut = useMemo(() => [...rows].sort((a, b) => b.on_truck - a.on_truck)[0] ?? null, [rows])

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
        `บันทึกรอบ ${thFull(parsed.snapIso)} แล้ว · ${res.rows} สาขา · ${res.trucks} คัน ` +
          `(ปริ้นใบแล้ว ${parsed.printed} ยังไม่ปริ้น ${parsed.notPrinted})`,
      )
      board.reload()
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
        ? `${Math.floor(ageMin / 60)} ชั่วโมง ${ageMin % 60} นาทีที่แล้ว`
        : `${Math.floor(ageMin / 1440)} วันที่แล้ว`
  const vs = snap?.prev_at ? `เทียบรอบ ${thFull(snap.prev_at)}` : 'ยังไม่มีรอบก่อนหน้าให้เทียบ'

  const field = { background: C.panel2, border: `1px solid ${C.line2}`, color: C.ink }
  const tabOn = { background: C.brand, color: C.bg, fontWeight: 700 }
  const tabOff = { background: C.chip, color: C.mute }

  return (
    <div className="min-h-dvh" style={{ background: C.bg, color: C.ink }}>
      <header
        className="safe-t sticky top-0 z-20 flex flex-wrap items-center gap-3 px-4 py-3"
        style={{ background: C.bg, borderBottom: `1px solid ${C.line}` }}
      >
        <button type="button" aria-label="ย้อนกลับ" className="h-tap w-tap rounded-btn text-xl" style={{ color: C.mute }} onClick={() => nav('/')}>
          ←
        </button>
        <span className="rounded-md px-2.5 py-1 text-sm font-extrabold" style={{ background: C.brand, color: C.bg }}>
          FLASH
        </span>
        <span className="text-lg font-bold">
            ของค้างส่งออก <Cn>发车监控</Cn> · 21BPL
          </span>
        <span className="flex-1" />
        <span className="text-sm" style={{ color: C.mute }}>
          {DAY_TH[clock.getDay()]} {clock.getDate()} {TH_MON[clock.getMonth()]} {String((clock.getFullYear() + 543) % 100)}
        </span>
        <span className="font-mono text-xl font-bold" style={{ color: C.brand }}>
          {p2(clock.getHours())}:{p2(clock.getMinutes())}:{p2(clock.getSeconds())}
        </span>
      </header>

      <div className="px-4 py-4">
        {/* ───────── อัปไฟล์ · สลับหน้า ───────── */}
        <section className="mb-3 flex flex-wrap items-center gap-3 px-3 py-3" style={{ ...CARD, borderLeft: `4px solid ${C.brand}` }}>
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => void pickFile(e.target.files?.[0] ?? null)} />
          <button
            type="button"
            className="h-tap rounded-btn px-5 font-bold"
            style={{ background: C.brand, color: C.bg, opacity: busy ? 0.6 : 1 }}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? <Spinner /> : null} อัปไฟล์รอบใหม่ <Cn>上传新一轮</Cn>
          </button>
          <span className="text-sm" style={{ color: C.mute }}>
            {snap ? `${snap.row_count} สาขา · ${snap.truck_count} คัน` : 'ยังไม่มีข้อมูล'}
          </span>
          <span className="flex-1" />

          <label className="flex items-center gap-2 text-sm" style={{ color: C.mute }}>
            <input type="checkbox" className="h-[18px] w-[18px]" checked={swap} onChange={(e) => setSwap(e.target.checked)} />
            สลับหน้าเอง <Cn>自动切换</Cn>
          </label>
          <select
            className="h-tap rounded-btn px-2 text-sm"
            style={field}
            value={swapSec}
            aria-label="สลับทุกกี่วินาที"
            disabled={!swap}
            onChange={(e) => setSwapSec(Number(e.target.value))}
          >
            <option value={10}>ทุก 10 วิ</option>
            <option value={20}>ทุก 20 วิ</option>
            <option value={30}>ทุก 30 วิ</option>
            <option value={60}>ทุก 60 วิ</option>
          </select>

          <div className="flex flex-wrap gap-2">
            {([
              ['main', 'หน้าหลัก', '主页'],
              ['tv', 'จอทีวี', '电视屏'],
              ['zone', 'จอโซน D0', 'D0 分区屏'],
              ['table', 'ตาราง', '表格'],
            ] as const).map(([k, label, cn]) => (
              <button key={k} type="button" className="h-tap rounded-btn px-4 text-sm" style={page === k ? tabOn : tabOff} onClick={() => setPage(k)}>
                {label} <Cn>{cn}</Cn>
              </button>
            ))}
            {lastId !== null && (
              <button
                type="button"
                className="h-tap rounded-btn px-3 text-sm"
                style={tabOff}
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

        {msg && <p className="mb-3 rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(53,217,138,.12)', color: C.greenInk }}>{msg}</p>}
        {err && <p className="mb-3 rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(255,92,92,.12)', color: C.redInk }}>{err}</p>}
        {board.loading && <p style={{ color: C.mute }}>กำลังโหลด…</p>}
        {board.error && <p className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,92,92,.12)', color: C.redInk }}>{board.error}</p>}
        {!board.loading && !snap && (
          <p className="py-16 text-center text-lg" style={{ ...CARD, color: C.mute }}>
            ยังไม่เคยอัปไฟล์ · กดปุ่มด้านบนเพื่อเริ่ม
          </p>
        )}

        {/* ═══════════════════════ หน้าหลัก */}
        {snap && page === 'main' && (
          <>
            <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <BigTile
                label={<>เข้าคลังแต่ไม่สแกนออก <Cn>{CN.inWh}</Cn></>}
                n={t.inWh}
                prev={t.pIn}
                color={C.lhHi}
                edge={C.lh}
                vs={vs}
              />
              <BigTile
                label={<>สแกนออกแต่รถไม่ออก <Cn>{CN.onTruck}</Cn></>}
                n={t.onTruck}
                prev={t.pOn}
                color={C.fdHi}
                edge={C.fd}
                vs={vs}
              />
              <div className="p-3" style={CARD}>
                <span className="block text-sm" style={{ color: C.mute }}>
                  รถยังไม่ปล่อยตามแผน <Cn>未发车</Cn>
                </span>
                <span className="mt-1 block text-4xl font-extrabold leading-none">{nf(t.trucks)}</span>
                <span className="text-xs" style={{ color: C.faint }}>
                  คัน · รอส่งออกทั้งหมด {nf(t.waiting)} · ยังไม่ถึงฮับ {nf(t.inTransit)}
                </span>
              </div>
              <UpdateCard snapAt={snap.snap_at} uploadedAt={snap.uploaded_at} ageTxt={ageTxt} warn={ageMin > 45} />
            </div>

            <div className="mb-3 grid gap-3 lg:grid-cols-2">
              <ZoneRank rows={rows} vs={vs} />
              <ZoneTop rows={rows} />
            </div>

            <TwoSide rows={rows} metric="in_wh" title={<>เข้าคลังแต่ไม่สแกนออก <Cn>{CN.inWh}</Cn></>} vs={vs} />
            <div className="h-3" />
            <TwoSide rows={rows} metric="on_truck" title={<>สแกนออกแต่รถไม่ออก <Cn>{CN.onTruck}</Cn></>} vs={vs} />
          </>
        )}

        {/* ═══════════════════════ จอทีวี */}
        {snap && page === 'tv' && (
          <>
            <div className="mb-3 grid gap-3 lg:grid-cols-3">
              <UpdateCard snapAt={snap.snap_at} uploadedAt={snap.uploaded_at} ageTxt={ageTxt} warn={ageMin > 45} big />
              <TopOne label={<>เข้าคลังแต่ไม่สแกนออก เยอะสุด <Cn>{CN.inWh}最多</Cn></>} r={topIn} value={(x) => x.in_wh} prev={(x) => x.prev_in} color={C.lhHi} edge={C.lh} />
              <TopOne label={<>สแกนออกแต่รถไม่ออก เยอะสุด <Cn>{CN.onTruck}最多</Cn></>} r={topOut} value={(x) => x.on_truck} prev={(x) => x.prev_on} color={C.fdHi} edge={C.fd} />
            </div>
            <Ladders rows={rows} />
          </>
        )}

        {/* ═══════════════════════ จอโซน D0 */}
        {snap && page === 'zone' && <ZoneTv rows={rows} vs={vs} />}

        {/* ═══════════════════════ ตาราง */}
        {snap && page === 'table' && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                className="h-tap min-w-[180px] flex-1 rounded-btn px-3 text-sm"
                style={{ ...field, maxWidth: 300 }}
                type="search"
                placeholder="พิมพ์ชื่อสาขา — แทนการ VLOOKUP"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <select className="h-tap rounded-btn px-3 text-sm" style={field} value={dir} aria-label="สาย" onChange={(e) => setDir(e.target.value)}>
                <option value="">ทุกสาย</option>
                <option value="LH">สายหลัก LH 干线</option>
                <option value="FD">สายรอง FD 支线</option>
              </select>
              <select className="h-tap rounded-btn px-3 text-sm" style={field} value={sort} aria-label="เรียงตาม" onChange={(e) => setSort(e.target.value)}>
                <option value="work">ค้างรวมมากสุด</option>
                <option value="in">เข้าคลังไม่สแกนออก</option>
                <option value="out">สแกนออกแต่รถไม่ออก</option>
                <option value="chg">ค้างเพิ่มมากสุด</option>
                <option value="clr">เคลียร์ได้มากสุด</option>
              </select>
              <label className="flex min-h-tap items-center gap-2 text-sm" style={{ color: C.mute }}>
                <input type="checkbox" className="h-[18px] w-[18px]" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} />
                เฉพาะที่มีปัญหา
              </label>
              <span className="font-mono text-xs" style={{ color: C.faint }}>
                {shown.length} สาขา · {vs}
              </span>
            </div>

            <section className="overflow-x-auto p-2" style={CARD}>
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.line}`, color: C.faint }}>
                    <th className="px-3 py-2 text-xs font-medium">
                      สาขาปลายทาง <Cn>{CN.station}</Cn>
                    </th>
                    <th className="w-[150px] px-3 py-2 text-xs font-medium">
                      สถานะ <Cn>状态</Cn>
                    </th>
                    <th className="w-[200px] px-3 py-2 text-xs font-medium" style={{ color: C.lhHi }}>
                      เข้าคลัง ไม่สแกนออก <Cn>{CN.inWh}</Cn>
                    </th>
                    <th className="w-[200px] px-3 py-2 text-xs font-medium" style={{ color: C.fdHi }}>
                      สแกนออก รถไม่ออก <Cn>{CN.onTruck}</Cn>
                    </th>
                    <th className="w-[110px] px-3 py-2 text-right text-xs font-medium">
                      เทียบรอบก่อน <Cn>对比上轮</Cn>
                    </th>
                    <th className="w-[70px] px-3 py-2 text-right text-xs font-medium">
                      รถยังไม่ปล่อย <Cn>未发车</Cn>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <RowItem
                      key={r.dir + r.station}
                      r={r}
                      max={Math.max(1, ...shown.map((x) => Math.max(x.in_wh, x.on_truck)))}
                      open={open === r.station}
                      onToggle={() => setOpen(open === r.station ? null : r.station)}
                    />
                  ))}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center" style={{ color: C.faint }}>
                        ไม่พบสาขาตามเงื่อนไข
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- การ์ด */

function BigTile({ label, n, prev, color, edge, vs }: { label: React.ReactNode; n: number; prev: number; color: string; edge: string; vs: string }) {
  const d = n - prev
  return (
    <div className="p-3" style={{ ...CARD, border: `2px solid ${edge}` }}>
      <span className="block text-sm font-semibold" style={{ color: C.mute }}>
        {label}
      </span>
      <span className="mt-1 block text-5xl font-extrabold leading-none" style={{ color, textShadow: `0 0 22px ${edge}44` }}>
        {nf(n)}
      </span>
      <span className="mt-1 block font-mono text-sm" style={{ color: d > 0 ? C.redInk : d < 0 ? C.greenInk : C.faint }}>
        {d > 0 ? `▲ +${nf(d)}` : d < 0 ? `▼ ${nf(d)}` : 'เท่าเดิม'}
      </span>
      <span className="block text-[11px]" style={{ color: C.faint }}>
        {vs}
      </span>
    </div>
  )
}

function UpdateCard({
  snapAt,
  uploadedAt,
  ageTxt,
  warn,
  big,
}: {
  snapAt: string
  uploadedAt: string
  ageTxt: string
  warn: boolean
  big?: boolean
}) {
  return (
    <div className="p-3" style={{ ...CARD, border: `2px solid ${warn ? C.amber : C.line2}` }}>
      <span className="block text-sm" style={{ color: C.mute }}>
        อัปเดตล่าสุด <Cn>{CN.update}</Cn>
      </span>
      <span className={`mt-1 block font-mono font-extrabold leading-tight ${big ? 'text-3xl' : 'text-2xl'}`}>
        {thFull(snapAt)}
      </span>
      <span className="text-xs" style={{ color: warn ? C.amberInk : C.faint }}>
        {ageTxt}
      </span>
      <span className="block font-mono text-[11px]" style={{ color: C.faint }}>
        อัปเข้าระบบ {thFull(uploadedAt)}
      </span>
    </div>
  )
}

/** สาขาที่หนักสุดของตัวเลขหนึ่งตัว · ชื่อใหญ่ ตัวเลขใหญ่กว่า อ่านจากไกลได้ */
function TopOne({
  label,
  r,
  value,
  prev,
  color,
  edge,
}: {
  label: React.ReactNode
  r: OutCalc | null
  value: (x: OutCalc) => number
  prev: (x: OutCalc) => number | null
  color: string
  edge: string
}) {
  return (
    <div className="flex items-stretch gap-3 p-3" style={{ ...CARD, border: `2px solid ${edge}` }}>
      <div className="min-w-0 flex-1">
        <span className="block text-sm font-semibold" style={{ color: C.mute }}>
          {label}
        </span>
        {r ? (
          <>
            <span className="mt-1 block break-words text-xl font-extrabold leading-tight">{r.station}</span>
            <span className="block font-mono text-xs" style={{ color: C.faint }}>
              {LANE[r.dir]} {CN.lane[r.dir]}
            </span>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="text-5xl font-extrabold leading-none" style={{ color, textShadow: `0 0 22px ${edge}44` }}>
                {nf(value(r))}
              </span>
              <Delta now={value(r)} prev={prev(r)} big />
            </div>
          </>
        ) : (
          <span className="text-sm" style={{ color: C.faint }}>
            ยังไม่มีข้อมูล
          </span>
        )}
      </div>
      {/* โซนตัวใหญ่อยู่ขวามือ · ที่ว่างข้างชื่อสาขาคือจุดที่ตาไปถึงอยู่แล้ว
          และเป็นคำถามแรกที่คนดูถาม ว่าสาขาที่หนักสุดอยู่สายพานไหน */}
      {r && <Zone z={zoneOf(r)} huge />}
    </div>
  )
}

/* ------------------------------------------------------------- โซน D0x */

/** รวมยอดของแต่ละโซน · สาขาที่ยังไม่ตั้งโซนรวมเป็นกลุ่ม "ไม่มีโซน" ไม่ได้ถูกทิ้ง */
function byZone(rows: OutCalc[]) {
  const m = new Map<string, { zone: string | null; inWh: number; onTruck: number; pIn: number; pOn: number; n: number; top: OutCalc | null }>()
  for (const r of rows) {
    const k = zoneOf(r) ?? ''
    const cur = m.get(k) ?? { zone: zoneOf(r), inWh: 0, onTruck: 0, pIn: 0, pOn: 0, n: 0, top: null }
    cur.inWh += r.in_wh
    cur.onTruck += r.on_truck
    cur.pIn += r.prev_in ?? 0
    cur.pOn += r.prev_on ?? 0
    cur.n += 1
    if (!cur.top || r.in_wh + r.on_truck > cur.top.in_wh + cur.top.on_truck) cur.top = r
    m.set(k, cur)
  }
  return [...m.values()].sort((a, b) => b.inWh + b.onTruck - (a.inWh + a.onTruck))
}

/** อันดับโซน · สองแท่งต่อโซน ฟ้าคือเข้าคลัง เหลืองคือรถไม่ออก */
function ZoneRank({ rows, vs }: { rows: OutCalc[]; vs: string }) {
  const g = useMemo(() => byZone(rows), [rows])
  const max = Math.max(1, ...g.map((x) => Math.max(x.inWh, x.onTruck)))
  return (
    <section className="p-4" style={CARD}>
      <h2 className="mb-1 text-lg font-extrabold">
        อันดับโซน D0 <Cn>D0 分区排名</Cn>
      </h2>
      <p className="mb-3 text-[11px]" style={{ color: C.faint }}>
        รวมยอดของทุกสาขาในโซนนั้น · สายหลักไม่มีโซนจึงรวมเป็น LH · เรียงจากค้างรวมมากสุด · {vs}
      </p>
      <ul className="space-y-3">
        {g.map((x) => (
          <li key={x.zone ?? 'none'}>
            <div className="mb-1 flex items-baseline gap-2">
              <Zone z={x.zone} />
              <span className="text-sm" style={{ color: C.faint }}>
                {x.n} สาขา
              </span>
              <span className="flex-1" />
              <span className="font-mono text-sm font-bold">{nf(x.inWh + x.onTruck)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-[62px] shrink-0 text-right font-mono text-sm font-bold" style={{ color: C.lhHi }}>
                {nf(x.inWh)}
              </span>
              <span className="flex h-[14px] flex-1" style={groove}>
                <i style={barStyle('LH', 'r', (x.inWh / max) * 100)} />
              </span>
              <Delta now={x.inWh} prev={x.pIn} />
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="w-[62px] shrink-0 text-right font-mono text-sm font-bold" style={{ color: C.fdHi }}>
                {nf(x.onTruck)}
              </span>
              <span className="flex h-[14px] flex-1" style={groove}>
                <i style={barStyle('FD', 'r', (x.onTruck / max) * 100)} />
              </span>
              <Delta now={x.onTruck} prev={x.pOn} />
            </div>
          </li>
        ))}
        {g.length === 0 && (
          <li className="text-sm" style={{ color: C.faint }}>
            ยังไม่มีข้อมูล
          </li>
        )}
      </ul>
    </section>
  )
}

/** สาขาที่หนักสุดของแต่ละโซน · ตอบว่าในโซนนั้นต้องไปที่สาขาไหนก่อน */
function ZoneTop({ rows }: { rows: OutCalc[] }) {
  const g = useMemo(() => byZone(rows), [rows])
  return (
    <section className="p-4" style={CARD}>
      <h2 className="mb-1 text-lg font-extrabold">
        สาขาสูงสุดของแต่ละโซน <Cn>各分区最高网点</Cn>
      </h2>
      <p className="mb-3 text-[11px]" style={{ color: C.faint }}>
        ในโซนนั้นต้องไปที่สาขาไหนก่อน
      </p>
      <ul className="space-y-2">
        {g.map((x) =>
          x.top ? (
            <li
              key={x.zone ?? 'none'}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
              style={{ borderRadius: 11, background: C.groove, border: `1px solid ${C.line2}` }}
            >
              <Zone z={x.zone} />
              <span className="min-w-0 flex-1 break-words text-[15px] font-bold leading-tight">{x.top.station}</span>
              <span className="text-right">
                <em className="block text-xl font-extrabold not-italic leading-none" style={{ color: C.lhHi }}>
                  {nf(x.top.in_wh)}
                </em>
                <span className="font-mono text-[10px]" style={{ color: C.faint }}>
                  เข้าคลัง
                </span>
              </span>
              <span className="text-right">
                <em className="block text-xl font-extrabold not-italic leading-none" style={{ color: C.fdHi }}>
                  {nf(x.top.on_truck)}
                </em>
                <span className="font-mono text-[10px]" style={{ color: C.faint }}>
                  รถไม่ออก
                </span>
              </span>
            </li>
          ) : null,
        )}
        {g.length === 0 && (
          <li className="text-sm" style={{ color: C.faint }}>
            ยังไม่มีข้อมูล
          </li>
        )}
      </ul>
    </section>
  )
}

/* --------------------------------------------------------- จอโซน D0 */

/**
 * ทุกโซนอยู่ในจอเดียว ไม่มีเลื่อน ไม่มีสลับ
 *
 * เจ้าของระบบสั่งให้จบในจอเดียว เหตุผลคือคำถามของคนดูคือ "ตอนนี้โซนไหนหนัก"
 * ซึ่งเป็นคำถามเปรียบเทียบ · ถ้าโชว์ทีละโซนสลับไปมา คนดูต้องจำตัวเลขโซนก่อนหน้า
 * ไว้ในหัวเองถึงจะตอบได้ ซึ่งไม่มีใครทำ
 *
 * สายหลักไม่ขึ้นจอนี้ เพราะเป็นรถหลักที่ไม่ได้ขึ้นสายพานคัดแยก ไม่มีโซนให้แยก
 * ส่วนสายรองที่ยังไม่ได้ตั้งโซนยังขึ้นเป็นช่องของตัวเอง ไม่ได้ถูกซ่อน
 * ถ้าซ่อน ของค้างก้อนนั้นจะหายไปจากจอโดยไม่มีใครรู้ว่าหายไปไหน
 */
function ZoneTv({ rows, vs }: { rows: OutCalc[]; vs: string }) {
  /**
   * ความสูงของกริดคิดจากที่ว่างจริงที่เหลือ ไม่ใช่ตัวเลขที่เดาเอาไว้
   *
   * เคยใส่เป็นเลขตายตัวแล้วพลาด เพราะแถบหัวจอกับแถบบอกสีสูงไม่เท่ากัน
   * ในแต่ละความกว้างจอ พอเดาผิดไปไม่กี่สิบพิกเซล จอทีวีก็มีแถบเลื่อนโผล่
   * วัดเอาจากตำแหน่งจริงของกริดจบเรื่อง และปรับตามเองเวลาเปลี่ยนขนาดจอ
   */
  const boxRef = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState(0)
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY
      setRoom(Math.max(360, Math.round(window.innerHeight - top - 16)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const zones = useMemo(() => {
    const m = new Map<string, { zone: string | null; list: OutCalc[]; si: number; so: number; pi: number; po: number }>()
    for (const r of rows) {
      const z = zoneOf(r)
      if (z === 'LH') continue
      const k = z ?? ''
      const cur = m.get(k) ?? { zone: z, list: [], si: 0, so: 0, pi: 0, po: 0 }
      cur.list.push(r)
      cur.si += r.in_wh
      cur.so += r.on_truck
      cur.pi += r.prev_in ?? 0
      cur.po += r.prev_on ?? 0
      m.set(k, cur)
    }
    const out = [...m.values()]
    for (const z of out) z.list.sort((a, b) => b.in_wh + b.on_truck - (a.in_wh + a.on_truck))
    return out.sort((a, b) => b.si + b.so - (a.si + a.so))
  }, [rows])

  return (
    <>
      <ZoneKey vs={vs} />
      {/* สองแถวสามช่อง ยืดเต็มความสูงจอ · วัดกับ 1920x1080 แล้วลงพอดีไม่มีแถบเลื่อน
          แถวเป็น minmax(min-content, 1fr) ไม่ใช่ 1fr เฉย ๆ เพราะถ้าเปิดบนจอเตี้ยกว่าทีวี
          ช่องจะบีบจนรายชื่อสาขาหาย · ยอมให้หน้าเลื่อนดีกว่าตัดของที่ค้างทิ้งเงียบ ๆ */}
      <div
        ref={boxRef}
        className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
        style={{
          minHeight: room || undefined,
          gridTemplateRows: 'repeat(2, minmax(min-content, 1fr))',
          gridAutoRows: 'minmax(min-content, 1fr)',
        }}
      >
        {zones.map((z) => (
          <ZonePanel key={z.zone ?? 'none'} z={z} />
        ))}
        {zones.length === 0 && (
          <p className="text-sm" style={{ color: C.faint }}>
            ยังไม่มีข้อมูล
          </p>
        )}
      </div>
    </>
  )
}

/**
 * แถบบอกว่าสีไหนคืออะไร
 *
 * จอนี้ใช้สีสื่อความหมายสามชุดพร้อมกัน คือสีของตัวเลขสองชนิด สีของลูกศรขึ้นลง
 * และสีเทาที่แปลว่าไม่มีของค้าง · คนที่เดินผ่านมาดูครั้งแรกไม่มีทางเดาถูกเอง
 * จึงเขียนไว้บนจอเลย ไม่ใช่ไปอยู่ในคู่มือที่ไม่มีใครเปิด
 */
function ZoneKey({ vs }: { vs: string }) {
  const item = (swatch: React.ReactNode, text: string) => (
    <span className="flex items-center gap-1.5">
      {swatch}
      <span className="text-[12px]" style={{ color: C.mute }}>
        {text}
      </span>
    </span>
  )
  const num = (color: string, text: string) => (
    <span className="rounded px-1.5 py-[1px] font-mono text-[13px] font-bold" style={{ background: C.groove, color }}>
      {text}
    </span>
  )

  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-[5px]"
      style={{ borderRadius: 10, background: C.panel2, border: `1px solid ${C.line2}` }}
    >
      {item(num(C.lhHi, '1,190'), `เข้าคลังแต่ไม่สแกนออก ${CN.inWh}`)}
      {item(num(C.fdHi, '174'), `สแกนออกแต่รถไม่ออก ${CN.onTruck}`)}
      {item(num(C.faint, '0'), 'ไม่มีของค้าง 无积压')}
      <span className="h-[14px] w-px" style={{ background: C.line }} />
      {item(
        <span className="font-mono text-[13px] font-bold" style={{ color: C.green }}>
          ▼
        </span>,
        'น้อยลงกว่ารอบก่อน 比上轮减少',
      )}
      {item(
        <span className="font-mono text-[13px] font-bold" style={{ color: C.red }}>
          ▲
        </span>,
        'มากขึ้นกว่ารอบก่อน 比上轮增加',
      )}
      <span className="flex-1" />
      <span className="text-[11px]" style={{ color: C.faint }}>
        {vs} · ไม่รวมสายหลัก
      </span>
    </div>
  )
}

/** กี่สาขาที่ยอมให้ขึ้นในช่องเดียว · เกินกว่านี้ยุบเป็นบรรทัดสรุป ไม่ปล่อยให้ล้นออกนอกจอ */
const ZONE_MAX = 24

function ZonePanel({
  z,
}: {
  z: { zone: string | null; list: OutCalc[]; si: number; so: number; pi: number; po: number }
}) {
  const shown = z.list.slice(0, ZONE_MAX)
  const rest = z.list.slice(ZONE_MAX)
  const restIn = rest.reduce((a, b) => a + b.in_wh, 0)
  const restOn = rest.reduce((a, b) => a + b.on_truck, 0)

  return (
    <section className="flex min-h-0 flex-col overflow-hidden" style={CARD}>
      {/* ---- หัวช่อง ---- */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: `1px solid ${C.line2}`, background: 'linear-gradient(180deg,#17202B,#121922)' }}
      >
        <Zone z={z.zone} big />
        <span className="text-[11px]" style={{ color: C.faint }}>
          {z.list.length} สาขา
        </span>
        <span className="flex-1" />
        <span className="text-right">
          <em className="block text-xl font-extrabold not-italic leading-none" style={{ color: C.lhHi }}>
            {nf(z.si)}
          </em>
          <Delta now={z.si} prev={z.pi} />
        </span>
        <span className="w-[72px] text-right">
          <em className="block text-xl font-extrabold not-italic leading-none" style={{ color: C.fdHi }}>
            {nf(z.so)}
          </em>
          <Delta now={z.so} prev={z.po} />
        </span>
      </div>

      {/* ---- รายสาขา · สองคอลัมน์ ไล่ลงคอลัมน์ซ้ายให้ครบก่อนค่อยขึ้นคอลัมน์ขวา ---- */}
      <div
        className="grid min-h-0 flex-1 gap-x-3 gap-y-[1px] px-2 py-1"
        style={{
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gridTemplateRows: `repeat(${Math.ceil(shown.length / 2)}, minmax(0, auto))`,
          gridAutoFlow: 'column',
          alignContent: 'center',
        }}
      >
        {shown.map((r, i) => (
          <span key={r.dir + r.station} className="flex items-center gap-2 overflow-hidden">
            <span className="w-[14px] shrink-0 text-right font-mono text-[10px]" style={{ color: C.faint }}>
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{r.station}</span>
            <span
              className="w-[54px] shrink-0 text-right font-mono text-[17px] font-bold"
              style={{ color: r.in_wh ? C.lhHi : C.faint }}
            >
              {nf(r.in_wh)}
            </span>
            <span
              className="w-[48px] shrink-0 text-right font-mono text-[17px] font-bold"
              style={{ color: r.on_truck ? C.fdHi : C.faint }}
            >
              {nf(r.on_truck)}
            </span>
          </span>
        ))}
      </div>

      {rest.length > 0 && (
        <p className="px-3 pb-2 text-center font-mono text-[11px]" style={{ color: C.faint }}>
          อีก {rest.length} สาขา · รวม {nf(restIn)} / {nf(restOn)}
        </p>
      )}
    </section>
  )
}

/* ------------------------------------------------- กราฟแท่งสองฝั่ง */

function TwoSide({
  rows,
  metric,
  title,
  vs,
  n = 8,
}: {
  rows: OutCalc[]
  metric: 'in_wh' | 'on_truck'
  title: React.ReactNode
  vs: string
  n?: number
}) {
  const l = useMemo(() => rows.filter((r) => r.dir === 'LH').sort((a, b) => b[metric] - a[metric]).slice(0, n), [rows, metric, n])
  const r = useMemo(() => rows.filter((r) => r.dir === 'FD').sort((a, b) => b[metric] - a[metric]).slice(0, n), [rows, metric, n])
  const max = Math.max(1, ...l.map((x) => x[metric]), ...r.map((x) => x[metric]))
  const headColor = metric === 'in_wh' ? C.lhHi : C.fdHi

  return (
    <section className="p-4" style={CARD}>
      <h2 className="mb-1 flex flex-wrap items-baseline gap-3 text-lg font-extrabold" style={{ color: headColor }}>
        {title}
        <span className="text-[11px] font-normal" style={{ color: C.faint }}>
          {vs} · โชว์ {n} อันดับแรกของแต่ละสาย · สเกลร่วมกันทั้งสองฝั่ง
        </span>
      </h2>
      <div className="grid items-center gap-x-2" style={{ gridTemplateColumns: '1fr 32px 1fr' }}>
        <div className="pb-2 text-right font-mono text-[10px] uppercase tracking-wider" style={{ color: C.faint }}>
          {LANE.LH} {CN.lane.LH}
        </div>
        <div />
        <div className="pb-2 font-mono text-[10px] uppercase tracking-wider" style={{ color: C.faint }}>
          {LANE.FD} {CN.lane.FD}
        </div>

        {Array.from({ length: n }, (_, i) => {
          const a = l[i]
          const b = r[i]
          return (
            <Row key={i} i={i}>
              {a ? (
                <div className="grid items-center gap-2" style={{ gridTemplateColumns: 'minmax(0,1fr) auto 56%' }}>
                  <span className="flex min-w-0 items-center justify-end gap-1.5">
                    <span className="truncate text-[13.5px]">{a.station}</span>
                  </span>
                  <span className="font-mono text-base font-bold" style={{ color: C.lhHi }}>
                    {nf(a[metric])}
                  </span>
                  <span className="flex h-[24px] justify-end" style={groove}>
                    <i style={barStyle('LH', 'l', (a[metric] / max) * 100)} />
                  </span>
                </div>
              ) : (
                <span />
              )}
              {b ? (
                <div className="grid items-center gap-2" style={{ gridTemplateColumns: '56% auto minmax(0,1fr)' }}>
                  <span className="flex h-[24px]" style={groove}>
                    <i style={barStyle('FD', 'r', (b[metric] / max) * 100)} />
                  </span>
                  <span className="font-mono text-base font-bold" style={{ color: C.fdHi }}>
                    {nf(b[metric])}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[13.5px]">{b.station}</span>
                    <Zone z={zoneOf(b)} dim />
                  </span>
                </div>
              ) : (
                <span />
              )}
            </Row>
          )
        })}
      </div>
    </section>
  )
}

function Row({ i, children }: { i: number; children: [React.ReactNode, React.ReactNode] }) {
  return (
    <>
      <div className="py-[3px]">{children[0]}</div>
      <div className="text-center font-mono text-xs" style={{ color: C.faint }}>
        {i + 1}
      </div>
      <div className="py-[3px]">{children[1]}</div>
    </>
  )
}

/* ------------------------------------------------- บันไดรายสาขา */

function Ladders({ rows }: { rows: OutCalc[] }) {
  const [auto, setAuto] = useState(true)
  const [open, setOpen] = useState<string | null>(null)
  const lh = useRef<HTMLDivElement>(null)
  const fd = useRef<HTMLDivElement>(null)

  /** เลื่อนหนึ่งขั้น · ใช้ทั้งตอนเลื่อนเองและตอนกดปุ่ม */
  function step(box: HTMLDivElement | null, back = false) {
    if (!box) return
    const items = [...box.querySelectorAll<HTMLElement>('[data-row]')]
    if (items.length < 2) return
    const bottom = box.scrollHeight - box.clientHeight
    if (bottom <= 2) return
    if (back) {
      const prev = [...items].reverse().find((el) => el.offsetTop < box.scrollTop - 4)
      box.scrollTo({ top: box.scrollTop <= 2 ? bottom : prev ? prev.offsetTop : 0, behavior: 'smooth' })
      return
    }
    const next = items.find((el) => el.offsetTop > box.scrollTop + 4)
    box.scrollTo({ top: !next || box.scrollTop >= bottom - 2 ? 0 : next.offsetTop, behavior: 'smooth' })
  }

  useEffect(() => {
    if (!auto || open) return
    const id = setInterval(() => {
      step(lh.current)
      step(fd.current)
    }, 3000)
    return () => clearInterval(id)
  }, [auto, open, rows])

  const mask = 'linear-gradient(180deg, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%)'

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">รายสาขา แยกสาย</h2>
        <span className="text-xs" style={{ color: C.faint }}>
          เรียงจากที่ต้องลงมือก่อน
        </span>
        <label className="ml-auto flex items-center gap-2 text-sm" style={{ color: C.mute }}>
          <input type="checkbox" className="h-[19px] w-[19px]" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          เลื่อนเองทุก 3 วิ
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {(['LH', 'FD'] as const).map((d) => {
          const g = rows.filter((r) => r.dir === d).sort((a, b) => OUT_RANK[a.state] - OUT_RANK[b.state] || b.work - a.work)
          const gi = g.reduce((n, r) => n + r.in_wh, 0)
          const go = g.reduce((n, r) => n + r.on_truck, 0)
          const ref = d === 'LH' ? lh : fd
          const edge = d === 'LH' ? C.lh : C.fd
          return (
            <div key={d} className="p-3" style={{ ...CARD, border: `2px solid ${edge}55` }}>
              <div className="mb-2 flex flex-wrap items-baseline gap-2">
                <h3 className="text-xl font-extrabold">
                  {LANE[d]} <Cn>{CN.lane[d]}</Cn>
                </h3>
                <span className="text-sm font-normal" style={{ color: C.mute }}>
                  {g.length} สาขา
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  aria-label="เลื่อนขึ้น"
                  className="h-tap w-tap rounded-btn text-base"
                  style={{ background: C.chip, color: C.mute }}
                  onClick={() => step(ref.current, true)}
                >
                  ▲
                </button>
                <button
                  type="button"
                  aria-label="เลื่อนลง"
                  className="h-tap w-tap rounded-btn text-base"
                  style={{ background: C.chip, color: C.mute }}
                  onClick={() => step(ref.current)}
                >
                  ▼
                </button>
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="p-2" style={{ borderRadius: 12, background: C.groove, border: `1px solid ${C.line2}` }}>
                  <span className="block text-sm" style={{ color: C.mute }}>
                    เข้าคลัง ไม่สแกนออก <Cn>{CN.inWh}</Cn>
                  </span>
                  <span className="block text-4xl font-extrabold leading-none" style={{ color: C.lhHi }}>
                    {nf(gi)}
                  </span>
                </div>
                <div className="p-2" style={{ borderRadius: 12, background: C.groove, border: `1px solid ${C.line2}` }}>
                  <span className="block text-sm" style={{ color: C.mute }}>
                    สแกนออก รถไม่ออก <Cn>{CN.onTruck}</Cn>
                  </span>
                  <span className="block text-4xl font-extrabold leading-none" style={{ color: C.fdHi }}>
                    {nf(go)}
                  </span>
                </div>
              </div>
              <div
                ref={ref}
                className="space-y-[6px] overflow-hidden"
                style={{ maxHeight: '52vh', scrollBehavior: 'smooth', maskImage: mask, WebkitMaskImage: mask }}
              >
                {g.map((r) => (
                  <TvRow key={r.station} r={r} open={open === r.station} onToggle={() => setOpen(open === r.station ? null : r.station)} />
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
  const foot = [r.trucks ? `รถ ${r.trucks}` : '', r.no_print ? `ไม่ปริ้นใบ ${r.no_print}` : '', r.finding ? `จัดหา ${r.finding}` : '']
    .filter(Boolean)
    .join(' · ')

  return (
    <div data-row>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2 text-left"
        style={{
          borderRadius: 13,
          background: 'linear-gradient(180deg, #121922, #0C1116)',
          border: `1px solid ${C.line2}`,
          borderLeft: `6px solid ${EDGE[r.state]}`,
          boxShadow: '0 6px 14px -10px #000, inset 0 1px 0 rgba(255,255,255,.04)',
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
        {/* ช่องว่างกลางแถวคือที่ที่ตาไปถึงพอดีตอนกวาดจากชื่อสาขาไปหาตัวเลข · โซนอยู่ตรงนี้ */}
        <Zone z={zoneOf(r)} big />
        <span className="shrink-0 text-right" style={{ minWidth: 84 }}>
          <em className="block text-2xl font-extrabold not-italic leading-none" style={{ color: C.lhHi }}>
            {nf(r.in_wh)}
          </em>
          <Delta now={r.in_wh} prev={r.prev_in} />
        </span>
        <span className="shrink-0 text-right" style={{ minWidth: 84 }}>
          <em className="block text-2xl font-extrabold not-italic leading-none" style={{ color: C.fdHi }}>
            {nf(r.on_truck)}
          </em>
          <Delta now={r.on_truck} prev={r.prev_on} />
        </span>
        <Tag state={r.state} text={tagText(r)} />
      </button>
      {open && (
        <div className="mt-1 p-3" style={{ borderRadius: 13, background: C.panel2, border: `1px solid ${C.line2}` }}>
          <TruckList r={r} />
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- ตาราง */

function RowItem({ r, max, open, onToggle }: { r: OutCalc; max: number; open: boolean; onToggle: () => void }) {
  const cell = (v: number, prev: number | null, lane: 'LH' | 'FD') => (
    <td className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="w-[62px] shrink-0 text-right font-mono text-base font-bold" style={{ color: lane === 'LH' ? C.lhHi : C.fdHi }}>
          {nf(v)}
        </span>
        <span className="flex h-[16px] flex-1" style={groove}>
          <i style={barStyle(lane, 'r', (v / max) * 100)} />
        </span>
      </div>
      <div className="pl-[70px]">
        <Delta now={v} prev={prev} />
      </div>
    </td>
  )
  return (
    <>
      <tr className="cursor-pointer" style={{ borderBottom: `1px solid ${C.line2}`, background: open ? C.panel2 : undefined }} onClick={onToggle}>
        <td className="px-3 py-2">
          <span className="block">{r.station}</span>
          <span className="flex items-center gap-2 font-mono text-xs" style={{ color: C.faint }}>
            <Zone z={zoneOf(r)} />
            {r.dir === 'FD' ? r.dir : null}
          </span>
        </td>
        <td className="px-3 py-2">
          <Tag state={r.state} text={tagText(r)} />
        </td>
        {cell(r.in_wh, r.prev_in, 'LH')}
        {cell(r.on_truck, r.prev_on, 'FD')}
        <td className="px-3 py-2 text-right">
          <Delta now={r.work} prev={r.chg === null ? null : r.work - r.chg} />
        </td>
        <td className="px-3 py-2 text-right font-mono text-xs">{r.trucks || '—'}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="px-3 py-3" style={{ background: C.panel2 }}>
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
            <li key={i} className="flex items-center gap-2 px-2 py-1" style={{ borderRadius: 9, background: C.groove }}>
              <span className="font-mono text-sm font-bold" style={{ color: isLate ? C.redInk : isSoon ? C.amberInk : C.ink }}>
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
