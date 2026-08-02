/**
 * Parser tests. Run with `npm test` (Node's built-in runner, no framework).
 *
 * The rule these tests exist to enforce: a write must change only what it was
 * asked to change. Every "round trip" test below takes a fixture, makes one
 * edit, and asserts every other byte is identical.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  appendToSectionByTitle,
  findSection,
  setFrontmatterKey,
  slugify,
  toLines,
} from "../src/lib/md.ts";
import {
  applyGrid,
  blankWeekNote,
  dinners,
  parseMeal,
  parseTable,
  parseWeek,
  serializeMeal,
  setCell,
} from "../src/lib/parse/week.ts";
import {
  addComment,
  formatQuantity,
  markDraft,
  newRecipeNote,
  parseRecipe,
  publishRecipe,
  scaleIngredient,
  setFavorite,
  setRating,
  updateRecipeNote,
} from "../src/lib/parse/recipe.ts";
import { readStatusMarkers } from "../src/lib/claude-markers.ts";
import {
  formatEntry,
  parseThread,
  unansweredQuestions,
} from "../src/lib/threads.ts";
import {
  binForTag,
  groupTagsIntoBins,
  matchesAllTags,
  normalizeTag,
} from "../src/lib/tag-taxonomy.ts";
import {
  addTask,
  completeTask,
  parseHoneydew,
  parseTaskLine,
  reopenTask,
  serializeTask,
  sortTasks,
} from "../src/lib/parse/honeydew.ts";
import {
  addExtra,
  formatItemSources,
  parseGrocery,
  parseItemSources,
  parseItemStore,
  setChecked,
  toPlainText,
  uncheckAll,
} from "../src/lib/parse/grocery.ts";
import {
  getSectionItems,
  orderEntryLine,
  otherPrefSections,
  parseOrderHistory,
  parsePreferences,
  parseSections,
  setPreferences,
  setSectionItems,
} from "../src/lib/parse/lists.ts";
import {
  advance,
  dayLabel,
  nextOccurrence,
  parseInterval,
  startOfWeek,
  toISO,
  weekDayLabels,
} from "../src/lib/dates.ts";

/*
 * Byte-exact assertions read from tests/fixtures, NOT from the live vault.
 * The vault is not a fixture: Basic Memory reindexes those notes in the
 * background (it rewrites inline YAML arrays into block form, turns empty
 * values into `null`, strips trailing spaces and adds a `permalink` key), so
 * any test pinned to a line number there fails the moment the indexer runs.
 *
 * The live vault still gets exercised below, but only for what actually
 * matters about it: that whatever shape the files are in right now, the
 * parsers read them correctly.
 */
const FIXTURES = path.join(import.meta.dirname, "fixtures");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

const VAULT = process.env.HOMERUN_VAULT ?? "";
const HAS_VAULT = VAULT !== "" && existsSync(VAULT);
const vault = (...p: string[]) => readFileSync(path.join(VAULT, ...p), "utf8");

/** Asserts two documents differ on exactly the expected line numbers. */
function changedLines(before: string, after: string): number[] {
  const a = toLines(before);
  const b = toLines(after);
  const out: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) out.push(i);
  }
  return out;
}

/* ---------------------------------------------------------------- dates -- */

test("parseInterval understands the @every vocabulary", () => {
  assert.deepEqual(parseInterval("3 months"), { count: 3, unit: "month" });
  assert.deepEqual(parseInterval("weekly"), { count: 1, unit: "week" });
  assert.deepEqual(parseInterval("2 weeks"), { count: 2, unit: "week" });
  assert.deepEqual(parseInterval("quarterly"), { count: 3, unit: "month" });
  assert.equal(parseInterval("whenever"), null);
});

test("advance clamps month-end arithmetic", () => {
  const jan31 = new Date(2026, 0, 31);
  assert.equal(toISO(advance(jan31, { count: 1, unit: "month" })), "2026-02-28");
  assert.equal(toISO(advance(jan31, { count: 12, unit: "month" })), "2027-01-31");
});

test("nextOccurrence rolls a stale recurring task into the future", () => {
  const today = new Date(2026, 6, 26);
  assert.equal(nextOccurrence("2026-07-20", "1 week", today), "2026-07-27");
  // Overdue by years: still lands ahead of today, not in 2024.
  assert.equal(nextOccurrence("2024-01-01", "3 months", today), "2026-10-01");
});

test("week day labels match the Meal-Plan Day column format", () => {
  assert.equal(dayLabel(new Date(2026, 6, 27)), "Mon 7/27");
  assert.equal(toISO(startOfWeek(new Date(2026, 6, 30))), "2026-07-27");
  assert.deepEqual(weekDayLabels(new Date(2026, 6, 30)), [
    "Mon 7/27",
    "Tue 7/28",
    "Wed 7/29",
    "Thu 7/30",
    "Fri 7/31",
    "Sat 8/1",
    "Sun 8/2",
  ]);
});

/* ------------------------------------------------------------------- md -- */

test("setFrontmatterKey rewrites one line and nothing else", () => {
  const before = fixture("recipe.md");
  const after = setFrontmatterKey(before, "favorite", true);
  assert.deepEqual(changedLines(before, after), [7]);
  assert.match(toLines(after)[7], /^favorite: true$/);
});

test("setFrontmatterKey appends a missing key inside the block", () => {
  const before = "---\ntitle: X\n---\n# X\n";
  const after = setFrontmatterKey(before, "servings", 4);
  assert.equal(after, "---\ntitle: X\nservings: 4\n---\n# X\n");
});

test("setFrontmatterKey writes a bare key for an empty value", () => {
  const after = setFrontmatterKey("---\nsource-url: x\n---\n", "source-url", "");
  assert.equal(after, "---\nsource-url:\n---\n");
});

