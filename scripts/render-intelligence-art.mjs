import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Original resolution-independent geometry. This is conceptual art, not a model trace.
sharp.cache(false); sharp.concurrency(1);
const root=process.cwd(), web=path.join(root,'public/media'), masters=path.join(root,'outputs/scientific-art');
const n=x=>Number(x.toFixed(2));
const p=(x,y,z)=>[n(800+(x-y)*1.16),n(680+(x+y)*.43-z)];
const poly=a=>a.map(q=>q.join(',')).join(' ');
const line=(a,b,attrs='')=>`<path d="M${a.join(' ')}L${b.join(' ')}" ${attrs}/>`;
const planes=[],edges=[],nodes=[],signals=[];
for(let layer=0;layer<6;layer++){
 const z=layer*78;
 planes.push(`<polygon points="${poly([[-240,-240],[240,-240],[240,240],[-240,240]].map(([x,y])=>p(x,y,z)))}" fill="url(#plane)" stroke="#C7D9E5" stroke-opacity="${n(.17+layer*.025)}" stroke-width="1.3"/>`);
 for(let i=1;i<8;i++){
  const d=-240+i*60;
  planes.push(line(p(-240,d,z),p(240,d,z),'stroke="#ABBAC5" stroke-opacity=".09"'));
  planes.push(line(p(d,-240,z),p(d,240,z),'stroke="#ABBAC5" stroke-opacity=".09"'));
 }
 for(let row=0;row<4;row++)for(let col=0;col<4;col++){
  const x=-180+col*120,y=-180+row*120,q=p(x,y,z);
  nodes.push(`<circle cx="${q[0]}" cy="${q[1]}" r="${layer===5?4.8:3.3}" fill="${(row+col+layer)%4===0?'#F2E7D5':'#C7D9E5'}" fill-opacity="${n(.4+layer*.09)}"/>`);
  if(layer<5&&(row+col)%2===0)edges.push(line(q,p(x+(col%2===0?60:-60),y,z+78),'stroke="#C7D9E5" stroke-opacity=".19" stroke-width="1.2"'));
 }
 const trace=[p(-180,180,z),p(-60,180,z),p(-60,60,z),p(60,60,z),p(60,-60,z),p(180,-60,z)];
 signals.push(`<polyline points="${poly(trace)}" stroke="url(#signal)" stroke-width="2.5" stroke-linejoin="round"/>`);
 if(layer<5)signals.push(line(trace.at(-1),p(180,-60,z+78),'stroke="#C7D9E5" stroke-opacity=".55" stroke-width="1.6"'));
}
const ribbons=Array.from({length:3},(_,head)=>{const o=head*35;return `<path d="M${335+o} 850C${140+o} 480 ${340+o} 150 800 120C${1240-o} 150 ${1460-o} 490 ${1265-o} 850" stroke="url(#ribbon)" stroke-width="${head===0?1.6:.9}" opacity="${.32-head*.065}"/>`;}).join('');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="0 0 1600 1200" fill="none"><defs>
<radialGradient id="background" cx="50%" cy="35%" r="75%"><stop stop-color="#334452"/><stop offset=".55" stop-color="#202B34"/><stop offset="1" stop-color="#141C23"/></radialGradient>
<linearGradient id="plane" x1="300" y1="200" x2="1200" y2="900" gradientUnits="userSpaceOnUse"><stop stop-color="#C7D9E5" stop-opacity=".085"/><stop offset=".5" stop-color="#ABBAC5" stop-opacity=".025"/><stop offset="1" stop-color="#C7D9E5" stop-opacity=".13"/></linearGradient>
<linearGradient id="signal" x1="500" y1="200" x2="1100" y2="850" gradientUnits="userSpaceOnUse"><stop stop-color="#F2E7D5" stop-opacity=".3"/><stop offset=".5" stop-color="#D7EBF6"/><stop offset="1" stop-color="#ABBAC5" stop-opacity=".4"/></linearGradient>
<linearGradient id="ribbon" x1="800" y1="100" x2="800" y2="900" gradientUnits="userSpaceOnUse"><stop stop-color="#D2E5F1"/><stop offset="1" stop-color="#C7D9E5" stop-opacity="0"/></linearGradient>
<radialGradient id="floor"><stop stop-color="#A9CDDF" stop-opacity=".15"/><stop offset="1" stop-color="#A9CDDF" stop-opacity="0"/></radialGradient>
<pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse"><circle cx="25" cy="25" r=".8" fill="#C7D9E5" opacity=".16"/></pattern></defs>
<rect width="1600" height="1200" fill="url(#background)"/><rect width="1600" height="1200" fill="url(#grid)"/>
<ellipse cx="800" cy="995" rx="650" ry="150" fill="url(#floor)"/>${ribbons}
<g>${planes.join('')}${edges.join('')}${signals.join('')}${nodes.join('')}</g>
<path d="M170 1010H1430M800 950V1070" stroke="#C7D9E5" stroke-opacity=".11"/>
<g stroke="#C7D9E5" stroke-opacity=".3"><path d="M105 130h20m-10-10v20M1475 1060h20m-10-10v20"/></g></svg>`;
await fs.mkdir(web,{recursive:true});await fs.mkdir(masters,{recursive:true});
await fs.writeFile(path.join(web,'intelligence-architecture.svg'),svg);
await sharp(Buffer.from(svg)).webp({quality:90}).toFile(path.join(web,'intelligence-architecture.webp'));
const manifest={created:'2026-10-24',source:'Original procedural vector geometry: six perspective computational planes, directed lattice paths and three attention-inspired ribbons.',conceptual:true,containsModelWeights:false,sourceViewBox:[1600,1200],web:[]};
for(const name of ['intelligence-architecture.svg','intelligence-architecture.webp'])manifest.web.push({file:`public/media/${name}`,bytes:(await fs.stat(path.join(web,name))).size});
if(process.argv.includes('--master')){
 const inner=svg.replace(/<svg[^>]*>/,'').replace(/<\/svg>$/,'');
 const landscape=`<svg xmlns="http://www.w3.org/2000/svg" width="15360" height="8640" viewBox="0 0 2133.333333 1200"><rect width="2133.333333" height="1200" fill="#18232C"/><g transform="translate(266.666667 0)">${inner}</g></svg>`;
 const file=path.join(masters,'intelligence-architecture-15360x8640.png');
 await fs.writeFile(path.join(masters,'intelligence-architecture-master.svg'),landscape);
 await sharp(Buffer.from(landscape),{limitInputPixels:160000000}).png({compressionLevel:6,adaptiveFiltering:true}).toFile(file);
 const meta=await sharp(file,{limitInputPixels:160000000}).metadata();
 manifest.master={file:path.relative(root,file).replaceAll('\\','/'),width:meta.width,height:meta.height,bytes:(await fs.stat(file)).size,method:'Original vectors rendered directly at target size; not a raster upscale. Landscape framing differs from 4:3 web artwork.'};
}
await fs.writeFile(path.join(masters,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
