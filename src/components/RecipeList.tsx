"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { errorText, pollJobOutcome, post, type JobOutcome } from "@/lib/client";
import { matchesAllTags, normalizeTag } from "@/lib/tag-taxonomy";
import { SelectedTags, TagFilterSheet } from "@/components/TagFilter";
import type { Recipe } from "@/lib/parse/recipe";
import { PageHeader } from "@/components/PageHeader";
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  Input,
  Pill,
  Sheet,
  Stars,
} from "@/components/ui";

/**
 * The recipe box. Filters are all client-side because the whole collection is
 * a few dozen small files: the server already handed over everything, so
 * typing in the search box should feel instant, not like a network request.
 */

type Sort = "title" | "rating" | "recent";

export function RecipeList({
  recipes,
  drafts,
  me,
}: {
  recipes: Recipe[];
  drafts: Recipe[];
  me: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const [favesOnly, setFavesOnly] = useState(false);
  const [minRating, setMinRating] = useState(0);
  const [sort, setSort] = useState<Sort>("title");
  const [importOpen, setImportOpen] = useState(false);

  const tagCounts = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of recipes) {
      for (const raw of r.tags) {
        const t = normalizeTag(raw);
        if (t) seen.set(t, (seen.get(t) ?? 0) + 1);
      }
    }
    return seen;
  }, [recipes]);

  const allTags = useMemo(() => [...tagCounts.keys()], [tagCounts]);

  function toggleTag(tag: string) {
    const clean = normalizeTag(tag);
    setSelectedTags((current) =>
      current.includes(clean)
        ? current.filter((t) => t !== clean)
        : [...current, clean]
    );
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = recipes.filter((r) => {
      if (favesOnly && !r.favorite) return false;
      // Every selected tag must be present. Filters compose: tags, text,
      // favorites and rating all narrow the same list together.
      if (!matchesAllTags(r.tags, selectedTags)) return false;
      if (minRating > 0 && (best(r) ?? 0) < minRating) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q)) ||
        r.ingredients.some((i) => i.toLowerCase().includes(q))
      );
    });
    if (sort === "rating") {
      return [...filtered].sort(
        (a, b) => (best(b) ?? -1) - (best(a) ?? -1) || a.title.localeCompare(b.title)
      );
    }
    return filtered;
  }, [recipes, query, selectedTags, favesOnly, minRating, sort]);

  const filtersOn =
    query !== "" ||
    selectedTags.length > 0 ||
    favesOnly ||
    minRating > 0 ||
    sort !== "title";

  return (
    <>
      <PageHeader
        title="Recipes"
        subtitle={`${recipes.length} in the box`}
        action={
          <Link
            href="/recipes/new"
            className="inline-flex min-h-12 items-center rounded-xl border border-line px-4 text-[0.95rem] font-medium"
          >
            Type one
          </Link>
        }
      />

      {/*
        Importing is how recipes actually get into this app. Almost nobody
        types a recipe in by hand; they see one on a phone or they are holding
        a cookbook. So the import is the headline control, not a link buried
        under the filters, and it offers both routes at once.
      */}
      <button
        onClick={() => setImportOpen(true)}
        className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-accent/40 bg-accent-soft px-4 py-4 text-left"
      >
        <span className="text-2xl" aria-hidden>
          +
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.98rem] font-medium text-accent">
            Import a recipe
          </span>
          <span className="block text-xs text-ink-soft">
            Paste a link from anywhere, or photograph a cookbook page
          </span>
        </span>
      </button>

      {drafts.length > 0 ? (
        <section className="mb-5">
          <div className="mb-2 flex items-center gap-2 px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Waiting for review
            </h2>
            <span className="rounded-full bg-warn px-2 py-0.5 text-[0.7rem] font-semibold text-white">
              {drafts.length}
            </span>
          </div>
          <div className="space-y-2">
            {drafts.map((draft) => (
              <Link key={draft.slug} href={`/recipes/${encodeURIComponent(draft.slug)}`}>
                <Card className="flex min-h-16 items-center gap-3 border-warn/40 px-4 py-3 active:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{draft.title}</p>
                    <p className="truncate text-xs text-ink-faint">
                      {draft.ingredients.length} ingredients, {draft.steps.length}{" "}
                      steps. Check it before it goes live.
                    </p>
                  </div>
                  <span aria-hidden className="text-ink-faint">
                    &rsaquo;
                  </span>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="space-y-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          type="search"
          placeholder="Search titles, tags, ingredients"
          aria-label="Search recipes"
        />

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <Pill active={favesOnly} onClick={() => setFavesOnly((v) => !v)}>
            Favorites
          </Pill>
          <Pill
            active={minRating > 0}
            onClick={() => setMinRating((v) => (v === 0 ? 4 : 0))}
          >
            4 stars and up
          </Pill>
          <Pill
            active={sort === "rating"}
            onClick={() => setSort((v) => (v === "rating" ? "title" : "rating"))}
          >
            Best first
          </Pill>
          <Pill active={selectedTags.length > 0} onClick={() => setTagSheetOpen(true)}>
            Tags{selectedTags.length > 0 ? ` (${selectedTags.length})` : ""}
          </Pill>
        </div>

        <SelectedTags
          selected={selectedTags}
          onRemove={toggleTag}
          onClear={() => setSelectedTags([])}
        />

        <p className="px-1 text-xs text-ink-faint">
          {shown.length} shown{filtersOn ? " (filtered)" : ""}
        </p>
      </div>

      <div className="mt-3 space-y-2">
        {shown.length === 0 ? (
          <Empty>
            {recipes.length === 0
              ? "No recipes yet. Add one, or import from a link."
              : "Nothing matches those filters."}
          </Empty>
        ) : (
          shown.map((r) => (
            <Link key={r.slug} href={`/recipes/${encodeURIComponent(r.slug)}`}>
              <Card className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {r.favorite ? (
                      <span aria-label="Favorite" className="text-warn">
                        ★{" "}
                      </span>
                    ) : null}
                    {r.title}
                  </p>
                  <p className="truncate text-xs text-ink-faint">
                    {[
                      r.servings ? `Serves ${r.servings}` : "",
                      r.tags.join(", "),
                    ]
                      .filter(Boolean)
                      .join(" | ") || "No tags yet"}
                  </p>
                </div>
                <Stars value={r.ratings[me] ?? null} size="sm" />
              </Card>
            </Link>
          ))
        )}
      </div>

      <TagFilterSheet
        open={tagSheetOpen}
        onClose={() => setTagSheetOpen(false)}
        allTags={allTags}
        counts={tagCounts}
        selected={selectedTags}
        onToggle={toggleTag}
        onClear={() => setSelectedTags([])}
        matchCount={shown.length}
      />

      <ImportSheet
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => {
          setImportOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}

function best(r: Recipe): number | null {
  const values = Object.values(r.ratings).filter(
    (v): v is number => typeof v === "number"
  );
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function ImportSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [status, setStatus] = useState("");
  const [outcome, setOutcome] = useState<JobOutcome | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setUrl("");
    setNotes("");
    setPhotos([]);
    setStatus("");
    setOutcome(null);
    setError("");
  }

  async function submit() {
    setBusy(true);
    setError("");
    setOutcome(null);
    setStatus(
      photos.length > 0
        ? "Reading the photos and writing the recipe. This takes a minute."
        : "Fetching the page and writing the recipe. This takes a minute."
    );
    try {
      let uploadId: string | undefined;
      if (photos.length > 0) {
        setStatus("Uploading the photos.");
        const form = new FormData();
        for (const photo of photos) form.append("files", photo);
        const res = await fetch("/api/uploads", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Those photos did not upload.");
        uploadId = data.uploadId as string;
        setStatus("Reading the photos. Handwriting takes a moment longer.");
      }

      const { jobId } = await post<{ jobId: string }>("/api/claude", {
        kind: "import",
        url: url.trim(),
        notes: notes.trim(),
        uploadId,
      });
      const result = await pollJobOutcome(jobId, setStatus);
      setOutcome(result);
      setStatus("");
      if (result.status === "done") {
        setUrl("");
        setNotes("");
        setPhotos([]);
      }
      onDone();
    } catch (err) {
      setError(errorText(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = url.trim() !== "" || photos.length > 0;

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Import a recipe"
    >
      <p className="text-sm text-ink-soft">
        Two ways in. Paste a link from anywhere, or photograph the recipe.
        Either way it lands as a draft for you to check before it joins the
        planner.
      </p>

      <Field label="Link" hint="TikTok, Instagram, Pinterest, any recipe site.">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          type="url"
          inputMode="url"
          placeholder="https://"
        />
      </Field>

      <Field
        label="Or photos"
        hint="A cookbook page, a screenshot, a handwritten card. Up to 8."
      >
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => setPhotos(Array.from(e.target.files ?? []))}
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-sm"
        />
      </Field>
      {photos.length > 0 ? (
        <p className="text-xs text-ink-faint">
          {photos.length} photo{photos.length === 1 ? "" : "s"} ready:{" "}
          {photos.map((p) => p.name).join(", ")}
        </p>
      ) : null}

      <Field label="Anything to add?" hint="Optional.">
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Halve the sugar, we like it less sweet"
        />
      </Field>

      <ErrorNote>{error}</ErrorNote>

      {status ? (
        <p className="whitespace-pre-wrap rounded-xl bg-surface-2 px-3 py-3 text-sm text-ink-soft">
          {status}
        </p>
      ) : null}

      {outcome ? <Outcome outcome={outcome} onClose={onClose} /> : null}

      <Button
        variant="primary"
        className="w-full"
        disabled={busy || !canSubmit}
        onClick={submit}
      >
        {busy ? "Working" : "Import it"}
      </Button>
    </Sheet>
  );
}

/**
 * How an import ended.
 *
 * Two of these outcomes are not failures and must not read like one. A page
 * that needs a real browser has been queued and will be picked up; a page
 * behind a login needs a human. Saying "import failed" to either would be a
 * lie that makes someone retry something that cannot work.
 */
function Outcome({
  outcome,
  onClose,
}: {
  outcome: JobOutcome;
  onClose: () => void;
}) {
  if (outcome.status === "needs_browser") {
    return (
      <Card className="border-warn/40 px-4 py-3">
        <p className="text-sm font-medium text-warn">Queued for browser fetch</p>
        <p className="mt-1 text-sm text-ink-soft">
          This one cannot be read without a real browser. Claude will pull it in
          the next live session and the recipe will appear in your drafts.
        </p>
        {outcome.text ? (
          <p className="mt-2 whitespace-pre-wrap text-xs text-ink-faint">
            {outcome.text}
          </p>
        ) : null}
      </Card>
    );
  }

  if (outcome.status === "needs_login") {
    return (
      <Card className="border-warn/40 px-4 py-3">
        <p className="text-sm font-medium text-warn">Needs a login</p>
        <p className="mt-1 text-sm text-ink-soft">
          That page is behind a login or a paywall, so nothing could be read.
          Open it yourself and screenshot the recipe, then import the photo.
        </p>
        {outcome.text ? (
          <p className="mt-2 whitespace-pre-wrap text-xs text-ink-faint">
            {outcome.text}
          </p>
        ) : null}
      </Card>
    );
  }

  if (outcome.status === "error") {
    return (
      <Card className="border-danger/40 px-4 py-3">
        <p className="text-sm font-medium text-danger">That did not work</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">
          {outcome.error || outcome.text || "No reason was given."}
        </p>
      </Card>
    );
  }

  return (
    <Card className="border-accent/40 bg-accent-soft px-4 py-3">
      <p className="text-sm font-medium text-accent">Saved as a draft</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">
        {outcome.text}
      </p>
      {outcome.slug ? (
        <Link
          href={`/recipes/${encodeURIComponent(outcome.slug)}`}
          onClick={onClose}
          className="mt-2 inline-block text-sm font-medium text-accent"
        >
          Review it now
        </Link>
      ) : null}
    </Card>
  );
}
