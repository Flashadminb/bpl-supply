import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { useAsync } from '../../lib/useAsync'
import { listProfiles, updateProfile } from '../../lib/api'
import { PeoplePicker } from '../../components/PeoplePicker'
import { ErrorBox, Loading, EmptyState } from '../../components/ui'
import type { Profile } from '../../lib/types'
import {
  addBreakCards,
  deleteBreakBan,
  deleteBreakCards,
  getBreakSettings,
  hhmmToMin,
  minToHHMM,
  saveBreakBan,
  saveBreakCard,
  saveBreakGroup,
  saveBreakReason,
  setBreakAlertSub,
  setBreakGroupUser,
} from '../../lib/breakPass'

/**
 * จัดการบัตรเบรค — เมนูเดียวจบ
 *
 * ของเดิมแยกเป็นสองเมนู บัตรอยู่หน้าหนึ่ง ช่วงห้ามกับแจ้งเตือนอยู่อีกหน้า
 * ซึ่งทำให้คำถามที่ถามบ่อยที่สุดตอบไม่ได้ในหน้าเดียว คือ
 * "บัตรใบนี้ใครใช้ได้บ้าง" ต้องเปิดสองหน้าแล้วจำข้ามกัน
 *
 * ตอนนี้สิทธิ์อยู่ติดกับบัตรของแผนกนั้นเลย เห็นพร้อมกันและแก้ตรงนั้นได้
 *
 * บัตรเบรคต่างจากบัตร OS ตรงที่ไม่มีชื่อ ไม่มีรูป และไม่มี token ลับ
 * QR เก็บรหัสบัตรตรง ๆ เพราะความลับของบัตรไม่ได้ช่วยอะไรเลย
 * ใครปลอม QR ขึ้นมาเองก็ไปจบที่ด่านเดียวกัน — ปลอมใบที่ไม่ได้ถูกปล่อย
 * คือโดนปัด ปลอมใบที่ถูกปล่อยอยู่คือโดนจับว่าซ้ำ
 */

const NAVY = '#1B2A4A'
const Y = '#F5B301'

type Tab = 'cards' | 'rules' | 'alerts' | 'print'

export function BreakCardStyles() {
  return (
    <style>{`
      .brk-sheet { display:grid; grid-template-columns:repeat(2,204px); gap:12px; }
      @media print {
        /* เบราว์เซอร์ตัดสีพื้นทิ้งตอนพิมพ์ ถือว่าช่วยประหยัดหมึก
           บัตรนี้สีพื้นคือตัวบัตร ตัดทิ้งแล้วเหลือแต่ตัวหนังสือลอยบนกระดาษเปล่า */
        body { background:#fff; }
        .no-print, aside, header, nav { display:none !important; }
        main { padding:0 !important; }
        .brk-sheet { grid-template-columns:repeat(3,54mm); gap:4mm; }
        .brk-card { break-inside:avoid; page-break-inside:avoid;
                    width:54mm; height:86mm; border-radius:2mm; }
        @page { size:A4; margin:8mm; }
      }
      .brk-card {
        position:relative; width:204px; height:325px; overflow:hidden;
        background:#14120F; border:1px dashed #b9b3a6; border-radius:8px;
        font-family:Kanit,system-ui,sans-serif; color:#fff;
        display:flex; flex-direction:column; align-items:center;
        padding:22px 10px 30px; text-align:center;
        -webkit-print-color-adjust:exact; print-color-adjust:exact;
      }
      .brk-top { position:absolute; left:0; right:0; top:0; height:10px; background:${Y}; }
      .brk-hub { background:${Y}; color:#111; font-weight:800; font-size:12px;
                 border-radius:5px; padding:1px 11px; }
      .brk-grp { font-size:9.5px; opacity:.6; margin-top:6px; letter-spacing:.08em; }
      /* รหัสยืนกลางช่องว่างระหว่างหัวบัตรกับ QR
         ของเดิมดัน QR ลงล่างด้วย margin-top:auto แล้วรหัสค้างอยู่บนสุด
         กลางบัตรเลยโหว่เป็นแถบดำยาว ๆ ดูเหมือนพิมพ์ตกไปหนึ่งบรรทัด */
      .brk-mid { flex:1; display:flex; align-items:center; justify-content:center; width:100%; }
      /* ขนาดตัวอักษรมาจากความยาวรหัส ตั้งเป็นตัวแปรไว้ใน style ของแต่ละใบ
         ตายตัวไม่ได้ เพราะเจ้าของระบบตั้งรหัสเองได้ยาวถึง 24 ตัว
         ปล่อยไว้แล้วรหัสยาวจะตัดกลางคำ กลายเป็น PICK-NIGHT-1 ขึ้นบรรทัดใหม่เป็น 2
         break-word ตัดตรงขีดกลางให้ก่อน ค่อยตัดกลางคำเมื่อจำเป็นจริง ๆ */
      .brk-code { font-family:ui-monospace,monospace; font-weight:800;
                  font-size:var(--brk-fs,27px); line-height:1.1;
                  overflow-wrap:break-word; word-break:break-word; }
      .brk-qr { background:#fff; padding:6px; border-radius:6px; }
      .brk-qr img { display:block; width:116px; height:116px; }
      /* แถบล่างกับข้อความอยู่ด้วยกัน ไม่ใช่แถบเปล่า ๆ กับข้อความลอยอยู่เหนือมัน
         ตัวหนังสือสีอ่อนบนพื้นกรมท่าอ่านออก ส่วนบนพื้นดำของบัตรมันจมหายไปเลย */
      .brk-bot { position:absolute; left:0; right:0; bottom:0; height:24px; background:${NAVY};
                 display:flex; align-items:center; justify-content:center; }
      .brk-foot { font-size:7px; line-height:1.3; color:#cfd6e2; }
    `}</style>
  )
}

