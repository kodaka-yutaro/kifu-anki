#!/usr/bin/env node
"use strict";

// Run with: node tools/test-tutorial.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Shogi = require("../shogi.js");
const lesson = require("../tutorial.js");
const source = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const BOOKS = "kifu-anki-books-v1";
const SETTINGS = "kifu-anki-settings-v1";
const TUTORIAL = "kifu-anki-tutorial-v1";
const json = value => JSON.parse(JSON.stringify(value));
const storedBooks = (title = "既存の定跡") => ({
  books: [{ title, root: Shogi.parseKIF(lesson.fullKif) }], current: 0
});

function leafLines(root) {
  const lines = [];
  function walk(node, position, line) {
    if (!node.children.length) {
      lines.push(line);
      return;
    }
    for (const child of node.children) {
      const move = child.move;
      assert.ok(move.from, "the opening should not require a captured piece");
      const piece = position.sq[move.from[0]][move.from[1]];
      assert.ok(piece && piece.s === position.turn, "move the side whose turn it is");
      assert.ok(
        Shogi.destinations(position, ...move.from).some(to => Shogi.sameSq(to, move.to)),
        `illegal lesson move: ${JSON.stringify(move)}`
      );
      const label = Shogi.label(position, move, node.move && node.move.to);
      walk(child, Shogi.apply(position, move), [...line, label]);
    }
  }
  walk(root, Shogi.initial(), []);
  return lines;
}

