"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { errorText, patch } from "@/lib/client";
import type { Recipe } from "@/lib/parse/recipe";
import { PEOPLE } from "@/lib/people";
import { scaleIngredient } from "@/lib/scale";
import { TagEditor } from "@/components/TagFilter";
import {
  Button,
  Card,
  ErrorNote,
  SectionTitle,
  Stars,
  Textarea,
} from "@/components/ui";

/**
 * One recipe. The scaler is the reason this page is a client component: doing
 * the arithmetic in the browser means the note on disk keeps its own honest
 * servings count while the screen shows whatever you are actually cooking
 * tonight. Scaling never writes anything.
 */

export function RecipeDetail({
  recipe,
  me,
  vocabulary,
}: {
  recipe: Recipe;
  me: string;
  vocabulary: string[];
}) {
  const router = useRouter();
  const base = recipe.servings && recipe.servings > 0 ? recipe.servings : null;
  const [servings, setServings] = useState(base ?? 4);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const factor = base ? servings / base : 1;
  const ingredients = useMemo(
    () => recipe.ingredients.map((line) => scaleIngredient(line, factor)),
    [recipe.ingredients, factor]
  );

  async function act(payload: Record<string, unknown>, after?: () => void) {
    setBusy(true);
    setError("");
    try {
      await patch(`/api/recipes/${encodeURIComponent(recipe.slug)}`, payload);
      after?.();
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Link href="/recipes" className="min-h-12 py-3 text-sm text-ink-soft">
          Back to recipes
        </Link>
        <Link
          href={`/recipes/${encodeURIComponent(recipe.slug)}/edit`}
          className="min-h-12 py-3 text-sm font-medium text-accent"
        >
          Edit
        </Link>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight">{recipe.title}</h1>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
        {base ? <span>Serves {base} as written</span> : null}
        {recipe.tags.length ? <span>{recipe.tags.join(", ")}</span> : null}
        {recipe.sourceUrl ? (
          <a
            href={recipe.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline"
          >
            Source
          </a>
        ) : null}
      </div>

      <ErrorNote>{error}</ErrorNote>

      <Card className="mt-4 flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-sm font-medium">Favorite</p>
          <p className="text-xs text-ink-faint">Shows up in the Favorites filter.</p>
        </div>
        <Button
          disabled={busy}
          variant={recipe.favorite ? "primary" : "quiet"}
          onClick={() => act({ action: "favorite", favorite: !recipe.favorite })}
          className="px-4"
        >
          {recipe.favorite ? "Saved" : "Save"}
        </Button>
      </Card>

      <Card className="mt-3 px-4 py-3">
        <p className="text-sm font-medium">Tags</p>
        <p className="text-xs text-ink-faint">
          Used to find this again. Tap one to remove it.
        </p>
        <div className="mt-2">
          <TagEditor
            tags={recipe.tags}
            suggestions={vocabulary}
            busy={busy}
            onChange={(tags) => act({ action: "tags", tags })}
          />
        </div>
      </Card>

      <Card className="mt-3 px-4 py-3">
        <p className="text-sm font-medium">Ratings</p>
        <ul className="mt-2 space-y-1">
          {PEOPLE.map((person) => (
            <li key={person} className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink-soft">
                {person}
                {person === me ? " (you)" : ""}
              </span>
              {person === me ? (
                <Stars
                  value={recipe.ratings[person] ?? null}
                  onChange={(stars) => act({ action: "rate", stars })}
                />
              ) : (
                <Stars value={recipe.ratings[person] ?? null} />
              )}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-ink-faint">
          Tap your own star again to clear it. Claude reads these when it plans.
        </p>
      </Card>

      <section className="mt-6">
        <div className="flex items-end justify-between gap-3">
          <SectionTitle>Ingredients</SectionTitle>
          {base ? (
            <div className="flex items-center gap-2 pb-2">
              <Button
                variant="quiet"
                aria-label="Fewer servings"
                disabled={servings <= 1}
                onClick={() => setServings((s) => Math.max(1, s - 1))}
                className="w-12 px-0 text-lg"
              >
                -
              </Button>
              <span className="w-24 text-center text-sm tabular-nums">
                {servings} serving{servings === 1 ? "" : "s"}
              </span>
              <Button
                variant="quiet"
                aria-label="More servings"
                disabled={servings >= 24}
                onClick={() => setServings((s) => Math.min(24, s + 1))}
                className="w-12 px-0 text-lg"
              >
                +
              </Button>
            </div>
          ) : null}
        </div>
        <Card className="px-4 py-3">
          {ingredients.length === 0 ? (
            <p className="text-sm text-ink-faint">None listed yet.</p>
          ) : (
            <ul className="space-y-2">
              {ingredients.map((line, i) => (
                <li key={i} className="flex gap-2 text-[0.95rem]">
                  <span aria-hidden className="text-ink-faint">
                    -
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}
          {factor !== 1 ? (
            <p className="mt-3 text-xs text-ink-faint">
              Scaled {formatFactor(factor)} from the note. The file still says{" "}
              {base}.
            </p>
          ) : null}
        </Card>
      </section>

      <section className="mt-6">
        <SectionTitle>Steps</SectionTitle>
        <Card className="px-4 py-3">
          {recipe.steps.length === 0 ? (
            <p className="text-sm text-ink-faint">None written yet.</p>
          ) : (
            <ol className="space-y-3">
              {recipe.steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-[0.95rem] leading-relaxed">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink-soft">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </section>

      <section className="mt-6">
        <SectionTitle>Comments</SectionTitle>
        <Card className="px-4 py-3">
          {recipe.comments.length === 0 ? (
            <p className="text-sm text-ink-faint">
              Nothing yet. Notes here are what Claude reads to learn what worked.
            </p>
          ) : (
            <ul className="space-y-3">
              {recipe.comments.map((c, i) => (
                <li key={i}>
                  <p className="text-xs text-ink-faint">
                    {[c.date, c.name].filter(Boolean).join(" - ")}
                  </p>
                  <p className="text-[0.95rem]">{c.text}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 space-y-2">
            <Textarea
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={`How was it, ${me}?`}
              aria-label="Add a comment"
            />
            <Button
              disabled={busy || comment.trim() === ""}
              className="w-full"
              onClick={() =>
                act({ action: "comment", text: comment }, () => setComment(""))
              }
            >
              {busy ? "Saving" : `Add as ${me}`}
            </Button>
          </div>
        </Card>
      </section>
    </>
  );
}

function formatFactor(factor: number): string {
  const rounded = Math.round(factor * 100) / 100;
  return rounded === 2 ? "double" : rounded === 0.5 ? "by half" : `${rounded}x`;
}
