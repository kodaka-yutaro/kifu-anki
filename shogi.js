// 将棋の盤面・指し手のルールと KIF 形式の読み書き
const Shogi = (() => {
  const KANJI = "〇一二三四五六七八九";
  const ZEN = "０１２３４５６７８９";
  const NAME = { k:"玉", r:"飛", b:"角", g:"金", s:"銀", n:"桂", l:"香", p:"歩" };
  const PRO_NAME = { r:"龍", b:"馬", s:"成銀", n:"成桂", l:"成香", p:"と" };
  const PRO_CHAR = { r:"龍", b:"馬", s:"全", n:"圭", l:"杏", p:"と" };
  const HAND_ORDER = ["r", "b", "g", "s", "n", "l", "p"];
  const BY_NAME = {
    "歩":["p",false], "香":["l",false], "桂":["n",false], "銀":["s",false], "金":["g",false],
    "角":["b",false], "飛":["r",false], "玉":["k",false], "王":["k",false],
    "と":["p",true], "成香":["l",true], "杏":["l",true], "成桂":["n",true], "圭":["n",true],
    "成銀":["s",true], "全":["s",true], "馬":["b",true], "龍":["r",true], "竜":["r",true]
  };
  const INITIAL = [
    "lnsgkgsnl", ".r.....b.", "ppppppppp", ".........", ".........",
    ".........", "PPPPPPPPP", ".B.....R.", "LNSGKGSNL"
  ];

  // 盤は sq[筋][段]（1〜9）。駒は { t:'p', s:先手か, pr:成りか }。turn は先手番なら true。
  function initial() {
    const sq = Array.from({ length: 10 }, () => Array(10).fill(null));
    INITIAL.forEach((row, i) => [...row].forEach((c, j) => {
      if (c !== ".") sq[9 - j][i + 1] = { t: c.toLowerCase(), s: c === c.toUpperCase(), pr: false };
    }));
    const hand = () => ({ r:0, b:0, g:0, s:0, n:0, l:0, p:0 });
    return { sq, hands: { true: hand(), false: hand() }, turn: true };
  }

  function clone(pos) {
    return {
      sq: pos.sq.map(col => col.slice()),
      hands: { true: { ...pos.hands.true }, false: { ...pos.hands.false } },
      turn: pos.turn
    };
  }

  const inBoard = (f, r) => f >= 1 && f <= 9 && r >= 1 && r <= 9;
  const GOLD = [[0,-1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1]];
  const KING = [[0,-1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[1,1],[-1,1]];
  const ORTH = [[0,-1],[0,1],[1,0],[-1,0]];
  const DIAG = [[1,-1],[-1,-1],[1,1],[-1,1]];

  // [歩むだけの方向, 走る方向]（先手から見て前が段の減る向き）
  function vectors(p) {
    if (p.pr) {
      if (p.t === "r") return [DIAG, ORTH];
      if (p.t === "b") return [ORTH, DIAG];
      return [GOLD, []];
    }
    switch (p.t) {
      case "k": return [KING, []];
      case "g": return [GOLD, []];
      case "s": return [[[0,-1],[1,-1],[-1,-1],[1,1],[-1,1]], []];
      case "n": return [[[1,-2],[-1,-2]], []];
      case "p": return [[[0,-1]], []];
      case "l": return [[], [[0,-1]]];
      case "r": return [[], ORTH];
      case "b": return [[], DIAG];
    }
  }

  function destinations(pos, f, r) {
    const p = pos.sq[f][r];
    if (!p) return [];
    const dir = p.s ? 1 : -1;
    const [steps, slides] = vectors(p);
    const out = [];
    const ok = (tf, tr) => inBoard(tf, tr) && (!pos.sq[tf][tr] || pos.sq[tf][tr].s !== p.s);
    for (const [df, dr] of steps) {
      const tf = f + df, tr = r + dr * dir;
      if (ok(tf, tr)) out.push([tf, tr]);
    }
    for (const [df, dr] of slides) {
      let tf = f + df, tr = r + dr * dir;
      while (inBoard(tf, tr)) {
        const q = pos.sq[tf][tr];
        if (q && q.s === p.s) break;
        out.push([tf, tr]);
        if (q) break;
        tf += df; tr += dr * dir;
      }
    }
    return out;
  }

  function deadSquare(t, sente, r) {
    const rr = sente ? r : 10 - r;
    return ((t === "p" || t === "l") && rr === 1) || (t === "n" && rr <= 2);
  }

  function dropTargets(pos, t) {
    const sente = pos.turn, out = [];
    for (let f = 1; f <= 9; f++) {
      if (t === "p" && pos.sq[f].some(q => q && q.t === "p" && !q.pr && q.s === sente)) continue;
      for (let r = 1; r <= 9; r++) {
        if (!pos.sq[f][r] && !deadSquare(t, sente, r)) out.push([f, r]);
      }
    }
    return out;
  }

  const inZone = (sente, r) => sente ? r <= 3 : r >= 7;
  function canPromote(p, fromR, toR) {
    return !p.pr && p.t !== "k" && p.t !== "g" && (inZone(p.s, fromR) || inZone(p.s, toR));
  }
  const mustPromote = (p, toR) => deadSquare(p.t, p.s, toR);

  // m = { from:[f,r] | null, to:[f,r], t:持ち駒を打つときの駒, promote:bool }
  function apply(pos, m) {
    const next = clone(pos);
    const [tf, tr] = m.to;
    if (m.from) {
      const [ff, fr] = m.from;
      const p = next.sq[ff][fr];
      const cap = next.sq[tf][tr];
      if (cap) next.hands[p.s][cap.t]++;
      next.sq[ff][fr] = null;
      next.sq[tf][tr] = { ...p, pr: p.pr || !!m.promote };
    } else {
      next.hands[pos.turn][m.t]--;
      next.sq[tf][tr] = { t: m.t, s: pos.turn, pr: false };
    }
    next.turn = !pos.turn;
    return next;
  }

  const sameSq = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
  function moveEq(a, b) {
    if (!sameSq(a.to, b.to)) return false;
    if (!a.from || !b.from) return !a.from && !b.from && a.t === b.t;
    return sameSq(a.from, b.from) && !!a.promote === !!b.promote;
  }

  // 「７六歩」「同　銀」「２二角成」「５五角打」の形（手番記号・移動元なし）
  function moveText(pos, m, prevTo) {
    const dest = sameSq(m.to, prevTo) ? "同　" : ZEN[m.to[0]] + KANJI[m.to[1]];
    if (!m.from) return dest + NAME[m.t] + "打";
    const p = pos.sq[m.from[0]][m.from[1]];
    let s = dest + (p.pr ? PRO_NAME[p.t] : NAME[p.t]);
    if (m.promote) s += "成";
    else if (canPromote(p, m.from[1], m.to[1])) s += "不成";
    return s;
  }
  const label = (pos, m, prevTo) => (pos.turn ? "▲" : "△") + moveText(pos, m, prevTo).replace("同　", "同");

  const digit = c => { const z = ZEN.indexOf(c); return z >= 0 ? z : (/[0-9]/.test(c) ? +c : -1); };

  function parseMove(text, pos, prevTo) {
    let rest = text.replace(/[\s　]/g, "");
    let to;
    if (rest[0] === "同") {
      if (!prevTo) throw new Error("「同」の前の手がありません");
      to = prevTo; rest = rest.slice(1);
    } else {
      const f = digit(rest[0]);
      let r = KANJI.indexOf(rest[1]);
      if (r < 1) r = digit(rest[1]);
      if (f < 1 || r < 1) throw new Error("移動先が読めません");
      to = [f, r]; rest = rest.slice(2);
    }
    let from = null;
    const fm = rest.match(/\((\d)(\d)\)$/);
    if (fm) { from = [+fm[1], +fm[2]]; rest = rest.slice(0, fm.index); }
    let drop = false, promote = false;
    if (rest.endsWith("打")) { drop = true; rest = rest.slice(0, -1); }
    else if (rest.endsWith("不成")) rest = rest.slice(0, -2);
    else if (rest.length >= 2 && rest.endsWith("成") && BY_NAME[rest.slice(0, -1)]) { promote = true; rest = rest.slice(0, -1); }
    const info = BY_NAME[rest];
    if (!info) throw new Error("駒の名前が読めません");
    if (drop || !from) {
      if (pos.hands[pos.turn][info[0]] < 1 || pos.sq[to[0]][to[1]]) throw new Error("その駒は打てません");
      return { from: null, to, t: info[0], promote: false };
    }
    const p = pos.sq[from[0]][from[1]];
    if (!p || p.s !== pos.turn) throw new Error("移動元に手番の駒がありません");
    if (!destinations(pos, ...from).some(d => sameSq(d, to))) throw new Error("その駒はそこへ動けません");
    return { from, to, promote };
  }

  const newNode = move => ({ move, comment: "", children: [] });

  function addComment(node, text) {
    node.comment = node.comment ? node.comment + "\n" + text : text;
  }

  // KIF テキスト → 定石ツリー（根ノード）
  function parseKIF(text) {
    const root = newNode(null);
    const line = [root];
    const positions = [initial()];
    let last = root;
    const lines = text.replace(/^﻿/, "").split(/\r?\n/);
    lines.forEach((raw, i) => {
      const s = raw.replace(/^[\s　]+/, "").replace(/\s+$/, "");
      if (!s || s.startsWith("#") || s.startsWith("&")) return;
      if (s.startsWith("*")) { addComment(last, s.replace(/^\*/, "")); return; }
      let m = s.match(/^手合割[：:](.*)$/);
      if (m) {
        if (!/平手/.test(m[1])) throw new Error(`平手以外の棋譜には対応していません（${i + 1}行目）`);
        return;
      }
      m = s.match(/^変化[：:]\s*(\d+)手/);
      if (m) {
        const n = +m[1];
        if (!line[n - 1]) throw new Error(`変化の分岐元が見つかりません（${i + 1}行目）`);
        line.length = n; positions.length = n;
        last = line[n - 1];
        return;
      }
      m = s.match(/^(\d+)[\s　]+(.+)$/);
      if (!m) return;
      const ply = +m[1];
      const body = m[2].replace(/[\s　]*\(\s*\d+:\d+\s*\/\s*[\d:]*\s*\)[\s+]*$/, "").replace(/\+$/, "").trim();
      if (/^(投了|中断|千日手|詰み|不詰|持将棋|切れ負け|反則|入玉|不戦|封じ手)/.test(body)) return;
      const parent = line[ply - 1];
      if (!parent || line.length !== ply) {
        if (!parent) throw new Error(`${ply}手目の前の手がありません（${i + 1}行目）`);
        line.length = ply; positions.length = ply;
      }
      let mv;
      try { mv = parseMove(body, positions[ply - 1], parent.move && parent.move.to); }
      catch (e) { throw new Error(`${e.message}（${i + 1}行目「${body}」）`); }
      let child = parent.children.find(c => moveEq(c.move, mv));
      if (!child) { child = newNode(mv); parent.children.push(child); }
      line[ply] = child;
      positions[ply] = apply(positions[ply - 1], mv);
      last = child;
    });
    return root;
  }

  // 定石ツリー → KIF テキスト（最初の子を本譜、残りを変化として書き出す）
  function toKIF(title, root) {
    const out = ["#KIF version=2.0 encoding=UTF-8", "# ---- 棋譜暗記道場 で作成 ----"];
    if (title) out.push("表題：" + title);
    out.push("手合割：平手", "先手：", "後手：", "手数----指手---------消費時間--");
    const comment = node => {
      if (node.comment) node.comment.split("\n").forEach(l => out.push("*" + l));
    };
    const moveLine = (ply, node, pos, prevTo) => {
      const m = node.move;
      const from = m.from ? `(${m.from[0]}${m.from[1]})` : "";
      const body = moveText(pos, m, prevTo) + from;
      const pad = Math.max(1, 14 - [...body].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 2 : 1), 0));
      out.push(String(ply).padStart(4) + " " + body + " ".repeat(pad) + "( 0:00/00:00:00)");
      comment(node);
    };
    const writeLine = (start, pos, ply) => {
      const branches = [];
      let node = start, p = pos;
      while (node.children.length) {
        const [first, ...alts] = node.children;
        if (alts.length) branches.push({ parent: node, pos: p, ply: ply + 1, alts });
        moveLine(ply + 1, first, p, node.move && node.move.to);
        p = apply(p, first.move); ply++; node = first;
      }
      for (const b of branches.reverse()) {
        for (const alt of b.alts) {
          out.push("", `変化：${b.ply}手`);
          moveLine(b.ply, alt, b.pos, b.parent.move && b.parent.move.to);
          writeLine(alt, apply(b.pos, alt.move), b.ply);
        }
      }
    };
    comment(root);
    writeLine(root, initial(), 0);
    return out.join("\r\n") + "\r\n";
  }

  return {
    NAME, PRO_CHAR, HAND_ORDER, KANJI, initial, apply, destinations, dropTargets,
    canPromote, mustPromote, moveEq, label, moveText, parseKIF, toKIF, newNode, sameSq
  };
})();
if (typeof module !== "undefined") module.exports = Shogi;
