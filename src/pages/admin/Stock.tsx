import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import {
  adjustStock,
  listAllItemsForAdmin,
  listCategories,
  listDepartments,
  upsertItem,
  type ItemDraft,
} from '../../lib/api'
import { readableError } from '../../lib/supabase'
import { ErrorBox, Loading, Modal, Spinner, StockBadge } from '../../components/ui'
import type { Item } from '../../lib/types'
import { CategoryManager } from '../../components/CategoryManager'
import { DepartmentManager } from '../../components/DepartmentManager'

type Filter = 'all' | 'low' | 'out' | 'returnable'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'low', label: 'ใกล้หมด' },
  { key: 'out', label: 'หมดสต็อก' },
  { key: 'returnable', label: 'ประเภทยืม-คืน' },
]

function emptyDraft(): ItemDraft {
  return {
    sku: '',
    name: '',
    hub_code: 'BPL',
    dept_code: 'ALL',
    unit: 'ชิ้น',
    category_id: null,
    shelf_code: '',
    qty_on_hand: 0,
    min_qty: 0,
    is_returnable: false,
    requires_approval: false,
    qr_payload: '',
    is_active: true,
  }
}

export default function Stock() {
  const items = useAsync(() => listAllItemsForAdmin(), [])
  const cats = useAsync(() => listCategories(), [])
  const depts = useAsync(() => listDepartments(), [])

  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<ItemDraft | null>(null)
  const [adjusting, setAdjusting] = useState<Item | null>(null)
  const [delta, setDelta] = useState(0)
  const [reason, setReason] = useState('receive')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [catsOpen, setCatsOpen] = useState(false)
  const [deptsOpen, setDeptsOpen] = useState(false)

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (items.data ?? []).filter((i) => {
      if (s && !`${i.name} ${i.sku} ${i.shelf_code ?? ''}`.toLowerCase().includes(s)) return false
      if (filter === 'low') return i.qty_on_hand > 0 && i.qty_on_hand <= i.min_qty
      if (filter === 'out') return i.qty_on_hand <= 0
      if (filter === 'returnable') return i.is_returnable
      return true
    })
  }, [items.data, filter, search])

  async function save() {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      await upsertItem({
        ...draft,
        shelf_code: draft.shelf_code || null,
        qr_payload: draft.qr_payload || null,
      })
      setDraft(null)
      items.reload()
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveAdjust() {
    if (!adjusting || delta === 0) return
    setBusy(true)
    setError(null)
    try {
      await adjustStock(adjusting.id, delta, reason)
      setAdjusting(null)
      setDelta(0)
      items.reload()
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg">สต็อกวัสดุ</h1>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => window.print()}
            title="พิมพ์หน้านี้เป็นรายการติดชั้นวางไปก่อน — หน้าพิมพ์ QR เต็มรูปแบบยังไม่ได้ออกแบบ"
          >
            พิมพ์รายการ
          </button>
          <button type="button" className="btn-ghost" onClick={() => setDeptsOpen(true)}>
            จัดการแผนก
          </button>
          <button type="button" className="btn-ghost" onClick={() => setCatsOpen(true)}>
            จัดการหมวด
          </button>
          <button type="button" className="btn-primary" onClick={() => setDraft(emptyDraft())}>
            เพิ่มวัสดุ
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-[320px]"
          type="search"
          placeholder="ค้นหาชื่อ SKU ชั้นวาง"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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

      {items.loading && <Loading />}
      {items.error && <ErrorBox message={items.error} onRetry={items.reload} />}

      <div className="panel overflow-x-auto p-2">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="text-ink-500">
            <tr className="border-b border-line">
              <th className="p-2 font-medium">วัสดุ</th>
              <th className="p-2 font-medium">SKU</th>
              <th className="p-2 font-medium">หมวด</th>
              <th className="p-2 font-medium">ชั้นวาง</th>
              <th className="p-2 font-medium">คงเหลือ</th>
              <th className="p-2 font-medium">ขั้นต่ำ</th>
              <th className="p-2 font-medium">สถานะ</th>
              <th className="p-2 font-medium">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} className="border-b border-line last:border-0">
                <td className="p-2">
                  {i.name}
                  {!i.is_active && <span className="badge-mute ml-2">ปิดใช้งาน</span>}
                  {i.is_returnable && <span className="badge-mute ml-2">ยืม-คืน</span>}
                  {i.requires_approval && <span className="badge-warn ml-2">ต้องอนุมัติ</span>}
                </td>
                <td className="p-2 font-mono text-xs">{i.sku}</td>
                <td className="p-2 text-ink-500">{i.categories?.name ?? '—'}</td>
                <td className="p-2 font-mono text-xs">{i.shelf_code ?? '—'}</td>
                <td className="p-2 font-display">{i.qty_on_hand}</td>
                <td className="p-2 text-ink-500">{i.min_qty}</td>
                <td className="p-2">
                  <StockBadge qty={i.qty_on_hand} min={i.min_qty} />
                </td>
                <td className="p-2">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="btn-soft h-tap px-3 text-sm"
                      onClick={() => {
                        setAdjusting(i)
                        setDelta(0)
                        setReason('receive')
                      }}
                    >
                      รับเข้า/ปรับ
                    </button>
                    <button
                      type="button"
                      className="btn-soft h-tap px-3 text-sm"
                      onClick={() =>
                        setDraft({
                          id: i.id,
                          sku: i.sku,
                          name: i.name,
                          hub_code: i.hub_code,
                          dept_code: i.dept_code ?? 'ALL',
                          unit: i.unit,
                          category_id: i.category_id,
                          shelf_code: i.shelf_code ?? '',
                          qty_on_hand: i.qty_on_hand,
                          min_qty: i.min_qty,
                          is_returnable: i.is_returnable,
                          requires_approval: i.requires_approval,
                          qr_payload: i.qr_payload ?? '',
                          is_active: i.is_active,
                        })
                      }
                    >
                      แก้ไข
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!items.loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center text-ink-400">
                  ไม่พบวัสดุตามเงื่อนไข
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* เพิ่ม / แก้ไขวัสดุ */}
      <Modal open={Boolean(draft)} onClose={() => setDraft(null)} title={draft?.id ? 'แก้ไขวัสดุ' : 'เพิ่มวัสดุ'}>
        {draft && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">ชื่อวัสดุ</label>
              <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div>
              <label className="label">SKU</label>
              <input className="input" value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} />
            </div>
            <div>
              <label className="label">หน่วย</label>
              <input className="input" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
            </div>
            <div>
              <label className="label">หมวด</label>
              <select
                className="input"
                value={draft.category_id ?? ''}
                onChange={(e) => setDraft({ ...draft, category_id: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">— ไม่ระบุ —</option>
                {(cats.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">แผนกที่เห็นของชิ้นนี้</label>
              <select
                className="input"
                value={draft.dept_code ?? 'ALL'}
                onChange={(e) => setDraft({ ...draft, dept_code: e.target.value })}
              >
                {(depts.data ?? []).map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-ink-400">
                เลือก “ทุกแผนก” = ทุกคนเห็น · เลือกแผนกเดียว = เห็นเฉพาะคนในแผนกนั้น
              </p>
            </div>
            <div>
              <label className="label">ชั้นวาง</label>
              <input
                className="input"
                value={draft.shelf_code ?? ''}
                onChange={(e) => setDraft({ ...draft, shelf_code: e.target.value })}
              />
            </div>
            <div>
              <label className="label">รหัสใน QR</label>
              <input
                className="input"
                placeholder="เว้นว่างได้ ระบบจะใช้ SKU แทน"
                value={draft.qr_payload ?? ''}
                onChange={(e) => setDraft({ ...draft, qr_payload: e.target.value })}
              />
            </div>
            <div>
              <label className="label">คงเหลือ</label>
              <input
                type="number"
                className="input"
                value={draft.qty_on_hand}
                onChange={(e) => setDraft({ ...draft, qty_on_hand: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="label">ขั้นต่ำ</label>
              <input
                type="number"
                className="input"
                value={draft.min_qty}
                onChange={(e) => setDraft({ ...draft, min_qty: Number(e.target.value) })}
              />
            </div>
            <label className="inline-flex min-h-tap items-center gap-2">
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--yellow-500)]"
                checked={draft.is_returnable}
                onChange={(e) => setDraft({ ...draft, is_returnable: e.target.checked })}
              />
              ประเภทยืม-คืน
            </label>
            <label className="inline-flex min-h-tap items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--yellow-500)]"
                checked={draft.requires_approval}
                onChange={(e) => setDraft({ ...draft, requires_approval: e.target.checked })}
              />
              <span>
                ต้องขออนุมัติทุกครั้ง
                <span className="block text-xs text-ink-400">
                  ติ๊กแล้วจะไม่อนุมัติอัตโนมัติ ไม่ว่าหมวดจะตั้งไว้ยังไง — ใช้กับของแพงหรือของที่ต้องคุมการใช้
                </span>
              </span>
            </label>
            <label className="inline-flex min-h-tap items-center gap-2">
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--yellow-500)]"
                checked={draft.is_active}
                onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
              />
              เปิดใช้งาน
            </label>

            {error && <div className="sm:col-span-2"><ErrorBox message={error} /></div>}

            <div className="sm:col-span-2 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setDraft(null)}>
                ยกเลิก
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
                {busy ? <Spinner /> : null} บันทึก
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* รับเข้า / ปรับยอด */}
      <Modal open={Boolean(adjusting)} onClose={() => setAdjusting(null)} title={`รับเข้า / ปรับยอด — ${adjusting?.name ?? ''}`}>
        {adjusting && (
          <>
            <p className="text-sm text-ink-500">
              คงเหลือปัจจุบัน <b className="text-ink">{adjusting.qty_on_hand}</b> {adjusting.unit}
            </p>
            <label className="label mt-3">จำนวนที่เปลี่ยน (ใส่ค่าลบเพื่อหักออก)</label>
            <input
              type="number"
              className="input"
              value={delta}
              onChange={(e) => setDelta(Number(e.target.value))}
            />
            <label className="label mt-3">เหตุผล</label>
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="receive">รับของเข้า</option>
              <option value="adjust">ปรับยอดจากการตรวจนับ</option>
              <option value="damage">ตัดของชำรุด</option>
            </select>
            <p className="mt-3 rounded-btn bg-surface-2 px-3 py-2 text-sm">
              ยอดใหม่จะเป็น <b>{Math.max(0, adjusting.qty_on_hand + delta)}</b> {adjusting.unit}
            </p>
            {error && <div className="mt-3"><ErrorBox message={error} /></div>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setAdjusting(null)}>
                ยกเลิก
              </button>
              <button type="button" className="btn-primary" disabled={busy || delta === 0} onClick={() => void saveAdjust()}>
                {busy ? <Spinner /> : null} บันทึก
              </button>
            </div>
          </>
        )}
      </Modal>

      <CategoryManager
        open={catsOpen}
        onClose={() => setCatsOpen(false)}
        categories={cats.data ?? []}
        onChanged={() => {
          cats.reload()
          items.reload()
        }}
      />

      <DepartmentManager
        open={deptsOpen}
        onClose={() => setDeptsOpen(false)}
        departments={depts.data ?? []}
        onChanged={() => {
          depts.reload()
          items.reload()
        }}
      />
    </div>
  )
}
