import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { findItemByCode } from '../../lib/api'
import { useCart } from '../../lib/cart'
import { readableError } from '../../lib/supabase'
import type { Item } from '../../lib/types'
import { QtyStepper, Sheet, Spinner, StockBadge } from '../../components/ui'

/**
 * สแกนต่อเนื่อง — ทุกชิ้นที่สแกนไปรวมในตะกร้าเดียว
 * ใช้ BarcodeDetector ถ้าเบราว์เซอร์รองรับ ไม่งั้นตกไป @zxing/browser
 */
export default function Scan() {
  const nav = useNavigate()
  const cart = useCart()
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const busyRef = useRef(false)

  const [error, setError] = useState<string | null>(null)
  const [torch, setTorch] = useState(false)
  const [torchable, setTorchable] = useState(false)
  const [manual, setManual] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [found, setFound] = useState<Item | null>(null)
  const [qty, setQty] = useState(1)
  const [lookingUp, setLookingUp] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const handleCode = useCallback(
    async (code: string) => {
      if (busyRef.current) return
      busyRef.current = true
      setLookingUp(true)
      try {
        const item = await findItemByCode(code)
        if (!item) {
          setToast(`ไม่พบวัสดุสำหรับรหัส ${code}`)
          setTimeout(() => setToast(null), 2500)
        } else {
          navigator.vibrate?.(40)
          setFound(item)
          setQty(item.qty_on_hand > 0 ? 1 : 0)
        }
      } catch (e) {
        setError(readableError(e))
      } finally {
        setLookingUp(false)
        // หน่วงกันยิงซ้ำจากเฟรมถัดไป
        setTimeout(() => {
          busyRef.current = false
        }, 1200)
      }
    },
    [],
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
        const caps = track.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined
        setTorchable(Boolean(caps?.torch))

        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()

        const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector
        if (Detector) {
          const detector = new Detector({ formats: ['qr_code', 'code_128', 'ean_13'] })
          const loop = async () => {
            if (cancelled || !videoRef.current) return
            try {
              const hits = await detector.detect(videoRef.current)
              if (hits[0]?.rawValue) void handleCode(hits[0].rawValue)
            } catch {
              /* เฟรมนี้อ่านไม่ได้ ข้ามไป */
            }
            rafRef.current = requestAnimationFrame(() => void loop())
          }
          rafRef.current = requestAnimationFrame(() => void loop())
        } else {
          const reader = new BrowserMultiFormatReader()
          controlsRef.current = await reader.decodeFromVideoElement(video, (result) => {
            if (result) void handleCode(result.getText())
          })
        }
      } catch (e) {
        setError(
          (e as Error).name === 'NotAllowedError'
            ? 'ยังไม่ได้อนุญาตให้ใช้กล้อง เปิดสิทธิ์กล้องในเบราว์เซอร์แล้วลองใหม่ หรือใช้ปุ่มป้อนรหัสเอง'
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
  }, [handleCode])

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      const constraints = { advanced: [{ torch: !torch }] } as unknown as MediaTrackConstraints
      await track.applyConstraints(constraints)
      setTorch((t) => !t)
    } catch {
      setTorchable(false)
    }
  }

  function addToCart(thenGoToCart: boolean) {
    if (!found || qty <= 0) return
    cart.add(found, qty)
    setFound(null)
    if (thenGoToCart) nav('/cart')
    else {
      setToast(`ใส่ตะกร้าแล้ว · ${found.name} ${qty} ${found.unit}`)
      setTimeout(() => setToast(null), 2000)
    }
  }

  return (
    <div className="relative min-h-dvh bg-ink">
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />

      <div className="relative z-10 flex min-h-dvh flex-col">
        <header className="safe-t flex items-center gap-2 bg-ink/70 px-3 py-2 text-white">
          <button type="button" aria-label="ปิด" className="h-tap w-tap text-lg" onClick={() => nav(-1)}>
            ←
          </button>
          <h1 className="flex-1 font-display text-md">สแกน QR ที่ชั้นวาง</h1>
          {cart.count > 0 && (
            <button type="button" className="btn-primary h-tap px-3" onClick={() => nav('/cart')}>
              ตะกร้า {cart.count}
            </button>
          )}
        </header>

        <div className="flex flex-1 items-center justify-center p-6">
          <div className="relative aspect-square w-full max-w-[280px] rounded-panel border-2 border-brand-500/80">
            <span className="absolute -left-[2px] -top-[2px] h-8 w-8 rounded-tl-panel border-l-4 border-t-4 border-brand-500" />
            <span className="absolute -right-[2px] -top-[2px] h-8 w-8 rounded-tr-panel border-r-4 border-t-4 border-brand-500" />
            <span className="absolute -bottom-[2px] -left-[2px] h-8 w-8 rounded-bl-panel border-b-4 border-l-4 border-brand-500" />
            <span className="absolute -bottom-[2px] -right-[2px] h-8 w-8 rounded-br-panel border-b-4 border-r-4 border-brand-500" />
            {lookingUp && (
              <span className="absolute inset-0 flex items-center justify-center rounded-panel bg-ink/50">
                <Spinner className="border-white/40 border-t-white" />
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="mx-4 mb-3 rounded-card bg-danger-bg p-3 text-sm text-danger-txt">{error}</div>
        )}
        {toast && (
          <div className="mx-4 mb-3 rounded-card bg-success-bg p-3 text-center text-sm text-success-txt">
            {toast}
          </div>
        )}

        <div className="safe-b flex items-center justify-center gap-3 bg-ink/70 px-4 py-3">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void toggleTorch()}
            disabled={!torchable}
            title={torchable ? '' : 'อุปกรณ์นี้ไม่รองรับไฟฉาย'}
          >
            {torch ? 'ปิดไฟฉาย' : 'เปิดไฟฉาย'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setManualOpen(true)}>
            ป้อนรหัสเอง
          </button>
        </div>
      </div>

      <Sheet open={manualOpen} onClose={() => setManualOpen(false)} title="ป้อนรหัสวัสดุหรือ SKU">
        <input
          className="input"
          placeholder="SKU-CL-0091"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <button
          type="button"
          className="btn-primary mt-3 w-full"
          onClick={() => {
            setManualOpen(false)
            busyRef.current = false
            void handleCode(manual)
            setManual('')
          }}
        >
          ค้นหา
        </button>
      </Sheet>

      <Sheet open={Boolean(found)} onClose={() => setFound(null)} title={found?.name}>
        {found && (
          <>
            <p className="font-mono text-sm text-ink-400">
              {found.sku} · ชั้น {found.shelf_code ?? '—'}
            </p>
            <div className="mt-2">
              <StockBadge qty={found.qty_on_hand} min={found.min_qty} />
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="text-base text-ink-700">จำนวน ({found.unit})</span>
              <QtyStepper value={qty} max={found.qty_on_hand} min={0} onChange={setQty} />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={qty <= 0}
                onClick={() => addToCart(false)}
              >
                ใส่ตะกร้า · สแกนต่อ
              </button>
              <button
                type="button"
                className="btn-dark"
                disabled={qty <= 0}
                onClick={() => addToCart(true)}
              >
                ดูตะกร้า
              </button>
            </div>
          </>
        )}
      </Sheet>
    </div>
  )
}
