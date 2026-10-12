import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import { useAuth } from '../../lib/auth'
import { MANAGER_ROLES } from '../../lib/roles'
import {
  countAssetExportRows,
  countSheetExportRows,
  listAllItemsForAdmin,
  listAssetHoldings,
  listBadReturns,
  listDepartments,
  listOpenAssetIssues,
  listOpenBorrowings,
  listPendingSlim,
  listRecentRequisitions,
} from '../../lib/api'
import { ErrorBox, Loading } from '../../components/ui'
import { StockLevels } from '../../components/StockLevels'
import { OutstandingNow } from '../../components/OutstandingNow'
import { HomeBoard } from '../../components/HomeBoard'
import { STATUS_TH, fmtDateTime, statusClass } from '../../lib/format'

/**
 * หน้าแรก — ตอบคำถามเดียว: ตอนนี้มีอะไรต้องจัดการบ้าง
 *
 * บนสุดคือเรื่องที่ต้องลงมือ เรียงตามความเร่ง
 * ถัดลงมาคือสองรายการที่ถูกถามบ่อยที่สุด ของเหลือเท่าไหร่ และอะไรยังไม่กลับมา
 * ท้ายสุดคือรายการล่าสุดกับของที่คืนมาไม่ปกติ
 *
 * ตัวเลขสรุปกับกราฟไม่ได้อยู่ที่นี่ตั้งใจ — มันตอบว่า "เดือนที่แล้วเป็นยังไง"
 * ซึ่งเป็นคนละคำถามกับ "ตอนนี้ต้องทำอะไร" ย้ายไปอยู่หน้ารายงานทั้งสองหน้าแล้ว
 */

const RANGES = [
  { days: 7, label: '7 วัน' },
  { days: 30, label: '30 วัน' },
  { days: 90, label: '90 วัน' },
]


const COND_TH: Record<string, string> = { damaged: 'ชำรุด', lost: 'สูญหาย', ok: 'ใช้ได้' }

