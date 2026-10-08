import { audioCtx, type Stage } from '../trucks/alarm'

/**
 * เสียงเตือนของรถรอลงงาน — ต้องไม่เหมือนเสียงปล่อยรถ
 *
 * สองกระดานนี้อยู่ในคลังเดียวกันและดังพร้อมกันได้ คนละทีมกันด้วย
 * ถ้าเสียงคล้ายกัน ทีมลงงานจะวิ่งเพราะเสียงของทีมปล่อยรถ และกลับกัน
 * พอโดนหลอกสองสามครั้ง ทั้งคลังจะเลิกสนใจเสียงทั้งสองชุด
 *
 * วิธีแยกที่ได้ผลจริงคือแยกด้วย "ตระกูลเสียง" ไม่ใช่แค่เปลี่ยนความถี่
 *   ปล่อยรถ    เสียงเคาะ · โน้ตนิ่ง ๆ ตัดเป็นห้วง ๆ แบบกระดิ่ง
 *   รถรอลงงาน  เสียงกวาด · โน้ตไถลขึ้นลงต่อเนื่องแบบไซเรน
 *
 * หูแยกเสียงเคาะออกจากเสียงกวาดได้ทันทีโดยไม่ต้องจำว่าเสียงไหนของใคร
 * ต่อให้อยู่คนละมุมคลังและมีเสียงสายพานกลบ
 *
 * ใช้ AudioContext ตัวเดียวกับของปล่อยรถ ผ่าน audioCtx()
 * ไม่ได้สร้างใหม่ เพราะแต่ละตัวต้องถูกปลดล็อกแยกกัน
 * ซึ่งแปลว่าคนต้องกดเปิดเสียงสองครั้งโดยไม่รู้ว่าทำไม
 */

/**
 * โน้ตหนึ่งตัวที่ไถลจากความถี่หนึ่งไปอีกความถี่
 *
 * การไถลคือสิ่งที่ทำให้ชุดนี้ต่างจากของปล่อยรถทั้งหมด
 * เสียงที่ความถี่ขยับตลอดจะถูกหูจับได้ว่า "ไม่ใช่เสียงเดิม" ก่อนที่สมองจะทันแปลด้วยซ้ำ
 */
function sweep(
  ctx: AudioContext,
  at: number,
  from: number,
  to: number,
  dur: number,
  vol: number,
  type: OscillatorType = 'sawtooth',
) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(from, at)
  o.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + dur)

  // ไต่ขึ้นลงสั้น ๆ กันเสียงแตกตอนตัดดิบ ๆ เหมือนชุดของปล่อยรถ
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(vol, at + 0.02)
  g.gain.setValueAtTime(vol, at + Math.max(0.03, dur - 0.05))
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)

  o.connect(g)
  g.connect(ctx.destination)
  o.start(at)
  o.stop(at + dur + 0.05)
}

/**
 * ไซเรนสองจังหวะแบบรถฉุกเฉิน · ใช้กับคันที่เลยเวลาแล้ว
 *
 * กวาดขึ้นแล้วกวาดลงสลับกันสามรอบ ไม่ใช่รัวเป็นห้วงแบบนาฬิกาปลุกของปล่อยรถ
 * ยาวกว่าของปล่อยรถเล็กน้อยโดยตั้งใจ เพราะงานลงของอยู่ลึกเข้าไปในคลัง
 * เสียงสั้นเกินจะโดนเสียงสายพานกินหมดก่อนถึงคนที่ต้องได้ยิน
 */
function siren(ctx: AudioContext, t0: number) {
  let t = t0
  for (let i = 0; i < 3; i++) {
    sweep(ctx, t, 420, 900, 0.34, 0.3)
    t += 0.34
    sweep(ctx, t, 900, 420, 0.34, 0.3)
    t += 0.34 + 0.1
  }
}

export function playWaitAlarm(stage: Stage) {
  const ctx = audioCtx()
  if (!ctx) return
  const t = ctx.currentTime + 0.02

  if (stage === 'm20') {
    // ไถลลงยาวหนึ่งที · บอกให้รู้ ไม่ได้บอกให้วิ่ง
    // ของปล่อยรถตรงขั้นนี้เป็นเสียงนุ่มเคาะสองที จึงคนละทิศกันชัดเจน
    sweep(ctx, t, 700, 380, 0.5, 0.24, 'triangle')
  } else if (stage === 'm10') {
    // ไถลขึ้นสามที ถี่ขึ้นเรื่อย ๆ · ทิศขึ้นแปลว่ากำลังจะหมดเวลา
    sweep(ctx, t, 460, 820, 0.18, 0.26)
    sweep(ctx, t + 0.24, 520, 900, 0.18, 0.26)
    sweep(ctx, t + 0.44, 580, 1000, 0.2, 0.28)
  } else {
    siren(ctx, t)
  }
}

/** ให้คนกดฟังตอนตั้งค่า จะได้รู้ว่าเสียงไหนคืออะไร และต่างจากปล่อยรถยังไง */
export function previewWaitAll() {
  const ctx = audioCtx()
  if (!ctx) return
  const t = ctx.currentTime + 0.02
  sweep(ctx, t, 700, 380, 0.5, 0.24, 'triangle')
  sweep(ctx, t + 1.1, 460, 820, 0.18, 0.26)
  sweep(ctx, t + 1.34, 520, 900, 0.18, 0.26)
  sweep(ctx, t + 1.54, 580, 1000, 0.2, 0.28)
  siren(ctx, t + 2.5)
}

/** คีย์เก็บคำตอบเรื่องเสียงของกระดานนี้ · แยกจากของปล่อยรถ จะได้ปิดทีละกระดานได้ */
export const WAIT_ALARM_PREF = 'wait.alarm'
