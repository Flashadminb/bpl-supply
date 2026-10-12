import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../lib/useAsync'
import { listAnnouncements } from '../lib/api'
import { markNoticeSeen, listNoticeSeen } from '../lib/noticeSeen'
import { Modal } from './ui'
import { AssetOtButton } from './AssetOtButton'

/**
 * ป็อปอัพรวมเรื่องใหม่ที่ยังไม่เคยเห็น
 *
 * เจ้าของระบบเลือกแบบ "เด้งทุกครั้งที่มีเรื่องใหม่ที่ยังไม่เคยเห็น"
 * ของพวกนี้ทำพังง่ายมาก จึงกันความเสี่ยงไว้ห้าชั้น
 *
 *   1 อยู่บนหน้าแรกเท่านั้น · หน้าสแกน กล้อง และฟอร์มที่ยังไม่เซฟจึงไม่มีทางโดนบัง
 *     ซึ่งเป็นความเสี่ยงที่แพงที่สุด คนยืนหน้าประตูถือของเต็มมือรอไม่ได้
 *   2 เด้งเฉพาะเรื่องที่ยังไม่เคยเห็น และจำรายคนที่ฐานข้อมูล ไม่ใช่รายเครื่อง
 *   3 รวมทุกเรื่องในใบเดียว ปุ่มปิดใหญ่ปุ่มเดียว ไม่เด้งซ้อนกันทีละเรื่อง
 *   4 ปิดแล้วไปอยู่ในกระดิ่งกับป้ายประกาศตามเดิม ไม่ได้ลบทิ้ง
 *   5 โหลดไม่สำเร็จก็เงียบไปเลย ไม่เด้งใบเปล่าให้คนกดปิดฟรี ๆ
 *
 * เรื่องที่เอามาเด้งมีสองอย่างที่มีตัวตนจริงและมีเจ้าของชัดเจน
 * คือประกาศจากหลังบ้าน กับของที่เลยกำหนดคืนของคนนั้นเอง
 * ตัวเลขรวม ๆ อย่าง "ค้าง 3 รายการ" ไม่เอามาเด้ง เพราะมันขึ้นลงทั้งวัน
 * แล้วจะกลายเป็นป็อปอัพที่เด้งทุกชั่วโมงจนไม่มีใครอ่าน
 */

export interface LateItem {
  code: string
  typeName: string
  dueAt: string
  /** ใบเบิกของเครื่องนี้ · ไว้ให้กดต่อเวลาจากในป็อปอัพได้เลย */
  txnId: string
  /** เคยขอต่อไว้ถึงกี่โมง · ว่าง = ยังไม่เคยขอ */
  otUntil?: string | null
  otHours?: number | null
}

interface Row {
  key: string
  title: string
  sub: string
  bad?: boolean
  /** มีใบเบิกผูกอยู่ · ขอต่อเวลาได้จากแถวนี้เลย */
  ot?: { txnId: string; until?: string | null; hours?: number | null }
}

