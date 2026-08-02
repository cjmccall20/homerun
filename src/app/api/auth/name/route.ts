import { cookies } from "next/headers";

import { body, fail, handle, ok, str } from "@/lib/api";
import { SESSION_MAX_AGE, WHO_COOKIE, isPerson, makeWhoToken } from "@/lib/auth";

export async function POST(request: Request) {
  return handle(async () => {
    const { name } = await body<{ name?: unknown }>(request);
    const value = str(name ?? "", "name").trim();
    if (!isPerson(value)) return fail("Pick Cooper or Ashlyn.", 400);

    const store = await cookies();
    store.set(WHO_COOKIE, makeWhoToken(value), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return ok({ ok: true, name: value });
  });
}
