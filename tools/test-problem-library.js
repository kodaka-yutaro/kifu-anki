#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const vm = require("node:vm");
const Shogi = require("../shogi.js");
const { harness, source, storedBooks, BOOKS, PROBLEMS, DEFAULTS, json } = require("./test-tutorial.js");
const tick = () => new Promise(resolve => setImmediate(resolve));

// This lightweight DOM executes the actual page, storage and shogi modules.
// Firebase and browser layout are deliberately outside this test.
function pageHarness(page, { data = new Map(), search = "" } = {}) {
  const elements = new Map(), downloads = [], listeners = new Map();
  let failingKey = null, failuresLeft = 0, syncs = 0, document;
  class Element {
    constructor(tagName, id = "") {
      this.tagName = tagName.toUpperCase(); this.id = id;
      this.dataset = {}; this.children = []; this.parentElement = null;
      this.attributes = new Map(); this.listeners = new Map();
      this.value = ""; this.textContent = ""; this.disabled = false;
      this.hidden = false; this.open = false; this.files = [];
      const classes = new Set();
      Object.defineProperty(this, "className", {
        get: () => [...classes].join(" "),
        set: text => { classes.clear(); String(text).split(/\s+/).filter(Boolean).forEach(n => classes.add(n)); }
      });
      this.classList = {
        add: (...names) => names.forEach(n => classes.add(n)),
        remove: (...names) => names.forEach(n => classes.delete(n)),
        contains: name => classes.has(name),
        toggle: (name, force = !classes.has(name)) => force ? classes.add(name) : classes.delete(name)
      };
    }
    set innerHTML(value) { this.html = value; this.children = []; }
    get innerHTML() { return this.html || ""; }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    add(child) { this.appendChild(child); }
    insertAdjacentHTML() {}
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name.startsWith("data-")) this.dataset[name.slice(5)] = String(value);
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(callback);
    }
    dispatch(type, values = {}) {
      const event = { target: this, preventDefault() {}, stopPropagation() {}, ...values };
      const result = this[`on${type}`] ? this[`on${type}`](event) : undefined;
      for (const callback of this.listeners.get(type) || []) callback(event);
      return result;
    }
    click() { if (!this.disabled) return this.dispatch("click"); }
    showModal() { this.open = true; }
    close(value = "") { this.open = false; this.returnValue = value; this.dispatch("close"); }
    focus() { document.activeElement = this; }
    scrollIntoView() {}
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); }
    matches(selector) {
      const tag = /^[a-z]+/i.exec(selector);
      if (tag && this.tagName !== tag[0].toUpperCase()) return false;
      const id = /#([\w-]+)/.exec(selector);
      if (id && this.id !== id[1]) return false;
      const className = /\.([\w-]+)/.exec(selector);
      if (className && !this.classList.contains(className[1])) return false;
      if (selector.includes("[open]") && !this.open) return false;
      return true;
    }
    querySelectorAll(selector) {
      const result = [];
      for (const child of this.children) {
        if (child.matches(selector)) result.push(child);
        result.push(...child.querySelectorAll(selector));
      }
      return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  for (const match of source(`${page}.html`).matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(match[1], match[2]);
    element.hidden = /\bhidden\b/.test(match[0]);
    for (const [, name, value] of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) element.setAttribute(name, value);
    elements.set(element.id, element);
  }
  const get = id => { assert.ok(elements.has(id), `missing ${page} element: ${id}`); return elements.get(id); };
  document = new Element("document");
  document.body = new Element("body"); document.documentElement = new Element("html");
  document.documentElement.appendChild(document.body);
  elements.forEach(el => document.body.appendChild(el));
  document.activeElement = document.body;
  document.getElementById = get;
  document.createElement = tag => new Element(tag);
  document.querySelector = selector => document.body.querySelector(selector);
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  const window = {
    onKifuSaved: () => syncs++,
    addEventListener: (type, callback) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    }
  };
  const context = vm.createContext({
    Shogi, window, document, Blob, File, TextDecoder, URLSearchParams, navigator: {},
    location: { search, href: `${page}.html${search}` },
    URL: {
      createObjectURL: blob => { downloads.push(blob); return `blob:test-${downloads.length}`; },
      revokeObjectURL() {}
    },
    Option: function (text, value) { const el = new Element("option"); el.textContent = text; el.value = value; return el; },
    localStorage: {
      getItem: key => data.get(key) ?? null,
      setItem: (key, value) => {
        if (key === failingKey && failuresLeft-- > 0) throw new Error("quota exceeded");
        data.set(key, String(value));
      },
      removeItem: key => data.delete(key)
    },
    fetch: async () => ({ ok: true, json: async () => [] }),
    setTimeout: () => 1, clearTimeout() {},
    confirm: () => true, prompt: () => null, alert: text => { throw new Error(text); }
  });
  vm.runInContext(source("problems-store.js"), context, { filename: "problems-store.js" });
  vm.runInContext(source("default-files.js"), context, { filename: "default-files.js" });
  vm.runInContext(source(`${page}.js`), context, { filename: `${page}.js` });
  return {
    get, data, context, window, downloads, store: window.KifuProblems,
    get syncs() { return syncs; },
    failWrites(key, count = 1) { failingKey = key; failuresLeft = count; },
    storageEvent(key) { (listeners.get("storage") || []).forEach(callback => callback({ key })); },
    async restore(value) {
      const input = get("restoreInput");
      input.files = [{ text: async () => typeof value === "string" ? value : JSON.stringify(value) }];
      input.dispatch("change");
      await tick();
    },
    move(from, to) {
      for (const [file, rank] of [from, to]) {
        const cell = get("problemBoard").children.find(el => +el.dataset.file === file && +el.dataset.rank === rank);
        assert.ok(cell, `board square ${file}${rank} exists`);
        cell.click();
      }
    }
  };
}

