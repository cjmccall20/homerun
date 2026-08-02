/**
 * Surgical markdown editing.
 *
 * The vault files are read by humans in Obsidian, so a write must never
 * re-serialize a whole document. Every helper here works on the original array
 * of lines and touches only the lines it was asked to touch: the prose, the
 * comments, the spacing and the key order all survive a round trip untouched.
 *
 * Reading is done with gray-matter (tolerant), writing is done line by line.
 */

import matter from "gray-matter";

export type Frontmatter = Record<string, unknown>;

export function toLines(text: string): string[] {
  return text.split("\n");
}

export function fromLines(lines: string[]): string {
  return lines.join("\n");
}

/** Reads frontmatter and body. Never throws on malformed YAML. */
export function readDoc(text: string): { data: Frontmatter; body: string } {
  try {
    const parsed = matter(text);
    return { data: (parsed.data ?? {}) as Frontmatter, body: parsed.content };
  } catch {
    return { data: {}, body: stripFrontmatter(text) };
  }
}

function stripFrontmatter(text: string): string {
  const lines = toLines(text);
  const range = frontmatterRange(lines);
  if (!range) return text;
  return fromLines(lines.slice(range.end + 1));
}

/** Indices of the opening and closing `---` lines, if the file has frontmatter. */
export function frontmatterRange(
  lines: string[]
): { start: number; end: number } | null {
  if (lines.length === 0 || lines[0].trim() !== "---") return null;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") return { start: 0, end: i };
  }
  return null;
}

