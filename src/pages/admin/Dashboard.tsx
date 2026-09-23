import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import { useAuth } from '../../lib/auth'
import {
  countAssetExportRows,
  countSheetExportRows,
  listAllItemsForAdmin,
  listAssetLinesBetween,
  listAssets,
  listAssetHoldings,
  listAssetTypes,
  listBadReturns,
  listByRows,
  listCategories,
  listDepartments,
  listOpenAssetIssues,
  listOpenBorrowings,
  listRequisitionsBetween,
} from '../../lib/api'
import { ErrorBox, Loading } from '../../components/ui'
import { BarsH, Columns, DataTable, Stat, STATUS, type Datum } from '../../components/charts'
import { StockLevels } from '../../components/StockLevels'
import { OutstandingNow } from '../../components/OutstandingNow'
import { STATUS_TH, fmtDateTime, relativeAge, statusClass } from '../../lib/format'

/**
 * หน้าภาพรวม — ตอบคำถามเดียว: ตอนนี้มีอะไรต้องจัดการบ้าง
 *
 * บนสุดคือเรื่องที่ต้องลงมือ เรียงตามความเร่ง
 * ถัดลงมาแยกสองฝั่งชัดเจน สิ้นเปลืองกับ Asset เป็นคนละงานคนละคนดูแล
 * เอามาปนกันแล้วอ่านไม่ออกว่าตัวเลขไหนของอะไร
 */

const RANGES = [
  { days: 7, label: '7 วัน' },
  { days: 30, label: '30 วัน' },
  { days: 90, label: '90 วัน' },
]

const LATE_HOURS = 18

const dayKey = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(iso))

