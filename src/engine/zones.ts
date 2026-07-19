// M13 樸門分區分析(前半):距離環 + 頻率-距離檢查
import type { HomesteadProject, Point } from '../types';
import { distance } from './geometry';

/**
 * 分區距離環:依「基地實際大小」動態縮放(而非固定公尺數)。
 * R = 住家到地界最遠頂點的距離;Zone 1~4 為 R 的 15%/35%/60%/85%,
 * Zone 4 之外(仍在地界內)即 Zone 5 野地 — 確保分區環貼合家園範圍。
 */
export function zoneRadii(
  boundary: Point[],
  home: Point
): { zone: number; radius: number; label: string }[] {
  let r = 0;
  for (const p of boundary) r = Math.max(r, distance(home, p));
  if (r <= 0) r = 50;
  return [
    { zone: 1, radius: r * 0.15, label: 'Zone 1 日常生活區' },
    { zone: 2, radius: r * 0.35, label: 'Zone 2 食物森林/家禽' },
    { zone: 3, radius: r * 0.6, label: 'Zone 3 主要作物區' },
    { zone: 4, radius: r * 0.85, label: 'Zone 4 半野放林地' },
  ];
}

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
  // 每日照顧的元素(菜園)建議落在 Zone 2 內 — 門檻隨基地大小縮放
  const maxDist = zoneRadii(project.boundary, home)[1].radius;
  const warnings: ZoneWarning[] = [];
  for (const el of project.elements) {
    if (el.kind === 'area' && el.areaType === 'garden') {
      const d = distance(home, polygonCentroid(el.polygon));
      if (d > maxDist) {
        warnings.push({
          elementId: el.id,
          message: `菜園距住家約 ${Math.round(d)}m,每日往返成本高,建議移入 Zone 1-2(${Math.round(maxDist)}m 內)`,
        });
      }
    }
  }
  return warnings;
}
