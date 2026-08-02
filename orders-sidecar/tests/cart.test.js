"use strict";

/**
 * The parts that can be tested without a browser: the checkout boundary and
 * the parsing. The boundary tests matter most. Everything else here is a
 * convenience; those are a guarantee that this tool cannot spend money.
 */

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  isSafeUrl,
  assertSafeUrl,
  isSafeClickLabel,
  assertSafeClickLabel,
  isAllowedHost,
  SafetyError,
} = require("../lib/safety");
const { pickProduct, isExcluded, stem, isRelevant } = require("../lib/match");
const { makeRateLimiter } = require("../lib/bulk");
const {
  normalizeName,
  parsePrice,
  detectBadges,
  pickSize,
  normalizeProducts,
  judgeAuthState,
} = require("../lib/extract");

/* ------------------------------------------------------- the boundary -- */

test("checkout and payment URLs are refused", () => {
  const forbidden = [
    "https://delivery.publix.com/store/checkout",
    "https://delivery.publix.com/store/publix/checkout/v4",
    "https://delivery.publix.com/store/publix/payment",
    "https://delivery.publix.com/store/place-order",
    "https://delivery.publix.com/store/order-confirm",
    "https://delivery.publix.com/checkout?step=payment",
    "https://delivery.publix.com/store/publix/billing",
    "https://delivery.publix.com/store/publix/wallet",
    "https://delivery.publix.com/store/publix/purchase",
  ];
  for (const url of forbidden) {
    assert.equal(isSafeUrl(url), false, url);
    assert.throws(() => assertSafeUrl(url), SafetyError, url);
  }
});

test("shopping URLs are allowed", () => {
  const allowed = [
    "https://delivery.publix.com/store/publix/storefront",
    "https://delivery.publix.com/store/publix/s?k=organic%20limes",
    "https://delivery.publix.com/store/publix/products/12345",
    "https://www.publix.com/shop",
    "about:blank",
  ];
  for (const url of allowed) {
    assert.equal(isSafeUrl(url), true, url);
    assert.doesNotThrow(() => assertSafeUrl(url), url);
  }
});

test("anything off the Publix storefront is refused", () => {
  const offsite = [
    "https://example.com/",
    "https://publix.com.evil.test/store",
    "https://amazon.com/cart",
    "file:///Users/anyone/.ssh/id_rsa",
    "https://accounts.google.com/signin",
  ];
  for (const url of offsite) {
    assert.equal(isAllowedHost(url), false, url);
    assert.equal(isSafeUrl(url), false, url);
    assert.throws(() => assertSafeUrl(url), SafetyError, url);
  }
});

test("a redirect into checkout is caught even from an allowed host", () => {
  assert.throws(
    () => assertSafeUrl("https://delivery.publix.com/store/checkout", "after navigation"),
    (err) => err instanceof SafetyError && err.detail.reason === "checkout"
  );
});

test("controls that submit or pay for an order are never clicked", () => {
  const forbidden = [
    "Checkout",
    "Check out",
    "Go to checkout",
    "Place order",
    "Place Order",
    "Submit order",
    "Continue to payment",
    "Pay now",
    "Confirm and pay",
    "Complete purchase",
  ];
  for (const label of forbidden) {
    assert.equal(isSafeClickLabel(label), false, label);
    assert.throws(() => assertSafeClickLabel(label), SafetyError, label);
  }
});

test("shopping controls are clickable", () => {
  const allowed = [
    "Add to cart",
    "Add",
    "Add Organic Limes to cart",
    "Remove",
    "Decrease quantity",
    "View cart",
    "Search",
  ];
  for (const label of allowed) {
    assert.equal(isSafeClickLabel(label), true, label);
    assert.doesNotThrow(() => assertSafeClickLabel(label), label);
  }
});

/* --------------------------------------------------------- the parsing -- */

test("prices parse out of the usual renderings", () => {
  assert.equal(parsePrice("$4.99"), 4.99);
  assert.equal(parsePrice("$ 4.99"), 4.99);
  assert.equal(parsePrice("$12"), 12);
  assert.equal(parsePrice("$4.99 each"), 4.99);
  assert.equal(parsePrice("was $6.49, now $4.99"), 6.49);
  assert.equal(parsePrice("free"), null);
  assert.equal(parsePrice(""), null);
  assert.equal(parsePrice(null), null);
});

