// M7 水流分析 — D8 流向 + 匯流累積(經典地表水文演算法)
import type { Terrain } from '../types';

// 8 鄰域:E, SE, S, SW, W, NW, N, NE
const DC = [1, 1, 0, -1, -1, -1, 0, 1];
const DR = [0, 1, 1, 1, 0, -1, -1, -1];

/** D8 流向:每格指向最陡下降鄰格的索引(0-7);窪地/平地 = -1 */
export function flowDirections(terrain: Terrain): number[][] {
  const { rows, cols, grid, resolution } = terrain;
  const dir: number[][] = Array.from({ length: rows }, () => Array(cols).fill(-1));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let best = -1;
      let bestDrop = 0;
      for (let k = 0; k < 8; k++) {
        const rr = r + DR[k];
        const cc = c + DC[k];
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
        const dist = resolution * (DR[k] !== 0 && DC[k] !== 0 ? Math.SQRT2 : 1);
        const drop = (grid[r][c] - grid[rr][cc]) / dist;
        if (drop > bestDrop) {
          bestDrop = drop;
          best = k;
        }
      }
      dir[r][c] = best;
    }
  }
  return dir;
}

/** 匯流累積:每格上游(含自身)的格數,由高到低依序傳遞 */
export function flowAccumulation(terrain: Terrain): number[][] {
  const { rows, cols, grid } = terrain;
  const dir = flowDirections(terrain);
  const acc: number[][] = Array.from({ length: rows }, () => Array(cols).fill(1));
  const order: { r: number; c: number; z: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) order.push({ r, c, z: grid[r][c] });
  }
  order.sort((a, b) => b.z - a.z); // 由高到低
  for (const { r, c } of order) {
    const k = dir[r][c];
    if (k < 0) continue;
    acc[r + DR[k]][c + DC[k]] += acc[r][c];
  }
  return acc;
}

export interface FlowArrow {
  x: number;
  y: number;
  dx: number;
  dy: number;
  strength: number; // 0~1(log 正規化的匯流量)
}

/** 匯流視覺化:回傳每格的流向箭頭(僅匯流量達門檻者) */
export function flowArrows(terrain: Terrain, minAccum = 3): FlowArrow[] {
  const { rows, cols, resolution, origin } = terrain;
  const dir = flowDirections(terrain);
  const acc = flowAccumulation(terrain);
  let maxAcc = 1;
  for (const row of acc) for (const v of row) if (v > maxAcc) maxAcc = v;
  const arrows: FlowArrow[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = dir[r][c];
      if (k < 0 || acc[r][c] < minAccum) continue;
      const len = Math.hypot(DC[k], DR[k]);
      arrows.push({
        x: origin.x + c * resolution,
        y: origin.y + r * resolution,
        dx: (DC[k] / len) * resolution * 0.8,
        dy: (DR[k] / len) * resolution * 0.8,
        strength: Math.log(acc[r][c]) / Math.log(maxAcc),
      });
    }
  }
  return arrows;
}
