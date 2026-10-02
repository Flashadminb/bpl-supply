import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { useAsync } from '../../lib/useAsync'
import { listProfiles, updateProfile } from '../../lib/api'
import { PeoplePicker } from '../../components/PeoplePicker'
import { BreakBanBar } from '../../components/BreakBanBar'
import { ErrorBox, Loading, EmptyState } from '../../components/ui'
import type { Profile } from '../../lib/types'
import {
  addBreakCards,
  breakBanNext,
  breakBanNow,
  deleteBreakCards,
  deleteBreakGroup,
  getBreakSettings,
  saveBreakCard,
  saveBreakGroup,
  saveBreakReason,
  setBreakAlertSub,
  setBreakGroupUser,
} from '../../lib/breakPass'

/**
 * จัดการบัตรเบรค
 *
 * หน้านี้เคยเป็นกองฟอร์มซ้อนกันสามชั้นแล้วค่อยมีข้อมูลอยู่ล่างสุด
 * ซึ่งผิดลำดับ คนเปิดมาเพื่อ "ดูว่ามีอะไรอยู่" ไม่ใช่เพื่อ "กรอกฟอร์ม"
 *
 * ตอนนี้เห็นแผนกกับบัตรก่อน ปุ่มเพิ่มอยู่ในแผนกนั้น ๆ เลย
 * ไม่ต้องเลื่อนขึ้นไปกรอกฟอร์มกลางแล้วเลือกแผนกซ้ำอีกรอบ
 * และตัวนำหน้ารหัสเติมให้จากรหัสแผนกเอง — ของเดิมเป็นช่องว่างที่มี placeholder
 * หน้าตาเหมือนกรอกแล้ว ทำให้กดเพิ่มได้ 0 ใบโดยไม่รู้ว่าทำไม
 */

const NAVY = '#1B2A4A'
const Y = '#F5B301'

type Tab = 'cards' | 'ban' | 'alerts' | 'print'

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
         ปล่อยไว้แล้วรหัสยาวจะตัดกลางคำ กลายเป็น PICK-NIGHT-1 ขึ้นบรรทัดใหม่เป็น 2 */
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
    QRCode.toDataURL(text, { width: size * 3, margin: 0, errorCorrectionLevel: 'Q' })
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null))
    return () => {
      alive = false
    }
  }, [text, size])
  return <span className="block">{url && <img src={url} alt="" />}</span>
}

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

type Grp = { code: string; name: string | null; max_open: number; active: boolean; users: string[] }
type Crd = { code: string; group_code: string; active: boolean; busy: boolean; used: boolean }
type Run = (fn: () => Promise<unknown>, ok: string) => void

