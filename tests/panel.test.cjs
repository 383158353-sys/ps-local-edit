const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const api = require('../plugin/api');
const {TaskQueue}=require('../plugin/task-queue');const {pngRGBA}=require('../plugin/png');

function harness({ switchDocument = false, reopenSameDocument = false, reopenPathless = false, submissionFails = false, submissionMessage = '', helperDown = false, helperPrepareMissing = false, optimizerDeferred = false, noSelection = false, captureHangs = false, captureMismatch = false, captureError = '', boundsThrows = false, boundsError = '', busyTimeoutMs = 0, dropGraceMs = 0, entryForUrl = null, dropQueue = null, pickedFiles = null, pickerError = '', remoteResult = false, remoteDownloadFails = false } = {}) {
  const nodes = {}, local = new Map(), calls = [], writes = [], requests = [], reads = [], docEvents = {}, helperCalls=[],optimizerCalls=[],captureArgs=[],filePickerCalls=[];let reloads=0, imageDecodes=0,optimizerCancels=0,resolveOptimize;
  function makeNode(id='') { const node={id,value:id==='prompt'?'改成红色':id==='model'?'banana-2':'',textContent:'',hidden:false,style:{},children:[],attributes:{},className:'',classList:{add(){},remove(){}},addEventListener(event,fn){this[event]=fn;},setAttribute(name,value){this.attributes[name]=value;},getAttribute(name){return Object.prototype.hasOwnProperty.call(this.attributes,name)?this.attributes[name]:null;},removeAttribute(name){delete this.attributes[name];if(name==='src')this.src='';},append(...items){for(const item of items)this.appendChild(item);},appendChild(item){item.parentNode=this;this.children.push(item);},replaceChildren(...items){this.children=[];this.append(...items);},get parentElement(){return makeNode('parent');}};Object.defineProperty(node,'innerHTML',{get(){return '';},set(value){if(value==='')this.children=[];}});return node; }
  const document = { readyState: 'interactive', addEventListener(event,fn) {docEvents[event]=fn;}, createElement: tag=>makeNode(tag), getElementById(id) { return nodes[id] ||= makeNode(id); },querySelectorAll(){return [];} };
  const selection = noSelection ? null : { bounds: {left:150,top:120,right:350,bottom:240} };
  if (boundsThrows && selection) Object.defineProperty(selection, 'bounds', { get() { throw new Error('dom bounds blocked'); } });
  const originalDoc = { id: 12, name: 'sample.psd', path: 'C:/project/sample.psd', width: 1000, height: 800, mode: 'RGB', selection };
  const app = { activeDocument: originalDoc };
  const bounds = { left: 120, top: 90, right: 420, bottom: 290, width: 300, height: 200 };
  const mask = { width: 300, height: 200, components: 1, imageData: new Uint8Array(60000) };
  const capture = { bounds, maskData: mask, documentWidth:1000,documentHeight:800,context: { documentId: 12, documentName: 'sample.psd', documentPath:reopenPathless?'':'C:/project/sample.psd', originalBounds: { left: 150, top: 120, right: 350, bottom: 240 } }, imageData: { sourceBounds: bounds, imageData: { width: 300, height: 200, components:4,getData:async()=>new Uint8Array(300*200*4), dispose() {} } } };
  const ps = { getSelectionBounds:async()=>{ if(boundsError) throw new Error(boundsError); return {left:150,top:120,right:350,bottom:240,width:200,height:120}; },hasActiveSelection:async()=>!noSelection,captureSelection: async (...args) => { captureArgs.push(args); if (captureError) throw new Error(captureError); if (captureHangs) return new Promise(() => {}); if (captureMismatch) return {...capture, imageData:{ sourceBounds:{ left:11.5, top:7.25, right:311.5, bottom:207.25 }, imageData:capture.imageData.imageData }}; return capture; }, placeBack: async (...args) => calls.push(args),placeGeneratedAsLayer:async (...args)=>calls.push(args) };
  const dataFiles=new Map();const folder={createFile:async name=>({write:async value=>dataFiles.set(name,value)}),getEntry:async name=>{reads.push(name);return {read:async()=>dataFiles.get(name)};}};
  const storage = { formats: { binary: 'binary' }, secureStorage: { getItem: async () => new Uint8Array(Buffer.from('test-key')) }, localFileSystem: { getDataFolder:async()=>folder,getTemporaryFolder: async () => ({ createFile: async () => ({ write: async value => writes.push(value) }) }), createSessionToken: () => 'session-token', getFileForOpening: async options => { filePickerCalls.push(options); if (pickerError) throw new Error(pickerError); return pickedFiles; }, ...(entryForUrl?{getEntryWithUrl:entryForUrl}:{}) } };
  const fetch = async (url, options) => {
    if(helperDown&&String(url).includes('127.0.0.1:17402'))throw new Error('fetch failed');
    if(helperPrepareMissing&&String(url).includes('127.0.0.1:17402/images/prepare'))return {ok:false,status:404,json:async()=>({message:'本机服务没有这个接口。'})};
    if(helperPrepareMissing&&String(url).includes('127.0.0.1:17402/health'))return {ok:true,json:async()=>({state:'ready',language:'zh-CN'})};
    if(url.includes('127.0.0.1:17402/annotate/')){helperCalls.push({url,options});return {ok:true,json:async()=>url.includes('/open')?{id:'test-annotation'}:{state:'waiting'}};}
    if(url.includes('127.0.0.1:17402/drop/read')){helperCalls.push({url,options});const body=JSON.parse(options.body||'{}');const references=(Array.isArray(body.paths)?body.paths:[]).map(item=>({name:String(item).split(/[/\\]/).pop(),data:'data:image/png;base64,YWJj'}));return {ok:true,json:async()=>({references})};}
    if(url.includes('127.0.0.1:17402/drop/poll')){helperCalls.push({url,options});const references=dropQueue?dropQueue.shift()||[]:[];return {ok:true,json:async()=>({references})};}
    if(url.includes('127.0.0.1:17402/drop/arm')||url.includes('127.0.0.1:17402/drop/hide')){helperCalls.push({url,options});return {ok:true,json:async()=>({state:'ready'})};}
    if(url.includes('127.0.0.1:17402/drop/cover')||url.includes('127.0.0.1:17402/drop/open')){helperCalls.push({url,options});return {ok:true,json:async()=>({id:'test-drop',ready:true})};}
    if(url.includes('127.0.0.1:17402/drop/')){helperCalls.push({url,options});return {ok:true,json:async()=>({state:'ok'})};}
    if (String(url).startsWith('https://cdn.example/')) { if (remoteDownloadFails) throw new Error('network down'); const bytes=Uint8Array.from([137,80,78,71,13,10,26,10]); return { ok:true, headers:{ get:name=>String(name).toLowerCase()==='content-type'?'image/png':'' }, arrayBuffer:async()=>bytes.buffer, blob:async()=>new Blob([bytes],{type:'image/png'}) }; }
    if (url.endsWith('/generate')) { requests.push(JSON.parse(options.body)); if (submissionMessage) return { ok:false, status:400, json:async()=>({error:{message:submissionMessage}}) }; if (submissionFails) throw new Error('connection lost'); return { ok: true, json: async () => ({ task_id: requests.length===1?'existing-task':'task-'+requests.length }) }; }
    if (switchDocument) app.activeDocument = { ...originalDoc, id: 99, path:'C:/project/other.psd' };
    if (reopenSameDocument) app.activeDocument = { ...originalDoc, id: 99 };
    if (reopenPathless) app.activeDocument = { ...originalDoc, id: 99, path:'C:/project/sample.psd' };
    return { ok: true, json: async () => ({ is_final: true, state: 'success', result_url: remoteResult ? 'https://cdn.example/result.png' : 'data:image/png;base64,YWJj' }) };
  };
  class Client extends api.MediaClient { constructor(key) { super(key, fetch); } }
  const context = { __lk888BusyTimeoutMs: busyTimeoutMs || undefined, __lk888DropGraceMs: dropGraceMs || undefined, document, location:{reload:()=>{reloads++;}}, localStorage: { getItem: k => local.get(k) || null, setItem: (k, v) => local.set(k, v), removeItem: k => local.delete(k) }, setTimeout, clearTimeout, Uint8Array, Blob, URL, btoa, atob, console, fetch, require(name) {
    if (name === 'photoshop') return { app, imaging: { encodeImageData: async () => 'YWJj' }, constants: { DocumentMode: { RGB: 'RGB' } } };
    if (name === 'uxp') return { storage };
    if (name === './modules/ps') return ps;if(name==='./modules/geometry')return require('../plugin/modules/geometry');
    if(name==='./prompt-editor')return require('../plugin/prompt-editor');if(name==='./voice'){const Base=require('../plugin/voice').VoiceController;return {VoiceController:class extends Base{constructor(options){super({...options,fetchImpl:fetch});}}};}if(name==='./optimizer')return {OptimizerClient:class{cancel(){optimizerCancels++;}optimize(input){optimizerCalls.push(input);if(optimizerDeferred)return new Promise(resolve=>{resolveOptimize=resolve;});return Promise.resolve({prompt:'优化后的修改要求',images:[{name:'影词新增.png',data:'data:image/png;base64,YWJj'}]});}}};if(name==='./task-queue')return {TaskQueue};if(name==='./png')return {pngRGBA};
    if (name === './modules/fs') return { arrayBufferToBase64:v=>Buffer.from(v).toString('base64'), base64ToArrayBuffer: v => {imageDecodes++;return Uint8Array.from(Buffer.from(v, 'base64')).buffer;} };
    if (name === './api') return { ...api, MediaClient: Client };
    if (name === './model-selection') return require('../plugin/model-selection');
    if (name === './model-manager') {
      const module = { exports: {} };
      vm.runInNewContext(fs.readFileSync('plugin/model-manager.js', 'utf8'), { module, exports: module.exports, console, document, localStorage: context.localStorage, require(inner) { throw new Error(inner); } }, { filename: 'model-manager.js' });
      return module.exports;
    }
    throw new Error(name);
  } };
  vm.runInNewContext(fs.readFileSync('plugin/main.js', 'utf8'), context);
  // init loads saved prompt; restore the user's entry for this run.
  nodes.prompt ||= document.getElementById('prompt');nodes.prompt.value = '改成红色';
  document.getElementById('quality'); document.getElementById('output-size');
  return { app, newDraft:()=>context.newDraft(),openHistory:id=>context.openHistory(id), currentId:()=>vm.runInNewContext("selectedJobId",context), nodes, docEvents, calls, writes, reads, local, capture, captureArgs, requests, helperCalls, filePickerCalls, optimizerCalls,resolveOptimize:value=>resolveOptimize?.(value),saveAnnotation:image=>context.saveAnnotation(image),get optimizerCancels(){return optimizerCancels;}, get reloads(){return reloads;}, get imageDecodes(){return imageDecodes;}, ready:async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));nodes.prompt.value='改成红色';} };
}


