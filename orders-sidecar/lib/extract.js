"use strict";

/**
 * Reading the storefront.
 *
 * This deliberately does NOT lean on Publix's CSS class names or test ids.
 * That markup is generated, it changes without warning, and a scraper pinned
 * to it is a scraper that breaks silently on a Tuesday and puts the wrong
 * groceries in the cart.
 *
 * Instead the page is read structurally, the way a person reads it: find the
 * prices, walk up to the box each price lives in, and pull the name, size and
 * badges out of that box. A price next to a name next to an Add button is a
 * product tile no matter what it is called in the DOM.
 *
 * The in-page functions below are serialized into the browser, so each one has
 * to be self-contained. The pure post-processing lives in Node where it can be
 * tested.
 */

/* ------------------------------------------------------------- in-page -- */

/**
 * Finds product tiles and tags them so a later click can find them again.
 * Runs inside the browser. Returns plain data only.
 */
function scrapeProductsInPage(limit) {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  /*
   * Anchor on the results heading, not on prices.
   *
   * The first version of this walked up from any element whose whole text was
   * a price. That finds nothing on the real results grid, because Publix
   * splits a price across spans for screen readers ("Current price: $3.29"
   * followed by "$329"), so no single leaf ever equals "$3.29". What it DID
   * match was the sponsored carousels further down the page, whose markup is
   * different. The result was searches for cilantro returning Dole pineapple,
   * and 18 of 42 items on a real run falsely reported as unavailable.
   *
   * Two facts about this page make a reliable anchor:
   *   - the real grid sits under an h1 reading: Results for "<query>"
   *   - every real result names itself in an h3; the sponsored carousel tiles
   *     use div[role=heading] instead, and are introduced by their own h2
   *
   * So: find the results heading, take the h3s after it, and refuse anything
   * that sits inside a recommendation block.
   */
  const headings = Array.from(document.querySelectorAll("h1,h2"));
  const resultsHeading =
    headings.find((h) => /^results?\s+for\b/i.test(clean(h.textContent))) || null;

  const isAfterResults = (el) =>
    !resultsHeading ||
    Boolean(
      resultsHeading.compareDocumentPosition(el) &
        Node.DOCUMENT_POSITION_FOLLOWING
    );

  /** The nearest h1/h2 above this element, which names the section it is in. */
  const sectionOf = (el) => {
    let section = "";
    for (const h of headings) {
      if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
        section = clean(h.textContent);
      }
    }
    return section;
  };

  const SPONSORED_RE = /sponsored|recommend|you might|related|similar|popular near|frequently bought/i;

  const inSponsoredBlock = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const label = clean(
        node.getAttribute?.("aria-label") ||
          node.getAttribute?.("data-testid") ||
          ""
      );
      if (label && SPONSORED_RE.test(label)) return true;
    }
    return false;
  };

  const looksLikeAdd = (el) => {
    const label = clean(
      el.getAttribute("aria-label") || el.textContent || ""
    ).toLowerCase();
    if (!label) return false;
    if (/checkout|place order|pay\b/.test(label)) return false;
    return /^add\b|add to cart|add item|\badd\b/.test(label) && label.length < 120;
  };

  const priceFrom = (text) => {
    // "Current price: $3.29" is the screen-reader label and the honest one.
    const labelled = /current price:\s*(\$\s?\d{1,4}(?:\.\d{2})?)/i.exec(text);
    if (labelled) return clean(labelled[1]);
    const first = /\$\s?\d{1,4}(?:\.\d{2})/.exec(text);
    return first ? clean(first[0]) : "";
  };

  const out = [];
  const diagnostics = {
    url: location.href,
    title: document.title,
    resultsHeading: resultsHeading ? clean(resultsHeading.textContent) : "",
    h3Total: document.querySelectorAll("h3").length,
    h3InResults: 0,
    rejectedSponsored: 0,
    rejectedNoAdd: 0,
    carouselSections: [],
  };

  for (const h2 of headings) {
    const text = clean(h2.textContent);
    if (h2.tagName === "H2" && text && !/^results?\s+for\b/i.test(text)) {
      diagnostics.carouselSections.push(text.slice(0, 60));
    }
  }

  for (const h3 of document.querySelectorAll("h3")) {
    if (!isAfterResults(h3)) continue;
    diagnostics.h3InResults += 1;

    if (inSponsoredBlock(h3)) {
      diagnostics.rejectedSponsored += 1;
      continue;
    }

    // Walk up to the tile: the smallest ancestor that also holds an Add button.
    let card = null;
    let node = h3.parentElement;
    for (let i = 0; i < 10 && node && node !== document.body; i += 1) {
      const add = Array.from(
        node.querySelectorAll("button,a[role='button']")
      ).find(looksLikeAdd);
      if (add) {
        card = node;
        break;
      }
      node = node.parentElement;
    }
    if (!card) {
      diagnostics.rejectedNoAdd += 1;
      continue;
    }

    const section = sectionOf(h3);
    if (section && SPONSORED_RE.test(section)) {
      diagnostics.rejectedSponsored += 1;
      continue;
    }

    const addEl = Array.from(
      card.querySelectorAll("button,a[role='button']")
    ).find(looksLikeAdd);
    const cardText = clean(card.textContent);
    const name = clean(h3.textContent);
    if (!name) continue;

    const fragments = [];
    for (const el of card.querySelectorAll("span,div,p,li,strong,em")) {
      if (el.children.length !== 0) continue;
      const t = clean(el.textContent);
      if (t && t.length <= 60) fragments.push(t);
    }

    const idx = out.length;
    card.setAttribute("data-homerun-card", String(idx));
    addEl.setAttribute("data-homerun-add", String(idx));

    out.push({
      index: idx,
      name,
      price: priceFrom(cardText),
      fragments,
      addLabel: clean(addEl.getAttribute("aria-label") || addEl.textContent || ""),
      href:
        card.querySelector("a[href*='/products/'],a[href*='/item']")?.getAttribute("href") ||
        null,
      section: section.slice(0, 60),
    });
    if (out.length >= limit) break;
  }

  return { products: out, diagnostics };
}

