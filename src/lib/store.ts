import path from "node:path";

import { fromISO, todayISO, weekDayLabels } from "@/lib/dates";
import { blankGoals, parseGoals, type GoalsByPerson } from "@/lib/goals";
import { slugify } from "@/lib/md";
import {
  blankGroceryList,
  parseGrocery,
  type GroceryList,
} from "@/lib/parse/grocery";
import { parseHoneydew, type Honeydew } from "@/lib/parse/honeydew";
import {
  formatEntry,
  parseThread,
  threadHeader,
  unansweredQuestions,
  type ThreadEntry,
} from "@/lib/threads";
import {
  getSectionItems,
  parseOrderHistory,
  parsePreferences,
  type OrderEntry,
  type Preference,
} from "@/lib/parse/lists";
import { parseRecipe, type Recipe } from "@/lib/parse/recipe";
import {
  blankWeekNote,
  parseWeek,
  type Week,
  type WeekTable,
} from "@/lib/parse/week";
import * as vault from "@/lib/vault";

/**
 * The application's view of the vault: read a file, hand back a parsed object.
 * Route handlers talk to this module, this module talks to `vault` and the
 * parsers, and nothing else touches the disk.
 */

export type WeekScope = "current" | "draft" | "template" | "archive";

export function weekDir(scope: WeekScope): string {
  switch (scope) {
    case "draft":
      return vault.DIRS.drafts;
    case "template":
      return vault.DIRS.templates;
    case "archive":
      return vault.DIRS.archive;
    default:
      return "";
  }
}

export function weekPath(scope: WeekScope, name?: string): string {
  if (scope === "current") return vault.FILES.mealPlan;
  if (!name) throw new vault.VaultError(`A ${scope} needs a name`);
  return path.join(weekDir(scope), `${vault.safeName(name)}.md`);
}

/* ------------------------------------------------------------------ week -- */

export async function readCurrentWeek(): Promise<Week & { raw: string }> {
  const raw = await vault.readFileOr(
    blankWeekNote(todayISO(), weekDayLabels()),
    vault.FILES.mealPlan
  );
  return { ...parseWeek(raw), raw };
}

export async function readWeekNote(
  scope: WeekScope,
  name?: string
): Promise<(Week & { raw: string; name: string }) | null> {
  if (scope === "current") {
    const week = await readCurrentWeek();
    return { ...week, name: "Meal-Plan" };
  }
  const rel = weekPath(scope, name);
  if (!(await vault.exists(rel))) return null;
  const raw = await vault.readFile(rel);
  return { ...parseWeek(raw), raw, name: vault.safeName(name ?? "") };
}

export interface WeekSummary {
  name: string;
  weekOf: string;
  title: string;
  filled: number;
  table: WeekTable | null;
}

