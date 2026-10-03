import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listCategories, listItems } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import { useCart } from '../../lib/cart'
import { StaffPage, TopBar } from '../../components/Shell'
import { EmptyState, ErrorBox, Loading, QtyStepper, StockBadge } from '../../components/ui'

/**
 * หมวดที่ขึ้นเป็นปุ่มจิ้มได้เลย · ที่เหลืออยู่ในดรอปดาวน์
 *
 * ของเดิมเอาทุกหมวดมาเรียงเป็นแถวเลื่อนแนวนอน ซึ่งพังตอนหมวดเพิ่มขึ้น
 * บนจอ 390px แถวนั้นใส่ได้จริงราวสามปุ่ม หมวดที่เพิ่มทีหลังจึงไปกองอยู่นอกจอ
 * คนใช้งานเห็นแค่หมวดเก่าสามหมวดแล้วสรุปว่าของที่เพิ่งเพิ่มไม่ขึ้นในระบบ
 *
 * ชื่อที่ไม่มีอยู่จริงในตารางหมวดจะถูกข้ามไปเงียบ ๆ ไม่ขึ้นปุ่มค้างไว้ให้กดแล้วว่าง
 */
const QUICK_CATS = ['บัตรชั่วคราว', 'สำนักงาน', 'หน้างาน']

export default function Items() {
  const nav = useNavigate()
  const cart = useCart()
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState<number | null>(null)

  const cats = useAsync(() => listCategories(), [])
  const items = useAsync(() => listItems({ search, categoryId: cat }), [search, cat])

  const allCats = cats.data ?? []
  const quick = QUICK_CATS.map((n) => allCats.find((c) => c.name === n)).filter(
    (c): c is NonNullable<typeof c> => Boolean(c),
  )

  return (
    <>
      <TopBar title="รายการวัสดุ" back="/" />
      <StaffPage>
        <input
          className="input"
          type="search"
          placeholder="ค้นหาชื่อ SKU หรือชั้นวาง"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`chip ${cat === null ? 'chip-on' : ''}`}
            onClick={() => setCat(null)}
          >
            ทั้งหมด
          </button>
          {quick.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chip ${cat === c.id ? 'chip-on' : ''}`}
              onClick={() => setCat(c.id)}
            >
              {c.name}
            </button>
          ))}

          {/* ดรอปดาวน์ถือหมวดครบทุกหมวดเสมอ รวมหมวดที่เพิ่งเพิ่ม
              ปุ่มด้านบนเป็นแค่ทางลัดของสามหมวดที่ใช้บ่อย ไม่ใช่รายการทั้งหมด */}
          <label className="sr-only" htmlFor="it-cat">
            เลือกหมวด
          </label>
          <select
            id="it-cat"
            className="input h-tap w-full max-w-[200px]"
            value={cat ?? ''}
            onChange={(e) => setCat(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">ทุกหมวด</option>
            {allCats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 space-y-2">
          {items.loading && <Loading />}
          {items.error && <ErrorBox message={items.error} onRetry={items.reload} />}
          {!items.loading && !items.error && (items.data ?? []).length === 0 && (
            <EmptyState title="ไม่พบวัสดุที่ค้นหา" hint="ลองเปลี่ยนคำค้นหรือเลือกหมวดอื่น" />
          )}

          {(items.data ?? []).map((it) => {
            const inCart = cart.qtyOf(it.id)
            // ดูอย่างเดียวไม่ใช่ของหมด จงใจไม่หรี่การ์ดลง เพราะเลขสต็อกคือสิ่งที่เขามาดู
            const locked = it.view_only
            const out = !locked && it.qty_on_hand <= 0
            return (
              <div key={it.id} className={`card flex items-center gap-3 p-3 ${out ? 'opacity-55' : ''}`}>
                <Link to={`/items/${it.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-display text-base">{it.name}</p>
                  <p className="truncate font-mono text-xs text-ink-400">
                    {it.sku} · ชั้น {it.shelf_code ?? '—'} · {it.unit}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <StockBadge qty={it.qty_on_hand} min={it.min_qty} />
                    {it.is_returnable && <span className="badge-mute">ยืม-คืน</span>}
                    {it.requires_approval && <span className="badge-warn">ต้องอนุมัติ</span>}
                    {locked && <span className="badge-warn">เบิกในแอพนี้ไม่ได้</span>}
                  </div>
                  {/* เหตุผลต้องอยู่ตรงนี้เลย ไม่ใช่ให้กดเข้าไปอ่าน
                      หน้างานยืนอยู่หน้าชั้นของ ต้องรู้เดี๋ยวนั้นว่าต้องไปเบิกที่ไหนแทน */}
                  {locked && (
                    <p className="mt-1 rounded-btn bg-warn-bg px-2 py-1 text-xs text-warn-txt">
                      {it.view_only_note?.trim() || 'ดูสต็อกได้อย่างเดียว'}
                    </p>
                  )}
                </Link>

                {locked ? (
                  <span
                    aria-label="เบิกในแอพนี้ไม่ได้"
                    className="shrink-0 rounded-btn bg-surface-2 px-3 py-2 text-xs text-ink-400"
                  >
                    ดูอย่างเดียว
                  </span>
                ) : out ? (
                  <button
                    type="button"
                    className="btn-soft shrink-0 text-sm"
                    onClick={() => alert('บันทึกคำขอแจ้งเตือนไว้แล้ว ระบบจะแจ้งเมื่อของเข้า (ฟีเจอร์นี้ยังรอเปิดใช้)')}
                  >
                    แจ้งเตือน
                  </button>
                ) : inCart > 0 ? (
                  <QtyStepper
                    size="sm"
                    value={inCart}
                    max={it.qty_on_hand}
                    onChange={(n) => cart.setQty(it.id, n)}
                  />
                ) : (
                  <button
                    type="button"
                    aria-label={`เพิ่ม ${it.name} ลงตะกร้า`}
                    className="btn-primary h-tap w-tap shrink-0 px-0 text-lg"
                    onClick={() => cart.add(it, 1)}
                  >
                    +
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </StaffPage>

      {cart.count > 0 && (
        <div className="safe-b fixed inset-x-0 bottom-[68px] z-20 px-3">
          <button
            type="button"
            className="btn-primary w-full max-w-phone shadow-float mx-auto flex"
            onClick={() => nav('/cart')}
          >
            ดูตะกร้า · {cart.count} รายการ · {cart.units} ชิ้น
          </button>
        </div>
      )}
    </>
  )
}
