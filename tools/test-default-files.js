#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const Shogi = require("../shogi.js");
const Problems = require("../problems-store.js");
const Defaults = require("../default-files.js");
const BOOKS_KEY = "kifu-anki-books-v1";
const SYNC_KEY = "kifu-anki-sync-v1";
const data = new Map();
let writes = [], notifications = 0, blockedRead = false, blockedWrite = null, checks = 0;
global.localStorage = {
  getItem(key) {
    if (blockedRead) throw new Error("storage unavailable");
    return data.get(key) ?? null;
  },
  setItem(key, value) {
    if (blockedWrite === key) throw new Error("quota exceeded");
    writes.push(key);
    data.set(key, String(value));
  },
  removeItem: key => data.delete(key)
};
global.window = { onKifuSaved() { notifications++; } };
const books = () => JSON.parse(data.get(BOOKS_KEY)).books;

function test(name, check) {
  data.clear(); writes = []; notifications = 0; blockedRead = false; blockedWrite = null;
  check(); checks++;
  console.log("PASS " + name);
}

test("a first visit persists exactly one sample kifu and one playable three-question book", () => {
  assert.deepEqual(Defaults.ensure(), { books: true, problemCollections: true });
  assert.equal(books().length, 1);
  assert.deepEqual(books()[0], Defaults.sampleBook());
  const collections = Problems.load();
  assert.equal(collections.length, 1);
  assert.equal(collections[0].problems.length, 3);
  assert.ok(Problems.validateCollections(collections));
  assert.equal(notifications, 0);
});

test("reopening either page neither duplicates nor rewrites the samples", () => {
  Defaults.ensure();
  const before = new Map(data), beforeWrites = writes.length;
  assert.deepEqual(Defaults.ensure(), { books: false, problemCollections: false });
  assert.deepEqual(data, before);
  assert.equal(writes.length, beforeWrites);
});

test("deleted samples stay deleted when the saved arrays are empty", () => {
  Defaults.ensure();
  Problems.removeCollection(Problems.load()[0].id);
  data.set(BOOKS_KEY, JSON.stringify({ books: [], current: 0 }));
  const before = new Map(data), beforeWrites = writes.length;
  assert.deepEqual(Defaults.ensure(), { books: false, problemCollections: false });
  assert.deepEqual(data, before);
  assert.equal(writes.length, beforeWrites);
});

test("existing user files and pending synchronization metadata remain byte-for-byte unchanged", () => {
  data.set(BOOKS_KEY, JSON.stringify({ books: [{ title: "自分の棋譜", root: Shogi.newNode(null) }], current: 0 }));
  const collection = Defaults.sampleCollection();
  collection.id = "my-collection"; collection.title = "自分の問題";
  data.set(Problems.KEY, JSON.stringify({ version: 1, collections: [collection] }));
  data.set(SYNC_KEY, JSON.stringify({ uid: "existing-account", pending: false, revision: 5 }));
  const before = new Map(data);
  Defaults.ensure();
  assert.deepEqual(data, before);
  assert.equal(writes.length, 0);
  assert.equal(notifications, 0);
});

test("a missing problem store is initialized without changing existing kifu or cloud state", () => {
  const saved = JSON.stringify({ books: [{ title: "対局の棋譜", root: Shogi.newNode(null) }], current: 0 });
  const metadata = JSON.stringify({ uid: "existing-account", pending: false, revision: 8 });
  data.set(BOOKS_KEY, saved); data.set(SYNC_KEY, metadata);
  assert.deepEqual(Defaults.ensure(), { books: false, problemCollections: true });
  assert.equal(data.get(BOOKS_KEY), saved);
  assert.equal(data.get(SYNC_KEY), metadata);
  assert.equal(Problems.load().length, 1);
  assert.equal(notifications, 0);
});

