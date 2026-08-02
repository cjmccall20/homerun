import { promises as fs } from "node:fs";
import path from "node:path";

import type { NextRequest } from "next/server";

import { fail, handle, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The live ticker for a running order.
 *
 * The shopper appends one JSON line per decision to a sidecar beside its job
 * file. This reads it. A partially written last line is normal at this
 * frequency and is simply skipped, because a malformed tail must not blank the
 * ticker somebody is watching.
 */
export async function GET(request: NextRequest) {
  return handle(async () => {
    const id = request.nextUrl.searchParams.get("id") ?? "";
    if (!/^[a-f0-9-]{36}$/i.test(id)) return fail("That is not an order id.");

    const file = path.join(
      process.cwd(),
      "jobs",
      "orders",
      `${id}.json.progress.jsonl`
    );

    let raw = "";
    try {
      raw = await fs.readFile(file, "utf8");
    } catch {
      return ok({ entries: [], added: 0, skipped: 0 });
    }

    const entries: {
      item: string;
      outcome: string;
      product?: string;
      why?: string;
      at?: string;
    }[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (typeof row?.item === "string") entries.push(row);
      } catch {
        // The shopper is appending as it goes; the last line may be half
        // written. Skip it and it will be complete on the next poll.
      }
    }

    return ok({
      entries,
      added: entries.filter((e) => e.outcome === "added").length,
      skipped: entries.filter((e) => e.outcome === "skipped").length,
    });
  });
}
