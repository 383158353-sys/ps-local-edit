const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {VoiceController}=require('../plugin/voice');
const {createVoiceServer}=require('../scripts/voice-server.cjs');
const response=(data,ok=true)=>({ok,json:async()=>data});
test('dictation inserts each phrase once and ends without another API call',async()=>{
  const texts=[],states=[],paths=[];let queries=0;
  const controller=new VoiceController({onText:t=>texts.push(t),onState:s=>states.push(s.state),fetchImpl:async(url,options)=>{
    paths.push(new URL(url).pathname);assert.equal(options.headers['X-PS-Local-Voice'],'1');
    if(url.endsWith('/health'))return response({state:'ready'});
    if(url.endsWith('/start'))return response({id:'session'});
    return response({state:++queries===1?'listening':'complete',events:[{seq:1,text:'把花瓶改为白色'}]});
  }});
  await controller.start();clearTimeout(controller.timer);await controller.poll(controller.epoch);
  assert.deepEqual(texts,['把花瓶改为白色']);assert.equal(controller.session,null);assert.equal(states.at(-1),'complete');
  assert.ok(paths.every(p=>['/health','/start','/status'].includes(p)));
});
test('switching editor stops microphone and does not insert late dictation',async()=>{
  let context='a';const paths=[],texts=[];
  const controller=new VoiceController({context:()=>context,onText:t=>texts.push(t),fetchImpl:async url=>{
    paths.push(new URL(url).pathname);
    if(url.endsWith('/health'))return response({state:'ready'});
    if(url.endsWith('/start'))return response({id:'session'});
    return response({state:'listening',events:[]});
  }});
  await controller.start();clearTimeout(controller.timer);context='b';await controller.poll(controller.epoch);
  assert.equal(controller.session,null);assert.deepEqual(texts,[]);assert.equal(paths.at(-1),'/stop');
});
test('unavailable helper shows actionable error and does not submit audio',async()=>{
  const states=[];const controller=new VoiceController({onState:s=>states.push(s),fetchImpl:async()=>{throw new Error('fetch failed');}});
  await controller.start();assert.equal(states.at(-1).state,'error');assert.match(states.at(-1).message,/node scripts\/voice-server\.cjs/);assert.equal(controller.session,null);
});
test('stop retains final recognized phrase before completion',async()=>{
  const texts=[];let stopped=false;
  const controller=new VoiceController({onText:t=>texts.push(t),fetchImpl:async(url,options)=>{
    if(url.endsWith('/health'))return response({state:'ready'});
    if(url.endsWith('/start'))return response({id:'session'});
    if(url.includes('/stop')){assert.equal(options.method,'POST');stopped=true;return response({state:'stopping'});}
    return response({state:stopped?'complete':'listening',events:stopped?[{seq:1,text:'保留桌面纹理'}]:[]});
  }});
  await controller.start();clearTimeout(controller.timer);await controller.stop();await controller.poll(controller.epoch);
  assert.deepEqual(texts,['保留桌面纹理']);assert.equal(controller.phase,'complete');
});
function fakeChild(){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>child.emit('exit',0);return child;}
test('loopback helper rejects web callers and only launches recording on authenticated start',async()=>{
  const children=[];const server=createVoiceServer({spawnWorker:probe=>{
    const child=fakeChild();children.push({child,probe});
    if(probe)setImmediate(()=>{child.stdout.write(JSON.stringify({type:'ready',language:'zh-CN'})+'\n');child.emit('exit',0);});
    return child;
  }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,headers={'X-PS-Local-Voice':'1'};
  try{
    assert.equal((await fetch(base+'/start',{method:'POST'})).status,403);
    assert.equal((await fetch(base+'/start',{method:'POST',headers:{...headers,Origin:'https://example.com'}})).status,403);
    assert.equal(children.length,1);
    const start=await(await fetch(base+'/start',{method:'POST',headers})).json();assert.ok(start.id);assert.equal(children.length,2);assert.equal(children[1].probe,false);
    const resumed=await fetch(base+'/start',{method:'POST',headers});assert.equal(resumed.status,200);const resumedSession=await resumed.json();assert.equal(resumedSession.id,start.id);assert.equal(resumedSession.resumed,true);assert.equal(children.length,2);
    children[1].child.stdout.write(JSON.stringify({type:'text',text:'白色花瓶'})+'\n');
    const state=await(await fetch(base+'/status?id='+start.id+'&cursor=0',{headers})).json();assert.equal(state.events[0].text,'白色花瓶');
    const next=await(await fetch(base+'/status?id='+start.id+'&cursor=1',{headers})).json();assert.deepEqual(next.events,[]);
    await fetch(base+'/stop?id='+start.id,{method:'POST',headers});assert.equal(children[1].child.stdin.read().toString(),'stop\n');
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('voice session reports microphone level and distinguishes silence from rejected speech',async()=>{
  const children=[];const server=createVoiceServer({spawnWorker:probe=>{
    const child=fakeChild();children.push(child);
    if(probe)setImmediate(()=>{child.stdout.write(JSON.stringify({type:'ready',language:'zh-CN'})+'\n');child.emit('exit',0);});
    return child;
  }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,headers={'X-PS-Local-Voice':'1'};
  try{
    const start=await(await fetch(base+'/start',{method:'POST',headers})).json();
    children[1].stdout.write(JSON.stringify({type:'audiolevel',level:24,peak:31})+'\n');
    let state=await(await fetch(base+'/status?id='+start.id+'&cursor=0',{headers})).json();
    assert.equal(state.audioLevel,24);
    children[1].stdout.write(JSON.stringify({type:'complete',peak:31,rejected:2})+'\n');
    state=await(await fetch(base+'/status?id='+start.id+'&cursor=0',{headers})).json();
    assert.match(state.message,/检测到麦克风声音/);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('local drop window sends images into the panel polling queue',async()=>{
  const launched=[];const server=createVoiceServer({spawnWorker:()=>{const child=fakeChild();setImmediate(()=>child.emit('exit',0));return child;},dropWindowLauncher:id=>{launched.push(id);return fakeChild();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,headers={'X-PS-Local-Voice':'1'};
  try{
    const opened=await(await fetch(base+'/drop/open',{method:'POST',headers})).json();assert.equal(launched[0],opened.id);
    const image={name:'测试.png',data:'data:image/png;base64,YWJj'};
    const upload=await fetch(base+'/drop/upload?id='+opened.id,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({references:[image]})});assert.equal(upload.status,200);
    const first=await(await fetch(base+'/drop/poll?id='+opened.id,{headers})).json();assert.deepEqual(first.references,[image]);
    const second=await(await fetch(base+'/drop/poll?id='+opened.id,{headers})).json();assert.deepEqual(second.references,[]);
    const bad=await fetch(base+'/drop/upload?id='+opened.id,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({references:[{name:'x',data:'file:///secret'}]})});assert.equal(bad.status,400);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('local annotation window returns a saved PNG exactly once',async()=>{
  const launched=[];const server=createVoiceServer({spawnWorker:()=>{const child=fakeChild();setImmediate(()=>child.emit('exit',0));return child;},annotationWindowLauncher:id=>{launched.push(id);return fakeChild();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,headers={'X-PS-Local-Voice':'1','Content-Type':'application/json'};
  try{
    const image='data:image/png;base64,YWJj';
    const opened=await(await fetch(base+'/annotate/open',{method:'POST',headers,body:JSON.stringify({image})})).json();assert.equal(launched[0],opened.id);
    const waiting=await(await fetch(base+'/annotate/poll?id='+opened.id,{headers})).json();assert.equal(waiting.state,'waiting');
    const saved=await fetch(base+'/annotate/save?id='+opened.id,{method:'POST',headers,body:JSON.stringify({image})});assert.equal(saved.status,200);
    const done=await(await fetch(base+'/annotate/poll?id='+opened.id,{headers})).json();assert.equal(done.state,'saved');assert.equal(done.image,image);
    assert.equal((await fetch(base+'/annotate/poll?id='+opened.id,{headers})).status,404);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
