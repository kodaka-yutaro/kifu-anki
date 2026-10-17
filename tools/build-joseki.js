// 定跡解説ページ（joseki/*.html, *.kif, index.html）と sitemap.xml を生成する。
// 使い方: node tools/build-joseki.js
const fs = require("fs");
const path = require("path");
const S = require("../shogi.js");
const ARTICLES = require("./joseki-data.js");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "joseki");
const SITE = "https://kifu.kdking-tools.com/";
const TODAY = new Date().toISOString().slice(0, 10);
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 本譜（最初の子をたどる）と変化を、表示用のラベル付きで集める
function analyze(root) {
  const main = [], variations = [];
  const follow = (node, pos, ply, out) => {
    while (node.children.length) {
      const [first, ...alts] = node.children;
      for (const alt of alts) {
        const seq = [];
        seq.push({ ply: ply + 1, label: S.label(pos, alt.move, node.move && node.move.to), comment: alt.comment });
        follow(alt, S.apply(pos, alt.move), ply + 1, seq);
        variations.push({ from: ply + 1, moves: seq });
      }
      out.push({ ply: ply + 1, label: S.label(pos, first.move, node.move && node.move.to), comment: first.comment });
      pos = S.apply(pos, first.move); node = first; ply++;
    }
    return pos;
  };
  const finalPos = follow(root, S.initial(), 0, main);
  variations.sort((a, b) => a.from - b.from);
  return { main, variations, finalPos };
}

function boardHTML(pos) {
  let cells = "";
  for (let r = 1; r <= 9; r++) for (let f = 9; f >= 1; f--) {
    const p = pos.sq[f][r];
    const cls = ["cell"];
    if (p && !p.s) cls.push("rev");
    if (p && p.pr) cls.push("promoted");
    cells += `<div class="${cls.join(" ")}">${p ? `<span>${p.pr ? S.PRO_CHAR[p.t] : S.NAME[p.t]}</span>` : ""}</div>`;
  }
  const hand = side => S.HAND_ORDER.filter(t => pos.hands[side][t])
    .map(t => S.NAME[t] + (pos.hands[side][t] > 1 ? pos.hands[side][t] : "")).join(" ") || "なし";
  return `<figure class="static-board">
<p class="static-hand">△後手の持駒：${hand(false)}</p>
<div class="board">${cells}</div>
<p class="static-hand">▲先手の持駒：${hand(true)}</p>
</figure>`;
}

const page = ({ title, description, canonical, body, jsonld }) => `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="棋譜暗記道場">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>\n` : ""}<link rel="stylesheet" href="../style.css">
</head>
<body>
<header class="site-header"><p class="site-name"><a href="../index.html">棋譜暗記道場</a></p></header>
<main class="article">
${body}
</main>
<div class="ad-slot" aria-label="広告">広告枠（準備中）</div>
<footer class="site-footer">
  <a href="../index.html">定跡暗記ツール</a> ・ <a href="index.html">定跡解説の一覧</a> ・ <a href="../about.html">運営者情報・お問い合わせ</a> ・ <a href="../privacy.html">プライバシーポリシー</a>
</footer>
</body>
</html>
`;

fs.mkdirSync(OUT, { recursive: true });
const others = a => ARTICLES.filter(b => b !== a)
  .map(b => `<li><a href="${b.slug}.html">${esc(b.title)}</a></li>`).join("\n");

for (const a of ARTICLES) {
  const root = S.parseKIF(a.kif);
  const { main, variations, finalPos } = analyze(root);
  const kifName = `${a.slug}.kif`;
  fs.writeFileSync(path.join(OUT, kifName), "﻿" + S.toKIF(a.title, root));
  const url = `${SITE}joseki/${a.slug}.html`;
  const moveItem = m => `<li><span class="mv">${m.ply}. ${esc(m.label)}</span>${m.comment ? `<span class="mv-note">${esc(m.comment)}</span>` : ""}</li>`;
  const body = `<nav class="crumbs"><a href="../index.html">トップ</a> › <a href="index.html">定跡解説</a> › ${esc(a.short)}</nav>
<article>
<h1>${esc(a.title)}</h1>
<p class="lead">${esc(a.lead)}</p>
${root.comment ? `<p>${esc(root.comment)}</p>` : ""}
<p class="cta"><a class="button primary" href="../index.html?kif=joseki/${kifName}">この定跡を盤で指して暗記する ▶</a></p>
<h2>手順</h2>
<ol class="moves">
${main.map(moveItem).join("\n")}
</ol>
${variations.length ? `<h2>変化</h2>
${variations.map(v => `<h3>${v.from}手目の変化</h3>
<ol class="moves">
${v.moves.map(moveItem).join("\n")}
</ol>`).join("\n")}` : ""}
<h2>完成図</h2>
${boardHTML(finalPos)}
<h2>覚えるポイント</h2>
<ul>
${a.points.map(p => `<li>${esc(p)}</li>`).join("\n")}
</ul>
<p class="cta"><a class="button primary" href="../index.html?kif=joseki/${kifName}">この定跡を暗記する ▶</a> <a class="button" href="${kifName}" download>KIFファイルをダウンロード</a></p>
</article>
<section class="related">
<h2>ほかの定跡</h2>
<ul>
${others(a)}
</ul>
</section>`;
  fs.writeFileSync(path.join(OUT, `${a.slug}.html`), page({
    title: `${a.title}｜手順と覚え方 - 棋譜暗記道場`,
    description: a.description,
    canonical: url,
    body,
    jsonld: { "@context": "https://schema.org", "@type": "Article", headline: a.title, description: a.description,
      inLanguage: "ja", datePublished: "2026-10-15", dateModified: TODAY, url,
      author: { "@type": "Person", name: "kdking" }, publisher: { "@type": "Organization", name: "棋譜暗記道場" } }
  }));
}

fs.writeFileSync(path.join(OUT, "index.html"), page({
  title: "将棋の定跡解説一覧｜手順を盤で覚える - 棋譜暗記道場",
  description: "矢倉・角換わり・横歩取り・相掛かり・四間飛車・中飛車・三間飛車・美濃囲いなど、将棋の基本定跡を手順つきで解説。各定跡は盤上で指して暗記できます。",
  canonical: `${SITE}joseki/`,
  body: `<nav class="crumbs"><a href="../index.html">トップ</a> › 定跡解説</nav>
<h1>将棋の定跡解説</h1>
<p class="lead">代表的な戦型の基本手順を、一手ずつのコメントつきで解説しています。各ページの「暗記する」ボタンから、そのまま盤上で指して覚えられます。</p>
<ul class="article-list">
${ARTICLES.map(a => `<li><a href="${a.slug}.html"><b>${esc(a.title)}</b><span>${esc(a.description)}</span></a></li>`).join("\n")}
</ul>`
}));

const urls = ["", "joseki/", ...ARTICLES.map(a => `joseki/${a.slug}.html`), "about.html", "privacy.html"];
fs.writeFileSync(path.join(ROOT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${SITE}${u}</loc><lastmod>${TODAY}</lastmod></url>`).join("\n")}
</urlset>
`);
console.log(`generated ${ARTICLES.length} articles`);
