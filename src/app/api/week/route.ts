import type { NextRequest } from "next/server";

import { body, fail, handle, num, ok, str } from "@/lib/api";
import { todayISO, weekDayLabels, weekLabelsFor, weekStartISO } from "@/lib/dates";
import { blankWeekNote, setCell } from "@/lib/parse/week";
import {
  listArchive,
  listDrafts,
  listTemplates,
  readWeekNote,
  weekPath,
  type WeekScope,
} from "@/lib/store";
import * as vault from "@/lib/vault";

const SCOPES: WeekScope[] = ["current", "draft", "template", "archive"];

function asScope(value: string | null): WeekScope {
  const scope = (value ?? "current") as WeekScope;
  if (!SCOPES.includes(scope)) throw new Error(`Unknown scope: ${value}`);
  return scope;
}

export async function GET(request: NextRequest) {
  return handle(async () => {
    const params = request.nextUrl.searchParams;
    const list = params.get("list");
    if (list === "draft") return ok({ weeks: await listDrafts() });
    if (list === "template") return ok({ weeks: await listTemplates() });
    if (list === "archive") return ok({ weeks: await listArchive() });

    const scope = asScope(params.get("scope"));
    const week = await readWeekNote(scope, params.get("name") ?? undefined);
    if (!week) return fail("That week note does not exist.", 404);
    return ok({ week });
  });
}

/** Sets one cell of one week note. */
export async function PATCH(request: Request) {
  return handle(async () => {
    const payload = await body<{
      scope?: unknown;
      name?: unknown;
      row?: unknown;
      col?: unknown;
      value?: unknown;
    }>(request);

    const scope = asScope(
      payload.scope === undefined ? null : str(payload.scope, "scope")
    );
    const name = payload.name === undefined ? undefined : str(payload.name, "name");
    const row = num(payload.row, "row");
    const col = num(payload.col, "col");
    const value = str(payload.value ?? "", "value");

    const rel = weekPath(scope, name);
    const fallback = blankWeekNote(todayISO(), weekDayLabels());
    const next = await vault.editFile(rel, fallback, (text) =>
      setCell(text, row, col, value)
    );
    return ok({ ok: true, bytes: next.length });
  });
}

/** Creates a new empty draft or template. */
export async function POST(request: Request) {
  return handle(async () => {
    const payload = await body<{
      scope?: unknown;
      name?: unknown;
      weekOf?: unknown;
    }>(request);
    const scope = asScope(str(payload.scope ?? "draft", "scope"));
    if (scope === "current") return fail("Use PATCH to edit the current week.");

    const weekOf = weekStartISO(str(payload.weekOf ?? "", "weekOf"));
    const name = vault.safeName(str(payload.name ?? `proposed-${weekOf}`, "name"));
    const rel = weekPath(scope, name);
    if (await vault.exists(rel)) return fail(`"${name}" already exists.`, 409);

    await vault.writeFile(rel, blankWeekNote(weekOf, weekLabelsFor(weekOf)));
    return ok({ ok: true, name });
  });
}

export async function DELETE(request: NextRequest) {
  return handle(async () => {
    const params = request.nextUrl.searchParams;
    const scope = asScope(params.get("scope"));
    if (scope === "current") return fail("The current week cannot be deleted.");
    const name = params.get("name");
    if (!name) return fail("A name is required.");
    await vault.deleteNote(
      scope === "draft"
        ? vault.DIRS.drafts
        : scope === "template"
          ? vault.DIRS.templates
          : vault.DIRS.archive,
      name
    );
    return ok({ ok: true });
  });
}
