const {setButtonDisabled,createUiButton,initButtons}=require('./ui-controls');
let hostPlatform='';try{hostPlatform=require('os').platform();}catch(_){}
const { app, imaging, constants, action } = require('photoshop');
const { storage, shell } = require('uxp');
const ps = require('./modules/ps');
const fileUtils = require('./modules/fs');
const { MODELS, MediaClient, imageSources, unwrap, validateImages } = require('./api');
const { TaskQueue }=require('./task-queue');
const {readChoice,selectChoice,setChoices,setChoiceDisabled,closeChoices,initChoices,forgetChoice}=require('./dropdown');
const {platformProfile}=require('./platform-profiles');
const {isTokenModel}=require('./model-policy');
const {normalizeModels,orderModels,parameterChoices,preferredRatio,automaticQuality,buildModelParams,modelHint,restoreProfiles,extraFields,validateExtras,validateModelUse}=require('./model-catalog');
const { uploadPNG, thumbnailPNG }=require('./png');
const { VoiceController }=require('./voice');
const { PromptEditor }=require('./prompt-editor');
const { closestStandardAspect, closestStandardImageSize }=require('./modules/geometry');
const LOCAL_EDIT_EDGE_FEATHER={enabled:true,bias:-1,relative:0.015,minRadius:1,maxRadius:3};
let queue=null, pageName='edit', selectedJobId=null, historyOpen=false, clearHistoryArmed=false;
let promptEditor=null,tabsSignature='',resultsSignature='',extraSignature='',extraControlIds=[];
let lastSnapshot=null;
let lastInputRefs=null,lastInputBusy=null;
const stateLabel=record=>record.submissionFailed&&record.tasks?.length&&record.state!=='uncertain'?(record.tasks.some(t=>t.state==='running')?'部分提交 · 生成中':'部分失败'):record.state==='draft'?'待生成':record.state==='submitting'?'提交中':record.state==='ready'?'已完成':record.state==='failed'?'失败':record.state==='uncertain'?'待确认':'生成中';
function releaseCapture(){if(capture?.imageData?.imageData){capture.imageData.imageData.dispose();capture.imageData=null;}}
const resultDownloads=new Map();
const voice=new VoiceController({context:()=>selectedJobId,onState:data=>promptEditor?.voice(data),onText:text=>promptEditor?.insert(text)});
async function saveCurrent(){
 const record=queue?.jobs.find(j=>j.id===selectedJobId);if(!record)return;
 const input={prompt:$('prompt').value,model:readChoice($('model')),quality:readChoice($('quality'))||'auto',ratio:readChoice($('output-size'))||'original',count:Number(readChoice($('count')))||1,extraParams:readExtraParams()};
 if(record.state==='draft')Object.assign(record,input);else record.editor=input;
 if(capture&&sourceImage&&record.state==='draft'){await snapshot(record.captureRef);record.captureWidth=capture.bounds.width;record.captureHeight=capture.bounds.height;record.thumbnail=capture.thumbnail||record.thumbnail;}queue.save();
}
async function newDraft(){voice.cancel();await saveCurrent();const number=Math.max(0,...queue.jobs.map(j=>j.number||0))+1,id='region-'+Date.now();queue.jobs.unshift({id,captureRef:id,title:'局部改图 '+number,number,createdAt:Date.now(),state:'draft',tasks:[],prompt:'',count:1});selectedJobId=id;releaseCapture();capture=null;sourceImage=null;references=[];$('prompt').value='';promptEditor?.resize();queue.save();show('selection-gate',true);navigatePage('edit');syncInputs();status('新建改图：请读取选区。');}
const fs = storage.localFileSystem;
let capture = null, reference = null, busy = false, initialized = false;
let job = null;
let apiBusy=false;
let pauseRequested=false,modelList=normalizeModels(MODELS),favoriteModels=[],modelFilter='all',modelSearch='',modelAccount='',modelSyncToken=0,modelPage=0;
function accountFingerprint(value){let a=2166136261,b=5381;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b,33)^value.charCodeAt(i);}return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0')+'-'+value.length;}
function selectedModelProfile(){const id=readChoice($('model'));return id==='custom'?normalizeModels([$('custom-model').value.trim()])[0]:modelList.find(m=>m.id===id);}
function fillChoices(id,values,fallback,preferred){
 const node=$(id),selected=preferred??readChoice(node),found=values.some(item=>item.value===selected);
 const next=found?selected:id==='model'&&preferred!==undefined?'':fallback;
 const labels={model:'模型',quality:'清晰度','output-size':'比例',count:'张数','model-filter':'模型筛选'};
 setChoices(node,values,{document,label:labels[id]||node.title||'模型参数',value:next,onChange:value=>{
  if(id==='model'){updateModelInputs();try{localStorage.setItem('lk888-selected-model:'+modelAccount,value);}catch(_){status('模型已切换，本机未能保存选择。',true);}}
  else if(id==='model-filter'){modelFilter=value;modelPage=0;renderModelManager();}
 }});
}
function readExtraParams(){
 const out={};for(const field of extraFields(selectedModelProfile())){
  const node=$('model-param-'+field.name),value=field.options.length?readChoice(node):node.value;
  if(value==='__omit__'||value==='__choose__'||value===undefined||value===null||!field.options.length&&value==='')continue;
  out[field.name]=field.options.length?field.options.find(o=>String(o.value)===String(value))?.value:value;
 }return out;
}
function restoreExtraParams(values={}){for(const field of extraFields(selectedModelProfile())){const node=$('model-param-'+field.name),value=values[field.name];if(field.options.length)selectChoice(node,value!==undefined?String(value):field.required?'__choose__':'__omit__');else node.value=value!==undefined?String(value):'';}}
function renderExtraInputs(profile){
 const fields=extraFields(profile),signature=JSON.stringify([profile?.id,fields]),root=$('model-extra-controls');
 show('model-parameters',fields.length>0);
 if(signature!==extraSignature){
  closeChoices(document);extraControlIds.forEach(forgetChoice);extraControlIds=[];root.innerHTML='';extraSignature=signature;
  fields.forEach(field=>{
   const wrapper=document.createElement('div'),label=document.createElement('label'),node=document.createElement(field.options.length?'div':'input');
   node.id='model-param-'+field.name;node.title=field.label;label.textContent=field.label+(field.required?' *':'');wrapper.appendChild(label);wrapper.appendChild(node);root.appendChild(wrapper);
   if(field.options.length){extraControlIds.push(node.id);fillChoices(node.id,[{value:field.required?'__choose__':'__omit__',label:field.required?'请选择':'不传（平台默认）'},...field.options.filter(o=>!o.unavailable).map(o=>({value:String(o.value),label:o.label}))],field.required?'__choose__':'__omit__');}
   else node.setAttribute('type',field.type==='number'?'number':'text');
  });
  show('model-extra-controls',fields.some(f=>f.required));$('model-extra-toggle').textContent=fields.some(f=>f.required)?'收起模型参数':'模型参数';
 }
 fields.forEach(f=>setChoiceDisabled($('model-param-'+f.name),busy));
}
function updateModelInputs(){
 const profile=selectedModelProfile(),choices=parameterChoices(profile);
 fillChoices('quality',[{value:'auto',label:choices.qualities.length?'自动':profile?.hasSchema?'平台未提供':'平台默认'},...choices.qualities.map(value=>({value,label:value+(profile&&!profile.hasSchema&&profile.evidence!=='preset'&&!platformProfile(profile)?' · 通用':'')}))],'auto');
 fillChoices('output-size',[{value:'original',label:choices.ratios.length?'原图':'原选区'},...choices.ratios.map(value=>({value,label:value}))],'original');
 setChoiceDisabled($('quality'),busy||!choices.qualities.length);setChoiceDisabled($('output-size'),busy||!choices.ratios.length);
 const favorite=$('favorite-model'),saved=!!profile&&favoriteModels.includes(profile.id);favorite.textContent=saved?'★':'☆';favorite.title=saved?'取消收藏当前模型':'收藏当前模型';favorite.setAttribute('aria-label',favorite.title);favorite.setAttribute('aria-pressed',String(saved));setButtonDisabled(favorite,busy||!profile||readChoice($('model'))==='custom');
 $('model-hint').textContent=(profile?profile.id+' · ':'')+modelHint(profile);$('model-hint').title=$('model-hint').textContent;renderExtraInputs(profile);
}
function renderModels(preferred=readChoice($('model'))){
 const visible=orderModels(modelList,favoriteModels,'image','').slice(0,40);
 const selected=modelList.find(m=>m.id===preferred);
 if(selected&&!visible.some(m=>m.id===preferred))visible.unshift({...selected,pinned:true});
 const labels={'banana-2':'Banana 2','banana-pro':'Banana Pro','tt-image-2':'GPT 图 2','tt-image-2.5':'GPT 图 2.5','doubao-seedream-5-0-pro-260628':'即梦 5 Pro','gk-image-2.0':'GK 图 2','qwen-image':'千问 Image'};
 fillChoices('model',[...visible.map(m=>({value:m.id,description:m.id,label:(m.pinned?'当前 · ':'')+(favoriteModels.includes(m.id)?'★ ':'')+(m.kind==='other'?'非图像 · ':['candidate','unknown'].includes(m.kind)?'待确认 · ':'')+(labels[m.id]||m.label)})),{value:'custom',label:'其他模型（手动 ID）'}],visible[0]?.id||'custom',preferred);
 updateModelInputs();renderModelManager();const id=readChoice($('model'));if(id)try{localStorage.setItem('lk888-selected-model:'+modelAccount,id);}catch(_){}
}
function renderModelManager(){
 const root=$('model-list');root.innerHTML='';const matches=orderModels(modelList,favoriteModels,modelFilter,modelSearch),pages=Math.max(1,Math.ceil(matches.length/20));modelPage=Math.max(0,Math.min(modelPage,pages-1));
 $('model-page-info').textContent='共 '+modelList.length+' 个 · 匹配 '+matches.length+' 个 · 第 '+(modelPage+1)+' / '+pages+' 页';setButtonDisabled($('model-prev'),modelPage===0);setButtonDisabled($('model-next'),modelPage>=pages-1);
 if(!matches.length){const empty=document.createElement('p');empty.className='hint';empty.textContent=modelFilter==='favorites'?'还没有收藏模型，点击模型旁的 ☆ 添加。':'没有匹配的模型。';root.appendChild(empty);}
 matches.slice(modelPage*20,(modelPage+1)*20).forEach(model=>{const row=document.createElement('div');row.className='model-entry';const choose=createUiButton(document);choose.setAttribute('quiet','');choose.className='ui-button model-choose';choose.textContent=(model.kind==='other'?'非图像 · ':['candidate','unknown'].includes(model.kind)?'待确认 · ':model.kind==='edit'&&model.evidence==='api'?'图像编辑 · ':model.evidence==='preset'?'预设 · ':'图像 · ')+model.label;choose.title=model.id+' · '+modelHint(model);choose.addEventListener('click',()=>{if(busy)return;renderModels(model.id);settingsPage(false);});const star=createUiButton(document);star.setAttribute('quiet','');star.textContent=favoriteModels.includes(model.id)?'★':'☆';star.title=(favoriteModels.includes(model.id)?'取消收藏 ':'收藏 ')+model.label;star.setAttribute('aria-label',star.title);star.addEventListener('click',()=>{if(!busy)toggleFavorite(model.id);});row.appendChild(choose);row.appendChild(star);root.appendChild(row);});
 $('browse-models').textContent='全部模型（'+modelList.length+'）';
}
function connectionStatus(state,{save=true,checkedAt=Date.now()}={}){
 const node=$('api-status'),labels={unknown:'尚未检测连接',checking:'正在检测 API…',success:'检测成功 · API 鉴权通过',error:'检测失败 · 请检查密钥或网络'};
 node.textContent=labels[state]+(['success','error'].includes(state)?' · '+new Date(checkedAt).toLocaleString():'');node.className='connection-status '+state;
 if(save&&['success','error'].includes(state)&&modelAccount)localStorage.setItem('lk888-connection:'+modelAccount,JSON.stringify({state,checkedAt}));
}
function restoreConnectionStatus(){
 try{const saved=JSON.parse(localStorage.getItem('lk888-connection:'+modelAccount)||'null');if(['success','error'].includes(saved?.state)&&Number.isFinite(saved.checkedAt)){connectionStatus(saved.state,{save:false,checkedAt:saved.checkedAt});$('api-status').textContent='上次'+$('api-status').textContent+'（本次尚未检测）';return;}}catch(_){}
 connectionStatus('unknown',{save:false});
}
async function loadModelCatalog(){
 let account;try{account=accountFingerprint(await key());}catch(_){account='local';}
 modelAccount=account;
 // Cache stores normalized profiles; do not infer their capabilities a second time.
 try{const saved=JSON.parse(localStorage.getItem('lk888-model-catalog:'+account)||localStorage.getItem('lk888-model-catalog')||'null');if(saved?.account===account&&Array.isArray(saved.models)){const restored=restoreProfiles(saved.models);if(restored.length)modelList=restored;}}catch(_){}
 try{const saved=JSON.parse(localStorage.getItem('lk888-model-favorites:'+account)||localStorage.getItem('lk888-model-favorites')||'null');favoriteModels=saved?.account===account&&Array.isArray(saved.ids)?saved.ids.filter(id=>typeof id==='string'&&!isTokenModel(id)):[];}catch(_){favoriteModels=[];}
}
async function syncModels({silent=false}={}){
 const token=++modelSyncToken,keyValue=await key(),account=accountFingerprint(keyValue);
 $('models-status').textContent='正在同步 API 模型…';
 try{
  const items=await new MediaClient(keyValue).models({onProgress:(done,total)=>{$('models-status').textContent='正在同步图像模型参数 '+done+' / '+total+'…';}});if(token!==modelSyncToken)return;
  const models=normalizeModels(items);if(!models.length)throw new Error('API 没有返回有效模型，已保留当前列表。');
  const selected=readChoice($('model')),old=modelList.find(m=>m.id===selected);
  modelList=models.slice();modelAccount=account;
  saveAccountData('lk888-model-catalog',{account,models,updatedAt:Date.now()});
  if(old&&!modelList.some(m=>m.id===selected))modelList.push({...old,available:false});
  renderModels(selected);
  $('models-status').textContent='已同步 '+models.length+' 个模型，其中 '+models.filter(m=>m.kind==='edit'&&m.evidence==='api').length+' 个支持图像编辑。按平台详情显示参数；密钥无可用渠道的模型会单独提示。'+(items.some(m=>m._detailFailed)?' 部分详情读取失败，保留公开参数快照或待确认状态。':'');
 }catch(error){if(token!==modelSyncToken)return;$('models-status').textContent='同步失败，保留缓存或内置预设。'+(error.message||'请检查连接。');if(!silent)throw error;}
}
function saveAccountData(name,data){const value=JSON.stringify(data);localStorage.setItem(name+':'+data.account,value);localStorage.setItem(name,value);}
function toggleFavorite(id=selectedModelProfile()?.id){const profile=modelList.find(m=>m.id===id);if(!profile)return;favoriteModels=favoriteModels.includes(id)?favoriteModels.filter(value=>value!==id):[...favoriteModels,id];saveAccountData('lk888-model-favorites',{account:modelAccount,ids:favoriteModels});renderModels(readChoice($('model')));}
let references = [], sourceImage = null, settingsOpen = false, referenceDrag = null;
let annotationTarget=null,annotationPollToken=0;
// Captured input owns this layout; Photoshop notifications must never reopen
// the empty-state card over an existing source image.
function syncSelectionGate(){
 show('selection-gate',!sourceImage,'flex');
 const refresh=$('refresh-selection');
 refresh.title=sourceImage?'用 Photoshop 当前选区替换已读取的图片':'读取 Photoshop 当前选区';
 if(sourceImage)return;
 let hasSelection=false;
 try{hasSelection=!!app.activeDocument?.selection?.bounds;}catch(_){}
 $('selection-hint').textContent=hasSelection?'检测到选区':'先在 PS 框选';
}
function syncInputs(){
 syncSelectionGate();
 const preview=$('preview'),size=$('selection-size'),container=$('reference-thumbs');
 if(sourceImage){if(preview.src!==sourceImage)preview.src=sourceImage;preview.style.display='block';size.textContent=capture?.bounds?capture.bounds.width+' × '+capture.bounds.height:'选区参考图';size.title=capture?.uploadWidth?'上传 '+capture.uploadWidth+' × '+capture.uploadHeight+' · '+(sourceImage.length/1024/1024).toFixed(2)+' MB':'选区参考图';preview.title=(capture?.bounds?capture.bounds.width+' × '+capture.bounds.height+' · ':'')+size.title;}
 else{preview.removeAttribute('src');preview.style.display='none';size.textContent='尚未读取选区';}
 show('annotate-source',!!sourceImage,'flex');show('preview-box',!!sourceImage);show('upload-info',!!sourceImage,'flex');
 $('upload-size').textContent=sourceImage?'上传 '+(sourceImage.length/1024/1024).toFixed(2)+' / 10 MB':'';
 $('compression-status').textContent=sourceImage?(capture?.uploadWidth&&capture.uploadWidth<capture.bounds.width?'已缩小压缩':'PNG 压缩'):'';
 if(lastInputBusy!==busy||!lastInputRefs||lastInputRefs.length!==references.length||references.some((ref,i)=>ref!==lastInputRefs[i])){
 lastInputBusy=busy;lastInputRefs=references.slice();container.innerHTML='';
 references.forEach((ref,index)=>{
  const tile=document.createElement('div');tile.className='thumb reference-thumb';tile.referenceIndex=index;tile.title='拖动调整参考图顺序';
  const badge=document.createElement('span');badge.className='badge';badge.textContent=String(index+2);tile.appendChild(badge);
  const img=document.createElement('img');img.src=ref.data;img.alt=ref.name||'参考图';img.draggable=false;img.title='点击标注参考图';img.onclick=()=>openAnnotation(index);tile.appendChild(img);
  const name=document.createElement('span');name.className='hint';name.textContent=ref.name||'参考图';tile.appendChild(name);
  const remove=createUiButton(document);remove.className='ui-button remove-reference';remove.textContent='×';remove.title='移除参考图';setButtonDisabled(remove,busy);remove.onclick=()=>{references.splice(index,1);syncInputs();};tile.appendChild(remove);
  const annotate=document.createElement('span');annotate.className='annotate-reference';annotate.textContent='✎';annotate.title='标注参考图';annotate.setAttribute('role','button');annotate.setAttribute('tabindex','0');annotate.setAttribute('aria-label','标注参考图');annotate.onclick=()=>openAnnotation(index);annotate.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openAnnotation(index);}};tile.appendChild(annotate);
  tile.addEventListener('mousedown',event=>{if(busy||event.button!==0||event.target===remove||event.target===annotate)return;referenceDrag={index,jobId:selectedJobId,x:event.clientX,y:event.clientY,moved:false};event.preventDefault();});
  container.appendChild(tile);
 });
 }
 show('clear-reference',references.length>0);
}
async function openAnnotation(index){
 if(busy)return;
 const data=index===null?sourceImage:references[index]?.data;
 if(!data){status('请先读取选区或添加参考图。',true);return;}
 const token=++annotationPollToken;
 annotationTarget={index,jobId:selectedJobId};
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
 if(typeof image!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)||image.length>14*1024*1024)throw new Error('标注图片过大或格式无效。');
 if(annotationTarget.index===null)sourceImage=image;
 else if(references[annotationTarget.index])references[annotationTarget.index]={...references[annotationTarget.index],data:image};
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
  const pendingConfirmation=queue?.jobs.find(j=>j.id===selectedJobId)?.state==='uncertain';
  setButtonDisabled($('generate'),busy||apiBusy||pendingConfirmation);
  $('generate').textContent=pendingConfirmation?'请先核对提交结果':busy ? '正在处理…' : queue?.jobs.find(j=>j.id===selectedJobId)?.tasks.length?'按当前输入再次生成':'生成当前选区';
  setButtonDisabled($('refresh-selection'),busy);setButtonDisabled($('tab-edit'),busy);
  setChoiceDisabled($('count'),busy);updateModelInputs();
  show('pause-wait',false);
  setChoiceDisabled($('model'),busy); if(promptEditor)promptEditor.setBusy(busy);else $('prompt').disabled=busy;
  ['add-reference','paste-reference','open-drop-window','clear-reference','settings-toggle','reload-panel'].forEach(id=>setButtonDisabled($(id),busy));
  show('recovery',false);
  setButtonDisabled($('resume'),busy || !job || !job.taskId);
  show('resume', !!(job && job.taskId));
  show('import-result', !!(job && job.source && capture && !job.imported));
  show('save-result', !!(job && job.source));
  setButtonDisabled($('import-result'),busy); setButtonDisabled($('save-result'),busy);
  setButtonDisabled($('reset-job'),busy);
  syncInputs();
}
async function key() {
  try { const value = await storage.secureStorage.getItem('lk888-key'); return String.fromCharCode(...value); }
  catch (_) { throw new Error('请在设置中填写并保存 API Key。'); }
}
async function client(record) { const value=await key();if(record?.account&&record.account!==accountFingerprint(value))throw new Error('此任务属于另一把 API 密钥，请切换回原密钥再查询。');return new MediaClient(value); }
async function withBusy(fn) {
  if(busy)return;if(apiBusy){status('正在读取平台信息，请稍后再操作。');return;}busy=true; refresh();
  try { await fn(); } catch (error) { status(error.message || '操作失败，请检查设置后重试。', true); }
  finally { busy = false; refresh(); }
}
// Settings requests must not refresh Photoshop's native menus or image views.
async function withApiBusy(fn,failurePrefix='',connectionCheck=false){
 if(apiBusy||busy)return;
 apiBusy=true;setButtonDisabled($('generate'),true);
 const buttons=['test-key','refresh-models','save-key'];
 buttons.forEach(id=>setButtonDisabled($(id),true));
 try{await fn();}catch(error){const message=failurePrefix+(error.message||'接口检查失败，请稍后重试。');if(connectionCheck)connectionStatus('error');else $('models-status').textContent=message;status(message,true);}
 finally{apiBusy=false;setButtonDisabled($('generate'),busy||queue?.jobs.find(j=>j.id===selectedJobId)?.state==='uncertain');buttons.forEach(id=>setButtonDisabled($(id),false));}
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
  setButtonDisabled($('generate'),false);
}
function renderTasks(){
 const root=$('task-content');
 const current=queue.jobs.find(j=>j.id===selectedJobId);
 const signature=JSON.stringify([selectedJobId,historyOpen,clearHistoryArmed,historyOpen?queue.jobs.map(j=>[j.id,j.title,j.state]):null,current&&[!!sourceImage,current.state,current.error,current.tasks.map(t=>[t.id,t.state,t.error,t.progress,t.results])]]);
 if(signature===resultsSignature)return;resultsSignature=signature;root.innerHTML='';
 if(historyOpen){
  const list=document.createElement('div');list.className='task-history';
  queue.jobs.forEach(record=>{const item=document.createElement('div');const open=createUiButton(document);open.textContent=record.title+' · '+stateLabel(record);open.onclick=()=>withBusy(()=>openHistory(record.id));const remove=createUiButton(document);remove.textContent='删除';remove.title='删除 '+record.title;remove.onclick=()=>withBusy(()=>deleteHistoryRecord(record.id));item.appendChild(open);item.appendChild(remove);list.appendChild(item);});
  if(queue.jobs.length){const clear=createUiButton(document);clear.className='ui-button clear-history'+(clearHistoryArmed?' armed':'');clear.textContent=clearHistoryArmed?'确认清空全部记录':'清空历史记录';clear.onclick=onClearHistoryClick;list.appendChild(clear);}
  if(!queue.jobs.length){const empty=document.createElement('p');empty.className='task-message';empty.textContent='暂无历史记录。';list.appendChild(empty);}
  root.appendChild(list);
 }
 const record=queue.jobs.find(j=>j.id===selectedJobId);if(!record){const empty=document.createElement('p');empty.className='task-message';empty.textContent='生成后，结果会显示在这里。';root.appendChild(empty);return;}
 const notice=(message,error=false)=>{const p=document.createElement('p');p.className='task-message'+(error?' task-error':'');p.textContent=message;root.appendChild(p);};
 if(record.state==='submitting'||record.tasks?.some(t=>t.state==='running'))notice('当前选区生成中（'+record.tasks.filter(t=>t.state==='ready').length+' / '+record.count+' 张完成）。点 ＋ 新建其他选区；完成后点击对应标签查看。');
 if(record.state!=='draft'&&record.model)notice('本次提交模型：'+record.model);
 if(record.error)notice(record.error,true);
 let total=0;const resultCards=[];
 (record.tasks||[]).forEach(task=>{
  if(task.error)notice(task.error,true);
  (task.results||[]).forEach((result,index)=>{
   total++;const card=document.createElement('div');card.className='task-result';root.appendChild(card);resultCards.push(card);
   const badge=document.createElement('span');badge.className='task-badge';badge.textContent=String(total);card.appendChild(badge);
   const img=document.createElement('img');img.src=result.source;img.alt='生成结果 '+total;
   const caption=document.createElement('span');caption.className='task-caption';caption.textContent=result.imported?'已添加图层，可再次添加':'点击图片添加图层';
   img.onload=()=>{caption.textContent=img.naturalWidth+' × '+img.naturalHeight+(result.imported?' · 已添加':'');caption.title=result.imported?'已添加，可再次添加':'点击图片添加图层';};
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
   const resultButton=(text,title,callback,primary=false)=>{const node=createUiButton(document);node.className='ui-button result-action'+(primary?' result-action-primary':'');node.textContent=text;node.title=title;node.setAttribute('aria-label',title);node.onclick=callback;return node;};
   const add=resultButton(result.imported?'再次添加':'添加图层',result.imported?'再次添加图层':'添加图层',img.onclick,true);
   const zoom=resultButton('⤢','放大预览',()=>openTaskPreview(result,action));
   const save=resultButton('⇩','保存原图',()=>withBusy(()=>candidateAction({...action,type:'save'})));
   card.appendChild(img);card.appendChild(buttons);card.appendChild(caption);buttons.appendChild(add);buttons.appendChild(zoom);buttons.appendChild(save);
  });
 });
 if(resultCards.length===1){resultCards[0].style.width='100%';resultCards[0].style.marginRight='0';}
 if(record.state==='draft')notice(sourceImage?'当前选区待生成，填写要求后点击“生成当前选区”。':'当前选区还未读取图片。');else if(record.state==='uncertain')notice('提交结果待确认，请先在平台核对任务，避免重复扣费。',true);else if(record.state==='failed')notice('当前选区生成失败，请查看上方错误。',true);
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
async function clearHistory(){
 const records=queue.jobs.slice();queue.jobs=[];lastSnapshot=null;selectedJobId=null;historyOpen=false;clearHistoryArmed=false;
 queue.save();localStorage.removeItem('lk888-job');localStorage.removeItem('lk888-last-result');localStorage.removeItem('lk888-prompt');job=null;
 await deleteCaptureFiles(records,true);voice.cancel();capture=null;sourceImage=null;references=[];$('prompt').value='';
 show('selection-gate',true);navigatePage('edit');syncInputs();status('本机历史已清空；下一处改图从 1 开始。已提交的平台任务不会因此取消。');
}
async function deleteHistoryRecord(id){
 const record=queue.jobs.find(j=>j.id===id);if(!record)return;
 const wasSelected=selectedJobId===id;
 queue.jobs=queue.jobs.filter(j=>j.id!==id);
 if(lastSnapshot?.id===record.captureRef)lastSnapshot=null;
 if(wasSelected){releaseCapture();selectedJobId=null;capture=null;sourceImage=null;references=[];$('prompt').value='';promptEditor?.resize();}
 clearHistoryArmed=false;renumberHistory();queue.save();
 await deleteCaptureFiles([record]);
 if(wasSelected){const next=queue.jobs.find(j=>!j.closed);if(next)await openHistory(next.id);else{show('selection-gate',true);syncInputs();}}
 tasksUI();status('已删除本机历史记录。已提交的平台任务不会因此取消。');
}
function openTaskPreview(result,action){
 const overlay=$('task-preview'),image=$('task-preview-image');image.src=result.source;
 $('task-preview-save').onclick=()=>withBusy(()=>candidateAction({...action,type:'save'}));
 overlay.style.display='flex';
}
function tasksUI(){
 if(!queue)return;
 const tabs=$('document-tabs'),visible=queue.jobs.filter(j=>!j.closed).slice().reverse();
 const nextTabs=JSON.stringify([selectedJobId,visible.map(j=>[j.id,j.title,j.number,j.state,j.thumbnail])]);
 if(document.createElement && nextTabs!==tabsSignature){
  tabsSignature=nextTabs;tabs.innerHTML='';
  if(!visible.length){const empty=document.createElement('p');empty.className='empty-regions';empty.textContent='读取选区后，任务会自动保存在这里。';tabs.appendChild(empty);}
  visible.forEach((record,index)=>{
   const id=record.id,number=record.number??(Number(record.title.match(/\d+$/)?.[0])||index+1),button=document.createElement('div');button.className='tab-button';button.setAttribute('role','button');button.setAttribute('tabindex','0');button.setAttribute('aria-pressed',String(id===selectedJobId));if(id===selectedJobId){button.classList.add('active');button.setAttribute('selected','');}
   const thumb=document.createElement(record.thumbnail?'img':'span');thumb.className='tab-thumbnail'+(record.thumbnail?'':' tab-placeholder');
   if(record.thumbnail){thumb.src=record.thumbnail;thumb.alt='选区 '+number+' 缩略图';}else thumb.textContent='＋';button.appendChild(thumb);
   const copy=document.createElement('span');copy.className='tab-copy';
   const label=document.createElement('span');label.className='tab-number';label.textContent='选区 '+String(number).padStart(2,'0');copy.appendChild(label);
   const state=document.createElement('span');state.className='tab-state state-'+record.state;state.textContent=stateLabel(record);copy.appendChild(state);button.appendChild(copy);
   button.title=record.title+' · '+stateLabel(record);button.setAttribute('aria-label',button.title);
   button.addEventListener('click',()=>withBusy(()=>openHistory(id)));
   button.addEventListener('keydown',event=>{if(event.target!==button)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();withBusy(()=>openHistory(id));}});
   const close=document.createElement('span');close.className='tab-close';close.textContent='×';close.setAttribute('role','button');close.setAttribute('tabindex','0');close.setAttribute('aria-label','关闭改图 '+number);close.title='关闭标签，记录保留在历史中';
   const remove=event=>{event.preventDefault();event.stopPropagation();withBusy(async()=>{const current=queue.jobs.find(j=>j.id===id);if(!current)return;current.closed=true;queue.save();if(selectedJobId===id){const next=queue.jobs.find(j=>!j.closed);if(next)await openHistory(next.id);else await newDraft();}});};
   close.addEventListener('click',remove);close.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){remove(event);}});
   button.appendChild(close);tabs.appendChild(button);
  });
 }
  renderTasks();
 const historyLabel='历史记录 ('+queue.jobs.length+')';if($('tab-tasks').textContent!==historyLabel)$('tab-tasks').textContent=historyLabel;const selected=queue.jobs.find(j=>j.id===selectedJobId);$('panel-title').textContent=selected?selected.title+' · '+stateLabel(selected):'局部改图';$('refresh-selection').textContent=selected?.tasks.length?'读取新选区':'重新读取';$('generate').textContent=selected?.tasks.length?'按当前输入再次生成':'生成当前选区';
}
function navigatePage(page){closeChoices(document);if(page==='settings')voice.cancel();pageName=page;show('editor',page!=='settings');show('task-page',true);show('settings',page==='settings');show('page-tabs',page!=='settings');show('tab-edit',page!=='settings','inline-flex');show('refresh-selection',page!=='settings','inline-block');show('tab-tasks',page!=='settings','inline-block');$('settings-toggle').textContent=page==='settings'?'返回':'设置';tasksUI();}
async function snapshot(id){
 const same=lastSnapshot?.id===id&&lastSnapshot.capture===capture;
 const refData=references.map(r=>r.data);
 if(same&&lastSnapshot.source===sourceImage&&lastSnapshot.refs.length===refData.length&&lastSnapshot.refs.every((data,i)=>data===refData[i]))return;
 const folder=await fs.getDataFolder();
 if(!same){const mask=await folder.createFile(id+'.bin',{overwrite:true}),bytes=capture.maskData.imageData;await mask.write(bytes.buffer?bytes.buffer.slice(bytes.byteOffset||0,(bytes.byteOffset||0)+bytes.byteLength):bytes,{format:storage.formats.binary});}
 const meta=await folder.createFile(id+'.json',{overwrite:true});
 await meta.write(JSON.stringify({bounds:capture.bounds,uploadWidth:capture.uploadWidth,uploadHeight:capture.uploadHeight,thumbnail:capture.thumbnail,aspectRatio:capture.aspectRatio,aspectRatioMatched:capture.aspectRatioMatched,context:capture.context,documentWidth:capture.documentWidth,documentHeight:capture.documentHeight,sourceImage,references,mask:{width:capture.maskData.width,height:capture.maskData.height,components:1,sourceBounds:capture.maskData.sourceBounds}}));
 lastSnapshot={id,capture,source:sourceImage,refs:refData};
}
async function restoreCapture(id){const folder=await fs.getDataFolder(),meta=JSON.parse(await(await folder.getEntry(id+'.json')).read()),bytes=await(await folder.getEntry(id+'.bin')).read({format:storage.formats.binary});return {...meta,maskData:{...meta.mask,imageData:new Uint8Array(bytes)}};}
async function generate(){voice.cancel();
 const current=queue?.jobs.find(j=>j.id===selectedJobId);if(current?.state==='uncertain')throw new Error('上次提交结果尚未确认，请先在平台核对任务，再在设置中结束待确认记录。');
 const prompt=$('prompt').value.trim();if(!prompt)throw new Error('请填写修改要求。');
 const profile=selectedModelProfile();if(!profile)throw new Error('请选择模型；自定义模型需在设置填写 ID。');
 const extraParams=readExtraParams();validateModelUse(profile,{imageCount:1+references.length});validateExtras(profile,extraParams);
 if(!capture || !sourceImage)await readSelection();
 if(!app.activeDocument || app.activeDocument.id!==capture.context.documentId)throw new Error('请读取当前文档选区。');
 const configuredRatio=readChoice($('output-size'))||'original',selection=capture.context.originalBounds;
 const ratio=configuredRatio==='original'?preferredRatio(profile,selection.right-selection.left,selection.bottom-selection.top):configuredRatio;
 if(capture.aspectRatio && capture.aspectRatio!==ratio){await readSelection(ratio,true);$('prompt').value=prompt;}
 const model=profile.id;
 const qualityChoice=readChoice($('quality'))||'auto',quality=qualityChoice==='auto'?automaticQuality(profile,closestStandardImageSize(selection.right-selection.left,selection.bottom-selection.top)):qualityChoice;
 const params=buildModelParams(profile,{quality,explicitQuality:qualityChoice!=='auto',extraParams,ratio,includeRatio:capture.aspectRatioMatched!==false,imageCount:1+references.length});
 const existing=queue.jobs.find(j=>j.id===selectedJobId);const id=existing?.state==='draft'?existing.id:'region-'+Date.now(),region=capture.context.originalBounds,b=capture.bounds;
 if([sourceImage,...references.map(r=>r.data)].some(data=>data.length>10*1024*1024))throw new Error('有图片超过 10 MB 上传限制，请重新读取选区或缩小参考图。');
 const images=[sourceImage,...references.map(r=>r.data)];validateImages(images);
 await snapshot(id);
 const sx=(capture.uploadWidth||b.width)/b.width,sy=(capture.uploadHeight||b.height)/b.height;
 const record={id,title:existing?.state==='draft'?existing.title:'局部改图 '+(Math.max(0,...queue.jobs.map(j=>j.number||0))+1),number:existing?.state==='draft'?existing.number:Math.max(0,...queue.jobs.map(j=>j.number||0))+1,quality,ratio,model,prompt,extraParams,count:Math.max(1,Math.min(4,parseInt(readChoice($('count'))||'1',10)||1)),createdAt:Date.now(),account:modelAccount,captureWidth:b.width,captureHeight:b.height,thumbnail:capture.thumbnail,captureRef:id,tasks:[],state:'submitting',instruction:'编辑图片1，保持画面尺寸、构图与主体位置。修改范围相对像素坐标：'+[(region.left-b.left)*sx,(region.top-b.top)*sy,(region.right-b.left)*sx,(region.bottom-b.top)*sy].map(Math.round).join(',')+'。其余图片按编号作为参考。修改要求：'+prompt};
 await queue.submit(record,images,params);
 selectedJobId=id;syncInputs();show('selection-gate',false);navigatePage('edit');if(record.state==='uncertain'||record.submissionFailed)status(record.error||'提交失败，请核对平台状态。',true);else status('已提交 '+record.model+'。下方显示生成状态；点击新建改图可以继续修改其他区域。');queue.tick();
}
 async function openHistory(id){if(id===selectedJobId){historyOpen=false;tasksUI();return;}voice.cancel();if(selectedJobId!==id)await saveCurrent();const record=queue.jobs.find(j=>j.id===id);if(!record)return;const input=record.editor||record;record.closed=false;historyOpen=false;clearHistoryArmed=false;selectedJobId=id;tasksUI();releaseCapture();try{capture=await restoreCapture(record.captureRef);}catch(_){capture=null;}sourceImage=capture?.sourceImage||null;references=capture?.references||[];if(!sourceImage && capture){try{const folder=await fs.getDataFolder(),meta=JSON.parse(await(await folder.getEntry('selection.json')).read());if(meta.context.documentId===capture.context.documentId && JSON.stringify(meta.bounds)===JSON.stringify(capture.bounds))sourceImage=meta.sourceImage;}catch(_){}}$('prompt').value=input.prompt||'';promptEditor?.resize();if(!modelList.some(m=>m.id===input.model)&&input.model!=='custom')modelList.push(...normalizeModels([input.model]));renderModels(input.model);selectChoice($('quality'),input.quality||'auto');selectChoice($('output-size'),input.ratio||'original');selectChoice($('count'),String(input.count||1));restoreExtraParams(input.extraParams);show('selection-gate',!sourceImage,'flex');navigatePage('edit');syncInputs();status(sourceImage?'已恢复当时的输入。结果完成后点击图片添加图层。':record.state==='draft'?'当前为待生成选区：请先在 PS 框选，再读取选区。':'旧记录未保存输入缩略图；提示词和结果已恢复。');}
