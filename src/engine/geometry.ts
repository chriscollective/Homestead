// 幾何運算純函式模組 — 不依賴渲染層(規格書 3.3-2)
import type { Point } from '../types';

/** 多邊形面積(㎡),Shoelace 公式,支援凹多邊形 */
export function polygonArea(polygon: Point[]): number {
  if (polygon.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** 多邊形周長(m) */
export function polygonPerimeter(polygon: Point[]): number {
  if (polygon.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum;
}

/** 點是否在多邊形內(ray casting,支援凹多邊形) */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** 多邊形頂點外接框 */
export function boundingBox(polygon: Point[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** 折線總長(測距工具用) */
export function polylineLength(points: Point[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    sum += distance(points[i - 1], points[i]);
  }
  return sum;
}

/** ㎡ 換算:公頃 */
export function m2ToHectare(m2: number): number {
  return m2 / 10000;
}

/** ㎡ 換算:坪(1 坪 = 400/121 ㎡) */
export function m2ToPing(m2: number): number {
  return m2 * 0.3025;
}
