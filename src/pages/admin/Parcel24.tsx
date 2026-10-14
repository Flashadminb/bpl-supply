import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import { Spinner } from '../../components/ui'
import BoardThemeToggle from '../../components/BoardTheme'
import { readableError } from '../../lib/supabase'
import { C, CARD, HEAT_RED, field, heat, heatRank, nf, tabOff, tabOn, thFull } from '../../lib/boardTheme'
import {
  CANCEL,
  byCust,
  byAction,
  byDest,
  heldHours,
  importP24,
  p24Board,
  parseP24,
  undoP24,
  type P24Group,
  type P24Row,
} from '../../lib/parcel24'

/**
 * พัสดุค้างเกิน 24 ชม
 *
 * จอเต็มของตัวเอง ไม่ใช้กรอบหลังบ้าน แบบเดียวกับของค้างส่งออกและกระดานปล่อยรถ
 * เปิดให้เจ้าของระบบกับผู้ดูแลระบบ ด่านจริงอยู่ที่ RLS ของ parcel24_* ที่ตรวจ my_can_outbox()
 *
 * หน้าแรกคือผังกิ่ง ไม่ใช่การ์ดสรุป เพราะเจ้าของระบบเลือกแบบนี้เอง
 * แกนกลางคือหัวข้อการดำเนินการล่าสุด เริ่มที่ยกเลิกการส่งต่อพัสดุเสมอ
 * กิ่งที่ยื่นออกไปคือสาขา แล้วแตกต่อเป็นเลขพัสดุที่คัดลอกได้ทีละเลขและยกชุด
 */

/** กี่เลขที่ยอมกางในหน้าเดียว · เกินกว่านี้กางเท่าที่ไหว ที่เหลือบอกจำนวนไว้ */
const MAX_OPEN = 160

