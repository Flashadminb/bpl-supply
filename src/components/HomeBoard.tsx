import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../lib/useAsync'
import { assetBoard, exportToSheet, listAssetTransferRows } from '../lib/api'
import { breakNow, breakOverRecent } from '../lib/breakPass'
import { isLate, listAssetOtOpen } from '../lib/assetOt'
import { ErrorBox, Loading, Modal, Spinner } from './ui'
import { readableError } from '../lib/supabase'
import type { TransferCandidate } from './AssetTransfer'
import type { AssetBoardRow, AssetHolding, AssetIssue, Item, OpenBorrowing } from '../lib/types'

/**
 * กล่องสั่งงานของเครื่องเดียว · ตัวเดียวกับที่หน้ากระดานใช้ ไม่ได้ทำใหม่
 *
 * โหลดแยกก้อนตอนกดเปิดเท่านั้น เพราะข้างในลากกล่องถ่ายรูป กล่องโอน
 * และกล่องเคลียร์ใบแจ้งเสียติดมาทั้งชุด ถ้า import ตรง ๆ ของทั้งกองนี้
 * จะไปกองอยู่ในก้อนของหน้าแรก ซึ่งเป็นหน้าที่ทุกคนต้องโหลดก่อนเสมอ
 * ทั้งที่คนส่วนใหญ่เปิดหน้าแรกแล้วก็ไม่ได้กดเครื่องสักเครื่อง
 */
const DeviceBox = lazy(() =>
  import('../pages/admin/AssetDeviceBox').then((m) => ({ default: m.AssetDeviceBox })),
)

/**
 * แถบบนสุดของหน้าแรกหลังบ้าน
 *
 * หน้าเดิมเป็นการ์ดใหญ่ห้าใบที่บอกแค่ตัวเลขรวม กินไปครึ่งจอ
 * แล้วของที่ต้องลงมือจริง — เครื่องไหนอยู่กับใคร ใกล้ครบกำหนดแล้ว —
 * ต้องเลื่อนลงไปหาเอง · ที่นี่กลับลำดับใหม่
 * ตัวเลขรวมย่อให้เล็กที่สุด เอาที่ว่างไปให้รายตัว
 *
 * ข้อมูลทั้งหมดรับมาจากหน้าแม่ที่ขอไว้อยู่แล้ว ไม่ได้ยิงถามซ้ำ
 * ยกเว้นรายการโอนซึ่งหน้าแม่ไม่เคยขอ
 */

const p2 = (n: number) => String(n).padStart(2, '0')

/** hh:mm แบบไทย · ใช้กับเวลาที่คนจะเอาไปเทียบกับนาฬิกาบนผนัง */
function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
}

function minsLeft(iso: string): number {
  return Math.round((Date.parse(iso) - Date.now()) / 60000)
}

function leftText(m: number): string {
  if (m < 0) {
    const a = Math.abs(m)
    return a >= 60 ? `เลย ${Math.floor(a / 60)} ชม ${a % 60} น.` : `เลย ${a} นาที`
  }
  return m >= 60 ? `เหลือ ${Math.floor(m / 60)} ชม ${m % 60} น.` : `เหลือ ${m} นาที`
}

/* ------------------------------------------------------------ นาฬิกา */

interface DueItem {
  code: string
  who: string
  at: string
}

/** hh:mm:ss จากจำนวนวินาที · เกินหนึ่งวันตัดเป็นวันกับชั่วโมง ไม่งั้นเลขจะยาวจนอ่านไม่ทัน */
function hms(sec: number): string {
  if (sec >= 86400) return `${Math.floor(sec / 86400)} วัน ${Math.floor((sec % 86400) / 3600)} ชม`
  return `${p2(Math.floor(sec / 3600))}:${p2(Math.floor(sec / 60) % 60)}:${p2(sec % 60)}`
}

