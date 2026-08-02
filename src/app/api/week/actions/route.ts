import { body, fail, handle, ok, str } from "@/lib/api";
import { todayISO, weekDayLabels, weekLabelsFor, weekStartISO } from "@/lib/dates";
import { applyGrid, blankWeekNote, parseTable, parseWeek, setWeekOf } from "@/lib/parse/week";
import { readCurrentWeek, weekPath } from "@/lib/store";
import * as vault from "@/lib/vault";

/**
 * The three verbs that move a week around:
 *
 *   promote  draft   -> Meal-Plan.md  (archiving whatever was live)
 *   template current -> Weeks/Templates/<name>.md
 *   apply    template-> Meal-Plan.md  (meals only, the current days stay)
 *
 * Promote archives FIRST. If the archive write fails, nothing has been lost.
 */

export async function POST(request: Request) {
  return handle(async () => {
    const payload = await body<{
      action?: unknown;
      name?: unknown;
      from?: unknown;
    }>(request);
    const action = str(payload.action ?? "", "action");

    switch (action) {
      case "promote":
        return promote(str(payload.name ?? "", "name"));
      case "save-template":
        return saveTemplate(str(payload.name ?? "", "name"));
      case "apply-template":
        return applyTemplate(str(payload.name ?? "", "name"), "template");
      case "apply-draft":
        return applyTemplate(str(payload.name ?? "", "name"), "draft");
      case "archive-current":
        return archiveCurrent();
      case "new-week":
        return newWeek(str(payload.name ?? todayISO(), "name"));
      default:
        return fail(`Unknown action: ${action}`);
    }
  });
}

async function archivePath(weekOf: string): Promise<string> {
  const base = vault.safeName(weekOf || todayISO());
  let candidate = `${base}`;
  let n = 2;
  while (await vault.exists(vault.DIRS.archive, `${candidate}.md`)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return `${vault.DIRS.archive}/${candidate}.md`;
}

async function archiveCurrent(): Promise<Response> {
  const current = await readCurrentWeek();
  const target = await archivePath(current.weekOf);
  await vault.writeFile(target, current.raw);
  return ok({ ok: true, archivedTo: target });
}

async function promote(name: string): Promise<Response> {
  const draftRel = weekPath("draft", name);
  if (!(await vault.exists(draftRel))) {
    return fail(`Draft "${name}" does not exist.`, 404);
  }

  const current = await readCurrentWeek();
  const draftText = await vault.readFile(draftRel);
  const draft = parseWeek(draftText);
  if (!draft.table) return fail(`Draft "${name}" has no meal table.`);

  // Archive first: if this throws, the live week is still intact.
  const archivedTo = await archivePath(current.weekOf);
  await vault.writeFile(archivedTo, current.raw);

  const weekOf = draft.weekOf || current.weekOf || todayISO();
  // The draft becomes the live note wholesale, so its own days go live too.
  const promoted = setWeekOf(draftText, weekOf);
  await vault.writeFile(vault.FILES.mealPlan, promoted);
  await vault.deleteNote(vault.DIRS.drafts, name);

  return ok({ ok: true, archivedTo, weekOf });
}

async function saveTemplate(name: string): Promise<Response> {
  const safe = vault.safeName(name);
  const current = await readCurrentWeek();
  if (!current.table) return fail("The current week has no meal table.");
  const rel = weekPath("template", safe);
  await vault.writeFile(rel, current.raw);
  return ok({ ok: true, name: safe });
}

async function applyTemplate(
  name: string,
  scope: "template" | "draft"
): Promise<Response> {
  const rel = weekPath(scope, name);
  if (!(await vault.exists(rel))) {
    return fail(`"${name}" does not exist.`, 404);
  }
  const source = parseTable(await vault.readFile(rel));
  if (!source) return fail(`"${name}" has no meal table.`);

  await vault.editFile(
    vault.FILES.mealPlan,
    blankWeekNote(todayISO(), weekDayLabels()),
    (text) => applyGrid(text, source)
  );
  return ok({ ok: true });
}

/** Archives the live week and replaces it with a fresh, empty one. */
async function newWeek(weekOf: string): Promise<Response> {
  const current = await readCurrentWeek();
  const archivedTo = await archivePath(current.weekOf);
  await vault.writeFile(archivedTo, current.raw);

  const start = weekStartISO(weekOf);
  const labels = weekLabelsFor(start);
  await vault.writeFile(vault.FILES.mealPlan, blankWeekNote(start, labels));
  return ok({ ok: true, archivedTo, weekOf: start });
}
