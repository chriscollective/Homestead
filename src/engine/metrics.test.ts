import { describe, expect, it } from 'vitest';
import type { HomesteadProject, PlantSpecies } from '../types';
import { elementStats, forestCoverageRatio, spacingConflicts } from './metrics';

const square100 = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

function makeProject(elements: HomesteadProject['elements']): HomesteadProject {
  return {
    name: 'test',
    boundary: square100,
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
    },
  };
}

const camphor: PlantSpecies = {
  id: 'camphor',
  nameZh: '樟樹',
  nameSci: 'Cinnamomum camphora',
  category: 'tree_forest',
  growth: {
    matureYears: 20,
    heightCurve: [{ year: 0, value: 1 }, { year: 20, value: 15 }],
    canopyCurve: [{ year: 0, value: 0.5 }, { year: 20, value: 10 }], // 成熟半徑 5m
    lifespan: 500,
  },
  needs: { sun: 'full', water: 2, windTolerance: 2 },
  climateZones: ['north'],
  tags: [],
  isNative: true,
  sources: [],
};
const speciesMap = new Map([[camphor.id, camphor]]);

describe('forestCoverageRatio', () => {
  it('無森林元素時為 0', () => {
    expect(forestCoverageRatio(makeProject([]), speciesMap)).toBe(0);
  });

  it('林地區塊佔半個地界 → 約 50%', () => {
    const project = makeProject([
      {
        id: 'f1',
        kind: 'area',
        areaType: 'forest',
        polygon: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 100 },
          { x: 0, y: 100 },
        ],
      },
    ]);
    expect(forestCoverageRatio(project, speciesMap)).toBeCloseTo(0.5, 1);
  });

  it('樹冠與林地重疊不重複計算', () => {
    const forestHalf: HomesteadProject['elements'][number] = {
      id: 'f1',
      kind: 'area',
      areaType: 'forest',
      polygon: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 100 },
        { x: 0, y: 100 },
      ],
    };
    const treeInside: HomesteadProject['elements'][number] = {
      id: 'p1',
      kind: 'plant',
      speciesId: 'camphor',
      position: { x: 25, y: 50 }, // 完全落在林地內
      plantedYear: 0,
    };
    const withTree = forestCoverageRatio(
      makeProject([forestHalf, treeInside]),
      speciesMap
    );
    const withoutTree = forestCoverageRatio(makeProject([forestHalf]), speciesMap);
    expect(withTree).toBeCloseTo(withoutTree, 5);
  });

  it('單株喬木以成熟樹冠面積貢獻覆蓋率', () => {
    const project = makeProject([
      {
        id: 'p1',
        kind: 'plant',
        speciesId: 'camphor',
        position: { x: 50, y: 50 },
        plantedYear: 0,
      },
    ]);
    // 半徑 5m 圓面積 ≈ 78.5 ㎡ / 10000 ㎡ ≈ 0.79%
    expect(forestCoverageRatio(project, speciesMap)).toBeCloseTo(0.00785, 2);
  });

  it('未繪製邊界時為 0', () => {
    const project = makeProject([]);
    project.boundary = [];
    expect(forestCoverageRatio(project, speciesMap)).toBe(0);
  });

  it('指定年份時依當年冠幅計算(M4)', () => {
    const project = makeProject([
      {
        id: 'p1',
        kind: 'plant',
        speciesId: 'camphor',
        position: { x: 50, y: 50 },
        plantedYear: 0,
      },
    ]);
    // 第 0 年冠幅 0.5m(半徑 0.25)→ 覆蓋趨近 0;第 20 年 = 成熟半徑 5m
    const early = forestCoverageRatio(project, speciesMap, 0.5, 0);
    const mature = forestCoverageRatio(project, speciesMap, 0.5, 20);
    expect(early).toBeLessThan(mature);
    expect(mature).toBeCloseTo(0.00785, 2);
  });

  it('種植前與移除後不計入覆蓋', () => {
    const project = makeProject([
      {
        id: 'p1',
        kind: 'plant',
        speciesId: 'camphor',
        position: { x: 50, y: 50 },
        plantedYear: 5,
        removedYear: 30,
      },
    ]);
    expect(forestCoverageRatio(project, speciesMap, 1, 2)).toBe(0);
    expect(forestCoverageRatio(project, speciesMap, 1, 40)).toBe(0);
    expect(forestCoverageRatio(project, speciesMap, 1, 25)).toBeGreaterThan(0);
  });
});

describe('spacingConflicts', () => {
  const treeAt = (id: string, x: number, y: number) =>
    ({ id, kind: 'plant', speciesId: 'camphor', position: { x, y }, plantedYear: 0 }) as const;

  it('兩株樹距離足夠時無警告', () => {
    // 成熟冠幅半徑 5m,閾值 = (5+5)*0.7 = 7m
    const project = makeProject([treeAt('t1', 20, 20), treeAt('t2', 30, 20)]);
    expect(spacingConflicts(project, speciesMap)).toEqual([]);
  });

  it('兩株樹過近時回報配對', () => {
    const project = makeProject([treeAt('t1', 20, 20), treeAt('t2', 25, 20)]);
    expect(spacingConflicts(project, speciesMap)).toEqual([{ a: 't1', b: 't2' }]);
  });
});

describe('elementStats', () => {
  it('統計各類元素與面積', () => {
    const project = makeProject([
      {
        id: 'g1',
        kind: 'area',
        areaType: 'garden',
        polygon: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      },
      {
        id: 'w1',
        kind: 'water',
        waterType: 'pond',
        polygon: [
          { x: 20, y: 20 },
          { x: 40, y: 20 },
          { x: 40, y: 40 },
          { x: 20, y: 40 },
        ],
      },
      {
        id: 'p1',
        kind: 'plant',
        speciesId: 'camphor',
        position: { x: 50, y: 50 },
        plantedYear: 0,
      },
    ]);
    expect(elementStats(project)).toEqual({
      plants: 1,
      areas: 1,
      ponds: 1,
      gardenAreaM2: 100,
      pondAreaM2: 400,
    });
  });
});
