// Standalone helper entry point. Does not load CinePrompt or its settings.
const http=require('node:http');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createVoiceServer}=require('./voice-server.cjs');
const origins=new Set(['com.local.lk888.psedit','plugin://com.local.lk888.psedit','uxp://com.local.lk888.psedit']);
async function start(){
 const {createSubmissionStore}=await import(pathToFileURL(path.join(__dirname,'../helper/server/media-submissions.mjs')).href);
 const directory=path.resolve(__dirname,'../data/media-submissions');
 const submissions=createSubmissionStore({directory});
 const server=createVoiceServer();const original=server.listeners('request')[0];server.removeAllListeners('request');
 server.on('request',async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(!url.pathname.startsWith('/api/bridge/'))return original(req,res);
  const origin=req.headers.origin||'';const trusted=!origin||origins.has(origin);
  const cors=origin&&trusted?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors});res.end(JSON.stringify(value));};
  if(!trusted)return send(403,{error:'仅允许本机插件调用。'});
  if(req.method==='OPTIONS'){res.writeHead(204,{...cors,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Cine-Bridge'});return res.end();}
  if(req.headers['x-cine-bridge']!=='1')return send(403,{error:'缺少本机桥接认证头'});
  try{
   if(url.pathname==='/api/bridge/health')return send(200,{ok:true,service:'ps-local-edit-helper',version:'0.1.11',standalone:true});
   if(url.pathname==='/api/bridge/media/submission'&&req.method==='GET')return send(200,await submissions.get(url.searchParams.get('id')));
   if(req.method==='POST'&&['submit','lookup','release'].includes(url.pathname.split('/').pop())){
    if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'需要 JSON 请求'});
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const action=url.pathname.split('/').pop();return send(200,await submissions[action==='submit'?'start':action](input));
   }
   return send(404,{error:'本机助手没有此接口'});
  }catch(error){return send(error.status||400,{error:error.code?'本机数据操作失败':error.message});}
 });
 server.on('error',error=>{console.error('helper:'+error.code);if(error.code!=='EADDRINUSE')process.exitCode=1;server.close();});
 server.once('listening',()=>server.ensureOverlay());
 server.listen(17402,'127.0.0.1');
 const stop=()=>server.close(()=>process.exit(0));process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
start().catch(error=>{console.error('helper startup failed: '+error.code);process.exitCode=1;});
