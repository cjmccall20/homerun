import { VaultError } from "@/lib/vault";

/**
 * Route-handler plumbing. Errors are allowed to surface with their real
 * message: this app has exactly two users and a hidden failure in the kitchen
 * is worse than a blunt one.
 */

export function ok<T>(data: T): Response {
  return Response.json(data as unknown as Record<string, unknown>);
}

export function fail(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function handle(
  fn: () => Promise<Response>
): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof VaultError ? 400 : 500;
    console.error("[homerun]", message);
    return fail(message, status);
  }
}

export async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("Expected a JSON body");
  }
}

export function str(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

export function num(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number`);
  return n;
}

export function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

export function strList(value: unknown, field: string): string[] {
  if (typeof value === "string") {
    return value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) throw new Error(`${field} must be a list`);
  return value.map((v) => String(v).trim()).filter(Boolean);
}
