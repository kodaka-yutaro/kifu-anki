#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const vm = require("node:vm");
const Shogi = require("../shogi.js");
const lesson = require("../tutorial.js");
const { harness, source, BOOKS, PROBLEMS, json } = require("./test-tutorial.js");
const { pageHarness, initial, tick } = require("./test-problem-library.js");

const tests = [];
const test = (name, check) => tests.push({ name, check });
const books = h => JSON.parse(h.data.get(BOOKS));
const file = (name, text) => new File([text], name, { type: "text/plain" });
const untitled = text => text.replace(/^表題[：:].*\n/m, "");
const importFiles = (h, files) => {
  h.context.__qaImportFiles = files;
  const promise = vm.runInContext("importKifuFiles(__qaImportFiles)", h.context);
  delete h.context.__qaImportFiles;
  return promise;
};

test("UTF-8 kifu import keeps the title, comments and branches, then opens the selected file on the board", async () => {
  const data = initial();
  const library = pageHarness("library", { data });
  const existing = books(library).books[0];
  const kif = "表題：読み込んだ振り飛車\n" + lesson.fullKif;
  const input = library.get("kifuFileInput");
  let pickerOpened = 0;
  input.onclick = () => pickerOpened++;
  library.get("btnImportKifu").click();
  assert.equal(pickerOpened, 1);
  input.files = [file("fallback.kifu", kif)];
  await input.dispatch("change");
  assert.equal(input.value, "", "the same file can be selected again after import");
  const imported = books(library).books[1];
  assert.equal(imported.title, "読み込んだ振り飛車");
  assert.deepEqual(imported.root, Shogi.parseKIF(kif));
  assert.deepEqual(books(library).books[0], existing);
  let leaf = imported.root;
  for (let i = 0; i < 5; i++) leaf = leaf.children[0];
  assert.equal(leaf.children.length, 2, "both the main line and its branch remain in the saved file");
  library.get("myBooks").children[1].querySelector("a").click();
  assert.equal(books(library).current, 1);
  assert.equal(library.context.location.href, "index.html");
  const board = harness({ data });
  assert.equal(board.get("currentBookTitle").textContent, imported.title);
  assert.deepEqual(json(board.app.state().root), imported.root);
  assert.doesNotMatch(source("index.html"), /id="bookSelect"/);
});

test("Shift-JIS files retain Japanese titles and comments", async () => {
  const h = pageHarness("library", { data: initial() });
  const encoded = Buffer.from("lVyR6IFGg1aDdINngmmCaIJyivuViAqO6I2HioSBRpW9jugKjuiQlC0tLS2Od47oLS0tLS0tLS0tj8GU746eitQtLQoxIIJWmFqV4Cg3NykKMiCCUo5sleAoMzMpCiqKcJO5gvCKSoKtCg==", "base64");
  await importFiles(h, [new File([encoded], "shift-jis.kif")]);
  const imported = books(h).books[1];
  assert.equal(imported.title, "シフトＪＩＳ棋譜");
  assert.equal(imported.root.children[0].children[0].comment, "角道を開く");
  assert.equal(h.syncs, 1);
});

test("multiple imports use unique file names and do not merge into or replace an existing record", async () => {
  const h = pageHarness("library", { data: initial() });
  const before = books(h).books[0];
  await importFiles(h, [
    file("元からある棋譜.KIFU", untitled(lesson.mainKif)),
    file("元からある棋譜.kif", untitled(lesson.fullKif))
  ]);
  const saved = books(h).books;
  assert.equal(saved.length, 3);
  assert.deepEqual(saved[0], before);
  assert.equal(new Set(saved.map(book => book.title)).size, 3);
  assert.ok(saved[1].title.includes("（2）"));
  assert.ok(saved[2].title.includes("（3）"));
  assert.deepEqual(saved[1].root, Shogi.parseKIF(lesson.mainKif));
  assert.deepEqual(saved[2].root, Shogi.parseKIF(lesson.fullKif));
  assert.equal(h.syncs, 1, "a batch is saved once");
});

test("a mixed batch saves the valid file and reports the invalid file without creating an empty kifu", async () => {
  const h = pageHarness("library", { data: initial() });
  await importFiles(h, [file("valid.kif", untitled(lesson.mainKif)), file("invalid.kif", "this is not a shogi record")]);
  assert.equal(books(h).books.length, 2);
  assert.equal(books(h).books[1].title, "valid");
  assert.ok(h.get("libraryStatus").textContent.includes("invalid.kif"));
  assert.equal(h.syncs, 1);
});

test("empty and unrelated files do not change either store or report a successful import", async () => {
  const h = pageHarness("library", { data: initial() });
  const before = [...h.data];
  await importFiles(h, [file("empty.kif", ""), file("backup.json", '{"books":[]}')]);
  assert.deepEqual([...h.data], before);
  assert.equal(h.syncs, 0);
  assert.ok(h.get("libraryStatus").classList.contains("ng"));
});

test("a failed import write preserves saved files and supports retry", async () => {
  const h = pageHarness("library", { data: initial() });
  const before = [...h.data];
  h.failWrites(BOOKS);
  await importFiles(h, [file("retry.kif", lesson.mainKif)]);
  assert.deepEqual([...h.data], before);
  assert.equal(h.syncs, 0);
  assert.equal(h.get("btnImportKifu").disabled, false);
  assert.ok(h.get("libraryStatus").classList.contains("ng"));
  await importFiles(h, [file("retry.kif", lesson.mainKif)]);
  assert.equal(books(h).books.length, 2);
  assert.equal(h.syncs, 1);
});

