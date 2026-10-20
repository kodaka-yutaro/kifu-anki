// 棋譜一覧ページ：保存した棋譜（localStorage）と定跡の棋譜を一覧にして選ぶ
const $ = id => document.getElementById(id);
const STORE_KEY = "kifu-anki-books-v1";

function loadData() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY));
    if (data && Array.isArray(data.books)) return data;
  } catch (e) { /* 壊れたデータは空として扱う */ }
  return { books: [], current: 0 };
}
function saveData(data) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
  catch (e) { alert("保存できませんでした。ブラウザの設定を確認してください。"); }
  if (window.onKifuSaved) window.onKifuSaved();   // ログイン中ならサーバーにも保存（sync.js）
}

// 本線の手数と変化（末端）の数
function stats(root) {
  let leaves = 0, depth = 0;
  const walk = (n, d) => {
    if (!n.children.length) { leaves++; depth = Math.max(depth, d); return; }
    n.children.forEach(c => walk(c, d + 1));
  };
  walk(root, 0);
  return { depth, leaves };
}

function item({ title, sub, href, onOpen, onDelete }) {
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.href = href || "#";
  a.innerHTML = "<b></b><span></span>";
  a.querySelector("b").textContent = title;
  a.querySelector("span").textContent = sub;
  if (onOpen) a.onclick = e => { e.preventDefault(); onOpen(); };
  li.appendChild(a);
  if (onDelete) {
    const del = document.createElement("button");
    del.className = "icon";
    del.title = "削除";
    del.setAttribute("aria-label", `「${title}」を削除`);
    del.textContent = "🗑";
    del.onclick = onDelete;
    li.appendChild(del);
  }
  return li;
}

function renderMine() {
  const data = loadData();
  const ul = $("myBooks");
  ul.innerHTML = "";
  if (!data.books.length) {
    ul.innerHTML = '<li class="empty">まだ棋譜がありません。下の定跡から選ぶか、<a href="index.html">暗記ツール</a>の「読込」でKIFファイルを読み込んでください。</li>';
    return;
  }
  data.books.forEach((b, i) => {
    const { depth, leaves } = stats(b.root);
    ul.appendChild(item({
      title: b.title,
      sub: depth ? `${depth}手・変化${leaves}通り` : "まだ手がありません",
      onOpen: () => { data.current = i; saveData(data); location.href = "index.html"; },
      onDelete: () => {
        if (!confirm(`「${b.title}」を削除しますか？`)) return;
        data.books.splice(i, 1);
        data.current = 0;
        saveData(data);
        renderMine();
      }
    }));
  });
}

async function renderJoseki() {
  const ul = $("josekiList");
  try {
    const list = await (await fetch("joseki/list.json")).json();
    list.forEach(j => ul.appendChild(item({
      title: j.title,
      sub: j.short,
      href: `index.html?kif=joseki/${j.slug}.kif`
    })));
  } catch (e) {
    ul.innerHTML = '<li class="empty">定跡の一覧を読み込めませんでした。<a href="joseki/">定跡解説</a>から選んでください。</li>';
  }
}

function backup() {
  const data = loadData();
  const blob = new Blob([JSON.stringify({ app: "kifu-anki", version: 1, books: data.books })], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `棋譜暗記道場_バックアップ_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function restore(file) {
  let books;
  try {
    const json = JSON.parse(await file.text());
    books = json.books;
    if (!Array.isArray(books) || !books.every(b => b && typeof b.title === "string" && b.root && Array.isArray(b.root.children))) throw new Error();
  } catch (e) {
    alert("棋譜暗記道場のバックアップファイルではないようです。");
    return;
  }
  const data = loadData();
  // 同じ名前の棋譜は上書きせず、変化を合流させる
  let added = 0, merged = 0;
  for (const b of books) {
    const same = data.books.find(x => x.title === b.title);
    if (same) { mergeTree(same.root, b.root); merged++; }
    else { data.books.push(b); added++; }
  }
  saveData(data);
  renderMine();
  alert(`${added}件を追加${merged ? `、${merged}件に変化を合流` : ""}しました。`);
}

function mergeTree(dst, src) {
  if (src.comment && !(dst.comment || "").includes(src.comment)) {
    dst.comment = dst.comment ? dst.comment + "\n" + src.comment : src.comment;
  }
  for (const c of src.children) {
    const same = dst.children.find(d => Shogi.moveEq(d.move, c.move));
    if (same) mergeTree(same, c); else dst.children.push(c);
  }
}

$("btnBackup").onclick = backup;
$("btnRestore").onclick = () => $("restoreInput").click();
$("restoreInput").onchange = e => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ""; };
renderMine();
renderJoseki();
// ログインしてサーバーの棋譜を読み込んだとき（sync.js から呼ばれる）
window.kifuReload = renderMine;
// 保存した棋譜をブラウザが勝手に消さないよう、永続化をお願いしておく
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
