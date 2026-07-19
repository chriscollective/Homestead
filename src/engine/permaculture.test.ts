import { describe, expect, it } from 'vitest';
import type { HomesteadProject, PlantSpecies } from '../types';
import { foodForestLayers, swaleLevelness, synergyHints } from './permaculture';

const mkSpecies = (id: string, layer: PlantSpecies['forestLayer']): PlantSpecies => ({
  id, nameZh: id, nameSci: id, category: 'tree_fruit',
  growth: { matureYears: 10, heightCurve: [{ year: 0, value: 1 }], canopyCurve: [{ year: 0, value: 1 }], lifespan: 50 },
  needs: { sun: 'full', water: 2, windTolerance: 2 },
  climateZones: ['north'], tags: [], forestLayer: layer, isNative: false, sources: [],
});
const speciesMap = new Map([
  ['mango', mkSpecies('mango', 'canopy')],
  ['banana', mkSpecies('banana', 'understory')],
]);

function makeProject(elements: HomesteadProject['elements'], terrain: HomesteadProject['terrain'] = null): HomesteadProject {
  return {
    name: 't',
    boundary: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    terrain, elements,
    settings: {
      northAngle: 0, gridVisible: true, gridSize: 5, showContours: false, showSlope: false,
      showZones: false, contourInterval: 1, homePosition: null, showShadows: false,
      showInsolation: false, showFlow: false, showWind: false, sunMonth: 6, sunHour: 12,
      windDir: 'NE', people: 4, windTurbineKw: 0, windClass: 'normal', showSectors: false,
    },
  };
}

const ffPolygon = [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 10, y: 50 }];

describe('foodForestLayers', () => {
  it('偵測區塊內植物層次 + 手動勾選層,回報缺層', () => {
    const project = makeProject([
      { id: 'ff', kind: 'area', areaType: 'food_forest', polygon: ffPolygon, manualLayers: ['groundcover'] },
      { id: 'p1', kind: 'plant', speciesId: 'mango', position: { x: 20, y: 20 }, plantedYear: 0 },
      { id: 'p2', kind: 'plant', speciesId: 'banana', position: { x: 30, y: 30 }, plantedYear: 0 },
      { id: 'p3', kind: 'plant', speciesId: 'mango', position: { x: 80, y: 80 }, plantedYear: 0 }, // 區塊外
    ]);
    const report = foodForestLayers(project, 'ff', speciesMap)!;
    expect(report.present).toEqual(expect.arrayContaining(['canopy', 'understory', 'groundcover']));
    expect(report.present).toHaveLength(3);
    expect(report.missing).toContain('shrub');
    expect(report.missing).toContain('herb');
  });

  it('非食物森林區塊回傳 null', () => {
    const project = makeProject([
      { id: 'g', kind: 'area', areaType: 'garden', polygon: ffPolygon },
    ]);
    expect(foodForestLayers(project, 'g', speciesMap)).toBeNull();
  });
});

describe('synergyHints', () => {
  const garden: HomesteadProject['elements'][number] = {
    id: 'g1', kind: 'area', areaType: 'garden',
    polygon: [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }],
  };
  const coopAt = (x: number, y: number): HomesteadProject['elements'][number] => ({
    id: 'c1', kind: 'building', modelId: 'coop', position: { x, y }, rotationDeg: 0, width: 3, depth: 2, height: 2.5,
  });

  it('雞舍鄰近菜園 → 正向提示', () => {
    const hints = synergyHints(makeProject([garden, coopAt(55, 55)]));
    expect(hints.some((h) => h.kind === 'good' && h.message.includes('雞舍'))).toBe(true);
  });

  it('雞舍過遠 → 建議提示', () => {
    const hints = synergyHints(makeProject([garden, coopAt(95, 95)]));
    expect(hints.some((h) => h.kind === 'suggest' && h.message.includes('雞舍'))).toBe(true);
  });

  it('池塘位於菜園上坡 → 重力給水提示', () => {
    // 向東傾斜地形:x 越大越低;池塘在西(高)、菜園在東(低)
    const terrain = {
      resolution: 10, origin: { x: 0, y: 0 }, cols: 11, rows: 11,
      grid: Array.from({ length: 11 }, () => Array.from({ length: 11 }, (_, c) => 10 - c)),
    };
    const pond: HomesteadProject['elements'][number] = {
      id: 'w1', kind: 'water', waterType: 'pond',
      polygon: [{ x: 5, y: 40 }, { x: 15, y: 40 }, { x: 15, y: 50 }, { x: 5, y: 50 }],
    };
    const gardenEast: HomesteadProject['elements'][number] = {
      id: 'g1', kind: 'area', areaType: 'garden',
      polygon: [{ x: 80, y: 40 }, { x: 95, y: 40 }, { x: 95, y: 55 }, { x: 80, y: 55 }],
    };
    const hints = synergyHints(makeProject([pond, gardenEast], terrain));
    expect(hints.some((h) => h.kind === 'good' && h.message.includes('重力給水'))).toBe(true);
  });
});

describe('swaleLevelness', () => {
  it('沿等高線的 swale 高差為 0;垂直等高線則有高差', () => {
    const terrain = {
      resolution: 10, origin: { x: 0, y: 0 }, cols: 11, rows: 11,
      grid: Array.from({ length: 11 }, () => Array.from({ length: 11 }, (_, c) => c)),
    };
    const project = makeProject([], terrain);
    // 沿 y 向(等高線方向)
    expect(swaleLevelness(project, [{ x: 50, y: 10 }, { x: 50, y: 90 }])).toBeCloseTo(0);
    // 沿 x 向(垂直等高線)
    expect(swaleLevelness(project, [{ x: 10, y: 50 }, { x: 90, y: 50 }])!).toBeGreaterThan(5);
  });

  it('無地形回傳 null', () => {
    expect(swaleLevelness(makeProject([]), [{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBeNull();
  });
});
