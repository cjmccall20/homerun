"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import Link from "next/link";

import { errorText, get, post } from "@/lib/client";
import { todayISO } from "@/lib/dates";
import type { ListSection, OrderEntry, Preference } from "@/lib/parse/lists";
import type { Week } from "@/lib/parse/week";
import { PEOPLE } from "@/lib/people";
import { PageHeader } from "@/components/PageHeader";
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  Input,
  SectionTitle,
  Sheet,
  Textarea,
} from "@/components/ui";

/**
 * Everything that is edited rarely: staples, restaurants, ingredient
 * preferences, and who you are. Each editor writes back exactly one section of
 * one note, so the prose the household wrote around it stays put.
 */

type Panel =
  | "pantry"
  | "house"
  | "restaurants"
  | "prefs"
  | "favorites"
  | "weeks"
  | "who"
  | null;

/** What /api/week hands back for a template or an archived week. */
type WeekGrid = Week;

interface SavedWeek {
  name: string;
  weekOf: string;
  filled: number;
  scope: "template" | "archive";
}

interface FavoriteRecipe {
  slug: string;
  title: string;
  tags: string[];
}

export function MoreScreen({
  me,
  staples,
  restaurants,
  prefs,
  prefNotes,
  favorites,
  savedWeeks,
}: {
  me: string;
  staples: { pantry: string[]; house: string[] };
  restaurants: { favorites: string[]; history: OrderEntry[] };
  prefs: Preference[];
  prefNotes: ListSection[];
  favorites: FavoriteRecipe[];
  savedWeeks: SavedWeek[];
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  /*
   * Bins, the way the old McCall Home app had them: one tile per thing you
   * keep, each opening its own drawer. A settings list would have been less
   * work and would have buried the two lists people actually use weekly
   * (pantry and house staples) under a heading called Staples.
   */
  const bins: { key: Panel; label: string; detail: string }[] = [
    {
      key: "favorites",
      label: "Favorites",
      detail: `${favorites.length} recipe${favorites.length === 1 ? "" : "s"}`,
    },
    {
      key: "weeks",
      label: "Saved weeks",
      detail: `${savedWeeks.length} template${savedWeeks.length === 1 ? "" : "s"} and archived`,
    },
    {
      key: "pantry",
      label: "Pantry staples",
      detail: `${staples.pantry.length} kept stocked`,
    },
    {
      key: "house",
      label: "House staples",
      detail: `${staples.house.length} kept stocked`,
    },
    {
      key: "restaurants",
      label: "Restaurants",
      detail: `${restaurants.favorites.length} favorites, ${restaurants.history.length} logged`,
    },
    {
      key: "prefs",
      label: "Ingredient prefs",
      detail: `${prefs.length} brands`,
    },
  ];

  return (
    <>
      <PageHeader title="More" />

      <Link
        href="/plan"
        className="mb-2 flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-accent/40 bg-accent-soft px-4 text-accent"
      >
        <span className="text-[0.95rem] font-medium">
          Plan the week with Claude
        </span>
        <span aria-hidden className="text-lg">
          &rsaquo;
        </span>
      </Link>

      <Link
        href="/budget"
        className="mb-2 flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4"
      >
        <span className="min-w-0">
          <span className="block text-[0.95rem] font-medium">Budget</span>
          <span className="block text-xs text-ink-faint">
            Balances, spending, and envelopes across every account
          </span>
        </span>
        <span aria-hidden className="text-lg text-ink-faint">
          &rsaquo;
        </span>
      </Link>

      <Link
        href="/more/suggestions"
        className="mb-5 flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4"
      >
        <span className="min-w-0">
          <span className="block text-[0.95rem] font-medium">Suggestion box</span>
          <span className="block text-xs text-ink-faint">
            Ask how something works, or ask for it to work differently
          </span>
        </span>
        <span aria-hidden className="text-lg text-ink-faint">
          &rsaquo;
        </span>
      </Link>

      <ErrorNote>{error}</ErrorNote>

      <div className="grid grid-cols-2 gap-2">
        {bins.map((bin) => (
          <button
            key={bin.label}
            onClick={() => setPanel(bin.key)}
            className="flex min-h-24 flex-col justify-between rounded-2xl border border-line bg-surface p-4 text-left active:bg-surface-2"
          >
            <span className="text-[0.95rem] font-medium">{bin.label}</span>
            <span className="text-xs text-ink-faint">{bin.detail}</span>
          </button>
        ))}
      </div>

      <button
        onClick={() => setPanel("who")}
        className="mt-2 flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 text-left active:bg-surface-2"
      >
        <span className="text-[0.95rem] font-medium">Who is using this phone</span>
        <span className="text-sm text-ink-faint">{me}</span>
      </button>

      <p className="mt-6 px-1 text-xs leading-relaxed text-ink-faint">
        Everything here lives in ~/Obsidian/HQ/Family as plain markdown. Edit it
        in Obsidian or edit it here; it is the same file either way.
      </p>

      <form action="/api/auth/logout" method="post" className="mt-4">
        <Button
          type="button"
          variant="danger"
          className="w-full"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await post("/api/auth/logout", {});
              router.replace("/login");
            })
          }
        >
          Sign out
        </Button>
      </form>

      {/*
        Each editor is mounted only while it is open. They seed their textareas
        from props with useState, so a sheet that stays mounted would still be
        showing what you typed last time after a save and refresh.
      */}
      {panel === "pantry" ? (
        <StaplesSheet
          bin="pantry"
          busy={busy}
          items={staples.pantry}
          onClose={() => setPanel(null)}
          onSave={(items) =>
            run(async () => {
              await post("/api/lists", {
                action: "staples",
                pantry: items,
                house: staples.house,
              });
              setPanel(null);
            })
          }
        />
      ) : null}

      {panel === "house" ? (
        <StaplesSheet
          bin="house"
          busy={busy}
          items={staples.house}
          onClose={() => setPanel(null)}
          onSave={(items) =>
            run(async () => {
              await post("/api/lists", {
                action: "staples",
                pantry: staples.pantry,
                house: items,
              });
              setPanel(null);
            })
          }
        />
      ) : null}

      {panel === "favorites" ? (
        <FavoritesSheet
          favorites={favorites}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {panel === "weeks" ? (
        <SavedWeeksSheet weeks={savedWeeks} onClose={() => setPanel(null)} />
      ) : null}

      {panel === "restaurants" ? (
        <RestaurantsSheet
          open
          busy={busy}
          restaurants={restaurants}
          onClose={() => setPanel(null)}
          onSaveFavorites={(favorites) =>
            run(() =>
              post("/api/lists", { action: "restaurant-favorites", favorites })
            )
          }
          onLogOrder={(entry) =>
            run(() =>
              post("/api/lists", { action: "restaurant-order", ...entry })
            )
          }
        />
      ) : null}

      {panel === "prefs" ? (
        <PrefsSheet
          open
          busy={busy}
          prefs={prefs}
          notes={prefNotes}
          onClose={() => setPanel(null)}
          onSave={(next) =>
            run(async () => {
              await post("/api/lists", { action: "prefs", prefs: next });
              setPanel(null);
            })
          }
        />
      ) : null}

      <Sheet
        open={panel === "who"}
        onClose={() => setPanel(null)}
        title="Who is using this phone"
      >
        <p className="text-sm text-ink-soft">
          Sets who your ratings and comments are attributed to, and what the
          Mine filter means.
        </p>
        {PEOPLE.map((name) => (
          <Button
            key={name}
            variant={name === me ? "primary" : "quiet"}
            className="w-full"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await post("/api/auth/name", { name });
                setPanel(null);
              })
            }
          >
            {name}
          </Button>
        ))}
      </Sheet>
    </>
  );
}

