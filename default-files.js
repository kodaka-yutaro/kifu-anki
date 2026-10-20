const KifuDefaults = (() => {
  const BOOKS_KEY = "kifu-anki-books-v1";
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
    let node = book.root, position = S.initial();
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

  function ensure() {
    let needBooks, needProblems;
    try {
      needBooks = localStorage.getItem(BOOKS_KEY) === null;
      needProblems = localStorage.getItem(P.KEY) === null;
    } catch (e) {
      throw new Error("サンプルを用意できませんでした。ブラウザの保存設定を確認してください。");
    }
    const added = { books: false, problemCollections: false };
    // 空の保存データは削除済みとして扱い、初期サンプルを復活させない。
    if (needBooks) {
      try {
        const data = { books: [sampleBook()], current: 0 };
        if (localStorage.getItem(BOOKS_KEY) === null) {
          localStorage.setItem(BOOKS_KEY, JSON.stringify(data));
          added.books = true;
        }
      } catch (e) {
        throw new Error("サンプルの棋譜を保存できませんでした。ブラウザの空き容量や保存設定を確認してください。");
      }
    }
    if (needProblems) {
      try {
        const collections = [sampleCollection()];
        if (localStorage.getItem(P.KEY) === null) {
          if (!P.save(collections, { notify: false })) throw new Error("problem-storage");
          added.problemCollections = true;
        }
      } catch (e) {
        throw new Error("サンプルの次の一手ブックを保存できませんでした。ブラウザの空き容量や保存設定を確認してください。");
      }
    }
    return added;
  }

  return { ensure, sampleBook, sampleCollection };
})();
if (typeof window !== "undefined") window.KifuDefaults = KifuDefaults;
if (typeof module !== "undefined") module.exports = KifuDefaults;