test('selection uses lossless PNG and does not submit a task',async()=>{const h=harness();await h.ready();await h.nodes['capture-selection'].click();assert.match(h.nodes.preview.src,/^data:image\/png/);assert.equal(h.requests.length,0);});
test('loading the panel does not show a drop window',async()=>{
 const h=harness();await h.ready();
 assert.ok(!h.helperCalls.some(call=>/\/drop\/(cover|open)/.test(call.url)));
});
test('add image uses the Photoshop file picker for several files and a bad type does not lock the panel',async()=>{
 const h=harness({pickedFiles:[{name:'中文 图.png',read:async()=>Uint8Array.from([1,2,3]).buffer},{name:'second.jpg',read:async()=>Uint8Array.from([4]).buffer},{name:'notes.txt',read:async()=>Uint8Array.from([7]).buffer}]});
 await h.ready();
 await h.nodes['add-reference'].click();
 await h.ready();
 assert.equal(h.filePickerCalls[0].allowMultiple,true);
 assert.equal(JSON.stringify(Array.from(h.filePickerCalls[0].types)),JSON.stringify(['png','jpg','jpeg','webp']));
 assert.equal(h.nodes['reference-thumbs'].children.length,2);
 assert.equal(h.nodes['reference-thumbs'].children[0].children[2].textContent,'中文 图.png');
 assert.equal(h.nodes['reference-thumbs'].children[1].children[2].textContent,'second.jpg');
 assert.match(h.nodes.status.textContent,/已添加 2/);
 assert.match(h.nodes.status.textContent,/notes.txt/);
 assert.ok(!h.helperCalls.some(call=>call.url.includes('/pick-images')));
 assert.equal(h.nodes.generate.disabled,false);
});
test('cancelling or failing the file picker leaves generation available',async()=>{
 const cancelled=harness();await cancelled.ready();
 await cancelled.nodes['add-reference'].click();await cancelled.ready();
 assert.match(cancelled.nodes.status.textContent,/已取消添加图片/);
 assert.equal(cancelled.nodes.generate.disabled,false);
 const failed=harness({pickerError:'dialog blocked'});await failed.ready();
 await failed.nodes['add-reference'].click();await failed.ready();
 assert.match(failed.nodes.status.textContent,/dialog blocked/);
 assert.equal(failed.nodes.generate.disabled,false);
});
test('images can be added while a generation is in flight without resubmitting it',async()=>{
 const h=harness({pickedFiles:[{name:'额外.png',read:async()=>Uint8Array.from([9]).buffer}]});
 await h.ready();
 h.nodes.prompt.value='生成中仍可加图';
 await h.nodes.generate.click();await h.ready();
 const before=h.requests.length;
 const job=JSON.parse(h.local.get('lk888-jobs'))[0];
 assert.ok(job.tasks.length);
 assert.equal(h.nodes['add-reference'].disabled,false);
 await h.nodes['add-reference'].click();await h.ready();
 assert.equal(h.requests.length,before);
 assert.equal(h.nodes['reference-thumbs'].children[0].children[2].textContent,'额外.png');
 const after=JSON.parse(h.local.get('lk888-jobs'))[0];
 assert.equal(after.id,job.id);
 assert.equal(after.tasks.length,job.tasks.length);
 assert.equal(after.tasks[0].id,job.tasks[0].id);
});
test('selection read is a native click and does not depend on sp-button pointerup',async()=>{
 const html=fs.readFileSync('plugin/index.html','utf8');
 assert.match(html,/<button id="capture-selection" type="button">局部改图 · 读取选区<\/button>/);
 assert.doesNotMatch(html,/<sp-button id="capture-selection"/);
 const h=harness();await h.ready();
 assert.equal(h.nodes['capture-selection'].pointerup,undefined);
 await h.nodes['capture-selection'].click();
 assert.match(h.nodes.status.textContent,/已读取选区/);
 assert.doesNotMatch(h.nodes['selection-size'].textContent,/尚未读取/);
});
test('no active selection is reported instead of leaving the idle status',async()=>{
 const h=harness({boundsError:'No active selection'});await h.ready();
 await h.nodes['capture-selection'].click();
 assert.match(h.nodes.status.textContent,/请先在 PS/);
 assert.match(h.nodes['selection-size'].textContent,/尚未读取选区/);
 assert.equal(h.nodes.generate.disabled,false);
 assert.equal(h.nodes.generate.textContent,'生成');
});
test('optimizer button is left of voice in the panel',()=>{const html=fs.readFileSync('plugin/index.html','utf8');assert.ok(html.indexOf('id="optimize-prompt"')<html.indexOf('id="voice-prompt"'));});
test('optimizer maps selection and references in order, fills prompt and supports undo',async()=>{
 const h=harness();await h.ready();await h.nodes['capture-selection'].click();
 await h.nodes['images-row'].drop({preventDefault(){},dataTransfer:{files:[{name:'参考.png',size:1,arrayBuffer:async()=>Uint8Array.from([2]).buffer}]}});
 h.nodes.prompt.value='改成红色';await h.nodes['optimize-prompt'].click();
 assert.equal(h.optimizerCalls.length,1);assert.equal(h.optimizerCalls[0].target,'banana2');assert.equal(h.optimizerCalls[0].images.length,2);assert.equal(h.optimizerCalls[0].images[0].name,'选区.png');assert.equal(h.optimizerCalls[0].images[1].name,'参考.png');
 assert.equal(h.nodes.prompt.value,'优化后的修改要求');assert.equal(h.nodes['undo-optimize'].style.display,'inline-block');
 assert.equal(h.nodes['reference-thumbs'].children.length,2);assert.equal(h.nodes['reference-thumbs'].children[1].children[2].textContent,'影词新增.png');
 let prevented=false;await h.nodes.prompt.keydown({ctrlKey:true,key:'z',preventDefault(){prevented=true;},stopPropagation(){}});assert.equal(prevented,true);assert.equal(h.nodes.prompt.value,'改成红色');
});
test('switching to a new edit cancels optimization and discards its late result',async()=>{
 const h=harness({optimizerDeferred:true});await h.ready();const pending=h.nodes['optimize-prompt'].click();await h.nodes['tab-edit'].click();h.resolveOptimize({prompt:'不应写入'});await pending;await new Promise(resolve=>setImmediate(resolve));
 assert.ok(h.optimizerCancels>0);assert.notEqual(h.nodes.prompt.value,'不应写入');
});
test('clicking source annotation sends its image to the local editor',async()=>{const h=harness();await h.ready();await h.nodes['capture-selection'].click();await h.nodes['annotate-source'].click();assert.equal(h.helperCalls[0].options.method,'POST');assert.match(h.helperCalls[0].options.body,/data:image/);h.saveAnnotation('data:image/png;base64,YWJj');});
test('saved annotation replaces the source image used for generation',async()=>{const h=harness();await h.ready();await h.nodes['capture-selection'].click();h.nodes['annotate-source'].click();const image='data:image/png;base64,YWJj';h.saveAnnotation(image);await h.ready();assert.equal(h.nodes.preview.src,image);await h.nodes.generate.click();await h.ready();assert.equal(h.requests[0].params.images[0],image);});
test('dropping UXP and browser files adds numbered reference images',async()=>{
 const h=harness();await h.ready();
 const drop=h.nodes['images-row'].drop;
 await drop({preventDefault(){},dataTransfer:{uxpEntries:[{name:'第一张.png',read:async()=>Uint8Array.from([1,2,3]).buffer}]}});
 await drop({preventDefault(){},dataTransfer:{files:[{name:'第二张.jpg',size:3,arrayBuffer:async()=>Uint8Array.from([4,5,6]).buffer}]}});
 const tiles=h.nodes['reference-thumbs'].children;
 assert.equal(tiles.length,2);
 assert.equal(tiles[0].children[0].textContent,'1');
 assert.equal(tiles[1].children[0].textContent,'2');
 assert.equal(tiles[0].children[2].textContent,'第一张.png');
 assert.equal(tiles[1].children[2].textContent,'第二张.jpg');
 assert.ok(!h.helperCalls.some(call=>/\/drop\/(?!trace)/.test(call.url)));
 await h.nodes['capture-selection'].click();
 assert.equal(h.nodes['reference-thumbs'].children.length,2);
});
test('an Explorer drop the panel cannot read is imported from the add-area catch',async()=>{
 const h=harness({dropGraceMs:2000,dropQueue:[[{name:'资源管理器.png',data:'data:image/png;base64,YWJj'}]]});
 await h.ready();
 h.nodes.dropzone.getBoundingClientRect=()=>({left:10,top:20,width:160,height:72});
 h.nodes.dropzone.dragenter({preventDefault(){},currentTarget:h.nodes.dropzone,clientX:40,clientY:35,screenX:400,screenY:300,dataTransfer:{types:['Files'],files:[],items:[]}});
 h.nodes.dropzone.drop({preventDefault(){},stopPropagation(){},target:h.nodes.dropzone,currentTarget:h.nodes.dropzone,dataTransfer:{types:['Files'],files:[],items:[]}});
 for(let i=0;i<40&&!h.nodes['reference-thumbs'].children.length;i++)await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(h.nodes['reference-thumbs'].children[0].children[2].textContent,'资源管理器.png');
 const cover=h.helperCalls.find(call=>call.url.includes('/drop/cover'));
 const body=JSON.parse(cover.options.body);
 assert.equal(body.width,160);
 assert.equal(body.height,72);
 assert.equal(body.offsetX,30);
 assert.equal(body.offsetY,15);
 assert.ok(!h.helperCalls.some(call=>/\/drop\/open|\/clipboard/.test(call.url)));
 assert.match(h.nodes.status.textContent,/已添加/);
 assert.doesNotMatch(h.nodes.status.textContent,/没有读到拖入的图片|停一下再松开|接图层还在启动|松手添加/);
 assert.equal(h.nodes.generate.disabled,false);
});
test('an add-area catch during generation adds the image and does not resubmit',async()=>{
 const h=harness({dropGraceMs:2000,dropQueue:[[{name:'生成中拖入.png',data:'data:image/png;base64,YWJj'}]]});
 await h.ready();
 h.nodes.prompt.value='生成中仍可拖图';
 await h.nodes.generate.click();await h.ready();
 const before=h.requests.length;
 const job=JSON.parse(h.local.get('lk888-jobs'))[0];
 h.nodes.dropzone.getBoundingClientRect=()=>({left:10,top:20,width:160,height:72});
 h.nodes.dropzone.dragenter({preventDefault(){},currentTarget:h.nodes.dropzone,clientX:40,clientY:30,screenX:200,screenY:200,dataTransfer:{types:['Files'],files:[],items:[]}});
 h.nodes.dropzone.drop({preventDefault(){},stopPropagation(){},target:h.nodes.dropzone,dataTransfer:{types:['Files'],files:[],items:[]}});
 for(let i=0;i<40&&!(h.nodes['reference-thumbs'].children[0]&&h.nodes['reference-thumbs'].children[0].children[2].textContent==='生成中拖入.png');i++)await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(h.nodes['reference-thumbs'].children[0].children[2].textContent,'生成中拖入.png');
 assert.equal(h.requests.length,before);
 const after=JSON.parse(h.local.get('lk888-jobs'))[0];
 assert.equal(after.id,job.id);
 assert.equal(after.tasks.length,job.tasks.length);
 assert.equal(after.tasks[0].id,job.tasks[0].id);
 assert.equal(after.chargeState,job.chargeState);
 assert.notEqual(after.chargeState,'cleared');
});
test('a drag outside the add-image area does not raise a catch window',async()=>{
 const h=harness();await h.ready();
 const before=h.helperCalls.length;
 h.nodes['images-row'].dragenter({preventDefault(){},screenX:320,screenY:240,dataTransfer:{types:['Files'],files:[],items:[]}});
 await h.nodes['images-row'].drop({preventDefault(){},stopPropagation(){},target:h.nodes['images-row'],dataTransfer:{files:[],items:[]}});
 await h.ready();
 assert.equal(h.nodes['reference-thumbs'].children.length,0);
 assert.ok(!h.helperCalls.slice(before).some(call=>/\/drop\/(cover|open|poll)/.test(call.url)));
 assert.doesNotMatch((h.nodes.status&&h.nodes.status.textContent)||'',/已添加|没有读到拖入的图片|停一下再松开/);
 assert.equal(h.nodes.generate.disabled,false);
});
test('a file dropped on the add-image area is imported without an overlay',async()=>{
 const h=harness();await h.ready();
 await h.nodes.dropzone.drop({preventDefault(){},stopPropagation(){},target:h.nodes.dropzone,dataTransfer:{files:[{name:'窗口.jpg',size:3,arrayBuffer:async()=>Uint8Array.from([4,5,6]).buffer}]}});
 await h.ready();
 assert.equal(h.nodes['reference-thumbs'].children[0].children[2].textContent,'窗口.jpg');
 assert.ok(!h.helperCalls.some(call=>/\/drop\/(cover|open)/.test(call.url)));
});
test('a drop elsewhere on the panel still accepts file bytes and does not cover the screen',async()=>{
 const h=harness();await h.ready();
 await h.docEvents.drop({preventDefault(){},stopPropagation(){},target:h.nodes.status,dataTransfer:{files:[{name:'拖入.png',size:1,arrayBuffer:async()=>Uint8Array.from([1]).buffer}]}});
 await h.ready();
 assert.equal(h.nodes['reference-thumbs'].children[0].children[2].textContent,'拖入.png');
 assert.ok(!h.helperCalls.some(call=>/\/drop\/(cover|open)/.test(call.url)));
});
test('the add area reports a miss without asking for another drag or opening a dialog',async()=>{
 const h=harness({dropGraceMs:350});await h.ready();
 h.nodes.dropzone.getBoundingClientRect=()=>({left:8,top:8,width:120,height:64});
 h.nodes.dropzone.dragenter({preventDefault(){},currentTarget:h.nodes.dropzone,clientX:20,clientY:18,screenX:100,screenY:80,dataTransfer:{types:['Files'],files:[],items:[]}});
 h.nodes.dropzone.drop({preventDefault(){},stopPropagation(){},target:h.nodes.dropzone,currentTarget:h.nodes.dropzone,dataTransfer:{files:[],items:[]}});
 for(let i=0;i<30&&!/添加图片区域没有接到/.test((h.nodes.status&&h.nodes.status.textContent)||'');i++)await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(h.nodes['reference-thumbs'].children.length,0);
 assert.match(h.nodes.status.textContent,/添加图片区域没有接到这次拖放的文件/);
 assert.doesNotMatch(h.nodes.status.textContent,/停一下再松开|接图层还在启动|松手添加|请点「添加图片」/);
 assert.ok(h.helperCalls.some(call=>call.url.includes('/drop/cover')));
 assert.ok(!h.helperCalls.some(call=>/\/drop\/open|\/clipboard/.test(call.url)));
 assert.equal(h.nodes.generate.disabled,false);
});
test('an empty drop outside the add area does not open a dialog',async()=>{
 const h=harness();await h.ready();
 await h.nodes['images-row'].drop({preventDefault(){},stopPropagation(){},target:h.nodes['images-row'],dataTransfer:{files:[],items:[]}});
 assert.equal(h.nodes['reference-thumbs'].children.length,0);
 assert.ok(!h.helperCalls.some(call=>/\/drop\/(open|cover)/.test(call.url)));
 assert.doesNotMatch((h.nodes.status&&h.nodes.status.textContent)||'',/已添加|该来源没有提供可读取的图片|语音会话|停一下再松开/);
});
test('a nameless PNG or JPEG is recognized from its bytes',async()=>{
 const h=harness();await h.ready();
 const png=Uint8Array.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,1]);
 const jpg=Uint8Array.from([0xFF,0xD8,0xFF,0xD9]);
 await h.nodes['images-row'].drop({preventDefault(){},dataTransfer:{files:[{name:'',arrayBuffer:async()=>png.buffer}]}});
 await h.nodes['images-row'].drop({preventDefault(){},dataTransfer:{files:[{name:'camera',type:'application/octet-stream',arrayBuffer:async()=>jpg.buffer}]}});
 assert.equal(h.nodes['reference-thumbs'].children[0].children[2].textContent,'拖入图片.png');
 assert.equal(h.nodes['reference-thumbs'].children[1].children[2].textContent,'camera.jpg');
 assert.ok(!h.helperCalls.some(call=>/\/drop\/(open|cover|read)/.test(call.url)));
});
test('items-only and getFiles-only drops add images with missing MIME types',async()=>{
 const h=harness();await h.ready();
 const file=(name,value)=>({name,type:'',size:1,arrayBuffer:async()=>Uint8Array.from([value]).buffer});
 await h.nodes['images-row'].drop({preventDefault(){},dataTransfer:{files:[],items:[{kind:'file',getAsFile:()=>file('微信另存.png',7)}]}});
 await h.nodes['images-row'].drop({preventDefault(){},dataTransfer:{files:[],items:[],getFiles:async()=>[file('电脑图片.jpg',8)]}});
 assert.equal(h.nodes['reference-thumbs'].children.length,2);
 assert.equal(h.nodes['reference-thumbs'].children[0].children[2].textContent,'微信另存.png');
 assert.equal(h.nodes['reference-thumbs'].children[1].children[2].textContent,'电脑图片.jpg');
});
test('a file the panel cannot read and that has no path asks for the file picker instead of a catch layer',async()=>{
 const h=harness({dropQueue:[[{name:'拖入.png',data:'data:image/png;base64,YWJj'}]]});await h.ready();
 await h.nodes['images-row'].drop({preventDefault(){},stopPropagation(){},dataTransfer:{files:[{name:'微信图片.png',size:1,arrayBuffer:async()=>{throw new Error('access denied');}}]}});
 await h.ready();
 assert.ok(!h.helperCalls.some(call=>/\/drop\/(cover|open|read)/.test(call.url)));
 assert.equal(h.nodes['reference-thumbs'].children.length,0);
 assert.match(h.nodes.status.textContent,/无法读取/);
 assert.equal(h.nodes.generate.disabled,false);
});
test('Explorer file URL is captured before the drop transfer is cleared and read without the helper',async()=>{
 let readStarted=false;
 const urls=[];
 const h=harness({entryForUrl:async url=>{urls.push(url);return {name:'参考.png',read:async()=>Uint8Array.from([9]).buffer};}});
 await h.ready();
 await h.nodes.dropzone.drop({preventDefault(){},target:h.nodes.dropzone,dataTransfer:{
  files:[{name:'参考.png',arrayBuffer:async()=>{readStarted=true;throw new Error('access denied');}}],
  getData(type){return !readStarted&&type==='text/uri-list'?'file:///C:/pics/%E5%8F%82%E8%80%83.png':'';}
 }});
 assert.equal(h.nodes['reference-thumbs'].children.length,1);
 assert.equal(h.nodes['reference-thumbs'].children[0].children[2].textContent,'参考.png');
 assert.match(decodeURIComponent(urls[0]),/参考\.png/);
 assert.ok(!h.helperCalls.some(call=>/\/drop\/(?!trace)/.test(call.url)));
});
test('Explorer path is read by the local helper when UXP cannot read the dropped file',async()=>{
 const h=harness();await h.ready();
 const blocked=name=>async()=>{throw new Error('access denied');};
 await h.nodes['images-row'].drop({preventDefault(){},dataTransfer:{files:[
  {name:'参考.jpg',path:'C:\\pics\\参考.jpg',arrayBuffer:blocked('jpg')},
  {name:'第二张.webp',nativePath:'D:\\img\\第二张.webp',arrayBuffer:blocked('webp')}
 ]}});
 assert.equal(h.helperCalls.filter(call=>call.url.includes('/drop/read')).length,1);
 assert.ok(!h.helperCalls.some(call=>call.url.includes('/drop/open')));
 assert.deepEqual(JSON.parse(h.helperCalls.find(call=>call.url.includes('/drop/read')).options.body).paths,['C:\\pics\\参考.jpg','D:\\img\\第二张.webp']);
 assert.equal(h.nodes['reference-thumbs'].children.length,2);
 assert.equal(h.nodes['reference-thumbs'].children[0].children[2].textContent,'参考.jpg');
 assert.equal(h.nodes['reference-thumbs'].children[1].children[2].textContent,'第二张.webp');
});
test('a file UXP can read does not call the helper even if it also has a path',async()=>{
 const h=harness({entryForUrl:async()=>{throw new Error('permission denied');}});
 await h.ready();
 await h.nodes['images-row'].drop({preventDefault(){},dataTransfer:{files:[{name:'直接.png',path:'C:\\pics\\直接.png',arrayBuffer:async()=>Uint8Array.from([4]).buffer}]}});
 assert.equal(h.nodes['reference-thumbs'].children[0].children[2].textContent,'直接.png');
 assert.ok(!h.helperCalls.some(call=>/\/drop\/(?!trace)/.test(call.url)));
});
test('unreadable Explorer drop names a closed helper instead of a voice session',async()=>{
 const h=harness({helperDown:true});await h.ready();
 await h.nodes['images-row'].drop({preventDefault(){},dataTransfer:{files:[{name:'参考.png',path:'C:\\pics\\参考.png',arrayBuffer:async()=>{throw new Error('access denied');}}]}});
 assert.equal(h.nodes['reference-thumbs'].children.length,0);
 assert.match(h.nodes.status.textContent,/本机图片拖入服务未开启/);
 assert.doesNotMatch(h.nodes.status.textContent,/语音会话|提交状态不确定/);
});
test('an empty drop outside the add area with the helper closed does not show a voice session',async()=>{
 const h=harness({helperDown:true});await h.ready();
 await h.nodes['images-row'].dragenter({preventDefault(){},dataTransfer:{types:['Files'],files:[],items:[]}});
 await h.nodes['images-row'].drop({preventDefault(){},stopPropagation(){},target:h.nodes['images-row'],dataTransfer:{files:[],items:[]}});
 await h.ready();
 assert.equal(h.nodes['reference-thumbs'].children.length,0);
 assert.doesNotMatch((h.nodes.status&&h.nodes.status.textContent)||'',/语音会话|接图层还在启动|提交状态不确定|已添加/);
 assert.ok(!h.helperCalls.some(call=>/\/drop\/(open|cover)/.test(call.url)));
});
test('the add area names a closed helper instead of a voice session',async()=>{
 const h=harness({helperDown:true,dropGraceMs:400});await h.ready();
 h.nodes.dropzone.getBoundingClientRect=()=>({left:4,top:4,width:100,height:48});
 h.nodes.dropzone.dragenter({preventDefault(){},currentTarget:h.nodes.dropzone,clientX:10,clientY:10,dataTransfer:{types:['Files'],files:[],items:[]}});
 h.nodes.dropzone.drop({preventDefault(){},stopPropagation(){},target:h.nodes.dropzone,dataTransfer:{files:[],items:[]}});
 for(let i=0;i<20&&!/拖入服务未开启/.test((h.nodes.status&&h.nodes.status.textContent)||'');i++)await new Promise(resolve=>setTimeout(resolve,40));
 assert.match(h.nodes.status.textContent,/本机图片拖入服务未开启/);
 assert.doesNotMatch(h.nodes.status.textContent,/语音会话|提交状态不确定/);
 assert.equal(h.nodes['reference-thumbs'].children.length,0);
 assert.equal(h.nodes.generate.disabled,false);
});

