/**
 * HESSARA / Neural field, an original periodic mathematical composition.
 * No stock footage, external artwork, text, metrics, or generative model output.
 *
 * Requires existing `sharp` and an FFmpeg executable. The encoder is an offline
 * build tool, never a shipped application dependency. Run with FFMPEG_BIN or:
 *   npm install --prefix .vercel/media-tools --no-audit --no-fund ffmpeg-static@5.3.0
 *   node scripts/render-neural-film.mjs
 *
 * All time-dependent terms use integer multiples of 2π * frame / frameCount.
 * Frame 192 is identical to frame 0; it is intentionally omitted from the film.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const width = 960;
const height = 600;
const fps = 24;
const seconds = 8;
const frameCount = fps * seconds;
const tau = Math.PI * 2;
const target = path.join(root, 'public', 'media');
const colors = ['#8a9cdd', '#acc8ed', '#ddbc88', '#b9b4df'];
sharp.cache(false);
sharp.concurrency(1);

function point(theta, phi, time) {
  // Shape deformation changes the surface itself rather than rotating a still.
  const major = 170 + 17 * Math.sin(theta * 3 + time) + 9 * Math.cos(theta * 2 - time * 2);
  const minor = 47 + 10 * Math.sin(theta * 2 - time + phi);
  const radius = major + minor * Math.cos(phi);
  const x = radius * Math.cos(theta);
  const y = radius * Math.sin(theta);
  const z = minor * Math.sin(phi) + 29 * Math.sin(theta * 2 + time);
  const tilt = 1.02;
  const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
  const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
  const angle = -.28;
  const x2 = x * Math.cos(angle) - y2 * Math.sin(angle);
  const y3 = x * Math.sin(angle) + y2 * Math.cos(angle);
  const perspective = 800 / (800 - z2);
  return { x: width / 2 + x2 * perspective * 1.53, y: height / 2 + y3 * perspective * 1.53, z: z2 };
}

const fmt = (value) => value.toFixed(2);

export function frameSvg(frame) {
  const time = tau * frame / frameCount;
  const ribbons = [];
  const points = [];
  for (let layer = 0; layer < 26; layer++) {
    const phi = tau * layer / 26;
    const samples = [];
    let depth = 0;
    for (let index = 0; index <= 144; index++) {
      const theta = tau * index / 144;
      const sample = point(theta, phi, time);
      samples.push(`${index === 0 ? 'M' : 'L'}${fmt(sample.x)} ${fmt(sample.y)}`);
      depth += sample.z;
      if (index < 144 && index % 12 === layer % 12) {
        points.push({ ...sample, layer, index });
      }
    }
    ribbons.push({ d: samples.join(' '), z: depth / 145, layer });
  }
  ribbons.sort((a, b) => a.z - b.z);
  const curves = ribbons.map(({ d, layer }) => `<path d="${d}" fill="none" stroke="${colors[layer % colors.length]}" stroke-width="${layer % 7 === 0 ? 1.5 : .65}" opacity="${layer % 7 === 0 ? .82 : .33}"/>`).join('');
  const meridians = Array.from({ length: 36 }, (_, segment) => {
    const theta = tau * segment / 36;
    const samples = [];
    for (let index = 0; index <= 40; index++) {
      const p = point(theta, tau * index / 40, time);
      samples.push(`${index === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`);
    }
    return `<path d="${samples.join(' ')}" fill="none" stroke="#b5c8e5" stroke-width=".5" opacity=".13"/>`;
  }).join('');
  const nodes = points.sort((a, b) => a.z - b.z).map((p) => {
    const pulse = .6 + .4 * Math.sin(time * 2 + p.index * .17 + p.layer);
    const opacity = .22 + ((p.z + 230) / 460) * .6;
    return `<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${fmt(.55 + pulse * 1.35)}" fill="${colors[p.layer % colors.length]}" opacity="${fmt(opacity)}"/>`;
  }).join('');
  const signals = Array.from({ length: 12 }, (_, index) => {
    const phi = tau * index / 12;
    const theta = time + tau * index / 12;
    const trail = Array.from({ length: 22 }, (_, step) => {
      const p = point(theta - step * .012, phi, time);
      return `${step === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`;
    }).join(' ');
    const p = point(theta, phi, time);
    return `<path d="${trail}" fill="none" stroke="${colors[index % 4]}" stroke-width="1.9" opacity=".75"/><circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="2.3" fill="#edf2ff"/><circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="6" fill="${colors[index % 4]}" opacity=".15"/>`;
  }).join('');
  const dust = Array.from({ length: 46 }, (_, index) => {
    const phase = index * 2.39996;
    const x = 480 + Math.cos(phase) * (280 + index * 2.8) + Math.sin(time + phase) * 5;
    const y = 300 + Math.sin(phase) * (160 + index * 1.4) + Math.cos(time + phase) * 5;
    return `<circle cx="${fmt(x)}" cy="${fmt(y)}" r=".65" fill="#b8cbe2" opacity="${fmt(.1 + .1 * Math.sin(time + phase))}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <radialGradient id="background"><stop stop-color="#20283b"/><stop offset="1" stop-color="#10151f"/></radialGradient>
      <radialGradient id="violet"><stop stop-color="#7c6ba6" stop-opacity=".19"/><stop offset="1" stop-color="#7c6ba6" stop-opacity="0"/></radialGradient>
      <radialGradient id="ice"><stop stop-color="#8dacc9" stop-opacity=".13"/><stop offset="1" stop-color="#8dacc9" stop-opacity="0"/></radialGradient>
      <filter id="soft"><feGaussianBlur stdDeviation="9"/></filter>
    </defs>
    <rect width="960" height="600" fill="url(#background)"/>
    <ellipse cx="${fmt(400 + Math.sin(time) * 35)}" cy="270" rx="330" ry="230" fill="url(#violet)"/>
    <ellipse cx="600" cy="${fmt(350 + Math.cos(time) * 25)}" rx="310" ry="220" fill="url(#ice)"/>
    <g>${dust}</g><g filter="url(#soft)" opacity=".25">${curves}</g>
    <g>${meridians}${curves}${nodes}${signals}</g>
  </svg>`;
}

async function render() {
  const ffmpeg = process.env.FFMPEG_BIN || require(path.join(root, '.vercel', 'media-tools', 'node_modules', 'ffmpeg-static'));
  await mkdir(target, { recursive: true });
  const videoPath = path.join(target, 'neural-field.mp4');
  const posterPath = path.join(target, 'neural-field-poster.webp');
  const processEncoder = spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'warning', '-y',
    '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${width}x${height}`,
    '-framerate', String(fps), '-i', 'pipe:0', '-an',
    '-c:v', 'libx264', '-threads', '1', '-preset', 'slow', '-crf', '24',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-metadata', 'title=HESSARA - Neural field',
    '-metadata', 'comment=Original periodic procedural artwork. No third-party footage.',
    videoPath,
  ], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  processEncoder.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const finished = once(processEncoder, 'close');
  for (let frame = 0; frame < frameCount; frame++) {
    const svg = Buffer.from(frameSvg(frame));
    if (frame === 0) await sharp(svg).webp({ quality: 90 }).toFile(posterPath);
    const pixels = await sharp(svg).flatten({ background: '#10151f' }).removeAlpha().raw().toBuffer();
    if (!processEncoder.stdin.write(pixels)) await once(processEncoder.stdin, 'drain');
    if (frame % fps === 0) console.log(`Rendered ${frame}/${frameCount} frames`);
  }
  processEncoder.stdin.end();
  const [exitCode] = await finished;
  if (exitCode !== 0) throw new Error(`FFmpeg failed (${exitCode}): ${stderr}`);
  const seam = frameSvg(0) === frameSvg(frameCount);
  // Float roundoff at sin(2π) can stringify -0.00; compare actual raster output.
  const first = await sharp(Buffer.from(frameSvg(0))).removeAlpha().raw().toBuffer();
  const end = await sharp(Buffer.from(frameSvg(frameCount))).removeAlpha().raw().toBuffer();
  let maxDifference = 0;
  let totalDifference = 0;
  for (let index = 0; index < first.length; index++) {
    const difference = Math.abs(first[index] - end[index]);
    totalDifference += difference;
    maxDifference = Math.max(maxDifference, difference);
  }
  const metadata = {
    width, height, fps, seconds, frameCount, audio: false, codec: 'H.264', pixelFormat: 'yuv420p',
    provenance: 'Original mathematical artwork generated by scripts/render-neural-film.mjs; no third-party media.',
    seam: { identicalSvg: seam, maxPixelDifference: maxDifference, meanPixelDifference: totalDifference / first.length },
    sharpVersion: sharp.versions.sharp,
  };
  await writeFile(path.join(target, 'neural-field.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(JSON.stringify({ videoPath, posterPath, ...metadata }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  render().catch((error) => { console.error(error); process.exitCode = 1; });
}
