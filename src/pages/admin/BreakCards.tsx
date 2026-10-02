import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { useAsync } from '../../lib/useAsync'
import { listProfiles } from '../../lib/api'
import {
  addBreakCards,
  getBreakSettings,
  saveBreakCard,
  saveBreakGroup,
  setBreakGroupUser,
} from '../../lib/breakPass'
import { ErrorBox, Loading, EmptyState } from '../../components/ui'

/**
 * บัตรเบรค — แผนก บัตร และการพิมพ์
 *
 * บัตรเบรคต่างจากบัตร OS ตรงที่ไม่มีชื่อ ไม่มีรูป และไม่มี token ลับ
 * QR เก็บรหัสบัตรตรง ๆ เพราะความลับของบัตรไม่ได้ช่วยอะไรเลย
 * ใครปลอม QR ขึ้นมาเองก็ไปจบที่ด่านเดียวกัน — ปลอมใบที่ไม่ได้ถูกปล่อย
 * คือโดนปัด ปลอมใบที่ถูกปล่อยอยู่คือโดนจับว่าซ้ำ
 *
 * ผลพลอยได้สามอย่าง พิมพ์ซ่อมเองที่ไหนก็ได้ · QR เล็กลงสแกนติดง่ายขึ้น ·
 * และถ้า QR เปื้อนจน รปภ สแกนไม่ได้ ก็พิมพ์รหัสแทนได้ ผลเหมือนกันทุกอย่าง
 */

const NAVY = '#1B2A4A'
const Y = '#F5B301'

type Tab = 'cards' | 'print'

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

