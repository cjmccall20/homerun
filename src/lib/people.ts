/**
 * The household roster, kept in its own module with no Node imports so client
 * components can use it. `auth.ts` pulls node:crypto and can never be imported
 * from the browser.
 */

export const PEOPLE = ["Cooper", "Ashlyn"] as const;
export type Who = (typeof PEOPLE)[number];

export function isPerson(name: string): name is Who {
  return (PEOPLE as readonly string[]).includes(name);
}
