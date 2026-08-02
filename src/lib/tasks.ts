/**
 * Task shapes and the filter/sort rules, free of any Node import so the
 * Honeydew screen can re-filter in the browser without a round trip.
 */

export type Priority = "hi" | "med" | "lo" | "";

export interface Task {
  /** Stable within a single read: the absolute line number in the file. */
  line: number;
  done: boolean;
  text: string;
  due: string;
  who: string;
  every: string;
  prio: Priority;
  doneOn: string;
  section: "tasks" | "done";
}

export interface Honeydew {
  tasks: Task[];
  done: Task[];
}

export type TaskFilter = "all" | "mine" | "todo" | "done" | "recurring";

export const TASK_FILTERS: { key: TaskFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "mine", label: "Mine" },
  { key: "todo", label: "To do" },
  { key: "done", label: "Done" },
  { key: "recurring", label: "Recurring" },
];

export function filterTasks(
  data: Honeydew,
  filter: TaskFilter,
  me: string
): Task[] {
  switch (filter) {
    case "done":
      return data.done;
    case "mine":
      return data.tasks.filter(
        (t) => t.who.toLowerCase() === me.trim().toLowerCase()
      );
    case "recurring":
      return data.tasks.filter((t) => t.every !== "");
    case "todo":
      return data.tasks.filter((t) => !t.done);
    default:
      return data.tasks;
  }
}

/** Soonest due date first, undated last, priority breaking ties. */
export function sortTasks(tasks: Task[]): Task[] {
  const rank: Record<string, number> = { hi: 0, med: 1, lo: 2, "": 1 };
  return [...tasks].sort((a, b) => {
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
    if (a.due && !b.due) return -1;
    if (!a.due && b.due) return 1;
    return rank[a.prio] - rank[b.prio];
  });
}

/** "Overdue", "Today", "Tomorrow" or the plain date. */
export function dueLabel(due: string, todayIso: string): string {
  if (!due) return "";
  if (due < todayIso) return "Overdue";
  if (due === todayIso) return "Today";
  const t = new Date(`${todayIso}T12:00:00`);
  t.setDate(t.getDate() + 1);
  const tomorrow = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  return due === tomorrow ? "Tomorrow" : due;
}
