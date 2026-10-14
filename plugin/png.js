// Lossless PNG encoder; bundled fflate runs inside UXP without Node or workers.
const {zlibSync}=require("./lib/fflate");
function pngRGBA(width,height,pixels,components=4){
 const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
 const u32=(a,p,n)=>{a[p]=n>>>24;a[p+1]=n>>>16;a[p+2]=n>>>8;a[p+3]=n;};
 function chunk(type,data){const a=new Uint8Array(data.length+12);u32(a,0,data.length);for(let i=0;i<4;i++)a[4+i]=type.charCodeAt(i);a.set(data,8);let crc=0xffffffff;for(let i=4;i<a.length-4;i++)crc=table[(crc^a[i])&255]^(crc>>>8);u32(a,a.length-4,(crc^0xffffffff)>>>0);return a;}
 if(![3,4].includes(components)||pixels.length!==width*height*components)throw new Error('PNG 像素格式不支持。');
 const raw=new Uint8Array(height*(width*components+1));for(let y=0;y<height;y++)raw.set(pixels.subarray(y*width*components,(y+1)*width*components),y*(width*components+1)+1);
 const z=zlibSync(raw,{level:6});let p=0;
 const ihdr=new Uint8Array(13);u32(ihdr,0,width);u32(ihdr,4,height);ihdr[8]=8;ihdr[9]=components===4?6:2;const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',z),chunk('IEND',new Uint8Array())];const out=new Uint8Array(parts.reduce((s,p)=>s+p.length,0));p=0;for(const part of parts){out.set(part,p);p+=part.length;}return out.buffer;
}
// Budget includes the data URL and Base64 expansion, with room for JSON framing.
const UPLOAD_LIMIT=10*1024*1024;
const uploadBytes=bytes=>23+4*Math.ceil(bytes/3);
async function uploadPNG(width,height,pixels,components=4,limit=UPLOAD_LIMIT){
 const originalWidth=width,originalHeight=height;
 let data=pixels;
 for(;;){
  await new Promise(resolve=>setTimeout(resolve,0));
  const encoded=pngRGBA(width,height,data,components);
  if(uploadBytes(encoded.byteLength)<=limit)return {encoded,width,height,originalWidth,originalHeight,resized:width!==originalWidth||height!==originalHeight};
  if(width===1&&height===1)throw new Error('图片无法压缩到上传限制内。');
  const scale=Math.min(.85,Math.sqrt((limit-64)/uploadBytes(encoded.byteLength))*.95);
  const nextWidth=Math.max(1,Math.floor(width*scale)),nextHeight=Math.max(1,Math.floor(height*scale));
  const next=new Uint8Array(nextWidth*nextHeight*components);
  // Area averaging avoids nearest-neighbour jagged edges; alpha is premultiplied.
  for(let y=0;y<nextHeight;y++){
   const top=y*height/nextHeight,bottom=(y+1)*height/nextHeight;
   for(let x=0;x<nextWidth;x++){
    const left=x*width/nextWidth,right=(x+1)*width/nextWidth;
    let sums=[0,0,0,0],weight=0;
    for(let sy=Math.floor(top);sy<Math.ceil(bottom);sy++)for(let sx=Math.floor(left);sx<Math.ceil(right);sx++){
     const w=(Math.min(bottom,sy+1)-Math.max(top,sy))*(Math.min(right,sx+1)-Math.max(left,sx)),i=(sy*width+sx)*components,alpha=components===4?data[i+3]/255:1;
     for(let c=0;c<3;c++)sums[c]+=data[i+c]*alpha*w;
     sums[3]+=alpha*w;weight+=w;
    }
    const i=(y*nextWidth+x)*components;
    for(let c=0;c<3;c++)next[i+c]=sums[3]?Math.round(sums[c]/sums[3]):0;
    if(components===4)next[i+3]=Math.round(255*sums[3]/weight);
   }
   if(y%32===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  data=next;width=nextWidth;height=nextHeight;
 }
}
module.exports={pngRGBA,uploadPNG,UPLOAD_LIMIT};

// Small previews are stored separately so task cards never decode full upload images.
function thumbnailPNG(width,height,pixels,components=4){
 const scale=Math.min(1,96/Math.max(width,height));
 const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
 const output=new Uint8Array(w*h*components);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const sx=Math.max(0,(x+.5)*width/w-.5),sy=Math.max(0,(y+.5)*height/h-.5);
  const x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0;
  let alpha=0,sums=[0,0,0];
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
   const i=(Math.min(height-1,y0+dy)*width+Math.min(width-1,x0+dx))*components;
   const weight=(dx?fx:1-fx)*(dy?fy:1-fy),a=components===4?pixels[i+3]/255:1;
   alpha+=a*weight;for(let c=0;c<3;c++)sums[c]+=pixels[i+c]*a*weight;
  }
  const i=(y*w+x)*components;for(let c=0;c<3;c++)output[i+c]=alpha?Math.round(sums[c]/alpha):0;
  if(components===4)output[i+3]=Math.round(alpha*255);
 }
 return pngRGBA(w,h,output,components);
}
module.exports.thumbnailPNG=thumbnailPNG;
