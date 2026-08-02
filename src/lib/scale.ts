/**
 * Ingredient quantity math, kept dependency-free so the servings slider can
 * run entirely in the browser. Scaling never writes anything: the note keeps
 * its own servings, and doubling a recipe is a view, not an edit.
 */

const VULGAR: Record<string, number> = {
  "½": 0.5,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 0.25,
  "¾": 0.75,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

const QTY_RE = new RegExp(
  `^\\s*(\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d*\\.\\d+|\\d+|[${Object.keys(VULGAR).join("")}])\\s*(.*)$`
);

export function parseQuantity(
  line: string
): { qty: number; rest: string } | null {
  const m = QTY_RE.exec(line);
  if (!m) return null;
  const raw = m[1].trim();
  if (VULGAR[raw] !== undefined) return { qty: VULGAR[raw], rest: m[2] };
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(raw);
  if (mixed) {
    return {
      qty: Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]),
      rest: m[2],
    };
  }
  const frac = /^(\d+)\/(\d+)$/.exec(raw);
  if (frac) return { qty: Number(frac[1]) / Number(frac[2]), rest: m[2] };
  const n = Number(raw);
  return Number.isFinite(n) ? { qty: n, rest: m[2] } : null;
}

const NICE_FRACTIONS: [number, string][] = [
  [1 / 8, "1/8"],
  [1 / 4, "1/4"],
  [1 / 3, "1/3"],
  [1 / 2, "1/2"],
  [2 / 3, "2/3"],
  [3 / 4, "3/4"],
];

/** Renders 1.5 as "1 1/2" and 0.33 as "1/3", the way a recipe card would. */
export function formatQuantity(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  if (frac < 0.05) return String(whole);

  let best: string | null = null;
  let bestDelta = 0.06;
  for (const [value, label] of NICE_FRACTIONS) {
    const delta = Math.abs(frac - value);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = label;
    }
  }
  if (!best) return String(Math.round(n * 100) / 100);
  return whole > 0 ? `${whole} ${best}` : best;
}

/** Scales one ingredient line. Lines with no leading quantity pass through. */
export function scaleIngredient(line: string, factor: number): string {
  if (factor === 1) return line;
  const parsed = parseQuantity(line);
  if (!parsed) return line;
  return `${formatQuantity(parsed.qty * factor)} ${parsed.rest}`.trim();
}
