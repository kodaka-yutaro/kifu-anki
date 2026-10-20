(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const store = window.KifuProblems;
  const source = window.KifuProblemSource;
  const dialog = $("problemDialog");
  let draft = null;
  let lastDestination = "";
  let saving = false;

  function error(text = "") {
    $("problemEditorError").textContent = text;
    $("problemEditorError").hidden = !text;
  }

  function fillDestinations(preferred = "") {
    const select = $("problemDestination");
    select.innerHTML = "";
    const collections = store.load();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = collections.length ? "保存先を選んでください" : "問題集を新規作成してください";
    select.appendChild(placeholder);
    for (const collection of collections) {
      const option = document.createElement("option");
      option.value = collection.id;
      option.textContent = `${collection.title}（${collection.problems.length}問）`;
      select.appendChild(option);
    }
    select.value = collections.some(c => c.id === preferred)
      ? preferred : (collections.length === 1 ? collections[0].id : "");
    $("btnSaveProblem").disabled = !collections.length;
  }

  function refresh() {
    const current = source.current();
    $("problemCreateControls").hidden = !current;
    const enabled = !!(current && current.choices.length);
    $("btnCreateProblem").disabled = !enabled;
    $("problemCreateHint").textContent = enabled
      ? "次の手を本線・分岐から選んで、問題集に保存できます。"
      : "次の手を登録すると、この局面の問題を作れます。";
  }

  function open() {
    const current = source.current();
    if (!current || !current.choices.length) return;
    draft = current;
    error();
    $("problemNewCollectionFields").hidden = true;
    $("problemNewCollectionName").value = "";
    $("problemQuestion").value = "";
    $("problemExplanation").value = draft.explanation;
    $("problemSourceLabel").textContent = `${draft.source.title} · ${draft.source.ply}手目の局面 · ${draft.position.turn ? "先手番" : "後手番"}`;
    const select = $("problemAnswer");
    select.innerHTML = "";
    draft.choices.forEach((move, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      const origin = move.from ? `（${"０１２３４５６７８９"[move.from[0]]}${Shogi.KANJI[move.from[1]]}から）` : "";
      option.textContent = Shogi.label(draft.position, move, draft.source.previousMove && draft.source.previousMove.to)
        + origin + (index === 0 ? "［本線］" : `［分岐${index}］`);
      select.appendChild(option);
    });
    select.value = "0";
    try { fillDestinations(lastDestination); }
    catch (e) { error(e.message); $("btnSaveProblem").disabled = true; }
    dialog.showModal();
    select.focus();
  }

  function createCollection() {
    const name = $("problemNewCollectionName").value.trim();
    if (!name) {
      error("問題集の名前を入力してください。");
      $("problemNewCollectionName").focus();
      return;
    }
    try {
      const collection = store.createCollection(name);
      fillDestinations(collection.id);
      $("problemNewCollectionFields").hidden = true;
      $("problemNewCollectionName").value = "";
      error();
      $("problemDestination").focus();
    } catch (e) { error(e.message); }
  }

  function submit(event) {
    event.preventDefault();
    if (!draft || saving) return;
    const answerValue = $("problemAnswer").value;
    const answerIndex = Number(answerValue);
    if (answerValue === "" || !Number.isInteger(answerIndex) || !draft.choices[answerIndex]) {
      error("正解の一手を分岐から選んでください。");
      return;
    }
    const collectionId = $("problemDestination").value;
    if (!collectionId) {
      error("保存先の問題集を選んでください。");
      $("problemDestination").focus();
      return;
    }
    saving = true;
    $("btnSaveProblem").disabled = true;
    try {
      const collection = store.load().find(c => c.id === collectionId);
      if (!collection) throw new Error("保存先の問題集が見つかりません。保存先を選び直してください。");
      store.addProblem(collectionId, {
        position: draft.position,
        choices: draft.choices,
        answer: draft.choices[answerIndex],
        question: $("problemQuestion").value,
        explanation: $("problemExplanation").value,
        source: draft.source
      });
      lastDestination = collectionId;
      dialog.close();
      source.notice(`「${collection.title}」に次の一手問題を保存しました。「ファイル」から開いて解けます。`, "ok");
    } catch (e) { error(e.message); }
    finally { saving = false; $("btnSaveProblem").disabled = false; }
  }

  $("btnCreateProblem").onclick = open;
  $("problemForm").onsubmit = submit;
  $("btnCancelProblem").onclick = () => dialog.close();
  $("btnNewProblemCollection").onclick = () => {
    $("problemNewCollectionFields").hidden = false;
    $("problemNewCollectionName").focus();
  };
  $("btnCancelNewProblemCollection").onclick = () => {
    $("problemNewCollectionFields").hidden = true;
    error();
    $("btnNewProblemCollection").focus();
  };
  $("btnConfirmNewProblemCollection").onclick = createCollection;
  $("problemNewCollectionName").onkeydown = event => {
    if (event.key === "Enter") { event.preventDefault(); createCollection(); }
  };
  dialog.addEventListener("close", () => { draft = null; error(); refresh(); });
  window.addEventListener("storage", event => {
    if (event.key !== store.KEY || !dialog.open) return;
    const previous = $("problemDestination").value;
    try {
      fillDestinations(previous);
      if (previous && $("problemDestination").value !== previous) {
        $("problemDestination").value = "";
        error("保存先の問題集が変更されました。保存先を選び直してください。");
      }
    } catch (e) { error(e.message); $("btnSaveProblem").disabled = true; }
  });
  window.KifuProblemEditor = { refresh };
  refresh();
})();
