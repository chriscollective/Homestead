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
