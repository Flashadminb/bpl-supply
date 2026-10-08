/**
 * เครื่องทำเสียงเตือน · ใช้ร่วมกันทั้งตารางปล่อยรถและรถรอลงงาน
 *
 * สองกระดานนี้อยู่ในคลังเดียวกันและดังพร้อมกันได้ คนละทีมกันด้วย
 * ถ้าเสียงคล้ายกัน ทีมหนึ่งจะวิ่งเพราะเสียงของอีกทีม พอโดนหลอกสองสามครั้ง
 * ทั้งคลังจะเลิกสนใจเสียงทั้งสองชุด
 *
 * แต่เสียงที่ "ตัดผ่านเสียงสายพานได้" กับเสียงที่ "ฟังทั้งกะแล้วไม่รำคาญ"
 * เป็นคนละเรื่องกัน และขึ้นกับคลังจริงซึ่งไม่มีทางรู้จากฝั่งโค้ด
 * จึงทำมาให้เลือกเอง แล้วให้คนที่ยืนอยู่ตรงนั้นตัดสิน
 *
 * ไฟล์นี้มีแต่เครื่องมือ · รายการชุดเสียงของแต่ละกระดานอยู่ในโฟลเดอร์ของกระดานนั้น
 * เพราะประโยคที่พูดต้องต่างกัน กระดานหนึ่งพูดว่าปล่อยรถ อีกกระดานพูดว่าลงงาน
 *
 * ทั้งหมดนี้ไม่กินโควตาสักไบต์ · ไม่มีไฟล์เสียงให้โหลด
 * เสียงบี๊บสังเคราะห์ในเครื่องตอนนั้น ส่วนเสียงพูดใช้ของที่ติดมากับเครื่องอยู่แล้ว
 */

export type Stage = 'm20' | 'm10' | 'late'

/* --------------------------------------------------------- เครื่องเสียง */

let ctx: AudioContext | null = null

export function audioOn(): boolean {
  return !!ctx && ctx.state === 'running'
}

export function audioCtx(): AudioContext | null {
  return ctx && ctx.state === 'running' ? ctx : null
}

/**
 * ปลดล็อกเสียง
 *
 * เบราว์เซอร์ห้ามเล่นเสียงจนกว่าคนจะแตะหน้าจอนั้นสักครั้ง
 * จอทีวีที่แขวนไว้เฉย ๆ จึงเงียบตลอดกาลถ้าไม่มีใครกด
 *
 * ใช้ตัวเดียวทั้งแอพ · สร้างคนละตัวแปลว่าคนต้องกดเปิดเสียงสองครั้งโดยไม่รู้ว่าทำไม
 */
export async function unlockAudio(): Promise<boolean> {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = ctx ?? new Ctor()
    await ctx.resume()
    return ctx.state === 'running'
  } catch {
    return false
  }
}

/* ------------------------------------------------------- เสียงพื้นฐาน */

function env(c: AudioContext, node: AudioNode, at: number, dur: number, vol: number, attack = 0.01) {
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(vol, at + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  node.connect(g)
  g.connect(c.destination)
  return g
}

export function osc(
  c: AudioContext,
  at: number,
  freq: number,
  dur: number,
  vol: number,
  type: OscillatorType = 'sine',
  attack = 0.01,
) {
  const o = c.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(freq, at)
  env(c, o, at, dur, vol, attack)
  o.start(at)
  o.stop(at + dur + 0.05)
}

/** เสียงบี๊บตัดห้วน ๆ · เสียงดั้งเดิมของตารางปล่อยรถ */
export function beep(
  c: AudioContext,
  at: number,
  freq: number,
  dur: number,
  vol: number,
  type: OscillatorType,
) {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, at)
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(vol, at + 0.006)
  g.gain.setValueAtTime(vol, at + Math.max(0.01, dur - 0.02))
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  o.connect(g)
  g.connect(c.destination)
  o.start(at)
  o.stop(at + dur + 0.03)
}

/** เสียงดังสั้น ๆ แบบไม่มีระดับเสียงชัด · ใช้ทำเสียงเคาะโลหะ */
export function hit(c: AudioContext, at: number, freq: number, dur: number, vol: number, q = 9) {
  const len = Math.ceil(c.sampleRate * (dur + 0.05))
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1

  const src = c.createBufferSource()
  src.buffer = buf
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(freq, at)
  bp.Q.setValueAtTime(q, at)
  src.connect(bp)
  env(c, bp, at, dur, vol, 0.004)
  src.start(at)
  src.stop(at + dur + 0.05)
}

