import { useMemo, useState } from 'react'
import { StaffImport } from '../../components/StaffImport'
import { LoginQr } from '../../components/LoginQr'
import { useAsync } from '../../lib/useAsync'
import {
  createEmployee,
  listDepartments,
  listProfiles,
  resetEmployeePassword,
  updateProfile,
} from '../../lib/api'
import { emailFromEmployeeCode, readableError } from '../../lib/supabase'
import { ErrorBox, Loading, Modal, Spinner } from '../../components/ui'
import type { Profile } from '../../lib/types'
import { POSTS, ROLE_TH, postOf, postPatch, type PostKey } from '../../lib/roles'

const MIN_PASSWORD = 8

const RBAC: { action: string; staff: boolean; dispatcher: boolean; supervisor: boolean; admin: boolean }[] = [
  { action: 'เบิก / คืนวัสดุ', staff: true, dispatcher: true, supervisor: true, admin: true },
  { action: 'เปลี่ยนรหัสผ่านตัวเอง', staff: true, dispatcher: true, supervisor: true, admin: true },
  { action: 'ดูประวัติของตัวเอง', staff: true, dispatcher: true, supervisor: true, admin: true },
  { action: 'เห็นเครื่อง Asset ทุกแผนก', staff: false, dispatcher: true, supervisor: true, admin: true },
  { action: 'เบิกอุปกรณ์แทนคนอื่น', staff: false, dispatcher: true, supervisor: true, admin: true },
  { action: 'โอนเครื่องให้แผนกอื่น', staff: false, dispatcher: true, supervisor: true, admin: true },
  { action: 'คืนอุปกรณ์แทนคนอื่น', staff: false, dispatcher: false, supervisor: true, admin: true },
  { action: 'เข้าหน้าฝั่งแอดมิน', staff: false, dispatcher: false, supervisor: true, admin: true },
  { action: 'อนุมัติ / ปฏิเสธคำขอ', staff: false, dispatcher: false, supervisor: true, admin: true },
  { action: 'เพิ่มวัสดุ / แก้สต็อก / รับของเข้า', staff: false, dispatcher: false, supervisor: true, admin: true },
  { action: 'ส่งออก Google Sheet', staff: false, dispatcher: false, supervisor: true, admin: true },
  { action: 'เปิดรูปหลักฐานใน Drive', staff: false, dispatcher: false, supervisor: true, admin: true },
  { action: 'เพิ่มบัญชี / รีเซ็ตรหัสผ่านคนอื่น', staff: false, dispatcher: false, supervisor: false, admin: true },
  { action: 'ย้ายแผนกเจ้าของเครื่องถาวร', staff: false, dispatcher: false, supervisor: false, admin: true },
  { action: 'เห็นหน้านี้และตารางสิทธิ์', staff: false, dispatcher: false, supervisor: false, admin: true },
]

/** รหัสผ่านตั้งต้นที่อ่านออก พิมพ์ง่าย ไม่มีตัวที่สับสน (0/O, 1/l/I) */
function suggestPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint32Array(10))
  return Array.from(bytes, (n) => chars[n % chars.length]).join('')
}

interface Draft {
  employee_code: string
  full_name: string
  dept_code: string
  sub_dept: string
  can_assets: boolean
  post: PostKey
  password: string
  shift_start: string
  shift_end: string
}

