// 盤面の上下反転（視点の切り替え）。全ページ共通で localStorage に保存する。
// 暗記モード「△後手」や次の一手の後手番など、元から反転している盤はさらに反転する（＝見る向きを入れ替える）。
(function () {
  const KEY = "kifu-anki-board-flip-v1";
  let flipped = false;
  try { flipped = localStorage.getItem(KEY) === "1"; } catch (e) { /* 既定のまま */ }
  const listeners = [];

  function syncButtons() {
    document.querySelectorAll(".flip-board").forEach(b => b.setAttribute("aria-pressed", String(flipped)));
    document.querySelectorAll(".static-board").forEach(f => f.classList.toggle("flipped", flipped));
  }
  function set(v) {
    flipped = !!v;
    try { localStorage.setItem(KEY, flipped ? "1" : "0"); } catch (e) { /* 保存できなくても反映はする */ }
    syncButtons();
    listeners.forEach(fn => fn(flipped));
  }
  function init() {
    document.querySelectorAll(".flip-board").forEach(b => {
      if (!b.dataset.flipReady) { b.dataset.flipReady = "1"; b.addEventListener("click", () => set(!flipped)); }
    });
    syncButtons();
  }

  window.BoardFlip = {
    get: () => flipped,
    set,
    toggle: () => set(!flipped),
    onChange: fn => listeners.push(fn),
    init,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
