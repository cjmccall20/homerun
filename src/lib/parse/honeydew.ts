/**
 * Honeydew.md task grammar:
 *
 *   - [ ] task text @due(YYYY-MM-DD) @who(name) @every(interval) @prio(hi|med|lo)
 *
 * Tasks live under `## Tasks`, finished ones under `## Done`. Completing a
 * recurring task is the only clever bit: the line moves to Done stamped with
 * today, and a fresh copy with the next due date is appended to Tasks, which
 * is the same thing the nightly digest run does.
 */

import {
  appendToSection,
  findSection,
  fromLines,
  replaceSectionContent,
  toLines,
} from "../md.ts";
import { nextOccurrence, todayISO } from "../dates.ts";
import type { Honeydew, Priority, Task } from "../tasks.ts";

export type { Honeydew, Priority, Task, TaskFilter } from "../tasks.ts";
export { filterTasks, sortTasks } from "../tasks.ts";

const TASK_RE = /^(\s*)- \[( |x|X)\]\s?(.*)$/;

function tagValue(text: string, tag: string): string {
  const re = new RegExp(`@${tag}\\(([^)]*)\\)`, "i");
  const m = re.exec(text);
  return m ? m[1].trim() : "";
}

function stripTags(text: string): string {
  return text
    .replace(/@(due|who|every|prio|done)\([^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTaskLine(
  line: string,
  index: number,
  section: "tasks" | "done"
): Task | null {
  const m = TASK_RE.exec(line);
  if (!m) return null;
  const body = m[3];
  const prio = tagValue(body, "prio").toLowerCase();
  return {
    line: index,
    done: m[2].toLowerCase() === "x",
    text: stripTags(body),
    due: tagValue(body, "due"),
    who: tagValue(body, "who"),
    every: tagValue(body, "every"),
    prio: (["hi", "med", "lo"].includes(prio) ? prio : "") as Priority,
    doneOn: tagValue(body, "done"),
    section,
  };
}

export function serializeTask(task: {
  done: boolean;
  text: string;
  due?: string;
  who?: string;
  every?: string;
  prio?: Priority;
  doneOn?: string;
}): string {
  const parts = [task.text.trim()];
  if (task.due) parts.push(`@due(${task.due})`);
  if (task.who) parts.push(`@who(${task.who})`);
  if (task.every) parts.push(`@every(${task.every})`);
  if (task.prio) parts.push(`@prio(${task.prio})`);
  if (task.doneOn) parts.push(`@done(${task.doneOn})`);
  return `- [${task.done ? "x" : " "}] ${parts.filter(Boolean).join(" ")}`.trimEnd();
}

function sectionRange(
  lines: string[],
  prefix: string
): { start: number; end: number } | null {
  const s = findSection(lines, prefix);
  return s ? { start: s.start, end: s.end } : null;
}

export function parseHoneydew(text: string): Honeydew {
  const lines = toLines(text);
  const tasksRange = sectionRange(lines, "Tasks");
  const doneRange = sectionRange(lines, "Done");

  const collect = (
    range: { start: number; end: number } | null,
    which: "tasks" | "done"
  ): Task[] => {
    if (!range) return [];
    const out: Task[] = [];
    for (let i = range.start; i < range.end && i < lines.length; i += 1) {
      const t = parseTaskLine(lines[i], i, which);
      if (t && t.text !== "") out.push(t);
    }
    return out;
  };

  return {
    tasks: collect(tasksRange, "tasks"),
    done: collect(doneRange, "done"),
  };
}

export interface TaskInput {
  text: string;
  due?: string;
  who?: string;
  every?: string;
  prio?: Priority;
}

export function addTask(text: string, input: TaskInput): string {
  const lines = toLines(text);
  const section = findSection(lines, "Tasks");
  const line = serializeTask({ done: false, ...input });
  if (!section) {
    return fromLines([...lines, "", "## Tasks", "", line, ""]);
  }
  return fromLines(appendToSection(lines, section, [line]));
}

/** Rewrites one task line in place, identified by its line number. */
export function updateTask(
  text: string,
  lineNumber: number,
  input: TaskInput
): string {
  const lines = toLines(text);
  const existing = parseTaskLine(lines[lineNumber] ?? "", lineNumber, "tasks");
  if (!existing) throw new Error(`Line ${lineNumber} is not a task`);
  const next = [...lines];
  next[lineNumber] = serializeTask({
    done: existing.done,
    doneOn: existing.doneOn,
    ...input,
  });
  return fromLines(next);
}

export function removeTask(text: string, lineNumber: number): string {
  const lines = toLines(text);
  if (!TASK_RE.test(lines[lineNumber] ?? "")) {
    throw new Error(`Line ${lineNumber} is not a task`);
  }
  return fromLines(lines.filter((_, i) => i !== lineNumber));
}

/**
 * Completing a task: pull it out of Tasks, stamp it into Done, and if it is
 * recurring, drop the next occurrence back into Tasks.
 */
export function completeTask(
  text: string,
  lineNumber: number,
  today: string = todayISO()
): string {
  const lines = toLines(text);
  const task = parseTaskLine(lines[lineNumber] ?? "", lineNumber, "tasks");
  if (!task) throw new Error(`Line ${lineNumber} is not a task`);

  const tasksSection = findSection(lines, "Tasks");
  if (!tasksSection) throw new Error("Honeydew has no ## Tasks section");

  const remaining: string[] = [];
  for (let i = tasksSection.start; i < tasksSection.end; i += 1) {
    if (i !== lineNumber) remaining.push(lines[i]);
  }
  /*
   * The slice above carries the blank line that separated Tasks from the next
   * heading. Drop it before appending, or the recurrence lands underneath a
   * gap and the list looks like it has two sections.
   */
  while (remaining.length > 0 && remaining[remaining.length - 1].trim() === "") {
    remaining.pop();
  }

  if (task.every) {
    const next = nextOccurrence(task.due || today, task.every, new Date(today));
    if (next) {
      remaining.push(
        serializeTask({
          done: false,
          text: task.text,
          due: next,
          who: task.who,
          every: task.every,
          prio: task.prio,
        })
      );
    }
  }

  let out = replaceSectionContent(lines, tasksSection, remaining);

  const doneLine = serializeTask({
    done: true,
    text: task.text,
    due: task.due,
    who: task.who,
    every: task.every,
    prio: task.prio,
    doneOn: today,
  });

  const doneSection = findSection(out, "Done");
  if (doneSection) {
    out = appendToSection(out, doneSection, [doneLine]);
  } else {
    out = [...out, "", "## Done", "", doneLine, ""];
  }
  return fromLines(out);
}

/** Moves a completed task back to Tasks, unchecked. */
export function reopenTask(text: string, lineNumber: number): string {
  const lines = toLines(text);
  const task = parseTaskLine(lines[lineNumber] ?? "", lineNumber, "done");
  if (!task) throw new Error(`Line ${lineNumber} is not a task`);

  const withoutLine = lines.filter((_, i) => i !== lineNumber);
  const tasksSection = findSection(withoutLine, "Tasks");
  const reopened = serializeTask({
    done: false,
    text: task.text,
    due: task.due,
    who: task.who,
    every: task.every,
    prio: task.prio,
  });
  if (!tasksSection) {
    return fromLines([...withoutLine, "", "## Tasks", "", reopened, ""]);
  }
  return fromLines(appendToSection(withoutLine, tasksSection, [reopened]));
}
