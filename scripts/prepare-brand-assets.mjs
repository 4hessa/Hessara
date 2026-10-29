import sharp from 'sharp';
import fs from 'node:fs/promises';

// Delivery preparation after the image-tool background extraction. Alpha is kept;
// RGB is normalized to the owner's exact single brand ink, never approximated.
sharp.cache(false);sharp.concurrency(1);
const input='public/brand/hessara-emblem-source.png';
const {width,height}=await sharp(input).metadata();
const alpha=await sharp(input).extractChannel('alpha').raw().toBuffer();
const master=await sharp({create:{width,height,channels:3,background:'#24292e'}}).joinChannel(alpha,{raw:{width,height,channels:1}}).png().toBuffer();
await fs.mkdir('outputs/brand',{recursive:true});
// Resampling premultiplied alpha can round RGB at translucent edges. Normalize
// after resizing; a three-band linear operation leaves the alpha band intact.
for(const size of [64,192,512])await sharp(master).resize(size,size,{fit:'contain'}).linear([0,0,0],[36,41,46]).png().toFile(`public/brand/hessara-emblem-${size}.png`);
await sharp(master).resize(16384,16384,{fit:'contain',kernel:'lanczos3'}).linear([0,0,0],[36,41,46]).png({compressionLevel:9}).toFile('outputs/brand/hessara-emblem-cinder-16k.png');
await fs.writeFile('outputs/brand/provenance.json',JSON.stringify({originalInput:'User-supplied 1254px emblem',extractedSource:{width,height},delivery:{width:16384,height:16384},ink:'#24292e',transparent:true,note:'16K is an enlarged delivery export; it does not create native 16K detail absent from the source. Web pages use the 512px variant.'},null,2));
console.log(JSON.stringify({source:{width,height},export:'16384 × 16384 transparent PNG',web:'64 / 192 / 512 px'}));
