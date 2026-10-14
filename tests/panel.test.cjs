const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const api = require('../plugin/api');
const {TaskQueue}=require('../plugin/task-queue');const {pngRGBA}=require('../plugin/png');

function harness({ switchDocument = false, reopenSameDocument = false, reopenPathless = false, submissionFails = false, shrinkUpload = false, apiModels = null, modelSyncFails = false, balanceGate = null, balanceFails = false, nativeDropdownValue = false, savedLocal = [] } = {}) {
  const apiCalls=[];let notification; const action={addNotificationListener:async(_events,listener)=>{notification=listener;}};
  const nodes = {}, local = new Map(savedLocal), calls = [], writes = [], requests = [], reads = [], docEvents = {}, helperCalls=[];let reloads=0, imageDecodes=0,secureKey='test-key';
  function makeNode(id='') { const node={id,value:id==='prompt'?'改成红色':id==='model'?'banana-2':'',textContent:'',hidden:false,style:{},children:[],attributes:{},className:'',classList:{add(){},remove(){}},addEventListener(event,fn){this[event]=fn;},setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];},append(...items){for(const item of items)this.appendChild(item);},appendChild(item){item.parentNode=this;this.children.push(item);if(item.id.startsWith('model-param-'))nodes[item.id]=item;},removeChild(item){this.children=this.children.filter(child=>child!==item);item.parentNode=null;},focus(){document.activeElement=this;},replaceChildren(...items){this.children=[];this.append(...items);},get parentElement(){return makeNode('parent');}};Object.defineProperty(node,'innerHTML',{get(){return '';},set(value){if(value==='')this.children=[];}});if(['model','quality','output-size','count','model-filter'].includes(id)){
   if(['count','model-filter'].includes(id)){const menu={children:(id==='count'?['1','2','3','4']:['image','favorites','all']).map(value=>{const item=makeNode('sp-menu-item');item.setAttribute('value',value);return item;})};node.children.push(menu);}
   let value=node.value;Object.defineProperty(node,'value',{get(){return nativeDropdownValue?(id==='model'?'banana-2':'stale display label'):(node.children[0]?.children?.[node.selectedIndex]?.attributes.value??value);},set(next){value=next;if(nativeDropdownValue)return;const options=node.children[0]?.children||[];const index=options.findIndex(n=>n.attributes.value===next);if(index>=0)node.selectedIndex=index;}});
  }return node; }
  const document = { readyState: 'interactive', addEventListener(event,fn) {docEvents[event]=fn;}, createElement: tag=>makeNode(tag), getElementById(id) { return nodes[id] ||= makeNode(id); },querySelectorAll(){return [];} };
  document.body=makeNode('body');
  function choose(id,value){const node=document.getElementById(id);node.click({target:node,stopPropagation(){}});const row=findNode(document.body,n=>n.className==='choice-row'&&n.attributes['data-value']===String(value));assert.ok(row,'Missing choice '+id+': '+value);row.click({target:row,preventDefault(){},stopPropagation(){}});}
  function choices(id){const node=document.getElementById(id);node.click({target:node,stopPropagation(){}});const rows=findNodes(document.body,n=>n.className==='choice-row');require('../plugin/dropdown').closeChoices(document);return rows;}
  const originalDoc = { id: 12, name: 'sample.psd', path: 'C:/project/sample.psd', width: 1000, height: 800, mode: 'RGB', selection: { bounds: {left:150,top:120,right:350,bottom:240} } };
  const app = { activeDocument: originalDoc };
  const bounds = { left: 120, top: 90, right: 420, bottom: 290, width: 300, height: 200 };
  const mask = { width: 300, height: 200, components: 1, imageData: new Uint8Array(60000) };
  const capture = { bounds, maskData: mask, documentWidth:1000,documentHeight:800,context: { documentId: 12, documentName: 'sample.psd', documentPath:reopenPathless?'':'C:/project/sample.psd', originalBounds: { left: 150, top: 120, right: 350, bottom: 240 } }, imageData: { sourceBounds: bounds, imageData: { width: 300, height: 200, components:4,getData:async()=>new Uint8Array(300*200*4), dispose() {} } } };
  const ps = { getSelectionBounds:async()=>({left:150,top:120,right:350,bottom:240,width:200,height:120}),captureSelection: async () => ({...capture,imageData:{sourceBounds:bounds,imageData:{width:300,height:200,components:4,getData:async()=>new Uint8Array(300*200*4),dispose(){}}}}), placeBack: async (...args) => calls.push(args) };
  const dataWrites=[];const dataFiles=new Map();const folder={createFile:async name=>({write:async value=>{dataWrites.push(name);dataFiles.set(name,value);}}),getEntry:async name=>{reads.push(name);return {read:async()=>dataFiles.get(name)};}};
  const storage = { formats: { binary: 'binary' }, secureStorage: { getItem: async () => new Uint8Array(Buffer.from(secureKey)),setItem:async(_name,value)=>{secureKey=value;} }, localFileSystem: { getDataFolder:async()=>folder,getTemporaryFolder: async () => ({ createFile: async () => ({ write: async value => writes.push(value) }) }), createSessionToken: () => 'session-token' } };
  const fetch = async (url, options) => {
    if(url.includes('127.0.0.1:17402/annotate/')){helperCalls.push({url,options});return {ok:true,json:async()=>url.includes('/open')?{id:'test-annotation'}:{state:'waiting'}};}
    if(url.endsWith('/v1/skills/balance')){apiCalls.push(url);if(balanceGate)await balanceGate;if(balanceFails)throw new Error('network lost');return {ok:true,json:async()=>({balance:1})};}
    if(url.endsWith('/v1/skills/models')){apiCalls.push(url);if(modelSyncFails)throw new Error('network lost');return {ok:true,json:async()=>({data:apiModels||api.MODELS})};}
    if (url.endsWith('/generate')) { requests.push(JSON.parse(options.body)); if (submissionFails) throw new Error('connection lost'); return { ok: true, json: async () => ({ task_id: requests.length===1?'existing-task':'task-'+requests.length }) }; }
    if (switchDocument) app.activeDocument = { ...originalDoc, id: 99, path:'C:/project/other.psd' };
    if (reopenSameDocument) app.activeDocument = { ...originalDoc, id: 99 };
    if (reopenPathless) app.activeDocument = { ...originalDoc, id: 99, path:'C:/project/sample.psd' };
    return { ok: true, json: async () => ({ is_final: true, state: 'success', result_url: 'data:image/png;base64,YWJj' }) };
  };
  class Client extends api.MediaClient { constructor(key) { super(key, fetch); } }
  const context = { document, location:{reload:()=>{reloads++;}}, localStorage: { getItem: k => local.get(k) || null, setItem: (k, v) => local.set(k, v), removeItem: k => local.delete(k) }, setTimeout, clearTimeout, Uint8Array, console, fetch, require(name) {
    if (name === 'photoshop') return { app, action, imaging: { encodeImageData: async () => 'YWJj' }, constants: { DocumentMode: { RGB: 'RGB' } } };
    if (name === 'uxp') return { storage };
    if (name === './modules/ps') return ps;if(name==='./modules/geometry')return require('../plugin/modules/geometry');
    if(name==='./ui-controls')return require('../plugin/ui-controls');if(name==='./model-policy')return require('../plugin/model-policy');if(name==='./prompt-editor')return require('../plugin/prompt-editor');if(name==='./voice'){const Base=require('../plugin/voice').VoiceController;return {VoiceController:class extends Base{constructor(options){super({...options,fetchImpl:fetch});}}};}if(name==='./platform-profiles')return require('../plugin/platform-profiles');if(name==='./dropdown')return require('../plugin/dropdown');if(name==='./model-catalog')return require('../plugin/model-catalog');if(name==='./task-queue')return {TaskQueue};if(name==='./png'){const png=require('../plugin/png');return shrinkUpload?{...png,uploadPNG:async()=>({encoded:png.pngRGBA(150,100,new Uint8Array(150*100*4)),width:150,height:100,originalWidth:300,originalHeight:200,resized:true})}:png;}
    if (name === './modules/fs') return { arrayBufferToBase64:v=>Buffer.from(v).toString('base64'), base64ToArrayBuffer: v => {imageDecodes++;return Uint8Array.from(Buffer.from(v, 'base64')).buffer;} };
    if (name === './api') return { ...api, MediaClient: Client };
    throw new Error(name);
  } };
  vm.runInNewContext(fs.readFileSync('plugin/main.js', 'utf8'), context);
  // init loads saved prompt; restore the user's entry for this run.
  nodes.prompt ||= document.getElementById('prompt');nodes.prompt.value = '改成红色';
  document.getElementById('quality'); document.getElementById('output-size');
  return { document,app,notify:()=>notification?.(),choices,apiCalls,node:id=>document.getElementById(id),select:choose,selected:id=>require('../plugin/dropdown').readChoice(document.getElementById(id)),openHistory:id=>context.openHistory(id),dataWrites,refreshTasks:()=>context.tasksUI(),nodes, docEvents, calls, writes, reads, local, capture, requests, helperCalls, saveAnnotation:image=>context.saveAnnotation(image), get reloads(){return reloads;}, get imageDecodes(){return imageDecodes;}, ready:async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));nodes.prompt.value='改成红色';} };
}


