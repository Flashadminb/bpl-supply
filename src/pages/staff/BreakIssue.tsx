import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import { stampLines } from '../../lib/image'
import { PhotoSteps, shotsToPhotos, type Shot } from '../../components/PhotoSteps'
import { BreakBanBar } from '../../components/BreakBanBar'
import { ErrorBox, Loading, EmptyState, Spinner } from '../../components/ui'
import { StaffPage, TopBar } from '../../components/Shell'
import {
  breakBanNext,
  breakBanNow,
  countdown,
  issueBreak,
  listBreakBoard,
  listBreakReasons,
  listMyBreakCards,
  type BreakCardOption,
} from '../../lib/breakPass'

/**
 * ปล่อยบัตรเบรค — หน้าของหัวหน้างาน
 *
 * ไม่มีกล้องสแกนในหน้านี้โดยตั้งใจ หัวหน้าเห็นบัตรแค่ของแผนกตัวเอง
 * รายการสั้นพออยู่แล้ว จิ้มเร็วกว่าเปิดกล้องส่องมาก โดยเฉพาะกะดึกที่แสงน้อย
 * กล้องไปอยู่ฝั่ง รปภ ซึ่งเป็นคนที่ต้องจับคู่บัตรในมือกับแถวบนจอจริง ๆ
 *
 * **เวลาเริ่มเดินตอนกดยื่น** ไม่ใช่ตอนถึงประตู
 * นาทีที่เลือกจึงหมายถึงไปกลับรวม หัวหน้าต้องเผื่อเวลาเดินไว้ในนั้นเอง
 * ป้ายบนหน้าจอเขียนไว้ชัดทุกจุดที่เกี่ยวกับนาที ไม่งั้นจะตั้ง 3 นาทีแล้วเกินทุกใบ
 */

const PEOPLE = [1, 2, 3, 4, 5]
const MINUTES = [4, 5, 6, 8, 10, 15, 20]

