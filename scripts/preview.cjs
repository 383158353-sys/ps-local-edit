// Browser-only layout preview. Photoshop APIs and paid generation are not invoked.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'plugin/index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="panel.css">', '<link rel="stylesheet" href="../plugin/panel.css">');
html = html.replace(/<sp-dropdown id="([^"]+)"[^>]*><sp-menu[^>]*>/g, '<select id="$1">').replace(/<\/sp-menu><\/sp-dropdown>/g, '</select>');
html = html.replace(/<sp-menu-item value="([^"]+)"( selected)?>([^<]+)<\/sp-menu-item>/g, '<option value="$1"$2>$3</option>');
html = html.replace(/<sp-(?:action-button|button)([^>]*)>/g, '<button$1>').replace(/<\/sp-(?:action-button|button)>/g, '</button>');
html = html.replace(/<sp-checkbox([^>]*)>([^<]+)<\/sp-checkbox>/g, '<label><input type="checkbox"$1>$2</label>');
html = html.replace('<script src="main.js"></script>', '<script>document.getElementById("settings-toggle").onclick=()=>{const s=document.getElementById("settings"),e=document.getElementById("editor");const open=s.style.display==="none";s.style.display=open?"block":"none";e.style.display=open?"none":"block";};</script>');
html = html.replace('</head>', '<style>body{width:320px}select,button{font:inherit;color:#f2f2f2;background:#414141;border:1px solid #666;border-radius:4px;padding:7px}select,#generate{width:100%}#generate{background:#ededed;color:#202020;border:0;font-weight:600;padding:10px}button:hover{filter:brightness(1.15)}input[type=checkbox]{width:auto}</style></head>');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/panel-preview.html'), html);
console.log('Browser layout preview written; native UXP rendering remains unverified.');
