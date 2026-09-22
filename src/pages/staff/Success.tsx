import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import { listMyRequisitions } from '../../lib/api'
import { StaffPage } from '../../components/Shell'
import { Loading } from '../../components/ui'
import { SyncBar, syncMapFromRows, type SyncMap } from '../../components/SyncBar'
import { STATUS_TH, fmtDateTime, statusClass } from '../../lib/format'
import type { CartLine, CreateReqResult } from '../../lib/types'

interface NavState {
  result?: CreateReqResult
  lines?: CartLine[]
  purpose?: string
  sync?: SyncMap
}

/**
 * หน้าเบิกสำเร็จ — ห้ามมีลิงก์เปิดรูปหลักฐานในหน้านี้
 * พนักงานเห็นได้แค่แถบรหัสสถานะย่อเท่านั้น (CLAUDE.md กติกาข้อ 4)
 */
export default function Success() {
  const { refNo } = useParams()
  const { profile } = useAuth()
  const state = (useLocation().state ?? {}) as NavState

  // ถ้าเข้าหน้านี้ตรง ๆ (รีเฟรช) ให้ดึงคำขอล่าสุดมาเทียบเลขที่
  const fetched = useAsync(async () => {
    if (state.result) return null
    const all = await listMyRequisitions(20)
    return all.find((r) => r.ref_no === refNo) ?? null
  }, [refNo])

  const req = fetched.data
  const status = state.result?.status ?? req?.status ?? 'pending'
  const lines =
    state.lines ??
    (req?.requisition_items ?? []).map((ri) => ({
      item_id: ri.item_id,
      sku: ri.items?.sku ?? '',
      name: ri.items?.name ?? '—',
      unit: ri.items?.unit ?? '',
      shelf_code: ri.items?.shelf_code ?? null,
      qty_on_hand: ri.qty_after ?? ri.items?.qty_on_hand ?? 0,
      is_returnable: false,
      requires_approval: false,
      qty: ri.qty_requested,
    }))
  const syncStates: SyncMap = state.sync ?? syncMapFromRows(req?.sync_log)

  return (
    <StaffPage nav={false}>
      {fetched.loading && <Loading />}

      <div className="mt-4 flex flex-col items-center text-center">
        <div className="flex h-[76px] w-[76px] items-center justify-center rounded-pill bg-success-bg text-[34px] text-success">
          ✓
        </div>
        <h1 className="mt-3 font-display text-xl">
          {status === 'approved' ? 'เบิกสำเร็จ' : status === 'pending' ? 'ส่งคำขอแล้ว' : 'บันทึกแล้ว'}
        </h1>
        <p className="mt-1 font-mono text-md">{refNo}</p>
        <span className={`mt-2 ${statusClass(status)}`}>{STATUS_TH[status]}</span>
        {status === 'pending' && (
          <p className="mt-2 text-sm text-ink-500">รายการนี้รอแอดมินอนุมัติ ยังไม่ตัดสต็อก</p>
        )}
      </div>

      <ul className="mt-4 space-y-2">
        {lines.map((l) => (
          <li key={l.item_id} className="card flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="truncate font-display text-base">{l.name}</p>
              <p className="truncate font-mono text-xs text-ink-400">{l.sku}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-display text-md">
                {l.qty} {l.unit}
              </p>
              {status === 'approved' && (
                <p className="text-xs text-ink-400">คงเหลือ {l.qty_on_hand}</p>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="card mt-3 p-3 text-sm text-ink-500">
        <p>
          ผู้เบิก <b className="text-ink">{profile?.full_name}</b> · {profile?.hub_code}
        </p>
        <p className="mt-1">เวลา {fmtDateTime(req?.created_at ?? new Date().toISOString())}</p>
        <div className="mt-3">
          <SyncBar states={syncStates} refNo={refNo} at={req?.created_at ?? new Date().toISOString()} />
        </div>
        <p className="mt-2 text-xs text-ink-400">
          แคปหน้าจอแถบรหัสนี้ส่งให้แอดมินได้ ถ้ามีขั้นไหนขึ้น <span className="font-mono">!</span>
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link to="/scan" className="btn-ghost">
          เบิกต่อ
        </Link>
        <Link to="/" className="btn-primary">
          กลับหน้าหลัก
        </Link>
      </div>
    </StaffPage>
  )
}
