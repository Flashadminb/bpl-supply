import { useEffect, useRef, useState } from 'react'

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

export type Stage = 'm20' | 'm10' | 'late'

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

let ctx: AudioContext | null = null

export function audioOn(): boolean {
  return !!ctx && ctx.state === 'running'
}

/**
 * ปลดล็อกเสียง
 *
 * เบราว์เซอร์ห้ามเล่นเสียงจนกว่าคนจะแตะหน้าจอนั้นสักครั้ง
 * จอทีวีที่แขวนไว้เฉย ๆ จึงเงียบตลอดกาลถ้าไม่มีใครกด
 * นี่คือเหตุผลเดียวที่หน้านี้ต้องมีกล่องถามตอนเข้า ไม่ใช่เพราะอยากถาม
 */
export async function unlockAudio(): Promise<boolean> {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = ctx ?? new Ctor()
    await ctx.resume()
    return ctx.state === 'running'
  } catch {
    return false
  }
}

function beep(at: number, freq: number, dur: number, vol: number, type: OscillatorType) {
  if (!ctx) return
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, at)
  // ไต่ขึ้นลงสั้น ๆ กันเสียงแตกตอนตัดดิบ ๆ
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(vol, at + 0.006)
  g.gain.setValueAtTime(vol, at + Math.max(0.01, dur - 0.02))
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  o.connect(g)
  g.connect(ctx.destination)
  o.start(at)
  o.stop(at + dur + 0.03)
}

/**
 * เสียงนาฬิกาปลุกแบบสองลูก
 *
 * นาฬิกาปลุกจริงคือค้อนเคาะกระดิ่งสองใบสลับกันเร็ว ๆ
 * จึงทำเป็นสองความถี่สลับกันทุกห้าสิบมิลลิวินาที แล้วพักเป็นช่วง ๆ
 * เสียงบี๊บยาวตัวเดียวดังเท่ากันแต่ไม่มีใครรู้สึกว่าต้องรีบ
 */
function alarmClock(t0: number) {
  const ON = 0.055
  const GAP = 0.045
  let t = t0
  for (let burst = 0; burst < 3; burst++) {
    for (let i = 0; i < 11; i++) {
      beep(t, i % 2 === 0 ? 1180 : 860, ON, 0.3, 'square')
      t += ON + GAP
    }
    t += 0.22
  }
}

export function playAlarm(stage: Stage) {
  if (!ctx || ctx.state !== 'running') return
  const t = ctx.currentTime + 0.02
  if (stage === 'm20') {
    // นุ่มและต่ำ · บอกให้รู้ ไม่ได้บอกให้วิ่ง
    beep(t, 620, 0.16, 0.22, 'triangle')
    beep(t + 0.26, 620, 0.16, 0.22, 'triangle')
  } else if (stage === 'm10') {
    // แหลมและถี่ขึ้น · คนละเสียงกับอันบนชัดเจนแม้ฟังจากไกล
    for (let i = 0; i < 4; i++) beep(t + i * 0.15, 1040, 0.085, 0.26, 'square')
  } else {
    alarmClock(t)
  }
}

/** ให้คนกดฟังตอนตั้งค่า จะได้รู้ว่าเสียงไหนคืออะไร */
export function previewAll() {
  if (!ctx || ctx.state !== 'running') return
  const t = ctx.currentTime + 0.02
  beep(t, 620, 0.16, 0.22, 'triangle')
  beep(t + 0.26, 620, 0.16, 0.22, 'triangle')
  for (let i = 0; i < 4; i++) beep(t + 0.9 + i * 0.15, 1040, 0.085, 0.26, 'square')
  alarmClock(t + 1.9)
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
export function useTruckAlarm(items: { id: number; sec: number }[], enabled: boolean) {
  const seen = useRef(new Map<number, Stage | null>())
  const seeded = useRef(false)

  useEffect(() => {
    const next = new Map<number, Stage | null>()
    let fire: Stage | null = null
    for (const it of items) {
      const st = stageOf(it.sec)
      next.set(it.id, st)
      const prev = seen.current.get(it.id)
      if (seeded.current && st && st !== prev && (!fire || RANK[st] > RANK[fire])) fire = st
    }
    seen.current = next
    if (!seeded.current) {
      seeded.current = true
      return
    }
    if (fire && enabled) playAlarm(fire)
  }, [items, enabled])
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
export function useAlarmPref() {
  const [on, setOn] = useState(() => audioOn())
  const [asked, setAsked] = useState(() => localStorage.getItem(PREF) !== null)

  useEffect(() => {
    if (localStorage.getItem(PREF) !== 'on' || audioOn()) return
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
  }, [])

  async function turnOn() {
    const ok = await unlockAudio()
    setOn(ok)
    setAsked(true)
    localStorage.setItem(PREF, ok ? 'on' : 'off')
    return ok
  }
  function decline() {
    setAsked(true)
    localStorage.setItem(PREF, 'off')
  }
  return { on, asked, turnOn, decline }
}
