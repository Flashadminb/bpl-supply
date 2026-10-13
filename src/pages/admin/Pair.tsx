import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import { Spinner } from '../../components/ui'
import { readableError } from '../../lib/supabase'
import { code128Png, code128Svg } from '../../lib/code128'
import { C, CARD, field, nf, tabOff, tabOn, thFull } from '../../lib/boardTheme'
import {
  CJK,
  P48_FIELDS,
  P48_GROUPS,
  PAGE,
  slaText,
  importP48,
  p48Facets,
  p48One,
  p48Search,
  p48Prune,
  p48Runs,
  p48Stats,
  p48Undo,
  parseP48,
  shortName,
  type P48Filter,
  type P48Found,
  type P48Kind,
  type P48Row,
  type P48RunRow,
  type P48Stats,
} from '../../lib/pair'

/**
 * จับคู่
 *
 * จอเต็มของตัวเอง ฟิลเดียวกับพัสดุค้างเกิน 24 ชม เพราะแขวนอยู่ข้างกันในคลัง
 * เปิดให้เจ้าของระบบกับผู้ดูแลระบบ · ด่านจริงอยู่ที่ RLS ของ p48_* ที่ตรวจ my_can_outbox()
 *
 * ต่างจากงาน 24 ตรงที่ไม่โหลดทั้งกระดานมาไว้ในเครื่อง
 * รอบหนึ่งมี 54,834 ชิ้น จึงกรองที่ฐานข้อมูลแล้วหยิบมาทีละหน้า
 *
 * เปิดมาเห็นทั้งคลัง ไม่ได้กรองอะไรไว้ล่วงหน้า
 *
 * ตัวกรองที่ตั้งค้างไว้เองโดยที่คนเปิดไม่ได้สั่ง คือตัวกรองที่ซ่อนของไปห้าหมื่นชิ้น
 * แล้วคนจะคิดว่าไฟล์อัปไม่เข้า · แถบ SLA ยังอยู่ ใครอยากกรองก็กดเอง
 *
 * ความด่วนวัดด้วย SLA เป็นวัน ไม่ใช่ชั่วโมงที่ค้างอยู่
 *   ครบกำหนด = วันที่เข้ารับสินค้า + SLA ของประเภทลูกค้าเจ้านั้น
 *   เหลือ     = ครบกำหนด − วันนี้
 * ชั่วโมงที่ค้างตอบได้แค่ว่าอยู่ในระบบมานานแค่ไหน ไม่ได้ตอบว่าช้าหรือยัง
 * เพราะลูกค้าแต่ละเจ้าให้เวลาไม่เท่ากัน · เกณฑ์ตั้งได้ที่ปุ่ม ตั้ง SLA
 *
 * ตัวเลขคิดที่ฐานข้อมูลที่เดียว ทั้งตารางและแผงขวา
 * ถ้าให้หน้าจอคิดเอง วันหนึ่งสองที่จะไม่ตรงกันแล้วไม่มีใครรู้ว่าอันไหนถูก
 */

/** เกินกี่แถวแล้วต้องถามก่อนคัดลอกยกชุด · เกินนี้ไปคือเบราว์เซอร์เริ่มอืด */
const COPY_WARN = 5000

/**
 * ตัวกรอง SLA · เรียงจากด่วนสุดไปหาไม่ด่วน
 *
 * ยังไม่ตั้ง SLA แยกเป็นชิปของตัวเอง ไม่ได้ซุกไว้ใน ทั้งหมด เฉย ๆ
 * เพราะของกลุ่มนั้นคือของที่ระบบยังตัดสินไม่ได้ ซึ่งเป็นงานที่ต้องไปตั้งค่า
 * ไม่ใช่งานที่ต้องไปตามของ · คนละเรื่องกัน
 */
const SLAS = [
  { v: '', t: 'ทั้งหมด' },
  { v: 'over', t: 'เลยกำหนด' },
  { v: 'today', t: 'ครบวันนี้' },
  { v: '1', t: 'เหลือ ≤1 วัน' },
  { v: '3', t: 'เหลือ ≤3 วัน' },
  { v: 'none', t: 'ยังไม่ตั้ง SLA' },
]

const CUST_COLOR: Record<string, { bg: string; fg: string }> = {
  Shopee: { bg: '#3A2210', fg: '#FFB071' },
  Tiktok: { bg: '#331726', fg: '#FF8FC0' },
  Lazada: { bg: '#17253E', fg: '#8FB8FF' },
  KA: { bg: '#2A1F3A', fg: '#C0A6FF' },
}
const CUST_FALLBACK = { bg: '#1F2730', fg: '#9FB0C2' }

