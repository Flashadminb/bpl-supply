import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { guardScan } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import { stampLines } from '../../lib/image'
import { CodeScanner } from '../../components/CodeScanner'
import { EvidenceImg } from '../../components/EvidenceThumbs'
import { PhotoSteps, shotsToPhotos, type Shot } from '../../components/PhotoSteps'
import { StaffPage, TopBar } from '../../components/Shell'
import { BreakBanBar } from '../../components/BreakBanBar'
import { ErrorBox, Sheet, Spinner, EmptyState } from '../../components/ui'
import { fmtDateTime } from '../../lib/format'
import {
  breakGateOut,
  breakProblem,
  breakReturn,
  countdown,
  breakBanNext,
  breakBanNow,
  countOpenPasses,
  listBreakBoard,
  scanBreakCard,
  type BreakScan,
} from '../../lib/breakPass'

/**
 * เบรค OS — หน้าของ รปภ
 *
 * กฎทั้งหมดของ รปภ เหลือประโยคเดียว
 *   **ขาออกต้องเห็นเขียว** เห็นสีอื่นไม่ปล่อย · ขากลับกดปุ่มที่มีให้
 *
 * การสแกนไม่เปลี่ยนอะไรทันที แค่เปิดจอให้ดู แล้วมีปุ่มเดียวให้กดเสมอ
 * ที่ต้องแยกการอ่านออกจากการกระทำ เพราะคนที่ยืนอยู่ตรงหน้าอาจกำลังจะออก
 * หรือเพิ่งกลับก็ได้ ระบบแยกไม่ออก แต่ รปภ เห็นเองว่าเขาเดินไปทางไหน
 *
 * ถ้าปล่อยให้สแกนแล้วทำงานเลย คนถือบัตรสำเนาที่เดินมาขาออกจะทำให้เวลาหยุดผิด
 * ทั้งที่เจ้าตัวยังอยู่ข้างนอก ซึ่งแก้ย้อนหลังไม่ได้
 */

type Pending = { pass: Extract<BreakScan, { state: 'ready' | 'out' }>; code: string }

