import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { listRequisitionHistory, supplyPersonHistory } from '../../lib/api'
import { DateRangePicker } from '../../components/DateRangePicker'
import { EmptyState, ErrorBox, Loading } from '../../components/ui'
import { STATUS_TH, fmtDateTime, statusClass } from '../../lib/format'
import { deptSuffix, positionSuffix } from '../../lib/deptNames'
import type { SupplyPersonRow } from '../../lib/types'

/**
 * ประวัติการเบิกสิ้นเปลือง — อ่านอย่างเดียว
 *
 * มีไว้ให้ผู้ตรวจสอบไล่ดูว่าใครเบิกอะไรไปเมื่อไหร่ โดยไม่ต้องมีสิทธิ์แอดมิน
 * ไม่มีปุ่มอนุมัติ ไม่มีปุ่มแก้ และไม่มีลิงก์รูปใน Drive
 * (กติกาข้อ 4 ของโปรเจกต์ — คนที่ไม่ใช่แอดมินเปิดรูปหลักฐานไม่ได้)
 *
 * สองมุมของข้อมูลเดียวกัน แยกแท็บเพราะตอบคนละคำถาม
 *   รายใบ   "ใบนี้ใครเบิก มีอะไร"           — ไล่ตามเวลา
 *   รายคน   "คนนี้เบิกอะไรไปบ้างในช่วงนี้"   — รวมยอดต่อคน แล้วกดเข้าไปดูใบของเขา
 *
 * ยอดรายคนรวมที่ฐานข้อมูล ไม่ใช่ที่หน้าจอ เพราะฝั่งรายใบดึงมาแค่ 400 ใบล่าสุด
 * ถ้าเอาก้อนนั้นมาบวกเอง ช่วงวันยาว ๆ ยอดของแต่ละคนจะขาดโดยไม่มีใครรู้
 */

/** วันนี้ตามเวลาไทย ในรูปแบบ YYYY-MM-DD */
const todayTH = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())

/** ย้อนหลัง n วัน ในรูปแบบ YYYY-MM-DD ตามเวลาไทย */
function daysAgoTH(n: number): string {
  const d = new Date(Date.now() - n * 864e5)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d)
}

const QUICK = [7, 30, 90]