const initial = () => new Map([
  [BOOKS, JSON.stringify(storedBooks("元からある棋譜"))],
  [PROBLEMS, JSON.stringify({ version: 1, collections: [] })],
  [DEFAULTS, JSON.stringify({ version: 1, books: "ready", problemCollections: "ready" })]
]);
const fields = () => ({
  position: Shogi.initial(),
  choices: [{ from: [7, 7], to: [7, 6], promote: false }, { from: [2, 7], to: [2, 6], promote: false }],
  answer: { from: [7, 7], to: [7, 6], promote: false },
  question: "", explanation: "角道を開けます。", source: { title: "元からある棋譜", ply: 0, previousMove: null }
});
const tests = [];
const test = (name, check) => tests.push({ name, check });

test("the file screen creates a separate named problem collection and links to it", () => {
  const h = pageHarness("library", { data: initial() });
  const booksBefore = h.data.get(BOOKS);
  h.get("btnNewProblemCollection").click();
  h.get("newProblemCollectionName").value = "  四間飛車の問題集  ";
  h.get("newProblemCollectionForm").dispatch("submit");
  assert.equal(h.get("newProblemCollectionDialog").open, false);
  const collection = h.store.load()[0];
  assert.equal(collection.title, "四間飛車の問題集");
  assert.equal(collection.problems.length, 0);
  const link = h.get("myProblemCollections").children[0].children[0];
  assert.equal(link.href, `problems.html?id=${encodeURIComponent(collection.id)}`);
  assert.equal(h.data.get(BOOKS), booksBefore);
});

test("blank names and failed collection writes keep the creation form open without reporting success", () => {
  const h = pageHarness("library", { data: initial() });
  h.get("btnNewProblemCollection").click();
  h.get("newProblemCollectionName").value = "   ";
  h.get("newProblemCollectionForm").dispatch("submit");
  assert.equal(h.store.load().length, 0);
  assert.equal(h.get("newProblemCollectionDialog").open, true);
  h.get("newProblemCollectionName").value = "保存したい問題集";
  h.failWrites(h.store.KEY);
  h.get("newProblemCollectionForm").dispatch("submit");
  assert.equal(h.get("newProblemCollectionDialog").open, true);
  assert.equal(h.get("newProblemCollectionName").value, "保存したい問題集");
  assert.ok(h.get("newProblemCollectionError").textContent.length > 0);
  assert.equal(h.get("libraryStatus").textContent, "");
  assert.equal(h.syncs, 0);
});

