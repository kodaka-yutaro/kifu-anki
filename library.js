// 棋譜と次の一手問題集のファイル一覧
const $ = id => document.getElementById(id);
const STORE_KEY = "kifu-anki-books-v1";
const P = KifuProblems;

function validBooks(books) {
  if (!Array.isArray(books)) return false;
  const square = v => Array.isArray(v) && v.length === 2 && v.every(n => Number.isInteger(n) && n >= 1 && n <= 9);
  const move = m => m && square(m.to) && (square(m.from) || (m.from === null && Shogi.HAND_ORDER.includes(m.t)));
  for (const b of books) {
    if (!b || typeof b.title !== "string" || !b.root) return false;
    const stack = [b.root];
    while (stack.length) {
      const n = stack.pop();
      if (!n || !Array.isArray(n.children) || (n.comment !== undefined && typeof n.comment !== "string")) return false;
      if (n !== b.root && !move(n.move)) return false;
      stack.push(...n.children);
    }
  }
  return true;
}

function loadData() {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw === null) return { books: [], current: 0 };
  try {
    const data = JSON.parse(raw);
    if (data && validBooks(data.books)) return data;
  } catch (e) { /* 元の保存内容は上書きしない */ }
  throw new Error("保存した棋譜を読み込めませんでした。ブラウザの保存内容を確認してください。");
}

function saveData(data, notify = true) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
  catch (e) { return false; }
  if (notify && window.onKifuSaved) window.onKifuSaved();
  return true;
}

function libraryStatus(text, error = false) {
  $("libraryStatus").textContent = text;
  $("libraryStatus").className = "message" + (error ? " ng" : " ok");
}

function stats(root) {
  let leaves = 0, depth = 0;
  const stack = [[root, 0]];
  while (stack.length) {
    const [n, d] = stack.pop();
    if (!n.children.length) { leaves++; depth = Math.max(depth, d); }
    else n.children.forEach(c => stack.push([c, d + 1]));
  }
  return { depth, leaves };
}

function item({ title, sub, href, onOpen, onDelete }) {
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.href = href || "#";
  const name = document.createElement("b"), detail = document.createElement("span");
  name.textContent = title;
  detail.textContent = sub;
  a.appendChild(name); a.appendChild(detail);
  if (onOpen) a.onclick = e => { e.preventDefault(); onOpen(); };
  li.appendChild(a);
  if (onDelete) {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "icon";
    del.title = "削除";
    del.setAttribute("aria-label", `「${title}」を削除`);
    del.textContent = "🗑";
    del.onclick = onDelete;
    li.appendChild(del);
  }
  return li;
}

function emptyItem(ul, text) {
  const li = document.createElement("li");
  li.className = "empty";
  li.textContent = text;
  ul.appendChild(li);
}

function renderMine() {
  const ul = $("myBooks");
  ul.innerHTML = "";
  try {
    const data = loadData();
    if (!data.books.length) {
      ul.innerHTML = '<li class="empty">まだ棋譜がありません。下の定跡から選ぶか、<a href="index.html">暗記ツール</a>の「読込」でKIFファイルを読み込んでください。</li>';
      return;
    }
    data.books.forEach((b, i) => {
      const { depth, leaves } = stats(b.root);
      ul.appendChild(item({
        title: b.title,
        sub: depth ? `${depth}手・変化${leaves}通り` : "まだ手がありません",
        onOpen: () => {
          data.current = i;
          if (saveData(data)) location.href = "index.html";
          else libraryStatus("棋譜を選択できませんでした。ブラウザの保存設定を確認してください。", true);
        },
        onDelete: () => {
          if (!confirm(`「${b.title}」を削除しますか？ 作成済みの次の一手問題は残ります。`)) return;
          const next = { ...data, books: data.books.filter((_, j) => j !== i), current: 0 };
          if (!saveData(next)) return libraryStatus("棋譜を削除できませんでした。", true);
          renderMine();
        }
      }));
    });
  } catch (e) { emptyItem(ul, e.message); }
}

function renderProblemCollections() {
  const ul = $("myProblemCollections");
  ul.innerHTML = "";
  try {
    const collections = P.load();
    if (!collections.length) return emptyItem(ul, "まだ問題集がありません。「問題集を新規作成」から保存先を作れます。");
    collections.forEach(c => ul.appendChild(item({
      title: c.title,
      sub: `${c.problems.length}問・次の一手問題集`,
      href: `problems.html?id=${encodeURIComponent(c.id)}`,
      onDelete: () => {
        if (!confirm(`「${c.title}」と中の${c.problems.length}問を削除しますか？ 元の棋譜は残ります。`)) return;
        try { P.removeCollection(c.id); renderProblemCollections(); }
        catch (e) { libraryStatus(e.message, true); }
      }
    })));
  } catch (e) { emptyItem(ul, e.message); }
}

