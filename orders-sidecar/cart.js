#!/usr/bin/env node
"use strict";

/**
 * cart.js - build a Publix pickup cart from the command line.
 *
 *   node cart.js status
 *   node cart.js search "organic limes" [--limit 6]
 *   node cart.js add 0 [--expect "Organic Limes"]
 *   node cart.js cart
 *   node cart.js clear-item "Organic Limes"
 *   node cart.js probe [auth|products|cart]
 *
 * Every command prints one JSON object to stdout and exits 0 on success or 1
 * on failure. Nothing is ever printed to stdout except that JSON, because the
 * order runner parses it.
 *
 * This tool adds to a cart and stops. It cannot reach checkout: see lib/safety.js.
 */

const fs = require("node:fs");
const path = require("node:path");

const {
  CartError,
  SafetyError,
  CDP_URL,
  connect,
  getStorePage,
  goto,
  settle,
  dismissOverlays,
  cleanCause,
} = require("./lib/browser");
const {
  scrapeProductsInPage,
  readCartCountInPage,
  scrapeCartInPage,
  readAuthStateInPage,
  normalizeProducts,
  normalizeName,
  judgeAuthState,
} = require("./lib/extract");
const { assertSafeClickLabel } = require("./lib/safety");
const { searchOnPage } = require("./lib/search");
const { runBulk } = require("./lib/bulk");
const { isExcluded } = require("./lib/match");

const STOREFRONT = "https://delivery.publix.com/store/publix/storefront";
const SEARCH_URL = (q) =>
  `https://delivery.publix.com/store/publix/s?k=${encodeURIComponent(q)}`;
const STATE_FILE = path.join(__dirname, ".state.json");
const DEFAULT_LIMIT = 6;

/* ------------------------------------------------------------- plumbing -- */

function out(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = next;
        i += 1;
      }
    } else positional.push(arg);
  }
  return { positional, flags };
}

/* ------------------------------------------------------------ page work -- */

/**
 * Reads the auth state, retrying while the header is still rendering.
 *
 * The storefront paints its category nav before its account controls, so a
 * read taken half a second too early sees no log in control and no account
 * control and reports "not signed in" for a session that is perfectly fine.
 * Keep looking until the page gives a confident answer or stops changing.
 */
async function readAuth(page, attempts = 4) {
  let signals = null;
  for (let i = 0; i < attempts; i += 1) {
    signals = await page.evaluate(readAuthStateInPage);
    const verdict = judgeAuthState(signals);
    if (verdict.confident) return { signals, verdict };
    await page.waitForTimeout(1200);
  }
  return { signals, verdict: judgeAuthState(signals) };
}

async function ensureSignedIn(page) {
  const { signals, verdict } = await readAuth(page);
  if (!verdict.signedIn) {
    throw new CartError(
      "NOT_LOGGED_IN",
      `The dedicated Chrome profile is not signed in to Publix (${verdict.reason}).`,
      "Open the profile and log in once: see the one-time setup in " +
        "~/Tools/homerun-orders/README.md. The session then persists in that profile.",
      { url: signals.url, confident: verdict.confident, signals }
    );
  }
  return verdict;
}

/** Runs a search and returns normalized products. Tags tiles for later clicks. */
async function runSearch(page, query, limit) {
  return searchOnPage(page, query, limit);
}

