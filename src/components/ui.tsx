import type { ReactNode } from 'react'

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="กำลังโหลด"
      className={`spin inline-block h-[18px] w-[18px] rounded-pill border-2 border-ink-300 border-t-ink ${className}`}
    />
  )
}

export function Loading({ label = 'กำลังโหลด…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-6 text-ink-400">
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-card border border-danger/25 bg-danger-bg p-4 text-danger-txt">
      <p className="text-base font-medium">เกิดข้อผิดพลาด</p>
      <p className="mt-1 break-words text-sm">{message}</p>
      {onRetry && (
        <button type="button" className="btn-ghost mt-3" onClick={onRetry}>
          ลองใหม่
        </button>
      )}
    </div>
  )
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line-2 bg-surface px-4 py-6 text-center">
      <p className="font-display text-md text-ink-700">{title}</p>
      {hint && <p className="text-sm text-ink-400">{hint}</p>}
      {action}
    </div>
  )
}

/** ตัวปรับจำนวน — ปุ่มไม่ต่ำกว่า 44px เพราะพนักงานใส่ถุงมือ */
export function QtyStepper({
  value,
  max,
  min = 0,
  onChange,
  size = 'md',
}: {
  value: number
  max: number
  min?: number
  onChange: (n: number) => void
  size?: 'sm' | 'md'
}) {
  const box = size === 'sm' ? 'h-tap w-tap' : 'h-tap w-[52px]'
  return (
    <div className="inline-flex items-center overflow-hidden rounded-btn border border-line-2 bg-surface">
      <button
        type="button"
        aria-label="ลดจำนวน"
        className={`${box} text-lg text-ink disabled:text-ink-300`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label="จำนวน"
        className="h-tap w-[56px] border-x border-line-2 bg-surface text-center font-display text-md text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, Math.trunc(n))))
        }}
      />
      <button
        type="button"
        aria-label="เพิ่มจำนวน"
        className={`${box} text-lg text-ink disabled:text-ink-300`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  )
}

export function StockBadge({ qty, min }: { qty: number; min: number }) {
  if (qty <= 0) return <span className="badge-dang">หมดสต็อก</span>
  if (qty <= min) return <span className="badge-warn">ใกล้หมด · เหลือ {qty}</span>
  return <span className="badge-ok">เหลือ {qty}</span>
}

export function Sheet({
  open,
  onClose,
  children,
  title,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="ปิด"
        className="absolute inset-0 bg-ink/45"
        onClick={onClose}
      />
      <div className="safe-b relative max-h-[86vh] w-full max-w-phone overflow-y-auto rounded-t-panel bg-surface p-4 shadow-pop">
        <div className="mx-auto mb-3 h-1 w-10 rounded-pill bg-line-2" />
        {title && <h2 className="mb-3 font-display text-lg">{title}</h2>}
        {children}
      </div>
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-[560px]',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  width?: string
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button type="button" aria-label="ปิด" className="absolute inset-0 bg-ink/45" onClick={onClose} />
      <div className={`relative w-full ${width} rounded-panel bg-surface p-5 shadow-pop`}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-display text-lg">{title}</h2>
          <button type="button" className="h-tap w-tap text-xl text-ink-400" onClick={onClose} aria-label="ปิด">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-tap items-center gap-3 text-base"
    >
      <span
        className={`relative h-[26px] w-[46px] rounded-pill transition-colors ${
          checked ? 'bg-brand-500' : 'bg-line-2'
        }`}
      >
        <span
          className={`absolute top-[3px] h-5 w-5 rounded-pill bg-white shadow-card transition-all ${
            checked ? 'left-[23px]' : 'left-[3px]'
          }`}
        />
      </span>
      <span className="text-ink-700">{label}</span>
    </button>
  )
}
