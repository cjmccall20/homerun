/**
 * Recipe notes: `Recipes/<slug>.md`.
 *
 * Frontmatter carries the structured bits (tags, servings, ratings, favorite)
 * and the body carries ## Ingredients, ## Steps, ## Comments. Ratings, the
 * favorite flag and new comments are one-line edits; only a full form save
 * rewrites the body sections, and even then the frontmatter lines stay put.
 */

import {
  appendToSectionByTitle,
  bulletItems,
  findSection,
  fromLines,
  readDoc,
  removeFrontmatterKey,
  setFrontmatterKey,
  toLines,
} from "../md.ts";

export type Person = "Cooper" | "Ashlyn";
export const PEOPLE: Person[] = ["Cooper", "Ashlyn"];

export interface Comment {
  date: string;
  name: string;
  text: string;
}

/**
 * An imported recipe lands as a draft and stays out of the way until a human
 * has looked at it. Extraction from a video caption or a photograph of a
 * cookbook page is good but not trustworthy, and a wrong quantity that silently
 * joins the planner and the grocery list costs a shopping trip.
 */
export type RecipeStatus = "draft" | "live";

export interface Recipe {
  slug: string;
  status: RecipeStatus;
  title: string;
  tags: string[];
  servings: number | null;
  sourceUrl: string;
  ratings: Record<string, number | null>;
  favorite: boolean;
  ingredients: string[];
  steps: string[];
  comments: Comment[];
}

export function ratingKey(person: string): string {
  return `rating-${person.trim().toLowerCase()}`;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((t) => String(t).trim()).filter(Boolean);
  if (typeof v === "string") {
    return v
      .split(",")
      .map((t) => t.trim().replace(/^\[|\]$/g, ""))
      .filter(Boolean);
  }
  return [];
}

const COMMENT_RE = /^(\d{4}-\d{2}-\d{2})\s*\(([^)]*)\)\s*:\s*(.*)$/;

export function parseRecipe(slug: string, text: string): Recipe {
  const { data } = readDoc(text);
  const lines = toLines(text);

  const ingredientsSection = findSection(lines, "Ingredients");
  const stepsSection = findSection(lines, "Steps");
  const commentsSection = findSection(lines, "Comments");

  const ingredients = ingredientsSection
    ? bulletItems(lines, ingredientsSection.start, ingredientsSection.end).map(
        (b) => b.text
      )
    : [];

  const steps: string[] = [];
  if (stepsSection) {
    for (let i = stepsSection.start; i < stepsSection.end; i += 1) {
      const m = /^\s*(?:\d+[.)]|[-*])\s+(.*)$/.exec(lines[i]);
      if (m && m[1].trim() !== "") steps.push(m[1].trim());
    }
  }

  const comments: Comment[] = [];
  if (commentsSection) {
    for (const b of bulletItems(
      lines,
      commentsSection.start,
      commentsSection.end
    )) {
      const m = COMMENT_RE.exec(b.text);
      if (m) comments.push({ date: m[1], name: m[2].trim(), text: m[3].trim() });
      else comments.push({ date: "", name: "", text: b.text });
    }
  }

  const ratings: Record<string, number | null> = {};
  for (const person of PEOPLE) {
    ratings[person] = asNumber(data[ratingKey(person)]);
  }

  return {
    slug,
    status: data.status === "draft" ? "draft" : "live",
    title:
      (typeof data.title === "string" && data.title.trim()) ||
      headingTitle(lines) ||
      slug,
    tags: asTags(data.tags),
    servings: asNumber(data.servings),
    sourceUrl:
      typeof data["source-url"] === "string" ? data["source-url"].trim() : "",
    ratings,
    favorite: data.favorite === true || data.favorite === "true",
    ingredients,
    steps,
    comments,
  };
}

