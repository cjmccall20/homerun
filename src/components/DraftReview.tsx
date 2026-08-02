"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { del, errorText, patch, put } from "@/lib/client";
import type { Recipe } from "@/lib/parse/recipe";
import { PageHeader } from "@/components/PageHeader";
import { Button, Card, ErrorNote, Field, Input, Textarea } from "@/components/ui";

/**
 * Reviewing an imported recipe before it goes live.
 *
 * Extraction from a video caption, a blog buried in advertising, or a
 * photograph of somebody's handwriting is good but never trustworthy. A wrong
 * quantity that quietly joins the meal planner and the grocery list costs a
 * shopping trip, so nothing imported is usable until a person has looked at it.
 *
 * This is the same form as the editor with two extra buttons, deliberately:
 * the review is an edit, and the common case is fixing one line and publishing.
 */
export function DraftReview({ recipe }: { recipe: Recipe }) {
  const router = useRouter();
  const [title, setTitle] = useState(recipe.title);
  const [tags, setTags] = useState(recipe.tags.join(", "));
  const [servings, setServings] = useState(
    recipe.servings ? String(recipe.servings) : ""
  );
  const [sourceUrl, setSourceUrl] = useState(recipe.sourceUrl);
  const [ingredients, setIngredients] = useState(recipe.ingredients.join("\n"));
  const [steps, setSteps] = useState(recipe.steps.join("\n"));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const payload = () => ({
    title: title.trim(),
    tags: tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    servings: servings.trim(),
    sourceUrl: sourceUrl.trim(),
    ingredients,
    steps,
  });

  const url = `/api/recipes/${encodeURIComponent(recipe.slug)}`;

  async function save(then?: () => Promise<void>) {
    setBusy("save");
    setError("");
    try {
      await put(url, payload());
      await then?.();
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }

  async function publish() {
    setBusy("publish");
    setError("");
    try {
      // Save first, then publish: publishing an unsaved edit would put the
      // unreviewed version live, which is the exact thing this screen exists
      // to prevent.
      await put(url, payload());
      await patch(url, { action: "publish" });
      router.push(`/recipes/${encodeURIComponent(recipe.slug)}`);
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      setBusy("");
    }
  }

  async function discard() {
    setBusy("discard");
    setError("");
    try {
      await del(url);
      router.push("/recipes");
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      setBusy("");
    }
  }

  return (
    <>
      <div className="mb-2">
        <Link href="/recipes" className="inline-block min-h-12 py-3 text-sm text-ink-soft">
          Back to recipes
        </Link>
      </div>

      <PageHeader
        title="Check this over"
        subtitle="Imported, not live yet. It stays out of the planner and the grocery list until you publish it."
      />

      <Card className="mb-4 border-warn/40 px-4 py-3">
        <p className="text-sm">
          {recipe.ingredients.length} ingredients and {recipe.steps.length} steps
          were extracted
          {recipe.sourceUrl ? " from the link" : " from what you sent"}. Quantities
          are the thing worth checking.
        </p>
      </Card>

      <div className="space-y-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <Field label="Servings" hint="What the quantities below make.">
          <Input
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            inputMode="numeric"
            placeholder="4"
          />
        </Field>

        <Field label="Tags" hint="Comma separated.">
          <Input value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>

        <Field
          label="Ingredients"
          hint="One per line. Start each with a quantity so the scaler works."
        >
          <Textarea
            rows={10}
            value={ingredients}
            onChange={(e) => setIngredients(e.target.value)}
          />
        </Field>

        <Field label="Steps" hint="One per line.">
          <Textarea rows={10} value={steps} onChange={(e) => setSteps(e.target.value)} />
        </Field>

        <Field label="Source" hint="Where it came from.">
          <Input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            type="url"
            inputMode="url"
            placeholder="https://"
          />
        </Field>

        <ErrorNote>{error}</ErrorNote>

        <Button
          variant="primary"
          className="w-full"
          disabled={busy !== "" || title.trim() === ""}
          onClick={publish}
        >
          {busy === "publish" ? "Publishing" : "Publish it"}
        </Button>
        <Button
          className="w-full"
          disabled={busy !== ""}
          onClick={() => save()}
        >
          {busy === "save" ? "Saving" : "Save and keep reviewing"}
        </Button>
        <Button
          variant="danger"
          className="w-full"
          disabled={busy !== ""}
          onClick={discard}
        >
          {busy === "discard" ? "Discarding" : "Discard this import"}
        </Button>
      </div>
    </>
  );
}
