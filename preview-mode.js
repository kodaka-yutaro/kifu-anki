// This preview uses its own origin and does not load production cloud sync.
for (const button of document.querySelectorAll('#btnAccount, #btnLogin, #btnLogout')) {
  button.disabled = true;
  button.title = '確認版はブラウザ内保存です';
}