function Qr({ text, size = 108 }: { text: string; size?: number }) {
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

  // ฟอร์มเพิ่มแผนก
  const [gCode, setGCode] = useState('')
  const [gName, setGName] = useState('')
  const [gMax, setGMax] = useState(3)

  // ฟอร์มเพิ่มบัตร
  const [target, setTarget] = useState('')
  const [prefix, setPrefix] = useState('')
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(5)
  const [pad, setPad] = useState(2)

  // พิมพ์
  const [printGroup, setPrintGroup] = useState('')

  const s = settings.data
  const groups = s?.groups ?? []
  const cards = s?.cards ?? []
  const staff = people.data ?? []

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

  return (
    <div>
      <BreakCardStyles />

      <div className="no-print mb-4">
        <h1 className="font-display text-xl">บัตรเบรค</h1>
        <p className="mt-1 text-sm text-ink-500">
          บัตรไม่มีชื่อไม่มีรูป · QR เก็บรหัสบัตรตรง ๆ ไม่ใช่ความลับ จึงไม่ต้องเปลี่ยนรอบ
          และพิมพ์ซ่อมเองได้ตลอด
        </p>
      </div>

      <div className="no-print mb-4 flex gap-2">
        {(
          [
            ['cards', `แผนกและบัตร (${cards.length})`],
            ['print', `พิมพ์บัตร (${printable.length})`],
          ] as [Tab, string][]
        ).map(([k, label]) => (
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

      {err && <div className="no-print mb-3"><ErrorBox message={err} /></div>}
      {msg && (
        <p className="no-print mb-3 rounded-btn bg-success-bg px-3 py-2 text-sm text-success-txt">
          {msg}
        </p>
      )}

      {tab === 'cards' ? (
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
                  value={gCode}
                  onChange={(e) => setGCode(e.target.value)}
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
                  value={gName}
                  onChange={(e) => setGName(e.target.value)}
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
                  value={gMax}
                  onChange={(e) => setGMax(Number(e.target.value))}
                />
              </div>
            </div>
            <button
              type="button"
              className="btn-primary mt-3 px-4 py-2 text-sm"
              disabled={busy || !gCode.trim()}
              onClick={() =>
                void run(async () => {
                  await saveBreakGroup({ code: gCode, name: gName, maxOpen: gMax })
                  setGCode('')
                  setGName('')
                }, 'บันทึกแผนกแล้ว')
              }
            >
              บันทึกแผนก
            </button>
          </section>

          {/* ───────── เพิ่มบัตรเป็นชุด ───────── */}
          {groups.length > 0 && (
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
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    {groups.map((g) => (
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
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
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
                      value={from}
                      onChange={(e) => setFrom(Number(e.target.value))}
                    />
                    <span className="text-sm text-ink-500">–</span>
                    <input
                      type="number"
                      min={0}
                      aria-label="ถึงเลขที่"
                      className="input"
                      value={to}
                      onChange={(e) => setTo(Number(e.target.value))}
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
                    value={pad}
                    onChange={(e) => setPad(Number(e.target.value))}
                  />
                </div>
              </div>

              {preview.length > 0 && (
                <p className="mt-3 rounded-btn bg-ink/5 px-3 py-2 font-mono text-xs text-ink-700">
                  {preview.slice(0, 12).join(' · ')}
                  {preview.length > 12 ? ` … รวม ${preview.length} ใบ` : ''}
                </p>
              )}

              <button
                type="button"
                className="btn-primary mt-3 px-4 py-2 text-sm"
                disabled={busy || preview.length === 0 || !target}
                onClick={() =>
                  void run(async () => {
                    const r = await addBreakCards(target, preview)
                    setPrefix('')
                    setMsg(`เพิ่ม ${r.added} ใบ · มีอยู่แล้ว ${r.skipped} ใบ`)
                  }, 'เพิ่มบัตรแล้ว')
                }
              >
                เพิ่ม {preview.length} ใบ
              </button>
            </section>
          )}

          {/* ───────── รายแผนก ───────── */}
          {groups.length === 0 ? (
            <EmptyState title="ยังไม่มีแผนกบัตร" hint="สร้างแผนกก่อน แล้วค่อยเพิ่มบัตรเข้าไป" />
          ) : (
            groups.map((g) => {
              const mine = cards.filter((c) => c.group_code === g.code)
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
                    <button
                      type="button"
                      className="btn-ghost ml-auto px-3 py-1 text-xs"
                      disabled={busy}
                      onClick={() =>
                        void run(
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
                    <div className="flex flex-wrap gap-1.5">
                      {mine.map((c) => (
                        <button
                          key={c.code}
                          type="button"
                          title={
                            c.busy
                              ? 'ใบนี้ยังไม่ได้รับกลับ ปิดใช้งานไม่ได้'
                              : c.active
                                ? 'กดเพื่อปิดใช้งาน'
                                : 'กดเพื่อเปิดใช้งาน'
                          }
                          disabled={busy || c.busy}
                          className={`rounded-btn border px-2.5 py-1 font-mono text-xs ${
                            c.busy
                              ? 'border-warn/40 bg-warn-bg text-warn-txt'
                              : c.active
                                ? 'border-line bg-white text-ink-700'
                                : 'border-line bg-ink/5 text-ink-500 line-through'
                          }`}
                          onClick={() =>
                            void run(
                              () => saveBreakCard({ code: c.code, active: !c.active }),
                              c.active ? `ปิด ${c.code} แล้ว` : `เปิด ${c.code} แล้ว`,
                            )
                          }
                        >
                          {c.code}
                          {c.busy ? ' ●' : ''}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* ───── ใครดูแลบัตรแผนกนี้ ───── */}
                  <p className="mt-4 mb-1 text-xs font-semibold text-ink-500">
                    ใครปล่อยบัตรแผนกนี้ได้
                  </p>
                  <p className="mb-2 text-xs text-ink-500">
                    ต้องเปิดสิทธิ์ &ldquo;ปล่อยบัตรเบรค&rdquo; ในหน้าสิทธิ์เข้าถึงด้วย
                    ติ๊กที่นี่อย่างเดียวยังปล่อยไม่ได้
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {staff
                      .filter((p) => p.is_active && (p.can_break_issue || g.users.includes(p.id)))
                      .map((p) => {
                        const on = g.users.includes(p.id)
                        return (
                          <button
                            key={p.id}
                            type="button"
                            disabled={busy}
                            className={`rounded-btn border px-2.5 py-1 text-xs ${
                              on
                                ? 'border-ink bg-ink text-white'
                                : 'border-line bg-white text-ink-700'
                            }`}
                            onClick={() =>
                              void run(
                                () => setBreakGroupUser(g.code, p.id, !on),
                                on ? 'เอาออกแล้ว' : 'เพิ่มแล้ว',
                              )
                            }
                          >
                            {p.full_name}
                            {!p.can_break_issue && (
                              <span className="ml-1 opacity-60">· ยังไม่เปิดสิทธิ์</span>
                            )}
                          </button>
                        )
                      })}
                    {staff.filter((p) => p.is_active && p.can_break_issue).length === 0 && (
                      <span className="text-xs text-ink-500">
                        ยังไม่มีใครได้สิทธิ์ปล่อยบัตรเบรค เปิดได้ที่หน้าสิทธิ์เข้าถึง
                      </span>
                    )}
                  </div>
                </section>
              )
            })
          )}
        </div>
      ) : (
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
            <EmptyState
              title="ยังไม่มีบัตรที่เปิดใช้งาน"
              hint="เพิ่มบัตรในแท็บแผนกและบัตรก่อน"
            />
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
