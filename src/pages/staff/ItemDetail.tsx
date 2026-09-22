import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getItem } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import { useCart } from '../../lib/cart'
import { StaffPage, TopBar } from '../../components/Shell'
import { ErrorBox, Loading, QtyStepper, StockBadge } from '../../components/ui'

const PURPOSES = ['ใช้ในไลน์คัดแยก', 'ทำความสะอาดพื้นที่', 'งานสำนักงาน', 'เปลี่ยนของชำรุด']

export default function ItemDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const cart = useCart()
  const item = useAsync(() => getItem(Number(id)), [id])
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')

  const it = item.data

  return (
    <>
      <TopBar title="รายละเอียดวัสดุ" back />
      <StaffPage>
        {item.loading && <Loading />}
        {item.error && <ErrorBox message={item.error} onRetry={item.reload} />}

        {it && (
          <>
            <div className="card p-4">
              <div className="mb-3 flex h-[120px] items-center justify-center rounded-card bg-surface-2 text-ink-300">
                {it.image_path ? (
                  <img src={it.image_path} alt={it.name} className="h-full w-full rounded-card object-cover" />
                ) : (
                  <span className="text-sm">ยังไม่มีรูปวัสดุ</span>
                )}
              </div>

              <h2 className="font-display text-lg">{it.name}</h2>
              <p className="font-mono text-sm text-ink-400">
                {it.sku} · ชั้น {it.shelf_code ?? '—'} · หน่วย {it.unit}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StockBadge qty={it.qty_on_hand} min={it.min_qty} />
                <span className="badge-mute">ขั้นต่ำ {it.min_qty}</span>
                {it.is_returnable && <span className="badge-mute">ต้องคืน</span>}
                {it.requires_approval && <span className="badge-warn">ต้องขออนุมัติก่อน</span>}
                {it.categories && <span className="badge-mute">{it.categories.name}</span>}
              </div>
            </div>

            <div className="card mt-3 p-4">
              <div className="flex items-center justify-between">
                <span className="label mb-0">จำนวนที่ต้องการ</span>
                <QtyStepper value={qty} max={it.qty_on_hand} min={1} onChange={setQty} />
              </div>

              <div className="mt-3 flex gap-2">
                {[1, 3, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`chip flex-1 justify-center ${qty === n ? 'chip-on' : ''}`}
                    disabled={n > it.qty_on_hand}
                    onClick={() => setQty(n)}
                  >
                    {n} {it.unit}
                  </button>
                ))}
              </div>

              <p className="mt-3 rounded-btn bg-surface-2 px-3 py-2 text-sm text-ink-500">
                คงเหลือหลังเบิก{' '}
                <b className={it.qty_on_hand - qty <= it.min_qty ? 'text-warn-txt' : 'text-ink'}>
                  {Math.max(0, it.qty_on_hand - qty)} {it.unit}
                </b>
                {it.qty_on_hand - qty <= it.min_qty && ' · ต่ำกว่าขั้นต่ำ ต้องรออนุมัติ'}
              </p>

              <label className="label mt-4">วัตถุประสงค์</label>
              <div className="flex flex-wrap gap-2">
                {PURPOSES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`chip ${cart.purpose === p ? 'chip-on' : ''}`}
                    onClick={() => cart.setPurpose(cart.purpose === p ? '' : p)}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <label className="label mt-4" htmlFor="note">
                หมายเหตุ
              </label>
              <textarea
                id="note"
                className="input py-2"
                rows={2}
                placeholder="ระบุเพิ่มเติม (ไม่บังคับ)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  cart.add(it, qty)
                  if (note) cart.setNote([cart.note, `${it.name}: ${note}`].filter(Boolean).join(' · '))
                  nav('/items')
                }}
                disabled={it.qty_on_hand <= 0}
              >
                เลือกต่อ
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  cart.add(it, qty)
                  if (note) cart.setNote([cart.note, `${it.name}: ${note}`].filter(Boolean).join(' · '))
                  nav('/cart')
                }}
                disabled={it.qty_on_hand <= 0}
              >
                เพิ่มลงตะกร้า
              </button>
            </div>
          </>
        )}
      </StaffPage>
    </>
  )
}
