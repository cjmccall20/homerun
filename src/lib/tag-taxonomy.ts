/**
 * What the tags mean.
 *
 * A flat row of chips works at thirty recipes and falls apart at three
 * hundred: by then there are a hundred tags, the row scrolls forever, and
 * nobody can find "crockpot" because it is somewhere between "comfort-food"
 * and "dessert". So tags are grouped into bins, and the grouping is data
 * rather than logic so the same map can be reused anywhere a tag needs
 * classifying.
 *
 * Deliberately free of Node imports: the browser does the filtering.
 *
 * A tag that is not listed here is not an error. It lands in Other and the app
 * carries on, which is what keeps an import free to invent a tag nobody
 * anticipated.
 */

export type BinKey = "type" | "cuisine" | "method" | "protein" | "other";

export interface TagBin {
  key: BinKey;
  label: string;
  /** Canonical tags belonging to this bin. */
  tags: string[];
}

/** Ordered: this is the order the bins appear in the filter sheet. */
export const TAG_BINS: TagBin[] = [
  {
    key: "type",
    label: "Type",
    tags: [
      "breakfast",
      "brunch",
      "lunch",
      "dinner",
      "dessert",
      "snack",
      "side",
      "appetizer",
      "drink",
      "cocktail",
      "soup",
      "salad",
      "sandwich",
      "wrap",
      "pasta",
      "pizza",
      "bread",
      "quick-bread",
      "dip",
      "sauce",
      "casserole",
      "bowl",
    ],
  },
  {
    key: "cuisine",
    label: "Cuisine",
    tags: [
      "american",
      "italian",
      "mexican",
      "asian",
      "chinese",
      "japanese",
      "korean",
      "thai",
      "vietnamese",
      "indian",
      "mediterranean",
      "greek",
      "middle-eastern",
      "french",
      "spanish",
      "german",
      "british",
      "southern",
      "cajun",
      "tex-mex",
      "caribbean",
      "hawaiian",
    ],
  },
  {
    key: "method",
    label: "How it is made",
    tags: [
      "crockpot",
      "instant-pot",
      "air-fryer",
      "grilling",
      "baking",
      "roasting",
      "no-bake",
      "stovetop",
      "one-pan",
      "sheet-pan",
      "freezer-friendly",
      "make-ahead",
      "meal-prep",
      "quick",
      "weeknight",
      "30-minute",
      "5-ingredient",
    ],
  },
  {
    key: "protein",
    label: "Protein",
    tags: [
      "chicken",
      "beef",
      "ground-beef",
      "pork",
      "sausage",
      "bacon",
      "turkey",
      "lamb",
      "salmon",
      "shrimp",
      "fish",
      "seafood",
      "egg",
      "tofu",
      "vegetarian",
      "vegan",
    ],
  },
];

export const BIN_ORDER: BinKey[] = ["type", "cuisine", "method", "protein", "other"];

export const OTHER_BIN: TagBin = { key: "other", label: "Everything else", tags: [] };

/**
 * Tags that mean the same thing written differently. Imports arrive from a
 * dozen creators who each have their own vocabulary, so "slowcooker",
 * "slow-cooker" and "crock-pot" all have to become one filter.
 *
 * Exported as data so a normalizer elsewhere can reuse exactly this map rather
 * than growing a second, drifting copy.
 */
export const TAG_ALIASES: Record<string, string> = {
  "slow-cooker": "crockpot",
  slowcooker: "crockpot",
  "crock-pot": "crockpot",
  crockpot_meal: "crockpot",
  airfryer: "air-fryer",
  "air-fried": "air-fryer",
  grilled: "grilling",
  grill: "grilling",
  bbq: "grilling",
  baked: "baking",
  bake: "baking",
  roasted: "roasting",
  "one-pot": "one-pan",
  onepan: "one-pan",
  "sheetpan": "sheet-pan",
  "instapot": "instant-pot",
  "pressure-cooker": "instant-pot",
  freezer: "freezer-friendly",
  "make ahead": "make-ahead",
  mealprep: "meal-prep",
  "meal prep": "meal-prep",
  easy: "quick",
  fast: "quick",
  "30-minutes": "30-minute",
  "weeknight-dinner": "weeknight",
  supper: "dinner",
  entree: "dinner",
  main: "dinner",
  "main-dish": "dinner",
  desserts: "dessert",
  sweets: "dessert",
  drinks: "drink",
  beverage: "drink",
  appetizers: "appetizer",
  starter: "appetizer",
  sides: "side",
  "side-dish": "side",
  veggie: "vegetarian",
  veg: "vegetarian",
  meatless: "vegetarian",
  "ground beef": "ground-beef",
  hamburger: "ground-beef",
  prawns: "shrimp",
  seafoods: "seafood",
  noodles: "pasta",
  soups: "soup",
  salads: "salad",
  sandwiches: "sandwich",
  wraps: "wrap",
  mex: "mexican",
  "tex mex": "tex-mex",
  japan: "japanese",
  chinese_food: "chinese",
};

/** Lowercase, hyphenated, alias-resolved. The one true form of a tag. */
export function normalizeTag(raw: string): string {
  const cleaned = String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return TAG_ALIASES[cleaned] ?? cleaned;
}

const BIN_BY_TAG: Map<string, BinKey> = (() => {
  const map = new Map<string, BinKey>();
  for (const bin of TAG_BINS) {
    for (const tag of bin.tags) map.set(tag, bin.key);
  }
  return map;
})();

export function binForTag(tag: string): BinKey {
  return BIN_BY_TAG.get(normalizeTag(tag)) ?? "other";
}

export interface GroupedBin {
  key: BinKey;
  label: string;
  /** Tags actually present, with how many recipes carry each. */
  tags: { tag: string; count: number }[];
}

/**
 * Groups the tags that actually exist into bins, in bin order, dropping bins
 * with nothing in them. Within a bin, the most-used tags come first: at three
 * hundred recipes the useful filters are the popular ones, and alphabetical
 * order buries them.
 */
export function groupTagsIntoBins(
  allTags: string[],
  counts?: Map<string, number>
): GroupedBin[] {
  const seen = new Map<BinKey, Map<string, number>>();
  for (const raw of allTags) {
    const tag = normalizeTag(raw);
    if (!tag) continue;
    const key = binForTag(tag);
    const bucket = seen.get(key) ?? new Map<string, number>();
    bucket.set(tag, counts?.get(tag) ?? bucket.get(tag) ?? 0);
    seen.set(key, bucket);
  }

  const labels = new Map<BinKey, string>(
    [...TAG_BINS, OTHER_BIN].map((b) => [b.key, b.label])
  );

  return BIN_ORDER.map((key) => ({
    key,
    label: labels.get(key) ?? key,
    tags: [...(seen.get(key) ?? new Map())]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
  })).filter((bin) => bin.tags.length > 0);
}

/** True when a recipe carries every selected tag. Selecting nothing matches all. */
export function matchesAllTags(
  recipeTags: string[],
  selected: string[]
): boolean {
  if (selected.length === 0) return true;
  const have = new Set(recipeTags.map(normalizeTag));
  return selected.every((tag) => have.has(normalizeTag(tag)));
}
