import { supabase, readableError } from './supabase'
import { readXlsxSheets } from './xlsx'

/**
 * ของค้างส่งออก — ของที่ต้องออกจากฮับไปสาขาปลายทาง ตอนนี้ค้างอยู่ตรงไหน
 *
 * คนละเรื่องกับปล่อยรถและรถรอลงงาน
 *   ปล่อยรถ        รถที่จอดอยู่แล้วต้องออก
 *   รถรอลงงาน      รถที่มาถึงแล้วรอลงของ
 *   ของค้างส่งออก  ของที่ยังออกไม่ได้ แยกตามสาขาปลายทาง
 *
 * ต้นทางคือไฟล์ที่ระบบ HUB ส่งออกมาเป็น .xlsx ทุกครึ่งชั่วโมง
 * ซึ่งเป็น "ภาพนิ่ง ณ เวลาหนึ่ง" ไม่ใช่รายการงานที่กดเสร็จทีละอัน
 * ของที่มีค่าจริงจึงไม่ใช่ตัวเลข แต่คือมันขึ้นหรือลงจากรอบที่แล้ว
 *
 * กุญแจคือเวลาในชีต th_update_time ของไฟล์เอง ไม่ใช่เวลาที่กดอัป
 * อัปไฟล์เดิมซ้ำจึงไม่เกิดข้อมูลซ้ำ และอัปย้อนหลังไม่ทับรอบล่าสุด
 */

export interface OutTruck {
  /** 'YYYY-MM-DD HH:mm' เวลาไทย */
  at: string
  v: string | null
  p: boolean
}

export interface OutRow {
  dir: 'LH' | 'FD'
  station: string
  /** โซน D0x ของสาขา · null = ยังไม่ได้ตั้งที่หน้าหลังบ้าน */
  zone: string | null
  in_wh: number
  on_truck: number
  /** ค่าของรอบก่อนหน้า · null = รอบก่อนไม่มีสาขานี้ */
  prev_in: number | null
  prev_on: number | null
  waiting: number
  in_transit: number
  trucks: number
  main_trucks: number
  extra_trucks: number
  approving: number
  finding: number
  no_print: number
  trucks_list: OutTruck[]
}

export interface OutSnapshot {
  /** กี่สาขาที่ถูกปิดการโชว์ไว้ · ต้องโชว์ตัวเลขนี้เสมอ ไม่งั้นยอดจะไม่ตรงไฟล์แบบไร้เหตุผล */
  hidden_count?: number
  id: number
  snap_at: string
  uploaded_at: string
  file_name: string | null
  row_count: number
  truck_count: number
  prev_at: string | null
}

export interface OutBoard {
  snapshot: OutSnapshot | null
  rows: OutRow[]
}

export interface OutRun {
  id: number
  snap_at: string
  uploaded_at: string
  row_count: number
  truck_count: number
  /** ชื่อไฟล์ที่อัปขึ้นมา · ของเก่าก่อนมีช่องนี้จะว่าง */
  file_name: string | null
  /** ใครอัป · ว่างแปลว่าเป็นรอบเก่าที่ยังไม่ได้เก็บชื่อ หรือบัญชีถูกลบไปแล้ว */
  by_name: string
  by_code: string
}

/* ------------------------------------------------------------- อ่านไฟล์ */

/** หาคอลัมน์จากหัวตาราง · อิงข้อความจีนซึ่งคงที่กว่าคำแปลไทยที่ต่อท้าย */
function col(head: string[], needle: string): number {
  return head.findIndex((h) => (h ?? '').includes(needle))
}

