#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const vm = require("node:vm");
const Shogi = require("../shogi.js");
const { source, BOOKS, json } = require("./test-tutorial.js");

const PROBLEMS = "kifu-anki-problems-v1";
const META = "kifu-anki-sync-v1";
const collection = (id, title = id) => ({ id, title, createdAt: 1, updatedAt: 1, problems: [] });
const book = title => ({ title, root: Shogi.newNode(null) });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const snap = data => ({ exists: () => data !== null, data: () => data });
const remoteData = (books, problemCollections) => ({
  books: JSON.stringify(books),
  ...(problemCollections === undefined ? {} : { problemCollections: JSON.stringify(problemCollections) })
});

function setup({ localBooks = [book("ローカル棋譜")], localCollections = [collection("local")], metadata = {}, data: savedData, defaults = false, read, write } = {}) {
  const data = savedData || new Map([
    [BOOKS, JSON.stringify({ books: localBooks, current: 0 })],
    [PROBLEMS, JSON.stringify({ version: 1, collections: localCollections })],
    [META, JSON.stringify(metadata)]
  ]);
  const reads = [], writes = [], timers = new Map(), listeners = new Map();
  let authCallback, timerId = 0, reloads = 0;
  const accountStatus = { textContent: "" };
  const window = { Shogi, kifuReload: () => reloads++ };
  const document = {
    visibilityState: "visible",
    getElementById: id => id === "accountStatus" ? accountStatus : null,
    addEventListener: (type, callback) => listeners.set(type, callback)
  };
  const context = vm.createContext({
    Shogi, window, document, console,
    localStorage: {
      getItem: key => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, String(value)),
      removeItem: key => data.delete(key)
    },
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
    GoogleAuthProvider: function () {}, signInWithPopup: async () => {}, signOut: async () => {},
    onAuthStateChanged: (_, callback) => { authCallback = callback; },
    doc: (_, type, uid) => ({ type, uid }),
    getDoc: ref => { reads.push(ref.uid); return read ? read(ref) : Promise.resolve(snap(null)); },
    setDoc: (ref, value, options) => {
      const call = { uid: ref.uid, value: json(value), options: json(options) };
      writes.push(call);
      return write ? write(call) : Promise.resolve();
    },
    serverTimestamp: () => "server-timestamp"
  });
  vm.runInContext(source("problems-store.js"), context, { filename: "problems-store.js" });
  if (defaults) {
    vm.runInContext(source("default-files.js"), context, { filename: "default-files.js" });
    window.KifuDefaults.ensure();
  }
  const sync = source("sync.js").replace(/^import\b[\s\S]*?;\n/gm, "");
  vm.runInContext(sync, context, { filename: "sync.js" });
  return {
    data, reads, writes, timers, window, store: window.KifuProblems, defaults: window.KifuDefaults, accountStatus,
    auth(user) { authCallback(user ? { uid: user, displayName: user, email: `${user}@example.invalid` } : null); },
    get reloads() { return reloads; },
    metadata() { return JSON.parse(data.get(META)); },
    books() { return JSON.parse(data.get(BOOKS)).books; },
    fireTimer() {
      const next = timers.entries().next().value;
      assert.ok(next, "a pending sync is scheduled");
      timers.delete(next[0]);
      return next[1]();
    }
  };
}

const tests = [];
const test = (name, check) => tests.push({ name, check });

test("an old remote document without problem collections preserves and uploads local collections", async () => {
  const h = setup({ metadata: { uid: "user-a", pending: false }, read: async () => snap(remoteData([book("サーバー棋譜")])) });
  h.auth("user-a"); await tick();
  assert.equal(h.store.load()[0].id, "local");
  assert.equal(h.books()[0].title, "サーバー棋譜");
  assert.equal(h.writes.length, 1);
  assert.deepEqual(JSON.parse(h.writes[0].value.problemCollections), json(h.store.load()));
  assert.deepEqual(h.writes[0].options, { merge: true });
  assert.equal(h.metadata().pending, false);
});

