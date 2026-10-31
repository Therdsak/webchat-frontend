import { randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import type { ChatMessage, ChatUser, Inbox, Profile, StorageMode } from "./types";

type ProfileRecord = {
  userId: string;
  displayName: string;
  pictureUrl: string;
  statusMessage: string;
  unread: number;
  lastText: string;
  lastMessageAt: number;
  replyToken: string;
  replyTokenAt: number;
};

type FileShape = {
  profiles: Record<string, ProfileRecord>;
  messages: Record<string, ChatMessage[]>;
  seen: Record<string, number>;
};

type InboundInput = {
  userId: string;
  messageId: string;
  text: string;
  messageType: string;
  timestamp: number;
  replyToken?: string;
  profile: Profile;
  profileIsFallback: boolean;
};

const EMPTY: FileShape = { profiles: {}, messages: {}, seen: {} };
const memory = globalThis as typeof globalThis & { __lineWebchat?: FileShape };
let fileQueue: Promise<unknown> = Promise.resolve();

function redisCredentials() {
  const url = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "").replace(
    /\/$/,
    "",
  );
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
  if (!url || !token) return null;
  return { url, token };
}

export function storageMode(): StorageMode {
  if (redisCredentials()) return "redis";
  if (process.env.VERCEL === "1") return "memory";
  return "file";
}

function profileKey(userId: string) {
  return `webchat:profile:${userId}`;
}

function messagesKey(userId: string) {
  return `webchat:msgs:${userId}`;
}