test('selection uses lossless PNG and does not submit a task',async()=>{const h=harness();await h.ready();await h.nodes['capture-selection'].click();assert.match(h.nodes.preview.src,/^data:image\/png/);assert.equal(h.requests.length,0);});
test('clicking source annotation sends its image to the local editor',async()=>{const h=harness();await h.ready();await h.nodes['capture-selection'].click();await h.nodes['annotate-source'].click();assert.equal(h.helperCalls[0].options.method,'POST');assert.match(h.helperCalls[0].options.body,/data:image/);h.saveAnnotation('data:image/png;base64,YWJj');});
test('saved annotation replaces the source image used for generation',async()=>{const h=harness();await h.ready();await h.nodes['capture-selection'].click();h.nodes['annotate-source'].click();const image='data:image/png;base64,YWJj';h.saveAnnotation(image);await h.ready();assert.equal(h.nodes.preview.src,image);await h.nodes.generate.click();await h.ready();assert.equal(h.requests[0].params.images[0],image);});
test('dropping UXP and browser files adds numbered reference images',async()=>{
 const h=harness();await h.ready();
 const drop=h.nodes['images-row'].drop;
 await drop({preventDefault(){},dataTransfer:{uxpEntries:[{name:'第一张.png',read:async()=>Uint8Array.from([1,2,3]).buffer}]}});
 await drop({preventDefault(){},dataTransfer:{files:[{name:'第二张.jpg',size:3,arrayBuffer:async()=>Uint8Array.from([4,5,6]).buffer}]}});
 const tiles=h.nodes['reference-thumbs'].children;
 assert.equal(tiles.length,2);
 assert.equal(tiles[0].children[0].textContent,'2');
 assert.equal(tiles[1].children[0].textContent,'3');
 assert.equal(tiles[0].children[2].textContent,'第一张.png');
 assert.equal(tiles[1].children[2].textContent,'第二张.jpg');
 await h.nodes['capture-selection'].click();
 assert.equal(h.nodes['reference-thumbs'].children.length,2);
});
test('dragging a reference thumbnail changes the submitted image order',async()=>{
 const h=harness();await h.ready();await h.nodes['capture-selection'].click();
 await h.nodes['images-row'].drop({preventDefault(){},dataTransfer:{files:[
  {name:'A.png',size:1,arrayBuffer:async()=>Uint8Array.from([1]).buffer},
  {name:'B.png',size:1,arrayBuffer:async()=>Uint8Array.from([2]).buffer}
 ]}});
 const tiles=h.nodes['reference-thumbs'].children;
 tiles[0].mousedown({button:0,target:tiles[0],clientX:10,clientY:10,preventDefault(){}});
 h.docEvents.mousemove({target:tiles[1],clientX:40,clientY:10});
 h.docEvents.mouseup();
 assert.equal(h.nodes['reference-thumbs'].children[0].children[2].textContent,'B.png');
 h.nodes.prompt.value='调整房间陈设';
 await h.nodes.generate.click();await h.ready();
 assert.ok(h.requests[0],h.nodes.status.textContent);
 assert.deepEqual(h.requests[0].params.images.slice(1),['data:image/png;base64,Ag==','data:image/png;base64,AQ==']);
});
test('invalid mixed file drop does not leave a partial reference list',async()=>{
 const h=harness();await h.ready();
 await h.nodes['images-row'].drop({preventDefault(){},dataTransfer:{files:[
  {name:'valid.png',size:1,arrayBuffer:async()=>Uint8Array.from([1]).buffer},
  {name:'invalid.txt',size:1,arrayBuffer:async()=>Uint8Array.from([2]).buffer}
 ]}});
 assert.equal(h.nodes['reference-thumbs'].children.length,0);
 assert.match(h.nodes.status.textContent,/PNG、JPG 或 WebP/);
});
test('generation releases editor and never auto imports results',async()=>{const h=harness();await h.ready();await h.nodes.generate.click();await h.ready();assert.equal(h.requests.length,1);assert.equal(h.calls.length,0);assert.equal(h.nodes.generate.disabled,false);assert.ok(JSON.parse(h.local.get('lk888-jobs'))[0].tasks[0].results.length);});
test('reload button saves the current editor and reloads without resubmitting',async()=>{const h=harness();await h.ready();await h.nodes['tab-edit'].click();h.nodes.prompt.value='保留这个提示词';await h.nodes['reload-panel'].click();assert.equal(h.reloads,1);assert.equal(JSON.parse(h.local.get('lk888-jobs'))[0].prompt,'保留这个提示词');assert.equal(h.local.get('lk888-reload-job-id'),JSON.parse(h.local.get('lk888-jobs'))[0].id);assert.equal(h.requests.length,0);});
test('automatic generation size and ratio follow the selected region',async()=>{const h=harness();await h.ready();await h.nodes.generate.click();await h.ready();assert.equal(h.requests[0].params.imageSize,'1K');assert.equal(h.requests[0].params.aspectRatio,'16:9');});
test('another region can submit while previous task remains in history',async()=>{const h=harness();await h.ready();await h.nodes.generate.click();await h.ready();await h.nodes['capture-selection'].click();h.nodes.prompt.value='修改另一区域';await h.nodes.generate.click();await h.ready();assert.equal(h.requests.length,2);assert.equal(JSON.parse(h.local.get('lk888-jobs')).length,2);assert.equal(h.calls.length,0);});
test('model quality aspect and four tasks are preserved',async()=>{const h=harness();await h.ready();h.select('count','4');h.select('quality','2K');h.select('output-size','16:9');await h.nodes.generate.click();await h.ready();assert.equal(h.requests.length,4);assert.equal(h.requests[0].params.imageSize,'2K');assert.equal(h.requests[0].params.aspectRatio,'16:9');assert.equal(h.calls.length,0);});

