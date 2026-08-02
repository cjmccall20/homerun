"use strict";

const { chromium } = require("playwright-core");

const { assertSafeUrl, SafetyError } = require("./safety");

/**
 * Playwright decorates its errors with terminal colour codes. Those escapes
 * end up in a JSON job file and then on a phone screen, so they come out here.
 */
function cleanCause(err) {
  return String((err && err.message) || err)
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * Talking to the dedicated Chrome.
 *
 * We attach to a browser that is already running with its own profile, we do
 * not launch one per command. That profile holds the Publix session Cooper
 * logged in with once, and it is the only reason any of this works unattended.
 */

const CDP_URL = process.env.HOMERUN_CDP_URL || "http://127.0.0.1:9222";
const NAV_TIMEOUT = Number(process.env.HOMERUN_NAV_TIMEOUT || 45000);

/** A failure with a code the app can branch on and a hint a human can act on. */
class CartError extends Error {
  constructor(code, message, hint, detail) {
    super(message);
    this.name = "CartError";
    this.code = code;
    this.hint = hint || null;
    this.detail = detail || null;
  }
}

async function connect() {
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 10000 });
  } catch (err) {
    throw new CartError(
      "CHROME_NOT_RUNNING",
      `Could not reach the HomeRun Chrome on ${CDP_URL}.`,
      "Start it with: launchctl kickstart -k gui/$(id -u)/com.homerun.chrome " +
        "(or `npm run chrome:start` in ~/Tools/homerun-orders). If it has never been " +
        "set up, follow the one-time login in that repo's README.",
      { cdpUrl: CDP_URL, cause: cleanCause(err) }
    );
  }

  const contexts = browser.contexts();
  if (contexts.length === 0) {
    await browser.close().catch(() => {});
    throw new CartError(
      "NO_BROWSER_CONTEXT",
      "Chrome is running but exposed no browser context over CDP.",
      "Restart it: launchctl kickstart -k gui/$(id -u)/com.homerun.chrome"
    );
  }
  return { browser, context: contexts[0] };
}

/**
 * Reuses the storefront tab if one is open, otherwise opens one. Reusing keeps
 * the profile from accumulating a tab per command over a long shopping run.
 */
async function getStorePage(context) {
  const pages = context.pages();
  for (const page of pages) {
    const url = page.url();
    if (/publix\.com|instacart\.com/i.test(url)) {
      try {
        assertSafeUrl(url, "existing tab");
        return page;
      } catch {
        // The tab drifted somewhere we will not touch. Leave it alone and
        // open a clean one instead of navigating it away from a human's work.
      }
    }
  }
  const page = pages.find((p) => p.url() === "about:blank") ?? (await context.newPage());
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);
  return page;
}

/** Navigates, refusing anything outside the storefront and settling the page. */
async function goto(page, url, context) {
  assertSafeUrl(url, context || "navigation");
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  } catch (err) {
    throw new CartError(
      "NAVIGATION_FAILED",
      `Could not load ${url}.`,
      "Check that the Mac has network access and that Publix is reachable in the dedicated Chrome.",
      { cause: cleanCause(err) }
    );
  }
  // A site can redirect anywhere; re-check where we actually landed.
  assertSafeUrl(page.url(), "after navigation");
  await settle(page);
  return page;
}

/**
 * Waits for the page to stop moving. Publix renders products client-side, so
 * "domcontentloaded" means nothing; we wait for the network to go quiet and
 * then for the DOM to stop growing.
 */
async function settle(page, { quietMs = 700, timeout = 20000 } = {}) {
  await page.waitForLoadState("networkidle", { timeout }).catch(() => {});
  const deadline = Date.now() + timeout;
  let previous = -1;
  while (Date.now() < deadline) {
    const count = await page
      .evaluate(() => document.querySelectorAll("*").length)
      .catch(() => -1);
    if (count === previous && count > 0) return;
    previous = count;
    await page.waitForTimeout(quietMs);
  }
}

/** Dismisses the cookie and location interstitials that hide the storefront. */
async function dismissOverlays(page) {
  const labels = [
    /^accept( all)?( cookies)?$/i,
    /^got it$/i,
    /^continue$/i,
    /^close$/i,
    /^no thanks$/i,
    /^dismiss$/i,
  ];
  for (const re of labels) {
    const button = page.getByRole("button", { name: re }).first();
    try {
      if (await button.isVisible({ timeout: 500 })) {
        await button.click({ timeout: 2000 });
        await page.waitForTimeout(400);
      }
    } catch {
      // Nothing to dismiss, which is the common case.
    }
  }
}

module.exports = {
  CartError,
  cleanCause,
  SafetyError,
  CDP_URL,
  connect,
  getStorePage,
  goto,
  settle,
  dismissOverlays,
};
