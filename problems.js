const S = Shogi;
const P = KifuProblems;
const $ = id => document.getElementById(id);
const collectionId = new URLSearchParams(location.search).get("id");
const copy = value => JSON.parse(JSON.stringify(value));
let collection = null;
let problemId = null;
let selected = null;
let answered = false;
let shownPosition = null;
let generation = 0;
let promoting = false;
let editing = null;
let reloadPending = false;

const currentProblem = () => collection && collection.problems.find(p => p.id === problemId);
const canAnswer = () => !!currentProblem() && !answered && !promoting;
const FULL_PIECE_NAME = { k: "玉将", r: "飛車", b: "角行", g: "金将", s: "銀将", n: "桂馬", l: "香車", p: "歩兵" };
const FULL_PROMOTED_NAME = { r: "龍王", b: "龍馬", s: "成銀", n: "成桂", l: "成香", p: "と" };

function pieceElement(piece) {
  const photo = document.documentElement.dataset.pieces === "photo";
  const name = photo
    ? (piece.pr ? FULL_PROMOTED_NAME[piece.t] : piece.t === "k" && !piece.s ? "王将" : FULL_PIECE_NAME[piece.t])
    : (piece.pr ? S.PRO_CHAR[piece.t] : S.NAME[piece.t]);
  const twoLetter = photo && name.length === 2;
  const body = document.createElement("span"), letter = document.createElement("b");
  body.className = "piece-body" + (twoLetter ? " two-letter" : "");
  body.dataset.piece = piece.t;
  body.setAttribute("aria-hidden", "true");
  letter.className = "piece-letter";
  letter.textContent = twoLetter ? [...name].join("\n") : name;
  body.appendChild(letter);
  return body;
}

function setStatus(text, error = false) {
  $("collectionStatus").textContent = text;
  $("collectionStatus").className = "message" + (error ? " ng" : " ok");
}

function feedback(text = "", kind = "") {
  $("problemFeedback").textContent = text;
  $("problemFeedback").className = "message " + kind;
}

function resetQuestion() {
  generation++;
  selected = null;
  answered = false;
  promoting = false;
  if ($("problemPromoteDialog").open) $("problemPromoteDialog").close("cancel");
  const p = currentProblem();
  shownPosition = p ? copy(p.position) : null;
  feedback();
}

function reloadCollection() {
  if ($("editProblemDialog").open) { reloadPending = true; return; }
  const before = currentProblem();
  try {
    collection = P.load().find(c => c.id === collectionId) || null;
    if (!currentProblem()) problemId = collection && collection.problems[0] ? collection.problems[0].id : null;
    const after = currentProblem();
    if (!before || !after || JSON.stringify(before) !== JSON.stringify(after)) resetQuestion();
    render();
  } catch (e) {
    collection = null; problemId = null;
    resetQuestion(); render();
    $("problemEmptyText").textContent = "問題集を読み込めませんでした。保存内容を確認してください。";
    setStatus(e.message, true);
  }
}

function chooseProblem(id, focus = true) {
  if (!collection || !collection.problems.some(p => p.id === id)) return;
  problemId = id;
  resetQuestion(); render();
  if (focus) $("problemQuestion").focus();
}