async function redis(command: (string | number)[]) {
  const credentials = redisCredentials();
  if (!credentials) throw new Error("Redis is not configured");
  const response = await fetch(credentials.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  const data = (await response.json()) as { result?: unknown; error?: string };
  if (!response.ok || data.error) {
    throw new Error(data.error || "Redis request failed");
  }
  return data.result;
}

async function redisPipeline(commands: (string | number)[][]) {
  const credentials = redisCredentials();
  if (!credentials) throw new Error("Redis is not configured");
  const response = await fetch(`${credentials.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  const data = (await response.json()) as unknown;
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: string }).error)
        : "Redis pipeline failed";
    throw new Error(message);
  }
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { result?: unknown }).result)
      ? ((data as { result: unknown[] }).result)
      : null;
  if (!rows) throw new Error("Redis pipeline failed");
  return rows.map((row) =>
    row && typeof row === "object" && "result" in row ? (row as { result: unknown }).result : row,
  );
}

function toUser(record: ProfileRecord): ChatUser {
  return {
    userId: record.userId,
    displayName: record.displayName,
    pictureUrl: record.pictureUrl || null,
    statusMessage: record.statusMessage || null,
    lastMessageAt: record.lastMessageAt,
    lastMessageText: record.lastText,
    unreadCount: record.unread,
  };
}

function emptyRecord(userId: string, profile: Profile, timestamp: number): ProfileRecord {
  return {
    userId,
    displayName: profile.displayName,
    pictureUrl: profile.pictureUrl ?? "",
    statusMessage: profile.statusMessage ?? "",
    unread: 0,
    lastText: "",
    lastMessageAt: timestamp,
    replyToken: "",
    replyTokenAt: 0,
  };
}

function hashToRecord(userId: string, hash: unknown): ProfileRecord | null {
  const fields: Record<string, string> = {};
  if (Array.isArray(hash)) {
    for (let index = 0; index < hash.length; index += 2) {
      fields[String(hash[index])] = String(hash[index + 1] ?? "");
    }
  } else if (hash && typeof hash === "object") {
    for (const [key, value] of Object.entries(hash)) fields[key] = String(value ?? "");
  } else {
    return null;
  }
  if (!fields.displayName && !fields.lastMessageAt) return null;
  return {
    userId,
    displayName: fields.displayName || `ผู้ใช้ ${userId.slice(-6)}`,
    pictureUrl: fields.pictureUrl || "",
    statusMessage: fields.statusMessage || "",
    unread: Number(fields.unread || 0),
    lastText: fields.lastText || "",
    lastMessageAt: Number(fields.lastMessageAt || 0),
    replyToken: fields.replyToken || "",
    replyTokenAt: Number(fields.replyTokenAt || 0),
  };
}

function parseMessages(values: unknown): ChatMessage[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    if (typeof value !== "string") return [];
    try {
      const message = JSON.parse(value) as ChatMessage;
      if (!message.id || !message.userId || !message.text) return [];
      return [message];
    } catch {
      return [];
    }
  });
}

async function readFileStore(): Promise<FileShape> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as FileShape;
    return {
      profiles: parsed.profiles ?? {},
      messages: parsed.messages ?? {},
      seen: parsed.seen ?? {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY);
    throw error;
  }
}

function storePath() {
  return path.join(process.cwd(), ".data", "store.json");
}

async function writeFileStore(data: FileShape) {
  const file = storePath();
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(data), "utf8");
  await rename(temp, file);
}

function withFileLock<T>(work: () => Promise<T>) {
  const run = fileQueue.then(work, work);
  fileQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function memoryData() {
  memory.__lineWebchat ??= structuredClone(EMPTY);
  return memory.__lineWebchat;
}

function listFromShape(data: FileShape): Inbox {
  const users = Object.values(data.profiles)
    .map(toUser)
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  const messages: Record<string, ChatMessage[]> = {};
  for (const user of users) {
    messages[user.userId] = data.messages[user.userId] ?? [];
  }
  return { users, messages };
}

function pruneSeen(seen: Record<string, number>, now: number) {
  for (const [id, expiry] of Object.entries(seen)) {
    if (expiry < now) delete seen[id];
  }
}

function applyInbound(data: FileShape, input: InboundInput): "saved" | "duplicate" {
  const now = Date.now();
  pruneSeen(data.seen, now);
  if (data.seen[input.messageId]) return "duplicate";
  data.seen[input.messageId] = now + 7 * 24 * 60 * 60 * 1000;

  const current = data.profiles[input.userId] ?? emptyRecord(input.userId, input.profile, input.timestamp);
  if (!input.profileIsFallback) {
    current.displayName = input.profile.displayName;
    current.pictureUrl = input.profile.pictureUrl ?? "";
    current.statusMessage = input.profile.statusMessage ?? "";
  }
  current.unread += 1;
  current.lastText = input.text;
  current.lastMessageAt = input.timestamp;
  if (input.replyToken) {
    current.replyToken = input.replyToken;
    current.replyTokenAt = now;
  }
  data.profiles[input.userId] = current;

  const message: ChatMessage = {
    id: input.messageId,
    userId: input.userId,
    direction: "in",
    text: input.text,
    timestamp: input.timestamp,
    messageType: input.messageType,
  };
  const thread = data.messages[input.userId] ?? [];
  thread.push(message);
  data.messages[input.userId] = thread.slice(-200);
  return "saved";
}

function applyOutbound(data: FileShape, userId: string, text: string): ChatMessage | null {
  const current = data.profiles[userId];
  if (!current) return null;
  const message: ChatMessage = {
    id: `out-${randomUUID()}`,
    userId,
    direction: "out",
    text,
    timestamp: Date.now(),
    messageType: "text",
  };
  current.lastText = text;
  current.lastMessageAt = message.timestamp;
  current.unread = 0;
  const thread = data.messages[userId] ?? [];
  thread.push(message);
  data.messages[userId] = thread.slice(-200);
  return message;
}

async function listLocal(read: () => Promise<FileShape> | FileShape) {
  return listFromShape(await read());
}

export async function listInbox(): Promise<Inbox> {
  if (storageMode() === "redis") return listRedis();
  if (storageMode() === "memory") return listLocal(() => memoryData());
  return withFileLock(() => listLocal(readFileStore));
}

async function listRedis(): Promise<Inbox> {
  const ids = (await redis(["ZRANGE", "webchat:inbox", "0", "-1"])) as string[] | null;
  const userIds = Array.isArray(ids) ? [...ids].reverse() : [];
  if (userIds.length === 0) return { users: [], messages: {} };

  const results = await redisPipeline(
    userIds.flatMap((userId) => [
      ["HGETALL", profileKey(userId)],
      ["LRANGE", messagesKey(userId), "0", "-1"],
    ]),
  );

  const users: ChatUser[] = [];
  const messages: Record<string, ChatMessage[]> = {};
  userIds.forEach((userId, index) => {
    const record = hashToRecord(userId, results[index * 2]);
    if (!record) return;
    users.push(toUser(record));
    messages[userId] = parseMessages(results[index * 2 + 1]);
  });
  users.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  return { users, messages };
}

export async function hasUser(userId: string) {
  if (storageMode() === "redis") {
    const exists = await redis(["EXISTS", profileKey(userId)]);
    return exists === 1 || exists === "1";
  }
  const data = storageMode() === "memory" ? memoryData() : await readFileStore();
  return Boolean(data.profiles[userId]);
}

export async function saveInbound(input: InboundInput) {
  if (storageMode() === "redis") return saveInboundRedis(input);
  if (storageMode() === "memory") {
    return applyInbound(memoryData(), input);
  }
  return withFileLock(async () => {
    const data = await readFileStore();
    const result = applyInbound(data, input);
    await writeFileStore(data);
    return result;
  });
}

async function saveInboundRedis(input: InboundInput): Promise<"saved" | "duplicate"> {
  const seen = await redis(["SET", `webchat:seen:${input.messageId}`, "1", "NX", "EX", 60 * 60 * 24 * 7]);
  if (seen !== "OK") return "duplicate";
  const now = Date.now();
  try {
    return await writeInboundRedis(input, now);
  } catch (error) {
    await redis(["DEL", `webchat:seen:${input.messageId}`]);
    throw error;
  }
}

async function writeInboundRedis(input: InboundInput, now: number): Promise<"saved"> {
  const message: ChatMessage = {
    id: input.messageId,
    userId: input.userId,
    direction: "in",
    text: input.text,
    timestamp: input.timestamp,
    messageType: input.messageType,
  };
  const exists = await redis(["EXISTS", profileKey(input.userId)]);
  const profileExists = exists === 1 || exists === "1";
  const fields: (string | number)[] = [
    "HSET",
    profileKey(input.userId),
    "userId",
    input.userId,
    "lastText",
    input.text,
    "lastMessageAt",
    String(input.timestamp),
  ];
  if (!input.profileIsFallback || !profileExists) {
    fields.push(
      "displayName",
      input.profile.displayName,
      "pictureUrl",
      input.profile.pictureUrl ?? "",
      "statusMessage",
      input.profile.statusMessage ?? "",
    );
  }
  if (input.replyToken) {
    fields.push("replyToken", input.replyToken, "replyTokenAt", String(now));
  }
  await redis(["RPUSH", messagesKey(input.userId), JSON.stringify(message)]);
  await redis(["LTRIM", messagesKey(input.userId), "-200", "-1"]);
  await redis(fields);
  await redis(["HINCRBY", profileKey(input.userId), "unread", 1]);
  await redis(["ZADD", "webchat:inbox", String(input.timestamp), input.userId]);
  return "saved";
}

export async function saveOutbound(userId: string, text: string) {
  if (storageMode() === "redis") return saveOutboundRedis(userId, text);
  if (storageMode() === "memory") return applyOutbound(memoryData(), userId, text);
  return withFileLock(async () => {
    const data = await readFileStore();
    const message = applyOutbound(data, userId, text);
    if (!message) return null;
    await writeFileStore(data);
    return message;
  });
}

async function saveOutboundRedis(userId: string, text: string) {
  const exists = await redis(["EXISTS", profileKey(userId)]);
  if (exists !== 1 && exists !== "1") return null;
  const message: ChatMessage = {
    id: `out-${randomUUID()}`,
    userId,
    direction: "out",
    text,
    timestamp: Date.now(),
    messageType: "text",
  };
  await redis(["RPUSH", messagesKey(userId), JSON.stringify(message)]);
  await redis(["LTRIM", messagesKey(userId), "-200", "-1"]);
  await redis([
    "HSET",
    profileKey(userId),
    "lastText",
    text,
    "lastMessageAt",
    String(message.timestamp),
    "unread",
    "0",
  ]);
  await redis(["ZADD", "webchat:inbox", String(message.timestamp), userId]);
  return message;
}

export async function markRead(userId: string) {
  if (storageMode() === "redis") {
    const exists = await redis(["EXISTS", profileKey(userId)]);
    if (exists === 1 || exists === "1") {
      await redis(["HSET", profileKey(userId), "unread", "0"]);
    }
    return;
  }
  const update = (data: FileShape) => {
    const record = data.profiles[userId];
    if (record) record.unread = 0;
  };
  if (storageMode() === "memory") {
    update(memoryData());
    return;
  }
  await withFileLock(async () => {
    const data = await readFileStore();
    update(data);
    await writeFileStore(data);
  });
}

export async function getReplyToken(userId: string) {
  const read = (record: ProfileRecord | null) => {
    if (!record?.replyToken) return null;
    return { token: record.replyToken, at: record.replyTokenAt };
  };
  if (storageMode() === "redis") {
    return read(hashToRecord(userId, await redis(["HGETALL", profileKey(userId)])));
  }
  const data = storageMode() === "memory" ? memoryData() : await readFileStore();
  return read(data.profiles[userId] ?? null);
}

export async function clearReplyToken(userId: string, token: string) {
  if (storageMode() === "redis") {
    const current = await redis(["HGET", profileKey(userId), "replyToken"]);
    if (current === token) {
      await redis(["HSET", profileKey(userId), "replyToken", "", "replyTokenAt", "0"]);
    }
    return;
  }
  const update = (data: FileShape) => {
    const record = data.profiles[userId];
    if (record?.replyToken === token) {
      record.replyToken = "";
      record.replyTokenAt = 0;
    }
  };
  if (storageMode() === "memory") {
    update(memoryData());
    return;
  }
  await withFileLock(async () => {
    const data = await readFileStore();
    update(data);
    await writeFileStore(data);
  });
}
