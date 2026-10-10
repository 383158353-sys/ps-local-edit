const { app, imaging, constants, action } = require('photoshop');
const { storage, shell } = require('uxp');
const ps = require('./modules/ps');
const fileUtils = require('./modules/fs');
const { MODELS, MediaClient, imageSources, unwrap } = require('./api');
const { TaskQueue }=require('./task-queue');
const { pngRGBA }=require('./png');
const { VoiceController }=require('./voice');
const { PromptEditor }=require('./prompt-editor');
const { closestStandardAspect, closestStandardImageSize }=require('./modules/geometry');
const LOCAL_EDIT_EDGE_FEATHER={enabled:true,bias:-1,relative:0.015,minRadius:1,maxRadius:3};
let queue=null, pageName='edit', selectedJobId=null, historyOpen=false;
let promptEditor=null,tabsSignature='',historySignature='';
const voice=new VoiceController({context:()=>selectedJobId,onState:data=>promptEditor?.voice(data),onText:text=>promptEditor?.insert(text)});
async function saveCurrent(){const record=queue?.jobs.find(j=>j.id===selectedJobId);if(!record)return;record.prompt=$('prompt').value;record.model=$('model').value||record.model;record.quality=$('quality').value||'auto';record.ratio=$('output-size').value||'original';record.count=Number($('count').value)||1;if(capture&&sourceImage){await snapshot(record.captureRef);record.captureWidth=capture.bounds.width;record.captureHeight=capture.bounds.height;}queue.save();}
async function newDraft(){voice.cancel();await saveCurrent();const number=Math.max(0,...queue.jobs.map(j=>j.number||0))+1,id='region-'+Date.now();queue.jobs.unshift({id,captureRef:id,title:'局部改图 '+number,number,createdAt:Date.now(),state:'draft',tasks:[],prompt:'',count:1});selectedJobId=id;capture=null;sourceImage=null;references=[];$('prompt').value='';queue.save();show('selection-gate',true);navigatePage('edit');syncInputs();status('新建改图：请读取选区。');}
const fs = storage.localFileSystem;
let capture = null, reference = null, busy = false, initialized = false;
let job = null;
let pauseRequested=false, modelList=MODELS.slice();
function renderModels(){const node=$('model');if(!document.createElement)return;const selected=node.value;node.innerHTML='';const menu=document.createElement('sp-menu');menu.setAttribute('slot','options');modelList.forEach(model=>{const item=document.createElement('sp-menu-item');item.setAttribute('value',model.id);item.textContent=model.label || model.id;if(model.id===selected)item.setAttribute('selected','');menu.appendChild(item);});node.appendChild(menu);node.value=modelList.some(m=>m.id===selected)?selected:(modelList[0]||{}).id;$('models-status').textContent='已保存 '+modelList.length+' 个模型。';}
let references = [], sourceImage = null, settingsOpen = false;
function syncInputs(){const view=$('input-webview');if(view.postMessage)view.postMessage(JSON.stringify({type:'state',source:sourceImage?{data:sourceImage,name:capture.bounds.width+' × '+capture.bounds.height}:null,references,busy}));}
function archiveCompleted(){if(job && job.source && job.state!=='uncertain'){localStorage.setItem('lk888-last-result',JSON.stringify(job));job=null;saveJob();}}

