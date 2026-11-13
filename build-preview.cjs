const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const out = path.join(root, 'dist');
fs.mkdirSync(out, {recursive:true});
const source = fs.readdirSync(root, {withFileTypes:true});
for (const entry of source) {
  if (entry.isFile() && /\.(html|js|css)$/.test(entry.name) && entry.name !== 'sync.js') {
    let text = fs.readFileSync(path.join(root,entry.name),'utf8');
    if (entry.name.endsWith('.html')) {
      text = text.replace(/<script type="module" src="sync\.js[^"]*"><\/script>/g, '<script src="preview-mode.js"></script>');
      text = text.replace(/<body([^>]*)>/, '<body$1><div class="preview-banner"><b>棋譜暗記道場・動作確認版</b><br>この確認版のデータはこのブラウザに保存されます。棋譜は「読込」から取り込めます。</div>');
      text = text.replace('<head>', '<head>\n<meta name="robots" content="noindex,nofollow">');
      text = text.replace(/<title>(.*?)<\/title>/, '<title>$1｜動作確認版</title>');
    }
    fs.writeFileSync(path.join(out,entry.name),text);
  }
}
for (const name of ['fonts','joseki']) fs.cpSync(path.join(root,name),path.join(out,name),{recursive:true});
console.log('Built isolated browser-local preview in dist/');
