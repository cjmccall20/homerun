"use client";

import Link from "next/link";

import type { Meal } from "@/lib/meal";
import type { WeekTable } from "@/lib/parse/week";

/**
 * A compact, read-only rendering of a week note, used to preview a draft
 * before it goes live: in the Manage sheet and in the plan chat. Recipe cells
 * link straight to the recipe so a proposed dinner can be checked in one tap.
 */

interface RecipeRef {
  slug: string;
  title: string;
}

export function WeekPreview({
  table,
  recipes = [],
}: {
  table: WeekTable | null;
  recipes?: RecipeRef[];
}) {
  if (!table) return null;
  const columns = table.headers.slice(1);
  const rows = table.rows.filter((r) => r.cells.some((c) => c.kind !== "empty"));
  if (rows.length === 0) return null;

  return (
    <ul className="mt-2 space-y-1.5 border-t border-line pt-2">
      {rows.map((row, i) => (
        <li key={`${row.day}-${i}`} className="flex gap-2 text-xs">
          <span className="w-16 shrink-0 pt-px font-medium">
            {row.day || `Day ${i + 1}`}
          </span>
          <span className="min-w-0 flex-1 space-y-0.5 text-ink-soft">
            {row.cells.map((cell, j) =>
              cell.kind === "empty" ? null : (
                <span key={j} className="block truncate">
                  <span className="text-ink-faint">{columns[j]}: </span>
                  <PreviewMeal meal={cell} recipes={recipes} />
                </span>
              )
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PreviewMeal({ meal, recipes }: { meal: Meal; recipes: RecipeRef[] }) {
  const cook = meal.cook ? ` (${meal.cook})` : "";
  if (meal.kind === "recipe") {
    const title = recipes.find((r) => r.slug === meal.value)?.title ?? meal.value;
    return (
      <>
        <Link href={`/recipes/${meal.value}`} className="text-accent underline">
          {title}
        </Link>
        {cook}
      </>
    );
  }
  const text = meal.kind === "restaurant" ? `Out: ${meal.value}` : meal.value;
  return (
    <>
      {text}
      {cook}
    </>
  );
}