test("an import that finishes reading later appends to the latest saved files", async () => {
  const h = pageHarness("library", { data: initial() });
  let resolve;
  const delayed = { name: "later.kif", arrayBuffer: () => new Promise(done => { resolve = done; }) };
  const pending = importFiles(h, [delayed]);
  await tick();
  const latest = books(h);
  latest.books.push({ title: "読込中に別画面で追加", root: Shogi.newNode(null) });
  latest.current = 1;
  h.data.set(BOOKS, JSON.stringify(latest));
  resolve(await file("later.kif", untitled(lesson.mainKif)).arrayBuffer());
  await pending;
  assert.equal(books(h).books.length, 3);
  assert.equal(books(h).books[1].title, "読込中に別画面で追加");
  assert.equal(books(h).books[2].title, "later");
  assert.equal(books(h).current, 1);
});

test("a first visit shows one saved kifu and one playable next-move book", () => {
  const data = new Map();
  const library = pageHarness("library", { data });
  assert.equal(books(library).books.length, 1);
  assert.equal(library.store.load().length, 1);
  assert.equal(library.get("myBooks").children.length, 1);
  assert.equal(library.get("myProblemCollections").children.length, 1);
  const collection = json(library.store.load()[0]);
  assert.ok(collection.problems.length > 0);
  const initialData = [...data];
  const player = pageHarness("problems", { data, search: `?id=${collection.id}` });
  for (const [index, problem] of collection.problems.entries()) {
    if (index) player.get("btnNextProblem").click();
    assert.equal(player.get("problemAnswerPanel").hidden, true);
    assert.ok(problem.question.trim(), "a sample question identifies the intended move");
    player.move(problem.answer.from, problem.answer.to);
    assert.equal(player.get("problemFeedback").textContent, "正解です。");
    assert.equal(player.get("problemExplanation").textContent, problem.explanation);
  }
  const again = pageHarness("library", { data });
  assert.equal(books(again).books.length, 1);
  assert.equal(again.store.load().length, 1);
  assert.deepEqual([...data], initialData, "opening or solving samples does not duplicate or modify them");
});

test("creating an empty kifu keeps a failed draft and opens the newly saved file after retry", () => {
  const data = initial();
  const library = pageHarness("library", { data });
  const before = [...data];
  library.get("btnNewKifu").click();
  library.get("newKifuName").value = "手作りの棋譜";
  library.failWrites(BOOKS);
  library.get("newKifuForm").dispatch("submit");
  assert.equal(library.get("newKifuDialog").open, true);
  assert.equal(library.get("newKifuName").value, "手作りの棋譜");
  assert.deepEqual([...data], before);
  assert.equal(library.syncs, 0);
  library.get("newKifuForm").dispatch("submit");
  assert.equal(library.get("newKifuDialog").open, false);
  assert.equal(library.context.location.href, "index.html");
  assert.equal(books(library).current, 1);
  const board = harness({ data });
  assert.equal(board.get("currentBookTitle").textContent, "手作りの棋譜");
  assert.equal(board.app.state().root.children.length, 0);
});

test("returning to files saves a pending comment and keeps navigation blocked until a failed save can be retried", () => {
  const board = harness({ data: initial() });
  board.comment("ファイル画面へ移る直前のコメント");
  assert.equal(board.timers.size, 1);
  let prevented = 0;
  const navigate = () => board.get("btnLibrary").dispatch("click", { preventDefault() { prevented++; } });
  navigate();
  assert.equal(prevented, 0);
  assert.equal(board.timers.size, 0);
  assert.equal(books(board).books[0].root.comment, "ファイル画面へ移る直前のコメント");
  const saved = board.data.get(BOOKS);
  board.comment("保存失敗しても失ってはいけないコメント");
  board.blockStorage();
  navigate(); navigate();
  assert.equal(prevented, 2, "repeated navigation remains blocked while the draft is unsaved");
  assert.equal(board.data.get(BOOKS), saved);
  assert.ok(board.get("message").classList.contains("ng"));
  board.blockStorage(false);
  navigate();
  assert.equal(prevented, 2);
  assert.equal(books(board).books[0].root.comment, "保存失敗しても失ってはいけないコメント");
  assert.equal(board.timers.size, 0);
});

test("deleting both default files keeps the library empty when revisiting it and the board", () => {
  const data = new Map();
  const library = pageHarness("library", { data });
  library.get("myBooks").children[0].querySelector("button").click();
  library.get("myProblemCollections").children[0].querySelector("button").click();
  assert.deepEqual(books(library).books, []);
  assert.deepEqual(json(library.store.load()), []);
  const afterDeletion = [...data];
  const board = harness({ data });
  assert.equal(board.app.state().root.children.length, 0);
  assert.deepEqual([...data], afterDeletion);
  const revisited = pageHarness("library", { data });
  assert.deepEqual(books(revisited).books, []);
  assert.deepEqual(json(revisited.store.load()), []);
  assert.equal(revisited.data.get(PROBLEMS), library.data.get(PROBLEMS));
});

if (require.main === module) (async () => {
  for (const { name, check } of tests) {
    await check();
    process.stdout.write(`PASS ${name}\n`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
