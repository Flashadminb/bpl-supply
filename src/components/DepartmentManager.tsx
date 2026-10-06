import { useEffect, useState } from 'react'
import {
  createDepartment,
  deleteDepartment,
  deleteSubDept,
  listSubDeptCoverage,
  listSubDepts,
  renameDepartment,
  saveSubDept,
  type SubDept,
  type SubDeptCoverage,
} from '../lib/api'
import { readableError } from '../lib/supabase'
import { ErrorBox, Modal, Spinner } from './ui'
import type { Department } from '../lib/types'

/**
 * จัดการแผนก — เพิ่ม เปลี่ยนชื่อ ลบ
 *
 * เปลี่ยนชื่อได้อิสระเพราะระบบอ้างอิงด้วยรหัสที่ซ่อนอยู่ ไม่ได้อ้างอิงด้วยชื่อ
 * ลบได้เฉพาะแผนกที่ไม่มีคนและไม่มีของผูกอยู่ ฐานข้อมูลเป็นคนกันให้เอง
 */
export function DepartmentManager({
  open,
  onClose,
  departments,
  onChanged,
  canEdit,
}: {
  open: boolean
  onClose: () => void
  departments: Department[]
  onChanged: () => void
  /**
   * แก้ได้ไหม · เฉพาะเจ้าของระบบ
   *
   * ฐานข้อมูลกันไว้อยู่แล้วตั้งแต่ migration 019 เพราะแผนกคุมว่าใครเห็นของอะไร
   * แต่ของเดิมยังโชว์ปุ่มให้แอดมินกด แล้วได้ error ดิบ ๆ ของ Postgres ใส่หน้า
   * ปุ่มที่กดแล้วพังเสมอ แย่กว่าไม่มีปุ่ม เพราะคนจะคิดว่าระบบเสีย
   */
  canEdit: boolean
}) {
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* แผนกย่อย · โหลดเองเพราะใช้แค่ในกล่องนี้ */
  const [subs, setSubs] = useState<SubDept[]>([])
  const [cover, setCover] = useState<SubDeptCoverage[]>([])
  const [openSub, setOpenSub] = useState<string | null>(null)
  const [newSub, setNewSub] = useState('')

  async function reloadSubs() {
    try {
      const [a, b] = await Promise.all([listSubDepts(), listSubDeptCoverage()])
      setSubs(a)
      setCover(b)
    } catch {
      /* ไม่ใช่แอดมินก็อ่านตัวนับไม่ได้ ปล่อยว่างไว้ ไม่ต้องทำให้ทั้งกล่องพัง */
    }
  }
  useEffect(() => {
    if (open) void reloadSubs()
  }, [open])

  const subsOf = (dept: string) => subs.filter((s) => s.dept_code === dept)
  const coverOf = (dept: string) => cover.find((c) => c.dept_code === dept)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await reloadSubs()
      onChanged()
    } catch (e) {
      const raw = readableError(e)
      // Postgres ตอบเป็นภาษาอังกฤษดิบ ๆ ตอนโดน RLS ปฏิเสธ · แปลให้คนอ่านรู้เรื่อง
      setError(
        /row-level security|violates row-level/i.test(raw)
          ? 'บัญชีนี้แก้แผนกไม่ได้ · เฉพาะเจ้าของระบบเท่านั้นที่เพิ่ม แก้ชื่อ หรือลบแผนกและแผนกย่อยได้'
          : raw,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="จัดการแผนก">
      <p className="mb-3 rounded-card bg-brand-50 px-3 py-2 text-sm text-warn-txt">
        แผนกใช้คุมว่าใครเห็นของชิ้นไหน — ตั้งแผนกให้<b>คน</b>ที่หน้าผู้ใช้และสิทธิ์
        และตั้งแผนกให้<b>ของ</b>ตอนเพิ่ม/แก้วัสดุ
        <br />
        ของที่ตั้งเป็น <b>ทุกแผนก</b> ทุกคนเห็นหมด
      </p>

      <p className="mb-3 rounded-card border border-line-2 px-3 py-2 text-sm text-ink-500">
        <b className="text-ink">แผนกย่อย</b> ใช้แยกของกันเองในแผนกเดียว เช่น OUT 4W มี DO1 DO2 DO3
        <br />
        คนที่<b>ปล่อยช่องย่อยว่าง</b> เห็นทั้งแผนกรวมทุกย่อย · คนที่<b>ใส่ย่อย</b> เห็นของกลางของแผนก
        บวกของย่อยตัวเองเท่านั้น
        <br />
        เครื่องที่ไม่ใส่ย่อยเป็นของกลาง ทุกคนในแผนกเห็นเหมือนเดิม · ข้ามแผนกยังไม่ได้เหมือนเดิม
        <br />
        ชื่อย่อยตั้งเป็นอะไรก็ได้ · ชื่อที่เพิ่มไว้ตรงนี้แล้วเท่านั้นจึงจะมีผลกับสิทธิ์
      </p>

      {!canEdit && (
        <p className="mb-3 rounded-card border border-warn/30 bg-warn-bg px-3 py-2 text-sm text-warn-txt">
          <b>ดูได้อย่างเดียว</b> · เฉพาะเจ้าของระบบเท่านั้นที่เพิ่ม แก้ชื่อ หรือลบแผนกและแผนกย่อยได้
          <br />
          เพราะแผนกเป็นตัวกำหนดว่าใครเห็นเครื่องไหน แก้ผิดทีเดียวกระทบทั้งคนและของพร้อมกัน
        </p>
      )}

      <ul className="space-y-2">
        {departments.map((d) => (
          <li key={d.code} className="card flex flex-wrap items-center gap-2 p-3">
            {editing === d.code ? (
              <>
                <input
                  className="input min-w-0 flex-1"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || !editName.trim()}
                  onClick={() =>
                    void run(async () => {
                      await renameDepartment(d.code, editName)
                      setEditing(null)
                    })
                  }
                >
                  บันทึก
                </button>
                <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
                  ยกเลิก
                </button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate font-display text-base">{d.name}</span>
                {d.code === 'ALL' ? (
                  <span className="badge-mute">ค่าตั้งต้นของระบบ · แก้ไม่ได้</span>
                ) : !canEdit ? (
                  <button
                    type="button"
                    className="btn-soft h-tap px-3 text-sm"
                    onClick={() => setOpenSub(openSub === d.code ? null : d.code)}
                  >
                    ดูแผนกย่อย {subsOf(d.code).length > 0 ? subsOf(d.code).length : ''}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn-soft h-tap px-3 text-sm"
                      disabled={busy}
                      onClick={() => {
                        setEditing(d.code)
                        setEditName(d.name)
                      }}
                    >
                      เปลี่ยนชื่อ
                    </button>
                    <button
                      type="button"
                      className="btn-soft h-tap px-3 text-sm"
                      disabled={busy}
                      onClick={() => setOpenSub(openSub === d.code ? null : d.code)}
                    >
                      แผนกย่อย {subsOf(d.code).length > 0 ? subsOf(d.code).length : ''}
                    </button>
                    <button
                      type="button"
                      className="btn-danger h-tap px-3 text-sm"
                      disabled={busy}
                      onClick={() => {
                        if (confirm(`ลบแผนก "${d.name}" ?`)) void run(() => deleteDepartment(d.code))
                      }}
                    >
                      ลบ
                    </button>
                  </>
                )}
              </>
            )}

            {openSub === d.code && (
              <div className="mt-2 w-full rounded-card bg-canvas p-3">
                {subsOf(d.code).length === 0 ? (
                  <p className="mb-2 text-sm text-ink-500">
                    ยังไม่มีแผนกย่อย · ตอนนี้ทุกคนในแผนกนี้เห็นของในแผนกเหมือนเดิมทั้งหมด
                  </p>
                ) : (
                  <ul className="mb-2 flex flex-wrap gap-2">
                    {subsOf(d.code).map((s) => (
                      <li
                        key={s.code}
                        className="flex items-center gap-2 rounded-pill border border-line-2 px-3 py-1.5 text-sm"
                      >
                        <b>{s.code}</b>
                        <button
                          type="button"
                          aria-label={`ลบแผนกย่อย ${s.code}`}
                          className={canEdit ? 'text-danger' : 'hidden'}
                          disabled={busy}
                          onClick={() => {
                            if (confirm(`ลบแผนกย่อย "${s.code}" ของ ${d.name} ?`))
                              void run(() => deleteSubDept(d.code, s.code))
                          }}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className={`flex flex-wrap gap-2 ${canEdit ? '' : 'hidden'}`}>
                  <input
                    className="input min-w-0 flex-1"
                    placeholder="ชื่อแผนกย่อย เช่น DO1 หรือ ABC"
                    value={newSub}
                    onChange={(e) => setNewSub(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newSub.trim())
                        void run(async () => {
                          await saveSubDept({ dept_code: d.code, code: newSub.trim(), name: newSub.trim() })
                          setNewSub('')
                        })
                    }}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy || !newSub.trim()}
                    onClick={() =>
                      void run(async () => {
                        await saveSubDept({ dept_code: d.code, code: newSub.trim(), name: newSub.trim() })
                        setNewSub('')
                      })
                    }
                  >
                    เพิ่มแผนกย่อย
                  </button>
                </div>

                {coverOf(d.code) && coverOf(d.code)!.no_sub > 0 && (
                  <p className="mt-2 rounded-btn bg-warn-bg px-3 py-2 text-xs text-warn-txt">
                    แผนกนี้มีคน {coverOf(d.code)!.total} คน ·{' '}
                    <b>ยังไม่ได้ใส่แผนกย่อย {coverOf(d.code)!.no_sub} คน</b>
                    <br />
                    คนที่ยังว่างจะเห็นของทุกย่อยเหมือนหัวหน้า · ตั้งใจแบบนั้นก็ปล่อยไว้ได้
                    ถ้าไม่ได้ตั้งใจให้ไปใส่ที่หน้าผู้ใช้และสิทธิ์
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className={`mt-4 rounded-card border border-dashed border-line-2 p-3 ${canEdit ? '' : 'hidden'}`}>
        <label className="label">เพิ่มแผนกใหม่</label>
        <div className="flex flex-wrap gap-2">
          <input
            className="input min-w-0 flex-1"
            placeholder="เช่น OUT 10W"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !newName.trim()}
            onClick={() =>
              void run(async () => {
                await createDepartment(newName)
                setNewName('')
              })
            }
          >
            {busy ? <Spinner /> : null} เพิ่ม
          </button>
        </div>
      </div>

      {error && <div className="mt-3"><ErrorBox message={error} /></div>}

      <div className="mt-4 flex justify-end">
        <button type="button" className="btn-ghost" onClick={onClose}>
          ปิด
        </button>
      </div>
    </Modal>
  )
}
