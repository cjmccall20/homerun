"use client";

/**
 * The client's half of the contract: post JSON, throw the server's own error
 * message on failure. No error is swallowed here; every screen shows what
 * actually went wrong, because "something went wrong" is useless when the
 * thing that went wrong is a file on your own Mac.
 */

export async function post<T = unknown>(
  url: string,
  payload: unknown
): Promise<T> {
  return send<T>(url, "POST", payload);
}

export async function patch<T = unknown>(
  url: string,
  payload: unknown
): Promise<T> {
  return send<T>(url, "PATCH", payload);
}

export async function put<T = unknown>(
  url: string,
  payload: unknown
): Promise<T> {
  return send<T>(url, "PUT", payload);
}

export async function del<T = unknown>(url: string): Promise<T> {
  return send<T>(url, "DELETE");
}

export async function get<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  return unwrap<T>(res);
}

async function send<T>(
  url: string,
  method: string,
  payload?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: payload === undefined ? {} : { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    cache: "no-store",
  });
  return unwrap<T>(res);
}

async function unwrap<T>(res: Response): Promise<T> {
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Fall through to the status-based message below.
  }
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Waits on a Claude job. The API starts a subprocess and returns an id; this
 * polls the job file until it settles. Progress is reported as elapsed time
 * because `claude -p` gives no intermediate output to show.
 */
export interface JobOutcome {
  status: "done" | "error" | "needs_browser" | "needs_login";
  text: string;
  slug?: string;
  error?: string;
}

/**
 * Waits on a Claude job and hands back how it ended, not just its text.
 * An import that needs a real browser or a login has finished successfully
 * and the screen says something different for each, so the caller needs the
 * status rather than an exception.
 */
export async function pollJobOutcome(
  jobId: string,
  onProgress: (message: string) => void
): Promise<JobOutcome> {
  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    const data = await get<{
      job?: {
        status: string;
        text: string;
        error?: string;
        slug?: string;
      };
    }>(`/api/claude?jobId=${encodeURIComponent(jobId)}`);
    const job = data.job;
    if (!job) throw new Error("Lost track of that job.");
    if (job.status !== "running") {
      return {
        status: job.status as JobOutcome["status"],
        text: job.text,
        slug: job.slug,
        error: job.error,
      };
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    onProgress(`Still working, ${seconds}s in.`);
  }
}

export async function pollJob(
  jobId: string,
  onProgress: (message: string) => void
): Promise<string> {
  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    const data = await get<{
      job?: { status: string; text: string; error?: string };
    }>(`/api/claude?jobId=${encodeURIComponent(jobId)}`);
    const job = data.job;
    if (!job) throw new Error("Lost track of that job.");
    if (job.status === "done") return job.text;
    if (job.status === "error") {
      throw new Error(job.error ?? "That did not work.");
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    onProgress(`Still working, ${seconds}s in.`);
  }
}
