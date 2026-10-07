import { useEffect, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import { StaffPage, TopBar } from '../../components/Shell'
import { BreakBanBar } from '../../components/BreakBanBar'
import { EmptyState, ErrorBox, Loading } from '../../components/ui'
import { fmtDateTime } from '../../lib/format'
import {
  breakBanNext,
  breakBanNow,
  countdown,
  listMyBreakRows,
  secToMMSS,
  type BreakRow,
} from '../../lib/breakPass'

/**
 * เบรค OS — หน้าของหัวหน้างาน
 *
 * หัวหน้างานไม่ได้ยืนที่ประตู จึงไม่มีอะไรให้สแกน
 * ของเดิมเขาเห็นหน้าเดียวกับ รปภ ซึ่งมีปุ่มสแกนใหญ่อยู่กลางจอ
 * กดแล้วก็สแกนได้จริงด้วย ทั้งที่การกดรับกลับเป็นหน้าที่ของ รปภ คนเดียว
 * ปุ่มที่กดได้แต่ไม่ควรกดคือปุ่มที่วันหนึ่งจะถูกกด
 *
 * สิ่งที่หัวหน้าต้องรู้จริงมีอย่างเดียว คือบัตรที่ตัวเองปล่อยไปอยู่สถานะไหน
 * ใบที่ยังไม่ปิดจึงอยู่บนสุดพร้อมนาฬิกาเดิน ส่วนที่ปิดแล้วไล่ลงไปเป็นประวัติ
 *
 * กระดานรวมทั้งฮับไม่ได้อยู่หน้านี้ เพราะบัตรของหัวหน้าคนอื่นไม่ใช่งานของเขา
 */

const CLOSE_TH: Record<string, string> = {
  guard: 'รปภ กดรับกลับ',
  problem: 'แจ้งปัญหา',
  supervisor: 'หัวหน้าปิดเอง',
  admin: 'หลังบ้านปิดให้',
}

export default function BreakMine() {
  const { profile } = useAuth()
  const [tick, setTick] = useState(0)

  const mine = useAsync(
    () => (profile ? listMyBreakRows(profile.id) : Promise.resolve([])),
    [profile?.id, tick],
  )
  const ban = useAsync(() => breakBanNow(), [tick])
  const banNext = useAsync(() => breakBanNext(), [tick])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  /**
   * ดึงใหม่นาทีละครั้ง และเฉพาะตอนที่จอเปิดอยู่จริง
   *
   * ของเดิมทุก 15 วินาที และยิงต่อแม้พับแอพไปแล้ว หน้านี้เปิดได้ 32 คน
   * ถ้าเปิดค้างกันทั้งกะคือยิงเปล่า ๆ หลายหมื่นครั้งต่อวัน
   *
   * นาฬิกานับถอยหลังเดินในเครื่องทุกวินาทีอยู่แล้ว ตัวเลขจึงไม่ค้าง
   * สิ่งเดียวที่ช้าลงคือการเห็นว่า รปภ เพิ่งกดรับกลับ ซึ่งรอหนึ่งนาทีได้
   * และกลับมาดูอีกทีก็ดึงให้ทันที
   */
  useEffect(() => {
    const fire = () => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1)
    }
    const t = setInterval(fire, 60_000)
    document.addEventListener('visibilitychange', fire)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', fire)
    }
  }, [])

  const rows = mine.data ?? []
  const open = rows.filter((r) => !r.closed_at)
  const done = rows.filter((r) => r.closed_at)

  return (
    <>
      <TopBar title="บัตรเบรคของฉัน" back />
      <StaffPage>
        <BreakBanBar
          ban={ban.data ?? null}
          next={banNext.data ?? null}
          now={now}
          onChanged={() => setTick((n) => n + 1)}
        />

        {mine.loading && rows.length === 0 && <Loading />}
        {mine.error && <ErrorBox message={mine.error} onRetry={mine.reload} />}

        {!mine.loading && !mine.error && rows.length === 0 && (
          <EmptyState
            title="ยังไม่เคยปล่อยบัตรเบรค"
            hint="ปล่อยบัตรจากหน้าเบรค OS แล้วรายการจะมาขึ้นที่นี่"
          />
        )}

        {open.length > 0 && (
          <>
            <h2 className="mb-2 font-display text-sm text-ink-500">
              ยังไม่กลับ · {open.length} ใบ ·{' '}
              {open.reduce((n, r) => n + (r.gate_out_people ?? r.people), 0)} คน
            </h2>
            <ul className="mb-5 space-y-2">
              {open.map((r) => (
                <OpenLine key={r.id} row={r} now={now} />
              ))}
            </ul>
          </>
        )}

        {done.length > 0 && (
          <>
            <h2 className="mb-2 font-display text-sm text-ink-500">ปิดแล้ว · {done.length} ใบ</h2>
            <ul className="space-y-2">
              {done.map((r) => (
                <DoneLine key={r.id} row={r} />
              ))}
            </ul>
            <p className="mt-3 rounded-btn bg-ink/5 px-3 py-2 text-xs text-ink-500">
              แสดงย้อนหลังล่าสุด {rows.length} ใบ · ประวัติเต็มพร้อมรูปอยู่ในเมนูหลังบ้าน
            </p>
          </>
        )}
      </StaffPage>
    </>
  )
}