export function NewNotices({ late }: { late: LateItem[] }) {
  const seen = useAsync(() => listNoticeSeen(), [])
  const anns = useAsync(() => listAnnouncements(), [])
  const [closed, setClosed] = useState(false)
  /*
    ใบเบิกใบเดียวถือได้หลายเครื่อง และการต่อเวลาต่อให้ทั้งใบ ไม่ใช่ทีละเครื่อง
    ถ้าให้แต่ละแถวจำของตัวเอง กดต่อที่เครื่องแรกแล้วเครื่องที่สองจะยังขึ้นปุ่มอยู่
    พอกดก็จะเจอ "ใบนี้ต่อเวลาไปแล้ว" ทั้งที่เพิ่งกดไปเองเมื่อกี้
    จึงจำที่เลขใบ แล้วทุกแถวของใบเดียวกันพลิกพร้อมกัน
  */
  const [otDone, setOtDone] = useState<Record<string, { hours: number; until: string }>>({})

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const l of late) {
      out.push({
        /*
          กุญแจผูกกับเส้นตายที่ใช้จริง ไม่ใช่ผูกกับรหัสเครื่องเฉย ๆ
          พอขอต่อเวลา เส้นตายเปลี่ยน กุญแจจึงเป็นตัวใหม่
          แปลว่าถ้าเลยเวลาที่ขอต่อไว้อีก ป็อปอัพจะเด้งเตือนใหม่
          ถ้าผูกกับรหัสเครื่องอย่างเดียว เตือนครั้งแรกครั้งเดียวแล้วเงียบตลอดกาล
        */
        key: `late:${l.code}:${l.otUntil ?? l.dueAt}`,
        ot: { txnId: l.txnId, until: l.otUntil, hours: l.otHours },
        title: `เลยกำหนดคืนแล้ว · ${l.code}`,
        sub: `${l.typeName} · ครบกำหนด ${new Date(l.dueAt).toLocaleString('th-TH', {
          hour: '2-digit',
          minute: '2-digit',
        })} น.`,
        bad: true,
      })
    }
    for (const a of anns.data ?? []) {
      out.push({
        key: `ann:${a.id}`,
        title: a.title,
        sub: a.level === 'urgent' ? 'ประกาศด่วน' : 'ประกาศจากหลังบ้าน',
        bad: a.level === 'urgent',
      })
    }
    return out
  }, [late, anns.data])

  /* ยังโหลดไม่เสร็จหรือโหลดพลาด ให้เงียบ · ไม่เดาว่าอะไรใหม่ตอนที่ยังไม่รู้ว่าเคยเห็นอะไร */
  const ready = seen.data !== undefined && !seen.error
  const fresh = ready ? rows.filter((r) => !(seen.data ?? []).includes(r.key)) : []

  /* ปิดเองอัตโนมัติถ้าของที่ค้างอยู่หายไประหว่างเปิดค้าง เช่นมีคนไปคืนให้แล้ว */
  useEffect(() => {
    if (fresh.length === 0) setClosed(false)
  }, [fresh.length])

  if (!ready || fresh.length === 0 || closed) return null

  async function close() {
    setClosed(true)
    try {
      await markNoticeSeen(fresh.map((r) => r.key))
    } catch {
      /* บันทึกไม่ได้ก็แค่เด้งซ้ำรอบหน้า ไม่ใช่เรื่องที่ต้องขึ้น error ให้คนหน้างาน */
    }
  }

  return (
    <Modal open onClose={() => void close()} title={`มีเรื่องใหม่ ${fresh.length} เรื่อง`}>
      <ul className="space-y-2">
        {fresh.slice(0, 8).map((r) => (
          <li
            key={r.key}
            className={`rounded-card border-l-[3px] px-3 py-2 ${
              r.bad ? 'border-danger bg-danger-bg' : 'border-line-2 bg-surface-2'
            }`}
          >
            <p className={`font-display text-base ${r.bad ? 'text-danger-txt' : 'text-ink'}`}>
              {r.title}
            </p>
            <p className={`text-sm ${r.bad ? 'text-danger-txt' : 'text-ink-500'}`}>{r.sub}</p>
            {/*
              ขอต่อเวลาได้ตรงนี้เลย ไม่ต้องเด้งไปอีกหน้าแล้วหาเครื่องเองใหม่
              ไม่กดก็ปิดป็อปอัพได้ตามปกติ ปุ่มนี้ไม่เคยขวางทางอะไร
            */}
            {r.ot && (
              <AssetOtButton
                txnId={r.ot.txnId}
                otUntil={otDone[r.ot.txnId]?.until ?? r.ot.until}
                otHours={otDone[r.ot.txnId]?.hours ?? r.ot.hours}
                tone="onDanger"
                onDone={(hours, until) =>
                  setOtDone((v) => ({ ...v, [r.ot?.txnId ?? '']: { hours, until } }))
                }
              />
            )}
          </li>
        ))}
        {fresh.length > 8 && (
          <li className="text-center text-sm text-ink-400">และอีก {fresh.length - 8} เรื่อง</li>
        )}
      </ul>

      <p className="mt-3 text-center text-xs text-ink-400">
        ปิดแล้วเรื่องพวกนี้ยังอยู่ในป้ายประกาศและกระดิ่งเหมือนเดิม ไม่ได้หายไปไหน
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link to="/returns" onClick={() => void close()} className="btn-soft py-4 text-center">
          ไปดูของที่ต้องคืน
        </Link>
        <button type="button" className="btn-primary py-4" onClick={() => void close()}>
          รับทราบ
        </button>
      </div>
    </Modal>
  )
}