export default function SupplyHistory() {
  const [tab, setTab] = useState<'slips' | 'people'>('slips')
  const [from, setFrom] = useState(() => daysAgoTH(30))
  const [to, setTo] = useState(() => todayTH())
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  /** คนที่กดเปิดดูใบของเขา · null = ยังไม่ได้เลือกใคร */
  const [who, setWho] = useState<SupplyPersonRow | null>(null)

  const range = useMemo(
    () => ({
      fromISO: new Date(`${from}T00:00:00`).toISOString(),
      toISO: new Date(`${to}T23:59:59`).toISOString(),
    }),
    [from, to],
  )

  const reqs = useAsync(
    () => listRequisitionHistory(range.fromISO, range.toISO, 400),
    [range.fromISO, range.toISO],
  )

  const people = useAsync(
    () => supplyPersonHistory(range.fromISO, range.toISO),
    [range.fromISO, range.toISO],
  )

  /** ใบของคนที่เลือก · ดึงแยกเพื่อให้ได้ครบทุกใบ ไม่ติดเพดาน 400 ของฝั่งรายใบ */
  const mine = useAsync(
    () =>
      who
        ? listRequisitionHistory(range.fromISO, range.toISO, 500, who.user_id)
        : Promise.resolve([]),
    [who?.user_id, range.fromISO, range.toISO],
  )

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (reqs.data ?? [])
      .filter((r) => (status ? r.status === status : true))
      .filter((r) => {
        if (!q) return true
        const names = (r.requisition_items ?? []).map((l) => l.items?.name ?? '').join(' ')
        return `${r.ref_no} ${r.profiles?.full_name ?? ''} ${r.profiles?.employee_code ?? ''} ${r.profiles?.dept_code ?? ''} ${names}`
          .toLowerCase()
          .includes(q)
      })
  }, [reqs.data, search, status])

  const peopleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const all = people.data ?? []
    if (!q) return all
    return all.filter((p) =>
      `${p.full_name} ${p.employee_code} ${p.dept_code ?? ''} ${p.sub_dept ?? ''}`
        .toLowerCase()
        .includes(q),
    )
  }, [people.data, search])

  const units = rows.reduce(
    (n, r) =>
      n + (r.requisition_items ?? []).reduce((m, l) => m + (l.qty_approved ?? l.qty_requested), 0),
    0,
  )

  const peopleUnits = peopleRows.reduce((n, p) => n + p.units, 0)
  const peopleSlips = peopleRows.reduce((n, p) => n + p.slips, 0)

  function pick(days: number) {
    setFrom(daysAgoTH(days))
    setTo(todayTH())
  }

  /** ช่วงวันที่เลือกอยู่ตรงกับปุ่มลัดอันไหนไหม — ไว้ไฮไลต์ปุ่ม */
  const activeQuick = QUICK.find((d) => from === daysAgoTH(d) && to === todayTH())

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-lg">ประวัติการเบิกสิ้นเปลือง</h1>
          <p className="text-sm text-ink-500">
            ดูอย่างเดียว · ใครเบิกอะไรไปเมื่อไหร่ จำนวนเท่าไหร่
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`chip ${tab === 'slips' ? 'chip-on' : ''}`}
            onClick={() => {
              setTab('slips')
              setWho(null)
            }}
          >
            รายใบ
          </button>
          <button
            type="button"
            className={`chip ${tab === 'people' ? 'chip-on' : ''}`}
            onClick={() => setTab('people')}
          >
            รายคน
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------------- ตัวกรอง */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <DateRangePicker
          from={from}
          to={to}
          onChange={(f, t) => {
            setFrom(f)
            setTo(t)
          }}
        />

        <div className="flex flex-wrap gap-2 pb-[2px]">
          {QUICK.map((d) => (
            <button
              key={d}
              type="button"
              className={`chip ${activeQuick === d ? 'chip-on' : ''}`}
              onClick={() => pick(d)}
            >
              {d} วัน
            </button>
          ))}
        </div>

        {tab === 'slips' && (
          <select
            className="input h-tap max-w-[160px]"
            value={status}
            aria-label="สถานะ"
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">ทุกสถานะ</option>
            <option value="approved">อนุมัติแล้ว</option>
            <option value="partial">อนุมัติบางส่วน</option>
            <option value="pending">รออนุมัติ</option>
            <option value="rejected">ไม่อนุมัติ</option>
          </select>
        )}

        <input
          className="input h-tap max-w-[280px]"
          type="search"
          placeholder={
            tab === 'people'
              ? 'ค้นหาชื่อคน รหัสพนักงาน หรือแผนก'
              : 'ค้นหาชื่อคน แผนก วัสดุ หรือเลขที่'
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <span className="pb-2 text-sm text-ink-500">
          {tab === 'people'
            ? `${peopleRows.length} คน · ${peopleSlips} ใบ · ${peopleUnits} ชิ้น`
            : `${rows.length} ใบ · ${units} ชิ้น`}
        </span>
        <button
          type="button"
          className="btn-soft h-tap px-3 text-sm"
          onClick={() => (tab === 'people' ? people.reload() : reqs.reload())}
        >
          รีเฟรช
        </button>
      </div>

      {/* ============================================================ รายคน */}
      {tab === 'people' && (
        <>
          {people.loading && <Loading />}
          {people.error && <ErrorBox message={people.error} onRetry={people.reload} />}

          {!people.loading && !people.error && peopleRows.length === 0 && (
            <EmptyState
              title="ไม่มีใครเบิกในช่วงนี้"
              hint="ลองขยายช่วงวันในปฏิทิน หรือล้างคำค้น"
            />
          )}

          {peopleRows.length > 0 && (
            <section className="panel overflow-x-auto p-2">
              <p className="px-3 py-2 text-sm text-ink-500">
                เรียงจากคนที่เบิกมากที่สุด · กดที่แถวเพื่อดูใบของคนนั้น
                <br />
                ช่อง <b>ค้างคืน</b> เป็นยอดที่ค้างอยู่ตอนนี้ ไม่ได้ผูกกับช่วงวันที่เลือก
                เพราะของที่ค้างคือของที่ยังไม่กลับมา ไม่ว่าจะเบิกไปตั้งแต่เมื่อไหร่
              </p>
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="text-ink-500">
                  <tr className="border-b border-line">
                    <th className="px-3 py-2 font-medium">ชื่อ</th>
                    <th className="w-[180px] px-3 py-2 font-medium">แผนก · ตำแหน่ง</th>
                    <th className="w-[70px] px-3 py-2 text-right font-medium">ใบ</th>
                    <th className="w-[80px] px-3 py-2 text-right font-medium">ชิ้น</th>
                    <th className="w-[80px] px-3 py-2 text-right font-medium">ชนิดของ</th>
                    <th className="w-[90px] px-3 py-2 text-right font-medium">รออนุมัติ</th>
                    <th className="w-[90px] px-3 py-2 text-right font-medium">ไม่อนุมัติ</th>
                    <th className="w-[90px] px-3 py-2 text-right font-medium">ค้างคืน</th>
                    <th className="w-[150px] px-3 py-2 font-medium">ล่าสุด</th>
                  </tr>
                </thead>
                <tbody>
                  {peopleRows.map((p) => {
                    const on = who?.user_id === p.user_id
                    return (
                      <tr
                        key={p.user_id}
                        className={`cursor-pointer border-b border-line last:border-0 ${
                          on ? 'bg-surface-2' : ''
                        }`}
                        onClick={() => setWho(on ? null : p)}
                      >
                        <td className="px-3 py-2">
                          <span className="block truncate">{p.full_name}</span>
                          <span className="block font-mono text-xs text-ink-400">
                            {p.employee_code}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-500">
                          {deptSuffix(p.dept_code, '')}
                          {p.sub_dept ? ` · ${p.sub_dept}` : ''}
                          {positionSuffix(p.position_code)}
                        </td>
                        <td className="px-3 py-2 text-right font-display">{p.slips}</td>
                        <td className="px-3 py-2 text-right font-display">{p.units}</td>
                        <td className="px-3 py-2 text-right text-ink-500">{p.kinds}</td>
                        <td className="px-3 py-2 text-right text-warn-txt">
                          {p.pending_slips || ''}
                        </td>
                        <td className="px-3 py-2 text-right text-danger-txt">
                          {p.rejected_slips || ''}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {p.open_units > 0 ? (
                            <span className="font-display text-warn-txt">{p.open_units}</span>
                          ) : (
                            <span className="text-ink-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-500">{fmtDateTime(p.last_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          )}

          {/* ใบของคนที่เลือก */}
          {who && (
            <section className="panel mt-4 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="font-display text-md">
                  ใบของ {who.full_name}
                  <span className="ml-2 font-mono text-xs text-ink-400">{who.employee_code}</span>
                </h2>
                <span className="text-sm text-ink-500">
                  {from} ถึง {to}
                </span>
                <button
                  type="button"
                  className="btn-soft ml-auto h-tap px-3 text-sm"
                  onClick={() => setWho(null)}
                >
                  ปิด
                </button>
              </div>

              {mine.loading && <Loading />}
              {mine.error && <ErrorBox message={mine.error} onRetry={mine.reload} />}
              {!mine.loading && (mine.data ?? []).length === 0 && (
                <p className="rounded-btn bg-surface-2 px-3 py-2 text-sm text-ink-500">
                  ไม่มีใบในช่วงวันที่เลือก
                </p>
              )}

              {(mine.data ?? []).length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="text-ink-500">
                      <tr className="border-b border-line">
                        <th className="w-[130px] px-3 py-2 font-medium">เลขที่</th>
                        <th className="w-[150px] px-3 py-2 font-medium">วันเวลา</th>
                        <th className="px-3 py-2 font-medium">รายการ</th>
                        <th className="w-[130px] px-3 py-2 font-medium">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(mine.data ?? []).map((r) => (
                        <tr key={r.id} className="border-b border-line last:border-0">
                          <td className="px-3 py-2 align-top font-mono text-xs">{r.ref_no}</td>
                          <td className="px-3 py-2 align-top text-ink-500">
                            {fmtDateTime(r.created_at)}
                          </td>
                          <td className="px-3 py-2 align-top text-ink-700">
                            <ul className="space-y-[2px]">
                              {(r.requisition_items ?? []).map((l) => (
                                <li
                                  key={l.id}
                                  className={
                                    l.status === 'rejected' ? 'text-ink-300 line-through' : ''
                                  }
                                >
                                  {l.items?.name ?? `#${l.item_id}`}{' '}
                                  <span className="font-display">
                                    {l.qty_approved ?? l.qty_requested}
                                  </span>{' '}
                                  <span className="text-xs text-ink-400">
                                    {l.items?.unit ?? ''}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <span className={statusClass(r.status)}>{STATUS_TH[r.status]}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* ============================================================ รายใบ */}
      {tab === 'slips' && (
        <>
          {reqs.loading && <Loading />}
          {reqs.error && <ErrorBox message={reqs.error} onRetry={reqs.reload} />}

          {!reqs.loading && rows.length === 0 && (
            <EmptyState title="ไม่มีการเบิกตามตัวกรอง" hint="ลองขยายช่วงวัน หรือล้างคำค้น" />
          )}

          {rows.length > 0 && (
            <section className="panel overflow-x-auto p-2">
              {(reqs.data ?? []).length >= 400 && (
                <p className="px-3 py-2 text-xs text-warn-txt">
                  ช่วงนี้มีใบเกิน 400 ใบ หน้านี้แสดงเฉพาะ 400 ใบล่าสุด ·
                  ถ้าต้องการยอดรวมที่ครบจริง ให้ดูที่แท็บ <b>รายคน</b> ซึ่งรวมที่ฐานข้อมูล
                </p>
              )}
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="text-ink-500">
                  <tr className="border-b border-line">
                    <th className="w-[130px] px-3 py-2 font-medium">เลขที่</th>
                    <th className="w-[150px] px-3 py-2 font-medium">วันเวลา</th>
                    <th className="w-[220px] px-3 py-2 font-medium">ผู้เบิก</th>
                    <th className="px-3 py-2 font-medium">รายการ</th>
                    <th className="w-[130px] px-3 py-2 font-medium">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 align-top font-mono text-xs">{r.ref_no}</td>
                      <td className="px-3 py-2 align-top text-ink-500">
                        {fmtDateTime(r.created_at)}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <p className="truncate">{r.profiles?.full_name ?? '—'}</p>
                        <p className="text-xs text-ink-400">
                          <span className="font-mono">{r.profiles?.employee_code ?? ''}</span>
                          {deptSuffix(r.profiles?.dept_code)}
                        </p>
                      </td>
                      <td className="px-3 py-2 align-top text-ink-700">
                        <ul className="space-y-[2px]">
                          {(r.requisition_items ?? []).map((l) => (
                            <li
                              key={l.id}
                              className={l.status === 'rejected' ? 'text-ink-300 line-through' : ''}
                            >
                              {l.items?.name ?? `#${l.item_id}`}{' '}
                              <span className="font-display">
                                {l.qty_approved ?? l.qty_requested}
                              </span>{' '}
                              <span className="text-xs text-ink-400">{l.items?.unit ?? ''}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className={statusClass(r.status)}>{STATUS_TH[r.status]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  )
}
