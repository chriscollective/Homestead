import { describe, expect, it } from 'vitest';
import type { HomesteadProject } from '../types';
import { zoneWarnings } from './zones';

function makeProject(
  homePosition: { x: number; y: number } | null,
  elements: HomesteadProject['elements']
): HomesteadProject {
  return {
    name: 'test',
    boundary: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ],
    terrain: null,
    hedge: null,
    elements,
    settings: {
      northAngle: 0,
      gridVisible: true,
      gridSize: 5,
      showContours: false,
      showSlope: false,
      showZones: true,
      contourInterval: 1,
      homePosition,
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

const gardenAt = (id: string, cx: number, cy: number): HomesteadProject['elements'][number] => ({
  id,
  kind: 'area',
  areaType: 'garden',
  polygon: [
    { x: cx - 5, y: cy - 5 },
    { x: cx + 5, y: cy - 5 },
    { x: cx + 5, y: cy + 5 },
    { x: cx - 5, y: cy + 5 },
  ],
});

describe('zoneWarnings', () => {
  it('未設定住家時不檢查', () => {
    expect(zoneWarnings(makeProject(null, [gardenAt('g1', 150, 150)]))).toEqual([]);
  });

  it('菜園在 40m 內不警告', () => {
    expect(zoneWarnings(makeProject({ x: 20, y: 20 }, [gardenAt('g1', 40, 20)]))).toEqual([]);
  });

  it('菜園過遠時提出建議', () => {
    const w = zoneWarnings(makeProject({ x: 20, y: 20 }, [gardenAt('g1', 120, 20)]));
    expect(w).toHaveLength(1);
    expect(w[0].elementId).toBe('g1');
    expect(w[0].message).toContain('100m');
  });
});
