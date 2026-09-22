import { useEffect, useRef, useState } from 'react'
import { fetchEvidenceImage } from '../lib/api'
import { readableError } from '../lib/supabase'
import { Spinner } from './ui'

/**
 * โหลดรูปหลักฐานผ่าน Edge Function แล้วคืนเป็น object URL
 * enabled = false จะยังไม่โหลด ใช้คุมว่าโหลดเฉพาะรูปที่ถูกมองจริง
 * คืน URL ให้เบราว์เซอร์อัตโนมัติเมื่อเลิกใช้ กันหน่วยความจำรั่ว
 */
export function useEvidenceImage(fileId: string | null, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !fileId) return
    let alive = true
    setUrl(null)
    setError(null)
    fetchEvidenceImage(fileId)
      .then((u) => {
        if (!alive) {
          URL.revokeObjectURL(u)
          return
        }
        urlRef.current = u
        setUrl(u)
      })
      .catch((e) => alive && setError(readableError(e)))
    return () => {
      alive = false
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [fileId, enabled])

  return { url, error }
}

/** รูปหนึ่งใบ ขนาดกำหนดเอง โหลดเมื่อ enabled เท่านั้น */
export function EvidenceImg({
  fileId,
  enabled,
  className = '',
  alt = 'หลักฐาน',
  onClick,
}: {
  fileId: string
  enabled: boolean
  className?: string
  alt?: string
  onClick?: () => void
}) {
  const { url, error } = useEvidenceImage(fileId, enabled)

  const body = url ? (
    <img src={url} alt={alt} className="h-full w-full object-cover" />
  ) : error ? (
    <span className="flex h-full w-full items-center justify-center text-xs text-danger-txt" title={error}>
      !
    </span>
  ) : (
    <span className="flex h-full w-full items-center justify-center">
      <Spinner className="h-3 w-3" />
    </span>
  )

  if (!onClick) return <div className={className}>{body}</div>
  return (
    <button type="button" className={className} onClick={onClick} title="กดเพื่อดูรูปใหญ่">
      {body}
    </button>
  )
}

/**
 * ช่องรูปในตาราง — โชว์ใบแรก ชี้ค้าง (หรือกดบนมือถือ) แล้วรูปที่เหลือเด้งขึ้นมาครบ
 *
 * ทำไมไม่โชว์ทุกใบแต่แรก: ถ้าตารางมี 25 แถว แถวละ 5 ใบ จะยิงโหลด 125 รูปรวดเดียว
 * แบบนี้โหลดเฉพาะแถวที่ถูกมองจริง ๆ เท่านั้น
 */
export function ThumbStrip({
  fileIds,
  onOpen,
}: {
  fileIds: string[]
  onOpen: (index: number) => void
}) {
  const [inView, setInView] = useState(false)
  const [peek, setPeek] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number>(0)

  const many = fileIds.length > 1

  // รูปใบแรกโหลดเมื่อแถวเลื่อนเข้ามาในจอ
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (e) => {
        if (e.some((x) => x.isIntersecting)) {
          setInView(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // ปิดแผงเมื่อเลื่อนหน้าจอ ไม่งั้นแผงจะลอยค้างผิดที่
  useEffect(() => {
    if (!peek) return
    const close = () => setPeek(false)
    window.addEventListener('scroll', close, true)
    return () => window.removeEventListener('scroll', close, true)
  }, [peek])

  function open() {
    if (!many) return
    window.clearTimeout(closeTimer.current)
    const r = boxRef.current?.getBoundingClientRect()
    if (r) setAnchor({ top: r.bottom + 6, left: r.left })
    setPeek(true)
  }

  function delayedClose() {
    closeTimer.current = window.setTimeout(() => setPeek(false), 180)
  }

  return (
    <div
      ref={boxRef}
      className="relative inline-block"
      onMouseEnter={open}
      onMouseLeave={delayedClose}
      onFocus={open}
    >
      <EvidenceImg
        fileId={fileIds[0]}
        enabled={inView}
        className="block h-[52px] w-[52px] overflow-hidden rounded-btn border border-line bg-surface-2"
        onClick={() => (many ? (peek ? onOpen(0) : open()) : onOpen(0))}
      />

      {many && (
        <span className="pointer-events-none absolute -right-1 -top-1 rounded-pill bg-ink px-[6px] font-display text-[10px] leading-[16px] text-white">
          {fileIds.length}
        </span>
      )}

      {peek && anchor && (
        <div
          className="fixed z-50 flex gap-2 rounded-card border border-line bg-surface p-2 shadow-pop"
          style={{ top: anchor.top, left: Math.max(8, Math.min(anchor.left, window.innerWidth - 360)) }}
          onMouseEnter={() => window.clearTimeout(closeTimer.current)}
          onMouseLeave={delayedClose}
        >
          {fileIds.map((id, i) => (
            <EvidenceImg
              key={id}
              fileId={id}
              enabled
              alt={`หลักฐานใบที่ ${i + 1}`}
              className="h-[96px] w-[96px] shrink-0 overflow-hidden rounded-btn border border-line bg-surface-2"
              onClick={() => {
                setPeek(false)
                onOpen(i)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