test('dropping on an occupied reference replaces only that slot; dropping on the empty slot appends',async()=>{
 const h=harness();await h.ready();await h.nodes['capture-selection'].click();
 const file=(name,value)=>({name,size:1,arrayBuffer:async()=>Uint8Array.from([value]).buffer});
 await h.nodes['images-row'].drop({preventDefault(){},dataTransfer:{files:[file('A.png',1),file('B.png',2)]}});
 const before=h.nodes.preview.src;
 const tile=h.nodes['reference-thumbs'].children[0];
 await h.nodes['images-row'].drop({preventDefault(){},target:tile,dataTransfer:{files:[file('C.webp',3)]}});
 assert.equal(h.nodes['reference-thumbs'].children.length,2);
 assert.equal(h.nodes['reference-thumbs'].children[0].children[2].textContent,'C.webp');
 assert.equal(h.nodes['reference-thumbs'].children[1].children[2].textContent,'B.png');
 assert.equal(h.nodes.preview.src,before);
 await h.nodes['images-row'].drop({preventDefault(){},target:h.nodes.dropzone,dataTransfer:{files:[file('D.jpg',4)]}});
 assert.equal(h.nodes['reference-thumbs'].children.length,3);
 await h.nodes['images-row'].drop({preventDefault(){},target:h.nodes['preview-box'],dataTransfer:{files:[file('E.png',5)]}});
 assert.equal(h.nodes.preview.src,'data:image/png;base64,BQ==');
 assert.equal(h.nodes['reference-thumbs'].children.length,3);
 h.nodes.prompt.value='只调整光照';await h.nodes.generate.click();await h.ready();
 assert.deepEqual(h.requests[0].params.images,['data:image/png;base64,BQ==','data:image/webp;base64,Aw==','data:image/png;base64,Ag==','data:image/jpeg;base64,BA==']);
});

