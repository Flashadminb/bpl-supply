import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { WorkLinks } from '../../components/WorkLinks'
import { useAuth } from '../../lib/auth'
import { usePendingApprovals } from '../../lib/usePendingApprovals'
import { usePendingExports } from '../../lib/usePendingExports'
import { usePendingMeetings } from '../../lib/usePendingMeetings'
import { Icon, type IconName } from '../../components/icons'
import { MANAGER_ROLES, isOwner } from '../../lib/roles'

// adminOnly = เห็นเฉพาะ "ผู้ดูแลระบบ" (role admin) ส่วน "แอดมิน" (supervisor) เห็นที่เหลือทั้งหมด
// audit     = "ผู้ตรวจสอบ" เห็นเมนูนี้ · เป็นรายการขาว อ่านคู่กับ visible() ท้ายไฟล์
//
// ลำดับเมนูเรียงตามความถี่ที่เปิดจริง ไม่ได้เรียงตามโครงสร้างระบบ
//   หน้าแรกกับหลักฐาน เปิดแทบทุกวัน
//   ยังไม่คืน เป็นงานตามของ แยกออกมาเพราะถามบ่อยสุดและถามพร้อมกันทั้งสองฝั่ง
//   สิ้นเปลือง / Asset เป็นงานดูแลของประจำ
//   รายงาน เปิดตอนสรุป ไม่ใช่ทุกวัน จึงลงไปอยู่ท้าย ๆ
//   ทั่วไป เป็นงานตั้งค่า นาน ๆ ที
interface Link {
  to: string
  label: string
  icon: IconName
  end?: boolean
  adminOnly?: boolean
  /** เลขค้างท้ายเมนู ดึงจากตัวนับคนละตัวกัน */
  badge?: 'approvals' | 'exports' | 'meetings'
  /** ผู้ตรวจสอบเห็นเมนูนี้ · ธงนี้ไม่เกี่ยวกับ adminOnly ทั้งสองอันคุมคนละเส้น */
  audit?: boolean
  /** เจ้าของระบบคนเดียว · แคบกว่า adminOnly เพราะผู้ดูแลระบบก็ไม่เห็น */
  ownerOnly?: boolean
  /** ติดดาวไม่ได้ · ใช้กับหน้าแรกที่อยู่บนสุดตลอดอยู่แล้ว ติดดาวไปก็ซ้ำที่เดิม */
  noPin?: boolean
}

/**
 * บุ๊กมาร์ก · เก็บในเครื่องแยกตามคนที่ล็อกอิน
 *
 * ที่ไม่เก็บลงฐานข้อมูล เพราะเป็นความชอบส่วนตัวของแต่ละคนที่เปลี่ยนบ่อย
 * และไม่มีใครอื่นต้องรู้ · เก็บในเครื่องจึงกดแล้วติดทันทีโดยไม่ต้องรอเน็ตฮับ
 * ข้อแลกคือเปลี่ยนเครื่องแล้วต้องติดดาวใหม่ ซึ่งใช้เวลาไม่กี่วินาที
 */
const PIN_KEY = 'bpl.menu.pins.'

/** ติดดาวให้อัตโนมัติตั้งแต่แรก ตามที่เจ้าของระบบสั่ง · เอาออกเองได้ทุกอัน */
const PIN_DEFAULT = [
  '/admin/notices',
  '/admin/evidence',
  '/admin/return-status',
  '/admin/asset-moves',
  '/admin/outstanding',
  '/admin/assets-out',
  '/admin/approvals',
]

function readPins(uid: string): string[] {
  try {
    const raw = localStorage.getItem(PIN_KEY + uid)
    if (raw === null) return PIN_DEFAULT
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? (v as string[]) : PIN_DEFAULT
  } catch {
    return PIN_DEFAULT
  }
}