function findNode(root,predicate){if(predicate(root))return root;for(const child of root.children||[]){const match=findNode(child,predicate);if(match)return match;}return null;}
function findNodes(root,predicate){return [...(predicate(root)?[root]:[]),...(root.children||[]).flatMap(child=>findNodes(child,predicate))];}
function button(root,label){const found=findNode(root,node=>(node.id==='button'||node.attributes?.role==='button')&&((node.textContent||'').includes(label)||(node.title||'').includes(label)||(node.attributes?.['aria-label']||'').includes(label)));assert.ok(found,`Missing button: ${label}`);return found;}

test('completed result stays visible as a card with an add-layer button after reopening history',async()=>{
 const h=harness();await h.ready();await h.nodes.generate.click();await h.ready();
 const root=h.nodes['task-content'];
 assert.equal(findNodes(root,node=>node.className==='task-result').length,1);
 assert.equal(root.children.filter(node=>node.className==='task-result').length,1);
 assert.ok(button(root,'添加图层'));
 await h.nodes['tab-tasks'].click();await button(root,'局部改图 1').onclick();await h.ready();
 assert.equal(findNodes(root,node=>node.className==='task-result').length,1);
});

test('result actions use compact icons with clear accessible names below the image',async()=>{
 const h=harness();await h.ready();await h.nodes.generate.click();await h.ready();
 const card=findNode(h.nodes['task-content'],node=>node.className==='task-result');
 assert.equal(card.children[0].id,'span');
 assert.equal(card.children[1].id,'img');
 assert.equal(card.children[2].className,'task-actions');
 assert.equal(card.children[3].className,'task-caption');
 assert.equal(button(card,'添加图层').textContent,'添加图层');
 assert.equal(button(card,'放大预览').textContent,'⤢');
 assert.equal(button(card,'保存原图').textContent,'⇩');
});

