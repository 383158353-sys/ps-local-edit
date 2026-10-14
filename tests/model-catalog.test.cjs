const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeModels,orderModels,parameterChoices,preferredRatio,automaticQuality,buildModelParams,modelHint,restoreProfiles}=require('../plugin/model-catalog');
const normalize=item=>normalizeModels([item])[0];
test('API image input plus image output qualifies for editing; vision chat does not',()=>{
 const models=normalizeModels([{id:'editor',input_modalities:['text','image'],output_modalities:['image']},{id:'vision-chat',input_modalities:['text','image'],output_modalities:['text']}]);
 assert.equal(models[0].kind,'edit');assert.equal(models[1].kind,'other');
 assert.deepEqual(orderModels(models).map(m=>m.id),['editor']);
 assert.throws(()=>buildModelParams(models[1],{}),/不是.*图像/);
});
test('name guesses are explicitly unverified and do not inherit preset parameters',()=>{
 const model=normalize('flux-next');assert.equal(model.kind,'candidate');assert.equal(model.evidence,'name');
 assert.match(modelHint(model),/待确认/);assert.deepEqual(buildModelParams(model,{quality:'4K',ratio:'16:9'}),{});
 assert.deepEqual(parameterChoices(model),{qualities:['1K','2K','4K'],ratios:[]});
});
test('favorite ordering, image priority, search and favorites-only filtering are independent',()=>{
 const models=normalizeModels([{id:'editor',capabilities:{image_editing:true}},{id:'generator',type:'image'},{id:'unknown'},{id:'chat',type:'chat'}]);
 assert.deepEqual(orderModels(models,['generator']).map(m=>m.id),['generator','editor','unknown']);
 assert.deepEqual(orderModels(models,['generator'],'favorites').map(m=>m.id),['generator']);
 assert.deepEqual(orderModels(models,[],'all','CHAT').map(m=>m.id),['chat']);
});
test('parameter names and allowed values follow each model schema',()=>{
 const model=normalize({id:'studio',capabilities:{image_editing:true},parameters:{resolution:{enum:['1K','2K']},ratio:{enum:['1:1','3:4']}}});
 assert.deepEqual(buildModelParams(model,{quality:'2K',ratio:'3:4'}),{resolution:'2K',ratio:'3:4'});
 assert.throws(()=>buildModelParams(model,{quality:'4K',ratio:'3:4'}),/不支持清晰度/);
 assert.throws(()=>buildModelParams(model,{quality:'2K',ratio:'16:9'}),/不支持比例/);
 assert.equal(automaticQuality(model,'4K'),'2K');assert.equal(preferredRatio(model,300,400),'3:4');
});
test('pixel-size models receive supported dimensions instead of a 1K token',()=>{
 const model=normalize({id:'pixels',capabilities:{image_editing:true},parameter_schema:{properties:{size:{enum:['1024x1024','1536x1024','2048x2048']}}}});
 assert.deepEqual(parameterChoices(model),{qualities:['1K','2K'],ratios:['1:1','3:2']});
 assert.deepEqual(buildModelParams(model,{quality:'2K',ratio:'3:2'}),{size:'1536x1024'});
 assert.equal(preferredRatio(model,300,200),'3:2');
});
test('unsupported editing, image limits and specialized endpoints fail before submission',()=>{
 assert.throws(()=>buildModelParams(normalize({id:'text-only-image',capabilities:{image_generation:true,image_input:false}}),{}),/不支持图片输入/);
 assert.throws(()=>buildModelParams(normalize({id:'no-edit',capabilities:{image_editing:false,image_generation:true}}),{}),/不支持图片编辑/);
 assert.throws(()=>buildModelParams(normalize({id:'limited',capabilities:{image_editing:true,max_images:2}}),{imageCount:3}),/最多接收 2/);
 assert.throws(()=>buildModelParams(normalize({id:'special',endpoints:['/v1/images/edits']}),{}),/专用接口/);
});
test('API declarations override an existing preset and explicit empty schema adds no fields',()=>{
 const model=normalize({id:'banana-2',parameter_schema:{properties:{},additionalProperties:false}});assert.deepEqual(buildModelParams(model,{quality:'1K',ratio:'1:1'}),{});
 const unsupported=normalize({id:'banana-2',capabilities:{image_input:false}});assert.throws(()=>buildModelParams(unsupported,{}),/不支持图片输入/);
});
test('array-shaped capabilities and parameter descriptors are retained',()=>{
 const model=normalize({id:'new-editor',capabilities:['image_editing'],supported_parameters:[{name:'resolution',enum:['2K']}]});
 assert.equal(model.kind,'edit');assert.deepEqual(buildModelParams(model,{quality:'2K',ratio:'1:1'}),{resolution:'2K'});
});
test('normalization deduplicates models and strips unrelated metadata before caching',()=>{
 const models=normalizeModels([null,'a',{id:'a'},{id:'custom'},{id:'b',secret:'do-not-cache',parameters:{images:{enum:['x']},resolution:{enum:['2K']}}}]);
 assert.equal(models.length,2);assert.equal(JSON.stringify(models).includes('do-not-cache'),false);assert.deepEqual(Object.keys(models[1].parameters),['resolution']);
});
test('cache validation preserves profiles but discards invalid records and unsupported parameter keys',()=>{
 const model=normalize({id:'safe',capabilities:{image_editing:true},parameters:{resolution:{enum:['2K']}}});
 assert.deepEqual(restoreProfiles([model]),[model]);
 assert.deepEqual(restoreProfiles([{id:'bad',kind:'made-up'}]),[]);
 const restored=restoreProfiles([{...model,parameters:{resolution:['2K'],images:['wrong']}}]);assert.deepEqual(restored[0].parameters,{resolution:['2K']});
});
test('contradictory size and ratio declarations are rejected rather than sent together',()=>{
 const model=normalize({id:'conflicting',parameters:{size:{enum:['1024x1024']},aspect_ratio:{enum:['1:1','16:9']}}});
 assert.throws(()=>buildModelParams(model,{quality:'1K',ratio:'16:9'}),/没有与 16:9 匹配/);
});

