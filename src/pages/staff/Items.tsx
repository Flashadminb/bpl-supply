import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listCategories, listItems } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import { useCart } from '../../lib/cart'
import { StaffPage, TopBar } from '../../components/Shell'
import { EmptyState, ErrorBox, Loading, QtyStepper, StockBadge } from '../../components/ui'

export default function Items() {
  const nav = useNavigate()
  const cart = useCart()
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState<number | null>(null)

  const cats = useAsync(() => listCategories(), [])
  const items = useAsync(() => listItems({ search, categoryId: cat }), [search, cat])

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

        <div className="no-bar -mx-3 mt-3 flex gap-2 overflow-x-auto px-3 pb-1">
          <button
            type="button"
            className={`chip shrink-0 ${cat === null ? 'chip-on' : ''}`}
            onClick={() => setCat(null)}
          >
            ทั้งหมด
          </button>
          {(cats.data ?? []).map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chip shrink-0 ${cat === c.id ? 'chip-on' : ''}`}
              onClick={() => setCat(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-2">
          {items.loading && <Loading />}
          {items.error && <ErrorBox message={items.error} onRetry={items.reload} />}
          {!items.loading && !items.error && (items.data ?? []).length === 0 && (
            <EmptyState title="ไม่พบวัสดุที่ค้นหา" hint="ลองเปลี่ยนคำค้นหรือเลือกหมวดอื่น" />
          )}

          {(items.data ?? []).map((it) => {
            const inCart = cart.qtyOf(it.id)
            const out = it.qty_on_hand <= 0
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
                  </div>
                </Link>

                {out ? (
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
