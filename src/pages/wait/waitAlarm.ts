import { audioCtx, type Stage } from '../trucks/alarm'

/**
 * เสียงเตือนของรถรอลงงาน — ต้องไม่เหมือนเสียงปล่อยรถ
 *
 * สองกระดานนี้อยู่ในคลังเดียวกันและดังพร้อมกันได้ คนละทีมกันด้วย
 * ถ้าเสียงคล้ายกัน ทีมลงงานจะวิ่งเพราะเสียงของทีมปล่อยรถ และกลับกัน
 * พอโดนหลอกสองสามครั้ง ทั้งคลังจะเลิกสนใจเสียงทั้งสองชุด
 *
 * วิธีแยกที่ได้ผลจริงคือแยกด้วย "ตระกูลเสียง" ไม่ใช่แค่เปลี่ยนความถี่
 *   ปล่อยรถ    เสียงเคาะ · โน้ตสูงสั้นตัดเป็นห้วง ๆ แบบกระดิ่ง
 *   รถรอลงงาน  เสียงกวาด · โน้ตไถลขึ้นลงต่อเนื่องแบบไซเรน
 *
 * หูแยกเสียงกระดิ่งสูงออกจากเสียงแตรต่ำได้ทันที โดยไม่ต้องจำว่าเสียงไหนของใคร
 * ต่อให้อยู่คนละมุมคลังและมีเสียงสายพานกลบ
 *
 * ใช้ AudioContext ตัวเดียวกับของปล่อยรถ ผ่าน audioCtx()
 * ไม่ได้สร้างใหม่ เพราะแต่ละตัวต้องถูกปลดล็อกแยกกัน
 * ซึ่งแปลว่าคนต้องกดเปิดเสียงสองครั้งโดยไม่รู้ว่าทำไม
 */

/**
 * แตรหนึ่งครั้ง
 *
 * ซ้อนสามเสียงที่สัมพันธ์กันทางดนตรี — เสียงหลัก เสียงคู่ห้า และเสียงต่ำหนึ่งช่วงคู่แปด
 * ซึ่งเป็นโครงเดียวกับแตรลมของรถใหญ่กับเรือ หูจึงได้ยินเป็น "แตร" ไม่ใช่ "บี๊บ"
 *
 * ใช้คลื่นไซน์ล้วน ไม่ใช่ฟันเลื่อยหรือสี่เหลี่ยม เพราะสองอย่างนั้นมีฮาร์โมนิกสูงเยอะ
 * ซึ่งเป็นต้นเหตุที่ทำให้เสียงฟังเป็นการ์ตูน
 *
 * ขึ้นและลงช้ากว่าเสียงบี๊บ ทำให้ฟังเป็นเสียงหนัก ๆ ไม่ใช่เสียงจิ้ม
 */
function horn(ctx: AudioContext, at: number, freq: number, dur: number, vol: number) {
  const parts: [number, number][] = [
    [freq, 1],
    [freq * 1.5, 0.45],
    [freq * 0.5, 0.35],
  ]
  for (const [f, w] of parts) {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(f, at)

    const peak = vol * w
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(peak, at + 0.05)
    g.gain.setValueAtTime(peak, at + Math.max(0.08, dur - 0.12))
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)

    o.connect(g)
    g.connect(ctx.destination)
    o.start(at)
    o.stop(at + dur + 0.05)
  }
}

export function playWaitAlarm(stage: Stage) {
  const ctx = audioCtx()
  if (!ctx) return
  const t = ctx.currentTime + 0.02

  if (stage === 'm20') {
    // แตรเดียวต่ำ ๆ ยาว · บอกให้รู้ ไม่ได้บอกให้วิ่ง
    horn(ctx, t, 196, 0.62, 0.26)
  } else if (stage === 'm10') {
    // สองครั้ง สูงขึ้นมาหน่อย · เริ่มต้องขยับแล้ว
    horn(ctx, t, 247, 0.34, 0.28)
    horn(ctx, t + 0.46, 247, 0.34, 0.28)
  } else {
    // สามครั้งติด ๆ แล้วลงท้ายด้วยเสียงต่ำยาว · เลยเวลาแล้ว
    horn(ctx, t, 294, 0.3, 0.3)
    horn(ctx, t + 0.4, 294, 0.3, 0.3)
    horn(ctx, t + 0.8, 294, 0.3, 0.3)
    horn(ctx, t + 1.3, 165, 0.9, 0.3)
  }
}

/** ให้คนกดฟังตอนตั้งค่า จะได้รู้ว่าเสียงไหนคืออะไร และต่างจากปล่อยรถยังไง */
export function previewWaitAll() {
  const ctx = audioCtx()
  if (!ctx) return
  const t = ctx.currentTime + 0.02
  horn(ctx, t, 196, 0.62, 0.26)
  horn(ctx, t + 1.3, 247, 0.34, 0.28)
  horn(ctx, t + 1.76, 247, 0.34, 0.28)
  horn(ctx, t + 2.7, 294, 0.3, 0.3)
  horn(ctx, t + 3.1, 294, 0.3, 0.3)
  horn(ctx, t + 3.5, 294, 0.3, 0.3)
  horn(ctx, t + 4.0, 165, 0.9, 0.3)
}

/** คีย์เก็บคำตอบเรื่องเสียงของกระดานนี้ · แยกจากของปล่อยรถ จะได้ปิดทีละกระดานได้ */
export const WAIT_ALARM_PREF = 'wait.alarm'
