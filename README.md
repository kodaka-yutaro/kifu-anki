# 棋譜暗記道場

将棋の定跡をツリーで管理し、盤上で指しながら暗記する練習サイトです（静的サイト / GitHub Pages）。

- `shogi.js`：駒の動き・指し手・KIF の読み書き
- `app.js`：画面（編集・暗記モード、定跡ツリー、コメント）。データはブラウザの localStorage に保存
- サンプル定跡は `app.js` の `SAMPLE_KIF` にあります
- 定跡解説ページ（`joseki/`）は `tools/joseki-data.js` を編集して `node tools/build-joseki.js` で生成します（sitemap.xml も更新）
