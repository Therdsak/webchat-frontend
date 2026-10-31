"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { AppStatus, ChatMessage, ChatUser, Inbox } from "@/lib/types";

const EMPTY_INBOX: Inbox = { users: [], messages: {} };

function formatListTime(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat("th-TH", {
    hour: sameDay ? "2-digit" : undefined,
    minute: sameDay ? "2-digit" : undefined,
    day: sameDay ? undefined : "numeric",
    month: sameDay ? undefined : "short",
  }).format(date);
}

function formatMessageTime(timestamp: number) {
  return new Intl.DateTimeFormat("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function Avatar({ name, pictureUrl, size = "md" }: { name: string; pictureUrl: string | null; size?: "md" | "lg" }) {
  const dimension = size === "lg" ? "h-12 w-12" : "h-11 w-11";
  if (pictureUrl) {
    return (
      // LINE profile photos are served from a CDN host that is not known at build time.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={pictureUrl}
        alt=""
        referrerPolicy="no-referrer"
        className={`${dimension} shrink-0 rounded-full object-cover`}
      />
    );
  }
  return (
    <div
      className={`${dimension} flex shrink-0 items-center justify-center rounded-full bg-[#06C755] text-sm font-semibold text-white`}
    >
      {name.trim().charAt(0) || "?"}
    </div>
  );
}

export function ChatConsole() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [inbox, setInbox] = useState<Inbox>(EMPTY_INBOX);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [copied, setCopied] = useState(false);
  const [requiresLogin, setRequiresLogin] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const loadInbox = useCallback(async () => {
    const response = await fetch("/api/conversations", { cache: "no-store" });
    if (response.status === 401) {
      setStatus((current) => (current ? { ...current, auth: "login" } : current));
      return;
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error || "โหลดบทสนทนาไม่สำเร็จ");
    }
    const data = (await response.json()) as Inbox;
    setInbox(data);
    const user = data.users.find((item) => item.userId === selectedId);
    if (selectedId && user && user.unreadCount > 0) {
      await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedId }),
      });
      setInbox((previous) => ({
        ...previous,
        users: previous.users.map((item) =>
          item.userId === selectedId ? { ...item, unreadCount: 0 } : item,
        ),
      }));
    }
  }, [selectedId]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        const nextStatus = (await response.json()) as AppStatus;
        if (cancelled) return;
        setStatus(nextStatus);
        setRequiresLogin(nextStatus.auth === "login");
        if (!nextStatus.lineConfigured && !nextStatus.testMode) setShowSetup(true);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!status || status.auth !== "open") return;
    const pull = () => {
      void loadInbox().catch(() => undefined);
    };
    const first = setTimeout(pull, 0);
    const timer = setInterval(pull, 2500);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [loadInbox, status]);

  const selected = inbox.users.find((user) => user.userId === selectedId) ?? null;
  const messages = selectedId ? (inbox.messages[selectedId] ?? []) : [];
  const visibleUsers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return inbox.users;
    return inbox.users.filter(
      (user) =>
        user.displayName.toLowerCase().includes(keyword) || user.userId.toLowerCase().includes(keyword),
    );
  }, [inbox.users, query]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [selectedId, messages.length]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setLoggingIn(true);
    setLoginError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setLoginError(data?.error || "เข้าสู่ระบบไม่สำเร็จ");
        return;
      }
      setStatus((current) => (current ? { ...current, auth: "open" } : current));
      setPassword("");
      await loadInbox();
    } finally {
      setLoggingIn(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSelectedId(null);
    setInbox(EMPTY_INBOX);
    setStatus((current) => (current ? { ...current, auth: "login" } : current));
  }

  function selectUser(userId: string) {
    setSelectedId(userId);
    setError("");
    setInbox((previous) => ({
      ...previous,
      users: previous.users.map((user) =>
        user.userId === userId ? { ...user, unreadCount: 0 } : user,
      ),
    }));
    void fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || !draft.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedId, text: draft }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(data?.error || "ส่งข้อความไม่สำเร็จ");
        return;
      }
      setDraft("");
      await loadInbox();
    } catch {
      setError("ส่งข้อความไม่สำเร็จ");
    } finally {
      setSending(false);
    }
  }

  const webhookUrl =
    typeof window === "undefined" ? "" : `${window.location.origin}/api/line/webhook`;

  async function copyWebhook() {
    await navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  if (loading) {
    return (
      <main className="grid h-dvh place-items-center bg-[#e7efeb] text-[#1c2b24]">
        <p className="text-sm font-medium">กำลังเปิดกล่องข้อความ...</p>
      </main>
    );
  }

  if (status?.auth === "missing-password") {
    return (
      <main className="grid h-dvh place-items-center bg-[#e7efeb] px-6 text-[#1c2b24]">
        <section className="w-full max-w-md rounded-3xl bg-white p-8 shadow-[0_20px_60px_rgba(16,40,28,0.08)]">
          <p className="text-sm font-semibold text-[#06C755]">LINE OA</p>
          <h1 className="mt-2 text-2xl font-semibold">ยังเปิดคอนโซลไม่ได้</h1>
          <p className="mt-3 text-sm leading-6 text-[#5d6b64]">
            ตั้งค่าตัวแปร <code className="rounded bg-[#eef6f1] px-1.5 py-0.5">ADMIN_PASSWORD</code> บน
            Vercel แล้วเปิดหน้านี้ใหม่ รหัสนี้ใช้ล็อกกล่องข้อความไม่ให้คนอื่นอ่านแชทของลูกค้า
          </p>
        </section>
      </main>
    );
  }

  if (status?.auth === "login") {
    return (
      <main className="grid h-dvh place-items-center bg-[#e7efeb] px-6 text-[#1c2b24]">
        <form
          onSubmit={login}
          className="w-full max-w-md rounded-3xl bg-white p-8 shadow-[0_20px_60px_rgba(16,40,28,0.08)]"
        >
          <p className="text-sm font-semibold text-[#06C755]">LINE OA</p>
          <h1 className="mt-2 text-2xl font-semibold">เข้าสู่กล่องข้อความ</h1>
          <p className="mt-2 text-sm leading-6 text-[#5d6b64]">
            ใส่รหัสผ่านคอนโซลเพื่อดูว่าใครทักมา และเลือกผู้ใช้เพื่อตอบกลับ
          </p>
          <label className="mt-6 block text-sm font-medium" htmlFor="password">
            รหัสผ่าน
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 h-12 w-full rounded-2xl border border-[#d7e3dc] px-4 outline-none focus:border-[#06C755]"
          />
          {loginError ? <p className="mt-3 text-sm text-[#b42318]">{loginError}</p> : null}
          <button
            type="submit"
            disabled={loggingIn || !password}
            className="mt-5 h-12 w-full rounded-2xl bg-[#06C755] font-semibold text-white disabled:opacity-50"
          >
            {loggingIn ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="flex h-dvh flex-col bg-[#e7efeb] text-[#1c2b24]">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#d5e2db] bg-white px-4 py-3 md:px-6">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[#06C755]">LINE OFFICIAL ACCOUNT</p>
          <h1 className="text-lg font-semibold">กล่องข้อความ</h1>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={status} />
          <button
            type="button"
            onClick={() => setShowSetup((value) => !value)}
            className="h-10 rounded-full border border-[#d5e2db] px-4 text-sm font-medium hover:bg-[#f4faf6]"
          >
            วิธีเชื่อมต่อ
          </button>
          {requiresLogin ? (
            <button
              type="button"
              onClick={() => void logout()}
              className="h-10 rounded-full px-3 text-sm font-medium text-[#66756e] hover:bg-[#f4faf6]"
            >
              ออกจากระบบ
            </button>
          ) : null}
        </div>
      </header>
      {status?.testMode || status?.storage === "memory" ? (
        <p className="shrink-0 bg-[#fff8e8] px-4 py-2 text-sm text-[#7a5b00] md:px-6">
          {status.testMode ? "โหมดทดสอบ: ข้อความตอบกลับถูกเก็บในระบบ แต่ยังไม่ส่งเข้า LINE จริง" : "ข้อความอยู่ในหน่วยความจำชั่วคราว ต่อ Upstash Redis แล้วข้อความจะไม่หาย"}
        </p>
      ) : null}
      {error && !selected ? <p className="shrink-0 bg-[#fff4f2] px-4 py-2 text-sm text-[#b42318] md:px-6">{error}</p> : null}

      {showSetup ? (
        <section className="shrink-0 border-b border-[#d5e2db] bg-[#f7fbf8] px-4 py-4 text-sm md:px-6">
          <ol className="grid gap-2 text-[#3d4f46] md:grid-cols-2">
            <li>1. ใน LINE Developers สร้าง Messaging API channel แล้วออก Channel secret กับ Channel access token</li>
            <li>2. ตั้งค่า <code>LINE_CHANNEL_SECRET</code> และ <code>LINE_CHANNEL_ACCESS_TOKEN</code> บน Vercel</li>
            <li>3. วาง Webhook URL ด้านล่าง แล้วเปิด Use webhook</li>
            <li>4. เพิ่ม Upstash Redis จาก Vercel Marketplace เพื่อให้ข้อความไม่หายตอน serverless รีสตาร์ท</li>
          </ol>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <code className="flex-1 overflow-x-auto rounded-xl bg-white px-3 py-2 text-xs">{webhookUrl}</code>
            <button
              type="button"
              onClick={() => void copyWebhook()}
              className="h-10 rounded-xl bg-[#163028] px-4 text-sm font-medium text-white"
            >
              {copied ? "คัดลอกแล้ว" : "คัดลอก Webhook"}
            </button>
          </div>
          {status?.storage === "memory" ? (
            <p className="mt-3 text-[#9a6700]">
              ตอนนี้ข้อความอยู่ในหน่วยความจำชั่วคราวของเซิร์ฟเวอร์ จะหายเมื่ออินสแตนซ์รีสตาร์ท
            </p>
          ) : null}
          {status?.testMode ? (
            <p className="mt-2 text-[#9a6700]">โหมดทดสอบ: ข้อความตอบกลับถูกบันทึกในระบบ แต่ยังไม่ส่งเข้า LINE จริง</p>
          ) : null}
        </section>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside
          className={`${selected ? "hidden md:flex" : "flex"} min-h-0 w-full flex-col border-[#d5e2db] bg-white md:w-[340px] md:border-r`}
        >
          <div className="shrink-0 p-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ค้นหาชื่อหรือรหัสผู้ใช้"
              aria-label="ค้นหาผู้ใช้"
              className="h-11 w-full rounded-2xl bg-[#f3f7f4] px-4 text-sm outline-none focus:ring-2 focus:ring-[#06C755]"
            />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="รายชื่อผู้ใช้">
            {visibleUsers.length === 0 ? (
              <li className="px-6 py-10 text-center text-sm leading-6 text-[#66756e]">
                ยังไม่มีผู้ใช้ทักมา
                <br />
                ข้อความที่ส่งเข้า LINE OA จะปรากฏที่นี่
              </li>
            ) : (
              visibleUsers.map((user) => (
                <li key={user.userId}>
                  <button
                    type="button"
                    onClick={() => selectUser(user.userId)}
                    aria-pressed={user.userId === selectedId}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#f4faf6] ${
                      user.userId === selectedId ? "bg-[#e7f8ee]" : ""
                    }`}
                  >
                    <Avatar name={user.displayName} pictureUrl={user.pictureUrl} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-semibold">{user.displayName}</span>
                        <span className="shrink-0 text-xs text-[#7b8a83]">
                          {user.lastMessageAt ? formatListTime(user.lastMessageAt) : ""}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-[#66756e]">{user.lastMessageText}</span>
                        {user.unreadCount > 0 ? (
                          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#06C755] px-1.5 text-xs font-semibold text-white">
                            {user.unreadCount}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </aside>

        <section className={`${selected ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-1 flex-col`}>
          {selected ? (
            <>
              <div className="flex shrink-0 items-center gap-3 border-b border-[#d5e2db] bg-white px-4 py-3">
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="h-10 rounded-full px-3 text-sm font-medium md:hidden"
                >
                  กลับ
                </button>
                <Avatar name={selected.displayName} pictureUrl={selected.pictureUrl} size="lg" />
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold">{selected.displayName}</h2>
                  <p className="truncate font-mono text-xs text-[#66756e]">{selected.userId}</p>
                  {selected.statusMessage ? (
                    <p className="truncate text-xs text-[#66756e]">{selected.statusMessage}</p>
                  ) : null}
                </div>
              </div>
              <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-5">
                {messages.map((message) => (
                  <Bubble key={message.id} message={message} user={selected} />
                ))}
              </div>
              <form onSubmit={send} className="shrink-0 border-t border-[#d5e2db] bg-white p-3 md:p-4">
                {error ? <p className="mb-2 text-sm text-[#b42318]">{error}</p> : null}
                {!status?.canSend ? (
                  <p className="mb-2 text-sm text-[#9a6700]">ยังส่งไม่ได้ เพราะยังไม่ได้ตั้ง Channel access token</p>
                ) : null}
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    aria-label="ข้อความตอบกลับ"
                    placeholder={`ตอบกลับ ${selected.displayName}`}
                    rows={2}
                    maxLength={5000}
                    className="max-h-40 min-h-12 flex-1 resize-none rounded-2xl border border-[#d7e3dc] px-4 py-3 text-sm outline-none focus:border-[#06C755]"
                  />
                  <button
                    type="submit"
                    disabled={sending || !draft.trim() || !status?.canSend}
                    className="h-12 shrink-0 rounded-2xl bg-[#06C755] px-5 font-semibold text-white disabled:opacity-50"
                  >
                    {sending ? "กำลังส่ง" : "ส่ง"}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="grid flex-1 place-items-center px-8 text-center">
              <div>
                <p className="text-lg font-semibold">เลือกผู้ใช้เพื่อตอบกลับ</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#66756e]">
                  เมื่อมีคนทัก LINE OA ชื่อและรูปโปรไฟล์จะอยู่ทางซ้าย เลือกคนนั้นแล้วพิมพ์ข้อความเพื่อส่งกลับเข้า LINE
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function StatusPill({ status }: { status: AppStatus | null }) {
  const ready = Boolean(status?.lineConfigured);
  const label = status?.testMode ? "โหมดทดสอบ" : ready ? "เชื่อมต่อ LINE แล้ว" : "ยังไม่เชื่อม LINE";
  const color = status?.testMode ? "bg-[#9a6700]" : ready ? "bg-[#06C755]" : "bg-[#98a29c]";
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-[#f4faf6] px-3 py-2 text-xs font-medium">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function Bubble({ message, user }: { message: ChatMessage; user: ChatUser }) {
  const outbound = message.direction === "out";
  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[min(78%,28rem)] rounded-3xl px-4 py-2.5 text-sm leading-6 shadow-sm ${
          outbound ? "rounded-br-md bg-[#06C755] text-white" : "rounded-bl-md bg-white text-[#1c2b24]"
        }`}
      >
        <span className="sr-only">{outbound ? "คุณตอบกลับ" : user.displayName}</span>
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
        <p className={`mt-1 text-[11px] ${outbound ? "text-white/80" : "text-[#8b9892]"}`}>
          {formatMessageTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}