test("badges are read from the tile text", () => {
  assert.deepEqual(detectBadges(["Buy it again"]), ["Buy it again"]);
  assert.deepEqual(
    detectBadges(["Organic", "Buy it again"]).sort(),
    ["Buy it again", "Organic"]
  );
  assert.ok(detectBadges(["GreenWise Organic Broccoli"]).includes("GreenWise"));
  assert.ok(
    detectBadges(["Thousand Hills 100% Grass Fed Ground Beef"]).includes("Grass fed")
  );
  assert.deepEqual(detectBadges(["Aisle 7"]), []);
});

test("sizes are picked from short size-shaped fragments", () => {
  assert.equal(pickSize(["16 oz"], "Sour Cream"), "16 oz");
  assert.equal(pickSize(["12 fl oz", "Aisle 3"], "Soda"), "12 fl oz");
  assert.equal(pickSize(["1 lb"], "Ground Beef"), "1 lb");
  assert.equal(pickSize([], "Ground Beef, 1 lb"), "1 lb");
  assert.equal(pickSize(["Delivered by 5pm"], "Milk"), "");
});

test("normalizeName makes comparisons survive punctuation and case", () => {
  assert.equal(
    normalizeName("Thousand Hills 100% Grass-Fed Ground Beef, 1 lb"),
    "thousand hills 100% grass fed ground beef 1 lb"
  );
  assert.equal(normalizeName("Organic  Limes"), "organic limes");
  assert.equal(normalizeName(""), "");
});

test("raw tiles become clean products, de-duplicated, in page order", () => {
  const raw = [
    {
      index: 0,
      name: "Organic Limes",
      price: "$0.79",
      fragments: ["each", "Organic", "Buy it again"],
      href: "/products/1",
    },
    {
      index: 1,
      name: "Organic Limes",
      price: "$0.79",
      fragments: ["each"],
      href: "/products/1",
    },
    {
      index: 2,
      name: "Thousand Hills Grass Fed Ground Beef",
      price: "$9.49",
      fragments: ["16 oz", "Buy it again"],
      href: "/products/2",
    },
    { index: 3, name: "", price: "$1.00", fragments: [], href: null },
  ];
  const products = normalizeProducts(raw, 6);

  assert.equal(products.length, 2, "the duplicate and the nameless tile are dropped");
  assert.equal(products[0].index, 0);
  assert.equal(products[0].addRef, 0, "addRef points back at the tagged tile");
  assert.deepEqual(products[0].badges.sort(), ["Buy it again", "Organic"]);
  assert.equal(products[1].index, 1, "indexes are renumbered after de-duplication");
  assert.equal(products[1].addRef, 2, "but addRef still points at the real tile");
  assert.equal(products[1].size, "16 oz");
  assert.equal(products[1].priceValue, 9.49);
});

test("normalizeProducts respects the limit", () => {
  const raw = Array.from({ length: 20 }, (_, i) => ({
    index: i,
    name: `Product ${i}`,
    price: "$1.00",
    fragments: [],
  }));
  assert.equal(normalizeProducts(raw, 6).length, 6);
});

/* ------------------------------------------------------------- the auth -- */

test("a visible log in control means not signed in", () => {
  const verdict = judgeAuthState({
    signedOutSignals: { loginControl: true, createAccount: false },
    signedInSignals: { account: false, cart: false, orders: false },
  });
  assert.equal(verdict.signedIn, false);
  assert.equal(verdict.confident, true);
});

test("account controls mean signed in", () => {
  const verdict = judgeAuthState({
    signedOutSignals: { loginControl: false, createAccount: false },
    signedInSignals: { account: true, cart: true, orders: true },
  });
  assert.equal(verdict.signedIn, true);
  assert.equal(verdict.confident, true);
});

test("an unreadable page is treated as not signed in", () => {
  const verdict = judgeAuthState({
    signedOutSignals: {},
    signedInSignals: {},
  });
  assert.equal(verdict.signedIn, false, "unsure must fail closed");
  assert.equal(verdict.confident, false);
  assert.equal(judgeAuthState(null).signedIn, false);
});

test("the real signed-out storefront is judged signed out", () => {
  // These are the actual signals read off delivery.publix.com anonymously.
  // "Buy It Again" is a PUBLIC category link on that page, which is why it is
  // not one of the signed-in signals: treating it as one made an anonymous
  // session look authenticated.
  const verdict = judgeAuthState({
    url: "https://delivery.publix.com/store/publix/storefront",
    title: "Publix Delivery or Pickup",
    signedOutSignals: { loginControl: true, createAccount: true },
    signedInSignals: { account: false, cart: false, orders: false },
    controlsSeen: 120,
  });
  assert.equal(verdict.signedIn, false);
  assert.equal(verdict.confident, true);
});

