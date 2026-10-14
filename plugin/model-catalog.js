const {MODELS}=require('./api');
const {isTokenModel,requireAllowedModel}=require('./model-policy');
const OFFICIAL=new Map(require('./platform-models').map(m=>[m.name,m]));
const {normalizeFields,restoreFields}=require('./platform-schema');
const {platformProfile,platformImageLimit,platformParams}=require('./platform-profiles');
const {closestStandardAspect,parseAspectRatio}=require('./modules/geometry');
const PRESETS=new Set(MODELS.filter(m=>m.id!=='custom').map(m=>m.id));
const RATIOS=['1:1','4:3','3:4','16:9','9:16'];
const FIELDS=['imageSize','image_size','resolution','size','aspectRatio','aspect_ratio','ratio'];
const cleanList=value=>Array.isArray(value)?[...new Set(value.filter(v=>typeof v==='string'&&v.length<=120).map(v=>v.trim()).filter(Boolean))]:[];
function normalizeModels(items){
 const seen=new Set();return items.flatMap(raw=>{
  let item=typeof raw==='string'?{id:raw}:raw;if(!item||typeof item!=='object')return [];
  const id=String(item.id||item.name||'').trim();if(!id||id==='custom'||isTokenModel(item)||id.length>200||seen.has(id))return [];seen.add(id);
  const known=OFFICIAL.get(id),incoming=!!(item._detailLoaded||item.parameter_schema||item.metadata?.parameter_schema||item.params?.length||item.parameters&&Object.keys(item.parameters).length||item.supported_parameters?.length);
  if(known&&!incoming)item={...known,...item,params:known.params};
  const fields=normalizeFields(item.params),tags=cleanList(item.tags||item.biaoqian),imageUpload=fields.find(f=>f.name==='images'&&f.type==='upload');
  const meta=item.metadata&&typeof item.metadata==='object'?item.metadata:{};
  const cap=item.capabilities&&typeof item.capabilities==='object'?item.capabilities:meta.capabilities||{};
  const input=cleanList(item.input_modalities||cap.input_modalities||meta.input_modalities),output=cleanList(item.output_modalities||cap.output_modalities||meta.output_modalities);
  const capabilityNames=cleanList(cap),namedEdit=capabilityNames.some(v=>['image_edit','image_editing','image-to-image'].includes(v));
  const canInput=item.supports_image_input??cap.image_input??cap.supports_image_input??(input.length?input.includes('image'):namedEdit?true:item._detailLoaded?!!imageUpload:undefined);
  const canOutput=cap.image_generation??cap.image_output??(output.length?output.includes('image'):namedEdit||capabilityNames.includes('image_generation')?true:undefined);
  const edits=cap.image_editing??cap.image_edit??item.supports_image_editing??(namedEdit||imageUpload||tags.some(t=>['图生图','图像编辑','图片编辑','多图参考','image-to-image','image editing'].includes(t.toLowerCase()))?true:undefined);
  const category=String(item.type||item.category||meta.type||'').toLowerCase();
  let kind='unknown',evidence='unknown';
  if(edits===true||(canInput===true&&canOutput===true)){kind='edit';evidence='api';}
  else if(canOutput===true||/^(image|image-generation|text-to-image)$/.test(category)){kind='image';evidence='api';}
  else if(edits===false&&canInput===false&&canOutput===false||output.length&&!output.includes('image')||/^(chat|text|audio|video|embedding|speech)$/.test(category)){kind='other';evidence='api';}
  else if(PRESETS.has(id)){kind='edit';evidence='preset';}
  else if(/(?:image|img|banana|seedream|imagen|flux|sdxl|stable.diffusion)/i.test(id)){kind='candidate';evidence='name';}
  else if(/(?:gpt-[345](?:\.|-|$)|claude|deepseek|whisper|embedding|tts|sora|veo|seedance)/i.test(id)){kind='other';evidence='name';}
  const schema=item.parameter_schema||meta.parameter_schema||{},declared=fields.length?fields.map(f=>({name:f.name,enum:f.options.filter(o=>!o.unavailable).map(o=>String(o.value))})):item.parameters||item.supported_parameters||meta.parameters;
  const props=schema.properties||(!Array.isArray(declared)&&declared&&typeof declared==='object'?declared:{});
  const names=Array.isArray(declared)?declared.map(p=>typeof p==='string'?p:p?.name).filter(Boolean):Object.keys(props);
  const hasSchema=!!(item.parameter_schema||meta.parameter_schema||names.length||item._detailLoaded&&Array.isArray(item.params));
  const parameters={};
  for(const name of FIELDS){if(names.includes(name)||Object.prototype.hasOwnProperty.call(props,name)){
   const field=props[name]||(Array.isArray(declared)?declared.find(p=>p?.name===name):null);parameters[name]=cleanList(Array.isArray(field)?field:field?.enum||field?.values);
  }}
  const endpoints=cleanList(item.endpoints||item.supported_endpoint_types||meta.endpoints||item.api_endpoints?.map(e=>e.endpoint)||(item.api_endpoint?[item.api_endpoint]:item.api_format?[item.api_format]:[]));
  const protocol=endpoints.length&&!endpoints.some(e=>e==='media'||e==='media.generate'||e==='/v1/media/generate')?'unsupported':'media';
  const max=Number(imageUpload?.maxCount??item.max_images??cap.max_images??meta.max_images??known?.params?.find(f=>f.name==='images')?.max_count);
  return [{id,label:String(item.label||item.display_name||item.name||id).slice(0,160),kind,evidence,parameters,fields,available:item.available_for_this_key!==false,parameterSource:known&&!incoming?'platform':fields.length?'api':'unknown',hasSchema,schemaDeclared:!!(item.parameter_schema||meta.parameter_schema),protocol,acceptsImages:canInput!==false,editingSupported:typeof edits==='boolean'?edits:null,maxImages:Number.isInteger(max)&&max>0?Math.min(20,max):platformImageLimit(id)}];
 });
}
function orderModels(models,favorites=[],filter='image',search=''){
 const favoriteSet=new Set(favorites),term=String(search).trim().toLowerCase();
 const rank={edit:0,image:1,candidate:2,unknown:3,other:4};
 return models.filter(m=>(filter!=='favorites'||favoriteSet.has(m.id))&&(filter!=='image'||m.kind!=='other')&&(!term||(m.label+' '+m.id).toLowerCase().includes(term))).slice().sort((a,b)=>Number(favoriteSet.has(b.id))-Number(favoriteSet.has(a.id))||(rank[a.kind]+(a.kind==='edit'&&a.evidence!=='api'?.5:0))-(rank[b.kind]+(b.kind==='edit'&&b.evidence!=='api'?.5:0))||a.label.localeCompare(b.label));
}
function parameterChoices(model){
 if(!model||model.kind==='other'||model.acceptsImages===false||model.editingSupported===false||model.protocol!=='media')return {qualities:[],ratios:[]};
 const platform=platformProfile(model);if(platform)return {qualities:platform.qualities.slice(),ratios:platform.ratios.slice()};
 if(!model.hasSchema)return model.evidence==='preset'?{qualities:['1K','2K','4K'],ratios:RATIOS}:model.kind!=='other'&&model.protocol==='media'&&model.acceptsImages!==false&&model.editingSupported!==false?{qualities:['1K','2K','4K'],ratios:[]}:{qualities:[],ratios:[]};
 const p=model.parameters,{qualityField,ratioField}=sizingFields(model);
 const values=qualityField?p[qualityField]:[],qualityUnavailable=model.fields?.find(f=>f.name===qualityField)?.options.every(o=>o.unavailable)&&model.fields?.find(f=>f.name===qualityField)?.options.length>0,ratioUnavailable=model.fields?.find(f=>f.name===ratioField)?.options.every(o=>o.unavailable)&&model.fields?.find(f=>f.name===ratioField)?.options.length>0;
 const qualities=values.filter(v=>/^(?:0\.5|[1-4])K$/i.test(v)).map(v=>v.toUpperCase());
 // Pixel size enums are adapted from the chosen quality and crop ratio.
 const pixels=values.filter(v=>/^\d+x\d+$/.test(v)&&v.split('x').every(n=>Number(n)>0&&Number(n)<=32768));
 if(pixels.length&&['tt-image-2','tt-image-2-token'].includes(model.id)){const preset=platformProfile({id:'tt-image-2',hasSchema:false});return {qualities:preset.qualities.filter(q=>Object.values(preset.sizes[q]).some(size=>values.includes(size))),ratios:preset.ratios.filter(r=>preset.qualities.some(q=>values.includes(preset.sizes[q][r])))};}
 return {qualities:qualityUnavailable?[]:qualityField?(qualityField==='size'&&!values.length?[]:qualities.length?qualities:pixels.length?[...new Set(pixels.map(v=>{const edge=Math.max(...v.split('x').map(Number));return edge<=1448?'1K':edge<=2896?'2K':'4K';}))]:values.length?values:['1K','2K','4K']):[],ratios:ratioUnavailable?[]:ratioField?(p[ratioField].length?p[ratioField].filter(v=>parseAspectRatio(v)):RATIOS):pixels.length?[...new Set(pixels.map(v=>{const [w,h]=v.split('x').map(Number);const gcd=(a,b)=>b?gcd(b,a%b):a,g=gcd(w,h);return (w/g)+':'+(h/g);} ))]:[]};
}
function automaticQuality(model,desired){const choices=parameterChoices(model).qualities;if(!choices.length||choices.includes(desired))return desired;const numeric=choices.filter(v=>/^(?:0\.5|[1-4])K$/.test(v));if(numeric.length)return numeric.reduce((a,b)=>Math.abs(parseFloat(b)-parseFloat(desired))<Math.abs(parseFloat(a)-parseFloat(desired))?b:a,numeric[0]);return choices[0];}
function preferredRatio(model,width,height){
 const ratios=parameterChoices(model).ratios;
 if(!ratios.length)return closestStandardAspect(width,height);
 const actual=width/height;return ratios.reduce((a,b)=>Math.abs(Math.log(parseAspectRatio(b).value/actual))<Math.abs(Math.log(parseAspectRatio(a).value/actual))?b:a,ratios[0]);
}
function sizingFields(model){
 const p=model.parameters||{},sizeIsRatio=p.size?.length&&p.size.every(value=>!!parseAspectRatio(value));
 return {qualityField:['imageSize','image_size','resolution',...(sizeIsRatio?[]:['size'])].find(k=>k in p),ratioField:['aspectRatio','aspect_ratio','ratio',...(sizeIsRatio?['size']:[])].find(k=>k in p)};
}
function extraFields(model){return (model?.fields||[]).filter(f=>!FIELDS.includes(f.name)&&!['images','prompt','notify_url','n'].includes(f.name));}
function validateModelUse(model,{imageCount=1}={}){
 if(!model)throw new Error('请重新同步模型列表或填写自定义模型 ID。');
 requireAllowedModel(model.id);
 if(model.editingSupported===false)throw new Error('该模型明确不支持图片编辑，请选择其他模型。');
 if(model.acceptsImages===false)throw new Error('该模型明确不支持图片输入，不能编辑当前选区。');
 if(model.kind==='other')throw new Error('这个模型不是可用于局部改图的图像模型，请选择其他模型。');
 if(model.protocol!=='media')throw new Error('该模型声明使用专用接口，目前不能通过图片任务接口提交。');
 if(model.maxImages&&imageCount>model.maxImages)throw new Error('该模型最多接收 '+model.maxImages+' 张图片（包含选区），请减少参考图。');
 if(model.available===false)throw new Error('当前密钥未配置这个模型的可用渠道，请先在平台密钥管理中启用。');
}
function validateExtras(model,extras={}){
 const out={};for(const field of extraFields(model)){
  const value=extras[field.name];if(value===undefined||value===null){if(field.required)throw new Error('请选择模型参数「'+field.label+'」。');continue;}
  if(field.options.length){const option=field.options.find(o=>String(o.value)===String(value)&&!o.unavailable);if(!option)throw new Error('模型参数「'+field.label+'」的选项当前不可用。');out[field.name]=option.value;}
  else if(field.type==='number'){const n=Number(value);if(!Number.isFinite(n))throw new Error('模型参数「'+field.label+'」需要数字。');out[field.name]=n;}
  else if(field.type==='upload')throw new Error('该模型还需要专用文件输入「'+field.label+'」，请更换模型。');
  else out[field.name]=String(value).slice(0,2000);
 }
 return out;
}
function buildModelParams(model,{quality,ratio,includeRatio=true,imageCount=1,explicitQuality=false,extraParams={}}){
 validateModelUse(model,{imageCount});const extra=validateExtras(model,extraParams);
 const platform=platformProfile(model);if(platform)return {...platformParams(platform,{quality,ratio,includeRatio}),...extra};
 if(!model.hasSchema){
  if(model.evidence==='preset')return {image_size:quality,...(includeRatio?{aspect_ratio:ratio}:{})};
  if(explicitQuality){if(!['1K','2K','4K'].includes(quality))throw new Error('请选择 1K、2K 或 4K 清晰度。');return {image_size:quality};}
  return {};
 }
 const out={...extra},p=model.parameters,{qualityField,ratioField}=sizingFields(model);
 if(qualityField&&(qualityField!=='size'||p[qualityField].length)){
  const values=p[qualityField],pixels=values.filter(v=>/^\d+x\d+$/.test(v));
  if(pixels.length){
   const target=({'1K':1024,'2K':2048,'4K':4096})[quality]||1024,r=parseAspectRatio(ratio)?.value||1;
   const preset=['tt-image-2','tt-image-2-token'].includes(model.id)?platformProfile({id:'tt-image-2',hasSchema:false}):null;
   const fixed=preset?.sizes?.[quality]?.[ratio];if(fixed&&!values.includes(fixed))throw new Error('当前清晰度与比例的尺寸选项不可用，请更换规格。');
   out[qualityField]=fixed&&values.includes(fixed)?fixed:pixels.reduce((a,b)=>{const score=v=>{const [w,h]=v.split('x').map(Number);return Math.abs(Math.log((w/h)/r))*10+Math.abs(Math.log(Math.max(w,h)/target));};return score(b)<score(a)?b:a;});
   if(includeRatio){const [w,h]=out[qualityField].split('x').map(Number);if(Math.abs(Math.log((w/h)/r))>.02)throw new Error('该模型没有与 '+ratio+' 匹配的像素尺寸，请调整比例。');}
  }else if(!values.length||values.some(v=>v.toLowerCase()===String(quality).toLowerCase()))out[qualityField]=values.find(v=>v.toLowerCase()===String(quality).toLowerCase())||quality;
  else throw new Error('该模型不支持清晰度 '+quality+'，请选择模型支持的规格。');
 }
 if(ratioField&&(includeRatio||model.fields?.find(f=>f.name===ratioField)?.required)){if(p[ratioField].length&&!p[ratioField].includes(ratio))throw new Error('该模型不支持比例 '+ratio+'，请重新选择。');out[ratioField]=ratio;}
 if(['tt-image-2.5','tt-image-2.5-token'].includes(model.id)&&(!includeRatio||out.aspect_ratio==='auto')){out.resolution='auto';out.aspect_ratio='auto';}
 for(const field of model.fields||[]){if(field.required&&!['images','prompt'].includes(field.name)&&out[field.name]===undefined)throw new Error('请设置模型参数「'+field.label+'」。');const option=field.options.find(o=>String(o.value)===String(out[field.name]));if(out[field.name]!==undefined&&field.options.length&&(!option||option.unavailable))throw new Error('模型参数「'+field.label+'」当前规格不可用。');if(option)for(const [name,values] of Object.entries(option.requires))if(!values.some(v=>String(v)===String(out[name])))throw new Error('模型参数「'+field.label+'」与其他选项不兼容。');}
 return out;
}
function modelHint(model){
 if(!model)return '请选择模型';
 if(model.available===false)return '当前密钥不可用 · 请在平台启用对应渠道';
 if(model.protocol!=='media')return '需要专用接口 · 暂不能生成';
 if(model.editingSupported===false)return '该模型不支持图片编辑 · 不用于局部改图';
 if(model.acceptsImages===false)return '该模型不支持图片输入 · 不用于局部改图';
 if(model.kind==='other')return '非图像模型 · 不用于局部改图';
 if(model.parameterSource==='platform'||model.parameterSource==='api')return '按平台参数匹配 · '+(model.maxImages?'含选区最多 '+model.maxImages+' 张参考图':'清晰度与比例以平台为准')+(!parameterChoices(model).qualities.length?' · 平台未提供清晰度档位':'');
 if(platformProfile(model))return 'LK888 专用参数已匹配 · 按该模型的清晰度与比例提交';
 const capability=model.evidence==='api'?(model.kind==='edit'?'API 声明支持图片输入与输出':'API 声明为图像模型，编辑能力待确认'):model.evidence==='preset'?'已有改图预设':model.evidence==='name'?'按名称识别为图像候选，编辑能力待确认':'API 未标注能力，编辑兼容性待确认';
 return capability+' · '+(model.hasSchema?'按模型参数提交':model.evidence==='preset'?'使用已有参数适配':'自动使用平台默认；手动清晰度需模型支持');
}
module.exports={normalizeModels,orderModels,parameterChoices,preferredRatio,buildModelParams,modelHint,automaticQuality,extraFields,validateExtras,validateModelUse};