function show(id, visible, display = "block") { const node = $(id),target=visible?display:"none";if(node.hidden!==!visible)node.hidden=!visible;if(node.style && node.style.display!==target)node.style.display=target; }
const $ = id => document.getElementById(id);
function status(message, error = false) { $('status').textContent = message; $('status').className = error ? 'error' : ''; }
function matchesTaskDocument(doc, region){
 if(!doc||!region?.context)return false;
 const context=region.context;
 const sameCanvas=doc.name===context.documentName&&doc.width===region.documentWidth&&doc.height===region.documentHeight;
 if(doc.id===context.documentId)return sameCanvas;
 // Photoshop assigns a new in-memory id after reopening a PSD. For a saved
 // document, allow history import only when its full path and canvas size match.
 if(!context.documentPath||!doc.path)return sameCanvas;
 const normalize=value=>String(value).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
 return normalize(doc.path)===normalize(context.documentPath)&&sameCanvas;
}
function saveJob() { if (job) localStorage.setItem('lk888-job', JSON.stringify(job)); else localStorage.removeItem('lk888-job'); }
function refresh() {
  $('generate').disabled = busy;
  $('generate').textContent = busy ? '正在提交 / 添加…' : '生成';
  $('quality').disabled = busy; $('count').disabled = busy; $('output-size').disabled = busy;
  show('pause-wait',false);
  $('model').disabled = busy; if(promptEditor)promptEditor.setBusy(busy);else $('prompt').disabled=busy;
  $('add-reference').disabled = busy; $('clear-reference').disabled = busy;
  show('recovery',false);
  $('resume').disabled = busy || !job || !job.taskId;
  show('resume', !!(job && job.taskId));
  show('import-result', !!(job && job.source && capture && !job.imported));
  show('save-result', !!(job && job.source));
  $('import-result').disabled = busy; $('save-result').disabled = busy;
  $('reset-job').disabled = busy;
  syncInputs();
}
async function key() {
  try { const value = await storage.secureStorage.getItem('lk888-key'); return String.fromCharCode(...value); }
  catch (_) { throw new Error('请在设置中填写并保存 API Key。'); }
}
async function client() { return new MediaClient(await key()); }
async function withBusy(fn) {
  if (busy) return; busy = true; refresh();
  try { await fn(); } catch (error) { status(error.message || '操作失败，请检查设置后重试。', true); }
  finally { busy = false; refresh(); }
}
async function download(source) {
  if (source.startsWith('data:image/')) return { buffer: fileUtils.base64ToArrayBuffer(source.split(',')[1]), ext: source.includes('image/jpeg') ? 'jpg' : source.includes('image/webp') ? 'webp' : 'png' };
  if (!/^https:\/\//.test(source)) throw new Error('结果地址必须使用 HTTPS。');
  let response;
  try { response = await fetch(source); } // No API credentials on image download.
  catch (_) { throw new Error('图片已生成，但下载结果时网络失败。点击「导入结果」重试下载，不会重复生图。'); }
  if (!response.ok) throw new Error('结果下载失败，请稍后重新查询原任务。');
  const type = response.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error('结果地址没有返回图片，请核对平台返回格式。');
  return { buffer: await response.arrayBuffer(), ext: /jpeg/.test(type) ? 'jpg' : /webp/.test(type) ? 'webp' : 'png' };
}
async function importImage() {
  if (!capture || !job || !job.source) throw new Error('本次选区不可恢复。请保存结果后手动导入 PS。');
  if (job.imported) throw new Error('此结果已导入。结束任务记录后可再次生成。');
  const doc = app.activeDocument;
  if (!matchesTaskDocument(doc,capture)) throw new Error('请打开生成时保存的同一个 PSD 文件，再点「导入结果」。');
  if (doc.width !== capture.documentWidth || doc.height !== capture.documentHeight) throw new Error('原画布尺寸已变化，请保存结果后手动导入，避免错位。');
  const { buffer, ext } = await download(job.source);
  if (!buffer.byteLength || buffer.byteLength > 60 * 1024 * 1024) throw new Error('图片为空或超过 60MB。');
  const folder = await fs.getTemporaryFolder();
  const file = await folder.createFile('lk888-' + Date.now() + '.' + ext, { overwrite: true });
  await file.write(buffer, { format: storage.formats.binary });
  await ps.placeBack('editableSo', fs.createSessionToken(file), capture.bounds, capture.maskData, { ...LOCAL_EDIT_EDGE_FEATHER, skipImageBlur: true });
  job.imported = true; if(job.tasks){const task=job.tasks.find(t=>t.id===job.taskId);if(task)task.imported=true;} saveJob();
  status('已添加独立图层与原选区蒙版。Ctrl+Z 可撤销。');
  // Permit a new run after a successful import, keep the result available until then.
  $('generate').disabled = false;
}
function tasksUI(){
 if(!queue)return;
 const tabs=$('document-tabs'),visible=queue.jobs.filter(j=>!j.closed).slice().reverse();
 const nextTabs=JSON.stringify([selectedJobId,visible.map(j=>[j.id,j.title,j.number])]);
 if(document.createElement && nextTabs!==tabsSignature){
  tabsSignature=nextTabs;tabs.innerHTML='';
  visible.forEach((record,index)=>{
   const id=record.id,number=record.number??(Number(record.title.match(/\d+$/)?.[0])||index+1),button=document.createElement('sp-action-button');button.className='tab-button';button.setAttribute('quiet','');if(id===selectedJobId)button.classList.add('active');
   const label=document.createElement('span');label.className='tab-number';label.textContent=String(number);button.appendChild(label);
   button.addEventListener('click',()=>withBusy(()=>openHistory(id)));
   const close=document.createElement('span');close.className='tab-close';close.textContent='×';close.setAttribute('role','button');close.setAttribute('tabindex','0');close.setAttribute('aria-label','删除改图 '+number);close.title='删除此改图';
   const remove=event=>{event.preventDefault();event.stopPropagation();withBusy(async()=>{const current=queue.jobs.find(j=>j.id===id);if(!current)return;current.closed=true;queue.save();if(selectedJobId===id){const next=queue.jobs.find(j=>!j.closed);if(next)await openHistory(next.id);else await newDraft();}});};
   close.addEventListener('click',remove);close.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){remove(event);}});
   button.appendChild(close);tabs.appendChild(button);
  });
 }
 const node=$('task-webview');if(node.postMessage)node.postMessage(JSON.stringify({type:'jobs',selectedJobId,historyOpen,jobs:queue.jobs.map(j=>({...j,width:j.captureWidth,height:j.captureHeight,stateLabel:j.state==='ready'?'完成，点击图片添加图层':j.state==='uncertain'?'部分提交未确认，请到平台核对':j.state==='submitting'?'提交中':j.state==='failed'?'失败':'后台生成中'}))}));
 const history=$('history-list'),nextHistory=JSON.stringify(queue.jobs.map(j=>[j.id,j.title,!!j.closed]));
 if(document.createElement && nextHistory!==historySignature){historySignature=nextHistory;history.innerHTML='';queue.jobs.forEach((record,index)=>{const number=record.number??(Number(record.title.match(/\d+$/)?.[0])||index+1),item=document.createElement('sp-action-button');item.textContent=String(number);item.title=record.title+(record.closed?' · 已关闭':'');item.setAttribute('aria-label',item.title);item.addEventListener('click',()=>withBusy(()=>openHistory(record.id)));history.appendChild(item);});}
 show('history-list',historyOpen&&pageName!=='settings','grid');const historyLabel='历史记录 ('+queue.jobs.length+')';if($('tab-tasks').textContent!==historyLabel)$('tab-tasks').textContent=historyLabel;const selected=queue.jobs.find(j=>j.id===selectedJobId);$('panel-title').textContent=selected?.title||'局部改图';
}
function navigatePage(page){if(page==='settings')voice.cancel();pageName=page;show('editor',page!=='settings');show('task-page',true);show('settings',page==='settings');show('page-tabs',true,'flex');show('refresh-selection',page!=='settings','inline-block');show('tab-tasks',page!=='settings','inline-block');$('settings-toggle').textContent=page==='settings'?'返回':'设置';tasksUI();}
async function snapshot(id){const folder=await fs.getDataFolder(),meta=await folder.createFile(id+'.json',{overwrite:true}),mask=await folder.createFile(id+'.bin',{overwrite:true});const bytes=capture.maskData.imageData;await mask.write(bytes.buffer?bytes.buffer.slice(bytes.byteOffset||0,(bytes.byteOffset||0)+bytes.byteLength):bytes,{format:storage.formats.binary});await meta.write(JSON.stringify({bounds:capture.bounds,aspectRatio:capture.aspectRatio,aspectRatioMatched:capture.aspectRatioMatched,context:capture.context,documentWidth:capture.documentWidth,documentHeight:capture.documentHeight,sourceImage,references,mask:{width:capture.maskData.width,height:capture.maskData.height,components:1,sourceBounds:capture.maskData.sourceBounds}}));}
async function restoreCapture(id){const folder=await fs.getDataFolder(),meta=JSON.parse(await(await folder.getEntry(id+'.json')).read()),bytes=await(await folder.getEntry(id+'.bin')).read({format:storage.formats.binary});return {...meta,maskData:{...meta.mask,imageData:new Uint8Array(bytes)}};}
async function generate(){voice.cancel();
 const prompt=$('prompt').value.trim();if(!prompt)throw new Error('请填写修改要求。');
 if(!capture || !sourceImage)await readSelection();
 if(!app.activeDocument || app.activeDocument.id!==capture.context.documentId)throw new Error('请读取当前文档选区。');
 const configuredRatio=$('output-size').value||'original',selection=capture.context.originalBounds;
 const ratio=configuredRatio==='original'?closestStandardAspect(selection.right-selection.left,selection.bottom-selection.top):configuredRatio;
 if(capture.aspectRatio && capture.aspectRatio!==ratio){await readSelection(ratio,true);$('prompt').value=prompt;}
 const selectedModel=$('model').value || modelList[0]?.id,model=selectedModel==='custom'?$('custom-model').value.trim():selectedModel;if(!model)throw new Error(selectedModel==='custom'?'请先在设置里填写自定义模型 ID。':'请选择模型。');
 const params={},qualityChoice=$('quality').value||'auto',quality=qualityChoice==='auto'?closestStandardImageSize(selection.right-selection.left,selection.bottom-selection.top):qualityChoice;params.image_size=quality;if(capture.aspectRatioMatched!==false)params.aspect_ratio=ratio;
 const existing=queue.jobs.find(j=>j.id===selectedJobId);const id=existing?.state==='draft'?existing.id:'region-'+Date.now(),region=capture.context.originalBounds,b=capture.bounds;
 await snapshot(id);
 const record={id,title:existing?.state==='draft'?existing.title:'局部改图 '+(Math.max(0,...queue.jobs.map(j=>j.number||0))+1),number:existing?.state==='draft'?existing.number:Math.max(0,...queue.jobs.map(j=>j.number||0))+1,quality,ratio,model,prompt,count:Math.max(1,Math.min(4,parseInt($('count').value||'1',10)||1)),createdAt:Date.now(),captureWidth:b.width,captureHeight:b.height,captureRef:id,tasks:[],state:'submitting',instruction:'编辑图片1，保持画面尺寸、构图与主体位置。修改范围相对像素坐标：'+[region.left-b.left,region.top-b.top,region.right-b.left,region.bottom-b.top].map(Math.round).join(',')+'。其余图片按编号作为参考。修改要求：'+prompt};
 await queue.submit(record,[sourceImage,...references.map(r=>r.data)],params);
 selectedJobId=id;syncInputs();show('selection-gate',false);navigatePage('edit');status('已提交。下方显示生成状态；点击新建改图可以继续修改其他区域。');queue.tick();
}
async function openHistory(id){voice.cancel();if(selectedJobId!==id)await saveCurrent();const record=queue.jobs.find(j=>j.id===id);if(!record)return;record.closed=false;historyOpen=false;selectedJobId=id;tasksUI();try{capture=await restoreCapture(record.captureRef);}catch(_){capture=null;}sourceImage=capture?.sourceImage||null;references=capture?.references||[];if(!sourceImage && capture){try{const folder=await fs.getDataFolder(),meta=JSON.parse(await(await folder.getEntry('selection.json')).read());if(meta.context.documentId===capture.context.documentId && JSON.stringify(meta.bounds)===JSON.stringify(capture.bounds))sourceImage=meta.sourceImage;}catch(_){}}$('prompt').value=record.prompt;$('model').value=record.model;$('quality').value=record.quality||'auto';$('output-size').value=record.ratio||'original';$('count').value=String(record.count||1);show('selection-gate',false);navigatePage('edit');syncInputs();status(sourceImage?'已恢复当时的输入。结果完成后点击图片添加图层。':'旧记录未保存输入缩略图；提示词和结果已恢复。');}
async function candidateAction(data){const record=queue.jobs.find(j=>j.id===data.jobId),task=record?.tasks.find(t=>t.id===data.taskId),result=task?.results[data.index];if(!result)throw new Error('结果不存在。');
 const {buffer,ext}=await download(result.source);
 if(data.type==='preview'){const folder=await fs.getTemporaryFolder(),file=await folder.createFile('preview-'+task.id+'-'+data.index+'.'+ext,{overwrite:true});await file.write(buffer,{format:storage.formats.binary});const error=await shell.openPath(file.nativePath);if(error)throw new Error(error);status('已在系统图片查看器打开原尺寸结果。');return;}
 if(data.type==='save'){const file=await fs.getFileForSaving('AI-'+task.id+'-'+(data.index+1)+'.'+ext,{types:[ext]});if(file)await file.write(buffer,{format:storage.formats.binary});status('已保存模型返回的原始文件，没有重新压缩。');return;}
 const region=await restoreCapture(record.captureRef),doc=app.activeDocument;
 if(!matchesTaskDocument(doc,region))throw new Error('请打开生成任务时保存的同一个 PSD 文件，再点击结果图片。');
 if(doc.width!==region.documentWidth || doc.height!==region.documentHeight)throw new Error('原画布尺寸已改变，请保存原图后手动导入。');
 const folder=await fs.getTemporaryFolder(),file=await folder.createFile('result-'+Date.now()+'.'+ext,{overwrite:true});await file.write(buffer,{format:storage.formats.binary});
 await ps.placeBack('editableSo',fs.createSessionToken(file),region.bounds,region.maskData,{...LOCAL_EDIT_EDGE_FEATHER,skipImageBlur:true});result.imported=true;queue.save();status('已添加此图片为独立图层；蒙版边缘轻微向选区内羽化，不会扩出原选区。');
}
async function readSelection(aspectOverride, preserveCurrent = false) {
  voice.cancel();
  if(!preserveCurrent && queue && (!selectedJobId || queue.jobs.find(j=>j.id===selectedJobId)?.tasks.length)) await newDraft();

  if (!app.activeDocument || !app.activeDocument.selection || !app.activeDocument.selection.bounds) throw new Error('请先在 PS 用框选或套索圈出区域。');
  const documentWidth = app.activeDocument.width, documentHeight = app.activeDocument.height;
  const selectionBounds=await ps.getSelectionBounds();
  const configuredRatio=$('output-size').value||'original';
  const aspectRatio=aspectOverride||(configuredRatio==='original'?closestStandardAspect(selectionBounds.width,selectionBounds.height):configuredRatio);
  if (capture && capture.imageData && capture.imageData.imageData) capture.imageData.imageData.dispose();
  capture = await ps.captureSelection('copyMerged', false, false, {tight:true,padding:8,aspectRatio});
  capture.aspectRatio=aspectRatio;
  capture.aspectRatioMatched=capture.aspectRatioMatched!==false;
  capture.documentWidth = documentWidth; capture.documentHeight = documentHeight;
  const imageData = capture.imageData.imageData;
  const actualBounds = capture.imageData.sourceBounds;
  if (!imageData || imageData.width !== capture.bounds.width || imageData.height !== capture.bounds.height || (actualBounds && (actualBounds.left !== capture.bounds.left || actualBounds.top !== capture.bounds.top))) throw new Error('选区包含空白边界，暂时无法准确对齐。请换用图片内部的选区。');
  const pixels=await imageData.getData({chunky:true});
  const encoded=pngRGBA(imageData.width,imageData.height,pixels,imageData.components);
  const image='data:image/png;base64,'+fileUtils.arrayBufferToBase64(encoded);
  $('preview').src = image; show('preview-box',true);
  sourceImage = image;
  if (fs.getDataFolder) {
    const folder = await fs.getDataFolder();
    const meta = await folder.createFile('selection.json', {overwrite:true});
    const mask = await folder.createFile('selection-mask.bin', {overwrite:true});
    const bytes = capture.maskData.imageData;
    await mask.write(bytes.buffer ? bytes.buffer.slice(bytes.byteOffset || 0, (bytes.byteOffset || 0) + bytes.byteLength) : bytes, {format:storage.formats.binary});
  await meta.write(JSON.stringify({bounds:capture.bounds,aspectRatio:capture.aspectRatio,aspectRatioMatched:capture.aspectRatioMatched,context:capture.context,documentWidth,documentHeight,sourceImage,mask:{width:capture.maskData.width,height:capture.maskData.height,components:1,sourceBounds:capture.maskData.sourceBounds}}));
  }
  show('selection-gate', false);
  $('selection-size').textContent = imageData.width + ' × ' + imageData.height + ' · ' + aspectRatio;
  status(capture.aspectRatioMatched?'已读取选区。参考图按最近模型比例补入上下文，回填仍由原套索蒙版限制。':'画布空间不足以使用所选模型比例，将按原选区范围生成。');
  syncInputs();
}
async function addFiles(files) {
  for (const file of files) {
    if (references.length >= 5) throw new Error('最多添加5张参考图。');
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['png','jpg','jpeg','webp'].includes(ext)) throw new Error('请添加 PNG、JPG 或 WebP 图片。');
    const buffer = await file.read({format:storage.formats.binary});
    if (buffer.byteLength > 10*1024*1024) throw new Error('每张参考图请控制在10MB以内。');
    references.push({name:file.name,data:'data:image/'+(ext==='jpg'?'jpeg':ext)+';base64,'+fileUtils.arrayBufferToBase64(buffer)});
  }
  const container=$('reference-thumbs');
  container.innerHTML='';
  references.forEach((ref,i)=>{const tile=document.createElement('div');tile.className='thumb';const badge=document.createElement('span');badge.className='badge';badge.textContent=String(i+2);const img=document.createElement('img');img.src=ref.data;const label=document.createElement('span');label.className='hint';label.textContent=ref.name;tile.appendChild(badge);tile.appendChild(img);tile.appendChild(label);container.appendChild(tile);});
  show('clear-reference', references.length>0);
  status('已添加 '+references.length+' 张参考图，可在提示词中用图片编号引用。');
}
function settingsPage(open){settingsOpen=open;navigatePage(open?'settings':'edit');}