test('completed candidate can be added repeatedly with subtle feather inside the selection',async()=>{
 const h=harness();await h.ready();await h.nodes.generate.click();await h.ready();
 const readsBefore=h.reads.length;
 await button(h.nodes['task-content'],'添加图层').onclick();await h.ready();
 assert.equal(h.calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][2])),h.capture.bounds);
 assert.equal(h.calls[0][4].enabled,true);assert.equal(h.calls[0][4].bias,-1);assert.equal(h.calls[0][4].maxRadius,3);
 await button(h.nodes['task-content'],'再次添加').onclick();await h.ready();
 assert.equal(h.calls.length,2);assert.deepEqual(JSON.parse(JSON.stringify(h.calls[1][2])),h.capture.bounds);assert.equal(h.requests.length,1);
 assert.equal(h.imageDecodes,1);
 assert.equal(h.reads.length,readsBefore);
});
test('candidate cannot be inserted into a different Photoshop document',async()=>{const h=harness({switchDocument:true});await h.ready();await h.nodes.generate.click();await h.ready();await button(h.nodes['task-content'],'添加图层').onclick();await h.ready();assert.equal(h.calls.length,0);assert.match(h.nodes.status.textContent,/同一个 PSD/);});
test('history result can be inserted after reopening the same saved PSD',async()=>{const h=harness({reopenSameDocument:true});await h.ready();await h.nodes.generate.click();await h.ready();await button(h.nodes['task-content'],'添加图层').onclick();await h.ready();assert.equal(h.calls.length,1);});
test('older pathless history can use the matching document name and canvas size',async()=>{const h=harness({reopenPathless:true});await h.ready();await h.nodes.generate.click();await h.ready();await button(h.nodes['task-content'],'添加图层').onclick();await h.ready();assert.equal(h.calls.length,1);});
test('history list appears in the native results panel',async()=>{const h=harness();await h.ready();await h.nodes.generate.click();await h.ready();await h.nodes['tab-tasks'].click();assert.ok(button(h.nodes['task-content'],'局部改图 1'));});
test('history restores prompt and generation options in the same editor',async()=>{const h=harness();await h.ready();h.select('quality','2K');h.select('output-size','3:4');await h.nodes.generate.click();await h.ready();await h.nodes['tab-edit'].click();assert.equal(h.nodes.prompt.value,'');await h.nodes['tab-tasks'].click();await button(h.nodes['task-content'],'局部改图 1').onclick();await h.ready();assert.equal(h.nodes.prompt.value,'改成红色');assert.equal(h.selected('quality'),'2K');assert.equal(h.selected('output-size'),'3:4');assert.equal(h.nodes.editor.style.display,'block');assert.equal(h.nodes['panel-title'].textContent,'局部改图 1 · 已完成');});
test('deleting selected history removes the record and clears the active image',async()=>{const h=harness();await h.ready();await h.nodes.generate.click();await h.ready();await h.nodes['tab-tasks'].click();await button(h.nodes['task-content'],'删除').onclick();assert.equal(JSON.parse(h.local.get('lk888-jobs')).length,0);assert.equal(h.requests.length,1);assert.equal(h.calls.length,0);assert.equal(h.nodes['preview-box'].style.display,'none');assert.equal(h.nodes.prompt.value,'');});
test('clearing history requires a second click and resets the next number',async()=>{
 const h=harness();await h.ready();await h.nodes.generate.click();await h.ready();await h.nodes['tab-tasks'].click();
 button(h.nodes['task-content'],'清空历史记录').onclick();
 assert.equal(JSON.parse(h.local.get('lk888-jobs')).length,1);
 await button(h.nodes['task-content'],'确认清空全部记录').onclick();
 assert.equal(JSON.parse(h.local.get('lk888-jobs')).length,0);
 assert.equal(h.nodes['tab-tasks'].textContent,'历史记录 (0)');
 await h.nodes['tab-edit'].click();
 assert.equal(JSON.parse(h.local.get('lk888-jobs'))[0].number,1);
 assert.equal(h.requests.length,1);
});
test('single history deletion renumbers remaining records',async()=>{
 const h=harness();await h.ready();await h.nodes.generate.click();await h.ready();await h.nodes['tab-edit'].click();await h.nodes['tab-tasks'].click();
 await button(h.nodes['task-content'],'删除').onclick();
 const jobs=JSON.parse(h.local.get('lk888-jobs'));assert.equal(jobs.length,1);assert.equal(jobs[0].number,1);assert.equal(jobs[0].title,'局部改图 1');
});

