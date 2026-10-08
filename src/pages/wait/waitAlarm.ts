import { audioCtx, type Stage } from '../trucks/alarm'

/**
 * เสียงเตือนของรถรอลงงาน — เลือกชุดได้
 *
 * สองกระดานนี้อยู่ในคลังเดียวกันและดังพร้อมกันได้ คนละทีมกันด้วย
 * ถ้าเสียงคล้ายกัน ทีมลงงานจะวิ่งเพราะเสียงของทีมปล่อยรถ และกลับกัน
 * พอโดนหลอกสองสามครั้ง ทั้งคลังจะเลิกสนใจเสียงทั้งสองชุด
 *
 * ของปล่อยรถคือเสียงเคาะสูงสั้นแบบกระดิ่ง · ทุกชุดในไฟล์นี้จึงเลี่ยงย่านนั้น
 * แต่เสียงที่ "ตัดผ่านเสียงสายพานได้" กับเสียงที่ "ฟังแล้วไม่รำคาญทั้งกะ"
 * เป็นคนละเรื่องกัน และขึ้นกับคลังจริงที่ไม่มีทางรู้จากตรงนี้
 * จึงทำมาให้เลือกเอง แล้วให้คนที่ยืนอยู่ตรงนั้นตัดสิน
 *
 * ใช้ AudioContext ตัวเดียวกับของปล่อยรถ ผ่าน audioCtx()
 * ไม่ได้สร้างใหม่ เพราะแต่ละตัวต้องถูกปลดล็อกแยกกัน
 * ซึ่งแปลว่าคนต้องกดเปิดเสียงสองครั้งโดยไม่รู้ว่าทำไม
 */

/* ------------------------------------------------------- เครื่องมือพื้นฐาน */

function env(
  ctx: AudioContext,
  node: AudioNode,
  at: number,
  dur: number,
  vol: number,
  attack = 0.01,
) {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(vol, at + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  node.connect(g)
  g.connect(ctx.destination)
  return g
}

function osc(
  ctx: AudioContext,
  at: number,
  freq: number,
  dur: number,
  vol: number,
  type: OscillatorType = 'sine',
  attack = 0.01,
) {
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(freq, at)
  env(ctx, o, at, dur, vol, attack)
  o.start(at)
  o.stop(at + dur + 0.05)
}

/** เสียงดังสั้น ๆ แบบไม่มีระดับเสียงชัด · ใช้ทำเสียงเคาะโลหะ */
function hit(ctx: AudioContext, at: number, freq: number, dur: number, vol: number, q = 9) {
  const len = Math.ceil(ctx.sampleRate * (dur + 0.05))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1

  const src = ctx.createBufferSource()
  src.buffer = buf

  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(freq, at)
  bp.Q.setValueAtTime(q, at)

  src.connect(bp)
  env(ctx, bp, at, dur, vol, 0.004)
  src.start(at)
  src.stop(at + dur + 0.05)
}

/* --------------------------------------------------------------- ชุดเสียง */

/** แตรลมของรถใหญ่ · เสียงหลัก คู่ห้า และต่ำลงหนึ่งคู่แปด ซ้อนกัน */
function horn(ctx: AudioContext, at: number, f: number, dur: number, vol: number) {
  osc(ctx, at, f, dur, vol, 'sine', 0.05)
  osc(ctx, at, f * 1.5, dur, vol * 0.45, 'sine', 0.05)
  osc(ctx, at, f * 0.5, dur, vol * 0.35, 'sine', 0.05)
}

/**
 * ระฆังโลหะ · พาร์เชียลไม่เป็นจำนวนเท่า
 *
 * ระฆังจริงมีความถี่ย่อยที่ไม่ได้เป็นจำนวนเท่าของเสียงหลัก
 * ซึ่งเป็นเหตุผลที่มันฟังเป็นโลหะ ไม่ใช่เป็นโน้ตดนตรี
 */
function chime(ctx: AudioContext, at: number, f: number, vol: number) {
  const parts: [number, number, number][] = [
    [1, 1, 1.5],
    [2.76, 0.5, 1.1],
    [5.4, 0.28, 0.8],
    [8.93, 0.16, 0.5],
  ]
  for (const [m, w, d] of parts) osc(ctx, at, f * m, d, vol * w, 'sine', 0.004)
}

/** ออดโรงงาน · คลื่นสี่เหลี่ยมต่ำที่ถูกสับเป็นห้วงถี่ ๆ */
function buzz(ctx: AudioContext, at: number, f: number, dur: number, vol: number) {
  const o = ctx.createOscillator()
  o.type = 'square'
  o.frequency.setValueAtTime(f, at)

  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(900, at)

  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, at)
  // สับเปิดปิด 22 ครั้งต่อวินาที · ความถี่ที่หูได้ยินเป็น "ออด" ไม่ใช่ "บี๊บ"
  const step = 1 / 44
  for (let t = at; t < at + dur; t += step * 2) {
    g.gain.setValueAtTime(vol, t)
    g.gain.setValueAtTime(vol * 0.25, t + step)
  }
  g.gain.setValueAtTime(vol, at + dur)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.05)

  o.connect(lp)
  lp.connect(g)
  g.connect(ctx.destination)
  o.start(at)
  o.stop(at + dur + 0.1)
}

