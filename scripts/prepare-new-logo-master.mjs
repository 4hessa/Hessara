import sharp from 'sharp';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { once } from 'node:events';
import { Transform } from 'node:stream';
import { createDeflate } from 'node:zlib';
import { createHash } from 'node:crypto';

// Render an exact 15360-square deliverable in 256-row vector tiles. This avoids
// allocating a full ~944 MB RGBA frame and keeps production builds independent.
sharp.cache(false); sharp.concurrency(1);
const size=15360, stripHeight=256, output='outputs/branding/hessara-monogram-15360.png';
const svg=await readFile('public/brand/hessara-monogram.svg','utf8');
const [x,y,w,h]=svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
const path=svg.match(/<path[^>]*\/>/)[0];
const scale=size/Math.max(w,h), offsetX=(size-w*scale)/2, offsetY=(size-h*scale)/2;
const crcTable=Array.from({length:256},(_,i)=>{let c=i;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return(crc^0xffffffff)>>>0;}
function chunk(type, data){const text=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([text,data])));return Buffer.concat([length,text,data,crc]);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
const file=createWriteStream(output);file.write(Buffer.from([137,80,78,71,13,10,26,10]));file.write(chunk('IHDR',ihdr));file.write(chunk('sRGB',Buffer.from([0])));
const deflate=createDeflate({level:9});
const pack=new Transform({transform(data,_encoding,done){done(null,chunk('IDAT',data));}});
deflate.pipe(pack).pipe(file,{end:false});
const compressed=once(pack,'end');
let transparent=0,opaque=0,partial=0,minX=size,minY=size,maxX=-1,maxY=-1;
for(let top=0;top<size;top+=stripHeight){
  const rows=Math.min(stripHeight,size-top);
  const tile=`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${rows}" viewBox="0 ${top} ${size} ${rows}" fill="#626b7c"><g transform="matrix(${scale} 0 0 ${scale} ${offsetX-x*scale} ${offsetY-y*scale})">${path}</g></svg>`;
  const pixels=await sharp(Buffer.from(tile),{limitInputPixels:size*stripHeight}).ensureAlpha().raw().toBuffer();
  for(let row=0;row<rows;row++){
    const filtered=Buffer.alloc(1+size*4);filtered[0]=1;
    let previous=0,previousR=0,previousG=0,previousB=0;
    for(let col=0;col<size;col++){
      const a=pixels[(row*size+col)*4+3],r=a?98:0,g=a?107:0,b=a?124:0;
      filtered[1+col*4]=(r-previousR+256)&255;filtered[2+col*4]=(g-previousG+256)&255;filtered[3+col*4]=(b-previousB+256)&255;filtered[4+col*4]=(a-previous+256)&255;previous=a;previousR=r;previousG=g;previousB=b;
      if(a===0)transparent++;else{if(a===255)opaque++;else partial++;minX=Math.min(minX,col);maxX=Math.max(maxX,col);minY=Math.min(minY,top+row);maxY=Math.max(maxY,top+row);}
    }
    if(!deflate.write(filtered))await once(deflate,'drain');
  }
  if(top%2048===0)console.log(JSON.stringify({renderedRows:top+rows,totalRows:size,rssMb:Math.round(process.memoryUsage().rss/1048576)}));
}
deflate.end();await compressed;file.end(chunk('IEND',Buffer.alloc(0)));await once(file,'finish');
const meta=await sharp(output,{limitInputPixels:size*size}).metadata();
if(meta.width!==size||meta.height!==size||!meta.hasAlpha||transparent===0||opaque===0||partial===0)throw new Error('Master export verification failed');
const hash=createHash('sha256');for await(const buffer of createReadStream(output))hash.update(buffer);
const reportPath='docs/logo-asset-verification-2026-10-29.json',report=JSON.parse(await readFile(reportPath,'utf8'));
report.master={status:'verified',path:output,width:meta.width,height:meta.height,channels:meta.channels,hasAlpha:meta.hasAlpha,bytes:(await stat(output)).size,sha256:hash.digest('hex'),pixels:{transparent,opaque,antialiased:partial},ink:'#626b7c',whiteRGBPixels:0,transparentRGBZero:true,bounds:{minX,minY,maxX,maxY},rendering:'256-row vector tiles and streaming PNG; visible/antialiased RGB is exact brand ink, zero-alpha RGB is normalized to zero'};
report.masterVerifiedAt=new Date().toISOString();await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.master));