test("setFrontmatterKey creates a block when the file has none", () => {
  const after = setFrontmatterKey("# Title\n", "week-of", "2026-07-27");
  assert.equal(after, "---\nweek-of: 2026-07-27\n---\n# Title\n");
});

test("findSection ignores headings inside code fences", () => {
  const lines = toLines("# A\n\n```\n## Not a heading\n```\n\n## Real\n\n- x\n");
  const section = findSection(lines, "Real");
  assert.ok(section);
  assert.equal(section.title, "Real");
});

test("appendToSectionByTitle creates the section when missing", () => {
  const out = appendToSectionByTitle("# T\n\nprose\n", "Comments", "## Comments", [
    "- a",
  ]);
  assert.equal(out, "# T\n\nprose\n\n## Comments\n\n- a\n");
});

test("slugify produces Obsidian-safe names", () => {
  assert.equal(slugify("Weeknight Tacos!"), "weeknight-tacos");
  assert.equal(slugify("Café au Lait"), "cafe-au-lait");
  assert.equal(slugify("???"), "untitled");
});

/* ----------------------------------------------------------------- week -- */

test("parses the real Meal-Plan table", () => {
  const text = fixture("meal-plan.md");
  const week = parseWeek(text);
  assert.equal(week.weekOf, "2026-07-27");
  assert.ok(week.table);
  assert.deepEqual(week.table.headers, [
    "Day",
    "Breakfast",
    "Lunch",
    "Dinner",
    "Notes",
  ]);
  assert.equal(week.table.rows.length, 7);
  assert.equal(week.table.rows[0].day, "Mon 7/27");
  assert.equal(week.table.rows[0].cells.length, 4);
  assert.equal(week.table.rows[0].cells[0].kind, "empty");
});

test("meal cell grammar round-trips", () => {
  const cases: [string, string, string, string][] = [
    // raw, kind, value, cook
    ["Tacos", "text", "Tacos", ""],
    ["Tacos (Ashlyn)", "text", "Tacos", "Ashlyn"],
    ["[[weeknight-tacos]]", "recipe", "weeknight-tacos", ""],
    ["[[weeknight-tacos]] (Cooper)", "recipe", "weeknight-tacos", "Cooper"],
    ["Leftovers", "leftovers", "Leftovers", ""],
    ["Restaurant: Taco Bus", "restaurant", "Taco Bus", ""],
    ["Restaurant: Taco Bus (Cooper)", "restaurant", "Taco Bus", "Cooper"],
    ["", "empty", "", ""],
  ];
  for (const [raw, kind, value, cook] of cases) {
    const meal = parseMeal(raw);
    assert.equal(meal.kind, kind, raw);
    assert.equal(meal.value, value, raw);
    assert.equal(meal.cook, cook, raw);
    assert.equal(serializeMeal(meal), raw, `serialize ${raw}`);
  }
});

test("a parenthetical that is not a cook stays part of the dish name", () => {
  const meal = parseMeal("Chili (big batch)");
  assert.equal(meal.value, "Chili (big batch)");
  assert.equal(meal.cook, "");
});

test("setCell changes exactly one table row and nothing above it", () => {
  const before = fixture("meal-plan.md");
  const after = setCell(before, 2, 2, "[[example-weeknight-tacos]] (Cooper)");
  const table = parseTable(before)!;
  assert.deepEqual(changedLines(before, after), [table.firstDataLine + 2]);
  const reparsed = parseTable(after)!;
  assert.equal(reparsed.rows[2].cells[2].kind, "recipe");
  assert.equal(reparsed.rows[2].cells[2].cook, "Cooper");
  assert.equal(reparsed.rows[2].day, "Wed 7/29");
});

test("writing an untouched grid is a byte-for-byte no-op", () => {
  const before = fixture("meal-plan.md");
  const after = setCell(before, 0, 0, parseTable(before)!.rows[0].cells[0].raw);
  assert.equal(after, before);
});

test("pipes in a meal name are escaped and survive a round trip", () => {
  const before = fixture("meal-plan.md");
  const after = setCell(before, 0, 0, "Rice | Beans");
  assert.equal(parseTable(after)!.rows[0].cells[0].value, "Rice | Beans");
});

test("applyGrid copies meals but keeps the target's own days", () => {
  const current = fixture("meal-plan.md");
  const template = setCell(
    setCell(current, 0, 2, "Chili"),
    1,
    2,
    "Restaurant: Taco Bus"
  );
  const retitled = setCell(current, 0, 0, "");
  const applied = applyGrid(retitled, parseTable(template)!);
  const table = parseTable(applied)!;
  assert.equal(table.rows[0].day, "Mon 7/27");
  assert.equal(table.rows[0].cells[2].value, "Chili");
  assert.equal(table.rows[1].cells[2].value, "Taco Bus");
});

test("blankWeekNote reproduces the seeded Meal-Plan shape", () => {
  const note = blankWeekNote("2026-07-27", weekDayLabels(new Date(2026, 6, 27)));
  const seeded = fixture("meal-plan.md");
  assert.equal(
    toLines(note).find((l) => l.startsWith("| Day")),
    toLines(seeded).find((l) => l.startsWith("| Day"))
  );
  assert.equal(
    toLines(note).find((l) => l.startsWith("|--")),
    toLines(seeded).find((l) => l.startsWith("|--"))
  );
  assert.equal(
    toLines(note).find((l) => l.startsWith("| Mon")),
    toLines(seeded).find((l) => l.startsWith("| Mon"))
  );
});

test("dinners pulls the Dinner column", () => {
  const text = setCell(fixture("meal-plan.md"), 3, 2, "Leftovers");
  const list = dinners(parseTable(text));
  assert.equal(list.length, 7);
  assert.equal(list[3].day, "Thu 7/30");
  assert.equal(list[3].meal.kind, "leftovers");
});

