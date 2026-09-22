import { useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import {
  createEmployee,
  listHubs,
  listProfiles,
  resetEmployeePassword,
  updateProfile,
} from '../../lib/api'
import { emailFromEmployeeCode, readableError } from '../../lib/supabase'
import { ErrorBox, Loading, Modal, Spinner } from '../../components/ui'
import type { Profile, UserRole } from '../../lib/types'
import { ASSIGNABLE_ROLES, ROLE_TH } from '../../lib/roles'

const MIN_PASSWORD = 8

const RBAC: { action: string; staff: boolean; supervisor: boolean; admin: boolean }[] = [
  { action: 'เบิก / คืนวัสดุ', staff: true, supervisor: true, admin: true },
  { action: 'เปลี่ยนรหัสผ่านตัวเอง', staff: true, supervisor: true, admin: true },
  { action: 'ดูประวัติของตัวเอง', staff: true, supervisor: true, admin: true },
  { action: 'อนุมัติ / ปฏิเสธคำขอ', staff: false, supervisor: true, admin: true },
  { action: 'เพิ่มวัสดุ / แก้สต็อก / รับของเข้า', staff: false, supervisor: true, admin: true },
  { action: 'ส่งออก Google Sheet', staff: false, supervisor: true, admin: true },
  { action: 'เปิดรูปหลักฐานใน Drive', staff: false, supervisor: true, admin: true },
  { action: 'เพิ่มบัญชี / รีเซ็ตรหัสผ่านคนอื่น', staff: false, supervisor: false, admin: true },
  { action: 'เห็นหน้านี้และตารางสิทธิ์', staff: false, supervisor: false, admin: true },
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
  hub_code: string
  role: UserRole
  password: string
}

export default function Users() {
  const users = useAsync(() => listProfiles(), [])
  const hubs = useAsync(() => listHubs(), [])
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const [draft, setDraft] = useState<Draft | null>(null)
  const [resetting, setResetting] = useState<Profile | null>(null)
  const [newPwd, setNewPwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

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
      hub_code: hubs.data?.[0]?.code ?? 'BPL',
      role: 'staff',
      password: suggestPassword(),
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
        hubCode: draft.hub_code,
        role: draft.role,
        password: draft.password,
      })
      setDone(
        `สร้างบัญชี ${draft.employee_code} แล้ว — แจ้งรหัสผ่าน "${draft.password}" ให้เจ้าตัว แล้วบอกให้เปลี่ยนรหัสเองที่หน้า "บัญชีของฉัน"`,
      )
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
      setDone(`ตั้งรหัสใหม่ให้ ${resetting.employee_code} แล้ว — แจ้งรหัส "${newPwd}" ให้เจ้าตัว`)
      setResetting(null)
      setNewPwd('')
    } catch (e) {
      setModalError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg">ผู้ใช้และสิทธิ์</h1>
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

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <section className="panel overflow-x-auto p-2">
          {users.loading && <Loading />}
          {users.error && <ErrorBox message={users.error} onRetry={users.reload} />}
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-ink-500">
              <tr className="border-b border-line">
                <th className="p-2 font-medium">ชื่อ</th>
                <th className="p-2 font-medium">รหัสพนักงาน</th>
                <th className="p-2 font-medium">ฮับ</th>
                <th className="p-2 font-medium">บทบาท</th>
                <th className="p-2 font-medium">สถานะ</th>
                <th className="p-2 font-medium">รหัสผ่าน</th>
              </tr>
            </thead>
            <tbody>
              {(users.data ?? []).map((u) => (
                <tr key={u.id} className="border-b border-line last:border-0">
                  <td className="p-2">{u.full_name}</td>
                  <td className="p-2 font-mono text-xs">{u.employee_code}</td>
                  <td className="p-2">
                    <select
                      className="input h-tap"
                      value={u.hub_code}
                      disabled={savingId === u.id}
                      onChange={(e) => void patch(u.id, { hub_code: e.target.value })}
                    >
                      {(hubs.data ?? []).map((h) => (
                        <option key={h.code} value={h.code}>
                          {h.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2">
                    <select
                      className="input h-tap"
                      value={u.role}
                      disabled={savingId === u.id}
                      onChange={(e) => void patch(u.id, { role: e.target.value as UserRole })}
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.label}
                        </option>
                      ))}
                      {/* เจ้าของระบบเปลี่ยนบทบาทตัวเองในหน้านี้ไม่ได้ กันล็อกตัวเองออกจากระบบ */}
                      {u.role === 'admin' && <option value="admin">{ROLE_TH.admin}</option>}
                    </select>
                  </td>
                  <td className="p-2">
                    <button
                      type="button"
                      className={u.is_active ? 'badge-ok' : 'badge-dang'}
                      disabled={savingId === u.id}
                      onClick={() => void patch(u.id, { is_active: !u.is_active })}
                    >
                      {u.is_active ? 'ใช้งานอยู่' : 'ระงับ'}
                    </button>
                  </td>
                  <td className="p-2">
                    <button
                      type="button"
                      className="btn-soft h-tap px-3 text-sm"
                      onClick={() => {
                        setResetting(u)
                        setNewPwd(suggestPassword())
                        setModalError(null)
                      }}
                    >
                      ตั้งรหัสใหม่
                    </button>
                  </td>
                </tr>
              ))}
              {!users.loading && (users.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-ink-400">
                    ยังไม่มีผู้ใช้ในระบบ
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="panel p-4">
          <h2 className="mb-3 font-display text-md">ตารางสิทธิ์ (RBAC)</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-ink-500">
              <tr className="border-b border-line">
                <th className="py-2 font-medium">สิ่งที่ทำได้</th>
                {(['staff', 'supervisor', 'admin'] as const).map((k) => (
                  <th key={k} className="py-2 text-center font-medium">
                    {ROLE_TH[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RBAC.map((row) => (
                <tr key={row.action} className="border-b border-line last:border-0">
                  <td className="py-2">{row.action}</td>
                  {(['staff', 'supervisor', 'admin'] as const).map((k) => (
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
        </section>
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
              <label className="label">ฮับ</label>
              <select
                className="input"
                value={draft.hub_code}
                onChange={(e) => setDraft({ ...draft, hub_code: e.target.value })}
              >
                {(hubs.data ?? []).map((h) => (
                  <option key={h.code} value={h.code}>
                    {h.code} — {h.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">บทบาท</label>
              <select
                className="input"
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value as UserRole })}
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-ink-400">
                {ASSIGNABLE_ROLES.find((r) => r.key === draft.role)?.hint}
              </p>
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
    </div>
  )
}