/** ใบที่ยังไม่ปิด · นาฬิกาเดินจริง เพราะอันนี้คือของที่ต้องตามต่อ */
function OpenLine({ row, now }: { row: BreakRow; now: number }) {
  const cd = countdown(row.due_at, now)
  const atGate = Boolean(row.gate_out_at)

  return (
    <li
      className={`rounded-card border px-3 py-2.5 ${
        !atGate ? 'border-line bg-ink/5' : cd.over ? 'border-danger/30 bg-danger-bg' : 'border-line bg-surface'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm font-bold">{row.card_code}</span>
        <span className="min-w-0 flex-1 text-xs text-ink-500">
          {row.reason_label} · {row.gate_out_people ?? row.people} คน
          {row.nickname ? ` · ${row.nickname}` : ''}
          <br />
          {atGate
            ? `ผ่านประตู ${fmtDateTime(row.gate_out_at as string).slice(-5)}`
            : `ยื่น ${fmtDateTime(row.issued_at).slice(-5)} · ยังไม่ถึงประตู`}
        </span>
        {atGate ? (
          <span className={`font-mono text-md font-bold ${cd.over ? 'text-danger-txt' : 'text-ink-700'}`}>
            {cd.text}
          </span>
        ) : (
          <span className="text-xs font-semibold text-ink-400">รอมาถึง</span>
        )}
      </div>

      {row.in_ban && (
        <p className="mt-1 rounded-btn bg-warn-bg px-2 py-1 text-xs text-warn-txt">
          ปล่อยในช่วงห้าม{row.ban_reason ? ` · ${row.ban_reason}` : ''}
        </p>
      )}
    </li>
  )
}

/** ใบที่ปิดแล้ว · สรุปผลสั้น ๆ พอให้รู้ว่าจบยังไง ไม่ต้องกดเข้าไปอ่าน */
function DoneLine({ row }: { row: BreakRow }) {
  const over = row.over_sec ?? 0
  const missing = row.missing_people

  return (
    <li className="rounded-card border border-line-2 bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-bold">{row.card_code}</span>
        <span className="min-w-0 flex-1 text-xs text-ink-500">
          {row.reason_label} · {row.people} คน
          {row.nickname ? ` · ${row.nickname}` : ''}
          <br />
          {fmtDateTime(row.issued_at)} · ขอไว้ {row.minutes} นาที
        </span>
        {over > 0 ? (
          <span className="badge-dang">เกิน {secToMMSS(over)}</span>
        ) : (
          <span className="badge-ok">ตรงเวลา</span>
        )}
      </div>

      <p className="mt-1 text-xs text-ink-400">
        {row.close_kind ? (CLOSE_TH[row.close_kind] ?? row.close_kind) : 'ปิดแล้ว'}
        {row.closed_by_name ? ` · ${row.closed_by_name}` : ''}
        {row.closed_at ? ` · ${fmtDateTime(row.closed_at).slice(-5)}` : ''}
      </p>

      {missing > 0 && (
        <p className="mt-1 rounded-btn bg-danger-bg px-2 py-1 text-xs text-danger-txt">
          เข้าไม่ครบ ขาด {missing} คน
          {row.problem_note ? ` · ${row.problem_note}` : ''}
        </p>
      )}
      {row.in_ban && (
        <p className="mt-1 rounded-btn bg-warn-bg px-2 py-1 text-xs text-warn-txt">
          ปล่อยในช่วงห้าม{row.ban_reason ? ` · ${row.ban_reason}` : ''}
        </p>
      )}
    </li>
  )
}
