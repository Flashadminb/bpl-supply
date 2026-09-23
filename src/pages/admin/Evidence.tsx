import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import {
  listEvidence,
  listEvidenceItems,
  listShiftsInUse,
  setEvidenceArchived,
  type EvidenceRow,
} from '../../lib/api'
import { readableError } from '../../lib/supabase'
import { EmptyState, ErrorBox, Loading, Modal, Spinner } from '../../components/ui'
import { EvidenceImg, ThumbStrip } from '../../components/EvidenceThumbs'
import { DateRangePicker } from '../../components/DateRangePicker'
import { fmtDateTime } from '../../lib/format'

/**
 * 2 แท็บแยกกันชัดเจน
 *   borrow = เฉพาะของยืม-คืน และโหลดรูปมาให้ดู
 *   all    = ทุกคำขอ แต่ไม่โหลดรูปเลย เพราะรายการเยอะและไม่ได้ต้องใช้รูป
 * แท็บ all จึงเปิดเร็วเสมอ ไม่ยิงดึงรูปสักใบ
 */
type Scope = 'borrow' | 'all'
const PAGE = 25


const isoDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d)

export default function Evidence() {
  const [scope, setScope] = useState<Scope>('borrow')
  const [showArchived, setShowArchived] = useState(false)
  const [kind, setKind] = useState('all')
  // เก็บเป็น "HH:MM|HH:MM" เพื่อให้ค่าใน <select> เป็นข้อความเดียว
  const [shiftKey, setShiftKey] = useState('')
  const [pick, setPick] = useState('')
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 30 * 864e5)))
  const [to, setTo] = useState(isoDay(new Date()))
  const [page, setPage] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [big, setBig] = useState<{ row: EvidenceRow; index: number } | null>(null)
  /** แถวที่เพิ่งกด "ใช้แล้ว" — ซ่อนทันทีโดยไม่รอเซิร์ฟเวอร์ตอบ */
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const withPhotos = scope === 'borrow'
  /**
   * แปลงวันที่เป็นช่วงเวลาเต็มวัน และ memo ไว้
   * ถ้าไม่ memo ค่าจะเป็นอ็อบเจกต์ใหม่ทุกครั้งที่วาดจอ deps ของ useAsync เปลี่ยนตลอด แล้ววนโหลดไม่หยุด
   */
  const range = useMemo(
    () => ({
      fromISO: new Date(`${from}T00:00:00`).toISOString(),
      toISO: new Date(`${to}T23:59:59`).toISOString(),
    }),
    [from, to],
  )

  const shifts = useAsync(() => listShiftsInUse(), [])
  const evItems = useAsync(() => listEvidenceItems(), [])

  const feed = useAsync(
    () =>
      listEvidence({
        returnableOnly: scope === 'borrow',
        includeArchived: showArchived,
        kind,
        pick: pick || null,
        shift: shiftKey
          ? { start: shiftKey.split('|')[0], end: shiftKey.split('|')[1] }
          : null,
        fromISO: range.fromISO,
        toISO: range.toISO,
      }),
    [scope, showArchived, kind, shiftKey, pick, range.fromISO, range.toISO],
  )

  const all = useMemo(
    () => (feed.data ?? []).filter((r) => !hidden.has(`${r.kind}-${r.source_id}`)),
    [feed.data, hidden],
  )
  const pages = Math.max(1, Math.ceil(all.length / PAGE))
  const rows = useMemo(() => all.slice(page * PAGE, page * PAGE + PAGE), [all, page])

  /**
   * ซ่อนทันทีที่กด แล้วค่อยบอกเซิร์ฟเวอร์เบื้องหลัง
   * ถ้าเซิร์ฟเวอร์ปฏิเสธค่อยเอากลับมาแสดงพร้อมข้อความ — จะได้ไม่ต้องรอ 1-2 วินาทีต่อแถว
   */
  async function toggle(row: EvidenceRow) {
    const key = `${row.kind}-${row.source_id}`
    if (!row.archived && !showArchived) {
      setHidden((s) => new Set(s).add(key))
    } else {
      setBusyId(row.source_id)
    }
    setError(null)
    try {
      await setEvidenceArchived(row, !row.archived)
      if (row.archived || showArchived) feed.reload()
    } catch (e) {
      setHidden((s) => {
        const next = new Set(s)
        next.delete(key)
        return next
      })
      setError(readableError(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg">หลักฐานการเบิก-คืน</h1>
        <span className="badge-mute">{all.length} รายการ</span>
      </div>

      {/* แท็บหลัก — คนละงานกัน จึงแยกให้ชัด ไม่ใช่แค่ตัวกรอง */}
      <div className="mb-3 flex border-b border-line">
        <button
          type="button"
          className={`min-h-tap px-4 font-display text-md ${
            withPhotos ? 'border-b-2 border-ink text-ink' : 'text-ink-400'
          }`}
          onClick={() => {
            setScope('borrow')
            setPage(0)
          }}
        >
          ยืม-คืน · มีรูป
        </button>
        <button
          type="button"
          className={`min-h-tap px-4 font-display text-md ${
            !withPhotos ? 'border-b-2 border-ink text-ink' : 'text-ink-400'
          }`}
          onClick={() => {
            setScope('all')
            setPage(0)
          }}
        >
          ทั้งหมด · ไม่โหลดรูป
        </button>
      </div>

      <p className="mb-4 rounded-card bg-brand-50 px-3 py-2 text-sm text-warn-txt">
        {withPhotos ? (
          <>
            เฉพาะการเบิกและคืน<b>ของประเภทยืม-คืน</b> · กดที่รูปย่อเพื่อเปิดรูปใหญ่ แล้วคลิกขวา →{' '}
            <b>คัดลอกรูปภาพ</b> ไปวางในไฟล์ส่วนกลาง
            <br />
            จัดการเสร็จกด <b>ใช้แล้ว</b> แถวจะหายไป เหลือข้อมูลกับลิงก์ Drive ในระบบ
          </>
        ) : (
          <>
            คำขอ<b>ทุกประเภท</b> · แท็บนี้<b>ไม่โหลดรูป</b> จึงเปิดเร็วแม้มีเป็นพันรายการ
            <br />
            อยากดูรูปของรายการไหน กดปุ่ม <b>Drive</b> ท้ายแถว
          </>
        )}
      </p>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="label mb-1" htmlFor="ev-kind">
            ประเภท
          </label>
          <select
            id="ev-kind"
            className="input h-tap w-[150px]"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value)
              setPage(0)
            }}
          >
            <option value="all">ทั้งหมด</option>
            <option value="supply">สิ้นเปลืองทั้งหมด</option>
            <option value="requisition">สิ้นเปลือง · เบิก</option>
            <option value="return">สิ้นเปลือง · คืน</option>
            <option value="asset">Asset ทั้งหมด</option>
            <option value="asset_out">Asset · เบิก</option>
            <option value="asset_in">Asset · คืน</option>
          </select>
        </div>

        <div>
          <label className="label mb-1" htmlFor="ev-item">
            อุปกรณ์ / วัสดุ
          </label>
          <select
            id="ev-item"
            className="input h-tap w-[210px]"
            value={pick}
            onChange={(e) => {
              setPick(e.target.value)
              setPage(0)
            }}
          >
            <option value="">ทุกรายการ</option>
            <optgroup label="อุปกรณ์ Asset">
              {(evItems.data ?? [])
                .filter((it) => it.kind === 'asset')
                .map((it) => (
                  <option key={it.key} value={it.key}>
                    {it.name} ({it.photo_rows})
                  </option>
                ))}
            </optgroup>
            <optgroup label="วัสดุสิ้นเปลือง">
              {(evItems.data ?? [])
                .filter((it) => it.kind === 'supply')
                .map((it) => (
                  <option key={it.key} value={it.key}>
                    {it.name} ({it.photo_rows})
                  </option>
                ))}
            </optgroup>
          </select>
        </div>

        <div>
          <label className="label mb-1" htmlFor="ev-shift">
            กะ
          </label>
          <select
            id="ev-shift"
            className="input h-tap w-[170px]"
            value={shiftKey}
            onChange={(e) => {
              setShiftKey(e.target.value)
              setPage(0)
            }}
          >
            <option value="">ทุกกะ</option>
            {(shifts.data ?? []).map((sh) => (
              <option key={sh.label} value={`${sh.shift_start}|${sh.shift_end}`}>
                {sh.label} ({sh.staff_count} คน)
              </option>
            ))}
          </select>
        </div>

        {/* ปฏิทินอันเดียว กดวันเริ่มแล้วกดวันจบ พร้อมปุ่มช่วงสำเร็จรูปอยู่ในนั้น */}
        <DateRangePicker
          from={from}
          to={to}
          onChange={(f, t) => {
            setFrom(f)
            setTo(t)
            setPage(0)
          }}
        />

        <button
          type="button"
          className={`chip ${showArchived ? 'chip-on' : ''}`}
          onClick={() => {
            setShowArchived((v) => !v)
            setHidden(new Set())
            setPage(0)
          }}
        >
          {showArchived ? 'แสดงที่ใช้แล้วด้วย' : 'ซ่อนที่ใช้แล้ว'}
        </button>
        <button
          type="button"
          className="btn-soft h-tap px-3 text-sm"
          onClick={() => {
            setHidden(new Set())
            feed.reload()
          }}
        >
          รีเฟรช
        </button>
      </div>

      {feed.loading && <Loading />}
      {feed.error && <ErrorBox message={feed.error} onRetry={feed.reload} />}
      {error && <div className="mb-3"><ErrorBox message={error} /></div>}

      {!feed.loading && all.length === 0 && (
        <EmptyState
          title="ไม่มีหลักฐานในหมวดนี้"
          hint={
            withPhotos
              ? 'ยังไม่มีการเบิกหรือคืนของประเภทยืม-คืนที่แนบรูปไว้'
              : 'ยังไม่มีคำขอที่แนบรูปหลักฐาน'
          }
        />
      )}

      {all.length > 0 && (
        <section className="panel overflow-x-auto p-2">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="text-ink-500">
              <tr className="border-b border-line">
                {withPhotos && <th className="w-[64px] p-2 font-medium">รูป</th>}
                <th className="p-2 font-medium">เลขที่</th>
                <th className="p-2 font-medium">วันเวลา</th>
                <th className="p-2 font-medium">ประเภท</th>
                <th className="p-2 font-medium">ผู้เบิก/ผู้คืน</th>
                <th className="p-2 font-medium">รายการ</th>
                <th className="p-2 font-medium">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.kind}-${r.source_id}`}
                  className={`border-b border-line last:border-0 ${r.archived ? 'opacity-55' : ''}`}
                >
                  {withPhotos && (
                    <td className="p-2">
                      <ThumbStrip
                        fileIds={r.file_ids.filter(Boolean)}
                        onOpen={(index) => setBig({ row: r, index })}
                      />
                    </td>
                  )}
                  <td className="p-2 font-mono text-xs">{r.ref_no}</td>
                  <td className="p-2 text-ink-500">{fmtDateTime(r.created_at)}</td>
                  <td className="p-2">
                    <span
                      className={
                        r.kind === 'return' || r.kind === 'asset_in' ? 'badge-ok' : 'badge-mute'
                      }
                    >
                      {r.kind === 'return'
                        ? 'คืนของ'
                        : r.kind === 'asset_in'
                          ? 'คืนเครื่อง'
                          : r.kind === 'asset_out'
                            ? 'เบิกเครื่อง'
                            : 'เบิกของ'}
                    </span>
                  </td>
                  <td className="p-2">
                    {r.who}
                    <span className="ml-1 font-mono text-xs text-ink-400">{r.employee_code}</span>
                    {(r.dept_code || r.sub_dept) && (
                      <p className="text-xs text-ink-400">
                        {r.dept_code}
                        {r.sub_dept ? ` · ${r.sub_dept}` : ''}
                      </p>
                    )}
                  </td>
                  <td className="max-w-[260px] p-2 text-ink-500">
                    <span className="line-clamp-2">{r.summary}</span>
                  </td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className={r.archived ? 'btn-soft h-tap px-3 text-sm' : 'btn-primary h-tap px-3 text-sm'}
                        disabled={busyId === r.source_id}
                        onClick={() => void toggle(r)}
                      >
                        {busyId === r.source_id ? <Spinner /> : r.archived ? 'เอากลับ' : 'ใช้แล้ว'}
                      </button>
                      {r.web_link && (
                        <a
                          href={r.web_link}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-soft h-tap px-3 text-sm"
                        >
                          Drive
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            type="button"
            className="btn-ghost h-tap px-3 text-sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            ก่อนหน้า
          </button>
          <span className="text-sm text-ink-500">
            หน้า {page + 1} / {pages}
          </span>
          <button
            type="button"
            className="btn-ghost h-tap px-3 text-sm"
            disabled={page >= pages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            ถัดไป
          </button>
        </div>
      )}

      <Modal
        open={Boolean(big)}
        onClose={() => setBig(null)}
        title={big ? `${big.row.ref_no} · ${fmtDateTime(big.row.created_at)}` : ''}
        width="max-w-[820px]"
      >
        {big && (
          <>
            <EvidenceImg
              key={big.row.file_ids[big.index] ?? big.row.file_id}
              fileId={big.row.file_ids[big.index] ?? big.row.file_id}
              enabled
              alt={`หลักฐาน ${big.row.ref_no}`}
              className="flex max-h-[62dvh] min-h-[280px] w-full items-center justify-center overflow-hidden rounded-card border border-line bg-surface-2 [&>img]:object-contain"
            />

            {big.row.file_ids.length > 1 && (
              <>
                {/* แถบรูปย่อ กดกระโดดไปใบไหนก็ได้ทันที */}
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  {big.row.file_ids.map((id, i) => (
                    <EvidenceImg
                      key={id}
                      fileId={id}
                      enabled
                      alt={`ใบที่ ${i + 1}`}
                      className={`h-[64px] w-[64px] overflow-hidden rounded-btn border-2 bg-surface-2 ${
                        i === big.index ? 'border-ink' : 'border-line'
                      }`}
                      onClick={() => setBig({ ...big, index: i })}
                    />
                  ))}
                </div>
                <p className="mt-2 text-center text-sm text-ink-500">
                  ใบที่ {big.index + 1} / {big.row.file_ids.length}
                </p>
              </>
            )}

            <p className="mt-2 text-sm">
              <b>{big.row.who}</b>{' '}
              <span className="font-mono text-xs text-ink-400">{big.row.employee_code}</span> ·{' '}
              {big.row.hub_code}
            </p>
            <p className="text-sm text-ink-500">{big.row.summary}</p>
            <p className="mt-2 text-xs text-ink-400">คลิกขวาที่รูป → คัดลอกรูปภาพ เพื่อนำไปวางในไฟล์ส่วนกลาง</p>
          </>
        )}
      </Modal>
    </div>
  )
}