export default function BreakGuard() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const [sp] = useSearchParams()
  /**
   * สองนาฬิกา ไม่ใช่อันเดียว
   *
   * tick  กระดานของตัวเอง · นาทีละครั้ง
   * slow  ช่วงห้ามเบรค · ห้านาทีครั้ง เพราะตารางห้ามเปลี่ยนไม่กี่ครั้งต่อเดือน
   *
   * ของเดิมยิงทั้งสี่คำขอทุก 15 วินาที รวมประวัติ 24 ชั่วโมงของทั้งฮับ 80 แถว
   * วัดจริงแล้วตกราว 740 MB ต่อวันเมื่อ รปภ สองเครื่องเปิดค้างครบวัน
   * ซึ่งกินโควต้าฟรี 5 GB ทั้งก้อนภายในสัปดาห์เดียว
   *
   * เวลานับถอยหลังบนกระดานไม่ได้มาจากเน็ต มาจากนาฬิกาในเครื่องที่เดินทุกวินาที
   * ลดรอบโหลดจึงไม่ได้ทำให้ตัวเลขบนจอค้าง
   */
  const [tick, setTick] = useState(0)
  const [slow, setSlow] = useState(0)
  const board = useAsync(
    () => (profile ? listBreakBoard(profile.id) : Promise.resolve([])),
    [tick, profile?.id],
  )
  const openAll = useAsync(() => countOpenPasses(), [tick])
  const ban = useAsync(() => breakBanNow(), [slow])
  const banNext = useAsync(() => breakBanNext(), [slow])
  const [open, setOpen] = useState(false)
  const [manual, setManual] = useState('')
  const [hit, setHit] = useState<BreakScan | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // แจ้งปัญหา
  const [problemFor, setProblemFor] = useState<Pending | null>(null)
  const [pick, setPick] = useState(0)
  const [note, setNote] = useState('')
  const [shots, setShots] = useState<Shot[]>([])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    const t = setInterval(() => setSlow((n) => n + 1), 300_000)
    return () => clearInterval(t)
  }, [])

  const rows = board.data ?? []
  /** ใบที่ยังไม่กลับทั้งฮับ · ของกะก่อนหน้าก็นับอยู่ในนี้ */
  const outAll = openAll.data ?? 0

  /**
   * ส่องอะไรมาก็รับ · เป็นบัตร OS ก็ส่งต่อไปหน้าสแกนบัตร OS ให้เลย
   * เหตุผลเดียวกับฝั่งโน้น รปภ ยืนประตูเดียว ของที่เดินผ่านมีสองอย่าง
   */
  async function look(code: string) {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const what = await guardScan(code)
      if (what.kind === 'os') {
        nav(`/guard?token=${encodeURIComponent(what.code)}`)
        return
      }
      setHit(await scanBreakCard(code))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // อีกหน้าส่งโค้ดมาให้ · ดูให้เลยครั้งเดียว
  const fired = useRef('')
  useEffect(() => {
    const c = sp.get('code')
    if (!c || fired.current === c) return
    fired.current = c
    void look(c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp])

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true)
    setErr(null)
    try {
      await fn()
      setMsg(ok)
      setHit(null)
      setTick((n) => n + 1)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const photos = shotsToPhotos(shots)
  const uploading = shots.some((s) => s.state === 'uploading' || s.state === 'ready')
  const failed = shots.some((s) => s.state === 'failed')
  const photoOk = photos.length >= 1 && !uploading && !failed

  const stamp = stampLines(
    profile?.full_name ?? '',
    profile?.employee_code ?? '',
    profile?.dept_code ?? profile?.hub_code ?? 'BPL',
    'รับกลับเบรค OS',
  )

  function closeProblem() {
    setProblemFor(null)
    setPick(0)
    setNote('')
    setShots([])
  }

  async function sendProblem() {
    if (!problemFor || !photoOk) return
    const total = problemFor.pass.people
    // pick = จำนวนที่ขาด · 0 แปลว่าเลือก "อื่น ๆ" ซึ่งคนกลับครบแต่มีเรื่องอื่น
    const returned = pick === 0 ? total : total - pick
    await act(
      () =>
        breakProblem({
          passId: problemFor.pass.pass_id,
          problem: pick === 0 ? 'อื่น ๆ' : `เข้าไม่ครบ · ขาด ${pick} คน`,
          returned,
          photo: photos.map((p) => ({
            file_id: p.file_id,
            web_link: p.web_link,
            bytes: p.bytes,
          })),
          note: note.trim() || null,
        }),
      'แจ้งปัญหาและปิดใบแล้ว · เตือนผู้ตรวจสอบไปแล้ว',
    )
    closeProblem()
  }

  return (
    <>
      <TopBar title="เบรค OS" back />
      <StaffPage>
        <BreakBanBar ban={ban.data ?? null} next={banNext.data ?? null} now={now} onChanged={() => setTick((n) => n + 1)} />

        {msg && (
          <p className="mb-3 rounded-btn bg-success-bg px-3 py-2 text-sm text-success-txt">{msg}</p>
        )}
        {err && (
          <div className="mb-3">
            <ErrorBox message={err} />
          </div>
        )}

        {/* ───────── ผลการสแกน ───────── */}
        {hit && (
          <div className="mb-4">
            <ScanResult hit={hit} now={now} />

            {hit.state === 'ready' && (
              <>
                <button
                  type="button"
                  className="mt-3 w-full rounded-btn bg-success py-4 text-md font-bold text-white"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => breakGateOut(hit.pass_id, hit.people),
                      `ปล่อยออก ${hit.code} · ${hit.people} คน`,
                    )
                  }
                >
                  {busy ? <Spinner /> : null}ปล่อยออก {hit.people} คน
                </button>
                {/*
                  เคสที่ รปภ พลาดไม่ได้สแกนขาออก พอเขากลับมาจอจะขึ้นเขียว
                  ซึ่งขัดกับความจริง ต้องมีทางปิดใบ ไม่งั้นคนเข้าไม่ได้เพราะระบบงอน
                */}
                <button
                  type="button"
                  className="btn-ghost mt-2 w-full py-3 text-sm"
                  disabled={busy}
                  onClick={() =>
                    void act(() => breakReturn(hit.pass_id), `ปิดใบ ${hit.code} แล้ว`)
                  }
                >
                  คนนี้กลับมาแล้ว · ปิดใบเลย
                </button>
              </>
            )}

            {hit.state === 'out' && (
              <>
                <button
                  type="button"
                  className="mt-3 w-full rounded-btn bg-warn py-4 text-md font-bold text-white"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => breakReturn(hit.pass_id),
                      `รับกลับ ${hit.code} · ${hit.gate_out_people ?? hit.people} คน`,
                    )
                  }
                >
                  {busy ? <Spinner /> : null}รับกลับครบ {hit.gate_out_people ?? hit.people} คน · ปิดใบ
                </button>
                <p className="mt-2 rounded-btn bg-danger-bg px-3 py-2 text-xs text-danger-txt">
                  ถ้าคนนี้กำลังจะออก = บัตรซ้ำ <b>ไม่ปล่อย</b> และไม่ต้องกดปุ่มบน
                </p>
                <button
                  type="button"
                  className="mt-2 w-full rounded-btn border-2 border-danger/40 bg-surface py-3 text-sm font-bold text-danger-txt"
                  disabled={busy}
                  onClick={() => {
                    setProblemFor({ pass: hit, code: hit.code })
                    setPick(1)
                  }}
                >
                  รับ + แจ้งปัญหา (คนไม่ครบ)
                </button>
              </>
            )}

            <button
              type="button"
              className="btn-ghost mt-2 w-full py-2.5 text-sm"
              onClick={() => setHit(null)}
            >
              ปิดผลนี้
            </button>
          </div>
        )}

        {/* ───────── ปุ่มสแกน ───────── */}
        {!hit && (
          <>
            <button
              type="button"
              className="btn-primary mb-3 w-full py-5 text-lg"
              onClick={() => setOpen(true)}
            >
              สแกนบัตร
            </button>
            <div className="mb-5 flex gap-2">
              <input
                className="input flex-1 font-mono"
                placeholder="หรือพิมพ์รหัสบัตร เช่น OUT4-01"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && manual.trim()) void look(manual.trim())
                }}
              />
              <button
                type="button"
                className="btn-ghost px-4"
                disabled={busy || !manual.trim()}
                onClick={() => void look(manual.trim())}
              >
                ดู
              </button>
            </div>
            <p className="mb-5 rounded-btn bg-ink/5 px-3 py-2 text-xs text-ink-500">
              QR เปื้อนจนสแกนไม่ติดก็พิมพ์รหัสแทนได้ ผลเหมือนกันทุกอย่าง
            </p>
          </>
        )}

        {/* ───────── กระดาน · เฉพาะใบที่ตัวเองปล่อยออก ───────── */}
        <h2 className="mb-2 font-display text-sm text-ink-500">
          ใบที่คุณปล่อยออกและยังไม่กลับ · {rows.length} ใบ ·{' '}
          {rows.reduce((n, r) => n + (r.gate_out_people ?? r.people), 0)} คน
        </h2>
        {/* กระดานโชว์เฉพาะของตัวเอง พอเปลี่ยนกะคนใหม่จะเห็นว่าง
            ทั้งที่ยังมีคนอยู่ข้างนอกจากกะก่อน บรรทัดนี้กันไม่ให้เข้าใจผิด */}
        {outAll > rows.length && (
          <p className="mb-2 rounded-btn bg-warn-bg px-3 py-2 text-xs text-warn-txt">
            ทั้งฮับยังไม่กลับอีก {outAll - rows.length} ใบ ที่คนอื่นเป็นคนปล่อยออก
            <br />
            ไม่ขึ้นในกระดานนี้ แต่สแกนบัตรใบนั้นแล้วกดรับกลับได้ตามปกติ
          </p>
        )}
        {rows.length === 0 ? (
          <EmptyState
            title={outAll > 0 ? 'คุณยังไม่ได้ปล่อยใบไหนออกไป' : 'ตอนนี้ไม่มีใครออกไป'}
            hint="เลขที่ไม่ขึ้นตอนสแกน = ไม่ได้รับอนุญาต ไม่ต้องปล่อย"
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => {
              const cd = countdown(r.due_at, now)
              return (
                <li
                  key={r.id}
                  className={`flex items-center gap-3 rounded-card border px-3 py-2.5 ${
                    r.waiting_gate
                      ? 'border-line bg-ink/5'
                      : cd.over
                        ? 'border-danger/30 bg-danger-bg'
                        : 'border-line bg-surface'
                  }`}
                >
                  <span className="font-mono text-sm font-bold">{r.card_code}</span>
                  <span className="min-w-0 flex-1 text-xs text-ink-500">
                    {r.reason_label} · {r.gate_out_people ?? r.people} คน
                    <br />
                    {r.waiting_gate
                      ? `ยื่น ${fmtDateTime(r.issued_at).slice(-5)} · ยังไม่ถึงประตู`
                      : `ผ่านประตู ${fmtDateTime(r.gate_out_at ?? r.issued_at).slice(-5)}`}
                  </span>
                  {r.waiting_gate ? (
                    <span className="text-xs font-semibold text-ink-400">รอมาถึง</span>
                  ) : (
                    <span
                      className={`font-mono text-md font-bold ${
                        cd.over ? 'text-danger-txt' : 'text-ink-700'
                      }`}
                    >
                      {cd.text}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}

      </StaffPage>

      {open && (
        <CodeScanner
          title="ส่องที่ QR บนบัตร"
          hint="ส่องได้ทั้งบัตรเบรคและบัตร OS ระบบแยกให้เอง"
          formats={['qr_code']}
          onCode={(code) => {
            setOpen(false)
            void look(code)
          }}
          onClose={() => setOpen(false)}
        />
      )}

      {/* ───────── แจ้งปัญหา ───────── */}
      <Sheet
        open={Boolean(problemFor)}
        title={`แจ้งปัญหา · ${problemFor?.code ?? ''}`}
        onClose={closeProblem}
      >
        {problemFor && (
          <>
            <p className="label">เกิดอะไรขึ้น</p>
            <div className="mb-4 space-y-1.5">
              {Array.from({ length: problemFor.pass.people }, (_, i) => i + 1).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`w-full rounded-btn border px-3 py-2.5 text-left text-sm ${
                    pick === k
                      ? 'border-danger bg-danger-bg font-semibold text-danger-txt'
                      : 'border-line bg-surface text-ink-700'
                  }`}
                  onClick={() => setPick(k)}
                >
                  {k === problemFor.pass.people
                    ? 'ไม่มีใครกลับเลย'
                    : `เข้าไม่ครบ · ขาด ${k} คน`}
                  <span className="ml-2 font-normal text-ink-400">
                    กลับ {problemFor.pass.people - k} จาก {problemFor.pass.people}
                  </span>
                </button>
              ))}
              <button
                type="button"
                className={`w-full rounded-btn border px-3 py-2.5 text-left text-sm ${
                  pick === 0
                    ? 'border-danger bg-danger-bg font-semibold text-danger-txt'
                    : 'border-line bg-surface text-ink-700'
                }`}
                onClick={() => setPick(0)}
              >
                อื่น ๆ · กลับครบแต่มีเรื่องต้องแจ้ง
              </button>
            </div>

            <label className="label" htmlFor="brk-note">
              รายละเอียด (ไม่บังคับ)
            </label>
            <input
              id="brk-note"
              className="input mb-4"
              placeholder="เช่น คนเกินมาจากที่ปล่อย"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />

            <p className="label">รูปตอนรับกลับ (บังคับ 1 ใบ)</p>
            <PhotoSteps
              steps={[]}
              maxFree={3}
              minFree={1}
              stamp={stamp}
              shots={shots}
              onShots={setShots}
              kind="break"
              namePrefix="break-return"
            />
            <p className="mt-2 text-xs text-ink-500">
              หลังบ้านจะเอารูปนี้ไปเทียบกับรูปตอนหัวหน้าปล่อย เห็นเองว่าใครหายไป
            </p>

            <button
              type="button"
              className="mt-4 w-full rounded-btn bg-danger py-4 text-md font-bold text-white disabled:opacity-50"
              disabled={busy || !photoOk}
              onClick={() => void sendProblem()}
            >
              {busy ? <Spinner /> : null}
              {failed
                ? 'รูปส่งไม่สำเร็จ กดที่รูปเพื่อลองใหม่'
                : uploading
                  ? 'กำลังส่งรูป…'
                  : photos.length === 0
                    ? 'ถ่ายรูปก่อน'
                    : 'ส่ง · ปิดใบและแจ้งเตือนทันที'}
            </button>
            <p className="mt-2 text-center text-xs text-ink-500">
              ส่งแล้วเตือนผู้ตรวจสอบ เจ้าของระบบ และหัวหน้าที่ปล่อยใบนี้ทันที
            </p>
          </>
        )}
      </Sheet>
    </>
  )
}

