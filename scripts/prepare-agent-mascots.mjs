import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as zlib from 'node:zlib';

// Validate complete PNG containers without allocating a decoded 16K RGBA image.
const crcTable=new Uint32Array(256);
for(let value=0;value<256;value++){let crc=value;for(let bit=0;bit<8;bit++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;crcTable[value]=crc>>>0;}
const fallbackCrc32=bytes=>{let crc=0xffffffff;for(const value of bytes)crc=crcTable[(crc^value)&255]^(crc>>>8);return(crc^0xffffffff)>>>0;};
const checksum=bytes=>typeof zlib.crc32==='function'?zlib.crc32(bytes)>>>0:fallbackCrc32(bytes);
async function verifyPngContainer(file,{inflate=false}={}){
  const {createReadStream}=await import('node:fs');
  const hash=createHash('sha256');
  const signature=Buffer.from([137,80,78,71,13,10,26,10]);
  let pending=Buffer.alloc(0),signatureRead=false,ended=false,chunks=0,total=0,idatBytes=0,header=null,inflatedBytes=0,firstPixelAlpha=null;
  const inflater=inflate?zlib.createInflate():null;
  let finished;
  if(inflater){
    let prefix=Buffer.alloc(0);
    inflater.on('data',bytes=>{inflatedBytes+=bytes.length;if(prefix.length<5){prefix=Buffer.concat([prefix,bytes.subarray(0,5-prefix.length)]);if(prefix.length===5)firstPixelAlpha=prefix[4];}});
    finished=new Promise((resolve,reject)=>{inflater.once('end',resolve);inflater.once('error',reject);});
    finished.catch(()=>{}); // The write callbacks/final await propagate errors.
  }
  try{
    for await(const bytes of createReadStream(file,{highWaterMark:1024*1024})){
      total+=bytes.length;hash.update(bytes);pending=pending.length?Buffer.concat([pending,bytes]):bytes;
      if(!signatureRead){if(pending.length<8)continue;if(!pending.subarray(0,8).equals(signature))throw new Error('Invalid PNG signature: '+file);pending=pending.subarray(8);signatureRead=true;}
      while(pending.length>=12){
        if(ended)throw new Error('PNG contains bytes after IEND: '+file);
        const length=pending.readUInt32BE(0);
        if(length>16*1024*1024)throw new Error('Unexpected PNG chunk size: '+file);
        if(pending.length<length+12)break;
        const type=pending.toString('ascii',4,8),expected=pending.readUInt32BE(8+length),actual=checksum(pending.subarray(4,8+length));
        if(actual!==expected)throw new Error('PNG CRC failed for '+type+': '+file);
        chunks++;
        const payload=pending.subarray(8,8+length);
        if(chunks===1&&type!=='IHDR')throw new Error('PNG does not start with IHDR: '+file);
        if(type==='IHDR'){if(length!==13||header)throw new Error('Invalid PNG header: '+file);header={width:payload.readUInt32BE(0),height:payload.readUInt32BE(4),bitDepth:payload[8],colorType:payload[9],interlace:payload[12]};}
        if(type==='IDAT'){idatBytes+=length;if(inflater)await new Promise((resolve,reject)=>{inflater.write(payload,error=>error?reject(error):resolve());});}
        if(type==='IEND'){if(length!==0)throw new Error('Invalid PNG IEND: '+file);ended=true;}
        pending=pending.subarray(length+12);
      }
      if(ended&&pending.length)throw new Error('PNG contains trailing bytes: '+file);
    }
    if(!signatureRead||!header||!ended||pending.length||!idatBytes)throw new Error('Incomplete PNG container: '+file);
    if(header.bitDepth!==8||header.colorType!==6||header.interlace!==0)throw new Error('Expected noninterlaced 8-bit RGBA PNG: '+file);
    const result={complete:true,chunks,crcValid:true,iend:true,bytes:total,sha256:hash.digest('hex'),...header};
    if(inflater){
      inflater.end();await finished;
      const expectedScanlineBytes=header.height*(1+header.width*4);
      if(inflatedBytes!==expectedScanlineBytes)throw new Error('Incorrect PNG scanline payload: '+file);
      if(firstPixelAlpha!==0)throw new Error('Expected a transparent top-left border pixel: '+file);
      result.inflate={complete:true,expectedScanlineBytes,actualScanlineBytes:inflatedBytes,topLeftAlpha:firstPixelAlpha};
    }
    return result;
  }catch(error){inflater?.destroy();throw error;}
}
async function verifyMasterDelivery(){
  const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const manifestPath=path.join(repository,'outputs','mascots','provenance.json');
  const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  if(manifest.characters.length!==25||manifest.characters.some(character=>!character.master))throw new Error('All 25 completed masters are required before verification.');
  for(let index=0;index<manifest.characters.length;index++){
    const character=manifest.characters[index],master=character.master,file=path.resolve(repository,master.file);
    const permitted=path.join(repository,'outputs','mascots','16k')+path.sep;
    if(!file.startsWith(permitted))throw new Error('Unexpected master path.');
    const verified=await verifyPngContainer(file,{inflate:index===0});
    if(verified.sha256!==master.sha256||verified.bytes!==master.bytes||verified.width!==master.width||verified.height!==master.height)throw new Error('Master changed after generation: '+character.id);
    if(Math.max(verified.width,verified.height)!==16384)throw new Error('Master has no 16K long edge: '+character.id);
    master.pngVerification=verified;
    console.log(JSON.stringify({phase:'master-verified',id:character.id,chunks:verified.chunks,bytes:verified.bytes,pilotInflate:!!verified.inflate}));
  }
  manifest.verifiedAt=new Date().toISOString();
  manifest.verification={masterCount:25,completePngContainers:25,allChunkCrcChecksPassed:true,allIendPresent:true,pilotFullInflate:true};
  await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2));
  await fs.writeFile(path.join(repository,'docs','mascot-assets-verification.json'),JSON.stringify(manifest,null,2));
  const docFile=path.join(repository,'docs','mascot-assets-verification.md');
  const documentation=await fs.readFile(docFile,'utf8');
  await fs.writeFile(docFile,documentation+'\n## Complete master verification\n\nAll 25 PNG masters passed complete streaming chunk CRC, IEND, size, dimensions and SHA-256 checks. The first master also passed full streamed decompression of '+manifest.characters[0].master.pngVerification.inflate.actualScanlineBytes.toLocaleString('en-US')+' scanline bytes without allocating a full RGBA image. Its padded top-left alpha pixel is zero.\n');
  const rows=manifest.characters.map(character=>'| '+character.id+' | '+character.native.width+' × '+character.native.height+' | '+character.master.width+' × '+character.master.height+' | '+(character.master.bytes/1048576).toFixed(1)+' MiB | [PNG](16k/'+character.id+'-16k.png) |');
  await fs.writeFile(path.join(repository,'outputs','mascots','README.md'),[
    '# HESSARA mascot delivery','',
    '25 separate transparent characters. Web cards use the optimized 512 × 640 WebP variants in public/mascots; the complete source sheet is never used as a card image.','',
    '**16K is an upscaled delivery export, not native 16K detail.** The source column below shows actual extracted raster dimensions. Appearance and texture can vary slightly after the image-tool background extraction.','',
    '| Character | Source pixels | PNG export pixels | Size | Download |',
    '| --- | --- | --- | --- | --- |',...rows,'',
    'All master PNG containers were verified end to end with CRC/IEND/dimensions/size/SHA-256. The first master was also fully decompressed as a streaming check.','',
    'See imagegen-provenance.json for the exact edit prompt, provenance.json for detailed checks, and sources/ for native transparent cutouts.','',
    'These are flat raster assets without independent eyes, mouth or limb layers. Whole-character motion is supported; articulated animation requires production rigs.',''
  ].join('\n'));
}
if(process.argv.includes('--verify-only')){await verifyMasterDelivery();process.exit(0);}


