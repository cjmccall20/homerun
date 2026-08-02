/**
 * Local-date helpers. Everything in the vault is a plain YYYY-MM-DD string in
 * the household's local time, so we never touch UTC (toISOString would shift
 * the date backwards for anyone west of Greenwich after 5pm).
 */

export function todayISO(now: Date = new Date()): string {
  return toISO(now);
}

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromISO(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Monday of the week containing `d`. */
export function startOfWeek(d: Date = new Date()): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = out.getDay(); // 0 = Sunday
  const delta = dow === 0 ? -6 : 1 - dow;
  out.setDate(out.getDate() + delta);
  return out;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon 7/27" - the label format used in the Meal-Plan table's Day column. */
export function dayLabel(d: Date): string {
  return `${DAY_NAMES[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

/** Seven day labels starting Monday of the week containing `d`. */
export function weekDayLabels(d: Date = new Date()): string[] {
  const start = startOfWeek(d);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return dayLabel(day);
  });
}

/**
 * Day labels for the week containing an ISO date. Parsed at noon local time so
 * a timezone offset can never nudge the date onto the day before.
 */
export function weekLabelsFor(iso: string): string[] {
  return weekDayLabels(atNoon(iso));
}

/**
 * The Monday of the week containing an ISO date. Every `week-of` value in the
 * vault is a Monday, so the Day column and the frontmatter always agree.
 */
export function weekStartISO(iso?: string): string {
  return toISO(startOfWeek(atNoon(iso ?? "")));
}

function atNoon(iso: string): Date {
  return fromISO(iso) ? new Date(`${iso}T12:00:00`) : new Date();
}

export interface Interval {
  count: number;
  unit: "day" | "week" | "month" | "year";
}

/**
 * Parses an @every() value: "3 months", "2 weeks", "daily", "weekly",
 * "monthly", "quarterly", "yearly", "10 days", "month".
 */
export function parseInterval(raw: string): Interval | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  const named: Record<string, Interval> = {
    daily: { count: 1, unit: "day" },
    day: { count: 1, unit: "day" },
    weekly: { count: 1, unit: "week" },
    week: { count: 1, unit: "week" },
    biweekly: { count: 2, unit: "week" },
    fortnightly: { count: 2, unit: "week" },
    monthly: { count: 1, unit: "month" },
    month: { count: 1, unit: "month" },
    quarterly: { count: 3, unit: "month" },
    yearly: { count: 1, unit: "year" },
    annually: { count: 1, unit: "year" },
    year: { count: 1, unit: "year" },
  };
  if (named[s]) return named[s];

  const m = /^(\d+)\s*(day|week|month|year)s?$/.exec(s);
  if (!m) return null;
  return { count: Number(m[1]), unit: m[2] as Interval["unit"] };
}

/** Advances a date by an interval. Month math clamps (Jan 31 + 1 month = Feb 28). */
export function advance(date: Date, interval: Interval): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  switch (interval.unit) {
    case "day":
      d.setDate(d.getDate() + interval.count);
      return d;
    case "week":
      d.setDate(d.getDate() + interval.count * 7);
      return d;
    case "year":
      d.setFullYear(d.getFullYear() + interval.count);
      return d;
    case "month": {
      const targetDay = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + interval.count);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(targetDay, lastDay));
      return d;
    }
  }
}

/**
 * The next occurrence of a recurring task: base date plus the interval, rolled
 * forward until it lands in the future so a long-neglected chore does not come
 * back already overdue.
 */
export function nextOccurrence(
  base: string | null,
  every: string,
  today: Date = new Date()
): string | null {
  const interval = parseInterval(every);
  if (!interval) return null;
  const anchor = (base && fromISO(base)) || today;
  let next = advance(anchor, interval);
  const floor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let guard = 0;
  while (next <= floor && guard < 500) {
    next = advance(next, interval);
    guard += 1;
  }
  return toISO(next);
}
