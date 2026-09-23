/**
 * เสียงเตือนตอนเปิดแอพค้างไว้
 *
 * สังเคราะห์เสียงเองด้วย Web Audio ไม่ได้โหลดไฟล์ mp3
 * เพราะไฟล์เสียงต้องดาวน์โหลดก่อนถึงจะดังได้ ซึ่งเน็ตในฮับไม่นิ่ง
 * พอถึงจังหวะที่ต้องเตือนจริงอาจยังโหลดไม่เสร็จ เสียงสังเคราะห์ดังทันทีเสมอ
 *
 * แต่ละเรื่องใช้ทำนองต่างกันชัดเจน ให้แยกออกโดยไม่ต้องมองจอ
 *   approve  สองโน้ตไล่ขึ้น เสียงนุ่ม        — มีคนขออนุมัติ ไม่ใช่เรื่องด่วน
 *   fault    สามโน้ตไล่ลง เสียงห้วน         — เครื่องเสียหรือหาย เรื่องไม่ดี
 *   overdue  สามจังหวะรัว เสียงแหลม ย้ำสอง  — ของยังไม่คืน ต้องรีบตาม
 *
 * เบราว์เซอร์ห้ามเล่นเสียงก่อนผู้ใช้แตะจอ จึงต้องปลุก AudioContext
 * ตอนคลิกครั้งแรก ทำให้อัตโนมัติอยู่ข้างล่างนี้แล้ว ไม่ต้องเรียกเอง
 */

export type AlertSound = 'approve' | 'fault' | 'overdue'

interface Tone {
  /** ความถี่เป็นเฮิรตซ์ */
  hz: number
  /** เริ่มดังที่วินาทีเท่าไหร่นับจากเริ่มเล่น */
  at: number
  /** ดังนานกี่วินาที */
  dur: number
  type: OscillatorType
  /** ความดัง 0–1 */
  vol: number
}

const PATTERNS: Record<AlertSound, Tone[]> = {
  // โด-มี ไล่ขึ้น นุ่ม ๆ ไม่ตกใจ
  approve: [
    { hz: 659, at: 0, dur: 0.16, type: 'sine', vol: 0.5 },
    { hz: 988, at: 0.15, dur: 0.26, type: 'sine', vol: 0.45 },
  ],
  // ไล่ลงสามขั้น เสียงมีเหลี่ยม ฟังแล้วรู้ว่าเรื่องไม่ดี
  fault: [
    { hz: 587, at: 0, dur: 0.15, type: 'triangle', vol: 0.55 },
    { hz: 466, at: 0.16, dur: 0.15, type: 'triangle', vol: 0.55 },
    { hz: 349, at: 0.32, dur: 0.34, type: 'triangle', vol: 0.5 },
  ],
  // รัวสามที เว้นวรรค แล้วรัวซ้ำอีกชุด เร่งเร้าที่สุดในสามแบบ
  overdue: [
    { hz: 988, at: 0, dur: 0.09, type: 'square', vol: 0.32 },
    { hz: 988, at: 0.14, dur: 0.09, type: 'square', vol: 0.32 },
    { hz: 988, at: 0.28, dur: 0.09, type: 'square', vol: 0.32 },
    { hz: 1175, at: 0.52, dur: 0.09, type: 'square', vol: 0.34 },
    { hz: 1175, at: 0.66, dur: 0.09, type: 'square', vol: 0.34 },
    { hz: 1175, at: 0.8, dur: 0.2, type: 'square', vol: 0.34 },
  ],
}

export const SOUND_TH: Record<AlertSound, string> = {
  approve: 'ขออนุมัติ',
  fault: 'เครื่องเสีย / หาย',
  overdue: 'ยังไม่คืน',
}

/* ------------------------------------------------------------ เปิด/ปิดเสียง */

const KEY = 'bpl.alertSound'

/** ค่าเริ่มต้นคือเปิด — คนที่ไม่อยากได้ยินกดปิดเองได้ที่กระดิ่ง */
export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    /* โหมดส่วนตัวเขียนไม่ได้ ก็ปล่อยไป เสียงยังทำงานปกติในรอบนี้ */
  }
}

/* ------------------------------------------------------------- ตัวเล่นเสียง */

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx) return ctx
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    return null
  }
  return ctx
}

/**
 * ปลุกเสียงตอนผู้ใช้แตะจอครั้งแรก
 *
 * เบราว์เซอร์สร้าง AudioContext มาในสถานะ suspended จนกว่าจะมี user gesture
 * ถ้าไม่ปลุกไว้ก่อน พอถึงเวลาเตือนจริงจะเงียบสนิทโดยไม่มี error อะไรเลย
 */
if (typeof window !== 'undefined') {
  const wake = () => {
    const a = audio()
    if (a && a.state === 'suspended') void a.resume()
  }
  window.addEventListener('pointerdown', wake, { once: true, passive: true })
  window.addEventListener('keydown', wake, { once: true })
}

/** เล่นเสียงหนึ่งแบบ — เงียบเองถ้าผู้ใช้ปิดเสียงไว้หรือเบราว์เซอร์ไม่รองรับ */
export function playAlert(kind: AlertSound, force = false) {
  if (!force && !soundOn()) return
  const a = audio()
  if (!a) return
  if (a.state === 'suspended') void a.resume()

  const t0 = a.currentTime + 0.02
  for (const tone of PATTERNS[kind]) {
    const osc = a.createOscillator()
    const gain = a.createGain()
    osc.type = tone.type
    osc.frequency.value = tone.hz

    // ไต่ขึ้นลงแทนการเปิดปิดห้วน ๆ ไม่งั้นจะได้ยินเสียง "แปะ" ตอนหัวท้าย
    const start = t0 + tone.at
    const end = start + tone.dur
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(tone.vol, start + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)

    osc.connect(gain).connect(a.destination)
    osc.start(start)
    osc.stop(end + 0.02)
  }
}
