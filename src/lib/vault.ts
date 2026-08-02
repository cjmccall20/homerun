import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * The one door to the filesystem.
 *
 * Every read and write in HomeRun goes through here, which means there is
 * exactly one place that knows where the vault lives, exactly one place that
 * can escape it (and refuses to), and exactly one place that writes files.
 */

const envVault = process.env.HOMERUN_VAULT;
if (!envVault) {
  throw new Error(
    "HOMERUN_VAULT is not set. Run bin/setup.mjs, or set it in .env.local to the directory your household notes should live in."
  );
}
export const VAULT_ROOT = envVault;

export const FILES = {
  mealPlan: "Meal-Plan.md",
  groceryList: "Grocery-List.md",
  staples: "Groceries-and-Staples.md",
  restaurants: "Restaurants.md",
  prefs: "Ingredient-Prefs.md",
  honeydew: "Honeydew.md",
  index: "Family-Index.md",
} as const;

export const DIRS = {
  recipes: "Recipes",
  goals: "Goals",
  drafts: path.join("Weeks", "Drafts"),
  templates: path.join("Weeks", "Templates"),
  archive: path.join("Weeks", "Archive"),
  threads: path.join("Weeks", "Threads"),
  lists: path.join("Weeks", "Lists"),
} as const;

export class VaultError extends Error {}

/**
 * Resolves a vault-relative path and refuses anything that climbs out.
 * `..`, absolute paths and symlink-ish trickery all land here first.
 */
export function vaultPath(...segments: string[]): string {
  const joined = path.join(...segments);
  const resolved = path.resolve(VAULT_ROOT, joined);
  const root = path.resolve(VAULT_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new VaultError(`Refusing to touch a path outside the vault: ${joined}`);
  }
  return resolved;
}

/** A note name with no slashes, no dots, no surprises. */
export function safeName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[/\\]/g, "-")
    .replace(/^\.+/, "")
    .trim();
  if (!cleaned) throw new VaultError("Empty file name");
  return cleaned;
}

export async function exists(...segments: string[]): Promise<boolean> {
  try {
    await fs.access(vaultPath(...segments));
    return true;
  } catch {
    return false;
  }
}

export async function readFile(...segments: string[]): Promise<string> {
  return fs.readFile(vaultPath(...segments), "utf8");
}

/** Reads a file, returning `fallback` if it does not exist yet. */
export async function readFileOr(
  fallback: string,
  ...segments: string[]
): Promise<string> {
  try {
    return await fs.readFile(vaultPath(...segments), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

/**
 * Writes atomically: a dot-prefixed temp file in the same directory (Obsidian
 * ignores dotfiles) then a rename, so a watcher never sees a half-written note.
 */
export async function writeFile(
  relPath: string,
  contents: string
): Promise<void> {
  const target = vaultPath(relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = path.join(
    path.dirname(target),
    `.homerun-${randomBytes(6).toString("hex")}.tmp`
  );
  try {
    await fs.writeFile(tmp, contents, "utf8");
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Read, transform, write. The single mutation primitive: every vault write in
 * the app is expressed as a pure string transform, which is what makes the
 * parsers testable without touching a disk.
 */
export async function editFile(
  relPath: string,
  fallback: string,
  transform: (text: string) => string
): Promise<string> {
  const current = await readFileOr(fallback, relPath);
  const next = transform(current);
  if (next !== current) await writeFile(relPath, next);
  return next;
}

/** Markdown note names (without extension) in a vault directory, sorted. */
export async function listNotes(relDir: string): Promise<string[]> {
  const dir = vaultPath(relDir);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((f) => f.endsWith(".md") && !f.startsWith("."))
    .map((f) => f.slice(0, -3))
    .sort((a, b) => a.localeCompare(b));
}

export async function deleteNote(relDir: string, name: string): Promise<void> {
  await fs.rm(vaultPath(relDir, `${safeName(name)}.md`), { force: true });
}

export async function mtime(...segments: string[]): Promise<number | null> {
  try {
    const s = await fs.stat(vaultPath(...segments));
    return s.mtimeMs;
  } catch {
    return null;
  }
}