async function summarize(
  scope: WeekScope
): Promise<WeekSummary[]> {
  const names = await vault.listNotes(weekDir(scope));
  const out: WeekSummary[] = [];
  for (const name of names) {
    const raw = await vault.readFile(weekDir(scope), `${name}.md`);
    const week = parseWeek(raw);
    out.push({
      name,
      weekOf: week.weekOf,
      title: week.title,
      filled: countFilled(week.table),
      table: week.table,
    });
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

export function countFilled(table: WeekTable | null): number {
  if (!table) return 0;
  return table.rows.reduce(
    (sum, row) => sum + row.cells.filter((c) => c.kind !== "empty").length,
    0
  );
}

export const listDrafts = () => summarize("draft");
export const listTemplates = () => summarize("template");
export const listArchive = () => summarize("archive");

/* --------------------------------------------------------------- recipes -- */

/**
 * Recipes on disk. Drafts are excluded unless asked for.
 *
 * The default matters more than it looks: this function feeds the recipe
 * picker in the week planner, and an unreviewed import must not be plannable
 * or shoppable. The planner and grocery prompts are told the same rule
 * separately, because they read the vault themselves rather than through here.
 */
export async function listRecipes(
  include: "live" | "draft" | "all" = "live"
): Promise<Recipe[]> {
  const slugs = await vault.listNotes(vault.DIRS.recipes);
  const out: Recipe[] = [];
  for (const slug of slugs) {
    const raw = await vault.readFile(vault.DIRS.recipes, `${slug}.md`);
    const recipe = parseRecipe(slug, raw);
    if (include === "all" || recipe.status === include) out.push(recipe);
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

export function recipePath(slug: string): string {
  return path.join(vault.DIRS.recipes, `${vault.safeName(slug)}.md`);
}

export async function readRecipe(slug: string): Promise<Recipe | null> {
  const rel = recipePath(slug);
  if (!(await vault.exists(rel))) return null;
  return parseRecipe(vault.safeName(slug), await vault.readFile(rel));
}

/** A slug that is not already taken, e.g. `tacos`, `tacos-2`, `tacos-3`. */
export async function uniqueRecipeSlug(title: string): Promise<string> {
  const base = slugify(title);
  let candidate = base;
  let n = 2;
  while (await vault.exists(recipePath(candidate))) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

/* --------------------------------------------------------------- grocery -- */

export async function readGrocery(): Promise<GroceryList & { raw: string }> {
  const raw = await vault.readFileOr(
    blankGroceryList(),
    vault.FILES.groceryList
  );
  return { ...parseGrocery(raw), raw };
}

/* --------------------------------------------------------- grocery weeks -- */

/**
 * A week's grocery list is snapshotted before a new one is generated, so the
 * list and its conversation can be read back together months later. The
 * generator overwrites Grocery-List.md; without this the only record of what
 * was actually bought would be gone.
 */
export async function snapshotGroceryList(): Promise<string | null> {
  const current = await readGrocery();
  if (current.total === 0) return null;
  const weekOf = current.generatedFrom.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  const week = weekOf || (await readCurrentWeek()).weekOf || todayISO();
  const rel = path.join(vault.DIRS.lists, `${vault.safeName(week)}.md`);
  await vault.writeFile(rel, current.raw);
  return rel;
}

export interface WeekOption {
  weekOf: string;
  /** True for the week whose list is live in Grocery-List.md. */
  current: boolean;
  hasList: boolean;
  hasThread: boolean;
}

/** Weeks you can look at: the live one, plus every snapshot and thread. */
export async function listGroceryWeeks(): Promise<WeekOption[]> {
  const [lists, threads, archive, current] = await Promise.all([
    vault.listNotes(vault.DIRS.lists),
    vault.listNotes(vault.DIRS.threads),
    vault.listNotes(vault.DIRS.archive),
    readCurrentWeek(),
  ]);

  const currentWeek = current.weekOf || todayISO();
  const weeks = new Map<string, WeekOption>();
  weeks.set(currentWeek, {
    weekOf: currentWeek,
    current: true,
    hasList: true,
    hasThread: threads.includes(currentWeek),
  });

  for (const name of [...lists, ...threads, ...archive]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name) || name === currentWeek) continue;
    weeks.set(name, {
      weekOf: name,
      current: false,
      hasList: lists.includes(name),
      hasThread: threads.includes(name),
    });
  }

  return [...weeks.values()].sort((a, b) => (a.weekOf < b.weekOf ? 1 : -1));
}

/** A past week's list, read from its snapshot. */
export async function readGroceryWeek(
  weekOf: string
): Promise<(GroceryList & { raw: string }) | null> {
  const rel = path.join(vault.DIRS.lists, `${vault.safeName(weekOf)}.md`);
  if (!(await vault.exists(rel))) return null;
  const raw = await vault.readFile(rel);
  return { ...parseGrocery(raw), raw };
}

/* ----------------------------------------------------------- thread I/O -- */

function threadPath(weekOf: string): string {
  return path.join(vault.DIRS.threads, `${vault.safeName(weekOf)}.md`);
}

export async function readThread(weekOf: string): Promise<ThreadEntry[]> {
  const raw = await vault.readFileOr("", threadPath(weekOf));
  return parseThread(raw);
}

/**
 * Appends one turn. Creates the thread with a header the first time, so a
 * human opening it in Obsidian knows what it is.
 */
export async function appendToThread(
  weekOf: string,
  author: string,
  text: string,
  awaitingAnswer = false
): Promise<string> {
  const rel = threadPath(weekOf);
  const line = formatEntry(todayISO(), author, text, awaitingAnswer);
  await vault.editFile(rel, threadHeader(weekOf), (current) => {
    const base = current.endsWith("\n") || current === "" ? current : `${current}\n`;
    return `${base}${line}\n`;
  });
  return line;
}

/** Every unanswered Claude question across every week, for the nightly sweep. */
export async function openThreadQuestions(): Promise<
  { weekOf: string; entry: ThreadEntry }[]
> {
  const weeks = await vault.listNotes(vault.DIRS.threads);
  const out: { weekOf: string; entry: ThreadEntry }[] = [];
  for (const weekOf of weeks) {
    for (const entry of unansweredQuestions(await readThread(weekOf))) {
      out.push({ weekOf, entry });
    }
  }
  return out;
}

/* -------------------------------------------------------------- honeydew -- */

const BLANK_HONEYDEW = [
  "# Honeydew",
  "",
  "Household tasks. Format: `- [ ] task @due(YYYY-MM-DD) @who(name) @every(interval)`",
  "",
  "## Tasks",
  "",
  "## Done",
  "",
].join("\n");

export async function readHoneydew(): Promise<Honeydew & { raw: string }> {
  const raw = await vault.readFileOr(BLANK_HONEYDEW, vault.FILES.honeydew);
  return { ...parseHoneydew(raw), raw };
}

/* ----------------------------------------------------------------- goals -- */

/** `Goals/YYYY-MM-DD.md`, with the date checked before it becomes a path. */
export function goalsRel(date: string): string {
  if (!fromISO(date)) throw new vault.VaultError(`Not a date: ${date}`);
  return `${vault.DIRS.goals}/${date}.md`;
}

export async function readGoals(
  date: string
): Promise<{ goals: GoalsByPerson; raw: string }> {
  const raw = await vault.readFileOr(blankGoals(date), goalsRel(date));
  return { goals: parseGoals(raw), raw };
}

/* ----------------------------------------------------------------- lists -- */

export interface Staples {
  pantry: string[];
  house: string[];
}

export async function readStaples(): Promise<Staples & { raw: string }> {
  const raw = await vault.readFileOr("# Groceries and Staples\n", vault.FILES.staples);
  return {
    pantry: getSectionItems(raw, "Pantry staples"),
    house: getSectionItems(raw, "House staples"),
    raw,
  };
}

export interface Restaurants {
  favorites: string[];
  history: OrderEntry[];
}

export async function readRestaurants(): Promise<Restaurants & { raw: string }> {
  const raw = await vault.readFileOr("# Restaurants\n", vault.FILES.restaurants);
  return {
    favorites: getSectionItems(raw, "Favorites"),
    history: parseOrderHistory(raw),
    raw,
  };
}

export async function readPrefs(): Promise<{
  prefs: Preference[];
  raw: string;
}> {
  const raw = await vault.readFileOr(
    "# Ingredient Preferences\n",
    vault.FILES.prefs
  );
  return { prefs: parsePreferences(raw), raw };
}
