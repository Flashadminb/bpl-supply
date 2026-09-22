import { Link, useNavigate } from 'react-router-dom'
import { useCart } from '../../lib/cart'
import { StaffPage, TopBar } from '../../components/Shell'
import { EmptyState, QtyStepper } from '../../components/ui'

const PURPOSES = ['ใช้ในไลน์คัดแยก', 'ทำความสะอาดพื้นที่', 'งานสำนักงาน', 'เปลี่ยนของชำรุด']

export default function Cart() {
  const cart = useCart()
  const nav = useNavigate()

  return (
    <>
      <TopBar
        title="ตะกร้าเบิก"
        back="/"
        right={
          cart.count > 0 ? (
            <button
              type="button"
              className="min-h-tap px-2 text-sm underline"
              onClick={() => {
                if (confirm('ล้างตะกร้าทั้งหมด?')) cart.clear()
              }}
            >
              ล้าง
            </button>
          ) : undefined
        }
      />
      <StaffPage>
        {cart.count === 0 ? (
          <EmptyState
            title="ตะกร้ายังว่าง"
            hint="สแกน QR ที่ชั้นวาง หรือเลือกจากรายการวัสดุ"
            action={
              <div className="mt-2 flex gap-2">
                <Link to="/scan" className="btn-primary">
                  สแกน QR
                </Link>
                <Link to="/items" className="btn-ghost">
                  เลือกจากรายการ
                </Link>
              </div>
            }
          />
        ) : (
          <>
            <ul className="space-y-2">
              {cart.lines.map((l) => (
                <li key={l.item_id} className="card p-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-base">{l.name}</p>
                      <p className="truncate font-mono text-xs text-ink-400">
                        {l.sku} · ชั้น {l.shelf_code ?? '—'} · คงเหลือ {l.qty_on_hand} {l.unit}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`ลบ ${l.name}`}
                      className="h-tap w-tap shrink-0 text-ink-400"
                      onClick={() => cart.remove(l.item_id)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm text-ink-500">จำนวน ({l.unit})</span>
                    <QtyStepper value={l.qty} max={l.qty_on_hand} onChange={(n) => cart.setQty(l.item_id, n)} />
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link to="/scan" className="btn-ghost">
                สแกนเพิ่ม
              </Link>
              <Link to="/items" className="btn-ghost">
                เลือกเพิ่ม
              </Link>
            </div>

            <div className="card mt-3 p-4">
              <span className="label">วัตถุประสงค์ — ใช้ร่วมทั้งคำขอ</span>
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

              <label className="label mt-4" htmlFor="cnote">
                หมายเหตุถึงแอดมิน
              </label>
              <textarea
                id="cnote"
                rows={2}
                className="input py-2"
                placeholder="ไม่บังคับ"
                value={cart.note}
                onChange={(e) => cart.setNote(e.target.value)}
              />
            </div>

            {cart.lines.some((l) => l.requires_approval) && (
              <p className="mt-3 rounded-card border border-warn/30 bg-warn-bg px-3 py-2 text-sm text-warn-txt">
                คำขอนี้มีของที่ <b>ต้องขออนุมัติ</b> —{' '}
                {cart.lines
                  .filter((l) => l.requires_approval)
                  .map((l) => l.name)
                  .join(', ')}
                <br />
                ทั้งคำขอจะเข้าคิวรออนุมัติ และยังไม่ตัดสต็อกจนกว่าแอดมินจะกด
              </p>
            )}

            <p className="mt-3 rounded-card bg-brand-50 px-3 py-2 text-sm text-warn-txt">
              ถ่ายรูปหลักฐาน 1 รูป ครอบทุกรายการในคำขอนี้ ไม่ต้องถ่ายแยกทีละชิ้น
            </p>

            <div className="card mt-3 flex items-center justify-between p-4">
              <span className="text-base text-ink-700">รวมทั้งหมด</span>
              <span className="font-display text-lg">
                {cart.count} รายการ · {cart.units} ชิ้น
              </span>
            </div>

            <div className="safe-b fixed inset-x-0 bottom-[68px] z-20 px-3">
              <button
                type="button"
                className="btn-primary mx-auto flex w-full max-w-phone shadow-float"
                onClick={() => nav('/evidence')}
              >
                ถ่ายรูปหลักฐาน
              </button>
            </div>
          </>
        )}
      </StaffPage>
    </>
  )
}
