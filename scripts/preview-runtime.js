// Included exclusively by preview.cjs, never shipped inside the plugin.
const dataFiles=new Map(),memory=new Map();
const localStorage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
const bytesTo64=buffer=>{let result='';for(const value of new Uint8Array(buffer))result+=String.fromCharCode(value);return btoa(result);};
const base64ToArrayBuffer=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0)).buffer;
const folder={createFile:async name=>({nativePath:name,write:async data=>dataFiles.set(name,data)}),getEntry:async name=>{if(!dataFiles.has(name))throw new Error('No saved capture');return {read:async()=>dataFiles.get(name),delete:async()=>dataFiles.delete(name)};}};
const bounds={left:0,top:0,right:480,bottom:270,width:480,height:270};
const pixels=new Uint8Array(480*270*4);
// Small deterministic sample document, representing a room with a sofa.
for(let y=0;y<270;y++)for(let x=0;x<480;x++){
 let color=y>210?[136,115,91]:[202,195,181];
 if(x>30&&x<150&&y<195)color=[151,181,194];
 if(x>180&&x<435&&y>130&&y<215)color=[231,222,206];
 if(x>194&&x<421&&y>142&&y<180)color=[217,205,185];
 if(x>193&&x<421&&y>183&&y<206)color=[242,233,215];
 if(x>225&&x<365&&y>223&&y<237)color=[92,72,54];
 const i=(y*480+x)*4;pixels.set([...color,255],i);
}
function require(id){
 if(cache[id])return cache[id].exports;
 if(!factories[id])throw new Error('Preview module unavailable: '+id);
 const module={exports:{}};cache[id]=module;
 const scoped=name=>require(id==='./task-queue'&&name==='./api'?'./api':name);
 factories[id](module,module.exports,scoped);return module.exports;
}
const png=require('./png');
const sample='data:image/png;base64,'+bytesTo64(png.pngRGBA(480,270,pixels));
const thumbnail='data:image/png;base64,'+bytesTo64(png.thumbnailPNG(480,270,pixels));
const context={documentId:12,documentName:'预览文档.psd',originalBounds:{left:0,top:0,right:480,bottom:270}};
const metadata={bounds,context,uploadWidth:480,uploadHeight:270,thumbnail,documentWidth:480,documentHeight:270,sourceImage:sample,references:[{name:'沙发参考.png',data:sample}],mask:{width:480,height:270,components:1}};
const demo=location.search.includes('demo');
if(demo){
 const jobs=[{id:'demo-1',captureRef:'demo-1',number:1,title:'局部改图 1',state:'ready',model:'banana-2',prompt:'将沙发换成米白色布艺沙发，保留原有光线与空间结构。',quality:'auto',ratio:'original',count:2,thumbnail,tasks:[{id:'demo-task',state:'ready',results:[{source:sample,imported:false},{source:sample,imported:false}]}]},{id:'demo-2',captureRef:'demo-2',number:2,title:'局部改图 2',state:'running',model:'banana-2',count:1,thumbnail,tasks:[{id:'pending-demo',state:'running',results:[]}]},{id:'demo-3',captureRef:'demo-3',number:3,title:'局部改图 3',state:'draft',model:'banana-2',count:1,thumbnail,tasks:[]}];
 localStorage.setItem('lk888-jobs',JSON.stringify(jobs.slice().reverse()));localStorage.setItem('lk888-reload-job-id','demo-1');
 for(const job of jobs){dataFiles.set(job.id+'.json',JSON.stringify(metadata));dataFiles.set(job.id+'.bin',new Uint8Array(480*270).fill(255).buffer);}
}
let previewCounter=0;class PreviewClient{async submit(){return 'preview-'+(++previewCounter);}async status(id){return id==='pending-demo'?{state:'running',progress:35}:{is_final:true,state:'success',result_url:sample};}async balance(){return {};}async models(){return [...require('./api').MODELS,{id:'studio-edit-demo',display_name:'Studio Edit（模拟）',capabilities:{image_input:true,image_generation:true,max_images:3},parameters:{resolution:{enum:['1K','2K']},ratio:{enum:['1:1','16:9']}}},{id:'image-lab-demo',display_name:'Image Lab（模拟）'},{id:'chat-demo',type:'chat'}];}}
const previewStorage={formats:{binary:'binary'},secureStorage:{getItem:async()=>new Uint8Array([112,114,101,118,105,101,119]),setItem:async()=>{}},localFileSystem:{getDataFolder:async()=>folder,getTemporaryFolder:async()=>folder,createSessionToken:()=>'',getFileForSaving:async()=>null,getFileForOpening:async()=>[{name:'参考图.png',read:async()=>base64ToArrayBuffer(sample.split(',')[1])}]}};
cache.photoshop={exports:{app:{activeDocument:{id:12,name:'预览文档.psd',width:480,height:270,selection:{bounds:context.originalBounds}}},imaging:{},constants:{},action:{}}};
cache.uxp={exports:{storage:previewStorage,shell:{openPath:async()=>''}}};
cache['./modules/fs']={exports:{arrayBufferToBase64:bytesTo64,base64ToArrayBuffer}};
cache['./modules/ps']={exports:{getSelectionBounds:async()=>bounds,captureSelection:async()=>({...metadata,maskData:{...metadata.mask,imageData:new Uint8Array(480*270).fill(255)},imageData:{sourceBounds:bounds,imageData:{width:480,height:270,components:4,getData:async()=>pixels,dispose(){}}}}),placeBack:async()=>{}}};
cache['./voice']={exports:{VoiceController:class{cancel(){}stop(){}start(){}async request(){throw new Error('浏览器预览不连接本机语音与标注服务。');}}}};
const originalAPI=require('./api');cache['./api']={exports:{...originalAPI,MediaClient:PreviewClient}};