export default function Parcel24() {
  const nav = useNavigate()
  const board = useAsync(() => p24Board(), [])
  const [page, setPage] = useState<'tv' | 'main' | 'table' | 'zones'>('tv')
  const [pick, setPick] = useState<string | null>(null)
  const [clock, setClock] = useState(() => new Date())
  const [copied, setCopied] = useState<string | null>(null)

  /* อัปไฟล์ได้เฉพาะผู้ดูแลระบบ · ตรงกับ my_can_outbox() ฝั่งฐานข้อมูลตัวต่อตัว
     ฐานข้อมูลเป็นด่านจริง ตรงนี้แค่ไม่เอาปุ่มที่กดไม่ได้ไปวางให้คนกด */
  const { can } = useAuth()
  const mayUpload = can('admin')
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
  const rows = useMemo(() => board.data?.rows ?? [], [board.data])
  const actions = useMemo(() => byAction(rows), [rows])

  /** ค่าเริ่มต้นคือยกเลิกการส่งต่อเสมอ ถ้ารอบนี้ไม่มีค่อยตกไปที่หัวข้อที่เยอะสุด */
  const current = useMemo(() => {
    if (pick) return pick
    if (actions.some((a) => a.action === CANCEL)) return CANCEL
    return actions[0]?.action ?? ''
  }, [pick, actions])

  const picked = useMemo(
    () => rows.filter((r) => (r.action || 'ยังไม่มีการดำเนินการ') === current),
    [rows, current],
  )
  const groups = useMemo(() => byDest(picked), [picked])

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(null), 1600)
    } catch {
      setErr('เบราว์เซอร์ไม่ให้คัดลอก ลองกดอีกครั้งหลังแตะหน้าจอ')
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy(true)
    setErr(null)
    setMsg(null)
    void parseP24(f)
      .then(async (p) => {
        const res = await importP24(p, f.name)
        setLastId(res.id)
        /* บอกชื่อหัวตารางที่อ่านจริงทุกครั้ง · สองช่องนี้เป็นตัวตัดสินว่าจอจะมีของหรือว่าง
           ถ้าไฟล์รุ่นหน้าเปลี่ยนชื่อหัวแล้วเราไปชนคอลัมน์สำรอง จะเห็นตั้งแต่บรรทัดนี้ */
        setMsg(
          `อัปทับรอบ ${thFull(p.dataAt)} แล้ว · ${nf(res.rows)} ชิ้น · ยกเลิกการส่งต่อ ${nf(res.cancel)} · เก่าสุดค้างมา ${p.oldestHours} ชม` +
            (p.other > 0 ? ` · ตัดของฮับอื่นออก ${nf(p.other)} ชิ้น` : '') +
            ' · ของที่ไม่มีในไฟล์ใหม่หายจากจอแล้ว' +
            `\nกรองฮับจากคอลัมน์ "${p.usedFrom}" · โชว์สาขาจากคอลัมน์ "${p.usedDest}"`,
        )
        board.reload()
      })
      .catch((x) => setErr(readableError(x)))
      .finally(() => setBusy(false))
  }

  const vs = snap?.prev_at ? `เทียบรอบ ${thFull(snap.prev_at)}` : 'ยังไม่มีรอบก่อนหน้าให้เทียบ'

  /** อายุของข้อมูลนับจากเวลาในไฟล์ ไม่ใช่เวลาที่กดอัป · ไฟล์เก่าที่เพิ่งอัปก็ยังเก่าอยู่ดี */
  const ageMin = snap ? Math.max(0, Math.round((clock.getTime() - new Date(snap.data_at).getTime()) / 60000)) : 0
  const stale = ageMin > 120
  const ageTxt =
    ageMin < 60
      ? `${ageMin} นาทีที่แล้ว`
      : ageMin < 1440
        ? `${Math.floor(ageMin / 60)} ชม ${ageMin % 60} นาทีที่แล้ว`
        : `${Math.floor(ageMin / 1440)} วันที่แล้ว`

  return (
    <div style={{ background: C.bg, color: C.ink, minHeight: '100vh' }}>
      <div className="mx-auto max-w-[1900px] p-3">
        {/* ───────── หัวจอ ───────── */}
        <div
          className="mb-2 flex flex-wrap items-center gap-3 px-3 py-2"
          style={{ borderRadius: 14, background: 'var(--b-head)', border: `1px solid ${C.line2}` }}
        >
          <button type="button" aria-label="ย้อนกลับ" className="h-tap w-tap rounded-btn text-xl" style={{ color: C.mute }} onClick={() => nav('/admin')}>
            ←
          </button>
          <span className="rounded px-2 py-[2px] text-[13px] font-extrabold" style={{ background: 'var(--b-tab-on)', color: '#111' }}>
            FLASH
          </span>
          <span className="rounded-lg px-[9px] py-[2px] font-mono text-[15px] font-extrabold" style={{ background: 'var(--b-zone-bg)', color: 'var(--b-zone-ink)' }}>
            24
          </span>
          <span className="text-lg font-bold">
            พัสดุค้างเกิน 24 ชม <Cn>24小时滞留包裹</Cn> · 21BPL
          </span>
          <span className="flex-1" />
          {/*
            เวลาของข้อมูลต้องเด่น เพราะจอนี้เปิดค้างทั้งกะ
            ถ้าไฟล์ค้างไม่ได้อัป คนจะยืนอ่านตัวเลขเก่าโดยไม่รู้ตัว
            เลยทำเป็นป้ายมีกรอบ ไม่ใช่ตัวหนังสือจาง ๆ และเปลี่ยนเป็นสีส้มเมื่อเกินสองชั่วโมง
          */}
          {snap && (
            <span
              className="flex items-center gap-3 px-3 py-[5px]"
              style={{
                borderRadius: 12,
                background: stale ? C.amberBg : C.panel2,
                border: `1.5px solid ${stale ? C.amber : C.line}`,
              }}
            >
              <span className="text-right">
                <span className="block font-mono text-[10px] uppercase tracking-wider" style={{ color: C.faint }}>
                  ข้อมูลถึง 更新时间
                </span>
                <b className="block font-mono text-[19px] font-extrabold leading-tight" style={{ color: stale ? C.amberInk : C.brand }}>
                  {thFull(snap.data_at)}
                </b>
              </span>
              <span className="text-[10px] leading-tight" style={{ color: C.faint }}>
                {ageTxt}
                <br />
                อัปเข้าระบบ {thFull(snap.uploaded_at)}
                <br />
                {vs}
              </span>
            </span>
          )}
          <span className="font-mono text-2xl font-extrabold" style={{ color: C.brand }}>
            {clock.toLocaleTimeString('th-TH')}
          </span>
        </div>

        {/* ───────── แถบอัปไฟล์ ─────────
            ขึ้นเฉพาะคนที่อัปได้ · หน้างานเห็นกระดานอย่างเดียว
            ของที่กดไม่ได้ไม่ควรอยู่บนจอ เพราะทำให้ของที่ต้องใช้หาเจอช้าลง
            ฐานข้อมูลกันอีกชั้นอยู่แล้ว ตรงนี้แค่ไม่เอาปุ่มไปวางให้คนกด */}
        {mayUpload && (
        <div
          className="mb-2 flex flex-wrap items-center gap-2 px-3 py-2"
          style={{ borderRadius: 14, background: C.panel, border: `1px solid ${C.line2}` }}
        >
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={onFile} />
          <button
            type="button"
            className="h-tap rounded-btn px-4 text-sm font-bold"
            style={{ background: 'var(--b-tab-on)', color: '#111' }}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? <Spinner /> : null} อัปไฟล์รอบใหม่ <Cn>上传新一轮</Cn>
          </button>
          <span className="text-xs" style={{ color: C.faint }}>
            {snap ? `${nf(snap.row_count)} ชิ้น · ${groups.length} สาขาในหัวข้อนี้` : 'ยังไม่มีข้อมูล'}
            {' · อัปแล้วทับของเดิม ไม่ได้เก็บย้อนหลัง'}
            {snap?.hidden_count ? ` · ปิดโชว์ไว้ ${nf(snap.hidden_count)} ชิ้น ไม่ได้นับในยอด` : ''}
          </span>
          <span className="flex-1" />
          {lastId !== null && (
            <button
              type="button"
              className="h-tap rounded-btn px-3 text-xs"
              style={{ ...field, color: C.amberInk }}
              onClick={() => {
                void undoP24(lastId).then(() => {
                  setLastId(null)
                  setMsg('ถอนรอบที่เพิ่งอัปแล้ว')
                  board.reload()
                })
              }}
            >
              ถอนรอบที่เพิ่งอัป
            </button>
          )}
        </div>
        )}

        {/* ปุ่มสลับหน้าเป็นของทุกคน ไม่ได้อยู่ในแถบอัปไฟล์แล้ว */}
        <div
          className="mb-2 flex flex-wrap items-center gap-2 px-3 py-2"
          style={{ borderRadius: 14, background: C.panel, border: `1px solid ${C.line2}` }}
        >
          <div className="flex flex-wrap gap-2">
            {([
              ['tv', 'จอทีวี', '电视屏'],
              ['main', 'หน้าหลัก', '主页'],
              ['table', 'ตาราง', '表格'],
              ['zones', 'แยกตามโซน', '分区'],
            ] as const).map(([k, label, cn]) => (
              <button key={k} type="button" className="h-tap rounded-btn px-4 text-sm" style={page === k ? tabOn : tabOff} onClick={() => setPage(k)}>
                {label} <Cn>{cn}</Cn>
              </button>
            ))}
          </div>
          <BoardThemeToggle />
          <span className="flex-1" />
          {!mayUpload && (
            <span className="text-xs" style={{ color: C.faint }}>
              {snap ? `${nf(snap.row_count)} ชิ้น · ${groups.length} สาขา` : 'ยังไม่มีข้อมูล'}
            </span>
          )}
        </div>

        {msg && (
          <p
            className="mb-2 whitespace-pre-line rounded-card px-3 py-2 text-sm"
            style={{ background: C.greenBg, color: C.greenInk }}
          >
            {msg}
          </p>
        )}
        {err && (
          <p className="mb-2 rounded-card px-3 py-2 text-sm" style={{ background: C.redBg, color: C.redInk }}>
            {err}
          </p>
        )}
        {copied && (
          <p className="mb-2 rounded-card px-3 py-2 text-sm" style={{ background: C.greenBg, color: C.greenInk }}>
            คัดลอกแล้ว · {copied}
          </p>
        )}

        {board.loading && <p style={{ color: C.mute }}>กำลังโหลด…</p>}
        {board.error && (
          <p className="rounded-card px-3 py-2 text-sm" style={{ background: C.redBg, color: C.redInk }}>
            {board.error}
          </p>
        )}
        {board.data && !snap && (
          <p className="px-3 py-10 text-center" style={{ color: C.faint }}>
            ยังไม่เคยอัปไฟล์ · กดปุ่มด้านบนเพื่อเริ่ม
          </p>
        )}

        {snap && page === 'tv' && (
          <Graph
            actions={actions}
            current={current}
            onPick={setPick}
            groups={groups}
            total={picked.length}
            onCopy={copy}
          />
        )}

        {snap && page === 'main' && <Cards rows={rows} snapAt={snap.data_at} actions={actions} vs={vs} snapCancelPrev={snap.prev_cancel} />}

        {snap && page === 'table' && <Table rows={rows} snapAt={snap.data_at} onCopy={copy} />}

        {snap && page === 'zones' && (
          <Zones rows={rows} actions={actions} onCopy={copy} />
        )}
      </div>
    </div>
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

function Zone({ z }: { z: string | null }) {
  return (
    <span
      className="shrink-0 rounded px-[5px] py-[1px] font-mono text-[10px] font-bold"
      style={z ? { background: 'var(--b-zone-bg)', color: 'var(--b-zone-ink)' } : { background: C.chip, color: C.faint, fontWeight: 400 }}
    >
      {z ?? '—'}
    </span>
  )
}

/* ----------------------------------------------------------- ผังกิ่ง */

