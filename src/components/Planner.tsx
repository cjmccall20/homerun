"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { errorText, pollJob, post } from "@/lib/client";
import type { WeekSummary } from "@/lib/store";
import { WeekPreview } from "@/components/WeekPreview";
import {
  Button,
  Card,
  ErrorNote,
  SectionTitle,
  Textarea,
} from "@/components/ui";

/**
 * The chat planner.
 *
 * Every turn replays the whole conversation to a fresh `claude -p` run: there
 * is no session to keep alive, and the transcript is small enough that
 * replaying it is simpler and more robust than trying to hold a subprocess
 * open between HTTP requests. What Claude actually produces is a file in
 * Weeks/Drafts, not a wall of text; the reply is just the summary.
 */

interface Message {
  role: "user" | "assistant";
  content: string;
}

/**
 * The conversation opens with the question rather than waiting for someone to
 * volunteer the answer. Planning around what is already in the house is the
 * whole cost-and-waste argument for doing this at all, and an empty text box
 * does not ask for it.
 */
const OPENING_QUESTION =
  "Before I plan anything: what is in the fridge, freezer and pantry right now? " +
  "Anything perishable gets used first, so nothing goes to waste. " +
  "A rough list is plenty, and \"not sure\" is a fine answer.";

/** Example answers, not example requests. */
const OPENERS = [
  "Two pounds of ground beef and a bag of spinach in the fridge.",
  "Chicken thighs in the freezer, not much else.",
  "Not sure, just plan something around the usual.",
];

/**
 * The thread survives leaving the page. Planning a week happens in between
 * checking recipes and the grocery list, and coming back to a blank chat threw
 * the whole conversation away. The transcript is small, so localStorage holds
 * it until someone deliberately starts a new week.
 */
const STORAGE_KEY = "homerun-planner-thread";

function loadThread(): Message[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 2) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function Planner({ drafts }: { drafts: WeekSummary[] }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: OPENING_QUESTION },
  ]);

  /*
   * Restoring the saved thread has to happen after mount, not during render.
   * localStorage does not exist on the server, so seeding it as initial state
   * would make the server render the opening question and the client render
   * the saved conversation, which is a hydration mismatch. Reading it in an
   * effect is the hydration-safe pattern, and the one render it costs is
   * invisible.
   */
  useEffect(() => {
    const saved = loadThread();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setMessages(saved);
  }, []);

  useEffect(() => {
    if (messages.length > 1) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    }
  }, [messages]);

  function startFresh() {
    localStorage.removeItem(STORAGE_KEY);
    setMessages([{ role: "assistant", content: OPENING_QUESTION }]);
    setError("");
    setStatus("");
  }
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;

    const history: Message[] = [...messages, { role: "user", content }];
    setMessages(history);
    setDraft("");
    setBusy(true);
    setError("");
    setStatus("Reading the vault: staples, ratings, and the last few weeks.");

    try {
      const { jobId } = await post<{ jobId: string }>("/api/claude", {
        kind: "plan",
        messages: history,
      });
      const reply = await pollJob(jobId, setStatus);
      setMessages([...history, { role: "assistant", content: reply }]);
      setStatus("");
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
      <div className="mb-2">
        <Link href="/week" className="inline-block min-h-12 py-3 text-sm text-ink-soft">
          Back to the week
        </Link>
      </div>

      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Plan the week</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          Starts with what is already in the house so it gets used first. The
          proposal lands in Drafts, and you make it live from the Week tab.
        </p>
        {messages.length > 1 ? (
          <button
            onClick={startFresh}
            disabled={busy}
            className="mt-2 min-h-12 rounded-xl border border-line px-3 py-2 text-sm text-ink-soft active:bg-surface-2 disabled:opacity-50"
          >
            Start a new week
          </button>
        ) : null}
      </header>

      {drafts.length > 0 ? (
        <section className="mb-4">
          <SectionTitle>Waiting in drafts</SectionTitle>
          <ul className="space-y-2">
            {drafts.map((d) => (
              <li key={d.name}>
                <Card className="px-4 py-3">
                  <p className="text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-ink-faint">
                    {d.filled} meals planned. Ask for changes below, or open the
                    Week tab and tap Manage to make it live.
                  </p>
                  <WeekPreview table={d.table} />
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex-1 space-y-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={m.role === "user" ? "flex justify-end" : "flex"}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[0.95rem] leading-relaxed ${
                m.role === "user"
                  ? "bg-accent text-accent-ink"
                  : "border border-line bg-surface"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {messages.length === 1 ? (
          <Card className="px-4 py-4">
            <p className="text-sm text-ink-soft">
              Whatever is already in the house anchors the first few days, so
              the perishables get eaten and the grocery bill shrinks. After
              that, Claude fills the week from your recipes, ratings, comments,
              dietary principles and the last few archived weeks, so you do not
              get the same dinner twice.
            </p>
            <p className="mt-3 text-xs font-medium text-ink-faint">
              For example:
            </p>
            <div className="mt-2 space-y-2">
              {OPENERS.map((opener) => (
                <button
                  key={opener}
                  onClick={() => send(opener)}
                  disabled={busy}
                  className="w-full rounded-xl border border-line px-3 py-3 text-left text-sm active:bg-surface-2 disabled:opacity-50"
                >
                  {opener}
                </button>
              ))}
            </div>
          </Card>
        ) : null}

        {status ? (
          <div className="flex">
            <div className="max-w-[85%] rounded-2xl border border-dashed border-line px-4 py-3 text-sm text-ink-faint">
              {status}
            </div>
          </div>
        ) : null}

        <ErrorNote>{error}</ErrorNote>
        <div ref={bottom} />
      </div>

      <div className="sticky bottom-24 mt-4 space-y-2 bg-canvas pt-2">
        <Textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Two pounds of ground beef in the fridge, and Thursday is soccer."
          aria-label="Message"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send(draft);
            }
          }}
        />
        <Button
          variant="primary"
          className="w-full"
          disabled={busy || draft.trim() === ""}
          onClick={() => send(draft)}
        >
          {busy ? "Thinking" : "Send"}
        </Button>
      </div>
    </div>
  );
}
