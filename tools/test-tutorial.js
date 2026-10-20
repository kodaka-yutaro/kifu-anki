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

// Only the DOM methods used by app.js and the tutorial controls are stubbed.
// The real application, KIF parser, storage guards, and timer callbacks run below.
function harness({ data = new Map(), blocked = false, controller = false, search = "" } = {}) {
  let document;
  class Element {
    constructor(id = "", tagName = "BUTTON") {
      this.id = id; this.tagName = tagName; this.dataset = {};
      this.children = []; this.attributes = new Map(); this.listeners = new Map();
      this.disabled = false; this.hidden = false; this.checked = false; this.open = false;
      this.value = ""; this.textContent = "";
      this.scrollLeft = 0; this.scrollTop = 0; this.clientWidth = 640; this.clientHeight = 240;
      this.parentElement = null;
      this.style = { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } };
      this.rect = { left: 100, top: 100, width: id === "tutorialPanel" ? 320 : 120, height: id === "tutorialPanel" ? 180 : 32 };
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
      this.html = value;
      this.children.forEach(child => child.parentElement = null);
      this.children = [];
      if (this.id === "tree") {
        for (const match of value.matchAll(/<g\s+([^>]+)>/g)) {
          const node = new Element("", "g");
          for (const [, name, content] of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) {
            node.setAttribute(name, content);
            if (name === "class") node.className = content;
            if (name.startsWith("data-")) node.dataset[name.slice(5)] = content;
          }
          this.appendChild(node);
        }
      }
    }
    get innerHTML() { return this.html || ""; }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name === "class") this.className = value;
      if (name.startsWith("data-")) this.dataset[name.slice(5)] = String(value);
    }
    getAttribute(name) {
      if (name === "id") return this.id || null;
      if (name === "class") return this.className || null;
      if (name.startsWith("data-")) return this.dataset[name.slice(5)] === undefined ? null : String(this.dataset[name.slice(5)]);
      if (name === "disabled") return this.disabled ? "" : null;
      return this.attributes.get(name) ?? null;
    }
    removeAttribute(name) { this.attributes.delete(name); }
    appendChild(child) {
      if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(el => el !== child);
      child.parentElement = this; this.children.push(child); return child;
    }
    add(child) { this.appendChild(child); }
    insertAdjacentHTML() {}
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }
    dispatch(type, detail = {}) {
      const event = { target: this, preventDefault() {}, stopPropagation() {}, ...detail };
      const result = this[`on${type}`] ? this[`on${type}`](event) : undefined;
      for (const listener of this.listeners.get(type) || []) listener(event);
      return result;
    }
    click() { if (!this.disabled) return this.dispatch("click"); }
    showModal() { this.open = true; }
    close(value = "") { this.returnValue = value; this.open = false; this.dispatch("close"); }
    focus() { document.activeElement = this; }
    scrollIntoView() {}
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(el => el !== this);
      this.parentElement = null;
    }
    getBoundingClientRect() {
      let { left, top, width, height } = this.rect;
      if (this.parentElement && this.parentElement.id === "board") {
        const index = this.parentElement.children.indexOf(this);
        width = height = 40; left = 180 + (index % 9) * 40; top = 180 + Math.floor(index / 9) * 40;
      }
      return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
    }
    getClientRects() {
      for (let el = this; el; el = el.parentElement) {
        if (el.hidden || (el.tagName === "DIALOG" && !el.open)) return [];
      }
      return [this.getBoundingClientRect()];
    }
    matches(selector) {
      return selector.split(",").some(part => {
        const tokens = part.trim().match(/(?:\[[^\]]*\]|[^\s])+/g) || [];
        const matchesToken = (el, token) => {
          const tag = /^[\w-]+/.exec(token);
          const id = /#([\w-]+)/.exec(token);
          if (tag && el.tagName.toLowerCase() !== tag[0].toLowerCase()) return false;
          if (id && el.id !== id[1]) return false;
          for (const [, name] of token.matchAll(/\.([\w-]+)/g)) if (!el.classList.contains(name)) return false;
          for (const [, name, value] of token.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
            if (name === "open" ? !el.open : el.getAttribute(name) === null) return false;
            if (value !== undefined && el.getAttribute(name) !== value) return false;
          }
          return true;
        };
        if (!tokens.length || !matchesToken(this, tokens.pop())) return false;
        let ancestor = this.parentElement;
        while (tokens.length) {
          const token = tokens.pop();
          while (ancestor && !matchesToken(ancestor, token)) ancestor = ancestor.parentElement;
          if (!ancestor) return false;
          ancestor = ancestor.parentElement;
        }
        return true;
      });
    }
    closest(selector) {
      for (let el = this; el; el = el.parentElement) if (el.matches(selector)) return el;
      return null;
    }
    querySelectorAll(selector) {
      const found = [];
      const visit = el => {
        if (el.matches && el.matches(selector)) found.push(el);
        (el.children || []).forEach(visit);
      };
      this.children.forEach(visit);
      return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const elements = new Map();
  for (const match of source("index.html").matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(match[2], match[1].toUpperCase());
    for (const [, name, value] of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) element.setAttribute(name, value);
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
  get("settingsDialog").querySelectorAll = function (selector) {
    const name = /name=(\w+)/.exec(selector);
    return name ? inputs[name[1]] : Element.prototype.querySelectorAll.call(this, selector);
  };
  get("settingsDialog").querySelector = function (selector) {
    const candidates = this.querySelectorAll(selector);
    return selector.includes(":checked") ? candidates.find(input => input.checked) : candidates[0] || null;
  };
  document = new Element();
  document.body = new Element("", "BODY"); document.documentElement = new Element("", "HTML");
  document.documentElement.appendChild(document.body);
  for (const el of elements.values()) document.body.appendChild(el);
  const guideContent = new Element("", "DIV");
  guideContent.className = "tutorial-guide-content";
  get("tutorialPanel").appendChild(guideContent);
  for (const id of ["tutorialStep", "tutorialTitle", "tutorialHint", "tutorialFeedback", "tutorialProgress", "btnTutorialExit", "btnTutorialNext", "btnTutorialBack", "btnTutorialRetry"])
    if (elements.has(id)) guideContent.appendChild(get(id));
  for (const id of ["tutorialDoneTitle", "btnTutorialFinish", "btnTutorialKeep"])
    if (elements.has(id)) get("tutorialDone").appendChild(get(id));
  get("helpDialog").appendChild(get("btnHelpTutorial"));
  // Dialog action buttons have no IDs, but the moving guide anchors to them.
  for (const id of ["settingsDialog", "importDialog"]) {
    const markup = new RegExp(`<dialog[^>]*id="${id}"[^>]*>([\\s\\S]*?)</dialog>`).exec(source("index.html"))[1];
    for (const [, contents] of markup.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)) {
      const form = new Element("", "FORM"); get(id).appendChild(form);
      for (const [, attributes] of contents.matchAll(/<button\b([^>]*)>/g)) {
        const button = new Element();
        for (const [, name, value] of attributes.matchAll(/([\w-]+)="([^"]*)"/g)) button.setAttribute(name, value);
        form.appendChild(button);
      }
    }
  }
  const modeGroup = new Element(); modeGroup.className = "modes";
  modes.forEach(el => modeGroup.appendChild(el)); document.body.appendChild(modeGroup);
  for (const group of Object.values(inputs)) group.forEach(el => get("settingsDialog").appendChild(el));
  for (const id of ["optArrows", "optHideComments"]) get("settingsDialog").appendChild(get(id));
  document.activeElement = document.body;
  document.getElementById = get;
  document.createElement = tag => new Element("", tag.toUpperCase());
  document.querySelectorAll = selector => document.documentElement.querySelectorAll(selector);
  document.querySelector = selector => document.documentElement.querySelector(selector);
  const timers = new Map();
  const frames = new Map();
  const writes = [];
  let timerId = 0, frameId = 0, saves = 0;
  const window = new Element();
  window.innerWidth = 1024; window.innerHeight = 768;
  const requestAnimationFrame = callback => { const id = ++frameId; frames.set(id, callback); return id; };
  const cancelAnimationFrame = id => frames.delete(id);
  window.requestAnimationFrame = requestAnimationFrame; window.cancelAnimationFrame = cancelAnimationFrame;
  window.onKifuSaved = () => saves++;
  const context = vm.createContext({
    Shogi, document, window, URL, URLSearchParams, TextDecoder, Blob, File,
    requestAnimationFrame, cancelAnimationFrame,
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
    app: window.KifuTutorialApp, window, get, data, timers, frames, writes,
    get saves() { return saves; },
    get focused() { return document.activeElement; },
    modeButton(mode) { return modes.find(el => el.dataset.mode === mode); },
    startTutorial() {
      get("btnHelp").click(); get("btnHelpTutorial").click(); this.flushFrames();
    },
    flushFrames() {
      let count = 0;
      while (frames.size) {
        assert.ok(++count < 50, "animation frames did not settle");
        const [id, callback] = frames.entries().next().value;
        frames.delete(id); callback(0);
      }
    },
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

test("retired themes load into selectable replacements without changing saved books", () => {
  for (const [oldPieces, newPieces] of [["mincho", "rounded"], ["kokuryu", "photo"]]) {
    const books = JSON.stringify(storedBooks());
    const data = new Map([[BOOKS, books], [SETTINGS, JSON.stringify({ board: "dark", pieces: oldPieces, arrows: false, hideComments: true })]]);
    const h = harness({ data });
    assert.equal(h.app.state().settings.board, "felt");
    assert.equal(h.app.state().settings.pieces, newPieces);
    h.get("optArrows").checked = true;
    h.get("settingsDialog").dispatch("change");
    assert.deepEqual(JSON.parse(data.get(SETTINGS)), { board: "felt", pieces: newPieces, arrows: true, hideComments: true });
    assert.equal(data.get(BOOKS), books);
    assert.equal(h.saves, 0);
  }
});

test("photo lettering keeps captured pieces, promoted moves, and KIF data intact", () => {
  const kif = "手合割：平手\n手数----指手---------消費時間--\n1 ７六歩(77)\n2 ３四歩(33)\n3 ２二角成(88)\n";
  const data = new Map([[SETTINGS, JSON.stringify({ board: "felt", pieces: "photo" })]]);
  const h = harness({ data });
  h.app.begin("表示確認", kif);
  h.app.sample(kif, { depth: 3 });
  const promoted = h.get("board").children.find(el => +el.dataset.file === 2 && +el.dataset.rank === 2);
  assert.equal(promoted.getAttribute("aria-label"), "2二 先手馬");
  assert.equal(promoted.classList.contains("promoted"), true);
  assert.ok(promoted.innerHTML.includes("龍\n馬"));
  const captured = h.get("handBottom").children.find(el => el.classList.contains("hand-piece"));
  assert.equal(captured.getAttribute("aria-label"), "先手の持駒 角 1枚");
  assert.ok(captured.innerHTML.includes("角\n行"));
  assert.deepEqual(json(h.app.state().root), Shogi.parseKIF(kif));
  h.app.finish();
  assert.equal(data.has(BOOKS), false);
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

test("a tutorial starts only from help and can be replayed without writing history or a demo book", () => {
  const h = harness({ controller: true });
  const importHandler = h.get("btnImport").onclick;
  assert.equal(h.app.state().active, false);
  assert.equal(h.get("tutorialPanel").hidden, true);
  assert.equal(h.get("tutorialDone").hidden, true);
  h.startTutorial();
  assert.equal(h.app.state().active, true);
  assert.equal(h.get("helpDialog").open, false);
  h.get("btnTutorialExit").click();
  h.startTutorial();
  assert.equal(h.app.state().active, true);
  h.get("btnTutorialExit").click();
  assert.equal(h.app.state().active, false);
  assert.equal(h.get("btnImport").onclick, importHandler);
  let filePickerOpened = 0;
  h.get("fileInput").onclick = () => filePickerOpened++;
  h.get("btnImport").click();
  assert.equal(filePickerOpened, 1, "normal import returns to the file picker after exit");
  assert.equal(h.data.size, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.get("btnNew").disabled, false);
  assert.equal(h.get("btnLibrary").getAttribute("aria-disabled"), null);
  assert.equal(h.focused, h.get("btnHelp"));
  h.flushFrames();
  assert.equal(h.frames.size, 0);
  const reload = harness({ data: h.data, controller: true });
  assert.equal(reload.app.state().active, false);
  assert.equal(reload.get("tutorialPanel").hidden, true);
});

test("existing books stay idle and a pending linked KIF prevents starting a tutorial", () => {
  const existing = harness({ data: new Map([[BOOKS, JSON.stringify(storedBooks())]]), controller: true });
  assert.equal(existing.app.state().active, false);
  existing.startTutorial();
  assert.equal(existing.app.state().active, true);
  existing.get("btnTutorialExit").click();
  const linked = harness({ search: "?kif=joseki/example.kif", controller: true });
  const importHandler = linked.get("btnImport").onclick;
  assert.equal(linked.app.state().active, false);
  assert.equal(linked.app.state().linkedKifPending, true);
  linked.startTutorial();
  assert.equal(linked.app.state().active, false);
  assert.equal(linked.get("btnImport").onclick, importHandler);
});

test("unavailable browser storage still permits help entry, exit and replay", () => {
  const h = harness({ blocked: true, controller: true });
  const original = h.app.state().root;
  for (let i = 0; i < 2; i++) {
    h.startTutorial();
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
  const importHandler = h.get("btnImport").onclick;
  const next = () => {
    assert.equal(h.get("btnTutorialNext").disabled, false, h.get("tutorialTitle").textContent);
    h.get("btnTutorialNext").click();
    h.flushFrames();
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

  h.startTutorial();
  h.move([7, 7], [7, 6]); next();
  h.get("btnPrev").click(); h.get("btnNext").click(); h.get("btnLast").click(); next();
  h.get("btnPrev").click(); h.move([8, 2], [3, 2]); next();
  const mainLeaf = h.get("tree").children.find(el => el.getAttribute("aria-label") === "6手目 △４二飛");
  assert.ok(mainLeaf); mainLeaf.click();

  // Fixed geometry probe for a keyboard-sized viewport; this is not a CSS renderer.
  const guide = h.get("tutorialPanel"), input = h.get("comment");
  const content = guide.querySelector(".tutorial-guide-content");
  const measureGuide = guide.getBoundingClientRect, inputRect = input.rect;
  h.window.visualViewport = { width: 390, height: 300, offsetLeft: 0, offsetTop: 0 };
  input.rect = { left: 16, top: 110, width: 358, height: 110 };
  guide.getBoundingClientRect = () => {
    const left = parseFloat(guide.style.left) || 0, top = parseFloat(guide.style.top) || 0;
    const width = Math.min(320, parseFloat(guide.style.maxWidth) || 320);
    // Supply the measured size after max-height, including a two-pixel outer border.
    const height = Math.min(180, (parseFloat(content.style.maxHeight) || 180) + 2);
    return { left, top, width, height, right: left + width, bottom: top + height };
  };
  input.focus(); h.window.dispatch("resize"); h.flushFrames();
  const placed = guide.getBoundingClientRect();
  assert.equal(guide.classList.contains("is-typing"), true);
  assert.equal(guide.dataset.placement, "top");
  assert.ok(placed.top >= 0 && placed.bottom <= input.rect.top, "the guide stays above the active comment field");
  assert.ok(placed.left >= 0 && placed.right <= 390, "the guide stays inside the narrow viewport");
  guide.getBoundingClientRect = measureGuide; input.rect = inputRect;
  h.window.visualViewport = undefined; h.window.dispatch("resize"); h.flushFrames();

  const comment = "飛車を4筋に振る練習メモ";
  h.comment(comment); next();

  h.modeButton("sente").click(); h.get("btnAnswer").click();
  finishLine();
  assert.equal(h.get("btnTutorialNext").disabled, true, "both branches are required for the sente step");
  h.get("btnContinue").click(); finishLine(); next();
  h.modeButton("gote").click(); finishLine(); next();
  h.modeButton("both").click(); finishLine(); next();

  h.get("btnSettings").click();
  h.flushFrames();
  assert.equal(h.get("tutorialPanel").parentElement, h.get("settingsDialog"));
  h.get("optHideComments").checked = true; h.get("settingsDialog").dispatch("change");
  h.flushFrames();
  assert.equal(h.get("settingsDialog").querySelector("form button").getAttribute("aria-describedby"), "tutorialHint");
  h.get("settingsDialog").close();
  h.flushFrames();
  assert.equal(h.get("tutorialPanel").parentElement.tagName, "BODY");
  assert.equal(h.get("commentCover").hidden, false);
  h.get("commentCover").click(); next();
  h.get("btnExport").click(); h.flushTimers(); next();
  const earlierStepImport = h.get("btnImport").click();
  await new Promise(setImmediate);
  h.flushFrames();
  assert.equal(h.get("importDialog").open, true);
  assert.equal(h.get("tutorialPanel").parentElement, h.get("importDialog"));
  assert.equal(h.get("importDialog").querySelector('button[value="merge"]').getAttribute("aria-describedby"), "tutorialHint");
  h.get("btnTutorialBack").click();
  await earlierStepImport; h.flushFrames();
  assert.equal(h.get("importDialog").open, false);
  assert.equal(h.get("tutorialPanel").parentElement.tagName, "BODY");
  assert.equal(h.get("tutorialStep").textContent, "9 / 10");
  h.get("btnExport").click(); h.flushTimers(); next();

  const supersededImport = h.get("btnImport").click();
  await new Promise(setImmediate);
  h.get("btnTutorialRetry").click();
  // Start another read before the canceled read's finally callback has run.
  const canceledImport = h.get("btnImport").click();
  await new Promise(setImmediate); await supersededImport;
  assert.equal(h.get("importDialog").open, true);
  assert.equal(h.get("btnImport").disabled, true, "an older import must not reset a newer import's busy state");
  h.get("importDialog").close(); await canceledImport;
  h.flushFrames();
  assert.equal(h.get("tutorialPanel").parentElement.tagName, "BODY");
  assert.equal(h.get("btnTutorialNext").disabled, true, "canceling import must not complete the step");
  assert.equal(h.get("btnImport").disabled, false, "a canceled import can be retried");
  const imported = h.get("btnImport").click();
  await new Promise(setImmediate);
  assert.equal(h.get("importDialog").open, true);
  h.get("importDialog").close("merge"); await imported; next();

  assert.equal(h.get("tutorialDone").hidden, false);
  assert.deepEqual(JSON.parse(h.data.get(BOOKS)), original);
  assert.equal(h.writes.length, 0);
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
  assert.equal(h.get("btnImport").onclick, importHandler);
  h.startTutorial();
  assert.equal(h.app.state().active, true);
  assert.equal(h.app.state().depth, 0);
  h.get("btnTutorialExit").click();
  assert.deepEqual(JSON.parse(h.data.get(BOOKS)), saved);
  assert.equal(h.timers.size, 0);
  assert.equal(h.get("btnImport").onclick, importHandler);
  assert.deepEqual(h.writes, [BOOKS]);
  h.flushFrames();
  assert.equal(h.frames.size, 0);
});

(async () => {
  for (const { name, check } of tests) {
    await check();
    process.stdout.write(`PASS ${name}\n`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