test('unverified models only send generic quality after an explicit user selection',()=>{
 const model=normalize('flux-next');
 assert.deepEqual(buildModelParams(model,{quality:'4K',ratio:'16:9'}),{});
 assert.deepEqual(buildModelParams(model,{quality:'4K',ratio:'16:9',explicitQuality:true}),{image_size:'4K'});
 assert.throws(()=>buildModelParams(model,{quality:'invalid',explicitQuality:true}),/请选择/);
 const declared=normalize({id:'schema-model',parameters:['ratio']});assert.deepEqual(parameterChoices(declared).qualities,[]);assert.deepEqual(buildModelParams(declared,{quality:'4K',ratio:'1:1',explicitQuality:true}),{ratio:'1:1'});
});

test('LK888 exact presets survive capability-only and empty model list metadata',()=>{
 for(const id of ['banana-2','banana-pro','tt-image-2','tt-image-2.5']){
  const model=normalize({id,capabilities:{image_editing:true},parameters:[]});
  assert.equal(model.hasSchema,true);assert.ok(parameterChoices(model).qualities.includes('4K'));assert.match(modelHint(model),/平台参数/);
  assert.deepEqual(parameterChoices(restoreProfiles([model])[0]),parameterChoices(model));
 }
 const restored=restoreProfiles([{...normalize('banana-2'),hasSchema:true,parameters:{},schemaDeclared:undefined}])[0];assert.ok(parameterChoices(restored).qualities.includes('4K'));
 const explicit=normalize({id:'banana-2',parameter_schema:{properties:{},additionalProperties:false}});assert.deepEqual(buildModelParams(restoreProfiles([explicit])[0],{quality:'4K',ratio:'1:1'}),{});
});
test('LK888 Banana models use camelCase media fields and their own ratios and limits',()=>{
 const banana=normalize('banana-2'),pro=normalize('banana-pro');
 assert.deepEqual(buildModelParams(banana,{quality:'0.5K',ratio:'1:8'}),{imageSize:'0.5K',aspectRatio:'1:8'});
 assert.deepEqual(buildModelParams(pro,{quality:'4K',ratio:'21:9'}),{imageSize:'4K',aspectRatio:'21:9'});
 assert.throws(()=>buildModelParams(pro,{quality:'0.5K',ratio:'1:1'}),/不支持清晰度/);
 assert.throws(()=>buildModelParams(pro,{quality:'4K',ratio:'1:8'}),/不支持比例/);
 assert.throws(()=>buildModelParams(banana,{quality:'1K',ratio:'1:1',imageCount:15}),/最多接收 14/);
});
test('LK888 GPT Image 2 maps every resolution and ratio to the platform pixel table',()=>{
 const model=normalize('tt-image-2');
 assert.deepEqual(buildModelParams(model,{quality:'1K',ratio:'16:9'}),{size:'1920x1088'});
 assert.deepEqual(buildModelParams(model,{quality:'2K',ratio:'3:4'}),{size:'1920x2560'});
 assert.deepEqual(buildModelParams(model,{quality:'4K',ratio:'1:1'}),{size:'2880x2880'});
 for(const quality of parameterChoices(model).qualities)for(const ratio of parameterChoices(model).ratios)assert.match(buildModelParams(model,{quality,ratio}).size,/^\d+x\d+$/);
});
test('LK888 GPT Image 2.5 uses resolution and paired automatic values',()=>{
 const model=normalize('tt-image-2.5');
 assert.deepEqual(buildModelParams(model,{quality:'2K',ratio:'9:21'}),{resolution:'2K',aspect_ratio:'9:21'});
 const params=buildModelParams(model,{quality:'4K',ratio:'16:9',includeRatio:false});assert.equal(params.resolution,'auto');assert.equal(params.aspect_ratio,'auto');
});
test('API parameter declarations override platform presets and retain camelCase fields',()=>{
 const model=normalize({id:'banana-2',parameters:{resolution:{enum:['2K']},ratio:{enum:['1:1']}}});assert.deepEqual(buildModelParams(model,{quality:'2K',ratio:'1:1'}),{resolution:'2K',ratio:'1:1'});
 const camel=normalize({id:'new-platform-model',parameters:{imageSize:{enum:['0.5K','2K']},aspectRatio:{enum:['1:1']}}});assert.deepEqual(parameterChoices(camel),{qualities:['0.5K','2K'],ratios:['1:1']});assert.deepEqual(buildModelParams(camel,{quality:'0.5K',ratio:'1:1'}),{imageSize:'0.5K',aspectRatio:'1:1'});
});


