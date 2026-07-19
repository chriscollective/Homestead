import { describe, expect, it } from 'vitest';
import type { BuildingElement, HomesteadProject, PlantSpecies } from '../types';
import { futureShadeYear, shadeFactorAt, solarRoofKwh, windTurbineKwh } from './energy';

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
  tags: [],
  isNative: true,
  sources: [],
};
const speciesMap = new Map([[camphor.id, camphor]]);

const building: BuildingElement = {
  id: 'b1', kind: 'building', modelId: 'cabin', position: { x: 50, y: 50 },
  rotationDeg: 0, width: 6, depth: 5, height: 4, solarRoofM2: 20,
};

function makeProject(elements: HomesteadProject['elements']): HomesteadProject {
  return {
    name: 't',
    boundary: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    terrain: null,
    elements,
    settings: {
      northAngle: 0, gridVisible: true, gridSize: 5, showContours: false, showSlope: false,
      showZones: false, contourInterval: 1, homePosition: null, showShadows: false,
      showInsolation: false, showFlow: false, showWind: false, sunMonth: 6, sunHour: 12,
      windDir: 'NE', people: 4, windTurbineKw: 0, windClass: 'normal',
    },
  };
}

describe('M12 能源', () => {
  it('無遮蔽時日照係數為 1,20㎡ 面板年發電約 3744 度', () => {
    const p = makeProject([building]);
    expect(shadeFactorAt(p, speciesMap, 10, building)).toBe(1);
    expect(solarRoofKwh(20, 1)).toBeCloseTo(20 * 1300 * 0.18 * 0.8);
  });

  it('南側大樹成熟後降低日照係數,futureShadeYear 偵測到未來遮蔽', () => {
    // 樹在建物南方 8m:冬季正午影子朝北會蓋到建物
    const tree = { id: 't1', kind: 'plant' as const, speciesId: 'camphor', position: { x: 50, y: 58 }, plantedYear: 0 };
    const p = makeProject([building, tree]);
    const early = shadeFactorAt(p, speciesMap, 0, building);
    const late = shadeFactorAt(p, speciesMap, 40, building);
    expect(late).toBeLessThan(early);
    const y = futureShadeYear(p, speciesMap, 0, building, 50, 0.9);
    expect(y).not.toBeNull();
    expect(y!).toBeGreaterThan(0); // 樹小時不遮,長大後才遮
  });

  it('風機發電依風區等級查表', () => {
    expect(windTurbineKwh(3, 'strong')).toBe(7500);
    expect(windTurbineKwh(3, 'weak')).toBe(2400);
    expect(windTurbineKwh(0, 'normal')).toBe(0);
  });
});