/** แตรลมของรถใหญ่ · เสียงหลัก คู่ห้า และต่ำลงหนึ่งคู่แปด ซ้อนกัน */
export function horn(c: AudioContext, at: number, f: number, dur: number, vol: number) {
  osc(c, at, f, dur, vol, 'sine', 0.05)
  osc(c, at, f * 1.5, dur, vol * 0.45, 'sine', 0.05)
  osc(c, at, f * 0.5, dur, vol * 0.35, 'sine', 0.05)
}

/**
 * ระฆังโลหะ · พาร์เชียลไม่เป็นจำนวนเท่า
 *
 * ระฆังจริงมีความถี่ย่อยที่ไม่ได้เป็นจำนวนเท่าของเสียงหลัก
 * ซึ่งเป็นเหตุผลที่มันฟังเป็นโลหะ ไม่ใช่เป็นโน้ตดนตรี
 */
export function chime(c: AudioContext, at: number, f: number, vol: number) {
  const parts: [number, number, number][] = [
    [1, 1, 1.5],
    [2.76, 0.5, 1.1],
    [5.4, 0.28, 0.8],
    [8.93, 0.16, 0.5],
  ]
  for (const [m, w, d] of parts) osc(c, at, f * m, d, vol * w, 'sine', 0.004)
}

/** ออดโรงงาน · คลื่นสี่เหลี่ยมต่ำที่ถูกสับเป็นห้วงถี่ ๆ */
export function buzz(c: AudioContext, at: number, f: number, dur: number, vol: number) {
  const o = c.createOscillator()
  o.type = 'square'
  o.frequency.setValueAtTime(f, at)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(900, at)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  const step = 1 / 44
  for (let t = at; t < at + dur; t += step * 2) {
    g.gain.setValueAtTime(vol, t)
    g.gain.setValueAtTime(vol * 0.25, t + step)
  }
  g.gain.setValueAtTime(vol, at + dur)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.05)
  o.connect(lp)
  lp.connect(g)
  g.connect(c.destination)
  o.start(at)
  o.stop(at + dur + 0.1)
}

/** ไซเรนกวาด · ความถี่ไถลขึ้นลงต่อเนื่อง */
export function sweep(
  c: AudioContext,
  at: number,
  from: number,
  to: number,
  dur: number,
  vol: number,
) {
  const o = c.createOscillator()
  o.type = 'sawtooth'
  o.frequency.setValueAtTime(from, at)
  o.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + dur)
  env(c, o, at, dur, vol, 0.02)
  o.start(at)
  o.stop(at + dur + 0.05)
}

/**
 * นาฬิกาปลุกสองลูก · เสียงดั้งเดิมของตารางปล่อยรถตอนเลยกำหนด
 *
 * นาฬิกาปลุกจริงคือค้อนเคาะกระดิ่งสองใบสลับกันเร็ว ๆ
 * เสียงบี๊บยาวตัวเดียวดังเท่ากันแต่ไม่มีใครรู้สึกว่าต้องรีบ
 */
export function alarmClock(c: AudioContext, t0: number) {
  const ON = 0.055
  const GAP = 0.045
  let t = t0
  for (let burst = 0; burst < 3; burst++) {
    for (let i = 0; i < 11; i++) {
      beep(c, t, i % 2 === 0 ? 1180 : 860, ON, 0.3, 'square')
      t += ON + GAP
    }
    t += 0.22
  }
}

/**
 * เสียงนำของขั้นสุดท้าย · ใช้ร่วมกันทุกชุดและทุกกระดาน
 *
 * สองโน้ตสลับกันเร็ว ๆ ห่างกันเป็นไตรโทน ซึ่งเป็นคู่เสียงที่ฟังแล้วไม่สบายหู
 * โดยธรรมชาติ · เป็นคู่เดียวกับที่ระบบเตือนภัยทั่วโลกใช้ ไม่ใช่เรื่องบังเอิญ
 *
 * จงใจให้เหมือนกันทุกชุด เพราะสิ่งที่ต้องจำคือ "นี่คือขั้นสุดท้าย"
 * ไม่ใช่ "นี่คือชุดเสียงอะไร" · เปลี่ยนชุดเสียงแล้วยังต้องรู้ทันทีเหมือนเดิม
 */
export function finalAlert(c: AudioContext, at: number) {
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(2600, at)
  lp.connect(c.destination)

  const step = 0.115
  for (let i = 0; i < 4; i++) {
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'square'
    o.frequency.setValueAtTime(i % 2 === 0 ? 932 : 622, at + i * step)
    g.gain.setValueAtTime(0.0001, at + i * step)
    g.gain.exponentialRampToValueAtTime(0.22, at + i * step + 0.008)
    g.gain.setValueAtTime(0.22, at + i * step + step - 0.03)
    g.gain.exponentialRampToValueAtTime(0.0001, at + i * step + step)
    o.connect(g)
    g.connect(lp)
    o.start(at + i * step)
    o.stop(at + i * step + step + 0.02)
  }
  osc(c, at, 110, 0.62, 0.22, 'sine', 0.03)
}

