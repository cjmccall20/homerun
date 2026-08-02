/**
 * Grocery-List.md.
 *
 * A generated list: `## Category` headings, `- [ ] item` under each, plus a
 * `## Extras (manual adds)` section people type into by hand. Checking a box
 * rewrites exactly one character on exactly one line, which matters because
 * two phones are often looking at this file in the same aisle.
 */

import {
  appendToSectionByTitle,
  asDateString,
  findSection,
  fromLines,
  readDoc,
  sections,
  toLines,
} from "../md.ts";

export interface ItemSource {
  /** M, T, W, Th, F, Sa, Su. */
  day: string;
  recipe: string;
}

export interface GroceryItem {
  line: number;
  checked: boolean;
  /** The item itself, with the annotations removed. */
  text: string;
  category: string;
  /** Which meals put this on the list. Empty for extras and staples. */
  sources: ItemSource[];
  /**
   * Where this is bought, when it is not the usual shop. "Costco" means it is
   * already handled elsewhere: it prints pre-checked and is never sent to the
   * Publix cart.
   */
  store: string;
}

export interface GroceryCategory {
  name: string;
  items: GroceryItem[];
}

export interface GroceryList {
  generatedFrom: string;
  generatedOn: string;
  categories: GroceryCategory[];
  total: number;
  checked: number;
}

const ITEM_RE = /^(\s*)-\s+\[( |x|X)\]\s?(.*)$/;

/*
 * Generated items say where they came from, in a trailing parenthetical:
 *
 *   - [ ] 1 lb ground beef (M: Weeknight Tacos)
 *   - [ ] 2 limes (Tu: Tacos; Th: Chili)
 *
 * It has to survive being read in Obsidian by a person, so it is a plain
 * parenthetical rather than a machine format. Manual adds and staples carry
 * nothing, which is what makes "no badge" mean "not from a meal".
 */
const DAYS = ["M", "Tu", "T", "W", "Th", "F", "Sa", "Su"];
const SOURCE_RE = /\s*\(([^()]*)\)\s*$/;
const PAIR_RE = /^([A-Za-z]{1,2}):\s*(.+)$/;

/*
 * A store in square brackets at the very end marks an item that comes from
 * somewhere other than the usual shop:
 *
 *   - [x] 1 lb butter (M: Pancakes) [Costco]
 *
 * Brackets rather than parentheses so it cannot be confused with the meal
 * annotation or with a description like "(90/10)". Items marked this way are
 * written pre-checked, because they are already taken care of.
 */
