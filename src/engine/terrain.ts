// M5 地勢系統引擎 — heightmap、筆刷、等高線(Marching Squares)、坡度、剖面
// 全部為純函式,不依賴渲染層
import type { Point, Terrain } from '../types';
import { boundingBox } from './geometry';

export type BrushMode = 'raise' | 'lower' | 'smooth';

/** 依地界外接框建立平坦地形網格(含外緣 margin) */
export function createTerrain(
  boundary: Point[],
  resolution = 2,
  margin = 6
): Terrain {
  const box = boundingBox(boundary);
  const origin = { x: box.minX - margin, y: box.minY - margin };
  const cols = Math.max(2, Math.ceil((box.maxX - box.minX + margin * 2) / resolution) + 1);
  const rows = Math.max(2, Math.ceil((box.maxY - box.minY + margin * 2) / resolution) + 1);
  const grid: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  return { resolution, origin, cols, rows, grid };
}

/** 雙線性內插取得任意點高程 */
export function sampleHeight(terrain: Terrain, p: Point): number {
  const { resolution, origin, cols, rows, grid } = terrain;
  const gx = (p.x - origin.x) / resolution;
  const gy = (p.y - origin.y) / resolution;
  const c0 = Math.min(Math.max(Math.floor(gx), 0), cols - 2);
  const r0 = Math.min(Math.max(Math.floor(gy), 0), rows - 2);
  const tx = Math.min(Math.max(gx - c0, 0), 1);
  const ty = Math.min(Math.max(gy - r0, 0), 1);
  const z00 = grid[r0][c0];
  const z10 = grid[r0][c0 + 1];
  const z01 = grid[r0 + 1][c0];
  const z11 = grid[r0 + 1][c0 + 1];
  return (
    z00 * (1 - tx) * (1 - ty) +
    z10 * tx * (1 - ty) +
    z01 * (1 - tx) * ty +
    z11 * tx * ty
  );
}

/**
 * 套用地形筆刷,回傳新 grid(immutable)。
 * 衰減:cos² 平滑衰減至筆刷邊緣。
 * @param strength raise/lower 為公尺;smooth 為 0~1 的混合比例
 */
export function applyBrush(
  terrain: Terrain,
  center: Point,
  radius: number,
  mode: BrushMode,
  strength: number
): number[][] {
  const { resolution, origin, cols, rows, grid } = terrain;
  const next = grid.map((row) => [...row]);
  const cMin = Math.max(0, Math.floor((center.x - radius - origin.x) / resolution));
  const cMax = Math.min(cols - 1, Math.ceil((center.x + radius - origin.x) / resolution));
  const rMin = Math.max(0, Math.floor((center.y - radius - origin.y) / resolution));
  const rMax = Math.min(rows - 1, Math.ceil((center.y + radius - origin.y) / resolution));

  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      const x = origin.x + c * resolution;
      const y = origin.y + r * resolution;
      const d = Math.hypot(x - center.x, y - center.y);
      if (d >= radius) continue;
      const falloff = Math.cos(((d / radius) * Math.PI) / 2) ** 2;
      if (mode === 'raise') {
        next[r][c] = grid[r][c] + strength * falloff;
      } else if (mode === 'lower') {
        next[r][c] = grid[r][c] - strength * falloff;
      } else {
        // smooth:向 3x3 鄰域平均值混合
        let sum = 0;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) {
              sum += grid[rr][cc];
              n++;
            }
          }
        }
        const avg = sum / n;
        next[r][c] = grid[r][c] + (avg - grid[r][c]) * Math.min(strength, 1) * falloff;
      }
    }
  }
  return next;
}

/** 各網格點坡度(度),中央差分 */
export function slopeGrid(terrain: Terrain): number[][] {
  const { resolution, cols, rows, grid } = terrain;
  const out: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cL = Math.max(c - 1, 0);
      const cR = Math.min(c + 1, cols - 1);
      const rU = Math.max(r - 1, 0);
      const rD = Math.min(r + 1, rows - 1);
      const gx = (grid[r][cR] - grid[r][cL]) / ((cR - cL) * resolution);
      const gy = (grid[rD][c] - grid[rU][c]) / ((rD - rU) * resolution);
      out[r][c] = (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
    }
  }
  return out;
}

