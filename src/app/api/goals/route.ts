import { body, handle, num, ok, str } from "@/lib/api";
import { addGoal, blankGoals, editGoal, removeGoal, setGoalDone } from "@/lib/goals";
import { isPerson } from "@/lib/people";
import { goalsRel, readGoals } from "@/lib/store";
import * as vault from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The day's goals, per person. GET reads a date; POST mutates one goal.
 * Every mutation is a pure transform through vault.editFile, same as the
 * honeydew, so two phones editing the same morning cannot half-write the file.
 */

export async function GET(request: Request) {
  return handle(async () => {
    const date = new URL(request.url).searchParams.get("date") ?? "";
    return ok(await readGoals(date));
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const payload = await body<Record<string, unknown>>(request);
    const action = str(payload.action ?? "", "action");
    const date = str(payload.date ?? "", "date");
    const person = str(payload.person ?? "", "person");
    if (!isPerson(person)) throw new Error("Pick a real person.");

    const rel = goalsRel(date);
    const blank = blankGoals(date);

    switch (action) {
      case "add": {
        const text = str(payload.text ?? "", "text");
        await vault.editFile(rel, blank, (t) => addGoal(t, person, text));
        break;
      }
      case "toggle": {
        const index = num(payload.index, "index");
        const done = payload.done === true;
        await vault.editFile(rel, blank, (t) => setGoalDone(t, person, index, done));
        break;
      }
      case "edit": {
        const index = num(payload.index, "index");
        const text = str(payload.text ?? "", "text");
        await vault.editFile(rel, blank, (t) => editGoal(t, person, index, text));
        break;
      }
      case "remove": {
        const index = num(payload.index, "index");
        await vault.editFile(rel, blank, (t) => removeGoal(t, person, index));
        break;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return ok(await readGoals(date));
  });
}
