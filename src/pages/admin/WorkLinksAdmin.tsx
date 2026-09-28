import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import {
  deleteWorkLink,
  listDepartments,
  listProfiles,
  listWorkLinksFull,
  saveWorkLink,
} from '../../lib/api'
import { readableError } from '../../lib/supabase'
import { EmptyState, ErrorBox, Loading, Modal, Spinner } from '../../components/ui'
import { fmtDateTime } from '../../lib/format'
import type { LinkAudience, LinkRoleKey, WorkLinkFull } from '../../lib/types'

/**
 * ลิงก์งาน — เจ้าของระบบใส่ไว้ให้กดจากปุ่มสายฟ้าในแอพ
 *
 * ปุ่มสายฟ้าเปิดให้ทุกคนเห็นแล้ว สิ่งที่ต้องคุมจึงกลายเป็น "เห็นลิงก์ไหน"
 * ไม่ใช่ "เห็นปุ่มไหม" — ตั้งได้เป็นรายลิงก์ในหน้านี้
 *
 * สิทธิ์จริงบังคับที่ RLS ของ work_links ไม่ใช่ที่หน้าจอนี้
 * หน้านี้เป็นแค่ที่กรอกค่า ใครแก้ URL ในเบราว์เซอร์ก็ยังเขียนไม่ได้อยู่ดี
 */

const EMPTY = {
  title: '',
  url: '',
  note: '',
  sort_no: 0,
  is_active: true,
  audience: 'custom' as LinkAudience,
  role_keys: [] as LinkRoleKey[],
  dept_codes: [] as string[],
  user_ids: [] as string[],
}

type Draft = typeof EMPTY & { id?: number }

const AUDIENCES: { key: LinkAudience; label: string; hint: string }[] = [
  { key: 'all', label: 'ทุกคนในระบบ', hint: 'ทุกคนที่ล็อกอินได้เห็นลิงก์นี้' },
  {
    key: 'custom',
    label: 'เลือกเอง',
    hint: 'เลือกตามตำแหน่ง ตามแผนก หรือระบุรายคน — ผสมกันได้',
  },
]

/**
 * ตำแหน่งที่เลือกได้
 *
 * ผู้ตรวจสอบไม่ใช่ role ในฐานข้อมูล เป็นธง can_dispatch ที่ปักบน role อะไรก็ได้
 * จึงต้องเป็นตัวเลือกแยก ไม่ใช่ค่าหนึ่งใน role เดียวกับที่เหลือ
 */
const ROLES: { key: LinkRoleKey; label: string; hint: string }[] = [
  { key: 'staff', label: 'หน้างาน', hint: 'พนักงานทั่วไปที่เบิกของ' },
  { key: 'dispatch', label: 'ผู้ตรวจสอบ', hint: 'คนที่เปิดสิทธิ์จ่ายของแทนไว้' },
  { key: 'supervisor', label: 'แอดมิน', hint: 'ดูแลสต็อกและอนุมัติ' },
  { key: 'admin', label: 'เจ้าของระบบ', hint: 'คุณ — เห็นทุกลิงก์อยู่แล้ว' },
]

