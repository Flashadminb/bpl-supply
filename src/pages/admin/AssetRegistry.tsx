import { useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import {
  listAssetHoldings,
  listAssetIssues,
  listAssetOpenIssues,
  listAssetTypes,
  listAssets,
  listDepartments,
  resolveAssetIssue,
  resolveAssetIssuesFor,
  setAssetDepts,
  setAssetEnabled,
} from '../../lib/api'
import { EmptyState, ErrorBox, Loading, Sheet, Spinner } from '../../components/ui'
import { fmtDateTime, relativeAge } from '../../lib/format'
import type { Asset, Department } from '../../lib/types'

type Filter = 'all' | 'free' | 'out' | 'issue' | 'off'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'free', label: 'ว่าง' },
  { key: 'out', label: 'ถูกยืมอยู่' },
  { key: 'issue', label: 'มีอาการค้าง' },
  { key: 'off', label: 'ปิดไว้' },
]

export default function AssetRegistry() {
  const { can } = useAuth()
  const types = useAsync(() => listAssetTypes(), [])
  const depts = useAsync(() => listDepartments(), [])
  const assets = useAsync(() => listAssets(), [])
  const held = useAsync(() => listAssetHoldings(false), [])
  const issues = useAsync(() => listAssetOpenIssues(), [])

  const [type, setType] = useState('')
  const [dept, setDept] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Asset | null>(null)

  const holdBy = useMemo(
    () => new Map((held.data ?? []).map((h) => [h.asset_code, h])),
    [held.data],
  )
  const issueBy = useMemo(
    () => new Map((issues.data ?? []).map((i) => [i.asset_code, i])),
    [issues.data],
  )
  const deptName = useMemo(
    () => new Map((depts.data ?? []).map((d) => [d.code, d.name])),
    [depts.data],
  )

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (assets.data ?? []).filter((a) => {
      if (type && a.type_code !== type) return false
      if (dept && (a.dept_code ?? 'ALL') !== dept && !a.share_depts?.includes(dept)) return false
      if (filter === 'free' && (holdBy.has(a.code) || !a.is_enabled)) return false
      if (filter === 'out' && !holdBy.has(a.code)) return false
      if (filter === 'issue' && !issueBy.has(a.code)) return false
      if (filter === 'off' && a.is_enabled) return false
      if (s && !a.code.toLowerCase().includes(s)) return false
      return true
    })
  }, [assets.data, type, dept, filter, search, holdBy, issueBy])

  const all = assets.data ?? []
  const stats = {
    total: all.length,
    out: all.filter((a) => holdBy.has(a.code)).length,
    issue: all.filter((a) => issueBy.has(a.code)).length,
    off: all.filter((a) => !a.is_enabled).length,
  }

  function reloadAll() {
    assets.reload()
    held.reload()
    issues.reload()
  }

  const loading = assets.loading || held.loading || issues.loading
  const error = assets.error ?? held.error ?? issues.error

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg">ทะเบียนเครื่อง</h1>
        <button type="button" className="btn-soft h-tap px-3 text-sm" onClick={reloadAll}>
          รีเฟรช
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-sm text-ink-500">เครื่องทั้งหมด</p>
          <p className="mt-1 font-display text-xl leading-none">{stats.total}</p>
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-sm text-ink-500">ถูกยืมอยู่</p>
          <p className="mt-1 font-display text-xl leading-none">{stats.out}</p>
        </div>
        <div
          className={`rounded-card border p-4 ${
            stats.issue > 0 ? 'border-warn/30 bg-warn-bg' : 'border-line bg-surface'
          }`}
        >
          <p className="text-sm text-ink-500">มีอาการค้าง</p>
          <p className="mt-1 font-display text-xl leading-none">{stats.issue}</p>
          <p className="mt-1 text-xs text-ink-400">ยังเบิกได้ ถ้าไม่ได้ปิดไว้</p>
        </div>
        <div
          className={`rounded-card border p-4 ${
            stats.off > 0 ? 'border-danger/25 bg-danger-bg' : 'border-line bg-surface'
          }`}
        >
          <p className="text-sm text-ink-500">ปิดไม่ให้เบิก</p>
          <p className="mt-1 font-display text-xl leading-none">{stats.off}</p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-[220px]"
          type="search"
          placeholder="ค้นหารหัสเครื่อง"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input h-tap max-w-[170px]"
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="ประเภท"
        >
          <option value="">ทุกประเภท</option>
          {(types.data ?? []).map((t) => (
            <option key={t.code} value={t.code}>
              {t.name}
            </option>
          ))}
        </select>
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
        <span className="mx-1 h-6 w-px bg-line-2" />
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`chip ${filter === f.key ? 'chip-on' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} onRetry={reloadAll} />}

      {!loading && rows.length === 0 && (
        <EmptyState title="ไม่พบเครื่องตามเงื่อนไข" hint="ลองล้างคำค้นหรือตัวกรอง" />
      )}

      {rows.length > 0 && (
        <section className="panel overflow-x-auto p-2">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="text-ink-500">
              <tr className="border-b border-line">
                <th className="p-2 font-medium">รหัสเครื่อง</th>
                <th className="p-2 font-medium">ประเภท</th>
                <th className="p-2 font-medium">แผนก</th>
                <th className="p-2 font-medium">สถานะ</th>
                <th className="p-2 font-medium">อาการค้าง</th>
                <th className="p-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const h = holdBy.get(a.code)
                const iss = issueBy.get(a.code)
                return (
                  <tr key={a.code} className="border-b border-line last:border-0">
                    <td className="p-2 font-display">{a.code}</td>
                    <td className="p-2 text-ink-500">{a.asset_types?.name ?? a.type_code}</td>
                    <td className="p-2 text-ink-500">
                      {deptName.get(a.dept_code ?? 'ALL') ?? a.dept_code ?? 'ส่วนกลาง'}
                      {a.share_depts?.length > 0 && (
                        <p className="text-xs text-ink-400">
                          + {a.share_depts.map((c) => deptName.get(c) ?? c).join(', ')}
                        </p>
                      )}
                    </td>
                    <td className="p-2">
                      {!a.is_enabled ? (
                        <span className="badge-dang">ปิดไม่ให้เบิก</span>
                      ) : h ? (
                        <>
                          <span className="badge-warn">ถูกยืม</span>
                          <span className="ml-2 text-ink-700">{h.holder_name}</span>
                          <span className="ml-1 font-mono text-xs text-ink-400">{h.holder_code}</span>
                          <span className="ml-1 text-xs text-ink-400">
                            · {relativeAge(h.taken_at)}
                          </span>
                        </>
                      ) : (
                        <span className="badge-ok">ว่าง</span>
                      )}
                    </td>
                    <td className="p-2">
                      {iss ? (
                        <span className="text-warn-txt">
                          {iss.symptoms}
                          {iss.issue_count > 1 ? ` (${iss.issue_count})` : ''}
                        </span>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </td>
                    <td className="p-2 text-right">
                      <button
                        type="button"
                        className="btn-soft h-tap px-3 text-sm"
                        onClick={() => setOpen(a)}
                      >
                        จัดการ
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      {rows.length > 0 && (
        <p className="mt-2 text-sm text-ink-500">แสดง {rows.length} เครื่อง จากทั้งหมด {all.length}</p>
      )}

      {open && (
        <AssetSheet
          asset={open}
          departments={depts.data ?? []}
          canMove={can('admin')}
          holder={holdBy.get(open.code) ?? null}
          onClose={() => setOpen(null)}
          onChanged={reloadAll}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ แผงจัดการรายเครื่อง */

function AssetSheet({
  asset,
  departments,
  canMove,
  holder,
  onClose,
  onChanged,
}: {
  asset: Asset
  departments: Department[]
  /** ย้ายแผนกเครื่องได้เฉพาะเจ้าของระบบ แอดมินดูได้อย่างเดียว */
  canMove: boolean
  holder: { holder_name: string; holder_code: string; taken_at: string; ref_no: string } | null
  onClose: () => void
  onChanged: () => void
}) {
  const log = useAsync(() => listAssetIssues(asset.code), [asset.code])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(asset.is_enabled)
  const [home, setHome] = useState(asset.dept_code ?? 'ALL')
  const [shares, setShares] = useState<string[]>(asset.share_depts ?? [])
  const deptsDirty =
    home !== (asset.dept_code ?? 'ALL') ||
    shares.slice().sort().join(',') !== (asset.share_depts ?? []).slice().sort().join(',')

  const rows = log.data ?? []
  const openRows = rows.filter((r) => !r.resolved_at)

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setErr(null)
    try {
      await fn()
      log.reload()
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open title={asset.code} onClose={onClose}>
      <div className="space-y-4">
        {err && <ErrorBox message={err} />}

        <div className="rounded-card border border-line bg-surface-2 p-3 text-sm">
          <p>
            <span className="text-ink-500">ประเภท</span> {asset.asset_types?.name ?? asset.type_code}
          </p>
          {holder && (
            <p className="mt-1 text-warn-txt">
              อยู่กับ <b>{holder.holder_name}</b>{' '}
              <span className="font-mono text-xs">{holder.holder_code}</span> ตั้งแต่{' '}
              {fmtDateTime(holder.taken_at)} ({relativeAge(holder.taken_at)})
            </p>
          )}
        </div>

        <div className="rounded-card border border-line p-3">
          <p className="font-display">แผนกที่มีสิทธิ์ใช้</p>
          <p className="mt-1 text-sm text-ink-500">
            {canMove
              ? 'ย้ายเครื่องได้ทุกเมื่อ · มีผลทันที · ประวัติเดิมไม่กระทบ'
              : 'เปลี่ยนได้เฉพาะเจ้าของระบบ'}
          </p>

          <label className="label mt-3" htmlFor="asset-home">
            แผนกเจ้าของเครื่อง
          </label>
          <select
            id="asset-home"
            className="input"
            value={home}
            disabled={!canMove}
            onChange={(e) => setHome(e.target.value)}
          >
            {departments.map((d) => (
              <option key={d.code} value={d.code}>
                {d.code === 'ALL' ? 'ทุกแผนก — ส่วนกลาง ทุกคนเห็น' : d.name}
              </option>
            ))}
          </select>

          {home !== 'ALL' && (
            <>
              <p className="label mt-3">แผนกอื่นที่ใช้ร่วมได้</p>
              <div className="flex flex-wrap gap-1">
                {departments
                  .filter((d) => d.code !== 'ALL' && d.code !== home)
                  .map((d) => {
                    const on = shares.includes(d.code)
                    return (
                      <button
                        key={d.code}
                        type="button"
                        className={`chip ${on ? 'chip-on' : ''}`}
                        disabled={!canMove}
                        onClick={() =>
                          setShares((v) => (on ? v.filter((c) => c !== d.code) : [...v, d.code]))
                        }
                      >
                        {d.name}
                      </button>
                    )
                  })}
              </div>
              <p className="mt-1 text-xs text-ink-400">ไม่ติ๊กเลยก็ได้ — มีแค่แผนกเจ้าของที่ใช้ได้</p>
            </>
          )}

          {canMove && deptsDirty && (
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost h-tap px-3 text-sm"
                disabled={busy}
                onClick={() => {
                  setHome(asset.dept_code ?? 'ALL')
                  setShares(asset.share_depts ?? [])
                }}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="btn-primary h-tap px-4"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await setAssetDepts(asset.code, home, home === 'ALL' ? [] : shares)
                    if (home === 'ALL') setShares([])
                  })
                }
              >
                {busy ? <Spinner /> : null} บันทึกแผนก
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-card border border-line p-3">
          <div className="min-w-0">
            <p className="font-display">เปิดให้เบิก</p>
            <p className="text-sm text-ink-500">
              {enabled ? 'หน้างานเห็นและเบิกได้ตามปกติ' : 'ซ่อนจากรายการเบิก ประวัติยังอยู่ครบ'}
            </p>
          </div>
          <button
            type="button"
            className={enabled ? 'btn-soft h-tap px-4' : 'btn-primary h-tap px-4'}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await setAssetEnabled(asset.code, !enabled)
                setEnabled(!enabled)
              })
            }
          >
            {busy ? <Spinner /> : null}
            {enabled ? 'ปิดไม่ให้เบิก' : 'เปิดให้เบิก'}
          </button>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="font-display">อาการค้าง {openRows.length > 0 && `(${openRows.length})`}</h3>
            {openRows.length > 1 && (
              <button
                type="button"
                className="btn-soft h-tap px-3 text-sm"
                disabled={busy}
                onClick={() => void run(() => resolveAssetIssuesFor(asset.code))}
              >
                เคลียร์ทั้งหมด
              </button>
            )}
          </div>

          {log.loading && <Loading />}
          {openRows.length === 0 && !log.loading && (
            <p className="rounded-card bg-success-bg px-3 py-2 text-sm text-success-txt">
              ไม่มีอาการค้าง เครื่องนี้สภาพปกติ
            </p>
          )}

          <ul className="space-y-2">
            {openRows.map((r) => (
              <li key={r.id} className="rounded-card border border-warn/30 bg-warn-bg p-3 text-sm">
                <p className="font-display text-warn-txt">{r.symptom}</p>
                <p className="mt-1 text-xs text-ink-500">
                  แจ้ง {fmtDateTime(r.reported_at)}
                  {r.phase ? ` ตอน${r.phase === 'out' ? 'เบิก' : 'คืน'}` : ''}
                  {r.reported_name ? ` โดย ${r.reported_name}` : ''}
                </p>
                <button
                  type="button"
                  className="btn-soft mt-2 h-tap px-3 text-sm"
                  disabled={busy}
                  onClick={() => void run(() => resolveAssetIssue(r.id))}
                >
                  ซ่อมแล้ว เคลียร์อาการนี้
                </button>
              </li>
            ))}
          </ul>
        </div>

        {rows.length > openRows.length && (
          <div>
            <h3 className="mb-2 font-display">ประวัติที่เคลียร์แล้ว</h3>
            <ul className="space-y-1 text-sm text-ink-500">
              {rows
                .filter((r) => r.resolved_at)
                .map((r) => (
                  <li key={r.id} className="flex flex-wrap gap-x-2 border-b border-line py-1 last:border-0">
                    <span className="line-through">{r.symptom}</span>
                    <span className="text-xs text-ink-400">
                      แจ้ง {fmtDateTime(r.reported_at)} · เคลียร์ {fmtDateTime(r.resolved_at as string)}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    </Sheet>
  )
}
