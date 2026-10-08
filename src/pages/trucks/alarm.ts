import { useEffect, useRef, useState } from 'react'
import { audioOn, unlockAudio } from '../../lib/alarmKit'
import { truckKit } from './truckAlarm'
import type { Stage } from '../../lib/alarmKit'
export type { Stage }

/**
 * เสียงเตือนรถ — สังเคราะห์ในเครื่อง ไม่มีไฟล์เสียงสักไฟล์
 *
 * ถ้าใช้ไฟล์ mp3 จะต้องโหลดข้ามเน็ตและกินทั้งโควตา bandwidth และพื้นที่
 * ทั้งที่สิ่งที่ต้องการคือเสียงบี๊บไม่กี่ตัว ซึ่งเบราว์เซอร์สร้างเองได้อยู่แล้ว
 * วิธีนี้จึงไม่กินโควตาฟรีเลยแม้แต่ไบต์เดียว และไม่มีอะไรให้โหลดไม่สำเร็จ
 *
 * สามเสียงต้องแยกออกจากกันให้ได้ด้วยหูอย่างเดียว โดยไม่ต้องมองจอ
 *   20 นาที  เสียงนุ่ม ต่ำ สองที         = ได้ยินแล้วรู้ว่าเริ่มนับถอยหลังจริงจังแล้ว
 *   10 นาที  เสียงแหลม ถี่ สี่ที          = ต้องขยับแล้ว
 *   เลยเวลา  นาฬิกาปลุกสองลูกสลับกันรัว  = ผิดแล้ว ไปจัดการเดี๋ยวนี้
 */

/** เหลือกี่วินาทีแล้วอยู่ขั้นไหน · null = ยังไม่ต้องเตือน */
export function stageOf(sec: number): Stage | null {
  if (sec <= 0) return 'late'
  if (sec <= 10 * 60) return 'm10'
  if (sec <= 20 * 60) return 'm20'
  return null
}

export const STAGE_TH: Record<Stage, string> = {
  m20: 'อีก 20 นาที',
  m10: 'อีก 10 นาที',
  late: 'เลยกำหนดแล้ว',
}

export const STAGE_PUSH: Record<Stage, string> = {
  m20: 'เร่งได้แล้ว',
  m10: 'เร่งด่วน',
  late: 'ต้องออกเดี๋ยวนี้',
}

export const STAGE_COLOR: Record<Stage, string> = {
  m20: '#FFC400',
  m10: '#FF8A3D',
  late: '#FF5C5C',
}

const RANK: Record<Stage, number> = { m20: 1, m10: 2, late: 3 }

/* --------------------------------------------------------------- เสียง */

/**
 * เครื่องเสียงย้ายไปอยู่ที่ lib/alarmKit แล้ว ใช้ร่วมกับกระดานรถรอลงงาน
 *
 * เหตุผลคือทั้งแอพต้องมี AudioContext ตัวเดียว · สร้างคนละตัวแปลว่า
 * คนต้องกดเปิดเสียงสองครั้งโดยไม่รู้ว่าทำไม
 *
 * ส่วนรายการชุดเสียงของกระดานนี้อยู่ที่ truckAlarm.ts
 * เพราะประโยคที่พูดต้องเป็นเรื่องปล่อยรถ ไม่ใช่เรื่องลงงาน
 */
export { audioOn, audioCtx, unlockAudio } from '../../lib/alarmKit'

/** เล่นเสียงตามชุดที่ตั้งไว้ของกระดานปล่อยรถ */
export function playAlarm(stage: Stage) {
  truckKit.play(stage)
}

/** ให้คนกดฟังตอนตั้งค่า · ฟังทั้งสามขั้นของชุดที่เลือกอยู่ */
export function previewAll() {
  truckKit.previewAll()
}

/* ---------------------------------------------------------------- ฮุก */

const PREF = 'truck.alarm'

/**
 * เฝ้าดูว่ามีคันไหนเพิ่งข้ามเส้น แล้วค่อยส่งเสียง
 *
 * ยิงเฉพาะตอน "เปลี่ยนขั้น" ไม่ใช่ตอน "อยู่ในขั้น"
 * ไม่งั้นเปิดหน้ามาตอนมีรถใกล้ครบกำหนดสิบคัน จะโดนรัวสิบเสียงรวดเดียว
 * รอบแรกหลังเปิดหน้าจึงแค่จำสถานะไว้เงียบ ๆ เสียงเริ่มจากการเปลี่ยนแปลงจริงรอบถัดไป
 *
 * รอบเดียวกันมีหลายคันข้ามเส้นพร้อมกัน ให้เล่นเสียงของขั้นที่หนักที่สุดเสียงเดียว
 * เสียงซ้อนกันสามเสียงฟังไม่ออกว่าเสียงอะไร และกลายเป็นเสียงรบกวนทันที
 */
