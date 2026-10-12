import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import { DateRangePicker } from '../../components/DateRangePicker'
import { BulkDeleteBar, PickBox } from '../../components/BulkDeleteBar'
import { TextHistory } from '../../components/TextHistory'
import { EvidenceImg } from '../../components/EvidenceThumbs'
import { EmptyState, ErrorBox, Loading, Modal, Spinner } from '../../components/ui'
import { BreakStats } from './BreakStats'
import { fmtDateTime } from '../../lib/format'
import { exportToSheet } from '../../lib/api'
import {
  BREAK_CLOSE_REASONS,
  breakHistoryFilters,
  breakPassEdit,
  closeBreakPasses,
  type BreakCloseReason,
  countBreakExportRows,
  deleteBreakPasses,
  purgeExportedBreaks,
  countdown,
  listBreakBoard,
  listBreakPhotos,
  listBreakRows,
  secToMMSS,
  type BreakRow,
} from '../../lib/breakPass'

/**
 * ประวัติเบรค — หน้าของผู้ตรวจสอบและเจ้าของระบบ
 *
 * เวลาสามจุดคือหัวใจของหน้านี้ ยื่น → ผ่านประตู → กลับ
 *   เดิน      ยื่นถึงผ่านประตู   ต่างกันตามระยะทางของแต่ละแผนก
 *   ข้างนอก   ผ่านประตูถึงกลับ   ← ช่องนี้ช่องเดียวที่เทียบข้ามแผนกได้
 * ถ้าดูแต่เวลารวม แผนกที่อยู่ไกลห้องน้ำจะดูเหมือนอู้กว่าทั้งที่ไม่ได้อู้
 *
 * ใบที่หลังบ้านปิดเองไม่คิดเวลาเกินให้ เพราะเวลาที่ค้างเกิดจากลืมกดรับกลับ
 * ไม่ใช่คนนั้นอยู่ข้างนอกจริง ๆ ถ้านับรวมสถิติทั้งเดือนจะเพี้ยนไปเลย
 */

type Tab = 'history' | 'stuck' | 'stats' | 'trash'

function dayKey(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d)
}

const hhmm = (iso: string | null) => (iso ? fmtDateTime(iso).slice(-5) : '—')

function StatusPill({ r }: { r: BreakRow }) {
  if (r.close_kind === 'problem') {
    return (
      <span className="badge-dang">
        {r.missing_people > 0 ? `เข้าไม่ครบ · ขาด ${r.missing_people}` : 'แจ้งปัญหา'}
      </span>
    )
  }
  if (!r.closed_at) return <span className="badge-mute">ยังไม่กลับ</span>
  if (r.close_kind === 'admin' || r.close_kind === 'supervisor') {
    return <span className="badge-mute">ปิดเอง · ไม่นับเวลา</span>
  }
  if (!r.gate_out_at) return <span className="badge-mute">ไม่ได้สแกนขาออก</span>
  if ((r.over_sec ?? 0) > 0) return <span className="badge-dang">เกิน {secToMMSS(r.over_sec)}</span>
  return <span className="badge-ok">ตรงเวลา</span>
}

/**
 * แถวที่กางออก — รูปตอนปล่อยอยู่ซ้าย รูปตอนรับกลับอยู่ขวา
 *
 * กดรูปแล้วขยายในแอพ ไม่ได้ลิงก์ออกไป Drive เหมือนเดิม
 * ของเดิมหุ้มรูปทุกใบด้วย <a href={web_link}> ซึ่งบนคอมไม่ค่อยมีใครกดโดน
 * แต่บนมือถือนิ้วโดนง่ายมาก แล้วจะเจอหนึ่งในสองอย่าง
 *   บัญชี Google ส่วนตัวไม่มีสิทธิ์ในโฟลเดอร์ → หน้าขอสิทธิ์ซึ่งงงเปล่า ๆ
 *   มีสิทธิ์ → เท่ากับเปิดทางเข้า Drive ที่อยู่นอกระบบสิทธิ์ของแอพทั้งหมด
 *             ส่งต่อลิงก์ให้ใครก็ได้ และไม่มีใครรู้ว่าใครเปิดดู
 * ตรงกับกติกาข้อ 4 และ 6 ที่ห้ามลิงก์ Drive โผล่ฝั่งหน้าจอ
 */