// Only the DOM methods used by app.js and the welcome/replay controls are stubbed.
// The real application, KIF parser, storage guards, and timer callbacks run below.
function harness({ data = new Map(), blocked = false, controller = false, search = "" } = {}) {
  class Element {
    constructor(id = "", tagName = "BUTTON") {
      this.id = id; this.tagName = tagName; this.dataset = {};
      this.children = []; this.attributes = new Map(); this.listeners = new Map();
      this.disabled = false; this.hidden = false; this.checked = false; this.open = false;
      this.value = ""; this.textContent = "";
      this.scrollLeft = 0; this.scrollTop = 0; this.clientWidth = 640; this.clientHeight = 240;
      const classes = new Set();
      Object.defineProperty(this, "className", {
        get: () => [...classes].join(" "),
        set: value => { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(n => classes.add(n)); }
      });
      this.classList = {
        add: (...names) => names.forEach(n => classes.add(n)),
        remove: (...names) => names.forEach(n => classes.delete(n)),
        contains: name => classes.has(name),
        toggle: (name, force = !classes.has(name)) => force ? classes.add(name) : classes.delete(name)
      };
    }
    set innerHTML(value) {
      this.html = value; this.children = [];
      if (this.id === "tree") {
        for (const match of value.matchAll(/<g\s+([^>]+)>/g)) {
          const node = new Element("", "g");
          for (const [, name, content] of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) {
            node.setAttribute(name, content);
            if (name === "class") node.className = content;
            if (name.startsWith("data-")) node.dataset[name.slice(5)] = content;
          }
          this.children.push(node);
        }
      }
    }
    get innerHTML() { return this.html || ""; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    appendChild(child) { this.children.push(child); }
    add(child) { this.children.push(child); }
    insertAdjacentHTML() {}
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }
    dispatch(type, detail = {}) {
      const event = { target: this, preventDefault() {}, stopPropagation() {}, ...detail };
      if (this[`on${type}`]) this[`on${type}`](event);
      for (const listener of this.listeners.get(type) || []) listener(event);
    }
    click() { if (!this.disabled) this.dispatch("click"); }
    showModal() { this.open = true; }
    close(value = "") { this.returnValue = value; this.open = false; this.dispatch("close"); }
    focus() {}
    scrollIntoView() {}
    remove() {}
    querySelectorAll(selector) {
      return selector === "g.node" ? this.children.filter(el => el.classList.contains("node")) : [];
    }
    querySelector(selector) {
      return selector === "g.current" ? this.children.find(el => el.classList.contains("current")) : null;
    }
  }
  const elements = new Map();
  for (const match of source("index.html").matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(match[2], match[1].toUpperCase());
    element.hidden = /\bhidden\b/.test(match[0]);
    elements.set(element.id, element);
  }
  const get = id => { assert.ok(elements.has(id), `missing element: ${id}`); return elements.get(id); };
  const modes = ["edit", "sente", "gote", "both"].map(mode => {
    const element = new Element(); element.dataset.mode = mode; return element;
  });
  const inputs = {};
  for (const name of ["board", "pieces"]) {
    inputs[name] = [...source("index.html").matchAll(new RegExp(`name="${name}" value="([^"]+)"`, "g"))]
      .map(match => { const input = new Element("", "INPUT"); input.value = match[1]; return input; });
  }
  get("settingsDialog").querySelectorAll = selector => inputs[/name=(\w+)/.exec(selector)[1]];
  get("settingsDialog").querySelector = selector =>
    get("settingsDialog").querySelectorAll(selector).find(input => input.checked);
  const document = new Element();
  document.body = new Element("", "BODY"); document.documentElement = new Element("", "HTML");
  document.getElementById = get;
  document.createElement = tag => new Element("", tag.toUpperCase());
  document.querySelectorAll = selector => selector === ".modes button" ? modes : [];
  document.querySelector = selector => {
    if (/^#[\w-]+$/.test(selector)) return get(selector.slice(1));
    if (selector === "dialog[open]") return [...elements.values()].find(el => el.tagName === "DIALOG" && el.open);
    return null;
  };
  const timers = new Map();
  const writes = [];
  let timerId = 0, saves = 0;
  const window = new Element();
  window.onKifuSaved = () => saves++;
  const context = vm.createContext({
    Shogi, document, window, URL, URLSearchParams, TextDecoder, Blob, File,
    location: { search, pathname: "/" }, history: { replaceState() {} }, navigator: {},
    Option: function (text, value) { this.text = text; this.value = value; },
    localStorage: {
      getItem(key) { if (blocked) throw new Error("storage unavailable"); return data.get(key) ?? null; },
      setItem(key, value) { if (blocked) throw new Error("storage unavailable"); data.set(key, value); writes.push(key); }
    },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch: () => new Promise(() => {}),
    alert(message) { throw new Error(message); }, prompt: () => null, confirm: () => true
  });
  vm.runInContext(source("app.js"), context, { filename: "app.js" });
  if (controller) vm.runInContext(source("tutorial.js"), context, { filename: "tutorial.js" });
  return {
    app: window.KifuTutorialApp, window, get, data, timers, writes,
    get saves() { return saves; },
    modeButton(mode) { return modes.find(el => el.dataset.mode === mode); },
    flushTimers() {
      let count = 0;
      while (timers.size) {
        assert.ok(++count < 50, "timer loop did not settle");
        const [id, { callback }] = timers.entries().next().value;
        timers.delete(id); callback();
      }
    },
    comment(value) { get("comment").value = value; get("comment").dispatch("input"); },
    move(from, to) {
      for (const [file, rank] of [from, to]) {
        const cell = get("board").children.find(el => +el.dataset.file === file && +el.dataset.rank === rank);
        assert.ok(cell, "board square exists"); cell.click();
      }
    }
  };
}

const tests = [];
function test(name, check) { tests.push({ name, check }); }
const mainLine = ["▲７六歩", "△３四歩", "▲２六歩", "△４四歩", "▲４八銀", "△４二飛"];
const branchLine = [...mainLine.slice(0, -1), "△３二飛"];

test("the real lesson fixtures have legal six-ply lines and the intended final branch", () => {
  assert.deepEqual(leafLines(Shogi.parseKIF(lesson.mainKif)), [mainLine]);
  assert.deepEqual(leafLines(Shogi.parseKIF(lesson.fullKif)), [mainLine, branchLine]);
});
test("KIF export and import preserve both branches and their comments", () => {
  const root = Shogi.parseKIF(lesson.fullKif);
  const roundTrip = Shogi.parseKIF(Shogi.toKIF(lesson.title, root));
  assert.deepEqual(roundTrip, root);
});

test("tutorial moves, comments and settings leave saved books and sync callbacks untouched", () => {
  const data = new Map([[BOOKS, JSON.stringify(storedBooks())], [SETTINGS, JSON.stringify({
    board: "dark", pieces: "mincho", arrows: false, hideComments: true
  })]]);
  const before = [...data];
  const h = harness({ data });
  h.get("btnNext").click(); h.get("btnNext").click();
  const original = h.app.state();
  assert.equal(h.app.begin(lesson.title, lesson.mainKif), true);
  h.app.sample(lesson.mainKif, { depth: 5 });
  h.move([8, 2], [3, 2]);
  assert.equal(h.app.state().total, 2);
  h.comment("体験中だけのメモ"); h.flushTimers();
  h.get("optHideComments").checked = true;
  h.get("settingsDialog").dispatch("change");
  assert.deepEqual([...data], before);
  assert.equal(h.saves, 0);
  h.app.finish();
  assert.equal(h.app.state().root, original.root);
  assert.equal(h.app.state().depth, original.depth);
  assert.deepEqual(json(h.app.state().settings), json(original.settings));
  assert.deepEqual([...data], before);
  assert.equal(h.timers.size, 0);
});

test("a pending real comment is saved before starting and tutorial comments cannot leak after exit", () => {
  const h = harness({ data: new Map([[BOOKS, JSON.stringify(storedBooks())]]) });
  h.comment("開始直前に書いたメモ");
  assert.equal(h.timers.size, 1);
  h.app.begin(lesson.title, lesson.mainKif);
  assert.equal(JSON.parse(h.data.get(BOOKS)).books[0].root.comment, "開始直前に書いたメモ");
  assert.equal(h.saves, 1);
  h.comment("保存しない練習メモ");
  assert.equal(h.timers.size, 1);
  h.app.finish(); h.flushTimers();
  assert.equal(h.app.state().root.comment, "開始直前に書いたメモ");
  assert.equal(h.saves, 1);
});

test("sample reset and repeated start/exit cancel opponent and comment timers", () => {
  const h = harness();
  const original = h.app.state().root;
  for (let i = 0; i < 3; i++) {
    assert.equal(h.app.begin(lesson.title, lesson.mainKif), true);
    assert.equal(h.app.begin(lesson.title, lesson.mainKif), false);
    h.app.mode("gote");
    assert.equal(h.timers.size, 1);
    h.app.sample(lesson.fullKif);
    assert.equal(h.timers.size, 0);
    h.comment("やり直すメモ");
    h.app.sample(lesson.mainKif);
    assert.equal(h.timers.size, 0);
    h.app.mode("gote");
    h.app.finish(); h.flushTimers();
    assert.equal(h.app.state().root, original);
    assert.equal(h.app.state().active, false);
    assert.equal(h.app.state().depth, 0);
  }
  assert.equal(h.saves, 0);
  assert.equal(h.writes.length, 0);
});

for (const notification of ["cloud", "other tab"]) {
  test(`${notification} updates received during a tutorial are loaded on exit`, () => {
    const h = harness({ data: new Map([[BOOKS, JSON.stringify(storedBooks())]]) });
    h.app.begin(lesson.title, lesson.mainKif);
    const tutorialRoot = h.app.state().root;
    const incoming = storedBooks("同期で届いた定跡");
    incoming.books[0].root.comment = "別の端末からのメモ";
    h.data.set(BOOKS, JSON.stringify(incoming));
    if (notification === "cloud") h.window.kifuReload();
    else h.window.dispatch("storage", { key: BOOKS });
    assert.equal(h.app.state().root, tutorialRoot);
    h.app.finish();
    assert.deepEqual(json(h.app.state().root), incoming.books[0].root);
    assert.equal(h.get("bookSelect").children[0].text, incoming.books[0].title);
    assert.equal(h.saves, 0);
    assert.equal(h.writes.length, 0);
  });
}

test("keeping the lesson preserves incoming books and uses a unique title", () => {
  const h = harness({ data: new Map([[BOOKS, JSON.stringify(storedBooks())]]) });
  h.app.begin(lesson.title, lesson.fullKif);
  const incoming = storedBooks(lesson.title);
  h.data.set(BOOKS, JSON.stringify(incoming)); h.window.kifuReload();
  h.app.finish(true);
  const saved = JSON.parse(h.data.get(BOOKS));
  assert.deepEqual(saved.books[0], incoming.books[0]);
  assert.equal(saved.books[1].title, `${lesson.title}（2）`);
  assert.deepEqual(leafLines(saved.books[1].root), [mainLine, branchLine]);
  assert.equal(saved.current, 1);
  assert.equal(h.saves, 1);
});

test("an asynchronous tutorial import cannot modify real books after exit", async () => {
  for (const waitForDialog of [false, true]) {
    const h = harness({ data: new Map([[BOOKS, JSON.stringify(storedBooks())]]) });
    const before = h.data.get(BOOKS);
    const original = h.app.state().root;
    h.app.begin(lesson.title, lesson.mainKif);
    const pending = h.app.importSample(lesson.fullKif);
    if (waitForDialog) {
      await new Promise(setImmediate);
      assert.equal(h.get("importDialog").open, true);
    }
    h.app.finish();
    if (waitForDialog) h.get("importDialog").close("merge");
    await pending;
    assert.equal(h.app.state().root, original);
    assert.equal(h.data.get(BOOKS), before);
    assert.equal(h.saves, 0);
  }
});

test("an import from an earlier tutorial step cannot change a replacement sample", async () => {
  for (const waitForDialog of [false, true]) {
    const h = harness();
    h.app.begin(lesson.title, lesson.mainKif);
    const pending = h.app.importSample(lesson.fullKif);
    if (waitForDialog) {
      await new Promise(setImmediate);
      assert.equal(h.get("importDialog").open, true);
    }
    h.app.sample(lesson.mainKif, { depth: 1 });
    const replacement = h.app.state().root;
    await new Promise(setImmediate);
    if (h.get("importDialog").open) h.get("importDialog").close("merge");
    await pending;
    assert.equal(h.app.state().root, replacement);
    assert.equal(h.app.state().total, 1);
    assert.equal(h.app.state().depth, 1);
    assert.equal(h.saves, 0);
    h.app.finish();
  }
});

test("first-use invitation, dismissal and manual replay work without saving a demo book", () => {
  const h = harness({ controller: true });
  assert.equal(h.get("tutorialWelcome").hidden, false);
  h.get("btnTutorialDismiss").click();
  assert.equal(h.get("tutorialWelcome").hidden, true);
  assert.equal(h.data.has(TUTORIAL), true);
  h.get("btnTutorial").click();
  assert.equal(h.app.state().active, true);
  h.get("btnTutorialExit").click();
  h.get("btnHelpTutorial").click();
  assert.equal(h.app.state().active, true);
  h.get("btnTutorialExit").click();
  assert.equal(h.app.state().active, false);
  assert.equal(h.data.has(BOOKS), false);
  assert.equal(h.get("btnNew").disabled, false);
  assert.equal(h.get("btnLibrary").getAttribute("aria-disabled"), null);
  const reload = harness({ data: h.data, controller: true });
  assert.equal(reload.get("tutorialWelcome").hidden, true);
});

test("existing books and a pending linked KIF suppress the first-use invitation", () => {
  const existing = harness({ data: new Map([[BOOKS, JSON.stringify(storedBooks())]]), controller: true });
  assert.equal(existing.get("tutorialWelcome").hidden, true);
  existing.get("btnTutorial").click();
  assert.equal(existing.app.state().active, true);
  existing.get("btnTutorialExit").click();
  const linked = harness({ search: "?kif=joseki/example.kif", controller: true });
  assert.equal(linked.get("tutorialWelcome").hidden, true);
  assert.equal(linked.app.state().linkedKifPending, true);
  linked.get("btnTutorial").click();
  assert.equal(linked.app.state().active, false);
});

test("unavailable browser storage still permits first use, exit and replay", () => {
  const h = harness({ blocked: true, controller: true });
  const original = h.app.state().root;
  assert.equal(h.get("tutorialWelcome").hidden, false);
  for (let i = 0; i < 2; i++) {
    h.get("btnTutorialStart").click();
    assert.equal(h.app.state().active, true);
    h.get("btnTutorialExit").click();
    assert.equal(h.app.state().root, original);
    assert.equal(h.app.state().active, false);
    assert.equal(h.timers.size, 0);
  }
});

test("failed lesson storage reports the failure and does not notify cloud sync", () => {
  const h = harness({ blocked: true });
  h.app.begin(lesson.title, lesson.mainKif);
  h.app.finish(true);
  assert.equal(h.app.state().active, false);
  assert.equal(h.data.has(BOOKS), false);
  assert.equal(h.saves, 0);
  assert.match(h.get("message").textContent, /保存でき|保存に失敗/);
  assert.match(h.get("message").textContent, /書出/);
  assert.doesNotMatch(h.get("message").textContent, /保存しました/);
});

test("all ten tutorial steps complete through the real app controls and can be replayed", async () => {
  const original = storedBooks();
  const h = harness({ data: new Map([[BOOKS, JSON.stringify(original)]]), controller: true });
  const next = () => {
    assert.equal(h.get("btnTutorialNext").disabled, false, h.get("tutorialTitle").textContent);
    h.get("btnTutorialNext").click();
  };
  const finishLine = () => {
    const done = h.app.state().done;
    for (let attempts = 0; h.app.state().done === done; attempts++) {
      assert.ok(attempts < 20, "a six-ply drill should complete");
      const state = h.app.state();
      if (state.waiting) h.flushTimers();
      else { assert.ok(state.nextMove); h.move(state.nextMove.from, state.nextMove.to); }
    }
  };

  h.get("btnTutorial").click();
  h.move([7, 7], [7, 6]); next();
  h.get("btnPrev").click(); h.get("btnNext").click(); h.get("btnLast").click(); next();
  h.get("btnPrev").click(); h.move([8, 2], [3, 2]); next();
  const mainLeaf = h.get("tree").children.find(el => el.getAttribute("aria-label") === "6手目 △４二飛");
  assert.ok(mainLeaf); mainLeaf.click();
  const comment = "飛車を4筋に振る練習メモ";
  h.comment(comment); next();

  h.modeButton("sente").click(); h.get("btnAnswer").click();
  finishLine();
  assert.equal(h.get("btnTutorialNext").disabled, true, "both branches are required for the sente step");
  h.get("btnContinue").click(); finishLine(); next();
  h.modeButton("gote").click(); finishLine(); next();
  h.modeButton("both").click(); finishLine(); next();

  h.get("btnSettings").click();
  h.get("optHideComments").checked = true; h.get("settingsDialog").dispatch("change");
  h.get("settingsDialog").close();
  assert.equal(h.get("commentCover").hidden, false);
  h.get("commentCover").click(); next();
  h.get("btnExport").click(); h.flushTimers(); next();
  const imported = h.get("btnTutorialImport").onclick();
  await new Promise(setImmediate);
  assert.equal(h.get("importDialog").open, true);
  h.get("importDialog").close("merge"); await imported; next();

  assert.equal(h.get("tutorialDone").hidden, false);
  assert.equal(JSON.parse(h.data.get(TUTORIAL)).status, "completed");
  assert.deepEqual(JSON.parse(h.data.get(BOOKS)), original);
  assert.equal(h.saves, 0);
  h.get("btnTutorialKeep").click();
  const saved = JSON.parse(h.data.get(BOOKS));
  assert.deepEqual(saved.books[0], original.books[0]);
  assert.equal(saved.books.length, 2);
  assert.deepEqual(leafLines(saved.books[1].root), [mainLine, branchLine]);
  let leaf = saved.books[1].root;
  while (leaf.children.length) leaf = leaf.children[0];
  assert.ok(leaf.comment.includes(comment));
  assert.equal(h.saves, 1);
  assert.equal(h.timers.size, 0);
  h.get("btnTutorial").click();
  assert.equal(h.app.state().active, true);
  assert.equal(h.app.state().depth, 0);
  h.get("btnTutorialExit").click();
  assert.deepEqual(JSON.parse(h.data.get(BOOKS)), saved);
  assert.equal(h.timers.size, 0);
});

(async () => {
  for (const { name, check } of tests) {
    await check();
    process.stdout.write(`PASS ${name}\n`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
