import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import { useAuth } from '../../lib/auth'
import {
  countAssetExportRows,
  countSheetExportRows,
  listAllItemsForAdmin,
  listAssetHoldings,
  listBadReturns,
  listByRows,
  listDepartments,
  listOpenAssetIssues,
  listOpenBorrowings,
  listRequisitionsBetween,
} from '../../lib/api'
import { ErrorBox, Loading } from '../../components/ui'
import { StockLevels } from '../../components/StockLevels'
import { OutstandingNow } from '../../components/OutstandingNow'
import { STATUS_TH, fmtDateTime, relativeAge, statusClass } from '../../lib/format'

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

const LATE_HOURS = 18

const COND_TH: Record<string, string> = { damaged: 'ชำรุด', lost: 'สูญหาย', ok: 'ใช้ได้' }

export default function Dashboard() {
  // ชำรุดค้างเป็นงานของเจ้าของระบบ ไม่ต้องขึ้นกวนแอดมิน
  const { can } = useAuth()
  const isOwner = can('admin')
  const [days, setDays] = useState(30)
  const [dept, setDept] = useState('')

  const fromISO = useMemo(() => new Date(Date.now() - days * 864e5).toISOString(), [days])
  const toISO = useMemo(() => new Date().toISOString(), [days])

  /* ---------------------------------------------------------- ดึงข้อมูล */
  const reqs = useAsync(() => listRequisitionsBetween(fromISO, toISO), [fromISO])
  const items = useAsync(() => listAllItemsForAdmin(), [])
  const depts = useAsync(() => listDepartments(), [])
  const borrow = useAsync(() => listOpenBorrowings(false), [])
  const badReturns = useAsync(() => listBadReturns(fromISO, toISO), [fromISO])
  const unsent = useAsync(() => countSheetExportRows({ fromISO, toISO }), [fromISO])

  const held = useAsync(() => listAssetHoldings(false), [])
  const assetIssues = useAsync(() => listOpenAssetIssues(50), [])
  const assetUnsent = useAsync(() => countAssetExportRows({ fromISO, toISO }), [fromISO])
  const byPending = useAsync(() => listByRows({ status: 'pending', limit: 200 }), [])

  // แผนกอยู่ที่ตัวคน ไม่ได้อยู่ที่ใบเบิก จึงกรองหลังดึงมาแล้ว
  const rows = useMemo(() => {
    const all = reqs.data ?? []
    return dept ? all.filter((r) => r.profiles?.dept_code === dept) : all
  }, [reqs.data, dept])

  /* ------------------------------------------------------ ฝั่งสิ้นเปลือง */
  const pending = rows.filter((r) => r.status === 'pending')
  const oldestPending = pending[pending.length - 1]

  const low = (items.data ?? []).filter((i) => i.is_active && i.qty_on_hand <= i.min_qty)
  const outOfStock = low.filter((i) => i.qty_on_hand === 0)
  const openBorrow = borrow.data ?? []
  const lateBorrow = openBorrow.filter(
    (b) => Date.now() - Date.parse(b.created_at) >= LATE_HOURS * 3600_000,
  )
  const pendingSheet = unsent.data?.pending ?? 0
  const bad = badReturns.data ?? []

  /* ----------------------------------------------------------- ฝั่ง Asset */
  const holdings = held.data ?? []
  const issues = assetIssues.data ?? []
  const byCount = (byPending.data ?? []).length
  const assetPendingSheet = assetUnsent.data?.pending ?? 0

  const lateAssets = holdings.filter((h) => h.due_at && Date.now() > Date.parse(h.due_at))
  const issueAssets = new Set(issues.map((i) => i.asset_code))

  /* ------------------------------------------------ เรื่องที่ต้องลงมือ */
  /** แจ้งซ่อมที่เพิ่งแจ้งมาใน 24 ชั่วโมง — เร่งกว่ากองที่ค้างมานาน */
  const freshIssues = issues.filter(
    (i) => Date.now() - Date.parse(i.reported_at) < 24 * 3600_000,
  )
  const lost = bad.filter((b) => b.condition === 'lost')

  // เรียงตามความเร่ง ของที่ไม่ได้คืนกับของหายมาก่อนเสมอ
  const todo = [
    lateAssets.length > 0 && {
      key: 'lateasset',
      tone: 'danger' as const,
      to: '/admin/assets-out',
      title: `ไม่ได้คืนเกินเวลา ${lateAssets.length} เครื่อง`,
      detail: `${new Set(lateAssets.map((h) => h.holder_code)).size} คนที่ต้องตาม`,
    },
    lateBorrow.length > 0 && {
      key: 'lateitem',
      tone: 'danger' as const,
      to: '/admin/outstanding',
      title: `วัสดุยืม-คืนค้างเกิน ${LATE_HOURS} ชม. ${lateBorrow.length} รายการ`,
      detail: 'ประมาณ 2 กะแล้ว',
    },
    lost.length > 0 && {
      key: 'lost',
      tone: 'danger' as const,
      to: '/admin/evidence',
      title: `แจ้งของสูญหาย ${lost.length} ครั้ง`,
      detail: lost
        .slice(0, 2)
        .map((b) => b.requisition_items?.items?.name ?? '—')
        .join(', '),
    },
    freshIssues.length > 0 && {
      key: 'freshissue',
      tone: 'danger' as const,
      to: '/admin/assets',
      title: `แจ้งซ่อมใหม่วันนี้ ${freshIssues.length} ใบ`,
      detail: freshIssues[0] ? `${freshIssues[0].asset_code} · ${freshIssues[0].symptom}` : '',
    },
    outOfStock.length > 0 && {
      key: 'out',
      tone: 'danger' as const,
      to: '/admin/stock',
      title: `ของหมดสต็อก ${outOfStock.length} รายการ`,
      detail: outOfStock.slice(0, 3).map((i) => i.name).join(', '),
    },
    pending.length > 0 && {
      key: 'approve',
      tone: 'warn' as const,
      to: '/admin/approvals',
      title: `รออนุมัติ ${pending.length} คำขอ`,
      detail: oldestPending ? `เก่าสุดรอมาแล้ว ${relativeAge(oldestPending.created_at)}` : 'กดเพื่ออนุมัติ',
    },
    byCount > 0 && {
      key: 'by',
      tone: 'warn' as const,
      to: '/admin/by',
      title: `บาร์โค้ด BY รอตัดสต็อก ${byCount} รายการ`,
      detail: 'หน้างานส่งรูปมาแล้ว รอไปตัดในระบบ BY',
    },
    low.length - outOfStock.length > 0 && {
      key: 'low',
      tone: 'warn' as const,
      to: '/admin/stock',
      title: `ของใกล้หมด ${low.length - outOfStock.length} รายการ`,
      detail: 'ต่ำกว่าจุดสั่งซื้อแล้ว',
    },
    bad.length - lost.length > 0 && {
      key: 'bad',
      tone: 'warn' as const,
      to: '/admin/evidence',
      title: `คืนของแบบชำรุด ${bad.length - lost.length} ครั้ง`,
      detail: `ใน ${days} วันที่ผ่านมา`,
    },
    // กองชำรุดที่ค้างสะสม เห็นเฉพาะเจ้าของระบบ
    isOwner &&
      issues.length > 0 && {
        key: 'issue',
        tone: 'mute' as const,
        to: '/admin/assets',
        title: `เครื่องชำรุดยังไม่เคลียร์ ${issueAssets.size} เครื่อง`,
        detail: 'สะสมทั้งหมด — เคลียร์เมื่อซ่อมเสร็จ',
      },
    pendingSheet + assetPendingSheet > 0 && {
      key: 'sheet',
      tone: 'mute' as const,
      to: '/admin/export',
      title: `ค้างส่งเข้า Google Sheet ${pendingSheet + assetPendingSheet} บรรทัด`,
      detail: `สิ้นเปลือง ${pendingSheet} · Asset ${assetPendingSheet}`,
    },
  ].filter(Boolean) as { key: string; tone: 'danger' | 'warn' | 'mute'; to: string; title: string; detail: string }[]

  const toneClass = {
    danger: 'border-danger/25 bg-danger-bg text-danger-txt',
    warn: 'border-warn/30 bg-warn-bg text-warn-txt',
    mute: 'border-line bg-surface text-ink-700',
  }

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

      {/* ---------------------------------------------- ต้องจัดการตอนนี้ */}
      <section className="mb-5">
        <h2 className="mb-2 font-display text-md">ต้องจัดการตอนนี้</h2>
        {todo.length === 0 ? (
          <p className="rounded-card border border-success/25 bg-success-bg px-4 py-3 text-sm text-success-txt">
            ไม่มีอะไรค้าง ทุกอย่างเรียบร้อย
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {todo.map((t) => (
              <Link key={t.key} to={t.to} className={`rounded-card border px-4 py-3 ${toneClass[t.tone]}`}>
                <p className="font-display text-base">{t.title}</p>
                {t.detail && <p className="mt-[2px] truncate text-sm opacity-90">{t.detail}</p>}
              </Link>
            ))}
          </div>
        )}

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
