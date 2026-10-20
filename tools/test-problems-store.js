#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const Shogi = require("../shogi.js");
const Problems = require("../problems-store.js");
const copy = value => JSON.parse(JSON.stringify(value));
const stored = new Map();
let notifications = 0, blocked = false, checks = 0;
global.localStorage = {
  getItem: key => stored.get(key) ?? null,
  setItem(key, value) {
    if (blocked) throw new Error("quota");
    stored.set(key, String(value));
  },
  removeItem: key => stored.delete(key)
};
global.window = { onKifuSaved() { notifications++; } };

function test(name, body) {
  stored.clear(); notifications = 0; blocked = false;
  body(); checks++;
  console.log("ok - " + name);
}

function fields() {
  const choices = [
    { from: [7, 7], to: [7, 6], promote: false },
    { from: [2, 7], to: [2, 6], promote: false }
  ];
  return {
    position: Shogi.initial(), choices, answer: choices[1], question: "", explanation: "局面コメント",
    source: { title: "自分の棋譜", ply: 0, previousMove: null }
  };
}

function add(title = "問題集") {
  const collection = Problems.createCollection(title);
  const problem = Problems.addProblem(collection.id, fields());
  return { collection, problem };
}

test("problem collections are independent of existing records", () => {
  const old = JSON.stringify({ books: [{ title: "既存の棋譜", root: Shogi.newNode(null) }], current: 0 });
  stored.set("kifu-anki-books-v1", old);
  assert.deepEqual(Problems.load(), []);
  const collection = Problems.createCollection("  苦手な局面  ");
  assert.equal(collection.title, "苦手な局面");
  assert.equal(Problems.load().length, 1);
  assert.equal(notifications, 1);
  assert.equal(stored.get("kifu-anki-books-v1"), old);
  assert.throws(() => Problems.createCollection("   "), /名前/);
});

test("saved position, branches, answer, and comments are snapshots", () => {
  const collection = Problems.createCollection("序盤");
  const source = fields();
  const problem = Problems.addProblem(collection.id, source);
  source.position.sq[7][7] = null;
  source.answer.to[0] = 1;
  source.explanation = "元の棋譜のコメントを変更";
  source.choices.splice(0);
  problem.answer.to[1] = 5;
  const saved = Problems.load()[0].problems[0];
  assert.equal(saved.position.sq[7][7].t, "p");
  assert.deepEqual(saved.answer, { from: [2, 7], to: [2, 6], promote: false });
  assert.equal(saved.explanation, "局面コメント");
  assert.equal(saved.choices.length, 2);
  assert.equal(saved.question, "");
});

test("answer must be one of the position's actual next branches", () => {
  const collection = Problems.createCollection("序盤");
  const candidate = fields();
  candidate.answer = { from: [6, 7], to: [6, 6], promote: false };
  const before = stored.get(Problems.KEY);
  assert.throws(() => Problems.addProblem(collection.id, candidate), /分岐/);
  assert.equal(stored.get(Problems.KEY), before);
  candidate.choices.push(candidate.answer);
  assert.doesNotThrow(() => Problems.addProblem(collection.id, candidate));
  const wrongSide = fields();
  wrongSide.choices[0] = { from: [3, 3], to: [3, 4], promote: false };
  assert.throws(() => Problems.addProblem(collection.id, wrongSide), /分岐/);
});

test("promotion and non-promotion are distinct answers", () => {
  const collection = Problems.createCollection("成り");
  const candidate = fields();
  candidate.position.sq = Array.from({ length: 10 }, () => Array(10).fill(null));
  candidate.position.sq[5][5] = { t: "r", s: true, pr: false };
  candidate.choices = [
    { from: [5, 5], to: [5, 3], promote: false },
    { from: [5, 5], to: [5, 3], promote: true }
  ];
  candidate.answer = candidate.choices[1];
  const problem = Problems.addProblem(collection.id, candidate);
  assert.equal(problem.answer.promote, true);
  assert.ok(!Shogi.moveEq(problem.answer, problem.choices[0]));
  Problems.updateProblem(collection.id, problem.id, { answer: candidate.choices[0] });
  assert.equal(Problems.load()[0].problems[0].answer.promote, false);
});

test("captured-piece drops survive serialization and validation", () => {
  const collection = Problems.createCollection("持ち駒");
  const candidate = fields();
  candidate.position.hands.true.s = 1;
  const drop = { from: null, to: [5, 5], t: "s", promote: false };
  candidate.choices = [drop]; candidate.answer = drop;
  const problem = Problems.addProblem(collection.id, candidate);
  assert.deepEqual(problem.answer, drop);
  assert.equal(Problems.load()[0].problems[0].position.hands.true.s, 1);
  candidate.position.hands.true.s = 0;
  assert.throws(() => Problems.addProblem(collection.id, candidate), /分岐/);
});