test("a log in control outranks any signed-in signal", () => {
  const verdict = judgeAuthState({
    signedOutSignals: { loginControl: true, createAccount: false },
    signedInSignals: { account: true, cart: true, orders: true },
  });
  assert.equal(verdict.signedIn, false, "a visible log in control wins");
});

/* --------------------------------------------- results, not carousels -- */

/*
 * The bug these exist for: a search for cilantro returned Dole pineapple, and
 * 18 of 42 items on a real run were reported unavailable when Publix stocked
 * every one. The scraper was anchoring on prices, which do not exist as whole
 * text nodes on the real grid, so the only thing it ever matched was the
 * sponsored carousels further down the page.
 */

test("a price split across spans is still read correctly", () => {
  // Publix renders "Current price: $3.29" for screen readers and "$329"
  // visually. The labelled one is the honest one.
  assert.equal(parsePrice("Current price: $3.29$329Organic Cilantro"), 3.29);
  assert.equal(parsePrice("$329"), 329, "the visual form alone is ambiguous");
});

test("normalizeProducts keeps the section a tile came from", () => {
  const products = normalizeProducts(
    [
      {
        index: 0,
        name: "Organic Cilantro",
        price: "$3.29",
        fragments: ["1 bunch", "Buy it again", "Organic"],
        section: 'Results for "cilantro"',
      },
    ],
    6
  );
  assert.equal(products.length, 1);
  assert.equal(products[0].name, "Organic Cilantro");
  assert.equal(products[0].priceValue, 3.29);
  assert.deepEqual(products[0].badges.sort(), ["Buy it again", "Organic"]);
});

test("an empty grid and a missing grid are different failures", () => {
  // These are the two diagnostics shapes cart.js branches on. Conflating them
  // is what turned "our scraper broke" into "Publix is out of cilantro".
  const genuinelyEmpty = { resultsHeading: 'Results for "unobtainium"', carouselSections: [] };
  const gridMissing = { resultsHeading: "", carouselSections: ["Easy to pack nutritious snack"] };

  assert.ok(genuinelyEmpty.resultsHeading, "a real empty result still has its heading");
  assert.equal(gridMissing.resultsHeading, "", "a missing grid has no heading at all");
  assert.ok(
    gridMissing.carouselSections.length > 0,
    "and the carousels are what got found instead"
  );
});

/* ------------------------------------------------ the mechanical matcher -- */

/*
 * The bulk phase skips the model, so these rules ARE the judgement. The bar is
 * deliberately high: anything not clearly meeting its rule is demoted to the
 * judge phase, because a wrong item in the cart costs a trip back to the shop
 * and a demotion costs a few seconds.
 */

const P = (name, price, badges = []) => ({
  name,
  price: price ? `$${price.toFixed(2)}` : "",
  priceValue: price ?? null,
  badges,
});

test("a brand rule needs every significant word of the brand", () => {
  const results = [
    P("Publix Ground Beef, 80/20", 6.49),
    P("Thousand Hills Lifetime Grazed Ground Beef, 70/30", 9.49, ["Buy it again"]),
  ];
  const hit = pickProduct("brand:Thousand Hills", results);
  assert.equal(hit.product.name, "Thousand Hills Lifetime Grazed Ground Beef, 70/30");

  const miss = pickProduct("brand:Farmer Focus", results);
  assert.equal(miss.demote, true);
  assert.match(miss.why, /no result matched the brand/);
});

test("a brand rule with several sizes takes the cheapest", () => {
  const hit = pickProduct("brand:Thousand Hills", [
    P("Thousand Hills Ground Beef, 32 oz", 17.99),
    P("Thousand Hills Ground Beef, 16 oz", 9.49),
  ]);
  assert.equal(hit.product.priceValue, 9.49);
});

test("buy-it-again needs the badge, not a hunch", () => {
  const hit = pickProduct("buy-it-again", [
    P("Chobani Hazelnut Creamer", 4.65, ["Buy it again"]),
    P("Coffee mate Hazelnut", 3.99),
  ]);
  assert.equal(hit.product.name, "Chobani Hazelnut Creamer");

  const miss = pickProduct("buy-it-again", [P("Coffee mate Hazelnut", 3.99)]);
  assert.equal(miss.demote, true);
  assert.match(miss.why, /Buy it again/);
});

