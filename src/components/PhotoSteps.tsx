import { useEffect, useRef, useState } from 'react'
import { uploadEvidence } from '../lib/api'
import { compressImage, prettyBytes, releaseImage, type CompressedImage } from '../lib/image'
import { Spinner } from './ui'
import type { AssetPhotoInput, AssetPhotoStep } from '../lib/types'

/**
 * ถ่ายรูปหลักฐาน — รองรับสองแบบในตัวเดียว
 *
 *  มีขั้นตอน (Power Pallet)  ถ่ายทีละขั้นตามที่ตั้งไว้ กุญแจ → หน้า → หลัง → ซ้าย → ขวา
 *                            ข้ามไม่ได้ ถ่ายผิดกดถ่ายใหม่ได้
 *  ไม่มีขั้นตอน (ที่เหลือ)    ถ่ายอิสระ ขั้นต่ำ 1 ใบ สูงสุด 5 ใบ
 *
 * คำสั่ง "ถ่ายกุญแจ" โผล่บนการ์ดของเรา ไม่ได้ฝังลงในรูป
 * รูปที่บันทึกมีแค่ลายน้ำเวลากับชื่อคนเหมือนทุกที่ในระบบ
 * ส่วนว่ารูปไหนคือขั้นอะไร เก็บเป็นป้ายกำกับในฐานข้อมูลแทน
 *
 * อัปโหลดทันทีที่ถ่ายเสร็จ ไม่รอกดยืนยัน — พอกดส่งจริงจะได้ไม่ต้องรอนาน
 */

const CONCURRENCY = 2

export interface Shot {
  key: string
  seq: number
  label: string | null
  img: CompressedImage
  state: 'ready' | 'uploading' | 'done' | 'failed'
  fileId?: string
  webLink?: string | null
  bytes?: number | null
  error?: string
}

export function shotsToPhotos(shots: Shot[]): AssetPhotoInput[] {
  return shots
    .filter((s) => s.state === 'done' && s.fileId)
    .map((s) => ({
      file_id: s.fileId as string,
      web_link: s.webLink ?? null,
      bytes: s.bytes ?? null,
      seq: s.seq,
      label: s.label,
    }))
}

