import { useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import {
  listAssetHoldings,
  listAssetIssues,
  reportAssetIssue,
  listAssetOpenIssues,
  listAssetTypes,
  listAssets,
  listDepartments,
  resolveAssetIssue,
  resolveAssetIssuesFor,
  setAssetDepts,
  setAssetEnabled,
} from '../../lib/api'
import { EmptyState, ErrorBox, Loading, Modal, Sheet, Spinner } from '../../components/ui'
import { fmtDateTime, relativeAge } from '../../lib/format'
import type { Asset, Department } from '../../lib/types'
import { AssetTransfer, type TransferCandidate } from '../../components/AssetTransfer'
import { createAsset, deleteAsset, updateAsset } from '../../lib/api'
import { readableError } from '../../lib/supabase'
import { DepartmentManager } from '../../components/DepartmentManager'
import { MANAGER_ROLES, canProxy } from '../../lib/roles'
import { IssueFixSheet } from '../../components/IssueFixSheet'
import { PhotoSteps, shotsToPhotos, type Shot } from '../../components/PhotoSteps'
import { stampLines } from '../../lib/image'

type Filter = 'all' | 'free' | 'out' | 'issue' | 'off'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'free', label: 'ว่าง' },
  { key: 'out', label: 'ถูกยืมอยู่' },
  { key: 'issue', label: 'มีอาการค้าง' },
  { key: 'off', label: 'ปิดไว้' },
]

