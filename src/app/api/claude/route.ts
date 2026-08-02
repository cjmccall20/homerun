import type { NextRequest } from "next/server";

import { body, fail, handle, ok, str } from "@/lib/api";
import { readJob, startJob, type ChatMessage, type JobKind } from "@/lib/claude";
import { snapshotGroceryList } from "@/lib/store";

export const runtime = "nodejs";
/** Spawning a subprocess is never cacheable. */
export const dynamic = "force-dynamic";

const KINDS: JobKind[] = ["plan", "import", "grocery"];

export async function POST(request: Request) {
  return handle(async () => {
    const payload = await body<Record<string, unknown>>(request);
    const kind = str(payload.kind ?? "", "kind") as JobKind;
    if (!KINDS.includes(kind)) return fail(`Unknown kind: ${kind}`);

    const raw = payload.messages;
    const messages: ChatMessage[] = Array.isArray(raw)
      ? raw
          .map((m) => m as Record<string, unknown>)
          .filter((m) => typeof m.content === "string" && m.content !== "")
          .map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: String(m.content),
          }))
      : [];

    if (kind === "plan" && messages.length === 0) {
      return fail("Say what you want planned first.");
    }
    const uploadId =
      payload.uploadId === undefined ? undefined : str(payload.uploadId, "uploadId");
    if (uploadId !== undefined && !/^[a-f0-9-]{36}$/i.test(uploadId)) {
      return fail("That is not an upload id.");
    }
    if (kind === "import" && !payload.url && !uploadId) {
      return fail("Paste a link or add a photo of the recipe.");
    }

    // Generating overwrites Grocery-List.md, so the outgoing list is filed
    // under its own week first. Otherwise the only record of what was actually
    // bought disappears the moment the next week is planned.
    if (kind === "grocery") await snapshotGroceryList();

    const job = await startJob(kind, {
      messages,
      url: payload.url === undefined ? undefined : str(payload.url, "url"),
      notes: payload.notes === undefined ? undefined : str(payload.notes, "notes"),
      uploadId,
    });
    return ok({ jobId: job.id, status: job.status });
  });
}

export async function GET(request: NextRequest) {
  return handle(async () => {
    const id = request.nextUrl.searchParams.get("jobId");
    if (!id) return fail("A jobId is required.");
    const job = await readJob(id);
    if (!job) return fail("No such job.", 404);
    return ok({ job });
  });
}
