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
  const KEY = "kifu-anki-tutorial-v1";
  const firstMove = { from: [7, 7], to: [7, 6], promote: false };
  const branchMove = { from: [8, 2], to: [3, 2], promote: false };
  const mainLastMove = { from: [8, 2], to: [4, 2], promote: false };
  const steps = [
    {
      title: "盤の駒を動かしてみよう",
      text: "まずは▲７六歩。7七にある先手の歩をタップし、移動先の7六をタップします。",
      success: "初手を指せました。編集モードでは、指した手が棋譜になります。"
    },
    {
      title: "手順を戻す・進める",
      text: "盤の横（スマホでは下）の「◀」「▶」で1手ずつ移動します。両方を試したら「⏭」で6手目まで進めてください。",
      success: "手順を前後に確認できました。「⏮」なら開始局面へ戻れます。"
    },
    {
      title: "別の手を指して、分岐を作ろう",
      text: "「◀」で5手目に戻り、8二の後手の飛車を3二へ。元の△４二飛を残したまま、△３二飛の枝が増えます。",
      success: "2つの変化ができました。途中で別の手を指すと、分岐として保存されます。"
    },
    {
      title: "ツリーで局面を選び、メモを書く",
      text: "盤の下のツリーで「△４二飛」を選びます。コメント欄を「飛車を4筋へ」など、自分の言葉に書き換えてみましょう。",
      success: "この局面にメモを書けました。コメントも棋譜と一緒に保存されます。"
    },
    {
      title: "先手で、2つの変化を暗記しよう",
      text: "「▲先手」を選び、まず「答え」を押します。先手の3手を指すと、後手は自動で進みます。「次の変化へ」で2本とも試しましょう。",
      mode: "sente", lines: 2,
      success: "先手で2つの変化を完了しました。終えた枝はツリーで緑色になります。"
    },
    {
      title: "後手の立場でも試そう",
      text: "「△後手」を選ぶと盤が反転します。今度は先手が自動で指すので、後手の3手を答えて1つの変化を終えましょう。",
      mode: "gote", lines: 1,
      success: "後手でも練習できました。盤の向きに合わせて筋・段を確認できます。"
    },
    {
      title: "両方の手を、自分で答えよう",
      text: "「両方」を選びます。先手・後手を交互に指し、6手の変化を1本終えましょう。困ったら「答え」も使えます。",
      mode: "both", lines: 1,
      success: "6手を自分で指せました。覚えたい立場に合わせてモードを選べます。"
    },
    {
      title: "コメントを隠して、めくって確認",
      text: "右上の設定（⚙）を開き、「暗記中はコメントを隠し、タップでめくって見る」をオンにします。閉じたら「コメントを見る」を押してください。",
      success: "メモを答え合わせに使えました。盤や駒の見た目も設定で選べます。"
    },
    {
      title: "KIFファイルに書き出そう",
      text: "上の「書出」を押すと、練習用の定跡をKIFファイルにできます。分岐とコメントも含まれ、ほかの将棋ソフトでも使える形式です。",
      success: "練習用KIFのダウンロードを開始しました。次は読み込みを試します。"
    },
    {
      title: "KIFの読み込みも体験しよう",
      text: "下の「練習用KIFを読み込む」を押し、表示された画面で「今の定跡に合流」か「新しい定跡にする」を選びます。自分のファイルは通常の「読込」から選べます。",
      success: "KIFを読み込めました。ひと通りの体験が完了です！"
    }
  ];

  let active = false;
  let preparing = false;
  let index = 0;
  let flags = {};
  let learnedComment = null;
  let notice = "";
  let controls = new Map();
  let libraryTabIndex = null;

  function remember(status) {
    try { localStorage.setItem(KEY, JSON.stringify({ version: 1, status })); } catch (e) { /* 任意の案内なので保存不可でも利用できる */ }
  }
  function setText(id, value) {
    if ($(id).textContent !== value) $(id).textContent = value;
  }
  function focusCard(id) {
    const card = $(id);
    card.scrollIntoView({ block: "start", behavior: "auto" });
    const heading = card.querySelector("h2");
    if (heading) heading.focus({ preventScroll: true });
  }
  function locateControl() {
    const state = app.state();
    const preferred = state.selected ? ".tutorial-to" : ".tutorial-from";
    const el = document.querySelector(preferred) ||
      [...document.querySelectorAll(".tutorial-target")].find(target => target.getClientRects().length);
    if (!el) return;
    el.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
    const control = el.matches("button, input, textarea, [tabindex]") ? el : el.querySelector("button:not(:disabled)");
    if (control) control.focus({ preventScroll: true });
  }
  function clearMarks() {
    document.querySelectorAll(".tutorial-target, .tutorial-from, .tutorial-to").forEach(el => {
      el.classList.remove("tutorial-target", "tutorial-from", "tutorial-to");
      if (el.getAttribute("aria-describedby") === "tutorialHint") el.removeAttribute("aria-describedby");
    });
  }
  function mark(selector) {
    const el = document.querySelector(selector);
    if (el) el.classList.add("tutorial-target");
  }
  function markMove(move) {
    if (!move) return;
    for (const [square, cls] of [[move.from, "tutorial-from"], [move.to, "tutorial-to"]]) {
      if (!square) continue;
      const el = document.querySelector(`#board [data-file="${square[0]}"][data-rank="${square[1]}"]`);
      if (el) { el.classList.add(cls); el.setAttribute("aria-describedby", "tutorialHint"); }
    }
  }
  function moveHelp(move, state) {
    if (!move || !move.from) return "光っている駒を選んで、移動先をタップします。";
    // 指し終えた直後のrender通知では、移動元が空になっている。
    const piece = state.position.sq[move.from[0]][move.from[1]];
    const label = piece ? Shogi.label(state.position, move, state.node.move && state.node.move.to) + "：" : "";
    return `${label}${move.from[0]}${Shogi.KANJI[move.from[1]]} → ${move.to[0]}${Shogi.KANJI[move.to[1]]}。青い実線の駒から、緑の破線のマスへ。`;
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
    if (index === 9) allowed.add("btnImport");
    controls.forEach((wasDisabled, el) => {
      const key = el.dataset.mode ? `mode-${el.dataset.mode}` : el.id;
      el.disabled = wasDisabled || !allowed.has(key);
    });
    $("comment").readOnly = !(index === 3 && flags.tree && isMainLast(state));
  }
  function update() {
    if (!active || preparing) return;
    const state = app.state();
    clearMarks();
    applyControls(state);
    $("tutorialDock").hidden = index >= steps.length;
    if (index >= steps.length) return;
    const done = completed(state);
    $("btnTutorialNext").disabled = !done;
    $("btnTutorialDockNext").disabled = !done;
    setText("btnTutorialDockNext", index === steps.length - 1 ? "完了へ" : "次へ");
    setText("tutorialDockText", `${index + 1} / ${steps.length}　${steps[index].title}`);
    $("tutorialProgress").value = index + (done ? 1 : 0);
    setText("tutorialFeedback", done ? steps[index].success : notice);
    let hint = "";
    if (done) {
      hint = index === steps.length - 1 ? "「体験を終える」へ進みましょう。" : "できました。「次へ」で進みましょう。";
      mark("#btnTutorialNext");
    } else if (index === 0) {
      hint = moveHelp(firstMove, state); markMove(firstMove);
    } else if (index === 1) {
      hint = `戻る ${flags.navigation.has("prev") ? "✓" : "未体験"}　進む ${flags.navigation.has("next") ? "✓" : "未体験"}　最後へ ${flags.navigation.has("last") ? "✓" : "未体験"}`;
      mark("#editButtons");
    } else if (index === 2) {
      if (state.depth === 6) { hint = "まず「◀」を1回押し、飛車を動かす前の5手目へ戻ります。"; mark("#btnPrev"); }
      else { hint = moveHelp(branchMove, state); markMove(branchMove); }
    } else if (index === 3) {
      if (!flags.tree || !isMainLast(state)) {
        hint = "ツリー右端の「△４二飛」をタップしてください。横に見切れるときはツリーを横へスクロールできます。";
        mark('#tree [aria-label="6手目 △４二飛"]');
      } else {
        hint = "コメント欄をタップして書き換えます。例：飛車を4筋へ。短い言葉で大丈夫です。";
        mark("#comment");
      }
    } else if (steps[index].mode) {
      const expectedMode = steps[index].mode;
      if (state.mode !== expectedMode) {
        hint = `盤の上の「${{ sente: "▲先手", gote: "△後手", both: "両方" }[expectedMode]}」を選びます。`;
        mark(`[data-mode="${expectedMode}"]`);
      } else if (index === 4 && !flags.answer) {
        hint = "最初に「答え」を押し、どの駒を動かすか確認してみましょう。"; mark("#btnAnswer");
      } else if (state.waiting && state.node.children.length === 0) {
        hint = `変化 ${state.done} / ${steps[index].lines} 完了。「次の変化へ」で、残りの枝を試します。`; mark("#btnContinue");
      } else if (state.waiting || (expectedMode !== "both" && (expectedMode === "sente") !== state.position.turn)) {
        hint = "相手の手が自動で進みます。次はあなたの番です。";
      } else {
        hint = moveHelp(state.nextMove, state); markMove(state.nextMove);
      }
    } else if (index === 7) {
      if (!state.settings.hideComments) {
        hint = "設定のチェックをオンにします。体験中に変えた設定は、終了すると元に戻ります。";
        mark("#btnSettings"); mark("#optHideComments");
      } else if ($("settingsDialog").open) {
        hint = "設定の「閉じる」を押し、盤の横（スマホでは下）にあるコメントをめくりましょう。";
        mark("#settingsDialog button.primary");
      } else {
        hint = "「💬 コメントを見る」を押すと、隠していたメモを確認できます。"; mark("#commentCover");
      }
    } else if (index === 8) {
      hint = "「書出」を押すと、この体験用の棋譜だけをダウンロードします。"; mark("#btnExport");
    } else if (index === 9) {
      hint = "練習用ファイルを用意してあるので、ファイルを探さずに読み込みを試せます。"; mark("#btnTutorialImport");
    }
    setText("tutorialHint", hint);
    setText("tutorialStep", `STEP ${index + 1} / ${steps.length}`);
  }
  function enter(next) {
    preparing = true;
    index = next;
    flags = { navigation: new Set() };
    notice = "";
    clearMarks();
    if (index === steps.length) {
      $("tutorialPanel").hidden = true;
      $("tutorialDone").hidden = false;
      remember("completed");
      preparing = false;
      update();
      focusCard("tutorialDone");
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
    setText("tutorialText", steps[index].text);
    $("btnTutorialBack").disabled = index === 0;
    $("btnTutorialImport").hidden = index !== 9;
    $("btnTutorialImport").disabled = false;
    $("btnTutorialNext").textContent = index === steps.length - 1 ? "体験を終える" : "次へ";
    preparing = false;
    update();
    focusCard("tutorialPanel");
  }
  function start() {
    if ($("helpDialog").open) $("helpDialog").close();
    if (active) { focusCard(index === steps.length ? "tutorialDone" : "tutorialPanel"); return; }
    if (app.state().linkedKifPending) return;
    controls = new Map();
    const ids = ["bookSelect", "btnNew", "btnRename", "btnDelete", "btnImport", "btnExport", "btnCut", "btnFirst", "btnPrev", "btnNext", "btnLast", "btnAnswer", "btnContinue", "btnSettings", "btnAccount", "commentCover"];
    ids.map($).concat([...document.querySelectorAll(".modes button")]).filter(Boolean).forEach(el => controls.set(el, el.disabled));
    libraryTabIndex = $("btnLibrary").getAttribute("tabindex");
    $("btnLibrary").setAttribute("aria-disabled", "true");
    $("btnLibrary").tabIndex = -1;
    active = true;
    preparing = true;
    learnedComment = null;
    if (!app.begin(title, mainKif)) { active = false; preparing = false; return; }
    $("tutorialWelcome").hidden = true;
    remember("started");
    enter(0);
  }
  function finish(keep = false) {
    if (!active) return;
    const didComplete = index === steps.length;
    active = false;
    clearMarks();
    controls.forEach((disabled, el) => el.disabled = disabled);
    $("btnLibrary").removeAttribute("aria-disabled");
    if (libraryTabIndex === null) $("btnLibrary").removeAttribute("tabindex");
    else $("btnLibrary").setAttribute("tabindex", libraryTabIndex);
    app.finish(keep);
    $("tutorialPanel").hidden = true;
    $("tutorialDone").hidden = true;
    $("tutorialDock").hidden = true;
    remember(didComplete ? "completed" : "dismissed");
    $("btnTutorial").focus();
    $("btnTutorial").scrollIntoView({ block: "nearest" });
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
      if (!valid) notice = "今の手順の案内に沿って操作してください。「この手順をやり直す」で戻れます。";
      return valid;
    },
    canUseTree() { return !active || index === 3; }
  };
  $("btnTutorial").onclick = start;
  $("btnHelpTutorial").onclick = start;
  $("btnTutorialStart").onclick = start;
  $("btnTutorialDismiss").onclick = () => { $("tutorialWelcome").hidden = true; remember("dismissed"); };
  $("btnTutorialExit").onclick = () => finish();
  $("btnTutorialFinish").onclick = () => finish();
  $("btnTutorialKeep").onclick = () => finish(true);
  $("btnTutorialBack").onclick = () => { if (active && index > 0) enter(index - 1); };
  $("btnTutorialRetry").onclick = () => { if (active) enter(index); };
  $("btnTutorialNext").onclick = () => { if (active && completed(app.state())) enter(index + 1); };
  $("btnTutorialDockNext").onclick = $("btnTutorialNext").onclick;
  $("btnTutorialGuide").onclick = () => focusCard("tutorialPanel");
  $("btnTutorialLocate").onclick = locateControl;
  $("btnTutorialImport").onclick = async () => {
    if (!active || index !== 9) return;
    $("btnTutorialImport").disabled = true;
    try { await app.importSample(fullKif); }
    finally { $("btnTutorialImport").disabled = false; }
  };
  $("btnLibrary").addEventListener("click", e => {
    if (!active) return;
    e.preventDefault();
    notice = "体験を終了すると、元の棋譜の一覧を開けます。";
    update();
  });
  let seen = false;
  try { seen = !!localStorage.getItem(KEY); } catch (e) { /* 初回の案内を表示する */ }
  const initial = app.state();
  $("tutorialWelcome").hidden = seen || initial.hasStoredBooks || initial.arrivedViaKif;
})();