test("a present empty remote collection list is applied as an intentional deletion", async () => {
  const h = setup({ metadata: { uid: "user-a", pending: false }, read: async () => snap(remoteData([book("サーバー棋譜")], [])) });
  h.auth("user-a"); await tick();
  assert.deepEqual(json(h.store.load()), []);
  assert.equal(h.writes.length, 0);
});

test("first login merges by stable IDs and includes local edits made while the remote read is pending", async () => {
  const read = deferred();
  const h = setup({ read: () => read.promise });
  h.auth("user-a");
  h.store.createCollection("読込中に作成した問題集");
  read.resolve(snap(remoteData([book("別の端末の棋譜")], [collection("remote")])));
  await tick();
  assert.deepEqual(new Set(h.store.load().map(c => c.title)), new Set(["remote", "local", "読込中に作成した問題集"]));
  assert.deepEqual(new Set(h.books().map(b => b.title)), new Set(["ローカル棋譜", "別の端末の棋譜"]));
  assert.equal(h.writes.length, 1);
  assert.equal(JSON.parse(h.writes[0].value.problemCollections).length, 3);
});

test("an existing account's pending read cannot overwrite a problem edited locally during the read", async () => {
  const read = deferred();
  const h = setup({ metadata: { uid: "user-a", pending: false }, read: () => read.promise });
  h.auth("user-a");
  h.store.renameCollection("local", "読み込み中の編集");
  read.resolve(snap(remoteData([book("古いサーバー棋譜")], [collection("local", "サーバーの古い名前")])));
  await tick();
  assert.equal(h.store.load()[0].title, "読み込み中の編集");
  assert.equal(JSON.parse(h.writes[0].value.problemCollections)[0].title, "読み込み中の編集");
  assert.equal(h.books()[0].title, "ローカル棋譜");
});

test("edits made during a remote write stay pending and are sent in a later ordered write", async () => {
  const firstWrite = deferred();
  let calls = 0;
  const h = setup({
    metadata: { uid: "user-a", pending: true },
    write: () => ++calls === 1 ? firstWrite.promise : Promise.resolve()
  });
  h.auth("user-a"); await tick();
  assert.equal(h.writes.length, 1);
  h.store.renameCollection("local", "送信中の編集");
  assert.equal(h.metadata().pending, true);
  firstWrite.resolve(); await tick();
  assert.equal(h.metadata().pending, true, "an earlier write must not mark a later local edit as synced");
  await h.fireTimer(); await tick();
  assert.equal(h.writes.length, 2);
  assert.equal(JSON.parse(h.writes[1].value.problemCollections)[0].title, "送信中の編集");
  assert.equal(h.metadata().pending, false);
});

test("a stale read from a signed-out account cannot change local data or write under a new account", async () => {
  const reads = { "user-a": deferred(), "user-b": deferred() };
  const h = setup({ read: ref => reads[ref.uid].promise });
  h.auth("user-a");
  h.auth("user-b");
  reads["user-a"].resolve(snap(remoteData([book("Aのみの棋譜")], [collection("a-only")])));
  await tick();
  assert.equal(h.writes.length, 0);
  assert.equal(h.store.load().some(c => c.id === "a-only"), false);
  reads["user-b"].resolve(snap(remoteData([book("Bの棋譜")], [collection("b")])));
  await tick();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].uid, "user-b");
  assert.equal(JSON.parse(h.writes[0].value.problemCollections).some(c => c.id === "a-only"), false);
});

test("identical remote data does not reload the current board position", async () => {
  const h = setup({
    metadata: { uid: "user-a", pending: false },
    read: async () => snap(remoteData([book("ローカル棋譜")], [collection("local")]))
  });
  h.auth("user-a"); await tick();
  assert.equal(h.reloads, 0);
  assert.equal(h.writes.length, 0);
});