function render() {
  const p = currentProblem();
  $("collectionTitle").textContent = collection ? collection.title : "次の一手問題集";
  document.title = (collection ? collection.title : "次の一手問題集") + " - 棋譜暗記道場";
  $("btnRenameCollection").hidden = !collection;
  $("problemPlayer").hidden = !p;
  $("problemEmpty").hidden = !!p;
  if (!p) {
    $("problemEmptyText").textContent = collection
      ? "まだ問題がありません。棋譜で局面を選び、「この局面の次の一手問題を作る」からこの問題集に追加してください。"
      : "この問題集が見つかりません。ファイル一覧から選び直してください。ログインして保存している場合は、同じアカウントでログインしてください。";
    $("problemAnswerPanel").hidden = true;
    $("problemAnswerLabel").textContent = "";
    $("problemExplanation").textContent = "";
    $("problemBoard").innerHTML = "";
    $("problemList").innerHTML = "";
    return;
  }
  const index = collection.problems.findIndex(x => x.id === p.id);
  $("problemNumber").textContent = `第${index + 1}問 / ${collection.problems.length}問`;
  $("btnPreviousProblem").disabled = index === 0;
  $("btnNextProblem").disabled = index === collection.problems.length - 1;
  $("problemTurn").textContent = p.position.turn ? "▲ 先手番" : "△ 後手番";
  $("problemQuestion").textContent = p.question.trim() ? p.question : "次の一手を指してください。";
  $("problemSource").textContent = `元の棋譜：${p.source.title} ・ ${p.source.ply}手目の局面`;
  $("btnRevealProblem").hidden = answered;
  $("btnRetryProblem").hidden = !answered;
  $("problemAnswerPanel").hidden = !answered;
  $("problemAnswerLabel").textContent = answered ? answerLabel(p, p.answer) : "";
  $("problemExplanation").textContent = answered ? p.explanation : "";
  $("problemExplanation").hidden = !p.explanation;
  $("problemExplanationHeading").hidden = !p.explanation;
  renderBoard();
  renderList();
}

function answerLabel(p, move) {
  return S.label(p.position, move, p.source.previousMove && p.source.previousMove.to);
}

function renderList() {
  const ul = $("problemList");
  ul.innerHTML = "";
  collection.problems.forEach((p, i) => {
    const li = document.createElement("li"), button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-current", String(p.id === problemId));
    const title = document.createElement("b"), question = document.createElement("span");
    title.textContent = `第${i + 1}問`;
    question.textContent = p.question.trim() ? p.question : "次の一手を指してください。";
    button.appendChild(title); button.appendChild(question);
    button.onclick = () => chooseProblem(p.id);
    li.appendChild(button); ul.appendChild(li);
  });
}

function renderBoard() {
  const p = currentProblem(), pos = shownPosition;
  if (!p || !pos) return;
  const flip = !p.position.turn;
  const board = $("problemBoard");
  const focused = document.activeElement;
  const focusSquare = focused && focused.parentElement === board ? [focused.dataset.file, focused.dataset.rank] : null;
  board.innerHTML = "";
  const last = answered ? p.answer.to : p.source.previousMove && p.source.previousMove.to;
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
    const r = flip ? 9 - i : i + 1, f = flip ? j + 1 : 9 - j;
    const cell = document.createElement("button"), piece = pos.sq[f][r];
    cell.type = "button";
    cell.className = "cell";
    cell.dataset.file = f; cell.dataset.rank = r;
    cell.disabled = !canAnswer();
    cell.setAttribute("aria-label", `${f}${S.KANJI[r]} ${piece ? (piece.s ? "先手" : "後手") + (piece.pr ? S.PRO_CHAR[piece.t] : S.NAME[piece.t]) : "空きマス"}`);
    if (piece) {
      cell.appendChild(pieceElement(piece));
      if (piece.s === flip) cell.classList.add("rev");
      if (piece.pr) cell.classList.add("promoted");
    }
    if (S.sameSq(last, [f, r])) cell.classList.add("last");
    if (selected && S.sameSq(selected.from, [f, r])) cell.classList.add("selected");
    if (selected && selected.targets.some(to => S.sameSq(to, [f, r]))) cell.classList.add("target");
    cell.onclick = () => onCell(f, r);
    board.appendChild(cell);
    if (focusSquare && +focusSquare[0] === f && +focusSquare[1] === r && !cell.disabled) cell.focus({ preventScroll: true });
  }
  const drawLabels = (id, labels) => {
    const el = $(id); el.innerHTML = "";
    labels.forEach(label => { const span = document.createElement("span"); span.textContent = label; el.appendChild(span); });
  };
  drawLabels("problemFiles", flip ? [1,2,3,4,5,6,7,8,9] : [9,8,7,6,5,4,3,2,1]);
  drawLabels("problemRanks", [1,2,3,4,5,6,7,8,9].map(r => S.KANJI[flip ? 10 - r : r]));
  renderHand($("problemHandTop"), flip, pos);
  renderHand($("problemHandBottom"), !flip, pos);
}