/* -------------------------------------------------------------- เสียงพูด */

/**
 * ใช้เสียงสังเคราะห์ของเครื่อง ไม่ได้โหลดไฟล์เสียงมาเก็บ
 *
 * ข้อแลกเปลี่ยนคือเสียงไทยไม่ได้มีทุกเครื่อง · เครื่องที่ไม่มีจะอ่านไทยไม่ออก
 * จึงต้องเช็คก่อนเสมอ และบอกคนเลือกไปตรง ๆ ว่าเครื่องนี้ใช้ไม่ได้
 */
function thaiVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null
  return speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('th')) ?? null
}

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

/* ------------------------------------------------------------- ชุดเสียง */

export interface Pack {
  key: string
  name: string
  hint: string
  /** tone = เสียงสังเคราะห์ล้วน · voice = มีคนพูด โดยมีเสียงนำสั้น ๆ ก่อน */
  kind: 'tone' | 'voice'
  /** เสียงสังเคราะห์ · ของชุดเสียงพูดคือเสียงนำให้คนเงยหน้าก่อนได้ยินประโยค */
  play: (c: AudioContext, at: number, stage: Stage) => void
  /** ประโยคที่จะพูด · มีเฉพาะชุดเสียงพูด */
  say?: (stage: Stage) => string
  voice?: { rate: number; pitch: number }
}

export interface AlarmKit {
  packs: Pack[]
  getKey: () => string
  setKey: (k: string) => void
  /** เล่นตามชุดที่เลือกไว้ · ส่งให้ useTruckAlarm โดยตรง */
  play: (stage: Stage) => void
  previewStage: (packKey: string, stage: Stage) => void
  previewAll: (packKey?: string) => void
}

/**
 * ประกอบชุดเสียงของกระดานหนึ่ง
 *
 * แต่ละกระดานเก็บคำตอบคนละคีย์ · ตั้งเสียงปล่อยรถแล้วไม่ควรไปเปลี่ยนของรถรอลงงาน
 * และคำตอบอยู่ในเครื่อง แปลว่าจอทีวีกับมือถือตั้งคนละเสียงกันได้
 * ซึ่งถูกแล้ว เพราะจอทีวีอยู่กลางคลังส่วนมือถืออยู่ในกระเป๋า
 */
export function makeAlarmKit(storageKey: string, packs: Pack[]): AlarmKit {
  const find = (k?: string) => packs.find((p) => p.key === k) ?? packs[0]

  const getKey = () => {
    const k = localStorage.getItem(storageKey)
    return packs.some((p) => p.key === k) ? (k as string) : packs[0].key
  }

  /**
   * เล่นหนึ่งครั้ง · เสียงนำก่อน แล้วค่อยพูดถ้าเป็นชุดเสียงพูด
   *
   * เว้นให้เสียงนำจบก่อนค่อยเริ่มพูด ไม่งั้นคำแรกจะหายไปในเสียงเตือน
   * ขั้นสุดท้ายรอนานกว่า เพราะเสียงนำของมันยาวกว่าขั้นอื่น
   */
  function fire(p: Pack, stage: Stage, onEnd?: () => void) {
    const c = audioCtx()
    if (c) p.play(c, c.currentTime + 0.02, stage)

    if (p.say) {
      const text = p.say(stage)
      const v = p.voice ?? { rate: 1, pitch: 1 }
      window.setTimeout(() => speak(text, v, onEnd), stage === 'late' ? 780 : 320)
    } else {
      onEnd?.()
    }
  }

  return {
    packs,
    getKey,
    setKey: (k) => localStorage.setItem(storageKey, k),
    play: (stage) => fire(find(getKey()), stage),
    previewStage: (packKey, stage) => fire(find(packKey), stage),
    previewAll: (packKey) => {
      const p = find(packKey ?? getKey())
      if (p.say) {
        // ต่อคิวด้วยการรอให้ประโยคก่อนหน้าจบจริง ไม่ใช่เดาเวลาเอา
        // ความยาวประโยคขึ้นกับเสียงของแต่ละเครื่อง เดาแล้วจะทับกันบนเครื่องที่พูดช้า
        fire(p, 'm20', () => fire(p, 'm10', () => fire(p, 'late')))
        return
      }
      const c = audioCtx()
      if (!c) return
      const t = c.currentTime + 0.02
      p.play(c, t, 'm20')
      p.play(c, t + 1.6, 'm10')
      p.play(c, t + 3.4, 'late')
    },
  }
}
