import sharp from 'sharp';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Deterministic, non-generative silhouette vectorization of the supplied mark.
// No geometry is invented. Marching squares interpolates the 50% ink contour;
// cubic fitting stays within 0.18 source pixels of the sampled contour.
sharp.cache(false); sharp.concurrency(1);
const source = process.argv[2] ?? 'outputs/branding/hessara-monogram-source.png';
const out = 'public/brand', archive = 'outputs/branding';
const ink = { r: 98, g: 107, b: 124 };
await mkdir(out, { recursive: true }); await mkdir(archive, { recursive: true });
if (source !== archive + '/hessara-monogram-source.png') await copyFile(source, archive + '/hessara-monogram-source.png');
const original = await readFile(source);
const { data, info } = await sharp(original).greyscale().removeAlpha().raw().toBuffer({ resolveWithObject: true });
const width = info.width + 2, height = info.height + 2;
const alpha = new Uint8Array(width * height);
// Use 50% luminance, not an arbitrary manual crop or reconstructed symbol.
for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) alpha[(y + 1) * width + x + 1] = 255 - data[y * info.width + x];
const vertices = new Map(), adjacency = new Map(), threshold = 127.5;
const table = { 1:[[3,0]], 2:[[0,1]], 3:[[3,1]], 4:[[1,2]], 5:[[3,0],[1,2]], 6:[[0,2]], 7:[[3,2]], 8:[[2,3]], 9:[[0,2]], 10:[[0,1],[2,3]], 11:[[1,2]], 12:[[1,3]], 13:[[0,1]], 14:[[3,0]] };
for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
  const values = [alpha[y * width + x], alpha[y * width + x + 1], alpha[(y + 1) * width + x + 1], alpha[(y + 1) * width + x]];
  const code = values.reduce((n,v,i) => n | (v > threshold ? 1 << i : 0), 0);
  if (!table[code]) continue;
  const edges = [ [[x,y],[x+1,y],0,1,`h${x},${y}`], [[x+1,y],[x+1,y+1],1,2,`v${x+1},${y}`], [[x,y+1],[x+1,y+1],3,2,`h${x},${y+1}`], [[x,y],[x,y+1],0,3,`v${x},${y}`] ];
  for (const pair of table[code]) {
    const ids = pair.map(edge => {
      const [a,b,va,vb,id] = edges[edge];
      // Raster sample centers are x+.5/y+.5 in SVG canvas coordinates.
      if (!vertices.has(id)) { const t = (threshold - values[va]) / (values[vb] - values[va]); vertices.set(id, [a[0] + t * (b[0] - a[0]) - .5, a[1] + t * (b[1] - a[1]) - .5]); }
      return id;
    });
    for (const [a,b] of [[ids[0],ids[1]],[ids[1],ids[0]]]) { if (!adjacency.has(a)) adjacency.set(a, []); adjacency.get(a).push(b); }
  }
}
const seen = new Set(), loops = [];
for (const start of adjacency.keys()) {
  if (seen.has(start)) continue;
  const points = []; let previous = null, current = start;
  do { seen.add(current); points.push(vertices.get(current)); const next = adjacency.get(current).find(n => n !== previous); previous = current; current = next; } while (current && current !== start && !seen.has(current));
  if (current !== start) throw new Error('Open silhouette contour');
  const area = Math.abs(points.reduce((sum,p,i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
  if (area >= 1) loops.push({ points, area });
}
if (!loops.length) throw new Error('Logo contour missing');
const add=(a,b)=>[a[0]+b[0],a[1]+b[1]], sub=(a,b)=>[a[0]-b[0],a[1]-b[1]], mul=(a,n)=>[a[0]*n,a[1]*n], dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const length=a=>Math.hypot(...a), normalize=a=>mul(a,1/(length(a)||1));
const bezier=(b,t)=>add(add(mul(b[0],(1-t)**3),mul(b[1],3*t*(1-t)**2)),add(mul(b[2],3*t*t*(1-t)),mul(b[3],t**3)));
function generate(points,u,left,right) {
  const start=points[0],end=points.at(-1), C=[[0,0],[0,0]], X=[0,0];
  for (let i=0;i<points.length;i++) { const t=u[i], a=mul(left,3*t*(1-t)**2), b=mul(right,3*t*t*(1-t)); const residual=sub(points[i],add(mul(start,(1-t)**3+3*t*(1-t)**2),mul(end,t**3+3*t*t*(1-t)))); C[0][0]+=dot(a,a); C[0][1]+=dot(a,b); C[1][0]+=dot(a,b); C[1][1]+=dot(b,b); X[0]+=dot(a,residual); X[1]+=dot(b,residual); }
  const determinant=C[0][0]*C[1][1]-C[0][1]*C[1][0], distance=length(sub(end,start));
  let a=determinant ? (X[0]*C[1][1]-X[1]*C[0][1])/determinant : 0, b=determinant ? (C[0][0]*X[1]-C[1][0]*X[0])/determinant : 0;
  if (a < distance*1e-6 || b < distance*1e-6) a=b=distance/3;
  return [start,add(start,mul(left,a)),add(end,mul(right,b)),end];
}
function fit(points,left,right,error=0.18) {
  if (points.length===2) { const d=length(sub(points[1],points[0]))/3; return [[points[0],add(points[0],mul(left,d)),add(points[1],mul(right,d)),points[1]]]; }
  const u=[0]; for(let i=1;i<points.length;i++)u[i]=u[i-1]+length(sub(points[i],points[i-1])); for(let i=1;i<u.length;i++)u[i]/=u.at(-1);
  const curve=generate(points,u,left,right); let max=0,split=Math.floor(points.length/2);
  for(let i=1;i<points.length-1;i++){ const d=length(sub(bezier(curve,u[i]),points[i]));if(d>max){max=d;split=i;} }
  if(max<=error)return [curve];
  const center=normalize(sub(points[split-1],points[split+1]));
  return [...fit(points.slice(0,split+1),left,center,error),...fit(points.slice(split),mul(center,-1),right,error)];
}
let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
for(const {points}of loops)for(const [x,y]of points){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
const pad=2, box={x:minX-pad,y:minY-pad,width:maxX-minX+2*pad,height:maxY-minY+2*pad};
const fmt=n=>Number(n.toFixed(3)); let segments=0;
const paths=loops.map(({points})=>{
  // Quarter splits avoid treating an arbitrary contour seam as a corner.
  const cuts=[0,Math.floor(points.length/4),Math.floor(points.length/2),Math.floor(3*points.length/4),points.length]; const curves=[];
  for(let part=0;part<4;part++){const start=cuts[part],end=cuts[part+1],chunk=Array.from({length:end-start+1},(_,i)=>points[(start+i)%points.length]);const left=normalize(sub(points[(start+1)%points.length],points[(start-1+points.length)%points.length])),right=normalize(sub(points[(end-1+points.length)%points.length],points[(end+1)%points.length]));curves.push(...fit(chunk,left,right));}
  segments+=curves.length;
  return `M${points[0].map(fmt).join(' ')}${curves.map(c=>'C'+c.slice(1).flat().map(fmt).join(' ')).join('')}Z`;
});
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${Object.values(box).map(fmt).join(' ')}" color="#626b7c" fill="currentColor"><path fill-rule="evenodd" d="${paths.join('')}"/></svg>\n`;
await writeFile(out+'/hessara-monogram.svg',svg);
const webAssets=[];
for(const size of [64,192,512,1024]){
  const path=`${out}/hessara-monogram-${size}.png`;
  const prepared=await sharp(Buffer.from(svg),{density:300}).resize(size,size,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).ensureAlpha().raw().toBuffer();
  for(let i=0;i<prepared.length;i+=4){const visible=prepared[i+3]>0;prepared[i]=visible?ink.r:0;prepared[i+1]=visible?ink.g:0;prepared[i+2]=visible?ink.b:0;}
  await sharp(prepared,{raw:{width:size,height:size,channels:4}}).png({compressionLevel:9}).toFile(path);
  const bytes=await readFile(path),pixels=await sharp(bytes).ensureAlpha().raw().toBuffer();let transparent=0,partial=0,opaque=0,nonInkRGB=0;
  for(let i=0;i<pixels.length;i+=4){const a=pixels[i+3];if(a===0)transparent++;else if(a===255)opaque++;else partial++;if(a&&(pixels[i]!==ink.r||pixels[i+1]!==ink.g||pixels[i+2]!==ink.b))nonInkRGB++;}
  if(!transparent||!opaque||!partial||nonInkRGB)throw new Error('Web alpha/monochrome verification failed');
  webAssets.push({path,width:size,height:size,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),pixels:{transparent,opaque,antialiased:partial},visibleNonInkRGB:nonInkRGB,transparentRGBZero:true});
}
// Compare the reconstructed curve against the source's 50% foreground mask.
const validationSvg=svg.replace(/viewBox="[^"]+"/,`width="${info.width}" height="${info.height}" viewBox="0 0 ${info.width} ${info.height}"`);
const rendered=await sharp(Buffer.from(validationSvg)).ensureAlpha().raw().toBuffer();let intersection=0,union=0,mismatches=0,sourceArea=0;
let mismatchesBeyondOnePixelBoundary=0;
for(let i=0;i<data.length;i++){const a=data[i]<127.5,b=rendered[i*4+3]>=128;if(a)sourceArea++;if(a&&b)intersection++;if(a||b)union++;if(a!==b){mismatches++;const x=i%info.width,y=Math.floor(i/info.width);let boundary=false;for(let yy=Math.max(0,y-1);yy<=Math.min(info.height-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(info.width-1,x+1);xx++)if((data[yy*info.width+xx]<127.5)!==a)boundary=true;if(!boundary)mismatchesBeyondOnePixelBoundary++;}}
let previous;try{previous=JSON.parse(await readFile('docs/logo-asset-verification-2026-10-29.json','utf8'));}catch{/* First conversion. */}
const svgSha256=createHash('sha256').update(svg).digest('hex');
const report={createdAt:new Date().toISOString(),source:{file:'outputs/branding/hessara-monogram-source.png',width:info.width,height:info.height,sha256:createHash('sha256').update(original).digest('hex')},method:'Interpolated luminance marching-squares contour plus bounded cubic Bezier fitting; no generative redraw',threshold:127.5,curveFitToleranceSourcePixels:0.18,contours:loops.length,cubicSegments:segments,viewBox:box,sourceForegroundPixels:sourceArea,silhouetteIoU:intersection/union,sourceMaskMismatchedPixels:mismatches,mismatchesBeyondOnePixelBoundary,svgBytes:Buffer.byteLength(svg),svgSha256,ink:'#626b7c',web:{sizes:[64,192,512,1024],transparent:true,assets:webAssets},master:previous?.svgSha256===svgSha256?previous.master:{status:'pending-memory-slot',requiredWidth:15360,requiredHeight:15360},masterVerifiedAt:previous?.svgSha256===svgSha256?previous.masterVerifiedAt:undefined,limitation:'The source is a 1254px raster. SVG preserves the measured silhouette within subpixel tolerance; a 16K export does not recover details absent from the source.'};
await mkdir('docs',{recursive:true});await writeFile('docs/logo-asset-verification-2026-10-29.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
