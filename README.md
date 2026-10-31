# กล่องข้อความ LINE OA

เว็บสำหรับรับข้อความที่ผู้ใช้ส่งเข้า LINE Official Account แล้วเลือกผู้ใช้คนนั้นเพื่อตอบกลับ ตัวแอปเขียนด้วย Next.js และ TypeScript

## สิ่งที่ทำได้

- รับข้อความจากผู้ใช้ที่ทัก LINE OA ผ่าน webhook
- แสดงชื่อ รูปโปรไฟล์ และรหัสผู้ใช้ของคนที่ส่งมา
- เลือกผู้ใช้จากรายการ แล้วส่งข้อความกลับเข้า LINE
- ล็อกคอนโซลด้วยรหัสผ่าน เพื่อไม่ให้กล่องข้อความเป็นสาธารณะ

## รันในเครื่อง

```bash
npm install
cp .env.example .env.local
npm run dev
```

ใส่ค่าใน `.env.local` แล้วเปิด [http://localhost:3000](http://localhost:3000)

| ตัวแปร | ความหมาย |
| --- | --- |
| `LINE_CHANNEL_SECRET` | Channel secret จาก LINE Developers |
| `LINE_CHANNEL_ACCESS_TOKEN` | Channel access token (long-lived) |
| `ADMIN_PASSWORD` | รหัสผ่านของหน้ากล่องข้อความ ต้องตั้งบน Vercel |
| `UPSTASH_REDIS_REST_URL` | REST URL ของ Upstash Redis |
| `UPSTASH_REDIS_REST_TOKEN` | Token ของ Upstash Redis |

ในเครื่อง ถ้ายังไม่ตั้ง Redis ข้อความจะถูกเก็บที่ `.data/store.json` ไฟล์นี้ไม่ถูก commit

## เชื่อม LINE OA

1. เปิด [LINE Developers](https://developers.line.biz/) แล้วสร้าง Messaging API channel
2. คัดลอก Channel secret และออก Channel access token ไปใส่ใน environment
3. ที่ Messaging API ตั้ง Webhook URL เป็น `https://<โดเมน>/api/line/webhook` แล้วกด Verify
4. เปิด **Use webhook**
5. ให้ผู้ใช้เพิ่มเพื่อน OA แล้วส่งข้อความ ชื่อของผู้ใช้จะโผล่ทางซ้าย
6. เลือกผู้ใช้ แล้วพิมพ์ข้อความเพื่อส่งกลับ

ข้อความตอบกลับจะใช้ Reply API ถ้ายังอยู่ในช่วงเวลาของ reply token และใช้ Push API เมื่อต้องตอบภายหลัง

## ขึ้น Vercel

1. นำโค้ดขึ้น GitHub แล้ว import โปรเจกต์ใน [Vercel](https://vercel.com/new)
2. ตั้ง environment ตามตารางด้านบนทั้ง Production
3. ใน Vercel Marketplace เพิ่ม **Upstash Redis** แล้วเชื่อมกับโปรเจกต์ ระบบจะใส่ `UPSTASH_REDIS_REST_URL` และ `UPSTASH_REDIS_REST_TOKEN` ให้เอง
4. Deploy แล้วเอา URL ของเว็บไปใส่เป็น webhook ใน LINE Developers

ถ้าไม่ได้ต่อ Redis ข้อความจะอยู่ในหน่วยความจำของ serverless และหายเมื่ออินสแตนซ์รีสตาร์ท หน้าเว็บจะขึ้นแถบเตือนในกรณีนี้

อย่า commit ค่า secret หรือ token ลง repository
