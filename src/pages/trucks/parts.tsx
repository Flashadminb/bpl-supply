import type { CSSProperties } from 'react'

/**
 * ชิ้นส่วนที่ใช้ร่วมกันของหน้าตารางปล่อยรถ
 *
 * กระดาน จอทีวี และหน้าสถิติ ต้องใช้สีและรูปแบบตัวเลขชุดเดียวกันเป๊ะ
 * ถ้าแยกเขียนสามที่ วันหนึ่งจะมีหน้าหนึ่งที่สีแดงเริ่มที่คนละนาทีกับอีกหน้า
 * แล้วไม่มีใครรู้ว่าหน้าไหนถูก
 */

export const DAY_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

export const p2 = (n: number) => String(n).padStart(2, '0')
export const hm = (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}`
export const dmy = (d: Date) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`

/** เขียวยังมีเวลา · ส้มเหลือไม่ถึง 30 นาที · แดงเลยกำหนด */
export function tone(sec: number) {
  if (sec < 0) return '#FF5C5C'
  if (sec <= 30 * 60) return '#FFB038'
  return '#35D98A'
}

/**
 * ป้ายตัวเลขแบบป้ายพับ
 *
 * พื้นขาวตัวดำบนจอดำอ่านได้จากไกลที่สุดเท่าที่ทำได้ด้วยตัวอักษรอย่างเดียว
 * เลยกำหนดแล้วสลับเป็นพื้นแดงตัวขาว เพราะตอนนั้นต้องสะดุดตา ไม่ใช่แค่อ่านออก
 */
export function Flip({
  v,
  label,
  size,
  late,
  tint,
}: {
  v: string
  label?: string
  size: number
  late: boolean
  /** พื้นสีอื่นแทนขาว · ใช้กับการ์ดตัวเลขที่ต้องแยกความหมายด้วยสี */
  tint?: string
}) {
  return (
    <span className="inline-flex flex-col items-center" style={{ gap: Math.round(size * 0.1) }}>
      <span
        className="relative inline-flex items-center justify-center"
        style={{
          width: size,
          height: Math.round(size * 0.82),
          background: late ? '#FF4040' : (tint ?? '#FBFBFB'),
          borderRadius: Math.round(size * 0.11),
          boxShadow: '0 2px 0 rgba(0,0,0,.45)',
        }}
      >
        <span
          className="font-mono font-extrabold leading-none"
          style={{ fontSize: Math.round(size * 0.62), color: late ? '#fff' : '#101316', letterSpacing: -1 }}
        >
          {v}
        </span>
        <span className="absolute inset-x-0 top-1/2 h-[2px]" style={{ background: 'rgba(0,0,0,.22)' }} />
      </span>
      {label && (
        <span className="text-[11px] font-bold tracking-widest" style={{ color: '#AFC0D4' }}>
          {label}
        </span>
      )}
    </span>
  )
}

/**
 * นาฬิกานับถอยหลัง
 *
 * วินาทีไม่ได้เพิ่มภาระฝั่งเซิร์ฟเวอร์เลยสักนิด
 * เพราะหน้าจอนับเองในเครื่องจากเวลาที่ควรออกซึ่งโหลดมาแล้วครั้งเดียว
 * ตัวเลขเดินทุกวินาทีอยู่แล้วตั้งแต่แรก แค่เดิมไม่ได้เอาวินาทีมาแสดง
 */
export function Countdown({ sec, size, showSec = false }: { sec: number; size: number; showSec?: boolean }) {
  const late = sec < 0
  const a = Math.abs(sec)
  const colon = (
    <span className="font-extrabold" style={{ fontSize: size * 0.45, color: late ? '#FF4040' : '#5A646F' }}>
      :
    </span>
  )
  return (
    <span className="inline-flex items-center gap-[6px]">
      {late && (
        <span className="font-extrabold" style={{ fontSize: size * 0.6, color: '#FF4040' }}>
          −
        </span>
      )}
      <Flip v={p2(Math.floor(a / 3600))} size={size} late={late} />
      {colon}
      <Flip v={p2(Math.floor(a / 60) % 60)} size={size} late={late} />
      {showSec && (
        <>
          {colon}
          {/* วินาทีเล็กกว่านาที เพราะมันไม่ใช่ตัวเลขที่ใช้ตัดสินใจ แค่บอกว่าเวลาเดินอยู่จริง */}
          <Flip v={p2(a % 60)} size={Math.round(size * 0.74)} late={late} />
        </>
      )}
    </span>
  )
}

