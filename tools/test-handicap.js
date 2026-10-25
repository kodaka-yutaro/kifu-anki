#!/usr/bin/env node
"use strict";

// Run with: node tools/test-handicap.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../shogi.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`PASS ${name}`);
}
const count = pos => {
  let sente = 0, gote = 0;
  for (let f = 1; f <= 9; f++) for (let r = 1; r <= 9; r++) {
    const p = pos.sq[f][r];
    if (p) (p.s ? sente++ : gote++);
  }
  return { sente, gote };
};

test("every handicap starts with the right number of pieces and the right side to move", () => {
  const expectedGote = {
    "平手": 20, "香落ち": 19, "右香落ち": 19, "両香落ち": 18, "角落ち": 19, "飛車落ち": 19,
    "飛香落ち": 18, "飛両香落ち": 17, "二枚落ち": 18, "三枚落ち": 17, "四枚落ち": 16,
    "五枚落ち": 15, "六枚落ち": 14, "七枚落ち": 13, "八枚落ち": 12, "九枚落ち": 11, "十枚落ち": 10
  };
  assert.deepEqual(Object.keys(expectedGote), S.HANDICAPS);
  for (const name of S.HANDICAPS) {
    const pos = S.initial(name);
    assert.deepEqual(count(pos), { sente: 20, gote: expectedGote[name] }, name);
    assert.equal(pos.turn, name === "平手", `${name}: 駒落ちは上手（後手）から指し始める`);
  }
});

test("the dropped pieces are the standard ones", () => {
  assert.equal(S.initial("香落ち").sq[1][1], null, "香落ちは上手の左香（1一）");
  assert.ok(S.initial("香落ち").sq[9][1], "右香は残る");
  assert.equal(S.initial("右香落ち").sq[9][1], null);
  assert.equal(S.initial("角落ち").sq[2][2], null, "角は2二");
  assert.equal(S.initial("飛車落ち").sq[8][2], null, "飛車は8二");
  const six = S.initial("六枚落ち");
  for (const [f, r] of [[8, 2], [2, 2], [1, 1], [9, 1], [2, 1], [8, 1]]) assert.equal(six.sq[f][r], null, `六枚落ち ${f}${r}`);
  assert.ok(six.sq[7][1] && six.sq[3][1], "六枚落ちでは銀は残る");
  const ten = S.initial("十枚落ち");
  assert.ok(ten.sq[5][1] && ten.sq[5][1].t === "k", "十枚落ちでも玉は残る");
  assert.equal(count(ten).gote, 10, "十枚落ちの上手は玉と歩9枚");
});

test("a real handicap KIF parses (first move is the uwate's) and round-trips", () => {
  const kif = "手合割：二枚落ち\n手数----指手---------消費時間--\n1 ６二銀(71)\n2 ７六歩(77)\n3 ５四歩(53)\n";
  const root = S.parseKIF(kif);
  assert.equal(root.handicap, "二枚落ち");
  const out = S.toKIF("二枚落ちの定跡", root);
  assert.match(out, /手合割：二枚落ち/);
  const again = S.parseKIF(out);
  assert.equal(again.handicap, "二枚落ち");
  assert.equal(again.children[0].move.from.join(","), "7,1");
});

test("hirate KIF keeps the old shape (no handicap property) and still parses", () => {
  const root = S.parseKIF("手合割：平手\n手数----指手---------消費時間--\n1 ７六歩(77)\n");
  assert.equal(root.handicap, undefined);
  assert.equal(S.handicapOf(root), "平手");
  assert.match(S.toKIF("平手の定跡", root), /手合割：平手/);
  assert.equal(S.parseKIF("手数----指手---------消費時間--\n1 ７六歩(77)\n").handicap, undefined);
});

test("an unknown handicap is rejected instead of silently read as hirate", () => {
  assert.throws(() => S.parseKIF("手合割：裸玉\n手数----指手---------消費時間--\n"), /対応していない手合割/);
  assert.throws(() => S.initial("裸玉"), /対応していない手合割/);
  assert.equal(S.normalizeHandicap("飛落ち"), "飛車落ち", "略称も受け付ける");
});

test("new roots carry the handicap and the HTML selectors offer exactly the supported list", () => {
  assert.equal(S.newRoot("二枚落ち").handicap, "二枚落ち");
  assert.equal(S.newRoot().handicap, undefined);
  for (const file of ["index.html", "library.html"]) {
    const html = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const values = [...html.matchAll(/<option value="([^"]+)">/g)].map(m => m[1]).filter(v => S.HANDICAPS.includes(v));
    assert.deepEqual(values, S.HANDICAPS, `${file} の手合割の選択肢`);
  }
});

console.log(`${passed} handicap checks passed.`);