function Qr({ text, size = 116 }: { text: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    // ระดับ Q ทนลายเลือนได้ราวหนึ่งในสี่ของภาพ บัตรที่ถือกันทั้งกะต้องเจอรอยแน่
    // รหัสสั้นแบบ OUT4-01 อยู่ในตาราง 25x25 ความทนจึงได้มาโดยช่องไม่เล็กลง
    QRCode.toDataURL(text, { width: size * 3, margin: 0, errorCorrectionLevel: 'Q' })
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null))
    return () => {
      alive = false
    }
  }, [text, size])
  return <span className="block">{url && <img src={url} alt="" />}</span>
}

/**
 * ตัวอักษรของรหัสย่อลงตามความยาว
 *
 * ตั้งตายตัวไม่ได้ รหัสตั้งเองได้ยาวถึง 24 ตัว ที่ 27px พอเกิน 9 ตัวก็ล้นแล้ว
 * ขนาดพวกนี้มาจากการลองวางจริงบนความกว้าง 184px (204 ลบขอบในซ้ายขวา)
 */
function codeSize(code: string): string {
  if (code.length <= 8) return '27px'
  if (code.length <= 11) return '22px'
  if (code.length <= 15) return '18px'
  return '15px'
}

export function BreakCardFace({ code, group }: { code: string; group: string | null }) {
  return (
    <div className="brk-card" style={{ ['--brk-fs' as string]: codeSize(code) }}>
      <span className="brk-top" />
      <span className="brk-hub">21BPL</span>
      <div className="brk-grp">บัตรเบรค</div>
      <div className="brk-mid">
        <div className="brk-code">{code}</div>
      </div>
      <div className="brk-qr">
        <Qr text={code} size={116} />
      </div>
      <div className="brk-bot">
        <span className="brk-foot">
          {group ? `${group} · ` : ''}ใบนี้ไม่ใช่สิทธิ์ · สิทธิ์อยู่ที่ระบบ
        </span>
      </div>
    </div>
  )
}

/**
 * สร้างรหัสเป็นชุด — "OUT4-" 1 ถึง 5 ได้ OUT4-01 … OUT4-05
 *
 * เจ้าของระบบจะเพิ่มบัตรทีละสิบใบ พิมพ์เองทีละบรรทัดแล้วพิมพ์ผิดแน่
 * และรหัสที่ผิดหนึ่งตัวแปลว่าบัตรใบนั้นสแกนไม่เจอตลอดอายุการใช้งาน
 */
function expand(prefix: string, from: number, to: number, pad: number): string[] {
  const out: string[] = []
  for (let i = from; i <= to && out.length < 200; i++) {
    out.push(`${prefix}${String(i).padStart(pad, '0')}`)
  }
  return out
}