const dayShort = (key: string) => {
  const [, m, d] = key.split('-')
  return `${d}/${m}`
}

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
  const cats = useAsync(() => listCategories(), [])
  const depts = useAsync(() => listDepartments(), [])
  const borrow = useAsync(() => listOpenBorrowings(false), [])
  const badReturns = useAsync(() => listBadReturns(fromISO, toISO), [fromISO])
  const unsent = useAsync(() => countSheetExportRows({ fromISO, toISO }), [fromISO])

  const assets = useAsync(() => listAssets(), [])
  const assetTypes = useAsync(() => listAssetTypes(), [])
  const held = useAsync(() => listAssetHoldings(false), [])
  const assetLines = useAsync(() => listAssetLinesBetween(fromISO, toISO), [fromISO])
  const assetIssues = useAsync(() => listOpenAssetIssues(50), [])
  const assetUnsent = useAsync(() => countAssetExportRows({ fromISO, toISO }), [fromISO])
  const byPending = useAsync(() => listByRows({ status: 'pending', limit: 200 }), [])

  // แผนกอยู่ที่ตัวคน ไม่ได้อยู่ที่ใบเบิก จึงกรองหลังดึงมาแล้ว
  const rows = useMemo(() => {
    const all = reqs.data ?? []
    return dept ? all.filter((r) => r.profiles?.dept_code === dept) : all
  }, [reqs.data, dept])

  const catName = useMemo(() => new Map((cats.data ?? []).map((c) => [c.id, c.name])), [cats.data])

  /* ------------------------------------------------------ ฝั่งสิ้นเปลือง */
  const stats = useMemo(() => {
    const today = dayKey(new Date().toISOString())
    const todayRows = rows.filter((r) => dayKey(r.created_at) === today)
    const pending = rows.filter((r) => r.status === 'pending')
    const oldest = pending[pending.length - 1]

    const decided = rows.filter(
      (r) => r.decided_at && r.status !== 'pending' && r.decided_by && r.decided_by !== r.requester_id,
    )
    const avgMins =
      decided.length > 0
        ? Math.round(
            decided.reduce(
              (sum, r) => sum + (Date.parse(r.decided_at as string) - Date.parse(r.created_at)) / 60000,
              0,
            ) / decided.length,
          )
        : null

    const unitsToday = todayRows.reduce(
      (n, r) => n + (r.requisition_items ?? []).reduce((m, l) => m + l.qty_requested, 0),
      0,
    )
    const noEvidence = rows.filter((r) => !r.evidence_file_id).length
    return { todayRows, pending, oldest, avgMins, unitsToday, noEvidence }
  }, [rows])

  const low = (items.data ?? []).filter((i) => i.is_active && i.qty_on_hand <= i.min_qty)
  const outOfStock = low.filter((i) => i.qty_on_hand === 0)
  const openBorrow = borrow.data ?? []
  const openUnits = openBorrow.reduce((n, b) => n + b.qty_open, 0)
  const lateBorrow = openBorrow.filter(
    (b) => Date.now() - Date.parse(b.created_at) >= LATE_HOURS * 3600_000,
  )
  const pendingSheet = unsent.data?.pending ?? 0
  const bad = badReturns.data ?? []

  /* ----------------------------------------------------------- ฝั่ง Asset */
  const allAssets = assets.data ?? []
  const holdings = held.data ?? []
  const issues = assetIssues.data ?? []
  const byCount = (byPending.data ?? []).length
  const assetPendingSheet = assetUnsent.data?.pending ?? 0

  const lateAssets = holdings.filter((h) => h.due_at && Date.now() > Date.parse(h.due_at))
  const disabledAssets = allAssets.filter((a) => !a.is_enabled)
  const issueAssets = new Set(issues.map((i) => i.asset_code))

  const assetToday = useMemo(() => {
    const today = dayKey(new Date().toISOString())
    const lines = (assetLines.data ?? []).filter(
      (l) => l.asset_txns && dayKey(l.asset_txns.created_at) === today,
    )
    return {
      out: lines.filter((l) => l.asset_txns?.kind === 'out').length,
      back: lines.filter((l) => l.asset_txns?.kind === 'in').length,
    }
  }, [assetLines.data])

  /** เครื่องที่ถูกหยิบบ่อยที่สุดในช่วงที่เลือก — บอกว่าตัวไหนสึกเร็ว */
  const busiestAssets: Datum[] = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of assetLines.data ?? []) {
      if (l.asset_txns?.kind !== 'out') continue
      m.set(l.asset_code, (m.get(l.asset_code) ?? 0) + 1)
    }
    return [...m.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
  }, [assetLines.data])

  /** เครื่องแยกตามประเภท: ว่าง / ถูกยืม / ปิดซ่อม */
  const byType = useMemo(() => {
    const takenSet = new Set(holdings.map((h) => h.asset_code))
    return (assetTypes.data ?? [])
      .filter((t) => allAssets.some((a) => a.type_code === t.code))
      .map((t) => {
        const pool = allAssets.filter((a) => a.type_code === t.code)
        return {
          code: t.code,
          name: t.name,
          total: pool.length,
          out: pool.filter((a) => takenSet.has(a.code)).length,
          off: pool.filter((a) => !a.is_enabled).length,
        }
      })
  }, [assetTypes.data, allAssets, holdings])

  /* ------------------------------------------------------------- กราฟ */
  const daily: Datum[] = useMemo(() => {
    const map = new Map<string, number>()
    for (let i = days - 1; i >= 0; i--) {
      map.set(dayKey(new Date(Date.now() - i * 864e5).toISOString()), 0)
    }
    for (const r of rows) {
      const k = dayKey(r.created_at)
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + 1)
    }
    return [...map.entries()].map(([k, v]) => ({ label: k, value: v, sub: dayShort(k) }))
  }, [rows, days])

  const topItems: Datum[] = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) {
      for (const l of r.requisition_items ?? []) {
        if (l.status === 'rejected') continue
        const name = l.items?.name ?? `#${l.item_id}`
        map.set(name, (map.get(name) ?? 0) + (l.qty_approved ?? l.qty_requested))
      }
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
  }, [rows])

  const byCategory: Datum[] = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) {
      for (const l of r.requisition_items ?? []) {
        if (l.status === 'rejected') continue
        const cid = (l.items as { category_id?: number | null } | null)?.category_id ?? null
        const name = cid ? (catName.get(cid) ?? 'ไม่ระบุหมวด') : 'ไม่ระบุหมวด'
        map.set(name, (map.get(name) ?? 0) + (l.qty_approved ?? l.qty_requested))
      }
    }
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  }, [rows, catName])

  const byStatus: Datum[] = useMemo(() => {
    const order = ['approved', 'partial', 'pending', 'rejected'] as const
    const color = {
      approved: STATUS.ok,
      partial: STATUS.mute,
      pending: STATUS.warn,
      rejected: STATUS.danger,
    }
    return order
      .map((s) => ({ label: STATUS_TH[s], value: rows.filter((r) => r.status === s).length, color: color[s] }))
      .filter((d) => d.value > 0)
  }, [rows])

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
    stats.pending.length > 0 && {
      key: 'approve',
      tone: 'warn' as const,
      to: '/admin/approvals',
      title: `รออนุมัติ ${stats.pending.length} คำขอ`,
      detail: stats.oldest ? `เก่าสุดรอมาแล้ว ${relativeAge(stats.oldest.created_at)}` : 'กดเพื่ออนุมัติ',
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
        <h1 className="font-display text-lg">ภาพรวม</h1>
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

      {/* ------------------------------------------------------- สิ้นเปลือง */}
      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="font-display text-md">วัสดุสิ้นเปลือง</h2>
          <span className="flex gap-3">
            <Link to="/admin/report/supply" className="text-sm underline">
              รายงานละเอียด
            </Link>
            <Link to="/admin/stock" className="text-sm underline">
              ไปหน้าสต็อก
            </Link>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Stat label="เบิกวันนี้" value={stats.todayRows.length} hint={`${stats.unitsToday} ชิ้น`} />
          <Stat label={`คำขอใน ${days} วัน`} value={rows.length} hint="ทุกสถานะ" />
          <Stat
            label="รออนุมัติ"
            value={stats.pending.length}
            hint={stats.oldest ? `เก่าสุด ${relativeAge(stats.oldest.created_at)}` : 'ไม่มีค้าง'}
            tone={stats.pending.length > 0 ? 'warn' : 'ok'}
          />
          <Stat
            label="ต่ำกว่าขั้นต่ำ"
            value={low.length}
            hint={`หมดแล้ว ${outOfStock.length}`}
            tone={low.length > 0 ? 'danger' : 'ok'}
          />
          <Stat
            label="ยืม-คืนค้าง"
            value={openUnits}
            hint={lateBorrow.length > 0 ? `ค้างนาน ${lateBorrow.length}` : 'ชิ้นที่ยังไม่คืน'}
            tone={lateBorrow.length > 0 ? 'danger' : undefined}
          />
          <Stat
            label="เวลาอนุมัติเฉลี่ย"
            value={
              stats.avgMins === null
                ? '—'
                : stats.avgMins < 60
                  ? `${stats.avgMins} นาที`
                  : `${(stats.avgMins / 60).toFixed(1)} ชม.`
            }
            hint="เฉพาะใบที่กดเอง"
          />
        </div>

        <div className="mt-3 panel p-4">
          <h3 className="mb-1 font-display">จำนวนคำขอต่อวัน</h3>
          <p className="mb-3 text-sm text-ink-400">ชี้ที่แท่งเพื่อดูตัวเลขของวันนั้น</p>
          <Columns data={daily} unit="คำขอ" />
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          <div className="panel p-4">
            <h3 className="mb-1 font-display">วัสดุที่เบิกมากที่สุด</h3>
            <p className="mb-3 text-sm text-ink-400">นับเป็นจำนวนชิ้นใน {days} วัน</p>
            <BarsH data={topItems} unit="ชิ้น" />
            <DataTable rows={topItems} head={['วัสดุ', 'จำนวนชิ้น']} />
          </div>

          <div className="panel p-4">
            <h3 className="mb-1 font-display">แยกตามหมวด</h3>
            <p className="mb-3 text-sm text-ink-400">จำนวนชิ้นรวมในแต่ละหมวด</p>
            <BarsH data={byCategory} unit="ชิ้น" />
            <div className="mt-4">
              <h3 className="mb-1 font-display">สถานะคำขอ</h3>
              <BarsH data={byStatus} unit="ใบ" />
            </div>
            {stats.noEvidence > 0 && (
              <p className="mt-2 rounded-btn bg-warn-bg px-3 py-2 text-sm text-warn-txt">
                มี {stats.noEvidence} คำขอที่ไม่มีรูปหลักฐาน — เกิดตอนอัปรูปไม่สำเร็จแล้วกดบันทึกต่อ
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Asset */}
      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="font-display text-md">อุปกรณ์ Asset</h2>
          <span className="flex gap-3">
            <Link to="/admin/report/asset" className="text-sm underline">
              รายงานละเอียด
            </Link>
            <Link to="/admin/assets" className="text-sm underline">
              ไปทะเบียนเครื่อง
            </Link>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Stat label="เครื่องทั้งหมด" value={allAssets.length} hint={`${byType.length} ประเภท`} />
          <Stat label="ถูกยืมอยู่" value={holdings.length} hint="เครื่อง" />
          <Stat
            label="เลยเวลาคืน"
            value={lateAssets.length}
            hint="วัดจากกะของเจ้าตัว"
            tone={lateAssets.length > 0 ? 'danger' : 'ok'}
          />
          <Stat
            label="ชำรุดยังไม่เคลียร์"
            value={issueAssets.size}
            hint={`${issues.length} ใบแจ้ง`}
            tone={issueAssets.size > 0 ? 'warn' : 'ok'}
          />
          <Stat
            label="ปิดซ่อม"
            value={disabledAssets.length}
            hint="เบิกไม่ได้"
            tone={disabledAssets.length > 0 ? 'warn' : undefined}
          />
          <Stat
            label="วันนี้"
            value={`${assetToday.out} / ${assetToday.back}`}
            hint="เบิก / คืน (เครื่อง)"
          />
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          <div className="panel overflow-x-auto p-4">
            <h3 className="mb-1 font-display">เครื่องแยกตามประเภท</h3>
            <p className="mb-3 text-sm text-ink-400">ว่างเท่าไหร่ ถูกยืมเท่าไหร่ ปิดซ่อมเท่าไหร่</p>
            <table className="w-full text-left text-sm">
              <thead className="text-ink-500">
                <tr className="border-b border-line">
                  <th className="py-2 font-medium">ประเภท</th>
                  <th className="py-2 font-medium">ทั้งหมด</th>
                  <th className="py-2 font-medium">ว่าง</th>
                  <th className="py-2 font-medium">ถูกยืม</th>
                  <th className="py-2 font-medium">ปิดซ่อม</th>
                </tr>
              </thead>
              <tbody>
                {byType.map((t) => (
                  <tr key={t.code} className="border-b border-line last:border-0">
                    <td className="py-2">{t.name}</td>
                    <td className="py-2 font-display">{t.total}</td>
                    <td className="py-2 text-success-txt">{t.total - t.out - t.off}</td>
                    <td className="py-2 text-warn-txt">{t.out}</td>
                    <td className="py-2 text-danger-txt">{t.off}</td>
                  </tr>
                ))}
                {byType.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-ink-400">
                      ยังไม่มีเครื่องในระบบ
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="panel p-4">
            <h3 className="mb-1 font-display">เครื่องที่ถูกหยิบบ่อยที่สุด</h3>
            <p className="mb-3 text-sm text-ink-400">นับจำนวนครั้งที่ถูกเบิกใน {days} วัน</p>
            <BarsH data={busiestAssets} unit="ครั้ง" />
            <DataTable rows={busiestAssets} head={['เครื่อง', 'ครั้งที่เบิก']} />
          </div>
        </div>

      </section>

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
