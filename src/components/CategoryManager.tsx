import { useState } from 'react'
import { createCategory, deleteCategory, updateCategory } from '../lib/api'
import { readableError } from '../lib/supabase'
import { ErrorBox, Modal, Spinner, Toggle } from './ui'

interface Category {
  id: number
  name: string
  auto_approvable: boolean
}

/**
 * จัดการหมวดวัสดุ — เพิ่ม เปลี่ยนชื่อ สลับอนุมัติอัตโนมัติ ลบ
 * ลบได้เฉพาะหมวดที่ไม่มีวัสดุผูกอยู่ ฐานข้อมูลเป็นคนกันให้เอง
 */
export function CategoryManager({
  open,
  onClose,
  categories,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  categories: Category[]
  onChanged: () => void
}) {
  const [newName, setNewName] = useState('')
  const [newAuto, setNewAuto] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
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
    <Modal open={open} onClose={onClose} title="จัดการหมวดวัสดุ">
      <p className="mb-3 rounded-card bg-brand-50 px-3 py-2 text-sm text-warn-txt">
        สวิตช์ <b>อนุมัติอัตโนมัติ</b> หมายถึงของในหมวดนี้เบิกได้เลยไม่ต้องรออนุมัติ
        แต่ถ้าวัสดุชิ้นไหนติ๊ก “ต้องขออนุมัติทุกครั้ง” ไว้ ตัวนั้นจะรออนุมัติเสมอไม่ว่าหมวดจะตั้งยังไง
      </p>

      <ul className="space-y-2">
        {categories.map((c) => (
          <li key={c.id} className="card flex flex-wrap items-center gap-2 p-3">
            {editingId === c.id ? (
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
                      await updateCategory(c.id, { name: editName.trim() })
                      setEditingId(null)
                    })
                  }
                >
                  บันทึก
                </button>
                <button type="button" className="btn-ghost" onClick={() => setEditingId(null)}>
                  ยกเลิก
                </button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate font-display text-base">{c.name}</span>
                <Toggle
                  checked={c.auto_approvable}
                  label="อนุมัติอัตโนมัติ"
                  onChange={(v) => void run(() => updateCategory(c.id, { auto_approvable: v }))}
                />
                <button
                  type="button"
                  className="btn-soft h-tap px-3 text-sm"
                  disabled={busy}
                  onClick={() => {
                    setEditingId(c.id)
                    setEditName(c.name)
                  }}
                >
                  เปลี่ยนชื่อ
                </button>
                <button
                  type="button"
                  className="btn-danger h-tap px-3 text-sm"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`ลบหมวด "${c.name}" ?`)) void run(() => deleteCategory(c.id))
                  }}
                >
                  ลบ
                </button>
              </>
            )}
          </li>
        ))}
        {categories.length === 0 && <li className="text-sm text-ink-400">ยังไม่มีหมวด</li>}
      </ul>

      <div className="mt-4 rounded-card border border-dashed border-line-2 p-3">
        <label className="label">เพิ่มหมวดใหม่</label>
        <div className="flex flex-wrap gap-2">
          <input
            className="input min-w-0 flex-1"
            placeholder="เช่น อะไหล่ซ่อมบำรุง"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !newName.trim()}
            onClick={() =>
              void run(async () => {
                await createCategory(newName, newAuto)
                setNewName('')
                setNewAuto(true)
              })
            }
          >
            {busy ? <Spinner /> : null} เพิ่ม
          </button>
        </div>
        <div className="mt-2">
          <Toggle checked={newAuto} label="อนุมัติอัตโนมัติ" onChange={setNewAuto} />
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