/**
 * ซ้ายคือหัวข้อการดำเนินการ กลางคือหัวข้อที่เลือก ขวาคือสาขาและเลขพัสดุ
 *
 * เส้นโยงวาดด้วย SVG ชั้นหลัง ส่วนโหนดเป็น HTML ชั้นหน้า
 * ทำแบบนี้เพราะโหนดต้องกดได้ ต้องเลือกข้อความไปคัดลอกได้ และต้องห่อบรรทัดเองได้
 * ซึ่ง SVG ทำได้ลำบากกว่ามาก · เส้นจึงไม่ได้ผูกกับโหนดจริง แต่คิดจากตำแหน่งที่วางไว้
 */
function Graph({
  actions,
  current,
  onPick,
  groups,
  total,
  onCopy,
}: {
  actions: { action: string; n: number }[]
  current: string
  onPick: (a: string) => void
  groups: P24Group[]
  total: number
  onCopy: (text: string, what: string) => void
}) {
  const [zone, setZone] = useState<string | null>(null)
  const [hover, setHover] = useState(false)
  const [stick, setStick] = useState(false)
  /**
   * กรองเหลือเฉพาะชิ้นที่อยู่ในถุงแบ๊กกิ้ง
   *
   * กรองที่กิ่ง ไม่ได้กรองแค่ตอนโชว์ · เลขใหญ่ จำนวนสาขา ยอดรายโซน
   * และปุ่มคัดลอก จึงเปลี่ยนตามไปด้วยทั้งหมด
   * ถ้ากรองแค่ตอนโชว์ เลขใหญ่จะบอก 249 แต่กางออกมาเจอ 80 ซึ่งคนจะไม่เชื่อหน้านี้อีกเลย
   */
  const [bagOnly, setBagOnly] = useState(false)
  const bagTotal = useMemo(
    () => groups.reduce((a, g) => a + g.rows.filter((r) => r.bag_no).length, 0),
    [groups],
  )
  const base = useMemo(
    () =>
      !bagOnly
        ? groups
        : groups
            .map((g) => ({ ...g, rows: g.rows.filter((r) => r.bag_no) }))
            .filter((g) => g.rows.length > 0),
    [groups, bagOnly],
  )

  /**
   * โซนย่อยของหัวข้อที่เลือกอยู่
   *
   * นับจากกิ่งที่มีอยู่จริงในหัวข้อนี้ ไม่ใช่รายชื่อโซนทั้งระบบ
   * เพราะโซนที่ไม่มีของในหัวข้อนี้เลย ขึ้นมาเป็นปุ่มที่กดแล้วว่างเปล่าก็ไม่มีประโยชน์
   */
  const zones = useMemo(() => {
    const m = new Map<string, { zone: string | null; items: number; branches: number }>()
    for (const g of base) {
      const k = g.zone ?? ''
      const cur = m.get(k) ?? { zone: g.zone, items: 0, branches: 0 }
      cur.items += g.rows.length
      cur.branches += 1
      m.set(k, cur)
    }
    return [...m.values()].sort((a, b) => b.items - a.items)
  }, [base])

  /** กดโซนไหนก็เห็นเฉพาะโซนนั้น · กดตัวเลขใหญ่กลับไปเห็นทั้งหมด */
  const shownGroups = useMemo(
    () => (zone === null ? base : base.filter((g) => (g.zone ?? '') === zone)),
    [base, zone],
  )
  const shownItems = shownGroups.reduce((a, g) => a + g.rows.length, 0)
  /** เมนูย่อยค้างไว้ถ้ากำลังเลือกโซนอยู่ ไม่งั้นพอเลื่อนเมาส์ออกจะไม่เหลือทางกลับ */
  const subOpen = hover || stick || zone !== null
  const allText = shownGroups.flatMap((g) => g.rows.map((r) => r.tracking)).join('\n')
  const open = shownItems <= MAX_OPEN

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(190px,220px) minmax(200px,240px) minmax(0,1fr)' }}>
      {/* ---- เมนูหัวข้อ ---- */}
      <div>
        <p className="mb-2 text-[11px]" style={{ color: C.faint }}>
          การดำเนินการล่าสุด <Cn>最新操作</Cn>
        </p>
        <div className="space-y-[6px]">
          {actions.map((a) => {
            const on = a.action === current
            const hot = a.action === CANCEL
            return (
              <button
                key={a.action}
                type="button"
                onClick={() => {
                  onPick(a.action)
                  setZone(null)
                }}
                className="flex w-full items-center gap-2 px-[9px] py-[7px] text-left"
                style={{
                  borderRadius: 10,
                  background: on ? 'var(--b-red-sel-bg)' : C.groove,
                  border: on ? `1.5px solid ${'var(--b-red-sel-line)'}` : `1px solid ${C.line2}`,
                }}
              >
                <span
                  className="min-w-0 flex-1 truncate text-[12.5px]"
                  style={{ color: hot ? C.redInk : on ? C.ink : C.mute, fontWeight: on || hot ? 700 : 400 }}
                >
                  {a.action}
                </span>
                <span className="font-mono text-[13px] font-bold" style={{ color: hot ? C.redInk : C.lhHi }}>
                  {nf(a.n)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ---- โหนดกลาง ---- */}
      <div className="relative">
        <div
          className="sticky top-3"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
        <div className="p-3" style={{ ...CARD, border: `2px solid #A32D2D` }}>
          <span className="block text-center text-[14px] font-bold" style={{ color: current === CANCEL ? C.redInk : C.ink }}>
            {current}
          </span>
          {/*
            ตัวเลขคือพระเอกของการ์ดนี้ จึงใหญ่สุดในจอและอยู่กลาง
            กดได้ด้วย · กดแล้วกลับไปเห็นทุกโซน เป็นทางกลับที่อยู่ตรงที่ตามองอยู่แล้ว
          */}
          <button
            type="button"
            className="mt-1 block w-full text-center"
            onClick={() => {
              if (zone !== null) setZone(null)
              else setStick((v) => !v)
            }}
          >
            <span
              className="block font-mono font-extrabold leading-[0.9]"
              style={{
                fontSize: 'clamp(56px, 7vw, 104px)',
                color: current === CANCEL ? C.redInk : C.lhHi,
                textShadow: current === CANCEL ? '0 0 34px rgba(226,75,74,.45)' : '0 0 34px rgba(79,163,227,.4)',
              }}
            >
              {nf(zone === null ? (bagOnly ? bagTotal : total) : shownItems)}
            </span>
            <span className="mt-1 block text-[12px]" style={{ color: C.faint }}>
              {zone === null
                ? `${base.length} สาขา${bagOnly ? ' · เฉพาะที่อยู่ในถุง' : ''}`
                : `${zone || 'ไม่มีโซน'} · ${shownGroups.length} สาขา · กดเพื่อดูทั้งหมด`}
            </span>
          </button>


          <button
            type="button"
            className="mt-2 w-full rounded-lg px-3 py-2 text-[12px] font-bold"
            style={{ background: 'var(--b-red-soft-bg)', color: C.redInk, border: `1px solid var(--b-red-soft-line)` }}
            onClick={() => onCopy(allText, zone === null ? `ทั้งหมด ${nf(shownItems)} เลข` : `${zone || 'ไม่มีโซน'} ${nf(shownItems)} เลข`)}
          >
            คัดลอก{zone === null ? 'ทั้ง' : `${zone || 'ไม่มีโซน'} `}
            {nf(shownItems)} เลข
          </button>
          {/* ตัวกรองถุงแบ๊กกิ้ง · วางใต้ปุ่มคัดลอกตามที่เจ้าของระบบชี้จุดไว้
              ปิดอยู่ = เห็นทุกชิ้นเหมือนเดิม ไม่ได้เปลี่ยนพฤติกรรมเดิมของหน้า */}
          <button
            type="button"
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11.5px] font-bold"
            style={
              bagOnly
                ? { background: 'rgba(79,163,227,.18)', color: C.lhHi, border: '1px solid rgba(79,163,227,.5)' }
                : { background: C.groove, color: C.faint, border: `1px solid ${C.line2}` }
            }
            onClick={() => {
              setBagOnly((v) => !v)
              setZone(null)
            }}
          >
            <span style={{ fontSize: 13 }}>▣</span>
            {bagOnly ? 'เฉพาะที่อยู่ในถุง' : 'กรองเฉพาะที่มีเลขถุง'}
            <span style={{ color: bagOnly ? C.lhHi : C.faint, fontFamily: 'ui-monospace, monospace' }}>
              {nf(bagTotal)}
            </span>
          </button>

          <p className="mt-2 text-[11px] leading-relaxed" style={{ color: C.faint }}>
            {open
              ? 'กางครบทุกเลขในหน้าเดียว · กดที่เลขเพื่อคัดลอกทีละเลข'
              : 'หัวข้อนี้มีเยอะ จึงกางเท่าที่ไหว สาขาละ 10 เลขแรก · เลือกโซนเพื่อกางครบ หรือกดกางต่อรายสาขา'}
          </p>
          {zones.length > 1 && (
            <p className="mt-1 text-center text-[11.5px]" style={{ color: subOpen ? 'var(--b-zone-ink)' : C.faint }}>
              {subOpen ? '▾' : '▾ ชี้หรือกดเพื่อแยกตามโซน D0'}
            </p>
          )}
        </div>

        {/*
          เมนูย่อยของโซน · ห้อยลงมาจากการ์ดกลางเหมือนกิ่งที่แตกต่อ
          โผล่ตอนเอาเมาส์ชี้หรือกดที่การ์ด และค้างไว้ถ้ากำลังเลือกโซนอยู่
          ไม่ได้โผล่ตลอดเวลา เพราะจอนี้แน่นอยู่แล้ว และคนส่วนใหญ่ดูทั้งก้อนไม่ได้แยกโซน
        */}
        {zones.length > 1 && subOpen && (
          /*
            กรอบของเมนูย่อยใช้ฟ้า ส่วนการ์ดใหญ่ใช้แดง
            คนละสีเพราะเป็นคนละชั้นของเมนู ถ้าสีเดียวกันจะอ่านเหมือนเป็นการ์ดเดียวที่ยาวลงมา
            ฟ้าเป็นสีเดียวกับป้ายโซน D0 ที่ใช้อยู่ทั้งระบบ จึงไม่ได้เพิ่มสีใหม่เข้ามาอีก
          */
          <div
            className="mt-[6px] p-2"
            style={{
              borderRadius: 13,
              background: 'var(--b-rail)',
              border: `2px solid #2F5A80`,
              boxShadow: 'inset 0 1px 0 rgba(143,208,255,.07)',
            }}
          >
            <p className="mb-[6px] flex items-baseline gap-2 px-[3px] font-mono text-[12px] font-extrabold" style={{ color: 'var(--b-zone-ink)' }}>
              แยกตามโซน D0 <Cn>D0 分区</Cn>
            </p>
            <div className="relative pl-4">
            <span
              aria-hidden
              className="absolute"
              style={{ left: 9, top: -2, bottom: 22, width: 1.5, background: 'var(--b-zone-line)' }}
            />
            {zones.map((z) => {
              const k = z.zone ?? ''
              const on = zone === k
              return (
                <div key={k || 'none'} className="relative">
                  <span
                    aria-hidden
                    className="absolute"
                    style={{ left: -7, top: 'calc(50% - 3px)', width: 11, height: 1.5, background: on ? 'var(--b-zone-ink)' : 'var(--b-zone-line)' }}
                  />
                  {/*
                    ช่องโซนต้องใหญ่พอจะอยู่คู่กับตัวเลขใหญ่กลางการ์ดได้
                    ชื่อโซนกับจำนวนคือสองอย่างที่คนอ่าน ส่วนจำนวนสาขาเป็นของรอง
                    จึงให้สองอันแรกตัวโต แล้วดันจำนวนสาขาไปเป็นบรรทัดเล็กใต้ชื่อ
                  */}
                  <button
                    type="button"
                    onClick={() => setZone(on ? null : k)}
                    className="mb-[5px] flex w-full items-center gap-2 px-[10px] py-[7px] text-left"
                    style={{
                      borderRadius: 10,
                      background: on ? 'var(--b-zone-on-bg)' : 'var(--b-zone-off-bg)',
                      border: `1.5px solid ${on ? 'var(--b-zone-ink)' : 'var(--b-zone-line)'}`,
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <b
                        className="block font-mono text-[19px] font-extrabold leading-none"
                        style={{ color: on ? 'var(--b-zone-ink)' : C.mute }}
                      >
                        {z.zone ?? 'ไม่มีโซน'}
                      </b>
                      <span className="mt-[2px] block text-[10.5px]" style={{ color: C.faint }}>
                        {z.branches} สาขา
                      </span>
                    </span>
                    <span
                      className="font-mono text-[24px] font-extrabold leading-none"
                      style={{ color: on ? 'var(--b-zone-ink)' : C.lhHi }}
                    >
                      {nf(z.items)}
                    </span>
                  </button>
                </div>
              )
            })}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* ---- กิ่งสาขา ---- */}
      <div className="grid gap-2 xl:grid-cols-2" style={{ alignContent: 'start' }}>
        {shownGroups.map((g, i) => (
          <Branch key={g.dest} g={g} i={i} n={shownGroups.length} open={open} onCopy={onCopy} />
        ))}
        {shownGroups.length === 0 && (
          <p className="text-sm" style={{ color: C.faint }}>
            หัวข้อนี้ไม่มีพัสดุในรอบนี้
          </p>
        )}
      </div>
    </div>
  )
}

function Branch({
  g,
  i,
  n,
  open,
  onCopy,
}: {
  g: P24Group
  i: number
  n: number
  open: boolean
  onCopy: (t: string, w: string) => void
}) {
  const [more, setMore] = useState(false)
  const show = open || more ? g.rows : g.rows.slice(0, 10)
  const left = g.rows.length - show.length
  const big = g.rows.length >= 5

  return (
    <section
      className="p-2"
      style={{
        borderRadius: 12,
        background: `${heat(i, n, HEAT_RED)}, ${C.groove}`,
        border: `1px solid ${big ? 'var(--b-red-edge)' : C.line2}`,
        gridColumn: big ? '1 / -1' : undefined,
      }}
    >
      <div className="flex items-center gap-2">
        <Zone z={g.zone} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{g.dest}</span>
        <span className="font-mono text-[15px] font-extrabold" style={{ color: C.redInk }}>
          {nf(g.rows.length)}
        </span>
        <button
          type="button"
          className="shrink-0 rounded-lg px-2 py-1 text-[11px]"
          style={{ background: C.panel2, color: C.mute, border: `1px solid ${C.line}` }}
          onClick={() => onCopy(g.rows.map((r) => r.tracking).join('\n'), `${g.dest} ${g.rows.length} เลข`)}
        >
          คัดลอก
        </button>
      </div>
      <div className="mt-[5px] flex flex-wrap gap-[3px]">
        {show.map((r) => (
          /* เลขถุงห้อยท้ายเลขพัสดุ แต่อยู่ "นอก" ปุ่มคัดลอก
             ทั้งกดคัดลอกทีละเลขและกดคัดลอกทั้งสาขา จึงไม่มีทางติดเลขถุงไปด้วย */
          <span key={r.tracking} className="inline-flex items-center">
            <button
              type="button"
              onClick={() => onCopy(r.tracking, r.tracking)}
              className="rounded-md px-[6px] py-[2px] font-mono text-[11.5px]"
              style={{
                background: C.slot,
                color: C.mute,
                border: `1px solid ${C.line2}`,
                borderTopRightRadius: r.bag_no ? 0 : undefined,
                borderBottomRightRadius: r.bag_no ? 0 : undefined,
              }}
            >
              {r.tracking}
            </button>
            {r.bag_no && (
              <span
                className="rounded-md px-[5px] py-[2px] font-mono text-[10.5px]"
                style={{
                  background: 'rgba(79,163,227,.14)',
                  border: '1px solid rgba(79,163,227,.32)',
                  borderLeft: 0,
                  borderTopLeftRadius: 0,
                  borderBottomLeftRadius: 0,
                  color: C.lhHi,
                }}
                title="เลขถุงแบ๊กกิ้ง · คัดลอกไม่ติดมา"
              >
                ▣ {r.bag_no}
              </span>
            )}
          </span>
        ))}
        {left > 0 && (
          <button type="button" className="px-1 text-[11px]" style={{ color: C.amberInk }} onClick={() => setMore(true)}>
            กางอีก {nf(left)} เลข
          </button>
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------ การ์ด */

function Cards({
  rows,
  snapAt,
  actions,
  vs,
  snapCancelPrev,
}: {
  rows: P24Row[]
  snapAt: string
  actions: { action: string; n: number }[]
  vs: string
  snapCancelPrev: number | null
}) {
  const cancel = rows.filter((r) => r.action === CANCEL)
  const over48 = rows.filter((r) => (heldHours(r, snapAt) ?? 0) > 48).length
  const dests = byDest(rows)
  const max = Math.max(1, ...actions.map((a) => a.n))
  /* ไฟล์รุ่นเก่าไม่มีคอลัมน์นี้เลย · ทั้งกองเป็น "ไม่ระบุ" ก็ไม่ต้องขึ้นแถบ
     แต่ถ้ามีของจริงปนอยู่ ให้ "ไม่ระบุ" ขึ้นด้วย ไม่งั้นเปอร์เซ็นต์รวมไม่ถึงร้อย
     แล้วคนจะนึกว่าตัวเลขผิด */
  const custAll = byCust(rows)
  const custs = custAll.length === 1 && custAll[0].cust === 'ไม่ระบุ' ? [] : custAll

  return (
    <>
      <div className="mb-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Tile label={<>ยกเลิกการส่งต่อพัสดุ <Cn>取消转寄</Cn></>} n={cancel.length} prev={snapCancelPrev} color={C.redInk} edge={C.red} vs={vs} />
        <Tile label="พัสดุค้างทั้งหมด" n={rows.length} prev={null} color={C.lhHi} edge={C.lh} vs={vs} />
        <Tile label="ค้างเกิน 48 ชม" n={over48} prev={null} color={C.amberInk} edge={C.amber} vs={vs} />
        <Tile label="ฮับถัดไปที่มีของค้าง" n={dests.length} prev={null} color={C.ink} edge={C.line} vs={vs} />
      </div>

      {/*
        ประเภทลูกค้า · เจ้าของระบบบอกว่าไม่ได้สำคัญมาก แค่อยากมี
        จึงวางเป็นแถบเดียวนอนไป ไม่ได้กินช่องของสองแผงที่คนใช้ทำงานจริง
        ไฟล์รุ่นเก่าไม่มีคอลัมน์นี้ ถ้าไม่มีก็ไม่ขึ้นทั้งแถบ ไม่ใช่ขึ้นว่า "ไม่ระบุ 6,460"
      */}
      {custs.length > 0 && (
        <section className="mb-3 p-3" style={CARD}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="text-[13px] font-extrabold" style={{ color: C.mute }}>
              ประเภทลูกค้า <Cn>客户类型</Cn>
            </h2>
            {custs.map((c) => (
              <span
                key={c.cust}
                className="flex items-baseline gap-[6px] px-2 py-[3px]"
                style={{ borderRadius: 999, background: C.groove, border: `1px solid ${C.line2}` }}
              >
                <span className="text-[12px]" style={{ color: C.mute }}>
                  {c.cust}
                </span>
                <b className="font-mono text-[13px]" style={{ color: C.lhHi }}>
                  {nf(c.n)}
                </b>
                <span className="font-mono text-[10.5px]" style={{ color: C.faint }}>
                  {Math.round((c.n / Math.max(1, rows.length)) * 100)}%
                </span>
              </span>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="p-4" style={CARD}>
          <h2 className="mb-2 text-lg font-extrabold">
            การดำเนินการล่าสุด <Cn>最新操作</Cn>
          </h2>
          {actions.map((a) => (
            <div key={a.action} className="mb-[6px] flex items-center gap-2">
              <span className="w-[160px] shrink-0 truncate text-[12.5px]" style={{ color: a.action === CANCEL ? C.redInk : C.mute }}>
                {a.action}
              </span>
              <span className="flex h-[13px] flex-1" style={{ background: C.slot, borderRadius: 4, overflow: 'hidden' }}>
                <i
                  style={{
                    display: 'block',
                    height: '100%',
                    width: `${(a.n / max) * 100}%`,
                    background: a.action === CANCEL ? `linear-gradient(90deg,var(--b-bar-red-lo),${C.red})` : `linear-gradient(90deg,${C.lhLo},${C.lh})`,
                  }}
                />
              </span>
              <span className="w-[46px] shrink-0 text-right font-mono text-[13px] font-bold" style={{ color: a.action === CANCEL ? C.redInk : C.lhHi }}>
                {nf(a.n)}
              </span>
            </div>
          ))}
        </section>

        <section className="p-4" style={CARD}>
          <h2 className="mb-2 text-lg font-extrabold">
            สาขาที่ค้างเยอะสุด <Cn>积压最多网点</Cn>
          </h2>
          {dests.slice(0, 14).map((g, i) => (
            <div
              key={g.dest}
              className="mb-[5px] flex items-center gap-2 px-2 py-[5px]"
              style={{ borderRadius: 10, background: `${heat(i, Math.min(dests.length, 14))}, ${C.groove}`, border: `1px solid ${C.line2}` }}
            >
              <Zone z={g.zone} />
              <span className="min-w-0 flex-1 truncate text-[13px]">{g.dest}</span>
              <span className="font-mono text-[15px] font-extrabold" style={{ color: C.lhHi }}>
                {nf(g.rows.length)}
              </span>
            </div>
          ))}
        </section>
      </div>
    </>
  )
}

function Tile({
  label,
  n,
  prev,
  color,
  edge,
  vs,
}: {
  label: React.ReactNode
  n: number
  prev: number | null
  color: string
  edge: string
  vs: string
}) {
  const d = prev === null ? null : n - prev
  return (
    <div className="p-3" style={{ ...CARD, border: `2px solid ${edge}` }}>
      <span className="block text-sm font-semibold" style={{ color: C.mute }}>
        {label}
      </span>
      <span className="mt-1 block text-5xl font-extrabold leading-none" style={{ color, textShadow: `0 0 22px ${edge}44` }}>
        {nf(n)}
      </span>
      <span className="mt-1 block font-mono text-sm" style={{ color: d === null ? C.faint : d > 0 ? C.redInk : d < 0 ? C.greenInk : C.faint }}>
        {d === null ? '—' : d > 0 ? `▲ +${nf(d)}` : d < 0 ? `▼ ${nf(d)}` : 'เท่าเดิม'}
      </span>
      <span className="block text-[11px]" style={{ color: C.faint }}>
        {vs}
      </span>
    </div>
  )
}

/* --------------------------------------------------------- แยกตามโซน */

/**
 * ทุกโซนในหน้าเดียว
 *
 * ─────────────────────────────────────────────────────────────────
 * ต่างจากหน้าหลักตรงไหน
 *
 * หน้าหลักให้เลือกทีละโซนแล้วค่อยดูสาขาข้างใน ซึ่งดีตอนรู้แล้วว่าจะตามโซนไหน
 * หน้านี้ตอบอีกคำถามหนึ่ง · คืนนี้ของกองอยู่โซนไหนมากที่สุด
 * ต้องเห็นครบทุกโซนพร้อมกันในจอเดียวโดยไม่ต้องกดสลับไปมา
 * ─────────────────────────────────────────────────────────────────
 *
 * เลขพัสดุซ่อนไว้ก่อนโดยตั้งใจ
 * ถ้ากางหมดทุกสาขาตั้งแต่แรก จอจะยาวเป็นกิโลจนหาโซนไม่เจอ
 * ซึ่งทำลายเหตุผลเดียวที่หน้านี้มีอยู่
 */
function Zones({
  rows,
  actions,
  onCopy,
}: {
  rows: P24Row[]
  actions: { action: string; n: number }[]
  onCopy: (text: string, what: string) => void
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState(false)

  /**
   * หัวข้อที่ติ๊กไว้ · ติ๊กได้หลายอันพร้อมกัน
   *
   * ค่าตั้งต้นคือยกเลิกการส่งต่อเสมอ ถ้ารอบนี้ไม่มีค่อยตกไปที่หัวข้อที่เยอะสุด
   * เก็บเป็นชุดของชื่อหัวข้อ ไม่ใช่ตัวเดียว เพราะบางคืนต้องตามสองสามหัวข้อพร้อมกัน
   * แล้วการกดสลับไปมาทำให้มองไม่เห็นว่ารวมกันแล้วโซนไหนหนักสุด
   */
  const [picks, setPicks] = useState<Set<string> | null>(null)

  const chosen = useMemo(() => {
    if (picks) return picks
    const first = actions.some((a) => a.action === CANCEL) ? CANCEL : (actions[0]?.action ?? '')
    return new Set(first ? [first] : [])
  }, [picks, actions])

  const flip = (a: string) =>
    setPicks(() => {
      const n = new Set(chosen)
      if (n.has(a)) n.delete(a)
      else n.add(a)
      return n
    })

  const picked = useMemo(
    () => rows.filter((r) => chosen.has(r.action || 'ยังไม่มีการดำเนินการ')),
    [rows, chosen],
  )
  const groups = useMemo(() => byDest(picked), [picked])

  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })

  /* จัดกองตามโซน · เรียงโซนจากของเยอะไปน้อย และดันโซนว่างไว้ท้ายสุดเสมอ
     โซนว่างคือสาขาที่ยังไม่ได้ตั้งโซน ซึ่งเป็นงานค้างของหลังบ้าน ไม่ใช่โซนจริง */
  const zones = useMemo(() => {
    const m = new Map<string, { zone: string; branches: P24Group[]; items: number }>()
    for (const g of groups) {
      const k = g.zone ?? ''
      const cur = m.get(k) ?? { zone: k, branches: [], items: 0 }
      cur.branches.push(g)
      cur.items += g.rows.length
      m.set(k, cur)
    }
    return [...m.values()]
      .map((z) => ({ ...z, branches: z.branches.slice().sort((a, b) => b.rows.length - a.rows.length) }))
      .sort((a, b) => {
        if (!a.zone !== !b.zone) return a.zone ? -1 : 1
        return b.items - a.items || a.zone.localeCompare(b.zone)
      })
  }, [groups])

  /* อันดับตามจำนวนจริง ใช้เฉพาะเรื่องสี · ลำดับที่วางยังเป็นของ zones เหมือนเดิม */
  const byItems = useMemo(() => zones.slice().sort((a, b) => b.items - a.items), [zones])

  const total = zones.reduce((a, z) => a + z.items, 0)
  const allText = groups.flatMap((g) => g.rows.map((r) => r.tracking)).join('\n')

  return (
    <div className="space-y-3">
      {/* เลือกว่าจะดูการดำเนินการล่าสุดแบบไหนบ้าง · ติ๊กได้หลายอัน */}
      <div className="relative flex flex-wrap items-center gap-2 px-3 py-2" style={CARD}>
        <span className="text-xs" style={{ color: C.faint }}>
          การดำเนินการล่าสุด <Cn>最新操作</Cn>
        </span>

        <button
          type="button"
          onClick={() => setMenu((v) => !v)}
          className="h-tap min-w-[220px] rounded-btn px-3 text-left text-sm"
          style={{ background: C.panel2, color: C.mute, border: `1px solid ${C.line2}` }}
        >
          {chosen.size === 0
            ? 'ยังไม่ได้เลือกหัวข้อ'
            : chosen.size === 1
              ? [...chosen][0]
              : `เลือกไว้ ${chosen.size} หัวข้อ`}
          <span className="ml-2" style={{ color: C.faint }}>
            {menu ? '▴' : '▾'}
          </span>
        </button>

        {menu && (
          <>
            {/* คลิกที่ว่างรอบ ๆ แล้วปิด · ไม่ต้องเล็งปุ่มเดิมให้โดน */}
            <button
              type="button"
              aria-label="ปิดรายการ"
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setMenu(false)}
            />
            <div
              className="absolute left-3 top-[52px] z-20 max-h-[340px] w-[340px] overflow-auto p-2"
              style={{ ...CARD, background: C.panel }}
            >
              <div className="mb-1 flex gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-md px-2 py-1 text-xs"
                  style={{ background: C.panel2, color: C.mute, border: `1px solid ${C.line2}` }}
                  onClick={() => setPicks(new Set(actions.map((a) => a.action)))}
                >
                  เลือกทั้งหมด
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-md px-2 py-1 text-xs"
                  style={{ background: C.panel2, color: C.mute, border: `1px solid ${C.line2}` }}
                  onClick={() => setPicks(new Set())}
                >
                  ล้างทั้งหมด
                </button>
              </div>
              {actions.map((a) => (
                <label
                  key={a.action}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-[5px] text-[12.5px]"
                  style={{ color: C.mute }}
                >
                  <input
                    type="checkbox"
                    checked={chosen.has(a.action)}
                    onChange={() => flip(a.action)}
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate">{a.action}</span>
                  <b className="shrink-0 font-mono text-[12px]" style={{ color: C.faint }}>
                    {nf(a.n)}
                  </b>
                </label>
              ))}
            </div>
          </>
        )}
        <span className="flex-1" />
        <b className="font-mono text-[17px]" style={{ color: C.brand }}>
          {nf(total)}
        </b>
        <span className="text-xs" style={{ color: C.faint }}>
          ชิ้น · {zones.length} โซน · {groups.length} สาขา
        </span>
        {total > 0 && (
          <button
            type="button"
            className="h-tap rounded-btn px-3 text-xs"
            style={{ background: C.panel2, color: C.mute, border: `1px solid ${C.line2}` }}
            onClick={() => onCopy(allText, `ทุกโซน ${total} เลข`)}
          >
            คัดลอกทั้งหมด
          </button>
        )}
      </div>

      {/* การ์ดสรุปรายโซน · เห็นครบทุกโซนในแถวเดียว
          สีคิดจากอันดับ "จำนวน" ไม่ใช่ลำดับที่วาง
          เพราะโซนที่ยังไม่ได้ตั้งถูกดันไปท้ายสุดเสมอไม่ว่าจะมีของเยอะแค่ไหน
          ถ้าให้สีตามตำแหน่ง มันจะขึ้นเขียวทั้งที่ของเยอะกว่าโซนที่ขึ้นเหลือง
          ซึ่งหลอกตาคนที่กวาดดูทั้งแถวแล้วตัดสินจากสี */}
      <div className="flex flex-wrap gap-2">
        {zones.map((z) => {
          const heat = heatRank(byItems.indexOf(z), zones.length)
          return (
            <div
              key={z.zone || 'none'}
              className="min-w-[120px] flex-1 px-3 py-2"
              style={{ ...CARD, background: heat.bg, borderColor: heat.bar }}
            >
              <div className="font-mono text-[11px] uppercase tracking-wider" style={{ color: C.faint }}>
                {z.zone || 'ไม่มีโซน'}
              </div>
              <div className="font-mono text-[22px] font-extrabold leading-tight" style={{ color: heat.bar }}>
                {nf(z.items)}
              </div>
              <div className="text-[10.5px]" style={{ color: C.faint }}>
                {z.branches.length} สาขา
              </div>
            </div>
          )
        })}
      </div>

      {/* ช่องของแต่ละโซน · ข้างในไล่สีจากสาขาที่มีเยอะสุดลงมา */}
      {zones.map((z) => (
        <div key={z.zone || 'none'} className="px-3 py-2" style={CARD}>
          <div className="mb-2 flex items-center gap-2">
            <b className="font-mono text-sm" style={{ color: C.brand }}>
              {z.zone || 'ไม่มีโซน'}
            </b>
            <span className="text-xs" style={{ color: C.faint }}>
              {nf(z.items)} ชิ้น · {z.branches.length} สาขา
            </span>
            <span className="flex-1" />
            <button
              type="button"
              className="h-tap rounded-btn px-3 text-xs"
              style={{ background: C.panel2, color: C.mute, border: `1px solid ${C.line2}` }}
              onClick={() =>
                onCopy(
                  z.branches.flatMap((g) => g.rows.map((r) => r.tracking)).join('\n'),
                  `${z.zone || 'ไม่มีโซน'} ${z.items} เลข`,
                )
              }
            >
              คัดลอกทั้งโซน
            </button>
          </div>

          <div className="space-y-1">
            {z.branches.map((g, i) => {
              const heat = heatRank(i, z.branches.length)
              const key = `${z.zone}|${g.dest}`
              const isOpen = open.has(key)
              return (
                <div key={g.dest} className="rounded-lg" style={{ background: heat.bg, border: `1px solid ${C.line2}` }}>
                  <div className="flex items-center gap-2 px-2 py-1">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => toggle(key)}
                      title={isOpen ? 'กดเพื่อซ่อนเลขพัสดุ' : 'กดเพื่อดูเลขพัสดุ'}
                    >
                      <span className="shrink-0 text-xs" style={{ color: C.faint }}>
                        {isOpen ? '▾' : '▸'}
                      </span>
                      <span className="truncate text-[12.5px]" style={{ color: C.mute }}>
                        {g.dest}
                      </span>
                      <b className="ml-auto shrink-0 font-mono text-[15px]" style={{ color: heat.bar }}>
                        {nf(g.rows.length)}
                      </b>
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded-md px-2 py-[2px] text-[11px]"
                      style={{ background: C.panel2, color: C.mute, border: `1px solid ${C.line}` }}
                      onClick={() => onCopy(g.rows.map((r) => r.tracking).join('\n'), `${g.dest} ${g.rows.length} เลข`)}
                    >
                      คัดลอก
                    </button>
                  </div>

                  {isOpen && (
                    <div className="flex flex-wrap gap-[3px] px-2 pb-2">
                      {g.rows.map((r) => (
                        <button
                          key={r.tracking}
                          type="button"
                          onClick={() => onCopy(r.tracking, r.tracking)}
                          className="rounded-md px-[6px] py-[2px] font-mono text-[11.5px]"
                          style={{ background: C.slot, color: C.mute, border: `1px solid ${C.line2}` }}
                        >
                          {r.tracking}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {zones.length === 0 && (
        <p className="px-3 py-6 text-center text-sm" style={{ ...CARD, color: C.faint }}>
          หัวข้อนี้ไม่มีของเลยในรอบนี้
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ ตาราง */

function Table({ rows, snapAt, onCopy }: { rows: P24Row[]; snapAt: string; onCopy: (t: string, w: string) => void }) {
  const [q, setQ] = useState('')
  const [act, setAct] = useState(CANCEL)
  const [old, setOld] = useState(false)
  const [bagOnly, setBagOnly] = useState(false)

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows
      .filter((r) => (act === '' ? true : (r.action || 'ยังไม่มีการดำเนินการ') === act))
      .filter((r) => (!old ? true : (heldHours(r, snapAt) ?? 0) > 48))
      .filter((r) => (!bagOnly ? true : Boolean(r.bag_no)))
      .filter(
        (r) =>
          !s ||
          r.tracking.toLowerCase().includes(s) ||
          r.dest.toLowerCase().includes(s) ||
          (r.bag_no ?? '').toLowerCase().includes(s),
      )
      .sort((a, b) => (heldHours(b, snapAt) ?? 0) - (heldHours(a, snapAt) ?? 0))
  }, [rows, q, act, old, bagOnly, snapAt])

  /* กดเลขถุงในตาราง = เอาเลขนั้นใส่ช่องค้นหา
     ใช้ช่องเดิมแทนที่จะทำตัวกรองใหม่ซ้อนเข้าไป คนจะได้เห็นว่ากรองด้วยอะไรอยู่
     และล้างทิ้งได้ด้วยวิธีเดียวกับที่เคยล้างคำค้น */
  const onBag = (b: string) => setQ(b)

  const acts = useMemo(() => byAction(rows), [rows])

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          className="h-tap min-w-[200px] flex-1 rounded-btn px-3 text-sm"
          style={{ ...field, maxWidth: 320 }}
          type="search"
          placeholder="พิมพ์เลขพัสดุ ชื่อสาขา หรือเลขถุง"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="h-tap rounded-btn px-3 text-sm" style={field} value={act} aria-label="การดำเนินการ" onChange={(e) => setAct(e.target.value)}>
          <option value="">ทุกการดำเนินการ</option>
          {acts.map((a) => (
            <option key={a.action} value={a.action}>
              {a.action} ({a.n})
            </option>
          ))}
        </select>
        <label className="flex min-h-tap items-center gap-2 text-sm" style={{ color: C.mute }}>
          <input type="checkbox" className="h-[18px] w-[18px]" checked={old} onChange={(e) => setOld(e.target.checked)} />
          เฉพาะค้างเกิน 48 ชม
        </label>
        {/* ของจริงมีเลขถุงราว 36% · กรองแล้วเหลือเฉพาะที่ตามเป็นถุงได้ */}
        <label className="flex min-h-tap items-center gap-2 text-sm" style={{ color: C.mute }}>
          <input type="checkbox" className="h-[18px] w-[18px]" checked={bagOnly} onChange={(e) => setBagOnly(e.target.checked)} />
          เฉพาะที่มีเลขถุง
          <span style={{ color: C.faint, fontSize: 11 }}>
            ({nf(rows.filter((r) => r.bag_no).length)})
          </span>
        </label>
        <span className="flex-1" />
        <span className="text-sm" style={{ color: C.faint }}>
          พบ {nf(shown.length)} ชิ้น
        </span>
        <button
          type="button"
          className="h-tap rounded-btn px-4 text-sm font-bold"
          style={{ background: 'var(--b-tab-on)', color: '#111' }}
          onClick={() => onCopy(shown.map((r) => r.tracking).join('\n'), `${shown.length} เลขที่กรองอยู่`)}
        >
          คัดลอกเลขพัสดุทั้ง {nf(shown.length)}
        </button>
      </div>

      <section className="overflow-x-auto p-2" style={CARD}>
        <table className="w-full min-w-[1120px] text-left text-sm">
          <thead style={{ color: C.faint }}>
            <tr style={{ borderBottom: `1px solid ${C.line2}` }}>
              <th className="px-3 py-2 text-xs font-medium">เลขพัสดุ</th>
              <th className="w-[124px] px-3 py-2 text-xs font-medium">ถุงแบ๊กกิ้ง</th>
              <th className="px-3 py-2 text-xs font-medium">ฮับถัดไป</th>
              <th className="w-[70px] px-3 py-2 text-xs font-medium">โซน</th>
              <th className="w-[92px] px-3 py-2 text-xs font-medium">ลูกค้า</th>
              <th className="px-3 py-2 text-xs font-medium">การดำเนินการล่าสุด</th>
              <th className="w-[150px] px-3 py-2 text-xs font-medium">เวลาล่าสุด</th>
              <th className="w-[100px] px-3 py-2 text-right text-xs font-medium">ค้างมาแล้ว</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 500).map((r) => {
              const h = heldHours(r, snapAt)
              return (
                <tr key={r.tracking} style={{ borderBottom: `1px solid ${C.line2}` }}>
                  <td className="px-3 py-[6px]">
                    <button
                      type="button"
                      onClick={() => onCopy(r.tracking, r.tracking)}
                      className="rounded-md px-[6px] py-[2px] font-mono text-[12px]"
                      style={{ background: C.slot, color: C.mute, border: `1px solid ${C.line2}` }}
                    >
                      {r.tracking}
                    </button>
                  </td>
                  {/* คอลัมน์ของตัวเอง · ไม่ได้อยู่ในปุ่มคัดลอก จึงไม่ติดไปเวลาคัดลอก
                      กดได้ด้วย · กดแล้วกรองเหลือเฉพาะชิ้นที่อยู่ถุงเดียวกัน
                      เพราะถ้าเจอถุงนั้นจริง ก็เคลียร์ได้ทีเดียวหลายชิ้น */}
                  <td className="px-3 py-[6px]">
                    {r.bag_no ? (
                      <button
                        type="button"
                        onClick={() => onBag(r.bag_no as string)}
                        className="rounded-md px-[6px] py-[2px] font-mono text-[11.5px]"
                        style={{
                          background: 'rgba(79,163,227,.12)',
                          border: '1px solid rgba(79,163,227,.3)',
                          color: C.lhHi,
                        }}
                        title="กดเพื่อดูเฉพาะชิ้นที่อยู่ถุงนี้"
                      >
                        {r.bag_no}
                      </button>
                    ) : (
                      <span style={{ color: C.faint, fontSize: 11 }}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-[6px]">{r.dest}</td>
                  <td className="px-3 py-[6px]">
                    <Zone z={r.zone} />
                  </td>
                  <td className="px-3 py-[6px] text-[12px]" style={{ color: C.faint }}>
                    {r.cust_type ?? '—'}
                  </td>
                  <td className="px-3 py-[6px]" style={{ color: r.action === CANCEL ? C.redInk : C.mute }}>
                    {r.action || 'ยังไม่มีการดำเนินการ'}
                  </td>
                  <td className="px-3 py-[6px] font-mono text-xs" style={{ color: C.faint }}>
                    {thFull(r.last_at)}
                  </td>
                  <td className="px-3 py-[6px] text-right font-mono text-xs" style={{ color: (h ?? 0) > 48 ? C.redInk : C.mute }}>
                    {h === null ? '—' : `${nf(h)} ชม`}
                  </td>
                </tr>
              )
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center" style={{ color: C.faint }}>
                  ไม่พบพัสดุตามเงื่อนไข
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {shown.length > 500 && (
          <p className="px-3 py-2 text-center text-xs" style={{ color: C.faint }}>
            แสดง 500 แถวแรกจาก {nf(shown.length)} · ปุ่มคัดลอกยังได้ครบทุกเลข
          </p>
        )}
      </section>
    </>
  )
}
