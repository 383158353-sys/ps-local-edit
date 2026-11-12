const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pngRGBA}=require('../plugin/png');
const {fitUploadImages,decodeDataUrl,decodedBytes,storedPngBytes,NOTE_JPEG,NOTE_LOSSLESS,NOTE_SCALED,PER_FILE_DECODED,AGGREGATE_DECODED}=require('../plugin/image-budget');
const {TaskQueue}=require('../plugin/task-queue');
const {createVoiceServer}=require('../scripts/voice-server.cjs');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');

function dataUrl(buffer,mime='png'){
  const bytes=Buffer.from(buffer);
  return 'data:image/'+mime+';base64,'+bytes.toString('base64');
}
function solid(width,height,rgba){
  const pixels=new Uint8Array(width*height*4);
  for(let i=0;i<pixels.length;i+=4){pixels[i]=rgba[0];pixels[i+1]=rgba[1];pixels[i+2]=rgba[2];pixels[i+3]=rgba[3];}
  return dataUrl(pngRGBA(width,height,pixels,4));
}
function texture(width,height){
  const pixels=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const grain=((x>>2)+(y>>2))%2?176:92;
    const i=(y*width+x)*4;
    pixels[i]=grain;pixels[i+1]=grain-8;pixels[i+2]=grain-16;pixels[i+3]=255;
  }
  return dataUrl(pngRGBA(width,height,pixels,4));
}

test('stored PNG byte size matches the encoder, and a 6336×2688 selection exceeds 50MB',()=>{
  const pixels=new Uint8Array(4*2*3);
  const encoded=Buffer.from(pngRGBA(4,2,pixels,3));
  assert.equal(encoded.length,storedPngBytes(4,2,3));
  const wide=storedPngBytes(6336,2688,3);
  const urlLength=22+Math.ceil(wide/3)*4;
  assert.ok(wide>PER_FILE_DECODED);
  assert.ok(wide>AGGREGATE_DECODED);
  assert.ok(urlLength>50*1024*1024);
});

test('images under the upload budget stay untouched',()=>{
  const image=solid(8,8,[180,170,160,255]);
  const fitted=fitUploadImages([image]);
  assert.equal(fitted.compressed,false);
  assert.equal(fitted.note,'');
  assert.equal(fitted.images[0],image);
});

test('an oversized stored PNG becomes a high-quality JPEG without a false prepare error',()=>{
  const image=texture(96,64);
  const original=decodeDataUrl(image);
  const fitted=fitUploadImages([image],{targetBytes:image.length-1,minEdge:32});
  assert.notEqual(fitted.images[0],image);
  assert.ok(fitted.images[0].length<image.length);
  assert.match(fitted.note,new RegExp(NOTE_JPEG+'|'+NOTE_LOSSLESS));
  assert.doesNotMatch(fitted.note,/无法识别|本机助手未开启/);
  const decoded=decodeDataUrl(fitted.images[0]);
  assert.equal(decoded.width,original.width);
  assert.equal(decoded.height,original.height);
  const dark=decoded.data[0],light=decoded.data[4*4];
  assert.ok(Math.abs(dark-92)<24,String(dark));
  assert.ok(light-dark>40,String(light)+'-'+String(dark));
});

test('dimensions shrink only after quality alone cannot fit',()=>{
  const image=texture(160,96);
  const fitted=fitUploadImages([image],{limits:{perFileDecoded:350,aggregateDecoded:350,aggregateEncoded:500},minEdge:20,overheadBytes:0});
  assert.ok(decodedBytes(fitted.images[0])<=350);
  const decoded=decodeDataUrl(fitted.images[0]);
  assert.ok(decoded.width<160);
  assert.ok(decoded.width>=80);
  assert.equal(fitted.note,NOTE_SCALED);
});

