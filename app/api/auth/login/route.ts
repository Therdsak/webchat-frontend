import { authMode, passwordsMatch, sessionResponse, tooManyAttempts } from "@/lib/auth";
import { json } from "@/lib/http";

export async function POST(request: Request) {
  const mode = authMode();
  if (mode === "missing-password") {
    return json({ error: "ตั้งค่า ADMIN_PASSWORD บน Vercel ก่อนเปิดใช้คอนโซล" }, 503);
  }
  if (mode === "open") return json({ ok: true });
  if (tooManyAttempts(request)) {
    return json({ error: "ลองรหัสผ่านบ่อยเกินไป รอสักครู่แล้วลองใหม่" }, 429);
  }

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!passwordsMatch(password)) return json({ error: "รหัสผ่านไม่ถูกต้อง" }, 401);
  return sessionResponse({ ok: true });
}
