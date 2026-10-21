// 模型管理：候选列表(平台拉取+内置+手动) → 勾选 → 测试已勾选 → 通过的进主面板下拉（按用户顺序）。
// localStorage: lk888-model-candidates [{id,label}] / lk888-model-selected [id,...]（即顺序，同时写 lk888-model-order）
// / lk888-model-test-results {id:{ok,text,at}}；兼容旧 lk888-custom-models / lk888-deleted-models。
function resolveModel(id,items){
 const exact=items.find(m=>m.id===id);if(exact)return exact;
 if(id==='gemini-nano-banana-2.1'){const aliases=items.filter(m=>/banana[\s._-]*2[._-]1(?:$|[\s._/-])/i.test(m.id));if(aliases.length===1)return aliases[0];}
 return null;
}
function shortModelName(model){
 const names={'banana-2.1':'Banana 2.1','banana-2':'Banana 2','gemini-nano-banana-2.1':'Banana 2.1','banana-pro':'Banana Pro','tt-image-2':'GPT 图 2','tt-image-2.5':'GPT 图 2.5','doubao-seedream-5-0-pro-260628':'即梦 5.0 Pro','qwen-image-max':'千问 Max','gk-image-2.0':'Grok 图',custom:'其他模型'};
 return names[model.id]||String(model.label||model.id).replace(/^doubao-seedream-/,'即梦 ').replace(/-\d{6,}$/,'').slice(0,28);
}
function isImageModel(model){const text=model.id+' '+(model.label||'');return /image|banana|seedream|imagine|flux|dall-?e|midjourney|mj[-_]|kolors|recraft|ideogram|sdxl|stable-diffusion/i.test(text)&&!/seedance|video|shouweiz|embedding|rerank|tts|whisper|audio|vision-preview|understand/i.test(text);}
const ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,119}$/;
// 推荐模型（按次计费最便宜的版本），按价格从低到高
const CURATED=[{id:'tt-image-2.5',label:'GPT 图 2.5',price:'0.0265/次'},{id:'tt-image-2',label:'GPT 图 2',price:'0.0386/次'},{id:'banana-2.1',label:'Banana 2.1',price:'0.0882/次'},{id:'banana-2',label:'Banana 2',price:'0.1176/次'},{id:'banana-pro',label:'Banana Pro',price:'0.1411/次'},{id:'doubao-seedream-5-0-pro-260628',label:'即梦 5.0 Pro',price:'0.3024/次'},{id:'gk-image-2.0',label:'Grok 图',price:'价格未知'}];
const DEFAULT_TICKED=CURATED.map(m=>m.id);
function readJSON(key,fallback){try{const v=JSON.parse(localStorage.getItem(key)||'null');return v==null?fallback:v;}catch(_){return fallback;}}
function createStore(builtins){
 const state={candidates:[],selected:[],results:{},deleted:new Set()};
 const stored=readJSON('lk888-model-candidates',[]);
 const manual=(Array.isArray(stored)?stored:[]).filter(m=>m&&m.manual&&ID_RE.test(m.id)&&!CURATED.some(c=>c.id===m.id));
 state.candidates=[...CURATED.map(m=>({...m,platform:(Array.isArray(stored)?stored:[]).find(x=>x&&x.id===m.id)?.platform})),...manual.map(m=>({id:m.id,label:m.label||m.id,manual:true}))];
 const ids=new Set(state.candidates.map(m=>m.id));
 const migrated=localStorage.getItem('lk888-model-curated-v1')==='1';
 const prevSel=readJSON('lk888-model-selected',[]);
 state.selected=migrated&&Array.isArray(prevSel)?prevSel.filter(id=>ids.has(id)):[...DEFAULT_TICKED,...(Array.isArray(prevSel)?prevSel:[]).filter(id=>manual.some(m=>m.id===id))];
 if(migrated&&localStorage.getItem('lk888-model-curated-v2')!=='1'){for(const id of ['doubao-seedream-5-0-pro-260628','gk-image-2.0'])if(!state.selected.includes(id))state.selected.push(id);}
 localStorage.setItem('lk888-model-curated-v2','1');
 const firstRun=!migrated;
 if(firstRun)localStorage.setItem('lk888-model-curated-v1','1');
 const r=readJSON('lk888-model-test-results',{});state.results={};if(r&&typeof r==='object')for(const id of ids)if(r[id])state.results[id]=r[id];
 const save=()=>{
  localStorage.setItem('lk888-model-candidates',JSON.stringify(state.candidates));
  localStorage.setItem('lk888-model-selected',JSON.stringify(state.selected));
  localStorage.setItem('lk888-model-order',JSON.stringify(state.selected));
  localStorage.setItem('lk888-model-test-results',JSON.stringify(state.results));
  localStorage.setItem('lk888-deleted-models',JSON.stringify([...state.deleted]));
  localStorage.setItem('lk888-custom-models',JSON.stringify(state.candidates.filter(m=>m.manual)));
 };
 const api={
  state,save,
  visible(){return state.candidates.filter(m=>!state.deleted.has(m.id));},
  isTicked(id){return state.selected.includes(id);},
  tick(id,on){state.selected=state.selected.filter(x=>x!==id);if(on)state.selected.push(id);save();},
  setAll(ids,on){for(const id of ids){state.selected=state.selected.filter(x=>x!==id);if(on)state.selected.push(id);}save();},
  move(id,delta){const i=state.selected.indexOf(id),j=i+delta;if(i<0||j<0||j>=state.selected.length)return;[state.selected[i],state.selected[j]]=[state.selected[j],state.selected[i]];save();},
  add(model,{tick=false}={}){if(!ID_RE.test(model.id))return false;state.deleted.delete(model.id);let added=false;if(!state.candidates.some(m=>m.id===model.id)){state.candidates.push({id:model.id,label:model.label||model.id,manual:true});added=true;}if(tick&&!state.selected.includes(model.id))state.selected.push(model.id);save();return added;},
  remove(id){state.deleted.add(id);state.selected=state.selected.filter(x=>x!==id);save();},
  restore(){state.deleted.clear();save();},
  setResult(id,res){state.results[id]={...res,at:Date.now()};save();},
  // 主面板下拉：勾选且测试通过，按勾选顺序。若勾选的都还没测过（首次/升级），先按勾选显示，避免下拉为空。
  dropdown(){
   const byId=new Map(state.candidates.map(m=>[m.id,m]));
   const ticked=state.selected.filter(id=>byId.has(id)&&!state.deleted.has(id));
   const passed=ticked.filter(id=>state.results[id]?.ok);
   const anyTested=ticked.some(id=>state.results[id]);
   return {models:(anyTested?passed:ticked).map(id=>byId.get(id)),untested:!anyTested&&ticked.length>0};
  },
  // 平台同步：只合并进候选列表，新模型默认不勾选
  syncFromPlatform(items){let found=0;for(const c of state.candidates){c.platform=!!resolveModel(c.id,items);if(c.platform)found++;}save();return {total:state.candidates.length,added:0,found};}
 };
 if(firstRun)save();
 return api;
}
// 单条测试：沿用现有方式（检查平台 /v1/models 是否含该 ID，不提交生图、不计费）
async function testModels(ids,client,onEach){
 const api=await client();const started=Date.now();const items=await api.models();
 const out={};for(const id of ids){const m=resolveModel(id,items);out[id]=m?{ok:true,text:'测试通过 · 平台可用'+(m.id!==id?'（对应 '+m.id+'）':'')+' · '+(Date.now()-started)+' ms'}:{ok:false,text:'失败：平台模型列表中没有该 ID（可能已下线或账号无权限）'};onEach&&onEach(id,out[id]);}
 return out;
}
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;}
let searchText='';
async function runTests(ids,store,client,status){
 if(!ids.length){status&&status('请先勾选要使用的模型。',true);return;}
 status&&status('正在测试 '+ids.length+' 个勾选模型…');
 try{const res=await testModels(ids,client,(id,r)=>store.setResult(id,r));const ok=Object.values(res).filter(r=>r.ok).length;status&&status('测试 '+ids.length+' 个：通过 '+ok+'，失败 '+(ids.length-ok)+(ok<ids.length?'（红色，点 ✗ 重测）':'')+'。',ok<ids.length);}
 catch(error){for(const id of ids)store.setResult(id,{ok:false,text:'连接平台出错：'+(error.message||'请检查密钥和网络')});status&&status('测试失败：'+(error.message||'请检查密钥和网络'),true);}
}
// 紧凑列表：[勾选] 名称 (id) [状态 ✓/✗/–] [↑][↓]
function renderManager({root,store,client,current,onChange,status}){
 root.innerHTML='';
 const all=store.visible();
 const bar=el('div','mm-bar');
 const search=el('input','mm-search');search.placeholder='搜索模型';search.value=searchText;bar.appendChild(search);
 const small=(text,fn)=>{const b=el('button','mm-small',text);b.type='button';b.onclick=fn;bar.appendChild(b);return b;};
 const list=el('div','mm-list');
 const order=[...store.state.selected.map(id=>all.find(m=>m.id===id)).filter(Boolean),...all.filter(m=>!store.isTicked(m.id))];
 const rows=[];
 const apply=()=>{searchText=String(search.value||'');const t=searchText.trim().toLowerCase();for(const e of rows)e.row.style.display=!t||(e.model.id+' '+(e.model.label||'')+' '+shortModelName(e.model)).toLowerCase().includes(t)?'flex':'none';};
 small('全选',()=>{store.setAll(rows.filter(e=>e.row.style.display!=='none').map(e=>e.model.id),true);onChange();});
 small('全不选',()=>{store.setAll(rows.filter(e=>e.row.style.display!=='none').map(e=>e.model.id),false);onChange();});
 search.addEventListener('input',apply);
 root.appendChild(bar);
 if(!all.length){root.appendChild(el('p','hint','暂无模型，点「检查连接」拉取。'));return;}
 for(const model of order){
  const tk=store.isTicked(model.id),res=store.state.results[model.id];
  const row=el('div','mm-row'+(tk&&res&&!res.ok?' failed':''));
  const cb=el('input','mm-cb');cb.type='checkbox';cb.checked=tk;cb.onchange=async()=>{store.tick(model.id,cb.checked);onChange();if(cb.checked&&!store.state.results[model.id]){await runTests([model.id],store,client,status);onChange();}};row.appendChild(cb);
  const name=el('div','mm-name');name.appendChild(el('span','mm-title',shortModelName(model)+(model.id===current?' ●':'')));name.appendChild(el('span','mm-id',model.price?model.price+(model.platform===false?' · 平台未找到':''):model.id));name.title=model.id;name.onclick=()=>{cb.checked=!cb.checked;cb.onchange();};row.appendChild(name);
  const dot=el('button','mm-dot '+(!tk?'off':res?(res.ok?'ok':'bad'):'todo'),!tk?'':res?(res.ok?'✓':'✗'):'–');dot.type='button';dot.title=tk?(res?res.text+(res.ok?'':'（点击重测）'):'尚未测试，点击测试'):'未勾选';
  if(tk)dot.onclick=async()=>{dot.textContent='…';await runTests([model.id],store,client,status);onChange();};
  row.appendChild(dot);
  if(tk){const up=el('button','mm-arrow','↑');up.type='button';up.onclick=()=>{store.move(model.id,-1);onChange();};const dn=el('button','mm-arrow','↓');dn.type='button';dn.onclick=()=>{store.move(model.id,1);onChange();};row.appendChild(up);row.appendChild(dn);}
  list.appendChild(row);rows.push({row,model});
 }
 root.appendChild(list);apply();
}
module.exports={resolveModel,shortModelName,renderManager,isImageModel,createStore,testModels,runTests};
