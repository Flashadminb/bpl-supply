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

/**
 * สีตามเวลาที่เหลือ · ต้องตรงกับขั้นของเสียงเตือนเป๊ะ ๆ
 *
 * เขียวยังมีเวลา · เหลืองเหลือ 20 นาที · ส้มเหลือ 10 นาที · แดงเลยกำหนด
 *
 * เดิมเหลืองเริ่มที่ 30 นาที ซึ่งไม่ตรงกับเสียงที่ดังตอน 20 นาที
 * คนจะเห็นป้ายเปลี่ยนสีก่อนได้ยินเสียงสิบนาที แล้วเรียนรู้ว่าสีกับเสียงไม่เกี่ยวกัน
 * พอถึงวันที่ต้องเชื่ออย่างใดอย่างหนึ่ง เขาจะไม่เชื่อทั้งสองอย่าง
 */
export function tone(sec: number) {
  if (sec < 0) return '#FF5C5C'
  if (sec <= 10 * 60) return '#FF8A3D'
  if (sec <= 20 * 60) return '#FFC400'
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
export interface MiniRow {
  id: number
  name: string
  code: string | null
  due: string
  sec: number
  seq?: number
  zone?: string | null
}

/**
 * ทุกคันในคลัง · แน่นที่สุดเท่าที่ยังอ่านออก
 *
 * ตัดวินาทีออกจากช่องเล็กโดยตั้งใจ
 * วินาทีมีประโยชน์ตอนเหลือสิบนาทีสุดท้าย ซึ่งคันนั้นขึ้นไปอยู่การ์ดใหญ่แล้ว
 * ส่วนคันที่เหลืออีกสองชั่วโมง วินาทีเป็นแค่ตัวเลขที่กระพริบแล้วกินที่
 *
 * แยกหัวข้อตามโซน เพราะหน้างานยืนประจำโซน
 * รายการที่คละทุกโซนปนกัน แปลว่าทุกคนต้องกวาดตาทั้งจอเพื่อหาของตัวเอง
 */
export function MiniGrid({
  rows,
  now,
  title,
  onPick,
  byZone = false,
}: {
  rows: MiniRow[]
  now: number
  title?: string
  /** จิ้มช่องแล้วทำอะไรต่อ · ไม่ส่งมาก็เป็นช่องอ่านอย่างเดียวเหมือนเดิม */
  onPick?: (id: number) => void
  /** แยกเป็นกลุ่มตามโซน */
  byZone?: boolean
}) {
  void now
  const n = rows.length
  if (n === 0) return null

  if (byZone) {
    const groups = new Map<string, MiniRow[]>()
    for (const r of rows) {
      const k = r.zone || 'ไม่ระบุโซน'
      const g = groups.get(k)
      if (g) g.push(r)
      else groups.set(k, [r])
    }
    const keys = [...groups.keys()].sort()
    return (
      <div>
        {title && (
          <p className="mb-2 text-lg font-bold" style={{ color: '#AFC0D4' }}>
            {title} <span style={{ color: '#5A646F' }}>{n} คัน · {keys.length} โซน</span>
          </p>
        )}
        <div className="space-y-2">
          {keys.map((k) => (
            <div key={k} className="flex items-start gap-2">
              <span
                className="mt-[2px] shrink-0 rounded-md px-2 py-1 font-mono text-sm font-extrabold"
                style={{ background: '#1B2430', color: '#7FD1FF', minWidth: 58, textAlign: 'center' }}
              >
                {k}
                <span className="ml-1 text-xs" style={{ color: '#5A646F' }}>
                  {groups.get(k)!.length}
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <Tiles rows={groups.get(k)!} total={n} onPick={onPick} />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      {title && (
        <p className="mb-2 text-lg font-bold" style={{ color: '#AFC0D4' }}>
          {title} <span style={{ color: '#5A646F' }}>{n} คัน</span>
        </p>
      )}
      <Tiles rows={rows} total={n} onPick={onPick} />
    </div>
  )
}

function Tiles({ rows, total, onPick }: { rows: MiniRow[]; total: number; onPick?: (id: number) => void }) {
  const n = total
  const w = n <= 16 ? 176 : n <= 40 ? 138 : n <= 90 ? 110 : 92
  const nameSize = n <= 16 ? 14 : n <= 40 ? 12.5 : n <= 90 ? 11.5 : 10.5
  const clockSize = n <= 16 ? 21 : n <= 40 ? 18 : n <= 90 ? 16 : 14
  const withSec = false

  return (
    <>
      <div
        className="grid gap-[5px]"
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
              className={`overflow-hidden rounded-lg px-2 py-1.5 ${onPick ? 'cursor-pointer active:opacity-70' : ''}`}
              role={onPick ? 'button' : undefined}
              tabIndex={onPick ? 0 : undefined}
              onClick={onPick ? () => onPick(r.id) : undefined}
              style={{
                background: late ? 'rgba(255,92,92,.1)' : '#121820',
                borderLeft: `4px solid ${c}`,
              }}
            >
              {/*
                ตัวย่อกับชื่อไทยตัวเท่ากัน

                หน้างานอ่านตัวย่อเป็นหลัก ส่วนชื่อไทยไว้ยืนยันว่าอ่านไม่ผิดสาขา
                การย่อตัวย่อให้เล็กกว่าจึงเท่ากับย่อสิ่งที่เขาใช้จริงให้เล็กกว่าสิ่งที่เขาใช้รอง
              */}
              <div
                className="flex items-baseline gap-1 truncate"
                style={{ fontSize: nameSize, color: '#F0F4F9', lineHeight: 1.25 }}
              >
                {r.code && (
                  <span className="font-mono font-extrabold" style={{ color: '#FFC400' }}>
                    {r.code}
                  </span>
                )}
                <span className="truncate font-bold">{r.name}</span>
                {r.seq && r.seq > 1 && (
                  <span className="font-extrabold" style={{ color: '#FFC400' }}>
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
    </>
  )
}

/**
 * การ์ดสรุปรายโซน · แทนที่กราฟความหนาแน่นบนจอทีวี
 *
 * กราฟความหนาแน่นตอบว่า "อีกกี่นาทีจะมีรถครบกำหนดพร้อมกันกี่คัน"
 * ซึ่งเป็นคำถามของคนวางแผน ไม่ใช่คำถามของคนที่ยืนอยู่ในโซน
 * คนในโซนถามว่า "โซนฉันมีกี่คัน ตกไปแล้วกี่คัน" ซึ่งกราฟนั้นตอบไม่ได้เลย
 */
export function ZoneCards({
  rows,
  onPick,
}: {
  rows: { zone?: string | null; sec: number }[]
  onPick?: (zone: string) => void
}) {
  const g = new Map<string, { n: number; late: number; soon: number; next: number }>()
  for (const r of rows) {
    const k = r.zone || 'ไม่ระบุ'
    const v = g.get(k) ?? { n: 0, late: 0, soon: 0, next: Infinity }
    v.n += 1
    if (r.sec < 0) v.late += 1
    else if (r.sec <= 20 * 60) v.soon += 1
    if (r.sec >= 0 && r.sec < v.next) v.next = r.sec
    g.set(k, v)
  }
  const keys = [...g.keys()].sort()
  if (keys.length === 0) return null

  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${keys.length > 6 ? 150 : 190}px, 1fr))` }}
    >
      {keys.map((k) => {
        const v = g.get(k)!
        const c = v.late > 0 ? '#FF5C5C' : v.soon > 0 ? '#FFC400' : '#35D98A'
        const next = v.next === Infinity ? null : v.next
        return (
          <div
            key={k}
            className={`rounded-xl px-3 py-3 ${onPick ? 'cursor-pointer active:opacity-70' : ''}`}
            role={onPick ? 'button' : undefined}
            onClick={onPick ? () => onPick(k) : undefined}
            style={{ background: '#121820', borderTop: `3px solid ${c}` }}
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-2xl font-extrabold" style={{ color: '#7FD1FF' }}>
                {k}
              </span>
              <span className="text-2xl font-extrabold">{v.n}</span>
              <span className="text-sm" style={{ color: '#AFC0D4' }}>
                คัน
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 text-sm">
              <span style={{ color: v.late ? '#FF5C5C' : '#5A646F' }}>เลย {v.late}</span>
              <span style={{ color: v.soon ? '#FFC400' : '#5A646F' }}>ใกล้ {v.soon}</span>
            </div>
            {next !== null && (
              <div className="mt-1 font-mono text-sm" style={{ color: '#AFC0D4' }}>
                คันถัดไป {p2(Math.floor(next / 3600))}:{p2(Math.floor(next / 60) % 60)}
              </div>
            )}
            {/* แถบสัดส่วน · เห็นทันทีว่าโซนนี้แดงไปแค่ไหน */}
            <div className="mt-2 flex h-[6px] overflow-hidden rounded-full" style={{ background: '#0B0E11' }}>
              <span style={{ width: `${(v.late / v.n) * 100}%`, background: '#FF5C5C' }} />
              <span style={{ width: `${(v.soon / v.n) * 100}%`, background: '#FFC400' }} />
              <span style={{ width: `${((v.n - v.late - v.soon) / v.n) * 100}%`, background: '#35D98A' }} />
            </div>
          </div>
        )
      })}
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