test("version 2 backups contain both kifu files and full independent problem snapshots", async () => {
  const h = pageHarness("library", { data: initial() });
  const collection = h.store.createCollection("バックアップ問題集");
  h.store.addProblem(collection.id, fields());
  h.get("btnBackup").click();
  assert.equal(h.downloads.length, 1);
  const backup = JSON.parse(await h.downloads[0].text());
  assert.equal(backup.version, 2);
  assert.deepEqual(backup.books, JSON.parse(h.data.get(BOOKS)).books);
  assert.deepEqual(backup.problemCollections, json(h.store.load()));
  assert.equal(backup.problemCollections[0].problems[0].position.sq[7][7].t, "p");
});

test("restoring a legacy version 1 kifu backup preserves all existing problem collections", async () => {
  const h = pageHarness("library", { data: initial() });
  const collection = h.store.createCollection("消してはいけない問題集");
  h.store.addProblem(collection.id, fields());
  const before = json(h.store.load());
  await h.restore({ app: "kifu-anki", version: 1, books: [{ title: "旧バックアップの棋譜", root: Shogi.newNode(null) }] });
  assert.deepEqual(json(h.store.load()), before);
  assert.equal(JSON.parse(h.data.get(BOOKS)).books.length, 2);
  assert.ok(h.get("libraryStatus").className.includes("ok"));
});

test("version 2 restoration rolls back a successful kifu write when the problem write fails", async () => {
  const h = pageHarness("library", { data: initial() });
  const collection = h.store.createCollection("既存問題集");
  h.store.addProblem(collection.id, fields());
  const before = [...h.data];
  const syncsBefore = h.syncs;
  h.failWrites(h.store.KEY);
  await h.restore({ app: "kifu-anki", version: 2, books: [{ title: "復元候補の棋譜", root: Shogi.newNode(null) }], problemCollections: [] });
  assert.deepEqual([...h.data], before);
  assert.equal(h.syncs, syncsBefore, "a failed two-key transaction must not notify cloud sync");
  assert.ok(h.get("libraryStatus").className.includes("ng"));
});

test("repeated restore merges the same collection and problem IDs without duplicating them", async () => {
  const h = pageHarness("library", { data: initial() });
  const collection = h.store.createCollection("重複しない問題集");
  h.store.addProblem(collection.id, fields());
  const payload = { app: "kifu-anki", version: 2, problemCollections: json(h.store.load()) };
  await h.restore(payload); await h.restore(payload);
  assert.equal(h.store.load().length, 1);
  assert.equal(h.store.load()[0].problems.length, 1);
  assert.equal(JSON.parse(h.data.get(BOOKS)).books.length, 1);
});

test("malformed backups do not modify either store", async () => {
  const h = pageHarness("library", { data: initial() });
  h.store.createCollection("元の問題集");
  const before = [...h.data];
  await h.restore({ app: "kifu-anki", version: 2, books: [], problemCollections: [{ title: "壊れた問題集" }] });
  assert.deepEqual([...h.data], before);
  assert.ok(h.get("libraryStatus").className.includes("ng"));
});

