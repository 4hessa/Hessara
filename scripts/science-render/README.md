# Offline science rendering

This directory contains an original Hessara teaching scene for **3b1b ManimGL**, separate from the Next.js production runtime. It makes no API request and reads no credentials. The authoring environment stays under ignored `.vercel/science-render-env/`; only the reviewed compressed film and poster are delivered as static frontend assets.

`descent_math.py` computes the example with Python's standard library. `gradient_descent.py` draws it using Pale `#ABBAC5`, Cinder `#24292E` and Slate `#626B7C`. `encode_video.py` encodes the owned scene, decodes every output frame, writes a poster and records media evidence. `requirements-render.txt` pins the 57 packages observed in the working isolated render environment.

## Scientific scope

The objective is `L(x) = 0.8*x^2 + 0.12`, with derivative `1.6*x`. The update is `x_next = x - 0.18 * gradient(x)`, starting at `x = 3.2`. Seven updates produce `x = 0.2968314638` and `L = 0.1904871343`; the true minimum is `x = 0`, `L = 0.12`. Seven updates do not reach that exact minimum.

This is a computed scalar example, not network training, model telemetry or benchmark data. Dots represent discrete optimizer states. The moving point interpolates `x` and recomputes `L(x)` to stay on the loss curve. The return motion resets the illustration for looping; it is **not another optimizer step**. Readouts change discretely after each update so character morphing does not imply intermediate numerical states. The tangent illustrates the derivative and axis arrows show parameter-update direction.

## Standard-library checks

From the repository root:

```powershell
python -B scripts/science-render/descent_math.py
```

This checks the analytic derivative against a central difference, each recurrence against `x_t = 3.2 * 0.712^t`, and decreasing loss. It neither imports ManimGL nor creates a graphics context. These numerical and syntax checks passed on Python 3.14.7 and 3.12.14.

## Working renderer and version boundary

The actual render used **ManimGL 1.7.2**, isolated **CPython 3.12.14**, a **ModernGL OpenGL 3.3 / 330 context on Intel UHD**, and the **FFmpeg 7.1** executable bundled with **imageio-ffmpeg 0.6.0**. The installed release imports `pkg_resources`, so its environment pins **setuptools 80.9.0**, below 81. It emits a deprecation warning; this is a compatibility pin for this authoring tool, not a frontend dependency. Ordinary `Text` avoids a LaTeX requirement.

