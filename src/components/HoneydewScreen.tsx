"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { errorText, post } from "@/lib/client";
import { PEOPLE } from "@/lib/people";
import {
  TASK_FILTERS,
  dueLabel,
  filterTasks,
  sortTasks,
  type Honeydew,
  type Priority,
  type Task,
  type TaskFilter,
} from "@/lib/tasks";
import { PageHeader } from "@/components/PageHeader";
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  Input,
  Pill,
  Select,
  Sheet,
} from "@/components/ui";

/**
 * Honeydew.
 *
 * The one rule worth knowing: ticking a task that carries `@every(...)` does
 * not just check a box. The line moves to Done with today's date and a fresh
 * copy appears in Tasks with the next due date computed, which is exactly what
 * the nightly digest run does. Recurring chores never fall off the list.
 */

const EVERY_PRESETS = ["", "1 week", "2 weeks", "1 month", "3 months", "1 year"];

export function HoneydewScreen({
  data,
  me,
  today,
}: {
  data: Honeydew;
  me: string;
  today: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<TaskFilter>("todo");
  const [editing, setEditing] = useState<Task | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const shown = useMemo(
    () => sortTasks(filterTasks(data, filter, me)),
    [data, filter, me]
  );

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

  const overdue = data.tasks.filter((t) => t.due && t.due < today).length;
  const dueToday = data.tasks.filter((t) => !t.done && t.due === today).length;

  return (
    <>
      <PageHeader
        title="Honeydew"
        count={dueToday}
        subtitle={
          overdue > 0
            ? `${overdue} overdue`
            : `${data.tasks.length} open, ${data.done.length} done`
        }
        action={
          <Button variant="primary" onClick={() => setAdding(true)} className="px-4">
            Add
          </Button>
        }
      />

      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
        {TASK_FILTERS.map((f) => (
          <Pill
            key={f.key}
            active={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Pill>
        ))}
      </div>

      <ErrorNote>{error}</ErrorNote>

      {shown.length === 0 ? (
        <Empty>
          {filter === "done"
            ? "Nothing finished yet."
            : filter === "mine"
              ? `Nothing assigned to ${me}.`
              : "Nothing here. Enjoy it."}
        </Empty>
      ) : (
        <ul className="space-y-2">
          {shown.map((task) => {
            const isDone = task.section === "done";
            const due = dueLabel(task.due, today);
            return (
              <li key={`${task.section}-${task.line}`}>
                <Card className="flex items-stretch">
                  <button
                    aria-label={isDone ? "Reopen task" : "Complete task"}
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        post("/api/honeydew", {
                          action: isDone ? "reopen" : "complete",
                          line: task.line,
                        })
                      )
                    }
                    className="flex w-14 shrink-0 items-center justify-center active:bg-surface-2"
                  >
                    <span
                      aria-hidden
                      className={`flex h-6 w-6 items-center justify-center rounded-md border text-sm ${
                        isDone
                          ? "border-transparent bg-accent text-accent-ink"
                          : "border-line"
                      }`}
                    >
                      {isDone ? "✓" : ""}
                    </span>
                  </button>
                  <button
                    onClick={() => (isDone ? undefined : setEditing(task))}
                    disabled={isDone}
                    className="flex min-h-14 flex-1 items-center py-2 pr-4 text-left active:bg-surface-2 disabled:active:bg-transparent"
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block ${isDone ? "text-ink-faint line-through" : ""}`}
                      >
                        {task.text}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-faint">
                        {due ? (
                          <span
                            className={
                              due === "Overdue" ? "font-semibold text-danger" : ""
                            }
                          >
                            {due}
                          </span>
                        ) : null}
                        {task.who ? <span>{task.who}</span> : null}
                        {task.every ? <span>every {task.every}</span> : null}
                        {task.prio ? <span>{PRIO_LABEL[task.prio]}</span> : null}
                        {task.doneOn ? <span>done {task.doneOn}</span> : null}
                      </span>
                    </span>
                  </button>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <TaskSheet
          title="New task"
          me={me}
          busy={busy}
          onClose={() => setAdding(false)}
          onSave={(input) =>
            run(async () => {
              await post("/api/honeydew", { action: "add", ...input });
              setAdding(false);
            })
          }
        />
      ) : null}

      {editing ? (
        <TaskSheet
          title="Edit task"
          me={me}
          task={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onDelete={() =>
            run(async () => {
              await post("/api/honeydew", {
                action: "delete",
                line: editing.line,
              });
              setEditing(null);
            })
          }
          onSave={(input) =>
            run(async () => {
              await post("/api/honeydew", {
                action: "update",
                line: editing.line,
                ...input,
              });
              setEditing(null);
            })
          }
        />
      ) : null}
    </>
  );
}

const PRIO_LABEL: Record<string, string> = {
  hi: "high priority",
  med: "medium priority",
  lo: "low priority",
};

interface TaskInput {
  text: string;
  due: string;
  who: string;
  every: string;
  prio: Priority;
}

function TaskSheet({
  title,
  task,
  me,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  title: string;
  task?: Task;
  me: string;
  busy: boolean;
  onClose: () => void;
  onSave: (input: TaskInput) => void;
  onDelete?: () => void;
}) {
  const [text, setText] = useState(task?.text ?? "");
  const [due, setDue] = useState(task?.due ?? "");
  const [who, setWho] = useState(task?.who ?? "");
  const [every, setEvery] = useState(task?.every ?? "");
  const [prio, setPrio] = useState<Priority>(task?.prio ?? "");

  return (
    <Sheet open onClose={onClose} title={title}>
      <Field label="What needs doing?">
        <Input
          autoFocus={!task}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Change the HVAC filter"
        />
      </Field>

      <Field label="Due">
        <Input
          value={due}
          onChange={(e) => setDue(e.target.value)}
          type="date"
        />
      </Field>

      <Field label="Who">
        <div className="flex gap-2">
          <Pill active={who === ""} onClick={() => setWho("")}>
            Anyone
          </Pill>
          {PEOPLE.map((name) => (
            <Pill key={name} active={who === name} onClick={() => setWho(name)}>
              {name === me ? `${name} (you)` : name}
            </Pill>
          ))}
        </div>
      </Field>

      <Field
        label="Repeats"
        hint="Completing a repeating task writes the next one automatically."
      >
        <Select value={every} onChange={(e) => setEvery(e.target.value)}>
          {EVERY_PRESETS.map((preset) => (
            <option key={preset || "none"} value={preset}>
              {preset === "" ? "Does not repeat" : `Every ${preset}`}
            </option>
          ))}
          {every && !EVERY_PRESETS.includes(every) ? (
            <option value={every}>Every {every}</option>
          ) : null}
        </Select>
      </Field>

      <Field label="Priority">
        <div className="flex gap-2">
          <Pill active={prio === ""} onClick={() => setPrio("")}>
            Normal
          </Pill>
          <Pill active={prio === "hi"} onClick={() => setPrio("hi")}>
            High
          </Pill>
          <Pill active={prio === "lo"} onClick={() => setPrio("lo")}>
            Low
          </Pill>
        </div>
      </Field>

      <Button
        variant="primary"
        className="w-full"
        disabled={busy || text.trim() === ""}
        onClick={() => onSave({ text, due, who, every, prio })}
      >
        {busy ? "Saving" : "Save"}
      </Button>

      {onDelete ? (
        <Button
          variant="danger"
          className="mb-2 w-full"
          disabled={busy}
          onClick={onDelete}
        >
          Delete
        </Button>
      ) : null}
    </Sheet>
  );
}
