import { useMemo, useRef, useState } from 'react'
import { createEmployee } from '../lib/api'
import { Modal, Spinner } from './ui'
import type { Department, UserRole } from '../lib/types'

/**
 * นำเข้าพนักงานทีละหลายคนจากข้อความที่วางมา
 *
 * รูปแบบ 1 คนต่อ 1 บรรทัด คั่นด้วยจุลภาคหรือแท็บ (วางจาก Google Sheet ได้ตรง ๆ)
 *   รหัสพนักงาน, ชื่อ-สกุล, แผนก, เวลาเข้ากะ, เวลาเลิกกะ, บทบาท, แผนกย่อย
 *
 * รหัสผ่านตั้งต้นคือรหัสพนักงาน ระบบบังคับให้เจ้าตัวเปลี่ยนเองตอนล็อกอินครั้งแรกอยู่แล้ว
 */

/** ชื่อแผนกที่พิมพ์มาแบบไหนก็ตาม ให้กลายเป็นรหัสแผนกจริง */
function normalizeDept(raw: string, depts: Department[]): string | null {
  const t = raw.trim().toUpperCase().replace(/\s+/g, '')
  if (!t || t === 'ทุกแผนก'.toUpperCase() || t === 'ALL') return 'ALL'
  const hit = depts.find(
    (d) =>
      d.code.toUpperCase() === t ||
      d.name.toUpperCase().replace(/\s+/g, '') === t,
  )
  return hit?.code ?? null
}

/** "09:00" / "9.00" / "09.00 น." → "09:00" */
function normalizeTime(raw: string): string | null {
  const m = raw.trim().match(/(\d{1,2})[:.](\d{2})/)
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
}

function normalizeRole(raw: string): UserRole {
  const t = raw.trim()
  // "หัวหน้างาน" ในชีตเดิมคือพนักงานหน้างาน ตามที่เจ้าของระบบยืนยัน
  return t === 'แอดมิน' || t.toLowerCase() === 'supervisor' ? 'supervisor' : 'staff'
}

interface Row {
  code: string
  name: string
  dept: string | null
  deptRaw: string
  start: string | null
  end: string | null
  role: UserRole
  subDept: string
  problem: string | null
}

type RowState = 'wait' | 'busy' | 'done' | 'dup' | 'fail'

function parse(text: string, depts: Department[]): Row[] {
  const out: Row[] = []
  for (const line of text.split('\n')) {
    const raw = line.trim()
    if (!raw) continue
    const c = raw.split(/[\t,]/).map((x) => x.trim())
    const code = c[0] ?? ''
    if (!/^\d{3,}$/.test(code)) continue // ข้ามหัวตาราง
    const dept = normalizeDept(c[2] ?? '', depts)
    const start = normalizeTime(c[3] ?? '')
    const end = normalizeTime(c[4] ?? '')
    out.push({
      code,
      name: c[1] ?? '',
      dept,
      deptRaw: c[2] ?? '',
      start,
      end,
      role: normalizeRole(c[5] ?? ''),
      subDept: (c[6] ?? '').trim(),
      problem: !c[1]
        ? 'ไม่มีชื่อ'
        : !dept
          ? `ไม่รู้จักแผนก "${c[2] ?? ''}"`
          : code.length < 8
            ? null // รหัสสั้นกว่า 8 ตัวใช้เป็นรหัสผ่านไม่ได้ เดี๋ยวเติมให้เอง
            : null,
    })
  }
  return out
}

/** รหัสผ่านตั้งต้น ต้องยาว 8 ตัวขึ้นไปตามกติกาของระบบ */
function initialPassword(code: string): string {
  return code.length >= 8 ? code : `bpl${code}`.slice(0, 32)
}

