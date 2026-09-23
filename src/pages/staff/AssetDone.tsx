import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { StaffPage } from '../../components/Shell'
import { fmtDateTime } from '../../lib/format'
import type { AssetIssueInput } from '../../lib/types'

/**
 * ใบสรุปหลังเบิกหรือคืนสำเร็จ
 *
 * ออกแบบให้จบใน 1 หน้าจอแม้เบิก 10 กว่าเครื่อง — รหัสเครื่องเรียงเป็นชิป
 * ไม่ใช่บรรทัดละเครื่อง ส่วนที่ชำรุดดันขึ้นบนสุดเป็นสีแดงเสมอ
 * แคปหน้าจอส่งต่อได้เลย
 */

interface DoneState {
  kind: 'out' | 'in'
  refNo: string
  dueAt?: string | null
  codes: string[]
  typeName: string
  issues?: AssetIssueInput[]
  photoCount: number
}

const timeOnly = (iso: string) =>
  new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

export default function AssetDone() {
  const { refNo = '' } = useParams()
  const { profile } = useAuth()
  const state = (useLocation().state ?? null) as DoneState | null

  const kind = state?.kind ?? 'out'
  const codes = state?.codes ?? []
  const issues = state?.issues ?? []
  const damaged = new Set(issues.map((i) => i.asset_code))
  const clean = codes.filter((c) => !damaged.has(c))

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="safe-t bg-success text-white">
        <div className="mx-auto max-w-phone px-4 pb-5 pt-5">
          <p className="font-display text-xl">
            ✓ {kind === 'out' ? 'เบิกสำเร็จ' : 'คืนสำเร็จ'}
            {codes.length > 0 ? ` · ${codes.length} เครื่อง` : ''}
          </p>
          <p className="mt-1 text-sm">
            {profile?.full_name} · {profile?.employee_code}
            {profile?.dept_code ? ` · ${profile.dept_code}` : ''}
            {profile?.shift_start && profile?.shift_end
              ? ` · กะ ${profile.shift_start.slice(0, 5)}–${profile.shift_end.slice(0, 5)}`
              : ''}
          </p>
          <p className="font-mono text-xs">
            {fmtDateTime(new Date().toISOString())} · {refNo}
          </p>
        </div>
      </header>

      <StaffPage className="-mt-3">
        {state?.dueAt && kind === 'out' && (
          <p className="mb-3 rounded-card border border-brand-300 bg-brand-50 px-3 py-2 text-center font-display text-md">
            คืนภายใน {timeOnly(state.dueAt)} น.
          </p>
        )}

        {issues.length > 0 && (
          <section className="mb-3 rounded-card border border-danger/25 bg-danger-bg p-3">
            <p className="font-display text-danger-txt">
              ⚠ แจ้งชำรุด {issues.length} เครื่อง
            </p>
            <ul className="mt-1 space-y-1 text-sm text-danger-txt">
              {issues.map((i) => (
                <li key={i.asset_code}>
                  <b>{i.asset_code}</b> · {i.symptom}
                </li>
              ))}
            </ul>
            <p className="mt-2 rounded-btn bg-surface px-3 py-2 text-center font-display text-danger-txt">
              กรุณานำเครื่องที่ชำรุดไปวางบนโต๊ะแอดมิน
            </p>
          </section>
        )}

        {clean.length > 0 && (
          <section className="rounded-card border border-line bg-surface p-3">
            <p className="mb-2 text-sm text-ink-500">
              {state?.typeName ?? 'อุปกรณ์'} · {clean.length} เครื่อง
            </p>
            <ul className="flex flex-wrap gap-1">
              {clean.map((c) => (
                <li
                  key={c}
                  className="rounded-pill border border-line-2 bg-surface-2 px-2 py-1 font-mono text-sm"
                >
                  {c}
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-3 text-center text-sm text-ink-500">
          รูปหลักฐาน {state?.photoCount ?? 0} ใบ ✓
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Link to="/" className="btn-soft py-4 text-center">
            กลับหน้าแรก
          </Link>
          <Link to="/returns" className="btn-primary py-4 text-center">
            ดูของที่ถืออยู่
          </Link>
        </div>
      </StaffPage>
    </div>
  )
}
