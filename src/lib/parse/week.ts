/**
 * The Meal-Plan table.
 *
 * Meal-Plan.md is a markdown table with a Day column and one column per meal.
 * We parse it into a grid, and when we write we rewrite ONLY the data rows:
 * the frontmatter, the heading, the grammar note above the table and the
 * header/separator rows are handed straight back unchanged.
 */

import {
  asDateString,
  fromLines,
  readDoc,
  setFrontmatterKey,
  toLines,
} from "../md.ts";
import { parseMeal, type Meal } from "../meal.ts";

export type { Meal, MealKind } from "../meal.ts";
export { parseMeal, serializeMeal } from "../meal.ts";

export interface WeekRow {
  /** The Day column, e.g. "Mon 7/27". */
  day: string;
  /** One entry per non-Day column, in header order. */
  cells: Meal[];
}

export interface WeekTable {
  /** Column headers including "Day", e.g. ["Day","Breakfast","Lunch","Dinner","Notes"]. */
  headers: string[];
  rows: WeekRow[];
  /** Line index of the header row within the file. */
  headerLine: number;
  /** Line index of the first data row. */
  firstDataLine: number;
  /** One past the last data row. */
  lastDataLine: number;
}

export interface Week {
  weekOf: string;
  title: string;
  table: WeekTable | null;
}

function splitRow(line: string): string[] {
  // Split on unescaped pipes, dropping the leading and trailing delimiters.
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      current += "|";
      i += 1;
    } else if (ch === "|") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  if (cells.length >= 2) {
    cells.shift();
    cells.pop();
  }
  return cells.map((c) => c.trim());
}

/**
 * Renders a row the way the vault file already renders it: one space of
 * padding around non-empty cells, a bare space for empty ones. Keeping this
 * byte-identical is what stops a save from producing a noisy Obsidian diff.
 */
function joinRow(cells: string[]): string {
  const escaped = cells.map((c) => c.replace(/\|/g, "\\|").trim());
  return `|${escaped.map((c) => (c === "" ? " " : ` ${c} `)).join("|")}|`;
}

function isSeparator(line: string): boolean {
  return /^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes("-");
}

function isTableLine(line: string): boolean {
  return /^\s*\|/.test(line);
}

/** Finds the meal grid: the first pipe table whose first header cell is "Day". */
export function parseTable(text: string): WeekTable | null {
  const lines = toLines(text);
  for (let i = 0; i < lines.length; i += 1) {
    if (!isTableLine(lines[i])) continue;
    const headers = splitRow(lines[i]);
    if (headers.length < 2 || headers[0].toLowerCase() !== "day") continue;
    if (i + 1 >= lines.length || !isSeparator(lines[i + 1])) continue;

    const firstDataLine = i + 2;
    let end = firstDataLine;
    while (end < lines.length && isTableLine(lines[end])) end += 1;

    const rows: WeekRow[] = [];
    for (let r = firstDataLine; r < end; r += 1) {
      const cells = splitRow(lines[r]);
      const padded = [...cells];
      while (padded.length < headers.length) padded.push("");
      rows.push({
        day: padded[0],
        cells: padded.slice(1, headers.length).map(parseMeal),
      });
    }
    return { headers, rows, headerLine: i, firstDataLine, lastDataLine: end };
  }
  return null;
}

export function parseWeek(text: string): Week {
  const { data } = readDoc(text);
  const lines = toLines(text);
  const titleLine = lines.find((l) => /^#\s+/.test(l)) ?? "";
  return {
    weekOf: asDateString(data["week-of"]),
    title: titleLine.replace(/^#\s+/, "").trim(),
    table: parseTable(text),
  };
}

/** Rewrites the table's data rows in place, leaving every other line alone. */
export function writeRows(
  text: string,
  rows: { day: string; cells: string[] }[]
): string {
  const table = parseTable(text);
  if (!table) throw new Error("No meal-plan table found in this note");
  const lines = toLines(text);
  const rendered = rows.map((row) => {
    const cells = [row.day, ...row.cells];
    while (cells.length < table.headers.length) cells.push("");
    return joinRow(cells.slice(0, table.headers.length));
  });
  return fromLines([
    ...lines.slice(0, table.firstDataLine),
    ...rendered,
    ...lines.slice(table.lastDataLine),
  ]);
}

/** Sets one cell (row index, column index among the non-Day columns). */
export function setCell(
  text: string,
  rowIndex: number,
  colIndex: number,
  value: string
): string {
  const table = parseTable(text);
  if (!table) throw new Error("No meal-plan table found in this note");
  const rows = table.rows.map((r, i) => ({
    day: r.day,
    cells: r.cells.map((c, j) =>
      i === rowIndex && j === colIndex ? value : c.raw.trim()
    ),
  }));
  if (rowIndex < 0 || rowIndex >= rows.length) {
    throw new Error(`Row ${rowIndex} is out of range`);
  }
  if (colIndex < 0 || colIndex >= table.headers.length - 1) {
    throw new Error(`Column ${colIndex} is out of range`);
  }
  return writeRows(text, rows);
}

/** Copies the meal cells out of a template or draft, keeping the target's days. */
export function applyGrid(text: string, source: WeekTable): string {
  const table = parseTable(text);
  if (!table) throw new Error("No meal-plan table found in this note");
  const rows = table.rows.map((row, i) => {
    const from = source.rows[i];
    return {
      day: row.day,
      cells: row.cells.map((cell, j) =>
        from ? (from.cells[j]?.raw ?? "").trim() : cell.raw.trim()
      ),
    };
  });
  return writeRows(text, rows);
}

/** Retitles a week note and stamps its `week-of` frontmatter. */
export function setWeekOf(text: string, weekOf: string): string {
  const withFm = setFrontmatterKey(text, "week-of", weekOf);
  const lines = toLines(withFm);
  const idx = lines.findIndex((l) => /^#\s+Meal Plan\b/.test(l));
  if (idx >= 0) lines[idx] = `# Meal Plan - week of ${weekOf}`;
  return fromLines(lines);
}

/** A blank week note in the exact shape of the seeded Meal-Plan.md. */
export function blankWeekNote(weekOf: string, dayLabels: string[]): string {
  const headers = ["Day", "Breakfast", "Lunch", "Dinner", "Notes"];
  return [
    "---",
    `week-of: ${weekOf}`,
    "---",
    `# Meal Plan - week of ${weekOf}`,
    "",
    'Cell grammar: a dish name, a [[recipe-link]], "Leftovers", or "Restaurant: name".',
    'Add the cook in parens: "Tacos (Ashlyn)". Blanks are fine.',
    "",
    `| ${headers.join(" | ")} |`,
    `|${headers.map((h) => "-".repeat(Math.max(3, h.length + 2))).join("|")}|`,
    ...dayLabels.map((d) => joinRow([d, "", "", "", ""])),
    "",
  ].join("\n");
}

/** Dinner cells for the whole week, for the digest-style summary on the home tab. */
export function dinners(table: WeekTable | null): { day: string; meal: Meal }[] {
  if (!table) return [];
  const idx = table.headers
    .slice(1)
    .findIndex((h) => h.toLowerCase() === "dinner");
  if (idx < 0) return [];
  return table.rows.map((r) => ({ day: r.day, meal: r.cells[idx] }));
}
