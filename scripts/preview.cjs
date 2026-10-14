// Browser-only preview: the production controller runs with isolated in-memory
// Photoshop/UXP doubles. No paid API, saved credentials, or real documents are used.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
let html=fs.readFileSync(path.join(root,'plugin/index.html'),'utf8');
html=html.replace('href="panel.css"','href="../plugin/panel.css"');
html=html.replace(/<sp-dropdown id="([^"]+)"[^>]*><sp-menu[^>]*>/g,'<select id="$1">').replace(/<\/sp-menu><\/sp-dropdown>/g,'</select>');
html=html.replace(/<sp-menu-item value="([^"]+)"( selected)?>([^<]+)<\/sp-menu-item>/g,'<option value="$1"$2>$3</option>');
html=html.replace(/<sp-checkbox([^>]*)>([^<]+)<\/sp-checkbox>/g,'<label><input type="checkbox"$1>$2</label>');
const modules=['ui-controls','api','model-policy','dropdown','platform-models','platform-schema','platform-profiles','model-catalog','task-queue','png','lib/fflate','modules/geometry','prompt-editor'];
const bundle=modules.map(id=>`factories[${JSON.stringify('./'+id)}]=function(module,exports,require){\n${fs.readFileSync(path.join(root,'plugin',id+'.js'),'utf8')}\n};`).join('\n');

const runtime=fs.readFileSync(path.join(root,'scripts/preview-runtime.js'),'utf8');
let main=fs.readFileSync(path.join(root,'plugin/main.js'),'utf8');

const script=`(function(){const factories={},cache={};${bundle}\n${runtime}\n${main}\n})();`;
html=html.replace('<script src="main.js"></script>',()=>`<script>${script.replace(/<\/script/gi,'<\\/script')}</script>`);
html=html.replace('</head>',`<style>
body{width:100%;margin:0 auto}input[type=checkbox]{width:auto}.preview-banner{padding:6px 16px;color:#9ea8b8;font-size:10px;background:#1c1e21}.preview-banner a{color:#a8c9f7}
</style></head>`);
html=html.replace('<body><main>','<body><div class="preview-banner">界面预览 · 使用模拟数据 · 不连接 Photoshop 或生图接口　<a href="?empty">空状态</a> / <a href="?demo">任务状态</a></div><main>');
fs.mkdirSync(path.join(root,'dist'),{recursive:true});fs.writeFileSync(path.join(root,'dist/panel-preview.html'),html);
console.log('Preview updated with the production UI controller and isolated sample data.');
