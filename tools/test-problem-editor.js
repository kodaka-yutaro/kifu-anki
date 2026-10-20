#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const Shogi = require("../shogi.js");
const lesson = require("../tutorial.js");
const { harness, storedBooks, BOOKS, PROBLEMS, DEFAULTS, json } = require("./test-tutorial.js");

const tests = [];
const test = (name, check) => tests.push({ name, check });

function setup({ empty = false } = {}) {
  const saved = storedBooks("復習に使う棋譜");
  if (empty) saved.books[0].root = Shogi.newNode(null);
  const data = new Map([
    [BOOKS, JSON.stringify(saved)],
    [PROBLEMS, JSON.stringify({ version: 1, collections: [] })],
    [DEFAULTS, JSON.stringify({ version: 1, books: "ready", problemCollections: "ready" })]
  ]);
  const h = harness({ data });
  h.runScript("problems-store.js");
  h.runScript("problem-editor.js");
  h.store = h.window.KifuProblems;
  return h;
}

function atBranch(h) {
  for (let i = 0; i < 5; i++) h.get("btnNext").click();
  assert.equal(h.app.state().depth, 5);
  assert.equal(h.app.state().node.children.length, 2);
}

function open(h, collectionId) {
  h.get("btnCreateProblem").click();
  assert.equal(h.get("problemDialog").open, true, "the creation form opens");
  if (collectionId) h.get("problemDestination").value = collectionId;
}

function submit(h) {
  return h.get("problemForm").dispatch("submit");
}

test("the current position comment is the editable default, and the selected branch is saved to the selected collection", () => {
  const h = setup();
  const first = h.store.createCollection("居飛車");
  const selected = h.store.createCollection("振り飛車");
  atBranch(h);
  h.comment("この局面で飛車をどこに振るか考える。\n次の手に注目。");
  const sourceComment = h.get("comment").value;
  const sourcePosition = json(h.app.state().position);
  const branch = json(h.app.state().node.children[1].move);
  open(h, selected.id);
  assert.equal(h.get("problemExplanation").value, sourceComment);
  assert.notEqual(h.get("problemExplanation").value, h.app.state().node.children[1].comment);
  h.get("problemAnswer").value = "1";
  h.get("problemQuestion").value = "";
  h.get("problemExplanation").value = "三間飛車に振ります。\n元のコメントとは別に編集した解説。";
  submit(h);
  assert.equal(h.get("problemDialog").open, false);
  const collections = json(h.store.load());
  assert.equal(collections.find(c => c.id === first.id).problems.length, 0);
  const problems = collections.find(c => c.id === selected.id).problems;
  assert.equal(problems.length, 1);
  assert.equal(problems[0].question, "", "a blank optional question is valid");
  assert.equal(problems[0].explanation, "三間飛車に振ります。\n元のコメントとは別に編集した解説。");
  assert.deepEqual(problems[0].answer, branch);
  assert.equal(problems[0].choices.length, 2);
  assert.deepEqual(problems[0].position, sourcePosition);
  assert.equal(problems[0].source.ply, 5);
  assert.equal(problems[0].source.title, "復習に使う棋譜");
  assert.equal(h.app.state().node.comment, sourceComment, "editing the problem does not rewrite the kifu comment");
});

test("a saved problem remains intact when its source record is edited and deleted", () => {
  const h = setup();
  const collection = h.store.createCollection("苦手な局面");
  atBranch(h);
  open(h, collection.id);
  h.get("problemAnswer").value = "1";
  h.get("problemQuestion").value = "ここで三間飛車にする手は？";
  submit(h);
  const original = json(h.store.load());
  h.comment("後から変更した棋譜コメント");
  h.get("btnNext").click();
  h.get("btnCut").click();
  h.get("btnDelete").click();
  h.flushTimers();
  assert.deepEqual(json(h.store.load()), original);
  assert.notEqual(h.app.state().root, original[0].problems[0].position);
  assert.equal(h.app.state().depth, 0);
});

test("terminal positions and memorization modes cannot create a problem with no valid source branches", () => {
  const h = setup();
  h.store.createCollection("テスト");
  h.get("btnLast").click();
  assert.equal(h.get("btnCreateProblem").disabled, true);
  h.get("btnCreateProblem").click();
  assert.equal(h.get("problemDialog").open, false);
  h.get("btnFirst").click();
  assert.equal(h.get("btnCreateProblem").disabled, false);
  h.modeButton("sente").click();
  assert.equal(h.window.KifuProblemSource.current(), null);
  h.get("btnCreateProblem").dispatch("click");
  assert.equal(h.get("problemDialog").open, false);
  assert.equal(h.store.load()[0].problems.length, 0);
});