test("malformed local problem data blocks uploading rather than replacing it with an empty list", async () => {
  const h = setup({ metadata: { uid: "user-a", pending: true } });
  const malformed = "{broken";
  h.data.set(PROBLEMS, malformed);
  h.auth("user-a"); await tick();
  assert.equal(h.writes.length, 0);
  assert.equal(h.data.get(PROBLEMS), malformed);
  assert.equal(h.metadata().pending, true);
  assert.ok(h.accountStatus.textContent.length > 0);
});

test("a returning account keeps newly seeded defaults when its old remote lists are empty", async () => {
  const h = setup({
    localBooks: [], localCollections: [], defaults: true,
    metadata: { uid: "user-a", pending: false, revision: 4 },
    read: async () => snap(remoteData([], []))
  });
  const samples = { books: json(h.books()), collections: json(h.store.load()) };
  assert.equal(h.metadata().pending, false, "seeding must not bypass the remote read");
  h.auth("user-a"); await tick();
  assert.deepEqual(h.reads, ["user-a"]);
  assert.deepEqual(json(h.books()), samples.books);
  assert.deepEqual(json(h.store.load()), samples.collections);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(JSON.parse(h.writes[0].value.books), samples.books);
  assert.deepEqual(JSON.parse(h.writes[0].value.problemCollections), samples.collections);
  assert.deepEqual(json(h.defaults.pending()), { books: false, problemCollections: false });
  assert.equal(h.metadata().pending, false);
});

test("a pending kifu sample merges with newer remote kifu while established problem deletions still apply", async () => {
  const remoteBook = book("別端末で追加した棋譜");
  remoteBook.root.comment = "クラウドにある最新の解説";
  const h = setup({
    localBooks: [], localCollections: [collection("old-local")], defaults: true,
    metadata: { uid: "user-a", pending: false },
    read: async () => snap(remoteData([remoteBook], []))
  });
  const sample = json(h.books()[0]);
  h.auth("user-a"); await tick();
  assert.deepEqual(json(h.books()), [remoteBook, sample]);
  assert.deepEqual(json(h.store.load()), []);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(JSON.parse(h.writes[0].value.books), [remoteBook, sample]);
  assert.deepEqual(JSON.parse(h.writes[0].value.problemCollections), []);
});

test("a pending problem sample does not restore stale local kifu over newer remote kifu", async () => {
  const h = setup({
    localCollections: [], defaults: true,
    metadata: { uid: "user-a", pending: false },
    read: async () => snap(remoteData([book("最新の棋譜")], [collection("remote")]))
  });
  const sample = json(h.store.load()[0]);
  h.auth("user-a"); await tick();
  assert.deepEqual(json(h.books()), [book("最新の棋譜")]);
  assert.deepEqual(json(h.store.load()), [collection("remote"), sample]);
  assert.equal(h.writes.length, 1);
});

test("fresh-seed receipts survive page navigation before login without duplicating remote samples", async () => {
  const firstPage = setup({
    localBooks: [], localCollections: [], defaults: true,
    metadata: { uid: "user-a", pending: false }
  });
  const samples = { books: json(firstPage.books()), collections: json(firstPage.store.load()) };
  const nextPage = setup({
    data: firstPage.data, defaults: true,
    read: async () => snap(remoteData(samples.books, samples.collections))
  });
  assert.deepEqual(json(nextPage.defaults.pending()), { books: true, problemCollections: true });
  nextPage.auth("user-a"); await tick();
  assert.deepEqual(json(nextPage.books()), samples.books);
  assert.deepEqual(json(nextPage.store.load()), samples.collections);
  assert.deepEqual(json(nextPage.defaults.pending()), { books: false, problemCollections: false });
});