const num = (v: string | undefined): number => {
  const n = Number(String(v ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? Math.round(n) : 0
}

/**
 * 'YYYY-MM-DD HH:mm[:ss]' เวลาไทย เป็น ISO
 *
 * ไฟล์ไม่ได้บอกเขตเวลามาด้วย แต่ชื่อชีตคือ th_update_time และเลขตรงกับนาฬิกาไทย
 * จึงต้องปักหมุดเป็น +07:00 เอง · ถ้าปล่อยให้เบราว์เซอร์เดา
 * เครื่องที่ตั้งเขตเวลาอื่นจะได้เวลาคนละอันกับของจริง แล้วรอบจะซ้อนกันเงียบ ๆ
 */
function thToIso(s: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s ?? '').trim())
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}+07:00`
}

export interface ParsedOut {
  snapIso: string
  snapText: string
  rows: Record<string, unknown>[]
  trucks: Record<string, unknown>[]
  stations: number
  printed: number
  notPrinted: number
}

export async function parseOutFile(file: File): Promise<ParsedOut> {
  const sheets = await readXlsxSheets(file)
  if (sheets.length === 0) throw new Error('ไฟล์นี้ไม่มีแผ่นงานข้างใน')

  /* เวลาของรอบ · อยู่แผ่นที่ชื่อ th_update_time ช่องใต้หัวตาราง */
  const tSheet =
    sheets.find((s) => /th_update_time/i.test(s.name)) ??
    sheets.find((s) => s.rows.some((r) => r.some((c) => /th_update_time|更新时间/.test(c ?? ''))))
  const rawSnap = tSheet?.rows.slice(1).flat().find((c) => thToIso(c ?? '')) ?? ''
  const snapIso = thToIso(rawSnap)
  if (!snapIso) {
    throw new Error('อ่านเวลาของรอบไม่ได้ · ไฟล์นี้ไม่มีชีต th_update_time หรือรูปแบบเวลาเปลี่ยนไป')
  }

  /* ตารางรายสาขา · หาแผ่นที่มีคอลัมน์สาขาถัดไป ไม่ได้เดาว่าเป็นแผ่นที่สาม */
  const dSheet = sheets.find((s) => s.rows[0]?.some((c) => (c ?? '').includes('下一站网点')))
  if (!dSheet) throw new Error('ไม่พบตารางรายสาขาในไฟล์ · หาคอลัมน์ 下一站网点 ไม่เจอ')

  const head = dSheet.rows[0] ?? []
  const ix = {
    dir: col(head, '方向'),
    station: col(head, '下一站网点'),
    waiting: col(head, '待发总量'),
    inTransit: col(head, '未到港在途单量'),
    arrivedIn: col(head, '到港未入仓单量'),
    baggedIn: col(head, '集包内包裹数'),
    inWh: col(head, '入仓未发出单量'),
    fdEarly: col(head, '02点前'),
    onTruck: col(head, '装车未出港单量'),
    trucks: col(head, '未发车当日规划车数'),
    main: col(head, '正班车车数'),
    extra: col(head, '加班车车数'),
    approving: col(head, '审批中车辆数'),
    finding: col(head, '找车中车辆数'),
    printed: col(head, '已打印出车凭证车数'),
    printedAt: col(head, '已打印发车凭证发车时间'),
    printedType: col(head, '已打印发车凭证车型'),
    noPrint: col(head, '未打印发车凭证车数'),
    noPrintAt: col(head, '未打印发车凭证发车时间'),
    noPrintType: col(head, '未打印发车凭证车型'),
  }
  if (ix.station < 0 || ix.inWh < 0 || ix.onTruck < 0) {
    throw new Error('หัวตารางในไฟล์เปลี่ยนไป · หาคอลัมน์หลักไม่ครบ')
  }

  const rows: Record<string, unknown>[] = []
  const trucks: Record<string, unknown>[] = []
  let printed = 0
  let notPrinted = 0

  const split = (v: string | undefined) =>
    String(v ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)

  for (const r of dSheet.rows.slice(1)) {
    const station = (r[ix.station] ?? '').trim()
    if (!station) continue
    const dirRaw = r[ix.dir] ?? ''
    const dir = dirRaw.includes('干线') ? 'LH' : 'FD'

    rows.push({
      dir,
      station,
      in_wh: num(r[ix.inWh]),
      on_truck: num(r[ix.onTruck]),
      waiting: num(r[ix.waiting]),
      in_transit: num(r[ix.inTransit]),
      arrived_in: num(r[ix.arrivedIn]),
      bagged_in: num(r[ix.baggedIn]),
      fd_early: num(r[ix.fdEarly]),
      trucks: num(r[ix.trucks]),
      main_trucks: num(r[ix.main]),
      extra_trucks: num(r[ix.extra]),
      approving: num(r[ix.approving]),
      finding: num(r[ix.finding]),
      printed: num(r[ix.printed]),
      no_print: num(r[ix.noPrint]),
    })

    /* แตกช่องข้อความที่เก็บเวลาปล่อยรถมาต่อกันด้วยคอมมา ออกเป็นคันละแถว
       นี่คือที่เดียวที่ตอบได้ว่า "คันไหนเลยเวลาแล้วยังไม่ปริ้นใบ"
       ซึ่งเป็นคำถามที่ลงมือได้ที่สุดในไฟล์ทั้งก้อน และไพวอทแตกให้ไม่ได้ */
    for (const [at, type, isP] of [
      [split(r[ix.printedAt]), split(r[ix.printedType]), true] as const,
      [split(r[ix.noPrintAt]), split(r[ix.noPrintType]), false] as const,
    ]) {
      at.forEach((t, i) => {
        const iso = thToIso(t)
        if (!iso) return
        trucks.push({ dir, station, depart_at: iso, vehicle: type[i] ?? null, printed: isP })
        if (isP) printed++
        else notPrinted++
      })
    }
  }

  if (rows.length === 0) throw new Error('ตารางรายสาขาในไฟล์ว่างเปล่า')

  return {
    snapIso,
    snapText: rawSnap.trim(),
    rows,
    trucks,
    stations: rows.length,
    printed,
    notPrinted,
  }
}

/* ----------------------------------------------------------------- api */

export async function importOut(p: ParsedOut, fileName: string) {
  const { data, error } = await supabase.rpc('hub_out_import', {
    p_snap: p.snapIso,
    p_file: fileName,
    p_rows: p.rows,
    p_trucks: p.trucks,
  })
  if (error) throw new Error(readableError(error))
  return data as { id: number; rows: number; trucks: number; snap_at: string }
}

export async function outBoard(): Promise<OutBoard> {
  const { data, error } = await supabase.rpc('hub_out_board')
  if (error) throw new Error(readableError(error))
  return (data ?? { snapshot: null, rows: [] }) as OutBoard
}

/** ถามแค่เวลาของรอบล่าสุด · ตอบบรรทัดเดียว ใช้เช็คบ่อย ๆ โดยไม่กิน egress */
export async function outLatest(): Promise<string | null> {
  const { data, error } = await supabase.rpc('hub_out_latest')
  if (error) throw new Error(readableError(error))
  return (data as string | null) ?? null
}

export async function undoOut(id: number) {
  const { error } = await supabase.rpc('hub_out_undo', { p_id: id })
  if (error) throw new Error(readableError(error))
}

export async function outRuns(limit = 48): Promise<OutRun[]> {
  const { data, error } = await supabase.rpc('hub_out_runs', { p_limit: limit })
  if (error) throw new Error(readableError(error))
  return (data ?? []) as OutRun[]
}

/* ------------------------------------------------------------ สถานะแถว */

export type OutState = 'late' | 'soon' | 'clear' | 'down' | 'flat' | 'new'

/** นาทีก่อนรถออกที่ถือว่า "ใกล้ถึงเวลา" */
export const SOON_MIN = 120

export interface OutCalc extends OutRow {
  work: number
  chg: number | null
  late: OutTruck[]
  soon: OutTruck[]
  state: OutState
}

/**
 * คิดสถานะเทียบกับเวลาของรอบ ไม่ใช่เทียบกับนาฬิกาตอนเปิดหน้า
 *
 * ถ้าเทียบกับนาฬิกาตอนเปิด คนที่เปิดหน้าช้าไปสองชั่วโมงจะเห็นรถแดงเต็มจอ
 * ทั้งที่รถอาจออกไปแล้วตั้งแต่รอบที่ไฟล์ยังไม่ได้ถ่าย — ตัวเลขผิดแย่กว่าไม่มีตัวเลข
 */
export function calcOut(rows: OutRow[], snapAt: string): OutCalc[] {
  const snap = new Date(snapAt).getTime()
  return rows.map((r) => {
    const at = (t: OutTruck) => new Date(t.at.replace(' ', 'T') + '+07:00').getTime()
    const late = r.trucks_list.filter((t) => !t.p && at(t) < snap)
    const soon = r.trucks_list.filter(
      (t) => !t.p && at(t) >= snap && at(t) - snap < SOON_MIN * 60_000,
    )
    const work = r.in_wh + r.on_truck
    const prev = r.prev_in === null ? null : (r.prev_in ?? 0) + (r.prev_on ?? 0)
    const chg = prev === null ? null : work - prev
    const state: OutState = late.length
      ? 'late'
      : soon.length
        ? 'soon'
        : chg === null
          ? 'new'
          : work === 0
            ? 'clear'
            : chg < 0
              ? 'down'
              : 'flat'
    return { ...r, work, chg, late, soon, state }
  })
}

/**
 * ป้ายสถานะ · เหลือเท่าที่บอกของที่ตัวเลขข้าง ๆ บอกไม่ได้
 *
 * ตัด "รถมีปัญหา" "ค้างเพิ่มขึ้น" และ "กำลังไล่ทัน" ออกตามที่เจ้าของระบบสั่ง
 * สามอันนั้นพูดซ้ำกับสิ่งที่อยู่บนแถวอยู่แล้ว — รถที่กำลังจัดหาขึ้นเป็นตัวเลขใต้ชื่อสาขา
 * ส่วนขึ้นหรือลงคือลูกศรแดงเขียวข้างตัวเลข ซึ่งอ่านเร็วกว่าป้ายคำ
 * ป้ายที่พูดซ้ำไม่ได้เพิ่มข้อมูล มีแต่ทำให้แถวรกจนป้ายที่สำคัญจริงหาไม่เจอ
 *
 * ค่าว่างแปลว่าแถวนั้นไม่ต้องมีป้าย
 */
export const OUT_STATE_TH: Record<OutState, string> = {
  late: 'เลยเวลายังไม่ปริ้นใบ',
  soon: 'ใกล้ถึงเวลา',
  clear: 'เคลียร์แล้ว',
  down: '',
  flat: '',
  new: 'สาขาใหม่',
}

/** ด่วนก่อน แล้วที่เหลือเรียงตามยอดค้างมากไปน้อย */
export const OUT_RANK: Record<OutState, number> = {
  late: 0,
  soon: 1,
  flat: 2,
  down: 2,
  new: 2,
  clear: 3,
}

/* ------------------------------------------------------- โซน D0x ของสาขา */

/**
 * โซนของสาขาปลายทาง · ตารางของตัวเอง ไม่ผูกกับรายชื่อสาขาของงานปล่อยรถ
 *
 * ดึงมาครั้งแรกจากงานปล่อยรถด้วย seedOutZones() ได้ 80 จาก 104 สาขา
 * ที่เหลือเจ้าของระบบตั้งเองที่หลังบ้าน และหลังจากนั้นสองระบบไม่ยุ่งกัน
 * ถ้าผูกกันตอนอ่าน วันที่ใครไปแก้ชื่อสาขาฝั่งปล่อยรถ โซนฝั่งนี้จะหายเงียบ ๆ
 */
export interface OutZoneRow {
  station: string
  /** ว่างได้ · สาขาที่เพิ่มเองหรือมีเฉพาะในไฟล์พัสดุ 24 ชม ยังไม่รู้ว่าอยู่สายไหน */
  dir: 'LH' | 'FD' | ''
  in_wh: number
  on_truck: number
  /** จำนวนพัสดุค้างเกิน 24 ชม ของสาขานี้ในรอบล่าสุด */
  p24: number
  zone: string | null
  note: string | null
  from_seed: boolean
  /** ปิดการโชว์ · ไม่ขึ้นบนกระดานและไม่ถูกนับในยอดรวม */
  hidden: boolean
  /** มาจากไหน · out ของค้างส่งออก · p24 พัสดุ 24 ชม · both ทั้งคู่ · manual เพิ่มเอง */
  src: 'out' | 'p24' | 'both' | 'manual'
}

export async function outZoneRows(): Promise<OutZoneRow[]> {
  const { data, error } = await supabase.rpc('hub_out_zone_rows')
  if (error) throw new Error(readableError(error))
  return (data ?? []) as OutZoneRow[]
}

/** เติมเฉพาะช่องที่ยังว่าง ไม่ทับของที่คนตั้งเอง · กดซ้ำกี่รอบก็ปลอดภัย */
export async function seedOutZones(): Promise<{ added: number; left: number }> {
  const { data, error } = await supabase.rpc('hub_out_zone_seed')
  if (error) throw new Error(readableError(error))
  return data as { added: number; left: number }
}

export async function setOutZone(station: string, zone: string, note?: string | null, hidden?: boolean) {
  const { error } = await supabase.rpc('hub_out_zone_set', {
    p_station: station,
    p_zone: zone,
    p_note: note ?? null,
    p_hidden: hidden ?? null,
  })
  if (error) throw new Error(readableError(error))
}

/** ลบแถวทิ้ง · ถ้าสาขายังอยู่ในไฟล์ มันจะกลับมาแบบไม่มีโซน ไม่ได้หายจากกระดาน */
export async function deleteOutZone(station: string) {
  const { error } = await supabase.rpc('hub_out_zone_delete', { p_station: station })
  if (error) throw new Error(readableError(error))
}

/** ปิดหรือเปิดการโชว์ทีละหลายสาขา */
export async function hideOutZoneMany(stations: string[], hidden: boolean): Promise<number> {
  const { data, error } = await supabase.rpc('hub_out_zone_hide_many', {
    p_stations: stations,
    p_hidden: hidden,
  })
  if (error) throw new Error(readableError(error))
  return (data as { n: number }).n
}

export async function setOutZoneMany(stations: string[], zone: string): Promise<number> {
  const { data, error } = await supabase.rpc('hub_out_zone_set_many', {
    p_stations: stations,
    p_zone: zone,
  })
  if (error) throw new Error(readableError(error))
  return (data as { n: number }).n
}
