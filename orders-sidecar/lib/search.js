"use strict";

const { goto, settle, dismissOverlays } = require("./browser");
const { scrapeProductsInPage, normalizeProducts } = require("./extract");

/**
 * One search, on one tab.
 *
 * Factored out so the single `search` command and the parallel bulk phase run
 * exactly the same code. A bulk phase that searched differently from the
 * command used to verify it would be a bulk phase nobody could trust.
 */

const SEARCH_URL = (q) =>
  `https://delivery.publix.com/store/publix/s?k=${encodeURIComponent(q)}`;

async function searchOnPage(page, query, limit = 6) {
  await goto(page, SEARCH_URL(query), "search");
  await dismissOverlays(page);

  let raw = await page.evaluate(scrapeProductsInPage, Math.max(limit * 3, 18));

  // The URL shape is Instacart's and has been stable, but if it ever stops
  // returning tiles, fall back to driving the search box like a person would.
  if (raw.products.length === 0) {
    const searched = await searchViaUi(page, query);
    if (searched) {
      raw = await page.evaluate(scrapeProductsInPage, Math.max(limit * 3, 18));
    }
  }

  return {
    products: normalizeProducts(raw.products, limit),
    diagnostics: raw.diagnostics,
  };
}

async function searchViaUi(page, query) {
  const box = page
    .getByRole("combobox", { name: /search/i })
    .or(page.getByRole("searchbox"))
    .or(page.getByPlaceholder(/search/i))
    .first();
  try {
    await box.waitFor({ state: "visible", timeout: 5000 });
    await box.fill(query);
    await box.press("Enter");
    await settle(page);
    return true;
  } catch {
    return false;
  }
}

module.exports = { searchOnPage, SEARCH_URL };
