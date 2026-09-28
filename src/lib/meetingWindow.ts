/**
 * อธิบายกรอบเวลาเช็คชื่อเป็นภาษาคน
 *
 * เคยคำนวณผิดมาแล้วด้วยการเอาชั่วโมงกับนาทีมาลบแยกกัน
 * 14:00 ลบ 15 นาที ได้ออกมาเป็น 14:45 เพราะนาทีติดลบแล้วไม่ได้ลดชั่วโมง
 * ตอนนี้ใช้ Date คำนวณให้ทั้งก้อน วันข้ามคืนก็ถูกต้องเอง
 */

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

export interface WindowText {
  from: string
  to: string
  line: string
}

/** คำอธิบายกรอบเวลาของนัดหนึ่ง ๆ · meetAt เป็นเวลาท้องถิ่น */
export function describeWindow(meetAt: Date, openBefore: number, lateAfter: number): WindowText {
  const from = new Date(meetAt.getTime() - openBefore * 60000)
  const to = new Date(meetAt.getTime() + lateAfter * 60000)
  const at = hhmm(meetAt)

  // สองค่านี้เป็นศูนย์พร้อมกัน = ต้องกดตรงวินาทีนั้นพอดี ซึ่งทำจริงแทบไม่ได้
  if (openBefore === 0 && lateAfter === 0) {
    return { from: at, to: at, line: `ต้องเช็คตอน ${at} พอดีเท่านั้น — แคบมาก แนะนำให้เผื่อสักนาที` }
  }
  if (openBefore === 0) {
    return {
      from: at,
      to: hhmm(to),
      line: `เริ่มเช็คได้ตอน ${at} ตรง (กดก่อนไม่ได้) ถึง ${hhmm(to)} หลังจากนั้นบันทึกว่าสาย`,
    }
  }
  if (lateAfter === 0) {
    return {
      from: hhmm(from),
      to: at,
      line: `เช็คได้ตั้งแต่ ${hhmm(from)} ถึง ${at} พอดี เลยจากนั้นถือว่าสายทันที`,
    }
  }
  return {
    from: hhmm(from),
    to: hhmm(to),
    line: `เช็คได้ตั้งแต่ ${hhmm(from)} ถึง ${hhmm(to)} หลังจากนั้นยังเช็คได้แต่บันทึกว่าสาย`,
  }
}