async function candidateAction(data){const record=queue.jobs.find(j=>j.id===data.jobId),task=record?.tasks.find(t=>t.id===data.taskId),result=task?.results[data.index];if(!result)throw new Error('结果不存在。');
 const {buffer,ext}=await download(result.source);
 if(data.type==='preview'){const folder=await fs.getTemporaryFolder(),file=await folder.createFile('preview-'+task.id+'-'+data.index+'.'+ext,{overwrite:true});await file.write(buffer,{format:storage.formats.binary});const error=await shell.openPath(file.nativePath);if(error)throw new Error(error);status('已在系统图片查看器打开原尺寸结果。');return;}
 if(data.type==='save'){const file=await fs.getFileForSaving('AI-'+task.id+'-'+(data.index+1)+'.'+ext,{types:[ext]});if(file)await file.write(buffer,{format:storage.formats.binary});status('已保存模型返回的原始文件，没有重新压缩。');return;}
 const region=record.id===selectedJobId&&capture?.maskData&&capture?.context?capture:await restoreCapture(record.captureRef),doc=app.activeDocument;
 if(!matchesTaskDocument(doc,region))throw new Error('请打开生成任务时保存的同一个 PSD 文件，再点击结果图片。');
 if(doc.width!==region.documentWidth || doc.height!==region.documentHeight)throw new Error('原画布尺寸已改变，请保存原图后手动导入。');
 const folder=await fs.getTemporaryFolder(),file=await folder.createFile('result-'+Date.now()+'.'+ext,{overwrite:true});await file.write(buffer,{format:storage.formats.binary});
 await ps.placeBack('editableSo',fs.createSessionToken(file),region.bounds,region.maskData,{...LOCAL_EDIT_EDGE_FEATHER,skipImageBlur:true});result.imported=true;queue.save();status('已添加此图片为独立图层；蒙版边缘轻微向选区内羽化，不会扩出原选区。');
}
async function readSelection(aspectOverride, preserveCurrent = false) {
  if (!app.activeDocument || !app.activeDocument.selection || !app.activeDocument.selection.bounds) throw new Error('请先在 PS 用框选或套索圈出区域。');
  voice.cancel();
  if(!preserveCurrent && queue && (!selectedJobId || queue.jobs.find(j=>j.id===selectedJobId)?.tasks.length)){
    const pendingInput=!selectedJobId?{references:references.slice(),prompt:$('prompt').value}:null;
    await newDraft();
    if(pendingInput){references=pendingInput.references;$('prompt').value=pendingInput.prompt;promptEditor?.resize();}
  }

  const documentWidth = app.activeDocument.width, documentHeight = app.activeDocument.height;
  const selectionBounds=await ps.getSelectionBounds();
  const configuredRatio=readChoice($('output-size'))||'original';
  const aspectRatio=aspectOverride||(configuredRatio==='original'?preferredRatio(selectedModelProfile(),selectionBounds.width,selectionBounds.height):configuredRatio);
  releaseCapture();
  capture = await ps.captureSelection('copyMerged', false, false, {tight:true,padding:8,aspectRatio});
  capture.aspectRatio=aspectRatio;
  capture.aspectRatioMatched=capture.aspectRatioMatched!==false;
  capture.documentWidth = documentWidth; capture.documentHeight = documentHeight;
  const imageData = capture.imageData.imageData;
  const actualBounds = capture.imageData.sourceBounds;
  if (!imageData || imageData.width !== capture.bounds.width || imageData.height !== capture.bounds.height || (actualBounds && (actualBounds.left !== capture.bounds.left || actualBounds.top !== capture.bounds.top))) throw new Error('选区包含空白边界，暂时无法准确对齐。请换用图片内部的选区。');
  const pixels=await imageData.getData({chunky:true});
  capture.thumbnail='data:image/png;base64,'+fileUtils.arrayBufferToBase64(thumbnailPNG(imageData.width,imageData.height,pixels,imageData.components));
  status('正在压缩选区图片…');
  let prepared;try{prepared=await uploadPNG(imageData.width,imageData.height,pixels,imageData.components);}finally{releaseCapture();}
  const encoded=prepared.encoded;capture.uploadWidth=prepared.width;capture.uploadHeight=prepared.height;
  const image='data:image/png;base64,'+fileUtils.arrayBufferToBase64(encoded);
  $('preview').src = image; show('preview-box',true);
  sourceImage = image;
  show('selection-gate', false);
  $('selection-size').textContent = prepared.originalWidth + ' × ' + prepared.originalHeight + ' · ' + aspectRatio;
  status(capture.aspectRatioMatched?'已读取选区。参考图按最近模型比例补入上下文，回填仍由原套索蒙版限制。':'画布空间不足以使用所选模型比例，将按原选区范围生成。');
  syncInputs();
  status('已读取选区 · 上传 '+prepared.width+' × '+prepared.height+' · '+(image.length/1024/1024).toFixed(2)+' MB'+(prepared.resized?'（已等比缩小，回填仍对齐原选区）':'（无损压缩）'));
  if(selectedJobId)await saveCurrent();
}
async function addFiles(files) {
  const incoming=Array.from(files||[]);
  if(!incoming.length)return;
  if(references.length+incoming.length>5)throw new Error('最多添加5张参考图。');
  const added=[];
  for(const file of incoming){
    const ext=String(file.name||'').split('.').pop().toLowerCase();
    if(!['png','jpg','jpeg','webp'].includes(ext))throw new Error('请添加 PNG、JPG 或 WebP 图片。');
    if(file.size>10*1024*1024)throw new Error('参考图上传数据需在 10 MB 内（原文件约 7.5 MB），请缩小后添加。');
    let buffer=typeof file.read==='function'?await file.read({format:storage.formats.binary}):typeof file.arrayBuffer==='function'?await file.arrayBuffer():null;
    if(!buffer&&typeof FileReader!=='undefined')buffer=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('拖入的图片读取失败。'));reader.readAsArrayBuffer(file);});
    if(!buffer||!buffer.byteLength)throw new Error('拖入的图片无法读取，请尝试点击“添加图片”。');
    if(23+4*Math.ceil(buffer.byteLength/3)>10*1024*1024)throw new Error('参考图上传数据需在 10 MB 内（原文件约 7.5 MB），请缩小后添加。');
    added.push({name:file.name,data:'data:image/'+(ext==='jpg'?'jpeg':ext)+';base64,'+fileUtils.arrayBufferToBase64(buffer)});
  }
  references.push(...added);
  syncInputs();
  status('已添加 '+references.length+' 张参考图，可在提示词中用图片编号引用。');
}
async function addDroppedImages(transfer){
  if(!transfer)throw new Error('没有收到拖入的图片，请点击“添加图片”。');
  const entries=Array.from(transfer.uxpEntries||[]).filter(entry=>!entry.isFolder);
  const files=entries.length?entries:Array.from(transfer.files||[]);
  if(!files.length&&transfer.items){
    for(const item of Array.from(transfer.items)){
      const file=typeof item.getAsFile==='function'?item.getAsFile():null;
      if(file)files.push(file);
    }
  }
  if(files.length){await addFiles(files);return;}
  let text='';
  if(typeof transfer.getData==='function'){
    try{text=transfer.getData('text/uri-list')||transfer.getData('text/plain')||'';}catch(_){}
  }
  const uri=String(text).split(/\r?\n/).find(line=>line&&!line.startsWith('#'))||'';
  const image=uri.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if(image){
    if(references.length>=5)throw new Error('最多添加5张参考图。');
    const buffer=fileUtils.base64ToArrayBuffer(image[2]);
    if(23+4*Math.ceil(buffer.byteLength/3)>10*1024*1024)throw new Error('参考图上传数据需在 10 MB 内（原文件约 7.5 MB），请缩小后添加。');
    const ext=image[1].toLowerCase()==='jpeg'?'jpg':image[1].toLowerCase();
    references.push({name:'拖入图片.'+ext,data:uri});syncInputs();status('已添加 '+references.length+' 张参考图。');return;
  }
  if(/^file:\/\//i.test(uri)&&typeof fs.getEntryWithUrl==='function'){
    await addFiles([await fs.getEntryWithUrl(uri)]);return;
  }
  throw new Error('当前 Photoshop 未提供可读取的图片；请从文件管理器拖入 PNG/JPG/WebP，或点击“添加图片”。');
}
function settingsPage(open){settingsOpen=open;navigatePage(open?'settings':'edit');}
async function openDropWindow(){
  if(busy)return;
  try{
    const {id}=await voice.request('/drop/open','POST');
    const jobId=selectedJobId,expires=Date.now()+180000;
    status('拖入窗口已打开；将图片拖到该窗口，参考图会自动出现在这里。');
    const poll=async()=>{
      if(Date.now()>expires||selectedJobId!==jobId)return;
      try{
        const result=await voice.request('/drop/poll?id='+encodeURIComponent(id));
        const incoming=result.references||[];
        if(incoming.length){
          if(incoming.length+references.length>5)throw new Error('最多添加5张参考图。');
          for(const ref of incoming)if(typeof ref.data!=='string'||ref.data.length>14*1024*1024||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(ref.data))throw new Error('拖入图片格式或大小无效。');
          references.push(...incoming.map(ref=>({name:String(ref.name||'拖入图片').slice(0,150),data:ref.data})));
          syncInputs();status('已添加 '+incoming.length+' 张拖入图片。');
        }
      }catch(error){status(error.message||'拖入图片失败。',true);return;}
      setTimeout(poll,700);
    };
    poll();
  }catch(error){status(error.message||'无法打开拖入窗口。',true);}
}

