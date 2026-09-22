import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

/**
 * หน้านโยบาย 2 หน้านี้เปิดได้โดยไม่ต้องล็อกอิน
 * Google บังคับให้แอป OAuth ต้องมีลิงก์นโยบายที่เปิดได้จริงก่อนจะอนุญาตให้เผยแพร่
 * เนื้อหาต้องตรงกับที่ระบบทำจริง ไม่ใช่ข้อความสำเร็จรูป
 */
function Page({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="safe-t bg-brand-500 text-ink">
        <div className="mx-auto max-w-[760px] px-4 pb-5 pt-6">
          <p className="font-mono text-xs tracking-widest">FLASH EXPRESS · BPL HUB</p>
          <h1 className="mt-1 font-display text-xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm">ปรับปรุงล่าสุด {updated}</p>
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-4 py-6">
        <article className="panel space-y-5 p-5 text-base leading-relaxed text-ink-700">{children}</article>
        <p className="mt-5 text-center">
          <Link to="/" className="text-sm text-ink-500 underline">
            กลับหน้าแรก
          </Link>
        </p>
      </main>
    </div>
  )
}

function H({ children }: { children: ReactNode }) {
  return <h2 className="font-display text-md text-ink">{children}</h2>
}

export function Privacy() {
  return (
    <Page title="นโยบายความเป็นส่วนตัว" updated="23 กันยายน 2569">
      <section>
        <H>ระบบนี้คืออะไร</H>
        <p className="mt-1">
          BPL SUPPLY เป็นระบบเบิก–คืนวัสดุและอุปกรณ์ภายในของศูนย์คัดแยกพัสดุ
          ใช้งานเฉพาะพนักงานที่ได้รับบัญชีจากผู้ดูแลระบบเท่านั้น ไม่เปิดให้บุคคลทั่วไปสมัครใช้งาน
        </p>
      </section>

      <section>
        <H>ข้อมูลที่เก็บ</H>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>รหัสพนักงาน ชื่อ-นามสกุล หน่วยงาน และบทบาทในระบบ</li>
          <li>รายการวัสดุหรืออุปกรณ์ที่เบิกและคืน จำนวน วันเวลา และวัตถุประสงค์</li>
          <li>รูปถ่ายหลักฐานตอนเบิกและตอนคืน พร้อมวันเวลาและชื่อผู้ถ่ายที่ประทับบนรูป</li>
        </ul>
        <p className="mt-2">
          ระบบ<b>ไม่เก็บ</b>เลขบัตรประชาชน ข้อมูลทางการเงิน ข้อมูลสุขภาพ
          รายชื่อผู้ติดต่อ หรือข้อมูลตำแหน่งที่ตั้งของผู้ใช้
        </p>
      </section>

      <section>
        <H>ข้อมูลถูกเก็บไว้ที่ไหน</H>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>ข้อมูลการเบิก–คืน เก็บในฐานข้อมูล Supabase</li>
          <li>
            รูปหลักฐาน เก็บใน Google Drive ของผู้ดูแลระบบ ผ่านสิทธิ์ที่ผู้ดูแลระบบอนุญาตด้วยตนเอง
            ระบบใช้สิทธิ์ <code>drive.file</code> ซึ่งเข้าถึงได้เฉพาะไฟล์ที่ระบบสร้างขึ้นเองเท่านั้น
            ไม่สามารถอ่านไฟล์อื่นในบัญชี Google ได้
          </li>
          <li>รายงานสรุป เขียนลง Google Sheet ของผู้ดูแลระบบ</li>
        </ul>
      </section>

      <section>
        <H>ใครเห็นข้อมูลได้บ้าง</H>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>พนักงานหน้างาน เห็นเฉพาะประวัติการเบิกของตนเอง และเปิดดูรูปหลักฐานไม่ได้</li>
          <li>แอดมิน เห็นคำขอและรูปหลักฐานเพื่อตรวจสอบและอนุมัติ</li>
          <li>ผู้ดูแลระบบ เห็นทั้งหมด และเป็นผู้จัดการบัญชีผู้ใช้</li>
        </ul>
        <p className="mt-2">
          สิทธิ์เหล่านี้บังคับที่ระดับฐานข้อมูล ไม่ใช่แค่การซ่อนปุ่มบนหน้าจอ
          และระบบไม่ส่งข้อมูลให้บุคคลภายนอก ไม่ขาย ไม่ใช้ทำโฆษณา
        </p>
      </section>

      <section>
        <H>ระยะเวลาเก็บและการลบ</H>
        <p className="mt-1">
          ข้อมูลถูกเก็บไว้เพื่อการตรวจสอบย้อนหลังตามระเบียบภายในขององค์กร
          ผู้ใช้ที่ต้องการให้ลบหรือแก้ไขข้อมูลของตน ติดต่อผู้ดูแลระบบได้โดยตรง
        </p>
      </section>

      <section>
        <H>ติดต่อ</H>
        <p className="mt-1">
          ผู้ดูแลระบบ · <span className="font-mono">elevenezbest@gmail.com</span>
        </p>
      </section>
    </Page>
  )
}

export function Terms() {
  return (
    <Page title="ข้อกำหนดการใช้งาน" updated="23 กันยายน 2569">
      <section>
        <H>ผู้มีสิทธิ์ใช้งาน</H>
        <p className="mt-1">
          ระบบนี้ใช้ภายในองค์กรเท่านั้น สงวนสิทธิ์เฉพาะพนักงานที่ได้รับบัญชีจากผู้ดูแลระบบ
          ไม่มีการเปิดให้สมัครใช้งานเอง
        </p>
      </section>

      <section>
        <H>หน้าที่ของผู้ใช้</H>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>ใช้บัญชีของตนเองเท่านั้น ห้ามให้ผู้อื่นใช้รหัสผ่านของตน</li>
          <li>ถ่ายรูปหลักฐานตามจริง ห้ามใช้รูปเก่าหรือรูปของรายการอื่นมาแทน</li>
          <li>เบิกวัสดุและอุปกรณ์เพื่อใช้ในงานเท่านั้น</li>
          <li>คืนอุปกรณ์ประเภทยืม–คืนตามกำหนด และแจ้งทันทีเมื่อชำรุดหรือสูญหาย</li>
        </ul>
      </section>

      <section>
        <H>ความถูกต้องของข้อมูล</H>
        <p className="mt-1">
          ทุกรายการมีการบันทึกผู้ทำ วันเวลา และรูปหลักฐานไว้ตรวจสอบย้อนหลังได้
          การกรอกข้อมูลเท็จถือเป็นความผิดตามระเบียบขององค์กร
        </p>
      </section>

      <section>
        <H>การให้บริการ</H>
        <p className="mt-1">
          ระบบอาจหยุดให้บริการชั่วคราวเพื่อปรับปรุงหรือด้วยเหตุขัดข้องของผู้ให้บริการภายนอก
          หากระบบใช้งานไม่ได้ ให้ดำเนินการตามขั้นตอนสำรองที่หน่วยงานกำหนดและแจ้งผู้ดูแลระบบ
        </p>
      </section>

      <section>
        <H>ติดต่อ</H>
        <p className="mt-1">
          ผู้ดูแลระบบ · <span className="font-mono">elevenezbest@gmail.com</span>
        </p>
      </section>
    </Page>
  )
}