/* --------------------------------------------------------------- recipe -- */

test("parses the real example recipe", () => {
  const r = parseRecipe(
    "example-weeknight-tacos",
    fixture("recipe.md")
  );
  assert.equal(r.title, "Weeknight Tacos");
  assert.deepEqual(r.tags, ["mexican", "quick", "weeknight"]);
  assert.equal(r.servings, 4);
  assert.equal(r.favorite, false);
  assert.equal(r.ratings.Cooper, null);
  assert.equal(r.ingredients.length, 6);
  assert.equal(r.ingredients[0], "1 lb ground beef");
  assert.equal(r.steps.length, 3);
  assert.match(r.steps[0], /^Brown the beef/);
  assert.equal(r.comments.length, 1);
  assert.equal(r.comments[0].date, "2026-07-26");
  assert.equal(r.comments[0].name, "Claude");
});

test("rating and favorite each touch one frontmatter line", () => {
  const before = fixture("recipe.md");
  assert.deepEqual(changedLines(before, setRating(before, "Cooper", 5)), [5]);
  assert.deepEqual(changedLines(before, setRating(before, "Ashlyn", 4)), [6]);
  assert.deepEqual(changedLines(before, setFavorite(before, true)), [7]);
  assert.equal(
    parseRecipe("x", setRating(before, "Cooper", 5)).ratings.Cooper,
    5
  );
});

test("clearing a rating leaves a bare key, not the string null", () => {
  const before = fixture("recipe.md");
  const rated = setRating(before, "Cooper", 5);
  const cleared = setRating(rated, "Cooper", null);
  assert.equal(cleared, before);
});

test("addComment appends under ## Comments and touches nothing above", () => {
  const before = fixture("recipe.md");
  const after = addComment(before, "2026-07-26", "Cooper", "Kids ate it. Repeat.");
  const changed = changedLines(before, after);
  assert.ok(changed.every((n) => n >= 28), `changed lines: ${changed}`);
  const r = parseRecipe("x", after);
  assert.equal(r.comments.length, 2);
  assert.equal(r.comments[1].name, "Cooper");
  assert.equal(r.comments[1].text, "Kids ate it. Repeat.");
});

test("appending to the last section keeps the file's trailing newline", () => {
  const before = fixture("recipe.md");
  assert.ok(before.endsWith("\n"), "the vault file ends with a newline");
  const after = addComment(before, "2026-07-26", "Cooper", "Good.");
  assert.ok(
    after.endsWith("\n"),
    "and so does the file after a comment is appended"
  );
  assert.ok(!after.endsWith("\n\n"), "without piling up blank lines");
});

test("a new recipe note parses back into the same recipe", () => {
  const note = newRecipeNote({
    title: "Sheet Pan Chicken",
    tags: ["easy", "weeknight"],
    servings: 4,
    sourceUrl: "https://example.com/chicken",
    ingredients: ["2 lb chicken thighs", "1 lemon"],
    steps: ["Heat oven to 425.", "Roast 30 minutes."],
  });
  const r = parseRecipe("sheet-pan-chicken", note);
  assert.equal(r.title, "Sheet Pan Chicken");
  assert.deepEqual(r.tags, ["easy", "weeknight"]);
  assert.equal(r.servings, 4);
  assert.equal(r.sourceUrl, "https://example.com/chicken");
  assert.deepEqual(r.ingredients, ["2 lb chicken thighs", "1 lemon"]);
  assert.equal(r.steps.length, 2);
  assert.equal(r.comments.length, 0);
});

