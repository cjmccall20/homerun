import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Order jobs: the handoff between the phone and the Mac.
 *
 * The Grocery tab writes a job file here. A launchd agent watching this
 * directory wakes up, hands the job to the cart builder in ~/Tools/homerun-orders,
 * and writes the result back into the same file. The phone polls it.
 *
 * A file on disk is the whole protocol. No queue, no socket, no shared memory:
 * both sides can restart at any point and the job survives, which is exactly
 * what you want from something that runs a browser for several minutes.
 */

export type OrderStatus = "pending" | "building" | "done" | "failed";

export interface OrderItem {
  text: string;
  category: string;
}

export interface OrderAdded {
  requested: string;
  product: string;
  size?: string;
  price?: string;
  badges?: string[];
  why?: string;
}

export interface OrderSkipped {
  requested: string;
  reason: string;
}

export interface OrderSubstitution {
  requested: string;
  chose: string;
  why: string;
}

export interface OrderResult {
  added?: OrderAdded[];
  skipped?: OrderSkipped[];
  substitutions?: OrderSubstitution[];
  cartTotal?: string;
  cartItemCount?: number;
  notes?: string;
}

export interface OrderJob {
  id: string;
  status: OrderStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  source: { generatedOn: string; itemCount: number };
  items: OrderItem[];
  result?: OrderResult;
  error?: string;
}

const ORDERS_DIR = path.join(process.cwd(), "jobs", "orders");

function jobPath(id: string): string {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Bad order id");
  return path.join(ORDERS_DIR, `${id}.json`);
}

export async function createOrder(
  items: OrderItem[],
  generatedOn: string
): Promise<OrderJob> {
  if (items.length === 0) {
    throw new Error("There is nothing unchecked on the list to order.");
  }
  const job: OrderJob = {
    id: randomUUID(),
    status: "pending",
    createdAt: new Date().toISOString(),
    source: { generatedOn, itemCount: items.length },
    items,
  };
  await fs.mkdir(ORDERS_DIR, { recursive: true });

  /*
   * Write to a temp file and rename. launchd's WatchPaths fires on any change
   * in the directory, and a partially written job would be picked up and
   * parsed as garbage. The rename makes the job appear complete or not at all.
   */
  const tmp = path.join(ORDERS_DIR, `.${job.id}.tmp`);
  await fs.writeFile(tmp, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  await fs.rename(tmp, jobPath(job.id));
  return job;
}

export async function readOrder(id: string): Promise<OrderJob | null> {
  try {
    return JSON.parse(await fs.readFile(jobPath(id), "utf8")) as OrderJob;
  } catch {
    return null;
  }
}

/** The most recent job, so the tab can show a run that is already going. */
export async function latestOrder(): Promise<OrderJob | null> {
  let names: string[];
  try {
    names = await fs.readdir(ORDERS_DIR);
  } catch {
    return null;
  }
  const jobs: OrderJob[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    try {
      jobs.push(
        JSON.parse(
          await fs.readFile(path.join(ORDERS_DIR, name), "utf8")
        ) as OrderJob
      );
    } catch {
      // A job mid-write. It will be there on the next poll.
    }
  }
  if (jobs.length === 0) return null;
  jobs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return jobs[0];
}

/**
 * A job that says "building" but whose runner died would spin forever on the
 * phone. Anything older than this is reported as stalled instead.
 */
const STALL_MS = 20 * 60 * 1000;

export function isStalled(job: OrderJob, now: number = Date.now()): boolean {
  if (job.status !== "building" && job.status !== "pending") return false;
  const started = Date.parse(job.startedAt ?? job.createdAt);
  if (!Number.isFinite(started)) return false;
  return now - started > STALL_MS;
}
