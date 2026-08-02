import { promises as fs } from "node:fs";
import path from "node:path";

import { body, fail, handle, ok } from "@/lib/api";
import { startJob, type ChatMessage } from "@/lib/claude";
import { readFileOr } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Asking how to use the app.
 *
 * The reference material is read HERE and handed to the job inside its prompt,
 * so the job itself needs no file access at all. A question box anybody can
 * type into freely should reach as little of the machine as possible.
 */
async function reference(): Promise<string> {
  const guide = await readFileOr("", "HomeRun-Guide.md");
  let forDoc = "";
  try {
    forDoc = await fs.readFile(path.join(process.cwd(), "FORHomeRun.md"), "utf8");
  } catch {
    forDoc = "";
  }
  // The FOR doc is written for engineers and is long; the guide is the part
  // written for the people actually using the app, so it leads.
  return [
    guide ? `# How to use HomeRun\n\n${guide}` : "",
    forDoc ? `# How HomeRun works underneath\n\n${forDoc.slice(0, 16000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function POST(request: Request) {
  return handle(async () => {
    const payload = await body<Record<string, unknown>>(request);
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
    if (messages.length === 0) return fail("Ask a question first.");

    const job = await startJob("help", { messages, reference: await reference() });
    return ok({ jobId: job.id, status: job.status });
  });
}
