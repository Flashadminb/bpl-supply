import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { readableError } from '../lib/supabase'

/**
 * กล้องสแกนโค้ดแบบเต็มจอ อ่านได้อย่างเดียว ไม่รู้จักว่าโค้ดคืออะไร
 * คนเรียกเป็นคนตัดสินใจเองว่าจะทำอะไรกับรหัสที่อ่านได้
 *
 * สแกนต่อเนื่องได้ ยิงรหัสเดิมซ้ำภายใน 1.2 วินาทีจะถูกกลืน
 * ใช้ BarcodeDetector ของเบราว์เซอร์ถ้ามี ไม่งั้นตกไป @zxing/browser
 */
export function CodeScanner({
  title,
  hint,
  onCode,
  onClose,
}: {
  title: string
  hint?: string
  /** คืนข้อความสั้น ๆ ไปโชว์เป็นแถบผลลัพธ์ · ok=false จะขึ้นสีแดง */
  onCode: (code: string) => { ok: boolean; message: string } | void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const lastRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })

  const [error, setError] = useState<string | null>(null)
  const [torch, setTorch] = useState(false)
  const [torchable, setTorchable] = useState(false)
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null)
  const [manual, setManual] = useState('')

  const handle = useCallback(
    (code: string) => {
      const now = Date.now()
      if (lastRef.current.code === code && now - lastRef.current.at < 1200) return
      lastRef.current = { code, at: now }
      const res = onCode(code.trim())
      if (res) {
        navigator.vibrate?.(res.ok ? 40 : [40, 60, 40])
        setToast(res)
        window.setTimeout(() => setToast(null), 2200)
      }
    },
    [onCode],
  )

  useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        const caps = track.getCapabilities?.() as
          | (MediaTrackCapabilities & { torch?: boolean })
          | undefined
        setTorchable(Boolean(caps?.torch))

        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()

        const Detector = (
          window as unknown as {
            BarcodeDetector?: new (o: { formats: string[] }) => {
              detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]>
            }
          }
        ).BarcodeDetector

        if (Detector) {
          const detector = new Detector({ formats: ['qr_code', 'code_128', 'ean_13'] })
          const loop = async () => {
            if (cancelled || !videoRef.current) return
            try {
              const hits = await detector.detect(videoRef.current)
              if (hits[0]?.rawValue) handle(hits[0].rawValue)
            } catch {
              /* เฟรมนี้อ่านไม่ได้ ข้ามไป */
            }
            rafRef.current = requestAnimationFrame(() => void loop())
          }
          rafRef.current = requestAnimationFrame(() => void loop())
        } else {
          const reader = new BrowserMultiFormatReader()
          controlsRef.current = await reader.decodeFromVideoElement(video, (result) => {
            if (result) handle(result.getText())
          })
        }
      } catch (e) {
        setError(
          (e as Error).name === 'NotAllowedError'
            ? 'ยังไม่ได้อนุญาตให้ใช้กล้อง เปิดสิทธิ์กล้องในเบราว์เซอร์แล้วลองใหม่ หรือพิมพ์รหัสเอง'
            : readableError(e),
        )
      }
    }

    void start()
    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      controlsRef.current?.stop()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [handle])

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch }] } as unknown as MediaTrackConstraints)
      setTorch((t) => !t)
    } catch {
      setTorchable(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink">
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />

      <div className="relative z-10 flex h-full flex-col">
        <header className="safe-t flex items-center gap-2 bg-ink/70 px-3 py-2 text-white">
          <button type="button" aria-label="ปิด" className="h-tap w-tap text-lg" onClick={onClose}>
            ←
          </button>
          <h2 className="flex-1 font-display text-md">{title}</h2>
          {torchable && (
            <button
              type="button"
              className="h-tap w-tap text-lg"
              aria-label="ไฟฉาย"
              onClick={() => void toggleTorch()}
            >
              {torch ? '🔦' : '💡'}
            </button>
          )}
        </header>

        <div className="flex flex-1 items-center justify-center p-6">
          <div className="relative aspect-square w-full max-w-[280px] rounded-panel border-2 border-brand-500/80">
            <span className="absolute -left-[2px] -top-[2px] h-8 w-8 rounded-tl-panel border-l-4 border-t-4 border-brand-500" />
            <span className="absolute -right-[2px] -top-[2px] h-8 w-8 rounded-tr-panel border-r-4 border-t-4 border-brand-500" />
            <span className="absolute -bottom-[2px] -left-[2px] h-8 w-8 rounded-bl-panel border-b-4 border-l-4 border-brand-500" />
            <span className="absolute -bottom-[2px] -right-[2px] h-8 w-8 rounded-br-panel border-b-4 border-r-4 border-brand-500" />
          </div>
        </div>

        <div className="safe-b bg-ink/80 p-3 text-white">
          {error ? (
            <p className="mb-2 rounded-card bg-danger-bg p-3 text-sm text-danger-txt">{error}</p>
          ) : (
            hint && <p className="mb-2 text-center text-sm text-white/80">{hint}</p>
          )}

          {toast && (
            <p
              className={`mb-2 rounded-card px-3 py-2 text-center text-sm ${
                toast.ok ? 'bg-success-bg text-success-txt' : 'bg-danger-bg text-danger-txt'
              }`}
            >
              {toast.message}
            </p>
          )}

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!manual.trim()) return
              handle(manual.trim())
              setManual('')
            }}
          >
            <input
              className="input flex-1"
              placeholder="หรือพิมพ์รหัสเอง"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
            />
            <button type="submit" className="btn-primary shrink-0 px-4">
              เพิ่ม
            </button>
          </form>

          <button type="button" className="btn-soft mt-2 w-full py-3" onClick={onClose}>
            เสร็จแล้ว กลับไปดูรายการ
          </button>
        </div>
      </div>
    </div>
  )
}