/** Best-effort cart item count from the header control. Runs in the browser. */
function readCartCountInPage() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const candidates = Array.from(
    document.querySelectorAll(
      "[aria-label*='cart' i],[data-testid*='cart' i],a[href*='cart'],button"
    )
  );
  for (const el of candidates) {
    const label = clean(el.getAttribute("aria-label") || "");
    const m = label.match(/(\d+)\s*(?:item|product)/i);
    if (m) return Number(m[1]);
  }
  for (const el of candidates) {
    const label = clean(el.getAttribute("aria-label") || "");
    if (!/cart/i.test(label)) continue;
    const m = label.match(/\b(\d{1,3})\b/);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Scrapes an open cart drawer or cart page. Runs in the browser.
 *
 * The walk-up that finds a row can overshoot and swallow its neighbours, which
 * produced one line reading "cottage cheese, $186.42" on a real run: the
 * container it grabbed held several rows and the cart total. A wrong number
 * reported as fact is worse than a missing one, so anything that looks merged
 * or implausible is returned flagged rather than quietly presented.
 */
function scrapeCartInPage() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const PRICE_RE = /^\s*\$\s?\d{1,5}(?:\.\d{2})?\s*$/;

  /*
   * Scope to the cart drawer, not the page.
   *
   * The drawer opens OVER the storefront, so scraping the document reads every
   * product tile behind it as if it were in the cart: 85 rows for a cart the
   * badge said held 44. Publix renders it as a labelled dialog, so use that as
   * the root and fall back to the document only if it is genuinely absent.
   */
  const root =
    document.querySelector('[role="dialog"][aria-label*="cart" i]') ||
    document.querySelector('[aria-modal="true"][aria-label*="cart" i]') ||
    document;
  const scoped = root !== document;

  const totalLabels = /(sub\s?total|estimated total|order total|items? total|total)/i;
  let total = null;
  let subtotal = null;
  for (const el of root.querySelectorAll("span,div,p,li,td,th,strong")) {
    const t = clean(el.textContent);
    if (!t || t.length > 80) continue;
    if (!totalLabels.test(t)) continue;
    const inline = t.match(/\$\s?\d{1,5}(?:\.\d{2})?/);
    let value = inline ? inline[0] : null;
    if (!value) {
      const sib = el.nextElementSibling;
      const st = clean(sib?.textContent);
      if (st && PRICE_RE.test(st)) value = st;
    }
    if (!value) continue;
    if (/sub\s?total|items? total/i.test(t) && !subtotal) subtotal = value;
    else if (!total) total = value;
  }

  const priceFrom = (text) => {
    const labelled = /current price:\s*(\$\s?\d{1,5}(?:\.\d{2})?)/i.exec(text);
    if (labelled) return clean(labelled[1]);
    const first = /\$\s?\d{1,5}(?:\.\d{2})/.exec(text);
    return first ? clean(first[0]) : "";
  };

  const toNumber = (price) => {
    const m = /\$\s?(\d{1,5}(?:\.\d{2})?)/.exec(price || "");
    return m ? Number(m[1]) : null;
  };

  /*
   * A row is in the cart if it can be removed from the cart.
   *
   * The drawer also carries a "you might also like" rail whose tiles look
   * exactly like cart rows, which is why this used to report 69 rows for a
   * cart holding 45. Those tiles offer "Add 1 ct <name>"; a real cart line
   * offers "Remove <name>". That control is the definition of being in the
   * cart, so it is what the scrape keys on.
   */
  const removeButtons = Array.from(
    root.querySelectorAll("button,[role='button']")
  ).filter((b) => /^remove\s+\S/i.test(clean(b.getAttribute("aria-label") || "")));

  const rows = [];
  const seenNodes = new Set();
  for (const button of removeButtons) {
    const name = clean(button.getAttribute("aria-label")).replace(/^remove\s+/i, "");
    if (!name || name.length > 160) continue;

    let card = null;
    let node = button.parentElement;
    for (let i = 0; i < 8 && node && node !== root; i += 1) {
      const text = clean(node.textContent);
      if (/\$\s?\d/.test(text)) {
        card = node;
        break;
      }
      node = node.parentElement;
    }
    if (!card || seenNodes.has(card)) continue;
    seenNodes.add(card);

    const text = clean(card.textContent);
    // More than one Remove control inside means the walk-up swallowed a neighbour.
    const headingsInside = Array.from(
      card.querySelectorAll("button,[role='button']")
    ).filter((b) => /^remove\s+\S/i.test(clean(b.getAttribute("aria-label") || ""))).length;
    const pricesInside = (text.match(/\$\s?\d{1,5}(?:\.\d{2})?/g) || []).length;

    rows.push({
      name,
      price: priceFrom(text),
      merged: headingsInside > 1,
      priceCount: pricesInside,
      text: text.slice(0, 200),
    });
  }

  // Flag rows whose price is out of family with the rest: a total or a
  // subtotal caught by a container that reached too far.
  const values = rows
    .map((r) => toNumber(r.price))
    .filter((n) => typeof n === "number" && n > 0)
    .sort((a, b) => a - b);
  const median = values.length ? values[Math.floor(values.length / 2)] : null;
  const totalValue = toNumber(total) ?? toNumber(subtotal);

  const items = [];
  const suspect = [];
  const seenKeys = new Set();
  for (const row of rows) {
    const value = toNumber(row.price);
    const looksLikeTotal =
      totalValue !== null && value !== null && Math.abs(value - totalValue) < 0.01;
    /*
     * A real cart legitimately mixes 44 cent limes with a 66 dollar box of
     * whitening strips, so this bar is set high enough to catch a total that
     * leaked into a row (40x the median on the run that prompted it) without
     * calling every expensive item a bug.
     */
    const wildlyHigh =
      median !== null && value !== null && median > 0 && value > median * 25;

    const key = `${row.name.toLowerCase()}|${row.price}`;
    const duplicate = seenKeys.has(key);
    seenKeys.add(key);

    const reasons = [];
    if (row.merged) reasons.push("several rows ran together");
    if (looksLikeTotal) reasons.push("the price equals the cart total");
    if (wildlyHigh) reasons.push("the price is far out of line with the rest");
    if (duplicate) reasons.push("a duplicate of a row already listed");
    if (row.priceCount > 4) reasons.push("too many prices in one row");

    const entry = { name: row.name, price: row.price };
    if (reasons.length > 0) suspect.push({ ...entry, why: reasons.join("; ") });
    else items.push(entry);
  }

  return {
    items,
    /** Rows we do not trust. Never presented as fact. */
    suspect,
    subtotal,
    total: total || subtotal,
    diagnostics: {
      url: location.href,
      title: document.title,
      scopedToDrawer: scoped,
      rows: rows.length,
      kept: items.length,
      flagged: suspect.length,
      medianItemPrice: median,
    },
  };
}

