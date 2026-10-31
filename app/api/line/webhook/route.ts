import { isLineUserId, json } from "@/lib/http";
import { fetchLineProfile, isTestMode, lineStatus, verifyLineSignature } from "@/lib/line";
import { saveInbound } from "@/lib/store";

type LineSource = { type?: string; userId?: string };
type LineMessage = { id?: string; type?: string; text?: string };
type LineEvent = {
  type?: string;
  timestamp?: number;
  replyToken?: string;
  source?: LineSource;
  message?: LineMessage;
};

const LABELS: Record<string, string> = {
  image: "[รูปภาพ]",
  video: "[วิดีโอ]",
  audio: "[เสียง]",
  file: "[ไฟล์]",
  location: "[ตำแหน่ง]",
  sticker: "[สติกเกอร์]",
};

function readTestName(request: Request) {
  const raw = request.headers.get("x-test-display-name")?.trim() ?? "";
  if (!raw) return "";
  const bytes = [...raw].every((char) => char.charCodeAt(0) <= 255);
  if (!bytes) return raw;
  const decoded = Buffer.from(raw, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? raw : decoded.trim();
}

function messageText(message: LineMessage) {
  if (message.type === "text") return message.text?.trim() ?? "";
  return LABELS[message.type ?? ""] ?? `[${message.type ?? "ข้อความ"}]`;
}

export async function POST(request: Request) {
  const { secret } = lineStatus();
  if (!secret) {
    return json({ error: "ยังไม่ได้ตั้ง LINE_CHANNEL_SECRET" }, 503);
  }

  const rawBody = await request.text();
  if (!verifyLineSignature(rawBody, request.headers.get("x-line-signature"))) {
    return json({ error: "ลายเซ็น webhook ไม่ถูกต้อง" }, 401);
  }

  let body: { events?: LineEvent[] };
  try {
    body = JSON.parse(rawBody) as { events?: LineEvent[] };
  } catch {
    return json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, 400);
  }

  for (const event of body.events ?? []) {
    if (event.type !== "message" || !event.message?.id) continue;
    const userId = event.source?.type === "user" ? event.source.userId : undefined;
    if (!userId || !isLineUserId(userId)) continue;
    const text = messageText(event.message);
    if (!text) continue;

    const testName = isTestMode() ? readTestName(request) : "";
    const fetched = testName
      ? { displayName: testName.slice(0, 80), pictureUrl: null, statusMessage: null }
      : await fetchLineProfile(userId);
    const profile = fetched ?? {
      displayName: `ผู้ใช้ ${userId.slice(-6)}`,
      pictureUrl: null,
      statusMessage: null,
    };

    await saveInbound({
      userId,
      messageId: event.message.id,
      text: text.slice(0, 5000),
      messageType: event.message.type || "text",
      timestamp: event.timestamp || Date.now(),
      replyToken: event.replyToken,
      profile,
      profileIsFallback: !fetched,
    });
  }

  return json({ ok: true });
}
