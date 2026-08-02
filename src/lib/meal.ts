/**
 * The meal-cell grammar, on its own so both sides of the wire can use it.
 *
 * A cell in the Meal-Plan table is one of:
 *   Tacos                          a dish
 *   [[weeknight-tacos]]            a recipe link
 *   Leftovers                      leftovers
 *   Restaurant: Taco Bus           eating out
 *   ... optionally + " (Cooper)"   who is cooking
 *
 * Kept free of any Node import so the cell editor can round-trip a value in
 * the browser without shipping a markdown parser to the phone.
 */

import { PEOPLE } from "./people.ts";

export type MealKind = "text" | "recipe" | "leftovers" | "restaurant" | "empty";

export interface Meal {
  /** The raw cell text, exactly as it sits in the file. */
  raw: string;
  kind: MealKind;
  /** Dish name, recipe slug, or restaurant name depending on `kind`. */
  value: string;
  /** "Cooper" | "Ashlyn" | "" - the (cook) tag. */
  cook: string;
}

const COOK_RE = /\s*\(([^()]{1,24})\)\s*$/;
const KNOWN_COOKS = PEOPLE.map((p) => p.toLowerCase());

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function parseMeal(raw: string): Meal {
  const text = raw.trim();
  if (text === "") return { raw, kind: "empty", value: "", cook: "" };

  let rest = text;
  let cook = "";
  const cookMatch = COOK_RE.exec(rest);
  if (cookMatch && KNOWN_COOKS.includes(cookMatch[1].trim().toLowerCase())) {
    cook = titleCase(cookMatch[1].trim());
    rest = rest.slice(0, cookMatch.index).trim();
  }

  const link = /^\[\[([^\]]+)\]\]$/.exec(rest);
  if (link) {
    return { raw, kind: "recipe", value: link[1].split("|")[0].trim(), cook };
  }
  if (/^leftovers$/i.test(rest)) {
    return { raw, kind: "leftovers", value: "Leftovers", cook };
  }
  const restaurant = /^restaurant:\s*(.*)$/i.exec(rest);
  if (restaurant) {
    return { raw, kind: "restaurant", value: restaurant[1].trim(), cook };
  }
  return { raw, kind: "text", value: rest, cook };
}

export function serializeMeal(meal: {
  kind: MealKind;
  value: string;
  cook?: string;
}): string {
  const cook = meal.cook ? ` (${titleCase(meal.cook)})` : "";
  switch (meal.kind) {
    case "empty":
      return "";
    case "recipe":
      return meal.value ? `[[${meal.value}]]${cook}` : "";
    case "leftovers":
      return `Leftovers${cook}`;
    case "restaurant":
      return meal.value ? `Restaurant: ${meal.value}${cook}` : "";
    default:
      return meal.value ? `${meal.value}${cook}` : "";
  }
}