test('all 16 allowed official image definitions round-trip and produce only declared fields and values',()=>{
 const official=require('../plugin/platform-models');assert.equal(official.length,21);
 assert.equal(normalizeModels(official).length,16);
 for(const record of official.filter(record=>!require('../plugin/model-policy').isTokenModel(record))){
  const model=normalize(record),choices=parameterChoices(model),extraParams=Object.fromEntries((model.fields||[]).filter(f=>f.required&&!['images','imageSize','image_size','resolution','size','aspectRatio','aspect_ratio','ratio'].includes(f.name)).map(f=>[f.name,f.options.find(o=>!o.unavailable).value]));
  const params=buildModelParams(model,{quality:choices.qualities[0]||'1K',ratio:choices.ratios[0]||'1:1',extraParams});
  for(const [name,value] of Object.entries(params)){const field=record.params.find(f=>f.name===name);assert.ok(field,record.name+' undeclared '+name);if(field.options)assert.ok(field.options.some(o=>String(o.value)===String(value)),record.name+' invalid '+name+' '+value);}
  const restored=restoreProfiles([model])[0];assert.deepEqual(parameterChoices(restored),choices);assert.deepEqual(buildModelParams(restored,{quality:choices.qualities[0]||'1K',ratio:choices.ratios[0]||'1:1',extraParams}),params);
 }
});
test('official Seedream, GK, Qwen and Vidu use different sizes, limits and mandatory parameters',()=>{
 assert.deepEqual(buildModelParams(normalize('doubao-seedream-5-0-pro-260628'),{quality:'2K',ratio:'16:9'}),{size:'2K',aspect_ratio:'16:9'});
 assert.throws(()=>buildModelParams(normalize('doubao-seedream-5-0-pro-260628'),{quality:'4K',ratio:'16:9'}),/不支持清晰度/);
 assert.deepEqual(buildModelParams(normalize('gk-image-2.0'),{quality:'2K',ratio:'1:1',imageCount:3}),{resolution:'2k',aspect_ratio:'1:1'});
 assert.throws(()=>buildModelParams(normalize('gk-image-2.0'),{quality:'2K',ratio:'1:1',imageCount:4}),/最多接收 3/);
 const qwen=normalize('qwen-image');assert.deepEqual(parameterChoices(qwen).qualities,[]);assert.deepEqual(buildModelParams(qwen,{quality:'4K',ratio:'3:4'}),{size:'3:4'});
 const vidu=normalize('vidu-image-2');assert.ok(parameterChoices(vidu).qualities.includes('3K'));assert.throws(()=>buildModelParams(vidu,{quality:'3K',ratio:'1:1'}),/请选择模型参数/);assert.deepEqual(buildModelParams(vidu,{quality:'3K',ratio:'1:1',extraParams:{quality:'high'}}),{resolution:'3K',aspect_ratio:'1:1',quality:'high'});
});
test('key availability and unavailable options stop invalid requests before submission',()=>{
 const denied=normalize({name:'banana-2',available_for_this_key:false});assert.throws(()=>buildModelParams(denied,{quality:'1K',ratio:'1:1'}),/未配置/);
 const model=normalize({name:'image-demo',type:'image',params:[{name:'resolution',type:'select',options:[{value:'1K',currently_unavailable:true},{value:'2K'}]},{name:'quality',label:'生成质量',type:'select',required:true,options:[{value:'high',requires:{resolution:['2K']}}]}]});
 assert.deepEqual(parameterChoices(model).qualities,['2K']);assert.throws(()=>buildModelParams(model,{quality:'1K',ratio:'1:1',extraParams:{quality:'high'}}),/不支持清晰度/);assert.deepEqual(buildModelParams(model,{quality:'2K',ratio:'1:1',extraParams:{quality:'high'}}),{resolution:'2K',quality:'high'});
});