export default function BreakCards() {
  const [tab, setTab] = useState<Tab>('cards')
  const settings = useAsync(() => getBreakSettings(), [])
  const people = useAsync(() => listProfiles(), [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const [gCode, setGCode] = useState('')
  const [gName, setGName] = useState('')
  const [gMax, setGMax] = useState(3)

  const [target, setTarget] = useState('')
  const [prefix, setPrefix] = useState('')
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(5)
  const [pad, setPad] = useState(2)

  const [sel, setSel] = useState<string[]>([])
  const [printGroup, setPrintGroup] = useState('')

  const [bFrom, setBFrom] = useState('04:00')
  const [bTo, setBTo] = useState('04:30')
  const [bNote, setBNote] = useState('')

  const s = settings.data
  const groups = s?.groups ?? []
  const cards = s?.cards ?? []
  const staff = useMemo(
    () => (people.data ?? []).filter((p) => p.is_active),
    [people.data],
  )

  useEffect(() => {
    if (!target && groups.length > 0) setTarget(groups[0].code)
  }, [groups, target])

  const preview = useMemo(
    () => (prefix.trim() ? expand(prefix.trim().toUpperCase(), from, to, pad) : []),
    [prefix, from, to, pad],
  )

  const printable = useMemo(
    () => cards.filter((c) => c.active && (!printGroup || c.group_code === printGroup)),
    [cards, printGroup],
  )

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      await fn()
      setMsg(ok)
      settings.reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (settings.loading && !s) return <Loading />
  if (settings.error) return <ErrorBox message={settings.error} onRetry={settings.reload} />

  const TABS: [Tab, string][] = [
    ['cards', `บัตรและสิทธิ์ (${cards.length})`],
    ['rules', 'ช่วงห้ามและนาที'],
    ['alerts', 'แจ้งเตือน'],
    ['print', `พิมพ์ (${printable.length})`],
  ]

  return (
    <div>
      <BreakCardStyles />

      <div className="no-print mb-4">
        <h1 className="font-display text-xl">จัดการบัตรเบรค</h1>
        <p className="mt-1 text-sm text-ink-500">
          บัตรไม่มีชื่อไม่มีรูป · QR เก็บรหัสบัตรตรง ๆ ไม่ใช่ความลับ จึงไม่ต้องเปลี่ยนรอบ
          และพิมพ์ซ่อมเองได้ตลอด
        </p>
      </div>

      <div className="no-print mb-4 flex flex-wrap gap-2">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={tab === k ? 'btn-primary px-4 py-2 text-sm' : 'btn-ghost px-4 py-2 text-sm'}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {err && (
        <div className="no-print mb-3">
          <ErrorBox message={err} />
        </div>
      )}
      {msg && (
        <p className="no-print mb-3 rounded-btn bg-success-bg px-3 py-2 text-sm text-success-txt">
          {msg}
        </p>
      )}

      {tab === 'cards' && (
        <CardsTab
          groups={groups}
          cards={cards}
          staff={staff}
          busy={busy}
          run={run}
          sel={sel}
          setSel={setSel}
          gCode={gCode}
          setGCode={setGCode}
          gName={gName}
          setGName={setGName}
          gMax={gMax}
          setGMax={setGMax}
          target={target}
          setTarget={setTarget}
          prefix={prefix}
          setPrefix={setPrefix}
          from={from}
          setFrom={setFrom}
          to={to}
          setTo={setTo}
          pad={pad}
          setPad={setPad}
          preview={preview}
          setMsg={setMsg}
        />
      )}

      {tab === 'rules' && s && (
        <div className="space-y-5">
          <section className="rounded-card border border-line p-4">
            <h2 className="font-display text-md">ช่วงห้ามเบรคประจำวัน</h2>
            <p className="mb-3 text-xs text-ink-500">
              ตั้งไว้แล้ววนทุกวัน · เปิดปิดได้ ลบได้ แก้เวลาได้ ไม่ต้องลบแล้วสร้างใหม่
              <br />
              ถ้าใช้เป็นครั้งคราว <b>ไม่ต้องตั้งที่นี่</b> ให้คนที่มีสิทธิ์กด
              &ldquo;ห้ามเบรคเดี๋ยวนี้&rdquo; ในแอปแทน แล้วมันหมดอายุเอง
              <br />
              ช่วงที่คร่อมเที่ยงคืนใส่ได้ เช่น 23:40 ถึง 00:20 — กะดึกใช้ได้ตามปกติ
            </p>

            {s.bans.length === 0 ? (
              <p className="mb-3 text-sm text-ink-500">
                ยังไม่ได้ตั้งช่วงห้ามประจำวันไว้เลย ปล่อยเบรคได้ตลอดเวลา
              </p>
            ) : (
              <ul className="mb-3 space-y-2">
                {s.bans.map((b) => (
                  <BanRow key={b.id} b={b} busy={busy} run={run} />
                ))}
              </ul>
            )}

            <div className="grid gap-2 sm:grid-cols-4">
              <div>
                <label className="label" htmlFor="b-from">
                  ตั้งแต่
                </label>
                <input
                  id="b-from"
                  type="time"
                  className="input"
                  value={bFrom}
                  onChange={(e) => setBFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="b-to">
                  ถึง
                </label>
                <input
                  id="b-to"
                  type="time"
                  className="input"
                  value={bTo}
                  onChange={(e) => setBTo(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="b-note">
                  เหตุผล (ไม่บังคับ)
                </label>
                <input
                  id="b-note"
                  className="input"
                  placeholder="เช่น ช่วงรถเข้า"
                  value={bNote}
                  onChange={(e) => setBNote(e.target.value)}
                />
              </div>
            </div>
            <button
              type="button"
              className="btn-primary mt-3 px-4 py-2 text-sm"
              disabled={busy}
              onClick={() => {
                const a = hhmmToMin(bFrom)
                const b2 = hhmmToMin(bTo)
                if (a === null || b2 === null) {
                  setErr('รูปแบบเวลาไม่ถูกต้อง')
                  return
                }
                void run(async () => {
                  await saveBreakBan({ startMin: a, endMin: b2, note: bNote })
                  setBNote('')
                }, 'เพิ่มช่วงห้ามแล้ว')
              }}
            >
              เพิ่มช่วงห้ามประจำวัน
            </button>
          </section>

          <section className="rounded-card border border-line p-4">
            <h2 className="font-display text-md">นาทีเริ่มต้นของแต่ละเหตุผล</h2>
            <p className="mb-3 text-xs text-ink-500">
              เป็น <b>เวลาไปกลับรวม</b> ไม่ใช่เวลาเบรคสุทธิ เพราะนาฬิกาเริ่มเดินตั้งแต่หัวหน้ากดยื่นบัตร
              ต้องเผื่อเวลาเดินไปกลับไว้ในตัวเลขนี้ ไม่งั้นจะเกินเวลาแทบทุกใบ
            </p>
            <ul className="space-y-2">
              {s.reasons.map((r) => (
                <li key={r.code} className="flex flex-wrap items-center gap-2">
                  <span className="w-28 text-sm">{r.label}</span>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    aria-label={`นาทีของ ${r.label}`}
                    className="input w-24"
                    defaultValue={r.default_minutes}
                    onBlur={(e) => {
                      const v = Number(e.target.value)
                      if (v === r.default_minutes || !v) return
                      void run(
                        () =>
                          saveBreakReason({
                            code: r.code,
                            label: r.label,
                            minutes: v,
                            sort: r.sort,
                            active: r.active,
                          }),
                        `${r.label} = ${v} นาที`,
                      )
                    }}
                  />
                  <span className="text-sm text-ink-500">นาที</span>
                  <button
                    type="button"
                    className="btn-ghost ml-auto px-3 py-1 text-xs"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          saveBreakReason({
                            code: r.code,
                            label: r.label,
                            minutes: r.default_minutes,
                            sort: r.sort,
                            active: !r.active,
                          }),
                        r.active ? 'ซ่อนเหตุผลนี้แล้ว' : 'เปิดเหตุผลนี้แล้ว',
                      )
                    }
                  >
                    {r.active ? 'ซ่อน' : 'เปิด'}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-400">แก้ตัวเลขแล้วคลิกออกจากช่อง ระบบบันทึกให้เอง</p>
          </section>
        </div>
      )}

      {tab === 'alerts' && s && (
        <div className="space-y-5">
          <section className="rounded-card border border-line p-4">
            <h2 className="font-display text-md">ใครได้แจ้งเตือนเรื่องเบรค</h2>
            <p className="mb-3 text-xs text-ink-500">
              เด้งสองเรื่อง — <b>มีคนปล่อยเบรคในช่วงห้าม</b> และ <b>รปภ แจ้งว่าคนเข้าไม่ครบ</b>
              <br />
              ยิงทันทีที่กด ไม่รอรอบนาฬิกา · เข้าเป็นแจ้งเตือนบนมือถือ กดแล้วเข้าหน้าเบรคเลย
              <br />
              <b>ผู้ตรวจสอบและเจ้าของระบบได้รับเสมอ</b> ไม่ต้องใส่ที่นี่ ·
              หัวหน้าที่ปล่อยใบนั้นก็ได้รับด้วยเมื่อลูกน้องเข้าไม่ครบ
              <br />
              ช่องนี้ไว้เพิ่มคนนอกเหนือจากนั้น เช่น หัวหน้ากะอีกฝั่งที่ต้องรู้ด้วย
            </p>
            <PeoplePicker
              people={staff}
              selected={s.alert_subs}
              disabled={busy}
              emptyText="ยังไม่ได้เพิ่มใคร — ตอนนี้เตือนเฉพาะผู้ตรวจสอบและเจ้าของระบบ"
              onToggle={(id, next) =>
                void run(() => setBreakAlertSub(id, next), next ? 'เพิ่มแล้ว' : 'เอาออกแล้ว')
              }
            />
          </section>

          <section className="rounded-card border border-line p-4">
            <h2 className="font-display text-md">ใครกดห้ามเบรคเดี๋ยวนี้ได้</h2>
            <p className="mb-3 text-xs text-ink-500">
              คนกลุ่มนี้จะมีปุ่ม <b>&ldquo;ห้ามเบรคเดี๋ยวนี้&rdquo;</b> ในหน้าเบรคบนมือถือ
              กดแล้วเลือกกี่นาที แล้วมันหมดอายุเอง ไม่ต้องกลับมาปิด
              <br />
              ยกเลิกกลางคันได้ตลอด · เจ้าของระบบกดได้อยู่แล้วไม่ต้องใส่
              <br />
              ห้ามแล้วหัวหน้ายัง<b>ปล่อยได้ถ้าฉุกเฉิน</b> แต่ต้องพิมพ์เหตุผล
              และคนในรายชื่อข้างบนจะรู้ทันที
            </p>
            <PeoplePicker
              people={staff}
              selected={s.ban_users}
              disabled={busy}
              emptyText="ยังไม่ได้เพิ่มใคร — ตอนนี้มีแต่เจ้าของระบบที่กดได้"
              onToggle={(id, next) =>
                void run(
                  () => updateProfile(id, { can_break_ban: next } as Partial<Profile>),
                  next ? 'เพิ่มแล้ว' : 'เอาออกแล้ว',
                )
              }
            />
          </section>
        </div>
      )}

      {tab === 'print' && (
        <div>
          <div className="no-print mb-4 flex flex-wrap items-center gap-2">
            <select
              className="input w-auto"
              value={printGroup}
              aria-label="เลือกแผนกที่จะพิมพ์"
              onChange={(e) => setPrintGroup(e.target.value)}
            >
              <option value="">ทุกแผนก</option>
              {groups.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.code}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-primary px-4 py-2 text-sm"
              disabled={printable.length === 0}
              onClick={() => window.print()}
            >
              พิมพ์ {printable.length} ใบ
            </button>
            <p className="w-full text-xs text-ink-500">
              กระดาษ A4 ได้แผ่นละ 3×3 = 9 ใบ · ขนาดเท่าบัตรพนักงาน 54×86 มม.
              <br />
              เปิด &ldquo;กราฟิกพื้นหลัง&rdquo; ในหน้าต่างพิมพ์ด้วย ไม่งั้นได้กระดาษขาวกับตัวหนังสือ
            </p>
          </div>

          {printable.length === 0 ? (
            <EmptyState title="ยังไม่มีบัตรที่เปิดใช้งาน" hint="เพิ่มบัตรในแท็บบัตรและสิทธิ์ก่อน" />
          ) : (
            <div className="brk-sheet">
              {printable.map((c) => (
                <BreakCardFace
                  key={c.code}
                  code={c.code}
                  group={groups.find((g) => g.code === c.group_code)?.name ?? c.group_code}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** ช่วงห้ามประจำวันหนึ่งแถว — แก้เวลาได้ในที่ ไม่ต้องลบแล้วสร้างใหม่ */
function BanRow({
  b,
  busy,
  run,
}: {
  b: { id: number; start_min: number; end_min: number; note: string | null; active: boolean }
  busy: boolean
  run: (fn: () => Promise<unknown>, ok: string) => void
}) {
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState(minToHHMM(b.start_min))
  const [t, setT] = useState(minToHHMM(b.end_min))
  const [n, setN] = useState(b.note ?? '')

  if (edit) {
    return (
      <li className="rounded-btn border border-line p-3">
        <div className="flex flex-wrap items-end gap-2">
          <input type="time" className="input w-32" value={f} onChange={(e) => setF(e.target.value)} />
          <input type="time" className="input w-32" value={t} onChange={(e) => setT(e.target.value)} />
          <input
            className="input min-w-40 flex-1"
            placeholder="เหตุผล"
            value={n}
            onChange={(e) => setN(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary px-3 py-2 text-xs"
            disabled={busy}
            onClick={() => {
              const a = hhmmToMin(f)
              const z = hhmmToMin(t)
              if (a === null || z === null) return
              run(
                () =>
                  saveBreakBan({ id: b.id, startMin: a, endMin: z, note: n, active: b.active }),
                'แก้ช่วงห้ามแล้ว',
              )
              setEdit(false)
            }}
          >
            บันทึก
          </button>
          <button type="button" className="btn-ghost px-3 py-2 text-xs" onClick={() => setEdit(false)}>
            ยกเลิก
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-btn border border-line px-3 py-2 text-sm">
      <span className="font-mono font-bold">
        {minToHHMM(b.start_min)} – {minToHHMM(b.end_min)}
      </span>
      {b.start_min > b.end_min && <span className="badge-mute">ข้ามเที่ยงคืน</span>}
      <span className="min-w-0 flex-1 text-ink-500">{b.note ?? '—'}</span>
      {!b.active && <span className="badge-mute">ปิดอยู่</span>}
      <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => setEdit(true)}>
        แก้เวลา
      </button>
      <button
        type="button"
        className="btn-ghost px-3 py-1 text-xs"
        disabled={busy}
        onClick={() =>
          run(
            () =>
              saveBreakBan({
                id: b.id,
                startMin: b.start_min,
                endMin: b.end_min,
                note: b.note,
                active: !b.active,
              }),
            b.active ? 'ปิดช่วงนี้แล้ว' : 'เปิดช่วงนี้แล้ว',
          )
        }
      >
        {b.active ? 'ปิดใช้' : 'เปิดใช้'}
      </button>
      <button
        type="button"
        className="btn-ghost px-3 py-1 text-xs text-danger-txt"
        disabled={busy}
        onClick={() => run(() => deleteBreakBan(b.id), 'ลบช่วงนี้แล้ว')}
      >
        ลบ
      </button>
    </li>
  )
}

/* ───────────────────────── แท็บบัตรและสิทธิ์ ───────────────────────── */

type Grp = { code: string; name: string | null; max_open: number; active: boolean; users: string[] }
type Crd = { code: string; group_code: string; active: boolean; busy: boolean; used: boolean }

function CardsTab(p: {
  groups: Grp[]
  cards: Crd[]
  staff: Profile[]
  busy: boolean
  run: (fn: () => Promise<unknown>, ok: string) => void
  sel: string[]
  setSel: (v: string[]) => void
  gCode: string
  setGCode: (v: string) => void
  gName: string
  setGName: (v: string) => void
  gMax: number
  setGMax: (v: number) => void
  target: string
  setTarget: (v: string) => void
  prefix: string
  setPrefix: (v: string) => void
  from: number
  setFrom: (v: number) => void
  to: number
  setTo: (v: number) => void
  pad: number
  setPad: (v: number) => void
  preview: string[]
  setMsg: (v: string) => void
}) {
  const selSet = new Set(p.sel)
  const selCards = p.cards.filter((c) => selSet.has(c.code))
  const canDelete = selCards.filter((c) => !c.used && !c.busy).length

  return (
    <div className="space-y-5">
      {/* ───────── เพิ่มแผนก ───────── */}
      <section className="rounded-card border border-line p-4">
        <h2 className="mb-1 font-display text-md">เพิ่มแผนกบัตร</h2>
        <p className="mb-3 text-xs text-ink-500">
          บัตรผูกกับแผนก ไม่ได้ผูกกับตัวพนักงาน OS · เพดานคือจำนวนใบที่แผนกนี้ปล่อยพร้อมกันได้
          ใส่ 0 = ไม่จำกัด
        </p>
        <div className="grid gap-2 sm:grid-cols-4">
          <div>
            <label className="label" htmlFor="g-code">
              รหัสแผนก
            </label>
            <input
              id="g-code"
              className="input"
              placeholder="OUT4"
              value={p.gCode}
              onChange={(e) => p.setGCode(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="g-name">
              ชื่อเรียก (ไม่บังคับ)
            </label>
            <input
              id="g-name"
              className="input"
              placeholder="ขาออก 4"
              value={p.gName}
              onChange={(e) => p.setGName(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="g-max">
              เพดานพร้อมกัน
            </label>
            <input
              id="g-max"
              type="number"
              min={0}
              max={50}
              className="input"
              value={p.gMax}
              onChange={(e) => p.setGMax(Number(e.target.value))}
            />
          </div>
        </div>
        <button
          type="button"
          className="btn-primary mt-3 px-4 py-2 text-sm"
          disabled={p.busy || !p.gCode.trim()}
          onClick={() =>
            p.run(async () => {
              await saveBreakGroup({ code: p.gCode, name: p.gName, maxOpen: p.gMax })
              p.setGCode('')
              p.setGName('')
            }, 'บันทึกแผนกแล้ว')
          }
        >
          บันทึกแผนก
        </button>
      </section>

      {/* ───────── เพิ่มบัตรเป็นชุด ───────── */}
      {p.groups.length > 0 && (
        <section className="rounded-card border border-line p-4">
          <h2 className="mb-1 font-display text-md">เพิ่มบัตรเป็นชุด</h2>
          <p className="mb-3 text-xs text-ink-500">
            ใช้ได้เฉพาะ A-Z 0-9 ขีดกลาง ขีดล่าง · ภาษาไทยใช้ไม่ได้ เพราะ รปภ
            ต้องพิมพ์รหัสเองตอน QR เปื้อน
          </p>
          <div className="grid gap-2 sm:grid-cols-5">
            <div>
              <label className="label" htmlFor="c-grp">
                แผนก
              </label>
              <select
                id="c-grp"
                className="input"
                value={p.target}
                onChange={(e) => p.setTarget(e.target.value)}
              >
                {p.groups.map((g) => (
                  <option key={g.code} value={g.code}>
                    {g.code}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="c-pre">
                ขึ้นต้นด้วย
              </label>
              <input
                id="c-pre"
                className="input"
                placeholder="OUT4-"
                value={p.prefix}
                onChange={(e) => p.setPrefix(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="c-from">
                เลขที่
              </label>
              <div className="flex items-center gap-1">
                <input
                  id="c-from"
                  type="number"
                  min={0}
                  className="input"
                  value={p.from}
                  onChange={(e) => p.setFrom(Number(e.target.value))}
                />
                <span className="text-sm text-ink-500">–</span>
                <input
                  type="number"
                  min={0}
                  aria-label="ถึงเลขที่"
                  className="input"
                  value={p.to}
                  onChange={(e) => p.setTo(Number(e.target.value))}
                />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="c-pad">
                เติมศูนย์
              </label>
              <input
                id="c-pad"
                type="number"
                min={1}
                max={4}
                className="input"
                value={p.pad}
                onChange={(e) => p.setPad(Number(e.target.value))}
              />
            </div>
          </div>

          {p.preview.length > 0 && (
            <p className="mt-3 rounded-btn bg-ink/5 px-3 py-2 font-mono text-xs text-ink-700">
              {p.preview.slice(0, 12).join(' · ')}
              {p.preview.length > 12 ? ` … รวม ${p.preview.length} ใบ` : ''}
            </p>
          )}

          <button
            type="button"
            className="btn-primary mt-3 px-4 py-2 text-sm"
            disabled={p.busy || p.preview.length === 0 || !p.target}
            onClick={() =>
              p.run(async () => {
                const r = await addBreakCards(p.target, p.preview)
                p.setPrefix('')
                p.setMsg(`เพิ่ม ${r.added} ใบ · มีอยู่แล้ว ${r.skipped} ใบ`)
              }, 'เพิ่มบัตรแล้ว')
            }
          >
            เพิ่ม {p.preview.length} ใบ
          </button>
        </section>
      )}

      {/* ───────── แถบจัดการบัตรที่เลือก ───────── */}
      {p.sel.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-card border border-ink bg-surface p-3 shadow">
          <span className="text-sm font-semibold">เลือกไว้ {p.sel.length} ใบ</span>
          <button
            type="button"
            className="btn-ghost px-3 py-1.5 text-xs"
            disabled={p.busy}
            onClick={() =>
              p.run(async () => {
                for (const c of selCards.filter((x) => x.active && !x.busy)) {
                  await saveBreakCard({ code: c.code, active: false })
                }
                p.setSel([])
              }, 'ปิดใช้งานแล้ว')
            }
          >
            ปิดใช้งาน
          </button>
          <button
            type="button"
            className="btn-ghost px-3 py-1.5 text-xs"
            disabled={p.busy}
            onClick={() =>
              p.run(async () => {
                for (const c of selCards.filter((x) => !x.active)) {
                  await saveBreakCard({ code: c.code, active: true })
                }
                p.setSel([])
              }, 'เปิดใช้งานแล้ว')
            }
          >
            เปิดใช้งาน
          </button>
          <button
            type="button"
            className="rounded-btn border border-danger/40 px-3 py-1.5 text-xs font-semibold text-danger-txt disabled:opacity-40"
            disabled={p.busy || canDelete === 0}
            onClick={() =>
              p.run(async () => {
                const r = await deleteBreakCards(p.sel)
                p.setSel([])
                p.setMsg(
                  r.kept.length === 0
                    ? `ลบ ${r.deleted} ใบแล้ว`
                    : `ลบ ${r.deleted} ใบ · ลบไม่ได้ ${r.kept.length} ใบ — ` +
                      r.kept.map((k) => `${k.code} (${k.why})`).join(' · '),
                )
              }, 'ลบบัตรแล้ว')
            }
          >
            ลบ {canDelete > 0 ? `${canDelete} ใบ` : '(ไม่มีใบที่ลบได้)'}
          </button>
          <button
            type="button"
            className="btn-ghost ml-auto px-3 py-1.5 text-xs"
            onClick={() => p.setSel([])}
          >
            ยกเลิกเลือก
          </button>
          <p className="w-full text-xs text-ink-500">
            ลบได้เฉพาะบัตรที่<b>ยังไม่เคยถูกปล่อย</b> · ใบที่เคยใช้แล้วลบไม่ได้เพราะประวัติอ้างถึงรหัสนั้นอยู่
            ให้ปิดใช้งานแทน ซึ่งซ่อนจากทุกหน้าโดยไม่ทำลายอะไร
          </p>
        </div>
      )}

      {/* ───────── รายแผนก ───────── */}
      {p.groups.length === 0 ? (
        <EmptyState title="ยังไม่มีแผนกบัตร" hint="สร้างแผนกก่อน แล้วค่อยเพิ่มบัตรเข้าไป" />
      ) : (
        p.groups.map((g) => {
          const mine = p.cards.filter((c) => c.group_code === g.code)
          return (
            <section key={g.code} className="rounded-card border border-line p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="font-display text-md">
                  {g.code}
                  {g.name ? <span className="ml-2 text-sm text-ink-500">{g.name}</span> : null}
                </h3>
                <span className="badge-mute">
                  {mine.length} ใบ · เพดาน {g.max_open === 0 ? 'ไม่จำกัด' : `${g.max_open} ใบ`}
                </span>
                {!g.active && <span className="badge-dang">ปิดใช้งาน</span>}
                {mine.length > 0 && (
                  <button
                    type="button"
                    className="btn-ghost px-3 py-1 text-xs"
                    onClick={() => {
                      const codes = mine.map((c) => c.code)
                      const allOn = codes.every((c) => selSet.has(c))
                      p.setSel(
                        allOn
                          ? p.sel.filter((c) => !codes.includes(c))
                          : [...new Set([...p.sel, ...codes])],
                      )
                    }}
                  >
                    เลือกทั้งแผนก
                  </button>
                )}
                <button
                  type="button"
                  className="btn-ghost ml-auto px-3 py-1 text-xs"
                  disabled={p.busy}
                  onClick={() =>
                    p.run(
                      () =>
                        saveBreakGroup({
                          code: g.code,
                          name: g.name,
                          maxOpen: g.max_open,
                          active: !g.active,
                        }),
                      g.active ? 'ปิดแผนกแล้ว' : 'เปิดแผนกแล้ว',
                    )
                  }
                >
                  {g.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                </button>
              </div>

              {mine.length === 0 ? (
                <p className="text-sm text-ink-500">ยังไม่มีบัตรในแผนกนี้</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {mine.map((c) => {
                      const on = selSet.has(c.code)
                      return (
                        <button
                          key={c.code}
                          type="button"
                          title={
                            c.busy
                              ? 'ใบนี้ยังไม่ได้รับกลับ'
                              : c.used
                                ? 'เคยใช้งานแล้ว ลบไม่ได้ ปิดใช้งานแทนได้'
                                : 'ยังไม่เคยถูกปล่อย ลบได้'
                          }
                          className={`rounded-btn border px-2.5 py-1 font-mono text-xs ${
                            on
                              ? 'border-ink bg-ink text-white'
                              : c.busy
                                ? 'border-warn/40 bg-warn-bg text-warn-txt'
                                : c.active
                                  ? 'border-line bg-white text-ink-700'
                                  : 'border-line bg-ink/5 text-ink-500 line-through'
                          }`}
                          onClick={() =>
                            p.setSel(
                              on ? p.sel.filter((x) => x !== c.code) : [...p.sel, c.code],
                            )
                          }
                        >
                          {c.code}
                          {c.busy ? ' ●' : c.used ? ' ·' : ''}
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-1.5 text-xs text-ink-400">
                    กดที่บัตรเพื่อเลือก · <b>●</b> กำลังออกไป · <b>·</b> เคยใช้แล้ว ลบไม่ได้ ·
                    ขีดฆ่า = ปิดใช้งานอยู่
                  </p>
                </>
              )}

              {/* ───── ใครใช้บัตรแผนกนี้ได้ ───── */}
              <div className="mt-4 rounded-card border border-line-2 bg-ink/5 p-3">
                <p className="mb-1 text-sm font-semibold">ใครปล่อยบัตรแผนกนี้ได้</p>
                <p className="mb-2 text-xs text-ink-500">
                  คนในรายชื่อนี้เท่านั้นที่จะ<b>เห็นบัตรของแผนก {g.code}</b> ในมือถือและปล่อยได้
                  <br />
                  ต้องเปิดสิทธิ์ &ldquo;ปล่อยบัตรเบรค&rdquo; ในหน้าสิทธิ์เข้าถึงด้วย
                  ใส่ชื่อที่นี่อย่างเดียวยังปล่อยไม่ได้
                </p>
                <PeoplePicker
                  people={p.staff}
                  selected={g.users}
                  disabled={p.busy}
                  emptyText={`ยังไม่มีใครดูแลบัตรแผนก ${g.code} — ตอนนี้ไม่มีใครปล่อยบัตรแผนกนี้ได้เลย`}
                  placeholder="พิมพ์ชื่อหรือรหัสพนักงานเพื่อเพิ่ม"
                  onToggle={(id, next) =>
                    p.run(
                      () => setBreakGroupUser(g.code, id, next),
                      next ? 'เพิ่มคนดูแลแล้ว' : 'เอาออกแล้ว',
                    )
                  }
                />
                {g.users.some(
                  (id) => !p.staff.find((x) => x.id === id)?.can_break_issue,
                ) && (
                  <p className="mt-2 rounded-btn bg-warn-bg px-3 py-2 text-xs text-warn-txt">
                    มีคนในรายชื่อที่ยังไม่ได้เปิดสิทธิ์ &ldquo;ปล่อยบัตรเบรค&rdquo; —
                    เขาจะยังเข้าหน้าปล่อยบัตรไม่ได้ ไปเปิดที่หน้าสิทธิ์เข้าถึง
                  </p>
                )}
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}
