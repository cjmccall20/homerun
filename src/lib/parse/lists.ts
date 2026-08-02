/**
 * The simple bullet-list notes: Groceries-and-Staples, Restaurants,
 * Ingredient-Prefs.
 *
 * All three are "headings with bullets under them". The editors here read a
 * named section into a textarea and write that one section back, so the
 * how-this-works prose at the top of Groceries-and-Staples.md never moves.
 */

import {
  appendToSectionByTitle,
  bulletItems,
  findSection,
  fromLines,
  replaceSectionContent,
  sections,
  toLines,
} from "../md.ts";

export interface ListSection {
  title: string;
  items: string[];
}

/** Every level-2 section with its bullet items. */
export function parseSections(text: string): ListSection[] {
  const lines = toLines(text);
  const out: ListSection[] = [];
  for (const section of sections(lines).filter((s) => s.level === 2)) {
    out.push({
      title: section.title,
      items: bulletItems(lines, section.start, section.end).map((b) => b.text),
    });
  }
  return out;
}

export function getSectionItems(text: string, titlePrefix: string): string[] {
  const lines = toLines(text);
  const section = findSection(lines, titlePrefix);
  if (!section) return [];
  return bulletItems(lines, section.start, section.end).map((b) => b.text);
}

/** Replaces a section's bullets wholesale. Empty lines are dropped. */
export function setSectionItems(
  text: string,
  titlePrefix: string,
  items: string[]
): string {
  const lines = toLines(text);
  const section = findSection(lines, titlePrefix);
  const clean = items.map((i) => i.trim()).filter((i) => i !== "");
  const rendered = clean.length ? clean.map((i) => `- ${i}`) : ["- "];
  if (!section) {
    return fromLines([...lines, "", `## ${titlePrefix}`, "", ...rendered, ""]);
  }
  return fromLines(replaceSectionContent(lines, section, rendered));
}

export function appendSectionItem(
  text: string,
  titlePrefix: string,
  heading: string,
  item: string
): string {
  const clean = item.replace(/\s+/g, " ").trim();
  if (!clean) return text;
  return appendToSectionByTitle(text, titlePrefix, heading, [`- ${clean}`]);
}

/* --- Ingredient preferences: `- ingredient: preferred brand (notes)` ------ */

export interface Preference {
  ingredient: string;
  preference: string;
}

/**
 * The heading the app owns. Everything else in Ingredient-Prefs.md is prose
 * the household wrote (dietary principles, Publix purchase-history notes) and
 * the editor must never touch it: scanning every bullet in the file would have
 * turned "Prefer organic when possible" into an ingredient called "Prefer
 * organic when and where possible, even at a premium".
 */
export const PREFS_SECTION = "Per-ingredient preferences";

function toPreference(raw: string): Preference | null {
  const idx = raw.indexOf(":");
  if (idx <= 0) return null;
  const ingredient = raw.slice(0, idx).trim();
  const preference = raw.slice(idx + 1).trim();
  return ingredient ? { ingredient, preference } : null;
}

export function parsePreferences(text: string): Preference[] {
  const lines = toLines(text);
  const section = findSection(lines, PREFS_SECTION);
  const raw = section
    ? bulletItems(lines, section.start, section.end)
    : // Older flat format: prose then bullets, no headings at all.
      sections(lines).length > 1
      ? []
      : bulletItems(lines, 0, lines.length);
  return raw
    .map((b) => toPreference(b.text))
    .filter((p): p is Preference => p !== null);
}

/** The other sections, shown read-only so the context is visible in the app. */
export function otherPrefSections(text: string): ListSection[] {
  return parseSections(text).filter((s) => s.title !== PREFS_SECTION);
}

/** Replaces only the per-ingredient bullets. */
export function setPreferences(text: string, prefs: Preference[]): string {
  return setSectionItems(text, PREFS_SECTION, serializePreferences(prefs));
}

export function serializePreferences(prefs: Preference[]): string[] {
  return prefs
    .filter((p) => p.ingredient.trim() !== "")
    .map((p) => `${p.ingredient.trim()}: ${p.preference.trim()}`);
}

/* --- Restaurants ---------------------------------------------------------- */

export const RESTAURANT_FAVORITES = "Favorites";
export const RESTAURANT_HISTORY = "Order history";

export interface OrderEntry {
  date: string;
  restaurant: string;
  what: string;
  verdict: string;
}

const PLACEHOLDER_DATE = /^yyyy-mm-dd$/i;

export function parseOrderHistory(text: string): OrderEntry[] {
  return getSectionItems(text, RESTAURANT_HISTORY)
    .map((raw) => {
      const parts = raw.split(" - ").map((p) => p.trim());
      return {
        date: parts[0] ?? "",
        restaurant: parts[1] ?? "",
        what: parts[2] ?? "",
        verdict: parts.slice(3).join(" - "),
      };
    })
    .filter((e) => !PLACEHOLDER_DATE.test(e.date));
}

export function orderEntryLine(entry: OrderEntry): string {
  return [entry.date, entry.restaurant, entry.what, entry.verdict]
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .join(" - ");
}