// Mechanical delivery preparation after the built-in image tool removed the
// backdrop. This does not redraw characters or manufacture articulated rigs.
sharp.concurrency(1);
sharp.cache({memory:32, files:0, items:20});
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args=new Set(process.argv.slice(2));
const pilot=args.has('--pilot');
const webOnly=args.has('--web-only');
const sourceArgument=process.argv.find(value=>value.startsWith('--source='));
const input=path.resolve(root,sourceArgument?.slice('--source='.length)??'outputs/mascots/reference-cutout-sheet.png');
const output=path.join(root,'outputs','mascots');
const webDirectory=path.join(root,'public','mascots');
const sourceDirectory=path.join(output,'sources');
const masterDirectory=path.join(output,'16k');
for(const directory of [output,webDirectory,sourceDirectory,masterDirectory])await fs.mkdir(directory,{recursive:true});
const sourceCopy=path.join(output,'reference-cutout-sheet.png');
if(input!==sourceCopy)await fs.copyFile(input,sourceCopy);
const sourceBytes=await fs.readFile(input);
const {data,info}=await sharp(sourceBytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
if(info.width!==1024||info.height!==1536||info.channels!==4)throw new Error('Expected the inspected 1024×1536 RGBA image-tool extraction.');
const width=info.width,height=info.height,pixels=width*height;
const coreLabels=new Int32Array(pixels),queue=new Int32Array(pixels),components=[];
let componentId=0;
for(let at=0;at<pixels;at++){
  if(coreLabels[at]||data[at*4+3]<64)continue;
  const id=++componentId;
  let front=0,end=1;queue[0]=at;coreLabels[at]=id;
  let left=width,top=height,right=0,bottom=0;
  while(front<end){
    const current=queue[front++],x=current%width,y=Math.floor(current/width);
    left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
    const visit=next=>{if(!coreLabels[next]&&data[next*4+3]>=64){coreLabels[next]=id;queue[end++]=next;}};
    if(x)visit(current-1);if(x<width-1)visit(current+1);if(y)visit(current-width);if(y<height-1)visit(current+width);
  }
  components.push({id,area:end,left,top,width:right-left+1,height:bottom-top+1});
}
const rowOf=component=>component.top<400?0:component.top<695?1:component.top<980?2:component.top<1248?3:4;
const characters=components.filter(component=>component.area>300).sort((a,b)=>rowOf(a)-rowOf(b)||a.left-b.left);
if(characters.length!==33)throw new Error('Expected 33 distinct inspected characters; found '+characters.length+'.');
const stableLabel=new Int16Array(componentId+1).fill(-1);
characters.forEach((component,index)=>{stableLabel[component.id]=index;});
const owners=new Int16Array(pixels).fill(-1);
let front=0,end=0;
for(let at=0;at<pixels;at++){
  const label=stableLabel[coreLabels[at]];
  if(label>=0){owners[at]=label;queue[end++]=at;}
}
// Multi-source propagation assigns only already-present alpha pixels to their
// nearest connected core. Overlapping bounding boxes cannot leak a neighbour.
while(front<end){
  const current=queue[front++],x=current%width,y=Math.floor(current/width),label=owners[current];
  const visit=next=>{if(owners[next]<0&&data[next*4+3]>0){owners[next]=label;queue[end++]=next;}};
  if(x)visit(current-1);if(x<width-1)visit(current+1);if(y)visit(current-width);if(y<height-1)visit(current+width);
}
const bounds=characters.map(()=>({left:width,top:height,right:0,bottom:0,pixels:0}));
let unassignedAlphaPixels=0;
for(let at=0;at<pixels;at++){
  const owner=owners[at];
  if(owner<0){if(data[at*4+3])unassignedAlphaPixels++;continue;}
  const x=at%width,y=Math.floor(at/width),box=bounds[owner];
  box.left=Math.min(box.left,x);box.right=Math.max(box.right,x);box.top=Math.min(box.top,y);box.bottom=Math.max(box.bottom,y);box.pixels++;
}
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
async function inspect(file,{decodeAlpha=true}={}){
  const bytes=await fs.readFile(file),metadata=await sharp(bytes).metadata();
  const record={file:path.relative(root,file).replaceAll('\\','/'),bytes:bytes.length,sha256:sha256(bytes),width:metadata.width,height:metadata.height,hasAlpha:metadata.hasAlpha};
  if(decodeAlpha){
    const alpha=await sharp(bytes).ensureAlpha().extractChannel('alpha').raw().toBuffer();
    let min=255,max=0,transparent=0,borderClear=true;
    for(let at=0;at<alpha.length;at++){const value=alpha[at];min=Math.min(min,value);max=Math.max(max,value);if(value===0)transparent++;const x=at%metadata.width,y=Math.floor(at/metadata.width);if((x===0||x===metadata.width-1||y===0||y===metadata.height-1)&&value!==0)borderClear=false;}
    record.alpha={min,max,transparentPixels:transparent,borderClear};
    if(min!==0||max<240||!borderClear)throw new Error('Invalid transparent delivery: '+record.file);
  }
  return record;
}
let availableBytes=null;
try{const storage=await fs.statfs(root);availableBytes=Number(storage.bavail)*Number(storage.bsize);}catch{}
const manifest={createdAt:new Date().toISOString(),source:{file:'outputs/mascots/reference-cutout-sheet.png',width,height,sha256:sha256(sourceBytes),tool:'Built-in image_gen background-removal edit',original:'Owner-supplied 853×1280 contact sheet',detectedCharacters:characters.length,selectedCharacters:25,coreAlphaThreshold:64,minimumCorePixels:301,unassignedAlphaPixels},method:'Connected alpha cores, multi-source propagation through existing alpha, isolated RGBA cutout and 8px transparent padding. Original extracted RGB/alpha retained for assigned pixels; no new eyes or body parts.',limitations:['Image-tool extraction can change fine textures and details; it is not a lossless separation of the original raster.','16K means an interpolated PNG export with a 16,384px long edge, not native 16K source detail. Individual extracted characters contain approximately 100–300px source dimensions.','No independent eyes, mouth, limbs or skeletal/Rive rig are present.'],availableBytesBefore:availableBytes,web:{format:'WebP',width:512,height:640,quality:88,alphaQuality:100},masters:{format:'PNG',longEdge:16384,fit:'inside',compressionLevel:3,publiclyServed:false},characters:[]};
let previousManifest=null; try{previousManifest=JSON.parse(await fs.readFile(path.join(output,'provenance.json'),'utf8'));}catch{}
const count=pilot?1:25;
for(let index=0;index<count;index++){
  const name='mascot-'+String(index+1).padStart(2,'0'),box=bounds[index],padding=8;
  const nativeWidth=box.right-box.left+1+padding*2,nativeHeight=box.bottom-box.top+1+padding*2;
  const isolated=Buffer.alloc(nativeWidth*nativeHeight*4);
  for(let y=box.top;y<=box.bottom;y++)for(let x=box.left;x<=box.right;x++){
    const at=y*width+x;if(owners[at]!==index)continue;
    const destination=((y-box.top+padding)*nativeWidth+x-box.left+padding)*4;
    data.copy(isolated,destination,at*4,at*4+4);
  }
  const native=path.join(sourceDirectory,name+'.png'),web=path.join(webDirectory,name+'.webp'),master=path.join(masterDirectory,name+'-16k.png');
  await sharp(isolated,{raw:{width:nativeWidth,height:nativeHeight,channels:4}}).png({compressionLevel:6}).toFile(native);
  await sharp(native).resize(512,640,{fit:'contain',background:{r:0,g:0,b:0,alpha:0},kernel:'lanczos3'}).webp({quality:88,alphaQuality:100,effort:4,smartSubsample:true}).toFile(web);
  const record={id:name,sheetRow:rowOf(characters[index])+1,sheetCore:characters[index],assignedAlphaPixels:box.pixels,native:await inspect(native),web:await inspect(web)};
  if(!webOnly){
    const started=performance.now();
    const previous=previousManifest?.source?.sha256===manifest.source.sha256?previousManifest.characters?.find(character=>character.id===name):null;
    let reused=false;
    if(args.has('--resume')&&previous?.native?.sha256===record.native.sha256&&previous?.master){
      try{
        const verified=await verifyPngContainer(master);
        if(verified.sha256===previous.master.sha256&&verified.bytes===previous.master.bytes&&Math.max(verified.width,verified.height)===16384){
          record.master={...previous.master,pngVerification:verified,reused:true};reused=true;
        }
      }catch{/* A missing, truncated or mismatched master is regenerated. */}
    }
    if(!reused){
      console.log(JSON.stringify({phase:'master-start',id:name,native:[nativeWidth,nativeHeight],rssBytes:process.memoryUsage().rss}));
      const temporary=path.join(masterDirectory,name+'-16k.partial.png');
      await sharp(native).resize(16384,16384,{fit:'inside',kernel:'lanczos3'}).png({compressionLevel:3,adaptiveFiltering:false}).toFile(temporary);
      const verified=await verifyPngContainer(temporary);
      if(Math.max(verified.width,verified.height)!==16384)throw new Error('Invalid 16K master '+name);
      await fs.rename(temporary,master);
      record.master={file:path.relative(root,master).replaceAll('\\','/'),bytes:verified.bytes,sha256:verified.sha256,width:verified.width,height:verified.height,hasAlpha:true,pngVerification:verified};
    }
    record.master.elapsedMs=Math.round(performance.now()-started);
    console.log(JSON.stringify({phase:reused?'master-reused':'master-complete',id:name,width:record.master.width,height:record.master.height,bytes:record.master.bytes,elapsedMs:record.master.elapsedMs,rssBytes:process.memoryUsage().rss}));
  }
  manifest.characters.push(record);
  await fs.writeFile(path.join(output,pilot?'pilot-provenance.json':'provenance.json'),JSON.stringify(manifest,null,2));
}
if(!pilot){
  await fs.writeFile(path.join(root,'docs','mascot-assets-verification.json'),JSON.stringify(manifest,null,2));
  const webBytes=manifest.characters.reduce((total,character)=>total+character.web.bytes,0),masterBytes=manifest.characters.reduce((total,character)=>total+(character.master?.bytes??0),0);
  const documentation=[
    '# Super Agent mascot asset delivery','',
    'Prepared '+count+' different transparent character cutouts from the owner’s contact sheet after built-in image-tool background extraction. The complete sheet is an intermediate source only; the application references individual WebP files.','',
    '- Web: 512 × 640 transparent WebP per character; '+webBytes.toLocaleString('en-US')+' bytes total.',
    '- Sources: individual native transparent PNG cutouts, original extracted RGB/alpha preserved.',
    '- Masters: '+(webOnly?'not generated in this web-only run':count+' transparent PNG exports with a 16,384px long edge, '+masterBytes.toLocaleString('en-US')+' bytes total')+'; outside public application assets.',
    '- Every source and WebP was decoded, checked for meaningful alpha and a completely transparent border. Each master was checked for actual dimensions, alpha support, file size and SHA-256.','',
    'The 16K masters are upscaled delivery files, not native 16K source detail. The supplied sheet has 853 × 1280 pixels, and the image-tool intermediate has 1024 × 1536 pixels shared across 33 characters. Individual source detail is much smaller. Image-tool extraction can change fine details; it is not a lossless separation.','',
    'These raster cutouts have no articulated layers or rigs. Whole-character motion is supported; genuine independent eye, mouth and limb animation needs layered or rigged production assets.','',
    'Reproduce from the repository root:','',
    '    node scripts/prepare-agent-mascots.mjs','',
    'Use --pilot for one full master or --web-only for web delivery without large PNG masters. The process uses one Sharp thread and a 32MB image cache; exports are sequential.',''
  ].join('\n');
  await fs.writeFile(path.join(root,'docs','mascot-assets-verification.md'),documentation);
}
console.log(JSON.stringify({complete:true,pilot,webOnly,count,webBytes:manifest.characters.reduce((total,character)=>total+character.web.bytes,0),masterBytes:manifest.characters.reduce((total,character)=>total+(character.master?.bytes??0),0)}));



