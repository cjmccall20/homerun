import type { NextRequest } from "next/server";

import { body, fail, handle, ok, str } from "@/lib/api";
import { createOrder, isStalled, latestOrder, readOrder } from "@/lib/orders";
import { readGrocery } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starting a pickup order writes a job file. The launchd watcher in
 * ~/Tools/homerun-orders picks it up from there; this route never touches a
 * browser and never waits for one.
 */
export async function POST(request: Request) {
  return handle(async () => {
    // A bare tap sends no body, which is fine; notes are optional.
    const payload: Record<string, unknown> = await body<Record<string, unknown>>(
      request
    ).catch(() => ({}));

    const running = await latestOrder();
    if (running && !isStalled(running) && (running.status === "pending" || running.status === "building")) {
      return fail(
        "An order is already being built. Wait for it to finish before starting another.",
        409
      );
    }

    /*
     * The snapshot is taken here, on the server, from the file itself. Sending
     * the list up from the phone would let a stale screen order last week's
     * groceries.
     */
    const list = await readGrocery();
    const items = list.categories.flatMap((category) =>
      category.items
        .filter((item) => !item.checked)
        .map((item) => ({ text: item.text, category: category.name }))
    );

    if (items.length === 0) {
      return fail(
        "Everything on the list is already checked off, so there is nothing to order.",
        400
      );
    }

    const note = payload.notes === undefined ? "" : str(payload.notes, "notes");
    const job = await createOrder(items, list.generatedOn || "");
    return ok({ ok: true, job, note });
  });
}

export async function GET(request: NextRequest) {
  return handle(async () => {
    const id = request.nextUrl.searchParams.get("id");
    const job = id ? await readOrder(id) : await latestOrder();
    if (!job) return ok({ job: null });
    return ok({ job, stalled: isStalled(job) });
  });
}