test("updateRecipeNote preserves ratings, comments and unknown sections", () => {
  const before = addComment(
    setRating(fixture("recipe.md"), "Cooper", 5) +
      "\n## Wine\n\n- something red\n",
    "2026-07-26",
    "Ashlyn",
    "Good"
  );
  const after = updateRecipeNote(before, {
    title: "Weeknight Tacos",
    tags: ["mexican", "quick"],
    servings: 6,
    sourceUrl: "",
    ingredients: ["1.5 lb ground beef", "12 corn tortillas"],
    steps: ["Brown beef.", "Assemble."],
  });
  const r = parseRecipe("x", after);
  assert.equal(r.servings, 6);
  assert.deepEqual(r.tags, ["mexican", "quick"]);
  assert.equal(r.ratings.Cooper, 5, "rating survived");
  assert.equal(r.comments.length, 2, "comments survived");
  assert.match(after, /## Wine/, "unknown section survived");
  assert.deepEqual(r.ingredients, ["1.5 lb ground beef", "12 corn tortillas"]);
});

test("ingredient scaler handles decimals, fractions and unmeasured lines", () => {
  assert.equal(scaleIngredient("1 lb ground beef", 2), "2 lb ground beef");
  assert.equal(scaleIngredient("0.5 cup salsa", 2), "1 cup salsa");
  assert.equal(scaleIngredient("1 lb ground beef", 1.5), "1 1/2 lb ground beef");
  assert.equal(scaleIngredient("8 corn tortillas", 0.5), "4 corn tortillas");
  assert.equal(scaleIngredient("1/2 cup rice", 3), "1 1/2 cup rice");
  assert.equal(scaleIngredient("Salt to taste", 2), "Salt to taste");
  assert.equal(scaleIngredient("1 lime", 1), "1 lime");
});

test("formatQuantity prefers kitchen fractions", () => {
  assert.equal(formatQuantity(0.5), "1/2");
  assert.equal(formatQuantity(0.3333333), "1/3");
  assert.equal(formatQuantity(2.25), "2 1/4");
  assert.equal(formatQuantity(3), "3");
});

/* ------------------------------------------------------------- honeydew -- */

test("parses the real Honeydew file", () => {
  const data = parseHoneydew(fixture("honeydew.md"));
  assert.equal(data.tasks.length, 1);
  assert.equal(data.tasks[0].text, "Example: change HVAC filter");
  assert.equal(data.tasks[0].every, "3 months");
  assert.equal(data.tasks[0].done, false);
  assert.equal(data.done.length, 0);
});

test("task grammar round-trips through parse and serialize", () => {
  const line =
    "- [ ] Take out recycling @due(2026-07-28) @who(Cooper) @every(1 week) @prio(hi)";
  const t = parseTaskLine(line, 0, "tasks")!;
  assert.equal(t.text, "Take out recycling");
  assert.equal(t.due, "2026-07-28");
  assert.equal(t.who, "Cooper");
  assert.equal(t.every, "1 week");
  assert.equal(t.prio, "hi");
  assert.equal(serializeTask(t), line);
});

test("addTask appends under ## Tasks without disturbing the prose", () => {
  const before = fixture("honeydew.md");
  const after = addTask(before, {
    text: "Water the plants",
    due: "2026-07-28",
    who: "Ashlyn",
  });
  const changed = changedLines(before, after);
  assert.ok(changed.every((n) => n >= 10), `changed lines: ${changed}`);
  const data = parseHoneydew(after);
  assert.equal(data.tasks.length, 2);
  assert.equal(data.tasks[1].who, "Ashlyn");
});

test("completing a recurring task re-lists it with the next due date", () => {
  const before = fixture("honeydew.md");
  const task = parseHoneydew(before).tasks[0];
  const after = completeTask(before, task.line, "2026-07-26");
  const data = parseHoneydew(after);

  assert.equal(data.tasks.length, 1, "the recurrence came back");
  assert.equal(data.tasks[0].text, "Example: change HVAC filter");
  assert.equal(data.tasks[0].every, "3 months");
  assert.equal(data.tasks[0].due, "2026-10-26");
  assert.equal(data.tasks[0].done, false);

  assert.equal(data.done.length, 1, "and the old one landed in Done");
  assert.equal(data.done[0].done, true);
  assert.equal(data.done[0].doneOn, "2026-07-26");
});

test("the task list has no blank lines between tasks after a completion", () => {
  const before = addTask(fixture("honeydew.md"), {
    text: "Water the plants",
    due: "2026-07-28",
    who: "Ashlyn",
  });
  const hvac = parseHoneydew(before).tasks.find((t) => t.every === "3 months")!;
  const after = completeTask(before, hvac.line, "2026-07-26");

  const lines = toLines(after);
  const tasks = findSection(lines, "Tasks")!;
  const block = lines
    .slice(tasks.start, tasks.end)
    .filter((l) => l.trim() !== "" || true);
  // Between the first and last task line there must be no blank line.
  const taskLines = block
    .map((l, i) => (/^- \[/.test(l) ? i : -1))
    .filter((i) => i >= 0);
  const first = taskLines[0];
  const last = taskLines[taskLines.length - 1];
  assert.equal(taskLines.length, 2);
  for (let i = first; i <= last; i += 1) {
    assert.notEqual(block[i].trim(), "", `blank line inside the task list at ${i}`);
  }
});

test("completing a one-off task leaves nothing behind in Tasks", () => {
  const before = addTask(fixture("honeydew.md"), { text: "Fix the gate" });
  const task = parseHoneydew(before).tasks.find((t) => t.text === "Fix the gate")!;
  const after = completeTask(before, task.line, "2026-07-26");
  const data = parseHoneydew(after);
  assert.equal(data.tasks.length, 1);
  assert.equal(data.tasks[0].text, "Example: change HVAC filter");
  assert.equal(data.done[0].text, "Fix the gate");
});

test("reopen moves a done task back to Tasks", () => {
  const before = fixture("honeydew.md");
  const done = completeTask(before, parseHoneydew(before).tasks[0].line, "2026-07-26");
  const doneTask = parseHoneydew(done).done[0];
  const after = reopenTask(done, doneTask.line);
  const data = parseHoneydew(after);
  assert.equal(data.done.length, 0);
  assert.ok(data.tasks.some((t) => t.done === false));
});

test("sortTasks puts the soonest due date first and undated last", () => {
  const tasks = sortTasks([
    parseTaskLine("- [ ] C", 0, "tasks")!,
    parseTaskLine("- [ ] A @due(2026-07-01)", 1, "tasks")!,
    parseTaskLine("- [ ] B @due(2026-08-01)", 2, "tasks")!,
  ]);
  assert.deepEqual(tasks.map((t) => t.text), ["A", "B", "C"]);
});

/* -------------------------------------------------------------- grocery -- */

const SAMPLE_LIST = [
  "---",
  "generated-from: Meal-Plan 2026-07-27",
  "generated-on: 2026-07-26",
  "---",
  "# Grocery List",
  "",
  "## Produce",
  "",
  "- [ ] 2 limes",
  "- [x] 1 head romaine",
  "",
  "## Meat",
  "",
  "- [ ] 1 lb ground beef",
  "",
  "## Extras (manual adds)",
  "",
  "- [ ] paper towels",
  "",
].join("\n");

test("parses the seeded empty grocery list without inventing items", () => {
  const list = parseGrocery(fixture("grocery-list.md"));
  assert.equal(list.total, 0);
  assert.ok(list.categories.some((c) => /^Extras/.test(c.name)));
});

test("parses categories, counts and check state", () => {
  const list = parseGrocery(SAMPLE_LIST);
  assert.equal(list.generatedFrom, "Meal-Plan 2026-07-27");
  assert.deepEqual(
    list.categories.map((c) => c.name),
    ["Produce", "Meat", "Extras (manual adds)"]
  );
  assert.equal(list.total, 4);
  assert.equal(list.checked, 1);
  assert.equal(list.categories[0].items[1].checked, true);
});

test("checking a box rewrites exactly that line", () => {
  const list = parseGrocery(SAMPLE_LIST);
  const item = list.categories[0].items[0];
  const after = setChecked(SAMPLE_LIST, item.line, true);
  assert.deepEqual(changedLines(SAMPLE_LIST, after), [item.line]);
  assert.equal(parseGrocery(after).checked, 2);
  assert.equal(setChecked(after, item.line, false), SAMPLE_LIST);
});

test("manual adds land under Extras", () => {
  const after = addExtra(SAMPLE_LIST, "dish soap");
  const list = parseGrocery(after);
  const extras = list.categories.find((c) => /^Extras/.test(c.name))!;
  assert.deepEqual(
    extras.items.map((i) => i.text),
    ["paper towels", "dish soap"]
  );
});

test("the first manual add replaces the seeded empty bullet", () => {
  const before = fixture("grocery-list.md");
  assert.match(before, /## Extras \(manual adds\)\n\n- \n?$/);
  const after = addExtra(before, "paper towels");
  assert.ok(
    !/^\s*-\s*$/m.test(after),
    `an orphan bullet survived:\n${after}`
  );
  const list = parseGrocery(after);
  const extras = list.categories.find((c) => /^Extras/.test(c.name))!;
  assert.deepEqual(
    extras.items.map((i) => i.text),
    ["paper towels"]
  );
});

test("copy-as-text drops checked items and keeps category labels", () => {
  const text = toPlainText(parseGrocery(SAMPLE_LIST));
  assert.equal(
    text,
    ["Produce", "2 limes", "", "Meat", "1 lb ground beef", "", "Extras (manual adds)", "paper towels"].join("\n")
  );
});

test("uncheckAll resets the trip", () => {
  assert.equal(parseGrocery(uncheckAll(SAMPLE_LIST)).checked, 0);
});

/* ---------------------------------------------------------------- lists -- */

test("reads the staples file sections", () => {
  const text = fixture("staples.md");
  const titles = parseSections(text).map((s) => s.title);
  assert.ok(titles.includes("Pantry staples (always keep stocked)"));
  assert.ok(titles.includes("House staples"));
  assert.deepEqual(getSectionItems(text, "Pantry staples"), []);
});

test("setSectionItems replaces one section and leaves the prose alone", () => {
  const before = fixture("staples.md");
  const after = setSectionItems(before, "Pantry staples", [
    "olive oil",
    "rice",
    "",
  ]);
  assert.match(after, /The vault is the brain, not the shopping cart/);
  assert.deepEqual(getSectionItems(after, "Pantry staples"), [
    "olive oil",
    "rice",
  ]);
  assert.deepEqual(getSectionItems(after, "House staples"), []);
  assert.match(after, /## House staples/);
});

test("ingredient preferences come only from the per-ingredient section", () => {
  const prefs = parsePreferences(fixture("ingredient-prefs.md"));
  assert.ok(prefs.length > 0, "found some preferences");
  assert.ok(
    prefs.every((p) => p.ingredient.length < 40),
    `prose leaked in: ${prefs.map((p) => p.ingredient).join(" | ")}`
  );
  assert.ok(prefs.some((p) => p.ingredient === "ground beef"));
  assert.ok(
    !prefs.some((p) => /Avoid foods|Planner behavior|Store/.test(p.ingredient)),
    "dietary prose was parsed as an ingredient"
  );
});

test("saving preferences leaves the household's prose sections untouched", () => {
  const before = fixture("ingredient-prefs.md");
  const after = setPreferences(before, [
    { ingredient: "ground beef", preference: "Thousand Hills 70/30" },
    { ingredient: "eggs", preference: "pasture raised" },
  ]);

  // The prose sections are still there, word for word.
  assert.match(after, /## House dietary principles/);
  assert.match(after, /Avoid foods containing vegetable\/seed oils/);
  assert.match(after, /## Publix purchase-history insights/);
  assert.match(after, /Thousand Hills \(beef\)/);
  assert.match(after, /Brand and label preferences per ingredient\./);

  const prefs = parsePreferences(after);
  assert.deepEqual(
    prefs.map((p) => p.ingredient),
    ["ground beef", "eggs"]
  );

  // And the other sections kept every one of their bullets.
  const others = otherPrefSections(after);
  const principles = others.find((s) => /House dietary/.test(s.title))!;
  assert.equal(principles.items.length, 5);
});

test("restaurant order entries serialize as a dash-joined line", () => {
  assert.equal(
    orderEntryLine({
      date: "2026-07-26",
      restaurant: "Taco Bus",
      what: "al pastor",
      verdict: "yes",
    }),
    "2026-07-26 - Taco Bus - al pastor - yes"
  );
});

test("the placeholder order-history row is not shown as real history", () => {
  assert.deepEqual(parseOrderHistory(fixture("restaurants.md")), []);
});

/* ------------------------------------------------- the vault as it really is -- */

/*
 * Basic Memory reindexes the vault behind our backs. These tests pin the two
 * things that must survive it: we can still read a reindexed note, and writing
 * to one does not throw away the keys the indexer added.
 */

test("a Basic Memory reindexed recipe still parses correctly", () => {
  const r = parseRecipe("example-weeknight-tacos", fixture("recipe-reindexed.md"));
  assert.equal(r.title, "Weeknight Tacos");
  assert.deepEqual(r.tags, ["mexican", "quick", "weeknight"], "block-style YAML list");
  assert.equal(r.servings, 4);
  assert.equal(r.sourceUrl, "", "null source-url reads as empty, not the text 'null'");
  assert.equal(r.ratings.Cooper, null, "null rating reads as unrated");
  assert.equal(r.ratings.Ashlyn, null);
  assert.equal(r.favorite, false);
  assert.equal(r.ingredients.length, 2);
  assert.equal(r.comments.length, 1);
});

test("writing to a reindexed note keeps the indexer's own keys", () => {
  const before = fixture("recipe-reindexed.md");
  const after = setRating(setFavorite(before, true), "Cooper", 5);
  assert.match(after, /permalink: hq\/family\/recipes\/example-weeknight-tacos/);
  assert.match(after, /^rating-cooper: 5$/m);
  assert.match(after, /^favorite: true$/m);
  assert.match(after, /^rating-ashlyn: null$/m, "the key we did not touch is untouched");
  const r = parseRecipe("x", after);
  assert.equal(r.ratings.Cooper, 5);
  assert.equal(r.favorite, true);
});

test("the live vault parses, whatever shape the indexer left it in", { skip: !HAS_VAULT }, () => {
  const week = parseWeek(vault("Meal-Plan.md"));
  assert.ok(week.table, "Meal-Plan.md still has a readable table");
  assert.equal(week.table.rows.length, 7);

  const honeydew = parseHoneydew(vault("Honeydew.md"));
  assert.ok(Array.isArray(honeydew.tasks));

  const grocery = parseGrocery(vault("Grocery-List.md"));
  assert.ok(Array.isArray(grocery.categories));

  const prefs = parsePreferences(vault("Ingredient-Prefs.md"));
  assert.ok(
    prefs.every((p) => p.ingredient.length < 40),
    "no prose leaked into the ingredient list"
  );

  for (const slug of readdirSync(path.join(VAULT, "Recipes")).filter((f) =>
    f.endsWith(".md")
  )) {
    const r = parseRecipe(slug.slice(0, -3), vault("Recipes", slug));
    assert.ok(r.title.length > 0, `${slug} has a title`);
    assert.ok(Array.isArray(r.tags), `${slug} has readable tags`);
  }
});

/* ------------------------------------------------ imports and drafts -- */

/*
 * An imported recipe is a guess until somebody checks it. These pin the two
 * halves of that: the draft marker survives a round trip and reads correctly,
 * and publishing removes it so a published recipe is shaped exactly like one
 * typed by hand.
 */

test("a recipe with no status is live", () => {
  const recipe = parseRecipe("x", fixture("recipe.md"));
  assert.equal(recipe.status, "live");
});

test("an imported recipe reads as a draft", () => {
  const note = newRecipeNote({
    status: "draft",
    title: "Caption Tacos",
    tags: ["tiktok"],
    servings: 4,
    sourceUrl: "https://www.tiktok.com/@someone/video/123",
    ingredients: ["1 lb ground beef"],
    steps: ["Cook it."],
  });
  assert.match(note, /^---\nstatus: draft\ntitle: Caption Tacos$/m);
  const recipe = parseRecipe("caption-tacos", note);
  assert.equal(recipe.status, "draft");
  assert.equal(recipe.title, "Caption Tacos");
  assert.equal(recipe.sourceUrl, "https://www.tiktok.com/@someone/video/123");
});

test("publishing removes the status key entirely", () => {
  const draft = newRecipeNote({
    status: "draft",
    title: "Caption Tacos",
    tags: [],
    servings: 4,
    sourceUrl: "",
    ingredients: ["1 lb ground beef"],
    steps: ["Cook it."],
  });
  const live = publishRecipe(draft);
  assert.equal(parseRecipe("x", live).status, "live");
  assert.ok(!/^status:/m.test(live), "no status line survives");
  assert.equal(
    live,
    newRecipeNote({
      title: "Caption Tacos",
      tags: [],
      servings: 4,
      sourceUrl: "",
      ingredients: ["1 lb ground beef"],
      steps: ["Cook it."],
    }),
    "a published import is byte-identical to one typed by hand"
  );
});

test("editing a draft leaves it a draft", () => {
  const draft = newRecipeNote({
    status: "draft",
    title: "Caption Tacos",
    tags: [],
    servings: 4,
    sourceUrl: "",
    ingredients: ["1 lb ground beef"],
    steps: ["Cook it."],
  });
  const edited = updateRecipeNote(draft, {
    title: "Caption Tacos",
    tags: ["mexican"],
    servings: 6,
    sourceUrl: "",
    ingredients: ["1.5 lb ground beef"],
    steps: ["Cook it properly."],
  });
  assert.equal(
    parseRecipe("x", edited).status,
    "draft",
    "publishing is a separate, explicit act"
  );
  assert.equal(parseRecipe("x", edited).servings, 6);
});

test("markDraft can put a recipe back into review", () => {
  const live = fixture("recipe.md");
  assert.equal(parseRecipe("x", markDraft(live)).status, "draft");
});

test("status markers are read off the end of a reply", () => {
  const done = readStatusMarkers(
    "Imported Weeknight Tacos. Guessed the oven temperature.\n\nHOMERUN-STATUS: done\nHOMERUN-SLUG: weeknight-tacos"
  );
  assert.equal(done.status, "done");
  assert.equal(done.slug, "weeknight-tacos");
  assert.equal(
    done.text,
    "Imported Weeknight Tacos. Guessed the oven temperature.",
    "the machine lines do not reach the screen"
  );
});

test("a blocked page reports needs_browser with a reason", () => {
  const queued = readStatusMarkers(
    "TikTok returned a login wall for the page body.\nHOMERUN-STATUS: needs_browser\nHOMERUN-REASON: The page renders only through JavaScript."
  );
  assert.equal(queued.status, "needs_browser");
  assert.equal(queued.reason, "The page renders only through JavaScript.");
  assert.equal(queued.text, "TikTok returned a login wall for the page body.");
});

test("needs_login is its own outcome", () => {
  assert.equal(readStatusMarkers("HOMERUN-STATUS: needs_login").status, "needs_login");
});

test("a reply with no markers is just a reply", () => {
  const plain = readStatusMarkers("I could not find a recipe on that page.");
  assert.equal(plain.status, null);
  assert.equal(plain.text, "I could not find a recipe on that page.");
});

test("an unknown marker value is ignored rather than trusted", () => {
  assert.equal(readStatusMarkers("HOMERUN-STATUS: banana").status, null);
});

/* ------------------------------------------------------- tag taxonomy -- */

/*
 * At three hundred recipes the tag list is the navigation, so these pin the
 * two things that make it usable: a tag always lands somewhere, and selecting
 * two tags narrows rather than widens.
 */

test("tags normalize to one canonical form", () => {
  assert.equal(normalizeTag("Slow Cooker"), "crockpot");
  assert.equal(normalizeTag("slow-cooker"), "crockpot");
  assert.equal(normalizeTag("CROCK-POT"), "crockpot");
  assert.equal(normalizeTag("  Air Fryer  "), "air-fryer");
  assert.equal(normalizeTag("Ground Beef"), "ground-beef");
  assert.equal(normalizeTag("main-dish"), "dinner");
  assert.equal(normalizeTag("tiktok-import"), "tiktok-import");
  assert.equal(normalizeTag("!!!"), "");
});

test("every tag lands in a bin, and unknown ones land in Other", () => {
  assert.equal(binForTag("dinner"), "type");
  assert.equal(binForTag("italian"), "cuisine");
  assert.equal(binForTag("crockpot"), "method");
  assert.equal(binForTag("Slow Cooker"), "method", "aliases bin like their canonical");
  assert.equal(binForTag("chicken"), "protein");
  assert.equal(binForTag("tiktok-import"), "other");
  assert.equal(binForTag("prosciutto"), "other");
  assert.equal(binForTag("whatever-nobody-planned-for"), "other");
});

test("bins come back in order, populated only, most-used first", () => {
  const counts = new Map([
    ["dinner", 40],
    ["breakfast", 9],
    ["italian", 11],
    ["chicken", 22],
    ["tiktok-import", 72],
  ]);
  const bins = groupTagsIntoBins([...counts.keys()], counts);
  assert.deepEqual(
    bins.map((b) => b.key),
    ["type", "cuisine", "protein", "other"],
    "method has nothing in it, so it does not appear"
  );
  assert.deepEqual(
    bins[0].tags.map((t) => t.tag),
    ["dinner", "breakfast"],
    "within a bin the popular tag comes first"
  );
});

test("selecting two tags narrows to recipes carrying both", () => {
  const italianDinner = ["dinner", "italian", "pasta"];
  const italianLunch = ["lunch", "italian"];
  const mexicanDinner = ["dinner", "mexican"];

  assert.equal(matchesAllTags(italianDinner, ["dinner", "italian"]), true);
  assert.equal(matchesAllTags(italianLunch, ["dinner", "italian"]), false);
  assert.equal(matchesAllTags(mexicanDinner, ["dinner", "italian"]), false);
});

test("filtering by nothing matches everything", () => {
  assert.equal(matchesAllTags(["dinner"], []), true);
  assert.equal(matchesAllTags([], []), true);
});

test("filtering survives a tag written differently on the recipe", () => {
  assert.equal(
    matchesAllTags(["Slow Cooker", "Chicken"], ["crockpot", "chicken"]),
    true,
    "a recipe tagged Slow Cooker is found by the crockpot filter"
  );
});

test("replacing a key whose value spans lines takes the whole value", () => {
  // Basic Memory rewrites inline arrays into block sequences. Replacing only
  // the `tags:` line used to leave its items orphaned below the new value,
  // which broke the frontmatter and made the recipe unfindable.
  const reindexed = [
    "---",
    "title: Sriracha Salmon",
    "tags:",
    "- tiktok-import",
    "- asian",
    "- dinner",
    "servings: 2",
    "favorite: false",
    "---",
    "# Sriracha Salmon",
    "",
  ].join("\n");

  const after = setFrontmatterKey(reindexed, "tags", [
    "tiktok-import",
    "asian",
    "dinner",
    "grilling",
  ]);

  assert.match(after, /^tags: \[tiktok-import, asian, dinner, grilling\]$/m);
  assert.ok(!/^- asian$/m.test(after), "no orphaned list items survive");
  assert.match(after, /^servings: 2$/m, "the following keys are untouched");
  assert.match(after, /^title: Sriracha Salmon$/m);
  assert.match(after, /^# Sriracha Salmon$/m, "the body is untouched");

  const recipe = parseRecipe("sriracha-salmon", after);
  assert.deepEqual(recipe.tags, ["tiktok-import", "asian", "dinner", "grilling"]);
  assert.equal(recipe.servings, 2);
});

test("a single-line key is still replaced in place", () => {
  const after = setFrontmatterKey(fixture("recipe.md"), "servings", 6);
  assert.match(after, /^servings: 6$/m);
  assert.equal(parseRecipe("x", after).ingredients.length, 6);
});

/* -------------------------------------------- grocery item provenance -- */

test("a generated item carries the day and meal it came from", () => {
  const { text, sources } = parseItemSources(
    "1 lb Thousand Hills grass fed ground beef, 70/30 (M: Weeknight Tacos)"
  );
  assert.equal(text, "1 lb Thousand Hills grass fed ground beef, 70/30");
  assert.deepEqual(sources, [{ day: "M", recipe: "Weeknight Tacos" }]);
});

test("an item shared by two meals keeps both", () => {
  const { text, sources } = parseItemSources("2 limes (Tu: Tacos; Th: Chili)");
  assert.equal(text, "2 limes");
  assert.deepEqual(sources, [
    { day: "Tu", recipe: "Tacos" },
    { day: "Th", recipe: "Chili" },
  ]);
});

test("a parenthetical that is not a source stays part of the item", () => {
  // This is the one that would quietly eat half an item name.
  const { text, sources } = parseItemSources("1 lb ground beef (90/10)");
  assert.equal(text, "1 lb ground beef (90/10)");
  assert.deepEqual(sources, []);

  const organic = parseItemSources("2 cups milk (organic if they have it)");
  assert.equal(organic.text, "2 cups milk (organic if they have it)");
  assert.deepEqual(organic.sources, []);
});

test("extras and staples have no source, which is how the badge stays off", () => {
  const { text, sources } = parseItemSources("paper towels");
  assert.equal(text, "paper towels");
  assert.deepEqual(sources, []);
});

test("sources round-trip through the file format", () => {
  const sources = [
    { day: "M", recipe: "Weeknight Tacos" },
    { day: "Th", recipe: "Chili" },
  ];
  const line = `2 limes${formatItemSources(sources)}`;
  assert.equal(line, "2 limes (M: Weeknight Tacos; Th: Chili)");
  assert.deepEqual(parseItemSources(line).sources, sources);
});

test("the grocery list parses sources and copy-as-text leaves them out", () => {
  const list = parseGrocery(
    [
      "# Grocery List",
      "",
      "## Produce",
      "",
      "- [ ] 2 limes (M: Weeknight Tacos)",
      "- [ ] 1 head romaine",
      "",
      "## Extras (manual adds)",
      "",
      "- [ ] paper towels",
      "",
    ].join("\n")
  );

  const produce = list.categories.find((c) => c.name === "Produce")!;
  assert.equal(produce.items[0].text, "2 limes");
  assert.equal(produce.items[0].sources[0].day, "M");
  assert.deepEqual(produce.items[1].sources, [], "an unannotated item has none");

  const extras = list.categories.find((c) => /^Extras/.test(c.name))!;
  assert.deepEqual(extras.items[0].sources, []);

  assert.ok(
    !toPlainText(list).includes("Weeknight Tacos"),
    "the annotation is for the app, not for whoever reads this in a shop"
  );
  assert.ok(toPlainText(list).includes("2 limes"));
});

/* ------------------------------------------------ threads and shop rules -- */

test("thread turns round-trip", () => {
  const line = formatEntry("2026-07-27", "Ashlyn", "we only get butter from Costco");
  assert.equal(line, "- 2026-07-27 (Ashlyn): we only get butter from Costco");
  const [entry] = parseThread(line);
  assert.equal(entry.author, "Ashlyn");
  assert.equal(entry.text, "we only get butter from Costco");
  assert.equal(entry.awaitingAnswer, false);
});

test("a turn is one line even when the note has newlines in it", () => {
  const line = formatEntry("2026-07-27", "Cooper", "too much\nchicken\nlately");
  assert.equal(line.split("\n").length, 1);
  assert.equal(parseThread(line)[0].text, "too much chicken lately");
});

test("a question Claude asks is marked and found", () => {
  const thread = [
    "- 2026-07-27 (Ashlyn): stop buying so much chicken",
    "- 2026-07-27 (Claude) [awaiting-answer]: less each time, or less often?",
  ].join("\n");
  const entries = parseThread(thread);
  assert.equal(entries[1].awaitingAnswer, true);
  assert.deepEqual(
    unansweredQuestions(entries).map((e) => e.text),
    ["less each time, or less often?"]
  );
});

test("a question stops waiting once a person replies", () => {
  const answered = parseThread(
    [
      "- 2026-07-27 (Claude) [awaiting-answer]: less each time, or less often?",
      "- 2026-07-27 (Ashlyn): less often",
    ].join("\n")
  );
  assert.deepEqual(unansweredQuestions(answered), []);

  const claudeTalkingToItself = parseThread(
    [
      "- 2026-07-27 (Claude) [awaiting-answer]: less each time, or less often?",
      "- 2026-07-27 (Claude): still waiting on that one",
    ].join("\n")
  );
  assert.equal(
    unansweredQuestions(claudeTalkingToItself).length,
    1,
    "Claude answering itself does not count"
  );
});

test("an item bought elsewhere carries its shop and stays pre-checked", () => {
  const list = parseGrocery(
    [
      "# Grocery List",
      "",
      "## Dairy",
      "",
      "- [x] 1 lb butter (M: Pancakes) [Costco]",
      "- [ ] 1 quart milk (M: Pancakes)",
      "",
    ].join("\n")
  );
  const dairy = list.categories[0];

  assert.equal(dairy.items[0].text, "1 lb butter");
  assert.equal(dairy.items[0].store, "Costco");
  assert.equal(dairy.items[0].checked, true, "already handled, so already ticked");
  assert.deepEqual(dairy.items[0].sources, [{ day: "M", recipe: "Pancakes" }]);

  assert.equal(dairy.items[1].store, "", "an ordinary item has no shop");
});

test("the shop survives copy-as-text but the meal annotation does not", () => {
  const list = parseGrocery(
    [
      "## Dairy",
      "",
      "- [ ] 1 lb butter (M: Pancakes) [Costco]",
      "- [ ] 1 quart milk (M: Pancakes)",
      "",
    ].join("\n")
  );
  const plain = toPlainText(list);
  assert.ok(plain.includes("1 lb butter [Costco]"), "the aisle needs to know");
  assert.ok(!plain.includes("M: Pancakes"), "the meal annotation does not");
});

test("a bracket that is not a shop is left alone", () => {
  const { text, store } = parseItemStore("1 lb butter [see note]");
  assert.equal(store, "see note");
  assert.equal(text, "1 lb butter");
  // Nothing bracket-shaped in the middle is touched.
  const mid = parseItemStore("1 lb [organic] butter");
  assert.equal(mid.store, "");
  assert.equal(mid.text, "1 lb [organic] butter");
});