test('downscaled input scales prompt coordinates while preserving original placement',async()=>{
 const h=harness({shrinkUpload:true});await h.ready();await h.nodes.generate.click();await h.ready();
 assert.match(h.requests[0].prompt,/15,15,115,75/);
 const result=findNode(h.nodes['task-content'],node=>node.id==='img');assert.ok(result);await result.onclick();
 assert.equal(h.calls[0][2].width,300);assert.equal(h.calls[0][2].height,200);
});
test('saving an unchanged selection does not rewrite its mask or image snapshot',async()=>{
 const h=harness();await h.ready();await h.nodes['capture-selection'].click();
 const count=h.dataWrites.length;await h.nodes['reload-panel'].click();await h.nodes['reload-panel'].click();
 assert.equal(h.dataWrites.length,count);
});
test('unchanged queue notifications preserve the result card DOM',async()=>{
 const h=harness();await h.ready();await h.nodes.generate.click();await h.ready();
 const first=h.nodes['task-content'].children[0];h.refreshTasks();h.refreshTasks();assert.equal(h.nodes['task-content'].children[0],first);
});
test('task cards use lightweight thumbnails and show the state separately',async()=>{
 const h=harness();await h.ready();await h.nodes['capture-selection'].click();
 const card=h.nodes['document-tabs'].children[0];
 const thumb=findNode(card,n=>n.className==='tab-thumbnail');assert.ok(thumb);
 assert.notEqual(thumb.src,h.nodes.preview.src);
 assert.equal(Buffer.from(thumb.src.split(',')[1],'base64').readUInt32BE(16),96);
 assert.ok(findNode(card,n=>n.className==='tab-state state-draft'&&n.textContent==='待生成'));
 assert.equal(card.attributes.role,'button');assert.equal(card.attributes['aria-pressed'],'true');
});
test('keyboard task switching restores the saved input and closing keeps history',async()=>{
 const h=harness();await h.ready();await h.nodes['capture-selection'].click();
 h.nodes.prompt.value='第一个区域';await h.nodes['tab-edit'].click();
 let first=h.nodes['document-tabs'].children[0];
 await first.keydown({target:first,key:'Enter',preventDefault(){}});await h.ready();
 assert.equal(h.nodes.preview.style.display,'block');
 first=h.nodes['document-tabs'].children[0];
 const close=findNode(first,n=>n.className==='tab-close');
 await close.click({preventDefault(){},stopPropagation(){}});await h.ready();
 const jobs=JSON.parse(h.local.get('lk888-jobs'));assert.equal(jobs.length,2);assert.ok(jobs.some(j=>j.closed));
});
test('explicit sync adds new API models, preserves the selected ID and applies its parameters',async()=>{
 const h=harness({apiModels:[{id:'banana-2'},{id:'studio-new',capabilities:{image_input:true,image_generation:true},parameters:{resolution:{enum:['2K']},ratio:{enum:['1:1']}}}]});
 await h.ready();await h.nodes['refresh-models'].click();const options=h.choices('model');
 assert.ok(options.some(n=>n.attributes['data-value']==='studio-new'));
 h.select('model','studio-new');await h.nodes.generate.click();await h.ready();
 assert.equal(h.requests[0].model,'studio-new');assert.equal(h.requests[0].params.resolution,'2K');assert.equal(h.requests[0].params.ratio,'1:1');assert.equal('image_size' in h.requests[0].params,false);
});
test('favorite models and API catalog survive restart and offline synchronization',async()=>{
 const models=[{id:'banana-2'},{id:'studio-new',capabilities:{image_editing:true}}];
 const h=harness({apiModels:models});await h.ready();await h.nodes['refresh-models'].click();h.select('model','studio-new');h.nodes['favorite-model'].click();
 assert.equal(h.nodes['favorite-model'].textContent,'★');
 const restarted=harness({savedLocal:[...h.local],modelSyncFails:true});await restarted.ready();await restarted.nodes['refresh-models'].click();
 assert.ok(restarted.choices('model').some(n=>n.attributes['data-value']==='studio-new'));
 assert.match(restarted.nodes['models-status'].textContent,/同步失败/);
 restarted.select('model','studio-new');assert.equal(restarted.nodes['favorite-model'].textContent,'★');
 assert.equal(JSON.stringify([...h.local]).includes('test-key'),false);
});
test('a non-image model cannot submit or create a region record',async()=>{
 const h=harness({apiModels:[{id:'banana-2'},{id:'chat-only',type:'chat'}]});await h.ready();await h.nodes['refresh-models'].click();
 h.nodes['model-list'].children.find(n=>n.children[0]?.title?.startsWith('chat-only · ')).children[0].click();await h.nodes.generate.click();
 assert.equal(h.requests.length,0);assert.match(h.nodes.status.textContent,/不是.*图像/);assert.equal(h.local.get('lk888-jobs'),undefined);
});
test('a name-only image candidate sends default parameters instead of guessing a model schema',async()=>{
 const h=harness({apiModels:[{id:'banana-2'},'flux-next']});await h.ready();await h.nodes['refresh-models'].click();h.select('model','flux-next');
 assert.match(h.nodes['model-hint'].textContent,/待确认/);assert.equal(h.nodes.quality.disabled,false);
 await h.nodes.generate.click();await h.ready();assert.deepEqual(Object.keys(h.requests[0].params),['images']);
});
test('changing API key does not reuse another accounts favorites',async()=>{
 const h=harness();await h.ready();h.nodes['favorite-model'].click();
 const oldAccount=JSON.parse(h.local.get('lk888-model-favorites')).account;
 h.node('api-key').value='second-account-key';await h.nodes['save-key'].click();
 h.nodes['favorite-model'].click();const saved=JSON.parse(h.local.get('lk888-model-favorites'));
 assert.notEqual(saved.account,oldAccount);assert.equal(h.nodes['favorite-model'].textContent,'★');
 assert.equal(JSON.stringify([...h.local]).includes('second-account-key'),false);
 h.node('api-key').value='test-key';await h.nodes['save-key'].click();assert.equal(h.nodes['favorite-model'].textContent,'★');
});