// Revalidate cache contents instead of trusting arbitrary objects from localStorage.
function restoreProfiles(items){
 return Array.isArray(items)?items.filter(m=>m&&typeof m.id==='string'&&!isTokenModel(m)&&m.id.length<=200&&['edit','image','candidate','unknown','other'].includes(m.kind)&&['api','preset','name','unknown'].includes(m.evidence)&&['media','unsupported'].includes(m.protocol)).map(m=>{
  if(OFFICIAL.has(m.id)&&!m.fields)return normalizeModels([{id:m.id,label:m.label,available_for_this_key:m.available!==false}])[0];
  const fields=restoreFields(m.fields),parameters=Object.fromEntries(FIELDS.filter(k=>m.parameters&&Object.prototype.hasOwnProperty.call(m.parameters,k)).map(k=>[k,cleanList(m.parameters[k])]));for(const f of fields)if(FIELDS.includes(f.name))parameters[f.name]=f.options.filter(o=>!o.unavailable).map(o=>String(o.value));
  return {id:m.id,label:String(m.label||m.id).slice(0,160),kind:m.kind,evidence:m.evidence,protocol:m.protocol,acceptsImages:m.acceptsImages!==false,editingSupported:typeof m.editingSupported==='boolean'?m.editingSupported:null,hasSchema:!!m.hasSchema,schemaDeclared:!!m.schemaDeclared,fields,available:m.available!==false,parameterSource:['api','platform'].includes(m.parameterSource)?m.parameterSource:'unknown',parameters,maxImages:Number.isInteger(m.maxImages)&&m.maxImages>0?Math.min(20,m.maxImages):platformImageLimit(m.id)};
 }):[];
}
module.exports.restoreProfiles=restoreProfiles;
