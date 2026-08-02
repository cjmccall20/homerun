"use strict";

const { promises: fs } = require("node:fs");

const { CartError, getStorePage, goto, settle } = require("./browser");
const { readCartCountInPage } = require("./extract");
const { searchOnPage } = require("./search");
const { pickProduct, isExcluded } = require("./match");
const { assertSafeClickLabel } = require("./safety");

/**
 * The bulk phase.
 *
 * One Claude turn per item cost about 75 minutes for a 42 item list, and most
 * of those turns were spent doing something mechanical: search, look for the
 * brand the preferences already named, click Add. The planner makes the
 * judgement calls once, up front, and this executes them.
 *
 * Three tabs against the same logged-in profile. The cart lives on Publix's
 * servers, so concurrent adds are safe; what is not safe is hammering them, so
 * adds go through one shared rate limiter and the tabs start staggered.
 *
 * Every item is isolated. A search that times out on tab two must not stop
 * tabs one and three, and must not be recorded as anything other than what it
 * was: unfinished, and therefore a job for the judge phase.
 */

const STOREFRONT = "https://delivery.publix.com/store/publix/storefront";

/** Roughly two adds a second across all tabs, whatever the tabs are doing. */
function makeRateLimiter(perSecond) {
  const interval = 1000 / Math.max(0.2, perSecond);
  let next = 0;
  return async function take() {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + interval;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };
}

async function appendProgress(file, row) {
  if (!file) return;
  try {
    await fs.appendFile(file, `${JSON.stringify(row)}\n`, "utf8");
  } catch {
    // The ticker is a nicety. Losing a line must never stop the shopping.
  }
}

function nowISO() {
  return new Date().toISOString();
}

/**
 * Runs the mechanical entries of a plan.
 *
 * @param {object} options
 * @param {import('playwright-core').BrowserContext} options.context
 * @param {Array} options.items plan entries
 * @param {string} options.progressFile jsonl to append outcomes to
 * @param {boolean} options.dryRun decide everything, click nothing
 * @param {number} options.concurrency tabs
 * @param {number} options.addsPerSecond global add ceiling
 */
async function runBulk({
  context,
  items,
  progressFile,
  dryRun = false,
  concurrency = 3,
  addsPerSecond = 2,
  onEvent,
}) {
  const queue = items.map((item, index) => ({ item, index }));
  const results = [];
  const takeAddSlot = makeRateLimiter(addsPerSecond);
  let cursor = 0;

  const report = (row) => {
    results.push(row);
    onEvent?.(row);
    return appendProgress(progressFile, {
      item: row.item,
      outcome: row.outcome,
      product: row.product ?? "",
      why: row.why ?? "",
      at: nowISO(),
    });
  };

  async function worker(slot) {
    // Stagger the openings so three tabs do not all hit the storefront at once.
    await new Promise((r) => setTimeout(r, slot * 1200));

    const page = slot === 0 ? await getStorePage(context) : await context.newPage();
    page.setDefaultTimeout(25000);
    try {
      await goto(page, STOREFRONT, `bulk tab ${slot}`);
    } catch {
      // A tab that cannot reach the storefront is simply not used; the others
      // pick up its share of the queue.
      if (slot !== 0) await page.close().catch(() => {});
      return;
    }

    for (;;) {
      const next = cursor < queue.length ? queue[cursor++] : null;
      if (!next) break;
      const { item } = next;

      try {
        const { products } = await searchOnPage(page, item.query, 8);
        const decision = pickProduct(item.expect, products, item.query);

        if (decision.demote || !decision.product) {
          await report({
            item: item.text,
            outcome: "judge",
            why: decision.why,
            query: item.query,
            candidates: products.slice(0, 5).map((p) => ({
              name: p.name,
              price: p.price,
              badges: p.badges,
            })),
          });
          continue;
        }

        const product = decision.product;

        if (dryRun) {
          await report({
            item: item.text,
            outcome: "would-add",
            product: product.name,
            price: product.price,
            why: decision.why,
          });
          continue;
        }

        await takeAddSlot();
        const button = page
          .locator(`[data-homerun-add="${product.addRef}"]`)
          .first();
        await button.waitFor({ state: "visible", timeout: 10000 });
        const label =
          (await button.getAttribute("aria-label")) ||
          (await button.innerText().catch(() => ""));
        assertSafeClickLabel(label, "bulk add");

        const before = await page.evaluate(readCartCountInPage).catch(() => null);
        await button.click({ timeout: 10000 });
        await page.waitForTimeout(1200);
        await settle(page, { timeout: 6000 });
        const after = await page.evaluate(readCartCountInPage).catch(() => null);

        await report({
          item: item.text,
          outcome: "added",
          product: product.name,
          price: product.price,
          why: decision.why,
          verified: before !== null && after !== null ? after > before : null,
        });
      } catch (err) {
        // Per item, never per run. An item that failed here is unfinished, not
        // unavailable, and saying otherwise is how a stocked shop looks empty.
        await report({
          item: item.text,
          outcome: "judge",
          why: `the bulk pass could not finish this one: ${
            err instanceof CartError ? err.message : String(err?.message ?? err)
          }`,
          query: item.query,
        });
      }
    }

    if (slot !== 0) await page.close().catch(() => {});
  }

  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, (_, slot) => worker(slot))
  );

  return results;
}

module.exports = { runBulk, makeRateLimiter, isExcluded };
