const S = Shogi;
const $ = id => document.getElementById(id);
const STORE_KEY = "kifu-anki-books-v1";

let books = [];        // [{ title, root }]
let book = null;
let path = [];         // 根から現在局面までのノード列
let mode = "edit";     // edit | sente | gote | both
let sel = null;        // { from:[f,r] } または { drop:'p' }、targets 付き
let drill = null;      // { done:Set(葉), misses, waiting }
let parentOf = new Map();
let timer = null;
let hint = null;          // 答えボタンで光らせる駒 { from } または { drop }
let revealedNode = null;   // 暗記中にコメントをめくった局面
let commentSaveTimer = null;
let tutorialSession = null;
let importGeneration = 0;
let linkedKifPending = false;
let hasStoredBooks = false;
const arrivedViaKif = new URLSearchParams(location.search).has("kif");

function tutorialAction(type, detail = {}) {
  if (window.KifuTutorial) window.KifuTutorial.onAction(type, detail);
}

const cur = () => path[path.length - 1];
function position() {
  let pos = S.initial();
  for (let i = 1; i < path.length; i++) pos = S.apply(pos, path[i].move);
  return pos;
}
const prevTo = () => cur().move && cur().move.to;

// ---------- 保存 ----------
function save() {
  if (tutorialSession) return false;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ books, current: books.indexOf(book) }));
  } catch (e) { return false; }
  if (window.onKifuSaved) window.onKifuSaved();   // ログイン中ならサーバーにも保存（sync.js）
  return true;
}
function load() {
  hasStoredBooks = false;
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY));
    if (data && Array.isArray(data.books)) {
      hasStoredBooks = !!data.books.length;
      books = data.books.length ? data.books : [{ title: "新しい棋譜", root: S.newNode(null) }];
      book = books[data.current] || books[0];
      return;
    }
  } catch (e) { /* 壊れたデータは無視してサンプルから始める */ }
  books = [window.KifuDefaults.sampleBook()];
  book = books[0];
}

// ---------- ツリー操作 ----------
const isLeaf = n => n.children.length === 0;
function complete(n) {
  return isLeaf(n) ? drill.done.has(n) : n.children.every(complete);
}
function countLeaves(n, pred) {
  if (isLeaf(n)) return pred(n) ? 1 : 0;
  return n.children.reduce((a, c) => a + countLeaves(c, pred), 0);
}
function pathTo(node) {
  const p = [];
  for (let n = node; n; n = parentOf.get(n)) p.unshift(n);
  return p;
}
function mergeTree(dst, src) {
  if (src.comment && !(dst.comment || "").includes(src.comment)) {
    dst.comment = dst.comment ? dst.comment + "\n" + src.comment : src.comment;
  }
  for (const c of src.children) {
    const same = dst.children.find(d => S.moveEq(d.move, c.move));
    if (same) mergeTree(same, c); else dst.children.push(c);
  }
}

// ---------- 描画 ----------
const FULL_PIECE_NAME = { k: "玉将", r: "飛車", b: "角行", g: "金将", s: "銀将", n: "桂馬", l: "香車", p: "歩兵" };
const FULL_PROMOTED_NAME = { r: "龍王", b: "龍馬", s: "成銀", n: "成桂", l: "成香", p: "と" };
function pieceMarkup(piece) {
  const photo = settings.pieces === "photo";
  const name = photo
    ? (piece.pr ? FULL_PROMOTED_NAME[piece.t] : piece.t === "k" && !piece.s ? "王将" : FULL_PIECE_NAME[piece.t])
    : (piece.pr ? S.PRO_CHAR[piece.t] : S.NAME[piece.t]);
  const twoLetter = photo && name.length === 2;
  return `<span class="piece-body${twoLetter ? " two-letter" : ""}" data-piece="${piece.t}" aria-hidden="true"><b class="piece-letter">${twoLetter ? [...name].join("\n") : name}</b></span>`;
}