/**
 * 山體陰影(hillshade):每格受光照程度 0~1(GIS 標準演算法)。
 * 預設光源自西北(315°)、仰角 45° — 地圖學慣例,讓地形立體感最直觀。
 */
export function hillshadeGrid(
  terrain: Terrain,
  azimuthDeg = 315,
  altitudeDeg = 45
): number[][] {
  const { resolution, cols, rows, grid } = terrain;
  const az = ((360 - azimuthDeg + 90) * Math.PI) / 180; // 轉數學角
  const alt = (altitudeDeg * Math.PI) / 180;
  const out: number[][] = Array.from({ length: rows }, () => Array(cols).fill(1));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cL = Math.max(c - 1, 0);
      const cR = Math.min(c + 1, cols - 1);
      const rU = Math.max(r - 1, 0);
      const rD = Math.min(r + 1, rows - 1);
      const gx = (grid[r][cR] - grid[r][cL]) / ((cR - cL) * resolution);
      const gy = (grid[rD][c] - grid[rU][c]) / ((rD - rU) * resolution);
      const slope = Math.atan(Math.hypot(gx, gy));
      const aspect = Math.atan2(gy, -gx);
      const shade =
        Math.sin(alt) * Math.cos(slope) +
        Math.cos(alt) * Math.sin(slope) * Math.cos(az - aspect);
      out[r][c] = Math.max(0, Math.min(1, shade));
    }
  }
  return out;
}

export interface ContourSegment {
  level: number;
  a: Point;
  b: Point;
}

/** Marching Squares 等高線(以線段集合輸出) */
export function generateContours(terrain: Terrain, interval: number): ContourSegment[] {
  const { resolution, origin, cols, rows, grid } = terrain;
  let min = Infinity;
  let max = -Infinity;
  for (const row of grid) {
    for (const z of row) {
      if (z < min) min = z;
      if (z > max) max = z;
    }
  }
  if (max - min < 1e-9) return [];

  const segments: ContourSegment[] = [];
  const firstLevel = Math.ceil(min / interval) * interval;

  for (let level = firstLevel; level <= max; level += interval) {
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const x = origin.x + c * resolution;
        const y = origin.y + r * resolution;
        const z00 = grid[r][c]; // 左上
        const z10 = grid[r][c + 1]; // 右上
        const z01 = grid[r + 1][c]; // 左下
        const z11 = grid[r + 1][c + 1]; // 右下

        let idx = 0;
        if (z00 >= level) idx |= 8;
        if (z10 >= level) idx |= 4;
        if (z11 >= level) idx |= 2;
        if (z01 >= level) idx |= 1;
        if (idx === 0 || idx === 15) continue;

        const lerp = (za: number, zb: number) => (level - za) / (zb - za);
        // 邊上的交點:top(上邊)、right、bottom、left
        const top = () => ({ x: x + lerp(z00, z10) * resolution, y });
        const right = () => ({ x: x + resolution, y: y + lerp(z10, z11) * resolution });
        const bottom = () => ({ x: x + lerp(z01, z11) * resolution, y: y + resolution });
        const left = () => ({ x, y: y + lerp(z00, z01) * resolution });

        const push = (a: Point, b: Point) => segments.push({ level, a, b });

        switch (idx) {
          case 1:
          case 14:
            push(left(), bottom());
            break;
          case 2:
          case 13:
            push(bottom(), right());
            break;
          case 3:
          case 12:
            push(left(), right());
            break;
          case 4:
          case 11:
            push(top(), right());
            break;
          case 5: // 鞍點:取兩段
            push(left(), top());
            push(bottom(), right());
            break;
          case 6:
          case 9:
            push(top(), bottom());
            break;
          case 7:
          case 8:
            push(left(), top());
            break;
          case 10: // 鞍點
            push(top(), right());
            push(left(), bottom());
            break;
        }
      }
    }
  }
  return segments;
}

/** 沿線段等距取樣高程(剖面工具) */
export function sampleProfile(
  terrain: Terrain,
  a: Point,
  b: Point,
  samples = 60
): { dist: number; height: number }[] {
  const out: { dist: number; height: number }[] = [];
  const total = Math.hypot(b.x - a.x, b.y - a.y);
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    out.push({ dist: total * t, height: sampleHeight(terrain, p) });
  }
  return out;
}
