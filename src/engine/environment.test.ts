import { describe, expect, it } from 'vitest';
import type { HomesteadProject, PlantSpecies, Terrain } from '../types';
import { flowAccumulation, flowDirections } from './hydrology';
import { dayOfYearForMonth, shadowVector, solarPosition } from './sun';
import { plantYieldAtAge, selfSufficiency } from './sustain';
import { shelterZones, windVector } from './wind';

// ── M7 光照 ──

describe('solarPosition', () => {
  it('夏至正午在北回歸線(23.45°N)太陽近天頂', () => {
    const sun = solarPosition(23.45, 172, 12);
    expect(sun.elevationDeg).toBeGreaterThan(88);
  });

  it('冬至正午仰角 ≈ 90 - 23.45 - 23.45 ≈ 43°', () => {
    const sun = solarPosition(23.45, 355, 12);
    expect(sun.elevationDeg).toBeGreaterThan(40);
    expect(sun.elevationDeg).toBeLessThan(46);
  });

  it('上午太陽在東半邊、下午在西半邊', () => {
    const morning = solarPosition(23.45, 355, 9);
    const afternoon = solarPosition(23.45, 355, 15);
    expect(morning.azimuthDeg).toBeGreaterThan(0);
    expect(morning.azimuthDeg).toBeLessThan(180);
    expect(afternoon.azimuthDeg).toBeGreaterThan(180);
    expect(afternoon.azimuthDeg).toBeLessThan(360);
  });

  it('夜間仰角為負', () => {
    expect(solarPosition(23.45, 172, 0).elevationDeg).toBeLessThan(0);
  });
});

describe('shadowVector', () => {
  it('冬至正午影子朝北(y 負向)且長度 = h/tan(el)', () => {
    const sun = solarPosition(23.45, 355, 12);
    const v = shadowVector(sun, 10)!;
    expect(Math.abs(v.x)).toBeLessThan(0.5); // 正午近正南 → 影子近正北
    expect(v.y).toBeLessThan(0); // y 負向 = 北
    const expected = 10 / Math.tan((sun.elevationDeg * Math.PI) / 180);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(expected, 1);
  });

  it('太陽在地平線下回傳 null', () => {
    expect(shadowVector({ elevationDeg: -5, azimuthDeg: 90 }, 10)).toBeNull();
  });

  it('dayOfYearForMonth:6 月中 ≈ 夏至附近', () => {
    expect(dayOfYearForMonth(6)).toBe(166);
  });
});

// ── M7 水流 ──

describe('D8 水流', () => {
  // 向東傾斜的斜面:每列獨立向東流
  const tilted: Terrain = {
    resolution: 1,
    origin: { x: 0, y: 0 },
    cols: 5,
    rows: 3,
    grid: [
      [4, 3, 2, 1, 0],
      [4, 3, 2, 1, 0],
      [4, 3, 2, 1, 0],
    ],
  };

  it('流向指向最陡下降(正東)', () => {
    const dir = flowDirections(tilted);
    expect(dir[1][1]).toBe(0); // 0 = E
  });

  it('匯流量沿坡向下遞增', () => {
    const acc = flowAccumulation(tilted);
    expect(acc[1][0]).toBe(1);
    expect(acc[1][4]).toBe(5); // 整列匯到最低點
  });

  it('平地無流向', () => {
    const flat: Terrain = {
      resolution: 1,
      origin: { x: 0, y: 0 },
      cols: 3,
      rows: 3,
      grid: [
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
      ],
    };
    const dir = flowDirections(flat);
    expect(dir[1][1]).toBe(-1);
  });
});

// ── M7 風向 ──

const camphor: PlantSpecies = {
  id: 'camphor',
  nameZh: '樟樹',
  nameSci: 'Cinnamomum camphora',
  category: 'tree_forest',
  growth: {
    matureYears: 20,
    heightCurve: [{ year: 0, value: 1 }, { year: 20, value: 15 }],
    canopyCurve: [{ year: 0, value: 0.5 }, { year: 20, value: 10 }],
    lifespan: 500,
  },
  needs: { sun: 'full', water: 2, windTolerance: 3 },
  climateZones: ['north'],
  tags: ['windbreak'],
  forestLayer: 'canopy',
  isNative: true,
  sources: [],
};
const speciesMap = new Map([[camphor.id, camphor]]);

function makeProject(elements: HomesteadProject['elements']): HomesteadProject {
  return {
    name: 't',
    boundary: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    terrain: null,
    elements,
    settings: {
      northAngle: 0,
      gridVisible: true,
      gridSize: 5,
      showContours: false,
      showSlope: false,
      showZones: false,
      contourInterval: 1,
      homePosition: null,
      showShadows: false,
      showInsolation: false,
      showFlow: false,
      showWind: false,
      sunMonth: 6,
      sunHour: 12,
      windDir: 'NE',
      people: 4,
      windTurbineKw: 0,
      windClass: 'normal',
      showSectors: false,
    },
  };
}