/** ไซเรนกวาด · ความถี่ไถลขึ้นลงต่อเนื่อง */
function sweep(ctx: AudioContext, at: number, from: number, to: number, dur: number, vol: number) {
  const o = ctx.createOscillator()
  o.type = 'sawtooth'
  o.frequency.setValueAtTime(from, at)
  o.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + dur)
  env(ctx, o, at, dur, vol, 0.02)
  o.start(at)
  o.stop(at + dur + 0.05)
}

export interface Pack {
  key: string
  name: string
  hint: string
  /** tone = เสียงสังเคราะห์ล้วน · voice = มีคนพูด โดยมีเสียงนำสั้น ๆ ก่อน */
  kind: 'tone' | 'voice'
  /** เสียงสังเคราะห์ · ของชุดเสียงพูดคือเสียงนำให้คนเงยหน้าก่อนได้ยินประโยค */
  play: (ctx: AudioContext, at: number, stage: Stage) => void
  /** ประโยคที่จะพูด · มีเฉพาะชุดเสียงพูด */
  say?: (stage: Stage) => string
  voice?: { rate: number; pitch: number }
}

/**
 * ทุกชุดไล่ความแรงเหมือนกันสามขั้น
 *   20 นาที  ครั้งเดียว เบา   บอกให้รู้
 *   10 นาที  สองครั้ง สูงขึ้น  เริ่มต้องขยับ
 *   เลยเวลา  รัว แล้วลงท้ายหนัก  ต้องไปเดี๋ยวนี้
 */