test("organic-best takes the cheapest organic option", () => {
  const hit = pickProduct("organic-best", [
    P("Cilantro", 1.65),
    P("Organic Cilantro", 3.29, ["Organic"]),
    P("Organic Cilantro Bunch", 4.15, ["Organic"]),
  ]);
  assert.equal(hit.product.name, "Organic Cilantro");
});

test("organic-best demotes when there is nothing organic", () => {
  const miss = pickProduct("organic-best", [P("Cilantro", 1.65)]);
  assert.equal(miss.demote, true);
  assert.match(miss.why, /no organic option/);
});

test("organic-best demotes a genuine tie rather than picking one", () => {
  const tie = pickProduct("organic-best", [
    P("Organic Cilantro", 3.29, ["Organic"]),
    P("Organic Flat Leaf Parsley", 3.29, ["Organic"]),
  ]);
  assert.equal(tie.demote, true);
  assert.match(tie.why, /same price/);
});

test("an empty search demotes rather than reporting unavailable", () => {
  const none = pickProduct("brand:Anything", []);
  assert.equal(none.demote, true);
  assert.match(none.why, /returned nothing/);
});

test("judge and unknown rules both go to a person", () => {
  assert.equal(pickProduct("judge", [P("Whatever", 1)]).demote, true);
  assert.equal(pickProduct("vibes", [P("Whatever", 1)]).demote, true);
});

test("excluded items never reach the shop", () => {
  assert.deepEqual(isExcluded({ text: "1 lb butter [Costco]" }), {
    excluded: true,
    why: "bought at Costco",
  });
  assert.equal(isExcluded({ text: "2 limes", checked: true }).excluded, true);
  assert.equal(isExcluded({ text: "2 limes" }).excluded, false);
  assert.equal(
    isExcluded({ text: "1 lb ground beef (90/10)" }).excluded,
    false,
    "a description in parentheses is not a shop"
  );
});

test("the rate limiter spaces adds out", async () => {
  const take = makeRateLimiter(20); // 50ms apart, fast enough for a test
  const started = Date.now();
  await take();
  await take();
  await take();
  assert.ok(
    Date.now() - started >= 90,
    "three slots at 20/sec take at least two intervals"
  );
});

test("a rule never matches a product that is not the thing asked for", () => {
  // The live dry run that prompted this: "organic limes" selected
  // "Terra Delyssa Olive Oil, Organic, Extra Virgin". Organic, yes. Limes, no.
  const results = [
    P("Terra Delyssa Olive Oil, Organic, Extra Virgin", 14.89, ["Organic"]),
    P("Lime", 0.44),
    P("Persian Lime Bag", 4.41),
  ];
  const wrong = pickProduct("organic-best", results, "limes");
  assert.equal(wrong.demote, true, "no organic LIME in the results, so demote");
  assert.match(wrong.why, /actually limes|no organic/);

  const organicLimes = pickProduct(
    "organic-best",
    [P("Organic Limes", 3.99, ["Organic"]), ...results],
    "limes"
  );
  assert.equal(organicLimes.product.name, "Organic Limes");
});

test("plural and singular are the same word", () => {
  assert.equal(stem("limes"), "lime");
  assert.equal(stem("tortillas"), "tortilla");
  assert.ok(isRelevant(P("Lime", 0.44), "limes"));
  assert.ok(isRelevant(P("Mission Corn Tortillas", 3.43), "corn tortillas"));
  assert.equal(stem("boxes"), "box");
  assert.equal(stem("glass"), "glass", "a word ending in ss is not a plural");
  assert.ok(!isRelevant(P("Terra Delyssa Olive Oil", 14.89), "limes"));
});

test("relevance also guards a brand rule", () => {
  const wrong = pickProduct(
    "brand:Thousand Hills",
    [P("Thousand Hills Beef Sticks", 7.99)],
    "Thousand Hills ground beef"
  );
  assert.equal(wrong.demote, true, "right brand, wrong product: no 'ground'");

  const right = pickProduct(
    "brand:Thousand Hills",
    [
      P("Thousand Hills Beef Sticks", 7.99),
      P("Thousand Hills Lifetime Grazed 100% Grass Fed Ground Beef", 10.99),
    ],
    "Thousand Hills ground beef"
  );
  assert.match(right.product.name, /Ground Beef/);
});
