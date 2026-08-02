"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { errorText, pollJob, post } from "@/lib/client";
import type { OrderJob } from "@/lib/orders";
import type { WeekOption } from "@/lib/store";
import type { ThreadEntry } from "@/lib/threads";
import { GroceryThread } from "@/components/GroceryThread";
import type { GroceryList } from "@/lib/parse/grocery";
import { OrderPickup } from "@/components/OrderPickup";
import { PageHeader } from "@/components/PageHeader";
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Input,
  Sheet,
} from "@/components/ui";

/**
 * The shopping list.
 *
 * Checking a box writes one character back to Grocery-List.md immediately.
 * The checkbox flips optimistically first: standing in an aisle waiting for a
 * server round trip before the tick appears is the fastest way to make someone
 * tap twice and lose their place.
 */

export function GroceryScreen({
  list,
  plain,
  order,
  weeks,
  viewing,
  isCurrent,
  thread,
  me,
  missingSnapshot,
}: {
  list: GroceryList;
  plain: string;
  order: OrderJob | null;
  weeks: WeekOption[];
  viewing: string;
  isCurrent: boolean;
  thread: ThreadEntry[];
  me: string;
  missingSnapshot: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [item, setItem] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function toggle(line: number, checked: boolean) {
    setPending((p) => ({ ...p, [line]: checked }));
    setError("");
    try {
      await post("/api/grocery", { action: "check", line, checked });
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      setPending((p) => {
        const next = { ...p };
        delete next[line];
        return next;
      });
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("The browser would not let us copy. Long-press the list instead.");
    }
  }

  const remaining = list.total - list.checked;

  return (
    <>
      <PageHeader
        title="Grocery"
        subtitle={
          list.total === 0
            ? "Nothing on the list yet"
            : `${remaining} left of ${list.total}${
                list.generatedOn ? `, built ${list.generatedOn}` : ""
              }`
        }
      />

      {weeks.length > 1 ? (
        <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {weeks.map((w) => (
            <Link
              key={w.weekOf}
              href={w.current ? "/grocery" : `/grocery?week=${w.weekOf}`}
              className={`flex min-h-10 shrink-0 items-center rounded-full border px-3.5 text-sm font-medium ${
                w.weekOf === viewing
                  ? "border-transparent bg-accent text-accent-ink"
                  : "border-line bg-surface text-ink-soft"
              }`}
            >
              {w.current ? "This week" : w.weekOf}
            </Link>
          ))}
        </div>
      ) : null}

      {missingSnapshot ? (
        <Empty>
          No list was saved for that week. The thread below is still here.
        </Empty>
      ) : null}

      {isCurrent ? (
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => setGenerateOpen(true)}
        >
          Generate
        </Button>
        <Button disabled={busy || list.total === 0} onClick={copy}>
          {copied ? "Copied" : "Copy as text"}
        </Button>
        <Button disabled={busy} onClick={() => setAddOpen(true)}>
          Add an item
        </Button>
        <Button
          disabled={busy || list.checked === 0}
          onClick={() => run(() => post("/api/grocery", { action: "uncheck-all" }))}
        >
          Uncheck all
        </Button>
      </div>
      ) : null}

      <ErrorNote>{error}</ErrorNote>

      {list.total === 0 ? (
        <Empty>
          Plan the week first, then tap Generate. Claude reads the meals, skips
          anything already stocked, and writes the list grouped by aisle.
        </Empty>
      ) : (
        <div className="space-y-4">
          {list.categories
            .filter((c) => c.items.length > 0)
            .map((category) => (
              <section key={category.name}>
                <h2 className="px-1 pb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">
                  {category.name}
                </h2>
                <Card className="overflow-hidden">
                  <ul>
                    {category.items.map((groceryItem) => {
                      const checked =
                        pending[groceryItem.line] ?? groceryItem.checked;
                      return (
                        <li
                          key={groceryItem.line}
                          className="border-b border-line last:border-0"
                        >
                          <button
                            onClick={() =>
                              isCurrent && toggle(groceryItem.line, !checked)
                            }
                            aria-pressed={checked}
                            disabled={!isCurrent}
                            className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left active:bg-surface-2 disabled:active:bg-transparent"
                          >
                            <span
                              aria-hidden
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-sm ${
                                checked
                                  ? "border-transparent bg-accent text-accent-ink"
                                  : "border-line"
                              }`}
                            >
                              {checked ? "✓" : ""}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                {groceryItem.sources.length > 0 ? (
                                  <DayBadge
                                    days={groceryItem.sources.map((s) => s.day)}
                                  />
                                ) : null}
                                <span
                                  className={
                                    checked ? "text-ink-faint line-through" : ""
                                  }
                                >
                                  {groceryItem.text}
                                </span>
                                {groceryItem.store ? (
                                  <span className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[0.7rem] font-semibold text-ink-soft">
                                    {groceryItem.store}
                                  </span>
                                ) : null}
                              </span>
                              {groceryItem.sources.length > 0 ? (
                                <span className="mt-0.5 block truncate text-xs text-ink-faint">
                                  {groceryItem.sources
                                    .map((s) => s.recipe)
                                    .join(", ")}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </section>
            ))}
        </div>
      )}

      {isCurrent ? (
        <OrderPickup remaining={remaining} initialJob={order} />
      ) : null}

      <GroceryThread week={viewing} entries={thread} me={me} />

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Add an item">
        <p className="text-sm text-ink-soft">
          Manual adds go under Extras, so a regenerate does not wipe them out.
        </p>
        <Input
          autoFocus
          value={item}
          onChange={(e) => setItem(e.target.value)}
          placeholder="Paper towels"
          onKeyDown={(e) => {
            if (e.key !== "Enter" || item.trim() === "") return;
            void run(async () => {
              await post("/api/grocery", { action: "add", item });
              setItem("");
              setAddOpen(false);
            });
          }}
        />
        <Button
          variant="primary"
          className="w-full"
          disabled={busy || item.trim() === ""}
          onClick={() =>
            run(async () => {
              await post("/api/grocery", { action: "add", item });
              setItem("");
              setAddOpen(false);
            })
          }
        >
          Add it
        </Button>
      </Sheet>

      <GenerateSheet
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onDone={() => router.refresh()}
      />
    </>
  );
}

/**
 * Which night an item is for.
 *
 * A letter rather than a word: at forty items a column of day names is a wall
 * of text, and the whole value here is being able to skim for "the Thursday
 * stuff" while standing in an aisle. The recipe name sits underneath in small
 * text for when the letter is not enough.
 */
function DayBadge({ days }: { days: string[] }) {
  const unique = [...new Set(days)];
  return (
    <span
      aria-label={`For ${unique.join(" and ")}`}
      className="flex shrink-0 items-center gap-1"
    >
      {unique.map((day) => (
        <span
          key={day}
          className="min-w-6 rounded-md bg-surface-2 px-1.5 py-0.5 text-center text-[0.7rem] font-semibold text-ink-soft"
        >
          {day}
        </span>
      ))}
    </span>
  );
}

function GenerateSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    setStatus("Reading the week's meals and every recipe they link to.");
    try {
      const { jobId } = await post<{ jobId: string }>("/api/claude", {
        kind: "grocery",
        notes: notes.trim(),
      });
      const text = await pollJob(jobId, setStatus);
      setStatus(text);
      onDone();
    } catch (err) {
      setError(errorText(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Generate the list">
      <p className="text-sm text-ink-soft">
        Builds the list from this week&apos;s meals, drops anything in your
        staples, and uses your brand preferences. Existing Extras are kept.
      </p>
      <Input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything to add or skip?"
        aria-label="Extra instructions"
      />
      <ErrorNote>{error}</ErrorNote>
      {status ? (
        <p className="whitespace-pre-wrap rounded-xl bg-surface-2 px-3 py-3 text-sm text-ink-soft">
          {status}
        </p>
      ) : null}
      <Button
        variant="primary"
        className="w-full"
        disabled={busy}
        onClick={submit}
      >
        {busy ? "Working" : "Build the list"}
      </Button>
    </Sheet>
  );
}