function userTurn(pos) {
  if (mode === "edit" || mode === "both") return true;
  return (mode === "sente") === pos.turn;
}
function canInput(pos) {
  if (mode === "edit") return true;
  return drill && !drill.waiting && !isLeaf(cur()) && userTurn(pos);
}

// 暗記中は、自分の直前の手から現在までのコメントをまとめて見せる（相手の自動指しで流れないように）
function drillComment() {
  const userMoveAt = i => mode === "both" || (mode === "sente") === (i % 2 === 1);
  let start = path.length - 1;
  while (start > 0 && !userMoveAt(start)) start--;
  let pos = S.initial();
  const parts = [];
  for (let i = 1; i < path.length; i++) {
    if (i >= start && path[i].comment) parts.push({ label: S.label(pos, path[i].move, path[i - 1].move && path[i - 1].move.to), text: path[i].comment });
    pos = S.apply(pos, path[i].move);
  }
  if (path.length === 1 && path[0].comment) return path[0].comment;
  if (parts.length === 1 && path[path.length - 1].comment) return parts[0].text;
  return parts.map(p => `${p.label}：${p.text}`).join("\n");
}

function render() {
  const pos = position();
  renderBoard(pos);
  renderHands(pos);
  renderTree();
  const c = $("comment");
  c.value = mode === "edit" ? cur().comment || "" : drillComment();
  c.readOnly = mode !== "edit";
  c.placeholder = mode === "edit" ? "この局面へのコメント" : "";
  c.classList.toggle("empty", mode !== "edit" && !c.value);
  const covered = mode !== "edit" && settings.hideComments && !!c.value && revealedNode !== cur();
  c.hidden = covered;
  $("commentCover").hidden = !covered;
  if (mode === "edit") {
    $("progress").textContent = `${path.length - 1}手目` + (cur().children.length > 1 ? `　（分岐 ${cur().children.length}）` : "");
  } else if (drill) {
    const total = countLeaves(book.root, () => true);
    const done = countLeaves(book.root, n => drill.done.has(n));
    $("progress").textContent = `変化 ${done} / ${total}　ミス ${drill.misses}`;
  }
  if (window.KifuProblemEditor) window.KifuProblemEditor.refresh();
  tutorialAction("render");
}

function renderBoard(pos) {
  const flip = mode === "gote";
  const el = $("board");
  const focused = document.activeElement;
  const focusSquare = focused && focused.parentElement === el
    ? [focused.dataset.file, focused.dataset.rank] : null;
  el.innerHTML = "";
  const last = cur().move && cur().move.to;
  const targets = sel ? sel.targets : [];
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
    const r = flip ? 9 - i : i + 1;
    const f = flip ? j + 1 : 9 - j;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell";
    cell.dataset.file = f;
    cell.dataset.rank = r;
    const p = pos.sq[f][r];
    cell.setAttribute("aria-label", `${f}${S.KANJI[r]} ${p ? (p.s ? "先手" : "後手") + (p.pr ? S.PRO_CHAR[p.t] : S.NAME[p.t]) : "空きマス"}`);
    if (p) {
      cell.innerHTML = pieceMarkup(p);
      if (p.s === flip) cell.classList.add("rev");
      if (p.pr) cell.classList.add("promoted");
    }
    if (S.sameSq(last, [f, r])) cell.classList.add("last");
    if (sel && sel.from && S.sameSq(sel.from, [f, r])) cell.classList.add("selected");
    if (hint && hint.from && S.sameSq(hint.from, [f, r])) cell.classList.add("hint");
    if (targets.some(t => S.sameSq(t, [f, r]))) cell.classList.add("target");
    cell.onclick = () => onCell(f, r);
    el.appendChild(cell);
    if (focusSquare && +focusSquare[0] === f && +focusSquare[1] === r) cell.focus({ preventScroll: true });
  }
  const nums = flip ? [1,2,3,4,5,6,7,8,9] : [9,8,7,6,5,4,3,2,1];
  $("files").innerHTML = nums.map(n => `<span>${n}</span>`).join("");
  $("ranks").innerHTML = [1,2,3,4,5,6,7,8,9].map(i => `<span>${S.KANJI[flip ? 10 - i : i]}</span>`).join("");
}