/** กล่องผลการสแกน — สีคือสิ่งเดียวที่ รปภ ต้องดู */
/**
 * รูปตอนยื่นบัตร · ขึ้นใต้แถบเขียว-แดงเสมอ
 *
 * วางไว้ใต้คำตอบ ไม่ใช่เหนือคำตอบ เพราะที่ประตูคนต่อแถว
 * ถ้ารูปอยู่บนแล้วโหลดช้า แถบสีจะถูกดันลงไปอยู่นอกจอพอดีตอนที่ต้องอ่าน
 * กล่องจองที่ไว้ตายตัวตั้งแต่แรก รูปมาทีหลังจึงไม่ทำให้ของข้างบนกระโดด
 *
 * กดที่รูปแล้วขยายเต็มจอ เผื่อแดดจ้าหรือคนยืนไกล
 */
function GatePhoto({ fileId }: { fileId: string | null }) {
  const [big, setBig] = useState(false)
  if (!fileId) return null
  return (
    <>
      <button
        type="button"
        className="mt-3 block h-[180px] w-full overflow-hidden rounded-card border border-line bg-surface-2"
        onClick={() => setBig(true)}
        aria-label="ดูรูปใหญ่"
      >
        <EvidenceImg fileId={fileId} enabled alt="คนที่ออกไปกับบัตรใบนี้" className="h-full w-full" />
      </button>
      <p className="mt-1 text-xs text-ink-400">รูปตอนหัวหน้ายื่นบัตร · กดเพื่อดูใหญ่</p>

      {big && (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3"
          onClick={() => setBig(false)}
          aria-label="ปิดรูป"
        >
          <EvidenceImg
            fileId={fileId}
            enabled
            alt="คนที่ออกไปกับบัตรใบนี้"
            className="max-h-full w-full"
          />
        </button>
      )}
    </>
  )
}