test('API checks are single flight and preserve choice controls and source views',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),h=harness({balanceGate:gate});await h.ready();
 assert.equal(h.apiCalls.length,0,'startup must use cache without a background API request');
 await h.nodes['capture-selection'].click();
 const menus=['model','quality','output-size'].map(id=>h.nodes[id].children[0]),refs=h.nodes['reference-thumbs'].children,decodes=h.imageDecodes;
 const pending=h.nodes['test-key'].click();await h.nodes['test-key'].click();await h.nodes['refresh-models'].click();await h.ready();
 assert.equal(h.apiCalls.length,1);assert.equal(h.nodes['test-key'].disabled,true);
 release();await pending;
 assert.equal(h.nodes['test-key'].disabled,false);
 assert.match(h.nodes['api-status'].textContent,/检测成功/);
 ['model','quality','output-size'].forEach((id,i)=>assert.equal(h.nodes[id].children[0],menus[i]));
 assert.equal(h.nodes['reference-thumbs'].children,refs);assert.equal(h.imageDecodes,decodes);assert.equal(h.requests.length,0);
 await h.nodes['save-key'].click();assert.equal(h.apiCalls.length,2,'saving the key must not fetch models');
});
test('failed API checks restore settings buttons without replacing menus',async()=>{
 const h=harness({balanceFails:true});await h.ready();const menu=h.nodes.quality.children[0];
 await h.nodes['test-key'].click();assert.match(h.nodes['api-status'].textContent,/检测失败/);assert.match(h.nodes.status.textContent,/网络/);
 for(const id of ['test-key','refresh-models','save-key'])assert.equal(h.nodes[id].disabled,false);
 assert.equal(h.nodes.quality.children[0],menu);
});
test('editor refresh keeps unchanged choice caption nodes',async()=>{
 const h=harness();await h.ready();const menu=h.nodes.quality.children[0];
 await h.nodes['capture-selection'].click();assert.equal(h.nodes.quality.children[0],menu);
 h.select('quality','2K');await h.nodes['capture-selection'].click();assert.equal(h.selected('quality'),'2K');assert.equal(h.nodes.quality.children[0],menu);
});
test('large model catalogs have bounded controls and search can select a late entry',async()=>{
 const h=harness({apiModels:Array.from({length:2000},(_,i)=>({id:'studio-'+i,capabilities:{image_editing:true}}))});await h.ready();await h.nodes['refresh-models'].click();
 assert.ok(h.choices('model').length<=42);
 assert.equal(h.nodes['model-list'].children.filter(n=>n.className==='model-entry').length,20);
 const menu=h.nodes.model.children[0];h.nodes['model-search'].value='studio-1999';h.nodes['model-search'].input();
 assert.equal(h.nodes.model.children[0],menu,'search does not recreate choice captions');
 const row=h.nodes['model-list'].children.find(n=>n.className==='model-entry');assert.equal(row.children[0].attributes.role,'button');
 row.children[0].click();assert.equal(h.selected('model'),'studio-1999');assert.ok(h.choices('model').length<=42);
});