export const WAIT_PACKS: Pack[] = [
  {
    key: 'horn',
    name: 'แตรลม',
    hint: 'เสียงต่ำยาวแบบแตรรถใหญ่ · ไม่แสบหู เหมาะกับคลังที่เสียงไม่ดังมาก',
    kind: 'tone',
    play: (ctx, t, s) => {
      if (s === 'm20') horn(ctx, t, 196, 0.62, 0.26)
      else if (s === 'm10') {
        horn(ctx, t, 247, 0.34, 0.28)
        horn(ctx, t + 0.46, 247, 0.34, 0.28)
      } else {
        horn(ctx, t, 294, 0.3, 0.3)
        horn(ctx, t + 0.4, 294, 0.3, 0.3)
        horn(ctx, t + 0.8, 294, 0.3, 0.3)
        horn(ctx, t + 1.3, 165, 0.9, 0.3)
      }
    },
  },
  {
    key: 'chime',
    name: 'ระฆังโลหะ',
    hint: 'เสียงใส ก้องยาว แบบระฆังสถานี · ตัดผ่านเสียงสายพานได้ดี',
    kind: 'tone',
    play: (ctx, t, s) => {
      if (s === 'm20') chime(ctx, t, 523, 0.3)
      else if (s === 'm10') {
        chime(ctx, t, 659, 0.32)
        chime(ctx, t + 0.4, 523, 0.32)
      } else {
        chime(ctx, t, 784, 0.34)
        chime(ctx, t + 0.3, 659, 0.34)
        chime(ctx, t + 0.6, 523, 0.34)
        chime(ctx, t + 0.9, 392, 0.34)
      }
    },
  },
  {
    key: 'buzz',
    name: 'ออดโรงงาน',
    hint: 'เสียงออดต่ำสั่น ๆ แบบประตูโรงงาน · ดุที่สุดในชุดทั้งหมด',
    kind: 'tone',
    play: (ctx, t, s) => {
      if (s === 'm20') buzz(ctx, t, 150, 0.4, 0.2)
      else if (s === 'm10') {
        buzz(ctx, t, 180, 0.3, 0.22)
        buzz(ctx, t + 0.45, 180, 0.3, 0.22)
      } else {
        buzz(ctx, t, 210, 0.42, 0.24)
        buzz(ctx, t + 0.55, 210, 0.42, 0.24)
        buzz(ctx, t + 1.1, 150, 0.9, 0.24)
      }
    },
  },
  {
    key: 'knock',
    name: 'เคาะเหล็ก',
    hint: 'เสียงเคาะสั้น แห้ง ไม่ก้อง · รบกวนน้อยที่สุดถ้าต้องฟังทั้งกะ',
    kind: 'tone',
    play: (ctx, t, s) => {
      if (s === 'm20') hit(ctx, t, 820, 0.18, 0.5)
      else if (s === 'm10') {
        hit(ctx, t, 1050, 0.14, 0.52)
        hit(ctx, t + 0.18, 1050, 0.14, 0.52)
      } else {
        for (let i = 0; i < 5; i++) hit(ctx, t + i * 0.16, 1250, 0.12, 0.55)
        hit(ctx, t + 0.95, 520, 0.35, 0.5, 5)
      }
    },
  },
  {
    key: 'siren',
    name: 'ไซเรนกวาด',
    hint: 'เสียงไถลขึ้นลงแบบรถฉุกเฉิน · ต่างจากทุกเสียงในคลังมากที่สุด',
    kind: 'tone',
    play: (ctx, t, s) => {
      if (s === 'm20') sweep(ctx, t, 700, 380, 0.5, 0.24)
      else if (s === 'm10') {
        sweep(ctx, t, 460, 820, 0.18, 0.26)
        sweep(ctx, t + 0.24, 520, 900, 0.18, 0.26)
        sweep(ctx, t + 0.44, 580, 1000, 0.2, 0.28)
      } else {
        let x = t
        for (let i = 0; i < 3; i++) {
          sweep(ctx, x, 420, 900, 0.34, 0.3)
          x += 0.34
          sweep(ctx, x, 900, 420, 0.34, 0.3)
          x += 0.44
        }
      }
    },
  },
  {
    key: 'voice_hard',
    name: 'คนพูด · โทนดุ',
    hint: 'สั่งตรง ๆ สั้น ๆ แบบหัวหน้าเร่งงาน · ใช้ตอนที่ต้องให้ขยับทันที',
    kind: 'voice',
    voice: { rate: 1.12, pitch: 0.8 },
    // เสียงนำเป็นเคาะเหล็ก ให้คนเงยหน้าก่อนประโยคจะเริ่ม
    play: (ctx, t, s) => {
      if (s === 'late') {
        hit(ctx, t, 1250, 0.12, 0.5)
        hit(ctx, t + 0.15, 1250, 0.12, 0.5)
      } else {
        hit(ctx, t, 1050, 0.13, 0.42)
      }
    },
    say: (s) =>
      s === 'm20'
        ? 'เหลือยี่สิบนาที เร่งลงงานหน่อย'
        : s === 'm10'
          ? 'สิบนาทีสุดท้ายแล้ว รีบหน่อย'
          : 'เลยเวลาแล้ว ไปจัดการเดี๋ยวนี้',
  },
  {
    key: 'voice_rude',
    name: 'คนพูด · โทนหยาบ',
    hint: 'พูดแบบด่ากันเองในทีม · อย่าเปิดไว้บนจอทีวีวันที่มีคนนอกเข้าฮับ',
    kind: 'voice',
    voice: { rate: 1.16, pitch: 0.72 },
    // เคาะสามทีถี่ ๆ ให้รู้ว่าคราวนี้ไม่ใช่เตือนเฉย ๆ
    play: (ctx, t, s) => {
      const n = s === 'late' ? 3 : s === 'm10' ? 2 : 1
      for (let i = 0; i < n; i++) hit(ctx, t + i * 0.13, 1250, 0.11, 0.52)
    },
    say: (s) =>
      s === 'm20'
        ? 'เห้ย เหลือยี่สิบนาทีแล้วโว้ย ขยับกันหน่อยดิ'
        : s === 'm10'
          ? 'สิบนาทีแล้วโว้ย มัวทำห่าอะไรกันอยู่'
          : 'แม่ง เลยเวลาไปแล้วโว้ย รีบไปจัดการเดี๋ยวนี้',
  },
  {
    key: 'voice_formal',
    name: 'คนพูด · โทนทางการ',
    hint: 'ประกาศสุภาพแบบเสียงตามสาย · เหมาะกับตอนมีคนนอกเดินผ่าน',
    kind: 'voice',
    voice: { rate: 0.96, pitch: 1 },
    play: (ctx, t) => chime(ctx, t, 784, 0.22),
    say: (s) =>
      s === 'm20'
        ? 'แจ้งเตือน เหลือเวลาอีกยี่สิบนาที กรุณาเตรียมลงงาน'
        : s === 'm10'
          ? 'แจ้งเตือน เหลือเวลาอีกสิบนาที กรุณาเร่งดำเนินการ'
          : 'แจ้งเตือน มีรถเกินเวลาที่กำหนดแล้ว กรุณาตรวจสอบ',
  },
  {
    key: 'voice_fun',
    name: 'คนพูด · โทนตลก',
    hint: 'หยอกเบา ๆ ไม่กดดัน · ฟังทั้งกะแล้วไม่เครียด',
    kind: 'voice',
    voice: { rate: 1.08, pitch: 1.35 },
    play: (ctx, t) => {
      chime(ctx, t, 1047, 0.18)
      chime(ctx, t + 0.14, 1319, 0.18)
    },
    say: (s) =>
      s === 'm20'
        ? 'อีกยี่สิบนาทีนะจ๊ะ ขยับตัวกันหน่อย'
        : s === 'm10'
          ? 'สิบนาทีแล้วนะ จะไหวไหมเนี่ย'
          : 'โอ๊ะโอ เลยเวลาแล้วจ้า รีบหน่อยน้า',
  },
]

