const zlib=require('node:zlib');
const {promisify}=require('node:util');
const deflate=promisify(zlib.deflate);
const table=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function chunk(type,data){const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);let crc=0xffffffff;for(let i=4;i<out.length-4;i++)crc=table[(crc^out[i])&255]^(crc>>>8);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;}
async function compressPng(source){
 if(typeof source!=='string'||!source.startsWith('data:image/png;base64,')||source.length<256*1024)return source;
 const png=Buffer.from(source.slice(22),'base64');
 if(!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return source;
 const chunks=[],idat=[];let ended=false;
 for(let p=8;p<png.length;){if(p+12>png.length)return source;const n=png.readUInt32BE(p);if(p+n+12>png.length)return source;const type=png.toString('ascii',p+4,p+8);if(type==='acTL')return source;chunks.push({type,bytes:png.subarray(p,p+n+12)});if(type==='IDAT')idat.push(png.subarray(p+8,p+8+n));p+=n+12;if(type==='IEND'){ended=true;break;}}
 if(!ended||!idat.length)return source;
 const original=Buffer.concat(idat);
 // Only optimize our uncompressed PNGs; leave already-compressed originals alone.
 if(original[0]!==0x78||original[1]!==0x01||(original[2]&6)!==0)return source;
 try{
  const raw=zlib.inflateSync(original,{maxOutputLength:512*1024*1024});
  const compressed=await deflate(raw,{level:1});if(compressed.length>=original.length)return source;
  let written=false;const output=[png.subarray(0,8)];
  for(const part of chunks){if(part.type==='IDAT'){if(!written){output.push(chunk('IDAT',compressed));written=true;}}else output.push(part.bytes);}
  return 'data:image/png;base64,'+Buffer.concat(output).toString('base64');
 }catch(_){return source;}
}
async function prepareImages(images){if(!Array.isArray(images)||images.some(image=>typeof image!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(image)))throw Error('图片数据无效。');const output=[];for(const image of images)output.push(await compressPng(image));return output;}
module.exports={prepareImages,compressPng};
