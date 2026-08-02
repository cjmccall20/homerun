import type { NextRequest } from "next/server";

import { body, fail, handle, ok, str } from "@/lib/api";
import { startJob } from "@/lib/claude";
import { appendToThread, readThread } from "@/lib/store";
import { currentWho } from "@/lib/session";
import { renderTranscript } from "@/lib/threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  return handle(async () => {
    const week = request.nextUrl.searchParams.get("week") ?? "";
    if (!WEEK_RE.test(week)) return fail("That is not a week.");
    return ok({ week, entries: await readThread(week) });
  });
}

/**
 * Posting to a thread does two things: records what was said, and asks Claude
 * to make the household's stored preferences match it.
 *
 * The user's line is written FIRST, before the job starts. If the job dies the
 * thread still has what they said, and a lost note is worse than a lost update.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const payload = await body<Record<string, unknown>>(request);
    const week = str(payload.week ?? "", "week");
    const text = str(payload.text ?? "", "text").trim();
    if (!WEEK_RE.test(week)) return fail("That is not a week.");
    if (!text) return fail("Write something first.");

    const who = await currentWho();
    const line = await appendToThread(week, who, text);

    const job = await startJob("grocery-learn", {
      weekOf: week,
      transcript: renderTranscript(await readThread(week)),
    });

    return ok({ ok: true, line, jobId: job.id });
  });
}