export function StaffImport({
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
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<Record<string, { s: RowState; msg?: string }>>({})
  const stopRef = useRef(false)

  const rows = useMemo(() => parse(text, departments), [text, departments])
  const bad = rows.filter((r) => r.problem)
  const ok = rows.filter((r) => !r.problem)
  const doneCount = Object.values(state).filter((v) => v.s === 'done').length
  const dupCount = Object.values(state).filter((v) => v.s === 'dup').length
  const failCount = Object.values(state).filter((v) => v.s === 'fail').length

  async function run() {
    setBusy(true)
    stopRef.current = false
    // ทีละคนเรียงกันไป ไม่ยิงพร้อมกัน เพราะสร้างบัญชีเป็นงานหนักฝั่งเซิร์ฟเวอร์
    for (const r of ok) {
      if (stopRef.current) break
      if (state[r.code]?.s === 'done') continue
      setState((m) => ({ ...m, [r.code]: { s: 'busy' } }))
      try {
        await createEmployee({
          employeeCode: r.code,
          fullName: r.name,
          deptCode: r.dept as string,
          role: r.role,
          password: initialPassword(r.code),
          subDept: r.subDept || null,
          shiftStart: r.start,
          shiftEnd: r.end,
        })
        setState((m) => ({ ...m, [r.code]: { s: 'done' } }))
      } catch (e) {
        const msg = (e as Error).message
        const dup = /มีอยู่ในระบบแล้ว|already/i.test(msg)
        setState((m) => ({ ...m, [r.code]: { s: dup ? 'dup' : 'fail', msg } }))
      }
    }
    setBusy(false)
    onChanged()
  }

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} title="นำเข้าพนักงานหลายคน">
      <p className="text-sm text-ink-500">
        วางข้อมูลจาก Google Sheet ได้ตรง ๆ — 1 คนต่อ 1 บรรทัด เรียงตามนี้
      </p>
      <p className="mt-1 rounded-btn bg-surface-2 px-3 py-2 font-mono text-xs text-ink-700">
        รหัสพนักงาน, ชื่อ-สกุล, แผนก, เวลาเข้ากะ, เวลาเลิกกะ, บทบาท, แผนกย่อย
      </p>

      <textarea
        className="input mt-3 h-[180px] w-full font-mono text-xs"
        placeholder={'724547, ทัศนาพร ปัตถาสาย, ทุกแผนก, 09:00, 18:00, พนักงานหน้างาน'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />

      {rows.length > 0 && (
        <>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <span className="badge-mute">อ่านได้ {rows.length} คน</span>
            {bad.length > 0 && <span className="badge-dang">ข้อมูลไม่ครบ {bad.length}</span>}
            {doneCount > 0 && <span className="badge-ok">สร้างแล้ว {doneCount}</span>}
            {dupCount > 0 && <span className="badge-warn">มีอยู่แล้ว {dupCount}</span>}
            {failCount > 0 && <span className="badge-dang">ล้มเหลว {failCount}</span>}
          </div>

          <div className="mt-2 max-h-[240px] overflow-y-auto rounded-card border border-line">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-surface-2 text-ink-500">
                <tr>
                  <th className="p-2 font-medium">รหัส</th>
                  <th className="p-2 font-medium">ชื่อ</th>
                  <th className="p-2 font-medium">แผนก</th>
                  <th className="p-2 font-medium">กะ</th>
                  <th className="p-2 font-medium">บทบาท</th>
                  <th className="p-2 font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = state[r.code]
                  return (
                    <tr key={r.code} className="border-t border-line">
                      <td className="p-2 font-mono">{r.code}</td>
                      <td className="p-2">{r.name}</td>
                      <td className="p-2">
                        {r.dept ?? <span className="text-danger-txt">{r.deptRaw}</span>}
                        {r.subDept ? <span className="text-ink-400"> · {r.subDept}</span> : null}
                      </td>
                      <td className="p-2 font-mono">
                        {r.start && r.end ? `${r.start}–${r.end}` : <span className="text-ink-300">—</span>}
                      </td>
                      <td className="p-2">{r.role === 'supervisor' ? 'แอดมิน' : 'หน้างาน'}</td>
                      <td className="p-2">
                        {r.problem ? (
                          <span className="text-danger-txt">{r.problem}</span>
                        ) : st?.s === 'busy' ? (
                          <Spinner />
                        ) : st?.s === 'done' ? (
                          <span className="text-success-txt">สร้างแล้ว</span>
                        ) : st?.s === 'dup' ? (
                          <span className="text-warn-txt">มีอยู่แล้ว</span>
                        ) : st?.s === 'fail' ? (
                          <span className="text-danger-txt">{st.msg}</span>
                        ) : (
                          <span className="text-ink-300">รอ</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="mt-3 rounded-card bg-brand-50 px-3 py-2 text-sm text-warn-txt">
        รหัสผ่านตั้งต้นคือ<b>รหัสพนักงานของแต่ละคน</b> (ถ้าสั้นกว่า 8 ตัวจะเติม <span className="font-mono">bpl</span> ข้างหน้า)
        <br />
        ระบบบังคับให้เจ้าตัวตั้งรหัสใหม่เองทันทีที่ล็อกอินครั้งแรก
      </p>

      <div className="mt-4 flex justify-end gap-2">
        {busy ? (
          <button type="button" className="btn-soft" onClick={() => (stopRef.current = true)}>
            หยุด
          </button>
        ) : (
          <button type="button" className="btn-ghost" onClick={onClose}>
            ปิด
          </button>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={busy || ok.length === 0}
          onClick={() => void run()}
        >
          {busy ? <Spinner /> : null}
          {busy ? 'กำลังสร้าง…' : `สร้าง ${ok.length - doneCount - dupCount} บัญชี`}
        </button>
      </div>
    </Modal>
  )
}
