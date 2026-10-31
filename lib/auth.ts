import { createHash, createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import type { AuthMode } from "./types";
import { json } from "./http";

const COOKIE = "line_console";
const MAX_AGE = 60 * 60 * 24 * 7;
const attempts = new Map<string, { count: number; reset: number }>();

export function authMode(): AuthMode {
  const password = process.env.ADMIN_PASSWORD?.trim() ?? "";
  const production = process.env.VERCEL === "1" && process.env.NODE_ENV === "production";
  if (production && !password) return "missing-password";
  if (password) return "login";
  return "open";
}

function sessionSecret() {
  return (
    process.env.ADMIN_PASSWORD?.trim() ||
    process.env.LINE_CHANNEL_SECRET?.trim() ||
    "dev-only-session"
  );
}

function safeEqual(a: string, b: string) {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export function createSession() {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + MAX_AGE * 1000 }),
  ).toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function hasValidSession(request: Request) {
  const token = readCookie(request, COOKIE);
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: number;
    };
    return typeof parsed.exp === "number" && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

export function requireConsole(request: Request) {
  const mode = authMode();
  if (mode === "open") return null;
  if (mode === "missing-password") {
    return json(
      {
        error: "ตั้งค่า ADMIN_PASSWORD บน Vercel ก่อนเปิดใช้คอนโซล",
        code: "missing-password",
      },
      503,
    );
  }
  if (!hasValidSession(request)) {
    return json({ error: "กรุณาเข้าสู่ระบบ", code: "unauthorized" }, 401);
  }
  return null;
}

export function tooManyAttempts(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const current = attempts.get(ip);
  if (!current || current.reset < now) {
    attempts.set(ip, { count: 1, reset: now + 10 * 60 * 1000 });
    return false;
  }
  current.count += 1;
  return current.count > 8;
}

export function sessionResponse(body: unknown, status = 200) {
  const response = NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
  response.cookies.set(COOKIE, createSession(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return response;
}

export function clearSessionResponse() {
  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export function passwordsMatch(input: string) {
  const expected = process.env.ADMIN_PASSWORD?.trim() ?? "";
  if (!expected) return false;
  return safeEqual(input, expected);
}
