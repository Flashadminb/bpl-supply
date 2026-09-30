import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import { listOsPeople } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import { useEvidenceImage } from '../../components/EvidenceThumbs'
import { EmptyState, ErrorBox, Loading } from '../../components/ui'
import type { OsPerson } from '../../lib/types'

/**
 * พิมพ์บัตรคล้องคอ — A4 ละ 9 ใบ ขนาด 54×86 มม. เท่าบัตรพนักงาน
 *
 * พิมพ์จาก HTML ตรง ๆ ไม่ได้เรนเดอร์เป็นรูปก่อน
 * ตัวหนังสือจึงคมตามความละเอียดเครื่องพิมพ์ ไม่ใช่ตามความละเอียดรูป
 * ซึ่งสำคัญกับ IMEI สิบห้าหลักที่ต้องอ่านออกจากบัตรจริง
 *
 * ธีมเหลือง-กรมท่าตามแบบที่เจ้าของระบบทำไว้ใน Canva
 * ยังต่างจากแบบอยู่อย่างเดียวคือไม่มีรูปพื้นหลังคลัง ซึ่งรอไฟล์อยู่
 */

const Y = '#FFED00'
const NAVY = '#16304C'

/**
 * สไตล์ของบัตร — แยกออกมาเป็นคอมโพเนนต์
 *
 * เดิมฝังอยู่ใน JSX ของหน้ารวม ใครเรียก <Card> ไปใช้ที่อื่นเลยได้บัตรเปล่า ๆ
 * แยกออกมาแล้วใครจะโชว์บัตรที่ไหนก็แค่วาง <OsCardStyles /> ไว้ด้วยหนึ่งครั้ง
 */
export function OsCardStyles() {
  return <style>{`
        .os-sheet { display:grid; grid-template-columns:repeat(2,204px); gap:10px; }
        @media print {
          .no-print { display:none !important; }
          .os-sheet { grid-template-columns:repeat(3,54mm); gap:4mm; }
          .os-card { break-inside:avoid; page-break-inside:avoid; }
          @page { size:A4; margin:8mm; }
        }
        .os-card {
          position:relative; width:204px; height:325px; overflow:hidden;
          background:#EDEAE4; border:1px dashed #b9b3a6; border-radius:8px;
          font-family:Kanit,system-ui,sans-serif; color:#111;
        }
        @media print { .os-card { width:54mm; height:86mm; border-radius:2mm; } }
        .os-top { position:absolute; left:0; right:0; top:0; height:8%; overflow:hidden; }
        .os-navy,.os-navy2 { position:absolute; inset:0; background:${NAVY}; }
        .os-navy  { clip-path:polygon(0 0,100% 0,100% 60%,48% 100%,0 55%); }
        .os-wedge { position:absolute; right:0; top:0; width:46%; height:27%; background:${Y};
                    clip-path:polygon(34% 0,100% 0,100% 74%,52% 100%); }
        .os-ystripe { position:absolute; left:-4%; top:0; width:52%; height:9px; background:${Y};
                      transform:skewX(-34deg); }
        /* โลโก้เล็กและอยู่สูงตามแบบใน Canva
           ของเดิมใหญ่กว่านี้และต่ำกว่านี้ เลยไปอยู่แถวเดียวกับป้ายสังกัดพอดี
           มองแล้วหนักไปทางซ้ายทั้งที่ป้ายอยู่กลางบัตรจริง ๆ */
        .os-logo { position:absolute; left:9px; top:22px; width:46px; height:auto; }

        /* แถบล่างบางลงและดันลายไปอยู่สองมุม ตรงกลางจึงว่างพอให้ QR ยืนเต็มใบ
           ของเดิมหนา 14% พาดขวางทั้งใบ เลยกิน QR ไปจนสแกนไม่ติด */
        .os-bot { position:absolute; left:0; right:0; bottom:0; height:8%; overflow:hidden; }
        .os-navy2 { clip-path:polygon(0 52%,30% 14%,100% 40%,100% 100%,0 100%); }
        .os-ytri2 { position:absolute; left:0; bottom:0; width:46%; height:100%; background:${Y};
                    clip-path:polygon(0 34%,48% 0,86% 30%,30% 100%,0 100%); }

        /* กรอบนี้กว้างเท่าบัตรและเว้นซ้ายขวาเท่ากัน แกนกลางของทุกบรรทัดจึงตรงกลางบัตรพอดี
           ถ้าเว้นไม่เท่ากันเมื่อไหร่ ป้ายสังกัดกับชื่อจะเยื้องออกข้างทันที */
        .os-inner { position:absolute; inset:0; display:flex; flex-direction:column;
                    align-items:center; justify-content:space-between; text-align:center;
                    padding:46px 9px 36px; }
        .os-tag { flex:0 0 auto; background:${Y}; color:#111; border-radius:4px; padding:0 10px;
                  font-weight:700; font-size:10px; line-height:1.5; }
        .os-mid { display:flex; flex-direction:column; align-items:center; width:100%;
                  min-height:0; }
        .os-name { font-weight:700; line-height:1.12; }
        .os-id { font-size:9px; color:#3b3b3b; margin-top:1px; }
        .os-model { font-weight:700; font-size:9.5px; margin-top:4px; text-transform:uppercase;
                    line-height:1.2; }
        .os-imeiL { font-weight:700; font-size:10px; margin-top:3px; }
        .os-imeiV { font-size:8.5px; letter-spacing:.01em; }
        .os-hub { position:absolute; right:9px; bottom:29px; text-align:right;
                  line-height:1.2; }
        .os-hub b { display:block; font-size:6px; color:#111; }
        .os-hub span { font-size:5px; color:#333; }
      `}</style>
}

