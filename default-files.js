const KifuDefaults = (() => {
  const BOOKS_KEY = "kifu-anki-books-v1";
  const KEY = "kifu-anki-default-files-v1";
  const S = typeof Shogi !== "undefined" ? Shogi : require("./shogi.js");
  const P = typeof KifuProblems !== "undefined" ? KifuProblems : require("./problems-store.js");
  const copy = value => JSON.parse(JSON.stringify(value));
  const SAMPLE_TIME = Date.UTC(2026, 9, 20);
  const SAMPLE_KIF = `手合割：平手
手数----指手---------消費時間--
*初手は角道を開ける▲７六歩が最も多い手です。
   1 ７六歩(77)
   2 ８四歩(83)
*△８四歩は居飛車の意思表示。
   3 ６八銀(79)
*▲６八銀から矢倉を目指します。
   4 ３四歩(33)
   5 ６六歩(67)
*角道を止めて矢倉囲いへ。
   6 ６二銀(71)

変化：3手
   3 ２六歩(27)
*飛車先を突いて相居飛車の力戦へ。
   4 ８五歩(84)
   5 ７七角(88)
*飛車先の歩交換を防ぎます。
   6 ３四歩(33)

変化：2手
   2 ３四歩(33)
*△３四歩は振り飛車も含みにした手。
   3 ２六歩(27)
   4 ４四歩(43)
*角道を止めて振り飛車へ。
   5 ４八銀(39)
   6 ４二飛(82)
*四間飛車。

変化：6手
   6 ３二飛(82)
*三間飛車。
`;

  function sampleBook() {
    return { title: "サンプル：相居飛車と振り飛車の序盤", root: S.parseKIF(SAMPLE_KIF) };
  }

  function problemAt(book, branches, id, question, explanation) {
    let node = book.root, position = S.initial(S.handicapOf(book.root));
    for (const branch of branches) {
      node = node.children[branch];
      position = S.apply(position, node.move);
    }
    return copy({
      id, position,
      choices: node.children.map(child => child.move),
      answer: node.children[0].move,
      question, explanation,
      source: { title: book.title, ply: branches.length, previousMove: node.move || null },
      createdAt: SAMPLE_TIME, updatedAt: SAMPLE_TIME
    });
  }

  function sampleCollection() {
    const book = sampleBook();
    return {
      id: "sample-next-move-basics-v1",
      title: "サンプル：はじめての次の一手",
      createdAt: SAMPLE_TIME, updatedAt: SAMPLE_TIME,
      problems: [
        problemAt(book, [], "sample-open-bishop-diagonal-v1",
          "先手番です。角道を開ける一手を指してください。",
          "▲７六歩と７筋の歩を進めると、８八にいる角の通り道が開きます。まずは駒を選んで、移動先を押してみましょう。"),
        problemAt(book, [0, 0, 1, 0], "sample-defend-rook-pawn-v1",
          "先手番です。相手の飛車先の歩交換に備えるため、角をどこへ動かしますか？",
          "▲７七角と上がると、角が８六の地点を守ります。後手の△８六歩からの歩交換に備える手です。"),
        problemAt(book, [0, 1, 0, 0, 0], "sample-fourth-file-rook-v1",
          "後手番です。四間飛車にするため、飛車を４筋へ振ってください。",
          "△４二飛と飛車を４筋へ動かして四間飛車にします。登録されているもう一つの分岐、△３二飛は三間飛車です。")
      ]
    };
  }

  function state() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === null) return { version: 1 };
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 1 || ["books", "problemCollections"].some(kind =>
        saved[kind] !== undefined && saved[kind] !== "pending" && saved[kind] !== "ready")) throw new Error();
      return saved;
    } catch (e) {
      throw new Error("サンプルの初期設定を読み込めませんでした。ブラウザの保存設定を確認してください。");
    }
  }

  function savedData(raw, kind) {
    if (raw === null) return kind === "books" ? { books: [], current: 0 } : { version: 1, collections: [] };
    try {
      const data = JSON.parse(raw);
      if (kind === "books") return data && Array.isArray(data.books) && data.books.every(book =>
        book && typeof book.title === "string" && book.root && Array.isArray(book.root.children)) ? data : null;
      return data && data.version === 1 && P.validateCollections(data.collections) ? data : null;
    } catch (e) { return null; }
  }

  function ensure() {
    const initialized = state();
    const added = { books: false, problemCollections: false };
    for (const kind of ["books", "problemCollections"]) {
      if (initialized[kind]) continue;
      const isBooks = kind === "books", key = isBooks ? BOOKS_KEY : P.KEY;
      try {
        const raw = localStorage.getItem(key), data = savedData(raw, kind);
        if (!data) continue;
        const list = isBooks ? data.books : data.collections;
        const sample = isBooks ? sampleBook() : sampleCollection();
        // 旧版の空の一覧にも一度だけ用意する。以後の空の一覧は削除済みとして扱う。
        if (!list.length) {
          if (localStorage.getItem(key) !== raw) continue;
          if (isBooks) localStorage.setItem(key, JSON.stringify({ ...data, books: [sample], current: 0 }));
          else if (!P.save([sample], { notify: false })) throw new Error("problem-storage");
          added[kind] = true;
        }
        // データを先に保存する。初期設定の保存に失敗しても、見本を判別して次回再試行できる。
        // 旧版で作った未編集の見本も、最初のクラウド同期で消えないように引き継ぐ。
        initialized[kind] = added[kind] || JSON.stringify(list) === JSON.stringify([sample]) ? "pending" : "ready";
        localStorage.setItem(KEY, JSON.stringify(initialized));
      } catch (e) {
        const name = isBooks ? "棋譜" : "次の一手ブック";
        throw new Error(`サンプルの${name}を保存できませんでした。ブラウザの空き容量や保存設定を確認してください。`);
      }
    }
    return added;
  }

  function pending() {
    const saved = state();
    return { books: saved.books === "pending", problemCollections: saved.problemCollections === "pending" };
  }

  function synced() {
    const saved = state();
    let changed = false;
    for (const kind of ["books", "problemCollections"]) {
      if (saved[kind] !== "pending") continue;
      saved[kind] = "ready";
      changed = true;
    }
    if (changed) localStorage.setItem(KEY, JSON.stringify(saved));
  }

  return { KEY, ensure, pending, synced, sampleBook, sampleCollection };
})();
if (typeof window !== "undefined") window.KifuDefaults = KifuDefaults;
if (typeof module !== "undefined") module.exports = KifuDefaults;