test("create, save, delete the source kifu, open, answer incorrectly, answer correctly, and retry use the real modules", () => {
  const data = initial();
  const library = pageHarness("library", { data });
  library.get("btnNewProblemCollection").click();
  library.get("newProblemCollectionName").value = "実戦の次の一手";
  library.get("newProblemCollectionForm").dispatch("submit");
  const collection = library.store.load()[0];

  const editor = harness({ data });
  editor.runScript("problems-store.js");
  editor.runScript("problem-editor.js");
  for (let i = 0; i < 5; i++) editor.get("btnNext").click();
  editor.comment("後手はどこへ飛車を振るか。元の局面のコメント。");
  editor.get("btnCreateProblem").click();
  editor.get("problemAnswer").value = "1";
  editor.get("problemDestination").value = collection.id;
  editor.get("problemQuestion").value = "";
  editor.get("problemExplanation").value = "三間飛車にして角道を生かします。";
  editor.get("problemForm").dispatch("submit");
  assert.equal(editor.get("problemDialog").open, false);
  const saved = json(library.store.load()[0].problems[0]);
  assert.deepEqual(saved.answer, saved.choices[1]);
  editor.get("btnDelete").click();
  editor.flushTimers();
  assert.equal(JSON.parse(data.get(BOOKS)).books.some(book => book.title === saved.source.title), false);

  const player = pageHarness("problems", { data, search: `?id=${collection.id}` });
  assert.equal(player.get("problemPlayer").hidden, false);
  assert.equal(player.get("problemBoard").children.length, 81);
  assert.equal(player.get("problemBoard").children[0].dataset.file, 1, "the gote-to-move board is rotated");
  assert.equal(player.get("problemBoard").children[0].dataset.rank, 9);
  assert.equal(player.get("problemQuestion").textContent, "次の一手を指してください。");
  assert.ok(player.get("problemSource").textContent.includes(saved.source.title));
  assert.equal(player.get("problemAnswerPanel").hidden, true);
  assert.equal(player.get("problemAnswerLabel").textContent, "");
  assert.equal(player.get("problemExplanation").textContent, "");
  const board = () => player.get("problemBoard").children.map(cell => cell.getAttribute("aria-label"));
  const initialBoard = board();
  player.move(saved.choices[0].from, saved.choices[0].to);
  assert.ok(player.get("problemFeedback").classList.contains("ng"));
  assert.deepEqual(board(), initialBoard, "a wrong answer leaves the snapshot unchanged");
  assert.equal(player.get("problemAnswerPanel").hidden, true);
  assert.equal(player.get("problemExplanation").textContent, "");
  player.move(saved.answer.from, saved.answer.to);
  assert.equal(player.get("problemFeedback").textContent, "正解です。");
  assert.equal(player.get("problemAnswerPanel").hidden, false);
  assert.equal(player.get("problemExplanation").textContent, saved.explanation);
  assert.notDeepEqual(board(), initialBoard);
  player.get("btnRetryProblem").click();
  assert.deepEqual(board(), initialBoard);
  assert.equal(player.get("problemAnswerPanel").hidden, true);
  assert.equal(player.get("problemAnswerLabel").textContent, "");
  assert.equal(player.get("problemExplanation").textContent, "");
});

test("revealing and moving between questions clears the previous answer and preserves the source kifu", () => {
  const data = initial(), library = pageHarness("library", { data });
  const collection = library.store.createCollection("二問の練習");
  const one = library.store.addProblem(collection.id, fields());
  const second = fields(); second.question = "二問目"; second.explanation = "二問目の解説";
  library.store.addProblem(collection.id, second);
  const original = data.get(BOOKS);
  const player = pageHarness("problems", { data, search: `?id=${collection.id}` });
  player.get("btnRevealProblem").click();
  assert.equal(player.get("problemExplanation").textContent, one.explanation);
  player.get("btnNextProblem").click();
  assert.equal(player.get("problemQuestion").textContent, "二問目");
  assert.equal(player.get("problemAnswerPanel").hidden, true);
  assert.equal(player.get("problemAnswerLabel").textContent, "");
  assert.equal(player.get("problemExplanation").textContent, "");
  player.get("btnPreviousProblem").click();
  player.move(one.answer.from, one.answer.to);
  assert.equal(player.get("problemFeedback").textContent, "正解です。");
  assert.equal(data.get(BOOKS), original);
});

