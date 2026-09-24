/**
 * เลือกเวลาแบบ 24 ชั่วโมง
 *
 * ของเดิมใช้ <input type="time"> ซึ่งเบราว์เซอร์เป็นคนเลือกรูปแบบให้เอง
 * บนเครื่องที่ตั้งภาษาไทยมันขึ้นเป็น AM/PM — เที่ยงคืนกลายเป็น "12:00 AM"
 * ซึ่งอ่านแล้วนึกว่าเที่ยงวัน และหา "00:00" ไม่เจอเลยทั้งที่มันคือตัวเดียวกัน
 *
 * กะทำงานลงตัวทุกครึ่งชั่วโมงอยู่แล้ว (03:00–12:00, 18:00–03:00)
 * จึงใช้ดรอปดาวน์ 48 ช่องแทน เห็น 00:00 อยู่บนสุดชัดเจน ไม่มี AM/PM ให้สับสน
 * และกดบนมือถือง่ายกว่าตัวเลื่อนเวลาของเบราว์เซอร์มาก
 *
 * ค่าที่เก็บยังเป็น "HH:MM" เหมือนเดิมทุกประการ ฐานข้อมูลไม่ต้องแก้อะไร
 */

/** ทุกครึ่งชั่วโมงตั้งแต่ 00:00 ถึง 23:30 */
const SLOTS: string[] = []
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '30']) SLOTS.push(`${String(h).padStart(2, '0')}:${m}`)
}

export function TimeSelect({
  value,
  onChange,
  disabled,
  ariaLabel,
  className = '',
}: {
  /** "HH:MM" หรือ "HH:MM:SS" · ว่าง = ยังไม่ได้ตั้ง */
  value: string | null | undefined
  onChange: (next: string | null) => void
  disabled?: boolean
  ariaLabel: string
  className?: string
}) {
  const cur = value ? value.slice(0, 5) : ''
  // เวลาที่ตั้งมาแต่เดิมอาจไม่ลงครึ่งชั่วโมง เช่น 08:45 — ต้องไม่ทำให้มันหาย
  const options = cur && !SLOTS.includes(cur) ? [cur, ...SLOTS] : SLOTS

  return (
    <select
      className={`input ${className}`}
      aria-label={ariaLabel}
      value={cur}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">— ไม่ระบุ —</option>
      {options.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  )
}
