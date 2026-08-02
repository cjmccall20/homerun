"use strict";

/**
 * The hard boundary.
 *
 * This tool builds a cart and stops. A human opens the Publix app, reviews
 * what is in it, and places the order. Nothing here may ever reach a page that
 * can spend money, so every navigation and every click is checked twice:
 * once against the URL it is heading to, once against the label it is about to
 * press.
 *
 * These are pure functions with no browser in sight, which is what lets the
 * test suite prove the boundary holds.
 */

/** Anything that could submit, pay for, or schedule an order. */
const FORBIDDEN_URL_PATTERNS = [
  /checkout/i,
  /\bpay(ment|ments)?\b/i,
  /place[-_]?order/i,
  /order[-_]?(confirm|review|submit|placed)/i,
  /purchase/i,
  /billing/i,
  /credit[-_]?card/i,
  /wallet/i,
  /ebt/i,
  /tip(ping)?[-_]?(select|amount)/i,
];

/** Button and link text that must never be clicked. */
const FORBIDDEN_CLICK_PATTERNS = [
  /check\s*out/i,
  /place\s+order/i,
  /submit\s+order/i,
  /continue\s+to\s+(payment|checkout)/i,
  /pay\s+now/i,
  /confirm\s+(and\s+)?(pay|order)/i,
  /complete\s+(purchase|order)/i,
  /go\s+to\s+checkout/i,
];

/** Only the Publix storefront is in scope. */
const ALLOWED_HOSTS = [/(^|\.)publix\.com$/i, /(^|\.)instacart\.com$/i];

class SafetyError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "SafetyError";
    this.code = "UNSAFE_ACTION";
    this.detail = detail;
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function isAllowedHost(url) {
  const host = hostOf(url);
  if (!host) return false;
  return ALLOWED_HOSTS.some((re) => re.test(host));
}

/** True when a URL is safe to be on. */
function isSafeUrl(url) {
  if (typeof url !== "string" || url === "") return false;
  if (url === "about:blank") return true;
  if (!isAllowedHost(url)) return false;
  return !FORBIDDEN_URL_PATTERNS.some((re) => re.test(url));
}

/**
 * Throws unless the URL is somewhere this tool is allowed to be. Called before
 * every navigation and again after every page settles, because a site can
 * redirect you somewhere you never asked to go.
 */
function assertSafeUrl(url, context) {
  if (isSafeUrl(url)) return url;

  const host = hostOf(url);
  const offHost = !isAllowedHost(url);
  throw new SafetyError(
    offHost
      ? `Refusing to operate on ${host ?? "an unparseable URL"}: only the Publix storefront is in scope.`
      : `Refusing to open a checkout or payment page: ${url}`,
    { url, context: context ?? null, reason: offHost ? "off-host" : "checkout" }
  );
}

/** True when a control's label is safe to click. */
function isSafeClickLabel(label) {
  if (typeof label !== "string") return true;
  return !FORBIDDEN_CLICK_PATTERNS.some((re) => re.test(label));
}

function assertSafeClickLabel(label, context) {
  if (isSafeClickLabel(label)) return label;
  throw new SafetyError(
    `Refusing to click "${String(label).trim()}": that submits or pays for an order.`,
    { label, context: context ?? null, reason: "checkout-control" }
  );
}

module.exports = {
  SafetyError,
  FORBIDDEN_URL_PATTERNS,
  FORBIDDEN_CLICK_PATTERNS,
  isSafeUrl,
  assertSafeUrl,
  isSafeClickLabel,
  assertSafeClickLabel,
  isAllowedHost,
};