interface Group {
  title: string | null
  links?: Link[]
  /**
   * กลุ่มที่พับเก็บไว้ กดหัวข้อถึงจะกาง
   *
   * งาน STANDARD เป็นงานประจำสัปดาห์ ไม่ใช่งานประจำวัน แต่มีหน้าอยู่หกหน้า
   * กางค้างไว้ตลอดแปลว่าเมนูที่เปิดทุกวันถูกดันลงไปจนต้องเลื่อนหา
   * ของที่ใช้บ่อยในกลุ่มนี้คือสองหน้าประวัติ ซึ่งก็อปไปไว้ในกลุ่มตรวจสอบแล้ว
   */
  collapsible?: boolean
  subs?: { title: string; links: Link[] }[]
}

/**
 * ลำดับเมนู · เจ้าของระบบเรียงมาเองทั้งชุด
 *
 * ทุกคนเห็นลำดับเดียวกัน ต่างกันแค่ว่าใครเห็นรายการไหนบ้าง
 * ไม่ได้สลับลำดับตามบทบาท เพราะคนสองคนที่คุยกันทางโทรศัพท์
 * ต้องชี้ได้ว่า "อันที่สามจากบน" แล้วหมายถึงอันเดียวกัน
 *
 * บางรายการตั้งใจให้ซ้ำสองกลุ่ม เช่นหลักฐานการเบิก-คืนที่อยู่ทั้งกลุ่มบนและ ADMIN
 * เพราะคนละคนเข้าหามันคนละทาง · คนตรวจเข้าจากกลุ่มบน คนคุมของเข้าจาก ADMIN
 */