export default function AssetRegistry() {
  const { can, profile } = useAuth()
  const mayTransfer = canProxy(profile)
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
  // โอนเครื่องให้แผนกอื่น — แอดมิน เจ้าของระบบ และผู้ตรวจสอบ
  const [moving, setMoving] = useState<Asset | null>(null)

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

  // ชื่อคนที่ถือครองชั่วคราว · อ่านจากรายการค้างคืนที่โหลดมาแล้ว
  // เครื่องที่โอนแล้วยังไม่มีใครกดรับจะไม่มีชื่อ ขึ้นว่า "คนอื่น" แทน
  const loanName = useMemo(
    () => new Map((held.data ?? []).map((h) => [h.user_id, h.holder_name])),
    [held.data],
  )

  // เครื่องอื่นที่เลือกโอนไปพร้อมกันได้ · เอาทั้งทะเบียน ไม่ใช่แค่ที่ตัวกรองโชว์อยู่
  // เพราะคนกรองหาเครื่องหนึ่งอยู่แล้วนึกออกว่าต้องย้ายอีกคันไปด้วย
  const moveCandidates = useMemo<TransferCandidate[]>(
    () =>
      (assets.data ?? [])
        .filter((a) => a.is_enabled)
        .map((a) => ({
          code: a.code,
          type_name: a.asset_types?.name ?? a.type_code,
          dept: a.dept_code,
          holder: holdBy.get(a.code)?.holder_name ?? null,
          holderId: holdBy.get(a.code)?.user_id ?? null,
        })),
    [assets.data, holdBy],
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

  /**
   * เพิ่มเครื่องใหม่ และแก้ของเดิม
   *
   * รหัสเครื่องเป็นกุญแจที่ตารางประวัติชี้มา เดิมจึงแก้ไม่ได้เลย
   * ฐานข้อมูลตั้งให้ประวัติตามรหัสใหม่ไปเองแล้ว (051) จึงเปิดให้แก้ได้
   */
  const [form, setForm] = useState<{
    original?: string
    code: string
    type_code: string
    dept_code: string
    note: string
  } | null>(null)
  const [kill, setKill] = useState<Asset | null>(null)
  const [killStep, setKillStep] = useState(0)
  const [formBusy, setFormBusy] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  async function saveForm() {
    if (!form) return
    if (!form.code.trim()) {
      setFormErr('ต้องใส่รหัสเครื่อง')
      return
    }
    setFormBusy(true)
    setFormErr(null)
    try {
      if (form.original) {
        await updateAsset(form.original, {
          code: form.code,
          type_code: form.type_code,
          dept_code: form.dept_code === 'ALL' ? null : form.dept_code,
          note: form.note,
        })
      } else {
        await createAsset({
          code: form.code,
          type_code: form.type_code,
          dept_code: form.dept_code === 'ALL' ? null : form.dept_code,
          note: form.note,
        })
      }
      setForm(null)
      reloadAll()
    } catch (e) {
      setFormErr(readableError(e))
    } finally {
      setFormBusy(false)
    }
  }

  async function runDelete() {
    if (!kill) return
    setFormBusy(true)
    setFormErr(null)
    try {
      const r = await deleteAsset(kill.code)
      setKill(null)
      setKillStep(0)
      setOpen(null)
      reloadAll()
      setDone(
        `ลบ ${r.code} แล้ว · ประวัติเบิก-คืน ${r.txn_items} รายการ · ใบแจ้งชำรุด ${r.issues} ใบ`,
      )
      setTimeout(() => setDone(null), 6000)
    } catch (e) {
      setFormErr(readableError(e))
    } finally {
      setFormBusy(false)
    }
  }

  const [done, setDone] = useState<string | null>(null)
  // จัดการแผนกอยู่ในหน้าสต็อกอย่างเดียวมาตลอด ซึ่งไม่ใช่ที่ที่คนนึกถึง
  // ตอนเพิ่มเครื่องแล้วไม่มีแผนกที่ต้องการ คนจะมาหาปุ่มตรงนี้
  const [deptsOpen, setDeptsOpen] = useState(false)

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
        {can(...MANAGER_ROLES) && (
          <button
            type="button"
            className="btn-soft h-tap px-3 text-sm"
            onClick={() => setDeptsOpen(true)}
          >
            จัดการแผนก
          </button>
        )}
        {can(...MANAGER_ROLES) && (
          <button
            type="button"
            className="btn-primary h-tap px-3 text-sm"
            onClick={() => {
              setFormErr(null)
              setForm({
                code: '',
                type_code: (types.data ?? [])[0]?.code ?? '',
                dept_code: 'ALL',
                note: '',
              })
            }}
          >
            เพิ่มเครื่อง
          </button>
        )}
        <button type="button" className="btn-soft h-tap px-3 text-sm" onClick={reloadAll}>
          รีเฟรช
        </button>
      </div>

      {done && (
        <p className="mb-3 rounded-card bg-success-bg px-3 py-2 text-sm text-success-txt">
          {done}
          <button type="button" className="ml-2 underline" onClick={() => setDone(null)}>
            ปิด
          </button>
        </p>
      )}

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
                      {a.loan_user && (
                        <p className="text-xs text-warn-txt">
                          โอนให้ {loanName.get(a.loan_user) ?? 'คนอื่น'} ใช้ชั่วคราว
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
                      <div className="flex justify-end gap-1">
                        {mayTransfer && (
                          <button
                            type="button"
                            className="btn-soft h-tap px-3 text-sm"
                            onClick={() => setMoving(a)}
                          >
                            โอน
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-soft h-tap px-3 text-sm"
                          onClick={() => setOpen(a)}
                        >
                          จัดการ
                        </button>
                      </div>
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
          canMove={can(...MANAGER_ROLES)}
          holder={holdBy.get(open.code) ?? null}
          onClose={() => setOpen(null)}
          onChanged={reloadAll}
          onEdit={() => {
            setFormErr(null)
            setForm({
              original: open.code,
              code: open.code,
              type_code: open.type_code,
              dept_code: open.dept_code ?? 'ALL',
              note: open.note ?? '',
            })
          }}
          onDelete={() => {
            setFormErr(null)
            setForm(null)
            setKillStep(0)
            setKill(open)
          }}
        />
      )}

      {/* --------------------------------------------- เพิ่ม / แก้เครื่อง */}
      <Modal
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.original ? `แก้เครื่อง ${form.original}` : 'เพิ่มเครื่องใหม่'}
      >
        {form && (
          <>
            <label className="label" htmlFor="as-code">
              รหัสเครื่อง
            </label>
            <input
              id="as-code"
              className="input font-mono"
              placeholder="เช่น PP-30"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
            {form.original && form.code.trim() !== form.original && (
              <p className="mt-2 rounded-btn bg-warn-bg px-3 py-2 text-sm text-warn-txt">
                เปลี่ยนรหัสจาก <b>{form.original}</b> เป็น <b>{form.code.trim()}</b>
                <br />
                ประวัติเบิก-คืนและรูปทั้งหมดจะตามรหัสใหม่ไปเอง ไม่ขาดหาย
                <br />
                แต่ QR ที่ติดอยู่ที่ตัวเครื่องจะใช้ไม่ได้ ต้องพิมพ์ใหม่
              </p>
            )}

            <label className="label mt-3" htmlFor="as-type">
              ประเภท
            </label>
            <select
              id="as-type"
              className="input"
              value={form.type_code}
              onChange={(e) => setForm({ ...form, type_code: e.target.value })}
            >
              {(types.data ?? []).map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                  {t.parent_code ? ' (ของพ่วง)' : ''}
                </option>
              ))}
            </select>

            <label className="label mt-3" htmlFor="as-dept">
              แผนกเจ้าของ
            </label>
            <select
              id="as-dept"
              className="input"
              value={form.dept_code}
              onChange={(e) => setForm({ ...form, dept_code: e.target.value })}
            >
              <option value="ALL">ส่วนกลาง — ทุกแผนกเบิกได้</option>
              {(depts.data ?? [])
                .filter((d) => d.code !== 'ALL')
                .map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.name}
                  </option>
                ))}
            </select>

            <label className="label mt-3" htmlFor="as-note">
              หมายเหตุ (ไม่บังคับ)
            </label>
            <input
              id="as-note"
              className="input"
              placeholder="เช่น ซื้อเพิ่มรอบเดือนกันยายน"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />

            {!form.original && (
              <p className="mt-2 text-xs text-ink-400">
                เครื่องใหม่จะเปิดให้เบิกทันที · แชร์ให้แผนกอื่นได้ทีหลังในแผงจัดการ
              </p>
            )}

            {formErr && (
              <div className="mt-3">
                <ErrorBox message={formErr} />
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setForm(null)}>
                ยกเลิก
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={formBusy}
                onClick={() => void saveForm()}
              >
                {formBusy ? <Spinner /> : null} บันทึก
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ------------------------------------------------- ลบเครื่อง 2 ชั้น */}
      <Modal
        open={Boolean(kill)}
        onClose={() => {
          setKill(null)
          setKillStep(0)
        }}
        title={kill ? `ลบเครื่อง ${kill.code}` : ''}
      >
        {kill && (
          <>
            {killStep === 0 ? (
              <>
                <p className="text-sm text-ink-500">
                  {kill.asset_types?.name ?? kill.type_code}
                  {kill.dept_code ? ` · แผนก ${kill.dept_code}` : ' · ส่วนกลาง'}
                </p>
                <p className="mt-3 rounded-card bg-danger-bg px-3 py-2 text-sm text-danger-txt">
                  ลบเครื่องนี้จะลบ <b>ประวัติการเบิก-คืนทั้งหมด</b> ของมันไปด้วย
                  <br />
                  รวมถึงใบแจ้งชำรุดและประวัติการโอน · กู้คืนไม่ได้
                </p>
                <p className="mt-2 text-sm text-ink-500">
                  ถ้าแค่ไม่อยากให้เบิกได้แล้ว ให้ใช้ <b>ปิดไม่ให้เบิก</b> ในแผงจัดการแทน
                  <br />
                  เครื่องจะยังอยู่ในทะเบียนและประวัติไม่หาย
                </p>
                {formErr && (
                  <div className="mt-3">
                    <ErrorBox message={formErr} />
                  </div>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" className="btn-ghost" onClick={() => setKill(null)}>
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    className="h-tap rounded-btn bg-danger px-3 text-sm text-white"
                    onClick={() => {
                      setFormErr(null)
                      setKillStep(1)
                    }}
                  >
                    เข้าใจแล้ว ไปต่อ
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-500">
                  ยืนยันอีกครั้ง — พิมพ์รหัสเครื่องให้ตรงเพื่อยืนยันว่าลบถูกตัว
                </p>
                <p className="mt-2 text-center font-mono text-lg">{kill.code}</p>
                <input
                  className="input mt-2 text-center font-mono"
                  placeholder="พิมพ์รหัสเครื่องที่นี่"
                  value={form?.code ?? ''}
                  onChange={(e) =>
                    setForm({ code: e.target.value, type_code: '', dept_code: 'ALL', note: '' })
                  }
                />
                {formErr && (
                  <div className="mt-3">
                    <ErrorBox message={formErr} />
                  </div>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      setKill(null)
                      setKillStep(0)
                      setForm(null)
                    }}
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    className="h-tap rounded-btn bg-danger px-3 text-sm text-white"
                    disabled={formBusy || form?.code.trim() !== kill.code}
                    onClick={() => {
                      setForm(null)
                      void runDelete()
                    }}
                  >
                    {formBusy ? <Spinner /> : null}
                    {form?.code.trim() === kill.code ? 'ลบถาวร' : 'พิมพ์รหัสให้ตรงก่อน'}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </Modal>

      <DepartmentManager
        open={deptsOpen}
        onClose={() => setDeptsOpen(false)}
        departments={depts.data ?? []}
        onChanged={() => {
          depts.reload()
          reloadAll()
        }}
      />

      <AssetTransfer
        asset={moving}
        holding={moving ? holdBy.get(moving.code) : undefined}
        candidates={moveCandidates}
        onClose={() => setMoving(null)}
        onDone={reloadAll}
      />
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
  onEdit,
  onDelete,
}: {
  asset: Asset
  departments: Department[]
  /** จัดการเครื่องได้ — แอดมินและเจ้าของระบบ */
  canMove: boolean
  holder: { holder_name: string; holder_code: string; taken_at: string; ref_no: string } | null
  onClose: () => void
  onChanged: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const log = useAsync(() => listAssetIssues(asset.code), [asset.code])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [symptom, setSymptom] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const { profile } = useAuth()
  // รูปอาการที่เจอ · ฐานข้อมูลบังคับอย่างน้อยหนึ่งใบ ปุ่มจึงต้องรอให้รูปขึ้นเสร็จก่อน
  const [shots, setShots] = useState<Shot[]>([])
  const reportReady =
    shotsToPhotos(shots).length >= 1 &&
    !shots.some((x) => x.state === 'uploading' || x.state === 'ready' || x.state === 'failed')
  const [fixOne, setFixOne] = useState<number | null>(null)
  const [fixAll, setFixAll] = useState(false)
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

  const fixSheets = (
    <>
      <IssueFixSheet
        open={fixOne !== null}
        title="ซ่อมเสร็จแล้ว"
        hint="แนบรูปตอนซ่อมเสร็จไว้เทียบกับรูปตอนแจ้ง ถ้าเครื่องเดิมพังซ้ำจะไล่ได้ว่ารอบที่แล้วแก้อะไรไป"
        onClose={() => setFixOne(null)}
        onSubmit={async (photos, n) => {
          await resolveAssetIssue(fixOne!, photos, n ?? undefined)
          log.reload()
          onChanged()
        }}
      />
      <IssueFixSheet
        open={fixAll}
        title={`เคลียร์ทุกอาการของ ${asset.code}`}
        hint="รูปชุดเดียวจะติดไปกับทุกใบที่ปิดในครั้งนี้"
        onClose={() => setFixAll(false)}
        onSubmit={async (photos, n) => {
          await resolveAssetIssuesFor(asset.code, photos, n ?? undefined)
          log.reload()
          onChanged()
        }}
      />
    </>
  )

  return (
    <Sheet open title={asset.code} onClose={onClose}>
      {fixSheets}
      <div className="space-y-4">
        {err && <ErrorBox message={err} />}

        {canMove && (
          <div className="flex gap-2">
            <button type="button" className="btn-soft h-tap flex-1 text-sm" onClick={onEdit}>
              แก้รหัส / ประเภท / แผนก
            </button>
            <button
              type="button"
              className="btn-ghost h-tap px-3 text-sm text-danger-txt"
              onClick={onDelete}
            >
              ลบเครื่อง
            </button>
          </div>
        )}

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
              : 'เปลี่ยนได้เฉพาะแอดมินและเจ้าของระบบ'}
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

        {/* แจ้งเสียได้จากตรงนี้ เผื่อหน้างานไม่แจ้งแล้วแอดมินเดินไปเจอเอง
            ของเดิมอาการพังบันทึกได้ตอนเบิกหรือตอนคืนเท่านั้น
            เครื่องที่วางอยู่เฉย ๆ จึงต้องรอให้มีคนมาเบิกก่อนถึงจะแจ้งได้
            ซึ่งแปลว่าของพังถูกเบิกออกไปหนึ่งรอบก่อนเสมอ */}
        <div className="rounded-card border border-warn/30 bg-warn-bg p-3">
          <label className="label" htmlFor="asset-report">
            เจอเครื่องเสียเอง แจ้งได้เลย
          </label>
          <textarea
            id="asset-report"
            className="input min-h-[72px] w-full"
            placeholder="อาการที่เจอ เช่น จอแตก ปุ่มสแกนไม่ติด แบตบวม"
            value={symptom}
            onChange={(e) => setSymptom(e.target.value)}
          />
          <p className="label mt-3">รูปอาการที่เจอ (บังคับ)</p>
          <PhotoSteps
            steps={[]}
            maxFree={5}
            minFree={1}
            stamp={stampLines(
              profile?.full_name ?? '',
              profile?.employee_code ?? '',
              profile?.dept_code ?? profile?.hub_code ?? 'BPL',
              'แจ้งเสีย',
            )}
            shots={shots}
            onShots={setShots}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-ink-500">
              ลงชื่อคุณเป็นผู้แจ้ง · ไปโผล่ในอาการค้างข้างล่างทันที
            </p>
            <button
              type="button"
              className="btn-primary h-tap px-4"
              disabled={busy || symptom.trim() === '' || !reportReady}
              onClick={() =>
                void run(async () => {
                  const res = await reportAssetIssue({
                    code: asset.code,
                    symptom,
                    photos: shotsToPhotos(shots).map((p) => ({
                      file_id: p.file_id,
                      web_link: p.web_link,
                      bytes: p.bytes,
                    })),
                  })
                  setSymptom('')
                  setShots([])
                  setNote(res.duplicate ? 'อาการนี้แจ้งไว้อยู่แล้ว ไม่ได้บันทึกซ้ำ' : 'บันทึกอาการแล้ว')
                })
              }
            >
              {busy ? <Spinner /> : null} แจ้งเสีย
            </button>
          </div>
          {note && <p className="mt-2 text-sm text-ink-700">{note}</p>}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="font-display">อาการค้าง {openRows.length > 0 && `(${openRows.length})`}</h3>
            {openRows.length > 1 && (
              <button
                type="button"
                className="btn-soft h-tap px-3 text-sm"
                disabled={busy}
                onClick={() => setFixAll(true)}
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
                  onClick={() => setFixOne(r.id)}
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