function renderHands(pos) {
  const flip = mode === "gote";
  const draw = (el, side) => {
    el.innerHTML = `<span class="hand-label">${side ? "▲先手" : "△後手"}</span>`;
    const hand = pos.hands[side];
    let any = false;
    for (const t of S.HAND_ORDER) {
      if (!hand[t]) continue;
      any = true;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "hand-piece";
      b.setAttribute("aria-label", `${side ? "先手" : "後手"}の持駒 ${S.NAME[t]} ${hand[t]}枚`);
      b.innerHTML = pieceMarkup({ t, s: side, pr: false }) + (hand[t] > 1 ? `<small aria-hidden="true">${hand[t]}</small>` : "");
      if (sel && sel.drop === t && pos.turn === side) b.classList.add("selected");
      if (hint && hint.drop === t && pos.turn === side) b.classList.add("hint");
      b.onclick = () => onHand(side, t);
      el.appendChild(b);
    }
    if (!any) el.insertAdjacentHTML("beforeend", `<span class="hand-none">持駒なし</span>`);
  };
  draw($("handTop"), flip);
  draw($("handBottom"), !flip);
}

// 定跡ツリー：横に手数、縦に変化。最初の子は親と同じ行に置く。
function renderTree() {
  const W = 90, H = 30, BW = 80, BH = 22, PAD = 6;
  parentOf = new Map();
  const items = [];
  let rows = 0;
  const onPath = new Set(path);
  const walk = (node, pos, depth, row, prev) => {
    const lbl = node.move ? S.label(pos, node.move, prev) : "開始";
    items.push({ node, depth, row, lbl });
    const next = node.move ? S.apply(pos, node.move) : pos;
    node.children.forEach((c, i) => {
      parentOf.set(c, node);
      const r = i === 0 ? row : ++rows;
      items.push({ edge: true, from: [depth, row], to: [depth + 1, r] });
      walk(c, next, depth + 1, r, node.move && node.move.to);
    });
  };
  walk(book.root, S.initial(), 0, 0, null);
  const maxDepth = Math.max(...items.filter(it => !it.edge).map(it => it.depth));
  const width = (maxDepth + 1) * W + PAD * 2, height = (rows + 1) * H + PAD * 2;
  const x = d => PAD + d * W, y = r => PAD + r * H;
  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  for (const it of items) if (it.edge) {
    const [d1, r1] = it.from, [d2, r2] = it.to;
    const x1 = x(d1) + BW, y1 = y(r1) + BH / 2, x2 = x(d2), y2 = y(r2) + BH / 2, mx = x2 - (W - BW) / 2;
    svg += r1 === r2
      ? `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="edge"/>`
      : `<path d="M${x1 - BW / 2 + 4} ${y1 + BH / 2} V${y2} H${x2}" class="edge" fill="none"/>`;
  }
  for (const it of items) if (!it.edge) {
    const n = it.node;
    const drilling = mode !== "edit" && drill;
    const done = drilling && n !== book.root && complete(n);
    const show = !drilling || onPath.has(n) || done || n === book.root;
    const cls = ["node"];
    if (n === cur()) cls.push("current");
    else if (onPath.has(n)) cls.push("onpath");
    if (done) cls.push("done");
    if (!show) cls.push("hidden");
    const text = show ? it.lbl : "？";
    svg += `<g class="${cls.join(" ")}" data-i="${items.indexOf(it)}" data-ply="${it.depth}" role="button" tabindex="${drilling ? -1 : 0}" aria-disabled="${!!drilling}" aria-label="${it.depth}手目 ${text}" transform="translate(${x(it.depth)},${y(it.row)})">` +
      `<rect width="${BW}" height="${BH}" rx="5"/>` +
      `<text x="${BW / 2}" y="${BH / 2 + 4}">${text}</text>` +
      (n.comment && show ? `<circle cx="${BW - 4}" cy="4" r="3" class="cmark"/>` : "") + `</g>`;
  }
  svg += "</svg>";
  const tree = $("tree");
  tree.innerHTML = svg;
  tree.querySelectorAll("g.node").forEach(g => {
    g.onclick = () => {
      if (mode !== "edit") return;
      if (tutorialSession && window.KifuTutorial && !window.KifuTutorial.canUseTree()) return;
      path = pathTo(items[+g.dataset.i].node);
      sel = null; render(); setMsg("");
      tutorialAction("tree");
    };
    g.onkeydown = e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); g.onclick(); }
    };
  });
  const curEl = tree.querySelector("g.current");
  if (curEl) {
    const it = items.find(i => i.node === cur());
    const cx = x(it.depth), cy = y(it.row);
    if (cx < tree.scrollLeft || cx + BW > tree.scrollLeft + tree.clientWidth) tree.scrollLeft = cx - tree.clientWidth / 2;
    if (cy < tree.scrollTop || cy + BH > tree.scrollTop + tree.clientHeight) tree.scrollTop = cy - tree.clientHeight / 2;
  }
}