export default function Dashboard() {
  // ชำรุดค้างเป็นงานของเจ้าของระบบ ไม่ต้องขึ้นกวนแอดมิน
  const { can } = useAuth()
  const isOwner = can(...MANAGER_ROLES)
  const [days, setDays] = useState(30)
  const [dept, setDept] = useState('')

  const fromISO = useMemo(() => new Date(Date.now() - days * 864e5).toISOString(), [days])
  const toISO = useMemo(() => new Date().toISOString(), [days])

  /* ---------------------------------------------------------- ดึงข้อมูล */
  // ไม่ดึงใบเบิกทั้งเดือนมาแล้วค่อยกรองในเครื่อง
  // วัดจากของจริงได้ใบละ ~1.8 KB พอคนเพิ่มเป็นสามเท่าจะกลายเป็นเมกะไบต์ต่อการเปิดหนึ่งครั้ง
  // หน้านี้ใช้แค่ใบล่าสุดสิบกว่าใบ กับใบที่ยังรออนุมัติ ซึ่งมีไม่เยอะโดยธรรมชาติ
  const reqs = useAsync(() => listRecentRequisitions(12), [])
  const pendingReqs = useAsync(() => listPendingSlim(), [])
  const items = useAsync(() => listAllItemsForAdmin(), [])
  const depts = useAsync(() => listDepartments(), [])
  const borrow = useAsync(() => listOpenBorrowings(false), [])
  const badReturns = useAsync(() => listBadReturns(fromISO, toISO), [fromISO])
  const unsent = useAsync(() => countSheetExportRows({ fromISO, toISO }), [fromISO])

  const held = useAsync(() => listAssetHoldings(false), [])
  const assetIssues = useAsync(() => listOpenAssetIssues(50), [])
  const assetUnsent = useAsync(() => countAssetExportRows({ fromISO, toISO }), [fromISO])

  // แผนกอยู่ที่ตัวคน ไม่ได้อยู่ที่ใบเบิก จึงกรองหลังดึงมาแล้ว
  const rows = useMemo(() => {
    const all = reqs.data ?? []
    return dept ? all.filter((r) => r.profiles?.dept_code === dept) : all
  }, [reqs.data, dept])

  /* ------------------------------------------------------ ฝั่งสิ้นเปลือง */
  const pending = useMemo(() => {
    const all = pendingReqs.data ?? []
    return dept ? all.filter((r) => r.profiles?.dept_code === dept) : all
  }, [pendingReqs.data, dept])

  const openBorrow = borrow.data ?? []
  const pendingSheet = unsent.data?.pending ?? 0
  const bad = badReturns.data ?? []

  /* ----------------------------------------------------------- ฝั่ง Asset */
  const holdings = held.data ?? []
  const issues = assetIssues.data ?? []
  const assetPendingSheet = assetUnsent.data?.pending ?? 0

  const issueAssets = new Set(issues.map((i) => i.asset_code))

  /* ------------------------------------------------ เรื่องที่ต้องลงมือ */

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg">หน้าแรก</h1>
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              className={`chip ${days === r.days ? 'chip-on' : ''}`}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </button>
          ))}
          <select
            className="input h-tap max-w-[170px]"
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            aria-label="แผนก"
          >
            <option value="">ทุกแผนก</option>
            {(depts.data ?? []).map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn-soft h-tap px-3 text-sm" onClick={reqs.reload}>
            รีเฟรช
          </button>
        </div>
      </div>

      {/*
        แผงบนสุด · นาฬิกา แถบวิ่ง การ์ดชี้ได้ แผงแจ้งซ่อม และตาราง Asset รายเครื่อง
        แทนการ์ดใหญ่ห้าใบของเดิมที่บอกแค่ตัวเลขรวมแล้วกินไปครึ่งจอ
        ข้อมูลส่งต่อจากที่หน้านี้ขอไว้อยู่แล้ว ไม่ได้ยิงถามซ้ำ ยกเว้นรายการโอน
      */}
      <HomeBoard
        holdings={holdings}
        issues={issues}
        items={items.data ?? []}
        openBorrow={openBorrow}
        pendingApprovals={pending.length}
        sheetRows={[
          { label: 'Asset', n: assetPendingSheet, scope: 'asset' },
          { label: 'สิ้นเปลือง', n: pendingSheet, scope: 'supply' },
        ]}
        fromISO={fromISO}
        toISO={toISO}
        onSent={() => {
          assetUnsent.reload()
          unsent.reload()
        }}
        /* สั่งงานเครื่องจากตารางบนหน้าแรกแล้ว · ตัวเลขทั้งหน้าต้องตามไปด้วย
           ไม่ใช่โอนเสร็จแล้วยังเห็นชื่อคนเดิมค้างอยู่จนกว่าจะกดรีเฟรชเอง */
        onAssetChanged={() => {
          held.reload()
          assetIssues.reload()
        }}
      />

      <section className="mb-5">
        {isOwner && issues.length > 0 && (
          <div className="mt-2 rounded-card border border-warn/30 bg-warn-bg p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="font-display text-warn-txt">
                อาการชำรุดที่ยังค้าง {issueAssets.size} เครื่อง
              </p>
              <Link to="/admin/assets" className="text-sm text-warn-txt underline">
                ไปเคลียร์
              </Link>
            </div>
            <ul className="space-y-[2px] text-sm text-warn-txt">
              {issues.slice(0, 6).map((i) => (
                <li key={i.id} className="flex flex-wrap items-baseline gap-x-2">
                  <b className="font-display">{i.asset_code}</b>
                  <span>{i.symptom}</span>
                  <span className="text-xs opacity-80">
                    แจ้ง {fmtDateTime(i.reported_at)}
                    {i.reported_name ? ` โดย ${i.reported_name}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {issues.length > 6 && (
              <p className="mt-1 text-sm text-warn-txt opacity-80">
                และอีก {issues.length - 6} ใบ
              </p>
            )}
          </div>
        )}
      </section>

      {/* --------------------------- สองรายการที่เปิดมาแล้วต้องเห็นก่อนเพื่อน */}
      <div className="mb-6 grid gap-3 xl:grid-cols-2">
        <StockLevels items={items.data ?? []} />
        <OutstandingNow holdings={holdings} borrowings={openBorrow} />
      </div>

      {reqs.loading && <Loading />}
      {reqs.error && <ErrorBox message={reqs.error} onRetry={reqs.reload} />}

      {/* ------------------------------------------------- ของเสียหาย + ล่าสุด */}
      <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr]">
        <section className="panel p-4">
          <h2 className="mb-3 font-display text-md">รายการเบิกล่าสุด</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="text-ink-500">
                <tr className="border-b border-line">
                  <th className="py-2 font-medium">เลขที่</th>
                  <th className="py-2 font-medium">เวลา</th>
                  <th className="py-2 font-medium">ผู้เบิก</th>
                  <th className="py-2 font-medium">รายการ</th>
                  <th className="py-2 font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 12).map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="py-2 font-mono text-xs">{r.ref_no}</td>
                    <td className="py-2 text-ink-500">{fmtDateTime(r.created_at)}</td>
                    <td className="py-2">{r.profiles?.full_name ?? '—'}</td>
                    <td className="py-2 text-ink-500">{r.requisition_items?.length ?? 0} รายการ</td>
                    <td className="py-2">
                      <span className={statusClass(r.status)}>{STATUS_TH[r.status]}</span>
                    </td>
                  </tr>
                ))}
                {!reqs.loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-ink-400">
                      ยังไม่มีคำขอในช่วงที่เลือก
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel p-4">
          <h2 className="mb-3 font-display text-md">ของที่คืนมาไม่ปกติ</h2>
          {badReturns.loading && <Loading />}
          <ul className="space-y-2 text-sm">
            {bad.slice(0, 10).map((b) => (
              <li key={b.id} className="border-b border-line pb-2 last:border-0">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <b>{b.requisition_items?.items?.name ?? '—'}</b> {b.qty}{' '}
                    {b.requisition_items?.items?.unit ?? ''}
                  </span>
                  <span className={b.condition === 'lost' ? 'badge-dang' : 'badge-warn'}>
                    {COND_TH[b.condition] ?? b.condition}
                  </span>
                </div>
                <p className="text-xs text-ink-400">
                  {b.profiles?.full_name ?? '—'} · {fmtDateTime(b.created_at)}
                </p>
              </li>
            ))}
            {!badReturns.loading && bad.length === 0 && (
              <li className="text-sm text-success-txt">ไม่มีของชำรุดหรือสูญหายในช่วงนี้</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  )
}