test("the optional tutorial never writes a real problem collection", () => {
  const h = setup();
  h.store.createCollection("通常の問題集");
  const before = h.data.get(h.store.KEY);
  assert.equal(h.app.begin(lesson.title, lesson.fullKif), true);
  assert.equal(h.window.KifuProblemSource.current(), null);
  h.get("btnCreateProblem").dispatch("click");
  assert.equal(h.get("problemDialog").open, false);
  assert.equal(h.data.get(h.store.KEY), before);
  h.app.finish();
  assert.equal(h.get("btnCreateProblem").disabled, false);
});

test("a deleted destination is not silently recreated and entered text is retained", () => {
  const h = setup();
  const collection = h.store.createCollection("削除される保存先");
  atBranch(h);
  open(h, collection.id);
  h.get("problemAnswer").value = "1";
  h.get("problemQuestion").value = "保存前に入力した問題文";
  h.get("problemExplanation").value = "保存前に入力した解説";
  h.store.removeCollection(collection.id);
  submit(h);
  assert.equal(h.get("problemDialog").open, true);
  assert.deepEqual(json(h.store.load()), []);
  assert.ok(h.get("problemEditorError").textContent.length > 0);
  assert.equal(h.get("problemQuestion").value, "保存前に入力した問題文");
  assert.equal(h.get("problemExplanation").value, "保存前に入力した解説");
});

test("a failed save keeps the dialog open and preserves drafts for a successful retry", () => {
  const h = setup();
  const collection = h.store.createCollection("書き込みテスト");
  open(h, collection.id);
  h.get("problemQuestion").value = "あとで保存する問題";
  h.get("problemExplanation").value = "消えてほしくない解説";
  const before = h.data.get(h.store.KEY);
  const syncBefore = h.saves;
  h.blockStorage();
  submit(h);
  assert.equal(h.get("problemDialog").open, true);
  assert.equal(h.data.get(h.store.KEY), before);
  assert.equal(h.saves, syncBefore);
  assert.ok(h.get("problemEditorError").textContent.length > 0);
  assert.equal(h.get("problemQuestion").value, "あとで保存する問題");
  assert.equal(h.get("problemExplanation").value, "消えてほしくない解説");
  h.blockStorage(false);
  submit(h);
  assert.equal(h.get("problemDialog").open, false);
  assert.equal(h.store.load()[0].problems.length, 1);
  assert.equal(h.saves, syncBefore + 1);
});

test("canceling creation changes neither the source kifu nor any problem collection", () => {
  const h = setup();
  h.store.createCollection("キャンセルテスト");
  const before = [...h.data];
  open(h);
  h.get("problemQuestion").value = "保存しない問題文";
  h.get("problemExplanation").value = "保存しない解説";
  h.get("btnCancelProblem").click();
  assert.equal(h.get("problemDialog").open, false);
  assert.deepEqual([...h.data], before);
});

test("an invalid branch index cannot be saved as an answer", () => {
  const h = setup();
  const collection = h.store.createCollection("分岐選択テスト");
  atBranch(h);
  open(h, collection.id);
  h.get("problemAnswer").value = "99";
  submit(h);
  assert.equal(h.get("problemDialog").open, true);
  assert.equal(h.store.load()[0].problems.length, 0);
  assert.ok(h.get("problemEditorError").textContent.length > 0);
});

test("creating a destination inline chooses the new collection without losing the draft", () => {
  const h = setup();
  atBranch(h);
  open(h);
  assert.equal(h.get("btnSaveProblem").disabled, true, "saving is unavailable until a destination exists");
  h.get("problemAnswer").value = "1";
  h.get("problemQuestion").value = "三間飛車の問題";
  h.get("problemExplanation").value = "問題集を作成しても残る解説";
  h.get("btnNewProblemCollection").click();
  h.get("problemNewCollectionName").value = "  振り飛車の問題集  ";
  h.get("btnConfirmNewProblemCollection").click();
  const collection = h.store.load()[0];
  assert.equal(collection.title, "振り飛車の問題集");
  assert.equal(h.get("problemDestination").value, collection.id);
  assert.equal(h.get("btnSaveProblem").disabled, false);
  assert.equal(h.get("problemQuestion").value, "三間飛車の問題");
  assert.equal(h.get("problemExplanation").value, "問題集を作成しても残る解説");
  assert.equal(h.get("problemAnswer").value, "1");
  submit(h);
  assert.equal(h.store.load()[0].problems.length, 1);
});

(async () => {
  for (const { name, check } of tests) {
    await check();
    process.stdout.write(`PASS ${name}\n`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