test("remote deletions remain effective after a seed has been successfully synchronized", async () => {
  const h = setup({
    localBooks: [], localCollections: [], defaults: true,
    metadata: { uid: "user-a", pending: false },
    read: async () => snap(remoteData([], []))
  });
  h.auth("user-a"); await tick();
  assert.equal(h.writes.length, 1);
  const nextPage = setup({
    data: h.data, defaults: true,
    read: async () => snap(remoteData([], []))
  });
  nextPage.auth("user-a"); await tick();
  assert.deepEqual(json(nextPage.books()), []);
  assert.deepEqual(json(nextPage.store.load()), []);
  assert.equal(nextPage.writes.length, 0);
  nextPage.defaults.ensure();
  assert.deepEqual(json(nextPage.books()), []);
  assert.deepEqual(json(nextPage.store.load()), []);
});

test("deleting a seeded sample before login uploads the deletion instead of regenerating it", async () => {
  const h = setup({
    localBooks: [], localCollections: [], defaults: true,
    metadata: { uid: "user-a", pending: false },
    read: async () => snap(remoteData([], []))
  });
  h.data.set(BOOKS, JSON.stringify({ books: [], current: 0 }));
  assert.ok(h.store.save([]));
  h.auth("user-a"); await tick();
  assert.equal(h.writes.length, 1);
  assert.deepEqual(JSON.parse(h.writes[0].value.books), []);
  assert.deepEqual(JSON.parse(h.writes[0].value.problemCollections), []);
  assert.deepEqual(json(h.defaults.ensure()), { books: false, problemCollections: false });
  assert.deepEqual(json(h.books()), []);
  assert.deepEqual(json(h.store.load()), []);
});

test("failed cloud writes retain fresh-seed receipts for a successful retry after navigation", async () => {
  const h = setup({
    localBooks: [], localCollections: [], defaults: true,
    metadata: { uid: "user-a", pending: false },
    read: async () => snap(remoteData([], [])),
    write: async () => { throw new Error("offline"); }
  });
  h.auth("user-a"); await tick();
  assert.equal(h.writes.length, 1);
  assert.equal(h.metadata().pending, true);
  assert.deepEqual(json(h.defaults.pending()), { books: true, problemCollections: true });
  const nextPage = setup({ data: h.data, defaults: true });
  nextPage.auth("user-a"); await tick();
  assert.equal(nextPage.writes.length, 1);
  assert.equal(JSON.parse(nextPage.writes[0].value.books).length, 1);
  assert.equal(JSON.parse(nextPage.writes[0].value.problemCollections).length, 1);
  assert.equal(nextPage.metadata().pending, false);
  assert.deepEqual(json(nextPage.defaults.pending()), { books: false, problemCollections: false });
});

test("a failed remote read does not acknowledge seeds or overwrite newer remote files on retry", async () => {
  const h = setup({
    localBooks: [], localCollections: [], defaults: true,
    metadata: { uid: "user-a", pending: false },
    read: async () => { throw new Error("offline"); }
  });
  h.auth("user-a"); await tick();
  assert.equal(h.writes.length, 0);
  assert.equal(h.metadata().pending, false);
  assert.deepEqual(json(h.defaults.pending()), { books: true, problemCollections: true });
  const nextPage = setup({
    data: h.data, defaults: true,
    read: async () => snap(remoteData([book("再接続時の最新棋譜")], [collection("latest")]))
  });
  nextPage.auth("user-a"); await tick();
  assert.equal(nextPage.writes.length, 1);
  assert.equal(nextPage.books().length, 2);
  assert.equal(nextPage.books()[0].title, "再接続時の最新棋譜");
  assert.equal(nextPage.store.load().length, 2);
  assert.equal(nextPage.store.load()[0].id, "latest");
  assert.deepEqual(json(nextPage.defaults.pending()), { books: false, problemCollections: false });
});

(async () => {
  for (const { name, check } of tests) {
    await check();
    process.stdout.write(`PASS ${name}\n`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