const NEEDS_QUOTES =
  /^\s|\s$|^$|^[-?:,[\]{}#&*!|>'"%@`]|:\s|#\s|^(true|false|null|yes|no|on|off)$/i;

export function formatYamlValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const inner = value.map((v) => formatYamlScalarInline(String(v)));
    return `[${inner.join(", ")}]`;
  }
  const s = String(value);
  if (s === "") return "";
  if (NEEDS_QUOTES.test(s) || /^-?\d+(\.\d+)?$/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

function formatYamlScalarInline(s: string): string {
  if (s === "" || /[,[\]{}:"']/.test(s) || /^\s|\s$/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

/**
 * Sets a single frontmatter key, rewriting exactly one line (or appending one).
 * Creates a frontmatter block if the file has none.
 */
export function setFrontmatterKey(
  text: string,
  key: string,
  value: unknown
): string {
  const lines = toLines(text);
  const formatted = formatYamlValue(value);
  const newLine = formatted === "" ? `${key}:` : `${key}: ${formatted}`;
  const range = frontmatterRange(lines);

  if (!range) {
    return fromLines(["---", newLine, "---", ...lines]);
  }

  const keyRe = new RegExp(`^${escapeRegExp(key)}\\s*:`);
  for (let i = range.start + 1; i < range.end; i += 1) {
    if (!keyRe.test(lines[i])) continue;
    /*
     * A YAML value can span lines. Basic Memory reindexes the vault and
     * rewrites `tags: [a, b]` into a block sequence, so replacing only the
     * `tags:` line leaves its `- a` / `- b` items orphaned below the new
     * value and the frontmatter stops parsing. Take the continuation lines
     * with it.
     */
    let end = i + 1;
    while (end < range.end && isContinuation(lines[end])) end += 1;
    const next = [...lines.slice(0, i), newLine, ...lines.slice(end)];
    return fromLines(next);
  }
  const next = [...lines];
  next.splice(range.end, 0, newLine);
  return fromLines(next);
}

/**
 * Deletes a frontmatter key entirely. Publishing a draft removes `status`
 * rather than setting it to "live", so a published recipe is byte-identical in
 * shape to one typed by hand, and "has a status key" stays a reliable test for
 * "is a draft".
 */
export function removeFrontmatterKey(text: string, key: string): string {
  const lines = toLines(text);
  const range = frontmatterRange(lines);
  if (!range) return text;
  const keyRe = new RegExp(`^${escapeRegExp(key)}\\s*:`);
  for (let i = range.start + 1; i < range.end; i += 1) {
    if (keyRe.test(lines[i])) {
      return fromLines(lines.filter((_, j) => j !== i));
    }
  }
  return text;
}

/** A line that belongs to the key above it rather than starting a new one. */
function isContinuation(line: string): boolean {
  if (line.trim() === "" || line.trim() === "---") return false;
  if (/^[A-Za-z0-9_.-]+\s*:/.test(line)) return false;
  return /^\s/.test(line) || /^-\s/.test(line);
}

export function setFrontmatterKeys(
  text: string,
  entries: Record<string, unknown>
): string {
  let out = text;
  for (const [key, value] of Object.entries(entries)) {
    out = setFrontmatterKey(out, key, value);
  }
  return out;
}

export interface Section {
  /** Index of the heading line itself. */
  heading: number;
  /** First content line after the heading. */
  start: number;
  /** One past the last content line (exclusive). */
  end: number;
  level: number;
  title: string;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/** Every ATX heading in the document, with its content range. */
export function sections(lines: string[]): Section[] {
  const found: { index: number; level: number; title: string }[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*```/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    const m = HEADING_RE.exec(lines[i]);
    if (m) found.push({ index: i, level: m[1].length, title: m[2].trim() });
  }

  return found.map((h, idx) => {
    let end = lines.length;
    for (let j = idx + 1; j < found.length; j += 1) {
      if (found[j].level <= h.level) {
        end = found[j].index;
        break;
      }
    }
    return {
      heading: h.index,
      start: h.index + 1,
      end,
      level: h.level,
      title: h.title,
    };
  });
}

/** Finds a section whose title starts with `titlePrefix` (case-insensitive). */
export function findSection(
  lines: string[],
  titlePrefix: string
): Section | null {
  const needle = titlePrefix.trim().toLowerCase();
  return (
    sections(lines).find((s) => s.title.toLowerCase().startsWith(needle)) ?? null
  );
}

function trimTrailing(block: string[]): string[] {
  const out = [...block];
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  return out;
}

function trimBlanks(block: string[]): string[] {
  const out = trimTrailing(block);
  while (out.length > 0 && out[0].trim() === "") out.shift();
  return out;
}

/** Replaces a section's content, keeping the heading and the blank line after it. */
export function replaceSectionContent(
  lines: string[],
  section: Section,
  content: string[]
): string[] {
  const body = trimBlanks(content);
  const leading = body.length > 0 ? [""] : [];
  /*
   * Always emit a trailing blank. Mid-document it is the gap before the next
   * heading; at the end of the file it is the final newline, which POSIX tools
   * and Obsidian both expect and whose absence shows up as a spurious
   * "\ No newline at end of file" in every future diff.
   */
  const trailing = [""];
  return [
    ...lines.slice(0, section.start),
    ...leading,
    ...body,
    ...trailing,
    ...lines.slice(section.end),
  ];
}

/** A seeded placeholder like `- ` with nothing after the dash. */
function isEmptyBullet(line: string): boolean {
  return /^\s*[-*]\s*$/.test(line);
}

/**
 * Appends lines to the end of a section's content, absorbing the empty `- `
 * placeholder the seeded vault notes carry so the first real item does not
 * arrive underneath an orphan bullet.
 */
export function appendToSection(
  lines: string[],
  section: Section,
  added: string[]
): string[] {
  const existing = trimBlanks(lines.slice(section.start, section.end)).filter(
    (l) => !isEmptyBullet(l)
  );
  return replaceSectionContent(lines, section, [...existing, ...added]);
}

/**
 * Appends to a section, creating it at the end of the document if it is
 * missing. Returns the whole document text.
 */
export function appendToSectionByTitle(
  text: string,
  titlePrefix: string,
  heading: string,
  added: string[]
): string {
  const lines = toLines(text);
  const section = findSection(lines, titlePrefix);
  if (section) return fromLines(appendToSection(lines, section, added));

  const trimmed = trimTrailing(lines);
  return fromLines([...trimmed, "", heading, "", ...added, ""]);
}

/** Bullet list items (`- text`) in a range, with their absolute line numbers. */
export function bulletItems(
  lines: string[],
  from: number,
  to: number
): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  for (let i = from; i < to && i < lines.length; i += 1) {
    const m = /^\s*[-*]\s+(.*)$/.exec(lines[i]);
    if (m && m[1].trim() !== "") out.push({ line: i, text: m[1].trim() });
  }
  return out;
}

/**
 * YAML silently upgrades `week-of: 2026-07-27` into a Date, which then
 * stringifies to a UTC timestamp and shifts the day. Every date-ish
 * frontmatter value goes through here on the way in.
 */
export function asDateString(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "string") return value.trim();
  return "";
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Obsidian-safe slug for a note filename. */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "untitled"
  );
}