function Clock({ due }: { due: DueItem[] }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const next = due[0] ?? null
  const sec = next ? Math.max(0, Math.round((Date.parse(next.at) - now.getTime()) / 1000)) : 0

  return (
    <div className="rounded-card bg-dark p-3 text-white">
      <p className="font-mono text-[10px] text-dark-muted">เวลาตอนนี้</p>
      <p className="font-mono text-[32px] font-bold leading-none tracking-wide">
        {p2(now.getHours())}:{p2(now.getMinutes())}:{p2(now.getSeconds())}
      </p>
      <p className="mt-1 text-xs text-dark-text">
        {now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'short' })}{' '}
        {now.getFullYear() + 543}
      </p>
      {next && (
        /* ชี้แล้วกางทั้งหมด · ตัวเลขในกล่องเดินจริงทุกวินาทีเหมือนตัวใหญ่ด้านบน
           เพราะถ้ากางมาแล้วเลขนิ่ง คนจะไม่รู้ว่ามันคือเวลาจริงหรือภาพนิ่งเมื่อกี้ */
        <div className="group relative mt-2 border-t border-dark-3 pt-2">
          <p className="text-[10px] text-dark-muted">
            ใกล้ครบกำหนดสุด {due.length > 1 && <span>· อีก {due.length - 1} เครื่อง ชี้เพื่อดู</span>}
          </p>
          <p className="truncate text-xs">
            {next.code} · {next.who}
          </p>
          <p className="font-mono text-xl font-bold leading-tight text-brand-500">{hms(sec)}</p>

          {/*
            กล่องนี้เคยชี้ไปไม่ถึง เพราะเว้นช่องว่าง 6px ไว้ใต้ตัวการ์ด
            พอเมาส์เลื่อนลงมาในช่องว่างนั้นก็หลุดจากทั้งการ์ดและกล่อง มันเลยดับ
            แก้โดยให้กล่องเริ่มชิดขอบการ์ดเลย แล้วดันระยะห่างเข้าไปเป็น padding ข้างใน
            ช่องว่างยังดูเหมือนเดิม แต่เมาส์เดินผ่านได้เพราะยังอยู่ในกล่อง
            และเอา pointer-events-none ออก ไม่งั้นเลื่อนในกล่องไม่ได้
          */}
          <span className="absolute left-0 top-full z-30 hidden w-[272px] pt-[6px] group-hover:block group-focus-within:block">
          <span className="block overflow-hidden rounded-card border border-line bg-surface text-ink shadow-lg">
            <span className="block border-b border-line-2 px-3 py-2 text-xs font-bold">
              ใกล้ครบกำหนด · {due.length} เครื่อง
            </span>
            <span className="block max-h-[220px] overflow-auto">
              {due.map((d) => {
                const left = Math.max(0, Math.round((Date.parse(d.at) - now.getTime()) / 1000))
                const soon = left <= 3600
                return (
                  <span
                    key={d.code}
                    className="flex items-center gap-2 border-b border-line-2 px-3 py-[4px] text-[11.5px] last:border-0"
                  >
                    <b className="font-mono">{d.code}</b>
                    <span className="min-w-0 flex-1 truncate text-ink-500">{d.who}</span>
                    <b className={`font-mono ${soon ? 'text-warn-txt' : 'text-ink'}`}>{hms(left)}</b>
                  </span>
                )
              })}
            </span>
          </span>
          </span>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ แถบวิ่ง */

function Ticker({ lines }: { lines: { text: string; bad?: boolean }[] }) {
  if (lines.length === 0) return null
  /* วิ่งสองรอบต่อกัน เพื่อให้วนแล้วไม่มีช่องว่างโผล่ตรงรอยต่อ */
  const run = [...lines, ...lines]
  return (
    <div className="mb-2 overflow-hidden rounded-card bg-dark py-[7px]">
      <span className="inline-block animate-[hbTick_30s_linear_infinite] whitespace-nowrap">
        {run.map((l, i) => (
          <span
            key={i}
            className={`px-4 text-[12.5px] ${l.bad ? 'text-danger-txt' : 'text-brand-500'}`}
          >
            ● {l.text}
          </span>
        ))}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------ การ์ด */

interface CardDef {
  key: string
  n: number
  label: string
  tone?: 'bad' | 'warn' | 'go'
  blink?: boolean
  to?: string
  onClick?: () => void
  head: string
  note?: string
  rows: string[]
  more?: number
}

function Card({ c }: { c: CardDef }) {
  const Tag = (c.to ? Link : 'button') as React.ElementType
  const extra = c.to ? { to: c.to } : { type: 'button' as const, onClick: c.onClick }
  const tone =
    c.tone === 'bad'
      ? 'bg-danger-bg text-danger-txt'
      : c.tone === 'warn'
        ? 'bg-warn-bg text-warn-txt'
        : c.tone === 'go'
          ? 'bg-brand-50 text-ink'
          : 'bg-surface-2 text-ink'

  return (
    <Tag
      {...extra}
      className={`group relative block w-full rounded-card border-2 border-transparent p-2 text-left ${tone} ${
        c.blink ? 'animate-[hbBlink_1.25s_ease-in-out_infinite]' : ''
      }`}
    >
      <b className="block font-mono text-xl font-bold leading-none">{c.n.toLocaleString('th-TH')}</b>
      <span className="mt-[2px] block text-[10.5px] opacity-80">{c.label}</span>

      {/* กล่องรายละเอียด · ชี้หรือโฟกัสแล้วกาง เลื่อนในกล่องได้ถ้าของเยอะ */}
      {/* เหตุผลเดียวกับกล่องของนาฬิกา · ไม่มีช่องว่างตาย และเลื่อนในกล่องได้ */}
      <span className="absolute left-0 top-full z-20 hidden w-[264px] pt-[6px] group-hover:block group-focus-within:block">
      <span className="block overflow-hidden rounded-card border border-line bg-surface text-ink shadow-lg">
        <span className="block border-b border-line-2 px-3 py-2 text-xs font-bold">{c.head}</span>
        {c.note && <span className="block px-3 pt-1 text-[10.5px] text-ink-400">{c.note}</span>}
        <span className="block max-h-[188px] overflow-auto px-3 py-1">
          {c.rows.map((r, i) => (
            <span key={i} className="block border-b border-line-2 py-[3px] text-[11.5px] last:border-0">
              {r}
            </span>
          ))}
          {c.rows.length === 0 && <span className="block py-2 text-[11.5px] text-ink-400">ไม่มีรายการ</span>}
        </span>
        {c.more && c.more > 0 ? (
          <span className="block border-t border-line-2 bg-surface-2 px-3 py-[6px] text-center text-[11.5px] text-ink-500">
            และอีก {c.more} รายการ · กดเพื่อดูทั้งหมด
          </span>
        ) : null}
      </span>
      </span>
    </Tag>
  )
}

/* ------------------------------------------------------------ ตัวหลัก */

export function HomeBoard({
  holdings,
  issues,
  items,
  openBorrow,
  pendingApprovals,
  sheetRows,
  fromISO,
  toISO,
  onSent,
  onAssetChanged,
}: {
  holdings: AssetHolding[]
  issues: AssetIssue[]
  items: Item[]
  openBorrow: OpenBorrowing[]
  pendingApprovals: number
  sheetRows: { label: string; n: number; scope: 'asset' | 'supply' }[]
  fromISO: string
  toISO: string
  onSent?: () => void
  /** สั่งงานเครื่องจากหน้านี้สำเร็จแล้ว · ให้หน้าแม่ไปโหลดรายการถือครองใหม่ */
  onAssetChanged?: () => void
}) {
  /** ติ๊กไว้ก่อนทุกชุดที่มีของค้าง · คนเปิดกล่องนี้ส่วนใหญ่ตั้งใจจะส่งทั้งหมดอยู่แล้ว */
  const [sheetOpen, setSheetOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [sentMsg, setSentMsg] = useState<string | null>(null)
  const [sendErr, setSendErr] = useState<string | null>(null)
  /* โอนที่ปลายทางยังไม่กดรับ · หน้าแม่ไม่เคยขอข้อมูลนี้ จึงขอเองที่นี่
     ย้อนหลังเจ็ดวันพอ ของที่ค้างนานกว่านั้นไม่ได้แก้ด้วยการเตือนบนหน้าแรก */
  const moves = useAsync(
    () =>
      listAssetTransferRows({
        fromISO: new Date(Date.now() - 7 * 864e5).toISOString(),
        toISO: new Date().toISOString(),
        limit: 200,
      }),
    [],
  )
  /**
   * เครื่องที่กดเปิดอยู่ · เก็บเป็นรหัส ไม่ได้เก็บทั้งแถว
   *
   * กล่องสั่งงานกินข้อมูลคนละชุดกับตารางนี้ มันขอ asset_board ซึ่งรู้ด้วยว่า
   * เครื่องไหนมีใบแจ้งเสียค้าง มีโอนที่ปลายทางยังไม่รับ และเครื่องไหนว่างอยู่
   * สามเรื่องนั้นไม่มีในรายการถือครองที่หน้านี้ถืออยู่
   *
   * กระดานถูกขอตอนกดเครื่องแรกเท่านั้น ไม่ได้ขอตั้งแต่เปิดหน้า
   * เพราะมันคือ 143 แถวที่คนส่วนใหญ่เปิดหน้าแรกแล้วไม่ได้ใช้
   */
  const [pickCode, setPickCode] = useState<string | null>(null)
  const [wantBoard, setWantBoard] = useState(false)
  const board = useAsync<AssetBoardRow[] | null>(
    async () => (wantBoard ? assetBoard() : null),
    [wantBoard],
  )
  const pick = useMemo(
    () => (pickCode ? ((board.data ?? []).find((r) => r.code === pickCode) ?? null) : null),
    [board.data, pickCode],
  )
  /* เครื่องที่ติ๊กโอนไปพร้อมกันได้ · ส่งทั้งกระดานเหมือนหน้ากระดาน
     ไม่ใช่แค่สิบสองเครื่องที่ตารางนี้โชว์อยู่ */
  const moveCandidates = useMemo<TransferCandidate[]>(
    () =>
      (board.data ?? [])
        .filter((x) => x.is_enabled)
        .map((x) => ({
          code: x.code,
          type_name: x.type_name,
          dept: x.dept_code,
          holder: x.holder_name,
          holderId: x.holder_id,
        })),
    [board.data],
  )

  function openDevice(code: string) {
    setWantBoard(true)
    setPickCode(code)
  }

  /* สถานะเบรคเดี๋ยวนี้ · ก้อนเดียวได้ทั้งแผนกที่เบรคอยู่และใบที่เกินเวลา
     ถามใหม่ทุกนาที เพราะเบรคเป็นเรื่องที่เปลี่ยนทุกไม่กี่นาที
     ต่างจากของค้างคืนที่เปลี่ยนวันละไม่กี่ครั้ง */
  const [brTick, setBrTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setBrTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])
  const br = useAsync(() => breakNow(), [brTick])
  const brGroups = br.data?.groups ?? []
  const brOver = br.data?.over ?? []

  /* ใครเกินเวลาไปแล้วบ้างในรอบ 24 ชม · รวมคนที่กลับเข้ามาแล้ว
     ถามรอบเดียวกับ breakNow เพราะเปลี่ยนด้วยเหตุการณ์เดียวกัน */
  const brPast = useAsync(() => breakOverRecent(60), [brTick])
  const overRows = brPast.data?.rows ?? []
  const overTotal = brPast.data?.total ?? 0
  const over5 = brPast.data?.over5 ?? 0
  const overOut = overRows.filter((o) => !o.back).length

  /* ใบที่ขอ OT ไว้ · เอามาต่อกับรายการถือครองด้วย txn_id
     ที่แยกคำถามเพราะเพิ่มคอลัมน์กลาง view asset_holdings ไม่ได้
     ต้องเขียน view ใหม่ทั้งก้อน ซึ่งเสี่ยงกับของที่หน้างานใช้อยู่ทุกวัน */
  const ot = useAsync(() => listAssetOtOpen(), [])
  const otBy = useMemo(() => {
    const m = new Map<string, { until: string; hours: number }>()
    for (const o of ot.data ?? []) m.set(o.txn_id, { until: o.ot_until, hours: o.ot_hours })
    return m
  }, [ot.data])

  const waiting = (moves.data ?? []).filter((m) => m.state === 'waiting')
  const todayMoves = (moves.data ?? []).filter(
    (m) => new Date(m.created_at).toDateString() === new Date().toDateString(),
  )

  /** เลยกำหนดจริง ๆ · ใบที่ยังอยู่ในช่วง OT ไม่นับ เพราะมีคนจัดการแล้ว */
  const late = useMemo(
    () =>
      holdings
        .filter((h) => isLate(h.due_at, otBy.get(h.txn_id)?.until))
        .sort((a, b) => Date.parse(a.due_at as string) - Date.parse(b.due_at as string)),
    [holdings, otBy],
  )

  /** ขอ OT ไว้และยังไม่เลยเวลาที่ขอ */
  const otOpen = useMemo(
    () =>
      holdings.filter((h) => {
        const u = otBy.get(h.txn_id)?.until
        return u ? Date.now() <= Date.parse(u) : false
      }),
    [holdings, otBy],
  )

  /** เรียงจากใกล้ครบกำหนดสุด · ของที่เลยแล้วขึ้นก่อน เพราะต้องตามก่อน */
  const soon = useMemo(
    () =>
      holdings
        .filter((h) => h.due_at)
        .sort((a, b) => Date.parse(a.due_at as string) - Date.parse(b.due_at as string)),
    [holdings],
  )

  const out = items.filter((i) => i.is_active && i.qty_on_hand === 0)
  const low = items.filter((i) => i.is_active && i.qty_on_hand > 0 && i.qty_on_hand <= i.min_qty)
  const fresh = issues.filter((i) => Date.now() - Date.parse(i.reported_at) < 24 * 3600_000)
  const sheetTotal = sheetRows.reduce((n, r) => n + r.n, 0)

  const cards: CardDef[] = [
    {
      key: 'late',
      n: late.length,
      label: 'เลยกำหนดคืน',
      tone: 'bad',
      to: '/admin/assets-out',
      head: `เลยกำหนดคืน · ${new Set(late.map((h) => h.holder_code)).size} คน`,
      rows: late.slice(0, 20).map((h) => `${h.asset_code} · ${h.holder_name ?? '—'} · ${leftText(minsLeft(h.due_at as string))}`),
      more: Math.max(0, late.length - 20),
    },
    {
      key: 'ot',
      n: otOpen.length,
      label: 'ขอ OT ไว้',
      tone: otOpen.length > 0 ? 'warn' : undefined,
      to: '/admin/assets-out',
      head: 'ต่อเวลาไว้ ยังไม่เลยที่ขอ',
      note: 'กำหนดเดิมยังอยู่ ไม่ได้ถูกลบ',
      rows: otOpen.slice(0, 20).map((h) => {
        const o = otBy.get(h.txn_id)
        const until = o ? new Date(o.until).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '—'
        return `${h.asset_code} · ${h.holder_name ?? '—'} · ถึง ${until} (+${o?.hours ?? 0})`
      }),
      more: Math.max(0, otOpen.length - 20),
    },
    {
      key: 'wait',
      n: waiting.length,
      label: 'โอนรอรับ',
      tone: 'bad',
      blink: waiting.length > 0,
      to: '/admin/asset-moves',
      head: 'โอนแล้วปลายทางยังไม่กดรับ',
      note: 'ของยังนับเป็นของคนส่งจนกว่าปลายทางจะกดรับ',
      rows: waiting
        .slice(0, 20)
        .map((m) => `${m.asset_code} · ${m.from_name ?? '—'} → ${m.to_name ?? '—'}`),
      more: Math.max(0, waiting.length - 20),
    },
    {
      key: 'today',
      n: todayMoves.length,
      label: 'โอนวันนี้',
      to: '/admin/asset-moves',
      head: 'การโอนของวันนี้',
      rows: [
        `รับแล้ว ${todayMoves.filter((m) => m.state === 'claimed').length} · รอรับ ${todayMoves.filter((m) => m.state === 'waiting').length}`,
        `ยกเลิก ${todayMoves.filter((m) => m.state === 'cancelled').length}`,
      ],
    },
    {
      key: 'fresh',
      n: fresh.length,
      label: 'แจ้งซ่อมใหม่',
      tone: fresh.length > 0 ? 'bad' : undefined,
      to: '/admin/asset-moves',
      head: 'แจ้งเข้ามาใน 24 ชม',
      rows: fresh.slice(0, 20).map((i) => `${i.asset_code} · ${i.symptom}`),
      more: Math.max(0, fresh.length - 20),
    },
    {
      key: 'issue',
      n: issues.length,
      label: 'ชำรุดค้าง',
      tone: issues.length > 0 ? 'warn' : undefined,
      to: '/admin/asset-moves',
      head: 'อาการที่ยังไม่เคลียร์',
      rows: issues.slice(0, 20).map((i) => `${i.asset_code} · ${i.symptom}`),
      more: Math.max(0, issues.length - 20),
    },
    {
      key: 'brover',
      n: brOver.length,
      label: 'เบรคเกินเวลา',
      tone: brOver.length > 0 ? 'bad' : undefined,
      blink: brOver.length > 0,
      to: '/admin/break/history?tab=stuck',
      head: 'ใบที่เลยเวลาและยังไม่ได้รับกลับ',
      rows: brOver
        .slice(0, 20)
        .map(
          (o) =>
            `${o.card} · ${o.grp} · ${o.people} คน · เกิน ${o.over_min} นาที` +
            (o.nickname ? ` · ${o.nickname}` : ''),
        ),
      more: Math.max(0, brOver.length - 20),
    },
    {
      key: 'brnow',
      n: brGroups.reduce((n, g) => n + g.open_people, 0),
      label: 'กำลังเบรคอยู่',
      tone: brGroups.length > 0 ? 'warn' : undefined,
      to: '/admin/break/history?tab=stuck',
      head: 'แผนกที่กำลังเบรคอยู่',
      rows: brGroups.map(
        (g) =>
          `${g.name} · ใบ ${g.open_cards}/${g.max_open} · ${g.open_people}/${g.max_people} คน`,
      ),
    },
    {
      key: 'out',
      n: out.length,
      label: 'หมดสต็อก',
      tone: out.length > 0 ? 'bad' : undefined,
      to: '/admin/stock',
      head: 'หมดสต็อกแล้ว',
      rows: out.slice(0, 20).map((i) => `${i.name} · ${i.sku}`),
      more: Math.max(0, out.length - 20),
    },
    {
      key: 'low',
      n: low.length,
      label: 'ใกล้หมด',
      tone: low.length > 0 ? 'warn' : undefined,
      to: '/admin/stock',
      head: 'ต่ำกว่าจุดสั่งซื้อ',
      rows: low.slice(0, 20).map((i) => `${i.name} · เหลือ ${i.qty_on_hand} ขั้นต่ำ ${i.min_qty}`),
      more: Math.max(0, low.length - 20),
    },
    {
      key: 'appr',
      n: pendingApprovals,
      label: 'คำขอรออนุมัติ',
      tone: pendingApprovals > 0 ? 'warn' : undefined,
      to: '/admin/approvals',
      head: 'คำขอเบิกที่รออยู่',
      rows: [`${pendingApprovals} ใบ`],
    },
    {
      key: 'sheet',
      n: sheetTotal,
      label: sheetTotal > 0 ? 'ค้างส่งชีต · กดส่งได้' : 'ค้างส่งชีต',
      tone: sheetTotal > 0 ? 'go' : undefined,
      onClick: () => {
        setPicked(sheetRows.filter((r) => r.n > 0).map((r) => r.scope))
        setSentMsg(null)
        setSendErr(null)
        setSheetOpen(true)
      },
      head: 'รอส่งเข้า Google Sheet',
      note: sheetTotal > 0 ? 'กดที่การ์ดเพื่อเลือกและส่งจากหน้านี้ได้เลย' : undefined,
      rows: sheetRows.map((r) => `${r.label} ${r.n.toLocaleString('th-TH')} บรรทัด`),
    },
  ]

  /**
   * ส่งทีละชุด ไม่ได้ยิงพร้อมกัน
   * เพราะ Edge Function เขียนลงไฟล์เดียวกัน ยิงพร้อมกันคือเสี่ยงเขียนทับกันเอง
   * และถ้าชุดใดชุดหนึ่งพลาด ต้องรู้ว่าชุดไหน ไม่ใช่รู้แค่ว่ามีอะไรพลาด
   */
  async function send() {
    setSending(true)
    setSendErr(null)
    setSentMsg(null)
    const done: string[] = []
    try {
      for (const r of sheetRows) {
        if (!picked.includes(r.scope) || r.n === 0) continue
        const res = await exportToSheet({ scope: r.scope, from: fromISO, to: toISO })
        done.push(`${r.label} เพิ่มใหม่ ${res.appended} อัปของเดิม ${res.updated}`)
      }
      setSentMsg(done.join(' · ') || 'ไม่มีอะไรต้องส่ง')
      onSent?.()
    } catch (e) {
      setSendErr(
        (done.length > 0 ? `ส่งไปแล้ว ${done.join(' · ')} · ` : '') + readableError(e),
      )
    } finally {
      setSending(false)
    }
  }

  const ticker = [
    brOver.length > 0 && { text: `เบรคเกินเวลา ${brOver.length} ใบ`, bad: true },
    fresh.length > 0 && { text: `แจ้งซ่อมใหม่ ${fresh.length} เรื่อง`, bad: true },
    waiting.length > 0 && { text: `โอนรอปลายทางกดรับ ${waiting.length} เครื่อง`, bad: true },
    late.length > 0 && { text: `เลยกำหนดคืน ${late.length} เครื่อง` },
    out.length > 0 && { text: `ของหมดสต็อก ${out.length} รายการ` },
    openBorrow.length > 0 && { text: `สิ้นเปลืองยืมค้าง ${openBorrow.length} รายการ` },
    sheetTotal > 0 && { text: `ค้างส่งชีต ${sheetTotal} บรรทัด` },
  ].filter(Boolean) as { text: string; bad?: boolean }[]

  return (
    <section className="mb-4">
      <style>{`
        @keyframes hbTick { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        @keyframes hbBlink { 0%,100% { border-color: transparent } 50% { border-color: #E24B4A } }
        @keyframes hbFlash { 0%,100% { background: #FCEBEB } 50% { background: #F7C1C1 } }
      `}</style>

      {/*
        กล่องเลือกก่อนส่ง · ไม่ยิงทันทีที่กด
        เพราะส่งชีตคือการเขียนลงไฟล์ขององค์กรที่คนอื่นเปิดดูอยู่
        กดพลาดครั้งเดียวแล้วบอกว่าไม่ได้ตั้งใจ ไม่ช่วยอะไรเลย
      */}
      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title="ส่งเข้า Google Sheet">
        <p className="mb-2 text-sm text-ink-500">
          ติ๊กเลือกว่าจะส่งอะไรบ้าง · ส่งซ้ำไม่เกิดแถวซ้ำ ระบบอัปของเดิมให้
        </p>
        <div className="space-y-2">
          {sheetRows.map((r) => (
            <label
              key={r.scope}
              className={`flex items-start gap-2 rounded-card bg-surface-2 p-3 ${r.n === 0 ? 'opacity-55' : ''}`}
            >
              <input
                type="checkbox"
                className="mt-[2px] h-[18px] w-[18px]"
                disabled={r.n === 0 || sending}
                checked={picked.includes(r.scope)}
                onChange={(e) =>
                  setPicked((p) => (e.target.checked ? [...p, r.scope] : p.filter((x) => x !== r.scope)))
                }
              />
              <span className="flex-1">
                <span className="block font-display text-base">
                  {r.label} · {r.n.toLocaleString('th-TH')} บรรทัด
                </span>
                <span className="block text-xs text-ink-400">
                  {r.n === 0 ? 'ไม่มีของค้าง ติ๊กไม่ได้' : 'ในช่วงวันที่เลือกไว้ด้านบนของหน้า'}
                </span>
              </span>
            </label>
          ))}
        </div>

        {sentMsg && <p className="mt-3 rounded-card bg-success-bg px-3 py-2 text-sm text-success-txt">{sentMsg}</p>}
        {sendErr && <p className="mt-3 rounded-card bg-danger-bg px-3 py-2 text-sm text-danger-txt">{sendErr}</p>}

        <div className="mt-4 flex gap-2">
          <button type="button" className="btn-soft flex-1 py-3" onClick={() => setSheetOpen(false)}>
            ปิด
          </button>
          <button
            type="button"
            className="btn-primary flex-[2] py-3"
            disabled={sending || picked.length === 0}
            onClick={() => void send()}
          >
            {sending ? <Spinner /> : null} ส่ง{' '}
            {sheetRows
              .filter((r) => picked.includes(r.scope))
              .reduce((n, r) => n + r.n, 0)
              .toLocaleString('th-TH')}{' '}
            บรรทัด
          </button>
        </div>
      </Modal>

      <Ticker lines={ticker} />

      <div className="mb-3 grid gap-2 lg:grid-cols-[196px_minmax(0,1fr)]">
        <Clock
          due={soon
            .filter((h) => Date.parse(h.due_at as string) > Date.now())
            .map((h) => ({
              code: h.asset_code,
              who: h.holder_name ?? '—',
              at: h.due_at as string,
            }))}
        />
        <div>
          <p className="label mb-1">
            ต้องจัดการตอนนี้ <span className="text-ink-400">ชี้ที่การ์ดเพื่อดูรายตัว</span>
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {cards.map((c) => (
              <Card key={c.key} c={c} />
            ))}
          </div>
        </div>
      </div>

      {/* แผงแจ้งซ่อม · ขึ้นเฉพาะตอนมีเรื่องใหม่ ไม่มีก็ไม่ขึ้นทั้งแผง */}
      {fresh.length > 0 && (
        <div className="mb-3 rounded-card border-2 border-danger bg-danger-bg p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-pill bg-danger px-3 text-xs text-white">แจ้งซ่อมใหม่</span>
            <b className="text-danger-txt">{fresh.length} เรื่องเข้ามาใน 24 ชม</b>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {fresh.slice(0, 4).map((i) => (
              <div key={i.id} className="rounded-card bg-surface px-3 py-2">
                <p className="text-sm">
                  <b className="font-mono">{i.asset_code}</b> · {i.symptom}
                </p>
                <p className="text-xs text-ink-400">
                  {i.reported_name ?? '—'} · {new Date(i.reported_at).toLocaleString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/*
        สถานะเบรค · ขึ้นเฉพาะตอนมีคนเบรคอยู่จริง
        ทุกช่องกดแล้วเด้งไปที่แท็บใบที่ค้างอยู่ พร้อมใส่คำค้นให้เลย
        ไม่ใช่พาไปหน้าประวัติเฉย ๆ แล้วให้ไปไล่หาเองว่าใบไหน
        จัดเป็นตารางช่องเล็กทั้งแถบ ของเดิมกล่องแดงกินเต็มความกว้าง
        ทั้งที่ข้างในมีป้ายเดียว
      */}
      {(brGroups.length > 0 || brOver.length > 0) && (
        <div className="mb-3 rounded-card bg-surface-2 p-3">
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <span className="font-display text-base">เบรคตอนนี้</span>
            <span className="text-xs text-ink-500">
              {brGroups.reduce((n, g) => n + g.open_cards, 0)} ใบ ·{' '}
              {brGroups.reduce((n, g) => n + g.open_people, 0)} คน
              {brOver.length > 0 && ` · เกินเวลา ${brOver.length} ใบ`}
            </span>
            <span className="flex-1" />
            <Link to="/admin/break/history?tab=stuck" className="text-xs text-ink-500 underline">
              ไปหน้าใบที่ค้างอยู่
            </Link>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {brOver.map((o) => (
              <Link
                key={o.card + o.due_at}
                to={`/admin/break/history?tab=stuck&q=${encodeURIComponent(o.card)}`}
                /* กระพริบเตือนเฉพาะใบที่เกินเวลา · ช้า 1.1 วินาทีต่อรอบ
                   หน้านี้เปิดค้างทั้งกะ ของที่กะพริบถี่จะกวนจนคนเลิกมอง */
                className="animate-[hbFlash_1.1s_ease-in-out_infinite] rounded-card border-2 border-danger px-2 py-[6px]"
              >
                <p className="truncate font-mono text-xs font-bold text-danger-txt">{o.card}</p>
                <p className="truncate text-[11px] text-danger-txt">
                  {o.grp} · {o.people} คน
                </p>
                <p className="font-mono text-[11px] font-bold text-danger-txt">
                  เกิน {o.over_min} นาที
                </p>
              </Link>
            ))}

            {brGroups.map((g) => {
              const leftCards = Math.max(0, g.max_open - g.open_cards)
              const leftPeople = Math.max(0, g.max_people - g.open_people)
              /* ตั้งเพดานไว้ 0 แปลว่าไม่จำกัด ไม่ใช่เต็มสิทธิ
                 เขียนว่าเต็มทั้งที่ไม่ได้จำกัดคือบอกผิด แล้วคนจะไม่กล้าปล่อยเพิ่ม */
              const capCards = g.max_open > 0
              const capPeople = g.max_people > 0
              const full = (capCards && leftCards === 0) || (capPeople && leftPeople === 0)
              return (
                <Link
                  key={g.code}
                  to={`/admin/break/history?tab=stuck&q=${encodeURIComponent(g.code)}`}
                  className="rounded-card border border-line bg-surface px-2 py-[6px]"
                >
                  <p className="truncate font-display text-[13px]">{g.name}</p>
                  <p className="font-mono text-[11px]">
                    ใบ {g.open_cards}
                    {capCards ? `/${g.max_open}` : ''} · {g.open_people}
                    {capPeople ? `/${g.max_people}` : ''} คน
                  </p>
                  <p className="truncate text-[10.5px] text-ink-500">
                    {!capCards && !capPeople
                      ? 'ไม่ได้จำกัดสิทธิ'
                      : full
                        ? 'เต็มสิทธิแล้ว'
                        : `เหลือ ${capCards ? leftCards + ' ใบ' : ''}${capCards && capPeople ? ' · ' : ''}${capPeople ? leftPeople + ' คน' : ''}`}
                  </p>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* ตาราง Asset รายเครื่อง · หัวใจของหน้านี้ */}
      <div className="rounded-card bg-surface-2 p-3">
        <div className="mb-2 flex flex-wrap items-baseline gap-2">
          <span className="font-display text-base">Asset ที่ออกไปอยู่กับคน</span>
          <span className="text-xs text-ink-500">เรียงจากใกล้ครบกำหนดสุด · {soon.length} เครื่อง</span>
          <span className="flex-1" />
          <span className="text-[10.5px] text-ink-400">
            กดที่เครื่องเพื่อโอน คืนแทน หรือดูประวัติ · เขียว ยังเหลือเวลา · เหลือง ใกล้ครบ · แดง เลยแล้ว
          </span>
        </div>
        {/*
          สามช่องต่อแถวบนจอกว้าง · ของเดิมเป็นแถวเต็มความกว้างแถวละเครื่อง
          ซึ่งเหลือที่ว่างกลางแถวเป็นครึ่งจอโดยไม่ได้ใช้ทำอะไร
          สามช่องทำให้เห็นสิบสองเครื่องในที่เท่าเดิมที่เคยเห็นสี่
        */}
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {soon.slice(0, 12).map((h) => {
            const o = otBy.get(h.txn_id)
            /* มี OT ให้นับถอยหลังจากเวลาที่ขอต่อ ไม่ใช่กำหนดเดิม
               เพราะสิ่งที่คนอยากรู้คือเหลือเวลาอีกเท่าไหร่จริง ๆ */
            const m = minsLeft((o?.until ?? h.due_at) as string)
            const over = m < 0
            const warn = !over && m <= 60
            const col = over ? '#A32D2D' : warn ? '#BA7517' : '#0F6E56'
            const bg = over ? 'bg-danger-bg text-danger-txt' : warn ? 'bg-warn-bg text-warn-txt' : 'bg-success-bg text-success-txt'
            /* แถบยาวตามเวลาที่ใช้ไป · ไม่รู้เวลาเริ่มก็ประมาณจากกำหนดแปดชั่วโมง */
            const pct = over ? 100 : Math.max(4, Math.min(100, 100 - (m / 480) * 100))
            return (
              <li key={h.out_item_id}>
                {/*
                  กดแล้วเปิดกล่องเดียวกับหน้ากระดาน · โอน คืนแทน ยกเลิกโอน ดูประวัติ
                  ของเดิมเป็นแค่ข้อความ เห็นว่าเครื่องนี้เลยกำหนดแล้วแต่ทำอะไรไม่ได้
                  ต้องจำรหัสไว้ในหัวแล้วเปิดอีกหน้าไปพิมพ์ค้นใหม่
                */}
                <button
                  type="button"
                  onClick={() => openDevice(h.asset_code)}
                  className="block w-full rounded-card bg-surface px-2 py-[6px] text-left"
                >
                <span className="flex items-center gap-2">
                  <b className="shrink-0 font-mono text-xs">{h.asset_code}</b>
                  {o && (
                    <span className="shrink-0 rounded-pill bg-warn px-[5px] py-[1px] font-mono text-[9.5px] font-bold text-ink">
                      +OT {o.hours}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{h.holder_name ?? '—'}</span>
                  <span className={`shrink-0 whitespace-nowrap rounded-pill px-2 py-[2px] font-mono text-[11.5px] font-bold ${bg}`}>
                    {leftText(m)}
                  </span>
                </span>
                <span className="mt-[1px] block truncate text-[10px] text-ink-400">
                  {h.type_name}
                  {o && ` · เดิม ${new Date(h.due_at as string).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`}
                </span>
                <span className="mt-1 block h-[6px] overflow-hidden rounded-pill bg-ink/10">
                  <i className="block h-full rounded-pill" style={{ width: `${pct}%`, background: col }} />
                </span>
                </button>
              </li>
            )
          })}
          {soon.length === 0 && (
            <li className="py-3 text-center text-sm text-ink-400 sm:col-span-2 xl:col-span-3">
              ไม่มีเครื่องที่ออกไป
            </li>
          )}
        </ul>
        {soon.length > 12 && (
          /* ของเยอะกว่าที่ตารางนี้ไหว ก็ส่งไปหน้ากระดาน ไม่ใช่หน้ารายการค้าง
             เพราะกระดานคือที่เดียวที่กรอง ค้นหา และสั่งงานได้ครบในหน้าเดียว */
          <Link to="/admin/asset-board" className="mt-2 block text-center text-xs text-ink-500 underline">
            ดูทั้งหมดอีก {soon.length - 12} เครื่อง · ไปหน้ากระดาน
          </Link>
        )}
      </div>

      {/*
        เบรคเกินเวลารอบ 24 ชม · อยู่ใต้ตาราง Asset ตามที่เจ้าของระบบสั่ง
        โชว์เฉพาะใบที่เกินจริง ใบที่กลับตรงเวลาไม่ขึ้นเลย
        ใบที่ยังไม่กลับขึ้นก่อนและกระพริบ ใบที่กลับมาแล้วอยู่ต่ออีก 24 ชม แล้วหายเอง
        ทุกช่องกดแล้วเข้าหน้าประวัติที่ใบนั้นทันที ด้วยเลขใบซึ่งไม่ซ้ำกับใครเลย
      */}
      {overRows.length > 0 && (
        <div className="mt-3 rounded-card bg-surface-2 p-3">
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <span className="font-display text-base">เบรคเกินเวลา</span>
            {/*
              สามตัวเลขไม่เท่ากันโดยตั้งใจ · วันหนึ่งปิดใบเกือบห้าร้อยใบ
              และครึ่งหนึ่งเกินหนึ่งนาที ซึ่งคือเวลาเดินกลับเข้าประตู ไม่ใช่การอู้
              ถ้าเขียนแต่เลขก้อนใหญ่ ป้ายนี้จะแดงทุกวันจนไม่มีความหมาย
            */}
            <span className="text-xs text-ink-500">
              รอบ 24 ชม
              {overOut > 0 && (
                <b className="text-danger-txt"> · ยังไม่กลับ {overOut} ใบ</b>
              )}
              {' · เกิน 5 นาทีขึ้นไป '}
              <b>{over5}</b> ใบ · เกิน 1 นาทีขึ้นไป {overTotal} ใบ
            </span>
            <span className="flex-1" />
            <Link
              to="/admin/break/history?tab=history&over=1"
              className="text-xs text-ink-500 underline"
            >
              ไปหน้าประวัติ
            </Link>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {overRows.slice(0, 15).map((o) => (
              <Link
                key={o.id}
                to={`/admin/break/history?tab=history&q=${encodeURIComponent(o.ref)}`}
                className={
                  o.back
                    ? 'rounded-card border border-line bg-surface px-2 py-[6px]'
                    : 'animate-[hbFlash_1.1s_ease-in-out_infinite] rounded-card border-2 border-danger px-2 py-[6px]'
                }
              >
                <span className="flex items-center gap-1">
                  <b
                    className={`min-w-0 flex-1 truncate font-mono text-xs font-bold ${o.back ? '' : 'text-danger-txt'}`}
                  >
                    {o.card}
                  </b>
                  <span
                    className={`shrink-0 rounded-pill px-[5px] py-[1px] text-[9.5px] font-bold ${
                      o.back ? 'bg-ink/10 text-ink-500' : 'bg-danger text-white'
                    }`}
                  >
                    {o.back ? 'กลับแล้ว' : 'ยังไม่กลับ'}
                  </span>
                </span>
                <span
                  className={`mt-[1px] block truncate text-[11px] ${o.back ? 'text-ink-500' : 'text-danger-txt'}`}
                >
                  {o.nickname ? o.nickname + ' · ' : ''}
                  {o.grp} · {o.people} คน
                </span>
                <span
                  className={`block font-mono text-[11px] font-bold ${o.back ? 'text-ink' : 'text-danger-txt'}`}
                >
                  เกิน {o.over_min} นาที
                  <span className="font-sans font-normal text-ink-400">
                    {' · '}
                    {hhmm(o.closed_at ?? o.due_at)}
                  </span>
                </span>
                {o.missing > 0 && (
                  <span className="mt-[2px] block rounded-pill bg-danger px-[5px] py-[1px] text-center text-[9.5px] font-bold text-white">
                    เข้าไม่ครบ · ขาด {o.missing}
                  </span>
                )}
              </Link>
            ))}
          </div>

          <p className="mt-2 text-center text-[10.5px] text-ink-400">
            เรียงจากเกินนานสุด · ใบที่ยังไม่กลับขึ้นก่อนเสมอ
            {overRows.length > 15 && ` · โชว์ 15 ใบแรกจาก ${overTotal} ใบ`}
          </p>
          {overRows.length > 15 && (
            <Link
              to="/admin/break/history?tab=history&over=1"
              className="mt-1 block text-center text-xs text-ink-500 underline"
            >
              ดูทั้งหมดในหน้าประวัติ
            </Link>
          )}
        </div>
      )}

      {/*
        กล่องสั่งงานของเครื่องที่กดเปิด
        ระหว่างรอกระดานโหลด ขึ้นกล่องเปล่าไว้ก่อน ไม่ปล่อยให้กดแล้วเงียบ
        เพราะเน็ตในฮับสะดุดบ่อย แล้วคนจะกดซ้ำอีกสามครั้งคิดว่าไม่ติด
      */}
      {pickCode && !pick && (
        <Modal open onClose={() => setPickCode(null)} title={pickCode}>
          {board.error ? (
            <ErrorBox message={board.error} onRetry={board.reload} />
          ) : board.loading || !board.data ? (
            <Loading label="กำลังเปิดกล่องเครื่อง…" />
          ) : (
            <div>
              <p className="text-sm text-ink-500">
                ไม่เจอเครื่องนี้บนกระดาน · อาจถูกปิดใช้งานหรือย้ายทะเบียนไปแล้ว
              </p>
              <Link to="/admin/asset-board" className="mt-3 block text-sm underline">
                เปิดหน้ากระดานเครื่อง
              </Link>
            </div>
          )}
        </Modal>
      )}
      {pick && (
        <Suspense
          fallback={
            <Modal open onClose={() => setPickCode(null)} title={pick.code}>
              <Loading label="กำลังเปิดกล่องเครื่อง…" />
            </Modal>
          }
        >
          <DeviceBox
            r={pick}
            candidates={moveCandidates}
            onClose={() => setPickCode(null)}
            onDone={() => {
              board.reload()
              onAssetChanged?.()
            }}
          />
        </Suspense>
      )}
    </section>
  )
}