function Photos({ passId }: { passId: number }) {
  const shots = useAsync(() => listBreakPhotos(passId), [passId])
  const [big, setBig] = useState<string | null>(null)
  if (shots.loading) return <Loading label="กำลังโหลดรูป…" />
  if (shots.error) return <ErrorBox message={shots.error} onRetry={shots.reload} />
  const all = shots.data ?? []
  const issue = all.filter((s) => s.phase === 'issue')
  const ret = all.filter((s) => s.phase === 'return')

  return (
    <div className="flex flex-wrap gap-5">
      <div>
        <p className="mb-1 text-xs font-semibold text-ink-500">ตอนปล่อย · {issue.length} รูป</p>
        <div className="flex flex-wrap gap-1.5">
          {issue.length === 0 ? (
            <span className="text-xs text-ink-400">ไม่มีรูป</span>
          ) : (
            issue.map((s) => (
              <EvidenceImg
                key={s.id}
                fileId={s.file_id}
                enabled
                className="h-28 w-20 rounded-btn"
                onClick={() => setBig(s.file_id)}
              />
            ))
          )}
        </div>
      </div>
      {ret.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-danger-txt">
            ตอนรับกลับ · {ret.length} รูป
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ret.map((s) => (
              <EvidenceImg
                key={s.id}
                fileId={s.file_id}
                enabled
                className="h-28 w-20 rounded-btn"
                onClick={() => setBig(s.file_id)}
              />
            ))}
          </div>
        </div>
      )}

      <Modal open={Boolean(big)} onClose={() => setBig(null)} title="รูปหลักฐาน">
        {big && <EvidenceImg fileId={big} enabled className="w-full rounded-card" />}
      </Modal>
    </div>
  )
}

