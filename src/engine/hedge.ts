// 邊界綠籬引擎(M2)— 沿地界周長自動佈植灌木、間插喬木、留出入口
// 設計參考:祖傳家園以活籬代替圍牆(喬木+灌木混植);俄式單排密籬株距 0.3~0.5m
import type { BoundaryHedgeConfig, HedgeGap, Point } from '../types';
import { distance, pointInPolygon, polygonPerimeter } from './geometry';

export interface HedgePlant {
  position: Point;
  speciesId: string;
  isTree: boolean;
}

/** 周長座標 s(m)→ 地界上的點與所在邊的方向 */
export function pointAtPerimeter(
  boundary: Point[],
  s: number
): { point: Point; dir: Point } {
  const total = polygonPerimeter(boundary);
  let remain = ((s % total) + total) % total;
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i];
    const b = boundary[(i + 1) % boundary.length];
    const len = distance(a, b);
    if (remain <= len || i === boundary.length - 1) {
      const t = len > 0 ? remain / len : 0;
      return {
        point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        dir: len > 0 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 1, y: 0 },
      };
    }
    remain -= len;
  }
  return { point: boundary[0], dir: { x: 1, y: 0 } };
}

/** 周長座標 s 是否落在任一出入口內(環狀距離判斷,處理跨起點的情形) */
function inGap(s: number, total: number, gaps: HedgeGap[]): boolean {
  for (const g of gaps) {
    const center = g.t * total;
    const d = Math.abs(s - center);
    const circular = Math.min(d, total - d);
    if (circular < g.width / 2) return true;
  }
  return false;
}

/** 邊上一點的「朝內」法向量(探測點法;頂點等模糊情形以形心方向後援) */
function inwardNormal(boundary: Point[], point: Point, dir: Point): Point {
  const n = { x: -dir.y, y: dir.x };
  const probeA = { x: point.x + n.x * 0.5, y: point.y + n.y * 0.5 };
  const probeB = { x: point.x - n.x * 0.5, y: point.y - n.y * 0.5 };
  const aIn = pointInPolygon(probeA, boundary);
  const bIn = pointInPolygon(probeB, boundary);
  if (aIn && !bIn) return n;
  if (bIn && !aIn) return { x: -n.x, y: -n.y };
  // 模糊(頂點上、探測點落在邊線):取指向形心的一側
  const c = boundary.reduce(
    (acc, p) => ({ x: acc.x + p.x / boundary.length, y: acc.y + p.y / boundary.length }),
    { x: 0, y: 0 }
  );
  const toC = { x: c.x - point.x, y: c.y - point.y };
  return n.x * toC.x + n.y * toC.y >= 0 ? n : { x: -n.x, y: -n.y };
}

/**
 * 依設定沿地界生成綠籬植株(純函式,隨地界變動自動重算)。
 * 每 treeEvery 株灌木後插一株喬木;出入口範圍留空。
 */
export function generateHedgePlants(
  boundary: Point[],
  config: BoundaryHedgeConfig
): HedgePlant[] {
  if (boundary.length < 3 || config.spacing <= 0.1) return [];
  const total = polygonPerimeter(boundary);
  const count = Math.floor(total / config.spacing);
  const plants: HedgePlant[] = [];
  let placed = 0;
  const useTrees = config.treeSpeciesId !== null && config.treeEvery > 0;
  for (let i = 0; i < count; i++) {
    const s = i * config.spacing;
    if (inGap(s, total, config.gaps)) continue;
    const { point, dir } = pointAtPerimeter(boundary, s);
    const n = inwardNormal(boundary, point, dir);
    let position = {
      x: point.x + n.x * config.inset,
      y: point.y + n.y * config.inset,
    };
    // 角點沿單邊法向內縮可能仍貼在另一條邊上 → 改朝形心方向內縮
    if (config.inset > 0 && !pointInPolygon(position, boundary)) {
      const c = boundary.reduce(
        (acc, q) => ({ x: acc.x + q.x / boundary.length, y: acc.y + q.y / boundary.length }),
        { x: 0, y: 0 }
      );
      const len = Math.hypot(c.x - point.x, c.y - point.y) || 1;
      position = {
        x: point.x + ((c.x - point.x) / len) * config.inset,
        y: point.y + ((c.y - point.y) / len) * config.inset,
      };
    }
    const isTree = useTrees && (placed + 1) % (config.treeEvery + 1) === 0;
    plants.push({
      position,
      speciesId: isTree ? config.treeSpeciesId! : config.shrubSpeciesId,
      isTree,
    });
    placed++;
  }
  return plants;
}

/** 綠籬圍合度(規格書 M2):地界被綠籬覆蓋的周長比例 */
export function hedgeEnclosureRatio(boundary: Point[], gaps: HedgeGap[]): number {
  const total = polygonPerimeter(boundary);
  if (total <= 0) return 0;
  const gapSum = gaps.reduce((s, g) => s + Math.min(g.width, total), 0);
  return Math.max(0, Math.min(1, 1 - gapSum / total));
}

/** 任意點到地界周長的最近位置(新增出入口用) */
export function nearestPerimeterT(
  boundary: Point[],
  p: Point
): { t: number; dist: number } {
  const total = polygonPerimeter(boundary);
  let best = { t: 0, dist: Infinity };
  let acc = 0;
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i];
    const b = boundary[(i + 1) % boundary.length];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const len = Math.sqrt(len2);
    let u = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
    u = Math.min(Math.max(u, 0), 1);
    const q = { x: a.x + abx * u, y: a.y + aby * u };
    const d = distance(p, q);
    if (d < best.dist) {
      best = { t: (acc + len * u) / total, dist: d };
    }
    acc += len;
  }
  return best;
}