function setMsg(text, cls = "") {
  const m = $("message");
  m.textContent = text;
  m.className = "message " + cls;
}

// ---------- 入力 ----------
function onCell(f, r) {
  const pos = position();
  if (!canInput(pos)) return;
  if (sel && sel.targets.some(t => S.sameSq(t, [f, r]))) {
    const s = sel;
    sel = null;
    if (s.drop) return play({ from: null, to: [f, r], t: s.drop, promote: false }, pos);
    const p = pos.sq[s.from[0]][s.from[1]];
    if (!S.canPromote(p, s.from[1], r)) return play({ from: s.from, to: [f, r], promote: false }, pos);
    if (S.mustPromote(p, r)) return play({ from: s.from, to: [f, r], promote: true }, pos);
    return askPromote().then(yes => play({ from: s.from, to: [f, r], promote: yes }, pos));
  }
  const p = pos.sq[f][r];
  if (p && p.s === pos.turn) {
    sel = S.sameSq(sel && sel.from, [f, r]) ? null : { from: [f, r], targets: S.destinations(pos, f, r) };
  } else sel = null;
  render();
}

function onHand(side, t) {
  const pos = position();
  if (!canInput(pos) || pos.turn !== side) return;
  sel = sel && sel.drop === t ? null : { drop: t, targets: S.dropTargets(pos, t) };
  render();
}

function askPromote() {
  return new Promise(resolve => {
    const d = $("promoteDialog");
    d.returnValue = "";
    d.onclose = () => resolve(d.returnValue === "yes");
    d.showModal();
  });
}

function play(m, pos) {
  if (tutorialSession && window.KifuTutorial && !window.KifuTutorial.canPlay(m)) {
    sel = null;
    render();
    return;
  }
  hint = null;
  const node = cur();
  let child = node.children.find(c => S.moveEq(c.move, m));
  if (mode === "edit") {
    if (!child) { child = S.newNode(m); node.children.push(child); save(); }
    path.push(child);
    setMsg(S.label(pos, m, prevToOf(node)));
    render();
    tutorialAction("play", { move: m });
    return;
  }
  if (!child) {
    drill.misses++;
    setMsg("違います。もう一度。", "ng");
    return render();
  }
  if (complete(child)) {
    setMsg("その変化は覚えました。別の手を指してください。", "ng");
    return render();
  }
  path.push(child);
  setMsg("○ " + S.label(pos, m, prevToOf(node)), "ok");
  advance();
  tutorialAction("play", { move: m });
}
const prevToOf = n => n.move && n.move.to;

// ---------- 暗記 ----------
function startDrill() {
  drill = { done: new Set(), misses: 0, waiting: false };
  if (isLeaf(book.root)) {
    path = [book.root]; render();
    return setMsg("まず「編集」で手順を登録してください。", "ng");
  }
  restartLine();
}

