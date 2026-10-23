const {selectModel}=require('./model-selection');
const {renderManager,shortModelName,isImageModel,createStore,runTests}=require('./model-manager');
const { app, imaging, constants, action } = require('photoshop');
const { storage, shell } = require('uxp');
const ps = require('./modules/ps');
const fileUtils = require('./modules/fs');
const { MODELS, MediaClient, imageSources, unwrap } = require('./api');
const { TaskQueue }=require('./task-queue');
const { pngRGBA }=require('./png');
const { VoiceController }=require('./voice');
const { PromptEditor }=require('./prompt-editor');
const { OptimizerClient }=require('./optimizer');
const { closestStandardAspect, closestStandardImageSize }=require('./modules/geometry');
const LOCAL_EDIT_EDGE_FEATHER={enabled:true,bias:-1,relative:0.015,minRadius:1,maxRadius:3};
let queue=null, pageName='edit', selectedJobId=null, historyOpen=false, clearHistoryArmed=false;
let historySelectionMode=false, historyDeleteArmed=false, documentTabRowOffset=0, documentTabLastSelectedId=null, documentTabExpectedScroll=0, documentTabScrollLockUntil=0;
const historySelectedIds=new Set();
let localIdSerial=0;
function nextLocalId(){return 'region-'+Date.now()+'-'+(++localIdSerial);}
let promptEditor=null,tabsSignature='',historySignature='',optimizing=false,optimizeEpoch=0,lastPromptBeforeOptimize=null,undoOptimizeTimer=null,applyingOptimizedPrompt=false;
const resultDownloads=new Map();
const voice=new VoiceController({context:()=>selectedJobId,onState:data=>promptEditor?.voice(data),onText:text=>promptEditor?.insert(text)});
const optimizer=new OptimizerClient();
function clearOptimizeUndo(){clearTimeout(undoOptimizeTimer);undoOptimizeTimer=null;lastPromptBeforeOptimize=null;if(typeof document!=='undefined')show('undo-optimize',false);}
function cancelOptimization(){if(!optimizing)return;optimizer.cancel();optimizing=false;++optimizeEpoch;refresh();}
async function optimizePrompt(){
 if(optimizing){cancelOptimization();status('已取消优化。');return;}
 const text=$('prompt').value.trim();if(!text&&!sourceImage&&!references.length){status('请添加图片或写提示词后再优化。',true);return;}
 voice.cancel();clearOptimizeUndo();const context=selectedJobId,epoch=++optimizeEpoch,original=$('prompt').value;
 const images=[...(sourceImage?[{name:'选区.png',data:sourceImage}]:[]),...references.map((item,index)=>({name:item.name||`参考图${index+(sourceImage?2:1)}.png`,data:item.data}))];
 const target=['banana-2','banana-pro'].includes($('model').value)?'banana2':'generic_image';
 optimizing=true;refresh();
 try{
  const result=await optimizer.optimize({text,images,target});
  if(epoch!==optimizeEpoch||context!==selectedJobId)return;
  const incoming=Array.isArray(result.images)?result.images:[];
  const capacity=sourceImage?5:6;
  if(references.length+incoming.length>capacity)throw new Error('回传图片超过 PS 数量限制；提示词和图片未更新，请减少参考图后再优化。');
  if(incoming.some(image=>typeof image?.data!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(image.data)))throw new Error('回传图片格式无效或过大；提示词和图片未更新。');
  lastPromptBeforeOptimize={context,text:original};applyingOptimizedPrompt=true;$('prompt').value=result.prompt||'';promptEditor.changed();applyingOptimizedPrompt=false;
  let added=0;for(const image of (Array.isArray(result.images)?result.images:[])){const data=typeof image?.data==='string'?image.data:'';if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(data))continue;references.push({name:String(image.name||`影词魔方图片${references.length+1}.png`).slice(0,150),data});added++;}
  syncInputs();await saveCurrent();show('undo-optimize',true,'inline-block');undoOptimizeTimer=setTimeout(clearOptimizeUndo,10000);status(added?`已优化并回传，新增 ${added} 张参考图。现在可点击生成。`:'已优化并回传。现在可点击生成；可按 Ctrl+Z 撤销提示词。');
 }catch(error){if(epoch===optimizeEpoch&&!/已取消优化/.test(error.message||''))status(error.message||'优化失败。',true);}
 finally{if(epoch===optimizeEpoch){optimizing=false;refresh();}}
}
async function undoOptimization(){
 if(!lastPromptBeforeOptimize||lastPromptBeforeOptimize.context!==selectedJobId)return;
 const value=lastPromptBeforeOptimize.text;clearOptimizeUndo();applyingOptimizedPrompt=true;$('prompt').value=value;promptEditor.changed();applyingOptimizedPrompt=false;await saveCurrent();status('已恢复优化前的修改要求。');
}
async function saveCurrent(){const record=queue?.jobs.find(j=>j.id===selectedJobId);if(!record)return;record.prompt=$('prompt').value;record.model=$('model').value||record.model;record.quality=$('quality').value||'auto';record.ratio=$('output-size').value||'original';record.count=Number($('count').value)||1;record.hasSelection=Boolean(capture&&sourceImage);if(capture&&sourceImage){await snapshot(record.captureRef);record.captureWidth=capture.bounds.width;record.captureHeight=capture.bounds.height;}else await snapshotReferences(record.captureRef||record.id);queue.save();}
async function newDraft(){voice.cancel();cancelOptimization();clearOptimizeUndo();await saveCurrent();const number=Math.max(0,...queue.jobs.map(j=>j.number||0))+1,id=nextLocalId();queue.jobs.unshift({id,captureRef:id,title:'局部改图 '+number,number,createdAt:Date.now(),state:'draft',tasks:[],prompt:'',count:1,hasSelection:false});selectedJobId=id;capture=null;sourceImage=null;references=[];$('prompt').value='';promptEditor?.resize();queue.save();show('selection-gate',true);navigatePage('edit');syncInputs();status('可读取选区做局部改图，也可直接上传图片或输入提示词生成。');}
const fs = storage.localFileSystem;
let capture = null, reference = null, busy = false, initialized = false;
let job = null;
let pauseRequested=false, modelList=MODELS.slice(),modelStore=null;
function rebuildModels(){const d=modelStore?modelStore.dropdown().models:MODELS.filter(m=>m.id!=="custom");modelList=[...d,MODELS.find(m=>m.id==="custom")];}
function modelsStatus(msg,err){const n=$('models-status');if(n){n.textContent=msg;n.className='hint mm-status'+(err?' error':'');}}
function renderSavedModels(){if(!modelStore)return;renderManager({root:$("saved-models"),store:modelStore,client,current:$("model").value,status:modelsStatus,onChange:()=>{rebuildModels();renderModels();}});}
function renderModels(){const node=$('model');if(!document.createElement)return;const selected=node.value;node.innerHTML='';const menu=document.createElement('sp-menu');menu.setAttribute('slot','options');modelList.forEach(model=>{const item=document.createElement('sp-menu-item');item.setAttribute('value',model.id);item.textContent=shortModelName(model);item.title=model.label||model.id;if(model.id===selected)item.setAttribute('selected','');item.addEventListener('click',()=>{selectModel(node,modelList,model.id);renderSavedModels();});menu.appendChild(item);});node.appendChild(menu);selectModel(node,modelList,modelList.some(m=>m.id===selected)?selected:(modelList[0]||{}).id);renderSavedModels();}
async function syncImageModelsFromPlatform(){const items=await (await client()).models();const r=modelStore.syncFromPlatform(items);rebuildModels();renderModels();const ticked=modelStore.visible().filter(m=>modelStore.isTicked(m.id)).length;return {...r,ticked,all:items.length};}
function addModel(id){const value=String(id||'').trim();if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,119}$/.test(value))throw new Error('模型 ID 请填写 2 至 120 个字母、数字或 . _ : / -。');modelStore.add({id:value,label:value},{tick:true});rebuildModels();renderModels();if(modelList.some(model=>model.id===value))selectModel($('model'),modelList,value);$('custom-model').value='';localStorage.removeItem('lk888-custom-model');modelsStatus('已添加 '+value+'，点它的 – 测试。');}
let references = [], sourceImage = null, settingsOpen = false, referenceDrag = null;
const activeSubmissions = new Set();
let annotationTarget=null,annotationPollToken=0;
function syncInputs(){
 const preview=$('preview'),size=$('selection-size'),container=$('reference-thumbs');
 if(sourceImage){preview.src=sourceImage;preview.style.display='block';size.textContent=capture?.bounds?capture.bounds.width+' × '+capture.bounds.height:'选区参考图';}
 else{preview.removeAttribute('src');preview.style.display='none';size.textContent='尚未读取选区';}
 show('preview-box',!!sourceImage);
 show('annotate-source',!!sourceImage,'flex');
 container.innerHTML='';
 references.forEach((ref,index)=>{
  const tile=document.createElement('div');tile.className='thumb reference-thumb';tile.referenceIndex=index;tile.title='拖动调整参考图顺序';
  const badge=document.createElement('span');badge.className='badge';badge.textContent=String(index+(sourceImage?2:1));tile.appendChild(badge);
  const img=document.createElement('img');img.src=ref.data;img.alt=ref.name||'参考图';img.draggable=false;img.title='点击标注参考图';img.onclick=()=>openAnnotation(index);tile.appendChild(img);
  const name=document.createElement('span');name.className='hint';name.textContent=ref.name||'参考图';tile.appendChild(name);
  const remove=document.createElement('span');remove.className='remove-reference';remove.textContent='×';remove.title='移除参考图';remove.setAttribute('role','button');remove.setAttribute('tabindex','0');remove.setAttribute('aria-label','移除参考图 '+(ref.name||index+1));remove.onclick=()=>{if(busy)return;references.splice(index,1);syncInputs();saveCurrent().catch(error=>status(error.message,true));};remove.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();remove.onclick();}};tile.appendChild(remove);
  const annotate=document.createElement('span');annotate.className='annotate-reference';annotate.textContent='✎';annotate.title='标注参考图';annotate.setAttribute('role','button');annotate.setAttribute('tabindex','0');annotate.setAttribute('aria-label','标注参考图');annotate.onclick=()=>openAnnotation(index);annotate.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openAnnotation(index);}};tile.appendChild(annotate);
  tile.addEventListener('mousedown',event=>{if(busy||event.button!==0||event.target===remove||event.target===annotate)return;referenceDrag={index,jobId:selectedJobId,x:event.clientX,y:event.clientY,moved:false};event.preventDefault();});
  container.appendChild(tile);
 });
 show('clear-reference',references.length>0);
}
async function openAnnotation(index){
 if(busy)return;
 const data=index===null?sourceImage:references[index]?.data;
 if(!data){status('请先读取选区或添加参考图。',true);return;}
 const token=++annotationPollToken;
 annotationTarget={index,jobId:selectedJobId,reference:index===null?null:references[index]};
 try{
  const {id}=await voice.request('/annotate/open','POST',{image:data});
  if(token!==annotationPollToken)return;
  status('标注窗口已打开；完成标注后图片会自动更新。');
  const expires=Date.now()+600000;
  const poll=async()=>{
   if(token!==annotationPollToken||Date.now()>expires||annotationTarget?.jobId!==selectedJobId)return;
   try{const response=await voice.request('/annotate/poll?id='+encodeURIComponent(id));
    if(token!==annotationPollToken)return;
    if(response.state==='error'){closeAnnotation();status(response.message||'标注窗口未完成。',true);return;}
    if(response.state==='saved'){saveAnnotation(response.image);return;}
   }catch(error){status(error.message||'标注结果读取失败。',true);return;}
   setTimeout(poll,700);
  };poll();
 }catch(error){if(token===annotationPollToken)status('标注工具打开失败：'+(error.message||error),true);}
}
function closeAnnotation(){++annotationPollToken;annotationTarget=null;}
function saveAnnotation(image){
 if(!annotationTarget||annotationTarget.jobId!==selectedJobId)return;
 if(typeof image!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image))throw new Error('标注图片过大或格式无效。');
 if(annotationTarget.index===null)sourceImage=image;
 else {const index=references.indexOf(annotationTarget.reference);if(index<0){closeAnnotation();return;}references[index]={...references[index],data:image};}
 closeAnnotation();syncInputs();saveCurrent().catch(error=>status(error.message,true));status('标注已保存，生成时将使用标注后的图片。');
}
function moveReferenceOnPointer(event){
 if(!referenceDrag||referenceDrag.jobId!==selectedJobId)return;
 if(!referenceDrag.moved&&Math.abs(event.clientX-referenceDrag.x)+Math.abs(event.clientY-referenceDrag.y)<6)return;
 referenceDrag.moved=true;
 let target=event.target;
 while(target&&typeof target.referenceIndex!=='number')target=target.parentNode;
 const next=target?.referenceIndex;
 if(typeof next!=='number'||next===referenceDrag.index)return;
 const [item]=references.splice(referenceDrag.index,1);references.splice(next,0,item);referenceDrag.index=next;
 syncInputs();
}
function endReferencePointer(){
 if(referenceDrag?.moved)status('参考图顺序已调整，生成时会按左到右的编号提交。');
 referenceDrag=null;
}
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
  $('generate').disabled = busy || optimizing || activeSubmissions.has(selectedJobId);
  $('generate').textContent = busy ? '正在准备…' : activeSubmissions.has(selectedJobId) ? ('已接单 '+(queue?.jobs.find(j=>j.id===selectedJobId)?.tasks?.length||0)+'/'+(queue?.jobs.find(j=>j.id===selectedJobId)?.count||1)+'…') : '生成';
  $('quality').disabled = busy; $('count').disabled = busy; $('output-size').disabled = busy;
  show('pause-wait',false);
  $('model').disabled = busy || optimizing; if(promptEditor)promptEditor.setBusy(busy || optimizing);else $('prompt').readOnly=busy || optimizing;
  if($('optimize-prompt')){$('optimize-prompt').textContent=optimizing?'停止优化':'✨ 优化';$('optimize-prompt').disabled=busy;}
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
async function client() { const api=new MediaClient(await key());api.prepareImages=async images=>{const result=await voice.request('/images/prepare','POST',{images});if(!Array.isArray(result.images)||result.images.length!==images.length)throw new Error('图片预处理返回无效。');return result.images;};return api; }
async function withBusy(fn) {
  if (busy) return; busy = true; refresh();
  try { await fn(); } catch (error) { status(error.message || '操作失败，请检查设置后重试。', true); }
  finally { busy = false; refresh(); }
}
async function downloadUncached(source) {
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
function download(source) {
  const cached=resultDownloads.get(source);
  if(cached)return cached;
  const pending=downloadUncached(source);
  resultDownloads.set(source,pending);
  pending.then(({buffer})=>{
    if(buffer.byteLength>60*1024*1024){resultDownloads.delete(source);return;}
    while(resultDownloads.size>2)resultDownloads.delete(resultDownloads.keys().next().value);
  },()=>resultDownloads.delete(source));
  return pending;
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
function renderTasks(){
 const root=$('task-content');root.innerHTML='';
 if(historyOpen){
  const list=document.createElement('div');list.className='task-history';
  if(queue.jobs.length){
   const controls=document.createElement('div');controls.className='history-bulk-controls';
   const select=document.createElement('button');select.textContent=historySelectionMode?'退出选择':'选择删除';select.onclick=()=>{historySelectionMode=!historySelectionMode;historySelectedIds.clear();historyDeleteArmed=false;tasksUI();};controls.appendChild(select);
   if(historySelectionMode){
    const all=document.createElement('button');all.textContent=historySelectedIds.size===queue.jobs.length?'取消全选':'全选';all.onclick=()=>{if(historySelectedIds.size===queue.jobs.length)historySelectedIds.clear();else queue.jobs.forEach(record=>historySelectedIds.add(record.id));historyDeleteArmed=false;tasksUI();};controls.appendChild(all);
    const removeSelected=document.createElement('button');removeSelected.textContent=historyDeleteArmed?'确认删除 '+historySelectedIds.size+' 条':'删除选中 ('+historySelectedIds.size+')';removeSelected.disabled=!historySelectedIds.size;removeSelected.onclick=onDeleteSelectedClick;controls.appendChild(removeSelected);
   }
   list.appendChild(controls);
  }
  queue.jobs.forEach(record=>{const item=document.createElement('div');item.className='history-entry';if(historySelectionMode){const choose=document.createElement('button');choose.className='history-choose';choose.textContent=historySelectedIds.has(record.id)?'☑':'☐';choose.title='选择 '+record.title;choose.setAttribute('aria-label',choose.title);choose.onclick=()=>{if(historySelectedIds.has(record.id))historySelectedIds.delete(record.id);else historySelectedIds.add(record.id);historyDeleteArmed=false;tasksUI();};item.appendChild(choose);}const open=document.createElement('button');open.textContent=record.title+' · '+(record.state==='ready'?'已完成':record.state==='failed'?'失败':'生成中');open.onclick=()=>withBusy(()=>openHistory(record.id));item.appendChild(open);if(!historySelectionMode){const remove=document.createElement('button');remove.textContent='删除';remove.title='删除 '+record.title;remove.onclick=()=>withBusy(()=>deleteHistoryRecord(record.id));item.appendChild(remove);}list.appendChild(item);});
  if(queue.jobs.length){const clear=document.createElement('button');clear.className='clear-history'+(clearHistoryArmed?' armed':'');clear.textContent=clearHistoryArmed?'确认清空全部记录':'清空历史记录';clear.onclick=onClearHistoryClick;list.appendChild(clear);}
  if(!queue.jobs.length){const empty=document.createElement('p');empty.className='task-message';empty.textContent='暂无历史记录。';list.appendChild(empty);}
  root.appendChild(list);
 }
 const record=queue.jobs.find(j=>j.id===selectedJobId);if(!record)return;
 const notice=(message,error=false)=>{const p=document.createElement('p');p.className='task-message'+(error?' task-error':'');p.textContent=message;root.appendChild(p);};
 if(record.state==='submitting'||record.tasks?.some(t=>t.state==='running'))notice((record.phase||'生成中')+'，可继续操作；完成后回到历史查看。');
 if(record.error)notice(record.error,true);
 let total=0;
 (record.tasks||[]).forEach(task=>{
  if(task.error)notice(task.error,true);
  (task.results||[]).forEach((result,index)=>{
   total++;const card=document.createElement('div');card.className='task-result';root.appendChild(card);
   const badge=document.createElement('span');badge.className='task-badge';badge.textContent=String(total);card.appendChild(badge);
   const img=document.createElement('img');img.src=result.source;img.alt='生成结果 '+total;
   const caption=document.createElement('span');caption.className='task-caption';caption.textContent=result.imported?'已添加图层，可再次添加':record.hasSelection===false?'点击图片添加完整图层':'点击图片添加图层';
   img.onload=()=>{caption.textContent=img.naturalWidth+' × '+img.naturalHeight;caption.title=result.imported?'已添加，可再次添加':'点击图片添加图层';if(index===0)download(result.source).catch(()=>{});};
   let previewRetried=false;
   img.onerror=async()=>{
    if(!previewRetried&&/^https:\/\//.test(result.source)){
     previewRetried=true;
     try{const {buffer,ext}=await download(result.source);img.src='data:image/'+(ext==='jpg'?'jpeg':ext)+';base64,'+fileUtils.arrayBufferToBase64(buffer);return;}catch(_){}
    }
    caption.textContent='预览加载失败，仍可点击添加图层或保存原图';
   };
   const action={jobId:record.id,taskId:task.id,index};
   img.onclick=()=>withBusy(()=>candidateAction({...action,type:'import'}));
   caption.onclick=img.onclick;
   const buttons=document.createElement('div');buttons.className='task-actions';
   const add=document.createElement('button');add.textContent='⊞';add.title=result.imported?'再次添加图层':'添加图层';add.setAttribute('aria-label',add.title);add.onclick=img.onclick;
   const zoom=document.createElement('button');zoom.textContent='⤢';zoom.title='放大预览';zoom.setAttribute('aria-label',zoom.title);zoom.onclick=()=>openTaskPreview(result,action);
   const save=document.createElement('button');save.textContent='⇩';save.title='保存原图';save.setAttribute('aria-label',save.title);save.onclick=()=>withBusy(()=>candidateAction({...action,type:'save'}));
   card.appendChild(img);card.appendChild(buttons);card.appendChild(caption);buttons.appendChild(add);buttons.appendChild(zoom);buttons.appendChild(save);
  });
 });
 if(total && record.state!=='submitting'&&!record.tasks.some(t=>t.state==='running'))notice(record.hasSelection===false?'生成完成，点击候选图添加完整图层，或保存原图。':'生成完成，点击候选图添加图层。');
 else if(record.state!=='submitting'&&!record.tasks?.some(t=>t.state==='running'))notice('尚无生成结果。');
}
function renumberHistory(){queue.jobs.slice().reverse().forEach((record,index)=>{record.number=index+1;record.title='局部改图 '+(index+1);});}
async function deleteCaptureFiles(records,includeSharedSelection=false){
 const refs=new Set(records.map(record=>record.captureRef).filter(ref=>ref&&/^(region|legacy)-/.test(ref)));
 if(includeSharedSelection&&records.some(record=>record.captureRef==='selection'))refs.add('selection');
 if(!refs.size)return;
 const folder=await fs.getDataFolder();for(const ref of refs)for(const ext of ['.json','.bin'])try{await(await folder.getEntry(ref+ext)).delete();}catch(_){}
}
function onClearHistoryClick(){
 if(!clearHistoryArmed){clearHistoryArmed=true;tasksUI();status('再次点击“确认清空全部记录”，将删除本机历史并从 1 重新编号。');return;}
 return withBusy(clearHistory);
}
function onDeleteSelectedClick(){
 if(!historySelectedIds.size)return;
 if(!historyDeleteArmed){historyDeleteArmed=true;tasksUI();status('再次点击“确认删除”，仅删除已选择的 '+historySelectedIds.size+' 条本机记录。');return;}
 return withBusy(deleteSelectedHistory);
}
async function deleteSelectedHistory(){
 const records=queue.jobs.filter(record=>historySelectedIds.has(record.id));
 if(!records.length)return;
 if(records.length===queue.jobs.length){historySelectedIds.clear();historySelectionMode=false;historyDeleteArmed=false;await clearHistory();return;}
 const removedCurrent=records.some(record=>record.id===selectedJobId);
 queue.jobs=queue.jobs.filter(record=>!historySelectedIds.has(record.id));
 historySelectedIds.clear();historySelectionMode=false;historyDeleteArmed=false;clearHistoryArmed=false;
 if(removedCurrent){selectedJobId=null;capture=null;sourceImage=null;references=[];$('prompt').value='';show('selection-gate',true);syncInputs();}
 renumberHistory();queue.save();await deleteCaptureFiles(records);tasksUI();status('已删除所选 '+records.length+' 条本机记录；平台任务不受影响。');
}
async function clearHistory(){
 const records=queue.jobs.slice();queue.jobs=[];selectedJobId=null;historyOpen=false;clearHistoryArmed=false;historySelectionMode=false;historyDeleteArmed=false;historySelectedIds.clear();documentTabRowOffset=0;
 queue.save();localStorage.removeItem('lk888-job');localStorage.removeItem('lk888-last-result');localStorage.removeItem('lk888-prompt');job=null;
 await deleteCaptureFiles(records,true);voice.cancel();capture=null;sourceImage=null;references=[];$('prompt').value='';
 show('selection-gate',true);navigatePage('edit');syncInputs();status('本机历史已清空；下一处改图从 1 开始。已提交的平台任务不会因此取消。');
}
async function deleteHistoryRecord(id){
 const record=queue.jobs.find(j=>j.id===id);if(!record)return;
 queue.jobs=queue.jobs.filter(j=>j.id!==id);if(selectedJobId===id){selectedJobId=null;capture=null;sourceImage=null;references=[];$('prompt').value='';show('selection-gate',true);syncInputs();}historySelectedIds.delete(id);clearHistoryArmed=false;historyDeleteArmed=false;renumberHistory();queue.save();
 await deleteCaptureFiles([record]);
 tasksUI();status('已删除本机历史记录。已提交的平台任务不会因此取消。');
}
function openTaskPreview(result,action){
 const overlay=$('task-preview'),image=$('task-preview-image');image.src=result.source;
 $('task-preview-save').onclick=()=>withBusy(()=>candidateAction({...action,type:'save'}));
 overlay.style.display='flex';
}
function documentTabRowHeight(){const first=$('document-tabs').children[0];return (first?.offsetHeight||28)+4;}
function documentTabColumns(){return Math.max(1,Math.floor((($('document-tabs').clientWidth||184)-1)/46));}
function visibleDocumentTabs(){return queue.jobs.filter(record=>!record.closed).slice().sort((a,b)=>(a.number||0)-(b.number||0)||a.createdAt-b.createdAt);}
function syncDocumentTabScroll(visible,keepSelected=false){
 const tabs=$('document-tabs'),rows=Math.ceil(visible.length/documentTabColumns()),lastStart=Math.max(0,rows-2);
 if(keepSelected){const index=visible.findIndex(record=>record.id===selectedJobId);if(index>=0){const row=Math.floor(index/documentTabColumns());if(row<documentTabRowOffset)documentTabRowOffset=row;else if(row>=documentTabRowOffset+2)documentTabRowOffset=row-1;}}
 documentTabRowOffset=Math.max(0,Math.min(documentTabRowOffset,lastStart));
 documentTabExpectedScroll=documentTabRowOffset*documentTabRowHeight();tabs.scrollTop=documentTabExpectedScroll;
}
function moveDocumentTabRow(delta){documentTabRowOffset+=delta*2;syncDocumentTabScroll(visibleDocumentTabs());}
function onDocumentTabScrollbarMouseDown(event){
 const tabs=$('document-tabs'),rect=tabs.getBoundingClientRect?.();if(!rect)return;
 const x=event.clientX-rect.left,y=event.clientY-rect.top;
 if(x<rect.width-20||x>rect.width||y<0||y>rect.height)return;
 if(y<=18||y>=rect.height-18){event.preventDefault();documentTabScrollLockUntil=Date.now()+80;moveDocumentTabRow(y<=18?-1:1);}
}
function onDocumentTabScroll(){
 const top=$('document-tabs').scrollTop||0;
 if(Math.abs(top-documentTabExpectedScroll)<2)return;
 if(Date.now()<documentTabScrollLockUntil){$('document-tabs').scrollTop=documentTabExpectedScroll;return;}
 const direction=Math.sign(top-documentTabExpectedScroll);
 documentTabScrollLockUntil=Date.now()+80;
 moveDocumentTabRow(direction);
}
function tasksUI(){
 if(!queue)return;
 const tabs=$('document-tabs'),visible=visibleDocumentTabs();
 const nextTabs=JSON.stringify([selectedJobId,visible.map(j=>[j.id,j.title,j.number])]);
 const tabsChanged=nextTabs!==tabsSignature;
 if(document.createElement && tabsChanged){
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
 const selectionChanged=documentTabLastSelectedId!==selectedJobId;documentTabLastSelectedId=selectedJobId;
 if(tabsChanged||selectionChanged)syncDocumentTabScroll(visible,selectionChanged);
  renderTasks();
 const history=$('history-list'),nextHistory=JSON.stringify([clearHistoryArmed,queue.jobs.map(j=>[j.id,j.title,!!j.closed])]);
  if(document.createElement && nextHistory!==historySignature){historySignature=nextHistory;history.innerHTML='';queue.jobs.forEach((record,index)=>{const number=record.number??(Number(record.title.match(/\d+$/)?.[0])||index+1),item=document.createElement('sp-action-button');item.textContent=String(number);item.title=record.title+(record.closed?' · 已关闭':'');item.setAttribute('aria-label',item.title);item.addEventListener('click',()=>withBusy(()=>openHistory(record.id)));history.appendChild(item);});if(queue.jobs.length){const clear=document.createElement('sp-action-button');clear.className='clear-history'+(clearHistoryArmed?' armed':'');clear.textContent=clearHistoryArmed?'确认清空全部记录':'清空历史记录';clear.addEventListener('click',onClearHistoryClick);history.appendChild(clear);}}
 show('history-list',historyOpen&&pageName!=='settings','grid');const historyLabel='历史记录 ('+queue.jobs.length+')';if($('tab-tasks').textContent!==historyLabel)$('tab-tasks').textContent=historyLabel;const selected=queue.jobs.find(j=>j.id===selectedJobId);$('panel-title').textContent=selected?.title||'局部改图';
}
function navigatePage(page){if(page==='settings'){voice.cancel();cancelOptimization();}pageName=page;show('editor',page!=='settings');show('task-page',true);show('settings',page==='settings');show('page-tabs',true,'flex');show('refresh-selection',page!=='settings','inline-block');show('tab-tasks',page!=='settings','inline-block');$('settings-toggle').textContent=page==='settings'?'返回':'设置';tasksUI();}
async function snapshot(id){const folder=await fs.getDataFolder(),meta=await folder.createFile(id+'.json',{overwrite:true}),mask=await folder.createFile(id+'.bin',{overwrite:true});const bytes=capture.maskData.imageData;await mask.write(bytes.buffer?bytes.buffer.slice(bytes.byteOffset||0,(bytes.byteOffset||0)+bytes.byteLength):bytes,{format:storage.formats.binary});await meta.write(JSON.stringify({bounds:capture.bounds,aspectRatio:capture.aspectRatio,aspectRatioMatched:capture.aspectRatioMatched,context:capture.context,documentWidth:capture.documentWidth,documentHeight:capture.documentHeight,sourceImage,references,mask:{width:capture.maskData.width,height:capture.maskData.height,components:1,sourceBounds:capture.maskData.sourceBounds}}));}
async function snapshotReferences(id){const folder=await fs.getDataFolder(),meta=await folder.createFile(id+'.json',{overwrite:true});await meta.write(JSON.stringify({references}));}
async function restoreReferences(id){const folder=await fs.getDataFolder(),meta=JSON.parse(await(await folder.getEntry(id+'.json')).read());return Array.isArray(meta.references)?meta.references:[];}
async function restoreCapture(id){const folder=await fs.getDataFolder(),meta=JSON.parse(await(await folder.getEntry(id+'.json')).read()),bytes=await(await folder.getEntry(id+'.bin')).read({format:storage.formats.binary});return {...meta,maskData:{...meta.mask,imageData:new Uint8Array(bytes)}};}
async function generate(){voice.cancel();
 const prompt=$('prompt').value.trim(),hasSelection=!!(capture&&sourceImage);
 if(!prompt&&!references.length)throw new Error('请添加图片或填写提示词。');
 if(hasSelection&&(!app.activeDocument||app.activeDocument.id!==capture.context.documentId))throw new Error('请读取当前文档选区。');
 const configuredRatio=$('output-size').value||'original',selection=hasSelection?capture.context.originalBounds:null;
 const ratio=configuredRatio==='original'?(selection?closestStandardAspect(selection.right-selection.left,selection.bottom-selection.top):'original'):configuredRatio;
 if(hasSelection&&capture.aspectRatio&&capture.aspectRatio!==ratio){await readSelection(ratio,true);$('prompt').value=prompt;}
 const selectedModel=$('model').value || modelList[0]?.id,model=selectedModel==='custom'?$('custom-model').value.trim():selectedModel;if(!model)throw new Error(selectedModel==='custom'?'请先在设置里填写自定义模型 ID。':'请选择模型。');
 const params={},qualityChoice=$('quality').value||'auto',quality=qualityChoice==='auto'?(selection?closestStandardImageSize(selection.right-selection.left,selection.bottom-selection.top):'1K'):qualityChoice;params.image_size=quality;if(ratio!=='original'&&(!hasSelection||capture.aspectRatioMatched!==false))params.aspect_ratio=ratio;
 const existing=queue.jobs.find(j=>j.id===selectedJobId),number=existing?.state==='draft'?existing.number:Math.max(0,...queue.jobs.map(j=>j.number||0))+1,id=existing?.state==='draft'?existing.id:nextLocalId();
 if(hasSelection)await snapshot(id);else await snapshotReferences(id);
 const region=hasSelection?capture.context.originalBounds:null,b=hasSelection?capture.bounds:null;
 const instruction=hasSelection?'编辑图片1，保持画面尺寸、构图与主体位置。修改范围相对像素坐标：'+[region.left-b.left,region.top-b.top,region.right-b.left,region.bottom-b.top].map(Math.round).join(',')+'。其余图片按编号作为参考。修改要求：'+prompt:(prompt||'请参考上传的图片生成一张新图片，保留主要主体和整体风格。');
 const record={id,title:(hasSelection?'局部改图 ':'图片生成 ')+number,number,quality,ratio,model,prompt,count:Math.max(1,Math.min(4,parseInt($('count').value||'1',10)||1)),createdAt:Date.now(),captureWidth:b?.width||0,captureHeight:b?.height||0,captureRef:id,hasSelection,tasks:[],state:'submitting',instruction};
 selectedJobId=id;activeSubmissions.add(id);syncInputs();show('selection-gate',false);navigatePage('edit');status('任务已开始提交。面板可以继续操作；提交状态会保存在历史记录中。');
 queue.submit(record,[...(hasSelection?[sourceImage]:[]),...references.map(r=>r.data)],params).then(()=>{
  activeSubmissions.delete(id);refresh();
  if(selectedJobId===id && record.state==='failed'){status(record.error||'生成失败，未返回图片。',true);return;}
  if(selectedJobId===id)status(record.state==='uncertain'?(record.error||'提交状态不确定，请在历史记录中查询原任务。'):'已提交。生成在后台继续，可新建另一处改图。',record.state==='uncertain');
  queue.tick();
 }).catch(error=>{
  activeSubmissions.delete(id);
  record.state=error.notSubmitted||!error.uncertain?'failed':'uncertain';
  record.error=error.message||(record.state==='uncertain'?'提交状态不确定':'提交没有发出，可以重新生成');
  queue.save();refresh();
  if(selectedJobId===id)status(record.error,true);
 });
}
async function openHistory(id){voice.cancel();if(selectedJobId!==id){cancelOptimization();clearOptimizeUndo();await saveCurrent();}const record=queue.jobs.find(j=>j.id===id);if(!record)return;record.closed=false;historyOpen=false;clearHistoryArmed=false;selectedJobId=id;tasksUI();try{capture=record.hasSelection===false?null:await restoreCapture(record.captureRef);}catch(_){capture=null;}sourceImage=capture?.sourceImage||null;references=capture?.references||[];if(record.hasSelection===false){try{references=await restoreReferences(record.captureRef||record.id);}catch(_){references=[];}}if(!sourceImage && capture){try{const folder=await fs.getDataFolder(),meta=JSON.parse(await(await folder.getEntry('selection.json')).read());if(meta.context.documentId===capture.context.documentId && JSON.stringify(meta.bounds)===JSON.stringify(capture.bounds))sourceImage=meta.sourceImage;}catch(_){}}$('prompt').value=record.prompt;promptEditor?.resize();$('model').value=record.model;$('quality').value=record.quality||'auto';$('output-size').value=record.ratio||'original';$('count').value=String(record.count||1);show('selection-gate',false);navigatePage('edit');syncInputs();status(sourceImage?'已恢复当时的选区输入。结果完成后点击图片添加图层。':record.hasSelection===false?'已恢复图片和提示词，可继续生成；结果可添加为完整图层。':'旧记录未保存输入缩略图；提示词和结果已恢复。');}
async function candidateAction(data){const record=queue.jobs.find(j=>j.id===data.jobId),task=record?.tasks.find(t=>t.id===data.taskId),result=task?.results[data.index];if(!result)throw new Error('结果不存在。');
 const {buffer,ext}=await download(result.source);
 if(data.type==='preview'){const folder=await fs.getTemporaryFolder(),file=await folder.createFile('preview-'+task.id+'-'+data.index+'.'+ext,{overwrite:true});await file.write(buffer,{format:storage.formats.binary});const error=await shell.openPath(file.nativePath);if(error)throw new Error(error);status('已在系统图片查看器打开原尺寸结果。');return;}
 if(data.type==='save'){const file=await fs.getFileForSaving('AI-'+task.id+'-'+(data.index+1)+'.'+ext,{types:[ext]});if(file)await file.write(buffer,{format:storage.formats.binary});status('已保存模型返回的原始文件，没有重新压缩。');return;}
 if(record.hasSelection===false){const folder=await fs.getTemporaryFolder(),file=await folder.createFile('result-'+Date.now()+'.'+ext,{overwrite:true});await file.write(buffer,{format:storage.formats.binary});await ps.placeGeneratedAsLayer(fs.createSessionToken(file));result.imported=true;queue.save();status('已将完整生成图片添加为独立图层。');return;}
 const region=record.id===selectedJobId&&capture?.maskData&&capture?.context?capture:await restoreCapture(record.captureRef),doc=app.activeDocument;
 if(!matchesTaskDocument(doc,region))throw new Error('请打开生成任务时保存的同一个 PSD 文件，再点击结果图片。');
 if(doc.width!==region.documentWidth || doc.height!==region.documentHeight)throw new Error('原画布尺寸已改变，请保存原图后手动导入。');
 const folder=await fs.getTemporaryFolder(),file=await folder.createFile('result-'+Date.now()+'.'+ext,{overwrite:true});await file.write(buffer,{format:storage.formats.binary});
 await ps.placeBack('editableSo',fs.createSessionToken(file),region.bounds,region.maskData,{...LOCAL_EDIT_EDGE_FEATHER,skipImageBlur:true});result.imported=true;queue.save();status('已添加此图片为独立图层；蒙版边缘轻微向选区内羽化，不会扩出原选区。');
}
async function readSelection(aspectOverride, preserveCurrent = false) {
  voice.cancel();
  if (!app.activeDocument || !app.activeDocument.selection || !app.activeDocument.selection.bounds) throw new Error('请先在 PS 用框选或套索圈出区域。');
  const documentWidth = app.activeDocument.width, documentHeight = app.activeDocument.height;
  const selectionBounds=await ps.getSelectionBounds();
  const configuredRatio=$('output-size').value||'original';
  const aspectRatio=aspectOverride||(configuredRatio==='original'?closestStandardAspect(selectionBounds.width,selectionBounds.height):configuredRatio);
  const nextCapture = await ps.captureSelection('copyMerged', false, false, {tight:true,padding:8,aspectRatio});
  nextCapture.aspectRatio=aspectRatio;
  nextCapture.aspectRatioMatched=nextCapture.aspectRatioMatched!==false;
  nextCapture.documentWidth = documentWidth; nextCapture.documentHeight = documentHeight;
  const imageData = nextCapture.imageData.imageData;
  const actualBounds = nextCapture.imageData.sourceBounds;
  if (!imageData || imageData.width !== nextCapture.bounds.width || imageData.height !== nextCapture.bounds.height || (actualBounds && (actualBounds.left !== nextCapture.bounds.left || actualBounds.top !== nextCapture.bounds.top))) throw new Error('选区包含空白边界，暂时无法准确对齐。请换用图片内部的选区。');
  const pixels=await imageData.getData({chunky:true});
  const encoded=pngRGBA(imageData.width,imageData.height,pixels,imageData.components);
  const image='data:image/png;base64,'+fileUtils.arrayBufferToBase64(encoded);
  // A completed task keeps its original capture for later result placement.
  // Continue in a fresh draft on the same editor, carrying all user inputs forward.
  const previousCapture=capture;
  if(!preserveCurrent && queue?.jobs.find(j=>j.id===selectedJobId)?.tasks.length){
    const keptPrompt=$('prompt').value,keptReferences=references.slice();
    await newDraft();references=keptReferences;$('prompt').value=keptPrompt;promptEditor?.resize();
  }
  if (previousCapture && previousCapture.imageData && previousCapture.imageData.imageData) previousCapture.imageData.imageData.dispose();
  capture=nextCapture;
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
  await saveCurrent();
}
async function addFiles(files, target = null) {
  const incoming=Array.from(files||[]);
  if(!incoming.length)return;
  const replacing=target?.kind==='reference'||target?.kind==='source';
  if(replacing&&incoming.length!==1)throw new Error('替换图片时请只拖入一张。');
  const added=[];
  for(const file of incoming){
    const ext=String(file.name||'').includes('.')?String(file.name).split('.').pop().toLowerCase():String(file.type||'').split('/').pop().toLowerCase();
    if(!['png','jpg','jpeg','webp'].includes(ext))throw new Error('请添加 PNG、JPG 或 WebP 图片。');
    let buffer=null;
    try{
      buffer=typeof file.read==='function'?await file.read({format:storage.formats.binary}):typeof file.arrayBuffer==='function'?await file.arrayBuffer():null;
      if(!buffer&&typeof FileReader!=='undefined')buffer=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('拖入的图片读取失败。'));reader.readAsArrayBuffer(file);});
    }catch(_){throw new Error('拖入的图片无法读取。');}
    if(!buffer||!buffer.byteLength)throw new Error('拖入的图片无法读取，请尝试点击“添加图片”。');
    added.push({name:file.name||'拖入图片.'+ext,data:'data:image/'+(ext==='jpg'?'jpeg':ext)+';base64,'+fileUtils.arrayBufferToBase64(buffer)});
  }
  if(target?.kind==='source'){
    if(!sourceImage||!capture)throw new Error('请先读取选区，再替换第 1 张图片。');
    sourceImage=added[0].data;
  }else if(target?.kind==='reference'){
    if(!references[target.index])throw new Error('目标参考图已变化，请重新拖入。');
    references[target.index]=added[0];
  }else references.push(...added);
  syncInputs();
  await saveCurrent();
  status(replacing?'已替换目标图片。':'已添加 '+incoming.length+' 张参考图，可在提示词中用图片编号引用。');
}
async function droppedFileGroups(transfer){
  const groups=[];
  const files=Array.from(transfer.files||[]);if(files.length)groups.push(files);
  const items=[];
  for(const item of Array.from(transfer.items||[])){
    if(item.kind&&item.kind!=='file')continue;
    let file=typeof item.getAsFile==='function'?item.getAsFile():null;
    if(!file&&typeof item.getAsFileSystemHandle==='function'){
      try{const handle=await item.getAsFileSystemHandle();if(handle?.kind==='file')file=await handle.getFile();}catch(_){}
    }
    if(file)items.push(file);
  }
  if(items.length)groups.push(items);
  const entries=Array.from(transfer.uxpEntries||[]).filter(entry=>!entry.isFolder);
  if(entries.length)groups.push(entries);
  if(typeof transfer.getFiles==='function'){
    try{const provided=Array.from(await transfer.getFiles()||[]);if(provided.length)groups.push(provided);}catch(_){}
  }
  return groups;
}
async function addDroppedImages(transfer,target = null){
  if(!transfer)throw new Error('拖放没有提供可读取的图片。微信图片请先另存到文件夹再拖入，或复制图片后在面板按 Ctrl+V；也可点“添加图片”。');
  const groups=await droppedFileGroups(transfer);
  let unreadable=false;
  for(const files of groups){try{await addFiles(files,target);return;}catch(error){if(!/无法读取|读取失败/.test(error.message||''))throw error;unreadable=true;}}
  let text='';
  if(typeof transfer.getData==='function'){
    try{text=transfer.getData('text/uri-list')||transfer.getData('text/plain')||'';}catch(_){}
  }
  const uri=String(text).split(/\r?\n/).find(line=>line&&!line.startsWith('#'))||'';
  const image=uri.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if(image){
    const buffer=fileUtils.base64ToArrayBuffer(image[2]);
    const ext=image[1].toLowerCase()==='jpeg'?'jpg':image[1].toLowerCase();
    await addFiles([{name:'拖入图片.'+ext,size:buffer.byteLength,arrayBuffer:async()=>buffer}],target);return;
  }
  if(/^file:\/\//i.test(uri)&&typeof fs.getEntryWithUrl==='function'){
    try{await addFiles([await fs.getEntryWithUrl(uri)],target);return;}catch(error){if(!/无法读取|读取失败|permission|access|not found/i.test(error.message||''))throw error;unreadable=true;}
  }
  throw new Error(unreadable?'拖入的图片无法读取。请先将图片另存到文件夹，再点“添加图片”选择；微信图片也可复制后在面板按 Ctrl+V。':'该来源没有提供可读取的图片。微信图片请先另存到文件夹再拖入，或复制图片后在面板按 Ctrl+V；电脑图片也可点“添加图片”。');
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
  // 旧版 lk888-custom-models / lk888-deleted-models 在 createStore 中迁移为候选列表；隐藏/显示合并为勾选。
  localStorage.removeItem('lk888-models');localStorage.removeItem('lk888-hidden-models');
  modelStore=createStore(MODELS);
  rebuildModels();renderModels();
    try{$('key-state').textContent=(await storage.secureStorage.getItem('lk888-key'))?.length?'密钥已保存在本机；更换时粘贴新密钥再保存。':'尚未保存密钥。';}catch(_){$('key-state').textContent='尚未保存密钥。';}
  $('pause-wait').addEventListener('click',()=>{pauseRequested=true;status('正在暂停等待，原任务会保留。');});
  $('mm-add-toggle').addEventListener('click',()=>{const b=$('mm-add-box');b.style.display=b.style.display==='none'?'flex':'none';});
  $('test-models').addEventListener('click',()=>withBusy(async()=>{await runTests(modelStore.state.selected.filter(id=>modelStore.visible().some(x=>x.id===id)),modelStore,client,modelsStatus);rebuildModels();renderModels();}));
  let jobs=[];try{jobs=JSON.parse(localStorage.getItem('lk888-jobs')||'[]');}catch(_){}
  if(job && !jobs.some(j=>j.id==='legacy-'+job.createdAt)){
    const migrated={...job,id:'legacy-'+job.createdAt,captureRef:'selection',captureWidth:capture?.bounds.width||0,captureHeight:capture?.bounds.height||0,tasks:(job.tasks?.length?job.tasks:[{id:job.taskId,source:job.source}]).filter(t=>t.id).map(t=>({...t,state:t.source?'ready':'running',results:(t.sources|| (t.source?[t.source]:[])).map(source=>({source,imported:!!t.imported}))})),state:job.source?'ready':job.state};if(capture){await snapshot(migrated.id);migrated.captureRef=migrated.id;}jobs.unshift(migrated);localStorage.removeItem('lk888-job');job=null;
  }
  queue=new TaskQueue({jobs,persist:value=>localStorage.setItem('lk888-jobs',JSON.stringify(value)),client,onChange:tasksUI});
   $('tab-edit').addEventListener('click',()=>withBusy(newDraft));$('tab-tasks').addEventListener('click',()=>{historyOpen=!historyOpen;if(!historyOpen)clearHistoryArmed=false;tasksUI();});
   $('document-tabs').addEventListener('mousedown',onDocumentTabScrollbarMouseDown,true);
   $('document-tabs').addEventListener('scroll',onDocumentTabScroll);
   if(typeof window!=='undefined'&&window.addEventListener)window.addEventListener('resize',()=>syncDocumentTabScroll(visibleDocumentTabs()));
   $('reload-panel').addEventListener('click',()=>withBusy(async()=>{await saveCurrent();if(typeof location==='undefined'||typeof location.reload!=='function')throw new Error('当前 Photoshop 不支持面板重载。');if(selectedJobId)localStorage.setItem('lk888-reload-job-id',selectedJobId);location.reload();}));
   $('task-preview-close').addEventListener('click',()=>{$('task-preview').style.display='none';$('task-preview-image').removeAttribute('src');});
  if(typeof setInterval!=='undefined')setInterval(()=>queue.tick(),1500);
  queue.jobs.forEach((j,i)=>{j.number ||= queue.jobs.length-i;j.title ||= '局部改图 '+j.number;});
  queue.tick();settingsPage(false);const reloadJobId=localStorage.getItem('lk888-reload-job-id');localStorage.removeItem('lk888-reload-job-id');if(queue.jobs.length)await openHistory(queue.jobs.find(j=>j.id===reloadJobId)?.id||queue.jobs[0].id);
  $('settings-toggle').addEventListener('click', () => settingsPage(!settingsOpen));
  promptEditor=new PromptEditor({node:$('prompt'),voiceButton:$('voice-prompt'),expandButton:$('expand-prompt'),container:$('prompt').parentElement,clipboard:typeof navigator!=='undefined'?navigator.clipboard:null,context:()=>selectedJobId,onChange:value=>{localStorage.setItem('lk888-prompt',value);if(!applyingOptimizedPrompt)clearOptimizeUndo();},onNotice:(message,error)=>{const note=$('input-notice');note.textContent=message;note.className=error?'error':'';},onVoice:kind=>{if(kind==='stop')voice.stop();else voice.start();},readImageClipboard:()=>voice.request('/clipboard'),onImage:async data=>{const match=typeof data==='string'&&data.match(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i);if(!match)throw new Error('截图格式或大小无效。');references.push({name:'截图.'+(match[1].toLowerCase()==='jpeg'?'jpg':match[1].toLowerCase()),data});syncInputs();}});
  $('prompt').addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&String(event.key).toLowerCase()==='z'&&lastPromptBeforeOptimize?.context===selectedJobId){event.preventDefault();undoOptimization().catch(error=>status(error.message||'撤销失败。',true));}});
  promptEditor.resize();
  console.log('Native prompt editor ready; clipboard access: '+(typeof navigator!=='undefined' && !!navigator.clipboard));
  $('restore-result').addEventListener('click',()=>{if(job && !job.imported && !job.source){status('先处理当前任务。',true);return;}const saved=localStorage.getItem('lk888-last-result');if(!saved){status('暂无上次结果。');return;}job=JSON.parse(saved);capture=null;sourceImage=null;saveJob();refresh();status('已恢复上次结果，可点击保存结果。');});
  $('back-editor').addEventListener('click', () => settingsPage(false));
  $('capture-selection').addEventListener('click', () => withBusy(readSelection));
  $('refresh-selection').addEventListener('click', () => withBusy(readSelection));
  $('save-key').addEventListener('click', () => withBusy(async () => {
    const value = $('api-key').value.trim(); if (!value) throw new Error('请输入 API Key。');
    await storage.secureStorage.setItem('lk888-key', value); $('api-key').value = ''; $('key-state').textContent='密钥已保存在本机；更换时粘贴新密钥再保存。';status('密钥已保存到本机安全存储。');
  }));
  $('test-key').addEventListener('click', () => withBusy(async () => { await (await client()).balance(); let r; try { r = await syncImageModelsFromPlatform(); } catch (error) { status('密钥鉴权成功，但拉取平台模型列表失败：' + (error.message || '请稍后重试') + '。可稍后点「读取平台图像模型」。', true); return; } const msg='连接成功：推荐的 ' + r.total + ' 个模型中平台有 ' + r.found + ' 个，已勾选 ' + r.ticked + '。'; status(msg); modelsStatus(msg); }));
  $('custom-model').addEventListener('change', () => localStorage.setItem('lk888-custom-model', $('custom-model').value.trim()));
  $('add-model').addEventListener('click',()=>{try{addModel($('custom-model').value);}catch(error){status(error.message,true);}});
  $('optimize-prompt').addEventListener('click',optimizePrompt);
  $('undo-optimize').addEventListener('click',()=>undoOptimization().catch(error=>status(error.message||'撤销失败。',true)));
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
  $('add-reference').addEventListener('click',()=>withBusy(async()=>{
    status('请选择要添加的参考图片…');
    const context=selectedJobId;
    const result=await voice.request('/pick-images');
    if(context!==selectedJobId)return;
    const images=Array.isArray(result.images)?result.images:[];
    if(!images.length){status('已取消添加图片。');return;}
    for(const image of images){
      if(typeof image.data!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image.data))throw new Error('图片格式无效，请使用 PNG、JPG 或 WebP。');
    }
    references.push(...images.map(image=>({name:String(image.name||'参考图片'),data:image.data})));
    syncInputs();await saveCurrent();status('已添加 '+images.length+' 张参考图。');
    $('input-notice').textContent='';
  }));
  $('paste-reference').addEventListener('click',()=>promptEditor.pasteImage());
  $('annotate-source').addEventListener('click',()=>openAnnotation(null));
  $('annotate-source').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openAnnotation(null);}});
  $('preview').addEventListener('click',()=>openAnnotation(null));
  $('clear-reference').addEventListener('click',()=>{references=[];referenceDrag=null;syncInputs();});
  document.addEventListener('mousemove',moveReferenceOnPointer);
  document.addEventListener('mouseup',endReferencePointer);
  const imageRow=$('images-row'),dropzone=$('dropzone');
  const dragEnter=event=>{event.preventDefault();dropzone.classList.add('dragging');};
  const dragOver=event=>{event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';dropzone.classList.add('dragging');};
  const handleImageDrop=event=>{
    event.preventDefault();event.stopPropagation?.();dropzone.classList.remove('dragging');
    let target=null,node=event.target;
    while(node&&node!==imageRow){
      if(node.id==='preview-box'){target={kind:'source'};break;}
      if(Number.isInteger(node.referenceIndex)){target={kind:'reference',index:node.referenceIndex};break;}
      if(node.id==='dropzone')break;
      node=node.parentElement;
    }
    return withBusy(()=>addDroppedImages(event.dataTransfer,target));
  };
  document.addEventListener('dragenter',dragEnter,true);
  document.addEventListener('dragover',dragOver,true);
  document.addEventListener('dragleave',event=>{if(!document.contains?.(event.relatedTarget))dropzone.classList.remove('dragging');},true);
  document.addEventListener('drop',handleImageDrop,true);
  imageRow.addEventListener('dragenter',dragEnter);
  imageRow.addEventListener('dragover',dragOver);
  imageRow.addEventListener('drop',handleImageDrop);
  dropzone.addEventListener('drop',handleImageDrop);
  document.addEventListener('paste',event=>{if(event.target===$('prompt'))return;const image=promptEditor.clipboardImage(event);if(!image)return;event.preventDefault();event.stopPropagation();promptEditor.addClipboardImage(image,selectedJobId).catch(error=>status(error.message,true));},true);
  if(action && action.addNotificationListener) action.addNotificationListener(['set','select','deselect'],()=>{
    if(busy)return;
    try { if(app.activeDocument && app.activeDocument.selection.bounds){show('selection-gate',true);$('selection-hint').textContent='检测到选区，是否进行局部改图？';} }catch(_){}
  }).catch(()=>{});
  if (job) status(job.imported ? '上次结果已导入，可以继续生成。' : job.taskId ? '存在未结束任务：' + job.taskId + '。请查询原任务。' : '上次提交状态不确定，请先到平台确认任务。');
  refresh();

}
document.addEventListener('DOMContentLoaded', init);
if (document.readyState === 'complete' || document.readyState === 'interactive') init();