/**
 * One staples bin at a time.
 *
 * Groceries-and-Staples.md has always had two sections and the old editor put
 * both in one drawer under a heading nobody read. Splitting them matches the
 * file, and matches how they are actually used: pantry churns, house staples
 * barely change.
 */
function StaplesSheet({
  bin,
  busy,
  items,
  onClose,
  onSave,
}: {
  bin: "pantry" | "house";
  busy: boolean;
  items: string[];
  onClose: () => void;
  onSave: (items: string[]) => void;
}) {
  const [text, setText] = useState(items.join("\n"));
  const pantry = bin === "pantry";

  return (
    <Sheet
      open
      onClose={onClose}
      title={pantry ? "Pantry staples" : "House staples"}
    >
      <p className="text-sm text-ink-soft">
        {pantry
          ? "Food that is always in the house. The grocery generator leaves these off the list."
          : "Everything that is not food: paper towels, dish soap, bin bags."}{" "}
        One item per line.
      </p>
      <Textarea
        rows={12}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          pantry ? "olive oil\nrice\ncanned tomatoes" : "paper towels\ndish soap"
        }
        aria-label={pantry ? "Pantry staples" : "House staples"}
      />
      <Button
        variant="primary"
        className="mb-2 w-full"
        disabled={busy}
        onClick={() => onSave(splitLines(text))}
      >
        {busy ? "Saving" : "Save"}
      </Button>
    </Sheet>
  );
}

