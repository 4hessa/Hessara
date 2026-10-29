import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mkdtemp,readFile,writeFile,stat,mkdir,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
sharp.cache(false);sharp.concurrency(1);
const root=process.cwd(),dir=await mkdtemp(path.join(root,'.science-export-test-')),out=path.join(root,'outputs/scientific-art');
await mkdir(out,{recursive:true});
const manifest=[];
const paletteCSS=await readFile(path.join(root,'app/design-system.css'),'utf8');
const palette=Object.fromEntries([...paletteCSS.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([,name,value])=>[name,value.trim()]));
function resolveColors(value,depth=0){if(depth>8)throw new Error('Circular palette reference');return value.replace(/var\((--[\w-]+)\)/g,(_,name)=>{if(!palette[name])throw new Error('Missing palette '+name);return resolveColors(palette[name],depth+1);});}
try{
 const built=await build({absWorkingDir:root,stdin:{contents:"export {ScientificVisual} from './app/scientific-visual';",resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',packages:'external',jsx:'automatic',loader:{'.css':'empty'},tsconfig:path.join(root,'tsconfig.json')});
 const file=path.join(dir,'visual.mjs');await writeFile(file,built.outputFiles[0].text);
 const {ScientificVisual}=await import(pathToFileURL(file).href);
 for(const kind of ['network','attention','language','embedding']){
  const markup=renderToStaticMarkup(React.createElement(ScientificVisual,{kind,locale:'en',motionPaused:true}));
  let svg=markup.match(/<svg[\s\S]*?<\/svg>/)?.[0];if(!svg)throw new Error('Missing SVG '+kind);
  svg=resolveColors(svg);
  // CSS pulses are optional overlays. Preserve the fully lit static baseline.
  svg=svg.replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="920" ').replace('<defs>','<style>.science-transmission{opacity:0}.science-node-activation{opacity:.2}</style><defs>');
  await writeFile(path.join(out,`${kind}.svg`),svg);
  const poster=path.join(out,`${kind}-poster.webp`);await sharp(Buffer.from(svg)).webp({quality:92}).toFile(poster);
  const entry={kind,source:`${kind}.svg`,sourceViewBox:[700,460],poster:{file:`${kind}-poster.webp`,width:1400,height:920,bytes:(await stat(poster)).size}};
  if(process.argv.includes('--master')){
   // Render original paths at target pixels, with generous landscape framing.
   const body=svg.replace(/<svg[^>]*>/,'').replace(/<\/svg>$/,'');
   const source=`<svg xmlns="http://www.w3.org/2000/svg" width="15360" height="8640" viewBox="0 0 817.777778 460"><rect width="817.777778" height="460" fill="${resolveColors(palette['--overview-art'])}"/><g transform="translate(58.888889 0)">${body}</g></svg>`;
   const master=path.join(out,`${kind}-15360x8640.png`);
   await writeFile(path.join(out,`${kind}-master.svg`),source);
   await sharp(Buffer.from(source),{limitInputPixels:160000000}).png({compressionLevel:6,adaptiveFiltering:true}).toFile(master);
   const meta=await sharp(master,{limitInputPixels:160000000}).metadata();entry.master={file:path.basename(master),width:meta.width,height:meta.height,bytes:(await stat(master)).size,method:'Direct original vector render; no raster enlargement. Conceptual illustration, not live model data.'};
  }
  manifest.push(entry);console.log(JSON.stringify(entry));
 }
 await writeFile(path.join(out,'scientific-plates.json'),JSON.stringify(manifest,null,2)+'\n');
 await writeFile(path.join(out,'README.md'),'# Original scientific artwork\n\nSources are original SVG geometry authored in app/scientific-visual.tsx and scripts/render-intelligence-art.mjs. PNG masters render these vectors directly at 15360×8640; they are not raster upscales. Master framing is landscape; web geometry adapts to each component. No model weights, live telemetry or exact Hessara model architecture are depicted. Web pages render inline SVG, not these 16K files. Authentication has no artwork. Historical identity/auth masters are not current page assets.\n\nRegenerate identity: node scripts/render-intelligence-art.mjs --master\nRegenerate plates: node scripts/export-scientific-plates.mjs --master\n\nSee manifest.json and scientific-plates.json for actual dimensions and byte sizes.\n');
}finally{await rm(dir,{recursive:true,force:true});}

