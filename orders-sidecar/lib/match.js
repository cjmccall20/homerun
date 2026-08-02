"use strict";

/**
 * Deciding whether a search result satisfies its plan entry.
 *
 * This is the whole reason the bulk phase can skip a language model. The
 * planner already used judgement once, up front, to say what a good match
 * looks like ("the Thousand Hills brand", "whatever they bought last time",
 * "the cheapest organic one"). Checking whether a given tile meets that
 * description is mechanical, and mechanical is a hundred times faster.
 *
 * The bar is deliberately high. Anything that does not clearly meet its rule
 * is demoted to the judge phase rather than guessed at, because the cost of a
 * wrong item in the cart is a person noticing it and taking it out, while the
 * cost of a demotion is a few extra seconds. Pure functions, no browser, so
 * every rule below is tested.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "with", "in", "for", "to",
  "organic", "fresh", "natural", "brand",
]);

function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9%\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text) {
  return normalize(text)
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function hasBadge(product, pattern) {
  return (product.badges ?? []).some((b) => pattern.test(b));
}

function isOrganic(product) {
  return (
    hasBadge(product, /organic/i) ||
    /\borganic\b/i.test(product.name) ||
    /greenwise/i.test(product.name)
  );
}

/**
 * Singular-insensitive comparison: "limes" and "Lime" are the same word.
 * "es" is only the plural marker after a sibilant, so limes stems to lime
 * while boxes stems to box, and glass is left alone.
 */
function stem(word) {
  if (/(?:ch|sh|s|x|z)es$/.test(word)) return word.slice(0, -2);
  if (/[^s]s$/.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * Is this product plausibly the thing that was searched for?
 *
 * Without this gate the rules match on the wrong axis entirely. A live dry run
 * planned "3 organic limes" and the organic-best rule happily selected
 * "Terra Delyssa Olive Oil, Organic, Extra Virgin", because it was organic and
 * it was in the results. Being organic is not the same as being limes.
 *
 * Every significant word of the query must appear in the product name. The
 * planner builds the query from the item and its brand, so all of those words
 * genuinely should be there. Head noun alone was not enough: it let
 * "Thousand Hills Beef Sticks" satisfy a search for ground beef.
 *
 * This errs towards demotion, which is the safe direction. A demoted item
 * costs the judge phase a few seconds; a wrong one costs a trip back to the
 * shop.
 */
function isRelevant(product, query) {
  const want = tokens(query).map(stem).filter((t) => t.length >= 3);
  if (want.length === 0) return true;
  const have = new Set(tokens(product.name).map(stem));
  return want.every((t) => have.has(t));
}

/** Every significant word of the brand appears in the product name. */
function matchesBrand(product, brand) {
  const want = tokens(brand);
  if (want.length === 0) return false;
  const have = new Set(tokens(product.name));
  return want.every((t) => have.has(t));
}

/**
 * The item the plan asked for, or nothing.
 *
 * Returns { product, why } on a confident match, or { demote, why } when the
 * rule is not clearly met. Never returns a "best guess".
 */
function pickProduct(expect, products, query = "") {
  const all = Array.isArray(products) ? products : [];
  if (all.length === 0) {
    return { demote: true, why: "the search returned nothing" };
  }

  // Before any rule runs, keep only results that are actually the thing asked
  // for. Publix search returns loosely related products and sponsored
  // neighbours, and every rule below would otherwise happily match one.
  const list = query ? all.filter((p) => isRelevant(p, query)) : all;
  if (list.length === 0) {
    return {
      demote: true,
      why: `nothing in the results was actually ${query}`,
    };
  }

  const rule = String(expect ?? "judge").trim();

  if (rule === "judge") {
    return { demote: true, why: "the plan asked for a judgement call" };
  }

  if (rule.startsWith("brand:")) {
    const brand = rule.slice("brand:".length).trim();
    const hits = list.filter((p) => matchesBrand(p, brand));
    if (hits.length === 0) {
      return { demote: true, why: `no result matched the brand "${brand}"` };
    }
    // Several sizes of the right brand is normal; take the cheapest known
    // price, which is the smallest pack and the safest default.
    const priced = hits.filter((p) => typeof p.priceValue === "number");
    const chosen = priced.length
      ? priced.reduce((a, b) => (b.priceValue < a.priceValue ? b : a))
      : hits[0];
    return { product: chosen, why: `matched the ${brand} brand` };
  }

  if (rule === "buy-it-again") {
    const hits = list.filter((p) => hasBadge(p, /buy it again/i));
    if (hits.length === 0) {
      return {
        demote: true,
        why: "nothing carried the Buy it again badge, so there is no record they have bought it",
      };
    }
    return { product: hits[0], why: "they have bought this one before" };
  }

  if (rule === "organic-best") {
    const organic = list.filter(isOrganic);
    if (organic.length === 0) {
      return { demote: true, why: "no organic option appeared in the results" };
    }
    const priced = organic.filter((p) => typeof p.priceValue === "number");
    if (priced.length === 0) {
      return organic.length === 1
        ? { product: organic[0], why: "the only organic option" }
        : { demote: true, why: "several organic options and no prices to choose between them" };
    }
    const sorted = [...priced].sort((a, b) => a.priceValue - b.priceValue);
    const cheapest = sorted[0];
    // A near-tie is not a clear winner; two organic products a few cents apart
    // may be very different things, and that is a judgement call.
    const runnerUp = sorted[1];
    if (
      runnerUp &&
      Math.abs(runnerUp.priceValue - cheapest.priceValue) < 0.01 &&
      normalize(runnerUp.name) !== normalize(cheapest.name)
    ) {
      return {
        demote: true,
        why: "two different organic options at the same price, so the choice is not obvious",
      };
    }
    return { product: cheapest, why: "the cheapest organic option" };
  }

  return { demote: true, why: `unknown rule "${rule}"` };
}

/** A plan entry that should not be shopped at all. */
function isExcluded(item) {
  const text = String(item?.text ?? "");
  if (item?.checked === true) return { excluded: true, why: "already checked off" };
  const shop = /\[([A-Za-z][A-Za-z0-9 '&.-]{0,30})\]\s*$/.exec(text);
  if (shop) return { excluded: true, why: `bought at ${shop[1].trim()}` };
  return { excluded: false };
}

module.exports = {
  normalize,
  tokens,
  stem,
  isRelevant,
  matchesBrand,
  isOrganic,
  pickProduct,
  isExcluded,
};
