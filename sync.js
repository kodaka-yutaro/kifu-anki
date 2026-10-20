// Google ログインと棋譜・問題集のサーバー保存（Firebase Authentication + Cloud Firestore）
// ブラウザの localStorage を正とし、ログイン中は変更をまとめて users/{uid} に保存する。
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAGvkKc8pwD-yRoxHjk-_19PfdisjK5G_8",
  authDomain: "kifu-kdking-tools.firebaseapp.com",
  projectId: "kifu-kdking-tools",
  storageBucket: "kifu-kdking-tools.firebasestorage.app",
  messagingSenderId: "744217927768",
  appId: "1:744217927768:web:ab15fd9c72f6718b6eea2d"
};

const STORE_KEY = "kifu-anki-books-v1";
const SYNC_KEY = "kifu-anki-sync-v1";   // { uid, pending } このブラウザがどのアカウントと同期済みか
const SAVE_DELAY = 3000;               // 変更をまとめて保存する間隔（書き込み回数を抑える）

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);
const problems = window.KifuProblems;
const defaults = window.KifuDefaults;
let user = null;
let timer = null;
let session = 0;
let loading = false;
let pushQueue = Promise.resolve();

const readJSON = key => { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } };
const writeJSON = (key, v) => {
  try { localStorage.setItem(key, JSON.stringify(v)); return true; }
  catch (e) { return false; }
};
function localBooks() {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw === null || raw === "") return [];
  const data = JSON.parse(raw);
  if (!data || !Array.isArray(data.books)) throw new Error("local-books");
  return data.books;
}
const localProblems = () => problems ? problems.load() : [];
function setLocalData(books, collections) {
  const data = readJSON(STORE_KEY) || {};
  const previous = localStorage.getItem(STORE_KEY);
  if (!writeJSON(STORE_KEY, { ...data, books, current: Math.min(data.current || 0, Math.max(books.length - 1, 0)) })) throw new Error("local-storage");
  if (problems && collections !== null && !problems.save(collections, { notify: false })) {
    if (previous === null) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, previous);
    throw new Error("problem-storage");
  }
  if (window.kifuReload) window.kifuReload();
}
const meta = () => readJSON(SYNC_KEY) || {};
const setMeta = m => writeJSON(SYNC_KEY, m);

const moveEq = (a, b) => window.Shogi ? Shogi.moveEq(a, b) : JSON.stringify(a) === JSON.stringify(b);
function mergeTree(dst, src) {
  if (src.comment && !(dst.comment || "").includes(src.comment)) {
    dst.comment = dst.comment ? dst.comment + "\n" + src.comment : src.comment;
  }
  for (const c of src.children) {
    const same = dst.children.find(d => moveEq(d.move, c.move));
    if (same) mergeTree(same, c); else dst.children.push(c);
  }
}
// 同じ名前の棋譜は変化を合流させ、ほかは追加する
function mergeBooks(base, extra) {
  const out = base.slice();
  for (const b of extra) {
    const same = out.find(x => x.title === b.title);
    if (same) mergeTree(same.root, b.root); else out.push(b);
  }
  return out;
}

const active = (uid, token) => user && user.uid === uid && session === token;
const snapshot = () => ({ books: localBooks(), problemCollections: localProblems() });
const changedSince = before => JSON.stringify(snapshot()) !== before;
function markPending() {
  const current = meta();
  setMeta({ ...current, ...(user ? { uid: user.uid } : {}), pending: true, revision: (current.revision || 0) + 1 });
}
function schedulePush() {
  clearTimeout(timer);
  timer = setTimeout(push, SAVE_DELAY);
}
async function fetchRemote(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  const books = data.books === undefined ? [] : JSON.parse(data.books);
  if (!Array.isArray(books) || !books.every(b => b && typeof b.title === "string" && b.root && Array.isArray(b.root.children))) throw new Error("remote-books");
  let problemCollections = null;
  if (problems && data.problemCollections !== undefined) {
    problemCollections = JSON.parse(data.problemCollections);
    if (!problems.validateCollections(problemCollections)) throw new Error("remote-problems");
  }
  return { books, problemCollections };
}
async function push() {
  clearTimeout(timer);
  timer = null;
  if (!user || loading) return;
  const uid = user.uid, token = session;
  let saved, revision;
  try {
    saved = snapshot();
    revision = meta().revision || 0;
  } catch (e) {
    status("問題集を読み込めないため、サーバーへの保存を中止しました");
    return;
  }
  // 書き込みを順番に実行し、古い保存結果が新しい変更を上書きしないようにする。
  pushQueue = pushQueue.then(async () => {
    if (!active(uid, token)) return;
    try {
      const payload = { books: JSON.stringify(saved.books), updatedAt: serverTimestamp() };
      if (problems) payload.problemCollections = JSON.stringify(saved.problemCollections);
      await setDoc(doc(db, "users", uid), payload, { merge: true });
      if (!active(uid, token)) return;
      if ((meta().revision || 0) === revision && !changedSince(JSON.stringify(saved))) {
        if (defaults) defaults.synced();
        setMeta({ uid, pending: false, revision });
        status("");
      } else {
        markPending();
        schedulePush();
      }
    } catch (e) {
      if (active(uid, token)) status("サーバーに保存できませんでした（ブラウザには保存済み）");
    }
  });
  return pushQueue;
}