/**
 * การ์ดตัวเลขแบบป้ายพับ · ใช้บนจอทีวี
 *
 * เลขเดียวกันนี้มีอยู่บนหน้ากระดานในรูปตัวหนังสือธรรมดาแล้ว
 * บนจอทีวีมันต้องอ่านออกจากอีกฝั่งของคลัง จึงใช้ป้ายพับแบบเดียวกับนาฬิกา
 * ตัวเลขที่ควรทำให้ใจหายจะกระพริบ · ที่เหลือนิ่ง เพราะถ้าทุกอย่างกระพริบก็เท่ากับไม่มีอะไรกระพริบ
 */
export function StatCard({
  label,
  n,
  color,
  blink = false,
  size = 60,
  foot,
  ring,
}: {
  label: string
  n: number
  color: string
  blink?: boolean
  size?: number
  foot?: string
  /** สีวงกระพริบ · สีเดียวกับ color แต่จาง เพื่อให้วงไม่กลืนกับเลข */
  ring?: string
}) {
  const digits = String(Math.max(0, Math.round(n)))
  // ศูนย์บนป้ายสีแดงอ่านจากไกล ๆ แล้วเหมือนมีเรื่อง · ไม่มีอะไรต้องทำก็ใช้สีกลาง
  const tile = n === 0 ? '#9AA7B5' : color
  return (
    <div
      className="flex flex-col items-center justify-center rounded-2xl px-4 py-4"
      style={
        {
          background: '#121820',
          border: `2px solid ${blink ? color : '#1E2733'}`,
          animation: blink ? 'bplPulse 1.1s steps(1, end) infinite' : undefined,
          '--ring': ring ?? 'rgba(255,255,255,.18)',
        } as CSSProperties
      }
    >
      <div className="mb-2 text-lg font-bold" style={{ color: '#AFC0D4' }}>
        {label}
      </div>
      <div className="flex items-end gap-[5px]">
        {digits.split('').map((d, i) => (
          <Flip key={i} v={d} size={size} late={false} tint={tile} />
        ))}
        <span className="ml-1 text-xl font-bold" style={{ color: '#AFC0D4' }}>
          คัน
        </span>
      </div>
      {foot && (
        <div className="mt-2 text-sm" style={{ color: '#7D8B9B' }}>
          {foot}
        </div>
      )}
    </div>
  )
}

/**
 * ช่องเล็กหนึ่งคัน · ใช้ตอนต้องแสดงให้ครบทุกคันในหน้าเดียว
 *
 * การ์ดใหญ่ตอบว่า "คันไหนต้องรีบ" ส่วนช่องเล็กตอบว่า "ทั้งคลังมีอะไรอยู่บ้าง"
 * สองคำถามนี้ต้องการพื้นที่ต่อคันไม่เท่ากัน ถ้าใช้ขนาดเดียวจะเสียอย่างใดอย่างหนึ่ง
 *
 * ขนาดช่องย่อลงเองตามจำนวนคัน เพราะเจ้าของระบบบอกว่าบางช่วงมีสามสี่ร้อยคัน
 * จอทีวีเลื่อนไม่ได้ ของที่ล้นออกนอกจอเท่ากับของที่ไม่ได้แสดง
 */
