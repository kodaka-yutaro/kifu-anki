// 棋譜と次の一手問題集のファイル一覧
const $ = id => document.getElementById(id);
const STORE_KEY = "kifu-anki-books-v1";
const P = KifuProblems;
let importingKifu = false;

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

function item({ title, sub, href, onOpen, onDelete, kind }) {
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.href = href || "#";
  const name = document.createElement("b"), detail = document.createElement("span");
  name.textContent = title;
  detail.textContent = sub;
  if (kind) {
    const icon = document.createElement("span"), filename = document.createElement("span"), type = document.createElement("span");
    icon.className = "file-icon" + (kind === "book" ? " file-icon-book" : "");
    icon.setAttribute("aria-hidden", "true");
    filename.className = "file-name";
    type.className = "file-kind";
    type.textContent = kind === "book" ? "次の一手ブック" : "棋譜ファイル";
    detail.className = "file-detail";
    filename.appendChild(name); filename.appendChild(type);
    a.appendChild(icon); a.appendChild(filename); a.appendChild(detail);
  } else { a.appendChild(name); a.appendChild(detail); }
  if (onOpen) a.onclick = e => { e.preventDefault(); onOpen(); };
  li.appendChild(a);
  if (onDelete) {
    const del = document.createElement("button");
    del.type = "button";
    del.className = kind ? "icon file-delete" : "icon";
    del.title = "削除";
    del.setAttribute("aria-label", `「${title}」を削除`);
    del.textContent = kind ? "×" : "🗑";
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
    $("kifuFileCount").textContent = `${data.books.length}件`;
    if (!data.books.length) {
      return emptyItem(ul, "まだ棋譜がありません。「棋譜を読み込む」から追加するか、新しい棋譜を作成してください。");
    }
    data.books.forEach((b, i) => {
      const { depth, leaves } = stats(b.root);
      ul.appendChild(item({
        title: b.title,
        sub: depth ? `${depth}手・変化${leaves}通り` : "まだ手がありません",
        kind: "kifu",
        href: "index.html",
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
  } catch (e) { $("kifuFileCount").textContent = "—"; emptyItem(ul, e.message); }
}

function renderProblemCollections() {
  const ul = $("myProblemCollections");
  ul.innerHTML = "";
  try {
    const collections = P.load();
    $("problemBookCount").textContent = `${collections.length}冊`;
    if (!collections.length) return emptyItem(ul, "まだブックがありません。「新規ブック」から問題の保存先を作れます。");
    collections.forEach(c => ul.appendChild(item({
      title: c.title,
      sub: `${c.problems.length}問`,
      kind: "book",
      href: `problems.html?id=${encodeURIComponent(c.id)}`,
      onDelete: () => {
        if (!confirm(`「${c.title}」と中の${c.problems.length}問を削除しますか？ 元の棋譜は残ります。`)) return;
        try { P.removeCollection(c.id); renderProblemCollections(); }
        catch (e) { libraryStatus(e.message, true); }
      }
    })));
  } catch (e) { $("problemBookCount").textContent = "—"; emptyItem(ul, e.message); }
}

function decodeKifu(buffer) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch (e) { return new TextDecoder("shift_jis", { fatal: true }).decode(buffer); }
}

function parseKifuFile(text, filename) {
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const hasMoves = /^[\t 　]*\d+[\t 　]+\S/m.test(text);
  const hasHeader = /^[\t 　]*(?:手合割[：:]|手数[-ー 　]*指手)/m.test(text);
  if (!hasMoves && !hasHeader) throw new Error("KIF・KIFU形式の棋譜が見つかりません。");
  const root = Shogi.parseKIF(text);
  const header = text.match(/^[\t 　]*(?:表題|棋戦)[：:](.+)$/m);
  const title = (header && header[1].trim()) || filename.replace(/\.(kifu?|txt)$/i, "").trim() || "読み込んだ棋譜";
  const parsed = { title, root };
  if (!validBooks([parsed])) throw new Error("棋譜の指し手を読み込めませんでした。");
  return parsed;
}

function uniqueKifuTitle(title, books) {
  let name = title;
  for (let i = 2; books.some(book => book.title === name); i++) name = `${title}（${i}）`;
  return name;
}

async function importKifuFiles(files) {
  if (importingKifu || !files.length) return;
  importingKifu = true;
  $("btnImportKifu").disabled = true;
  $("btnImportKifu").textContent = "読み込み中…";
  $("kifuFileInput").disabled = true;
  const parsed = [], failures = [];
  try {
    for (const file of files) {
      try { parsed.push(parseKifuFile(decodeKifu(await file.arrayBuffer()), file.name)); }
      catch (e) { failures.push(`「${file.name}」：${e.message || "読み込めませんでした。"}`); }
    }
    let message;
    if (parsed.length) {
      const data = loadData();
      for (const book of parsed) {
        book.title = uniqueKifuTitle(book.title, data.books);
        data.books.push(book);
      }
      if (!saveData(data)) throw new Error(`読み込んだ${parsed.length}件を保存できませんでした。ブラウザの保存設定・空き容量を確認して、もう一度読み込んでください。`);
      renderMine();
      message = `棋譜を${parsed.length}件読み込みました。一覧から開けます。`;
    } else message = "棋譜を読み込めませんでした。";
    if (failures.length) message += `\n読み込めなかったファイル：${failures.length}件\n` + failures.join("\n");
    libraryStatus(message, failures.length > 0);
  } catch (e) {
    libraryStatus(e.message + (failures.length ? "\n" + failures.join("\n") : ""), true);
  } finally {
    importingKifu = false;
    $("btnImportKifu").disabled = false;
    $("btnImportKifu").textContent = "棋譜を読み込む";
    $("kifuFileInput").disabled = false;
  }
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

$("btnImportKifu").onclick = () => $("kifuFileInput").click();
$("kifuFileInput").onchange = event => {
  const files = [...event.target.files];
  event.target.value = "";
  return importKifuFiles(files);
};
$("btnNewKifu").onclick = () => {
  $("newKifuName").value = "";
  $("newKifuError").textContent = "";
  $("newKifuDialog").showModal();
  $("newKifuName").focus();
};
$("btnCancelNewKifu").onclick = () => $("newKifuDialog").close();
$("newKifuForm").onsubmit = event => {
  event.preventDefault();
  try {
    const title = $("newKifuName").value.trim();
    if (!title) throw new Error("ファイル名を入力してください。");
    const data = loadData();
    data.books.push({ title: uniqueKifuTitle(title, data.books), root: Shogi.newNode(null) });
    data.current = data.books.length - 1;
    if (!saveData(data)) throw new Error("棋譜を保存できませんでした。ブラウザの保存設定・空き容量を確認してください。");
    $("newKifuDialog").close();
    location.href = "index.html";
  } catch (e) { $("newKifuError").textContent = e.message; }
};
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
try { if (window.KifuDefaults) window.KifuDefaults.ensure(); }
catch (e) { libraryStatus(e.message || "初期ファイルを保存できませんでした。", true); }
renderAll();
renderJoseki();
window.kifuReload = renderAll;
window.addEventListener("storage", e => { if (e.key === STORE_KEY || e.key === P.KEY || e.key === null) renderAll(); });
window.addEventListener("kifu-problems-changed", renderProblemCollections);
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