test("a missing kifu store is initialized without adding to an existing problem book", () => {
  const existing = JSON.stringify({ version: 1, collections: [Defaults.sampleCollection()] });
  data.set(Problems.KEY, existing);
  assert.deepEqual(Defaults.ensure(), { books: true, problemCollections: false });
  assert.equal(data.get(Problems.KEY), existing);
  assert.equal(books().length, 1);
});

test("corrupt or empty-string saved values are never replaced by samples", () => {
  for (const value of ["{broken", "", "null"]) {
    data.set(BOOKS_KEY, value); data.set(Problems.KEY, value);
    Defaults.ensure();
    assert.equal(data.get(BOOKS_KEY), value);
    assert.equal(data.get(Problems.KEY), value);
  }
  assert.equal(writes.length, 0);
});

test("unavailable storage and failed kifu writes report an error without creating either file", () => {
  blockedRead = true;
  assert.throws(() => Defaults.ensure(), /保存設定/);
  assert.equal(data.size, 0);
  blockedRead = false; blockedWrite = BOOKS_KEY;
  assert.throws(() => Defaults.ensure(), /棋譜を保存/);
  assert.equal(data.size, 0);
  assert.equal(notifications, 0);
});

test("a failed second write can be retried without duplicating the already saved kifu", () => {
  blockedWrite = Problems.KEY;
  assert.throws(() => Defaults.ensure(), /次の一手ブックを保存/);
  assert.equal(books().length, 1);
  assert.equal(data.has(Problems.KEY), false);
  const saved = data.get(BOOKS_KEY);
  blockedWrite = null;
  assert.deepEqual(Defaults.ensure(), { books: false, problemCollections: true });
  assert.equal(data.get(BOOKS_KEY), saved);
  assert.equal(Problems.load().length, 1);
  assert.equal(writes.filter(key => key === BOOKS_KEY).length, 1);
  assert.equal(notifications, 0);
});

test("sample factories return fresh copies with stable identifiers for cross-device merging", () => {
  const firstBook = Defaults.sampleBook(), secondBook = Defaults.sampleBook();
  firstBook.title = "changed"; firstBook.root.children.length = 0;
  assert.notEqual(secondBook.title, firstBook.title);
  assert.ok(secondBook.root.children.length);
  const a = Defaults.sampleCollection(), b = Defaults.sampleCollection();
  assert.deepEqual(a, b);
  const merged = Problems.mergeCollections([a], [b]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].problems.length, 3);
  a.problems[0].position.sq[7][7] = null;
  a.problems[0].answer.to[0] = 1;
  assert.ok(b.problems[0].position.sq[7][7]);
  assert.deepEqual(b.problems[0].answer.to, [7, 6]);
});

test("all sample answers come from the saved kifu branches and can be applied to their positions", () => {
  const book = Defaults.sampleBook(), collection = Defaults.sampleCollection();
  const routes = [[], [0, 0, 1, 0], [0, 1, 0, 0, 0]];
  assert.ok(Problems.validateCollections([collection]));
  collection.problems.forEach((problem, index) => {
    let node = book.root, position = Shogi.initial();
    for (const branch of routes[index]) {
      node = node.children[branch];
      position = Shogi.apply(position, node.move);
    }
    assert.deepEqual(problem.position, position);
    assert.deepEqual(problem.choices, node.children.map(child => child.move));
    assert.ok(problem.choices.some(move => Shogi.moveEq(move, problem.answer)));
    assert.equal(problem.source.ply, routes[index].length);
    const after = Shogi.apply(problem.position, problem.answer);
    assert.equal(after.turn, !problem.position.turn);
    assert.ok(after.sq[problem.answer.to[0]][problem.answer.to[1]]);
    assert.ok(problem.question.length > 0 && problem.explanation.length > 0);
  });
  assert.equal(collection.problems[2].position.turn, false);
  assert.equal(collection.problems[2].choices.length, 2);
});

console.log(`${checks} default-file checks passed.`);
