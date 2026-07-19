import { describe, expect, it } from 'vitest';
import type { BoundaryHedgeConfig } from '../types';
import { pointInPolygon } from './geometry';
import {
  generateHedgePlants,
  hedgeEnclosureRatio,
  nearestPerimeterT,
  pointAtPerimeter,
} from './hedge';

// 正方形 100×100,周長 400
const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

const baseConfig: BoundaryHedgeConfig = {
  shrubSpeciesId: 'orange_jasmine',
  spacing: 1,
  treeSpeciesId: null,
  treeEvery: 0,
  inset: 0,
  plantedYear: 0,
  gaps: [],
};

describe('pointAtPerimeter', () => {
  it('s=0 在第一個頂點,s=150 在第二條邊中段', () => {
    expect(pointAtPerimeter(square, 0).point).toEqual({ x: 0, y: 0 });
    const p = pointAtPerimeter(square, 150).point;
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(50);
  });
  it('s 超過周長時環繞', () => {
    expect(pointAtPerimeter(square, 400).point).toEqual({ x: 0, y: 0 });
  });
});

describe('generateHedgePlants', () => {
  it('周長 400、株距 1m → 400 株', () => {
    expect(generateHedgePlants(square, baseConfig)).toHaveLength(400);
  });

  it('株距 0.5m(俄式密籬)→ 800 株', () => {
    expect(generateHedgePlants(square, { ...baseConfig, spacing: 0.5 })).toHaveLength(800);
  });

  it('出入口範圍留空:寬 4m 的出入口約扣掉 4 株', () => {
    const withGap = generateHedgePlants(square, {
      ...baseConfig,
      gaps: [{ t: 0.5, width: 4 }],
    });
    expect(withGap.length).toBeGreaterThanOrEqual(395);
    expect(withGap.length).toBeLessThanOrEqual(397);
    // 出入口中心(t=0.5 → s=200 → (100,100) 角附近)2m 內不應有植株
    const c = pointAtPerimeter(square, 200).point;
    for (const p of withGap) {
      const d = Math.hypot(p.position.x - c.x, p.position.y - c.y);
      expect(d).toBeGreaterThan(1.9);
    }
  });

  it('每 9 株灌木插 1 株喬木 → 喬木約佔 1/10', () => {
    const plants = generateHedgePlants(square, {
      ...baseConfig,
      treeSpeciesId: 'camphor',
      treeEvery: 9,
    });
    const trees = plants.filter((p) => p.isTree);
    expect(trees).toHaveLength(40); // 400 / 10
    expect(trees.every((p) => p.speciesId === 'camphor')).toBe(true);
  });

  it('內縮 2m 時所有植株都在地界內', () => {
    const plants = generateHedgePlants(square, { ...baseConfig, inset: 2 });
    for (const p of plants) {
      expect(pointInPolygon(p.position, square)).toBe(true);
    }
  });
});

describe('hedgeEnclosureRatio', () => {
  it('無出入口 = 100%;4m 出入口 = 99%', () => {
    expect(hedgeEnclosureRatio(square, [])).toBe(1);
    expect(hedgeEnclosureRatio(square, [{ t: 0.2, width: 4 }])).toBeCloseTo(0.99);
  });
});

describe('nearestPerimeterT', () => {
  it('地界外一點映射到最近邊上的周長位置', () => {
    // (50, -10) 最近點是上邊的 (50, 0) → s = 50 → t = 0.125
    const r = nearestPerimeterT(square, { x: 50, y: -10 });
    expect(r.t).toBeCloseTo(0.125);
    expect(r.dist).toBeCloseTo(10);
  });
});
