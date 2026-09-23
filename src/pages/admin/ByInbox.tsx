import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { listAllItemsForAdmin, listByRows, listByStats, setByStatus } from '../../lib/api'
import { readableError } from '../../lib/supabase'
import { EmptyState, ErrorBox, Loading, Modal, Spinner } from '../../components/ui'
import { EvidenceImg, ThumbStrip } from '../../components/EvidenceThumbs'
import { DateRangePicker } from '../../components/DateRangePicker'
import { SearchSelect, type Option } from '../../components/SearchSelect'
import { QtyStepper } from '../../components/ui'
import { fmtDateTime, relativeAge } from '../../lib/format'
import type { ByRow, ByStatus } from '../../lib/types'

/**
 * กล่องรับบาร์โค้ดจาก BY
 *
 * แยกจากหน้าเบิกปกติทั้งหมด — ที่นี่ไม่มีการตัดสต็อกในระบบนี้
 * แอดมินดูรูป แล้วไปตัดในระบบ BY เอง จากนั้นกดปิดรายการ
 * กดปิดแล้วหายจากคิวทันที ประวัติกับรูปยังอยู่ให้ย้อนดูได้
 */

function isoDay(offset: number): string {
  return new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10)
}

type View = 'pending' | 'history'

export default function ByInbox() {
  const [view, setView] = useState<View>('pending')
  const [from, setFrom] = useState(isoDay(-30))
  const [to, setTo] = useState(isoDay(0))
  const [open, setOpen] = useState<ByRow | null>(null)
  const [big, setBig] = useState<{ row: ByRow; index: number } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const range = useMemo(
    () => ({
      fromISO: new Date(`${from}T00:00:00`).toISOString(),
      toISO: new Date(`${to}T23:59:59`).toISOString(),
    }),
    [from, to],
  )

  const pending = useAsync(() => listByRows({ status: 'pending', limit: 200 }), [])
  const history = useAsync(
    () => listByRows({ status: 'all', ...range, limit: 300 }),
    [range],
  )
  const stats = useAsync(() => listByStats(), [])
  const items = useAsync(() => listAllItemsForAdmin(), [])

  // ตอนปิดรายการ ระบุได้ว่าบาร์โค้ดนั้นคือวัสดุตัวไหนกี่ชิ้น
  const [pickItem, setPickItem] = useState('')
  const [pickQty, setPickQty] = useState(1)
  const [cutStock, setCutStock] = useState(false)

  const itemOpts: Option[] = useMemo(
    () =>
      (items.data ?? [])
        .filter((i) => i.is_active)
        .map((i) => ({ value: String(i.id), label: i.name, hint: `${i.sku} · เหลือ ${i.qty_on_hand} ${i.unit}` })),
    [items.data],
  )
  const pickedItem = (items.data ?? []).find((i) => String(i.id) === pickItem)

  const rows = view === 'pending' ? (pending.data ?? []) : (history.data ?? [])
  const loading = view === 'pending' ? pending.loading : history.loading
  const feedError = view === 'pending' ? pending.error : history.error

  const thisMonth = new Date().toISOString().slice(0, 7)
  const monthRows = (stats.data ?? []).filter((s) => s.ym === thisMonth)
  const monthTotal = monthRows.reduce((n, s) => n + s.total, 0)
  const monthDone = monthRows.reduce((n, s) => n + s.done, 0)

  /** เหตุผลที่เจอบ่อยที่สุดเดือนนี้ — บอกได้ว่าของอะไรกำลังขาด */
  const topReasons = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of monthRows) m.set(s.reason, (m.get(s.reason) ?? 0) + s.total)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [monthRows])

  /** วัสดุที่ถูกขอผ่าน BY บ่อยที่สุด — เอาไปใช้ตัดสินใจสั่งของได้ตรงกว่าเหตุผล */
  const topItems = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of monthRows) {
      if (!s.item_name) continue
      m.set(s.item_name, (m.get(s.item_name) ?? 0) + s.qty_done)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [monthRows])

  async function mark(row: ByRow, status: ByStatus, withItem = false) {
    setBusyId(row.id)
    setError(null)
    try {
      await setByStatus(row.id, status, {
        itemId: withItem && pickItem ? Number(pickItem) : null,
        qty: withItem && pickItem ? pickQty : null,
        cutStock: withItem && cutStock,
      })
      setOpen(null)
      setPickItem('')
      setPickQty(1)
      setCutStock(false)
      items.reload()
      pending.reload()
      history.reload()
      stats.reload()
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg">บาร์โค้ดจาก BY</h1>
        <button
          type="button"
          className="btn-soft h-tap px-3 text-sm"
          onClick={() => {
            pending.reload()
            history.reload()
            stats.reload()
          }}
        >
          รีเฟรช
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div
          className={`rounded-card border p-4 ${
            (pending.data ?? []).length > 0 ? 'border-warn/30 bg-warn-bg' : 'border-line bg-surface'
          }`}
        >
          <p className="text-sm text-ink-500">รอตัดสต็อก</p>
          <p className="mt-1 font-display text-xl leading-none">{(pending.data ?? []).length}</p>
          <p className="mt-1 text-xs text-ink-400">รายการ</p>
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-sm text-ink-500">เดือนนี้ทั้งหมด</p>
          <p className="mt-1 font-display text-xl leading-none">{monthTotal}</p>
          <p className="mt-1 text-xs text-ink-400">ตัดแล้ว {monthDone}</p>
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-sm text-ink-500">วัสดุที่ถูกขอมากสุดเดือนนี้</p>
          {topItems.length === 0 ? (
            <p className="mt-1 text-sm text-ink-400">ยังไม่ได้ระบุวัสดุตอนปิดรายการ</p>
          ) : (
            <ul className="mt-1 space-y-[2px] text-sm">
              {topItems.map(([name, n]) => (
                <li key={name} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">{name}</span>
                  <b>{n}</b>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-sm text-ink-500">เหตุผลที่เจอบ่อยเดือนนี้</p>
          {topReasons.length === 0 ? (
            <p className="mt-1 text-sm text-ink-400">ยังไม่มีข้อมูล</p>
          ) : (
            <ul className="mt-1 space-y-[2px] text-sm">
              {topReasons.map(([reason, n]) => (
                <li key={reason} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">{reason}</span>
                  <b>{n}</b>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="flex gap-1">
          <button
            type="button"
            className={`chip ${view === 'pending' ? 'chip-on' : ''}`}
            onClick={() => setView('pending')}
          >
            รอตัดสต็อก
          </button>
          <button
            type="button"
            className={`chip ${view === 'history' ? 'chip-on' : ''}`}
            onClick={() => setView('history')}
          >
            ประวัติทั้งหมด
          </button>
        </div>
        {view === 'history' && (
          <DateRangePicker
            from={from}
            to={to}
            onChange={(a, b) => {
              setFrom(a)
              setTo(b)
            }}
          />
        )}
      </div>

      {error && (
        <div className="mb-3">
          <ErrorBox message={error} />
        </div>
      )}
      {loading && <Loading />}
      {feedError && <ErrorBox message={feedError} />}

      {!loading && rows.length === 0 && (
        <EmptyState
          title={view === 'pending' ? 'ไม่มีรายการรอตัดสต็อก' : 'ไม่มีข้อมูลในช่วงที่เลือก'}
          hint={
            view === 'pending'
              ? 'บาร์โค้ดที่หน้างานส่งมาจะขึ้นที่นี่ทันที'
              : 'ลองขยายช่วงวันที่'
          }
        />
      )}

      {rows.length > 0 && (
        <section className="panel overflow-x-auto p-2">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-ink-500">
              <tr className="border-b border-line">
                <th className="p-2 font-medium">รูปบาร์โค้ด</th>
                <th className="p-2 font-medium">เลขที่ · เวลา</th>
                <th className="p-2 font-medium">ผู้ส่ง</th>
                <th className="p-2 font-medium">เหตุผล</th>
                <th className="p-2 font-medium">สถานะ</th>
                <th className="p-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="p-2">
                    <ThumbStrip
                      fileIds={r.file_ids.filter(Boolean)}
                      onOpen={(index) => setBig({ row: r, index })}
                    />
                  </td>
                  <td className="p-2">
                    <p className="font-mono text-xs">{r.ref_no}</p>
                    <p className="text-ink-500">{fmtDateTime(r.created_at)}</p>
                    {r.status === 'pending' && (
                      <p className="text-xs text-warn-txt">รอมาแล้ว {relativeAge(r.created_at)}</p>
                    )}
                  </td>
                  <td className="p-2">
                    {r.who}
                    <span className="ml-1 font-mono text-xs text-ink-400">{r.employee_code}</span>
                    <p className="text-xs text-ink-400">
                      {r.dept_code}
                      {r.sub_dept ? ` · ${r.sub_dept}` : ''}
                      {r.shift_start && r.shift_end
                        ? ` · กะ ${r.shift_start.slice(0, 5)}–${r.shift_end.slice(0, 5)}`
                        : ''}
                    </p>
                  </td>
                  <td className="max-w-[230px] p-2">
                    <p>{r.reason}</p>
                    {r.item_name && (
                      <p className="text-xs text-ink-700">
                        {r.item_name}
                        {r.qty ? ` ${r.qty} ${r.item_unit ?? ''}` : ''}
                      </p>
                    )}
                    {r.note && <p className="text-xs text-ink-400">{r.note}</p>}
                  </td>
                  <td className="p-2">
                    {r.status === 'done' ? (
                      <>
                        <span className="badge-ok">ตัดสต็อกแล้ว</span>
                        {r.handled_by_name && (
                          <p className="text-xs text-ink-400">
                            {r.handled_by_name}
                            {r.handled_at ? ` · ${fmtDateTime(r.handled_at)}` : ''}
                          </p>
                        )}
                      </>
                    ) : r.status === 'rejected' ? (
                      <span className="badge-dang">ไม่รับ</span>
                    ) : (
                      <span className="badge-warn">รอตัดสต็อก</span>
                    )}
                  </td>
                  <td className="p-2 text-right">
                    {r.status === 'pending' ? (
                      <button
                        type="button"
                        className="btn-primary h-tap px-3 text-sm"
                        disabled={busyId === r.id}
                        onClick={() => setOpen(r)}
                      >
                        {busyId === r.id ? <Spinner /> : 'จัดการ'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-soft h-tap px-3 text-sm"
                        disabled={busyId === r.id}
                        onClick={() => void mark(r, 'pending')}
                      >
                        เอากลับเข้าคิว
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="mt-4 rounded-card bg-brand-50 px-3 py-2 text-sm text-warn-txt">
        ระบบนี้ไม่ได้ตัดสต็อกให้ — ตัดในระบบ BY เองแล้วค่อยกดปิดรายการที่นี่
        <br />
        กดปิดแล้วหายจากคิวทันที แต่รูปกับประวัติยังอยู่ ดูย้อนหลังได้ที่แท็บประวัติ
      </p>

      {/* จัดการรายเรื่อง */}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title="จัดการรายการบาร์โค้ด">
        {open && (
          <>
            <p className="text-ink-700">
              <b>{open.reason}</b>
            </p>
            <p className="mt-1 text-sm text-ink-500">
              {open.who} {open.employee_code} · {fmtDateTime(open.created_at)} · {open.photo_count} รูป
            </p>
            {open.note && <p className="mt-1 text-sm text-ink-500">หมายเหตุ: {open.note}</p>}

            <div className="mt-3">
              <ThumbStrip
                fileIds={open.file_ids.filter(Boolean)}
                onOpen={(index) => setBig({ row: open, index })}
              />
            </div>

            <div className="mt-3 rounded-card border border-line p-3">
              <p className="font-display">บาร์โค้ดนี้คือวัสดุตัวไหน</p>
              <p className="mb-2 text-sm text-ink-400">
                ไม่บังคับ — ใส่ไว้เพื่อให้สถิติบอกได้ว่าของอะไรถูกขอบ่อย
              </p>

              <SearchSelect
                label="วัสดุ"
                value={pickItem}
                options={itemOpts}
                onChange={setPickItem}
                allLabel="ไม่ระบุ"
                placeholder="พิมพ์ชื่อหรือ SKU"
                width="w-full"
              />

              {pickItem && (
                <>
                  <p className="label mt-3">จำนวน {pickedItem?.unit ?? ''}</p>
                  <QtyStepper value={pickQty} max={9999} onChange={setPickQty} />

                  <label className="mt-3 flex items-start gap-2 rounded-card bg-surface-2 p-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5 shrink-0"
                      checked={cutStock}
                      onChange={(e) => setCutStock(e.target.checked)}
                    />
                    <span className="text-sm">
                      <b>ตัดสต็อกในระบบนี้ด้วย</b>
                      <span className="block text-ink-400">
                        ติ๊กเฉพาะตอนของชิ้นนี้นับรวมอยู่ในคลังนี้จริง ๆ
                        {pickedItem
                          ? ` — ตอนนี้เหลือ ${pickedItem.qty_on_hand} ${pickedItem.unit} ตัดแล้วจะเหลือ ${pickedItem.qty_on_hand - pickQty}`
                          : ''}
                        <br />
                        ถ้าตัดในระบบ BY อย่างเดียว อย่าติ๊ก ไม่งั้นยอดจะหายสองเด้ง
                      </span>
                    </span>
                  </label>
                </>
              )}
            </div>

            <p className="mt-3 rounded-card bg-surface-2 px-3 py-2 text-sm text-ink-500">
              ตัดสต็อกในระบบ BY ให้เรียบร้อยก่อน แล้วค่อยกดปุ่มด้านล่าง
            </p>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setOpen(null)}>
                ปิด
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={busyId === open.id}
                onClick={() => void mark(open, 'rejected')}
              >
                ไม่รับรายการนี้
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busyId === open.id}
                onClick={() => void mark(open, 'done', true)}
              >
                {busyId === open.id ? <Spinner /> : null} ตัดสต็อกแล้ว
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ดูรูปเต็ม */}
      <Modal open={Boolean(big)} onClose={() => setBig(null)} title={big?.row.ref_no ?? ''}>
        {big && (
          <>
            <EvidenceImg fileId={big.row.file_ids[big.index]} enabled className="w-full rounded-card" />
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                className="btn-soft"
                disabled={big.index === 0}
                onClick={() => setBig({ ...big, index: big.index - 1 })}
              >
                ‹ ก่อนหน้า
              </button>
              <span className="text-sm text-ink-500">
                {big.index + 1} / {big.row.file_ids.length}
              </span>
              <button
                type="button"
                className="btn-soft"
                disabled={big.index >= big.row.file_ids.length - 1}
                onClick={() => setBig({ ...big, index: big.index + 1 })}
              >
                ถัดไป ›
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