test('a prepare size rejection still submits a budgeted copy and does not say the assistant is off',async()=>{
  const image=texture(64,40);
  let submitted;
  const queue=new TaskQueue({persist(){},onChange(){},client:async()=>({
    uploadByteBudget:image.length-1,
    prepareImages:async()=>{const error=new Error('图片预处理遇到无法识别的图片。，已改用原图直接提交。');error.prepareSkipped=true;throw error;},
    submit:async(_model,_prompt,images)=>{submitted=images;return 'task-real';}
  })});
  const job={id:'wide',count:1,model:'banana-2',instruction:'保留石材纹理',tasks:[]};
  await queue.submit(job,[image],{});
  assert.notEqual(submitted[0],image);
  assert.ok(decodedBytes(submitted[0])<decodedBytes(image));
  assert.match(job.prepareNote,/无损压缩|高质量 JPEG|轻度缩小/);
  assert.doesNotMatch(job.prepareNote,/本机助手未开启|无法识别/);
  assert.equal(job.tasks[0].id,'task-real');
  assert.equal(image.startsWith('data:image/png;base64,'),true);
});

function fakeChild(){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>child.emit('exit',0);return child;}
test('the local assistant accepts a selection data URL longer than the old 14MB cap',async()=>{
  const width=2100,height=1400,pixels=new Uint8Array(width*height*4);
  for(let i=0;i<pixels.length;i+=4){pixels[i]=120;pixels[i+1]=110;pixels[i+2]=100;pixels[i+3]=255;}
  const image=dataUrl(pngRGBA(width,height,pixels,4));
  assert.ok(image.length>14*1024*1024);
  assert.ok(decodedBytes(image)>PER_FILE_DECODED);
  const server=createVoiceServer({spawnWorker:()=>{const child=fakeChild();setImmediate(()=>child.emit('exit',0));return child;}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const response=await fetch(base+'/images/prepare',{method:'POST',headers:{'X-PS-Local-Voice':'1','Content-Type':'application/json'},body:JSON.stringify({images:[image]})});
    const body=await response.json();
    assert.equal(response.status,200,JSON.stringify(body&&body.message||body));
    assert.notEqual(body.images[0],image);
    assert.ok(decodedBytes(body.images[0])<=PER_FILE_DECODED);
    assert.ok(body.compressed);
    assert.match(body.note,/无损压缩|高质量 JPEG/);
    assert.doesNotMatch(JSON.stringify(body),/无法识别|本机助手未开启/);
    const decoded=decodeDataUrl(body.images[0]);
    assert.equal(decoded.width,width);
    assert.equal(decoded.height,height);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('several images stay original until their decoded total crosses 14MB',()=>{
  const one=solid(24,24,[20,30,40,255]);
  const limits={perFileDecoded:decodedBytes(one),aggregateDecoded:decodedBytes(one)*2,aggregateEncoded:one.length*3};
  const same=fitUploadImages([one,one],{limits,overheadBytes:0});
  assert.equal(same.compressed,false);
  assert.equal(same.images[0],one);
  assert.equal(same.images[1],one);
  const over=fitUploadImages([one,one,one],{limits,minEdge:8,overheadBytes:0});
  assert.equal(over.compressed,true);
  assert.ok(over.images.some(image=>image===one));
  assert.ok(decodedBytes(over.images[0])+decodedBytes(over.images[1])+decodedBytes(over.images[2])<=limits.aggregateDecoded);
});

test('a transparent PNG is not flattened while a lossless copy still fits',()=>{
  const pixels=new Uint8Array(16*16*4);
  for(let i=0;i<pixels.length;i+=4){pixels[i]=10;pixels[i+1]=20;pixels[i+2]=30;pixels[i+3]=i%32?255:0;}
  const image=dataUrl(pngRGBA(16,16,pixels,4));
  const fitted=fitUploadImages([image],{targetBytes:image.length-1,minEdge:8,overheadBytes:0});
  const decoded=decodeDataUrl(fitted.images[0]);
  assert.equal(fitted.note,NOTE_LOSSLESS);
  assert.ok([...decoded.data].some((value,index)=>index%4===3&&value===0));
});