function restartLine() {
  clearTimeout(timer);
  path = [book.root];
  sel = null; hint = null;
  drill.waiting = false;
  $("btnContinue").hidden = true;
  $("btnAnswer").hidden = false;
  setMsg(userTurn(position()) ? "次の一手を指してください。" : "");
  advance();
}

function advance() {
  const node = cur();
  render();
  if (isLeaf(node)) {
    drill.done.add(node);
    render();
    $("btnAnswer").hidden = true;
    if (complete(book.root)) {
      setMsg(`ツリーをすべて覚えました🎉（ミス ${drill.misses}）`, "ok");
      $("btnContinue").textContent = "もう一度 ▶";
    } else {
      setMsg("この変化は完了！", "ok");
      $("btnContinue").textContent = "次の変化へ ▶";
    }
    drill.waiting = true;
    $("btnContinue").hidden = false;
    tutorialAction("drill");
    return;
  }
  const pos = position();
  if (!userTurn(pos)) {
    drill.waiting = true;
    timer = setTimeout(() => {
      drill.waiting = false;
      const open = node.children.filter(c => !complete(c));
      const c = open[Math.floor(Math.random() * open.length)];
      path.push(c);
      const text = S.label(pos, c.move, prevToOf(node));
      const m = $("message");
      setMsg(m.className.includes("ok") ? m.textContent + "　" + text : text);
      advance();
    }, 500);
  }
}

function showAnswer() {
  if (!drill || drill.waiting) return;
  const pos = position();
  if (!userTurn(pos) || isLeaf(cur())) return;
  const c = cur().children.find(n => !complete(n));
  hint = c.move.from ? { from: c.move.from } : { drop: c.move.t };
  setMsg(c.move.from ? "光っている駒を動かします。" : "光っている持ち駒を打ちます。");
  render();
  tutorialAction("answer");
}

// ---------- モード・定跡の切り替え ----------
function setMode(m) {
  clearTimeout(timer);
  mode = m;
  sel = null; hint = null;
  document.querySelectorAll(".modes button").forEach(b => b.classList.toggle("active", b.dataset.mode === m));
  $("editButtons").hidden = m !== "edit";
  $("drillButtons").hidden = m === "edit";
  document.body.classList.toggle("drilling", m !== "edit");
  if (m === "edit") {
    drill = null;
    path = [book.root];
    setMsg("駒を動かして手順を登録できます。");
    render();
  } else startDrill();
  tutorialAction("mode", { mode: m });
}

function refreshBooks() {
  const title = $("currentBookTitle");
  title.textContent = book.title;
  title.title = book.title;
}

function selectBook(b) {
  book = b;
  refreshBooks();
  save();
  setMode(mode);
}

function newBook() {
  const title = prompt("定跡の名前", "新しい定跡");
  if (!title) return;
  const b = { title, root: S.newNode(null) };
  books.push(b);
  selectBook(b);
  if (mode !== "edit") setMode("edit");
}

