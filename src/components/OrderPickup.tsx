"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { errorText, get, post } from "@/lib/client";
import type { OrderJob } from "@/lib/orders";
import { Button, Card, ErrorNote } from "@/components/ui";

/**
 * Order pickup.
 *
 * Tapping the button writes a job file; a launchd agent on the Mac wakes up,
 * drives a logged-in Chrome, and fills the Publix cart. This card polls the
 * job and reports what actually happened.
 *
 * It is careful to say "cart built", never "order placed". Nothing here can
 * spend money: a human opens the Publix app and places the order themselves,
 * and the copy has to keep that obvious or somebody will assume the groceries
 * are on their way when they are still sitting in a cart.
 */

const POLL_MS = 4000;

export function OrderPickup({
  remaining,
  initialJob,
}: {
  remaining: number;
  initialJob: OrderJob | null;
}) {
  const [job, setJob] = useState<OrderJob | null>(initialJob);
  const [progress, setProgress] = useState<ProgressEntry[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const active = job?.status === "pending" || job?.status === "building";

  const poll = useCallback(async () => {
    try {
      const data = await get<{ job: OrderJob | null; stalled?: boolean }>(
        "/api/orders"
      );
      setJob(data.job);
      if (data.job && (data.job.status === "building" || data.job.status === "pending")) {
        try {
          const live = await get<{ entries: ProgressEntry[] }>(
            `/api/orders/progress?id=${encodeURIComponent(data.job.id)}`
          );
          setProgress(live.entries);
        } catch {
          // The sidecar may not exist for the first few seconds.
        }
      }
      if (data.stalled && data.job) {
        setError(
          "That order has been running for a long time with no result. Check that the dedicated Chrome is still open on the Mac."
        );
      }
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    timer.current = setTimeout(() => void poll(), POLL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active, job, poll]);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const data = await post<{ job: OrderJob }>("/api/orders", {});
      setJob(data.job);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6">
      <Card className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Order pickup</p>
            <p className="mt-0.5 text-xs text-ink-faint">
              Builds the Publix cart on the Mac using your brand preferences.
              You review it and place the order in the Publix app.
            </p>
          </div>
          <Button
            variant="primary"
            className="shrink-0 px-4"
            disabled={busy || active || remaining === 0}
            onClick={start}
          >
            {busy ? "Starting" : active ? "Building" : "Build cart"}
          </Button>
        </div>

        {remaining === 0 && !job ? (
          <p className="mt-3 text-xs text-ink-faint">
            Nothing unchecked on the list to order.
          </p>
        ) : null}

        <ErrorNote>{error}</ErrorNote>

        {job ? <OrderStatus job={job} progress={progress} /> : null}
      </Card>
    </section>
  );
}

export interface ProgressEntry {
  item: string;
  outcome: string;
  product?: string;
  why?: string;
  at?: string;
}

/**
 * The live ticker.
 *
 * Six minutes of spinner is six minutes of wondering whether it hung. The
 * shopper writes a line per decision as it goes, so this shows the bar filling
 * and the last few things it actually did, including the ones it skipped and
 * why. Watching it work is also how you catch it doing something daft early.
 */
function LiveTicker({
  progress,
  total,
}: {
  progress: ProgressEntry[];
  total: number;
}) {
  const done = progress.length;
  const added = progress.filter((e) => e.outcome === "added").length;
  const skipped = done - added;
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const recent = progress.slice(-4).reverse();

  return (
    <div className="mt-3">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-ink-faint">
        {done} of {total} decided
        {added > 0 ? `, ${added} in the cart` : ""}
        {skipped > 0 ? `, ${skipped} left for you` : ""}
      </p>

      {recent.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {recent.map((entry, i) => (
            <li key={`${entry.at ?? ""}-${i}`} className="flex gap-2 text-xs">
              <span
                aria-hidden
                className={
                  entry.outcome === "added" ? "text-accent" : "text-ink-faint"
                }
              >
                {entry.outcome === "added" ? "+" : "-"}
              </span>
              <span className="min-w-0">
                <span className="block truncate">
                  {entry.product || entry.item}
                </span>
                {entry.why ? (
                  <span className="block truncate text-ink-faint">
                    {entry.why}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function OrderStatus({
  job,
  progress,
}: {
  job: OrderJob;
  progress: ProgressEntry[];
}) {
  if (job.status === "pending" || job.status === "building") {
    return (
      <div className="mt-4 rounded-xl bg-surface-2 px-3 py-3">
        <p className="text-sm font-medium">
          {job.status === "pending" ? "Waiting to start" : "Filling the cart"}
        </p>
        <p className="mt-0.5 text-xs text-ink-faint">
          {job.source.itemCount} item{job.source.itemCount === 1 ? "" : "s"} to
          shop for. You can leave this screen.
        </p>
        <LiveTicker progress={progress} total={job.source.itemCount} />
      </div>
    );
  }

  if (job.status === "failed") {
    return (
      <div className="mt-4 rounded-xl border border-danger/40 px-3 py-3">
        <p className="text-sm font-medium text-danger">Could not build the cart</p>
        <p className="mt-1 whitespace-pre-wrap text-xs text-ink-soft">
          {job.error || "No reason was recorded."}
        </p>
      </div>
    );
  }

  const result = job.result ?? {};
  const added = result.added ?? [];
  const skipped = result.skipped ?? [];
  const substitutions = result.substitutions ?? [];

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-xl bg-accent-soft px-3 py-3">
        <p className="text-sm font-medium text-accent">Cart is ready to review</p>
        <p className="mt-0.5 text-xs text-ink-soft">
          {added.length} item{added.length === 1 ? "" : "s"} added
          {result.cartTotal ? `, cart total ${result.cartTotal}` : ""}
          {skipped.length > 0
            ? `, ${skipped.length} left for you`
            : ""}
          .
        </p>
        <p className="mt-2 text-xs font-medium text-ink-soft">
          Open the Publix app to check it over and place the order. Nothing has
          been ordered yet.
        </p>
      </div>

      {substitutions.length > 0 ? (
        <div>
          <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Swapped
          </p>
          <ul className="space-y-1.5">
            {substitutions.map((s, i) => (
              <li key={i} className="rounded-xl bg-surface-2 px-3 py-2">
                <p className="text-sm">
                  {s.requested} to {s.chose}
                </p>
                <p className="text-xs text-ink-faint">{s.why}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {skipped.length > 0 ? (
        <div>
          <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Left for you
          </p>
          <ul className="space-y-1.5">
            {skipped.map((s, i) => (
              <li key={i} className="rounded-xl bg-surface-2 px-3 py-2">
                <p className="text-sm">{s.requested}</p>
                <p className="text-xs text-ink-faint">{s.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {added.length > 0 ? (
        <details className="rounded-xl border border-line px-3 py-2">
          <summary className="min-h-10 cursor-pointer list-none py-2 text-sm font-medium">
            What went in the cart ({added.length})
          </summary>
          <ul className="space-y-2 pb-2">
            {added.map((a, i) => (
              <li key={i}>
                <p className="text-sm">
                  {a.product}
                  {a.size ? ` (${a.size})` : ""}
                  {a.price ? ` - ${a.price}` : ""}
                </p>
                <p className="text-xs text-ink-faint">
                  for {a.requested}
                  {a.badges && a.badges.length > 0
                    ? ` - ${a.badges.join(", ")}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {result.notes ? (
        <p className="px-1 text-xs text-ink-faint">{result.notes}</p>
      ) : null}
    </div>
  );
}
