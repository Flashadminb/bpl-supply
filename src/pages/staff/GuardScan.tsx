import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { flagOsScan, guardScan, scanOsCard } from '../../lib/api'
import { readableError } from '../../lib/supabase'
import { CodeScanner } from '../../components/CodeScanner'
import { EvidenceImg } from '../../components/EvidenceThumbs'
import { StaffPage, TopBar } from '../../components/Shell'
import { ErrorBox, Sheet, Spinner } from '../../components/ui'
import { fmtDateTime } from '../../lib/format'
import type { OsScanHit } from '../../lib/types'

/**
 * หน้าสแกนบัตร OS ของ รปภ
 *
 * งานจริงคือ ยืนที่ประตู คนเดินมาเรื่อย ๆ ต้องตัดสินใจภายในไม่กี่วินาที
 * หน้าจอจึงต้องตอบสามอย่างให้ครบในหน้าจอเดียวโดยไม่ต้องเลื่อน
 *   คนนี้ใช่คนในรูปไหม · เครื่องที่ถือใช่เครื่องนี้ไหม · บัตรยังใช้ได้ไหม
 *
 * สีของแถบบนสุดคือคำตอบ อ่านจากระยะไกลได้โดยไม่ต้องอ่านตัวหนังสือ
 * เขียวผ่าน แดงไม่ผ่าน — ไม่มีสีเหลืองกลาง ๆ เพราะหน้างานต้องตัดสินใจ ไม่ใช่ลังเล
 */

const REASONS = [
  'หน้าไม่ตรงกับรูป',
  'เครื่องไม่ตรงกับ IMEI',
  'ถือเครื่องมากกว่าที่ลงทะเบียน',
  'ไม่มีบัตร / บัตรไม่ใช่ของตัวเอง',
  'อื่น ๆ',
]

