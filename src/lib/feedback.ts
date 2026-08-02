import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * The suggestion box.
 *
 * A request written on a phone becomes a file, a launchd agent notices it, and
 * a Claude session with write access to this repo tries to build the thing.
 * The file is the whole protocol, the same as the order runner: both sides can
 * restart mid-flight and the request survives.
 *
 * Every status here is written to be read by somebody who does not write
 * software. "snag" is not "error", and the blocker is a sentence about what is
 * needed rather than a stack trace.
 */

export type FeedbackStatus = "received" | "building" | "shipped" | "snag";

export interface FeedbackRequest {
  id: string;
  who: string;
  text: string;
  date: string;
  status: FeedbackStatus;
  startedAt?: string;
  finishedAt?: string;
  /** Plain words about what changed, shown when shipped. */
  changelog?: string;
  /** Short commit hash, when one was made. */
  commit?: string;
  /** Plain words about what is needed, shown when snagged. */
  blocker?: string;
}

const FEEDBACK_DIR = path.join(process.cwd(), "jobs", "feedback");

function requestPath(id: string): string {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Bad request id");
  return path.join(FEEDBACK_DIR, `${id}.json`);
}

export async function createRequest(
  who: string,
  text: string
): Promise<FeedbackRequest> {
  const clean = text.trim();
  if (!clean) throw new Error("Write what you would like changed first.");
  if (clean.length > 2000) {
    throw new Error("That is very long. Try describing just the one change.");
  }

  const request: FeedbackRequest = {
    id: randomUUID(),
    who,
    text: clean,
    date: new Date().toISOString(),
    status: "received",
  };

  await fs.mkdir(FEEDBACK_DIR, { recursive: true });
  // Temp then rename: launchd's WatchPaths fires on any change in the
  // directory, and a half-written request would be picked up and parsed as
  // nonsense.
  const tmp = path.join(FEEDBACK_DIR, `.${request.id}.tmp`);
  await fs.writeFile(tmp, `${JSON.stringify(request, null, 2)}\n`, "utf8");
  await fs.rename(tmp, requestPath(request.id));
  return request;
}

export async function readRequest(id: string): Promise<FeedbackRequest | null> {
  try {
    return JSON.parse(await fs.readFile(requestPath(id), "utf8")) as FeedbackRequest;
  } catch {
    return null;
  }
}

/** Every request, newest first. */
export async function listRequests(): Promise<FeedbackRequest[]> {
  let names: string[];
  try {
    names = await fs.readdir(FEEDBACK_DIR);
  } catch {
    return [];
  }
  const out: FeedbackRequest[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    try {
      out.push(
        JSON.parse(
          await fs.readFile(path.join(FEEDBACK_DIR, name), "utf8")
        ) as FeedbackRequest
      );
    } catch {
      // Mid-write. It will be there on the next poll.
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * A request that says "building" but whose runner died would spin forever on
 * the phone. Anything older than this is reported as stuck instead.
 */
const STALL_MS = 30 * 60 * 1000;

export function isStalled(
  request: FeedbackRequest,
  now: number = Date.now()
): boolean {
  if (request.status !== "building" && request.status !== "received") return false;
  const started = Date.parse(request.startedAt ?? request.date);
  if (!Number.isFinite(started)) return false;
  return now - started > STALL_MS;
}
