import { useState } from 'react'
import { createDepartment, deleteDepartment, renameDepartment } from '../lib/api'
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
}: {
  open: boolean
  onClose: () => void
  departments: Department[]
  onChanged: () => void
}) {
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (e) {
      setError(readableError(e))
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
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-card border border-dashed border-line-2 p-3">
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
