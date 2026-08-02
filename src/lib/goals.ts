/**
 * Daily goals.
 *
 * Each day gets one note, `Goals/YYYY-MM-DD.md`, with a section per person and
 * one goal per checkbox line. "Productive" in this house means these boxes got
 * checked, so the file is deliberately tiny: what would make today a good day,
 * written the night before or over coffee, ticked off as it happens, and read
 * out at dinner.
 *
 * Pure string -> string transforms, no Node imports, so the same module runs
 * in the browser, the server, and the test runner. Everything line-based:
 * a goal is addressed by (person, index among that person's goals), which
 * survives Basic Memory's habit of rewriting whitespace and frontmatter.
 */

import { PEOPLE, type Who } from "./people.ts";

export interface Goal {
  text: string;
  done: boolean;
}

export type GoalsByPerson = Record<string, Goal[]>;

const GOAL_RE = /^\s*-\s*\[([ xX])\]\s*(.*)$/;
const SECTION_RE = /^##\s+(.+?)\s*$/;

/** The note a date starts with: a section per person, ready for bullets. */
export function blankGoals(date: string): string {
  const sections = PEOPLE.map((p) => `## ${p}\n`).join("\n");
  return [
    `# Goals - ${date}`,
    "",
    "What would make this a productive day. One goal per line; check it off",
    "when it is done. Talked over at dinner.",
    "",
    sections,
  ].join("\n");
}

/** Every goal in the note, grouped by the section it sits under. */
export function parseGoals(text: string): GoalsByPerson {
  const out: GoalsByPerson = {};
  for (const person of PEOPLE) out[person] = [];

  let current: string | null = null;
  for (const raw of (text || "").split("\n")) {
    const section = SECTION_RE.exec(raw);
    if (section) {
      current = section[1].trim();
      if (!(current in out)) out[current] = [];
      continue;
    }
    if (!current) continue;
    const goal = GOAL_RE.exec(raw);
    if (!goal) continue;
    const body = goal[2].trim();
    if (!body) continue;
    out[current].push({ text: body, done: goal[1] !== " " });
  }
  return out;
}

/**
 * The line index of the Nth goal in a person's section, or -1.
 * Shared by every transform so "which line is goal 2" has one answer.
 */
function goalLine(lines: string[], person: string, index: number): number {
  let inSection = false;
  let seen = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const section = SECTION_RE.exec(lines[i]);
    if (section) {
      inSection = section[1].trim() === person;
      continue;
    }
    if (!inSection) continue;
    const goal = GOAL_RE.exec(lines[i]);
    if (!goal || !goal[2].trim()) continue;
    if (seen === index) return i;
    seen += 1;
  }
  return -1;
}

/** The bounds of a person's section: [after heading, before next heading). */
function sectionBounds(lines: string[], person: string): [number, number] | null {
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const section = SECTION_RE.exec(lines[i]);
    if (section && section[1].trim() === person) {
      start = i + 1;
      continue;
    }
    if (section && start >= 0) return [start, i];
  }
  return start >= 0 ? [start, lines.length] : null;
}

/**
 * Appends one goal to a person's section, creating the section at the end of
 * the file if the note predates that person.
 */
export function addGoal(text: string, person: Who | string, goal: string): string {
  const clean = goal.replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("A goal needs some text.");

  const lines = text.split("\n");
  const bounds = sectionBounds(lines, String(person));
  const line = `- [ ] ${clean}`;

  if (!bounds) {
    const trimmed = text.replace(/\n+$/, "");
    return `${trimmed}\n\n## ${person}\n\n${line}\n`;
  }

  // Insert after the last goal in the section, or right after the heading,
  // so prose that grows below the list later stays below the list.
  let insertAt = bounds[0];
  for (let i = bounds[0]; i < bounds[1]; i += 1) {
    if (GOAL_RE.test(lines[i])) insertAt = i + 1;
  }
  if (insertAt === bounds[0]) {
    while (insertAt < bounds[1] && lines[insertAt].trim() === "") insertAt += 1;
  }
  lines.splice(insertAt, 0, line);
  return lines.join("\n");
}

/** Checks or unchecks one goal. */
export function setGoalDone(
  text: string,
  person: Who | string,
  index: number,
  done: boolean
): string {
  const lines = text.split("\n");
  const at = goalLine(lines, String(person), index);
  if (at < 0) throw new Error("That goal is not in the file any more.");
  lines[at] = lines[at].replace(/\[([ xX])\]/, done ? "[x]" : "[ ]");
  return lines.join("\n");
}

/** Removes one goal outright. */
export function removeGoal(text: string, person: Who | string, index: number): string {
  const lines = text.split("\n");
  const at = goalLine(lines, String(person), index);
  if (at < 0) throw new Error("That goal is not in the file any more.");
  lines.splice(at, 1);
  return lines.join("\n");
}

/** Rewords one goal, keeping its checked state. */
export function editGoal(
  text: string,
  person: Who | string,
  index: number,
  next: string
): string {
  const clean = next.replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("A goal needs some text.");
  const lines = text.split("\n");
  const at = goalLine(lines, String(person), index);
  if (at < 0) throw new Error("That goal is not in the file any more.");
  const match = GOAL_RE.exec(lines[at]);
  lines[at] = `- [${match ? match[1] : " "}] ${clean}`;
  return lines.join("\n");
}
