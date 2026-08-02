/**
 * Grocery threads.
 *
 * Each week's list gets a conversation at `Weeks/Threads/<week-of>.md`. You
 * type plain English at it ("we only get butter from Costco") and Claude
 * changes the household's preferences to match, then says in the thread what
 * it changed and why.
 *
 * Append-only, one line per turn, in the same grammar the recipe comments use:
 *
 *   - 2026-07-27 (Ashlyn): we only get butter from Costco
 *   - 2026-07-27 (Claude): added a rule to Ingredient-Prefs so butter is never
 *     ordered from Publix and shows pre-checked on the list.
 *   - 2026-07-27 (Claude) [awaiting-answer]: do you want the same for eggs?
 *
 * The awaiting-answer marker is load-bearing. A question Claude asks and
 * nobody answers is the thing that quietly rots, so it is marked in the file
 * and the nightly paper sweeps for it.
 *
 * Pure parsing and formatting, no filesystem, so it is testable.
 */

export type ThreadAuthor = string;

export interface ThreadEntry {
  /** Absolute line number in the file, so a reply can be marked answered. */
  line: number;
  date: string;
  author: ThreadAuthor;
  text: string;
  /** True when this is a question Claude asked that nobody has answered. */
  awaitingAnswer: boolean;
}

const ENTRY_RE =
  /^\s*-\s+(\d{4}-\d{2}-\d{2})\s*\(([^)]*)\)\s*(\[awaiting-answer\])?\s*:\s*(.*)$/i;

export const AWAITING_MARKER = "[awaiting-answer]";

export function formatEntry(
  date: string,
  author: string,
  text: string,
  awaitingAnswer = false
): string {
  // One turn is one line: a newline in the middle would start a new entry.
  const clean = text.replace(/\s+/g, " ").trim();
  const marker = awaitingAnswer ? ` ${AWAITING_MARKER}` : "";
  return `- ${date} (${author})${marker}: ${clean}`;
}

export function parseThread(text: string): ThreadEntry[] {
  const out: ThreadEntry[] = [];
  const lines = (text || "").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const match = ENTRY_RE.exec(lines[i]);
    if (!match) continue;
    const body = match[4].trim();
    if (!body) continue;
    out.push({
      line: i,
      date: match[1],
      author: match[2].trim(),
      text: body,
      awaitingAnswer: Boolean(match[3]),
    });
  }
  return out;
}

function isClaude(author: string): boolean {
  return author.trim().toLowerCase() === "claude";
}

/**
 * Questions still waiting on a person.
 *
 * A question counts as answered as soon as anybody who is not Claude says
 * something after it. That is deliberately generous: the point is to catch
 * questions nobody engaged with at all, not to police whether the reply
 * actually addressed it.
 */
export function unansweredQuestions(entries: ThreadEntry[]): ThreadEntry[] {
  const out: ThreadEntry[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry.awaitingAnswer || !isClaude(entry.author)) continue;
    const answered = entries
      .slice(i + 1)
      .some((later) => !isClaude(later.author));
    if (!answered) out.push(entry);
  }
  return out;
}

/** The header written when a thread is created, so the file explains itself. */
export function threadHeader(weekOf: string): string {
  return [
    `# Grocery thread - week of ${weekOf}`,
    "",
    "Notes and corrections about this week's shopping. Anything written here is",
    "read by Claude, which updates Ingredient-Prefs and the staples lists to",
    "match and replies below saying what it changed.",
    "",
    "## Thread",
    "",
  ].join("\n");
}

/** The transcript, for handing to a job as context. */
export function renderTranscript(entries: ThreadEntry[], limit = 30): string {
  return entries
    .slice(-limit)
    .map((e) => `${e.author} (${e.date}): ${e.text}`)
    .join("\n");
}