test('connection success survives model sync errors, searches and reopening settings',async()=>{
 const h=harness({modelSyncFails:true});await h.ready();await h.nodes['test-key'].click();
 assert.match(h.nodes['api-status'].textContent,/检测成功/);assert.match(h.nodes['models-status'].textContent,/同步失败/);
 h.nodes['model-search'].value='banana';h.nodes['model-search'].input();h.nodes['settings-toggle'].click();h.nodes['settings-toggle'].click();
 assert.match(h.nodes['api-status'].textContent,/检测成功/);
 const restarted=harness({savedLocal:[...h.local]});await restarted.ready();assert.match(restarted.nodes['api-status'].textContent,/上次检测成功.*本次尚未检测/);
 h.node('api-key').value='new-account';await h.nodes['save-key'].click();assert.match(h.nodes['api-status'].textContent,/尚未检测连接/);
});
test('full model library pagination reaches every API model, including non-image models',async()=>{
 const models=Array.from({length:61},(_,i)=>({id:'entry-'+i,type:i%2?'chat':'image'})),h=harness({apiModels:models});await h.ready();await h.nodes['test-key'].click();
 assert.equal(h.apiCalls.length,2);assert.match(h.nodes['api-status'].textContent,/检测成功/);
 const seen=new Set();
 do{for(const row of h.nodes['model-list'].children.filter(n=>n.className==='model-entry'))seen.add(row.children[0].title.split(' · ')[0]);if(h.nodes['model-next'].disabled)break;h.nodes['model-next'].click();}while(true);
 for(const model of models)assert.ok(seen.has(model.id),model.id);
 assert.match(h.nodes['model-page-info'].textContent,/第 4 \/ 4 页/);
 h.nodes['model-prev'].click();assert.match(h.nodes['model-page-info'].textContent,/第 3/);
 h.nodes['model-search'].value='entry-60';h.nodes['model-search'].input();assert.match(h.nodes['model-page-info'].textContent,/匹配 1 个.*第 1 \/ 1 页/);
 h.nodes['browse-models'].click();assert.equal(h.nodes['model-search'].value,'');assert.equal(h.selected('model-filter'),'all');assert.match(h.nodes['model-page-info'].textContent,/匹配 62 个/);
});

test('custom picker selects and submits an unverified model instead of the stale default value',async()=>{
 const h=harness({nativeDropdownValue:true,apiModels:[{id:'banana-2'},'flux-next']});await h.ready();await h.nodes['refresh-models'].click();
 h.select('model','flux-next');
 assert.equal(h.selected('model'),'flux-next');assert.match(h.nodes['model-hint'].textContent,/flux-next/);assert.equal(h.nodes.quality.disabled,false);
 h.select('quality','4K');await h.nodes['capture-selection'].click();
 assert.equal(h.selected('model'),'flux-next');assert.equal(h.selected('quality'),'4K');h.nodes.prompt.value='修改选区';
 await h.nodes.generate.click();await h.ready();assert.ok(h.requests[0],h.nodes.status.textContent);assert.equal(h.requests[0].model,'flux-next');assert.equal(h.requests[0].params.image_size,'4K');
 assert.equal(JSON.parse(h.local.get('lk888-jobs'))[0].model,'flux-next');
 const options=h.choices('model');assert.equal(options.filter(n=>n.attributes['aria-selected']==='true').length,1);assert.equal(options.find(n=>n.attributes['aria-selected']==='true').attributes['data-value'],'flux-next');
});
test('choosing an unverified model from the library updates the selected item even when native value is stale',async()=>{
 const h=harness({nativeDropdownValue:true,apiModels:['banana-2','flux-next']});await h.ready();await h.nodes['refresh-models'].click();
 const row=h.nodes['model-list'].children.find(n=>n.children[0]?.title?.startsWith('flux-next · '));row.children[0].click();
 assert.equal(h.selected('model'),'flux-next');h.nodes['favorite-model'].click();assert.equal(h.selected('model'),'flux-next');
 await h.nodes.generate.click();await h.ready();assert.equal(h.requests[0].model,'flux-next');assert.deepEqual(Object.keys(h.requests[0].params),['images']);
});

test('capability-only LK888 model sync retains the platform parameters in actual submissions',async()=>{
 for(const [id,key,value] of [['banana-2','imageSize','2K'],['banana-pro','imageSize','2K'],['tt-image-2','size','2560x1440'],['tt-image-2.5','resolution','2K']]){
  const h=harness({nativeDropdownValue:true,apiModels:[{id,capabilities:{image_editing:true},parameters:[]}]});await h.ready();await h.nodes['refresh-models'].click();
  const row=h.nodes['model-list'].children.find(n=>n.children[0]?.title?.startsWith(id+' · '));row.children[0].click();h.select('quality','2K');h.select('output-size','16:9');
  assert.equal(h.nodes.quality.disabled,false);await h.nodes.generate.click();await h.ready();assert.ok(h.requests[0],h.nodes.status.textContent);assert.equal(h.requests[0].model,id);assert.equal(h.requests[0].params[key],value);assert.equal('n' in h.requests[0].params,false);assert.equal('image_size' in h.requests[0].params,false);
 }
});