function ScanResult({ hit, now }: { hit: BreakScan; now: number }) {
  if (hit.state === 'unknown' || hit.state === 'free') {
    return (
      <div className="rounded-card border-2 border-danger/40 bg-danger-bg p-5 text-center">
        <p className="font-mono text-2xl font-extrabold text-ink-700">{hit.code}</p>
        <p className="mt-2 font-display text-md text-danger-txt">
          🔴 {hit.state === 'unknown' ? 'ไม่รู้จักบัตรใบนี้' : 'ไม่ได้รับอนุญาต'}
        </p>
        <p className="mt-1 text-sm text-danger-txt">
          {hit.state === 'unknown'
            ? 'ไม่มีรหัสนี้ในระบบ — เป็นบัตรปลอม'
            : 'ไม่มีใครยื่นบัตรใบนี้'}
          <br />
          ไม่ต้องปล่อย
        </p>
      </div>
    )
  }

  if (hit.state === 'closed') {
    return (
      <div className="rounded-card border-2 border-danger/40 bg-danger-bg p-5 text-center">
        <p className="font-mono text-2xl font-extrabold text-ink-700">{hit.code}</p>
        <p className="mt-2 font-display text-md text-danger-txt">🔴 ปิดไปแล้ว</p>
        <p className="mt-1 text-sm text-danger-txt">
          รับกลับเมื่อ {fmtDateTime(hit.closed_at)}
          {hit.closed_by ? ` โดย ${hit.closed_by}` : ''}
          <br />
          ไม่ต้องปล่อย
        </p>
      </div>
    )
  }

  const cd = countdown(hit.due_at, now)
  const green = hit.state === 'ready'
  return (
    <div
      className={`rounded-card border-2 p-5 text-center ${
        green ? 'border-success/40 bg-success-bg' : 'border-warn/40 bg-warn-bg'
      }`}
    >
      <p className="font-mono text-2xl font-extrabold text-ink-700">{hit.code}</p>
      <p className={`mt-2 font-display text-md ${green ? 'text-success-txt' : 'text-warn-txt'}`}>
        {green ? '🟢 ปล่อยออกได้' : `🟡 ออกไปตั้งแต่ ${fmtDateTime(hit.gate_out_at!).slice(-5)}`}
      </p>
      <p
        className={`mt-2 inline-block rounded-btn border bg-white px-4 py-1 text-md font-extrabold ${
          green ? 'border-success/40 text-success-txt' : 'border-warn/40 text-warn-txt'
        }`}
      >
        {hit.gate_out_people ?? hit.people} คน
      </p>
      <p className={`mt-2 text-sm ${green ? 'text-success-txt' : 'text-warn-txt'}`}>
        {hit.reason} · {green ? `เหลือ ${cd.text}` : cd.over ? `เกินมา ${cd.text}` : `เหลือ ${cd.text}`}
        <br />
        ยื่นโดย {hit.issued_by} เมื่อ {fmtDateTime(hit.issued_at).slice(-5)}
        {hit.nickname ? ` · ${hit.nickname}` : ''}
      </p>
      {hit.in_ban && (
        <p className="mt-2 rounded-btn bg-ink px-3 py-1 text-xs font-semibold text-white">
          ใบนี้ปล่อยในช่วงห้ามเบรค
        </p>
      )}
      <GatePhoto fileId={hit.photo_file_id} />
    </div>
  )
}