async function init() {
  if (initialized) return; initialized = true;initChoices(document);initButtons(document);
  fillChoices('count',[1,2,3,4].map(n=>({value:String(n),label:n+'张'})),'1','1');
  fillChoices('model-filter',[{value:'all',label:'全部模型（图像优先）'},{value:'image',label:'仅图像候选'},{value:'favorites',label:'仅收藏'}],'all','all');
  if(hostPlatform!=='darwin'&&typeof navigator!=='undefined')voice.request('/health').then(data=>console.log('Local voice helper: '+data.state+' '+(data.language||''))).catch(()=>console.log('Local voice helper unavailable; start with the local launcher.'));
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
  await loadModelCatalog();restoreConnectionStatus();renderModels(localStorage.getItem('lk888-selected-model:'+modelAccount)||'banana-2');
  $('favorite-model').addEventListener('click',()=>{if(!busy)toggleFavorite();});
  $('model-extra-toggle').addEventListener('click',()=>{const open=$('model-extra-controls').style.display==='none';show('model-extra-controls',open);$('model-extra-toggle').textContent=open?'收起模型参数':'模型参数';});
  $('model-search').addEventListener('input',()=>{modelSearch=$('model-search').value;modelPage=0;renderModelManager();});
  $('model-prev').addEventListener('click',()=>{modelPage--;renderModelManager();});
  $('model-next').addEventListener('click',()=>{modelPage++;renderModelManager();});
  $('browse-models').addEventListener('click',()=>{modelFilter='all';modelSearch='';modelPage=0;selectChoice($('model-filter'),'all');$('model-search').value='';renderModelManager();settingsPage(true);});
  $('pause-wait').addEventListener('click',()=>{pauseRequested=true;status('正在暂停等待，原任务会保留。');});
  $('refresh-models').addEventListener('click',()=>withApiBusy(()=>syncModels(),'同步失败，保留缓存或内置预设。'));
  let jobs=[];try{jobs=JSON.parse(localStorage.getItem('lk888-jobs')||'[]');}catch(_){}
  if(job && !jobs.some(j=>j.id==='legacy-'+job.createdAt)){
    const migrated={...job,id:'legacy-'+job.createdAt,captureRef:'selection',captureWidth:capture?.bounds.width||0,captureHeight:capture?.bounds.height||0,tasks:(job.tasks?.length?job.tasks:[{id:job.taskId,source:job.source}]).filter(t=>t.id).map(t=>({...t,state:t.source?'ready':'running',results:(t.sources|| (t.source?[t.source]:[])).map(source=>({source,imported:!!t.imported}))})),state:job.source?'ready':job.state};if(capture){await snapshot(migrated.id);migrated.captureRef=migrated.id;}jobs.unshift(migrated);localStorage.removeItem('lk888-job');job=null;
  }
  queue=new TaskQueue({jobs,persist:value=>localStorage.setItem('lk888-jobs',JSON.stringify(value)),client,onChange:tasksUI});
   $('tab-edit').addEventListener('click',()=>withBusy(newDraft));$('tab-tasks').addEventListener('click',()=>{historyOpen=!historyOpen;if(!historyOpen)clearHistoryArmed=false;tasksUI();});
   $('reload-panel').addEventListener('click',()=>withBusy(async()=>{await saveCurrent();if(typeof location==='undefined'||typeof location.reload!=='function')throw new Error('当前 Photoshop 不支持面板重载。');if(selectedJobId)localStorage.setItem('lk888-reload-job-id',selectedJobId);location.reload();}));
   $('task-preview-close').addEventListener('click',()=>{$('task-preview').style.display='none';$('task-preview-image').removeAttribute('src');});
  if(typeof setInterval!=='undefined')setInterval(()=>queue.tick(),4000);
  queue.jobs.forEach((j,i)=>{j.number ||= queue.jobs.length-i;j.title ||= '局部改图 '+j.number;});
  queue.tick();settingsPage(false);const reloadJobId=localStorage.getItem('lk888-reload-job-id');localStorage.removeItem('lk888-reload-job-id');if(queue.jobs.length)await openHistory(queue.jobs.find(j=>j.id===reloadJobId)?.id||queue.jobs[0].id);
  $('settings-toggle').addEventListener('click', () => settingsPage(!settingsOpen));
  promptEditor=new PromptEditor({platform:hostPlatform,node:$('prompt'),voiceButton:$('voice-prompt'),expandButton:$('expand-prompt'),container:$('prompt').parentElement,clipboard:typeof navigator!=='undefined'?navigator.clipboard:null,context:()=>selectedJobId,onChange:value=>localStorage.setItem('lk888-prompt',value),onNotice:(message,error)=>{const note=$('input-notice');note.textContent=message;note.className=error?'error':'';},onVoice:kind=>{if(kind==='stop')voice.stop();else voice.start();},readImageClipboard:()=>voice.request('/clipboard'),onImage:async data=>{if(references.length>=5)throw new Error('最多添加5张参考图。');const match=typeof data==='string'&&data.match(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i);if(!match||data.length>14*1024*1024)throw new Error('截图格式或大小无效。');references.push({name:'截图.'+(match[1].toLowerCase()==='jpeg'?'jpg':match[1].toLowerCase()),data});syncInputs();}});
  promptEditor.resize();
  console.log('Native prompt editor ready; clipboard access: '+(typeof navigator!=='undefined' && !!navigator.clipboard));
  $('restore-result').addEventListener('click',()=>{if(job && !job.imported && !job.source){status('先处理当前任务。',true);return;}const saved=localStorage.getItem('lk888-last-result');if(!saved){status('暂无上次结果。');return;}job=JSON.parse(saved);capture=null;sourceImage=null;saveJob();refresh();status('已恢复上次结果，可点击保存结果。');});
  $('back-editor').addEventListener('click', () => settingsPage(false));
  $('capture-selection').addEventListener('click', () => withBusy(readSelection));
  $('refresh-selection').addEventListener('click', () => withBusy(readSelection));
  $('save-key').addEventListener('click', () => withApiBusy(async () => {
    const value = $('api-key').value.trim(); if (!value) throw new Error('请输入 API Key。');
    await storage.secureStorage.setItem('lk888-key', value);++modelSyncToken;$('api-key').value='';modelList=normalizeModels(MODELS);favoriteModels=[];await loadModelCatalog();restoreConnectionStatus();renderModels();$('models-status').textContent='密钥已保存，可点击「从 API 同步模型」。';status('密钥已保存。');
  }));
  $('test-key').addEventListener('click', () => withApiBusy(async () => { connectionStatus('checking',{save:false});await (await client()).balance();connectionStatus('success');status('接口鉴权成功。正在同步模型，不会提交生图任务。');await syncModels({silent:true}); },'',true));
  $('custom-model').addEventListener('change', () => {localStorage.setItem('lk888-custom-model', $('custom-model').value.trim());updateModelInputs();});
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
    const pending=queue?.jobs.find(j=>j.id===selectedJobId);if(pending?.state==='uncertain'){pending.state=pending.tasks.some(t=>t.state==='running')?'running':'failed';pending.submissionFailed=true;pending.error='已在平台核对上次提交，未自动重试。';queue.save();}job = null; saveJob(); $('reset-confirm').checked = false; status('已结束本机任务记录。不会取消平台任务。'); refresh();
  });
  $('add-reference').addEventListener('click',()=>withBusy(async()=>{const files=await fs.getFileForOpening({types:['png','jpg','jpeg','webp'],allowMultiple:true});if(files)await addFiles(Array.isArray(files)?files:[files]);}));
  $('paste-reference').addEventListener('click',()=>promptEditor.pasteImage());
  $('open-drop-window').addEventListener('click',openDropWindow);
  $('annotate-source').addEventListener('click',()=>openAnnotation(null));
  $('annotate-source').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openAnnotation(null);}});
  $('preview').addEventListener('click',()=>openAnnotation(null));
  $('clear-reference').addEventListener('click',()=>{references=[];referenceDrag=null;syncInputs();});
  document.addEventListener('mousemove',moveReferenceOnPointer);
  document.addEventListener('mouseup',endReferencePointer);
  const imageRow=$('images-row'),dropzone=$('dropzone');
  const dragEnter=event=>{event.preventDefault();dropzone.classList.add('dragging');};
  const dragOver=event=>{event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';dropzone.classList.add('dragging');};
  const handleImageDrop=event=>{event.preventDefault();event.stopPropagation?.();dropzone.classList.remove('dragging');return withBusy(()=>addDroppedImages(event.dataTransfer));};
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
    syncSelectionGate();
  }).catch(()=>{});
  if (job) status(job.imported ? '上次结果已导入，可以继续生成。' : job.taskId ? '存在未结束任务：' + job.taskId + '。请查询原任务。' : '上次提交状态不确定，请先到平台确认任务。');
  refresh();
  // Load cached models at startup; fetch only on an explicit settings action.

}
document.addEventListener('DOMContentLoaded', init);
if (document.readyState === 'complete' || document.readyState === 'interactive') init();