export default function BreakCards() {
  const [tab, setTab] = useState<Tab>('cards')
  const settings = useAsync(() => getBreakSettings(), [])
  const people = useAsync(() => listProfiles(), [])
  const [tick, setTick] = useState(0)
  const ban = useAsync(() => breakBanNow(), [tick])
  const banNext = useAsync(() => breakBanNext(), [tick])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [sel, setSel] = useState<string[]>([])
  const [printGroup, setPrintGroup] = useState('')

  const s = settings.data
  const groups = s?.groups ?? []
  const cards = s?.cards ?? []
  const staff = useMemo(() => (people.data ?? []).filter((p) => p.is_active), [people.data])

  const printable = useMemo(
    () => cards.filter((c) => c.active && (!printGroup || c.group_code === printGroup)),
    [cards, printGroup],
  )

  const run: Run = (fn, ok) => {
    setBusy(true)
    setErr(null)
    setMsg(null)
    void (async () => {
      try {
        await fn()
        setMsg(ok)
        settings.reload()
      } catch (e) {
        setErr((e as Error).message)
      } finally {
        setBusy(false)
      }
    })()
  }

  if (settings.loading && !s) return <Loading />
  if (settings.error) return <ErrorBox message={settings.error} onRetry={settings.reload} />

  const selSet = new Set(sel)
  const selCards = cards.filter((c) => selSet.has(c.code))
  const canDelete = selCards.filter((c) => !c.used && !c.busy).length

  const TABS: [Tab, string][] = [
    ['cards', `บัตรและสิทธิ์ (${cards.length})`],
    ['ban', ban.data ? 'ห้ามเบรค 🔴' : 'ห้ามเบรคและนาที'],
    ['alerts', 'แจ้งเตือน'],
    ['print', `พิมพ์ (${printable.length})`],
  ]

  return (
    <div>
      <BreakCardStyles />

      <div className="no-print mb-4">
        <h1 className="font-display text-xl">จัดการบัตรเบรค</h1>
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

      {/* ═══════════════ บัตรและสิทธิ์ ═══════════════ */}
      {tab === 'cards' && (
        <div className="space-y-4">
          {sel.length > 0 && (
            <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-card border-2 border-ink bg-surface p-3 shadow">
              <span className="text-sm font-semibold">เลือกไว้ {sel.length} ใบ</span>
              <button
                type="button"
                className="btn-ghost px-3 py-1.5 text-xs"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    for (const c of selCards.filter((x) => x.active && !x.busy)) {
                      await saveBreakCard({ code: c.code, active: false })
                    }
                    setSel([])
                  }, 'ปิดใช้งานแล้ว')
                }
              >
                ปิดใช้งาน
              </button>
              <button
                type="button"
                className="btn-ghost px-3 py-1.5 text-xs"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    for (const c of selCards.filter((x) => !x.active)) {
                      await saveBreakCard({ code: c.code, active: true })
                    }
                    setSel([])
                  }, 'เปิดใช้งานแล้ว')
                }
              >
                เปิดใช้งาน
              </button>
              <button
                type="button"
                className="rounded-btn border border-danger/40 px-3 py-1.5 text-xs font-semibold text-danger-txt disabled:opacity-40"
                disabled={busy || canDelete === 0}
                onClick={() =>
                  run(async () => {
                    const r = await deleteBreakCards(sel)
                    setSel([])
                    setMsg(
                      r.kept.length === 0
                        ? `ลบ ${r.deleted} ใบแล้ว`
                        : `ลบ ${r.deleted} ใบ · ลบไม่ได้ ${r.kept.length} ใบ — ` +
                          r.kept.map((k) => `${k.code} (${k.why})`).join(' · '),
                    )
                  }, 'ลบบัตรแล้ว')
                }
              >
                ลบ {canDelete > 0 ? `${canDelete} ใบ` : '(ลบไม่ได้)'}
              </button>
              <button
                type="button"
                className="btn-ghost ml-auto px-3 py-1.5 text-xs"
                onClick={() => setSel([])}
              >
                ยกเลิกเลือก
              </button>
            </div>
          )}

          <QuickAdd busy={busy} run={run} setMsg={setMsg} />

          {groups.length === 0 && (
            <EmptyState
              title="ยังไม่มีบัตร"
              hint="ใส่ตัวนำหน้ากับจำนวนข้างบนแล้วกดเพิ่มได้เลย กลุ่มสร้างให้เอง"
            />
          )}

          {groups.map((g) => (
            <GroupCard
              key={g.code}
              g={g}
              cards={cards.filter((c) => c.group_code === g.code)}
              staff={staff}
              busy={busy}
              run={run}
              sel={sel}
              setSel={setSel}
              setMsg={setMsg}
            />
          ))}

        </div>
      )}

      {/* ═══════════════ ห้ามเบรคและนาที ═══════════════ */}
      {tab === 'ban' && s && (
        <div className="space-y-5">
          <section className="rounded-card border border-line p-4">
            <h2 className="mb-1 font-display text-md">ห้ามเบรค</h2>
            <p className="mb-3 text-xs text-ink-500">
              <b>ไม่กดห้าม = เบรคได้ตลอด</b> ไม่มีช่วงห้ามประจำวันให้ต้องมาตั้งทุกวัน
              <br />
              กดแล้วเลือกเองว่าถึงกี่โมง ครบเวลาปลดเอง ยกเลิกกลางคันได้ตลอด
              <br />
              ห้ามแล้วหัวหน้ายัง<b>ปล่อยได้ถ้าฉุกเฉิน</b> แต่ต้องพิมพ์เหตุผล
              แล้วคนในแท็บแจ้งเตือนจะรู้ทันที และใบนั้นติดป้ายถาวรในประวัติ
            </p>
            <BreakBanBar
              ban={ban.data ?? null}
              next={banNext.data ?? null}
              now={now}
              onChanged={() => setTick((n) => n + 1)}
            />
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
                      run(
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
                      run(
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

      {/* ═══════════════ แจ้งเตือน ═══════════════ */}
      {tab === 'alerts' && s && (
        <div className="space-y-5">
          <section className="rounded-card border border-line p-4">
            <h2 className="font-display text-md">ใครได้แจ้งเตือนเรื่องเบรค</h2>
            <p className="mb-3 text-xs text-ink-500">
              เด้งสองเรื่อง — <b>มีคนปล่อยเบรคในช่วงห้าม</b> และ <b>รปภ แจ้งว่าคนเข้าไม่ครบ</b>
              <br />
              ยิงทันทีที่กด ไม่รอรอบนาฬิกา · เด้งบนมือถือ กดแล้วเข้าหน้าเบรคเลย
              <br />
              <b>ผู้ตรวจสอบและเจ้าของระบบได้รับเสมอ</b> ไม่ต้องใส่ที่นี่ ·
              หัวหน้าที่ปล่อยใบนั้นก็ได้รับด้วยเมื่อลูกน้องเข้าไม่ครบ
            </p>
            <PeoplePicker
              people={staff}
              selected={s.alert_subs}
              disabled={busy}
              emptyText="ยังไม่ได้เพิ่มใคร — ตอนนี้เตือนเฉพาะผู้ตรวจสอบและเจ้าของระบบ"
              onToggle={(id, next) =>
                run(() => setBreakAlertSub(id, next), next ? 'เพิ่มแล้ว' : 'เอาออกแล้ว')
              }
            />
          </section>

          <section className="rounded-card border border-line p-4">
            <h2 className="font-display text-md">ใครกดห้ามเบรคได้</h2>
            <p className="mb-3 text-xs text-ink-500">
              คนกลุ่มนี้จะมีปุ่ม <b>&ldquo;ห้ามเบรค&rdquo;</b> ในหน้าเบรคบนมือถือ
              · เจ้าของระบบกดได้อยู่แล้วไม่ต้องใส่
            </p>
            <PeoplePicker
              people={staff}
              selected={s.ban_users}
              disabled={busy}
              emptyText="ยังไม่ได้เพิ่มใคร — ตอนนี้มีแต่เจ้าของระบบที่กดได้"
              onToggle={(id, next) =>
                run(
                  () => updateProfile(id, { can_break_ban: next } as Partial<Profile>),
                  next ? 'เพิ่มแล้ว' : 'เอาออกแล้ว',
                )
              }
            />
          </section>
        </div>
      )}

      {/* ═══════════════ พิมพ์ ═══════════════ */}
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

/* ───────────────────────── เพิ่มบัตรแบบขั้นตอนเดียว ───────────────────────── */

/**
 * กลุ่มบัตรสร้างให้เองจากตัวนำหน้า
 *
 * ของเดิมต้องสร้างกลุ่มก่อน แล้วค่อยเลื่อนไปอีกฟอร์มเพื่อเลือกกลุ่มแล้วใส่บัตร
 * สองขั้นตอนทั้งที่ข้อมูลเดียวกัน และเจ้าของระบบพิมพ์ OUT4-01 ลงช่องรหัสกลุ่ม
 * จนได้กลุ่มชื่อ OUT4-01 ที่ไม่มีความหมาย เพราะสองช่องนั้นหน้าตาเหมือนกัน
 *
 * ตอนนี้พิมพ์ตัวนำหน้าที่เดียว OUT4- แล้วระบบตัดขีดท้ายออกเป็นชื่อกลุ่มเอง
 * ไม่มีทางพิมพ์ผิดช่อง เพราะเหลือช่องเดียว
 */
function QuickAdd({
  busy,
  run,
  setMsg,
}: {
  busy: boolean
  run: Run
  setMsg: (v: string) => void
}) {
  const [prefix, setPrefix] = useState('')
  const [count, setCount] = useState(5)
  const [start, setStart] = useState(1)

  const pre = prefix.trim().toUpperCase()
  const group = pre.replace(/[-_]+$/, '')
  const preview = useMemo(() => {
    if (!group) return []
    const sep = pre.endsWith('-') || pre.endsWith('_') ? pre : `${pre}-`
    const out: string[] = []
    for (let i = 0; i < Math.min(Math.max(count, 0), 200); i++) {
      out.push(`${sep}${String(start + i).padStart(2, '0')}`)
    }
    return out
  }, [pre, group, count, start])

  return (
    <section className="rounded-card border border-line p-4">
      <h2 className="mb-1 font-display text-md">เพิ่มบัตร</h2>
      <p className="mb-3 text-xs text-ink-500">
        พิมพ์ตัวนำหน้ากับจำนวน แล้วกดเพิ่ม — จบในขั้นตอนเดียว
        <br />
        กลุ่มบัตรสร้างให้เองจากตัวนำหน้า · ใช้ได้เฉพาะ A-Z 0-9 ขีดกลาง ขีดล่าง
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <label className="label" htmlFor="q-pre">
            ตัวนำหน้า
          </label>
          <input
            id="q-pre"
            className="input font-mono"
            placeholder="OUT4-"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="q-cnt">
            กี่ใบ
          </label>
          <input
            id="q-cnt"
            type="number"
            min={1}
            max={200}
            className="input w-24"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label" htmlFor="q-st">
            เริ่มที่เลข
          </label>
          <input
            id="q-st"
            type="number"
            min={1}
            className="input w-24"
            value={start}
            onChange={(e) => setStart(Number(e.target.value))}
          />
        </div>
        <button
          type="button"
          className="btn-primary px-5 py-2.5 text-sm"
          disabled={busy || preview.length === 0}
          onClick={() =>
            run(async () => {
              // สร้างกลุ่มให้เองถ้ายังไม่มี · มีอยู่แล้วก็ไม่ทับค่าที่ตั้งไว้
              await saveBreakGroup({ code: group, maxOpen: 3 })
              const r = await addBreakCards(group, preview)
              setPrefix('')
              setMsg(`เพิ่ม ${r.added} ใบเข้ากลุ่ม ${group} · มีอยู่แล้ว ${r.skipped} ใบ`)
            }, 'เพิ่มบัตรแล้ว')
          }
        >
          เพิ่ม {preview.length} ใบ
        </button>
      </div>

      {preview.length > 0 && (
        <p className="mt-3 rounded-btn bg-ink/5 px-3 py-2 font-mono text-xs text-ink-700">
          กลุ่ม {group} → {preview.slice(0, 10).join(' · ')}
          {preview.length > 10 ? ` … ถึง ${preview[preview.length - 1]}` : ''}
        </p>
      )}
    </section>
  )
}

/* ───────────────────────── แผนกหนึ่งกล่อง ───────────────────────── */

function GroupCard({
  g,
  cards,
  staff,
  busy,
  run,
  sel,
  setSel,
  setMsg,
}: {
  g: Grp
  cards: Crd[]
  staff: Profile[]
  busy: boolean
  run: Run
  sel: string[]
  setSel: (v: string[]) => void
  setMsg: (v: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editPeople, setEditPeople] = useState(false)

  const [name, setName] = useState(g.name ?? '')
  const [max, setMax] = useState(g.max_open)

  const selSet = new Set(sel)
  const owners = staff.filter((p) => g.users.includes(p.id))
  const missingFlag = owners.filter((p) => !p.can_break_issue)

  // เลขถัดไปที่ยังว่าง · เติมให้เลยจะได้ไม่ต้องไล่ดูเองว่าทำถึงใบไหนแล้ว
  const nextNo = useMemo(() => {
    const re = new RegExp(`^${g.code}-(\\d+)$`)
    const used = cards.map((c) => Number(re.exec(c.code)?.[1])).filter((n) => !Number.isNaN(n))
    return used.length === 0 ? 1 : Math.max(...used) + 1
  }, [cards, g.code])

  const [count, setCount] = useState(5)
  const [start, setStart] = useState(nextNo)
  useEffect(() => setStart(nextNo), [nextNo])

  const preview = useMemo(() => {
    const out: string[] = []
    for (let i = 0; i < Math.min(count, 200); i++) {
      out.push(`${g.code}-${String(start + i).padStart(2, '0')}`)
    }
    return out
  }, [count, start, g.code])

  const codes = cards.map((c) => c.code)
  const allOn = codes.length > 0 && codes.every((c) => selSet.has(c))

  return (
    <section className="rounded-card border border-line p-4">
      {/* ───── หัวกล่อง ───── */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-md">
          <span className="font-mono">{g.code}</span>
          {g.name ? <span className="ml-2 text-sm font-sans text-ink-500">{g.name}</span> : null}
        </h3>
        {!g.active && <span className="badge-dang">ปิดใช้งาน</span>}
        <span className="text-xs text-ink-500">
          {cards.length} ใบ · ปล่อยพร้อมกันได้{' '}
          {g.max_open === 0 ? 'ไม่จำกัด' : `${g.max_open} ใบ`}
        </span>
        <button
          type="button"
          className="btn-ghost ml-auto px-3 py-1 text-xs"
          onClick={() => setEditing(!editing)}
        >
          {editing ? 'ปิด' : 'แก้ไขแผนก'}
        </button>
      </div>

      {editing && (
        <div className="mt-3 rounded-card border border-line-2 bg-ink/5 p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="label" htmlFor={`n-${g.code}`}>
                ชื่อเรียก
              </label>
              <input
                id={`n-${g.code}`}
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor={`m-${g.code}`}>
                ปล่อยพร้อมกันได้ (0 = ไม่จำกัด)
              </label>
              <input
                id={`m-${g.code}`}
                type="number"
                min={0}
                max={50}
                className="input"
                value={max}
                onChange={(e) => setMax(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary px-4 py-2 text-xs"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await saveBreakGroup({ code: g.code, name, maxOpen: max, active: g.active })
                  setEditing(false)
                }, 'บันทึกแล้ว')
              }
            >
              บันทึก
            </button>
            <button
              type="button"
              className="btn-ghost px-4 py-2 text-xs"
              disabled={busy}
              onClick={() =>
                run(
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
              {g.active ? 'ปิดใช้งานแผนก' : 'เปิดใช้งานแผนก'}
            </button>
            <button
              type="button"
              className="ml-auto rounded-btn border border-danger/40 px-4 py-2 text-xs font-semibold text-danger-txt"
              disabled={busy}
              onClick={() =>
                run(
                  () => deleteBreakGroup(g.code),
                  `ลบแผนก ${g.code} แล้ว`,
                )
              }
            >
              ลบแผนกนี้
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-400">
            ลบแผนกได้เฉพาะตอนที่บัตรในแผนกยังไม่เคยถูกปล่อย · บัตรจะหายไปพร้อมกัน
          </p>
        </div>
      )}

      {/* ───── บัตร ───── */}
      <div className="mt-3">
        {cards.length === 0 ? (
          <p className="text-sm text-ink-500">ยังไม่มีบัตรในแผนกนี้</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {cards.map((c) => {
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
                      setSel(on ? sel.filter((x) => x !== c.code) : [...sel, c.code])
                    }
                  >
                    {c.code}
                    {c.busy ? ' ●' : c.used ? ' ·' : ''}
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-xs text-ink-400">
              กดที่บัตรเพื่อเลือก แล้วปุ่มลบจะโผล่ด้านบน · <b>●</b> กำลังออกไป · <b>·</b> เคยใช้แล้ว
              ลบไม่ได้ · ขีดฆ่า = ปิดใช้งานอยู่
            </p>
          </>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-ghost px-3 py-1.5 text-xs"
            onClick={() => setAdding(!adding)}
          >
            {adding ? 'ปิด' : '+ เพิ่มบัตร'}
          </button>
          {cards.length > 0 && (
            <button
              type="button"
              className="btn-ghost px-3 py-1.5 text-xs"
              onClick={() =>
                setSel(allOn ? sel.filter((c) => !codes.includes(c)) : [...new Set([...sel, ...codes])])
              }
            >
              {allOn ? 'เอาออกทั้งแผนก' : 'เลือกทั้งแผนก'}
            </button>
          )}
        </div>

        {adding && (
          <div className="mt-2 rounded-card border border-line-2 bg-ink/5 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="label" htmlFor={`cnt-${g.code}`}>
                  เพิ่มกี่ใบ
                </label>
                <input
                  id={`cnt-${g.code}`}
                  type="number"
                  min={1}
                  max={200}
                  className="input w-24"
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="label" htmlFor={`st-${g.code}`}>
                  เริ่มที่เลข
                </label>
                <input
                  id={`st-${g.code}`}
                  type="number"
                  min={1}
                  className="input w-24"
                  value={start}
                  onChange={(e) => setStart(Number(e.target.value))}
                />
              </div>
              <button
                type="button"
                className="btn-primary px-4 py-2 text-sm"
                disabled={busy || preview.length === 0}
                onClick={() =>
                  run(async () => {
                    const r = await addBreakCards(g.code, preview)
                    setAdding(false)
                    setMsg(`เพิ่ม ${r.added} ใบ · มีอยู่แล้ว ${r.skipped} ใบ`)
                  }, 'เพิ่มบัตรแล้ว')
                }
              >
                เพิ่ม {preview.length} ใบ
              </button>
            </div>
            <p className="mt-2 rounded-btn bg-white px-3 py-2 font-mono text-xs text-ink-700">
              {preview.slice(0, 10).join(' · ')}
              {preview.length > 10 ? ` … ถึง ${preview[preview.length - 1]}` : ''}
            </p>
            <p className="mt-1 text-xs text-ink-400">
              รหัสสร้างจากรหัสแผนกให้เอง · ใบที่มีอยู่แล้วจะถูกข้ามไป ไม่ซ้ำ
            </p>
          </div>
        )}
      </div>

      {/* ───── ใครปล่อยได้ ───── */}
      <div className="mt-4 border-t border-line-2 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">ใครปล่อยบัตรแผนกนี้ได้</span>
          <span className="min-w-0 flex-1 text-sm text-ink-500">
            {owners.length === 0 ? (
              <span className="text-danger-txt">ยังไม่มีใคร — ตอนนี้ไม่มีใครปล่อยบัตรแผนกนี้ได้เลย</span>
            ) : (
              owners.map((p) => p.full_name).join(' · ')
            )}
          </span>
          <button
            type="button"
            className="btn-ghost px-3 py-1 text-xs"
            onClick={() => setEditPeople(!editPeople)}
          >
            {editPeople ? 'ปิด' : 'แก้ไข'}
          </button>
        </div>

        {missingFlag.length > 0 && (
          <p className="mt-2 rounded-btn bg-warn-bg px-3 py-2 text-xs text-warn-txt">
            {missingFlag.map((p) => p.full_name).join(' · ')} ยังไม่ได้เปิดสิทธิ์
            &ldquo;ปล่อยบัตรเบรค&rdquo; — เขาจะยังเข้าหน้าปล่อยบัตรไม่ได้ ไปเปิดที่หน้าสิทธิ์เข้าถึง
          </p>
        )}

        {editPeople && (
          <div className="mt-2">
            <PeoplePicker
              people={staff}
              selected={g.users}
              disabled={busy}
              emptyText="ยังไม่มีใครดูแลบัตรแผนกนี้"
              placeholder="พิมพ์ชื่อหรือรหัสพนักงานเพื่อเพิ่ม"
              onToggle={(id, next) =>
                run(
                  () => setBreakGroupUser(g.code, id, next),
                  next ? 'เพิ่มคนดูแลแล้ว' : 'เอาออกแล้ว',
                )
              }
            />
          </div>
        )}
      </div>
    </section>
  )
}