function exportKIF() {
  const text = S.toKIF(book.title, book.root);
  const blob = new Blob(["﻿" + text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = book.title.replace(/[\\/:*?"<>|]/g, "_") + ".kif";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  tutorialAction("export");
}

function decode(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch (e) { return new TextDecoder("shift_jis").decode(buf); }
}

async function importFiles(files) {
  const importSession = tutorialSession;
  const generation = ++importGeneration;
  const parsed = [];
  for (const file of files) {
    try {
      const text = decode(await file.arrayBuffer());
      const header = text.match(/^(?:表題|棋戦)[：:](.+)$/m);
      const title = (header && header[1].trim()) || file.name.replace(/\.(kifu?|txt)$/i, "");
      parsed.push({ title, root: S.parseKIF(text) });
    } catch (e) {
      alert(`「${file.name}」を読み込めませんでした。\n${e.message}`);
    }
  }
  if (!parsed.length || importSession !== tutorialSession || generation !== importGeneration) return;
  let choice = "new";
  if (isLeaf(book.root)) choice = "fill";
  else {
    $("importText").textContent = parsed.length > 1
      ? `${parsed.length}個のファイルを読み込みます。`
      : `「${parsed[0].title}」を読み込みます。`;
    choice = await new Promise(resolve => {
      const d = $("importDialog");
      d.returnValue = "";
      d.onclose = () => resolve(d.returnValue);
      d.showModal();
      tutorialAction("dialog");
    });
    if (!choice || importSession !== tutorialSession || generation !== importGeneration) return;
  }
  if (choice === "new") {
    parsed.forEach(p => books.push(p));
    book = parsed[0];
  } else {
    if (choice === "fill" && book.title.startsWith("新しい定跡")) book.title = parsed[0].title;
    parsed.forEach(p => mergeTree(book.root, p.root));
  }
  refreshBooks();
  save();
  setMode("edit");
  setMsg("読み込みました。", "ok");
  tutorialAction("import");
}

// ---------- 設定 ----------
const SETTINGS_KEY = "kifu-anki-settings-v1";
let settings = { board: "kaya", pieces: "plain", arrows: true, hideComments: false };
function applySettings() {
  const html = document.documentElement;
  html.dataset.board = settings.board;
  html.dataset.pieces = settings.pieces;
  html.classList.toggle("no-arrows", !settings.arrows);
}
function refreshSettingsControls() {
  const d = $("settingsDialog");
  d.querySelectorAll("input[name=board]").forEach(i => i.checked = i.value === settings.board);
  d.querySelectorAll("input[name=pieces]").forEach(i => i.checked = i.value === settings.pieces);
  $("optArrows").checked = settings.arrows;
  $("optHideComments").checked = settings.hideComments;
}
function initSettings() {
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}); } catch (e) { /* 既定値のまま */ }
  if (settings.board === "dark") settings.board = "felt";
  settings.pieces = ({ mincho: "rounded", kokuryu: "photo" })[settings.pieces] || settings.pieces;
  if (!["kaya", "light", "green", "felt"].includes(settings.board)) settings.board = "kaya";
  if (!["plain", "rounded", "koma", "photo"].includes(settings.pieces)) settings.pieces = "plain";
  applySettings();
  const d = $("settingsDialog");
  refreshSettingsControls();
  d.addEventListener("change", () => {
    settings.board = d.querySelector("input[name=board]:checked").value;
    settings.pieces = d.querySelector("input[name=pieces]:checked").value;
    settings.arrows = $("optArrows").checked;
    settings.hideComments = $("optHideComments").checked;
    if (book) render();
    applySettings();
    if (!tutorialSession) {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* 保存できなくても反映はする */ }
    }
    tutorialAction("settings");
  });
  $("btnSettings").onclick = () => { d.showModal(); tutorialAction("dialog"); };
  d.addEventListener("close", () => tutorialAction("dialog"));
}