test("gote positions and the previous move remain intact", () => {
  const collection = Problems.createCollection("後手");
  const candidate = fields();
  const previous = candidate.choices[0];
  candidate.position = Shogi.apply(candidate.position, previous);
  const move = { from: [3, 3], to: [3, 4], promote: false };
  candidate.choices = [move]; candidate.answer = move;
  candidate.source = { title: "後手の定跡", ply: 1, previousMove: previous };
  Problems.addProblem(collection.id, candidate);
  const saved = Problems.load()[0].problems[0];
  assert.equal(saved.position.turn, false);
  assert.deepEqual(saved.source.previousMove, previous);
  assert.ok(Shogi.label(saved.position, saved.answer).startsWith("△"));
});

test("editing preserves identity and supports blank text", () => {
  const { collection, problem } = add();
  const edited = Problems.updateProblem(collection.id, problem.id, { question: "", explanation: "" });
  assert.equal(edited.id, problem.id);
  assert.equal(edited.createdAt, problem.createdAt);
  assert.ok(edited.updatedAt > problem.updatedAt);
  assert.equal(edited.explanation, "");
  const renamed = Problems.renameCollection(collection.id, "  復習用  ");
  assert.equal(renamed.title, "復習用");
  assert.equal(renamed.problems.length, 1);
});

test("missing destination never silently recreates deleted collections", () => {
  const { collection, problem } = add();
  Problems.removeProblem(collection.id, problem.id);
  assert.equal(Problems.load()[0].problems.length, 0);
  Problems.removeCollection(collection.id);
  assert.deepEqual(Problems.load(), []);
  const before = stored.get(Problems.KEY);
  assert.throws(() => Problems.addProblem(collection.id, fields()), /見つかりません/);
  assert.equal(stored.get(Problems.KEY), before);
});

test("storage failures do not claim success or notify synchronization", () => {
  const { collection } = add();
  const before = stored.get(Problems.KEY), count = notifications;
  blocked = true;
  assert.throws(() => Problems.addProblem(collection.id, fields()), /保存できません/);
  assert.equal(Problems.save([]), false);
  assert.equal(stored.get(Problems.KEY), before);
  assert.equal(notifications, count);
});

test("corrupt stored data is never replaced by an empty collection", () => {
  stored.set(Problems.KEY, "{broken json");
  assert.throws(() => Problems.load(), /上書きせず/);
  assert.equal(Problems.save([]), false);
  assert.throws(() => Problems.createCollection("新しい問題集"), /上書きせず/);
  assert.equal(stored.get(Problems.KEY), "{broken json");
});

test("ID-based backup merge keeps same-name collections and newer edits", () => {
  const { collection, problem } = add("同じ名前");
  const before = Problems.load();
  Problems.updateProblem(collection.id, problem.id, { explanation: "修正後の解説" });
  Problems.addProblem(collection.id, fields());
  add("同じ名前");
  const after = Problems.load();
  const merged = Problems.mergeCollections(before, after);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].problems.length, 2);
  assert.equal(merged[0].problems[0].explanation, "修正後の解説");
  assert.equal(before[0].problems[0].explanation, "局面コメント");
  const reverse = Problems.mergeCollections(after, before);
  assert.equal(reverse[0].problems[0].explanation, "修正後の解説");
  assert.equal(Problems.mergeCollections(merged, merged)[0].problems.length, 2);
  merged[0].problems[0].explanation = "戻り値だけ変更";
  assert.equal(after[0].problems[0].explanation, "修正後の解説");
});

test("invalid import data and duplicate identifiers are rejected", () => {
  add();
  const collections = Problems.load();
  assert.equal(Problems.validateCollections(collections), true);
  const duplicated = copy(collections);
  duplicated.push(copy(duplicated[0]));
  assert.equal(Problems.validateCollections(duplicated), false);
  collections[0].problems[0].position.sq = [];
  assert.equal(Problems.validateCollections(collections), false);
  assert.throws(() => Problems.mergeCollections([], collections), /データ形式/);
});

test("remote restoration can persist without starting another upload", () => {
  add();
  const collections = Problems.load();
  const count = notifications;
  assert.equal(Problems.save(collections, { notify: false }), true);
  assert.equal(notifications, count);
});

console.log(`${checks} problem-store checks passed.`);
