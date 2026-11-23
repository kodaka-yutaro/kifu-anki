// アクセス解析（Google アナリティクス 4）。
// GA_ID に測定ID（"G-" で始まる文字列）を入れると、本番ドメインでだけ計測を始める。
// 空のままなら何もしない。ローカル確認や動作確認版（dist/）では計測しない。
(function () {
  var GA_ID = "";
  if (!GA_ID || location.hostname !== "kifu.kdking-tools.com") return;
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", GA_ID);
})();
