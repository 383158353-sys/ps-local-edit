const assert=require('node:assert/strict');const {test}=require('node:test');const zlib=require('node:zlib');const {pngRGBA}=require('../plugin/png');
test('lossless encoder keeps exact pixels and dimensions in valid PNG scanlines',()=>{const raw=new Uint8Array([255,0,0,255,0,255,0,128]);const out=Buffer.from(pngRGBA(2,1,raw));assert.equal(out.readUInt32BE(16),2);assert.equal(out.readUInt32BE(20),1);let offset=8,idat=[];while(offset<out.length){const n=out.readUInt32BE(offset),type=out.toString('ascii',offset+4,offset+8);if(type==='IDAT')idat.push(out.subarray(offset+8,offset+8+n));offset+=n+12;}assert.deepEqual(zlib.inflateSync(Buffer.concat(idat)),Buffer.from([0,...raw]));});
const {uploadPNG,UPLOAD_LIMIT}=require('../plugin/png');
function noisy(length){let seed=123456789;return Uint8Array.from({length},()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed&255;});}
test('compressible selections preserve dimensions and alpha without loss',async()=>{
 const pixels=new Uint8Array(400*300*4).fill(128);
 const result=await uploadPNG(400,300,pixels);
 assert.equal(result.width,400);assert.equal(result.height,300);assert.equal(result.resized,false);
 assert.ok(result.encoded.byteLength<4000);
});
test('oversized upload is resized under 10 MB including Base64 expansion',async()=>{
 const pixels=noisy(1800*1600*4);
 const raw=pngRGBA(1800,1600,pixels);
 assert.ok(23+4*Math.ceil(raw.byteLength/3)>UPLOAD_LIMIT);
 const result=await uploadPNG(1800,1600,pixels);
 assert.ok(23+4*Math.ceil(result.encoded.byteLength/3)<=UPLOAD_LIMIT);
 assert.ok(result.resized);assert.ok(Math.abs(result.width/result.height-1800/1600)<.002);
 const png=Buffer.from(result.encoded);assert.equal(png.readUInt32BE(16),result.width);assert.equal(png.readUInt32BE(20),result.height);
});
test('small oversized image also satisfies an exact custom payload budget',async()=>{
 const result=await uploadPNG(60,40,noisy(60*40*4),4,1024);
 assert.ok(23+4*Math.ceil(result.encoded.byteLength/3)<=1024);
 assert.ok(result.resized);
});
test('bundled compression works without Node APIs or worker support',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const exports={},module={exports};
 vm.runInNewContext(fs.readFileSync('plugin/lib/fflate.js','utf8'),{module,exports,require(){throw new Error('Node APIs unavailable in UXP');}});
 const output=module.exports.zlibSync(new Uint8Array([1,2,3,4]));
 assert.deepEqual(zlib.inflateSync(output),Buffer.from([1,2,3,4]));
});
test('task thumbnails stay within 96 pixels and preserve aspect ratio and alpha',()=>{
 const {thumbnailPNG}=require('../plugin/png');
 const source=new Uint8Array(300*200*4).fill(128);
 const output=Buffer.from(thumbnailPNG(300,200,source));
 assert.equal(output.readUInt32BE(16),96);assert.equal(output.readUInt32BE(20),64);
 let offset=8,idat=[];while(offset<output.length){const n=output.readUInt32BE(offset);if(output.toString('ascii',offset+4,offset+8)==='IDAT')idat.push(output.subarray(offset+8,offset+8+n));offset+=n+12;}
 const decoded=zlib.inflateSync(Buffer.concat(idat));assert.deepEqual([...decoded.subarray(1,5)],[128,128,128,128]);
});
