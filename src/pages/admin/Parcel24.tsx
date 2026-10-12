import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import { Spinner } from '../../components/ui'
import { readableError } from '../../lib/supabase'
import { C, CARD, HEAT_RED, field, heat, nf, tabOff, tabOn, thFull } from '../../lib/boardTheme'
import {
  CANCEL,
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
  const [page, setPage] = useState<'tv' | 'main' | 'table'>('tv')
  const [pick, setPick] = useState<string | null>(null)
  const [clock, setClock] = useState(() => new Date())
  const [copied, setCopied] = useState<string | null>(null)

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
        setLastId(res.is_new ? res.id : null)
        setMsg(
          res.is_new
            ? `บันทึกรอบ ${thFull(p.dataAt)} แล้ว · ${nf(res.rows)} ชิ้น · ยกเลิกการส่งต่อ ${nf(res.cancel)} · เก่าสุดค้างมา ${p.oldestHours} ชม`
            : `ไฟล์นี้เคยอัปแล้ว ไม่ได้บันทึกซ้ำ · รอบ ${thFull(p.dataAt)}`,
        )
        board.reload()
      })
      .catch((x) => setErr(readableError(x)))
      .finally(() => setBusy(false))
  }

  const vs = snap?.prev_at ? `เทียบรอบ ${thFull(snap.prev_at)}` : 'ยังไม่มีรอบก่อนหน้าให้เทียบ'

  return (
    <div style={{ background: C.bg, color: C.ink, minHeight: '100vh' }}>
      <div className="mx-auto max-w-[1900px] p-3">
        {/* ───────── หัวจอ ───────── */}
        <div
          className="mb-2 flex flex-wrap items-center gap-3 px-3 py-2"
          style={{ borderRadius: 14, background: 'linear-gradient(180deg,#121922,#0C1116)', border: `1px solid ${C.line2}` }}
        >
          <button type="button" aria-label="ย้อนกลับ" className="h-tap w-tap rounded-btn text-xl" style={{ color: C.mute }} onClick={() => nav('/admin')}>
            ←
          </button>
          <span className="rounded px-2 py-[2px] text-[13px] font-extrabold" style={{ background: C.brand, color: '#111' }}>
            FLASH
          </span>
          <span className="rounded-lg px-[9px] py-[2px] font-mono text-[15px] font-extrabold" style={{ background: '#1E3246', color: '#8FD0FF' }}>
            24
          </span>
          <span className="text-lg font-bold">
            พัสดุค้างเกิน 24 ชม <Cn>24小时滞留包裹</Cn> · 21BPL
          </span>
          <span className="flex-1" />
          {snap && (
            <span className="text-xs" style={{ color: C.faint }}>
              ข้อมูลถึง {thFull(snap.data_at)} · อัปเข้าระบบ {thFull(snap.uploaded_at)} · {vs}
            </span>
          )}
          <span className="font-mono text-2xl font-extrabold" style={{ color: C.brand }}>
            {clock.toLocaleTimeString('th-TH')}
          </span>
        </div>

        {/* ───────── แถบอัปไฟล์ ───────── */}
        <div
          className="mb-2 flex flex-wrap items-center gap-2 px-3 py-2"
          style={{ borderRadius: 14, background: C.panel, border: `1px solid ${C.line2}` }}
        >
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={onFile} />
          <button
            type="button"
            className="h-tap rounded-btn px-4 text-sm font-bold"
            style={{ background: C.brand, color: '#111' }}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? <Spinner /> : null} อัปไฟล์รอบใหม่ <Cn>上传新一轮</Cn>
          </button>
          <span className="text-xs" style={{ color: C.faint }}>
            {snap ? `${nf(snap.row_count)} ชิ้น · ${groups.length} สาขาในหัวข้อนี้` : 'ยังไม่มีข้อมูล'}
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
          <div className="flex flex-wrap gap-2">
            {([
              ['tv', 'จอทีวี', '电视屏'],
              ['main', 'หน้าหลัก', '主页'],
              ['table', 'ตาราง', '表格'],
            ] as const).map(([k, label, cn]) => (
              <button key={k} type="button" className="h-tap rounded-btn px-4 text-sm" style={page === k ? tabOn : tabOff} onClick={() => setPage(k)}>
                {label} <Cn>{cn}</Cn>
              </button>
            ))}
          </div>
        </div>

        {msg && (
          <p className="mb-2 rounded-card px-3 py-2 text-sm" style={{ background: C.greenBg, color: C.greenInk }}>
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
      style={z ? { background: '#1E3246', color: '#8FD0FF' } : { background: C.chip, color: C.faint, fontWeight: 400 }}
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
   * โซนย่อยของหัวข้อที่เลือกอยู่
   *
   * นับจากกิ่งที่มีอยู่จริงในหัวข้อนี้ ไม่ใช่รายชื่อโซนทั้งระบบ
   * เพราะโซนที่ไม่มีของในหัวข้อนี้เลย ขึ้นมาเป็นปุ่มที่กดแล้วว่างเปล่าก็ไม่มีประโยชน์
   */
  const zones = useMemo(() => {
    const m = new Map<string, { zone: string | null; items: number; branches: number }>()
    for (const g of groups) {
      const k = g.zone ?? ''
      const cur = m.get(k) ?? { zone: g.zone, items: 0, branches: 0 }
      cur.items += g.rows.length
      cur.branches += 1
      m.set(k, cur)
    }
    return [...m.values()].sort((a, b) => b.items - a.items)
  }, [groups])

  /** กดโซนไหนก็เห็นเฉพาะโซนนั้น · กดตัวเลขใหญ่กลับไปเห็นทั้งหมด */
  const shownGroups = useMemo(
    () => (zone === null ? groups : groups.filter((g) => (g.zone ?? '') === zone)),
    [groups, zone],
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
                  background: on ? '#1E0F13' : C.groove,
                  border: on ? `1.5px solid ${'#A32D2D'}` : `1px solid ${C.line2}`,
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
              {nf(zone === null ? total : shownItems)}
            </span>
            <span className="mt-1 block text-[12px]" style={{ color: C.faint }}>
              {zone === null ? `${groups.length} สาขา` : `${zone || 'ไม่มีโซน'} · ${shownGroups.length} สาขา · กดเพื่อดูทั้งหมด`}
            </span>
          </button>


          <button
            type="button"
            className="mt-2 w-full rounded-lg px-3 py-2 text-[12px] font-bold"
            style={{ background: '#2A1116', color: C.redInk, border: `1px solid #5A2127` }}
            onClick={() => onCopy(allText, zone === null ? `ทั้งหมด ${nf(shownItems)} เลข` : `${zone || 'ไม่มีโซน'} ${nf(shownItems)} เลข`)}
          >
            คัดลอก{zone === null ? 'ทั้ง' : `${zone || 'ไม่มีโซน'} `}
            {nf(shownItems)} เลข
          </button>
          <p className="mt-2 text-[11px] leading-relaxed" style={{ color: C.faint }}>
            {open
              ? 'กางครบทุกเลขในหน้าเดียว · กดที่เลขเพื่อคัดลอกทีละเลข'
              : 'หัวข้อนี้มีเยอะ จึงกางเท่าที่ไหว สาขาละ 10 เลขแรก · เลือกโซนเพื่อกางครบ หรือกดกางต่อรายสาขา'}
          </p>
          {zones.length > 1 && (
            <p className="mt-1 text-center text-[10px]" style={{ color: C.faint }}>
              {subOpen ? '▾ แยกตามโซน' : '▾ ชี้หรือกดเพื่อแยกตามโซน'}
            </p>
          )}
        </div>

        {/*
          เมนูย่อยของโซน · ห้อยลงมาจากการ์ดกลางเหมือนกิ่งที่แตกต่อ
          โผล่ตอนเอาเมาส์ชี้หรือกดที่การ์ด และค้างไว้ถ้ากำลังเลือกโซนอยู่
          ไม่ได้โผล่ตลอดเวลา เพราะจอนี้แน่นอยู่แล้ว และคนส่วนใหญ่ดูทั้งก้อนไม่ได้แยกโซน
        */}
        {zones.length > 1 && subOpen && (
          <div className="relative mt-[2px] pl-4">
            <span
              aria-hidden
              className="absolute"
              style={{ left: 9, top: -2, bottom: 14, width: 1, background: C.line }}
            />
            {zones.map((z) => {
              const k = z.zone ?? ''
              const on = zone === k
              return (
                <div key={k || 'none'} className="relative">
                  <span
                    aria-hidden
                    className="absolute"
                    style={{ left: -7, top: '50%', width: 11, height: 1, background: on ? '#2F5A80' : C.line }}
                  />
                  <button
                    type="button"
                    onClick={() => setZone(on ? null : k)}
                    className="mb-[3px] flex w-full items-center gap-2 px-2 py-[5px] text-left"
                    style={{
                      borderRadius: 7,
                      background: on ? '#15293A' : C.groove,
                      border: `1px solid ${on ? '#2F5A80' : C.line2}`,
                    }}
                  >
                    <span className="font-mono text-[11.5px] font-bold" style={{ color: on ? '#8FD0FF' : C.mute }}>
                      {z.zone ?? 'ไม่มีโซน'}
                    </span>
                    <span className="flex-1 text-[10px]" style={{ color: C.faint }}>
                      {z.branches} สาขา
                    </span>
                    <span className="font-mono text-[12.5px] font-bold" style={{ color: on ? '#8FD0FF' : C.lhHi }}>
                      {nf(z.items)}
                    </span>
                  </button>
                </div>
              )
            })}
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
        border: `1px solid ${big ? '#55202A' : C.line2}`,
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
          <button
            key={r.tracking}
            type="button"
            onClick={() => onCopy(r.tracking, r.tracking)}
            className="rounded-md px-[6px] py-[2px] font-mono text-[11.5px]"
            style={{ background: '#101720', color: C.mute, border: `1px solid ${C.line2}` }}
          >
            {r.tracking}
          </button>
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

  return (
    <>
      <div className="mb-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Tile label={<>ยกเลิกการส่งต่อพัสดุ <Cn>取消转寄</Cn></>} n={cancel.length} prev={snapCancelPrev} color={C.redInk} edge={C.red} vs={vs} />
        <Tile label="พัสดุค้างทั้งหมด" n={rows.length} prev={null} color={C.lhHi} edge={C.lh} vs={vs} />
        <Tile label="ค้างเกิน 48 ชม" n={over48} prev={null} color={C.amberInk} edge={C.amber} vs={vs} />
        <Tile label="สาขาปลายทางที่มีของค้าง" n={dests.length} prev={null} color={C.ink} edge={C.line} vs={vs} />
      </div>

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
              <span className="flex h-[13px] flex-1" style={{ background: '#101720', borderRadius: 4, overflow: 'hidden' }}>
                <i
                  style={{
                    display: 'block',
                    height: '100%',
                    width: `${(a.n / max) * 100}%`,
                    background: a.action === CANCEL ? `linear-gradient(90deg,#5A1620,${C.red})` : `linear-gradient(90deg,${C.lhLo},${C.lh})`,
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

/* ------------------------------------------------------------ ตาราง */

function Table({ rows, snapAt, onCopy }: { rows: P24Row[]; snapAt: string; onCopy: (t: string, w: string) => void }) {
  const [q, setQ] = useState('')
  const [act, setAct] = useState(CANCEL)
  const [old, setOld] = useState(false)

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows
      .filter((r) => (act === '' ? true : (r.action || 'ยังไม่มีการดำเนินการ') === act))
      .filter((r) => (!old ? true : (heldHours(r, snapAt) ?? 0) > 48))
      .filter((r) => !s || r.tracking.toLowerCase().includes(s) || r.dest.toLowerCase().includes(s))
      .sort((a, b) => (heldHours(b, snapAt) ?? 0) - (heldHours(a, snapAt) ?? 0))
  }, [rows, q, act, old, snapAt])

  const acts = useMemo(() => byAction(rows), [rows])

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          className="h-tap min-w-[200px] flex-1 rounded-btn px-3 text-sm"
          style={{ ...field, maxWidth: 320 }}
          type="search"
          placeholder="พิมพ์เลขพัสดุ หรือชื่อสาขา"
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
        <span className="flex-1" />
        <span className="text-sm" style={{ color: C.faint }}>
          พบ {nf(shown.length)} ชิ้น
        </span>
        <button
          type="button"
          className="h-tap rounded-btn px-4 text-sm font-bold"
          style={{ background: C.brand, color: '#111' }}
          onClick={() => onCopy(shown.map((r) => r.tracking).join('\n'), `${shown.length} เลขที่กรองอยู่`)}
        >
          คัดลอกเลขพัสดุทั้ง {nf(shown.length)}
        </button>
      </div>

      <section className="overflow-x-auto p-2" style={CARD}>
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead style={{ color: C.faint }}>
            <tr style={{ borderBottom: `1px solid ${C.line2}` }}>
              <th className="px-3 py-2 text-xs font-medium">เลขพัสดุ</th>
              <th className="px-3 py-2 text-xs font-medium">สาขาปลายทาง</th>
              <th className="w-[70px] px-3 py-2 text-xs font-medium">โซน</th>
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
                      style={{ background: '#101720', color: C.mute, border: `1px solid ${C.line2}` }}
                    >
                      {r.tracking}
                    </button>
                  </td>
                  <td className="px-3 py-[6px]">{r.dest}</td>
                  <td className="px-3 py-[6px]">
                    <Zone z={r.zone} />
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
                <td colSpan={6} className="px-3 py-8 text-center" style={{ color: C.faint }}>
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
