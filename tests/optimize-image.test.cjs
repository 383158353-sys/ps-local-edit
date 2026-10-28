const assert=require('node:assert/strict');
const zlib=require('node:zlib');
const {test}=require('node:test');
const {pngRGBA}=require('../plugin/png');
const {UPLOAD_MESSAGE,estimatedBytes,decodePng,encodeJpeg,jpegSize,prepareOptimizeImages,LIMITS}=require('../plugin/optimize-image');

function dataUrl(bytes,mime='image/png'){return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;}

function pngChunk(type,data){
 const body=Buffer.from(data);
 const typeBuf=Buffer.from(type);
 const length=Buffer.alloc(4);length.writeUInt32BE(body.length);
 return Buffer.concat([length,typeBuf,body,Buffer.alloc(4)]);
}

function wrapPng(width,height,channels,scanlines){
 const ihdr=Buffer.alloc(13);
 ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=channels===4?6:2;
 const idat=zlib.deflateSync(scanlines);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('IDAT',idat),pngChunk('IEND',Buffer.alloc(0))]);
}

test('selection png pixels round-trip, including stored blocks past 64KB',()=>{
 const width=200,height=180,raw=new Uint8Array(width*height*4);
 for(let i=0;i<raw.length;i++)raw[i]=i===3||(i%4)===3?255:(i*17)&255;
 const decoded=decodePng(new Uint8Array(pngRGBA(width,height,raw)));
 assert.equal(decoded.width,width);assert.equal(decoded.height,height);
 assert.deepEqual(decoded.rgba,raw);
});

test('compressed png filters decode to the original pixels',()=>{
 const width=3,height=2,channels=3;
 const rows=[
  Buffer.from([255,0,0, 0,255,0, 0,0,255]),
  Buffer.from([10,20,30, 40,50,60, 70,80,90])
 ];
 const scan=Buffer.alloc((width*channels+1)*height);
 scan[0]=0;rows[0].copy(scan,1);
 scan[width*channels+1]=1;
 for(let i=0;i<rows[1].length;i++){
  const left=i>=channels?rows[1][i-channels]:0;
  scan[width*channels+2+i]=(rows[1][i]-left)&255;
 }
 const decoded=decodePng(new Uint8Array(wrapPng(width,height,channels,scan)));
 const expected=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const s=x*channels,d=(y*width+x)*4,row=rows[y];
  expected[d]=row[s];expected[d+1]=row[s+1];expected[d+2]=row[s+2];expected[d+3]=255;
 }
 assert.deepEqual(decoded.rgba,expected);
});

test('a small image is sent unchanged and the original data url is kept',async()=>{
 const raw=new Uint8Array(4*4*4).fill(255);
 const data=dataUrl(new Uint8Array(pngRGBA(4,4,raw)));
 const item={name:'选区.png',data};
 const [copy]=await prepareOptimizeImages([item]);
 assert.equal(copy.data,data);assert.equal(copy.name,'选区.png');assert.equal(item.data,data);
});

test('a 6k-wide uncompressed selection becomes a small jpeg copy',async()=>{
 const width=6336,height=32,raw=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4;raw[i]=x&255;raw[i+1]=40;raw[i+2]=200;raw[i+3]=255;
 }
 const data=dataUrl(new Uint8Array(pngRGBA(width,height,raw)));
 const item={name:'选区.png',data};
 const [copy]=await prepareOptimizeImages([item]);
 assert.equal(item.data,data);
 assert.match(copy.data,/^data:image\/jpeg;base64,/);assert.equal(copy.name,'选区.jpg');
 assert.ok(estimatedBytes(copy.data)<=LIMITS.maxImageBytes);
 const bytes=Buffer.from(copy.data.split(',')[1],'base64');
 assert.equal(bytes[0],0xff);assert.equal(bytes[1],0xd8);assert.equal(bytes[bytes.length-2],0xff);assert.equal(bytes[bytes.length-1],0xd9);
 const size=jpegSize(bytes);
 assert.ok(size.width<=LIMITS.maxEdge&&size.height<=LIMITS.maxEdge);
 assert.equal(Math.max(size.width,size.height),LIMITS.maxEdge);
});

test('an oversized image that cannot be decoded is not posted as-is',async()=>{
 const data='data:image/png;base64,'+'A'.repeat(4000);
 const item={name:'选区.png',data};
 await assert.rejects(prepareOptimizeImages([item],{maxImageBytes:100}),error=>error.message===UPLOAD_MESSAGE);
 assert.equal(item.data,data);
});

test('jpeg encode keeps a flat color',()=>{
 const width=16,height=16,rgba=new Uint8Array(width*height*4);
 for(let i=0;i<rgba.length;i+=4){rgba[i]=220;rgba[i+1]=20;rgba[i+2]=30;rgba[i+3]=255;}
 const jpeg=encodeJpeg(rgba,width,height,85);
 const size=jpegSize(jpeg);
 assert.equal(size.width,16);assert.equal(size.height,16);
 assert.ok(jpeg.length<width*height*3);
});
