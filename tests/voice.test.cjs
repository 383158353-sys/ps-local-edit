const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {LocalHelper}=require('../plugin/voice');
const {createVoiceServer}=require('../scripts/voice-server.cjs');
const response=(data,ok=true)=>({ok,json:async()=>data});
test('helper request returns parsed JSON from the local server',async()=>{
  const helper=new LocalHelper({fetchImpl:async()=>response({state:'ready'})});
  const data=await helper.request('/health');
  assert.equal(data.state,'ready');
});
test('image prepare does not surface a voice-session 404 when the helper is closed',async()=>{
  const helper=new LocalHelper({fetchImpl:async()=>({ok:false,status:404,json:async()=>({message:'语音会话已结束，请重新开始。'})})});
  await assert.rejects(helper.request('/images/prepare','POST',{images:['data:image/png;base64,YQ==']}),error=>error.message==='本机助手未开启。'&&!/语音会话/.test(error.message));
});
test('unavailable helper shows actionable error for clipboard path',async()=>{
  const helper=new LocalHelper({fetchImpl:async()=>{throw new Error('fetch failed');}});
  await assert.rejects(helper.request('/clipboard'),/打开局部改图插件/);
});
test('unavailable helper shows actionable error for drop path',async()=>{
  const helper=new LocalHelper({fetchImpl:async()=>{throw new Error('fetch failed');}});
  await assert.rejects(helper.request('/drop/read','POST',{paths:[]}),/打开局部改图插件/);
});
test('unavailable helper shows actionable error for annotate path',async()=>{
  const helper=new LocalHelper({fetchImpl:async()=>{throw new Error('fetch failed');}});
  await assert.rejects(helper.request('/annotate/open','POST',{}),/打开局部改图插件/);
});
test('unavailable helper shows generic error for health check',async()=>{
  const helper=new LocalHelper({fetchImpl:async()=>{throw new Error('fetch failed');}});
  await assert.rejects(helper.request('/health'),/打开局部改图插件/);
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
test('generate proxy is not answered as a voice session and unknown routes stay non-voice',async()=>{
  let forwarded;
  const server=createVoiceServer({spawnWorker:()=>{const child=fakeChild();setImmediate(()=>child.emit('exit',0));return child;},generateProxy:async raw=>{forwarded=JSON.parse(raw);return {status:200,body:JSON.stringify({task_id:'gen-1'})};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,headers={'X-PS-Local-Voice':'1','Content-Type':'application/json'};
  try{
    const generated=await fetch(base+'/media/generate',{method:'POST',headers,body:JSON.stringify({key:'sk-test',payload:{model:'banana-2',prompt:'写清楚',params:{images:[]}}})});
    assert.equal(generated.status,200);assert.equal((await generated.json()).task_id,'gen-1');assert.equal(forwarded.payload.model,'banana-2');assert.equal(forwarded.key,'sk-test');
    const unknown=await(await fetch(base+'/media/nope',{headers})).json();
    assert.equal(unknown.message,'本机服务没有这个接口。');assert.doesNotMatch(unknown.message,/语音会话/);
    const missing=await(await fetch(base+'/status',{headers})).json();
    assert.match(missing.message,/语音会话已结束/);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
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
test('drop overlay stays an opaque window so Explorer can hand it files',()=>{
  const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','scripts','drop-overlay.ps1'),'utf8');
  assert.doesNotMatch(source,/Opacity\s*=/);
  assert.doesNotMatch(source,/WS_EX_TRANSPARENT|0x00000020/);
  assert.match(source,/AllowDrop\s*=\s*\$true/);
  assert.match(source,/\$req\.Proxy\s*=\s*\$null/);
  assert.match(source,/X-PS-Local-Voice/);
  assert.match(source,/DragDrop/);
});
test('drop cover arms the overlay and never opens the titled drop window',async()=>{
  const windows=[];const overlays=[];
  const server=createVoiceServer({spawnWorker:()=>{const child=fakeChild();setImmediate(()=>child.emit('exit',0));return child;},dropWindowLauncher:id=>{windows.push(id);return fakeChild();},overlayLauncher:()=>{const child=fakeChild();overlays.push(child);return child;}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,headers={'X-PS-Local-Voice':'1'};
  try{
    const armed=await fetch(base+'/drop/arm',{method:'POST',headers});
    assert.equal(armed.status,200);assert.equal(overlays.length,1);assert.equal(windows.length,0);
    const covered=await(await fetch(base+'/drop/cover',{method:'POST',headers})).json();
    assert.equal(overlays.length,1);assert.equal(windows.length,0);assert.ok(covered.id);
    const shown=await(await fetch(base+'/drop/overlay',{headers})).json();
    assert.equal(shown.action,'show');assert.equal(shown.id,covered.id);
    const image={name:'拖入.png',data:'data:image/png;base64,YWJj'};
    const upload=await fetch(base+'/drop/upload?id='+covered.id,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({references:[image]})});
    assert.equal(upload.status,200);
    assert.equal((await(await fetch(base+'/drop/overlay',{headers})).json()).action,'idle');
    const polled=await(await fetch(base+'/drop/poll?id='+covered.id,{headers})).json();
    assert.deepEqual(polled.references,[image]);
    const again=await(await fetch(base+'/drop/cover',{method:'POST',headers})).json();
    await fetch(base+'/drop/hide',{method:'POST',headers});
    const hidden=await(await fetch(base+'/drop/overlay',{headers})).json();
    assert.equal(hidden.action,'idle');assert.notEqual(again.id,covered.id);assert.equal(windows.length,0);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('drop cover wakes a waiting overlay with the cursor hint and no dialog',async()=>{
  const windows=[];
  const server=createVoiceServer({spawnWorker:()=>{const child=fakeChild();setImmediate(()=>child.emit('exit',0));return child;},dropWindowLauncher:id=>{windows.push(id);return fakeChild();},overlayLauncher:()=>fakeChild()});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,headers={'X-PS-Local-Voice':'1','Content-Type':'application/json'};
  try{
    const pending=fetch(base+'/drop/overlay?wait=1&since=0',{headers});
    await new Promise(resolve=>setTimeout(resolve,40));
    const covered=await(await fetch(base+'/drop/cover',{method:'POST',headers,body:JSON.stringify({x:11,y:22})})).json();
    const shown=await Promise.race([pending.then(response=>response.json()),new Promise((_,reject)=>setTimeout(()=>reject(new Error('overlay wait timed out')),1000))]);
    assert.equal(shown.action,'show');assert.equal(shown.id,covered.id);assert.equal(shown.x,11);assert.equal(shown.y,22);assert.equal(shown.ready,false);
    assert.equal(windows.length,0);
    assert.equal((await(await fetch(base+'/drop/ready',{method:'POST',headers})).json()).state,'ready');
    assert.equal((await(await fetch(base+'/drop/overlay',{headers})).json()).ready,true);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('drop read returns local image bytes and rejects anything that is not an image path',async()=>{
  const read=[];
  const server=createVoiceServer({spawnWorker:()=>{const child=fakeChild();setImmediate(()=>child.emit('exit',0));return child;},pathReader:async file=>{read.push(file);if(file.endsWith('.jpg'))return Buffer.from('jpeg-bytes');return Buffer.from('png-bytes');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,headers={'X-PS-Local-Voice':'1','Content-Type':'application/json'};
  try{
    const ok=await fetch(base+'/drop/read',{method:'POST',headers,body:JSON.stringify({paths:['C:\\pics\\参考.png','D:/img/第二张.jpg']})});
    assert.equal(ok.status,200);
    const body=await ok.json();
    assert.deepEqual(read,['C:\\pics\\参考.png','D:\\img\\第二张.jpg']);
    assert.equal(body.references[0].name,'参考.png');
    assert.equal(body.references[0].data,'data:image/png;base64,'+Buffer.from('png-bytes').toString('base64'));
    assert.equal(body.references[1].name,'第二张.jpg');
    assert.match(body.references[1].data,/^data:image\/jpeg;base64,/);
    for (const paths of [['C:\\pics\\secret.txt'],['..\\secret.png'],['notes.png'],['C:\\pics\\..\\Windows\\a.png']]){
      const bad=await fetch(base+'/drop/read',{method:'POST',headers,body:JSON.stringify({paths})});
      assert.equal(bad.status,400);
    }
    assert.deepEqual(read,['C:\\pics\\参考.png','D:\\img\\第二张.jpg']);
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