/** Signals that tell us whether the profile is signed in. Runs in the browser. */
function readAuthStateInPage() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const texts = [];
  for (const el of document.querySelectorAll("button,a,span,h1,h2")) {
    const t = clean(el.getAttribute("aria-label") || el.textContent || "");
    if (t && t.length < 40) texts.push(t);
  }
  const has = (re) => texts.some((t) => re.test(t));
  return {
    url: location.href,
    title: document.title,
    /*
     * Note what is NOT here: "Buy it again" is a public category link on the
     * Publix storefront, shown to signed-out visitors, so it says nothing
     * about being logged in. Treating it as a signed-in signal made an
     * anonymous session look authenticated.
     */
    signedOutSignals: {
      loginControl: has(/^(log ?in|sign ?in)$/),
      createAccount: has(/create account|sign ?up/),
    },
    signedInSignals: {
      account: has(/^(account|your account|my account)$/),
      cart: has(/cart/),
      orders: has(/^(your orders|order history|my orders)$/),
    },
    /** How much of the page has rendered, so a half-loaded read can be retried. */
    controlsSeen: texts.length,
  };
}

/* ---------------------------------------------------------- pure (node) -- */

const BADGE_VOCABULARY = [
  { label: "Buy it again", re: /\bbuy it again\b/i },
  { label: "Organic", re: /\borganic\b/i },
  { label: "GreenWise", re: /\bgreenwise\b/i },
  { label: "Grass fed", re: /\bgrass[-\s]?fed\b/i },
  { label: "Best seller", re: /\bbest\s?seller\b/i },
  { label: "Sale", re: /\b(sale|save \$|% off|bogo|buy one)\b/i },
  { label: "New", re: /^new$/i },
  { label: "Local", re: /^local$/i },
  { label: "Gluten free", re: /\bgluten[-\s]?free\b/i },
  { label: "Publix brand", re: /^publix( brand)?$/i },
];

