import { createHmac, timingSafeEqual } from "crypto";
import type { Profile } from "./types";

const REPLY_WINDOW_MS = 60_000;

export function isTestMode() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() === "test-token"
  );
}

export function lineStatus() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() ?? "";
  const secret = process.env.LINE_CHANNEL_SECRET?.trim() ?? "";
  const testMode = isTestMode();
  return {
    token,
    secret,
    testMode,
    lineConfigured: Boolean(token && secret && !testMode),
    canSend: Boolean(token) && (testMode || token !== "test-token"),
  };
}

export function verifyLineSignature(body: string, signature: string | null) {
  const { secret } = lineStatus();
  if (!secret || !signature) return false;
  const digest = createHmac("sha256", secret).update(body).digest();
  let incoming: Buffer;
  try {
    incoming = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  if (incoming.length !== digest.length) return false;
  return timingSafeEqual(incoming, digest);
}

export async function fetchLineProfile(userId: string): Promise<Profile | null> {
  const { token, testMode } = lineStatus();
  if (!token || testMode) return null;
  try {
    const response = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      displayName?: string;
      pictureUrl?: string;
      statusMessage?: string;
    };
    const picture =
      typeof data.pictureUrl === "string" && data.pictureUrl.startsWith("https://")
        ? data.pictureUrl
        : null;
    return {
      displayName: data.displayName?.trim() || `ผู้ใช้ ${userId.slice(-6)}`,
      pictureUrl: picture,
      statusMessage: data.statusMessage?.trim() || null,
    };
  } catch {
    return null;
  }
}

type LineResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

async function linePost(path: string, token: string, body: unknown): Promise<LineResult> {
  try {
    const response = await fetch(`https://api.line.me${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) return { ok: true };
    let message = `LINE API ${response.status}`;
    try {
      const data = (await response.json()) as { message?: string };
      if (data.message) message = data.message;
    } catch {
      // Keep the status fallback when LINE returns a non-JSON body.
    }
    return { ok: false, status: response.status, message };
  } catch (error) {
    const message = error instanceof Error ? error.message : "เชื่อมต่อ LINE ไม่สำเร็จ";
    return { ok: false, status: 0, message };
  }
}

export async function deliverText(
  to: string,
  text: string,
  replyToken: { token: string; at: number } | null,
): Promise<
  | { ok: true; method: "reply" | "push" | "test"; clearToken: boolean }
  | { ok: false; error: string; clearToken: boolean }
> {
  const { token } = lineStatus();
  if (!token) {
    return { ok: false, error: "ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN", clearToken: false };
  }
  if (token === "test-token") {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "โทเคนทดสอบใช้บนโปรดักชันไม่ได้", clearToken: false };
    }
    return { ok: true, method: "test", clearToken: false };
  }

  const fresh = Boolean(replyToken && Date.now() - replyToken.at < REPLY_WINDOW_MS);
  if (fresh && replyToken) {
    const replied = await linePost("/v2/bot/message/reply", token, {
      replyToken: replyToken.token,
      messages: [{ type: "text", text }],
    });
    if (replied.ok) return { ok: true, method: "reply", clearToken: true };
    if (replied.status !== 400) {
      return { ok: false, error: replied.message, clearToken: false };
    }
  }

  const pushed = await linePost("/v2/bot/message/push", token, {
    to,
    messages: [{ type: "text", text }],
  });
  if (!pushed.ok) {
    return { ok: false, error: pushed.message, clearToken: fresh };
  }
  return { ok: true, method: "push", clearToken: fresh };
}
