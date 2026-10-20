const KifuProblems = (() => {
  const KEY = "kifu-anki-problems-v1";
  const S = typeof Shogi !== "undefined" ? Shogi : require("./shogi.js");
  const copy = value => JSON.parse(JSON.stringify(value));
  const text = value => typeof value === "string";
  const stamp = value => Number.isSafeInteger(value) && value >= 0;
  const square = value => Array.isArray(value) && value.length === 2 && value.every(n => Number.isInteger(n) && n >= 1 && n <= 9);
  const id = value => text(value) && value.trim().length > 0;
  const same = (a, b) => S.moveEq(a, b);

  function validMove(move) {
    return !!move && square(move.to) && (move.from === null || square(move.from)) &&
      (move.promote === undefined || typeof move.promote === "boolean") &&
      (move.from !== null || (S.HAND_ORDER.includes(move.t) && !move.promote));
  }

  function validPosition(pos) {
    if (!pos || typeof pos.turn !== "boolean" || !Array.isArray(pos.sq) || pos.sq.length !== 10 || !pos.hands) return false;
    if (!pos.sq.every(col => Array.isArray(col) && col.length === 10 && col.every(p => p === null ||
      (!!p && Object.hasOwn(S.NAME, p.t) && typeof p.s === "boolean" && typeof p.pr === "boolean")))) return false;
    return [true, false].every(side => pos.hands[side] && S.HAND_ORDER.every(t =>
      Number.isSafeInteger(pos.hands[side][t]) && pos.hands[side][t] >= 0));
  }

  function validChoice(pos, move) {
    if (!validMove(move)) return false;
    if (!move.from) return pos.hands[pos.turn][move.t] > 0 && S.dropTargets(pos, move.t).some(to => S.sameSq(to, move.to));
    const piece = pos.sq[move.from[0]][move.from[1]];
    if (!piece || piece.s !== pos.turn || !S.destinations(pos, ...move.from).some(to => S.sameSq(to, move.to))) return false;
    if (move.promote && !S.canPromote(piece, move.from[1], move.to[1])) return false;
    return piece.pr || !S.mustPromote(piece, move.to[1]) || !!move.promote;
  }

  function validProblem(problem) {
    if (!problem || !id(problem.id) || !stamp(problem.createdAt) || !stamp(problem.updatedAt) ||
      !text(problem.question) || !text(problem.explanation) || !validPosition(problem.position) ||
      !Array.isArray(problem.choices) || !problem.choices.length || !validMove(problem.answer)) return false;
    if (!problem.choices.every(move => validChoice(problem.position, move)) ||
      !problem.choices.some(move => same(move, problem.answer))) return false;
    const source = problem.source;
    return !!source && text(source.title) && Number.isSafeInteger(source.ply) && source.ply >= 0 &&
      (source.previousMove === null || validMove(source.previousMove));
  }

  function validateCollections(collections) {
    try {
      if (!Array.isArray(collections)) return false;
      const ids = new Set();
      return collections.every(collection => {
        if (!collection || !id(collection.id) || ids.has(collection.id) || !text(collection.title) || !collection.title.trim() ||
          !stamp(collection.createdAt) || !stamp(collection.updatedAt) || !Array.isArray(collection.problems)) return false;
        ids.add(collection.id);
        const problemIds = new Set();
        return collection.problems.every(problem => {
          if (!validProblem(problem) || problemIds.has(problem.id)) return false;
          problemIds.add(problem.id);
          return true;
        });
      });
    } catch (e) { return false; }
  }

  function load() {
    let raw;
    try { raw = localStorage.getItem(KEY); }
    catch (e) { throw new Error("問題集を読み込めませんでした。ブラウザの保存設定を確認してください。"); }
    if (raw === null || raw === "") return [];
    try {
      const data = JSON.parse(raw);
      if (!data || data.version !== 1 || !validateCollections(data.collections)) throw new Error();
      return data.collections;
    } catch (e) { throw new Error("保存された問題集を読み込めませんでした。データを上書きせず処理を中止しました。"); }
  }

  function save(collections, { notify = true } = {}) {
    if (!validateCollections(collections)) return false;
    try {
      load();
      localStorage.setItem(KEY, JSON.stringify({ version: 1, collections }));
    } catch (e) { return false; }
    if (notify && typeof window !== "undefined" && window.onKifuSaved) window.onKifuSaved();
    return true;
  }

  function persist(collections) {
    if (!save(collections)) throw new Error("問題集を保存できませんでした。ブラウザの空き容量や保存設定を確認してください。");
  }

  function newId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  const now = previous => Math.max(Date.now(), (previous || 0) + 1);
  function titleOf(title) {
    if (!text(title) || !title.trim()) throw new Error("問題集の名前を入力してください。");
    return title.trim();
  }
  function findCollection(collections, collectionId) {
    const collection = collections.find(item => item.id === collectionId);
    if (!collection) throw new Error("保存先の問題集が見つかりません。問題集を選び直してください。");
    return collection;
  }

  function createCollection(title) {
    const collections = load();
    const time = now();
    const collection = { id: newId(), title: titleOf(title), createdAt: time, updatedAt: time, problems: [] };
    collections.push(collection);
    persist(collections);
    return copy(collection);
  }

  function addProblem(collectionId, fields) {
    const collections = load();
    const collection = findCollection(collections, collectionId);
    const time = now(collection.updatedAt);
    const problem = copy({ ...fields, question: fields.question ?? "", explanation: fields.explanation ?? "", id: newId(), createdAt: time, updatedAt: time });
    if (!validProblem(problem)) throw new Error("正解手と局面を確認してください。正解は登録された分岐から選んでください。");
    collection.problems.push(problem);
    collection.updatedAt = time;
    persist(collections);
    return copy(problem);
  }

  function updateProblem(collectionId, problemId, fields) {
    const collections = load();
    const collection = findCollection(collections, collectionId);
    const index = collection.problems.findIndex(problem => problem.id === problemId);
    if (index < 0) throw new Error("問題が見つかりません。問題集を開き直してください。");
    const old = collection.problems[index];
    const time = now(Math.max(old.updatedAt, collection.updatedAt));
    const problem = copy({ ...old, ...fields, id: old.id, createdAt: old.createdAt, updatedAt: time });
    if (!validProblem(problem)) throw new Error("問題の内容を保存できません。正解手と局面を確認してください。");
    collection.problems[index] = problem;
    collection.updatedAt = time;
    persist(collections);
    return copy(problem);
  }

  function removeProblem(collectionId, problemId) {
    const collections = load();
    const collection = findCollection(collections, collectionId);
    const index = collection.problems.findIndex(problem => problem.id === problemId);
    if (index < 0) throw new Error("問題が見つかりません。問題集を開き直してください。");
    collection.problems.splice(index, 1);
    collection.updatedAt = now(collection.updatedAt);
    persist(collections);
  }

  function removeCollection(collectionId) {
    const collections = load();
    findCollection(collections, collectionId);
    persist(collections.filter(collection => collection.id !== collectionId));
  }

  function renameCollection(collectionId, title) {
    const collections = load();
    const collection = findCollection(collections, collectionId);
    collection.title = titleOf(title);
    collection.updatedAt = now(collection.updatedAt);
    persist(collections);
    return copy(collection);
  }

  function mergeCollections(base, extra) {
    if (!validateCollections(base) || !validateCollections(extra)) throw new Error("問題集のデータ形式を確認してください。");
    const merged = new Map(copy(base).map(collection => [collection.id, collection]));
    for (const incoming of copy(extra)) {
      const current = merged.get(incoming.id);
      if (!current) { merged.set(incoming.id, incoming); continue; }
      const problems = new Map(current.problems.map(problem => [problem.id, problem]));
      for (const problem of incoming.problems) {
        const previous = problems.get(problem.id);
        if (!previous || problem.updatedAt >= previous.updatedAt) problems.set(problem.id, problem);
      }
      const latest = incoming.updatedAt >= current.updatedAt ? incoming : current;
      merged.set(incoming.id, { ...latest, problems: [...problems.values()] });
    }
    return [...merged.values()];
  }

  return { KEY, load, save, createCollection, addProblem, updateProblem, removeProblem, removeCollection, renameCollection, validateCollections, mergeCollections };
})();
if (typeof window !== "undefined") window.KifuProblems = KifuProblems;
if (typeof module !== "undefined") module.exports = KifuProblems;
