/** Exact line comparison under a fixed memory/time budget. Large changes are
 * displayed without highlights rather than labelling unchanged context as edits. */
export function compareCodeLines(before: string[], after: string[]) {
  const removed = new Set<number>(), added = new Set<number>();
  let prefix = 0, suffix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  const left = before.length - prefix - suffix, right = after.length - prefix - suffix;
  if ((left + 1) * (right + 1) > 1_000_000) return { removed, added, precise: false };
  const width = right + 1, common = new Uint16Array((left + 1) * width);
  for (let i = left - 1; i >= 0; i--) for (let j = right - 1; j >= 0; j--) {
    common[i * width + j] = before[prefix + i] === after[prefix + j]
      ? common[(i + 1) * width + j + 1] + 1
      : Math.max(common[(i + 1) * width + j], common[i * width + j + 1]);
  }
  let i = 0, j = 0;
  while (i < left || j < right) {
    if (i < left && j < right && before[prefix + i] === after[prefix + j]) { i++; j++; }
    else if (i < left && (j === right || common[(i + 1) * width + j] >= common[i * width + j + 1])) removed.add(prefix + i++);
    else added.add(prefix + j++);
  }
  return { removed, added, precise: true };
}