function QrImg({ token, size = 150 }: { token: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(token, { width: size * 2, margin: 0, errorCorrectionLevel: 'M' })
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null))
    return () => {
      alive = false
    }
  }, [token, size])
  return (
    <span
      className="block bg-white"
      style={{ width: size, height: size, padding: 4 }}
      aria-label="QR บัตร"
    >
      {url && <img src={url} alt="" style={{ width: '100%', height: '100%' }} />}
    </span>
  )
}

function Face({ fileId }: { fileId: string | null }) {
  const { url } = useEvidenceImage(fileId, Boolean(fileId))
  return (
    <span
      className="block overflow-hidden"
      style={{
        width: 84,
        height: 92,
        // ยอมให้รูปหดได้ เป็นวาล์วกันล้นของบัตร
        // ชื่อยาวสองบรรทัดหรือชื่อรุ่นยาว ๆ จะดันของข้างล่างตกขอบ
        // หดรูปลงสองสามพิกเซลไม่มีใครดูออก แต่ QR หลุดขอบนี่สแกนไม่ได้เลย
        flex: '0 1 auto',
        minHeight: 62,
        background: '#d8d3c7',
        borderRadius: 4,
      }}
    >
      {url ? (
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span
          style={{
            display: 'flex',
            height: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            color: '#7a7466',
            textAlign: 'center',
            padding: 4,
          }}
        >
          ยังไม่มีรูป
        </span>
      )}
    </span>
  )
}

/** หน้าบัตรหนึ่งใบ — แยกออกมาเพื่อให้หน้าอื่นเรียกดูได้โดยไม่ต้องก็อป CSS ไปทั้งชุด */
export function Card({ p }: { p: OsPerson }) {
  // ชื่อไทยยาวกว่าชื่อพม่าที่เขียนด้วยอักษรโรมันมาก ย่อตามความยาวไม่ให้ล้นกรอบ
  const nameSize = p.full_name.length > 22 ? 12 : p.full_name.length > 16 ? 14 : 17

  return (
    <div className="os-card">
      <div className="os-top">
        <span className="os-navy" />
        <span className="os-ystripe" />
      </div>
      <span className="os-wedge" />
      <img className="os-logo" src="/os-logo.png" alt="Flash Express" />

      <div className="os-inner">
        <span className="os-tag">{p.affiliation ?? '—'}</span>
        <Face fileId={p.photo_file_id} />
        <div className="os-mid">
          <span className="os-name" style={{ fontSize: nameSize }}>
            {p.full_name}
          </span>
          <span className="os-id">ID: {p.os_code ?? '—'}</span>
          <span className="os-model">{p.phone_model ?? '—'}</span>
          <span className="os-imeiL">IMEI</span>
          <span className="os-imeiV">{p.imei ?? '—'}</span>
        </div>
        {p.card_token && <QrImg token={p.card_token} size={52} />}
      </div>

      <div className="os-bot">
        <span className="os-navy2" />
        <span className="os-ytri2" />
      </div>
      <span className="os-hub">
        <b>21BPL_BHUB-บางพลี</b>
        <span>Hub Standardization</span>
      </span>
    </div>
  )
}

