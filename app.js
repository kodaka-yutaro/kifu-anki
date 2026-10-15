const INITIAL = [
  "l n s g k g s n l",
  ". r . . . . . b .",
  "p p p p p p p p p",
  ". . . . . . . . .",
  ". . . . . . . . .",
  ". . . . . . . . .",
  "P P P P P P P P P",
  ". B . . . . . R .",
  "L N S G K G S N L"
];
const NAMES = { k:"玉", r:"飛", b:"角", g:"金", s:"銀", n:"桂", l:"香", p:"歩" };
const PROMOTED = { r:"龍", b:"馬", s:"全", n:"圭", l:"杏", p:"と" };

let kifu, step = 0, mode = "quiz", selected = null, board, hands;
const $ = id => document.getElementById(id);

// board[段-1][9-筋] = { t:'p', sente:true, promoted:false } | null
function buildPosition(n) {
  board = INITIAL.map(row => row.split(" ").map(c => c === "." ? null :
    { t:c.toLowerCase(), sente:c === c.toUpperCase(), promoted:false }));
  hands = { sente:[], gote:[] };
  for (let i = 0; i < n; i++) applyMove(kifu.moves[i]);
}
const at = (f, r) => board[r - 1][9 - f];
const put = (f, r, p) => { board[r - 1][9 - f] = p; };

function applyMove(m) {
  const p = at(...m.from);
  const cap = at(...m.to);
  if (cap) (p.sente ? hands.sente : hands.gote).push(cap.t);
  put(...m.from, null);
  put(...m.to, { ...p, promoted: p.promoted || !!m.promote });
}

function render() {
  buildPosition(step);
  const el = $("board");
  el.innerHTML = "";
  const last = step > 0 ? kifu.moves[step - 1].to : null;
  for (let r = 1; r <= 9; r++) for (let f = 9; f >= 1; f--) {
    const c = document.createElement("div");
    c.className = "cell";
    const p = at(f, r);
    if (p) {
      c.innerHTML = `<span>${p.promoted ? PROMOTED[p.t] : NAMES[p.t]}</span>`;
      if (!p.sente) c.classList.add("gote");
      if (p.promoted) c.classList.add("promoted");
    }
    if (last && last[0] === f && last[1] === r) c.classList.add("last");
    if (selected && selected[0] === f && selected[1] === r) c.classList.add("selected");
    c.onclick = () => onCell(f, r);
    c.dataset.pos = f + "-" + r;
    el.appendChild(c);
  }
  const handText = arr => arr.map(t => NAMES[t]).join("") || "なし";
  $("handSente").textContent = "▲先手の持駒：" + handText(hands.sente);
  $("handGote").textContent = "△後手の持駒：" + handText(hands.gote);
  $("progress").textContent = `${step} / ${kifu.moves.length} 手`;
  const list = $("moveList");
  list.innerHTML = "";
  kifu.moves.forEach((m, i) => {
    const li = document.createElement("li");
    const hidden = mode === "quiz" && i >= step;
    li.textContent = hidden ? "？？？" : m.label;
    if (i === step - 1) li.classList.add("current");
    list.appendChild(li);
  });
}

function setMsg(text, cls = "") { const m = $("message"); m.textContent = text; m.className = "message " + cls; }

function onCell(f, r) {
  if (mode !== "quiz" || step >= kifu.moves.length) return;
  const m = kifu.moves[step];
  const p = at(f, r);
  const senteTurn = step % 2 === 0;
  if (!selected) {
    if (p && p.sente === senteTurn) { selected = [f, r]; render(); }
    else setMsg(senteTurn ? "先手（▲）の駒を選んでください" : "後手（△）の駒を選んでください", "ng");
    return;
  }
  if (p && p.sente === senteTurn) { selected = [f, r]; render(); return; }
  const ok = selected[0] === m.from[0] && selected[1] === m.from[1] && f === m.to[0] && r === m.to[1];
  selected = null;
  if (ok) {
    step++;
    render();
    setMsg(step >= kifu.moves.length ? `正解！ ${m.label}　全問クリア🎉` : `正解！ ${m.label}`, "ok");
  } else {
    render();
    setMsg("違います。もう一度考えてみましょう。", "ng");
  }
}

function go(delta) {
  step = Math.max(0, Math.min(kifu.moves.length, step + delta));
  selected = null;
  render();
  setMsg(step > 0 ? kifu.moves[step - 1].label : "初期局面");
}

function setMode(m) {
  mode = m;
  $("modeQuiz").classList.toggle("active", m === "quiz");
  $("modeReplay").classList.toggle("active", m === "replay");
  $("btnHint").hidden = $("btnAnswer").hidden = m !== "quiz";
  selected = null;
  render();
  setMsg(m === "quiz" ? "駒をクリックし、移動先をクリックして次の一手を指してください。" : "「進む」「戻る」で棋譜を確認できます。");
}

function init() {
  const sel = $("kifuSelect");
  KIFU_LIST.forEach((k, i) => sel.add(new Option(k.title, i)));
  sel.onchange = () => { kifu = KIFU_LIST[sel.value]; step = 0; setMode(mode); };
  kifu = KIFU_LIST[0];
  $("modeQuiz").onclick = () => setMode("quiz");
  $("modeReplay").onclick = () => setMode("replay");
  $("btnPrev").onclick = () => go(-1);
  $("btnNext").onclick = () => go(1);
  $("btnReset").onclick = () => { step = 0; setMode(mode); };
  $("btnHint").onclick = () => {
    if (step >= kifu.moves.length) return;
    const [f, r] = kifu.moves[step].from;
    document.querySelector(`[data-pos="${f}-${r}"]`).classList.add("hint");
    setMsg("青枠の駒を動かします");
  };
  $("btnAnswer").onclick = () => {
    if (step >= kifu.moves.length) return;
    const m = kifu.moves[step];
    step++; selected = null; render();
    setMsg("答え：" + m.label);
  };
  setMode("quiz");
}
init();