export default function Pair() {
  const nav = useNavigate()
  const { can } = useAuth()
  /* เจ้าของระบบสั่งเปิดให้หน้างานอัปได้ตั้งแต่ไฟล์ 169
     ฐานข้อมูลเป็นด่านจริง ตรงนี้แค่เรื่องว่าจะวางปุ่มให้ใครเห็น */
  const mayUpload = true
  /** ประวัติว่าใครอัปรอบไหน · เครื่องมือตรวจสอบ ไม่ใช่ข้อมูลหน้างาน */
  const maySeeLog = can('admin')
  const [showLog, setShowLog] = useState(false)

  const stats = useAsync(() => p48Stats(), [])
  const facets = useAsync(() => p48Facets(), [])

  /* ---- ตัวกรอง ---- */
  const [qRaw, setQRaw] = useState('')
  const [q, setQ] = useState('')
  const [sla, setSla] = useState('')
  const [cust, setCust] = useState('')
  const [dest, setDest] = useState('')
  const [action, setAction] = useState('')
  const [prov, setProv] = useState('')
  const [bag, setBag] = useState(false)
  const [nop, setNop] = useState(false)
  const [cn, setCn] = useState(false)
  const [page, setPage] = useState(0)

  /* พิมพ์แล้วรอให้นิ่งก่อนค่อยยิง · ไม่งั้นยิงทุกตัวอักษรใส่ห้าหมื่นแถว */
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qRaw.trim())
      setPage(0)
    }, 320)
    return () => clearTimeout(t)
  }, [qRaw])

  const filter: P48Filter = useMemo(
    () => ({ q, sla, cust, dest, action, prov, bag, nop, cn, limit: PAGE, offset: page * PAGE }),
    [q, sla, cust, dest, action, prov, bag, nop, cn, page],
  )

  const found = useAsync<P48Found>(() => p48Search(filter), [JSON.stringify(filter)])
  const rows = found.data?.rows ?? []
  const total = found.data?.total ?? 0
  const all = found.data?.all ?? 0

  /* เปลี่ยนตัวกรองแล้วย้อนกลับหน้าแรกเสมอ ไม่งั้นค้างอยู่หน้า 9 ของผลเก่า */
  const reset = useCallback(() => setPage(0), [])

  /* ---- แผงขวา ---- */
  const [open, setOpen] = useState<string | null>(null)
  const one = useAsync(() => (open ? p48One(open) : Promise.resolve(null)), [open])

  /* ---- คัดลอก ---- */
  const [copied, setCopied] = useState<string | null>(null)
  const copyTimer = useRef<number | null>(null)
  const copy = useCallback(async (text: string, what: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(null), 1500)
    } catch {
      setCopied('เบราว์เซอร์ไม่ให้คัดลอก ลองกดอีกครั้งหลังแตะหน้าจอ')
    }
  }, [])

  /* ---- อัปไฟล์ ---- */
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  /** ตัวกดหยุดการอัปที่กำลังเดินอยู่ · ของที่ส่งไปแล้วกลายเป็นรอบค้างที่ไม่มีใครเห็น */
  const abort = useRef<AbortController | null>(null)

  const take = useCallback(
    async (files: File[]) => {
      if (!files.length) return
      if (files.length > 2) {
        setErr('รับได้ครั้งละไม่เกินสองไฟล์ · ไฟล์รายละเอียดหนึ่งใบ ไฟล์สินค้าหนึ่งใบ')
        return
      }
      const ac = new AbortController()
      abort.current = ac
      setBusy(true)
      setErr(null)
      setMsg(null)
      try {
        /*
          แกะทีละใบแล้วส่งขึ้นเลย ไม่ได้แกะทั้งสองใบรอไว้ก่อน
          ไฟล์จริงคือ 78,476 กับ 60,146 แถว · แกะพร้อมกันคือกินหน่วยความจำเบราว์เซอร์
          เป็นร้อยเมกะและคนเปิดต้องนั่งมองคำว่ากำลังอ่านไฟล์เป็นนาทีโดยไม่มีอะไรขยับ

          ใบแรกพังก็ยังไม่ได้แตะของเดิม ใบที่สองพังก็เสียแค่ใบที่สอง
          เพราะรอบใหม่จะไม่ถูกเห็นจนกว่าจะปิดรอบสำเร็จ ของเดิมอยู่ครบตลอด
        */
        const said: string[] = []
        /*
          จำว่าแต่ละชนิดที่ส่งไปแล้ว มาจากไฟล์ตัวจริงหรือคอลัมน์ที่ติดมากับใบใหญ่

          ไฟล์สินค้าตัวจริงต้องชนะคอลัมน์ที่ VLOOKUP มา ไม่ว่าจะมาถึงก่อนหรือหลัง
          ไม่งั้นวันที่ลากสองใบพร้อมกันแล้วใบใหญ่มาก่อน คอลัมน์ที่อาจไม่ครบ
          จะไปทับไฟล์ตัวจริงเงียบ ๆ แล้วไม่มีใครรู้ว่าชื่อสินค้าหายไปบางส่วน

          ส่งซ้ำไม่เสียหาย เพราะรอบใหม่สุดที่ปิดสำเร็จคือรอบที่ทุกคนเห็น
        */
        const seen = new Map<string, boolean>()

        for (const f of files) {
          setProg(`กำลังอ่าน ${f.name}…`)
          const parts = await parseP48(f)

          for (const one of parts) {
            if (ac.signal.aborted) throw new Error('ยกเลิกการอัปแล้ว · ของเดิมยังอยู่ครบ')
            const name = one.kind === 'parcel' ? 'ไฟล์รายละเอียด' : 'ไฟล์สินค้า'
            const before = seen.get(one.kind)
            const better = before === true && !one.embedded
            if (before !== undefined && !better) {
              said.push(
                one.embedded
                  ? `ไม่ใช้ชื่อสินค้าที่ติดมากับ ${one.fileName} เพราะมีไฟล์สินค้าตัวจริงแล้ว`
                  : `ข้าม${name}ซ้ำจาก ${one.fileName}`,
              )
              continue
            }
            if (better) said.push('ใช้ไฟล์สินค้าตัวจริงแทนชื่อสินค้าที่ติดมากับไฟล์ใบใหญ่')
            seen.set(one.kind, one.embedded === true)

            const res = await importP48(one, {
              signal: ac.signal,
              onProgress: (d, t) =>
                setProg(`${name} · ส่งขึ้นแล้ว ${nf(d)} จาก ${nf(t)} แถว (${Math.round((d / t) * 100)}%)`),
            })
            said.push(
              `${name} ${nf(res.rows)} ชิ้น` +
                (one.other > 0 ? ` (ตัดของฮับอื่นออก ${nf(one.other)})` : ''),
            )
          }
        }

        setMsg('อัปทับเรียบร้อย · ' + said.join(' · ') + ' · กดย้อนกลับได้ถ้าอัปผิดไฟล์')
        stats.reload()
        facets.reload()
        found.reload()

        /* เก็บกวาดรอบเก่าหลังรายงานผลไปแล้ว · ล้มตรงนี้ไม่กระทบไฟล์ที่เพิ่งอัปสำเร็จ */
        setProg('กำลังเก็บกวาดรอบเก่า…')
        await p48Prune()
      } catch (x) {
        setErr(readableError(x))
      } finally {
        abort.current = null
        setBusy(false)
        setProg(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  async function undo(kind: P48Kind) {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      await p48Undo(kind)
      setMsg(`ย้อนกลับ${kind === 'parcel' ? 'ไฟล์รายละเอียด' : 'ไฟล์สินค้า'}ไปรอบก่อนหน้าแล้ว`)
      stats.reload()
      facets.reload()
      found.reload()
    } catch (x) {
      setErr(readableError(x))
    } finally {
      setBusy(false)
    }
  }

  /* ---- คัดลอกยกชุด ---- */
  async function copyBulk(kind: 'tracking' | 'detail' | 'tsv') {
    if (total > COPY_WARN) {
      const ok = window.confirm(
        `ตอนนี้กรองอยู่ ${nf(total)} ชิ้น ซึ่งเยอะเกินกว่าที่โปรแกรมปลายทางส่วนใหญ่จะรับไหว\n` +
          `ระบบจะคัดลอกให้แค่ ${nf(PAGE)} ชิ้นแรกที่เห็นอยู่บนจอ · กรองให้แคบลงก่อนจะได้ครบ\n\nคัดลอกเท่าที่เห็นเลยไหม`,
      )
      if (!ok) return
    }
    if (kind === 'tracking') return copy(rows.map((r) => r.tracking).join('\n'), `เลขพัสดุ ${rows.length} เลข`)
    if (kind === 'detail')
      return copy(
        rows.filter((r) => r.detail).map((r) => r.detail).join('\n'),
        `ชื่อสินค้า ${rows.filter((r) => r.detail).length} รายการ`,
      )
    const head = ['เลขพัสดุ', 'รายละเอียดสินค้า', 'ประเภทลูกค้า', 'สาขาปลายทาง', 'น้ำหนัก', 'SLA คงเหลือ', 'การดำเนินการล่าสุด']
    const body = rows.map((r) =>
      [r.tracking, r.detail, r.cust_type, shortName(r.dest_branch), r.weight, slaText(r.sla_left), r.last_action]
        .map((v) => String(v ?? '').replace(/[\t\n]/g, ' '))
        .join('\t'),
    )
    return copy([head.join('\t')].concat(body).join('\n'), `ทั้งตาราง ${rows.length} แถว`)
  }

  const pages = Math.ceil(total / PAGE)

  return (
    <div className="min-h-dvh" style={{ background: C.bg, color: C.ink }}>
      <div className="mx-auto flex min-h-dvh max-w-[1900px] flex-col gap-2 p-2">
        {/* ---------------- หัว ---------------- */}
        <div className="flex flex-wrap items-center gap-3 px-3 py-2" style={CARD}>
          <button
            type="button"
            aria-label="ย้อนกลับ"
            className="h-tap w-tap rounded-btn text-xl"
            style={{ color: C.mute }}
            onClick={() => nav('/admin')}
          >
            ←
          </button>
          <span className="rounded px-2 py-[2px] text-[13px] font-extrabold" style={{ background: C.brand, color: '#111' }}>
            BPL
          </span>
          <span
            className="flex items-center rounded-lg px-[7px] py-[3px]"
            style={{ background: '#1E3246', color: '#8FD0FF' }}
          >
            <svg
              viewBox="0 0 24 24"
              width="19"
              height="19"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M10.1 13.9a4.2 4.2 0 0 0 5.94 0l2.52-2.52a4.2 4.2 0 1 0-5.94-5.94l-1.3 1.3" />
              <path d="M13.9 10.1a4.2 4.2 0 0 0-5.94 0l-2.52 2.52a4.2 4.2 0 1 0 5.94 5.94l1.3-1.3" />
            </svg>
          </span>
          <span className="text-lg font-bold">จับคู่</span>
          <span className="text-xs" style={{ color: C.faint }}>
            เลขพัสดุ + รายละเอียดสินค้า จากสองไฟล์
          </span>
          <span className="flex-1" />
          <Cards stats={stats.data} loading={stats.loading} />
        </div>

        {/* ---------------- อัปไฟล์ ---------------- */}
        {mayUpload && (
          <div
            className="flex flex-wrap items-center gap-2 px-3 py-2"
            style={{ ...CARD, border: `1.5px dashed ${drag ? C.brand : C.line}` }}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              void take([...e.dataTransfer.files].filter((f) => f.name.toLowerCase().endsWith('.xlsx')))
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              multiple
              className="hidden"
              onChange={(e) => {
                const fs = [...(e.target.files ?? [])]
                e.target.value = ''
                void take(fs)
              }}
            />
            <span style={{ color: C.mute, fontSize: 13 }}>
              ลากไฟล์มาวางได้ ทีละใบหรือสองใบ
              <span className="ml-2 text-[11.5px]" style={{ color: C.faint }}>
                ระบบแยกเองจากเนื้อในไฟล์ ไม่สนชื่อไฟล์
              </span>
            </span>
            <button
              type="button"
              disabled={busy}
              className="h-tap rounded-btn px-4 text-sm font-bold"
              style={{ background: C.brand, color: '#111', opacity: busy ? 0.5 : 1 }}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? 'กำลังอัป…' : 'เลือกไฟล์'}
            </button>
            <span className="flex-1" />
            {maySeeLog && (
              <button type="button" className="h-tap rounded-btn px-3 text-xs" style={showLog ? tabOn : tabOff} onClick={() => setShowLog((v) => !v)}>
                ประวัติอัป
              </button>
            )}
            {stats.data?.can_undo_parcel && (
              <button type="button" disabled={busy} className="h-tap rounded-btn px-3 text-xs" style={tabOff} onClick={() => void undo('parcel')}>
                ↶ ย้อนไฟล์รายละเอียด
              </button>
            )}
            {stats.data?.can_undo_product && (
              <button type="button" disabled={busy} className="h-tap rounded-btn px-3 text-xs" style={tabOff} onClick={() => void undo('product')}>
                ↶ ย้อนไฟล์สินค้า
              </button>
            )}
          </div>
        )}

        {maySeeLog && showLog && <UploadLog />}

        {prog && (
          <p
            className="flex items-center gap-3 rounded-card px-3 py-2 text-sm"
            style={{ background: C.amberBg, color: C.amberInk }}
          >
            <Spinner className="h-4 w-4" />
            <span>{prog}</span>
            <span className="flex-1" />
            <button
              type="button"
              className="rounded-lg px-3 py-1 text-xs font-bold"
              style={{ background: C.redBg, color: C.redInk, border: '1px solid #6a2a2a' }}
              onClick={() => abort.current?.abort()}
            >
              หยุดอัป
            </button>
          </p>
        )}
        {msg && (
          <p className="rounded-card px-3 py-2 text-sm" style={{ background: C.greenBg, color: C.greenInk }}>
            {msg}
          </p>
        )}
        {err && (
          <p className="rounded-card px-3 py-2 text-sm" style={{ background: C.redBg, color: C.redInk }}>
            {err}
          </p>
        )}
        {copied && (
          <p className="rounded-card px-3 py-2 text-sm" style={{ background: C.greenBg, color: C.greenInk }}>
            คัดลอกแล้ว · {copied}
          </p>
        )}

        {/* ---------------- ตัวกรอง ---------------- */}
        <div className="flex flex-wrap items-center gap-[6px] px-3 py-2" style={CARD}>
          <span
            className="flex h-8 w-[250px] items-center gap-2 rounded-lg px-3"
            style={{ background: C.panel2, border: `1px solid ${C.line}` }}
          >
            <span style={{ color: C.faint }}>⌕</span>
            <input
              value={qRaw}
              onChange={(e) => setQRaw(e.target.value)}
              placeholder="เลขพัสดุ / เลขแบ็กกิ้ง / ชื่อสินค้า"
              className="w-full bg-transparent font-mono text-[12.5px] outline-none"
              style={{ color: C.ink }}
            />
            {qRaw && (
              <button type="button" aria-label="ล้างคำค้น" style={{ color: C.faint }} onClick={() => setQRaw('')}>
                ✕
              </button>
            )}
          </span>

          <Sep />
          <Lab>SLA</Lab>
          {SLAS.map((a) => (
            <Chip
              key={a.v}
              on={sla === a.v}
              onClick={() => {
                setSla(a.v)
                reset()
              }}
            >
              {a.t}
            </Chip>
          ))}

          <Sep />
          <Lab>ลูกค้า</Lab>
          <Chip
            on={cust === ''}
            onClick={() => {
              setCust('')
              reset()
            }}
          >
            ทั้งหมด
          </Chip>
          {(facets.data?.cust ?? []).map((f) => (
            <Chip
              key={f.v}
              on={cust === f.v}
              onClick={() => {
                setCust(cust === f.v ? '' : f.v)
                reset()
              }}
            >
              {f.v}
            </Chip>
          ))}

          <Sep />
          <Chip
            on={bag}
            onClick={() => {
              setBag(!bag)
              reset()
            }}
          >
            ◧ มีเลขแบ็กกิ้ง
          </Chip>
          <Chip
            on={nop}
            onClick={() => {
              setNop(!nop)
              reset()
            }}
          >
            ⌀ ไม่มีรายละเอียด
          </Chip>
          <Chip
            on={cn}
            onClick={() => {
              setCn(!cn)
              reset()
            }}
          >
            文 รายละเอียดเป็นจีน
          </Chip>

          <Sep />
          <Pick
            value={dest}
            onChange={(v) => {
              setDest(v)
              reset()
            }}
            zero="สาขาปลายทาง · ทั้งหมด"
            list={facets.data?.dest ?? []}
            short
          />
          <Pick
            value={action}
            onChange={(v) => {
              setAction(v)
              reset()
            }}
            zero="การดำเนินการล่าสุด · ทั้งหมด"
            list={facets.data?.action ?? []}
          />
          <Pick
            value={prov}
            onChange={(v) => {
              setProv(v)
              reset()
            }}
            zero="จังหวัด · ทั้งหมด"
            list={facets.data?.prov ?? []}
            short
          />
        </div>

        {/* ---------------- ตาราง + แผงขวา ---------------- */}
        <div className="flex min-h-0 flex-1 gap-2">
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden" style={CARD}>
            <div
              className="flex flex-wrap items-center gap-2 px-3 py-[6px] text-[11.5px]"
              style={{ borderBottom: `1px solid ${C.line2}`, color: C.mute }}
            >
              <b className="text-[13px]">ผลการค้นหา</b>
              <span className="font-mono text-sm font-extrabold" style={{ color: C.brand }}>
                {nf(total)}
              </span>
              <span style={{ color: C.faint }}>จาก {nf(all)} ชิ้น</span>
              {found.loading && <Spinner className="h-4 w-4" />}
              <span className="flex-1" />
              <Chip onClick={() => void copyBulk('tracking')}>⎘ เลขพัสดุทั้งหมด</Chip>
              <Chip onClick={() => void copyBulk('detail')}>⎘ ชื่อสินค้าทั้งหมด</Chip>
              <Chip onClick={() => void copyBulk('tsv')}>⎘ ทั้งตาราง (วางลง Excel)</Chip>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <Table rows={rows} open={open} onOpen={setOpen} onCopy={copy} />
              {!found.loading && !rows.length && (
                <p className="px-3 py-10 text-center text-sm" style={{ color: C.faint }}>
                  {all === 0
                    ? 'ยังไม่มีข้อมูล · อัปไฟล์รายละเอียดกับไฟล์สินค้าเข้ามาก่อน'
                    : 'ไม่มีชิ้นไหนตรงกับตัวกรองนี้ · ลองกด "ทั้งหมด" ที่แถบ SLA'}
                </p>
              )}
              {found.error && (
                <p className="px-3 py-6 text-center text-sm" style={{ color: C.redInk }}>
                  {found.error}
                </p>
              )}
            </div>

            {pages > 1 && (
              <div
                className="flex items-center justify-center gap-2 px-3 py-[6px] text-[12px]"
                style={{ borderTop: `1px solid ${C.line2}`, color: C.mute }}
              >
                <Chip onClick={() => setPage(Math.max(0, page - 1))}>‹ ก่อนหน้า</Chip>
                <span className="font-mono">
                  หน้า {page + 1} / {nf(pages)}
                </span>
                <Chip onClick={() => setPage(Math.min(pages - 1, page + 1))}>ถัดไป ›</Chip>
              </div>
            )}
          </div>

          <Side
            tracking={open}
            data={one.data}
            loading={one.loading}
            onClose={() => setOpen(null)}
            onCopy={copy}
          />
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- ชิ้นส่วน */

function Sep() {
  return <span className="mx-[3px] h-5 w-px" style={{ background: C.line2 }} />
}

function Lab({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10.5px] uppercase tracking-wider" style={{ color: C.faint }}>
      {children}
    </span>
  )
}

function Chip({
  on,
  onClick,
  children,
}: {
  on?: boolean
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="whitespace-nowrap rounded-lg px-[10px] py-[5px] text-[11.5px]"
      style={on ? tabOn : tabOff}
    >
      {children}
    </button>
  )
}

function Pick({
  value,
  onChange,
  zero,
  list,
  short,
}: {
  value: string
  onChange: (v: string) => void
  zero: string
  list: { v: string; n: number }[]
  short?: boolean
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 max-w-[230px] rounded-lg px-2 text-[12px]"
      style={field}
    >
      <option value="">{zero}</option>
      {list.map((f) => (
        <option key={f.v} value={f.v}>
          {(short ? shortName(f.v) : f.v).slice(0, 40)} ({nf(f.n)})
        </option>
      ))}
    </select>
  )
}

/** การ์ดอัปเดตล่าสุดสามใบบนแถบหัว */
function Cards({ stats, loading }: { stats: P48Stats | null; loading: boolean }) {
  if (loading) return <Spinner className="h-5 w-5" />
  if (!stats) return null
  const one = (
    label: string,
    card: { at: string; rows: number; by: string; code: string } | undefined,
    color: string,
  ) => (
    <span className="flex items-center gap-2 px-2">
      <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: card ? C.green : C.faint }} />
      <span className="text-right">
        <span className="block font-mono text-[10px] uppercase tracking-wider" style={{ color: C.faint }}>
          {label}
        </span>
        <b className="block font-mono text-[17px] font-extrabold leading-tight" style={{ color }}>
          {card ? nf(card.rows) : '—'}
        </b>
      </span>
      <span className="text-[10.5px] leading-tight" style={{ color: C.faint }}>
        {card ? (
          <>
            {thFull(card.at)}
            <br />
            โดย {card.by || 'ไม่ทราบชื่อ'} {card.code && `(${card.code})`}
          </>
        ) : (
          'ยังไม่เคยอัป'
        )}
      </span>
    </span>
  )
  return (
    <span className="flex flex-wrap items-center gap-1">
      {one('ไฟล์รายละเอียด', stats.parcel, C.brand)}
      {one('ไฟล์สินค้า', stats.product, C.brand)}
      <span className="flex items-center gap-2 px-2">
        <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: stats.matched ? C.amber : C.faint }} />
        <span className="text-right">
          <span className="block font-mono text-[10px] uppercase tracking-wider" style={{ color: C.faint }}>
            จับคู่ได้
          </span>
          <b className="block font-mono text-[17px] font-extrabold leading-tight" style={{ color: C.amberInk }}>
            {nf(stats.matched)}
          </b>
        </span>
        <span className="text-[10.5px] leading-tight" style={{ color: C.faint }}>
          {stats.parcel?.rows
            ? `${Math.round((stats.matched / stats.parcel.rows) * 100)}% ของทั้งหมด`
            : '—'}
          <br />
          {stats.parcel?.rows ? `ไม่มีรายละเอียด ${nf(stats.parcel.rows - stats.matched)}` : ''}
        </span>
      </span>
    </span>
  )
}