test('required official model options appear and block submission until chosen',async()=>{
 const h=harness();await h.ready();const row=h.nodes['model-list'].children.find(n=>n.children[0]?.title?.startsWith('vidu-image-2 · '));
 if(row)row.children[0].click();else{h.nodes['model-search'].value='vidu-image-2';h.nodes['model-search'].input();h.nodes['model-list'].children.find(n=>n.children[0]?.title?.startsWith('vidu-image-2 · ')).children[0].click();}
 assert.equal(h.nodes['model-extra-controls'].style.display,'block');await h.nodes.generate.click();assert.equal(h.requests.length,0);assert.match(h.nodes.status.textContent,/请选择模型参数/);
 h.select('model-param-quality','high');h.select('quality','3K');h.select('output-size','1:1');await h.nodes.generate.click();await h.ready();assert.equal(h.requests[0].model,'vidu-image-2');assert.equal(h.requests[0].params.resolution,'3K');assert.equal(h.requests[0].params.quality,'high');assert.equal('style' in h.requests[0].params,false);
 const jobs=JSON.parse(h.local.get('lk888-jobs'));assert.deepEqual(jobs[0].extraParams,{quality:'high'});
});
test('a catalog model unavailable for this key never creates a region or submits a task',async()=>{
 const h=harness({apiModels:[{name:'banana-2',type:'image',available_for_this_key:false}]});await h.ready();await h.nodes['refresh-models'].click();await h.nodes.generate.click();assert.equal(h.requests.length,0);assert.equal(h.local.get('lk888-jobs'),undefined);assert.match(h.nodes.status.textContent,/未配置/);
});

test('model-specific optional parameters restore from history without leaking into another region',async()=>{
 const h=harness();await h.ready();h.select('model-param-thinkingLevel','high');await h.nodes.generate.click();await h.ready();const first=JSON.parse(h.local.get('lk888-jobs'))[0].id;
 await h.nodes['tab-edit'].click();h.select('model-param-thinkingLevel','__omit__');h.nodes.prompt.value='另一区域';await h.nodes.generate.click();await h.ready();const second=JSON.parse(h.local.get('lk888-jobs')).find(j=>j.id!==first).id;
 await h.openHistory(first);assert.equal(h.selected('model-param-thinkingLevel'),'high');await h.openHistory(second);assert.equal(h.selected('model-param-thinkingLevel'),'__omit__');
 assert.equal(h.requests[0].params.thinkingLevel,'high');assert.equal('thinkingLevel' in h.requests[1].params,false);
});

test('Photoshop selection notifications keep the empty gate hidden over captured source and references',async()=>{
 const h=harness();await h.ready();h.notify();assert.equal(h.nodes['selection-gate'].hidden,false);assert.match(h.nodes['selection-hint'].textContent,/检测到选区/);
 await h.nodes['capture-selection'].click();const image=h.nodes.preview.src;
 await h.nodes['images-row'].drop({preventDefault(){},dataTransfer:{files:[{name:'参考.png',size:1,arrayBuffer:async()=>Uint8Array.from([1]).buffer}]}});
 for(let i=0;i<10;i++)h.notify();assert.equal(h.nodes['selection-gate'].hidden,true);assert.equal(h.nodes['selection-gate'].style.display,'none');assert.equal(h.nodes.preview.src,image);assert.equal(h.nodes['reference-thumbs'].children.length,1);
 h.app.activeDocument.selection.bounds=null;h.notify();assert.equal(h.nodes['selection-gate'].hidden,true);assert.equal(h.nodes.preview.src,image);
 await h.nodes['tab-edit'].click();assert.equal(h.nodes['selection-gate'].hidden,false);assert.equal(h.nodes['preview-box'].hidden,true);assert.equal(h.nodes['reference-thumbs'].children.length,0);assert.match(h.nodes['selection-hint'].textContent,/先在 PS 框选/);assert.equal(h.requests.length,0);
});
test('Space on a focused choice leaves the panel closed and prompt spaces intact',async()=>{
 const h=harness();await h.ready();for(const id of ['model','quality','count','output-size']){let prevented=false;h.nodes[id].keydown({target:h.nodes[id],key:' ',preventDefault(){prevented=true;}});assert.equal(prevented,false);assert.equal(h.document.body.children.length,0);}
 h.nodes.prompt.value='换成 蓝色 西装';await h.nodes['capture-selection'].click();assert.equal(h.nodes.prompt.value,'换成 蓝色 西装');assert.equal(h.requests.length,0);
});

test('changing model after submission preserves actual model history while saving editable choice separately',async()=>{
 const h=harness();await h.ready();await h.nodes.generate.click();await h.ready();const first=JSON.parse(h.local.get('lk888-jobs'))[0];
 h.select('model','banana-2.1');h.nodes.prompt.value='修改为蓝色';await h.nodes['reload-panel'].click();const saved=JSON.parse(h.local.get('lk888-jobs')).find(j=>j.id===first.id);
 assert.equal(saved.model,'banana-2');assert.equal(saved.prompt,'改成红色');assert.equal(saved.editor.model,'banana-2.1');assert.equal(saved.editor.prompt,'修改为蓝色');assert.equal(h.requests.length,1);
});
