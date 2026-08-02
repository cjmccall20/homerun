"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { del, errorText, post, put } from "@/lib/client";
import type { Recipe } from "@/lib/parse/recipe";
import { PageHeader } from "@/components/PageHeader";
import { Button, ErrorNote, Field, Input, Textarea } from "@/components/ui";

/**
 * One form for both new and existing recipes. Ingredients and steps are plain
 * textareas, one item per line, because that is how anyone actually types a
 * recipe off a card. The server splits the lines.
 */

export function RecipeForm({ recipe }: { recipe?: Recipe }) {
  const router = useRouter();
  const editing = Boolean(recipe);

  const [title, setTitle] = useState(recipe?.title ?? "");
  const [tags, setTags] = useState(recipe?.tags.join(", ") ?? "");
  const [servings, setServings] = useState(
    recipe?.servings ? String(recipe.servings) : ""
  );
  const [sourceUrl, setSourceUrl] = useState(recipe?.sourceUrl ?? "");
  const [ingredients, setIngredients] = useState(
    recipe?.ingredients.join("\n") ?? ""
  );
  const [steps, setSteps] = useState(recipe?.steps.join("\n") ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError("");
    const payload = {
      title: title.trim(),
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      servings: servings.trim(),
      sourceUrl: sourceUrl.trim(),
      ingredients,
      steps,
    };
    try {
      if (recipe) {
        await put(`/api/recipes/${encodeURIComponent(recipe.slug)}`, payload);
        router.push(`/recipes/${encodeURIComponent(recipe.slug)}`);
      } else {
        const { slug } = await post<{ slug: string }>("/api/recipes", payload);
        router.push(`/recipes/${encodeURIComponent(slug)}`);
      }
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function remove() {
    if (!recipe) return;
    setBusy(true);
    setError("");
    try {
      await del(`/api/recipes/${encodeURIComponent(recipe.slug)}`);
      router.push("/recipes");
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-2">
        <Link
          href={recipe ? `/recipes/${encodeURIComponent(recipe.slug)}` : "/recipes"}
          className="inline-block min-h-12 py-3 text-sm text-ink-soft"
        >
          Cancel
        </Link>
      </div>
      <PageHeader title={editing ? "Edit recipe" : "New recipe"} />

      <div className="space-y-4">
        <Field label="Title">
          <Input
            autoFocus={!editing}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Weeknight tacos"
          />
        </Field>

        <Field label="Tags" hint="Comma separated. Used by the filters.">
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="mexican, quick, weeknight"
          />
        </Field>

        <Field label="Servings" hint="What the quantities below make.">
          <Input
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            inputMode="numeric"
            placeholder="4"
          />
        </Field>

        <Field label="Source link" hint="Optional.">
          <Input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            type="url"
            inputMode="url"
            placeholder="https://"
          />
        </Field>

        <Field
          label="Ingredients"
          hint="One per line. Start with a quantity so the scaler can do its work."
        >
          <Textarea
            rows={8}
            value={ingredients}
            onChange={(e) => setIngredients(e.target.value)}
            placeholder={"1 lb ground beef\n8 corn tortillas\n1 lime"}
          />
        </Field>

        <Field label="Steps" hint="One per line. Numbering is added for you.">
          <Textarea
            rows={8}
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            placeholder={"Brown the beef, 6 to 8 minutes.\nWarm tortillas and assemble."}
          />
        </Field>

        <ErrorNote>{error}</ErrorNote>

        <Button
          variant="primary"
          className="w-full"
          disabled={busy || title.trim() === ""}
          onClick={save}
        >
          {busy ? "Saving" : editing ? "Save changes" : "Create recipe"}
        </Button>

        {editing ? (
          <>
            <p className="text-center text-xs text-ink-faint">
              Ratings and comments are kept when you save. Deleting removes the
              note from the vault.
            </p>
            <Button
              variant="danger"
              className="w-full"
              disabled={busy}
              onClick={remove}
            >
              Delete this recipe
            </Button>
          </>
        ) : null}
      </div>
    </>
  );
}