test('updating selection preserves prompt and other references in the same editor',async()=>{
 const h=harness();await h.ready();await h.nodes['capture-selection'].click();
 await h.nodes['images-row'].drop({preventDefault(){},dataTransfer:{files:[{name:'参考.png',size:1,arrayBuffer:async()=>Uint8Array.from([9]).buffer}]}});
 h.nodes.prompt.value='保留用户的修改要求';const previous=h.nodes.preview.src;
 await h.nodes['refresh-selection'].click();
 assert.equal(h.nodes.prompt.value,'保留用户的修改要求');
 assert.equal(h.nodes['reference-thumbs'].children.length,1);
 assert.equal(h.nodes['reference-thumbs'].children[0].children[2].textContent,'参考.png');
 assert.equal(h.nodes.preview.src,previous);
});
test('an uploaded image can be optimized and generated without a Photoshop selection',async()=>{
 const h=harness({noSelection:true});await h.ready();
 await h.nodes['images-row'].drop({preventDefault(){},dataTransfer:{files:[{name:'参考.png',size:1,arrayBuffer:async()=>Uint8Array.from([9]).buffer}]}});
 h.nodes.prompt.value='';await h.nodes['optimize-prompt'].click();
 assert.equal(h.optimizerCalls[0].images.length,1);
 assert.equal(h.optimizerCalls[0].images[0].name,'参考.png');
 assert.equal(h.nodes.prompt.value,'优化后的修改要求');
 await h.nodes.generate.click();await h.ready();
 assert.equal(h.requests.length,1);
 assert.deepEqual(h.requests[0].params.images,['data:image/png;base64,CQ==','data:image/png;base64,YWJj']);
 assert.equal(h.calls.length,0);
});
test('a text prompt alone generates without reading a selection or sending images',async()=>{
 const h=harness({noSelection:true});await h.ready();h.nodes.prompt.value='生成夜晚城市';
 await h.nodes.generate.click();await h.ready();
 assert.equal(h.requests.length,1);
 assert.deepEqual(h.requests[0].params.images,[]);
 assert.equal(h.requests[0].prompt,'生成夜晚城市');
 assert.equal(h.nodes.status.className,'');
});
test('removing an uploaded image excludes it from a later generation request',async()=>{
 const h=harness({noSelection:true});await h.ready();
 await h.nodes['images-row'].drop({preventDefault(){},dataTransfer:{files:[
  {name:'旧.png',size:1,arrayBuffer:async()=>Uint8Array.from([1]).buffer},
  {name:'保留.png',size:1,arrayBuffer:async()=>Uint8Array.from([2]).buffer}
 ]}});
 h.nodes['reference-thumbs'].children[0].children[3].onclick();
 assert.equal(h.nodes['reference-thumbs'].children.length,1);
 await h.nodes.generate.click();await h.ready();
 assert.deepEqual(h.requests[0].params.images,['data:image/png;base64,Ag==']);
});
test('a no-selection result adds a complete image layer when clicked',async()=>{
 const h=harness({noSelection:true});await h.ready();h.nodes.prompt.value='生成海边';
 await h.nodes.generate.click();await h.ready();
 await button(h.nodes['task-content'],'添加图层').onclick();await h.ready();
 assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].length,1);
 assert.match(h.nodes.status.textContent,/完整生成图片/);
});
test('a custom image model can be added, selected, and used for generation',async()=>{
 const h=harness({noSelection:true});await h.ready();
 h.nodes['custom-model'].value='my-image-model';h.nodes['add-model'].click();
 assert.equal(h.nodes.model.value,'my-image-model');
 assert.equal(JSON.parse(h.local.get('lk888-custom-models'))[0].id,'my-image-model');
 h.nodes.prompt.value='生成封面';await h.nodes.generate.click();await h.ready();
 assert.equal(h.requests[0].model,'my-image-model');
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
test('generation releases editor and never auto imports results',async()=>{const h=harness();await h.ready();await h.nodes.generate.click();await h.ready();assert.equal(h.requests.length,1);assert.equal(h.requests[0].params.seed,undefined);assert.doesNotMatch(h.requests[0].prompt,/这一张是第/);assert.equal(h.calls.length,0);assert.equal(h.nodes.generate.disabled,false);assert.ok(JSON.parse(h.local.get('lk888-jobs'))[0].tasks[0].results.length);});
test('same-size document with a new id is adopted instead of asking for another selection read',async()=>{
 const h=harness();await h.ready();await h.nodes['capture-selection'].click();
 h.app.activeDocument.id=77;
 h.nodes.prompt.value='字体写清楚';await h.nodes.generate.click();await h.ready();
 assert.equal(h.requests.length,1);
 assert.equal(h.capture.context.documentId,77);
 assert.doesNotMatch(h.nodes.status.textContent,/请读取当前文档选区|语音会话|提交状态不确定/);
});
test('a different canvas size still asks for the current document selection',async()=>{
 const h=harness();await h.ready();await h.nodes['capture-selection'].click();
 h.app.activeDocument.id=77;h.app.activeDocument.width=50;h.app.activeDocument.height=50;
 h.nodes.prompt.value='字体写清楚';await h.nodes.generate.click();await h.ready();
 assert.equal(h.requests.length,0);
 assert.match(h.nodes.status.textContent,/请读取当前文档选区/);
 assert.doesNotMatch(h.nodes.status.textContent,/语音会话/);
});
test('a healthy helper without image prepare still submits and does not claim the assistant is off',async()=>{
 const h=harness({helperPrepareMissing:true});await h.ready();await h.nodes['capture-selection'].click();
 h.nodes.prompt.value='字体写清楚小浣熊干脆面';await h.nodes.generate.click();await h.ready();
 const notes=(h.nodes['task-content'].children||[]).map(node=>node.textContent||'').join('\n');
 const text=h.nodes.status.textContent+'\n'+notes;
 assert.equal(h.requests.length,1);
 assert.match(text,/图片预处理不可用/);
 assert.doesNotMatch(text,/本机助手未开启|语音会话|未收到任务编号/);
});
test('a closed helper skips image prepare, submits the original, and never shows voice copy',async()=>{
 const h=harness({helperDown:true});await h.ready();await h.nodes['capture-selection'].click();
 h.nodes.prompt.value='字体写清楚小浣熊干脆面';await h.nodes.generate.click();await h.ready();
 const notes=(h.nodes['task-content'].children||[]).map(node=>node.textContent||'').join('\n');
 const text=h.nodes.status.textContent+'\n'+notes;
 assert.equal(h.requests.length,1);
 assert.match(text,/本机助手未开启/);
 assert.doesNotMatch(text,/语音会话|提交状态不确定|尚无生成结果|请读取当前文档选区/);
 const job=JSON.parse(h.local.get('lk888-jobs'))[0];
 assert.notEqual(job.state,'uncertain');
 assert.ok(job.tasks.length||job.state==='ready'||job.state==='running'||job.state==='failed');
});
test('generation failure shows the provider reason and never a voice-session or uncertain status',async()=>{
 const h=harness({submissionMessage:'模型不存在或当前密钥无权限'});await h.ready();
 h.nodes.prompt.value='字体写清楚小浣熊干脆面';await h.nodes.generate.click();await h.ready();
 assert.match(h.nodes.status.textContent,/模型不存在或当前密钥无权限/);
 assert.doesNotMatch(h.nodes.status.textContent,/提交状态不确定|语音会话/);
 assert.doesNotMatch(h.nodes['input-notice']?.textContent||'',/语音/);
 const notes=(h.nodes['task-content'].children||[]).map(node=>node.textContent||'').join('\n');
 assert.match(notes,/模型不存在或当前密钥无权限/);
 assert.doesNotMatch(notes,/尚无生成结果|语音会话|提交状态不确定/);
 const job=JSON.parse(h.local.get('lk888-jobs'))[0];
 assert.equal(job.state,'failed');assert.match(job.error,/模型不存在或当前密钥无权限/);
});
test('reload button saves the current editor and reloads without resubmitting',async()=>{const h=harness();await h.ready();await h.nodes['tab-edit'].click();h.nodes.prompt.value='保留这个提示词';await h.nodes['reload-panel'].click();assert.equal(h.reloads,1);assert.equal(JSON.parse(h.local.get('lk888-jobs'))[0].prompt,'保留这个提示词');assert.equal(h.local.get('lk888-reload-job-id'),JSON.parse(h.local.get('lk888-jobs'))[0].id);assert.equal(h.requests.length,0);});
test('automatic generation size and ratio follow the selected region',async()=>{const h=harness();await h.ready();await h.nodes['capture-selection'].click();await h.nodes.generate.click();await h.ready();assert.equal(h.requests[0].params.image_size,'1K');assert.equal(h.requests[0].params.aspect_ratio,'16:9');});
test('another region can submit while previous task remains in history',async()=>{const h=harness();await h.ready();await h.nodes.generate.click();await h.ready();await h.nodes['capture-selection'].click();h.nodes.prompt.value='修改另一区域';await h.nodes.generate.click();await h.ready();assert.equal(h.requests.length,2);assert.equal(JSON.parse(h.local.get('lk888-jobs')).length,2);assert.equal(h.calls.length,0);});
test('model quality aspect and four tasks are preserved',async()=>{const h=harness();await h.ready();h.nodes.count.value='4';h.nodes.quality.value='2K';h.nodes['output-size'].value='16:9';await h.nodes.generate.click();await h.ready();assert.equal(h.requests.length,4);assert.equal(h.requests[0].params.image_size,'2K');assert.equal(h.requests[0].params.aspect_ratio,'16:9');assert.ok(h.requests.every(request=>request.params.seed===undefined&&request.params.chaos===undefined));const prompts=h.requests.map(request=>request.prompt);assert.equal(new Set(prompts).size,4);for(const n of [1,2,3,4])assert.match(prompts.join('\n'),new RegExp('第'+n+'张候选'));assert.equal(new Set(h.requests.map(request=>JSON.stringify(request.params.images))).size,1);assert.match(JSON.parse(h.local.get('lk888-jobs'))[0].prepareNote,/不同候选/);assert.equal(h.calls.length,0);});
test('midjourney count asks for chaos instead of an ignored seed',async()=>{const h=harness();await h.ready();h.nodes.model.value='mj_imagine';h.nodes.count.value='3';await h.nodes.generate.click();await h.ready();assert.deepEqual(h.requests.map(request=>request.params.chaos).sort((a,b)=>a-b),[40,70,100]);assert.ok(h.requests.every(request=>request.params.seed===undefined));assert.equal(new Set(h.requests.map(request=>request.prompt)).size,3);});

function findNode(root,predicate){if(predicate(root))return root;for(const child of root.children||[]){const match=findNode(child,predicate);if(match)return match;}return null;}
function findNodes(root,predicate){return [...(predicate(root)?[root]:[]),...(root.children||[]).flatMap(child=>findNodes(child,predicate))];}
function button(root,label){const found=findNode(root,node=>node.id==='button'&&node.textContent===label)||findNode(root,node=>node.id==='button'&&((node.textContent||'').includes(label)||(node.title||'').includes(label)||(node.attributes?.['aria-label']||'').includes(label)));assert.ok(found,`Missing button: ${label}`);return found;}

test('completed result stays visible as a card with an add-layer button after reopening history',async()=>{
 const h=harness();await h.ready();await h.nodes['capture-selection'].click();await h.nodes.generate.click();await h.ready();
 const root=h.nodes['task-content'];
 assert.equal(findNodes(root,node=>node.className==='task-result').length,1);
 assert.equal(root.children.filter(node=>node.className==='task-result').length,1);
 assert.ok(button(root,'添加图层'));
 await h.nodes['tab-tasks'].click();await button(root,'局部改图 1').onclick();await h.ready();
 assert.equal(findNodes(root,node=>node.className==='task-result').length,1);
 assert.equal(findNodes(root,node=>node.textContent==='生成完成，点击候选图添加图层。').length,1);
});

test('result actions use compact icons with clear accessible names below the image',async()=>{
 const h=harness();await h.ready();await h.nodes['capture-selection'].click();await h.nodes.generate.click();await h.ready();
 const card=findNode(h.nodes['task-content'],node=>node.className==='task-result');
 assert.equal(card.children[0].id,'span');
 assert.equal(card.children[1].id,'img');
 assert.equal(card.children[2].className,'task-actions');
 assert.equal(card.children[3].className,'task-caption');
 assert.equal(button(card,'添加图层').textContent,'⊞');
 assert.equal(button(card,'放大预览').textContent,'⤢');
 assert.equal(button(card,'保存原图').textContent,'⇩');
});

test('completed candidate can be added repeatedly with subtle feather inside the selection',async()=>{
 const h=harness();await h.ready();await h.nodes['capture-selection'].click();await h.nodes.generate.click();await h.ready();
 const readsBefore=h.reads.length;
 await button(h.nodes['task-content'],'添加图层').onclick();await h.ready();
 assert.equal(h.calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][2])),h.capture.bounds);
 assert.equal(h.calls[0][4].enabled,true);assert.equal(h.calls[0][4].bias,-1);assert.equal(h.calls[0][4].maxRadius,3);
 await button(h.nodes['task-content'],'再次添加').onclick();await h.ready();
 assert.equal(h.calls.length,2);assert.deepEqual(JSON.parse(JSON.stringify(h.calls[1][2])),h.capture.bounds);assert.equal(h.requests.length,1);
 assert.equal(h.imageDecodes,1);
 assert.equal(h.reads.length,readsBefore);
});
test('candidate cannot be inserted into a different Photoshop document',async()=>{const h=harness({switchDocument:true});await h.ready();await h.nodes['capture-selection'].click();await h.nodes.generate.click();await h.ready();await button(h.nodes['task-content'],'添加图层').onclick();await h.ready();assert.equal(h.calls.length,0);assert.match(h.nodes.status.textContent,/同一个 PSD/);});
test('history result can be inserted after reopening the same saved PSD',async()=>{const h=harness({reopenSameDocument:true});await h.ready();await h.nodes.generate.click();await h.ready();await button(h.nodes['task-content'],'添加图层').onclick();await h.ready();assert.equal(h.calls.length,1);});
test('older pathless history can use the matching document name and canvas size',async()=>{const h=harness({reopenPathless:true});await h.ready();await h.nodes.generate.click();await h.ready();await button(h.nodes['task-content'],'添加图层').onclick();await h.ready();assert.equal(h.calls.length,1);});
test('history list appears in the native results panel',async()=>{const h=harness();await h.ready();await h.nodes['capture-selection'].click();await h.nodes.generate.click();await h.ready();await h.nodes['tab-tasks'].click();assert.ok(button(h.nodes['task-content'],'局部改图 1'));});
test('history restores prompt and generation options in the same editor',async()=>{const h=harness();await h.ready();h.nodes.quality.value='2K';h.nodes['output-size'].value='3:4';await h.nodes['capture-selection'].click();await h.nodes.generate.click();await h.ready();await h.nodes['tab-edit'].click();assert.equal(h.nodes.prompt.value,'');await h.nodes['tab-tasks'].click();await button(h.nodes['task-content'],'局部改图 1').onclick();await h.ready();assert.equal(h.nodes.prompt.value,'改成红色');assert.equal(h.nodes.quality.value,'2K');assert.equal(h.nodes['output-size'].value,'3:4');assert.equal(h.nodes.editor.style.display,'block');assert.equal(h.nodes['panel-title'].textContent,'局部改图 1');});
test('deleting history removes only the chosen local record',async()=>{const h=harness();await h.ready();await h.nodes.generate.click();await h.ready();await h.nodes['tab-tasks'].click();await button(h.nodes['task-content'],'删除').onclick();await h.ready();assert.equal(JSON.parse(h.local.get('lk888-jobs')).length,0);assert.equal(h.requests.length,1);assert.equal(h.calls.length,0);});
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
 const h=harness();await h.ready();await h.nodes['capture-selection'].click();await h.nodes.generate.click();await h.ready();await h.nodes['tab-edit'].click();await h.nodes['tab-tasks'].click();
 await button(h.nodes['task-content'],'删除').onclick();
 const jobs=JSON.parse(h.local.get('lk888-jobs'));assert.equal(jobs.length,1);assert.equal(jobs[0].number,1);assert.equal(jobs[0].title,'局部改图 1');
});
test('history can select one record and delete it after confirmation',async()=>{
 const h=harness();await h.ready();await h.nodes.generate.click();await h.ready();await h.nodes['tab-edit'].click();await h.nodes.generate.click();await h.ready();await h.nodes['tab-edit'].click();await h.nodes.generate.click();await h.ready();
 await h.nodes['tab-tasks'].click();button(h.nodes['task-content'],'选择删除').onclick();
 button(h.nodes['task-content'],'选择 局部改图 2').onclick();
 button(h.nodes['task-content'],'删除选中 (1)').onclick();
 assert.equal(JSON.parse(h.local.get('lk888-jobs')).length,3);
 await button(h.nodes['task-content'],'确认删除 1 条').onclick();
 const jobs=JSON.parse(h.local.get('lk888-jobs'));
 assert.equal(jobs.length,2);assert.deepEqual(jobs.map(j=>j.number),[2,1]);
});
test('history select all deletes only after the second click',async()=>{
 const h=harness();await h.ready();await h.nodes.generate.click();await h.ready();await h.nodes['tab-edit'].click();await h.nodes.generate.click();await h.ready();
 await h.nodes['tab-tasks'].click();button(h.nodes['task-content'],'选择删除').onclick();button(h.nodes['task-content'],'全选').onclick();
 button(h.nodes['task-content'],'删除选中 (2)').onclick();assert.equal(JSON.parse(h.local.get('lk888-jobs')).length,2);
 await button(h.nodes['task-content'],'确认删除 2 条').onclick();assert.equal(JSON.parse(h.local.get('lk888-jobs')).length,0);
});
test('native scrollbar arrows advance exactly two ordered rows without duplicate buttons',async()=>{
 const h=harness();await h.ready();for(let i=0;i<20;i++)await h.newDraft();
 await h.nodes['document-tabs'].children[0].click();await h.ready();
 assert.equal(h.nodes['document-tabs'].scrollTop,0);
 const tabs=h.nodes['document-tabs'];tabs.getBoundingClientRect=()=>({left:0,top:0,width:200,height:64});
 const arrow=(y)=>tabs.mousedown({clientX:190,clientY:y,preventDefault(){}});
 arrow(60);assert.equal(tabs.scrollTop,64);
 arrow(60);assert.equal(tabs.scrollTop,128);
 arrow(4);assert.equal(tabs.scrollTop,64);
 tabs.scrollTop=96;tabs.scroll();assert.equal(tabs.scrollTop,64);
 await new Promise(resolve=>setTimeout(resolve,90));tabs.scrollTop=96;tabs.scroll();assert.equal(tabs.scrollTop,128);
 assert.deepEqual(h.nodes['document-tabs'].children.map(node=>Number(node.children[0].textContent)),Array.from({length:20},(_,i)=>i+1));
 assert.match(fs.readFileSync('plugin/panel.css','utf8'),/height:64px; max-height:64px; overflow-x:hidden; overflow-y:auto/);
 const css=fs.readFileSync('plugin/panel.css','utf8');
 const html=fs.readFileSync('plugin/index.html','utf8');
 assert.match(html,/id="panel-scroll"/);
 assert.match(css,/width:calc\(100% \+ 20px\)/);
 assert.match(css,/scrollbar-width:none/);
 assert.match(css,/main::-webkit-scrollbar/);
 assert.match(css,/\.prompt-editor textarea::-webkit-scrollbar/);
 assert.doesNotMatch(fs.readFileSync('plugin/index.html','utf8'),/id="tabs-(up|down)"/);
});