const STORE_RE = /\s*\[([A-Za-z][A-Za-z0-9 '&.-]{0,30})\]\s*$/;

export function parseItemStore(raw: string): { text: string; store: string } {
  const match = STORE_RE.exec(raw);
  if (!match) return { text: raw.trim(), store: "" };
  return { text: raw.slice(0, match.index).trim(), store: match[1].trim() };
}

export function parseItemSources(raw: string): {
  text: string;
  sources: ItemSource[];
} {
  const match = SOURCE_RE.exec(raw);
  if (!match) return { text: raw.trim(), sources: [] };

  const sources: ItemSource[] = [];
  for (const part of match[1].split(";")) {
    const pair = PAIR_RE.exec(part.trim());
    if (!pair) continue;
    const day = normalizeDay(pair[1]);
    if (!day) continue;
    sources.push({ day, recipe: pair[2].trim() });
  }

  // A parenthetical that is not a source annotation belongs to the item:
  // "1 lb ground beef (90/10)" is a description, not a meal.
  if (sources.length === 0) return { text: raw.trim(), sources: [] };
  return { text: raw.slice(0, match.index).trim(), sources };
}

function normalizeDay(raw: string): string {
  const cleaned = raw.trim();
  const exact = DAYS.find((d) => d.toLowerCase() === cleaned.toLowerCase());
  return exact ?? "";
}

/** Renders the annotation back, for writing an item with its source. */
export function formatItemSources(sources: ItemSource[]): string {
  if (sources.length === 0) return "";
  return ` (${sources.map((s) => `${s.day}: ${s.recipe}`).join("; ")})`;
}

export function formatItemStore(store: string): string {
  return store.trim() ? ` [${store.trim()}]` : "";
}

export const EXTRAS_HEADING = "## Extras (manual adds)";

export function parseGrocery(text: string): GroceryList {
  const { data } = readDoc(text);
  const lines = toLines(text);
  const heads = sections(lines).filter((s) => s.level >= 2);

  const categories: GroceryCategory[] = [];
  let total = 0;
  let checked = 0;

  for (const head of heads) {
    const items: GroceryItem[] = [];
    for (let i = head.start; i < head.end && i < lines.length; i += 1) {
      const m = ITEM_RE.exec(lines[i]);
      if (!m) continue;
      const itemText = m[3].trim();
      if (itemText === "") continue;
      const isChecked = m[2].toLowerCase() === "x";
      // Store first: it sits outermost, after the meal annotation.
      const withStore = parseItemStore(itemText);
      const parsed = parseItemSources(withStore.text);
      items.push({
        line: i,
        checked: isChecked,
        text: parsed.text,
        category: head.title,
        sources: parsed.sources,
        store: withStore.store,
      });
      total += 1;
      if (isChecked) checked += 1;
    }
    if (items.length > 0 || /^extras/i.test(head.title)) {
      categories.push({ name: head.title, items });
    }
  }

  return {
    generatedFrom: asDateString(data["generated-from"]),
    generatedOn: asDateString(data["generated-on"]),
    categories,
    total,
    checked,
  };
}

/** Flips one checkbox, identified by line number. */
export function setChecked(
  text: string,
  lineNumber: number,
  checked: boolean
): string {
  const lines = toLines(text);
  const line = lines[lineNumber];
  if (line === undefined || !ITEM_RE.test(line)) {
    throw new Error(`Line ${lineNumber} is not a grocery item`);
  }
  const next = [...lines];
  next[lineNumber] = line.replace(
    /-\s+\[( |x|X)\]/,
    `- [${checked ? "x" : " "}]`
  );
  return fromLines(next);
}

export function addExtra(text: string, item: string): string {
  const clean = item.replace(/\s+/g, " ").trim();
  if (!clean) return text;
  return appendToSectionByTitle(text, "Extras", EXTRAS_HEADING, [
    `- [ ] ${clean}`,
  ]);
}

export function removeItem(text: string, lineNumber: number): string {
  const lines = toLines(text);
  if (!ITEM_RE.test(lines[lineNumber] ?? "")) {
    throw new Error(`Line ${lineNumber} is not a grocery item`);
  }
  return fromLines(lines.filter((_, i) => i !== lineNumber));
}

/** Unchecks everything, for starting a fresh trip on the same list. */
export function uncheckAll(text: string): string {
  return fromLines(
    toLines(text).map((l) =>
      ITEM_RE.test(l) ? l.replace(/-\s+\[[xX]\]/, "- [ ]") : l
    )
  );
}

/**
 * Plain text for pasting into Apple Reminders or a store app: one item per
 * line, category headings kept as bare labels, checked items dropped.
 */
export function toPlainText(list: GroceryList): string {
  const out: string[] = [];
  for (const cat of list.categories) {
    const remaining = cat.items.filter((i) => !i.checked);
    if (remaining.length === 0) continue;
    out.push(cat.name);
    for (const item of remaining) {
      // The meal annotation is for the app. The store is not: somebody
      // reading this in an aisle needs to know an item is bought elsewhere.
      out.push(item.store ? `${item.text} [${item.store}]` : item.text);
    }
    out.push("");
  }
  return out.join("\n").trim();
}

/** A fresh list file. Used when nothing exists yet. */
export function blankGroceryList(): string {
  return [
    "---",
    "generated-from:",
    "generated-on:",
    "---",
    "# Grocery List",
    "",
    'Nothing generated yet. Ask Claude ("build this week\'s grocery list") or use the',
    "HomeRun app's Generate button once the week is planned.",
    "",
    EXTRAS_HEADING,
    "",
  ].join("\n");
}

/** True when the file still holds only the seeded placeholder. */
export function isEmptyList(list: GroceryList): boolean {
  return list.total === 0;
}

/** Keeps the `## Extras` section, replaces everything else. Used after generate. */
export function extrasSection(text: string): string[] {
  const lines = toLines(text);
  const section = findSection(lines, "Extras");
  if (!section) return [];
  return lines
    .slice(section.start, section.end)
    .filter((l) => ITEM_RE.test(l) && ITEM_RE.exec(l)![3].trim() !== "");
}
