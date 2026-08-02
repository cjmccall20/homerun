import { body, fail, handle, num, ok, str } from "@/lib/api";
import { todayISO } from "@/lib/dates";
import {
  addTask,
  completeTask,
  removeTask,
  reopenTask,
  updateTask,
  type Priority,
  type TaskInput,
} from "@/lib/parse/honeydew";
import { readHoneydew } from "@/lib/store";
import * as vault from "@/lib/vault";

const BLANK = [
  "# Honeydew",
  "",
  "Household tasks. Format: `- [ ] task @due(YYYY-MM-DD) @who(name) @every(interval)`",
  "",
  "## Tasks",
  "",
  "## Done",
  "",
].join("\n");

function taskInput(payload: Record<string, unknown>): TaskInput {
  const prio = str(payload.prio ?? "", "prio").toLowerCase();
  return {
    text: str(payload.text ?? "", "text").trim(),
    due: str(payload.due ?? "", "due").trim(),
    who: str(payload.who ?? "", "who").trim(),
    every: str(payload.every ?? "", "every").trim(),
    prio: (["hi", "med", "lo"].includes(prio) ? prio : "") as Priority,
  };
}

export async function GET() {
  return handle(async () => ok({ honeydew: await readHoneydew() }));
}

export async function POST(request: Request) {
  return handle(async () => {
    const payload = await body<Record<string, unknown>>(request);
    const action = str(payload.action ?? "", "action");
    const rel = vault.FILES.honeydew;

    switch (action) {
      case "add": {
        const input = taskInput(payload);
        if (!input.text) throw new Error("A task needs some text.");
        await vault.editFile(rel, BLANK, (t) => addTask(t, input));
        return ok({ ok: true });
      }
      case "update": {
        const line = num(payload.line, "line");
        const input = taskInput(payload);
        if (!input.text) throw new Error("A task needs some text.");
        await vault.editFile(rel, BLANK, (t) => updateTask(t, line, input));
        return ok({ ok: true });
      }
      case "complete": {
        const line = num(payload.line, "line");
        await vault.editFile(rel, BLANK, (t) =>
          completeTask(t, line, todayISO())
        );
        return ok({ ok: true });
      }
      case "reopen": {
        const line = num(payload.line, "line");
        await vault.editFile(rel, BLANK, (t) => reopenTask(t, line));
        return ok({ ok: true });
      }
      case "delete": {
        const line = num(payload.line, "line");
        await vault.editFile(rel, BLANK, (t) => removeTask(t, line));
        return ok({ ok: true });
      }
      default:
        return fail(`Unknown action: ${action}`);
    }
  });
}