The reviewed [ManimGL master revision](https://github.com/3b1b/manim/tree/fafa083a4fb274bba9cabde0b6e2f50ba6da0622) had WGPU/RenderCanvas source despite its README mentioning OpenGL. The working **PyPI 1.7.2 release has a different backend**. Do not treat success with 1.7.2 as verification of the newer master branch or Manim Community's separate `manim` package.

Initial default-TEMP installation encountered a Windows access-denied PE trampoline error. Repeating installation with an ordinary workspace-owned temporary/cache directory and a copied venv interpreter succeeded. No security ACL, antivirus, driver or machine policy was changed. Missing render dependencies at the initial inspection are historical findings, superseded by this isolated environment.

## Reproduction on a prepared Windows machine

Run from the repository root with CPython 3.12 available to the Python launcher. Use a fresh isolated environment; no global package installation is required. The commands below are the reproducible recipe, while the exact session's successful render and decode evidence are recorded separately.

```powershell
$repo = (Get-Location).Path
$renderRoot = Join-Path $repo '.vercel/science-render-env'
$ownedTemp = Join-Path $renderRoot 'temp'
$cache = Join-Path $renderRoot 'render-cache'
$renders = Join-Path $renderRoot 'renders'
$evidence = Join-Path $renderRoot 'evidence'
New-Item -ItemType Directory -Force -Path $renderRoot,$ownedTemp,$cache,$renders,$evidence,(Join-Path $repo 'public/science') | Out-Null

# These variables affect this shell and its child processes only.
$env:TEMP = $ownedTemp
$env:TMP = $ownedTemp
py -3.12 -m venv --copies (Join-Path $renderRoot 'venv')
$renderPython = Join-Path $renderRoot 'venv/Scripts/python.exe'
& $renderPython -m pip install --requirement scripts/science-render/requirements-render.txt
```

If using an existing uv-created environment that has no pip, the equivalent installer is optional:

```powershell
uv pip install --cache-dir (Join-Path $renderRoot 'uv-cache') --python $renderPython --requirement scripts/science-render/requirements-render.txt
```

Resolve the embedded encoder and write a local configuration. **Use numeric `camera.fps: 24` in YAML**: ManimGL 1.7.2's `--fps 24` CLI path leaves a string that causes division errors. The successful run used YAML, with no vendor-source patch.

```powershell
$ffmpeg = (& $renderPython -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())").Trim()
$yamlCache = $cache.Replace('\','/')
$yamlFfmpeg = $ffmpeg.Replace('\','/')
$config = Join-Path $renderRoot 'render-config.yml'
@"
directories:
  cache: '$yamlCache'
camera:
  fps: 24
  background_color: '#ABBAC5'
file_writer:
  ffmpeg_bin: '$yamlFfmpeg'
"@ | Set-Content -LiteralPath $config -Encoding utf8

Push-Location scripts/science-render
try {
  & $renderPython -B descent_math.py
  & $renderPython -m manimlib gradient_descent.py HessaraGradientDescent -w -r 1280x720 --config_file $config --video_dir $renders --file_name hessara-gradient-descent
} finally {
  Pop-Location
}
```

The raw file is `.vercel/science-render-env/renders/hessara-gradient-descent.mp4`. From the repository root, encode and verify it with the same environment:

```powershell
& $renderPython -B scripts/science-render/encode_video.py
```

The encoder uses bounded subprocess deadlines, H.264 CRF 24, `yuv420p`, MP4 fast-start and explicit `-an`. It writes `public/science/gradient-descent.mp4`, `public/science/gradient-descent-poster.webp`, frame/log evidence under the isolated directory and `docs/advanced-science-film-verification-2026-10-25.json`. It is a fixed-path offline authoring script for this original scene, not a general upload/transcoding endpoint. Re-running replaces these named generated outputs; inspect the source before repurposing it.

## Verified output on 25 October 2026

The final render completed successfully in approximately 13 seconds. Render-level QA corrected the text to Cinder fill and replaced numerical glyph morphs with discrete readout changes. The final encoded output decoded completely:

| Property | Observed result |
| --- | --- |
| Dimensions / frame rate | 1280 × 720, 24 fps |
| Duration / decoded frames | 11.46 seconds, 275 frames |
| Format | H.264, yuv420p, MP4 fast-start |
| Audio | No audio stream; silent export |
| Film size | 78,289 bytes |
| Poster size | 18,802 bytes |
| First/last RGB mean absolute difference | 0.2157902922 on the 0–255 channel scale; below the encoder's `<1` threshold |
| Film SHA-256 | `cf31fadabcc4cf0fd5fb074da54807664273bc388741559af017936b9b2d94f1` |
| Poster SHA-256 | `58b50df394c99638a506db49425f55a2d2ee71ebd494c678a2dae9c77ba3a70e` |

The first/last pixel comparison supports matching endpoints; it is not a guarantee of perceptual quality on every display. Inspect opening/middle/closing frames and the complete motion when changing the scene. Pixel-identical re-renders across GPU/font/driver versions are not promised.

The film is integrated through `CinematicMedia` **only in the LLM explorer's training stage**. That component keeps a poster and fixed aspect ratio, no playback controls or overlays, muted/loop/playsInline video, visibility/intersection gating, reduced-motion fallback and the surrounding pause state. Autoplay is enabled programmatically only when visible, the document is active and motion is allowed. The refreshed local production build and TypeScript checks passed. The actual explorer passed 72 checks in desktop/mobile Chrome emulation, including native movie playback/loop and reduced-motion behavior. See [browser evidence](../../docs/advanced-explorer-ui/verification.json). Safari/Firefox and physical-device behavior remain unverified.

The full regression suite passed **329 tests**. These tests, complete media decoding, the current build, and the scoped browser checks are separate evidence; they do not certify every device or any model-provider service. No production deployment or model-provider invocation was required for this pipeline.

The scene, calculations and wording are original Hessara work. No upstream scene, artwork, model data or branding was copied. Source/license decisions are in [the visual repository review](../../docs/ADVANCED-VISUAL-REPOSITORIES-2026-10-25.md); final machine-readable media evidence is in [the verification record](../../docs/advanced-science-film-verification-2026-10-25.json).