function CustChip({ v }: { v: string | null }) {
  if (!v) return <span style={{ color: C.faint }}>—</span>
  const c = CUST_COLOR[v] ?? CUST_FALLBACK
  return (
    <span
      className="whitespace-nowrap rounded px-[6px] py-[1.5px] text-[10.5px] font-bold"
      style={{ background: c.bg, color: c.fg }}
    >
      {v === 'ลูกค้าทั่วไป' ? 'ทั่วไป' : v}
    </span>
  )
}

/**
 * ตารางผลการค้นหา · เจ็ดช่อง พอดีหนึ่งหน้าจอตามที่เจ้าของระบบสั่ง
 * ช่องที่เหลือทั้งหมดอยู่ในแผงขวา ไม่ได้ตัดทิ้ง
 */
function Table({
  rows,
  open,
  onOpen,
  onCopy,
}: {
  rows: P48Row[]
  open: string | null
  onOpen: (t: string | null) => void
  onCopy: (text: string, what: string) => void
}) {
  return (
    <table className="w-full table-fixed border-collapse">
      <thead>
        <tr>
          {[
            ['เลขพัสดุ', '29%'],
            ['รายละเอียดสินค้า', ''],
            ['ลูกค้า', '82px'],
            ['สาขาปลายทาง', '19%'],
            ['น้ำหนัก', '64px'],
            ['SLA', '84px'],
            ['ล่าสุด', '15%'],
          ].map(([t, w], i) => (
            <th
              key={t}
              className="sticky top-0 z-[2] px-[9px] py-[7px] text-left font-mono text-[10.5px] font-semibold uppercase tracking-wide"
              style={{
                width: w || undefined,
                background: '#141B24',
                color: C.faint,
                borderBottom: `1px solid ${C.line}`,
                textAlign: i === 4 || i === 5 ? 'right' : 'left',
              }}
            >
              {t}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          /* ตัวเลขมาจากฐานข้อมูล ไม่ได้คิดในเครื่อง ตารางกับแผงขวาจึงตรงกันเสมอ */
          const L = r.sla_left
          const hc =
            L === null || L === undefined ? C.faint : L < 0 ? C.redInk : L === 0 ? C.amberInk : L <= 1 ? C.fdHi : C.mute
          const hasBag = r.bag_no && r.bag_no !== '--' && r.bag_no !== '-'
          const sel = open === r.tracking
          return (
            <tr
              key={r.tracking}
              onClick={() => onOpen(sel ? null : r.tracking)}
              className="group cursor-pointer"
              style={{
                background: sel ? '#17293A' : undefined,
                boxShadow: sel ? `inset 3px 0 0 ${C.lh}` : undefined,
              }}
            >
              <td className="overflow-hidden px-[9px] py-[5px]" style={{ borderBottom: '1px solid #161D26' }}>
                <span className="flex items-center">
                  <span className="font-mono text-[12.5px] font-bold" style={{ color: C.lhHi }}>
                    {r.tracking}
                  </span>
                  {hasBag && (
                    <span
                      className="ml-[5px] whitespace-nowrap rounded px-[4px] py-[1px] font-mono text-[9.5px] font-bold"
                      style={{ background: '#2A2412', color: '#E8C86A' }}
                    >
                      ◧ {r.bag_no}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label="คัดลอกเลขพัสดุ"
                    className="ml-[5px] text-[11px] opacity-0 group-hover:opacity-100"
                    style={{ color: C.faint }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onCopy(r.tracking, r.tracking)
                    }}
                  >
                    ⎘
                  </button>
                </span>
              </td>
              <td className="overflow-hidden px-[9px] py-[5px]" style={{ borderBottom: '1px solid #161D26' }}>
                <span className="flex min-w-0 items-center">
                  <span
                    className="truncate text-[12px]"
                    style={r.detail ? undefined : { color: '#4a5460', fontStyle: 'italic' }}
                  >
                    {r.detail || 'ไม่มีในไฟล์สินค้า'}
                  </span>
                  {r.detail && (
                    <button
                      type="button"
                      aria-label="คัดลอกชื่อสินค้า"
                      className="ml-[5px] shrink-0 text-[11px] opacity-0 group-hover:opacity-100"
                      style={{ color: CJK.test(r.detail) ? C.amberInk : C.faint }}
                      onClick={(e) => {
                        e.stopPropagation()
                        onCopy(r.detail ?? '', 'ชื่อสินค้า')
                      }}
                    >
                      ⎘
                    </button>
                  )}
                </span>
              </td>
              <td className="px-[9px] py-[5px]" style={{ borderBottom: '1px solid #161D26' }}>
                <CustChip v={r.cust_type} />
              </td>
              <td className="overflow-hidden px-[9px] py-[5px]" style={{ borderBottom: '1px solid #161D26' }}>
                <span className="block truncate text-[12px]" style={{ color: C.mute }}>
                  {shortName(r.dest_branch) || '—'}
                </span>
              </td>
              <td
                className="px-[9px] py-[5px] text-right font-mono text-[12px]"
                style={{ borderBottom: '1px solid #161D26', color: C.mute }}
              >
                {r.weight || '—'}
              </td>
              <td
                className="px-[9px] py-[5px] text-right font-mono text-[13px] font-extrabold"
                style={{ borderBottom: '1px solid #161D26', color: hc }}
              >
                {slaText(L)}
              </td>
              <td className="overflow-hidden px-[9px] py-[5px]" style={{ borderBottom: '1px solid #161D26' }}>
                <span className="block truncate text-[11.5px]" style={{ color: C.mute }}>
                  {r.last_action || '—'}
                </span>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/**
 * แผงขวา 40% · ทุกช่องที่เก็บไว้ และทุกค่ากดคัดลอกได้
 *
 * เจ้าของระบบสั่งว่า "ทุกเนื้อหามีตัวให้ก็อปได้หมดเลยเผื่อก็อปไปแปล"
 * จึงไม่ได้ใส่ปุ่มเล็ก ๆ ทุกบรรทัดซึ่งจะรกจนอ่านไม่ออก
 * แต่ทำให้ตัวค่าเองเป็นปุ่ม ชี้แล้วพื้นสว่างขึ้นพร้อมไอคอน
 */
function Side({
  tracking,
  data,
  loading,
  onClose,
  onCopy,
}: {
  tracking: string | null
  data: Record<string, unknown> | null
  loading: boolean
  onClose: () => void
  onCopy: (text: string, what: string) => void
}) {
  if (!tracking) {
    return (
      <div
        className="hidden w-[40%] min-w-[380px] items-center justify-center text-center text-[12.5px] lg:flex"
        style={{ ...CARD, color: C.faint }}
      >
        <span>
          กดที่แถวไหนก็ได้
          <br />
          <span style={{ color: '#3d454e' }}>
            รายละเอียดทุกช่องในไฟล์จะขึ้นตรงนี้
            <br />
            และทุกช่องกดคัดลอกได้
          </span>
        </span>
      </div>
    )
  }

  const detail = String(data?.detail ?? '')
  const val = (k: string) => {
    const v = data?.[k]
    if (v === null || v === undefined || v === '') return null
    const s = String(v)
    /* เวลามาเป็น ISO จากฐานข้อมูล · แปลงให้อ่านออกก่อนโชว์และก่อนคัดลอก */
    return /^\d{4}-\d{2}-\d{2}T/.test(s) ? thFull(s) : s
  }

  const all = () =>
    [`เลขพัสดุ: ${tracking}`, `รายละเอียดสินค้า: ${detail || '-'}`]
      .concat(P48_FIELDS.map((f) => `${f.label}: ${val(f.key) ?? '-'}`))
      .join('\n')

  return (
    <div className="flex w-[40%] min-w-[380px] flex-col overflow-hidden" style={CARD}>
      <div className="px-3 py-[10px]" style={{ borderBottom: `1px solid ${C.line2}` }}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[16px] font-bold" style={{ color: C.lhHi }}>
            {tracking}
          </span>
          <Chip onClick={() => onCopy(tracking, tracking)}>⎘ คัดลอก</Chip>
          {/* บาร์โค้ดอยู่ขวามือของเลข ไม่ได้กินทั้งแผงเหมือนรอบแรก */}
          <Barcode value={tracking} detail={detail} dest={String(data?.dest_branch ?? '')} />
          <span className="flex-1" />
          {loading && <Spinner className="h-4 w-4" />}
          <button type="button" aria-label="ปิด" className="text-base" style={{ color: C.faint }} onClick={onClose}>
            ✕
          </button>
        </div>

        <Copyable
          text={detail}
          onCopy={onCopy}
          what="ชื่อสินค้า"
          className="mt-[7px] block text-[13px] leading-relaxed"
          empty="ยังไม่มีรายละเอียดสินค้าของเลขนี้ในไฟล์ที่อัปล่าสุด"
        />

        {/* แถบ SLA · ตัวเลขมาจากฐานข้อมูล ตรงกับที่ตารางโชว์เสมอ */}
        <SlaBar
          left={(data?.sla_left ?? null) as number | null}
          days={(data?.sla_days ?? null) as number | null}
          due={(data?.sla_due ?? null) as string | null}
        />

        <div className="mt-2 flex flex-wrap gap-[6px]">
          <Chip onClick={() => onCopy(all(), 'ทั้งใบ')}>⎘ คัดลอกทั้งใบเป็นข้อความ</Chip>
          {detail && <Chip onClick={() => onCopy(detail, 'ชื่อสินค้า')}>⎘ คัดลอกเฉพาะชื่อสินค้า</Chip>}
        </div>

      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {P48_GROUPS.map((g) => (
          <div key={g} className="mt-3">
            <p
              className="mb-[5px] pb-1 font-mono text-[10px] uppercase tracking-widest"
              style={{ color: C.faint, borderBottom: `1px solid ${C.line2}` }}
            >
              {g}
            </p>
            {P48_FIELDS.filter((f) => f.group === g).map((f) => (
              <div key={f.key} className="flex items-baseline gap-[10px] py-[1px]">
                <span className="w-[150px] shrink-0 text-[11.5px]" style={{ color: C.faint }}>
                  {f.label}
                </span>
                <Copyable
                  text={val(f.key) ?? ''}
                  onCopy={onCopy}
                  what={f.label}
                  className={`flex-1 break-words text-[12.5px] ${f.mono ? 'font-mono' : ''}`}
                />
              </div>
            ))}
          </div>
        ))}
        <p
          className="mt-3 rounded-lg px-[10px] py-[7px] text-[11.5px] leading-relaxed"
          style={{ background: '#17202B', border: `1px dashed ${C.line}`, color: C.mute }}
        >
          ทุกช่องในไฟล์ถูกเก็บไว้ครบ ไม่ได้ตัดทิ้งช่องไหน ตารางหน้าแรกโชว์แค่ 7 ช่อง เพราะต้องจบใน 1 หน้าจอ
          <br />
          <b style={{ color: C.brand }}>ทุกค่าในแผงนี้กดคัดลอกได้</b> ชี้แล้วพื้นจะสว่างขึ้นพร้อมไอคอน ⎘
        </p>
      </div>
    </div>
  )
}

/**
 * แถบ SLA ในแผงขวา
 *
 * บอกสามอย่างที่คนถามต่อกันเป็นลูกโซ่ · เหลือกี่วัน ครบกำหนดวันไหน
 * และเกณฑ์ของลูกค้าเจ้านี้คือกี่วัน · ถ้าบอกแค่ว่าเหลือกี่วัน
 * คนจะถามต่อทันทีว่านับจากอะไร แล้วต้องไปเปิดหาเอง
 *
 * ยังไม่ได้ตั้ง SLA ขึ้นเป็นคำเตือน ไม่ใช่ขีดกลางเงียบ ๆ
 * เพราะนั่นคืองานที่ต้องไปตั้งค่า ไม่ใช่ของที่ไม่มีข้อมูล
 */
function SlaBar({ left, days, due }: { left: number | null; days: number | null; due: string | null }) {
  if (left === null || days === null) {
    return (
      <p className="mt-2 rounded-lg px-2 py-1 text-[11.5px]" style={{ background: C.amberBg, color: C.amberInk }}>
        ประเภทลูกค้านี้ยังไม่ได้ตั้ง SLA จึงบอกไม่ได้ว่าช้าหรือยัง
      </p>
    )
  }
  const col = left < 0 ? C.redInk : left === 0 ? C.amberInk : left <= 1 ? C.fdHi : C.greenInk
  const bg = left < 0 ? C.redBg : left === 0 ? C.amberBg : C.greenBg
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg px-2 py-[5px]" style={{ background: bg }}>
      <b className="font-mono text-[15px] font-extrabold" style={{ color: col }}>
        {slaText(left)}
      </b>
      <span className="text-[11.5px]" style={{ color: C.mute }}>
        {left < 0 ? 'เลยกำหนดมาแล้ว' : left === 0 ? 'ครบกำหนดวันนี้' : 'ยังเหลือเวลา'} · ครบกำหนด {due ?? '—'} · เกณฑ์ {days} วันนับจากวันเข้ารับสินค้า
      </span>
    </div>
  )
}

/**
 * ประวัติการอัปไฟล์ · ของผู้ดูแลระบบ
 *
 * เปิดให้หน้างานอัปได้แล้ว แปลว่าใครก็ทับของเดิมได้
 * ถ้าวันหนึ่งข้อมูลบนจอไม่ตรงกับที่คาด ต้องตอบได้ทันทีว่าใครอัปรอบล่าสุด
 * การ์ดด้านบนบอกได้แค่รอบปัจจุบัน ตรงนี้ย้อนดูได้ทั้งหมดที่ยังเก็บอยู่
 *
 * รอบที่อัปไม่จบก็โชว์ด้วย เพราะนั่นคือร่องรอยของการอัปที่ถูกตัดกลางทาง
 * ซึ่งเป็นเบาะแสว่าเน็ตมีปัญหา ไม่ใช่ของที่ควรซ่อน
 */
function UploadLog() {
  const runs = useAsync(() => p48Runs(), [])
  const list = runs.data ?? []

  return (
    <div className="px-3 py-2" style={CARD}>
      <p className="mb-2 text-[13px] font-bold">ประวัติการอัปไฟล์</p>
      {runs.loading && <Spinner className="h-4 w-4" />}
      {runs.error && (
        <p className="text-[12px]" style={{ color: C.redInk }}>
          {runs.error}
        </p>
      )}
      {!runs.loading && !list.length && (
        <p className="text-[12px]" style={{ color: C.faint }}>
          ยังไม่เคยมีใครอัปไฟล์
        </p>
      )}
      {list.length > 0 && (
        <div className="max-h-56 overflow-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr style={{ color: C.faint }}>
                <th className="px-2 py-1 text-left font-medium">เวลา</th>
                <th className="px-2 py-1 text-left font-medium">ไฟล์</th>
                <th className="px-2 py-1 text-left font-medium">ใครอัป</th>
                <th className="px-2 py-1 text-right font-medium">เข้าไป</th>
                <th className="px-2 py-1 text-left font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r: P48RunRow) => (
                <tr key={r.id} style={{ borderTop: '1px solid ' + C.line2 }}>
                  <td className="whitespace-nowrap px-2 py-[5px] font-mono">{thFull(r.uploaded_at)}</td>
                  <td className="px-2 py-[5px]">
                    {r.kind === 'parcel' ? 'รายละเอียด' : 'สินค้า'}
                    <span className="ml-1 text-[10.5px]" style={{ color: C.faint }}>
                      {r.file_name ?? ''}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-[5px]">
                    {r.by_name || <span style={{ color: C.faint }}>ไม่ทราบชื่อ</span>}
                  </td>
                  <td className="px-2 py-[5px] text-right font-mono">
                    {nf(r.row_count)}
                    <span style={{ color: C.faint }}> / {nf(r.file_rows)}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-[5px]" style={{ color: r.done ? C.greenInk : C.amberInk }}>
                    {r.done ? 'สำเร็จ' : 'อัปไม่จบ'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * บาร์โค้ดของเลขพัสดุ · เล็กไว้ก่อน กดแล้วค่อยใหญ่
 *
 * รอบแรกทำเต็มความกว้างแผงแล้วมันบังทุกอย่าง · ของจริงคนเปิดแผงนี้
 * เพื่ออ่านรายละเอียด ไม่ได้เปิดมายิงทุกครั้ง บาร์โค้ดจึงควรอยู่เงียบ ๆ
 * ข้างเลขพัสดุ แล้วค่อยขยายตอนจะยิงจริง
 *
 * พื้นขาวเสมอแม้ทั้งจอเป็นสีเข้ม · เครื่องยิงอ่านจากคอนทราสต์ระหว่าง
 * แถบดำกับพื้นขาว เอาแถบดำไปวางบนพื้นเข้มคือยิงไม่ติด
 */
function Barcode({ value, detail, dest }: { value: string; detail: string; dest: string }) {
  const svg = useMemo(() => code128Svg(value, 40), [value])
  const [big, setBig] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  if (!svg) return null

  const say = (t: string) => {
    setNote(t)
    window.setTimeout(() => setNote(null), 2200)
  }

  /** ข้อความที่ติดไปกับภาพ · เลขพัสดุ ชื่อสินค้า แล้วสาขาปลายทาง */
  const caption = () =>
    [value, detail || null, dest ? 'ปลายทาง ' + shortName(dest) : null].filter(Boolean).join('\n')

  async function save() {
    const blob = await code128Png(value)
    if (!blob) return say('สร้างไฟล์ภาพไม่ได้')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = value + '.png'
    a.click()
    /* คืนหน่วยความจำทันทีที่เบราว์เซอร์หยิบไฟล์ไปแล้ว */
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
    say('เซฟรูปบาร์โค้ดแล้ว')
  }

  /**
   * ส่งต่อ · พยายามส่งรูปพร้อมข้อความก่อน
   *
   * ช่องแชร์ของเครื่องจะมีไลน์อยู่ในนั้น และส่งได้ทั้งรูปกับข้อความ
   * เครื่องไหนไม่รองรับการแนบไฟล์ ถอยไปเปิดไลน์พร้อมข้อความอย่างเดียว
   * ซึ่งยังได้เลขพัสดุกับชื่อสินค้าครบ แค่ไม่มีรูปบาร์โค้ดติดไป
   */
  async function share() {
    const text = caption()
    const blob = await code128Png(value)
    const nav = navigator as Navigator & {
      canShare?: (d: unknown) => boolean
      share?: (d: unknown) => Promise<void>
    }

    if (blob && nav.share && nav.canShare) {
      const file = new File([blob], value + '.png', { type: 'image/png' })
      if (nav.canShare({ files: [file] })) {
        try {
          await nav.share({ files: [file], text, title: value })
          return
        } catch (e) {
          /* กดยกเลิกช่องแชร์เอง ไม่ใช่ความผิดพลาด อย่าขึ้นข้อความอะไร */
          if ((e as Error)?.name === 'AbortError') return
        }
      }
    }

    window.open('https://line.me/R/msg/text/?' + encodeURIComponent(text), '_blank', 'noopener')
    say('เครื่องนี้แนบรูปไปกับไลน์ไม่ได้ · ส่งเป็นข้อความให้แทน กดเซฟรูปแล้วแนบเองได้')
  }

  return (
    <span className="relative flex items-center gap-[6px]">
      <button
        type="button"
        title={big ? 'กดเพื่อย่อ' : 'กดเพื่อขยาย · ยิงไม่ติดลองขยายก่อน'}
        onClick={() => setBig((v) => !v)}
        className="rounded bg-white px-[6px] pb-[2px] pt-[4px]"
        style={{ width: big ? 420 : 168 }}
      >
        <span className="block" style={{ height: big ? 68 : 26 }} dangerouslySetInnerHTML={{ __html: svg }} />
        <span
          className="mt-[1px] block text-center font-mono font-bold text-black"
          style={{ fontSize: big ? 12 : 8, letterSpacing: big ? '2.5px' : '0.5px', lineHeight: 1.1 }}
        >
          {value}
        </span>
      </button>

      <button type="button" title="เซฟรูปบาร์โค้ด พร้อมเลขพัสดุใต้ภาพ" className="rounded-lg px-[7px] py-[5px] text-[11.5px]" style={tabOff} onClick={() => void save()}>
        ⤓ เซฟ
      </button>
      <button type="button" title="ส่งต่อทางไลน์ พร้อมรูปบาร์โค้ดและรายละเอียดสินค้า" className="rounded-lg px-[7px] py-[5px] text-[11.5px]" style={tabOff} onClick={() => void share()}>
        ➤ ส่งไลน์
      </button>

      {note && (
        <span
          className="absolute left-0 top-full z-10 mt-1 whitespace-normal rounded-lg px-2 py-1 text-[11px]"
          style={{ background: C.greenBg, color: C.greenInk, border: '1px solid #1E5C3C', maxWidth: 320 }}
        >
          {note}
        </span>
      )}
    </span>
  )
}

/** ค่าหนึ่งช่องที่กดแล้วคัดลอก · ช่องว่างกดไม่ได้ ไม่หลอกให้กด */
function Copyable({
  text,
  onCopy,
  what,
  className = '',
  empty = '—',
}: {
  text: string
  onCopy: (text: string, what: string) => void
  what: string
  className?: string
  empty?: string
}) {
  if (!text) return <span className={className} style={{ color: '#3d454e' }}>{empty}</span>
  return (
    <button
      type="button"
      title="กดเพื่อคัดลอก"
      onClick={() => onCopy(text, what)}
      className={`group/c -mx-[5px] -my-[2px] rounded-[5px] px-[5px] py-[2px] text-left hover:bg-[#1C2735] ${className}`}
      style={{ color: C.ink }}
    >
      {text}
      <span className="ml-[7px] align-[1px] text-[10.5px] opacity-0 group-hover/c:opacity-100" style={{ color: C.brand }}>
        ⎘
      </span>
    </button>
  )
}