/* -------------------------------------------------------------- เสียงพูด */

/**
 * ใช้เสียงสังเคราะห์ของเครื่อง ไม่ได้โหลดไฟล์เสียงมาเก็บ
 *
 * เหตุผลเดียวกับที่เสียงบี๊บสังเคราะห์เอาเอง — ไฟล์เสียงกินทั้งโควตา bandwidth
 * และพื้นที่ แถมโหลดไม่สำเร็จได้ ส่วนตัวนี้อยู่ในเครื่องอยู่แล้วและใช้ฟรีตลอด
 *
 * ข้อแลกเปลี่ยนคือเสียงไทยไม่ได้มีทุกเครื่อง · เครื่องที่ไม่มีจะอ่านไทยไม่ออก
 * จึงต้องเช็คก่อนเสมอ และบอกคนเลือกไปตรง ๆ ว่าเครื่องนี้ใช้ไม่ได้
 */
function thaiVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null
  const all = speechSynthesis.getVoices()
  return all.find((v) => v.lang.toLowerCase().startsWith('th')) ?? null
}

/** เครื่องนี้พูดไทยได้ไหม · รายชื่อเสียงมาแบบไม่พร้อมกัน จึงต้องถามใหม่ได้เรื่อย ๆ */
export function hasThaiVoice(): boolean {
  return thaiVoice() !== null
}

