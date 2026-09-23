import { useCallback, useEffect, useRef, useState } from 'react'
import { countAssetExportRows, countSheetExportRows } from './api'
import { useAuth } from './auth'
import { MANAGER_ROLES } from './roles'

/**
 * นับบรรทัดที่ยังไม่ได้ส่งเข้า Google Sheet — ไว้ขึ้นเลขหลังเมนู
 *
 * เดิมต้องเปิดหน้าส่งออกถึงจะรู้ว่ามีอะไรค้าง ซึ่งไม่มีเหตุให้เปิดถ้าไม่สงสัยอยู่ก่อน
 * ของเลยค้างข้ามวันได้เรื่อย ๆ โดยไม่มีใครเห็น
 *
 * ย้อนหลังสองปีเพราะบรรทัดที่ค้างคือบรรทัดที่ "ยังไม่เคยส่ง"
 * ไม่ได้ผูกกับช่วงวันที่ที่กำลังดูอยู่ ของเก่าที่หลุดไปก็ยังต้องนับ
 */

const POLL_MS = 60_000
const LOOKBACK_DAYS = 730

export function usePendingExports(): { count: number; reload: () => void } {
  const { can } = useAuth()
  const isManager = can(...MANAGER_ROLES)
  const [count, setCount] = useState(0)
  const aliveRef = useRef(true)

  const check = useCallback(async () => {
    if (!isManager) return
    const range = {
      fromISO: new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString(),
      toISO: new Date().toISOString(),
    }
    try {
      const [supply, asset] = await Promise.all([
        countSheetExportRows(range),
        countAssetExportRows(range),
      ])
      if (aliveRef.current) setCount(supply.pending + asset.pending)
    } catch {
      // นับไม่ได้ก็ไม่ต้องขึ้นเลข ดีกว่าขึ้นเลขผิด
      if (aliveRef.current) setCount(0)
    }
  }, [isManager])

  useEffect(() => {
    aliveRef.current = true
    if (!isManager) {
      setCount(0)
      return
    }

    void check()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void check()
    }, POLL_MS)

    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      aliveRef.current = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [isManager, check])

  return { count, reload: () => void check() }
}
