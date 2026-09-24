import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { canProxy } from './roles'

/**
 * นับเช็คอินประชุมที่ยังไม่ได้ตรวจ — ขึ้นเลขท้ายเมนู
 *
 * นับอย่างเดียว ไม่ดึงแถว เพราะถามซ้ำทุกนาทีตลอดเวลาที่เปิดหน้าแอดมินค้างไว้
 */

const POLL_MS = 60_000

export function usePendingMeetings(): { count: number; reload: () => void } {
  const { profile } = useAuth()
  const may = canProxy(profile)
  const [count, setCount] = useState(0)
  const aliveRef = useRef(true)

  const check = useCallback(async () => {
    if (!may) return
    const { count: n, error } = await supabase
      .from('meeting_checkins')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
    if (error || !aliveRef.current) return
    setCount(n ?? 0)
  }, [may])

  useEffect(() => {
    aliveRef.current = true
    if (!may) {
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
  }, [may, check])

  return { count, reload: () => void check() }
}
