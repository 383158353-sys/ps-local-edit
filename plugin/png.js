// Lossless PNG encoder. Stored DEFLATE blocks avoid adding a runtime dependency.
function pngRGBA(width,height,pixels,components=4){
 const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
 const u32=(a,p,n)=>{a[p]=n>>>24;a[p+1]=n>>>16;a[p+2]=n>>>8;a[p+3]=n;};
 function chunk(type,data){const a=new Uint8Array(data.length+12);u32(a,0,data.length);for(let i=0;i<4;i++)a[4+i]=type.charCodeAt(i);a.set(data,8);let crc=0xffffffff;for(let i=4;i<a.length-4;i++)crc=table[(crc^a[i])&255]^(crc>>>8);u32(a,a.length-4,(crc^0xffffffff)>>>0);return a;}
 if(![3,4].includes(components)||pixels.length!==width*height*components)throw new Error('PNG 像素格式不支持。');
 const raw=new Uint8Array(height*(width*components+1));for(let y=0;y<height;y++)raw.set(pixels.subarray(y*width*components,(y+1)*width*components),y*(width*components+1)+1);
 const blocks=Math.ceil(raw.length/65535),z=new Uint8Array(raw.length+blocks*5+6);z.set([0x78,0x01]);let p=2;for(let offset=0;offset<raw.length;offset+=65535){const n=Math.min(65535,raw.length-offset);z[p++]=offset+n===raw.length?1:0;z[p++]=n&255;z[p++]=n>>>8;z[p++]=(~n)&255;z[p++]=((~n)>>>8)&255;z.set(raw.subarray(offset,offset+n),p);p+=n;}let a=1,b=0;for(const v of raw){a=(a+v)%65521;b=(b+a)%65521;}u32(z,p,((b<<16)|a)>>>0);
 const ihdr=new Uint8Array(13);u32(ihdr,0,width);u32(ihdr,4,height);ihdr[8]=8;ihdr[9]=components===4?6:2;const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',z),chunk('IEND',new Uint8Array())];const out=new Uint8Array(parts.reduce((s,p)=>s+p.length,0));p=0;for(const part of parts){out.set(part,p);p+=part.length;}return out.buffer;
}
module.exports={pngRGBA};