function renderHand(el, side, pos) {
  el.innerHTML = "";
  const label = document.createElement("span");
  label.className = "hand-label";
  label.textContent = side ? "▲先手" : "△後手";
  el.appendChild(label);
  let any = false;
  S.HAND_ORDER.forEach(t => {
    if (!pos.hands[side][t]) return;
    any = true;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hand-piece";
    button.appendChild(pieceElement({ t, s: side, pr: false }));
    if (pos.hands[side][t] > 1) {
      const count = document.createElement("small");
      count.textContent = pos.hands[side][t];
      count.setAttribute("aria-hidden", "true");
      button.appendChild(count);
    }
    button.setAttribute("aria-label", `${side ? "先手" : "後手"}の持ち駒 ${S.NAME[t]}${pos.hands[side][t]}枚`);
    button.disabled = !canAnswer() || pos.turn !== side;
    if (selected && selected.drop === t && pos.turn === side) button.classList.add("selected");
    button.onclick = () => {
      if (!canAnswer() || pos.turn !== side) return;
      selected = selected && selected.drop === t ? null : { drop: t, targets: S.dropTargets(pos, t) };
      renderBoard();
    };
    el.appendChild(button);
  });
  if (!any) {
    const none = document.createElement("span"); none.className = "hand-none";
    none.textContent = "持駒なし"; el.appendChild(none);
  }
}

function onCell(f, r) {
  if (!canAnswer()) return;
  const p = currentProblem(), pos = p.position;
  if (selected && selected.targets.some(to => S.sameSq(to, [f, r]))) {
    const selection = selected;
    selected = null;
    if (selection.drop) return attempt({ from: null, to: [f, r], t: selection.drop, promote: false });
    const piece = pos.sq[selection.from[0]][selection.from[1]];
    const move = { from: selection.from, to: [f, r], promote: false };
    if (!S.canPromote(piece, selection.from[1], r)) return attempt(move);
    if (S.mustPromote(piece, r)) return attempt({ ...move, promote: true });
    const token = generation;
    promoting = true; renderBoard();
    const dialog = $("problemPromoteDialog");
    dialog.returnValue = "";
    dialog.onclose = () => {
      if (token !== generation) return;
      promoting = false;
      if (dialog.returnValue === "yes" || dialog.returnValue === "no") attempt({ ...move, promote: dialog.returnValue === "yes" });
      else renderBoard();
    };
    dialog.showModal();
    return;
  }
  const piece = pos.sq[f][r];
  selected = piece && piece.s === pos.turn
    ? (selected && S.sameSq(selected.from, [f, r]) ? null : { from: [f, r], targets: S.destinations(pos, f, r) })
    : null;
  renderBoard();
}

function attempt(move) {
  if (!canAnswer()) return;
  const p = currentProblem();
  selected = null;
  if (!S.moveEq(move, p.answer)) {
    feedback("登録された正解手とは違います。もう一度考えてみましょう。", "ng");
    renderBoard();
    return;
  }
  answered = true;
  shownPosition = S.apply(p.position, p.answer);
  feedback("正解です。", "ok");
  render();
}

function revealAnswer() {
  if (!canAnswer()) return;
  const p = currentProblem();
  answered = true; selected = null;
  shownPosition = S.apply(p.position, p.answer);
  feedback("答えと解説を表示しました。");
  render();
}

function openEditor() {
  const p = currentProblem();
  if (!p) return;
  editing = copy(p);
  const select = $("editProblemAnswer");
  select.innerHTML = "";
  editing.choices.forEach((move, index) => {
    const from = move.from ? `（${move.from[0]}${S.KANJI[move.from[1]]}から）` : "";
    const option = new Option(answerLabel(editing, move) + from, index);
    select.add(option);
  });
  select.value = editing.choices.findIndex(move => S.moveEq(move, editing.answer));
  $("editProblemQuestion").value = editing.question;
  $("editProblemExplanation").value = editing.explanation;
  $("editProblemError").textContent = "";
  $("editProblemDialog").showModal();
  select.focus();
}

