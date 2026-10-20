// Google ログインと棋譜のサーバー保存（Firebase Authentication + Cloud Firestore）
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
let user = null;
let timer = null;

const readJSON = key => { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } };
const writeJSON = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 保存できない環境 */ } };
const localBooks = () => (readJSON(STORE_KEY) || {}).books || [];
function setLocalBooks(books) {
  const data = readJSON(STORE_KEY) || {};
  writeJSON(STORE_KEY, { books, current: Math.min(data.current || 0, Math.max(books.length - 1, 0)) });
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

const userDoc = () => doc(db, "users", user.uid);
async function fetchRemote() {
  const snap = await getDoc(userDoc());
  if (!snap.exists()) return null;
  try { return JSON.parse(snap.data().books); } catch (e) { return null; }
}
async function push() {
  clearTimeout(timer);
  if (!user) return;
  const uid = user.uid;
  try {
    await setDoc(userDoc(), { books: JSON.stringify(localBooks()), updatedAt: serverTimestamp() });
    if (user && user.uid === uid) { setMeta({ uid, pending: false }); status(""); }
  } catch (e) {
    // 通信できない・無料枠を超えたときなど。棋譜はブラウザに残り、次に開いたときに送り直す
    status("サーバーに保存できませんでした（ブラウザには保存済み）");
  }
}

// app.js / library.js が保存するたびに呼ばれる
window.onKifuSaved = () => {
  if (!user) return;
  setMeta({ uid: user.uid, pending: true });
  clearTimeout(timer);
  timer = setTimeout(push, SAVE_DELAY);
};
// ページを離れる前に、まだ送っていない変更を送る
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && timer) push();
});

async function onLogin() {
  const m = meta();
  try {
    if (m.uid !== user.uid) {
      // このブラウザで初めてこのアカウントにログイン：手元の棋譜とサーバーの棋譜を合わせる
      const remote = await fetchRemote();
      setLocalBooks(remote ? mergeBooks(remote, localBooks()) : localBooks());
      await push();
    } else if (m.pending) {
      await push();              // 前回送れなかった変更を送る
    } else {
      const remote = await fetchRemote();
      // 読み込み中に手元で変更していたら、手元を優先する（その変更は onKifuSaved で送られる）
      if (remote && !meta().pending && JSON.stringify(remote) !== JSON.stringify(localBooks())) setLocalBooks(remote);
    }
  } catch (e) {
    status("サーバーの棋譜を読み込めませんでした");
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
      if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") status("ログインできませんでした");
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
  user = u;
  renderAccount();
  if (u) onLogin();
});
