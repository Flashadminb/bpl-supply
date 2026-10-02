import { Fragment, useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { DateRangePicker } from '../../components/DateRangePicker'
import { EvidenceImg } from '../../components/EvidenceThumbs'
import { EmptyState, ErrorBox, Loading, Spinner } from '../../components/ui'
import { fmtDateTime } from '../../lib/format'
import {
  closeBreakPasses,
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

type Tab = 'history' | 'stuck'

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

/** แถวที่กางออก — รูปตอนปล่อยอยู่ซ้าย รูปตอนรับกลับอยู่ขวา */
function Photos({ passId }: { passId: number }) {
  const shots = useAsync(() => listBreakPhotos(passId), [passId])
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
              <a key={s.id} href={s.web_link} target="_blank" rel="noreferrer">
                <EvidenceImg fileId={s.file_id} enabled className="h-28 w-20 rounded-btn" />
              </a>
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
              <a key={s.id} href={s.web_link} target="_blank" rel="noreferrer">
                <EvidenceImg fileId={s.file_id} enabled className="h-28 w-20 rounded-btn" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function BreakHistory() {
  const [tab, setTab] = useState<Tab>('history')
  // ย้อนหลัง 7 วันพอ เบรคเกิดวันละหลายร้อยใบ ตั้ง 30 วันแล้วตารางจะชนเพดาน 1000 แถว
  const [from, setFrom] = useState(dayKey(-7))
  const [to, setTo] = useState(dayKey())
  const [onlyOver, setOnlyOver] = useState(false)
  const [onlyBan, setOnlyBan] = useState(false)
  const [onlyProblem, setOnlyProblem] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
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
    () => listBreakRows({ ...range, onlyOver, onlyBan, onlyProblem }),
    [range, onlyOver, onlyBan, onlyProblem, tick],
  )
  const stuck = useAsync(() => listBreakBoard(), [tick])

  const list = rows.data ?? []
  const stuckList = stuck.data ?? []
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

  async function closeStuck(ids: number[]) {
    setBusy(true)
    setErr(null)
    try {
      await closeBreakPasses(ids, 'ปิดจากหน้าหลังบ้าน')
      setTick((n) => n + 1)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="font-display text-xl">ประวัติเบรค</h1>
        <p className="mt-1 text-sm text-ink-500">
          เทียบเวลาข้ามแผนกให้ดูช่อง &ldquo;ข้างนอก&rdquo; อย่างเดียว
          ช่อง &ldquo;เดิน&rdquo; ต่างกันตามระยะทาง ไม่ใช่ความขยัน
        </p>
      </div>

      <div className="mb-4 flex gap-2">
        {(
          [
            ['history', 'ประวัติ'],
            ['stuck', `ใบที่ค้างอยู่ (${stuckList.length})`],
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

      {tab === 'stuck' ? (
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
                        onClick={() => void closeStuck([r.id])}
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
                onClick={() => void closeStuck(stuckList.map((r) => r.id))}
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

              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink-500">
                      <th className="p-2">บัตร</th>
                      <th className="p-2">เหตุผล · ปล่อยโดย</th>
                      <th className="p-2">ยื่น</th>
                      <th className="p-2">ผ่านประตู</th>
                      <th className="p-2">กลับ</th>
                      <th className="p-2">เดิน</th>
                      <th className="p-2">ข้างนอก</th>
                      <th className="p-2">สถานะ</th>
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
                        </tr>
                        {open === r.id && (
                          <tr className="border-b border-line-2 bg-ink/5">
                            <td colSpan={8} className="p-3">
                              <p className="mb-2 text-xs text-ink-500">
                                {r.ref_no} · ขอ {r.minutes} นาที · {r.people} คน
                                {r.returned_people !== null && ` · กลับ ${r.returned_people} คน`}
                                {r.ban_reason && ` · เหตุผลฉุกเฉิน: ${r.ban_reason}`}
                                {r.problem_code && ` · ${r.problem_code}`}
                                {r.problem_note && ` · ${r.problem_note}`}
                                {r.closed_by_name && ` · รับกลับโดย ${r.closed_by_name}`}
                              </p>
                              <Photos passId={r.id} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-ink-400">กดที่แถวเพื่อดูรูปตอนปล่อยเทียบกับตอนรับกลับ</p>
            </>
          )}
        </>
      )}
    </div>
  )
}
