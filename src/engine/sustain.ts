// M9 自給自足計算 — 所有數值皆為「規劃參考值」,UI 需明示簡化假設
import type { HomesteadProject, PlantSpecies } from '../types';
import { polygonArea } from './geometry';
import { isPlantAlive } from './growth';
import { forestCoverageRatio } from './metrics';

// 簡化假設常數
const KCAL_PER_PERSON_DAY = 2000;
const FOOD_FROM_LAND_TARGET = 0.6; // 目標:六成熱量來自家園(其餘主食外購)
const GARDEN_KG_PER_M2_YEAR = 3; // 菜園年產量
const GARDEN_KCAL_PER_KG = 250;
const WATER_L_PER_PERSON_DAY = 120;
const ANNUAL_RAIN_M = 1.8; // 台灣平均年雨量估
const RUNOFF_COEF = 0.75;
const FIREWOOD_T_PER_HA_YEAR = 4; // 永續採伐量
const FIREWOOD_NEED_T_PER_YEAR = 2; // 家庭炊事+熱水估

export interface SustainReport {
  fruitKgPerYear: number;
  gardenKgPerYear: number;
  kcalPerDay: number;
  foodRatio: number; // 供給 / (需求 × 目標比)
  waterCollectedM3: number;
  waterRatio: number;
  firewoodSupplyT: number;
  firewoodRatio: number;
}

/** 某年份的植物產量:結果始年後線性爬升至成熟年 */
export function plantYieldAtAge(species: PlantSpecies, age: number): number {
  const y = species.yield;
  if (!y || age < y.startYear) return 0;
  const rampYears = Math.max(species.growth.matureYears - y.startYear, 1);
  const factor = Math.min((age - y.startYear + 1) / rampYears, 1);
  return y.matureKgPerYear * factor;
}

export function selfSufficiency(
  project: HomesteadProject,
  speciesById: Map<string, PlantSpecies>,
  year: number,
  people: number
): SustainReport {
  let fruitKg = 0;
  let fruitKcalYear = 0;
  for (const el of project.elements) {
    if (el.kind !== 'plant') continue;
    if (!isPlantAlive(el.plantedYear, el.removedYear, year)) continue;
    const species = speciesById.get(el.speciesId);
    if (!species?.yield) continue;
    const kg = plantYieldAtAge(species, year - el.plantedYear);
    fruitKg += kg;
    fruitKcalYear += kg * species.yield.kcalPerKg;
  }

  let gardenM2 = 0;
  let pondM2 = 0;
  for (const el of project.elements) {
    if (el.kind === 'area' && el.areaType === 'garden') gardenM2 += polygonArea(el.polygon);
    if (el.kind === 'water') pondM2 += polygonArea(el.polygon);
  }
  const gardenKg = gardenM2 * GARDEN_KG_PER_M2_YEAR;
  const kcalPerDay = (fruitKcalYear + gardenKg * GARDEN_KCAL_PER_KG) / 365;

  const foodNeed = people * KCAL_PER_PERSON_DAY * FOOD_FROM_LAND_TARGET;
  const foodRatio = foodNeed > 0 ? kcalPerDay / foodNeed : 0;

  const waterCollectedM3 = pondM2 * ANNUAL_RAIN_M * RUNOFF_COEF;
  const waterNeedM3 = (people * WATER_L_PER_PERSON_DAY * 365) / 1000;
  const waterRatio = waterNeedM3 > 0 ? waterCollectedM3 / waterNeedM3 : 0;

  const boundaryM2 = polygonArea(project.boundary);
  const forestHa = (forestCoverageRatio(project, speciesById, 2, year) * boundaryM2) / 10000;
  const firewoodSupplyT = forestHa * FIREWOOD_T_PER_HA_YEAR;
  const firewoodRatio = firewoodSupplyT / FIREWOOD_NEED_T_PER_YEAR;

  return {
    fruitKgPerYear: fruitKg,
    gardenKgPerYear: gardenKg,
    kcalPerDay,
    foodRatio,
    waterCollectedM3,
    waterRatio,
    firewoodSupplyT,
    firewoodRatio,
  };
}