test("the player applies promotion choices and a held-piece drop through board controls", () => {
  const data = initial(), library = pageHarness("library", { data });
  const collection = library.store.createCollection("成りと駒打ち");
  const promotion = fields();
  promotion.position.sq = Array.from({ length: 10 }, () => Array(10).fill(null));
  promotion.position.sq[7][3] = { t: "p", s: true, pr: false };
  promotion.choices = [false, true].map(promote => ({ from: [7, 3], to: [7, 2], promote }));
  promotion.answer = promotion.choices[1];
  library.store.addProblem(collection.id, promotion);
  const drop = fields();
  drop.position.sq[5][7] = null;
  drop.position.hands.true.p = 1;
  drop.answer = { from: null, to: [5, 5], t: "p", promote: false };
  drop.choices = [drop.answer];
  library.store.addProblem(collection.id, drop);
  const player = pageHarness("problems", { data, search: `?id=${collection.id}` });
  player.move([7, 3], [7, 2]);
  assert.equal(player.get("problemPromoteDialog").open, true);
  player.get("problemPromoteDialog").close("cancel");
  assert.equal(player.get("problemAnswerPanel").hidden, true);
  assert.equal(player.get("problemFeedback").textContent, "");
  player.move([7, 3], [7, 2]);
  player.get("problemPromoteDialog").close("no");
  assert.ok(player.get("problemFeedback").classList.contains("ng"));
  player.move([7, 3], [7, 2]);
  player.get("problemPromoteDialog").close("yes");
  assert.equal(player.get("problemFeedback").textContent, "正解です。");
  const promoted = player.get("problemBoard").children.find(cell => +cell.dataset.file === 7 && +cell.dataset.rank === 2);
  assert.equal(promoted.querySelector(".piece-letter").textContent, "と");
  player.get("btnNextProblem").click();
  const hand = player.get("problemHandBottom").children.find(el => el.tagName === "BUTTON");
  assert.ok(hand.getAttribute("aria-label").includes("歩1枚"));
  hand.click();
  player.get("problemBoard").children.find(cell => +cell.dataset.file === 5 && +cell.dataset.rank === 5).click();
  assert.equal(player.get("problemFeedback").textContent, "正解です。");
  assert.equal(player.get("problemHandBottom").children.filter(el => el.tagName === "BUTTON").length, 0);
});

test("editing a saved answer chooses among its snapshotted branches and preserves the source record", () => {
  const data = initial(), library = pageHarness("library", { data });
  const collection = library.store.createCollection("修正する問題集");
  library.store.addProblem(collection.id, fields());
  const before = data.get(BOOKS);
  const player = pageHarness("problems", { data, search: `?id=${collection.id}` });
  player.get("btnEditProblem").click();
  player.get("editProblemAnswer").value = "1";
  player.get("editProblemQuestion").value = "飛車先を伸ばすには？";
  player.get("editProblemExplanation").value = "二筋の歩を進めます。";
  player.get("editProblemForm").dispatch("submit");
  assert.equal(player.get("editProblemDialog").open, false);
  const saved = json(player.store.load()[0].problems[0]);
  assert.deepEqual(saved.answer, saved.choices[1]);
  assert.equal(saved.question, "飛車先を伸ばすには？");
  assert.equal(saved.explanation, "二筋の歩を進めます。");
  assert.equal(data.get(BOOKS), before);
  player.move(saved.answer.from, saved.answer.to);
  assert.equal(player.get("problemFeedback").textContent, "正解です。");
});

test("an edit form retains its draft when another tab deletes the problem and does not recreate it", () => {
  const data = initial(), library = pageHarness("library", { data });
  const collection = library.store.createCollection("競合する編集");
  const problem = library.store.addProblem(collection.id, fields());
  const player = pageHarness("problems", { data, search: `?id=${collection.id}` });
  player.get("btnEditProblem").click();
  player.get("editProblemQuestion").value = "編集中の文章を残す";
  library.store.removeProblem(collection.id, problem.id);
  player.storageEvent(player.store.KEY);
  assert.equal(player.get("editProblemQuestion").value, "編集中の文章を残す");
  player.get("editProblemForm").dispatch("submit");
  assert.equal(player.get("editProblemDialog").open, true);
  assert.ok(player.get("editProblemError").textContent.includes("削除"));
  assert.equal(player.store.load()[0].problems.length, 0);
  player.get("btnCancelEditProblem").click();
  assert.equal(player.get("problemPlayer").hidden, true);
  assert.equal(player.get("problemAnswerLabel").textContent, "");
  assert.equal(player.get("problemExplanation").textContent, "");
});

if (require.main === module) (async () => {
  for (const { name, check } of tests) {
    await check();
    process.stdout.write(`PASS ${name}\n`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { pageHarness, initial, fields, tick };