$("btnPreviousProblem").onclick = () => {
  if (!collection) return;
  const i = collection.problems.findIndex(p => p.id === problemId);
  if (i > 0) chooseProblem(collection.problems[i - 1].id);
};
$("btnNextProblem").onclick = () => {
  if (!collection) return;
  const i = collection.problems.findIndex(p => p.id === problemId);
  if (i >= 0 && i + 1 < collection.problems.length) chooseProblem(collection.problems[i + 1].id);
};
$("btnRevealProblem").onclick = revealAnswer;
$("btnRetryProblem").onclick = () => { resetQuestion(); render(); $("problemQuestion").focus(); };
$("btnEditProblem").onclick = openEditor;
$("btnCancelEditProblem").onclick = () => $("editProblemDialog").close();
$("editProblemDialog").addEventListener("close", () => {
  editing = null;
  if (reloadPending) { reloadPending = false; reloadCollection(); }
});
$("editProblemForm").onsubmit = event => {
  event.preventDefault();
  if (!editing) return;
  try {
    const latest = P.load().find(c => c.id === collectionId)?.problems.find(p => p.id === editing.id);
    if (!latest) throw new Error("この問題は別の画面で削除されました。入力を控えてから閉じてください。");
    if (JSON.stringify(latest) !== JSON.stringify(editing)) throw new Error("この問題は別の画面で変更されました。入力を控えてから閉じ、内容を確認してください。");
    const index = Number($("editProblemAnswer").value);
    if (!Number.isInteger(index) || !editing.choices[index]) throw new Error("正解手を選んでください。");
    P.updateProblem(collectionId, editing.id, {
      answer: editing.choices[index], question: $("editProblemQuestion").value, explanation: $("editProblemExplanation").value
    });
    $("editProblemDialog").close();
    reloadCollection();
    setStatus("問題の変更を保存しました。");
  } catch (e) { $("editProblemError").textContent = e.message; }
};
$("btnDeleteProblem").onclick = () => {
  const p = currentProblem();
  if (!p || !confirm("この問題を問題集から削除しますか？ 元の棋譜は残ります。")) return;
  try { P.removeProblem(collectionId, p.id); reloadCollection(); setStatus("問題を削除しました。"); }
  catch (e) { setStatus(e.message, true); }
};
$("btnRenameCollection").onclick = () => {
  if (!collection) return;
  const title = prompt("問題集の名前", collection.title);
  if (title === null) return;
  try { P.renameCollection(collectionId, title); reloadCollection(); setStatus("問題集の名前を変更しました。"); }
  catch (e) { setStatus(e.message, true); }
};

const SETTINGS_KEY = "kifu-anki-settings-v1";
function applySettings() {
  const settings = { board: "kaya", pieces: "plain" };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}); }
  catch (e) { /* 既定の盤と駒を使用する */ }
  if (settings.board === "dark") settings.board = "felt";
  settings.pieces = ({ mincho: "rounded", kokuryu: "photo" })[settings.pieces] || settings.pieces;
  if (!["kaya", "light", "green", "felt"].includes(settings.board)) settings.board = "kaya";
  if (!["plain", "rounded", "koma", "photo"].includes(settings.pieces)) settings.pieces = "plain";
  document.documentElement.dataset.board = settings.board;
  document.documentElement.dataset.pieces = settings.pieces;
}
applySettings();
window.kifuReload = reloadCollection;
window.addEventListener("storage", e => {
  if (e.key === SETTINGS_KEY || e.key === null) { applySettings(); renderBoard(); }
  if (e.key === P.KEY || e.key === null) reloadCollection();
});
window.addEventListener("kifu-problems-changed", reloadCollection);
reloadCollection();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
