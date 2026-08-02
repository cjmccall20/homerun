/**
 * Tests for the daily goals grammar.
 *
 * The file is edited from two phones and read by the morning digest, so what
 * matters is that goal indexes stay stable per person and that a note Basic
 * Memory has rewritten (frontmatter, whitespace) still parses.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addGoal,
  blankGoals,
  editGoal,
  parseGoals,
  removeGoal,
  setGoalDone,
} from "../src/lib/goals.ts";

test("a blank note has a section per person and no goals", () => {
  const text = blankGoals("2026-08-01");
  const goals = parseGoals(text);
  assert.deepEqual(goals.Cooper, []);
  assert.deepEqual(goals.Ashlyn, []);
});

test("adding and parsing round-trips", () => {
  let text = blankGoals("2026-08-01");
  text = addGoal(text, "Cooper", "gym before work");
  text = addGoal(text, "Cooper", "call the CPA");
  text = addGoal(text, "Ashlyn", "return the library books");

  const goals = parseGoals(text);
  assert.deepEqual(
    goals.Cooper.map((g) => g.text),
    ["gym before work", "call the CPA"]
  );
  assert.deepEqual(
    goals.Ashlyn.map((g) => g.text),
    ["return the library books"]
  );
  assert.equal(goals.Cooper.every((g) => !g.done), true);
});

test("checking a goal checks that goal and no other", () => {
  let text = blankGoals("2026-08-01");
  text = addGoal(text, "Cooper", "one");
  text = addGoal(text, "Cooper", "two");
  text = addGoal(text, "Ashlyn", "hers");

  text = setGoalDone(text, "Cooper", 1, true);
  const goals = parseGoals(text);
  assert.deepEqual(
    goals.Cooper.map((g) => g.done),
    [false, true]
  );
  assert.equal(goals.Ashlyn[0].done, false);
});

test("indexes are per person, not per file", () => {
  let text = blankGoals("2026-08-01");
  text = addGoal(text, "Cooper", "his first");
  text = addGoal(text, "Ashlyn", "her first");

  text = setGoalDone(text, "Ashlyn", 0, true);
  const goals = parseGoals(text);
  assert.equal(goals.Cooper[0].done, false);
  assert.equal(goals.Ashlyn[0].done, true);
});

test("removing keeps the rest in order", () => {
  let text = blankGoals("2026-08-01");
  text = addGoal(text, "Cooper", "one");
  text = addGoal(text, "Cooper", "two");
  text = addGoal(text, "Cooper", "three");

  text = removeGoal(text, "Cooper", 1);
  assert.deepEqual(
    parseGoals(text).Cooper.map((g) => g.text),
    ["one", "three"]
  );
});

test("editing keeps the checked state", () => {
  let text = blankGoals("2026-08-01");
  text = addGoal(text, "Cooper", "gymm");
  text = setGoalDone(text, "Cooper", 0, true);
  text = editGoal(text, "Cooper", 0, "gym");

  const [goal] = parseGoals(text).Cooper;
  assert.equal(goal.text, "gym");
  assert.equal(goal.done, true);
});

test("a reindexed note still parses", () => {
  // Basic Memory adds frontmatter and rewrites whitespace. The parser must
  // not care.
  const text = [
    "---",
    "title: Goals - 2026-08-01",
    "permalink: hq/family/goals/2026-08-01",
    "---",
    "",
    "# Goals - 2026-08-01",
    "",
    "## Cooper",
    "",
    "- [x] gym",
    "",
    "## Ashlyn",
    "- [ ] library books",
    "",
  ].join("\n");
  const goals = parseGoals(text);
  assert.deepEqual(goals.Cooper, [{ text: "gym", done: true }]);
  assert.deepEqual(goals.Ashlyn, [{ text: "library books", done: false }]);
});

test("a toggle on a goal that vanished says so instead of guessing", () => {
  const text = blankGoals("2026-08-01");
  assert.throws(() => setGoalDone(text, "Cooper", 0, true), /not in the file/);
});

test("adding for a person the note predates grows a new section", () => {
  const old = "# Goals - 2026-08-01\n\n## Cooper\n\n- [ ] one\n";
  const text = addGoal(old, "Ashlyn", "hers");
  const goals = parseGoals(text);
  assert.deepEqual(goals.Cooper.map((g) => g.text), ["one"]);
  assert.deepEqual(goals.Ashlyn.map((g) => g.text), ["hers"]);
});

test("prose in a section is not a goal", () => {
  const text = [
    "# Goals - 2026-08-01",
    "",
    "## Cooper",
    "",
    "Try to keep it to three.",
    "",
    "- [ ] the real one",
    "",
  ].join("\n");
  assert.deepEqual(parseGoals(text).Cooper, [
    { text: "the real one", done: false },
  ]);
});