export default function OsCards() {
  const list = useAsync(() => listOsPeople(), [])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [onlyNew, setOnlyNew] = useState(false)

  const rows = useMemo(
    () => (list.data ?? []).filter((p) => p.is_active && p.has_card),
    [list.data],
  )
  const toPrint = useMemo(() => {
    if (picked.size > 0) return rows.filter((p) => picked.has(p.id))
    if (onlyNew) {
      // ใบที่เพิ่งออกใน 7 วัน — ใช้ตอนมีคนเข้าใหม่ ไม่ต้องพิมพ์ยกชุดใหม่ทั้งฮับ
      const cut = Date.now() - 7 * 864e5
      return rows.filter((p) => p.card_issued_at && new Date(p.card_issued_at).getTime() > cut)
    }
    return rows
  }, [rows, picked, onlyNew])

  const noCard = (list.data ?? []).filter((p) => p.is_active && !p.has_card).length

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl">พิมพ์บัตร OS</h1>
          <p className="text-sm text-ink-400">
            A4 ละ 9 ใบ · ขนาด 54×86 มม. เท่าบัตรพนักงาน · ตัดตามเส้นประ
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/os" className="btn-ghost">
            กลับไปรายชื่อ
          </Link>
          <button
            type="button"
            className={`chip ${onlyNew ? 'chip-on' : ''}`}
            onClick={() => {
              setOnlyNew((v) => !v)
              setPicked(new Set())
            }}
          >
            เฉพาะบัตรที่ออกใน 7 วัน
          </button>
          <button type="button" className="btn-primary" onClick={() => window.print()}>
            พิมพ์ {toPrint.length} ใบ
          </button>
        </div>
      </div>

      {list.loading && <Loading />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}

      {noCard > 0 && (
        <p className="no-print mb-3 rounded-card border border-warn/30 bg-warn-bg p-3 text-sm text-warn-txt">
          มีอีก {noCard} คนที่ยังไม่ได้ออกบัตร — ไปกดออกบัตรที่หน้ารายชื่อก่อน ถึงจะพิมพ์ได้
        </p>
      )}

      {!list.loading && rows.length === 0 && (
        <EmptyState title="ยังไม่มีบัตรให้พิมพ์" hint="ออกบัตรที่หน้ารายชื่อ OS ก่อน" />
      )}

      {rows.length > 0 && (
        <div className="no-print mb-3 rounded-card border border-line bg-surface p-3">
          <p className="label">เลือกเฉพาะบางคน · ไม่เลือกเลย = พิมพ์ทั้งหมดที่กรองไว้</p>
          <div className="flex max-h-[150px] flex-wrap gap-1 overflow-y-auto">
            {rows.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`chip ${picked.has(p.id) ? 'chip-on' : ''}`}
                onClick={() => {
                  const next = new Set(picked)
                  if (next.has(p.id)) next.delete(p.id)
                  else next.add(p.id)
                  setPicked(next)
                  setOnlyNew(false)
                }}
              >
                {p.full_name}
              </button>
            ))}
          </div>
          {picked.size > 0 && (
            <button
              type="button"
              className="mt-2 text-sm text-ink-400 underline"
              onClick={() => setPicked(new Set())}
            >
              ล้างที่เลือก ({picked.size})
            </button>
          )}
        </div>
      )}

      <OsCardStyles />

      <div className="os-sheet">
        {toPrint.map((p) => (
          <Card key={p.id} p={p} />
        ))}
      </div>

    </div>
  )
}
