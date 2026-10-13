/**
 * คุยกับ Neon ผ่าน HTTP · เขียนเอง ไม่ลงไลบรารี
 *
 * Neon เปิดช่องทาง HTTP ให้ยิง SQL ตรง ๆ อยู่แล้ว ซึ่งเหมาะกับ Worker พอดี
 * เพราะ Worker เปิดการเชื่อมต่อแบบ TCP ค้างไว้ไม่ได้อยู่แล้ว
 *
 * ไลบรารีของ Neon ก็ห่อช่องทางเดียวกันนี้ · ส่วนที่เราต้องใช้จริงคือ
 * ยิง POST หนึ่งครั้งพร้อมคำสั่งกับพารามิเตอร์ ซึ่งสั้นกว่าการลงของพ่วงมาทั้งชุด
 * เหตุผลเดียวกับ xlsx.ts code128.ts และ auth.ts ในโปรเจกต์นี้
 *
 * ─────────────────────────────────────────────────────────────────
 * พารามิเตอร์ต้องส่งแยกเสมอ ห้ามต่อสตริงเข้าไปในคำสั่ง
 *
 * ทุกฟังก์ชันในนี้รับค่าเป็น params แยกจาก query เสมอ
 * ต่อสตริงเมื่อไหร่คือเปิดช่องให้คนยัดคำสั่งเข้ามาทางช่องค้นหา
 * ฝั่ง Supabase มี RLS คอยรับไม้สุดท้าย แต่ที่นี่ไม่มี พลาดคือพลาดเลย
 * ─────────────────────────────────────────────────────────────────
 */

export interface SqlResult<T = Record<string, unknown>> {
  rows: T[]
  rowCount: number
}

/** ดึงชื่อโฮสต์ออกจากสายเชื่อมต่อ · ช่อง HTTP อยู่ที่ https://<โฮสต์>/sql */
function hostOf(conn: string): string {
  try {
    return new URL(conn).hostname
  } catch {
    throw new Error('สายเชื่อมฐานข้อมูลผิดรูปแบบ')
  }
}

/**
 * ยิงคำสั่งเดียว
 *
 * โยนข้อผิดพลาดพร้อมข้อความจาก Postgres ตรง ๆ เพราะคนที่เห็นคือเราตอนแก้
 * ส่วนฝั่งที่ตอบกลับผู้ใช้จะเป็นคนตัดสินว่าจะบอกอะไรออกไป
 */
export async function sql<T = Record<string, unknown>>(
  conn: string,
  query: string,
  params: unknown[] = [],
): Promise<SqlResult<T>> {
  const res = await fetch(`https://${hostOf(conn)}/sql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Neon-Connection-String': conn,
      /* ให้ Postgres แปลงชนิดข้อมูลมาให้ จะได้ไม่ต้องแปลง jsonb เองทุกที่ */
      'Neon-Raw-Text-Output': 'false',
      'Neon-Array-Mode': 'false',
    },
    body: JSON.stringify({ query, params }),
  })

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`ฐานข้อมูลตอบ ${res.status} · ${t.slice(0, 300)}`)
  }

  const body = (await res.json()) as { rows?: T[]; rowCount?: number }
  return { rows: body.rows ?? [], rowCount: body.rowCount ?? 0 }
}

/** ยิงแล้วเอาค่าแรกช่องแรก · ฟังก์ชันฝั่งฐานข้อมูลคืน jsonb ก้อนเดียวเกือบทั้งหมด */
export async function one<T = unknown>(
  conn: string,
  query: string,
  params: unknown[] = [],
): Promise<T | null> {
  const r = await sql<Record<string, T>>(conn, query, params)
  if (!r.rows.length) return null
  const row = r.rows[0]
  const k = Object.keys(row)[0]
  return (row[k] ?? null) as T
}