// ---------- 初期化 ----------
function init() {
  let initialFileError = "";
  try { window.KifuDefaults.ensure(); }
  catch (e) { initialFileError = e.message; }
  initSettings();
  load();
  refreshBooks();
  $("btnLibrary").addEventListener("click", e => {
    if (tutorialSession || commentSaveTimer === null) return;
    clearTimeout(commentSaveTimer);
    if (save()) { commentSaveTimer = null; return; }
    e.preventDefault();
    setMsg("コメントを保存できませんでした。書き出してからファイル画面へ移動してください。", "ng");
  });
  $("btnNew").onclick = newBook;
  $("btnImport").onclick = () => $("fileInput").click();
  $("fileInput").onchange = e => { importFiles([...e.target.files]); e.target.value = ""; };
  $("btnExport").onclick = exportKIF;
  $("btnRename").onclick = () => {
    const t = prompt("定跡の名前", book.title);
    if (t) { book.title = t; refreshBooks(); save(); }
  };
  $("btnDelete").onclick = () => {
    if (!confirm(`「${book.title}」を削除しますか？`)) return;
    books.splice(books.indexOf(book), 1);
    if (!books.length) books.push({ title: "新しい定跡", root: S.newNode(null) });
    selectBook(books[0]);
  };
  document.querySelectorAll(".modes button").forEach(b => b.onclick = () => setMode(b.dataset.mode));
  const nav = (to, via) => {
    if (mode !== "edit") return;
    path = to; sel = null; render(); setMsg("");
    tutorialAction("navigate", { via });
  };
  const mainLine = () => { const p = path.slice(); while (p[p.length - 1].children.length) p.push(p[p.length - 1].children[0]); return p; };
  $("btnFirst").onclick = () => nav([book.root], "first");
  $("btnPrev").onclick = () => path.length > 1 && nav(path.slice(0, -1), "prev");
  $("btnNext").onclick = () => cur().children.length && nav([...path, cur().children[0]], "next");
  $("btnLast").onclick = () => nav(mainLine(), "last");
  $("btnCut").onclick = () => {
    if (path.length < 2) return;
    const node = cur(), parent = path[path.length - 2];
    if (node.children.length && !confirm("この手以降の変化もすべて削除します。よろしいですか？")) return;
    parent.children.splice(parent.children.indexOf(node), 1);
    save();
    nav(path.slice(0, -1));
  };
  $("btnAnswer").onclick = showAnswer;
  $("btnContinue").onclick = () => complete(book.root) ? startDrill() : restartLine();
  $("commentCover").onclick = () => { revealedNode = cur(); render(); tutorialAction("reveal"); };
  $("comment").oninput = e => {
    if (mode !== "edit") return;
    cur().comment = e.target.value;
    clearTimeout(commentSaveTimer);
    const editingSession = tutorialSession;
    commentSaveTimer = setTimeout(() => {
      commentSaveTimer = null;
      if (editingSession !== tutorialSession) return;
      save(); renderTree(); tutorialAction("render");
    }, 400);
    tutorialAction("comment");
  };
  $("btnHelp").onclick = () => $("helpDialog").showModal();
  document.addEventListener("keydown", e => {
    if (["TEXTAREA", "INPUT", "SELECT", "BUTTON"].includes(e.target.tagName) || document.querySelector("dialog[open]")) return;
    if (e.key === "ArrowLeft") $("btnPrev").click();
    else if (e.key === "ArrowRight") $("btnNext").click();
    else if (e.key === "Enter" && !$("btnContinue").hidden && mode !== "edit") $("btnContinue").click();
  });
  setMode("edit");
  if (initialFileError) setMsg(initialFileError, "ng");
  openLinkedKif();
  // 保存した棋譜をブラウザが勝手に消さないよう、永続化をお願いしておく
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
}

// ログインしてサーバーの棋譜を読み込んだとき（sync.js から呼ばれる）
window.kifuReload = () => {
  if (tutorialSession) { tutorialSession.reloadPending = true; return; }
  load();
  refreshBooks();
  setMode(mode);
};

window.KifuProblemSource = {
  current() {
    if (mode !== "edit" || tutorialSession || !book || !cur()) return null;
    return JSON.parse(JSON.stringify({
      position: position(),
      choices: cur().children.map(child => child.move),
      explanation: cur().comment || "",
      source: { title: book.title, ply: path.length - 1, previousMove: cur().move || null }
    }));
  },
  notice: setMsg
};

// 定跡解説ページの「暗記する」ボタン（?kif=joseki/xxx.kif）から開いたとき
async function openLinkedKif() {
  const params = new URLSearchParams(location.search);
  const file = params.get("kif");
  if (!file || !/^joseki\/[\w-]+\.kif$/.test(file)) return;
  linkedKifPending = true;
  history.replaceState(null, "", location.pathname);
  try {
    const text = decode(await (await fetch(file)).arrayBuffer());
    const header = text.match(/^表題[：:](.+)$/m);
    const title = header ? header[1].trim() : file;
    const root = S.parseKIF(text);
    const existing = books.find(b => b.title === title);
    if (existing) mergeTree(existing.root, root);
    else books.push({ title, root });
    selectBook(existing || books[books.length - 1]);
    setMsg("定跡を読み込みました。上の「暗記」から始められます。", "ok");
  } catch (e) {
    setMsg("定跡を読み込めませんでした。", "ng");
  } finally {
    linkedKifPending = false;
    tutorialAction("ready");
  }
}

