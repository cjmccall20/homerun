You are planning a Publix shop for the McCall household. You are NOT shopping
yet. Your whole job is to decide, once, what a good match looks like for each
item, so the mechanical part can run in parallel without asking you again.

The job file is:

  {{JOB_FILE}}

Read it. `items` is the grocery list snapshot: each has `text` and `category`.

## First, read the preferences

Read {{VAULT}}/Ingredient-Prefs.md in full. It has
three parts and all three shape the plan:

1. **House dietary principles** - constraints, not suggestions. Avoid seed and
   vegetable oils where practical. Prefer organic where possible, even at a
   premium. Prefer grass-fed or organic beef. Stay cost-aware: that means
   organic-when-reasonable, not organic-at-any-price.
2. **Per-ingredient preferences** - the exact brands this house buys.
3. **Publix purchase history** - what they have actually ordered before.

Also note any rule about where something is bought, such as "butter: bought at
Costco - exclude from Publix orders". Those items are excluded automatically
and you do not need to plan them.

## Write a plan

Write JSON to {{JOB_FILE}}.plan.json, exactly this shape:

{
  "jobFile": "{{JOB_FILE}}",
  "items": [
    {
      "text": "2 lb ground beef",
      "query": "ground beef",
      "expect": "brand:Thousand Hills",
      "note": "70/30 is what they buy"
    },
    {
      "text": "1 bunch cilantro",
      "query": "cilantro",
      "expect": "organic-best",
      "note": ""
    },
    {
      "text": "Chobani hazelnut creamer",
      "query": "Chobani hazelnut creamer",
      "expect": "buy-it-again",
      "note": "repeat item in their history"
    },
    {
      "text": "snacks for the week",
      "query": "snacks",
      "expect": "judge",
      "note": "too vague to match mechanically"
    }
  ]
}

One entry per item in the job, in the same order. Nothing else in the file.

### query

What you would type into the search box. The plain product, not the quantity:
"2 lb ground beef" becomes `ground beef`. Drop counts, units and recipe words.
If the preferences name a brand, put the brand in the query too, because that
is what makes an exact match findable: `Thousand Hills ground beef`.

### expect

Exactly one of these four. Choose the strictest one that will actually match,
because a rule that does not match costs a few seconds and a rule that matches
the wrong thing costs somebody a trip back to the shop.

- `brand:<name>` - the preferences name a specific brand for this ingredient.
  The matcher requires every significant word of the brand to appear in the
  product name, so give the brand only, not the full product title.
- `buy-it-again` - the purchase history shows they buy this, but no brand is
  written down. Publix badges previously-bought items and the matcher looks for
  that badge.
- `organic-best` - a plain ingredient where the house rule is simply "organic
  if there is one", and the cheapest organic result will be right. Good for
  produce.
- `judge` - anything that needs a person's judgement: vague items ("snacks for
  the week"), items where the dietary principles and cost genuinely conflict,
  items whose right answer depends on what the rest of the cart looks like, or
  anything you are unsure about.

**Use `judge` freely.** It is not a failure. The judge phase is a proper
shopping session with all the context; sending it the twelve genuinely hard
items and letting the machine handle the thirty easy ones is exactly the point
of this split. What is expensive is a confident wrong rule.

### note

One short line for the judge phase, or empty. Say what would make the choice
tricky, not what the item is.

## Finishing

Write the file, then reply with two or three lines: how many items, how many of
each rule, and anything about the list that struck you. Nothing else.

No em dashes, no emoji.