const GROUPS: Group[] = [
  {
    /* หน้าแรกอยู่บนสุดตลอด ไม่พับ ไม่ติดดาว · ใต้มันคือกล่องบุ๊กมาร์ก */
    title: null,
    links: [{ to: '/admin', label: 'หน้าแรก', icon: 'home', end: true, audit: true, noPin: true }],
  },
  {
    title: 'ตรวจสอบ',
    links: [
      { to: '/admin/notices', label: 'ประกาศและแจ้งเตือน', icon: 'bell', audit: true },
      { to: '/admin/evidence', label: 'หลักฐานการเบิก-คืน', icon: 'photo' },
      { to: '/admin/return-status', label: 'สถานะเบิก-คืน', icon: 'clipboard', audit: true },
      { to: '/admin/asset-moves', label: 'สถานะโอน-แจ้งเสีย', icon: 'history', audit: true },
      { to: '/admin/outstanding', label: 'ของค้างคืน', icon: 'clock', audit: true },
      { to: '/admin/assets-out', label: 'Asset ที่ยังไม่คืน', icon: 'device-clock', audit: true },
      { to: '/admin/approvals', label: 'คำขอเบิก', icon: 'inbox', badge: 'approvals' },
    ],
  },
  {
    title: 'ADMIN',
    links: [
      { to: '/admin/stock', label: 'สต็อกวัสดุ', icon: 'box' },
      { to: '/admin/approvals', label: 'คำขอเบิก', icon: 'inbox', badge: 'approvals' },
      { to: '/admin/evidence', label: 'หลักฐานการเบิก-คืน', icon: 'photo' },
      { to: '/admin/return-status', label: 'สถานะเบิก-คืน', icon: 'clipboard' },
      { to: '/admin/asset-moves', label: 'สถานะโอน-แจ้งเสีย', icon: 'history' },
      { to: '/admin/outstanding', label: 'ของค้างคืน', icon: 'clock' },
      { to: '/admin/by', label: 'บาร์โค้ดจาก BY', icon: 'barcode' },
      { to: '/admin/sacks', label: 'กระจายกระสอบ', icon: 'box' },
      { to: '/admin/report/supply', label: 'รายงานสิ้นเปลือง', icon: 'chart' },
      { to: '/admin/report/asset', label: 'รายงาน Asset', icon: 'pie', audit: true },
    ],
  },
  {
    /* ไม่ได้อยู่ในชุดที่เจ้าของระบบเรียงมา แต่ตัดทิ้งไม่ได้เพราะเป็นทางเดียวที่เข้าสองหน้านี้ */
    title: 'ASSET',
    links: [
      { to: '/admin/asset-board', label: 'กระดานเครื่อง', icon: 'device-clock' },
      { to: '/admin/assets', label: 'ทะเบียนเครื่อง', icon: 'device' },
    ],
  },
  {
    title: 'STANDARD',
    collapsible: true,
    links: [
      { to: '/admin/meetings', label: 'รายชื่อประชุม', icon: 'clipboard', audit: true, badge: 'meetings' },
      { to: '/admin/meeting-evidence', label: 'หลักฐานการเข้าประชุม', icon: 'photo', audit: true },
      { to: '/admin/report/meeting', label: 'แดชบอร์ดประชุม', icon: 'pie' },
      { to: '/admin/break/history', label: 'ประวัติเบรค', icon: 'history', audit: true },
      { to: '/admin/break/audit', label: 'ประวัติการแก้ไขเบรค', icon: 'clipboard', audit: true },
      { to: '/admin/os/scans', label: 'ประวัติการสแกน', icon: 'history', audit: true },
    ],
    subs: [
      {
        title: 'บัตร OS',
        links: [
          { to: '/guard', label: 'สแกนบัตร (หน้างาน)', icon: 'qr', audit: true },
          { to: '/admin/os', label: 'รายชื่อและบัตร', icon: 'users', audit: true, end: true },
          { to: '/admin/os/print', label: 'พิมพ์บัตร', icon: 'qr', audit: true },
        ],
      },
      {
        title: 'บัตรเบรค',
        links: [
          { to: '/admin/break/cards', label: 'จัดการบัตรเบรค', icon: 'qr', audit: true },
        ],
      },
      {
        title: 'สิ้นเปลือง',
        links: [{ to: '/admin/supply-history', label: 'ประวัติเบิกสิ้นเปลือง', icon: 'history', audit: true }],
      },
    ],
  },
  {
    title: 'OPERATION',
    links: [
      { to: '/outbox', label: 'ของค้างส่งออก', icon: 'box', adminOnly: true },
      { to: '/parcel24', label: 'พัสดุค้างเกิน 24 ชม', icon: 'n24', adminOnly: true },
      { to: '/admin/outbox-zones', label: 'โซน D0x ของสาขา', icon: 'lock', adminOnly: true },
    ],
    subs: [
      {
        title: 'กระดานปล่อยรถ',
        links: [
          { to: '/trucks', label: 'กระดานปล่อยรถ', icon: 'clipboard', audit: true },
          { to: '/admin/trucks', label: 'ส่งชีต สาขา แจ้งเตือน', icon: 'sheet', adminOnly: true, audit: true },
        ],
      },
      {
        title: 'กระดานรถรอลงงาน',
        links: [
          { to: '/wait', label: 'กระดานรถรอลงงาน', icon: 'clock', audit: true },
          { to: '/wait/stats', label: 'แดชบอร์ดรถรอลงงาน', icon: 'pie', audit: true },
          { to: '/admin/wait', label: 'ตั้งเกณฑ์เวลารถรอลงงาน', icon: 'clock', adminOnly: true },
        ],
      },
    ],
  },
  {
    /* งานหลังบ้าน · ตั้งชื่ออังกฤษว่า SYSTEM เพราะสั้นกว่า BACK OFFICE
       และสามกลุ่มบนเป็นคำเดียวหมด ยาวคำเดียวจะดูแปลกแถวเดียว */
    title: 'SYSTEM',
    links: [
      { to: '/admin/links', label: 'ลิงก์งาน', icon: 'sheet' },
      { to: '/admin/qr', label: 'พิมพ์ QR', icon: 'qr' },
      { to: '/admin/notices', label: 'ประกาศและแจ้งเตือน', icon: 'bell', audit: true },
      { to: '/admin/users', label: 'ผู้ใช้และสิทธิ์', icon: 'users' },
      { to: '/admin/access', label: 'สิทธิ์เข้าถึง', icon: 'lock' },
      { to: '/admin/export', label: 'ส่งออก Google Sheet', icon: 'sheet', badge: 'exports' },
      { to: '/admin/health', label: 'สถานะระบบ', icon: 'lock', ownerOnly: true },
    ],
  },
]