export default function BreakHistory() {
  /**
   * เปิดแท็บและคำค้นตามลิงก์ที่พามา
   *
   * หน้าแรกส่งมาที่ ?tab=stuck&q=OUT6-05 เพื่อให้กดจากการ์ดแล้วเจอใบนั้นเลย
   * ของเดิมพามาที่แท็บประวัติเสมอ ซึ่งเป็นคนละแท็บกับที่ใบค้างอยู่
   * คนกดจากหน้าแรกจึงต้องมาไล่หาเองอีกรอบ ทั้งที่เพิ่งชี้ไปแล้วว่าใบไหน
   */
  const q0 = new URLSearchParams(useLocation().search)
  const tab0 = q0.get('tab')
  const [tab, setTab] = useState<Tab>(
    tab0 === 'stuck' || tab0 === 'stats' || tab0 === 'trash' ? tab0 : 'history',
  )
  // ย้อนหลัง 7 วันพอ เบรคเกิดวันละหลายร้อยใบ ตั้ง 30 วันแล้วตารางจะชนเพดาน 1000 แถว
  const [from, setFrom] = useState(dayKey(-7))
  const [to, setTo] = useState(dayKey())
  /* ลิงก์จากป้ายเบรคเกินเวลาบนหน้าแรกพามาที่ ?over=1
       เพื่อให้เปิดมาแล้วเห็นเฉพาะใบที่เกิน ไม่ใช่เห็นทั้งเจ็ดวันแล้วไล่หาเอง */
  const [onlyOver, setOnlyOver] = useState(q0.get('over') === '1')
  const [onlyBan, setOnlyBan] = useState(false)
  const [onlyProblem, setOnlyProblem] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  // ค้นหาด้วยรหัสบัตรหรือชื่อคนปล่อย · สองอย่างนี้คือสิ่งที่คนจำได้ตอนตามเรื่องย้อนหลัง
  const [search, setSearch] = useState(q0.get('q') ?? '')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [group, setGroup] = useState('')
  const [card, setCard] = useState('')
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(50)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const range = useMemo(
    () => ({
      from: new Date(`${from}T00:00:00`).toISOString(),
      to: new Date(`${to}T23:59:59`).toISOString(),
    }),
    [from, to],
  )

  const rows = useAsync(
    () => listBreakRows({ ...range, onlyOver, onlyBan, onlyProblem, group, card, q: search, page, size }),
    [range, onlyOver, onlyBan, onlyProblem, group, card, search, page, size, tick],
  )
  const filters = useAsync(() => breakHistoryFilters(), [tick])

  /* เปลี่ยนตัวกรองแล้วต้องกลับหน้าแรก ไม่งั้นจะค้างอยู่หน้า 7 ของผลลัพธ์ที่มี 2 หน้า */
  const filterKey = `${from}|${to}|${onlyOver}|${onlyBan}|${onlyProblem}|${group}|${card}|${search}|${size}`
  const lastKey = useRef(filterKey)
  useEffect(() => {
    if (lastKey.current !== filterKey) {
      lastKey.current = filterKey
      setPage(0)
    }
  }, [filterKey])
  const stuck = useAsync(() => listBreakBoard(), [tick])
  const pendingRange = useAsync(() => countBreakExportRows(range), [range, tick])
  const pendingAll = useAsync(() => countBreakExportRows(), [tick])
  const outside = Math.max(0, (pendingAll.data ?? 0) - (pendingRange.data ?? 0))

  const [pushing, setPushing] = useState(false)
  const [pushed, setPushed] = useState<string | null>(null)
  const [purgeAsk, setPurgeAsk] = useState(false)

  async function pushSheet() {
    setPushing(true)
    setPushed(null)
    setErr(null)
    try {
      const res = await exportToSheet({ scope: 'break', from: range.from, to: range.to })
      setPushed(`เพิ่มใหม่ ${res.appended} แถว · อัปของเดิม ${res.updated} แถว · ${res.sheet}`)
      setTick((n) => n + 1)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setPushing(false)
    }
  }

  const list = rows.data?.rows ?? []
  const total = rows.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / size))
  const opts = filters.data ?? { groups: [], cards: [] }
  const cardOpts = group ? opts.cards.filter((c) => c.group_code === group) : opts.cards
  const stuckList = stuck.data ?? []
  const allPicked = list.length > 0 && list.every((r) => picked.has(r.id))

  function toggle(id: number) {
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const now = Date.now()

  const sum = useMemo(() => {
    const done = list.filter((r) => r.closed_at && r.close_kind === 'guard')
    const over = done.filter((r) => (r.over_sec ?? 0) > 0).length
    const people = list.reduce((n, r) => n + r.people, 0)
    const outAvg = done.length
      ? Math.round(done.reduce((n, r) => n + (r.out_sec ?? 0), 0) / done.length)
      : null
    return { total: list.length, people, over, outAvg, problem: list.filter((r) => r.close_kind === 'problem').length }
  }, [list])

  /**
   * ใบที่กำลังจะปิด · null = ยังไม่ได้กดปิดอะไร
   * เก็บเป็นรายการ id เพราะปุ่ม "ปิดทั้งหมด" ใช้กล่องเดียวกัน
   */
  const [closing, setClosing] = useState<number[] | null>(null)
  const [reason, setReason] = useState<BreakCloseReason | null>(null)
  const [closeNote, setCloseNote] = useState('')

  async function closeStuck(ids: number[], why: BreakCloseReason, note: string) {
    setBusy(true)
    setErr(null)
    try {
      await closeBreakPasses(ids, note.trim() || 'ปิดจากหน้าหลังบ้าน', why)
      setClosing(null)
      setReason(null)
      setCloseNote('')
      setTick((n) => n + 1)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {/*
        กล่องเลือกเหตุผลตอนปิดใบแทน
        บังคับเลือก เพราะปลายทางคือสถิติว่าปิดแทนเพราะอะไรบ่อยสุด
        ถ้าปล่อยให้ข้ามได้ สถิติจะเต็มไปด้วยช่องว่างซึ่งแปลผลไม่ได้
      */}
      <Modal
        open={closing !== null}
        onClose={() => setClosing(null)}
        title={closing && closing.length > 1 ? `ปิด ${closing.length} ใบ` : 'ปิดใบนี้'}
      >
        <p className="mb-3 text-sm text-ink-500">
          เลือกว่าทำไมใบนี้ถึงต้องปิดแทน · ใบที่ปิดแทนไม่ได้แปลว่าคนผิดเสมอไป
          บางทีคือประตูไม่ได้สแกน ซึ่งต้องไปแก้คนละที่
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          {BREAK_CLOSE_REASONS.map((x) => (
            <button
              key={x.code}
              type="button"
              className={'chip ' + (reason === x.code ? 'chip-on' : '')}
              onClick={() => setReason(x.code)}
            >
              {x.label}
            </button>
          ))}
        </div>
        {/*
          เลือก "อื่น ๆ" แล้วต้องพิมพ์เหตุผลเอง เพราะไม่งั้นจะได้ใบที่ปิดโดยไม่มีเหตุผลเลย
          ซึ่งแย่กว่าตัวเลือกสำเร็จรูปที่ไม่ตรงนัก อย่างน้อยอันนั้นยังบอกทิศทางได้
        */}
        <input
          className="input"
          placeholder={reason === 'other' ? 'พิมพ์เหตุผล · บังคับ' : 'รายละเอียดเพิ่มเติม (ไม่บังคับ)'}
          value={closeNote}
          onChange={(e) => setCloseNote(e.target.value)}
        />
        {reason === 'other' && !closeNote.trim() && (
          <p className="mt-1 text-xs text-danger-txt">เลือกอื่น ๆ แล้วต้องพิมพ์เหตุผลด้วย</p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-soft text-sm" onClick={() => setClosing(null)}>
            ไม่ปิดแล้ว
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={busy || !reason || !closing || (reason === 'other' && !closeNote.trim())}
            onClick={() => {
              if (closing && reason) void closeStuck(closing, reason, closeNote)
            }}
          >
            {busy ? <Spinner /> : null} ยืนยันปิด
          </button>
        </div>
      </Modal>

      <div className="mb-4">
        <h1 className="font-display text-xl">ประวัติเบรค</h1>
        <p className="mt-1 text-sm text-ink-500">
          เทียบเวลาข้ามแผนกให้ดูช่อง &ldquo;ข้างนอก&rdquo; อย่างเดียว
          ช่อง &ldquo;เดิน&rdquo; ต่างกันตามระยะทาง ไม่ใช่ความขยัน
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" className="btn-ghost px-4 py-2 text-sm" onClick={pushSheet} disabled={pushing}>
          {pushing ? <Spinner /> : 'ส่งลง Google Sheet'}
          {!pushing && (pendingRange.data ?? 0) > 0 && (
            <span className="ml-1 rounded-pill bg-brand-500 px-2 font-display text-xs text-ink">
              {(pendingRange.data ?? 0) > 99 ? '99+' : pendingRange.data}
            </span>
          )}
        </button>
        <button
          type="button"
          className="btn-ghost px-4 py-2 text-sm"
          onClick={() => setPurgeAsk(true)}
          disabled={busy || pushing}
        >
          ลบของเก่ากว่า 3 เดือน
        </button>
      </div>

      {pushed && (
        <div className="mb-3 rounded-card border border-success/25 bg-success-bg p-3 text-sm text-success-txt">
          ส่งลงชีตแล้ว · {pushed}
          <button type="button" className="ml-2 underline" onClick={() => setPushed(null)}>
            ปิด
          </button>
        </div>
      )}

      {outside > 0 && (
        <p className="mb-3 rounded-card border border-warn/30 bg-warn-bg p-3 text-sm text-warn-txt">
          ยังมีอีก {outside} ใบที่ยังไม่ได้ส่งลงชีต แต่อยู่นอกช่วงวันที่ที่เลือกอยู่ —
          ต้องขยายช่วงวันที่ก่อน ถึงจะกดส่งของพวกนั้นได้
        </p>
      )}

      <Modal open={purgeAsk} onClose={() => setPurgeAsk(false)} title="ลบประวัติเบรคที่เก่ากว่า 3 เดือน">
        <p className="rounded-btn bg-danger-bg px-3 py-3 text-sm text-danger-txt">
          ลบใบที่ปิดแล้วและเก่ากว่า 90 วันออกจากฐานข้อมูลถาวร
        </p>
        <p className="mt-2 text-sm text-ink-500">
          ลบได้เฉพาะใบที่ส่งลงชีตไปแล้วเท่านั้น ถ้ามีใบที่ยังไม่ได้ส่งปนอยู่ ระบบจะไม่ลบอะไรเลย
          และบอกว่าเหลือกี่ใบที่ต้องกดส่งก่อน
          <br />
          ชีตเก็บครบทุกช่องรวมลิงก์รูปในไดร์ฟ ย้อนดูได้เหมือนเดิมทุกอย่าง
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setPurgeAsk(false)}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="h-tap rounded-btn bg-danger px-4 text-white"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setErr(null)
              void purgeExportedBreaks(90)
                .then((r) => {
                  setPushed(`ลบของเก่าไป ${r.deleted} ใบ`)
                  setPurgeAsk(false)
                  setTick((n) => n + 1)
                })
                .catch((e) => setErr((e as Error).message))
                .finally(() => setBusy(false))
            }}
          >
            {busy ? <Spinner /> : null} ลบของเก่า
          </button>
        </div>
      </Modal>

      <div className="mb-4 flex gap-2">
        {(
          [
            ['history', 'ประวัติ'],
            ['stuck', `ใบที่ค้างอยู่ (${stuckList.length})`],
            ['stats', 'สถิติ'],
            ['trash', 'ที่ลบแล้ว'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={tab === k ? 'btn-primary px-4 py-2 text-sm' : 'btn-ghost px-4 py-2 text-sm'}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {err && (
        <div className="mb-3">
          <ErrorBox message={err} />
        </div>
      )}

      {tab === 'stats' ? (
        <BreakStats from={range.from} to={range.to} />
      ) : tab === 'trash' ? (
        <TextHistory kind="break" fromISO={range.from} toISO={range.to} />
      ) : tab === 'stuck' ? (
        <>
          <p className="mb-3 rounded-card border border-line bg-surface p-3 text-sm text-ink-500">
            ไม่มีปิดอัตโนมัติ · ใบที่ไม่มีใครมารับกลับจะมากองที่นี่รอคุณปิดเอง
            <br />
            บัตรใบนั้นเอาไปปล่อยซ้ำไม่ได้จนกว่าจะปิด และเวลาที่ค้างจะไม่ถูกนับเป็นเวลาอู้ของใคร
          </p>
          {stuck.loading && stuckList.length === 0 ? (
            <Loading />
          ) : stuckList.length === 0 ? (
            <EmptyState title="ไม่มีใบค้าง" hint="ทุกใบถูกรับกลับครบแล้ว" />
          ) : (
            <>
              <ul className="space-y-2">
                {stuckList.map((r) => {
                  const cd = countdown(r.due_at, now)
                  return (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center gap-3 rounded-card border border-line p-3"
                    >
                      <span className="font-mono text-sm font-bold">{r.card_code}</span>
                      <span className="min-w-0 flex-1 text-sm text-ink-500">
                        {r.reason_label} · {r.people} คน · {r.issued_by_name}
                        <br />
                        ยื่น {hhmm(r.issued_at)}
                        {r.gate_out_at ? ` · ผ่านประตู ${hhmm(r.gate_out_at)}` : ' · ไม่ได้สแกนขาออก'}
                      </span>
                      <span className="font-mono text-sm font-bold text-danger-txt">{cd.text}</span>
                      <button
                        type="button"
                        className="btn-ghost px-3 py-1.5 text-xs"
                        disabled={busy}
                        onClick={() => {
                          setClosing([r.id])
                          setReason(null)
                          setCloseNote('')
                        }}
                      >
                        ปิดใบนี้
                      </button>
                    </li>
                  )
                })}
              </ul>
              <button
                type="button"
                className="btn-primary mt-3 px-4 py-2 text-sm"
                disabled={busy}
                onClick={() => {
                  setClosing(stuckList.map((x) => x.id))
                  setReason(null)
                  setCloseNote('')
                }}
              >
                {busy ? <Spinner /> : null}ปิดทั้งหมด {stuckList.length} ใบ
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <DateRangePicker
            from={from}
            to={to}
            onChange={(f, t) => {
              setFrom(f)
              setTo(t)
            }}
          />

          <input
            className="input mt-3 max-w-[320px]"
            type="search"
            placeholder="ค้นหารหัสบัตร หรือชื่อคนปล่อย"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPicked(new Set())
            }}
          />

          <div className="my-3 flex flex-wrap gap-2">
            {(
              [
                ['เฉพาะที่เกินเวลา', onlyOver, setOnlyOver],
                ['เฉพาะช่วงห้าม', onlyBan, setOnlyBan],
                ['เฉพาะที่แจ้งปัญหา', onlyProblem, setOnlyProblem],
              ] as [string, boolean, (v: boolean) => void][]
            ).map(([label, on, set]) => (
              <button
                key={label}
                type="button"
                className={`rounded-btn border px-3 py-1.5 text-xs ${
                  on ? 'border-ink bg-ink font-semibold text-white' : 'border-line bg-surface'
                }`}
                onClick={() => set(!on)}
              >
                {label}
              </button>
            ))}
          </div>

          {rows.loading && list.length === 0 ? (
            <Loading />
          ) : rows.error ? (
            <ErrorBox message={rows.error} onRetry={rows.reload} />
          ) : list.length === 0 ? (
            <EmptyState title="ไม่มีรายการในช่วงนี้" hint="ลองขยายช่วงวันที่หรือเอาตัวกรองออก" />
          ) : (
            <>
              <p className="mb-3 rounded-card border border-line bg-surface p-3 text-sm">
                <b>{sum.total}</b> ใบ · <b>{sum.people}</b> คน · เกินเวลา{' '}
                <b className="text-danger-txt">{sum.over}</b> ใบ · แจ้งปัญหา{' '}
                <b className="text-danger-txt">{sum.problem}</b> ใบ
                {sum.outAvg !== null && (
                  <>
                    {' '}
                    · อยู่ข้างนอกเฉลี่ย <b>{secToMMSS(sum.outAvg)}</b>
                  </>
                )}
              </p>

              <BulkDeleteBar
                n={picked.size}
                noun="ใบ"
                confirmLabel={`ลบ ${picked.size} ใบ`}
                warning={
                  <>
                    ใบเบรคที่เลือกจะหายออกจากประวัติถาวร กู้คืนไม่ได้
                    <br />
                    ใบที่ยังไม่ปิดลบไม่ได้ ต้องไปกดปิดที่แท็บ &ldquo;ใบที่ค้างอยู่&rdquo; ก่อน
                  </>
                }
                onClear={() => setPicked(new Set())}
                onDelete={async (why) => {
                  await deleteBreakPasses([...picked], why)
                  setPicked(new Set())
                  setTick((n) => n + 1)
                }}
              />

              {/* ตัวกรองแผนกกับบัตร · ทั้งคู่กรองที่ฝั่งเซิร์ฟเวอร์ ไม่ใช่กรองเฉพาะหน้าที่เห็น */}
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <select
                  className="input h-tap max-w-[220px]"
                  aria-label="แผนก"
                  value={group}
                  onChange={(e) => {
                    setGroup(e.target.value)
                    setCard('')
                  }}
                >
                  <option value="">ทุกแผนก</option>
                  {opts.groups.map((g) => (
                    <option key={g.code} value={g.code}>
                      {g.name || g.code} ({g.n})
                    </option>
                  ))}
                </select>
                <select className="input h-tap max-w-[200px]" aria-label="บัตร" value={card} onChange={(e) => setCard(e.target.value)}>
                  <option value="">ทุกบัตร</option>
                  {cardOpts.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} ({c.n})
                    </option>
                  ))}
                </select>
                <select
                  className="input h-tap w-[130px]"
                  aria-label="กี่แถวต่อหน้า"
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                >
                  <option value={25}>25 แถว/หน้า</option>
                  <option value={50}>50 แถว/หน้า</option>
                  <option value={100}>100 แถว/หน้า</option>
                  <option value={200}>200 แถว/หน้า</option>
                </select>
                <span className="flex-1" />
                <Pager page={page} pages={pages} total={total} onGo={setPage} />
              </div>

              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink-500">
                      <th className="w-[44px] p-2">
                        <PickBox
                          on={allPicked}
                          label="เลือกทั้งหมด"
                          onToggle={() =>
                            setPicked(allPicked ? new Set() : new Set(list.map((r) => r.id)))
                          }
                        />
                      </th>
                      <th className="p-2">บัตร</th>
                      <th className="p-2">เหตุผล · ปล่อยโดย</th>
                      <th className="p-2">ยื่น</th>
                      <th className="p-2">ผ่านประตู</th>
                      <th className="p-2">กลับ</th>
                      <th className="p-2">เดิน</th>
                      <th className="p-2">ข้างนอก</th>
                      <th className="p-2">สถานะ</th>
                      <th className="w-[56px] p-2">แก้</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      // คีย์ต้องอยู่ที่ Fragment ไม่ใช่ที่ tr ข้างใน
                      // เพราะแถวขยายกับแถวหลักเป็นพี่น้องกันในลิสต์เดียว
                      <Fragment key={r.id}>
                        <tr
                          className="cursor-pointer border-b border-line-2 hover:bg-ink/5"
                          onClick={() => setOpen(open === r.id ? null : r.id)}
                        >
                          {/* กดช่องติ๊กต้องไม่พาแถวกางออกด้วย คนละความตั้งใจกัน */}
                          <td className="p-2" onClick={(e) => e.stopPropagation()}>
                            <PickBox
                              on={picked.has(r.id)}
                              label={`เลือกใบ ${r.card_code}`}
                              onToggle={() => toggle(r.id)}
                            />
                          </td>
                          <td className="p-2 font-mono font-bold">{r.card_code}</td>
                          <td className="p-2">
                            {r.reason_label}
                            {r.in_ban && <span className="ml-1 badge-dang">ช่วงห้าม</span>}
                            <span className="block text-xs text-ink-400">
                              {r.issued_by_name} {r.issued_by_code}
                              {r.nickname ? ` · ${r.nickname}` : ''}
                            </span>
                          </td>
                          <td className="p-2">{hhmm(r.issued_at)}</td>
                          <td className="p-2">{hhmm(r.gate_out_at)}</td>
                          <td className="p-2">{hhmm(r.closed_at)}</td>
                          <td className="p-2 text-ink-500">{secToMMSS(r.walk_sec)}</td>
                          <td className="p-2 font-bold">{secToMMSS(r.out_sec)}</td>
                          <td className="p-2">
                            <StatusPill r={r} />
                          </td>
                          {/*
                            ปุ่มแก้อยู่ติดสถานะเลย ไม่ต้องกางแถวก่อน
                            เพราะเก้าในสิบครั้งที่เปิดหน้านี้ คนมาแก้สถานะกับเวลา
                            ไม่ได้มาดูรูป · ของเดิมต้องกดแถว แล้วรอรูปโหลด
                            แล้วค่อยกดปุ่มแก้ แล้วค่อยได้ฟอร์ม สามจังหวะเพื่อเรื่องเดียว
                            stopPropagation เพราะทั้งแถวเป็นปุ่มกางอยู่แล้ว
                            ถ้าไม่กัน กดในฟอร์มทีไรแถวจะกางปิดสลับไปด้วยทุกครั้ง
                          */}
                          <td className="p-2" onClick={(e) => e.stopPropagation()}>
                            <QuickEdit r={r} onDone={() => setTick((n) => n + 1)} />
                          </td>
                        </tr>
                        {open === r.id && (
                          <tr className="border-b border-line-2 bg-ink/5">
                            <td colSpan={10} className="p-3">
                              <p className="mb-2 text-xs text-ink-500">
                                {r.ref_no} · ขอ {r.minutes} นาที · {r.people} คน
                                {r.returned_people !== null && ` · กลับ ${r.returned_people} คน`}
                                {r.ban_reason && ` · เหตุผลฉุกเฉิน: ${r.ban_reason}`}
                                {r.problem_code && ` · ${r.problem_code}`}
                                {r.problem_note && ` · ${r.problem_note}`}
                                {r.closed_by_name && ` · รับกลับโดย ${r.closed_by_name}`}
                              </p>
                              <Photos passId={r.id} />
                              <EditPass r={r} onDone={() => setTick((n) => n + 1)} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-xs text-ink-400">
                  กดปุ่มแก้ท้ายแถวเพื่อแก้สถานะหรือเวลาได้เลย · กดที่แถวถ้าจะดูรูปด้วย
                </p>
                <span className="flex-1" />
                <Pager page={page} pages={pages} total={total} onGo={setPage} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

/**
 * ปุ่มเปลี่ยนหน้า
 *
 * โชว์เลขหน้าปัจจุบันกับจำนวนทั้งหมดเสมอ ไม่ใช่แค่ปุ่มก่อนหน้า-ถัดไป
 * เพราะคนที่กำลังไล่ดูย้อนหลังต้องรู้ว่าเหลืออีกเท่าไหร่ ไม่งั้นไม่รู้ว่าจะจบเมื่อไหร่
 */
function Pager({
  page,
  pages,
  total,
  onGo,
}: {
  page: number
  pages: number
  total: number
  onGo: (p: number) => void
}) {
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-ink-500">ทั้งหมด {total.toLocaleString('th-TH')} ใบ</span>
      <button type="button" className="btn-soft h-tap px-3 text-sm" disabled={page <= 0} onClick={() => onGo(page - 1)}>
        ‹ ก่อนหน้า
      </button>
      <span className="text-sm font-semibold">
        {page + 1} / {pages}
      </span>
      <button
        type="button"
        className="btn-soft h-tap px-3 text-sm"
        disabled={page >= pages - 1}
        onClick={() => onGo(page + 1)}
      >
        ถัดไป ›
      </button>
    </span>
  )
}

/** แปลงเวลา ISO เป็นค่าที่ช่อง datetime-local รับได้ · ต้องเป็นเวลาท้องถิ่น ไม่ใช่ UTC */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const KIND_TH: { code: 'guard' | 'problem' | 'supervisor' | 'admin'; label: string }[] = [
  { code: 'guard', label: 'รปภ รับกลับตามปกติ' },
  { code: 'problem', label: 'แจ้งปัญหา' },
  { code: 'supervisor', label: 'หัวหน้าปิดเอง · ไม่นับเวลา' },
  { code: 'admin', label: 'หลังบ้านปิดเอง · ไม่นับเวลา' },
]

/**
 * แก้สถานะและเวลาของใบเดียว
 *
 * บังคับใส่เหตุผลเสมอ ทั้งฝั่งหน้าจอและฝั่งฐานข้อมูล
 * เพราะการแก้เวลาย้อนหลังคือการเปลี่ยนหลักฐาน ถ้าไม่มีเหตุผลติดไว้
 * เดือนหน้าจะไม่มีใครตอบได้ว่าทำไมเวลาไม่ตรงกับที่ รปภ จำได้
 * ทุกการแก้ถูกบันทึกลงประวัติการแก้ไขโดยอัตโนมัติจากฝั่งฐานข้อมูล
 */
function EditPassForm({
  r,
  onDone,
  onCancel,
  bare = false,
}: {
  r: BreakRow
  onDone: () => void
  onCancel: () => void
  /** อยู่ในกล่องป็อปอัพอยู่แล้ว ไม่ต้องตีกรอบซ้อนกรอบ */
  bare?: boolean
}) {
  const [kind, setKind] = useState<string>(r.close_kind ?? '')
  const [gate, setGate] = useState(toLocalInput(r.gate_out_at))
  const [back, setBack] = useState(toLocalInput(r.closed_at))
  const [issued, setIssued] = useState(toLocalInput(r.issued_at))
  const [note, setNote] = useState(r.problem_note ?? '')
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const iso = (v: string) => (v ? new Date(v).toISOString() : null)
  const changed =
    kind !== (r.close_kind ?? '') ||
    gate !== toLocalInput(r.gate_out_at) ||
    back !== toLocalInput(r.closed_at) ||
    issued !== toLocalInput(r.issued_at) ||
    note !== (r.problem_note ?? '')

  async function save() {
    setBusy(true)
    setErr(null)
    try {
      const clear: string[] = []
      if (!gate && r.gate_out_at) clear.push('gate_out_at')
      if (!back && r.closed_at) clear.push('closed_at')
      if (!kind && r.close_kind) clear.push('close_kind')
      if (!note && r.problem_note) clear.push('note')
      await breakPassEdit({
        id: r.id,
        reason: why,
        close_kind: (kind || null) as never,
        closed_at: iso(back),
        gate_out_at: iso(gate),
        issued_at: iso(issued),
        note: note || null,
        clear,
      })
      setWhy('')
      onDone()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={bare ? '' : 'mt-3 rounded-card border border-line p-3'}>
      {err && (
        <div className="mb-2">
          <ErrorBox message={err} />
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <label className="block">
          <span className="label">สถานะการปิด</span>
          <select className="input h-tap w-[220px]" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">ยังไม่ปิด</option>
            {KIND_TH.map((k) => (
              <option key={k.code} value={k.code}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">เวลายื่นบัตร</span>
          <input type="datetime-local" className="input h-tap" value={issued} onChange={(e) => setIssued(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">เวลาผ่านประตู</span>
          <input type="datetime-local" className="input h-tap" value={gate} onChange={(e) => setGate(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">เวลากลับ</span>
          <input type="datetime-local" className="input h-tap" value={back} onChange={(e) => setBack(e.target.value)} />
        </label>
      </div>
      <label className="mt-2 block">
        <span className="label">หมายเหตุของใบนี้</span>
        <input className="input h-tap w-full" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ไม่บังคับ" />
      </label>
      <label className="mt-2 block">
        <span className="label">เหตุผลที่แก้ · บังคับ</span>
        <input
          className="input h-tap w-full"
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          placeholder="เช่น รปภ ลืมกดรับกลับ ยืนยันกับหัวหน้าแล้วว่ากลับ 14:35"
        />
      </label>
      <p className="mt-1 text-xs text-ink-400">
        ทุกการแก้จะถูกบันทึกว่าใครแก้ แก้อะไร จากค่าอะไรเป็นอะไร ดูได้ที่เมนูประวัติการแก้ไข
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary h-tap px-4"
          disabled={busy || !why.trim() || !changed}
          onClick={save}
        >
          {busy ? <Spinner /> : null} บันทึกการแก้
        </button>
        <button type="button" className="btn-ghost h-tap px-4" onClick={onCancel}>
          ยกเลิก
        </button>
        {!changed && <span className="self-center text-xs text-ink-400">ยังไม่ได้แก้อะไร</span>}
      </div>
    </div>
  )
}

/** ปุ่มเดิมในแถวที่กางออก · ยังอยู่เหมือนเดิมสำหรับคนที่เปิดดูรูปอยู่แล้ว */
function EditPass({ r, onDone }: { r: BreakRow; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button
        type="button"
        className="btn-soft mt-3 h-tap px-4 text-sm"
        onClick={() => setOpen(true)}
      >
        แก้สถานะ หรือแก้เวลา
      </button>
    )
  }
  return (
    <EditPassForm
      r={r}
      onDone={() => {
        setOpen(false)
        onDone()
      }}
      onCancel={() => setOpen(false)}
    />
  )
}

/**
 * ปุ่มแก้ด่วนท้ายแถว · ฟอร์มตัวเดียวกับในแถวที่กางออก ไม่ได้ลอกมาวาง
 *
 * ถ้าลอกไปอีกชุด วันหนึ่งจะมีคนเพิ่มช่องที่ฝั่งหนึ่งแล้วลืมอีกฝั่ง
 * แล้วจะมีใบที่แก้จากแถวกางได้แต่แก้จากปุ่มด่วนไม่ได้ โดยไม่มีใครรู้ว่าทำไม
 *
 * ฟอร์มเกิดใหม่ทุกครั้งที่เปิด (เรนเดอร์เฉพาะตอน open)
 * ค่าในช่องจึงเป็นค่าล่าสุดของใบนั้นเสมอ ไม่ใช่ค่าค้างจากครั้งก่อน
 */
function QuickEdit({ r, onDone }: { r: BreakRow; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="btn-soft h-tap w-full px-2 text-xs"
        onClick={() => setOpen(true)}
        aria-label={`แก้ใบ ${r.card_code}`}
      >
        แก้
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`แก้ใบ ${r.card_code} · ${r.ref_no}`}
        width="max-w-[720px]"
      >
        <p className="mb-3 text-xs text-ink-500">
          {r.reason_label} · ขอ {r.minutes} นาที · {r.people} คน · ปล่อยโดย {r.issued_by_name}
          {r.closed_by_name ? ` · รับกลับโดย ${r.closed_by_name}` : ''}
        </p>
        {open && (
          <EditPassForm
            r={r}
            bare
            onDone={() => {
              setOpen(false)
              onDone()
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </Modal>
    </>
  )
}