async function renderJoseki() {
  const ul = $("josekiList");
  try {
    const response = await fetch("joseki/list.json");
    if (!response.ok) throw new Error();
    const list = await response.json();
    list.forEach(j => ul.appendChild(item({ title: j.title, sub: j.short, href: `index.html?kif=joseki/${j.slug}.kif` })));
  } catch (e) {
    ul.innerHTML = '<li class="empty">定跡の一覧を読み込めませんでした。<a href="joseki/">定跡解説</a>から選んでください。</li>';
  }
}

function backup() {
  try {
    const data = { app: "kifu-anki", version: 2, books: loadData().books, problemCollections: P.load() };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `棋譜暗記道場_バックアップ_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) { libraryStatus(e.message || "バックアップを作成できませんでした。", true); }
}

function restoreStorage(key, value) {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
}

async function restore(file) {
  let imported;
  try {
    const json = JSON.parse(await file.text());
    if (!json || (json.app !== undefined && json.app !== "kifu-anki") || (json.version !== undefined && ![1, 2].includes(json.version))) throw new Error();
    if (json.books === undefined && json.problemCollections === undefined) throw new Error();
    const books = json.books === undefined ? [] : json.books;
    const collections = json.problemCollections === undefined ? [] : json.problemCollections;
    if (!validBooks(books) || !P.validateCollections(collections)) throw new Error();
    imported = { books, collections };
  } catch (e) {
    libraryStatus("棋譜暗記道場のバックアップファイルではないか、内容が壊れています。", true);
    return;
  }
  try {
    const data = loadData(), collections = P.load();
    let added = 0, merged = 0;
    for (const b of imported.books) {
      const same = data.books.find(x => x.title === b.title);
      if (same) { mergeTree(same.root, b.root); merged++; }
      else { data.books.push(b); added++; }
    }
    const nextCollections = P.mergeCollections(collections, imported.collections);
    const oldBooks = localStorage.getItem(STORE_KEY), oldCollections = localStorage.getItem(P.KEY);
    if (!saveData(data, false)) throw new Error("復元内容を保存できませんでした。ブラウザの保存設定・空き容量を確認してください。");
    if (!P.save(nextCollections, { notify: false })) {
      try { restoreStorage(STORE_KEY, oldBooks); restoreStorage(P.KEY, oldCollections); }
      catch (e) { throw new Error("復元の保存に失敗しました。棋譜と問題集の一覧を確認し、バックアップファイルは保管してください。"); }
      throw new Error("復元内容を保存できませんでした。元のデータは変更していません。");
    }
    if (window.onKifuSaved) window.onKifuSaved();
    renderAll();
    const parts = [`棋譜${added}件を追加`];
    if (merged) parts.push(`${merged}件に変化を合流`);
    if (imported.collections.length) parts.push(`問題集${imported.collections.length}件を復元・合流`);
    libraryStatus(parts.join("、") + "しました。");
  } catch (e) { libraryStatus(e.message, true); }
}

function mergeTree(dst, src) {
  if (src.comment && !(dst.comment || "").includes(src.comment)) dst.comment = dst.comment ? dst.comment + "\n" + src.comment : src.comment;
  for (const c of src.children) {
    const same = dst.children.find(d => Shogi.moveEq(d.move, c.move));
    if (same) mergeTree(same, c); else dst.children.push(c);
  }
}

function renderAll() { renderMine(); renderProblemCollections(); }

$("btnNewProblemCollection").onclick = () => {
  $("newProblemCollectionName").value = "";
  $("newProblemCollectionError").textContent = "";
  $("newProblemCollectionDialog").showModal();
  $("newProblemCollectionName").focus();
};
$("btnCancelNewProblemCollection").onclick = () => $("newProblemCollectionDialog").close();
$("newProblemCollectionForm").onsubmit = e => {
  e.preventDefault();
  try {
    const collection = P.createCollection($("newProblemCollectionName").value);
    $("newProblemCollectionDialog").close();
    renderProblemCollections();
    libraryStatus(`「${collection.title}」を作成しました。棋譜から問題を追加できます。`);
  } catch (error) { $("newProblemCollectionError").textContent = error.message; }
};
$("btnBackup").onclick = backup;
$("btnRestore").onclick = () => $("restoreInput").click();
$("restoreInput").onchange = e => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ""; };
renderAll();
renderJoseki();
window.kifuReload = renderAll;
window.addEventListener("storage", e => { if (e.key === STORE_KEY || e.key === P.KEY || e.key === null) renderAll(); });
window.addEventListener("kifu-problems-changed", renderProblemCollections);
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