// 棋譜または問題集が保存されるたびに呼ばれる。
window.onKifuSaved = () => {
  markPending();
  if (user && !loading) schedulePush();
};
// ページを離れる前に、まだ送っていない変更を送る
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && timer) push();
});

async function onLogin() {
  const uid = user.uid, token = session;
  const m = meta();
  loading = true;
  try {
    const before = JSON.stringify(snapshot());
    if (m.uid !== uid) {
      // このブラウザで初めてこのアカウントにログイン：手元の棋譜とサーバーの棋譜を合わせる
      const remote = await fetchRemote(uid);
      if (!active(uid, token)) return;
      const collections = remote && remote.problemCollections !== null
        ? problems.mergeCollections(remote.problemCollections, localProblems()) : localProblems();
      setLocalData(remote ? mergeBooks(remote.books, localBooks()) : localBooks(), collections);
      markPending();
      loading = false;
      await push();
    } else if (m.pending) {
      loading = false;
      await push();              // 前回送れなかった変更を送る
    } else {
      const remote = await fetchRemote(uid);
      if (!active(uid, token)) return;
      // 読み込み中に手元で変更していたら、手元を優先する（その変更は onKifuSaved で送られる）
      if (meta().pending || changedSince(before)) {
        markPending();
        loading = false;
        await push();
        return;
      }
      const local = localProblems();
      const seeded = defaults ? defaults.pending() : {};
      if (remote) {
        // 初期サンプルだけは、古い空のクラウドデータで消さずに合流する。
        // 先にサーバーを読み、ほかの端末で保存した棋譜・問題集も保持する。
        const books = seeded.books ? mergeBooks(remote.books, localBooks()) : remote.books;
        const collections = seeded.problemCollections && remote.problemCollections !== null
          ? problems.mergeCollections(remote.problemCollections, local) : remote.problemCollections;
        if (JSON.stringify(books) !== JSON.stringify(localBooks()) ||
          (collections !== null && JSON.stringify(collections) !== JSON.stringify(local))) {
          setLocalData(books, collections);
        }
      }
      // 古いサーバーデータに問題集フィールドがなくても、端末の問題集は消さない。
      if (!remote || seeded.books || seeded.problemCollections ||
        (problems && remote.problemCollections === null && local.length)) {
        markPending();
        loading = false;
        await push();
      }
    }
  } catch (e) {
    if (active(uid, token)) status("サーバーの棋譜・問題集を読み込めませんでした");
  } finally {
    if (active(uid, token)) loading = false;
  }
}

// ---------- 画面 ----------
function status(text) {
  const el = $("accountStatus");
  if (el) el.textContent = text;
}
function renderAccount() {
  const btn = $("btnAccount");
  if (!btn) return;
  btn.hidden = false;
  btn.textContent = user ? (user.displayName || "G").slice(0, 1) : "👤";
  btn.classList.toggle("signed-in", !!user);
  btn.title = user ? "アカウント" : "Google でログイン";
  $("accountName").textContent = user ? `${user.displayName || ""}（${user.email || ""}）でログイン中` : "";
  $("accountIn").hidden = !!user;
  $("accountOut").hidden = !user;
}
function initUI() {
  const btn = $("btnAccount"), d = $("accountDialog");
  if (!btn || !d) return;
  btn.onclick = () => { status(""); d.showModal(); };
  $("btnSignIn").onclick = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); d.close(); }
    catch (e) {
      if (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return;
      const why = {
        "auth/unauthorized-domain": "このサイトのドメインが Firebase で許可されていません",
        "auth/operation-not-allowed": "Firebase で Google ログインが有効になっていません",
        "auth/configuration-not-found": "Firebase の Authentication が始まっていません",
        "auth/popup-blocked": "ポップアップがブロックされました。ブラウザの設定で許可してください",
        "auth/network-request-failed": "通信できませんでした"
      }[e.code];
      status(`ログインできませんでした（${why || e.code || e.message}）`);
    }
  };
  $("btnSignOut").onclick = async () => {
    if (timer) await push();
    await signOut(auth);
    setMeta({});
    d.close();
  };
}

initUI();
onAuthStateChanged(auth, u => {
  clearTimeout(timer);
  timer = null;
  session++;
  loading = false;
  user = u;
  renderAccount();
  if (u) onLogin();
});
