export function fluidPolicy({ compact = false, width, height, dpr = 1, quality = 1 }: { compact?: boolean; width: number; height: number; dpr?: number; quality?: number }) {
  const safeWidth = Math.max(1, Number.isFinite(width) ? width : 1);
  const safeHeight = Math.max(1, Number.isFinite(height) ? height : 1);
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const safeQuality = Number.isFinite(quality) ? Math.max(.5, Math.min(1, quality)) : 1;
  const aspect = Math.max(.5, Math.min(2, safeWidth / safeHeight));
  const resolution = compact ? 80 : 112;
  const dye = compact ? 176 : 256;
  const shape = (size: number) => aspect >= 1 ? [size, Math.round(size / aspect)] : [Math.round(size * aspect), size];
  const scale = Math.min(Math.max(.5, safeDpr), compact ? 1 : 1.25, Math.sqrt(520_000 / (safeWidth * safeHeight)), 1100 / Math.max(safeWidth, safeHeight));
  // Degrade after the DPR/area caps, so high-DPR canvases actually lose pixels.
  return { simulation: shape(resolution), dye: shape(dye), width: Math.max(1, Math.floor(safeWidth * scale * safeQuality)), height: Math.max(1, Math.floor(safeHeight * scale * safeQuality)), iterations: safeQuality < 1 ? 6 : compact ? 8 : 12, frameInterval: 1000 / (compact ? 24 : 30) };
}