test('a model whose resolution options are all unavailable does not invent generic quality values',()=>{
 const model=normalize({name:'exhausted-image',type:'image',params:[{name:'resolution',type:'select',required:true,options:[{value:'2K',currently_unavailable:true}]}]});assert.deepEqual(parameterChoices(model).qualities,[]);assert.throws(()=>buildModelParams(model,{quality:'2K',ratio:'1:1'}),/当前规格不可用/);
});

test('authoritative empty detail schemas do not resurrect old platform presets or allow image uploads',()=>{
 const model=normalize({name:'banana-2',type:'image',params:[],_detailLoaded:true});assert.equal(model.hasSchema,true);assert.equal(model.acceptsImages,false);assert.deepEqual(parameterChoices(model).qualities,[]);assert.throws(()=>buildModelParams(model,{quality:'2K',ratio:'1:1'}),/不支持图片输入/);
});

test('Token models cannot return through cached catalogs or billing metadata',()=>{
 const records=[{id:'banana-2-token'},{name:'other',billing_mode:'tokens'},{id:'another',display_name:'Pro Token版'},{id:'banana-2'}];assert.deepEqual(normalizeModels(records).map(m=>m.id),['banana-2']);const cached=records.map(m=>({...m,id:m.id||m.name,kind:'edit',evidence:'api',protocol:'media'}));assert.deepEqual(restoreProfiles(cached).map(m=>m.id),['banana-2']);
});
