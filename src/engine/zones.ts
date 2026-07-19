// M13 樸門分區分析(前半):距離環 + 頻率-距離檢查
import type { HomesteadProject, Point } from '../types';
import { distance } from './geometry';

/** 分區距離環(以住家為中心的半徑,m)— 樸門 Zone 1~4;環外為 Zone 5 野地 */
export const ZONE_RADII: { zone: number; radius: number; label: string }[] = [
  { zone: 1, radius: 15, label: 'Zone 1 日常生活區' },
  { zone: 2, radius: 40, label: 'Zone 2 食物森林/家禽' },
  { zone: 3, radius: 70, label: 'Zone 3 主要作物區' },
  { zone: 4, radius: 110, label: 'Zone 4 半野放林地' },
];

/** 需要每日照顧的元素建議距離上限(菜園 → Zone 1-2) */
const GARDEN_MAX_DIST = 40;

export interface ZoneWarning {
  elementId: string;
  message: string;
}

function polygonCentroid(polygon: Point[]): Point {
  const n = polygon.length;
  return {
    x: polygon.reduce((s, p) => s + p.x, 0) / n,
    y: polygon.reduce((s, p) => s + p.y, 0) / n,
  };
}

/**
 * 頻率-距離檢查:每日往返的元素(菜園)距住家過遠時提出建議。
 * 「建議不強制」— 僅回傳提示訊息。
 */
export function zoneWarnings(project: HomesteadProject): ZoneWarning[] {
  const home = project.settings.homePosition;
  if (!home) return [];
  const warnings: ZoneWarning[] = [];
  for (const el of project.elements) {
    if (el.kind === 'area' && el.areaType === 'garden') {
      const d = distance(home, polygonCentroid(el.polygon));
      if (d > GARDEN_MAX_DIST) {
        warnings.push({
          elementId: el.id,
          message: `菜園距住家約 ${Math.round(d)}m,每日往返成本高,建議移入 Zone 1-2(${GARDEN_MAX_DIST}m 內)`,
        });
      }
    }
  }
  return warnings;
}
