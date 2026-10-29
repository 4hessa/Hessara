"""Offline encoder/decoder verification for the owned Manim scene; not a server endpoint."""
import hashlib,json,pathlib,subprocess,sys
import imageio_ffmpeg
import numpy as np
root=pathlib.Path.cwd()
source=root/'.vercel/science-render-env/renders/hessara-gradient-descent.mp4'
output=root/'public/science/gradient-descent.mp4'
poster=root/'public/science/gradient-descent-poster.webp'
evidence=root/'.vercel/science-render-env/evidence'
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
result=subprocess.run([ffmpeg,'-hide_banner','-y','-i',str(source),'-map','0:v:0','-an','-map_metadata','-1','-c:v','libx264','-crf','24','-preset','medium','-pix_fmt','yuv420p','-movflags','+faststart',str(output)],capture_output=True,text=True,timeout=90)
(evidence/'encode.log').write_text(result.stderr,encoding='utf-8')
if result.returncode:sys.exit(result.returncode)
probe=subprocess.run([ffmpeg,'-hide_banner','-i',str(output),'-f','null','-'],capture_output=True,text=True,timeout=90)
(evidence/'decode.log').write_text(probe.stderr,encoding='utf-8')
if probe.returncode or 'Audio:' in probe.stderr:raise RuntimeError('Decode failed or unexpected audio stream')
frames=imageio_ffmpeg.read_frames(str(output),pix_fmt='rgb24')
metadata=next(frames);first=None;last=None;count=0
for frame in frames:
 if first is None:first=np.frombuffer(frame,dtype=np.uint8).copy()
 last=np.frombuffer(frame,dtype=np.uint8).copy();count+=1
mae=float(np.abs(first.astype(float)-last.astype(float)).mean())
for name,ss in [('first',0),('middle',metadata['duration']/2),('last',max(0,metadata['duration']-1/metadata['fps']))]:
 path=evidence/(name+'.png')
 subprocess.run([ffmpeg,'-hide_banner','-y','-ss',str(ss),'-i',str(output),'-frames:v','1',str(path)],capture_output=True,check=True,timeout=30)
subprocess.run([ffmpeg,'-hide_banner','-y','-i',str(evidence/'first.png'),'-frames:v','1','-c:v','libwebp','-quality','85',str(poster)],capture_output=True,check=True,timeout=30)
report={'renderer':'3b1b ManimGL 1.7.2, isolated Python3.12.14, OpenGL330 Intel UHD','sourceScene':'scripts/science-render/gradient_descent.py','scientificScope':'Original computed scalar gradient descent; no provider training/telemetry. Return motion is interpolation, not an optimization step.','metadata':{key:metadata[key] for key in ['codec','pix_fmt','fps','size','source_size','duration'] if key in metadata},'decodedFrames':count,'silent':True,'firstLastRGBMeanAbsoluteDifference':mae,'loopCheckPass':mae<1,'files':[]}
for path in [output,poster]:report['files'].append({'path':path.relative_to(root).as_posix(),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
(root/'docs/advanced-science-film-verification-2026-10-25.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,indent=2))

