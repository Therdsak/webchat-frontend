import { requireConsole } from "@/lib/auth";
import { isLineUserId, json } from "@/lib/http";
import { deliverText } from "@/lib/line";
import { clearReplyToken, getReplyToken, hasUser, saveOutbound } from "@/lib/store";

export async function POST(request: Request) {
  const denied = requireConsole(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as {
    userId?: unknown;
    text?: unknown;
  } | null;
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!isLineUserId(userId)) return json({ error: "เลือกผู้ใช้ก่อนส่งข้อความ" }, 400);
  if (!text) return json({ error: "พิมพ์ข้อความก่อนส่ง" }, 400);
  if (text.length > 5000) return json({ error: "ข้อความยาวเกิน 5,000 ตัวอักษร" }, 400);
  if (!(await hasUser(userId))) {
    return json({ error: "ผู้ใช้นี้ยังไม่ได้ทักมาที่ LINE OA" }, 404);
  }

  const replyToken = await getReplyToken(userId);
  const result = await deliverText(userId, text, replyToken);
  if (result.clearToken && replyToken) {
    await clearReplyToken(userId, replyToken.token);
  }
  if (!result.ok) return json({ error: result.error }, 502);

  const message = await saveOutbound(userId, text);
  if (!message) return json({ error: "บันทึกข้อความตอบกลับไม่สำเร็จ" }, 500);
  return json({ message, method: result.method });
}
