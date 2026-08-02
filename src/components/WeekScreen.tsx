"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { errorText, del, patch, post } from "@/lib/client";
import { matchesAllTags, normalizeTag } from "@/lib/tag-taxonomy";
import { todayISO, weekStartISO } from "@/lib/dates";
import { serializeMeal, type Meal, type MealKind } from "@/lib/meal";
import type { WeekTable } from "@/lib/parse/week";
import type { WeekSummary } from "@/lib/store";
import { PEOPLE } from "@/lib/people";
import { PageHeader } from "@/components/PageHeader";
import { WeekPreview } from "@/components/WeekPreview";
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  Input,
  Pill,
  SectionTitle,
  Select,
  Sheet,
} from "@/components/ui";

/**
 * The week, as day cards rather than a five-column table. A markdown table is
 * the right shape for a file and the wrong shape for a phone: nobody wants to
 * pinch-zoom to change what is for dinner on Thursday.
 */

interface WeekView {
  weekOf: string;
  title: string;
  table: WeekTable | null;
}

interface RecipeRef {
  slug: string;
  title: string;
  tags: string[];
}

type EditTarget = { row: number; col: number; day: string; column: string };

export function WeekScreen({
  week,
  drafts,
  templates,
  recipes,
}: {
  week: WeekView;
  drafts: WeekSummary[];
  templates: WeekSummary[];
  recipes: RecipeRef[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const table = week.table;
  const columns = table ? table.headers.slice(1) : [];

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveCell(target: EditTarget, value: string) {
    await run(() =>
      patch("/api/week", {
        scope: "current",
        row: target.row,
        col: target.col,
        value,
      })
    );
    setEditing(null);
  }

  /** Trades this cell with the same meal on another day, both sides intact. */
  async function swapCell(target: EditTarget, otherRow: number) {
    if (!table) return;
    const here = table.rows[target.row].cells[target.col].raw.trim();
    const there = table.rows[otherRow].cells[target.col].raw.trim();
    await run(async () => {
      await patch("/api/week", {
        scope: "current",
        row: target.row,
        col: target.col,
        value: there,
      });
      await patch("/api/week", {
        scope: "current",
        row: otherRow,
        col: target.col,
        value: here,
      });
    });
    setEditing(null);
  }

  const current: Meal | null =
    editing && table ? table.rows[editing.row].cells[editing.col] : null;

  return (
    <>
      <PageHeader
        title="This week"
        subtitle={week.weekOf ? `Week of ${week.weekOf}` : undefined}
        action={
          <Button variant="ghost" onClick={() => setMenuOpen(true)} className="px-3">
            Manage
          </Button>
        }
      />

      <Link
        href="/plan"
        className="mb-5 flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-accent/40 bg-accent-soft px-4 text-accent"
      >
        <span className="text-[0.95rem] font-medium">
          Plan the week with Claude
        </span>
        <span aria-hidden className="text-lg">
          &rsaquo;
        </span>
      </Link>

      <ErrorNote>{error}</ErrorNote>

      {!table ? (
        <Empty>
          Meal-Plan.md has no table in it. Open it in Obsidian, or use Manage to
          start a fresh week.
        </Empty>
      ) : (
        <div className="space-y-3">
          {table.rows.map((row, rowIndex) => (
            <Card key={`${row.day}-${rowIndex}`} className="overflow-hidden">
              <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">
                {row.day || `Day ${rowIndex + 1}`}
              </div>
              <ul>
                {row.cells.map((cell, colIndex) => (
                  <li key={colIndex} className="border-b border-line last:border-0">
                    <button
                      onClick={() =>
                        setEditing({
                          row: rowIndex,
                          col: colIndex,
                          day: row.day,
                          column: columns[colIndex] ?? "Meal",
                        })
                      }
                      className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left active:bg-surface-2"
                    >
                      <span className="w-20 shrink-0 text-xs uppercase tracking-wide text-ink-faint">
                        {columns[colIndex]}
                      </span>
                      <MealLabel meal={cell} recipes={recipes} />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {editing && current ? (
        <CellSheet
          target={editing}
          meal={current}
          recipes={recipes}
          days={table ? table.rows.map((r, i) => r.day || `Day ${i + 1}`) : []}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(value) => saveCell(editing, value)}
          onSwap={(otherRow) => swapCell(editing, otherRow)}
        />
      ) : null}

      <ManageSheet
        open={menuOpen}
        busy={busy}
        weekOf={week.weekOf}
        drafts={drafts}
        templates={templates}
        recipes={recipes}
        onClose={() => setMenuOpen(false)}
        onAction={run}
      />
    </>
  );
}

function MealLabel({
  meal,
  recipes,
}: {
  meal: Meal;
  recipes: RecipeRef[];
}) {
  if (meal.kind === "empty") {
    return <span className="text-ink-faint">Add</span>;
  }
  const title =
    meal.kind === "recipe"
      ? (recipes.find((r) => r.slug === meal.value)?.title ?? meal.value)
      : meal.value;

  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate">
        {meal.kind === "restaurant" ? `Out: ${title}` : title}
      </span>
      {meal.cook ? (
        <span className="block text-xs text-ink-faint">{meal.cook} cooks</span>
      ) : null}
    </span>
  );
}

// "Clear" is not one of these on purpose. Emptying a night is an action, not a
// kind of meal, so it gets its own button at the bottom of the sheet.
const KINDS: { key: MealKind; label: string }[] = [
  { key: "text", label: "Dish or event" },
  { key: "recipe", label: "Saved recipe" },
  { key: "leftovers", label: "Leftovers" },
  { key: "restaurant", label: "Eating out" },
];

function CellSheet({
  target,
  meal,
  recipes,
  days,
  busy,
  onClose,
  onSave,
  onSwap,
}: {
  target: EditTarget;
  meal: Meal;
  recipes: RecipeRef[];
  days: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (value: string) => void;
  onSwap: (otherRow: number) => void;
}) {
  // An empty night opens ready to type, since that is the common reason to tap one.
  const [kind, setKind] = useState<MealKind>(
    meal.kind === "empty" ? "text" : meal.kind
  );
  const [text, setText] = useState(meal.kind === "recipe" ? "" : meal.value);
  const [slug, setSlug] = useState(meal.kind === "recipe" ? meal.value : "");
  const [cook, setCook] = useState(meal.cook);
  const [recipeQuery, setRecipeQuery] = useState("");
  const [recipeTags, setRecipeTags] = useState<string[]>([]);

  // Tags sorted by how many recipes carry them, so the useful ones come first.
  const pickerTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of recipes) {
      for (const raw of r.tags) {
        const t = normalizeTag(raw);
        if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag);
  }, [recipes]);

  const shownRecipes = useMemo(() => {
    const q = recipeQuery.trim().toLowerCase();
    return recipes.filter((r) => {
      if (!matchesAllTags(r.tags, recipeTags)) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [recipes, recipeQuery, recipeTags]);

  const value = serializeMeal({
    kind,
    value: kind === "recipe" ? slug : text,
    cook,
  });

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${target.day} ${target.column.toLowerCase()}`}
    >
      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <Pill
            key={k.key}
            active={kind === k.key}
            onClick={() => setKind(k.key)}
          >
            {k.label}
          </Pill>
        ))}
      </div>

      {kind === "text" ? (
        <Field
          label="What are we having?"
          hint="Anything you like, including plans that are not a recipe: Dinner party at the Hodges."
        >
          <Input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Chicken and rice"
          />
        </Field>
      ) : null}

      {kind === "restaurant" ? (
        <Field label="Where?">
          <Input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Taco Bus"
          />
        </Field>
      ) : null}

      {kind === "recipe" ? (
        <Field
          label="Which recipe?"
          hint="Saved as a [[link]] so Obsidian connects the notes."
        >
          <Input
            value={recipeQuery}
            onChange={(e) => setRecipeQuery(e.target.value)}
            type="search"
            placeholder="Search titles and tags"
            aria-label="Search recipes"
            className="mb-2"
          />
          {pickerTags.length > 0 ? (
            <div className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1">
              {pickerTags.map((tag) => (
                <Pill
                  key={tag}
                  active={recipeTags.includes(tag)}
                  onClick={() =>
                    setRecipeTags((current) =>
                      current.includes(tag)
                        ? current.filter((t) => t !== tag)
                        : [...current, tag]
                    )
                  }
                >
                  {tag}
                </Pill>
              ))}
            </div>
          ) : null}
          <Select value={slug} onChange={(e) => setSlug(e.target.value)}>
            <option value="">
              {shownRecipes.length === recipes.length
                ? "Pick a recipe"
                : `Pick one of ${shownRecipes.length}`}
            </option>
            {/* The current pick stays listed even when the filters hide it. */}
            {slug && !shownRecipes.some((r) => r.slug === slug) ? (
              <option value={slug}>
                {recipes.find((r) => r.slug === slug)?.title ?? slug}
              </option>
            ) : null}
            {shownRecipes.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.title}
              </option>
            ))}
          </Select>
          {slug ? (
            <Link
              href={`/recipes/${slug}`}
              className="mt-2 inline-block text-sm text-accent underline"
            >
              Open the recipe
            </Link>
          ) : null}
        </Field>
      ) : null}

      <Field label="Who is cooking?">
        <div className="flex gap-2">
          <Pill active={cook === ""} onClick={() => setCook("")}>
            Not set
          </Pill>
          {PEOPLE.map((name) => (
            <Pill
              key={name}
              active={cook === name}
              onClick={() => setCook(name)}
            >
              {name}
            </Pill>
          ))}
        </div>
      </Field>

      <Button
        variant="primary"
        disabled={busy}
        onClick={() => onSave(value)}
        className="w-full"
      >
        {busy ? "Saving" : "Save"}
      </Button>

      {meal.kind !== "empty" ? (
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => onSave("")}
          className="w-full"
        >
          Remove this {target.column.toLowerCase()}
        </Button>
      ) : null}

      {meal.kind !== "empty" && days.length > 1 ? (
        <Field
          label="Or switch nights"
          hint={`Trades this ${target.column.toLowerCase()} with another day's.`}
        >
          <div className="flex flex-wrap gap-2">
            {days.map((day, i) =>
              i === target.row ? null : (
                <Pill key={day} onClick={() => !busy && onSwap(i)}>
                  {day}
                </Pill>
              )
            )}
          </div>
        </Field>
      ) : null}
    </Sheet>
  );
}

function ManageSheet({
  open,
  busy,
  weekOf,
  drafts,
  templates,
  recipes,
  onClose,
  onAction,
}: {
  open: boolean;
  busy: boolean;
  weekOf: string;
  drafts: WeekSummary[];
  templates: WeekSummary[];
  recipes: RecipeRef[];
  onClose: () => void;
  onAction: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [templateName, setTemplateName] = useState("");
  const [newWeekOf, setNewWeekOf] = useState(todayISO());

  return (
    <Sheet open={open} onClose={onClose} title="Manage weeks">
      <section>
        <SectionTitle>Drafts</SectionTitle>
        {drafts.length === 0 ? (
          <Empty>
            No drafts yet. The chat planner writes them to Weeks/Drafts.
          </Empty>
        ) : (
          <ul className="space-y-2">
            {drafts.map((draft) => (
              <li key={draft.name}>
                <Card className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{draft.name}</p>
                      <p className="text-xs text-ink-faint">
                        {draft.filled} meals planned
                        {draft.weekOf ? ` and dated ${draft.weekOf}` : ""}
                      </p>
                    </div>
                    <Button
                      variant="primary"
                      disabled={busy}
                      className="px-3 text-sm"
                      onClick={() =>
                        onAction(() =>
                          post("/api/week/actions", {
                            action: "promote",
                            name: draft.name,
                          })
                        )
                      }
                    >
                      Make it live
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy}
                      aria-label={`Delete draft ${draft.name}`}
                      className="px-3 text-sm"
                      onClick={() =>
                        onAction(() =>
                          del(`/api/week?scope=draft&name=${encodeURIComponent(draft.name)}`)
                        )
                      }
                    >
                      Delete
                    </Button>
                  </div>
                  <WeekPreview table={draft.table} recipes={recipes} />
                </Card>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 px-1 text-xs text-ink-faint">
          Making a draft live archives the current week to Weeks/Archive first.
        </p>
      </section>

      <section>
        <SectionTitle>Templates</SectionTitle>
        {templates.length === 0 ? (
          <Empty>No templates yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {templates.map((template) => (
              <li key={template.name}>
                <Card className="flex items-center gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {template.name}
                    </p>
                    <p className="text-xs text-ink-faint">
                      {template.filled} meals
                    </p>
                  </div>
                  <Button
                    disabled={busy}
                    className="px-3 text-sm"
                    onClick={() =>
                      onAction(() =>
                        post("/api/week/actions", {
                          action: "apply-template",
                          name: template.name,
                        })
                      )
                    }
                  >
                    Apply
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    aria-label={`Delete template ${template.name}`}
                    className="px-3 text-sm"
                    onClick={() =>
                      onAction(() =>
                        del(
                          `/api/week?scope=template&name=${encodeURIComponent(template.name)}`
                        )
                      )
                    }
                  >
                    Delete
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>Save this week as a template</SectionTitle>
        <Input
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder="Busy soccer week"
        />
        <Button
          disabled={busy || templateName.trim() === ""}
          className="w-full"
          onClick={() =>
            onAction(async () => {
              await post("/api/week/actions", {
                action: "save-template",
                name: templateName.trim(),
              });
              setTemplateName("");
            })
          }
        >
          Save as template
        </Button>
      </section>

      <section className="space-y-3 pb-2">
        <SectionTitle>Start a fresh week</SectionTitle>
        <Field
          label="Which week?"
          hint="Snapped to the Monday of whatever week you pick."
        >
          <Input
            type="date"
            value={newWeekOf}
            onChange={(e) => setNewWeekOf(e.target.value)}
          />
        </Field>
        <Button
          variant="danger"
          disabled={busy}
          className="w-full"
          onClick={() =>
            onAction(() =>
              post("/api/week/actions", {
                action: "new-week",
                name: weekStartISO(newWeekOf),
              })
            )
          }
        >
          Archive {weekOf || "this week"} and start {weekStartISO(newWeekOf)}
        </Button>
      </section>
    </Sheet>
  );
}