test('a hung read reports progress, a second click is not silent, and the timeout unlocks the panel',async()=>{
 const h=harness({captureHangs:true,busyTimeoutMs:300});await h.ready();
 const pending=h.nodes['capture-selection'].click();
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.match(h.nodes.status.textContent,/正在读取选区/);
 assert.equal(h.nodes.generate.textContent,'正在准备…');
 await h.nodes['capture-selection'].click();
 assert.match(h.nodes.status.textContent,/正在处理/);
 await pending;
 assert.match(h.nodes.status.textContent,/解除锁定/);
 assert.equal(h.nodes.generate.disabled,false);
 assert.equal(h.nodes.generate.textContent,'生成');
});
test('reload stays available while a selection read is still busy',async()=>{
 const h=harness({captureHangs:true,busyTimeoutMs:1000});await h.ready();
 const pending=h.nodes['capture-selection'].click();
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.match(h.nodes.status.textContent,/正在读取选区/);
 await h.nodes['reload-panel'].click();
 assert.equal(h.reloads,1);
 assert.match(h.nodes.status.textContent,/正在重载面板|正在读取选区|正在处理/);
 pending.catch(()=>{});
});
test('selection read accepts a capture whose reported origin does not exactly match the crop',async()=>{
 const h=harness({captureMismatch:true});await h.ready();
 await h.nodes['capture-selection'].click();
 assert.doesNotMatch(h.nodes['selection-size'].textContent,/尚未读取/);
 assert.match(h.nodes.status.textContent,/已读取选区/);
 assert.match(h.nodes.preview.src,/^data:image\/png/);
 assert.equal(h.captureArgs[0][3].selectionBounds.width,200);
 assert.equal(h.nodes.generate.textContent,'生成');
});
test('reading a selection does not depend on the synchronous selection.bounds getter',async()=>{
 const h=harness({boundsThrows:true});await h.ready();
 await h.nodes['capture-selection'].click();
 assert.match(h.nodes.status.textContent,/已读取选区/);
 assert.doesNotMatch(h.nodes['selection-size'].textContent,/尚未读取/);
});
test('a capture failure stays on the status line and releases the lock',async()=>{
 const h=harness({captureError:'选区导出失败：模拟'});await h.ready();
 await h.nodes['capture-selection'].click();
 assert.match(h.nodes.status.textContent,/选区导出失败：模拟/);
 assert.match(h.nodes['selection-size'].textContent,/尚未读取选区/);
 assert.equal(h.nodes.generate.disabled,false);
 assert.equal(h.nodes.generate.textContent,'生成');
});
test('result thumbnails keep their source and do not download the original until add or save',async()=>{
 const h=harness();await h.ready();await h.nodes.generate.click();await h.ready();
 const img=findNode(h.nodes['task-content'],node=>node.id==='img');
 if(img.onload)await img.onload();
 if(img.onerror)await img.onerror();
 assert.equal(h.imageDecodes,0);
 assert.match(img.src,/^data:image\/png/);
 await button(h.nodes['task-content'],'放大预览').onclick();
 assert.equal(h.nodes['task-preview'].style.display,'flex');
 assert.match(h.nodes['task-preview-image'].src,/^data:image\/png/);
 await button(h.nodes['task-content'],'添加图层').onclick();await h.ready();
 assert.equal(h.imageDecodes,1);
});
test('remote candidate preview comes from the downloaded file, and zoom uses that same preview',async()=>{
 const h=harness({remoteResult:true});await h.ready();await h.nodes.generate.click();await h.ready();
 const img=findNode(h.nodes['task-content'],node=>node.id==='img');
 const caption=findNode(h.nodes['task-content'],node=>node.className==='task-caption');
 assert.ok(img.src,'preview src was not assigned');
 assert.doesNotMatch(img.src,/^https:/);
 assert.match(img.src,/^(blob:|data:image\/png)/);
 if(/^blob:/.test(img.src)&&img.onerror){await img.onerror();assert.match(img.src,/^data:image\/png/);}
 img.naturalWidth=32;img.naturalHeight=16;if(img.onload)await img.onload();
 assert.equal(caption.textContent,'32 × 16');
 await button(h.nodes['task-content'],'放大预览').onclick();
 assert.equal(h.nodes['task-preview'].style.display,'flex');
 assert.doesNotMatch(h.nodes['task-preview-image'].src,/^https:/);
 assert.match(h.nodes['task-preview-image'].src,/^(blob:|data:image\/png)/);
 h.nodes['task-preview-close'].click();
 assert.equal(h.nodes['task-preview'].style.display,'none');
 assert.equal(h.nodes['task-preview-image'].src,'');
});
test('a failed remote preview says add and save still work',async()=>{
 const h=harness({remoteResult:true,remoteDownloadFails:true});await h.ready();await h.nodes.generate.click();await h.ready();
 const caption=findNode(h.nodes['task-content'],node=>node.className==='task-caption');
 assert.equal(caption.textContent,'预览加载失败，仍可点击添加图层或保存原图');
 assert.ok(button(h.nodes['task-content'],'添加图层'));
 assert.ok(button(h.nodes['task-content'],'保存原图'));
 await button(h.nodes['task-content'],'放大预览').onclick();await h.ready();
 assert.equal(h.nodes['task-preview-note'].textContent,'预览加载失败，仍可点击添加图层或保存原图');
});
test('uploaded references survive reopening a draft without a selection',async()=>{
 const h=harness({noSelection:true});await h.ready();await h.newDraft();
 await h.nodes['images-row'].drop({preventDefault(){},dataTransfer:{files:[{name:'保留.png',size:1,arrayBuffer:async()=>Uint8Array.from([9]).buffer}]}});
 const id=h.currentId();await h.newDraft();await h.openHistory(id);h.nodes.prompt.value='继续生成';
 await h.nodes.generate.click();await h.ready();assert.deepEqual(h.requests[0].params.images,['data:image/png;base64,CQ==']);
});