export default function BreakIssue() {
  const { profile } = useAuth()
  const cards = useAsync(() => listMyBreakCards(), [])
  const reasons = useAsync(() => listBreakReasons(), [])
  const [tick, setTick] = useState(0)
  const board = useAsync(() => listBreakBoard(), [tick])
  const ban = useAsync(() => breakBanNow(), [tick])
  const banNext = useAsync(() => breakBanNext(), [tick])

  const [card, setCard] = useState<string | null>(null)
  const [people, setPeople] = useState(1)
  const [reason, setReason] = useState<string | null>(null)
  const [minutes, setMinutes] = useState<number | null>(null)
  const [nickname, setNickname] = useState('')
  const [banWhy, setBanWhy] = useState('')
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ card: string; people: number; minutes: number } | null>(null)

  // นาฬิกาเดินในเครื่อง ไม่ได้ยิงเซิร์ฟเวอร์ — ตรงถึงวินาทีและไม่กินโควตาอะไรเลย
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // ดึงใบที่เปิดอยู่ใหม่ทุกครึ่งนาที เผื่อ รปภ รับกลับไปแล้วบัตรจะได้ว่างให้ปล่อยซ้ำ
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const list = cards.data ?? []
  const rs = reasons.data ?? []
  const banNow = ban.data ?? null
  const mine = (board.data ?? []).filter((r) => r.issued_by_code === profile?.employee_code)

  // เลือกเหตุผลแล้วนาทีเด้งมาให้เอง หัวหน้าไม่ต้องคิดตอนรีบ แต่กดเปลี่ยนได้
  useEffect(() => {
    if (!reason && rs.length > 0) setReason(rs[0].code)
  }, [rs, reason])
  useEffect(() => {
    const r = rs.find((x) => x.code === reason)
    if (r) setMinutes(r.default_minutes)
  }, [reason, rs])

  const chosen = list.find((c) => c.code === card) ?? null

  /**
   * เพดานของแผนก · 0 แปลว่าไม่จำกัด
   *
   * ตัวที่กั้นจริงคือหัวคน ไม่ใช่จำนวนใบ ของเดิมนับใบ แปลว่าใบละคนเดียวสามใบ
   * ชนเพดานเท่ากับใบละห้าคนสามใบ ทั้งที่ต่างกัน 12 คน
   * เพดานใบยังเช็คอยู่เป็นคันโยกสำรอง แต่ปกติตั้งเป็น 0 ไว้
   *
   * ต้องเทียบกับจำนวนคนในใบนี้ด้วย ไม่ใช่แค่ดูว่าเต็มหรือยัง
   * เหลือที่ว่าง 2 คนแต่กดใบละ 3 คน ก็ยังปล่อยไม่ได้
   */
  const roomLeft = useMemo(() => {
    if (!chosen || chosen.max_people === 0) return Infinity
    return Math.max(0, chosen.max_people - chosen.open_people)
  }, [chosen])

  const cardsFull = Boolean(chosen && chosen.max_open > 0 && chosen.open_now >= chosen.max_open)
  const capped = cardsFull || people > roomLeft

  const photos = shotsToPhotos(shots)
  const uploading = shots.some((s) => s.state === 'uploading' || s.state === 'ready')
  const failed = shots.some((s) => s.state === 'failed')
  const shotsOk = photos.length >= 1 && !uploading && !failed
  const banOk = !banNow || banWhy.trim().length > 0
  const ready = Boolean(card && reason && minutes && shotsOk && banOk && !capped)

  const stamp = stampLines(
    profile?.full_name ?? '',
    profile?.employee_code ?? '',
    profile?.dept_code ?? profile?.hub_code ?? 'BPL',
    'ปล่อยเบรค OS',
  )

  function reset() {
    setCard(null)
    setPeople(1)
    setNickname('')
    setBanWhy('')
    setShots([])
    setErr(null)
  }

  async function submit() {
    if (!ready || !card || !reason || !minutes) return
    setBusy(true)
    setErr(null)
    try {
      await issueBreak({
        cardCode: card,
        people,
        reason,
        minutes,
        photos: photos.map((p) => ({ file_id: p.file_id, web_link: p.web_link, bytes: p.bytes })),
        nickname: nickname.trim() || null,
        banReason: banNow ? banWhy.trim() : null,
      })
      setDone({ card, people, minutes })
      reset()
      setTick((n) => n + 1)
      cards.reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (cards.loading && list.length === 0) {
    return (
      <>
        <TopBar title="ปล่อยเบรค OS" back />
        <StaffPage>
          <Loading />
        </StaffPage>
      </>
    )
  }
  if (cards.error) {
    return (
      <>
        <TopBar title="ปล่อยเบรค OS" back />
        <StaffPage>
          <ErrorBox message={cards.error} onRetry={cards.reload} />
        </StaffPage>
      </>
    )
  }

  const byGroup = new Map<string, BreakCardOption[]>()
  for (const c of list) {
    const arr = byGroup.get(c.group_code) ?? []
    arr.push(c)
    byGroup.set(c.group_code, arr)
  }

  return (
    <>
      <TopBar
        title="ปล่อยเบรค OS"
        back
        right={
          <Link to="/break/board" className="btn-ghost px-3 py-1.5 text-sm">
            บัตรของฉัน
          </Link>
        }
      />
      <StaffPage>

      <BreakBanBar ban={banNow} next={banNext.data ?? null} now={now} onChanged={() => setTick((n) => n + 1)} />

      {done && (
        <div className="mb-4 rounded-card border border-success/30 bg-success-bg p-4 text-center">
          <p className="font-display text-md text-success-txt">
            ยื่น {done.card} แล้ว · {done.people} คน
          </p>
          <p className="mt-1 text-sm text-success-txt">
            เวลาเริ่มเดินแล้ว · ครบกำหนดใน {done.minutes} นาที
          </p>
          <button type="button" className="btn-ghost mt-3 px-4 py-2 text-sm" onClick={() => setDone(null)}>
            ปล่อยใบถัดไป
          </button>
        </div>
      )}

      {/* ───────── ใบที่ตัวเองปล่อยอยู่ · นับถอยหลังสด ───────── */}
      {mine.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 font-display text-sm text-ink-500">
            ใบที่คุณปล่อย · {mine.length} ใบ
          </h2>
          <ul className="space-y-1.5">
            {mine.map((r) => {
              const cd = countdown(r.due_at, now)
              return (
                <li
                  key={r.id}
                  className={`flex items-center gap-3 rounded-card border px-3 py-2 ${
                    cd.over ? 'border-danger/30 bg-danger-bg' : 'border-line bg-surface'
                  }`}
                >
                  <span className="font-mono text-sm font-bold">{r.card_code}</span>
                  <span className="min-w-0 flex-1 text-xs text-ink-500">
                    {r.reason_label} · {r.people} คน
                    {r.waiting_gate ? ' · ยังไม่ถึงประตู' : ''}
                  </span>
                  <span
                    className={`font-mono text-md font-bold ${
                      cd.over ? 'text-danger-txt' : 'text-ink-700'
                    }`}
                  >
                    {cd.text}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {list.length === 0 ? (
        <EmptyState
          title="ยังไม่มีบัตรที่คุณดูแล"
          hint="ให้เจ้าของระบบเพิ่มคุณเข้าแผนกบัตรในหน้าบัตรเบรคก่อน"
        />
      ) : (
        <>
          {/* ───────── ช่วงห้ามเบรค ───────── */}
          {banNow && (
            <div className="mb-4 rounded-card border border-danger/30 bg-danger-bg p-3">
              <p className="font-display text-sm text-danger-txt">ปล่อยในช่วงห้ามต้องมีเหตุผล</p>
              <input
                className="input mt-2"
                placeholder="เหตุผลฉุกเฉิน (บังคับ)"
                value={banWhy}
                onChange={(e) => setBanWhy(e.target.value)}
              />
            </div>
          )}

          {/* ───────── เลือกบัตร ───────── */}
          {[...byGroup.entries()].map(([g, arr]) => (
            <section key={g} className="mb-4">
              <p className="mb-1.5 text-xs font-semibold text-ink-500">
                {arr[0].group_name ? `${g} · ${arr[0].group_name}` : g}
                {arr[0].max_people > 0 && (
                  <span className="ml-2 font-normal">
                    ออกไปแล้ว {arr[0].open_people}/{arr[0].max_people} คน
                  </span>
                )}
                {arr[0].max_open > 0 && (
                  <span className="ml-2 font-normal">
                    · {arr[0].open_now}/{arr[0].max_open} ใบ
                  </span>
                )}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {arr.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    disabled={c.busy}
                    className={`rounded-card border px-3 py-2.5 text-left font-mono text-sm font-bold ${
                      c.busy
                        ? 'border-line bg-ink/5 text-ink-400'
                        : card === c.code
                          ? 'border-ink bg-ink text-white'
                          : 'border-line bg-surface text-ink-700'
                    }`}
                    onClick={() => setCard(card === c.code ? null : c.code)}
                  >
                    {c.code}
                    <span
                      className={`block font-sans text-xs font-normal ${
                        card === c.code ? 'text-white/70' : 'text-ink-400'
                      }`}
                    >
                      {c.busy ? `กำลังออกไป ${c.busy_people ?? ''} คน` : 'ว่าง'}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}

          {capped && (
            <p className="mb-4 rounded-btn bg-warn-bg px-3 py-2 text-sm text-warn-txt">
              {cardsFull ? (
                <>
                  แผนกนี้ปล่อยพร้อมกันได้สูงสุด {chosen?.max_open} ใบ · ตอนนี้ครบแล้ว
                  ต้องรับกลับก่อนถึงจะปล่อยใบใหม่ได้
                </>
              ) : roomLeft === 0 ? (
                <>
                  แผนกนี้ออกพร้อมกันได้สูงสุด {chosen?.max_people} คน · ตอนนี้ครบแล้ว
                  ต้องรับกลับก่อนถึงจะปล่อยใบใหม่ได้
                </>
              ) : (
                <>
                  แผนกนี้ออกพร้อมกันได้สูงสุด {chosen?.max_people} คน ตอนนี้ออกไปแล้ว{' '}
                  {chosen?.open_people} คน · <b>เหลือที่ว่างอีก {roomLeft} คน</b>
                  <br />
                  ใบนี้เลือกไว้ {people} คน ลดลงให้เหลือ {roomLeft} คน หรือรอรับกลับก่อน
                </>
              )}
            </p>
          )}

          {/* ───────── จำนวนคน ───────── */}
          <p className="label">ใบนี้กี่คน · สูงสุด 5</p>
          <div className="mb-4 flex gap-2">
            {PEOPLE.map((n) => (
              <button
                key={n}
                type="button"
                className={`h-tap flex-1 rounded-btn border text-md font-bold ${
                  people === n
                    ? 'border-success bg-success text-white'
                    : 'border-line bg-surface text-ink-700'
                }`}
                onClick={() => setPeople(n)}
              >
                {n}
              </button>
            ))}
          </div>

          {/* ───────── เหตุผล ───────── */}
          <p className="label">เพราะอะไร</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {rs.map((r) => (
              <button
                key={r.code}
                type="button"
                className={`rounded-btn border px-3.5 py-2 text-sm ${
                  reason === r.code
                    ? 'border-ink bg-ink font-semibold text-white'
                    : 'border-line bg-surface text-ink-700'
                }`}
                onClick={() => setReason(r.code)}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* ───────── นาที ───────── */}
          <p className="label">
            ไปกลับรวมกี่นาที
            {reason && (
              <span className="ml-1 font-normal text-ink-400">
                · ค่าเริ่มต้น {rs.find((r) => r.code === reason)?.default_minutes} นาที
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                className={`rounded-btn border px-3.5 py-2 text-sm ${
                  minutes === m
                    ? 'border-ink bg-ink font-semibold text-white'
                    : 'border-line bg-surface text-ink-700'
                }`}
                onClick={() => setMinutes(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="mt-2 mb-4 rounded-btn bg-ink/5 px-3 py-2 text-xs text-ink-500">
            เวลาเริ่มเดินตอนกดยื่นบัตร ไม่ใช่ตอนถึง รปภ — เผื่อเวลาเดินไว้ในนาทีนี้แล้ว
          </p>

          {/* ───────── ชื่อเล่น ───────── */}
          <label className="label" htmlFor="brk-nick">
            ชื่อเล่น (ไม่บังคับ)
          </label>
          <input
            id="brk-nick"
            className="input mb-4"
            placeholder="เว้นว่างได้ · ระบบไม่เก็บทะเบียน OS"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />

          {/* ───────── รูป ───────── */}
          <p className="label">รูป (บังคับ) · ถ่ายหรือเลือกจากเครื่องก็ได้</p>
          <PhotoSteps
            steps={[]}
            maxFree={5}
            minFree={1}
            stamp={stamp}
            shots={shots}
            onShots={setShots}
            kind="break"
            namePrefix="break"
          />
          <p className="mt-2 text-xs text-ink-500">
            รูปขึ้น Drive คนละโฟลเดอร์กับหลักฐานซัพพลาย · รปภ ไม่เห็นรูป ขึ้นเฉพาะหลังบ้าน
          </p>

          {err && (
            <p className="mt-3 rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-txt">{err}</p>
          )}

          <button
            type="button"
            className="btn-primary mt-4 w-full py-4 text-md"
            disabled={busy || !ready}
            onClick={() => void submit()}
          >
            {busy ? <Spinner /> : null}
            {!card
              ? 'เลือกบัตรก่อน'
              : capped
                ? 'แผนกนี้ปล่อยครบเพดานแล้ว'
                : banNow && !banOk
                  ? 'กรอกเหตุผลฉุกเฉินก่อน'
                  : failed
                    ? 'รูปส่งไม่สำเร็จ กดที่รูปเพื่อลองใหม่'
                    : uploading
                      ? 'กำลังส่งรูป…'
                      : photos.length === 0
                        ? 'ถ่ายรูปก่อน'
                        : `ยื่น ${card} · ${people} คน · เริ่มจับเวลา`}
          </button>
        </>
      )}
      </StaffPage>
    </>
  )
}