export default function Users() {
  const users = useAsync(() => listProfiles(), [])
  const depts = useAsync(() => listDepartments(), [])
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const [draft, setDraft] = useState<Draft | null>(null)
  const [extra, setExtra] = useState<Profile | null>(null)
  const [resetting, setResetting] = useState<Profile | null>(null)
  const [newPwd, setNewPwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // QR รหัสเริ่มต้นที่เพิ่งสร้าง — ให้ก๊อปรูปส่งให้เจ้าตัวได้เลย
  const [qr, setQr] = useState<{ code: string; name?: string; password: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const [search, setSearch] = useState('')
  const [onlyInactive, setOnlyInactive] = useState(false)

  // 49 คนขึ้นไปแล้ว ไล่หาด้วยตาไม่ไหว — ค้นได้ทั้งชื่อ รหัส แผนก และแผนกย่อย
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (users.data ?? []).filter((u) => {
      if (onlyInactive && u.is_active) return false
      if (!q) return true
      return `${u.full_name} ${u.employee_code} ${u.dept_code ?? ''} ${u.sub_dept ?? ''}`
        .toLowerCase()
        .includes(q)
    })
  }, [users.data, search, onlyInactive])

  async function patch(id: string, p: Parameters<typeof updateProfile>[1]) {
    setSavingId(id)
    setError(null)
    try {
      await updateProfile(id, p)
      users.reload()
    } catch (e) {
      setError(readableError(e))
    } finally {
      setSavingId(null)
    }
  }

  function openCreate() {
    setDraft({
      employee_code: '',
      full_name: '',
      dept_code: 'ALL',
      sub_dept: '',
      can_assets: true,
      post: 'staff',
      password: suggestPassword(),
      shift_start: '',
      shift_end: '',
    })
    setModalError(null)
  }

  async function saveCreate() {
    if (!draft) return
    setBusy(true)
    setModalError(null)
    try {
      await createEmployee({
        employeeCode: draft.employee_code,
        fullName: draft.full_name,
        deptCode: draft.dept_code,
        subDept: draft.sub_dept || null,
        canAssets: draft.can_assets,
        role: postPatch(draft.post).role,
        canDispatch: postPatch(draft.post).can_dispatch,
        password: draft.password,
        shiftStart: draft.shift_start || null,
        shiftEnd: draft.shift_end || null,
      })
      setQr({ code: draft.employee_code, name: draft.full_name, password: draft.password })
      setDraft(null)
      users.reload()
    } catch (e) {
      setModalError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveReset() {
    if (!resetting) return
    setBusy(true)
    setModalError(null)
    try {
      await resetEmployeePassword(resetting.id, newPwd)
      setQr({ code: resetting.employee_code, name: resetting.full_name, password: newPwd })
      setResetting(null)
      setNewPwd('')
    } catch (e) {
      setModalError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg">ผู้ใช้และสิทธิ์</h1>
        <button type="button" className="btn-soft h-tap px-3 text-sm" onClick={() => setImporting(true)}>
          นำเข้าหลายคน
        </button>
        <button type="button" className="btn-primary" onClick={openCreate}>
          เพิ่มพนักงาน
        </button>
      </div>

      {done && (
        <div className="mb-4 rounded-card border border-success/30 bg-success-bg p-3 text-sm text-success-txt">
          <p className="break-words">{done}</p>
          <button type="button" className="mt-2 min-h-tap underline" onClick={() => setDone(null)}>
            ปิดข้อความนี้
          </button>
        </div>
      )}
      {error && <div className="mb-3"><ErrorBox message={error} /></div>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-[280px]"
          type="search"
          placeholder="ค้นหาชื่อ รหัสพนักงาน หรือแผนก"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className={`chip ${onlyInactive ? 'chip-on' : ''}`}
          onClick={() => setOnlyInactive((v) => !v)}
        >
          เฉพาะที่ปิดใช้งาน
        </button>
        <span className="text-sm text-ink-500">
          แสดง {shown.length} จาก {(users.data ?? []).length} คน
        </span>
      </div>

      {/* ตารางกินเต็มความกว้าง ตารางสิทธิ์ย้ายลงไปพับไว้ข้างล่าง
          เพราะเปิดดูปีละครั้ง แต่เมื่อก่อนมันแย่งที่ช่องกะกับแผนกไปหนึ่งในสาม */}
      <div className="grid gap-4">
        <section className="panel overflow-x-auto p-2">
          {users.loading && <Loading />}
          {users.error && <ErrorBox message={users.error} onRetry={users.reload} />}
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="text-ink-500">
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-medium">ชื่อ</th>
                <th className="w-[124px] px-3 py-2 font-medium">รหัสพนักงาน</th>
                <th className="w-[210px] px-3 py-2 font-medium">แผนก</th>
                <th className="w-[250px] px-3 py-2 font-medium">กะ / แผนกย่อย</th>
                <th className="w-[160px] px-3 py-2 font-medium">บทบาท</th>
                <th className="w-[110px] px-3 py-2 font-medium">สถานะ</th>
                <th className="w-[150px] px-3 py-2 font-medium">รหัสผ่าน</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 align-top">{u.full_name}</td>
                  <td className="px-3 py-2 align-top font-mono text-xs">{u.employee_code}</td>
                  <td className="px-3 py-2 align-top">
                    <select
                      className="input h-tap"
                      value={u.dept_code ?? 'ALL'}
                      disabled={savingId === u.id}
                      onChange={(e) => void patch(u.id, { dept_code: e.target.value })}
                    >
                      {(depts.data ?? []).map((d) => (
                        <option key={d.code} value={d.code}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    {/* แผนกพิเศษที่คนนี้เห็นของเพิ่ม นอกจากแผนกตัวเอง */}
                    <button
                      type="button"
                      className="mt-1 block text-xs text-ink-500 underline"
                      onClick={() => setExtra(u)}
                    >
                      เห็นแผนกอื่น: {u.extra_depts?.length ? u.extra_depts.length + ' แผนก' : 'ไม่มี'}
                    </button>
                  </td>
                  {/* กะใช้คำนวณกำหนดคืนอุปกรณ์ แก้ตรงนี้ได้เลยไม่ต้องสร้างบัญชีใหม่ */}
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-center gap-1">
                      <input
                        type="time"
                        aria-label={`เวลาเข้ากะของ ${u.full_name}`}
                        className="input h-tap w-[104px] px-1 text-xs"
                        value={u.shift_start?.slice(0, 5) ?? ''}
                        disabled={savingId === u.id}
                        onChange={(e) => void patch(u.id, { shift_start: e.target.value || null })}
                      />
                      <span className="text-ink-400">–</span>
                      <input
                        type="time"
                        aria-label={`เวลาเลิกกะของ ${u.full_name}`}
                        className="input h-tap w-[104px] px-1 text-xs"
                        value={u.shift_end?.slice(0, 5) ?? ''}
                        disabled={savingId === u.id}
                        onChange={(e) => void patch(u.id, { shift_end: e.target.value || null })}
                      />
                    </div>
                    {u.role === 'staff' && !(u.shift_start && u.shift_end) && (
                      <p className="mt-1 text-xs text-warn-txt">ยังไม่ได้ตั้งกะ</p>
                    )}
                    <input
                      className="input h-tap mt-1 w-full px-2 text-xs"
                      placeholder="แผนกย่อย"
                      defaultValue={u.sub_dept ?? ''}
                      disabled={savingId === u.id}
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v !== (u.sub_dept ?? '')) void patch(u.id, { sub_dept: v || null })
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <select
                      className="input h-tap"
                      value={postOf(u)}
                      disabled={savingId === u.id}
                      onChange={(e) => void patch(u.id, postPatch(e.target.value as PostKey))}
                    >
                      {POSTS.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.label}
                        </option>
                      ))}
                      {/* เจ้าของระบบเปลี่ยนบทบาทตัวเองในหน้านี้ไม่ได้ กันล็อกตัวเองออกจากระบบ */}
                      {u.role === 'admin' && <option value="admin">{ROLE_TH.admin}</option>}
                    </select>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <button
                      type="button"
                      className={u.is_active ? 'badge-ok' : 'badge-dang'}
                      disabled={savingId === u.id}
                      onClick={() => void patch(u.id, { is_active: !u.is_active })}
                    >
                      {u.is_active ? 'ใช้งานอยู่' : 'ระงับ'}
                    </button>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <button
                      type="button"
                      className="btn-soft h-tap px-3 text-sm"
                      onClick={() => {
                        setResetting(u)
                        setNewPwd(suggestPassword())
                        setModalError(null)
                      }}
                    >
                      ตั้งรหัส + QR
                    </button>
                  </td>
                </tr>
              ))}
              {!users.loading && shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-ink-400">
                    {(users.data ?? []).length === 0 ? 'ยังไม่มีผู้ใช้ในระบบ' : 'ไม่พบผู้ใช้ตามคำค้น'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <details className="panel p-4">
          <summary className="min-h-tap cursor-pointer font-display text-md">
            ตารางสิทธิ์ (RBAC) — ใครทำอะไรได้บ้าง
          </summary>
          <table className="mt-3 w-full max-w-[760px] text-left text-sm">
            <thead className="text-ink-500">
              <tr className="border-b border-line">
                <th className="py-2 font-medium">สิ่งที่ทำได้</th>
                {POSTS.map((r) => (
                  <th key={r.key} className="py-2 text-center font-medium">
                    {r.label}
                  </th>
                ))}
                <th className="py-2 text-center font-medium">{ROLE_TH.admin}</th>
              </tr>
            </thead>
            <tbody>
              {RBAC.map((row) => (
                <tr key={row.action} className="border-b border-line last:border-0">
                  <td className="py-2">{row.action}</td>
                  {(['staff', 'dispatcher', 'supervisor', 'admin'] as const).map((k) => (
                    <td key={k} className="py-2 text-center">
                      {row[k] ? <span className="text-success">✓</span> : <span className="text-ink-300">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-ink-400">
            สิทธิ์เหล่านี้บังคับจริงที่ RLS ในฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่มบนหน้าจอ
          </p>
        </details>
      </div>

      {/* ---------------------------------------------------- เพิ่มพนักงาน */}
      <Modal open={Boolean(draft)} onClose={() => setDraft(null)} title="เพิ่มพนักงาน">
        {draft && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">รหัสพนักงาน</label>
              <input
                className="input"
                placeholder="FE-10482"
                value={draft.employee_code}
                onChange={(e) => setDraft({ ...draft, employee_code: e.target.value })}
              />
              <p className="mt-1 font-mono text-xs text-ink-400">
                ล็อกอินด้วยรหัสนี้ · ระบบใช้ {draft.employee_code ? emailFromEmployeeCode(draft.employee_code) : '—'}
              </p>
            </div>
            <div>
              <label className="label">ชื่อ-นามสกุล</label>
              <input
                className="input"
                value={draft.full_name}
                onChange={(e) => setDraft({ ...draft, full_name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">แผนก</label>
              <select
                className="input"
                value={draft.dept_code}
                onChange={(e) => setDraft({ ...draft, dept_code: e.target.value })}
              >
                {(depts.data ?? []).map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-ink-400">
                เห็นเฉพาะของแผนกตัวเอง · เลือก “ทุกแผนก” ถ้าต้องการให้เห็นหมด
              </p>
            </div>
            <div>
              <label className="label">บทบาท</label>
              <select
                className="input"
                value={draft.post}
                onChange={(e) => setDraft({ ...draft, post: e.target.value as PostKey })}
              >
                {POSTS.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-ink-400">
                {POSTS.find((r) => r.key === draft.post)?.hint}
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="sub-dept">แผนกย่อย (ไม่บังคับ)</label>
              <input
                id="sub-dept"
                className="input"
                placeholder="เช่น DO1"
                value={draft.sub_dept}
                onChange={(e) => setDraft({ ...draft, sub_dept: e.target.value })}
              />
              <p className="mt-1 text-xs text-ink-400">
                เป็นป้ายกำกับอย่างเดียว ไม่มีผลกับสิทธิ์การมองเห็น · จะขึ้นต่อท้ายแผนก เช่น OUT 4W · DO1
              </p>
            </div>
            <div>
              <label className="label" htmlFor="shift-start">เวลาเข้ากะ</label>
              <input
                id="shift-start"
                type="time"
                className="input"
                value={draft.shift_start}
                onChange={(e) => setDraft({ ...draft, shift_start: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="shift-end">เวลาเลิกกะ</label>
              <input
                id="shift-end"
                type="time"
                className="input"
                value={draft.shift_end}
                onChange={(e) => setDraft({ ...draft, shift_end: e.target.value })}
              />
              <p className="mt-1 text-xs text-ink-400">
                ใช้คำนวณกำหนดคืนอุปกรณ์ · กะข้ามเที่ยงคืนใส่ได้ตามจริง เช่น 18:00 ถึง 03:00
                <br />
                แอดมินกับเจ้าของระบบเว้นว่างไว้ได้
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className="flex items-start gap-2 rounded-card border border-line p-3">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 shrink-0"
                  checked={draft.can_assets}
                  onChange={(e) => setDraft({ ...draft, can_assets: e.target.checked })}
                />
                <span>
                  <span className="font-display">เบิกอุปกรณ์ Asset ได้</span>
                  <span className="block text-sm text-ink-400">
                    ไอดาต้า · Power Pallet · วิทยุ · เลเซอร์ลบ
                    <br />
                    ถ้าเอาเครื่องหมายออก คนนี้จะเบิกได้แต่ของสิ้นเปลือง และมองไม่เห็นเครื่องเลย
                  </span>
                </span>
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className="label">รหัสผ่านตั้งต้น (อย่างน้อย {MIN_PASSWORD} ตัว)</label>
              <div className="flex gap-2">
                <input
                  className="input font-mono"
                  value={draft.password}
                  onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                />
                <button
                  type="button"
                  className="btn-ghost shrink-0"
                  onClick={() => setDraft({ ...draft, password: suggestPassword() })}
                >
                  สุ่มใหม่
                </button>
              </div>
              <p className="mt-1 text-xs text-ink-400">
                แจ้งรหัสนี้ให้พนักงานแล้วบอกให้ไปเปลี่ยนเองที่หน้า "บัญชีของฉัน"
              </p>
            </div>

            {modalError && <div className="sm:col-span-2"><ErrorBox message={modalError} /></div>}

            <div className="flex justify-end gap-2 sm:col-span-2">
              <button type="button" className="btn-ghost" onClick={() => setDraft(null)}>
                ยกเลิก
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={
                  busy ||
                  !draft.employee_code.trim() ||
                  !draft.full_name.trim() ||
                  draft.password.length < MIN_PASSWORD
                }
                onClick={() => void saveCreate()}
              >
                {busy ? <Spinner /> : null} สร้างบัญชี
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ------------------------------ สิทธิพิเศษ: เห็นของแผนกอื่นเพิ่ม */}
      <Modal
        open={Boolean(extra)}
        onClose={() => setExtra(null)}
        title={`ให้เห็นของแผนกอื่น — ${extra?.full_name ?? ''}`}
      >
        {extra && (
          <>
            <p className="rounded-card bg-brand-50 px-3 py-2 text-sm text-warn-txt">
              ปกติพนักงานเห็นเฉพาะของ<b>แผนก {depts.data?.find((d) => d.code === extra.dept_code)?.name ?? '—'}</b>
              <br />
              ติ๊กแผนกเพิ่มตรงนี้ถ้าต้องการให้คนนี้เห็นของแผนกอื่นด้วย เช่นหัวหน้ากะที่ดูแลหลายแผนก
            </p>

            <ul className="mt-3 space-y-1">
              {(depts.data ?? [])
                .filter((d) => d.code !== 'ALL' && d.code !== extra.dept_code)
                .map((d) => {
                  const on = (extra.extra_depts ?? []).includes(d.code)
                  return (
                    <li key={d.code}>
                      <label className="flex min-h-tap items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-[var(--yellow-500)]"
                          checked={on}
                          disabled={savingId === extra.id}
                          onChange={() => {
                            const next = on
                              ? (extra.extra_depts ?? []).filter((c) => c !== d.code)
                              : [...(extra.extra_depts ?? []), d.code]
                            setExtra({ ...extra, extra_depts: next })
                            void patch(extra.id, { extra_depts: next })
                          }}
                        />
                        {d.name}
                      </label>
                    </li>
                  )
                })}
            </ul>

            <div className="mt-4 flex justify-end">
              <button type="button" className="btn-ghost" onClick={() => setExtra(null)}>
                ปิด
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ------------------------------------------------ รีเซ็ตรหัสผ่าน */}
      <Modal
        open={Boolean(resetting)}
        onClose={() => setResetting(null)}
        title={`ตั้งรหัสผ่านใหม่ — ${resetting?.full_name ?? ''}`}
      >
        {resetting && (
          <>
            <p className="text-sm text-ink-500">
              รหัสพนักงาน <b className="font-mono text-ink">{resetting.employee_code}</b>
            </p>
            <label className="label mt-3">รหัสผ่านใหม่ (อย่างน้อย {MIN_PASSWORD} ตัว)</label>
            <div className="flex gap-2">
              <input className="input font-mono" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
              <button type="button" className="btn-ghost shrink-0" onClick={() => setNewPwd(suggestPassword())}>
                สุ่มใหม่
              </button>
            </div>
            <p className="mt-2 rounded-btn bg-warn-bg px-3 py-2 text-sm text-warn-txt">
              รหัสเดิมจะใช้ไม่ได้ทันที ต้องแจ้งรหัสใหม่ให้เจ้าตัวก่อนกดยืนยัน
            </p>
            <p className="mt-2 rounded-btn bg-accent-50 px-3 py-2 text-sm text-ink-700">
              กดยืนยันแล้วระบบจะสร้าง QR ให้ทันที ก๊อปรูปส่งในแชตได้เลย ไม่ต้องพิมพ์รหัสให้ใครอ่าน
            </p>

            {modalError && <div className="mt-3"><ErrorBox message={modalError} /></div>}

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setResetting(null)}>
                ยกเลิก
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || newPwd.length < MIN_PASSWORD}
                onClick={() => void saveReset()}
              >
                {busy ? <Spinner /> : null} ยืนยัน
              </button>
            </div>
          </>
        )}
      </Modal>
      <Modal open={Boolean(qr)} onClose={() => setQr(null)} title="ส่ง QR ให้พนักงาน">
        {qr && (
          <>
            <p className="mb-3 text-sm text-ink-500">
              ก๊อปรูปนี้ส่งในแชตให้เจ้าตัว เขาเปิดหน้าล็อกอินแล้วกด
              <b> สแกน QR ที่แอดมินส่งให้ </b>
              เข้าได้เลย ไม่ต้องพิมพ์รหัส
            </p>
            <LoginQr employeeCode={qr.code} fullName={qr.name} password={qr.password} />
            <div className="mt-3 flex justify-end">
              <button type="button" className="btn-primary" onClick={() => setQr(null)}>
                เสร็จแล้ว
              </button>
            </div>
          </>
        )}
      </Modal>

      <StaffImport
        open={importing}
        onClose={() => setImporting(false)}
        departments={depts.data ?? []}
        onChanged={() => users.reload()}
      />

    </div>
  )
}
