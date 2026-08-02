"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { errorText, get, post } from "@/lib/client";
import type { ThreadEntry } from "@/lib/threads";
import { Button, Card, ErrorNote, Textarea } from "@/components/ui";

/**
 * The week's grocery conversation.
 *
 * You say something in plain English about the shopping and Claude changes the
 * household's stored preferences to match, then replies here saying what it
 * changed. "We only get butter from Costco" becomes a rule that keeps butter
 * out of the Publix cart and shows it already ticked on the list.
 *
 * The thread lives in the vault as a markdown file, one line per turn, so the
 * conversation is still there in six months when somebody wonders why butter
 * is never on the order.
 */

const POLL_MS = 4000;

export function GroceryThread({
  week,
  entries: initial,
  me,
}: {
  week: string;
  entries: ThreadEntry[];
  me: string;
}) {
  const [entries, setEntries] = useState(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * When the server hands down a newer thread (a refresh, or switching weeks),
   * adopt it. Adjusting state during render is React's documented way to do
   * this; syncing it in an effect costs an extra render and trips the
   * cascading-render rule.
   */
  const [lastFromServer, setLastFromServer] = useState(initial);
  if (initial !== lastFromServer) {
    setLastFromServer(initial);
    setEntries(initial);
  }

  const refresh = useCallback(async () => {
    try {
      const data = await get<{ entries: ThreadEntry[] }>(
        `/api/grocery/thread?week=${encodeURIComponent(week)}`
      );
      setEntries(data.entries);
      // Claude has replied once the last word is its own.
      const last = data.entries[data.entries.length - 1];
      if (last && last.author.toLowerCase() === "claude") setWaiting(false);
    } catch {
      // A failed poll is not worth a message.
    }
  }, [week]);

  useEffect(() => {
    if (!waiting) return;
    timer.current = setTimeout(() => void refresh(), POLL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [waiting, entries, refresh]);

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError("");
    try {
      await post("/api/grocery/thread", { week, text: body });
      setText("");
      setWaiting(true);
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">
        Notes on this week&apos;s shopping
      </h2>

      <Card className="px-4 py-4">
        {entries.length === 0 ? (
          <p className="text-sm text-ink-soft">
            Anything you say here changes how the lists get built. Tell it what
            annoyed you, what to buy elsewhere, what to stop buying. It updates
            your preferences and says what it changed.
          </p>
        ) : (
          <ul className="space-y-3">
            {entries.map((entry, i) => {
              const fromClaude = entry.author.toLowerCase() === "claude";
              return (
                <li
                  key={`${entry.line}-${i}`}
                  className={fromClaude ? "border-l-2 border-accent pl-3" : ""}
                >
                  <p className="text-xs text-ink-faint">
                    {entry.author}, {entry.date}
                    {entry.awaitingAnswer ? " - waiting on you" : ""}
                  </p>
                  <p
                    className={`text-[0.95rem] ${
                      entry.awaitingAnswer ? "font-medium" : ""
                    }`}
                  >
                    {entry.text}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {waiting ? (
          <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-faint">
            Reading that and updating your preferences.
          </p>
        ) : null}

        <ErrorNote>{error}</ErrorNote>

        <div className="mt-4 space-y-2">
          <Textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="We only get butter from Costco"
            aria-label="Add a note about this week's shopping"
          />
          <Button
            variant="primary"
            className="w-full"
            disabled={busy || text.trim() === ""}
            onClick={send}
          >
            {busy ? "Sending" : `Send as ${me}`}
          </Button>
        </div>
      </Card>
    </section>
  );
}
