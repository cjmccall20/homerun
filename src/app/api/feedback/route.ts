import { body, fail, handle, ok, str } from "@/lib/api";
import { createRequest, isStalled, listRequests } from "@/lib/feedback";
import { currentWho } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The suggestion box.
 *
 * Writing the file is all this does. A launchd agent notices it and hands it
 * to a Claude session that can change the app; nothing here waits for that.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const payload = await body<Record<string, unknown>>(request);
    const text = str(payload.text ?? "", "text");
    if (text.trim() === "") return fail("Write what you would like changed first.");

    const who = await currentWho();
    const created = await createRequest(who, text);
    return ok({ ok: true, request: created });
  });
}

export async function GET() {
  return handle(async () => {
    const requests = await listRequests();
    return ok({
      requests: requests.map((r) => ({ ...r, stalled: isStalled(r) })),
    });
  });
}
