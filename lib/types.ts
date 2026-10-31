export type StorageMode = "redis" | "file" | "memory";

export type AuthMode = "open" | "login" | "missing-password";

export type ChatUser = {
  userId: string;
  displayName: string;
  pictureUrl: string | null;
  statusMessage: string | null;
  lastMessageAt: number;
  lastMessageText: string;
  unreadCount: number;
};

export type ChatMessage = {
  id: string;
  userId: string;
  direction: "in" | "out";
  text: string;
  timestamp: number;
  messageType: string;
};

export type Inbox = {
  users: ChatUser[];
  messages: Record<string, ChatMessage[]>;
};

export type Profile = {
  displayName: string;
  pictureUrl: string | null;
  statusMessage: string | null;
};

export type AppStatus = {
  lineConfigured: boolean;
  testMode: boolean;
  canSend: boolean;
  storage: StorageMode;
  auth: AuthMode;
  webhookPath: string;
};