function headingTitle(lines: string[]): string {
  const h = lines.find((l) => /^#\s+/.test(l));
  return h ? h.replace(/^#\s+/, "").trim() : "";
}

export function setRating(
  text: string,
  person: string,
  stars: number | null
): string {
  return setFrontmatterKey(text, ratingKey(person), stars);
}

export function setFavorite(text: string, favorite: boolean): string {
  return setFrontmatterKey(text, "favorite", favorite);
}

/** Publishing drops the key; a live recipe carries no status at all. */
export function publishRecipe(text: string): string {
  return removeFrontmatterKey(text, "status");
}

export function markDraft(text: string): string {
  return setFrontmatterKey(text, "status", "draft");
}

export function addComment(
  text: string,
  date: string,
  name: string,
  body: string
): string {
  const clean = body.replace(/\s+/g, " ").trim();
  if (!clean) return text;
  return appendToSectionByTitle(text, "Comments", "## Comments", [
    `- ${date} (${name}): ${clean}`,
  ]);
}

export interface RecipeInput {
  status?: RecipeStatus;
  title: string;
  tags: string[];
  servings: number | null;
  sourceUrl: string;
  ingredients: string[];
  steps: string[];
}

/** A brand new recipe note, matching the seeded example byte for byte in shape. */
export function newRecipeNote(input: RecipeInput): string {
  const tags = input.tags.length ? `[${input.tags.join(", ")}]` : "[]";
  return [
    "---",
    ...(input.status === "draft" ? ["status: draft"] : []),
    `title: ${input.title}`,
    `tags: ${tags}`,
    `servings: ${input.servings ?? ""}`.trimEnd(),
    `source-url: ${input.sourceUrl}`.trimEnd(),
    "rating-cooper:",
    "rating-ashlyn:",
    "favorite: false",
    "---",
    `# ${input.title}`,
    "",
    "## Ingredients",
    "",
    ...(input.ingredients.length
      ? input.ingredients.map((i) => `- ${i}`)
      : ["- "]),
    "",
    "## Steps",
    "",
    ...(input.steps.length
      ? input.steps.map((s, i) => `${i + 1}. ${s}`)
      : ["1. "]),
    "",
    "## Comments",
    "",
  ].join("\n");
}

/**
 * Applies a form edit: the frontmatter keys are patched one line at a time and
 * the two body sections are replaced, so any extra sections a human added
 * (## Notes, ## Wine pairing) survive untouched.
 */
export function updateRecipeNote(text: string, input: RecipeInput): string {
  // The status line is deliberately untouched here. Editing a draft leaves it
  // a draft; publishing is a separate, explicit act.
  let out = text;
  out = setFrontmatterKey(out, "title", input.title);
  out = setFrontmatterKey(out, "tags", input.tags);
  out = setFrontmatterKey(out, "servings", input.servings);
  out = setFrontmatterKey(out, "source-url", input.sourceUrl);

  let lines = toLines(out);
  const h1 = lines.findIndex((l) => /^#\s+/.test(l));
  if (h1 >= 0) lines[h1] = `# ${input.title}`;

  lines = replaceOrAppendSection(
    lines,
    "Ingredients",
    "## Ingredients",
    input.ingredients.map((i) => `- ${i}`)
  );
  lines = replaceOrAppendSection(
    lines,
    "Steps",
    "## Steps",
    input.steps.map((s, i) => `${i + 1}. ${s}`)
  );
  return fromLines(lines);
}

function replaceOrAppendSection(
  lines: string[],
  titlePrefix: string,
  heading: string,
  content: string[]
): string[] {
  const section = findSection(lines, titlePrefix);
  if (!section) {
    return [...lines, "", heading, "", ...content, ""];
  }
  const trailing = section.end < lines.length ? [""] : [];
  return [
    ...lines.slice(0, section.start),
    "",
    ...content,
    ...trailing,
    ...lines.slice(section.end),
  ];
}

export {
  formatQuantity,
  parseQuantity,
  scaleIngredient,
} from "../scale.ts";
