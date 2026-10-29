import { readFile, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createInflate } from 'node:zlib';
import sharp from 'sharp';
const reportPath='docs/logo-asset-verification-2026-10-29.json',report=JSON.parse(await readFile(reportPath,'utf8'));
const bytes=await readFile(report.master.path),idat=[];
const table=Array.from({length:256},(_,i)=>{let c=i;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(data){let c=0xffffffff;for(const b of data)c=table[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Invalid PNG signature');
for(let at=8;at<bytes.length;){const length=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,at+8+length),crc=bytes.readUInt32BE(at+8+length);if(crc32(bytes.subarray(at+4,at+8+length))!==crc)throw new Error('Invalid PNG CRC');if(type==='IHDR'&&(data.readUInt32BE(0)!==15360||data.readUInt32BE(4)!==15360||data[8]!==8||data[9]!==6))throw new Error('Wrong PNG dimensions/color mode');if(type==='IDAT')idat.push(data);at+=length+12;}
const size=15360,stride=1+4*size,previewSize=1024,preview=Buffer.alloc(previewSize*previewSize*4);
let pending=Buffer.alloc(0),row=0,transparent=0,opaque=0,partial=0;
const stream=Readable.from([Buffer.concat(idat)]).pipe(createInflate());
for await(const buffer of stream){pending=Buffer.concat([pending,buffer]);while(pending.length>=stride){const line=pending.subarray(0,stride);if(line[0]!==1)throw new Error('Unexpected PNG filter');let alpha=0,r=0,g=0,b=0;const previewRow=row%15===0;
  for(let col=0;col<size;col++){const i=1+col*4;r=(r+line[i])&255;g=(g+line[i+1])&255;b=(b+line[i+2])&255;alpha=(alpha+line[i+3])&255;if(r!==(alpha?98:0)||g!==(alpha?107:0)||b!==(alpha?124:0))throw new Error('Master RGB differs from normalized Slate ink');if(!alpha)transparent++;else if(alpha===255)opaque++;else partial++;if(previewRow&&col%15===0){const p=((row/15)*previewSize+col/15)*4;preview[p]=r;preview[p+1]=g;preview[p+2]=b;preview[p+3]=alpha;}}
  row++;pending=pending.subarray(stride);
}}
if(row!==size||pending.length||transparent!==report.master.pixels.transparent||opaque!==report.master.pixels.opaque||partial!==report.master.pixels.antialiased)throw new Error('Decoded pixel counts differ');
sharp.cache(false);sharp.concurrency(1);await sharp(preview,{raw:{width:previewSize,height:previewSize,channels:4}}).png().toFile('outputs/branding/hessara-monogram-master-preview.png');
report.master.independentPNGDecode={passed:true,crcValid:true,decodedRows:row,pixelCountsMatch:true,allVisibleRGBExactInk:true,transparentRGBZero:true,whiteRGBPixels:0,preview:'outputs/branding/hessara-monogram-master-preview.png',checkedAt:new Date().toISOString()};
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.master.independentPNGDecode));