async function init() {
  if (initialized) return; initialized = true;
  if(typeof navigator!=='undefined')voice.request('/health').then(data=>console.log('Local voice helper: '+data.state+' '+(data.language||''))).catch(()=>console.log('Local voice helper unavailable; start with the local launcher.'));
  try { job = JSON.parse(localStorage.getItem('lk888-job') || 'null'); } catch (_) {}
  if (job && !job.imported && fs.getDataFolder) {
    try {
      const folder = await fs.getDataFolder();
      const meta = JSON.parse(await (await folder.getEntry('selection.json')).read());
      const mask = await (await folder.getEntry('selection-mask.bin')).read({format:storage.formats.binary});
      capture = {...meta,maskData:{...meta.mask,imageData:new Uint8Array(mask)}};
      capture.aspectRatioMatched=capture.aspectRatioMatched!==false;
      sourceImage=meta.sourceImage;
      $('preview').src=sourceImage;
      $('selection-size').textContent=meta.bounds.width+' × '+meta.bounds.height+(meta.aspectRatio?' · '+meta.aspectRatio:'');
    } catch (_) {}
  }
  $('prompt').value = localStorage.getItem('lk888-prompt') || '';
  $('custom-model').value = localStorage.getItem('lk888-custom-model') || '';
  // Keep the selector intentionally curated: old versions stored every API
  // model (including chat/audio models) in localStorage, so discard that list.
  localStorage.removeItem('lk888-models');localStorage.removeItem('lk888-hidden-models');modelList=MODELS.slice();
  renderModels();
  $('pause-wait').addEventListener('click',()=>{pauseRequested=true;status('正在暂停等待，原任务会保留。');});
  $('refresh-models').addEventListener('click',()=>withBusy(async()=>{const items=await (await client()).models(),available=new Set(items.map(model=>model.id));const matched=MODELS.filter(model=>model.id!=='custom'&&available.has(model.id));$('models-status').textContent='平台模型列表中匹配到 '+matched.length+' 个预设图像模型；其他模型已忽略，不会加入选择框。';}));
  let jobs=[];try{jobs=JSON.parse(localStorage.getItem('lk888-jobs')||'[]');}catch(_){}
  if(job && !jobs.some(j=>j.id==='legacy-'+job.createdAt)){
    const migrated={...job,id:'legacy-'+job.createdAt,captureRef:'selection',captureWidth:capture?.bounds.width||0,captureHeight:capture?.bounds.height||0,tasks:(job.tasks?.length?job.tasks:[{id:job.taskId,source:job.source}]).filter(t=>t.id).map(t=>({...t,state:t.source?'ready':'running',results:(t.sources|| (t.source?[t.source]:[])).map(source=>({source,imported:!!t.imported}))})),state:job.source?'ready':job.state};if(capture){await snapshot(migrated.id);migrated.captureRef=migrated.id;}jobs.unshift(migrated);localStorage.removeItem('lk888-job');job=null;
  }
  queue=new TaskQueue({jobs,persist:value=>localStorage.setItem('lk888-jobs',JSON.stringify(value)),client,onChange:tasksUI});
  $('tab-edit').addEventListener('click',()=>withBusy(newDraft));$('tab-tasks').addEventListener('click',()=>{historyOpen=!historyOpen;tasksUI();});
  const taskView=$('task-webview'),taskTarget=typeof window!=='undefined'?window:taskView;
  taskTarget.addEventListener('message',event=>{if(event.source && event.source!==taskView)return;let data=event.data;try{if(typeof data==='string')data=JSON.parse(data);}catch(_){return;}if(!data)return;if(data.type==='tasksReady'){console.log('LK888 history input ready');tasksUI();return;}if(data.type==='taskHeight'){const height=Math.max(80,Math.min(500,Number(data.height)||200))+'px';if(taskView.style && taskView.style.height!==height)taskView.style.height=height;return;}if(data.type==='openJob'){withBusy(()=>openHistory(data.jobId));return;}if(data.type==='deleteJob'){withBusy(async()=>{const record=queue.jobs.find(j=>j.id===data.jobId);queue.jobs=queue.jobs.filter(j=>j.id!==data.jobId);if(selectedJobId===data.jobId)selectedJobId=null;queue.save();if(record?.captureRef && /^(region|legacy)-/.test(record.captureRef)){const folder=await fs.getDataFolder();for(const ext of ['.json','.bin'])try{await(await folder.getEntry(record.captureRef+ext)).delete();}catch(_){}}status('已删除本机历史记录。已提交的平台任务不会因此取消。');});return;}if(data.type==='dimensions'){const result=queue.jobs.find(j=>j.id===data.jobId)?.tasks.find(t=>t.id===data.taskId)?.results[data.index];if(result && (result.width!==data.width || result.height!==data.height)){result.width=data.width;result.height=data.height;localStorage.setItem('lk888-jobs',JSON.stringify(queue.jobs));}return;}if(data.type==='query'){const record=queue.jobs.find(j=>j.id===data.jobId);if(record)record.tasks.filter(t=>t.state==='running').forEach(t=>queue.query(record,t));return;}if(['import','save','preview'].includes(data.type))withBusy(()=>candidateAction(data));});
  if(typeof setInterval!=='undefined')setInterval(()=>queue.tick(),4000);
  queue.jobs.forEach((j,i)=>{j.number ||= queue.jobs.length-i;j.title ||= '局部改图 '+j.number;});
  queue.tick();settingsPage(false);if(queue.jobs.length)await openHistory(queue.jobs[0].id);
  $('settings-toggle').addEventListener('click', () => settingsPage(!settingsOpen));
  promptEditor=new PromptEditor({node:$('prompt'),voiceButton:$('voice-prompt'),expandButton:$('expand-prompt'),container:$('prompt').parentElement,clipboard:typeof navigator!=='undefined'?navigator.clipboard:null,context:()=>selectedJobId,onChange:value=>localStorage.setItem('lk888-prompt',value),onNotice:(message,error)=>{const note=$('input-notice');note.textContent=message;note.className=error?'error':'';},onVoice:kind=>{if(kind==='stop')voice.stop();else voice.start();},readImageClipboard:()=>voice.request('/clipboard'),onImage:async data=>{if(references.length>=5)throw new Error('最多添加5张参考图。');const match=typeof data==='string'&&data.match(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i);if(!match||data.length>14*1024*1024)throw new Error('截图格式或大小无效。');references.push({name:'截图.'+(match[1].toLowerCase()==='jpeg'?'jpg':match[1].toLowerCase()),data});syncInputs();}});
  console.log('Native prompt editor ready; clipboard access: '+(typeof navigator!=='undefined' && !!navigator.clipboard));
  const inputView=$('input-webview');
  const messageTarget=typeof window !== 'undefined' ? window : inputView;
  messageTarget.addEventListener('message',event=>{
    if(event.source && event.source!==inputView)return;
    let data=event.data;try{if(typeof data==='string')data=JSON.parse(data);}catch(_){return;}
    if(!data || typeof data.type!=='string')return;
    if(data.type==='ready'){console.log('LK888 reference input ready: '+(data.version||'unknown'));syncInputs();return;}
    if(data.type==='height'){const height=Math.max(100,Math.min(350,Number(data.height)||112))+'px';if(inputView.style && inputView.style.height!==height)inputView.style.height=height;return;}
    if(data.type!=='addReferences' && data.type!=='removeReference')return;
    if(busy)return;
    try {
    if(data.type==='addReferences'){
      if(!Array.isArray(data.references) || data.references.length+references.length>5)throw new Error('最多添加5张参考图。');
      for(const ref of data.references){if(!ref || typeof ref.data!=='string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(ref.data) || ref.data.length>14*1024*1024)throw new Error('参考图片格式或大小无效。');}
      references.push(...data.references.map(ref=>({data:ref.data,name:String(ref.name||'截图.png').slice(0,150)})));syncInputs();status('已添加参考图，可用图片编号引用。');
    }
    if(data.type==='removeReference' && Number.isInteger(data.index)){references.splice(data.index,1);syncInputs();}
    } catch(error) { status(error.message,true); }
  });
  inputView.addEventListener('loaderror',()=>status('图片输入区加载失败，请保留此提示并反馈。',true));
  $('restore-result').addEventListener('click',()=>{if(job && !job.imported && !job.source){status('先处理当前任务。',true);return;}const saved=localStorage.getItem('lk888-last-result');if(!saved){status('暂无上次结果。');return;}job=JSON.parse(saved);capture=null;sourceImage=null;saveJob();refresh();status('已恢复上次结果，可点击保存结果。');});
  $('back-editor').addEventListener('click', () => settingsPage(false));
  $('capture-selection').addEventListener('click', () => withBusy(readSelection));
  $('refresh-selection').addEventListener('click', () => withBusy(readSelection));
  $('save-key').addEventListener('click', () => withBusy(async () => {
    const value = $('api-key').value.trim(); if (!value) throw new Error('请输入 API Key。');
    await storage.secureStorage.setItem('lk888-key', value); $('api-key').value = ''; status('密钥已保存到本机安全存储。');
  }));
  $('test-key').addEventListener('click', () => withBusy(async () => { await (await client()).balance(); status('接口鉴权成功。尚未提交生图任务。'); }));
  $('custom-model').addEventListener('change', () => localStorage.setItem('lk888-custom-model', $('custom-model').value.trim()));
  $('generate').addEventListener('click', () => withBusy(generate));
  $('resume').addEventListener('click', () => withBusy(async () => { if (job.source) { if (capture && !job.imported) await importImage(); else status('结果已保留。点击保存结果下载图片。'); return; } await queue.tick(); }));
  $('import-result').addEventListener('click', () => withBusy(importImage));
  $('save-result').addEventListener('click', () => withBusy(async () => {
    const sources=job.tasks ? job.tasks.filter(t=>t.source).map(t=>t.source) : (job.sources || [job.source]);
    if(sources.length>1){const folder=await fs.getFolder();if(!folder)return;for(let i=0;i<sources.length;i++){const {buffer,ext}=await download(sources[i]);const file=await folder.createFile('AI-'+job.createdAt+'-'+(i+1)+'.'+ext,{overwrite:false});await file.write(buffer,{format:storage.formats.binary});}status('已保存 '+sources.length+' 张结果。');return;}
    const { buffer, ext } = await download(job.source);
    const file = await fs.getFileForSaving('AI-result.' + ext, { types: [ext] });
    if (file) { await file.write(buffer, { format: storage.formats.binary }); status('结果已保存。'); }
  }));
  $('reset-job').addEventListener('click', () => {
    if (busy) return;
    if (!$('reset-confirm').checked) { status('请先在平台确认原任务，再勾选设置中的确认项。', true); return; }
    job = null; saveJob(); $('reset-confirm').checked = false; status('已结束本机任务记录。不会取消平台任务。'); refresh();
  });
  $('add-reference').addEventListener('click',()=>withBusy(async()=>{const files=await fs.getFileForOpening({types:['png','jpg','jpeg','webp'],allowMultiple:true});if(files)await addFiles(Array.isArray(files)?files:[files]);}));
  $('clear-reference').addEventListener('click',()=>{references=[];$('reference-thumbs').innerHTML='';show('clear-reference',false);});
  $('dropzone').addEventListener('dragover',event=>{event.preventDefault();});
  $('dropzone').addEventListener('drop',event=>{event.preventDefault();const files=event.dataTransfer && event.dataTransfer.uxpEntries;if(files && files.length)withBusy(()=>addFiles(Array.from(files)));else status('当前 PS 未提供拖入文件，请点击添加图片。',true);});
  if(action && action.addNotificationListener) action.addNotificationListener(['set','select','deselect'],()=>{
    if(busy)return;
    try { if(app.activeDocument && app.activeDocument.selection.bounds){show('selection-gate',true);$('selection-hint').textContent='检测到选区，是否进行局部改图？';} }catch(_){}
  }).catch(()=>{});
  if (job) status(job.imported ? '上次结果已导入，可以继续生成。' : job.taskId ? '存在未结束任务：' + job.taskId + '。请查询原任务。' : '上次提交状态不确定，请先到平台确认任务。');
  refresh();

}
document.addEventListener('DOMContentLoaded', init);
if (document.readyState === 'complete' || document.readyState === 'interactive') init();