// チュートリアルも通常の盤・編集・暗記・KIF処理を使用する。棋譜と設定の保存だけを分離する。
window.KifuTutorialApp = {
  state() {
    return {
      active: !!tutorialSession, mode, depth: path.length - 1, node: cur(), root: book.root,
      path: path.slice(), position: position(), hint, selected: sel,
      done: drill ? countLeaves(book.root, n => drill.done.has(n)) : 0,
      nextMove: (drill ? cur().children.find(n => !complete(n)) : cur().children[0])?.move || null,
      total: countLeaves(book.root, () => true), waiting: !!(drill && drill.waiting),
      settings: { ...settings }, revealed: revealedNode === cur(),
      hasStoredBooks, linkedKifPending, arrivedViaKif
    };
  },
  begin(title, kif) {
    if (tutorialSession || linkedKifPending) return false;
    if (commentSaveTimer !== null) {
      clearTimeout(commentSaveTimer); commentSaveTimer = null; save();
    }
    clearTimeout(timer);
    tutorialSession = { books, book, path: path.slice(), settings: { ...settings }, title, reloadPending: false };
    settings = { ...settings, arrows: true, hideComments: false };
    refreshSettingsControls(); applySettings();
    this.sample(kif);
    document.body.classList.add("in-tutorial");
    return true;
  },
  sample(kif, { depth = 0, alternate = false, comment = null } = {}) {
    if (!tutorialSession) return;
    importGeneration++;
    clearTimeout(timer);
    clearTimeout(commentSaveTimer); commentSaveTimer = null;
    book = { title: tutorialSession.title, root: S.parseKIF(kif) };
    books = [book];
    settings.hideComments = false;
    settings.arrows = true;
    refreshSettingsControls(); applySettings();
    if (comment !== null) {
      let n = book.root;
      while (n.children.length) n = n.children[0];
      n.comment = comment;
    }
    refreshBooks();
    revealedNode = null;
    setMode("edit");
    for (let i = 0; i < depth && cur().children.length; i++) {
      const children = cur().children;
      path.push(alternate && i === depth - 1 ? children[children.length - 1] : children[0]);
    }
    render();
  },
  mode: setMode,
  importSample(kif) {
    if (!tutorialSession) return Promise.resolve();
    return importFiles([new File([kif], "チュートリアル.kif", { type: "text/plain" })]);
  },
  finish(keep = false) {
    if (!tutorialSession) return;
    importGeneration++;
    clearTimeout(timer);
    clearTimeout(commentSaveTimer); commentSaveTimer = null;
    const session = tutorialSession;
    const kept = keep ? JSON.parse(JSON.stringify(book)) : null;
    tutorialSession = null;
    if (session.reloadPending) load();
    else { books = session.books; book = session.book; }
    settings = session.settings;
    refreshSettingsControls(); applySettings();
    let keptSaved = true;
    if (kept) {
      const base = session.title;
      kept.title = base;
      for (let i = 2; books.some(b => b.title === kept.title); i++) kept.title = `${base}（${i}）`;
      books.push(kept); book = kept; keptSaved = save();
    }
    refreshBooks();
    revealedNode = null;
    setMode("edit");
    if (!kept && !session.reloadPending) { path = session.path; render(); }
    document.body.classList.remove("in-tutorial");
    if (kept && !keptSaved) setMsg("このブラウザに保存できませんでした。画面を閉じる前に「書出」でKIFを保存してください。", "ng");
    else setMsg(kept ? "練習用の定跡を保存しました。いつでも暗記を続けられます。" : "元の棋譜に戻りました。チュートリアルはいつでもやり直せます。", "ok");
  }
};
window.addEventListener("storage", e => {
  if (tutorialSession && e.key === STORE_KEY) tutorialSession.reloadPending = true;
});
init();