/** แจ้งเมื่อรายชื่อเสียงโหลดเสร็จ · หน้าเลือกเสียงเอาไว้วาดใหม่ */
export function onVoicesReady(fn: () => void): () => void {
  if (typeof speechSynthesis === 'undefined') return () => undefined
  speechSynthesis.addEventListener('voiceschanged', fn)
  return () => speechSynthesis.removeEventListener('voiceschanged', fn)
}

function speak(text: string, v: { rate: number; pitch: number }, onEnd?: () => void) {
  if (typeof speechSynthesis === 'undefined') {
    onEnd?.()
    return
  }
  // ตัดคิวเก่าทิ้งก่อนเสมอ · รถสามคันข้ามเส้นพร้อมกันแล้วพูดต่อคิวกันสามประโยค
  // คือเสียงที่ยังพูดถึงคันแรกอยู่ตอนที่คันที่สามเลยเวลาไปแล้ว
  speechSynthesis.cancel()

  const u = new SpeechSynthesisUtterance(text)
  const tv = thaiVoice()
  if (tv) u.voice = tv
  u.lang = tv?.lang ?? 'th-TH'
  u.rate = v.rate
  u.pitch = v.pitch
  u.volume = 1
  if (onEnd) u.addEventListener('end', onEnd)
  speechSynthesis.speak(u)
}

/* ----------------------------------------------------------- เลือกชุดเสียง */

const PACK_KEY = 'wait.alarm.pack'

export function getPackKey(): string {
  const k = localStorage.getItem(PACK_KEY)
  return WAIT_PACKS.some((p) => p.key === k) ? (k as string) : WAIT_PACKS[0].key
}

export function setPackKey(k: string) {
  localStorage.setItem(PACK_KEY, k)
}

function current(): Pack {
  const k = getPackKey()
  return WAIT_PACKS.find((p) => p.key === k) ?? WAIT_PACKS[0]
}

/**
 * เล่นหนึ่งครั้ง · เสียงนำก่อน แล้วค่อยพูดถ้าเป็นชุดเสียงพูด
 *
 * เว้นให้เสียงนำจบก่อนค่อยเริ่มพูด ไม่งั้นคำแรกจะหายไปในเสียงเคาะ
 */
function fire(p: Pack, stage: Stage, onEnd?: () => void) {
  const ctx = audioCtx()
  if (ctx) p.play(ctx, ctx.currentTime + 0.02, stage)

  if (p.say) {
    const text = p.say(stage)
    const v = p.voice ?? { rate: 1, pitch: 1 }
    window.setTimeout(() => speak(text, v, onEnd), 320)
  } else {
    onEnd?.()
  }
}

export function playWaitAlarm(stage: Stage) {
  fire(current(), stage)
}

/** กดฟังทีละขั้นตอนตอนเลือกชุด */
export function previewStage(packKey: string, stage: Stage) {
  fire(WAIT_PACKS.find((x) => x.key === packKey) ?? WAIT_PACKS[0], stage)
}

/** ฟังทั้งสามขั้นเรียงกัน · ไว้เทียบชุดต่อชุด */
export function previewWaitAll(packKey?: string) {
  const p = WAIT_PACKS.find((x) => x.key === (packKey ?? getPackKey())) ?? WAIT_PACKS[0]

  if (p.say) {
    // ต่อคิวด้วยการรอให้ประโยคก่อนหน้าจบจริง ไม่ใช่เดาเวลาเอา
    // ความยาวประโยคขึ้นกับเสียงของแต่ละเครื่อง เดาแล้วจะทับกันบนเครื่องที่พูดช้า
    fire(p, 'm20', () => fire(p, 'm10', () => fire(p, 'late')))
    return
  }

  const ctx = audioCtx()
  if (!ctx) return
  const t = ctx.currentTime + 0.02
  p.play(ctx, t, 'm20')
  p.play(ctx, t + 1.6, 'm10')
  p.play(ctx, t + 3.4, 'late')
}

/** คีย์เก็บคำตอบเรื่องเสียงของกระดานนี้ · แยกจากของปล่อยรถ จะได้ปิดทีละกระดานได้ */
export const WAIT_ALARM_PREF = 'wait.alarm'