export function PhotoSteps({
  steps,
  maxFree,
  minFree = 1,
  stamp,
  shots,
  onShots,
  kind,
  namePrefix = 'asset',
}: {
  /** ขั้นตอนบังคับ — ว่างแปลว่าถ่ายอิสระ */
  steps: AssetPhotoStep[]
  maxFree: number
  /** ขั้นต่ำตอนถ่ายอิสระ · 0 = ไม่บังคับ เช่นตอนคืนแทน */
  minFree?: number
  stamp: string[]
  shots: Shot[]
  onShots: (next: Shot[] | ((prev: Shot[]) => Shot[])) => void
  /** โฟลเดอร์ปลายทางใน Drive · ไม่ส่งมา = โฟลเดอร์หลักเหมือนเดิม */
  kind?: 'evidence' | 'break'
  /** ขึ้นต้นชื่อไฟล์ใน Drive · ของเดิมขึ้นต้นด้วย asset ทุกใบไม่ว่าจะเป็นงานอะไร */
  namePrefix?: string
}) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const shotsRef = useRef<Shot[]>(shots)
  const uploadedRef = useRef<Set<string>>(new Set())
  // ยังอยู่บนหน้าจอไหม · ใช้ตัวนี้ตัดสิน ไม่ใช่รอบของ effect
  const mountedRef = useRef(true)
  const [compressing, setCompressing] = useState(false)
  // เดิมถ้าบีบอัดพัง จะเงียบสนิท วงหมุนหยุดแล้วไม่มีอะไรเกิดขึ้น
  // หน้างานจะกดถ่ายซ้ำไปเรื่อย ๆ โดยไม่รู้ว่าเกิดอะไรขึ้น และแจ้งกลับมาไม่ได้ว่าพังตรงไหน
  const [pickError, setPickError] = useState<string | null>(null)
  // ขั้นที่กำลังถ่ายอยู่ ใช้เฉพาะตอนมีขั้นตอนบังคับ
  const [target, setTarget] = useState<number | null>(null)

  useEffect(() => {
    shotsRef.current = shots
  }, [shots])
  useEffect(
    () => () => {
      mountedRef.current = false
      shotsRef.current.forEach((s) => releaseImage(s.img))
    },
    [],
  )

  const guided = steps.length > 0
  const cap = guided ? steps.length : maxFree
  const bySeq = new Map(shots.map((s) => [s.seq, s]))
  const nextStep = guided ? steps.find((st) => !bySeq.has(st.seq)) : undefined
  const doneCount = shots.filter((s) => s.state === 'done').length

  function openPicker(which: 'camera' | 'gallery', seq: number | null) {
    setTarget(seq)
    const el = which === 'camera' ? cameraRef.current : galleryRef.current
    if (el) {
      el.value = ''
      el.click()
    }
  }

  async function onPick(files: FileList | null) {
    if (!files || files.length === 0) return
    setPickError(null)
    setCompressing(true)
    try {
      const picked = Array.from(files)
      const added: Shot[] = []

      if (guided) {
        /**
         * เลือกทีเดียวหลายรูปได้ แล้วเติมลงขั้นที่ยังว่างตามลำดับ
         *
         * หน้างานถ่ายรอบคันรวดเดียว 4 รูปแล้วค่อยเลือกทีเดียว เร็วกว่าไล่ทีละขั้นมาก
         * ยังบังคับลำดับเหมือนเดิม รูปแรกที่เลือกลงขั้นที่ว่างขั้นแรก เรียงต่อไป
         * ถ้ากดถ่ายจากขั้นใดขั้นหนึ่งโดยตรง รูปแรกจะลงขั้นนั้นตามที่กด
         */
        const firstSeq = target ?? nextStep?.seq ?? 1
        const taken = new Set(shotsRef.current.map((x) => x.seq))
        const queue: number[] = [firstSeq]
        for (const st of steps) {
          if (st.seq !== firstSeq && !taken.has(st.seq)) queue.push(st.seq)
        }
        for (let i = 0; i < picked.length && i < queue.length; i++) {
          const seq = queue[i]
          const step = steps.find((st) => st.seq === seq)
          const img = await compressImage(picked[i], { stamp })
          added.push({
            key: `${seq}-${Date.now()}-${i}`,
            seq,
            label: step?.label ?? null,
            img,
            state: 'ready',
          })
        }
      } else {
        const room = cap - shots.length
        for (const f of picked.slice(0, Math.max(0, room))) {
          const img = await compressImage(f, { stamp })
          added.push({
            key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            seq: 0,
            label: null,
            img,
            state: 'ready',
          })
        }
      }

      if (added.length === 0) return
      onShots((prev) => {
        // ถ่ายซ้ำขั้นเดิม ให้ทับของเก่าแล้วคืนหน่วยความจำรูปเดิม
        if (guided) {
          const seqs = new Set(added.map((a) => a.seq))
          prev.filter((s) => seqs.has(s.seq)).forEach((s) => releaseImage(s.img))
          return [...prev.filter((s) => !seqs.has(s.seq)), ...added].sort((a, b) => a.seq - b.seq)
        }
        return [...prev, ...added]
      })
    } catch (e) {
      setPickError(
        `ใช้รูปนี้ไม่ได้: ${(e as Error).message} · ลองถ่ายใหม่ หรือเลือกจากคลังรูปแทน`,
      )
    } finally {
      setCompressing(false)
      setTarget(null)
    }
  }

  // อัปโหลดรูปที่ยังไม่ได้ส่ง ครั้งละสองใบ
  useEffect(() => {
    const queue = shots.filter((s) => s.state === 'ready' && !uploadedRef.current.has(s.key))
    if (queue.length === 0) return

    let running = 0
    let index = 0

    const pump = () => {
      while (running < CONCURRENCY && index < queue.length) {
        const shot = queue[index++]
        if (uploadedRef.current.has(shot.key)) continue
        uploadedRef.current.add(shot.key)
        running++
        onShots((prev) => prev.map((s) => (s.key === shot.key ? { ...s, state: 'uploading' } : s)))

        void uploadEvidence(shot.img.blob, `${namePrefix}-${shot.seq}-${shot.key}.webp`, kind)
          .then((res) => {
            if (!mountedRef.current) return
            onShots((prev) =>
              prev.map((s) =>
                s.key === shot.key
                  ? {
                      ...s,
                      state: 'done',
                      fileId: res.fileId,
                      webLink: res.webViewLink,
                      bytes: res.bytes,
                    }
                  : s,
              ),
            )
          })
          .catch((e) => {
            if (!mountedRef.current) return
            uploadedRef.current.delete(shot.key)
            onShots((prev) =>
              prev.map((s) =>
                s.key === shot.key ? { ...s, state: 'failed', error: (e as Error).message } : s,
              ),
            )
          })
          .finally(() => {
            running--
            if (mountedRef.current) pump()
          })
      }
    }
    pump()
    // ไม่มี cleanup ยกเลิก — ปล่อยให้อัปโหลดที่ค้างอยู่วิ่งจนจบเสมอ
  }, [shots, onShots, kind, namePrefix])

  function retry(key: string) {
    uploadedRef.current.delete(key)
    onShots((prev) => prev.map((s) => (s.key === key ? { ...s, state: 'ready', error: undefined } : s)))
  }

  function remove(key: string) {
    onShots((prev) => {
      prev.filter((s) => s.key === key).forEach((s) => releaseImage(s.img))
      return prev.filter((s) => s.key !== key)
    })
    uploadedRef.current.delete(key)
  }

  return (
    <div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void onPick(e.target.files)}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => void onPick(e.target.files)}
      />

      {guided ? (
        <>
          {nextStep ? (
            <div className="rounded-card border border-brand-300 bg-brand-50 p-4 text-center">
              <p className="text-sm text-ink-500">
                ขั้นที่ {shots.length + 1} จาก {steps.length}
              </p>
              <p className="mt-1 font-display text-lg">{nextStep.label}</p>
              {nextStep.hint && <p className="mt-1 text-sm text-ink-700">{nextStep.hint}</p>}

              <button
                type="button"
                className="btn-primary mt-3 w-full py-4 text-md"
                disabled={compressing}
                onClick={() => openPicker('camera', nextStep.seq)}
              >
                {compressing ? <Spinner /> : null} เปิดกล้อง
              </button>
              <button
                type="button"
                className="btn-ghost mt-1 w-full text-sm"
                disabled={compressing}
                onClick={() => openPicker('gallery', nextStep.seq)}
              >
                เลือกจากคลังรูป — เลือกหลายใบพร้อมกันได้
              </button>
            </div>
          ) : (
            <p className="rounded-card bg-success-bg px-3 py-2 text-center text-sm text-success-txt">
              ถ่ายครบ {steps.length} ขั้นแล้ว
            </p>
          )}

          {/* รายการขั้นตอนแบบมีเลข — หน้างานต้องรู้ตั้งแต่ต้นว่าต้องถ่ายอะไรบ้าง
              จุดเล็ก ๆ แบบเดิมบอกแค่ว่าเหลือกี่ขั้น แต่ไม่บอกว่าขั้นไหนคืออะไร */}
          <ul className="mt-2 space-y-1">
            {steps.map((st, i) => {
              const got = bySeq.get(st.seq)
              const isNext = nextStep?.seq === st.seq
              return (
                <li
                  key={st.seq}
                  className={`flex items-center gap-2 rounded-btn px-2 py-[6px] ${
                    isNext ? 'bg-brand-50' : ''
                  }`}
                >
                  <span
                    aria-hidden
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-pill text-xs font-semibold ${
                      got
                        ? 'bg-success text-white'
                        : isNext
                          ? 'bg-brand-500 text-ink'
                          : 'bg-line-2 text-ink-500'
                    }`}
                  >
                    {got ? '✓' : i + 1}
                  </span>
                  <span className={`flex-1 text-sm ${got ? 'text-ink-400' : 'text-ink'}`}>
                    {st.label}
                  </span>
                  {got && (
                    <button
                      type="button"
                      className="shrink-0 text-xs underline decoration-line-2"
                      onClick={() => openPicker('camera', st.seq)}
                    >
                      ถ่ายใหม่
                    </button>
                  )}
                </li>
              )
            })}
          </ul>

          <p className="mt-2 text-center text-sm text-ink-500">
            ถ่ายแล้ว <b className="text-ink">{shots.length}</b> จาก {steps.length} ใบ
            {shots.length < steps.length ? ` · เหลืออีก ${steps.length - shots.length}` : ' · ครบแล้ว'}
          </p>

          {pickError && (
            <p className="mt-1 rounded-btn bg-danger-bg px-2 py-1 text-center text-sm text-danger-txt">
              {pickError}
            </p>
          )}
        </>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-primary flex-1 py-4"
            disabled={compressing || shots.length >= cap}
            onClick={() => openPicker('camera', null)}
          >
            {compressing ? <Spinner /> : null} ถ่ายรูป
          </button>
          <button
            type="button"
            className="btn-soft flex-1 py-4"
            disabled={compressing || shots.length >= cap}
            onClick={() => openPicker('gallery', null)}
          >
            เลือกจากคลังรูป
          </button>
        </div>
      )}

      {!guided && (
        <p className="mt-1 text-center text-sm text-ink-400">
          {pickError && (
            <span className="mb-1 block rounded-btn bg-danger-bg px-2 py-1 text-danger-txt">
              {pickError}
            </span>
          )}
          ถ่ายแล้ว <b className="text-ink">{shots.length}</b> ใบ
          {minFree > 0
            ? shots.length >= minFree
              ? ' · ครบขั้นต่ำแล้ว'
              : ` · ต้องอีกอย่างน้อย ${minFree - shots.length} ใบ`
            : ' · ไม่บังคับ'}
          {cap < 99 ? ` · สูงสุด ${cap} ใบ` : ''}
        </p>
      )}

      {shots.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {shots.map((s) => (
            <li key={s.key} className="relative">
              <img
                src={s.img.objectUrl}
                alt={s.label ?? 'รูปหลักฐาน'}
                className="aspect-square w-full rounded-card object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 rounded-b-card bg-ink/70 px-1 py-[2px] text-center text-xs text-white">
                {s.state === 'uploading' && 'กำลังส่ง…'}
                {s.state === 'ready' && 'รอส่ง'}
                {s.state === 'done' && (s.label ?? prettyBytes(s.bytes))}
                {s.state === 'failed' && 'ส่งไม่สำเร็จ'}
              </div>
              {s.state === 'failed' && (
                <button
                  type="button"
                  className="absolute inset-0 rounded-card bg-danger-bg/85 text-sm font-medium text-danger-txt"
                  onClick={() => retry(s.key)}
                >
                  กดเพื่อส่งใหม่
                </button>
              )}
              {s.state !== 'uploading' && (
                <button
                  type="button"
                  aria-label="ลบรูปนี้"
                  className="absolute right-1 top-1 h-7 w-7 rounded-pill bg-ink/70 text-sm text-white"
                  onClick={() => remove(s.key)}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {shots.some((s) => s.state === 'failed') && (
        <p className="mt-2 rounded-card bg-danger-bg px-3 py-2 text-sm text-danger-txt">
          มีรูปที่ส่งไม่สำเร็จ กดที่รูปนั้นเพื่อส่งใหม่ — ส่งครบก่อนถึงจะยืนยันได้
        </p>
      )}

      <p className="mt-2 text-center text-xs text-ink-400">
        ส่งแล้ว {doneCount} จาก {shots.length} ใบ
      </p>
    </div>
  )
}
