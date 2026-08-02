"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { errorText, post } from "@/lib/client";
import { fromISO, toISO } from "@/lib/dates";
import { PEOPLE } from "@/lib/people";
import type { GoalsByPerson } from "@/lib/goals";
import { PageHeader } from "@/components/PageHeader";
import { Button, Card, Empty, ErrorNote, Input, SectionTitle } from "@/components/ui";

/**
 * Today's goals.
 *
 * One card per person, one checkbox per goal, and a date rail so tomorrow can
 * be planned tonight. The signed-in person's card comes first because their
 * thumb is the one on the screen, but both are always visible: the point of
 * the page is knowing what the other one is trying to get done today.
 */

export function GoalsScreen({
  date,
  today,
  goals,
  me,
}: {
  date: string;
  today: string;
  goals: GoalsByPerson;
  me: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const people = [...PEOPLE].sort((a, b) =>
    a === me ? -1 : b === me ? 1 : 0
  );

  function shift(days: number): string {
    const d = fromISO(date) ?? new Date();
    d.setDate(d.getDate() + days);
    return toISO(d);
  }

  async function act(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await post("/api/goals", { date, ...payload });
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const label =
    date === today
      ? "Today"
      : date === shiftFrom(today, 1)
        ? "Tomorrow"
        : date === shiftFrom(today, -1)
          ? "Yesterday"
          : longLabel(date);

  return (
    <>
      <PageHeader title="Goals" subtitle="What would make it a good day" />

      <div className="mb-4 flex items-center justify-between gap-2">
        <Button onClick={() => router.push(`/goals?date=${shift(-1)}`)}>
          Prev
        </Button>
        <div className="text-center">
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-xs text-ink-faint">{date}</p>
        </div>
        <Button onClick={() => router.push(`/goals?date=${shift(1)}`)}>
          Next
        </Button>
      </div>

      {date !== today ? (
        <p className="mb-4 text-center">
          <button
            type="button"
            className="text-sm text-accent underline underline-offset-2"
            onClick={() => router.push("/goals")}
          >
            Back to today
          </button>
        </p>
      ) : null}

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {people.map((person) => {
        const list = goals[person] ?? [];
        const done = list.filter((g) => g.done).length;
        return (
          <Card key={person} className="mb-4">
            <div className="flex items-baseline justify-between">
              <SectionTitle>{person}</SectionTitle>
              {list.length > 0 ? (
                <span className="text-xs text-ink-faint">
                  {done}/{list.length} done
                </span>
              ) : null}
            </div>

            {list.length === 0 ? (
              <Empty>Nothing planned yet.</Empty>
            ) : (
              <ul className="mt-2 space-y-1">
                {list.map((goal, index) => (
                  <li key={`${index}-${goal.text}`}>
                    <div className="group flex items-center gap-3 py-1.5">
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={
                          goal.done ? "Mark not done" : "Mark done"
                        }
                        onClick={() =>
                          act({
                            action: "toggle",
                            person,
                            index,
                            done: !goal.done,
                          })
                        }
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-sm ${
                          goal.done
                            ? "border-transparent bg-accent text-accent-ink"
                            : "border-line"
                        }`}
                      >
                        {goal.done ? "✓" : ""}
                      </button>
                      <span
                        className={`min-w-0 flex-1 text-[0.95rem] ${
                          goal.done ? "text-ink-faint line-through" : ""
                        }`}
                      >
                        {goal.text}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label="Remove goal"
                        onClick={() => act({ action: "remove", person, index })}
                        className="shrink-0 px-1 text-ink-faint opacity-60 transition group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const text = (drafts[person] ?? "").trim();
                if (!text) return;
                setDrafts((d) => ({ ...d, [person]: "" }));
                void act({ action: "add", person, text });
              }}
            >
              <Input
                value={drafts[person] ?? ""}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [person]: e.target.value }))
                }
                placeholder={`Add a goal for ${person}`}
                aria-label={`Add a goal for ${person}`}
              />
              <Button type="submit" disabled={busy}>
                Add
              </Button>
            </form>
          </Card>
        );
      })}
    </>
  );
}

function shiftFrom(iso: string, days: number): string {
  const d = fromISO(iso) ?? new Date();
  d.setDate(d.getDate() + days);
  return toISO(d);
}

function longLabel(iso: string): string {
  const d = fromISO(iso);
  if (!d) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
