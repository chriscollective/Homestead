// M7 風向分析 — 台灣季風模型與防風林減風區(簡化規則:樹高 × 倍數的漸衰)
import type { HomesteadProject, PlantSpecies, Point } from '../types';
import { canopyRadiusAtAge, interpolateCurve, isPlantAlive } from './growth';

export type WindDir = 'NE' | 'SW' | 'E';

export const WIND_LABELS: Record<WindDir, string> = {
  NE: '冬季東北季風',
  SW: '夏季西南風',
  E: '颱風情境(東)',
};

/** 風的行進方向單位向量(平面座標 x=東、y=南)。NE = 來自東北 → 吹向西南 */
export function windVector(dir: WindDir): Point {
  const s = Math.SQRT1_2;
  switch (dir) {
    case 'NE':
      return { x: -s, y: s };
    case 'SW':
      return { x: s, y: -s };
    case 'E':
      return { x: -1, y: 0 };
  }
}

export interface ShelterZone {
  center: Point; // 減風橢圓中心
  halfLength: number; // 順風向半軸(= 樹高 × 倍數 / 2)
  halfWidth: number; // 橫風向半軸
  angleDeg: number; // 橢圓長軸角度
}

const SHELTER_MULTIPLIER = 12; // 背風減風區長度 ≈ 樹高 × 10~15 倍(取 12)
const MIN_HEIGHT = 2; // 低於 2m 不視為有效防風

/** 防風林效果:每株夠高的存活樹在背風側形成減風橢圓 */
export function shelterZones(
  project: HomesteadProject,
  speciesById: Map<string, PlantSpecies>,
  viewYear: number,
  dir: WindDir
): ShelterZone[] {
  const wind = windVector(dir);
  const angleDeg = (Math.atan2(wind.y, wind.x) * 180) / Math.PI;
  const zones: ShelterZone[] = [];
  for (const el of project.elements) {
    if (el.kind !== 'plant') continue;
    if (!isPlantAlive(el.plantedYear, el.removedYear, viewYear)) continue;
    const species = speciesById.get(el.speciesId);
    if (!species) continue;
    const age = viewYear - el.plantedYear;
    const height = interpolateCurve(species.growth.heightCurve, age);
    if (height < MIN_HEIGHT) continue;
    const radius = canopyRadiusAtAge(species.growth.canopyCurve, age);
    const length = height * SHELTER_MULTIPLIER;
    zones.push({
      center: {
        x: el.position.x + (wind.x * length) / 2,
        y: el.position.y + (wind.y * length) / 2,
      },
      halfLength: length / 2,
      halfWidth: Math.max(radius, height * 0.4),
      angleDeg,
    });
  }
  return zones;
}
