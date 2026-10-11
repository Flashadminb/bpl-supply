import { useEffect, useState } from 'react'
import { listDeptNames, listPositionNames } from './api'

/**
 * แปลรหัสแผนกเป็นชื่อแผนก
 *
 * แผนกชุดแรกตั้งรหัสด้วยมือไว้อ่านออก เช่น OUT4W, REPACK
 * แต่แผนกที่สร้างทีหลังผ่านหน้าหลังบ้าน ระบบออกรหัสให้เองเป็นเลขสุ่ม
 * เช่น QC ได้รหัส D267C7A · ซึ่งถูกตามที่ออกแบบไว้ เพราะรหัสต้องไม่เปลี่ยน
 * จะได้เปลี่ยนชื่อแผนกทีหลังโดยของที่ผูกไว้ไม่ขาด
 *
 * ปัญหาคือหลายหน้าพิมพ์รหัสออกจอตรง ๆ เพราะตอนเขียนรหัสยังอ่านออกอยู่
 * พอมีแผนกใหม่ หน้าเหล่านั้นก็ขึ้น D267C7A ให้คนหน้างานอ่าน
 *
 * แก้ที่เดียวจบด้วยพจนานุกรมกลาง โหลดครั้งเดียวต่อการเปิดแอพหนึ่งครั้ง
 * ไม่ใช่ครั้งเดียวต่อหนึ่งหน้าจอ เพราะแผนกมีสิบแถวแต่หน้าที่ใช้มียี่สิบหน้า
 * ยี่สิบคำขอต่อการเปิดแอพหนึ่งครั้ง คือโควตาที่จ่ายทิ้งโดยไม่ได้อะไรกลับมา
 *
 * เอาทุกแผนกรวมที่ปิดใช้งานแล้ว เพราะคนที่ยังสังกัดแผนกที่เพิ่งปิด
 * ก็ยังต้องเห็นชื่อแผนกของตัวเอง ไม่ใช่เห็นรหัสเพราะแผนกถูกปิดไปเมื่อวาน
 */

let cache: Map<string, string> | null = null
let posCache: Map<string, string> | null = null
let inflight: Promise<void> | null = null
const waiters = new Set<() => void>()

function load(): Promise<void> {
  if (!inflight) {
    // ขอสองตารางพร้อมกัน · เป็นคนละคำขอแต่เสียเวลารอรอบเดียว
    inflight = Promise.all([listDeptNames(), listPositionNames()])
      .then(([depts, poss]) => {
        cache = new Map(depts.map((d) => [d.code, d.name]))
        posCache = new Map(poss.map((p) => [p.code, p.name]))
        waiters.forEach((w) => w())
      })
      .catch(() => {
        // โหลดไม่ได้ก็ไม่เป็นไร · deptName จะคืนรหัสไปก่อนเหมือนของเดิม
        // แต่ปล่อยให้ลองใหม่ได้ ไม่ใช่ค้างว่าเคยลองแล้วตลอดอายุแท็บ
        inflight = null
      })
  }
  return inflight
}

/**
 * ชื่อแผนกจากรหัส
 *
 * ยังโหลดไม่เสร็จ หรือเป็นรหัสที่ไม่รู้จัก ให้คืนรหัสไปก่อน
 * รหัสที่อ่านยากยังดีกว่าช่องว่าง เพราะอย่างน้อยยังเอาไปถามต่อได้
 */
export function deptName(code?: string | null, fallback = '—'): string {
  if (!code) return fallback
  return cache?.get(code) ?? code
}

/**
 * ชื่อตำแหน่งงานจากรหัส
 *
 * ว่าง = ยังไม่ได้ตั้งตำแหน่งให้คนนี้ ซึ่งต่างจาก "ไม่มีตำแหน่ง"
 * จึงคืนค่าว่างเปล่าเป็นค่าตั้งต้น ให้ฝั่งหน้าจอเลือกเองว่าจะเขียนว่าอะไร
 */
export function positionName(code?: string | null, fallback = ''): string {
  if (!code) return fallback
  return posCache?.get(code) ?? code
}

/** ชื่อตำแหน่งแบบมีตัวคั่นนำหน้า · ไม่มีตำแหน่งก็ไม่ต้องมีจุดคั่นค้างไว้ */
export function positionSuffix(code?: string | null, sep = ' · '): string {
  return code ? sep + positionName(code) : ''
}

/** ชื่อแผนกแบบมีตัวคั่นนำหน้า · ใช้ต่อท้ายข้อความ ว่างแล้วไม่ต้องมีจุด */
export function deptSuffix(code?: string | null, sep = ' · '): string {
  return code ? sep + deptName(code) : ''
}

/**
 * โหลดพจนานุกรมและวาดจอใหม่เมื่อโหลดเสร็จ
 *
 * เรียกที่ราก App ครั้งเดียว ไม่ต้องเรียกทุกหน้า
 * พอโหลดเสร็จรากวาดใหม่หนึ่งรอบ ทุกหน้าที่เรียก deptName จึงได้ชื่อพร้อมกันหมด
 * ซึ่งแปลว่าหน้าอื่น ๆ เรียก deptName ได้เหมือนฟังก์ชันธรรมดา ไม่ต้องรู้เรื่องฮุก
 */
export function useDeptNames() {
  const [, bump] = useState(0)
  useEffect(() => {
    if (cache && posCache) return
    const wake = () => bump((n) => n + 1)
    waiters.add(wake)
    void load()
    return () => {
      waiters.delete(wake)
    }
  }, [])
}