describe('風向與防風', () => {
  it('東北季風吹向西南', () => {
    const v = windVector('NE');
    expect(v.x).toBeLessThan(0); // 向西
    expect(v.y).toBeGreaterThan(0); // 向南
  });

  it('減風區在樹的背風側(東北風 → 西南側)', () => {
    const project = makeProject([
      { id: 't1', kind: 'plant', speciesId: 'camphor', position: { x: 50, y: 50 }, plantedYear: 0 },
    ]);
    const zones = shelterZones(project, speciesMap, 20, 'NE');
    expect(zones).toHaveLength(1);
    expect(zones[0].center.x).toBeLessThan(50);
    expect(zones[0].center.y).toBeGreaterThan(50);
    // 樹高 15m → 減風長度 180m,半軸 90m
    expect(zones[0].halfLength).toBeCloseTo(90);
  });

  it('太矮的樹不形成減風區', () => {
    const project = makeProject([
      { id: 't1', kind: 'plant', speciesId: 'camphor', position: { x: 50, y: 50 }, plantedYear: 19 },
    ]);
    // 第 20 年樹齡 1 → 高度 ~1.7m < 2m
    expect(shelterZones(project, speciesMap, 20, 'NE')).toHaveLength(0);
  });
});

// ── M8 建物陰影 ──

import { shadowShapes } from './sun';

describe('建物陰影(M8)', () => {
  it('建物投影納入陰影分析,冬至正午影子在建物北側', () => {
    const project = makeProject([
      {
        id: 'b1',
        kind: 'building',
        modelId: 'cabin',
        position: { x: 50, y: 50 },
        rotationDeg: 0,
        width: 6,
        depth: 5,
        height: 4,
      },
    ]);
    const sun = solarPosition(23.45, 355, 12);
    const shapes = shadowShapes(project, speciesMap, 10, sun);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].center.y).toBeLessThan(50); // 北側
    expect(shapes[0].radius).toBe(3); // max(6,5)/2
  });
});

// ── M9 自給自足 ──

const mango: PlantSpecies = {
  ...camphor,
  id: 'mango',
  nameZh: '芒果',
  category: 'tree_fruit',
  growth: { ...camphor.growth, matureYears: 10 },
  yield: { startYear: 4, matureKgPerYear: 80, harvestMonths: [6, 7], kcalPerKg: 600 },
};
const speciesMap2 = new Map([
  [camphor.id, camphor],
  [mango.id, mango],
]);

describe('plantYieldAtAge', () => {
  it('結果始年前為 0、成熟後達最大', () => {
    expect(plantYieldAtAge(mango, 2)).toBe(0);
    expect(plantYieldAtAge(mango, 15)).toBe(80);
  });
  it('始年至成熟年之間線性爬升', () => {
    const early = plantYieldAtAge(mango, 4);
    const mid = plantYieldAtAge(mango, 7);
    expect(early).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(early);
    expect(mid).toBeLessThan(80);
  });
});

describe('selfSufficiency', () => {
  it('產量與比率隨年份成長', () => {
    const project = makeProject([
      { id: 'p1', kind: 'plant', speciesId: 'mango', position: { x: 30, y: 30 }, plantedYear: 0 },
      {
        id: 'g1',
        kind: 'area',
        areaType: 'garden',
        polygon: [
          { x: 60, y: 60 },
          { x: 80, y: 60 },
          { x: 80, y: 80 },
          { x: 60, y: 80 },
        ],
      },
      {
        id: 'w1',
        kind: 'water',
        waterType: 'pond',
        polygon: [
          { x: 10, y: 60 },
          { x: 30, y: 60 },
          { x: 30, y: 80 },
          { x: 10, y: 80 },
        ],
      },
    ]);
    const y2 = selfSufficiency(project, speciesMap2, 2, 4);
    const y15 = selfSufficiency(project, speciesMap2, 15, 4);
    expect(y2.fruitKgPerYear).toBe(0);
    expect(y15.fruitKgPerYear).toBe(80);
    expect(y15.kcalPerDay).toBeGreaterThan(y2.kcalPerDay);
    // 菜園 400㎡ × 3kg = 1200kg/年
    expect(y15.gardenKgPerYear).toBeCloseTo(1200);
    // 池塘 400㎡ × 1.8m × 0.75 = 540 m³
    expect(y15.waterCollectedM3).toBeCloseTo(540);
    expect(y15.waterRatio).toBeGreaterThan(1); // 4 人年需 175.2 m³
  });
});