async function readCartCount(page) {
  try {
    return await page.evaluate(readCartCountInPage);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- commands -- */

async function cmdStatus() {
  const { browser, context } = await connect();
  try {
    const page = await getStorePage(context);
    if (!/publix\.com|instacart\.com/i.test(page.url())) {
      await goto(page, STOREFRONT, "status");
    }
    await dismissOverlays(page);
    const { verdict } = await readAuth(page);
    const cartCount = await readCartCount(page);

    out({
      ok: true,
      command: "status",
      cdpUrl: CDP_URL,
      chromeConnected: true,
      signedIn: verdict.signedIn,
      confident: verdict.confident,
      reason: verdict.reason,
      cartCount,
      url: page.url(),
    });
    return verdict.signedIn ? 0 : 1;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function cmdSearch(query, flags) {
  if (!query) {
    throw new CartError("BAD_USAGE", "search needs a query.", 'node cart.js search "organic limes"');
  }
  const limit = Number(flags.limit || DEFAULT_LIMIT);
  const { browser, context } = await connect();
  try {
    const page = await getStorePage(context);
    await goto(page, STOREFRONT, "search warmup");
    await dismissOverlays(page);
    await ensureSignedIn(page);

    const { products, diagnostics } = await runSearch(page, query, limit);
    if (products.length === 0) {
      /*
       * Two very different failures used to look identical, and telling them
       * apart is the whole point of this fix. "Publix has none" is a fact
       * about the shop. "We could not find the results grid" is a fact about
       * our scraper, and treating it as the first one is what caused 18 of 42
       * items to be reported unavailable when Publix stocked every one.
       */
      if (!diagnostics.resultsHeading) {
        throw new CartError(
          "RESULTS_GRID_NOT_FOUND",
          `The results grid for "${query}" was not on the page. ` +
            `Found ${diagnostics.carouselSections.length} recommendation ` +
            `carousel(s) instead, so this is NOT evidence that Publix is out of it.`,
          "The storefront markup may have changed. Run " +
            "`node cart.js probe products` and check whether the page still has " +
            'an h1 reading: Results for "<query>".',
          { query, diagnostics }
        );
      }
      throw new CartError(
        "NO_RESULTS",
        `Publix genuinely returned nothing for "${query}".`,
        "Try a simpler query; brand names and sizes often return nothing on " +
          "their search.",
        { query, diagnostics }
      );
    }

    writeState({
      lastSearch: {
        query,
        at: new Date().toISOString(),
        products: products.map((p) => ({
          index: p.index,
          addRef: p.addRef,
          name: p.name,
          size: p.size,
          price: p.price,
        })),
      },
    });

    out({ ok: true, command: "search", query, count: products.length, products });
    return 0;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function cmdAdd(target, flags) {
  const state = readState();
  const last = state.lastSearch;
  if (!last) {
    throw new CartError(
      "NO_SEARCH_STATE",
      "There is no previous search to add from.",
      'Run `node cart.js search "<query>"` first, then add by index.'
    );
  }

  const index = Number(target);
  if (!Number.isInteger(index) || index < 0) {
    throw new CartError(
      "BAD_USAGE",
      `"${target}" is not a search result index.`,
      "node cart.js add 0"
    );
  }
  const remembered = last.products.find((p) => p.index === index);
  if (!remembered) {
    throw new CartError(
      "BAD_INDEX",
      `The last search for "${last.query}" returned ${last.products.length} products, so index ${index} does not exist.`,
      "Search again and pick an index from that result list.",
      { available: last.products.map((p) => ({ index: p.index, name: p.name })) }
    );
  }
  const expected = normalizeName(flags.expect || remembered.name);

  const { browser, context } = await connect();
  try {
    const page = await getStorePage(context);
    await goto(page, STOREFRONT, "add warmup");
    await dismissOverlays(page);
    await ensureSignedIn(page);

    // Re-run the search: tile tags do not survive a page load, and prices and
    // availability move. This is also the check that stops us adding the wrong
    // groceries after Publix reshuffles its results.
    const { products, diagnostics } = await runSearch(
      page,
      last.query,
      Math.max(last.products.length, index + 1)
    );

    let match = products.find(
      (p) => p.index === index && normalizeName(p.name) === expected
    );
    if (!match) match = products.find((p) => normalizeName(p.name) === expected);
    if (!match) {
      throw new CartError(
        "PRODUCT_MOVED",
        `"${remembered.name}" is no longer in the results for "${last.query}", so nothing was added.`,
        "Search again and pick from the current results. Nothing was changed in the cart.",
        {
          expected: remembered.name,
          nowShowing: products.map((p) => ({ index: p.index, name: p.name })),
          diagnostics,
        }
      );
    }

    const before = await readCartCount(page);
    const addSelector = `[data-homerun-add="${match.addRef}"]`;
    const button = page.locator(addSelector).first();
    await button.waitFor({ state: "visible", timeout: 10000 }).catch(() => {
      throw new CartError(
        "ADD_BUTTON_MISSING",
        `Found "${match.name}" but its Add control was not clickable.`,
        "The product may be out of stock. Try another result.",
        { product: match }
      );
    });

    const label =
      (await button.getAttribute("aria-label")) || (await button.innerText().catch(() => ""));
    assertSafeClickLabel(label, "add to cart");

    await button.click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    await settle(page, { timeout: 8000 });
    const after = await readCartCount(page);

    const verified = before !== null && after !== null ? after > before : null;

    out({
      ok: true,
      command: "add",
      added: {
        name: match.name,
        size: match.size,
        price: match.price,
        priceValue: match.priceValue,
        badges: match.badges,
      },
      requestedIndex: index,
      cartCountBefore: before,
      cartCountAfter: after,
      verified,
      note:
        verified === null
          ? "The cart badge could not be read, so the add is unconfirmed. Run `node cart.js cart` to check."
          : verified
            ? "Cart count went up."
            : "Cart count did not change. The item may already have been in the cart.",
    });
    return 0;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function openCart(page) {
  const control = page
    .getByRole("button", { name: /^(cart|view cart|shopping cart|\d+ items?)/i })
    .or(page.locator("[data-testid*='cart' i]"))
    .or(page.getByRole("link", { name: /^cart/i }))
    .first();
  try {
    await control.waitFor({ state: "visible", timeout: 6000 });
    const label = (await control.getAttribute("aria-label")) || "";
    assertSafeClickLabel(label, "open cart");
    await control.click({ timeout: 6000 });
    await page.waitForTimeout(1200);
    await settle(page, { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

async function cmdCart() {
  const { browser, context } = await connect();
  try {
    const page = await getStorePage(context);
    await goto(page, STOREFRONT, "cart");
    await dismissOverlays(page);
    await ensureSignedIn(page);

    const opened = await openCart(page);
    const scraped = await page.evaluate(scrapeCartInPage);
    const count = await readCartCount(page);

    out({
      ok: true,
      command: "cart",
      opened,
      cartCount: count,
      itemCount: scraped.items.length,
      items: scraped.items.map((i) => ({ name: i.name, price: i.price })),
      // Rows the parser does not trust, with why. Reported separately so a
      // garbled line is never quoted back as if it were a real cart entry.
      suspect: scraped.suspect,
      subtotal: scraped.subtotal,
      total: scraped.total,
      diagnostics: scraped.diagnostics,
      note: opened
        ? undefined
        : "The cart panel could not be opened, so these items were read from the page as-is.",
    });
    return 0;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function cmdClearItem(name) {
  if (!name) {
    throw new CartError("BAD_USAGE", "clear-item needs a product name.", 'node cart.js clear-item "Organic Limes"');
  }
  const wanted = normalizeName(name);
  const { browser, context } = await connect();
  try {
    const page = await getStorePage(context);
    await goto(page, STOREFRONT, "clear-item");
    await dismissOverlays(page);
    await ensureSignedIn(page);
    await openCart(page);

    const before = await page.evaluate(scrapeCartInPage);
    const row = before.items.find((i) => normalizeName(i.name).includes(wanted));
    if (!row) {
      throw new CartError(
        "ITEM_NOT_IN_CART",
        `"${name}" is not in the cart, so nothing was removed.`,
        "Run `node cart.js cart` to see what is actually in there.",
        { inCart: before.items.map((i) => i.name) }
      );
    }

    /*
     * Publix labels the control "Remove <exact product name>", so target it
     * directly. The first version walked up from the product name to an
     * ancestor and hunted for a button inside it, which found a container far
     * too small and failed on every real removal.
     */
    const remove = page
      .getByRole("button", {
        name: new RegExp(`^Remove ${escapeForRegExp(row.name)}`, "i"),
      })
      .first();

    try {
      await remove.waitFor({ state: "visible", timeout: 8000 });
      const label = (await remove.getAttribute("aria-label")) || "";
      assertSafeClickLabel(label, "remove from cart");
      await remove.click({ timeout: 8000 });
      await page.waitForTimeout(1500);
      await settle(page, { timeout: 8000 });
    } catch (err) {
      if (err instanceof SafetyError) throw err;
      throw new CartError(
        "REMOVE_CONTROL_MISSING",
        `Found "${row.name}" in the cart but its Remove control did not respond.`,
        "Remove it by hand in the Publix app when you review the order.",
        { product: row.name, cause: cleanCause(err) }
      );
    }

    const after = await page.evaluate(scrapeCartInPage);
    out({
      ok: true,
      command: "clear-item",
      removed: row.name,
      itemsBefore: before.items.length,
      itemsAfter: after.items.length,
      total: after.total,
    });
    return 0;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Executes a match plan mechanically, three tabs at a time.
 *
 *   node cart.js bulk <plan.json> [--dry-run] [--tabs 3] [--rate 2]
 *
 * The plan says what a good match looks like for each item; this checks
 * whether a result meets that description and adds it if so. Anything that
 * does not clearly meet its rule is written out for the judge phase rather
 * than guessed at.
 */
async function cmdBulk(planPath, flags) {
  if (!planPath) {
    throw new CartError(
      "BAD_USAGE",
      "bulk needs a plan file.",
      "node cart.js bulk jobs/orders/<id>.json.plan.json [--dry-run]"
    );
  }

  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  } catch (err) {
    throw new CartError(
      "BAD_PLAN",
      `Could not read the plan at ${planPath}.`,
      "The plan phase writes this file. Check it ran and produced valid JSON.",
      { cause: cleanCause(err) }
    );
  }

  const all = Array.isArray(plan.items) ? plan.items : [];
  const excluded = [];
  const shoppable = [];
  for (const item of all) {
    const verdict = isExcluded(item);
    if (verdict.excluded) excluded.push({ item: item.text, why: verdict.why });
    else shoppable.push(item);
  }

  const mechanical = shoppable.filter((i) => i.expect && i.expect !== "judge");
  const preJudged = shoppable.filter((i) => !i.expect || i.expect === "judge");

  const dryRun = Boolean(flags["dry-run"]);
  const progressFile = plan.progressFile || (plan.jobFile ? `${plan.jobFile}.progress.jsonl` : "");

  const { browser, context } = await connect();
  const started = Date.now();
  try {
    const page = await getStorePage(context);
    await goto(page, STOREFRONT, "bulk warmup");
    await dismissOverlays(page);
    await ensureSignedIn(page);

    const results = await runBulk({
      context,
      items: mechanical,
      progressFile,
      dryRun,
      concurrency: Number(flags.tabs || 3),
      addsPerSecond: Number(flags.rate || 2),
    });

    const added = results.filter((r) => r.outcome === "added");
    const wouldAdd = results.filter((r) => r.outcome === "would-add");
    const demoted = results.filter((r) => r.outcome === "judge");

    // Everything the judge phase has to look at, in one place.
    const judgeList = [
      ...preJudged.map((i) => ({
        text: i.text,
        query: i.query,
        note: i.note || "",
        why: "the plan marked this one a judgement call",
      })),
      ...demoted.map((r) => ({
        text: r.item,
        query: r.query,
        why: r.why,
        candidates: r.candidates ?? [],
      })),
    ];

    if (plan.jobFile) {
      fs.writeFileSync(
        `${plan.jobFile}.judge.json`,
        `${JSON.stringify({ items: judgeList }, null, 2)}\n`,
        "utf8"
      );
    }

    out({
      ok: true,
      command: "bulk",
      dryRun,
      seconds: Math.round((Date.now() - started) / 1000),
      counts: {
        planned: all.length,
        excluded: excluded.length,
        mechanical: mechanical.length,
        added: added.length,
        wouldAdd: wouldAdd.length,
        forJudge: judgeList.length,
      },
      added: added.map((r) => ({ item: r.item, product: r.product, price: r.price })),
      wouldAdd: wouldAdd.map((r) => ({ item: r.item, product: r.product, price: r.price })),
      excluded,
      judge: judgeList,
    });
    return 0;
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Diagnostics for when the storefront markup changes. Not used by the runner. */
async function cmdProbe(what) {
  const { browser, context } = await connect();
  try {
    const page = await getStorePage(context);
    await goto(page, what === "products" ? SEARCH_URL("milk") : STOREFRONT, "probe");
    await dismissOverlays(page);

    const payload = { ok: true, command: "probe", what: what || "auth", url: page.url() };
    if (what === "products") {
      const raw = await page.evaluate(scrapeProductsInPage, 12);
      payload.diagnostics = raw.diagnostics;
      payload.rawProducts = raw.products.slice(0, 6);
      payload.normalized = normalizeProducts(raw.products, 6);
    } else if (what === "cart") {
      payload.opened = await openCart(page);
      payload.cart = await page.evaluate(scrapeCartInPage);
      payload.cartCount = await readCartCount(page);
    } else {
      const auth = await readAuth(page);
      payload.signals = auth.signals;
      payload.verdict = auth.verdict;
    }
    out(payload);
    return 0;
  } finally {
    await browser.close().catch(() => {});
  }
}

function escapeForRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ----------------------------------------------------------------- main -- */

const USAGE = `cart.js - build a Publix pickup cart

  node cart.js status
  node cart.js search "<query>" [--limit 6]
  node cart.js add <index> [--expect "<product name>"]
  node cart.js bulk <plan.json> [--dry-run] [--tabs 3] [--rate 2]
  node cart.js cart
  node cart.js clear-item "<product name>"
  node cart.js probe [auth|products|cart]

This tool never opens checkout or payment. A human places the order.`;

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positional;

  switch (command) {
    case "status":
      return cmdStatus();
    case "search":
      return cmdSearch(rest.join(" "), flags);
    case "add":
      return cmdAdd(rest[0], flags);
    case "bulk":
      return cmdBulk(rest[0], flags);
    case "cart":
      return cmdCart();
    case "clear-item":
      return cmdClearItem(rest.join(" "));
    case "probe":
      return cmdProbe(rest[0]);
    case "help":
    case "--help":
    case undefined:
      out({ ok: true, command: "help", usage: USAGE });
      return 0;
    default:
      throw new CartError("BAD_USAGE", `Unknown command "${command}".`, USAGE);
  }
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    const isKnown = err instanceof CartError || err instanceof SafetyError;
    out({
      ok: false,
      error: {
        code: err.code || "UNEXPECTED",
        message: err.message || String(err),
        hint: err.hint || null,
        detail: err.detail || null,
        ...(isKnown ? {} : { stack: String(err.stack || "").split("\n").slice(0, 4) }),
      },
    });
    process.exit(1);
  });
