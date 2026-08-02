"use client";

import { useMemo, useState } from "react";

import {
  groupTagsIntoBins,
  normalizeTag,
  type GroupedBin,
} from "@/lib/tag-taxonomy";
import { Button, Pill, Sheet } from "@/components/ui";

/**
 * Finding a recipe among hundreds.
 *
 * The old flat chip row was fine at thirty recipes. At three hundred there are
 * a hundred tags and the row becomes a mile of horizontal scrolling, so tags
 * are grouped into named bins behind a sheet, and what you have chosen stays
 * visible as removable chips above the results.
 *
 * Selecting more than one tag narrows rather than widens. That is the only
 * behaviour that makes sense once the collection is large: "dinner" plus
 * "italian" should be italian dinners, and a union would return more results
 * than you started with.
 */

export function SelectedTags({
  selected,
  onRemove,
  onClear,
}: {
  selected: string[];
  onRemove: (tag: string) => void;
  onClear: () => void;
}) {
  if (selected.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {selected.map((tag) => (
        <button
          key={tag}
          onClick={() => onRemove(tag)}
          aria-label={`Remove the ${tag} filter`}
          className="flex min-h-9 items-center gap-1.5 rounded-full border border-transparent bg-accent px-3 text-sm font-medium text-accent-ink"
        >
          {tag}
          <span aria-hidden className="text-base leading-none opacity-70">
            &times;
          </span>
        </button>
      ))}
      {selected.length > 1 ? (
        <button onClick={onClear} className="min-h-9 px-2 text-sm text-ink-soft">
          Clear all
        </button>
      ) : null}
    </div>
  );
}

export function TagFilterSheet({
  open,
  onClose,
  allTags,
  counts,
  selected,
  onToggle,
  onClear,
  matchCount,
}: {
  open: boolean;
  onClose: () => void;
  allTags: string[];
  counts: Map<string, number>;
  selected: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
  matchCount: number;
}) {
  const bins = useMemo(
    () => groupTagsIntoBins(allTags, counts),
    [allTags, counts]
  );
  // Bins with a selection start open, so you can see what you picked.
  const [openBins, setOpenBins] = useState<Set<string>>(new Set(["type"]));

  const isOpen = (bin: GroupedBin) =>
    openBins.has(bin.key) || bin.tags.some((t) => selected.includes(t.tag));

  return (
    <Sheet open={open} onClose={onClose} title="Filter by tag">
      <p className="text-sm text-ink-soft">
        Pick as many as you like. Each one narrows the list further.
      </p>

      <SelectedTags
        selected={selected}
        onRemove={onToggle}
        onClear={onClear}
      />

      {bins.map((bin) => (
        <section key={bin.key} className="border-t border-line pt-3">
          <button
            onClick={() =>
              setOpenBins((current) => {
                const next = new Set(current);
                if (next.has(bin.key)) next.delete(bin.key);
                else next.add(bin.key);
                return next;
              })
            }
            className="flex min-h-11 w-full items-center justify-between gap-2 text-left"
          >
            <span className="text-sm font-semibold">{bin.label}</span>
            <span className="flex items-center gap-2 text-xs text-ink-faint">
              {bin.tags.length}
              <span aria-hidden>{isOpen(bin) ? "−" : "+"}</span>
            </span>
          </button>

          {isOpen(bin) ? (
            <div className="flex flex-wrap gap-2 pb-2 pt-1">
              {bin.tags.map(({ tag, count }) => (
                <Pill
                  key={tag}
                  active={selected.includes(tag)}
                  onClick={() => onToggle(tag)}
                >
                  {tag}
                  {count > 0 ? (
                    <span className="ml-1.5 opacity-60">{count}</span>
                  ) : null}
                </Pill>
              ))}
            </div>
          ) : null}
        </section>
      ))}

      <Button variant="primary" className="mb-2 w-full" onClick={onClose}>
        Show {matchCount} recipe{matchCount === 1 ? "" : "s"}
      </Button>
    </Sheet>
  );
}

/**
 * Chip-based tag editing with autocomplete over the tags already in use.
 *
 * Reusing an existing tag matters more than inventing a tidy one: two spellings
 * of the same idea split a filter in half, so the suggestions are shown before
 * the free-text box rather than after it.
 */
export function TagEditor({
  tags,
  suggestions,
  busy,
  onChange,
}: {
  tags: string[];
  suggestions: string[];
  busy?: boolean;
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const current = tags.map(normalizeTag);
  const query = normalizeTag(draft);
  const matches = useMemo(() => {
    const pool = suggestions.map(normalizeTag).filter((t) => !current.includes(t));
    const unique = [...new Set(pool)];
    if (!query) return unique.slice(0, 12);
    return unique.filter((t) => t.includes(query)).slice(0, 12);
  }, [suggestions, current, query]);

  function add(tag: string) {
    const clean = normalizeTag(tag);
    if (!clean || current.includes(clean)) return;
    onChange([...current, clean]);
    setDraft("");
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {current.length === 0 ? (
          <p className="text-sm text-ink-faint">No tags yet.</p>
        ) : (
          current.map((tag) => (
            <button
              key={tag}
              disabled={busy}
              onClick={() => onChange(current.filter((t) => t !== tag))}
              aria-label={`Remove the ${tag} tag`}
              className="flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm disabled:opacity-40"
            >
              {tag}
              <span aria-hidden className="text-base leading-none text-ink-faint">
                &times;
              </span>
            </button>
          ))
        )}
      </div>

      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            e.preventDefault();
            add(draft);
          }
        }}
        disabled={busy}
        placeholder="Add a tag"
        aria-label="Add a tag"
        className="mt-3 w-full rounded-xl border border-line bg-surface px-3.5 py-3"
      />

      {matches.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {matches.map((tag) => (
            <button
              key={tag}
              disabled={busy}
              onClick={() => add(tag)}
              className="min-h-9 rounded-full border border-dashed border-line px-3 text-sm text-ink-soft disabled:opacity-40"
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}

      {query && !matches.includes(query) && !current.includes(query) ? (
        <button
          disabled={busy}
          onClick={() => add(query)}
          className="mt-2 min-h-9 text-sm font-medium text-accent disabled:opacity-40"
        >
          Add &quot;{query}&quot; as a new tag
        </button>
      ) : null}
    </div>
  );
}
