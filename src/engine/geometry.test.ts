import { describe, expect, it } from 'vitest';
import {
  boundingBox,
  distance,
  m2ToHectare,
  m2ToPing,
  pointInPolygon,
  polygonArea,
  polygonPerimeter,
  polylineLength,
} from './geometry';

const square100 = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

// 凹多邊形(L 形):100x100 缺右上 50x50 → 面積 7500
const lShape = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 50 },
  { x: 50, y: 50 },
  { x: 50, y: 100 },
  { x: 0, y: 100 },
];

describe('polygonArea', () => {
  it('正方形 100x100 = 1 公頃', () => {
    expect(polygonArea(square100)).toBe(10000);
  });
  it('支援凹多邊形(L 形)', () => {
    expect(polygonArea(lShape)).toBe(7500);
  });
  it('頂點順序(順/逆時針)不影響結果', () => {
    expect(polygonArea([...square100].reverse())).toBe(10000);
  });
  it('少於 3 點回傳 0', () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
  });
});

describe('polygonPerimeter', () => {
  it('正方形 100x100 周長 400', () => {
    expect(polygonPerimeter(square100)).toBe(400);
  });
});

describe('pointInPolygon', () => {
  it('內部點為 true', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square100)).toBe(true);
  });
  it('外部點為 false', () => {
    expect(pointInPolygon({ x: 150, y: 50 }, square100)).toBe(false);
  });
  it('凹多邊形的缺口區為 false', () => {
    expect(pointInPolygon({ x: 75, y: 75 }, lShape)).toBe(false);
    expect(pointInPolygon({ x: 25, y: 75 }, lShape)).toBe(true);
  });
});

describe('距離與長度', () => {
  it('distance 3-4-5', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
  it('polylineLength 累加', () => {
    expect(
      polylineLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
        { x: 3, y: 14 },
      ])
    ).toBe(15);
  });
});

describe('boundingBox', () => {
  it('計算外接框', () => {
    expect(boundingBox(lShape)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
  });
});

describe('單位換算', () => {
  it('10000 ㎡ = 1 公頃', () => {
    expect(m2ToHectare(10000)).toBe(1);
  });
  it('100 ㎡ = 30.25 坪', () => {
    expect(m2ToPing(100)).toBeCloseTo(30.25);
  });
});