/** Every recipe flagged favorite, as a bin you can shop from. */
function FavoritesSheet({
  favorites,
  onClose,
}: {
  favorites: FavoriteRecipe[];
  onClose: () => void;
}) {
  return (
    <Sheet open onClose={onClose} title="Favorites">
      {favorites.length === 0 ? (
        <Empty>
          Nothing starred yet. Tap Save on a recipe and it lands here.
        </Empty>
      ) : (
        <ul className="mb-2 space-y-2">
          {favorites.map((recipe) => (
            <li key={recipe.slug}>
              <Link
                href={`/recipes/${encodeURIComponent(recipe.slug)}`}
                onClick={onClose}
              >
                <Card className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {recipe.title}
                    </span>
                    {recipe.tags.length > 0 ? (
                      <span className="block truncate text-xs text-ink-faint">
                        {recipe.tags.join(", ")}
                      </span>
                    ) : null}
                  </span>
                  <span aria-hidden className="text-ink-faint">
                    &rsaquo;
                  </span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

/**
 * Saved weeks: templates you apply on purpose, and the archive of weeks that
 * already happened. Tapping one shows its grid, which is usually all you want
 * ("what did we eat the week of the 4th").
 */
function SavedWeeksSheet({
  weeks,
  onClose,
}: {
  weeks: SavedWeek[];
  onClose: () => void;
}) {
  const [open, setOpen] = useState<SavedWeek | null>(null);
  const [grid, setGrid] = useState<WeekGrid | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function show(week: SavedWeek) {
    setOpen(week);
    setGrid(null);
    setError("");
    setBusy(true);
    try {
      const data = await get<{ week: WeekGrid }>(
        `/api/week?scope=${week.scope}&name=${encodeURIComponent(week.name)}`
      );
      setGrid(data.week);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const templates = weeks.filter((w) => w.scope === "template");
  const archived = weeks.filter((w) => w.scope === "archive");

  return (
    <Sheet
      open
      onClose={() => {
        setOpen(null);
        onClose();
      }}
      title={open ? open.name : "Saved weeks"}
    >
      {open ? (
        <>
          <Button className="w-full" onClick={() => setOpen(null)}>
            Back to the list
          </Button>
          <ErrorNote>{error}</ErrorNote>
          {busy ? (
            <p className="text-sm text-ink-faint">Reading it.</p>
          ) : grid?.table ? (
            <div className="mb-2 space-y-2">
              {grid.table.rows.map((row, i) => (
                <Card key={i} className="px-4 py-2">
                  <p className="text-xs font-semibold">{row.day}</p>
                  <p className="text-sm text-ink-soft">
                    {row.cells
                      .map((c) => c.raw.trim())
                      .filter(Boolean)
                      .join("  /  ") || "Nothing planned"}
                  </p>
                </Card>
              ))}
            </div>
          ) : (
            <Empty>That week has no table in it.</Empty>
          )}
        </>
      ) : (
        <>
          {weeks.length === 0 ? (
            <Empty>
              No saved weeks yet. Save the current week as a template from the
              Week tab, or promote a draft and this fills up as weeks go by.
            </Empty>
          ) : null}

          {templates.length > 0 ? (
            <section>
              <SectionTitle>Templates</SectionTitle>
              <ul className="space-y-2">
                {templates.map((week) => (
                  <WeekRow key={`t-${week.name}`} week={week} onOpen={show} />
                ))}
              </ul>
            </section>
          ) : null}

          {archived.length > 0 ? (
            <section className="mb-2">
              <SectionTitle>Archive</SectionTitle>
              <ul className="space-y-2">
                {archived.map((week) => (
                  <WeekRow key={`a-${week.name}`} week={week} onOpen={show} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </Sheet>
  );
}

function WeekRow({
  week,
  onOpen,
}: {
  week: SavedWeek;
  onOpen: (week: SavedWeek) => void;
}) {
  return (
    <li>
      <button onClick={() => onOpen(week)} className="w-full text-left">
        <Card className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-surface-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{week.name}</span>
            <span className="block text-xs text-ink-faint">
              {week.filled} meals
              {week.weekOf ? ` and dated ${week.weekOf}` : ""}
            </span>
          </span>
          <span aria-hidden className="text-ink-faint">
            &rsaquo;
          </span>
        </Card>
      </button>
    </li>
  );
}

function RestaurantsSheet({
  open,
  busy,
  restaurants,
  onClose,
  onSaveFavorites,
  onLogOrder,
}: {
  open: boolean;
  busy: boolean;
  restaurants: { favorites: string[]; history: OrderEntry[] };
  onClose: () => void;
  onSaveFavorites: (favorites: string[]) => void;
  onLogOrder: (entry: OrderEntry) => void;
}) {
  const [favorites, setFavorites] = useState(restaurants.favorites.join("\n"));
  const [restaurant, setRestaurant] = useState("");
  const [what, setWhat] = useState("");
  const [verdict, setVerdict] = useState("");

  return (
    <Sheet open={open} onClose={onClose} title="Restaurants">
      <Field label="Favorites" hint="One per line.">
        <Textarea
          rows={5}
          value={favorites}
          onChange={(e) => setFavorites(e.target.value)}
          placeholder={"Taco Bus\nThe noodle place on Main"}
        />
      </Field>
      <Button
        className="w-full"
        disabled={busy}
        onClick={() => onSaveFavorites(splitLines(favorites))}
      >
        Save favorites
      </Button>

      <SectionTitle>Log what you ordered</SectionTitle>
      <Field label="Where">
        <Input
          value={restaurant}
          onChange={(e) => setRestaurant(e.target.value)}
          placeholder="Taco Bus"
        />
      </Field>
      <Field label="What you got">
        <Input
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          placeholder="al pastor, two orders"
        />
      </Field>
      <Field label="Worth repeating?">
        <Input
          value={verdict}
          onChange={(e) => setVerdict(e.target.value)}
          placeholder="yes, but skip the beans"
        />
      </Field>
      <Button
        variant="primary"
        disabled={busy || restaurant.trim() === ""}
        className="w-full"
        onClick={() => {
          onLogOrder({ date: todayISO(), restaurant, what, verdict });
          setRestaurant("");
          setWhat("");
          setVerdict("");
        }}
      >
        Log it
      </Button>

      <SectionTitle>Order history</SectionTitle>
      {restaurants.history.length === 0 ? (
        <Empty>Nothing logged yet.</Empty>
      ) : (
        <ul className="mb-2 space-y-2">
          {[...restaurants.history].reverse().map((entry, i) => (
            <li key={i}>
              <Card className="px-4 py-3">
                <p className="text-sm font-medium">{entry.restaurant}</p>
                <p className="text-xs text-ink-faint">
                  {[entry.date, entry.what, entry.verdict]
                    .filter(Boolean)
                    .join(" - ")}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function PrefsSheet({
  open,
  busy,
  prefs,
  notes,
  onClose,
  onSave,
}: {
  open: boolean;
  busy: boolean;
  prefs: Preference[];
  notes: ListSection[];
  onClose: () => void;
  onSave: (prefs: Preference[]) => void;
}) {
  const [text, setText] = useState(
    prefs.map((p) => `${p.ingredient}: ${p.preference}`).join("\n")
  );

  return (
    <Sheet open={open} onClose={onClose} title="Ingredient preferences">
      <p className="text-sm text-ink-soft">
        One per line, written as{" "}
        <code className="rounded bg-surface-2 px-1">ingredient: brand</code>.
        The grocery generator uses these when it writes item names.
      </p>
      <Textarea
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"ground beef: Thousand Hills grass fed, 70/30\nchicken: Farmer Focus organic"}
        aria-label="Ingredient preferences"
      />
      <Button
        variant="primary"
        className="w-full"
        disabled={busy}
        onClick={() => onSave(parsePrefLines(text))}
      >
        {busy ? "Saving" : "Save preferences"}
      </Button>

      {notes.map((section) => (
        <section key={section.title}>
          <SectionTitle>{section.title}</SectionTitle>
          <Card className="px-4 py-3">
            <ul className="space-y-2">
              {section.items.map((point, i) => (
                <li key={i} className="text-sm leading-relaxed text-ink-soft">
                  {point}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ))}
      <p className="mb-2 px-1 text-xs text-ink-faint">
        The notes above are read-only here. Edit them in Obsidian; Claude reads
        them when it plans and shops.
      </p>
    </Sheet>
  );
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parsePrefLines(value: string): Preference[] {
  return splitLines(value)
    .map((line) => {
      const idx = line.indexOf(":");
      if (idx <= 0) return null;
      return {
        ingredient: line.slice(0, idx).trim(),
        preference: line.slice(idx + 1).trim(),
      };
    })
    .filter((p): p is Preference => p !== null);
}
