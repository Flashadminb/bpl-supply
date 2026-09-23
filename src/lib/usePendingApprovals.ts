import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { MANAGER_ROLES } from './roles'

/**
 * นับคำขอที่รออนุมัติ แล้วเช็คซ้ำเรื่อย ๆ ระหว่างเปิดแอพค้างไว้
 *
 * ใช้ count แบบ head อย่างเดียว ไม่ดึงข้อมูลจริงมา ครั้งละไม่กี่ร้อยไบต์
 * จึงถามทุก 30 วินาทีได้โดยไม่กินแบนด์วิดท์
 * หยุดถามเมื่อสลับไปแท็บอื่นหรือพับมือถือ แล้วถามทันทีที่กลับมา
 */

const POLL_MS = 30_000

interface Pending {
  count: number
  /** เวลาที่คำขอเก่าสุดถูกสร้าง ไว้บอกว่ารอมานานแค่ไหน */
  oldestAt: string | null
  reload: () => void
}

export function usePendingApprovals(): Pending {
  const { can } = useAuth()
  const isManager = can(...MANAGER_ROLES)
  const [count, setCount] = useState(0)
  const [oldestAt, setOldest] = useState<string | null>(null)
  const aliveRef = useRef(true)

  const check = useCallback(async () => {
    if (!isManager) return
    const { count: n, error } = await supabase
      .from('requisitions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
    if (error || !aliveRef.current) return
    setCount(n ?? 0)

    if ((n ?? 0) === 0) {
      setOldest(null)
      return
    }
    const { data } = await supabase
      .from('requisitions')
      .select('created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
    if (aliveRef.current) setOldest(data?.[0]?.created_at ?? null)
  }, [isManager])

  useEffect(() => {
    aliveRef.current = true
    if (!isManager) {
      setCount(0)
      setOldest(null)
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

  // ขึ้นตัวเลขบนแท็บด้วย เผื่อเปิดเว็บทิ้งไว้แล้วไปทำอย่างอื่น
  useEffect(() => {
    const base = 'BPL SUPPLY'
    document.title = count > 0 ? `(${count}) ${base}` : base
    return () => {
      document.title = base
    }
  }, [count])

  return { count, oldestAt, reload: () => void check() }
}
