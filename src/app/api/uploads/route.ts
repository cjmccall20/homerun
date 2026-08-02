import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { fail, handle, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Photo uploads for a recipe import.
 *
 * A cookbook page, a screenshot, a handwritten card from somebody's mother.
 * The files land in jobs/uploads/<id>/ and the import job reads them with the
 * Read tool, which sees images. Nothing is parsed here: this route's only jobs
 * are to refuse things that are not photographs and to hand back an id.
 */

const UPLOADS_DIR = path.join(process.cwd(), "jobs", "uploads");
const MAX_FILES = 8;
const MAX_BYTES = 12 * 1024 * 1024;

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/gif": "gif",
};

export async function POST(request: Request) {
  return handle(async () => {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail("Expected a multipart upload.");
    }

    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) return fail("No photos were attached.");
    if (files.length > MAX_FILES) {
      return fail(`That is more than ${MAX_FILES} photos. Send the recipe pages only.`);
    }

    const id = randomUUID();
    const dir = path.join(UPLOADS_DIR, id);
    await fs.mkdir(dir, { recursive: true });

    const saved: { name: string; bytes: number }[] = [];
    for (const [index, file] of files.entries()) {
      const extension = ALLOWED[file.type];
      if (!extension) {
        await fs.rm(dir, { recursive: true, force: true });
        return fail(
          `"${file.name || "that file"}" is a ${file.type || "unknown type"}. Photos only.`
        );
      }
      if (file.size > MAX_BYTES) {
        await fs.rm(dir, { recursive: true, force: true });
        return fail(`"${file.name}" is larger than 12MB.`);
      }
      // Names are generated, never taken from the client: an uploaded name is
      // attacker-controlled and this is writing to disk.
      const name = `page-${String(index + 1).padStart(2, "0")}.${extension}`;
      await fs.writeFile(
        path.join(dir, name),
        Buffer.from(await file.arrayBuffer())
      );
      saved.push({ name, bytes: file.size });
    }

    return ok({ ok: true, uploadId: id, files: saved });
  });
}