export function MiniGrid({
  rows,
  now,
  title,
}: {
  rows: { id: number; name: string; code: string | null; due: string; sec: number; seq?: number }[]
  now: number
  title?: string
}) {
  void now
  const n = rows.length
  const w = n <= 16 ? 210 : n <= 40 ? 158 : n <= 90 ? 120 : 96
  const nameSize = n <= 16 ? 16 : n <= 40 ? 14 : n <= 90 ? 12.5 : 11
  const clockSize = n <= 16 ? 24 : n <= 40 ? 20 : n <= 90 ? 17 : 15
  const withSec = w >= 158

  if (n === 0) return null
  return (
    <div>
      {title && (
        <p className="mb-2 text-lg font-bold" style={{ color: '#AFC0D4' }}>
          {title} <span style={{ color: '#5A646F' }}>{n} คัน</span>
        </p>
      )}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${w}px, 1fr))` }}
      >
        {rows.map((r) => {
          const c = tone(r.sec)
          const late = r.sec < 0
          const a = Math.abs(r.sec)
          const t =
            (late ? '−' : '') +
            p2(Math.floor(a / 3600)) +
            ':' +
            p2(Math.floor(a / 60) % 60) +
            (withSec ? ':' + p2(a % 60) : '')
          return (
            <div
              key={r.id}
              className="overflow-hidden rounded-lg px-2 py-1.5"
              style={{
                background: late ? 'rgba(255,92,92,.1)' : '#121820',
                borderLeft: `4px solid ${c}`,
              }}
            >
              <div
                className="truncate font-bold"
                style={{ fontSize: nameSize, color: '#F0F4F9', lineHeight: 1.25 }}
              >
                {r.name}
                {r.seq && r.seq > 1 && (
                  <span className="ml-1 font-extrabold" style={{ color: '#FFC400' }}>
                    #{r.seq}
                  </span>
                )}
              </div>
              <div className="flex items-baseline justify-between gap-1">
                <span
                  className="font-mono font-extrabold"
                  style={{ fontSize: clockSize, color: c, letterSpacing: -0.5 }}
                >
                  {t}
                </span>
                <span
                  className="font-mono"
                  style={{ fontSize: Math.round(clockSize * 0.62), color: '#7D8B9B' }}
                >
                  {hm(new Date(r.due))}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * กราฟความหนาแน่น · แท่งละ 15 นาที
 *
 * ตอนรถน้อยเราใช้แถบต่อคัน แต่พอรถอยู่ในคลังพร้อมกันหลายสิบคัน
 * แถบต่อคันจะสูงจนเลื่อนไม่จบและอ่านไม่ได้
 *
 * พอรถเยอะ คำถามก็เปลี่ยนไปด้วย ไม่ใช่ "คันนี้เหลือเท่าไหร่" ซึ่งตารางตอบอยู่
 * แต่เป็น "อีกสองชั่วโมงจะมีรถครบกำหนดพร้อมกันกี่คัน" ซึ่งมีแต่กราฟนี้ที่ตอบได้
 */
export function Density({
  secs,
  now,
  big = false,
}: {
  /** เหลือกี่วินาทีของแต่ละคันที่ยังอยู่ในคลัง */
  secs: number[]
  now: number
  big?: boolean
}) {
  const BACK = 4 * 60 // ย้อนหลัง 4 ชั่วโมง
  const FWD = 8 * 60 // ไปข้างหน้า 8 ชั่วโมง
  const STEP = 15
  const n = (BACK + FWD) / STEP

  const buckets = new Array<number>(n).fill(0)
  for (const s of secs) {
    const m = Math.round(s / 60)
    const i = Math.floor((m + BACK) / STEP)
    if (i >= 0 && i < n) buckets[i] += 1
  }
  const max = Math.max(1, ...buckets)

  // ช่วงที่หนักที่สุดที่ยังมาไม่ถึง · บอกไว้ให้เห็นโดยไม่ต้องกวาดตาหาเอง
  let peak = 0
  let peakAt = -1
  buckets.forEach((v, i) => {
    const mins = (i - BACK / STEP) * STEP
    if (mins >= 0 && v > peak) {
      peak = v
      peakAt = mins
    }
  })

  const h = big ? 110 : 80
  return (
    <div>
      <div className="flex items-end gap-[2px]" style={{ height: h }}>
        {buckets.map((v, i) => {
          const mins = (i - BACK / STEP) * STEP
          const past = mins < 0
          const c = past ? '#394A5E' : v >= 11 ? '#FF5C5C' : v >= 8 ? '#FFB038' : '#35D98A'
          return (
            <div key={i} className="flex h-full flex-1 flex-col justify-end">
              {v >= 8 && (
                <div className="text-center text-[11px] font-bold" style={{ color: c }}>
                  {v}
                </div>
              )}
              <div
                style={{
                  height: `${(v / max) * 100}%`,
                  background: c,
                  borderRadius: '2px 2px 0 0',
                  minHeight: v > 0 ? 3 : 0,
                }}
              />
            </div>
          )
        })}
      </div>

      <div className="relative mt-1 h-[18px]">
        {[-4, -2, 0, 2, 4, 6, 8].map((k) => (
          <span
            key={k}
            className="absolute -translate-x-1/2 text-xs"
            style={{
              left: `${((k * 60 + BACK) / (BACK + FWD)) * 100}%`,
              color: k === 0 ? '#FFC400' : '#AFC0D4',
              fontWeight: k === 0 ? 700 : 400,
            }}
          >
            {k === 0 ? 'ตอนนี้' : hm(new Date(now + k * 3600_000))}
          </span>
        ))}
      </div>

      {peak >= 5 && peakAt >= 0 && (
        <p
          className="mt-2 rounded-lg px-3 py-2 text-sm"
          style={{ background: 'rgba(255,92,92,.12)', border: '1px solid #FF5C5C55', color: '#FF9A9A' }}
        >
          ช่วง {hm(new Date(now + peakAt * 60_000))}–{hm(new Date(now + (peakAt + 15) * 60_000))} มีรถครบกำหนดพร้อมกัน{' '}
          <b style={{ color: '#FFC2C2' }}>{peak} คัน</b>
        </p>
      )}
    </div>
  )
}
