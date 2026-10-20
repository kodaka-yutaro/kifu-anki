(() => {
  const title = "チュートリアル：振り飛車の出だし";
  const mainKif = `表題：${title}
手合割：平手
手数----指手---------消費時間--
*角道を開けるところから、6手の短い手順を体験します。
1 ７六歩(77)
2 ３四歩(33)
3 ２六歩(27)
4 ４四歩(43)
5 ４八銀(39)
6 ４二飛(82)
*飛車を4筋に振る、四間飛車の出だしです。
`;
  const fullKif = mainKif + `
変化：6手
6 ３二飛(82)
*飛車を3筋に振る、三間飛車の出だしです。
`;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { title, mainKif, fullKif };
    return;
  }

  const app = window.KifuTutorialApp;
  if (!app) return;
  const $ = id => document.getElementById(id);
  const firstMove = { from: [7, 7], to: [7, 6], promote: false };
  const branchMove = { from: [8, 2], to: [3, 2], promote: false };
  const mainLastMove = { from: [8, 2], to: [4, 2], promote: false };
  const steps = [
    { title: "駒を動かす", success: "初手を指せました。指した手が棋譜に登録されます。" },
    { title: "手順を戻す・進める", success: "手順を前後に確認できました。" },
    { title: "分岐を作る", success: "元の△４二飛を残して、△３二飛の枝が増えました。" },
    { title: "局面にメモを書く", success: "この局面にメモを書けました。" },
    { title: "先手で2つの変化を練習", mode: "sente", lines: 2, success: "先手で2つの変化を完了しました。" },
    { title: "後手で練習", mode: "gote", lines: 1, success: "後手の立場でも練習できました。" },
    { title: "両方の手を練習", mode: "both", lines: 1, success: "6手を自分で指せました。" },
    { title: "コメントを隠して確認", success: "隠していたコメントをめくれました。" },
    { title: "KIFに書き出す", success: "練習用KIFのダウンロードを開始しました。" },
    { title: "KIFを読み込む", success: "読み込めました。ひと通りの体験が完了です！" }
  ];

  let active = false;
  let preparing = false;
  let index = 0;
  let flags = {};
  let learnedComment = null;
  let notice = "";
  let controls = new Map();
  let libraryTabIndex = null;
  let originalImportHandler = null;
  let importing = false;
  let importAttempt = 0;
  let anchorSelector = "";
  let previousAnchor = "";
  let frame = null;
  let ensureVisible = false;

  function setText(id, value) {
    if ($(id).textContent !== value) $(id).textContent = value;
  }
  function focusHeading(id) {
    const heading = $(id).querySelector("h2");
    if (heading) heading.focus({ preventScroll: true });
  }
  function clearMarks() {
    document.querySelectorAll(".tutorial-target, .tutorial-from, .tutorial-to").forEach(el => {
      el.classList.remove("tutorial-target", "tutorial-from", "tutorial-to");
      if (el.getAttribute("aria-describedby") === "tutorialHint") el.removeAttribute("aria-describedby");
    });
    anchorSelector = "";
  }
  function mark(selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.classList.add("tutorial-target");
    el.setAttribute("aria-describedby", "tutorialHint");
    anchorSelector = selector;
  }
  const squareSelector = square => `#board [data-file="${square[0]}"][data-rank="${square[1]}"]`;
  function selectedMove(move, state) {
    return !!(state.selected && state.selected.from && Shogi.sameSq(state.selected.from, move.from));
  }
  function markMove(move, state) {
    if (!move || !move.from) return;
    for (const [square, cls] of [[move.from, "tutorial-from"], [move.to, "tutorial-to"]]) {
      const el = document.querySelector(squareSelector(square));
      if (el) { el.classList.add(cls); el.setAttribute("aria-describedby", "tutorialHint"); }
    }
    anchorSelector = squareSelector(selectedMove(move, state) ? move.to : move.from);
  }
  function moveHelp(move, state) {
    if (!move || !move.from) return "青い枠の駒を選び、緑の枠のマスへ動かします。";
    const from = `${move.from[0]}${Shogi.KANJI[move.from[1]]}`;
    const to = `${move.to[0]}${Shogi.KANJI[move.to[1]]}`;
    if (selectedMove(move, state)) return `次に、緑の枠の${to}をタップします。`;
    const piece = state.position.sq[move.from[0]][move.from[1]];
    const name = piece ? Shogi.NAME[piece.t] : "駒";
    return `青い枠の${from}の${name}をタップし、緑の枠の${to}へ動かします。`;
  }
  function isMainLast(state) {
    return state.depth === 6 && state.node.move && Shogi.moveEq(state.node.move, mainLastMove);
  }
  function completed(state) {
    switch (index) {
      case 0: return !!flags.moved;
      case 1: return ["prev", "next", "last"].every(a => flags.navigation.has(a)) && state.depth === 6;
      case 2: return !!flags.branch;
      case 3: return flags.tree && flags.comment && isMainLast(state) && !!state.node.comment.trim();
      case 4: return flags.answer && state.mode === "sente" && state.done >= 2;
      case 5: return state.mode === "gote" && state.done >= 1;
      case 6: return state.mode === "both" && state.done >= 1;
      case 7: return flags.revealed && state.settings.hideComments;
      case 8: return !!flags.exported;
      case 9: return !!flags.imported;
      default: return true;
    }
  }
  function applyControls(state) {
    const allowed = new Set(["btnHelp"]);
    if (index === 1) ["btnFirst", "btnPrev", "btnNext", "btnLast"].forEach(id => allowed.add(id));
    if (index === 2 && state.depth === 6 && !flags.branch) allowed.add("btnPrev");
    if (steps[index] && steps[index].mode && !completed(state)) {
      allowed.add(`mode-${steps[index].mode}`);
      allowed.add("btnAnswer"); allowed.add("btnContinue");
    }
    if (index === 7) { allowed.add("btnSettings"); allowed.add("commentCover"); }
    if (index === 8) allowed.add("btnExport");
    if (index === 9 && !importing) allowed.add("btnImport");
    controls.forEach((wasDisabled, el) => {
      const key = el.dataset.mode ? `mode-${el.dataset.mode}` : el.id;
      el.disabled = wasDisabled || !allowed.has(key);
    });
    $("comment").readOnly = !(index === 3 && flags.tree && isMainLast(state));
  }

  // ガイドは対象の近くに置き、設定・読込中はダイアログのトップレイヤーへ移す。
  function positionGuide() {
    frame = null;
    if (!active || index >= steps.length) return;
    const guide = $("tutorialPanel");
    const dialog = [$("settingsDialog"), $("importDialog")].find(d => d.open);
    const parent = dialog || document.body;
    if (guide.parentElement !== parent) parent.appendChild(guide);
    const target = document.querySelector(anchorSelector) || $("board");
    const viewport = window.visualViewport;
    const left = viewport ? viewport.offsetLeft : 0;
    const top = viewport ? viewport.offsetTop : 0;
    const width = viewport ? viewport.width : window.innerWidth;
    const height = viewport ? viewport.height : window.innerHeight;
    const margin = 12, gap = 14;
    const content = guide.querySelector(".tutorial-guide-content");
    guide.style.maxWidth = `${Math.max(1, width - margin * 2)}px`;
    content.style.maxHeight = `${Math.max(1, height - margin * 2 - 2)}px`;
    guide.classList.toggle("is-typing", height < 450 && document.activeElement === $("comment"));
    let rect = target.getBoundingClientRect();
    if (ensureVisible && document.activeElement !== $("comment") &&
        (rect.top < top + margin || rect.bottom > top + height - margin || rect.left < left || rect.right > left + width)) {
      target.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
      rect = target.getBoundingClientRect();
    }
    ensureVisible = false;
    const guideRect = guide.getBoundingClientRect();
    const w = guideRect.width;
    let h = guideRect.height;
    const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
    const centerX = rect.left + rect.width / 2, centerY = rect.top + rect.height / 2;
    const x = clamp(centerX - w / 2, left + margin, left + width - w - margin);
    const y = clamp(centerY - h / 2, top + margin, top + height - h - margin);
    const candidates = [
      { side: "bottom", x, y: rect.bottom + gap },
      { side: "top", x, y: rect.top - h - gap },
      { side: "right", x: rect.right + gap, y },
      { side: "left", x: rect.left - w - gap, y }
    ];
    // 盤上では、移動元と移動先の両方をガイドで隠さない。
    const squares = [...document.querySelectorAll(".tutorial-from, .tutorial-to")];
    const protectedRects = squares.length ? squares.map(el => el.getBoundingClientRect()) : [rect];
    const overlaps = candidate => protectedRects.some(r =>
      candidate.x < r.right + 4 && candidate.x + w > r.left - 4 && candidate.y < r.bottom + 4 && candidate.y + h > r.top - 4);
    const fits = candidate => candidate.x >= left + margin && candidate.y >= top + margin &&
      candidate.x + w <= left + width - margin && candidate.y + h <= top + height - margin && !overlaps(candidate);
    let chosen = candidates.find(fits);
    if (!chosen) {
      const protectedTop = Math.min(...protectedRects.map(r => r.top));
      const protectedBottom = Math.max(...protectedRects.map(r => r.bottom));
      const above = clamp(protectedTop - top - margin - gap, 0, height - margin * 2);
      const below = clamp(top + height - margin - protectedBottom - gap, 0, height - margin * 2);
      const available = Math.max(above, below);
      // キーボードなどで画面が狭いときも入力欄に重ねず、案内の中をスクロールする。
      content.style.maxHeight = `${Math.max(1, available - 2)}px`;
      h = guide.getBoundingClientRect().height;
      chosen = above >= below
        ? { side: "top", x, y: protectedTop - h - gap }
        : { side: "bottom", x, y: protectedBottom + gap };
    }
    guide.dataset.placement = chosen.side;
    guide.style.left = `${clamp(chosen.x, left + margin, left + width - w - margin)}px`;
    guide.style.top = `${clamp(chosen.y, top + margin, top + height - h - margin)}px`;
    guide.style.setProperty("--tip-x", `${clamp(centerX - chosen.x, 20, w - 20)}px`);
    guide.style.setProperty("--tip-y", `${clamp(centerY - chosen.y, 20, h - 20)}px`);
  }
  function schedulePosition(reveal = false) {
    if (!active || index >= steps.length) return;
    ensureVisible = ensureVisible || reveal;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(positionGuide);
  }
  function update() {
    if (!active || preparing) return;
    const state = app.state();
    const oldAnchor = anchorSelector || previousAnchor;
    clearMarks();
    applyControls(state);
    if (index >= steps.length) return;
    const done = completed(state);
    $("btnTutorialNext").disabled = !done;
    $("tutorialProgress").value = index + (done ? 1 : 0);
    setText("tutorialFeedback", done ? steps[index].success : notice);
    let hint = "";
    if (done) {
      hint = index === steps.length - 1 ? "「体験を終える」へ進みましょう。" : "「次へ」で続けます。";
      if ((index === 0 || index === 2 || steps[index].mode) && state.node.move) mark(squareSelector(state.node.move.to));
      else mark(index === 7 ? "#comment" : index === 9 ? "#btnImport" : oldAnchor || "#board");
    } else if (index === 0) {
      hint = moveHelp(firstMove, state); markMove(firstMove, state);
    } else if (index === 1) {
      if (!flags.navigation.has("prev")) { hint = "この「◀」を押して、1手前へ戻ります。"; mark("#btnPrev"); }
      else if (!flags.navigation.has("next")) { hint = "次は「▶」で1手進めます。"; mark("#btnNext"); }
      else { hint = "「⏭」を押して、最後の6手目へ進みます。"; mark("#btnLast"); }
    } else if (index === 2) {
      if (state.depth === 6) { hint = "「◀」で5手目に戻り、別の手を指してみます。"; mark("#btnPrev"); }
      else { hint = moveHelp(branchMove, state); markMove(branchMove, state); }
    } else if (index === 3) {
      if (!flags.tree || !isMainLast(state)) {
        hint = "ツリーの「△４二飛」を選ぶと、その局面へ移動できます。";
        mark('#tree [aria-label="6手目 △４二飛"]');
      } else {
        hint = "このコメントを、自分の言葉に書き換えます。例：飛車を4筋へ。"; mark("#comment");
      }
    } else if (steps[index].mode) {
      const expectedMode = steps[index].mode;
      if (state.mode !== expectedMode) {
        hint = `「${{ sente: "▲先手", gote: "△後手", both: "両方" }[expectedMode]}」を選びます。` +
          ({ sente: "先手の3手を、2つの変化で練習します。", gote: "盤が反転し、後手の3手を練習できます。", both: "6手を交互に指してみましょう。" }[expectedMode]);
        mark(`[data-mode="${expectedMode}"]`);
      } else if (index === 4 && !flags.answer) {
        hint = "「答え」を押すと、動かす駒が光ります。まず一度試してみましょう。"; mark("#btnAnswer");
      } else if (state.waiting && state.node.children.length === 0) {
        hint = "1つ目の変化が完了しました。「次の変化へ」で、残りの枝を練習します。"; mark("#btnContinue");
      } else if (state.waiting || (expectedMode !== "both" && (expectedMode === "sente") !== state.position.turn)) {
        hint = "相手の手が自動で進みます。"; mark(oldAnchor || "#board");
      } else { hint = moveHelp(state.nextMove, state); markMove(state.nextMove, state); }
    } else if (index === 7) {
      if (!$("settingsDialog").open && !state.settings.hideComments) {
        hint = "設定を開いて、コメントを隠す機能を試します。"; mark("#btnSettings");
      } else if (!state.settings.hideComments) {
        hint = "このチェックをオンにします。体験中の設定は、終了すると元に戻ります。"; mark("#optHideComments");
      } else if ($("settingsDialog").open) {
        hint = "「閉じる」で盤へ戻り、コメントをめくってみましょう。"; mark("#settingsDialog form button");
      } else {
        hint = "このボタンを押すと、隠していたメモを確認できます。"; mark("#commentCover");
      }
    } else if (index === 8) {
      hint = "「書出」で、練習用の棋譜をKIFに保存します。分岐とコメントも含まれます。"; mark("#btnExport");
    } else if (index === 9) {
      if ($("importDialog").open) {
        hint = "「今の定跡に合流」で枝をまとめられます。「新しい定跡にする」を選んでも大丈夫です。";
        mark('#importDialog button[value="merge"]');
      } else {
        hint = "「読込」を押します。この体験では練習用KIFを用意してあるので、ファイルを探す必要はありません。";
        mark("#btnImport");
      }
    }
    setText("tutorialHint", hint);
    setText("tutorialStep", `${index + 1} / ${steps.length}`);
    const changed = anchorSelector !== previousAnchor;
    previousAnchor = anchorSelector;
    schedulePosition(changed);
  }
  function enter(next) {
    preparing = true;
    importAttempt++;
    importing = false;
    document.body.appendChild($("tutorialPanel"));
    [$("settingsDialog"), $("importDialog")].forEach(d => { if (d.open) d.close(); });
    index = next;
    flags = { navigation: new Set() };
    notice = "";
    previousAnchor = "";
    clearMarks();
    if (index === steps.length) {
      $("tutorialPanel").hidden = true;
      $("tutorialDone").hidden = false;
      preparing = false;
      update();
      $("tutorialDone").scrollIntoView({ block: "start", behavior: "auto" });
      focusHeading("tutorialDone");
      return;
    }
    $("tutorialPanel").hidden = false;
    $("tutorialDone").hidden = true;
    const options = { comment: learnedComment };
    if (index === 1) options.depth = 1;
    if (index === 2) options.depth = 6;
    if (index === 3) { options.depth = 6; options.alternate = true; }
    app.sample(index <= 2 ? mainKif : fullKif, options);
    if (index === 7) app.mode("both");
    setText("tutorialTitle", steps[index].title);
    $("btnTutorialBack").disabled = index === 0;
    $("btnTutorialNext").textContent = index === steps.length - 1 ? "体験を終える" : "次へ";
    preparing = false;
    update();
    focusHeading("tutorialPanel");
  }
  async function tutorialImport() {
    if (!active || index !== 9 || importing) return;
    const attempt = ++importAttempt;
    importing = true;
    update();
    try { await app.importSample(fullKif); }
    finally { if (attempt === importAttempt) { importing = false; update(); } }
  }
  function start() {
    if ($("helpDialog").open) $("helpDialog").close();
    if (active) { focusHeading(index === steps.length ? "tutorialDone" : "tutorialPanel"); return; }
    if (app.state().linkedKifPending) return;
    controls = new Map();
    const ids = ["btnNew", "btnRename", "btnDelete", "btnImport", "btnExport", "btnCut", "btnFirst", "btnPrev", "btnNext", "btnLast", "btnAnswer", "btnContinue", "btnSettings", "btnAccount", "commentCover"];
    ids.map($).concat([...document.querySelectorAll(".modes button")]).filter(Boolean).forEach(el => controls.set(el, el.disabled));
    active = true;
    preparing = true;
    learnedComment = null;
    importing = false;
    if (!app.begin(title, mainKif)) { active = false; preparing = false; return; }
    libraryTabIndex = $("btnLibrary").getAttribute("tabindex");
    $("btnLibrary").setAttribute("aria-disabled", "true");
    $("btnLibrary").tabIndex = -1;
    originalImportHandler = $("btnImport").onclick;
    $("btnImport").onclick = tutorialImport;
    enter(0);
  }
  function finish(keep = false) {
    if (!active) return;
    active = false;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    clearMarks();
    $("tutorialPanel").hidden = true;
    document.body.appendChild($("tutorialPanel"));
    [$("settingsDialog"), $("importDialog")].forEach(d => { if (d.open) d.close(); });
    controls.forEach((disabled, el) => el.disabled = disabled);
    $("btnImport").onclick = originalImportHandler;
    $("btnLibrary").removeAttribute("aria-disabled");
    if (libraryTabIndex === null) $("btnLibrary").removeAttribute("tabindex");
    else $("btnLibrary").setAttribute("tabindex", libraryTabIndex);
    app.finish(keep);
    $("tutorialDone").hidden = true;
    $("btnHelp").focus({ preventScroll: true });
  }

  window.KifuTutorial = {
    onAction(type, detail) {
      if (!active || preparing) return;
      const state = app.state();
      if (type !== "render") notice = "";
      if (type === "navigate") flags.navigation.add(detail.via);
      if (index === 0 && type === "play" && Shogi.moveEq(detail.move, firstMove)) flags.moved = true;
      if (index === 2 && type === "play" && Shogi.moveEq(detail.move, branchMove)) flags.branch = true;
      if (index === 3 && type === "tree" && isMainLast(state)) { flags.tree = true; flags.initialComment = state.node.comment; }
      if (index === 3 && type === "comment" && flags.tree && isMainLast(state)) {
        flags.comment = !!state.node.comment.trim() && state.node.comment !== flags.initialComment;
        if (flags.comment) learnedComment = state.node.comment;
      }
      if (type === "answer") flags.answer = true;
      if (index === 7 && type === "reveal") flags.revealed = true;
      if (type === "export") flags.exported = true;
      if (type === "import") flags.imported = true;
      update();
    },
    canPlay(move) {
      if (!active) return true;
      const state = app.state();
      const valid = (index === 0 && state.depth === 0 && Shogi.moveEq(move, firstMove)) ||
        (index === 2 && state.depth === 5 && Shogi.moveEq(move, branchMove)) ||
        (steps[index] && steps[index].mode === state.mode && (index !== 4 || flags.answer));
      if (!valid) notice = "枠で示した駒を動かします。「やり直す」でこの手順の最初へ戻れます。";
      return valid;
    },
    canUseTree() { return !active || index === 3; }
  };
  $("btnHelpTutorial").onclick = start;
  $("btnTutorialExit").onclick = () => finish();
  $("btnTutorialFinish").onclick = () => finish();
  $("btnTutorialKeep").onclick = () => finish(true);
  $("btnTutorialBack").onclick = () => { if (active && index > 0) enter(index - 1); };
  $("btnTutorialRetry").onclick = () => { if (active) enter(index); };
  $("btnTutorialNext").onclick = () => { if (active && completed(app.state())) enter(index + 1); };
  $("btnLibrary").addEventListener("click", e => {
    if (!active) return;
    e.preventDefault();
    notice = "体験を終了すると、元の棋譜の一覧を開けます。";
    update();
  });
  [$("settingsDialog"), $("importDialog")].forEach(d => d.addEventListener("close", update));
  $("comment").addEventListener("focus", () => schedulePosition());
  $("comment").addEventListener("blur", () => schedulePosition());
  window.addEventListener("resize", () => schedulePosition());
  window.addEventListener("scroll", () => schedulePosition(), true);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => schedulePosition());
    window.visualViewport.addEventListener("scroll", () => schedulePosition());
  }
})();
