/**
 * The little protocol between a Claude job and the app.
 *
 * The CLI hands back prose, but "I could not fetch this, it needs a real
 * browser" has to become a state the app renders differently from a failure.
 * So the prompt ends with machine-readable lines and they come off here,
 * leaving the human-readable part for the screen.
 *
 * Kept in its own module, free of Next aliases, so the parsing is testable
 * without a server.
 */

export type JobStatus =
  | "running"
  | "done"
  | "error"
  | "needs_browser"
  | "needs_login";

const TERMINAL: JobStatus[] = ["done", "error", "needs_browser", "needs_login"];

export interface StatusMarkers {
  status: JobStatus | null;
  slug?: string;
  reason?: string;
  text: string;
}

export function readStatusMarkers(text: string): StatusMarkers {
  const statusMatch = /^\s*HOMERUN-STATUS:\s*(\w+)\s*$/im.exec(text);
  const slugMatch = /^\s*HOMERUN-SLUG:\s*([a-z0-9][a-z0-9-]*)\s*$/im.exec(text);
  const reasonMatch = /^\s*HOMERUN-REASON:\s*(.+)$/im.exec(text);

  const raw = statusMatch?.[1]?.toLowerCase();
  // An unrecognised value is ignored rather than trusted: a job that invents a
  // status must not be able to invent an app state.
  const status = TERMINAL.includes(raw as JobStatus) ? (raw as JobStatus) : null;

  return {
    status,
    slug: slugMatch?.[1],
    reason: reasonMatch?.[1]?.trim(),
    text: text.replace(/^\s*HOMERUN-(STATUS|SLUG|REASON):.*$/gim, "").trim(),
  };
}
