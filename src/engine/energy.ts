// M12 能源模組 — 太陽能屋頂與小型風機估算(規劃參考值,非工程評估)
import type { BuildingElement, HomesteadProject, PlantSpecies } from '../types';
import { dayOfYearForMonth, shadowShapes, solarPosition } from './sun';

// 簡化假設
const ANNUAL_IRRADIATION = 1300; // kWh/㎡/年(台灣平均全天空日射)
const PV_EFFICIENCY = 0.18;
const PERFORMANCE_RATIO = 0.8;
export const KWH_PER_PERSON_YEAR = 1200; // 家庭用電估算分母

export type WindClass = 'strong' | 'normal' | 'weak';
export const WIND_CLASS_LABELS: Record<WindClass, string> = {
  strong: '強風區(新竹/恆春/澎湖/沿海)',
  normal: '一般風區',
  weak: '弱風區(盆地/背風)',
};
const WIND_FULL_LOAD_HOURS: Record<WindClass, number> = {
  strong: 2500,
  normal: 1500,
  weak: 800,
};

/** 建物位置在某年份的日照係數(0~1,被樹蔭遮蔽的時數比例扣除) */
export function shadeFactorAt(
  project: HomesteadProject,
  speciesById: Map<string, PlantSpecies>,
  year: number,
  building: BuildingElement,
  latDeg = 23.5
): number {
  let daylight = 0;
  let sunny = 0;
  for (let month = 1; month <= 12; month += 2) {
    const day = dayOfYearForMonth(month);
    for (let hour = 8; hour <= 16; hour += 2) {
      const sun = solarPosition(latDeg, day, hour);
      if (sun.elevationDeg <= 0.5) continue;
      daylight++;
      const shadows = shadowShapes(project, speciesById, year, sun).filter(
        (s) => s.anchor.x !== building.position.x || s.anchor.y !== building.position.y
      );
      const p = building.position;
      let shaded = false;
      for (const s of shadows) {
        const dx = p.x - s.center.x;
        const dy = p.y - s.center.y;
        if (dx * dx + dy * dy <= s.radius * s.radius) {
          shaded = true;
          break;
        }
      }
      if (!shaded) sunny++;
    }
  }
  return daylight === 0 ? 1 : sunny / daylight;
}

/** 屋頂光電年發電量(kWh/年) */
export function solarRoofKwh(areaM2: number, shadeFactor: number): number {
  return areaM2 * ANNUAL_IRRADIATION * PV_EFFICIENCY * PERFORMANCE_RATIO * shadeFactor;
}

/**
 * 未來遮蔽偵測(本工具獨有價值):
 * 回傳 viewYear 之後第一個日照係數低於門檻的年份(樹長大遮到面板),無則 null。
 */
export function futureShadeYear(
  project: HomesteadProject,
  speciesById: Map<string, PlantSpecies>,
  fromYear: number,
  building: BuildingElement,
  maxYear = 50,
  threshold = 0.85
): number | null {
  for (let y = fromYear; y <= maxYear; y += 5) {
    if (shadeFactorAt(project, speciesById, y, building) < threshold) return y;
  }
  return null;
}

/** 小型風機年發電量(kWh/年)= 額定功率 × 年等效滿載小時 */
export function windTurbineKwh(ratedKw: number, windClass: WindClass): number {
  return ratedKw * WIND_FULL_LOAD_HOURS[windClass];
}

// ── 微水力(M12)──

import type { Point, Terrain } from '../types';
import { sampleHeight } from './terrain';

/** 溪流沿線落差 head(m):線上最高與最低高程差(依 M5 地勢自動計算) */
export function streamHead(terrain: Terrain, line: Point[]): number {
  if (line.length < 2) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const p of line) {
    const h = sampleHeight(terrain, p);
    if (h < min) min = h;
    if (h > max) max = h;
  }
  return Math.max(max - min, 0);
}

/**
 * 微水力年發電量(kWh/年)。
 * P = ρ × g × Q × H × η(規格書簡化公式,η 預設 0.6)
 * @param dryFactor 枯水期流量折減(預設 0.7)
 */
export function microHydroKwh(
  flowLps: number,
  headM: number,
  efficiency = 0.6,
  dryFactor = 0.7
): number {
  const powerW = 9.81 * flowLps * headM * efficiency; // ρg(Q/1000)H×1000 = 9.81·Q(L/s)·H
  return (powerW * 8760 * dryFactor) / 1000;
}