export default function GuardScan() {
  const nav = useNavigate()
  const [sp] = useSearchParams()
  const [open, setOpen] = useState(false)
  const [hit, setHit] = useState<OsScanHit | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [at, setAt] = useState<string>('')

  /** นับเฉพาะในรอบที่เปิดหน้าอยู่ ไม่ได้ไปถามเซิร์ฟเวอร์เพิ่ม */
  const [done, setDone] = useState(0)
  const [bad, setBad] = useState(0)

  const [flagOpen, setFlagOpen] = useState(false)
  const [flagged, setFlagged] = useState(false)

  // อีกหน้าส่งโค้ดมาให้ · สแกนให้เลยครั้งเดียว ไม่ต้องให้ยกมือถือส่องซ้ำ
  const fired = useRef('')
  useEffect(() => {
    const t = sp.get('token')
    if (!t || fired.current === t) return
    fired.current = t
    void handle(t)
    // handle เป็นฟังก์ชันใหม่ทุก render ใส่เป็น dependency แล้วจะยิงซ้ำไม่จบ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp])

  /**
   * สแกนอะไรมาก็รับ แล้วให้ฐานข้อมูลบอกว่าเป็นบัตรอะไร
   *
   * รปภ ยืนที่ประตูเดียว แต่ของที่เดินผ่านมีสองอย่าง บัตร OS กับบัตรเบรค
   * บังคับให้เลือกหน้าก่อนสแกนคือบังคับให้เดาถูกก่อนจะได้เห็นคำตอบ
   * ซึ่งเดาผิดเมื่อไหร่ก็ขึ้นว่าไม่รู้จักบัตร ทั้งที่บัตรนั้นใช้ได้ปกติ
   *
   * ไม่เรียก os_scan ก่อนถาม เพราะมันบันทึกประวัติทุกครั้งที่เรียก
   * ยิงบัตรเบรคเข้าไปลองก็จะได้ประวัติสแกนปลอมเก็บไว้ทุกครั้ง
   */
  async function handle(code: string) {
    setBusy(true)
    setErr(null)
    setFlagged(false)
    try {
      const what = await guardScan(code)
      if (what.kind === 'break') {
        setOpen(false)
        nav(`/break/board?code=${encodeURIComponent(what.code)}`)
        return
      }
      const res = await scanOsCard(code)
      setHit(res)
      setAt(new Date().toISOString())
      setOpen(false)
      setDone((n) => n + 1)
      if (res.result !== 'ok') setBad((n) => n + 1)
    } catch (e) {
      setErr(readableError(e))
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  async function flag(reason: string) {
    if (!hit) return
    setBusy(true)
    try {
      await flagOsScan(hit.scan_id, reason)
      setFlagged(true)
      setFlagOpen(false)
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  const ok = hit?.result === 'ok'

  return (
    <>
      <TopBar title="สแกนบัตร OS" back="/" />
      <StaffPage nav={false}>
        {err && <ErrorBox message={err} />}

        {!hit && !busy && (
          <>
            <button
              type="button"
              className="w-full rounded-panel bg-ink px-4 py-8 text-center text-white"
              onClick={() => setOpen(true)}
            >
              <span aria-hidden className="block text-[40px] leading-none">
                ▣
              </span>
              <span className="mt-2 block font-display text-xl">เปิดกล้องสแกน</span>
              <span className="mt-1 block text-sm text-dark-text">
                ส่องที่ QR บนบัตรคล้องคอ
              </span>
            </button>

            <div className="card mt-3 flex items-center justify-between p-4">
              <span className="text-sm text-ink-500">รอบนี้สแกนไปแล้ว</span>
              <span className="text-right">
                <span className="font-display text-xl">{done}</span>
                <span className="ml-1 text-sm text-ink-400">ครั้ง</span>
                {bad > 0 && (
                  <span className="block text-xs text-danger-txt">มีปัญหา {bad} ครั้ง</span>
                )}
              </span>
            </div>
          </>
        )}

        {busy && !hit && (
          <div className="card flex min-h-[220px] items-center justify-center p-6">
            <Spinner />
          </div>
        )}

        {hit && (
          <>
            <div
              className={`rounded-card border p-4 text-center ${
                ok
                  ? 'border-success/25 bg-success-bg text-success-txt'
                  : 'border-danger/25 bg-danger-bg text-danger-txt'
              }`}
            >
              <p className="font-display text-2xl leading-tight">
                {ok && '✓ บัตรใช้ได้'}
                {hit.result === 'revoked' && '✕ บัตรถูกยกเลิก'}
                {hit.result === 'unknown' && '✕ ไม่รู้จักบัตรนี้'}
                {hit.result === 'inactive' && '✕ คนนี้ถูกปิดการใช้งาน'}
              </p>
              <p className="mt-1 text-sm">
                {ok && 'เทียบหน้ากับรูป แล้วเทียบเครื่องกับ IMEI'}
                {hit.result === 'revoked' &&
                  `ยกเลิกเมื่อ ${fmtDateTime(hit.revoked_at)}${
                    hit.revoked_by_name ? ` โดย ${hit.revoked_by_name}` : ''
                  } · ให้ไปรับบัตรใหม่ก่อน`}
                {hit.result === 'unknown' && 'โค้ดนี้ไม่มีอยู่ในระบบ · ยังไม่อนุญาตให้เข้า'}
                {hit.result === 'inactive' && 'ไม่อนุญาตให้นำเครื่องเข้าพื้นที่'}
              </p>
            </div>

            {hit.person_id && (
              <div className="card mt-3 p-3">
                <div className="flex gap-3">
                  <div className="h-[168px] w-[134px] shrink-0 overflow-hidden rounded-card bg-surface-2">
                    {hit.photo_file_id ? (
                      <EvidenceImg
                        fileId={hit.photo_file_id}
                        enabled
                        alt={hit.full_name ?? 'รูปพนักงาน OS'}
                        className="h-full w-full"
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center px-2 text-center text-xs text-warn-txt">
                        ยังไม่มีรูปในระบบ
                        <br />
                        ตรวจด้วยข้อมูลอื่นไปก่อน
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-lg leading-tight">{hit.full_name}</p>
                    <p className="mt-[2px] font-mono text-sm text-ink-500">
                      {hit.os_code ?? 'ไม่มีรหัส'}
                    </p>
                    {hit.nickname && (
                      <p className="text-sm text-ink-500">({hit.nickname})</p>
                    )}
                    <p className="mt-2">
                      <span className="badge bg-surface-2 text-ink-700">
                        สังกัด {hit.affiliation ?? '—'}
                      </span>
                    </p>
                    <p className="mt-2 text-sm text-ink-500">กะ {hit.shift ?? '—'}</p>
                  </div>
                </div>

                {/*
                  รุ่นกับ IMEI ตัวใหญ่ที่สุดในการ์ด
                  เพราะเป็นสองบรรทัดที่ รปภ ต้องอ่านเทียบกับของจริงในมือ
                */}
                <div className="mt-3 rounded-card bg-surface-2 p-3">
                  <p className="label mb-0">รุ่นโทรศัพท์</p>
                  <p className="font-display text-lg leading-tight">
                    {hit.phone_model ?? '— ไม่ได้ลงทะเบียนไว้ —'}
                  </p>
                  <p className="label mb-0 mt-2">IMEI</p>
                  <p className="break-all font-mono text-lg leading-tight">
                    {hit.imei ?? '— ไม่ได้ลงทะเบียนไว้ —'}
                  </p>
                </div>
              </div>
            )}

            <p className="mt-2 text-center text-xs text-ink-400">
              บันทึกเข้าระบบแล้ว · {fmtDateTime(at)}
              {hit.card_rev ? ` · บัตรใบที่ ${hit.card_rev}` : ''}
            </p>

            {flagged && (
              <p className="mt-2 rounded-card border border-warn/30 bg-warn-bg p-3 text-center text-sm text-warn-txt">
                แจ้งแล้ว · ผู้ตรวจสอบและทีม STD ได้รับเรียบร้อย
              </p>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="btn-dark min-h-[56px]"
                onClick={() => {
                  setHit(null)
                  setOpen(true)
                }}
              >
                สแกนคนต่อไป
              </button>
              <button
                type="button"
                className="btn-ghost min-h-[56px] border-danger/35 text-danger-txt"
                onClick={() => setFlagOpen(true)}
                disabled={flagged || busy}
              >
                {flagged ? 'แจ้งแล้ว' : 'แจ้งไม่ตรง'}
              </button>
            </div>
          </>
        )}
      </StaffPage>

      {open && (
        <CodeScanner
          title="ส่องที่ QR บนบัตร"
          hint="ส่องได้ทั้งบัตร OS และบัตรเบรค ระบบแยกให้เอง"
          formats={['qr_code']}
          onCode={(code) => {
            void handle(code)
          }}
          onClose={() => setOpen(false)}
        />
      )}

      {/*
        บังคับเลือกเหตุผล ไม่ให้พิมพ์อิสระอย่างเดียว
        แจ้งเตือนที่บอกแค่ "มีปัญหา" ทำให้คนรับต้องโทรถามอยู่ดี ซึ่งช้ากว่าไม่แจ้ง
      */}
      <Sheet open={flagOpen} onClose={() => setFlagOpen(false)} title="ไม่ตรงตรงไหน">
        <div className="space-y-2">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              className="w-full rounded-card border border-line px-3 py-4 text-left text-base"
              onClick={() => void flag(r)}
              disabled={busy}
            >
              {r}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  )
}