export default function WorkLinksAdmin() {
  const feed = useAsync(() => listWorkLinksFull(), [])
  const depts = useAsync(listDepartments, [])
  const people = useAsync(listProfiles, [])

  const [edit, setEdit] = useState<Draft | null>(null)
  const [kill, setKill] = useState<WorkLinkFull | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [find, setFind] = useState('')

  const rows = feed.data ?? []

  const deptName = useMemo(
    () => new Map((depts.data ?? []).map((d) => [d.code, d.name])),
    [depts.data],
  )
  const personName = useMemo(
    () => new Map((people.data ?? []).map((p) => [p.id, p.full_name])),
    [people.data],
  )

  /** คนที่เลือกได้ — ปิดใช้งานแล้วไม่ต้องโผล่ ไม่งั้นรายชื่อจะรกขึ้นทุกเดือน */
  const pickable = useMemo(
    () => (people.data ?? []).filter((p) => p.is_active),
    [people.data],
  )

  const found = useMemo(() => {
    const q = find.trim().toLowerCase()
    if (!q) return pickable
    return pickable.filter(
      (p) =>
        p.full_name.toLowerCase().includes(q) ||
        p.employee_code.toLowerCase().includes(q) ||
        (p.dept_code ?? '').toLowerCase().includes(q),
    )
  }, [pickable, find])

  function toggle(key: 'role_keys' | 'dept_codes' | 'user_ids', v: string) {
    setEdit((e) =>
      !e
        ? e
        : {
            ...e,
            [key]: (e[key] as string[]).includes(v)
              ? (e[key] as string[]).filter((x) => x !== v)
              : [...(e[key] as string[]), v],
          },
    )
  }

  async function save() {
    if (!edit) return
    if (!edit.title.trim() || !edit.url.trim()) {
      setErr('ต้องใส่ทั้งชื่อและลิงก์')
      return
    }
    if (
      edit.audience === 'custom' &&
      edit.role_keys.length === 0 &&
      edit.dept_codes.length === 0 &&
      edit.user_ids.length === 0
    ) {
      setErr(
        'เลือกเองต้องเลือกอย่างน้อยหนึ่งอย่าง — ตำแหน่ง แผนก หรือรายคน ไม่งั้นจะไม่มีใครเห็นลิงก์นี้เลย',
      )
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await saveWorkLink(edit)
      setEdit(null)
      feed.reload()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!kill) return
    setBusy(true)
    setErr(null)
    try {
      await deleteWorkLink(kill.id)
      setKill(null)
      feed.reload()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  /** สรุปผู้ชมเป็นข้อความสั้นสำหรับตาราง */
  function audienceText(l: WorkLinkFull) {
    if (l.audience === 'all') return 'ทุกคนในระบบ'
    if (l.audience === 'managers') return 'แอดมินและผู้ตรวจสอบ'
    const parts: string[] = []
    if (l.role_keys.length > 0)
      parts.push(l.role_keys.map((k) => ROLES.find((r) => r.key === k)?.label ?? k).join(', '))
    if (l.dept_codes.length > 0)
      parts.push(l.dept_codes.map((c) => deptName.get(c) ?? c).join(', '))
    if (l.user_ids.length > 0) parts.push(`รายคน ${l.user_ids.length} คน`)
    return parts.join(' · ') || 'ยังไม่ได้เลือกใคร'
  }

  return (
    <div className="mx-auto max-w-[900px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg">ลิงก์งาน</h1>
        <button
          type="button"
          className="btn-primary h-tap px-3 text-sm"
          onClick={() => {
            setErr(null)
            setFind('')
            setEdit({
              ...EMPTY,
              // ค่าตั้งต้นเป็นของผู้จัดการ เพราะเป็นกรณีที่ใช้บ่อยสุดและปลอดภัยสุด
              role_keys: ['supervisor', 'admin', 'dispatch'],
              sort_no: (rows.length ? rows[rows.length - 1].sort_no : 0) + 10,
            })
          }}
        >
          เพิ่มลิงก์
        </button>
      </div>

      <p className="mb-3 rounded-card bg-brand-50 px-3 py-2 text-sm text-ink-700">
        ลิงก์พวกนี้ไปโผล่ที่ปุ่มสายฟ้าบนหัวแอพ ซึ่งตอนนี้ <b>ทุกคนเห็นปุ่ม</b>
        <br />
        แต่ละลิงก์เลือกได้เองว่าให้ใครเห็น — ตามตำแหน่ง ตามแผนก หรือระบุรายคน ผสมกันได้
        <br />
        แก้ได้เฉพาะคุณคนเดียว
      </p>

      {feed.loading && <Loading />}
      {feed.error && <ErrorBox message={feed.error} onRetry={feed.reload} />}

      {!feed.loading && rows.length === 0 && (
        <EmptyState title="ยังไม่มีลิงก์" hint="กดปุ่มเพิ่มลิงก์ด้านบนเพื่อใส่อันแรก" />
      )}

      {rows.length > 0 && (
        <section className="panel overflow-x-auto p-2">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="text-ink-500">
              <tr className="border-b border-line">
                <th className="p-2 font-medium">ลำดับ</th>
                <th className="p-2 font-medium">ชื่อที่แสดง</th>
                <th className="p-2 font-medium">ลิงก์</th>
                <th className="p-2 font-medium">ใครเห็น</th>
                <th className="p-2 font-medium">สถานะ</th>
                <th className="p-2 font-medium">แก้ล่าสุด</th>
                <th className="p-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0 align-top">
                  <td className="p-2 font-mono text-xs text-ink-400">{l.sort_no}</td>
                  <td className="p-2">
                    <p className="font-display">{l.title}</p>
                    {l.note && <p className="text-xs text-ink-400">{l.note}</p>}
                  </td>
                  <td className="p-2">
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-sm underline decoration-line-2"
                    >
                      {l.url}
                    </a>
                  </td>
                  <td className="p-2">
                    <span className={l.audience === 'all' ? 'badge-ok' : 'badge-mute'}>
                      {l.audience === 'all' ? 'ทุกคน' : 'เลือกเอง'}
                    </span>
                    <p className="mt-1 text-xs text-ink-500">{audienceText(l)}</p>
                  </td>
                  <td className="p-2">
                    <span className={l.is_active ? 'badge-ok' : 'badge-mute'}>
                      {l.is_active ? 'เปิดใช้' : 'ซ่อนอยู่'}
                    </span>
                  </td>
                  <td className="p-2 text-xs text-ink-500">{fmtDateTime(l.updated_at)}</td>
                  <td className="p-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        className="btn-soft h-tap px-3 text-sm"
                        onClick={() => {
                          setErr(null)
                          setFind('')
                          setEdit({
                            id: l.id,
                            title: l.title,
                            url: l.url,
                            note: l.note ?? '',
                            sort_no: l.sort_no,
                            is_active: l.is_active,
                            // แถวเก่าโหมด managers แปลงเป็นตำแหน่งให้ตอนเปิดแก้
                            audience: l.audience === 'all' ? 'all' : 'custom',
                            role_keys:
                              l.audience === 'managers'
                                ? (['supervisor', 'admin', 'dispatch'] as LinkRoleKey[])
                                : l.role_keys,
                            dept_codes: l.dept_codes,
                            user_ids: l.user_ids,
                          })
                        }}
                      >
                        แก้
                      </button>
                      <button
                        type="button"
                        className="btn-ghost h-tap px-3 text-sm"
                        onClick={() => {
                          setErr(null)
                          setKill(l)
                        }}
                      >
                        ลบ
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ------------------------------------------------- เพิ่ม / แก้ */}
      <Modal
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'แก้ลิงก์' : 'เพิ่มลิงก์'}
      >
        {edit && (
          <>
            <label className="label" htmlFor="wl-title">
              ชื่อที่แสดงในแอพ
            </label>
            <input
              id="wl-title"
              className="input"
              placeholder="เช่น ตารางเวรประจำสัปดาห์"
              value={edit.title}
              onChange={(e) => setEdit({ ...edit, title: e.target.value })}
            />

            <label className="label mt-3" htmlFor="wl-url">
              ลิงก์
            </label>
            <input
              id="wl-url"
              className="input font-mono text-sm"
              placeholder="https://..."
              value={edit.url}
              onChange={(e) => setEdit({ ...edit, url: e.target.value })}
            />

            <label className="label mt-3" htmlFor="wl-note">
              คำอธิบายสั้น ๆ (ไม่บังคับ)
            </label>
            <input
              id="wl-note"
              className="input"
              placeholder="เช่น อัปเดตทุกวันจันทร์"
              value={edit.note}
              onChange={(e) => setEdit({ ...edit, note: e.target.value })}
            />

            {/* ------------------------------------------------- ใครเห็น */}
            <p className="label mt-4">ใครเห็นลิงก์นี้</p>
            <div className="space-y-2">
              {AUDIENCES.map((a) => (
                <label
                  key={a.key}
                  className={`flex cursor-pointer gap-3 rounded-card border p-3 ${
                    edit.audience === a.key
                      ? 'border-ink bg-surface-2'
                      : 'border-line bg-surface'
                  }`}
                >
                  <input
                    type="radio"
                    name="wl-audience"
                    className="mt-1 h-5 w-5 shrink-0"
                    checked={edit.audience === a.key}
                    onChange={() => setEdit({ ...edit, audience: a.key })}
                  />
                  <span className="min-w-0">
                    <span className="block font-display text-base">{a.label}</span>
                    <span className="block text-sm text-ink-500">{a.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            {edit.audience === 'custom' && (
              <div className="mt-3 rounded-card border border-line p-3">
                <p className="label">ตำแหน่งที่เห็น</p>
                <div className="flex flex-wrap gap-2">
                  {ROLES.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      title={r.hint}
                      className={`chip ${edit.role_keys.includes(r.key) ? 'chip-on' : ''}`}
                      onClick={() => toggle('role_keys', r.key)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-ink-400">
                  คุณเห็นทุกลิงก์อยู่แล้วไม่ว่าจะติ๊กหรือไม่ เพราะต้องเข้ามาแก้ได้
                  <br />
                  ผู้ตรวจสอบส่วนใหญ่มีตำแหน่งเป็นหน้างานด้วย ถ้าติ๊ก “หน้างาน” เขาจะเห็นด้วย
                </p>

                <p className="label mt-4">แผนกที่เห็น</p>
                {depts.loading && <Loading />}
                <div className="flex flex-wrap gap-2">
                  {(depts.data ?? [])
                    .filter((d) => d.is_active)
                    .map((d) => (
                      <button
                        key={d.code}
                        type="button"
                        className={`chip ${edit.dept_codes.includes(d.code) ? 'chip-on' : ''}`}
                        onClick={() => toggle('dept_codes', d.code)}
                      >
                        {d.name}
                      </button>
                    ))}
                </div>
                <p className="mt-1 text-xs text-ink-400">
                  เลือก “ทุกแผนก” เท่ากับทุกคนที่มีแผนก · คนที่สังกัดหลายแผนกเห็นถ้าตรงสักแผนก
                </p>

                <p className="label mt-4">
                  เลือกรายคน
                  {edit.user_ids.length > 0 && (
                    <span className="ml-2 font-normal text-ink-500">
                      เลือกแล้ว {edit.user_ids.length} คน
                    </span>
                  )}
                </p>

                {edit.user_ids.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {edit.user_ids.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="chip chip-on"
                        onClick={() => toggle('user_ids', id)}
                      >
                        {personName.get(id) ?? id.slice(0, 8)} ✕
                      </button>
                    ))}
                  </div>
                )}

                <input
                  className="input"
                  placeholder="พิมพ์ชื่อ รหัสพนักงาน หรือแผนก เพื่อค้นหา"
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                />

                {people.loading && <Loading />}
                {people.error && <ErrorBox message={people.error} onRetry={people.reload} />}

                {/* จำกัดความสูงไว้ ไม่งั้นรายชื่อ 50 คนจะดันปุ่มบันทึกตกจอ */}
                <ul className="mt-2 max-h-[220px] overflow-y-auto rounded-btn border border-line">
                  {found.length === 0 && (
                    <li className="px-3 py-3 text-sm text-ink-400">ไม่พบคนที่ค้นหา</li>
                  )}
                  {found.map((p) => {
                    const on = edit.user_ids.includes(p.id)
                    return (
                      <li key={p.id} className="border-b border-line last:border-0">
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                          <input
                            type="checkbox"
                            className="h-5 w-5 shrink-0"
                            checked={on}
                            onChange={() => toggle('user_ids', p.id)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm">{p.full_name}</span>
                            <span className="block font-mono text-xs text-ink-400">
                              {p.employee_code}
                              {p.dept_code ? ` · ${deptName.get(p.dept_code) ?? p.dept_code}` : ''}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>

                <p className="mt-1 text-xs text-ink-400">
                  สามอย่างนี้เป็น “หรือ” กัน — ใครเข้าเงื่อนไขข้อใดข้อหนึ่งก็เห็น
                  <br />
                  ถ้าอยากเจาะว่าตำแหน่งนี้เฉพาะในแผนกนี้ ให้เลือกเป็นรายคนแทน
                </p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-end gap-4">
              <span>
                <label className="label" htmlFor="wl-sort">
                  ลำดับ
                </label>
                <input
                  id="wl-sort"
                  type="number"
                  className="input w-[110px]"
                  value={edit.sort_no}
                  onChange={(e) => setEdit({ ...edit, sort_no: Number(e.target.value) })}
                />
              </span>
              <label className="flex items-center gap-2 pb-2">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={edit.is_active}
                  onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })}
                />
                <span className="text-sm">เปิดใช้</span>
              </label>
            </div>

            <p className="mt-2 text-xs text-ink-400">
              เลขลำดับน้อยขึ้นก่อน · ปิด “เปิดใช้” เพื่อซ่อนชั่วคราวโดยไม่ต้องลบทิ้ง
            </p>

            {err && (
              <div className="mt-3">
                <ErrorBox message={err} />
              </div>
            )}

            {/*
              ตรึงปุ่มไว้ท้ายกล่อง
              ฟอร์มนี้ยาวกว่าใครเพื่อน ถ้าปล่อยให้ปุ่มไหลไปท้ายสุด
              คนตั้งสิทธิ์จะต้องเลื่อนหาทุกครั้งว่าบันทึกอยู่ไหน
            */}
            <div className="sticky bottom-0 -mx-1 mt-4 flex justify-end gap-2 border-t border-line bg-surface px-1 py-3">
              <button type="button" className="btn-ghost" onClick={() => setEdit(null)}>
                ยกเลิก
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? <Spinner /> : null} บันทึก
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ------------------------------------------------------------ ลบ */}
      <Modal open={Boolean(kill)} onClose={() => setKill(null)} title="ลบลิงก์">
        {kill && (
          <>
            <p className="text-sm text-ink-500">
              ลบ <b className="text-ink">{kill.title}</b> ออกจากรายการ
              <br />
              ถ้าแค่อยากซ่อนชั่วคราว ให้กดแก้แล้วปิด “เปิดใช้” แทน
            </p>
            {err && (
              <div className="mt-3">
                <ErrorBox message={err} />
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setKill(null)}>
                ยกเลิก
              </button>
              <button
                type="button"
                className="h-tap rounded-btn bg-danger px-3 text-sm text-white"
                disabled={busy}
                onClick={() => void remove()}
              >
                {busy ? <Spinner /> : null} ลบ
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