export function useTruckAlarm(
  items: { id: number; sec: number }[],
  enabled: boolean,
  /**
   * ชุดเสียงที่จะเล่น · ค่าเริ่มต้นคือเสียงของตารางปล่อยรถ
   *
   * รถรอลงงานส่งชุดของตัวเองเข้ามา เพราะสองกระดานดังพร้อมกันได้ในคลังเดียวกัน
   * แยกตรรกะไปเขียนใหม่ไม่ได้ กติกา "เพิ่งเห็นครั้งแรกไม่ส่งเสียง" ละเอียดเกินกว่าจะมีสองชุด
   */
  play: (s: Stage) => void = playAlarm,
): { ids: number[]; at: number } {
  const seen = useRef(new Map<number, Stage | null>())
  const seeded = useRef(false)
  /**
   * คันที่เพิ่งข้ามเส้นรอบล่าสุด · ส่งคืนให้หน้าจอเอาไปขึ้นกระดิ่งกระพริบ
   *
   * เสียงบอกว่า "มีอะไรเกิดขึ้น" แต่ไม่ได้บอกว่าคันไหน
   * บนกระดานที่มีสิบคัน คนได้ยินเสียงแล้วต้องกวาดตาหาเองว่าคันไหนเพิ่งเปลี่ยน
   * ซึ่งเสียเวลาและหาผิดได้ ถ้ามีคันอื่นสีเดียวกันอยู่ก่อนแล้ว
   *
   * เก็บไว้แม้ตอนปิดเสียง เพราะจอที่ปิดเสียงยิ่งต้องการเครื่องหมายบนจอ
   */
  const [fired, setFired] = useState<{ ids: number[]; at: number }>({ ids: [], at: 0 })

  useEffect(() => {
    const next = new Map<number, Stage | null>()
    const hit: number[] = []
    let fire: Stage | null = null
    for (const it of items) {
      const st = stageOf(it.sec)
      next.set(it.id, st)
      const prev = seen.current.get(it.id)
      // prev เป็น undefined แปลว่าเพิ่งเห็นคันนี้ครั้งแรก ไม่ใช่คันที่เพิ่งข้ามเส้นต่อหน้า
      // กรอกรถย้อนหลังที่เลยกำหนดไปแล้ว จึงไม่ปลุกนาฬิกาใส่หน้าคนกรอก
      // เขารู้อยู่แล้วว่ามันเลย เพราะเขาเป็นคนพิมพ์เวลานั้นเอง
      if (seeded.current && st && prev !== undefined && st !== prev) {
        hit.push(it.id)
        if (!fire || RANK[st] > RANK[fire]) fire = st
      }
    }
    seen.current = next
    if (!seeded.current) {
      seeded.current = true
      return
    }
    // ตั้งค่าเฉพาะตอนมีของจริง · items เปลี่ยนตัวตนทุกวินาทีอยู่แล้ว
    // ถ้าเซ็ตทุกรอบจะได้การวาดจอเพิ่มมาวินาทีละครั้งโดยไม่ได้อะไรเลย
    if (hit.length) setFired({ ids: hit, at: Date.now() })
    if (fire && enabled) play(fire)
  }, [items, enabled])

  return fired
}

/**
 * จำคำตอบไว้ ถามครั้งเดียวจบ
 *
 * เบราว์เซอร์ยังบังคับให้มีคนแตะจอหนึ่งครั้งต่อการโหลดหน้าหนึ่งครั้งอยู่ดี
 * แต่ไม่ได้แปลว่าต้องเอากล่องเต็มจอมาขวางทุกครั้ง
 *
 * ตอบไปแล้วครั้งหนึ่ง กล่องจะไม่ขึ้นอีกเลย
 * ถ้าตอบว่าเปิด ระบบจะลองเปิดเสียงเองก่อน ไม่สำเร็จก็รอให้แตะอะไรก็ได้บนหน้านั้น
 * แตะปุ่มไหนก็ได้ เลื่อนจอก็ได้ เสียงจะกลับมาเองโดยไม่ต้องกดอะไรเพิ่ม
 */
export function useAlarmPref(prefKey: string = PREF) {
  const [on, setOn] = useState(() => audioOn())
  const [asked, setAsked] = useState(() => localStorage.getItem(prefKey) !== null)

  useEffect(() => {
    if (localStorage.getItem(prefKey) !== 'on' || audioOn()) return
    let dead = false
    const wake = () => {
      void unlockAudio().then((ok) => {
        if (!dead && ok) setOn(true)
      })
    }
    wake()
    const evs: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'touchstart']
    evs.forEach((e) => document.addEventListener(e, wake, { once: true, passive: true }))
    return () => {
      dead = true
      evs.forEach((e) => document.removeEventListener(e, wake))
    }
  }, [prefKey])

  async function turnOn() {
    const ok = await unlockAudio()
    setOn(ok)
    setAsked(true)
    localStorage.setItem(prefKey, ok ? 'on' : 'off')
    return ok
  }
  function decline() {
    setAsked(true)
    localStorage.setItem(prefKey, 'off')
  }
  return { on, asked, turnOn, decline }
}