export default function AdminLayout() {
  const { profile, signOut, can } = useAuth()
  const isManager = can(...MANAGER_ROLES)
  /** ผู้ตรวจสอบล้วน · ไม่ใช่แอดมินที่ติดธงนี้มาด้วย */
  const isAudit = !isManager && Boolean(profile?.can_dispatch)
  const [menu, setMenu] = useState(false)
  /** กลุ่มไหนพับอยู่ · จำไว้ในเครื่อง จะได้ไม่ต้องพับใหม่ทุกครั้งที่เปิดหน้า */
  const uid = profile?.id ?? 'anon'
  /**
   * เปิดมาพับไว้หมดทุกกลุ่ม เหลือแต่หน้าแรกกับบุ๊กมาร์ก ตามที่เจ้าของระบบสั่ง
   * ใครกางกลุ่มไหนไว้ ครั้งหน้าก็ยังกางอยู่ เพราะจำลงเครื่องให้
   */
  const allTitles = GROUPS.map((g) => g.title).filter((t): t is string => Boolean(t))
  const [shut, setShut] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('bpl.menu.shut.' + uid)
      return raw ? (JSON.parse(raw) as string[]) : allTitles
    } catch {
      return allTitles
    }
  })
  const toggleGroup = (t: string) =>
    setShut((cur) => {
      const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]
      try {
        localStorage.setItem('bpl.menu.shut.' + uid, JSON.stringify(next))
      } catch {
        /* เบราว์เซอร์ปิด storage ก็แค่ไม่จำ ไม่ใช่เรื่องคอขาดบาดตาย */
      }
      return next
    })

  const [pins, setPins] = useState<string[]>(() => readPins(uid))
  const togglePin = (to: string) =>
    setPins((cur) => {
      const next = cur.includes(to) ? cur.filter((x) => x !== to) : [...cur, to]
      try {
        localStorage.setItem(PIN_KEY + uid, JSON.stringify(next))
      } catch {
        /* เหมือนกัน */
      }
      return next
    })
  const here = useLocation().pathname
  const pending = usePendingApprovals()
  const exports = usePendingExports()
  const meetings = usePendingMeetings()
  const badgeOf = { approvals: pending.count, exports: exports.count, meetings: meetings.count }

  /**
   * ผู้ตรวจสอบตัดสินด้วยธง audit ตัวเดียว ไม่ต้องผ่านด่าน adminOnly ก่อน
   *
   * เดิมกรองสองชั้นต่อกัน ซึ่งทำให้เขียน "เห็นเฉพาะเจ้าของระบบกับผู้ตรวจสอบ
   * แต่แอดมินไม่เห็น" ไม่ได้เลย — ซึ่งเป็นรูปที่เจ้าของระบบสั่งมาจริงสองหน้า
   * คือกระดานปล่อยรถกับรายชื่อสาขา
   *
   *   adminOnly  คุมเส้นแบ่งระหว่างผู้ดูแลระบบกับแอดมิน
   *   audit      คุมว่าผู้ตรวจสอบเห็นไหม เป็นรายการขาวล้วน ไม่ติดอะไรโดยบังเอิญ
   */
  const visible = (links: Link[]) =>
    links
      .filter((l) => !l.ownerOnly || isOwner(profile))
      .filter((l) => (isAudit ? Boolean(l.audit) : !l.adminOnly || can('admin')))

  /**
   * แถวเมนูหนึ่งแถว · ดาวอยู่นอก NavLink ไม่ใช่ข้างใน
   * เพราะปุ่มซ้อนในลิงก์ กดดาวทีไรจะเด้งไปหน้านั้นด้วยทุกที
   */
  /**
   * แถวเมนูหนึ่งแถว
   *
   * พื้นหลังอยู่ที่กรอบนอก ไม่ได้อยู่ที่ตัวลิงก์ เพราะดาวต้องอยู่ในแถบไฮไลต์เดียวกัน
   * ถ้าพื้นหลังอยู่ที่ลิงก์ ดาวจะลอยอยู่นอกแถบแล้วดูเหมือนคนละของ
   *
   * ดาวเป็นคอลัมน์กว้างคงที่ชิดขวาสุดทุกแถว และแถวที่ยังไม่ติดดาวก็ขึ้นดาวโปร่ง
   * ไม่ใช่เว้นว่าง · ถ้าเว้นว่าง ดาวที่ติดแล้วจะดูกระจัดกระจายไม่เป็นแถว
   * และคนจะไม่รู้ว่าแถวที่ยังไม่ติดก็กดติดได้
   *
   * ดาวอยู่นอก NavLink เพราะปุ่มซ้อนในลิงก์ กดดาวทีไรจะเด้งไปหน้านั้นด้วยทุกที
   */
  const item = (l: Link, where = '') => {
    const on = l.end ? here === l.to : here === l.to || here.startsWith(l.to + '/')
    const star = pins.includes(l.to)
    return (
      <div
        key={where + l.to}
        className={`flex items-center rounded-btn ${on ? 'bg-dark-3' : 'hover:bg-dark-2'}`}
      >
        <NavLink
          to={l.to}
          end={l.end}
          onClick={() => setMenu(false)}
          className={`flex min-h-tap min-w-0 flex-1 items-center gap-[10px] rounded-btn pl-3 text-base ${
            on ? 'text-white' : 'text-dark-text'
          }`}
        >
          <Icon name={l.icon} className={on ? '' : 'text-dark-muted'} />
          <span className="min-w-0 flex-1 truncate">{l.label}</span>
          {l.badge && badgeOf[l.badge] > 0 && (
            <span className="rounded-pill bg-brand-500 px-2 font-display text-xs text-ink">
              {badgeOf[l.badge] > 99 ? '99+' : badgeOf[l.badge]}
            </span>
          )}
        </NavLink>
        {l.noPin ? (
          <span className="w-[34px] shrink-0" aria-hidden />
        ) : (
        <button
          type="button"
          aria-label={star ? `เอา ${l.label} ออกจากบุ๊กมาร์ก` : `ติดดาว ${l.label}`}
          aria-pressed={star}
          onClick={() => togglePin(l.to)}
          className={`flex h-tap w-[34px] shrink-0 items-center justify-center rounded-btn text-[15px] leading-none ${
            star ? 'text-brand-500' : 'text-dark-muted/40 hover:text-dark-muted'
          }`}
        >
          {star ? '★' : '☆'}
        </button>
        )}
      </div>
    )
  }

  /** ลิงก์ที่ติดดาวไว้ · เรียงตามลำดับเมนูจริง ไม่ใช่ตามลำดับที่กดดาว
      เพราะคนจำตำแหน่งจากเมนูหลัก ไม่ได้จำว่าตัวเองกดดาวอันไหนก่อน */
  const pinned = GROUPS.flatMap((g) => [...(g.links ?? []), ...(g.subs ?? []).flatMap((x) => x.links)])
    .filter((l, i, arr) => arr.findIndex((x) => x.to === l.to) === i)
    .filter((l) => !l.noPin)
    .filter((l) => pins.includes(l.to))
    .filter((l) => visible([l]).length > 0)

  const nav = (
    <nav className="flex flex-col gap-1">
      {/* บุ๊กมาร์ก · ต่อจากหน้าแรกตามที่สั่ง · ไม่มีดาวค้างไว้ก็ไม่ขึ้นทั้งกล่อง */}
      {pinned.length > 0 && (
        <div className="rounded-card border border-brand-500/40 bg-dark-2/40 p-[6px]">
          <p className="mb-1 flex items-center gap-2 px-3 pt-1 font-display text-sm text-brand-500">
            <span aria-hidden>★</span> บุ๊กมาร์ก
          </p>
          {pinned.map((l) => item(l, 'pin:'))}
        </div>
      )}

      {GROUPS.map((g) => {
        if (g.title && (g.collapsible || true)) {
          const own = visible(g.links ?? [])
          const shutNow = shut.includes(g.title)
          const subs = (g.subs ?? [])
            .map((s) => ({ ...s, links: visible(s.links) }))
            .filter((s) => s.links.length > 0)
          if (subs.length === 0 && own.length === 0) return null
          /* ไม่กางเองเวลายืนอยู่ในหน้าของกลุ่มนั้น เพราะเจ้าของระบบสั่งว่าพับไว้เสมอ
             ทางกลับคือกล่องบุ๊กมาร์กด้านบน ซึ่งเก็บหน้าที่เข้าบ่อยไว้ให้อยู่แล้ว */
          const on = !shutNow
          return (
            <div key={g.title} className="mt-3 rounded-card border border-dark-3 bg-dark-2/30 p-[6px]">
              {/* หัวกลุ่มใหญ่และเด่นกว่าแถวเมนู เพราะมันคือป้ายบอกทางของทั้งก้อน
                  ของเดิมตัวเล็กสีจางกว่าเมนูข้างใน ซึ่งกลับหัวกลับหาง */}
              <button
                type="button"
                className="flex min-h-tap w-full items-center gap-2 rounded-btn px-3 text-left font-display text-sm tracking-wide text-white hover:bg-dark-2"
                onClick={() => toggleGroup(g.title as string)}
                aria-expanded={on}
              >
                <span className="flex-1">{g.title}</span>
                <span className="font-mono text-xs text-dark-muted" aria-hidden>
                  {on ? '▾' : '▸'}
                </span>
              </button>
              {on && own.map((l) => item(l))}
              {on &&
                subs.map((s) => (
                  <div key={s.title} className="mt-1">
                    <p className="mb-1 px-3 pl-5 font-mono text-[11px] uppercase tracking-widest text-dark-muted">
                      {s.title}
                    </p>
                    {s.links.map((l) => item(l))}
                  </div>
                ))}
            </div>
          )
        }

        const links = visible(g.links ?? [])
        const plain = (g.subs ?? [])
          .map((s) => ({ ...s, links: visible(s.links) }))
          .filter((s) => s.links.length > 0)
        if (links.length === 0 && plain.length === 0) return null
        return (
          /* ทุกกลุ่มมีกรอบของตัวเอง · ก่อนหน้านี้มีแต่หัวข้อตัวจาง ๆ คั่น
             พอเมนูยาวขึ้นเรื่อย ๆ เส้นแบ่งแบบนั้นหายไปกับพื้นหลัง */
          <div
            key={g.title ?? 'top'}
            className={`rounded-card border border-dark-3 bg-dark-2/30 p-[6px] ${g.title ? 'mt-3' : ''}`}
          >
            {g.title && (
              <p className="mb-1 px-3 pt-1 font-mono text-xs uppercase tracking-widest text-dark-muted">
                {g.title}
              </p>
            )}
            {links.map((l) => item(l))}
            {plain.map((s) => (
              <div key={s.title} className="mt-1">
                <p className="mb-1 px-3 pl-5 font-mono text-[11px] uppercase tracking-widest text-dark-muted">
                  {s.title}
                </p>
                {s.links.map((l) => item(l))}
              </div>
            ))}
          </div>
        )
      })}
    </nav>
  )

  return (
    <div className="min-h-dvh bg-canvas lg:flex">
      {/* แถบข้างเดสก์ท็อป 244px */}
      <aside className="hidden w-[244px] shrink-0 flex-col bg-dark lg:sticky lg:top-0 lg:flex lg:h-dvh">
        {/* กดชื่อแอพกลับหน้าแรกของหลังบ้าน · ทำเป็นกรอบนูนให้รู้ว่ากดได้
            ของเดิมเป็นข้อความเฉย ๆ ซึ่งกดได้จริงแต่ไม่มีอะไรบอก */}
        <div className="shrink-0 px-4 pb-3 pt-4">
          <Link
            to="/admin"
            onClick={() => {
              /* เด้งขึ้นบนสุดทั้งหน้าและทั้งแถบเมนู · กดจากหน้าที่เลื่อนลงไปลึก ๆ
                 แล้วไปโผล่หน้าแรกตรงกลางหน้า คือสิ่งที่ทำให้คนงงว่ากดติดไหม */
              setMenu(false)
              window.scrollTo({ top: 0 })
              document.getElementById('admin-nav')?.scrollTo({ top: 0 })
            }}
            className="block rounded-card border border-dark-3 bg-dark-2 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_6px_14px_-10px_#000] hover:bg-dark-3"
          >
            <span className="block font-mono text-xs tracking-widest text-dark-muted">FLASH EXPRESS</span>
            <span className="block font-display text-lg text-white">BPL SUPPLY</span>
          </Link>
        </div>

        {/* min-h-0 จำเป็น ไม่งั้น flex ไม่ยอมให้ลูกหดแล้วการเลื่อนจะไม่ทำงาน */}
        <div id="admin-nav" className="min-h-0 flex-1 overflow-y-auto px-4">{nav}</div>

        <div className="shrink-0 border-t border-dark-3 px-4 pb-4 pt-3 text-sm text-dark-muted">
          {/* ลิงก์งาน — เดิมมีแต่ในแอพ เปิดหน้าเว็บบนคอมแล้วหาไม่เจอ */}
          <div className="mb-3 flex items-center gap-2">
            <WorkLinks tone="onDark" />
            <span className="text-dark-text">ลิงก์งาน</span>
          </div>
          <p className="mb-2 text-[10px] tracking-wide text-dark-muted/60">
            Created by Thanawat Phuttarit
          </p>
          <p className="text-dark-text">{profile?.full_name}</p>
          <p className="font-mono text-xs">
            {profile?.employee_code} · {profile?.hub_code}
          </p>
          <Link to="/" className="mt-2 block min-h-tap py-2 underline">
            กลับหน้าพนักงาน
          </Link>
          <button type="button" className="min-h-tap py-2 underline" onClick={() => void signOut()}>
            ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* หัวมือถือ */}
      <header className="safe-t sticky top-0 z-30 flex items-center gap-2 bg-dark px-3 py-2 text-white lg:hidden">
        <button type="button" className="h-tap w-tap text-lg" aria-label="เมนู" onClick={() => setMenu((m) => !m)}>
          ☰
        </button>
        <span className="flex-1 font-display text-md">BPL SUPPLY · แอดมิน</span>
        <WorkLinks tone="onDark" />
        <Link to="/" className="min-h-tap px-2 py-2 text-sm underline">
          หน้าพนักงาน
        </Link>
      </header>
      {menu && (
        <div className="sticky top-[52px] z-30 max-h-[70dvh] overflow-y-auto border-b border-dark-3 bg-dark p-3 lg:hidden">
          {nav}
        </div>
      )}

      <main className="min-w-0 flex-1 p-4 lg:p-6">
        <Outlet context={{ reloadPending: pending.reload }} />
      </main>
    </div>
  )
}
