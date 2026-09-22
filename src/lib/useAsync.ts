import { useCallback, useEffect, useRef, useState } from 'react'
import { readableError } from './supabase'

interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/** โหลดข้อมูลแบบง่าย พร้อม loading / error / reload ครบตาม definition of done */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    fnRef
      .current()
      .then((d) => {
        if (alive) setData(d)
      })
      .catch((e) => {
        if (alive) setError(readableError(e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  return { data, loading, error, reload: useCallback(() => setTick((t) => t + 1), []) }
}
