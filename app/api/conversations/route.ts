import { requireConsole } from "@/lib/auth";
import { isLineUserId, json } from "@/lib/http";
import { listInbox, markRead } from "@/lib/store";

export async function GET(request: Request) {
  void request.headers.get("cookie");
  const denied = requireConsole(request);
  if (denied) return denied;
  const inbox = await listInbox();
  return json(inbox);
}

export async function POST(request: Request) {
  const denied = requireConsole(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { userId?: unknown } | null;
  const userId = typeof body?.userId === "string" ? body.userId : "";
  if (!isLineUserId(userId)) return json({ error: "ไม่พบผู้ใช้นี้" }, 400);
  await markRead(userId);
  return json({ ok: true });
}
