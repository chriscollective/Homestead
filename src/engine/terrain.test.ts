import { describe, expect, it } from 'vitest';
import type { Terrain } from '../types';
import {
  applyBrush,
  createTerrain,
  generateContours,
  hillshadeGrid,
  sampleHeight,
  sampleProfile,
  slopeGrid,
} from './terrain';

const square = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
];

describe('createTerrain', () => {
  it('依地界外接框建立平坦網格', () => {
    const t = createTerrain(square, 2, 6);
    expect(t.origin).toEqual({ x: -6, y: -6 });
    expect(t.cols).toBeGreaterThanOrEqual(17); // (20+12)/2 + 1
    expect(t.rows).toBeGreaterThanOrEqual(17);
    expect(t.grid.every((row) => row.every((z) => z === 0))).toBe(true);
  });
});

describe('sampleHeight', () => {
  it('雙線性內插', () => {
    const t: Terrain = {
      resolution: 10,
      origin: { x: 0, y: 0 },
      cols: 2,
      rows: 2,
      grid: [
        [0, 10],
        [10, 20],
      ],
    };
    expect(sampleHeight(t, { x: 0, y: 0 })).toBe(0);
    expect(sampleHeight(t, { x: 10, y: 10 })).toBe(20);
    expect(sampleHeight(t, { x: 5, y: 5 })).toBe(10);
  });
});

describe('applyBrush', () => {
  it('raise 在中心抬升最多、邊緣為 0,且不改變原 grid', () => {
    const t = createTerrain(square, 2, 0);
    const next = applyBrush(t, { x: 10, y: 10 }, 6, 'raise', 1);
    const center = next[5][5]; // (10,10) / 2m
    expect(center).toBeCloseTo(1, 5);
    // 邊緣外不受影響
    expect(next[0][0]).toBe(0);
    // 原 grid 不變(immutable)
    expect(t.grid[5][5]).toBe(0);
  });

  it('lower 下降', () => {
    const t = createTerrain(square, 2, 0);
    const next = applyBrush(t, { x: 10, y: 10 }, 6, 'lower', 0.5);
    expect(next[5][5]).toBeCloseTo(-0.5, 5);
  });

  it('smooth 讓尖峰趨向鄰域平均', () => {
    const t = createTerrain(square, 2, 0);
    t.grid[5][5] = 10; // 一個尖峰
    const next = applyBrush(t, { x: 10, y: 10 }, 6, 'smooth', 1);
    expect(next[5][5]).toBeLessThan(10);
    expect(next[5][5]).toBeGreaterThan(0);
  });
});

describe('slopeGrid', () => {
  it('平地坡度為 0', () => {
    const t = createTerrain(square, 2, 0);
    const s = slopeGrid(t);
    expect(s.every((row) => row.every((v) => v === 0))).toBe(true);
  });

  it('45° 斜面', () => {
    const t: Terrain = {
      resolution: 1,
      origin: { x: 0, y: 0 },
      cols: 3,
      rows: 3,
      grid: [
        [0, 1, 2],
        [0, 1, 2],
        [0, 1, 2],
      ],
    };
    const s = slopeGrid(t);
    expect(s[1][1]).toBeCloseTo(45, 5);
  });
});

describe('hillshadeGrid', () => {
  it('平地均勻受光', () => {
    const t = createTerrain(square, 2, 0);
    const s = hillshadeGrid(t);
    const flat = s[3][3];
    expect(flat).toBeGreaterThan(0.6);
    expect(s.every((row) => row.every((v) => Math.abs(v - flat) < 1e-9))).toBe(true);
  });

  it('西北光源下,朝西北的坡比朝東南的坡亮', () => {
    // 向東升高的斜面:西側坡面朝西(近光源)、東側…同一斜面各處法向相同
    // 改用山脊:中央高,西坡朝西北亮、東坡朝東南暗
    const t: Terrain = {
      resolution: 1,
      origin: { x: 0, y: 0 },
      cols: 5,
      rows: 3,
      grid: [
        [0, 2, 4, 2, 0],
        [0, 2, 4, 2, 0],
        [0, 2, 4, 2, 0],
      ],
    };
    const s = hillshadeGrid(t);
    expect(s[1][1]).toBeGreaterThan(s[1][3]); // 西坡亮於東坡
  });
});

describe('generateContours', () => {
  it('平地無等高線', () => {
    const t = createTerrain(square, 2, 0);
    expect(generateContours(t, 1)).toEqual([]);
  });

  it('斜面產生沿 y 向的等高線', () => {
    const t: Terrain = {
      resolution: 1,
      origin: { x: 0, y: 0 },
      cols: 5,
      rows: 3,
      grid: [
        [0, 1, 2, 3, 4],
        [0, 1, 2, 3, 4],
        [0, 1, 2, 3, 4],
      ],
    };
    const segs = generateContours(t, 1);
    expect(segs.length).toBeGreaterThan(0);
    // level=2 的線段應落在 x=2
    const level2 = segs.filter((s) => s.level === 2);
    expect(level2.length).toBe(2); // 兩列 cell 各一段
    for (const s of level2) {
      expect(s.a.x).toBeCloseTo(2, 5);
      expect(s.b.x).toBeCloseTo(2, 5);
    }
  });
});

describe('sampleProfile', () => {
  it('沿線取樣距離遞增、高程正確', () => {
    const t: Terrain = {
      resolution: 1,
      origin: { x: 0, y: 0 },
      cols: 11,
      rows: 2,
      grid: [
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      ],
    };
    const prof = sampleProfile(t, { x: 0, y: 0.5 }, { x: 10, y: 0.5 }, 10);
    expect(prof).toHaveLength(11);
    expect(prof[0]).toEqual({ dist: 0, height: 0 });
    expect(prof[10].dist).toBeCloseTo(10);
    expect(prof[10].height).toBeCloseTo(10);
    expect(prof[5].height).toBeCloseTo(5);
  });
});