const SIZE_RE =
  /\b\d+(?:\.\d+)?\s?(?:x\s?\d+(?:\.\d+)?\s?)?(?:fl\s?oz|oz|lb|lbs|ct|count|pk|pack|g|kg|ml|l|qt|gal|dozen|each)\b/i;

function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePrice(text) {
  if (!text) return null;
  const m = String(text).match(/\$\s?(\d{1,5}(?:\.\d{2})?)/);
  return m ? Number(m[1]) : null;
}

function detectBadges(fragments) {
  const found = new Set();
  for (const raw of fragments || []) {
    for (const badge of BADGE_VOCABULARY) {
      if (badge.re.test(raw)) found.add(badge.label);
    }
  }
  return [...found];
}

function pickSize(fragments, name) {
  for (const raw of fragments || []) {
    const m = raw.match(SIZE_RE);
    // A fragment that is mostly the size is a size label, not a description.
    if (m && raw.length <= 24) return raw.trim();
  }
  const inName = (name || "").match(SIZE_RE);
  return inName ? inName[0] : "";
}

/**
 * Turns raw tiles into the shape the order runner consumes. Drops anything
 * without a usable name, and keeps document order so "index 0" means "the
 * first result Publix showed", which is what a person would expect.
 */
function normalizeProducts(raw, limit) {
  const out = [];
  const seen = new Set();
  for (const item of raw || []) {
    const name = (item.name || "").trim();
    if (!name) continue;
    const key = normalizeName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      index: out.length,
      addRef: item.index,
      name,
      size: pickSize(item.fragments, name),
      price: item.price || "",
      priceValue: parsePrice(item.price),
      badges: detectBadges([...(item.fragments || []), name]),
      href: item.href || null,
    });
    if (limit && out.length >= limit) break;
  }
  return out;
}

/**
 * Interprets the auth signals. Conservative in both directions: unsure counts
 * as not signed in, because shopping with a signed-out session silently builds
 * a cart nobody can see.
 */
function judgeAuthState(signals) {
  if (!signals) return { signedIn: false, confident: false, reason: "no page data" };
  const { signedOutSignals: out, signedInSignals: is } = signals;
  if (out?.loginControl || out?.createAccount) {
    return {
      signedIn: false,
      confident: true,
      reason: "the storefront is showing a log in control",
    };
  }
  if (is?.orders || is?.account) {
    return { signedIn: true, confident: true, reason: "account controls are present" };
  }
  if (is?.cart) {
    return {
      signedIn: true,
      confident: false,
      reason: "a cart control is present but no account control was found",
    };
  }
  return {
    signedIn: false,
    confident: false,
    reason: "no account or log in controls were found on the page",
  };
}

module.exports = {
  scrapeProductsInPage,
  readCartCountInPage,
  scrapeCartInPage,
  readAuthStateInPage,
  normalizeName,
  parsePrice,
  detectBadges,
  pickSize,
  normalizeProducts,
  judgeAuthState,
  BADGE_VOCABULARY,
  SIZE_RE,
};
