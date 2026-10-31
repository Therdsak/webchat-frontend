import { authMode } from "@/lib/auth";
import { json } from "@/lib/http";
import { lineStatus } from "@/lib/line";
import { storageMode } from "@/lib/store";
import type { AppStatus } from "@/lib/types";

export async function GET(request: Request) {
  void request.headers.get("cookie");
  const line = lineStatus();
  const status: AppStatus = {
    lineConfigured: line.lineConfigured,
    testMode: line.testMode,
    canSend: line.canSend,
    storage: storageMode(),
    auth: authMode(),
    webhookPath: "/api/line/webhook",
  };
  return json(status);
}
