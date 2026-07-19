// M13 樸門設計工具(後半):食物森林層次完整度 + 元素關係(Relative Location)
import type { ForestLayer, HomesteadProject, PlantSpecies, Point } from '../types';
import { distance, pointInPolygon, polygonArea } from './geometry';
import { sampleHeight } from './terrain';

export const LAYER_LABELS: Record<ForestLayer, string> = {
  canopy: '樹冠層',
  understory: '林下層',
  shrub: '灌木層',
  herb: '草本層',
  groundcover: '地被層',
  vine: '爬藤層',
  root: '根系層',
};

export const ALL_LAYERS: ForestLayer[] = [
  'canopy',
  'understory',
  'shrub',
  'herb',
  'groundcover',
  'vine',
  'root',
];

/** 手動勾選的層(P1 蔬菜/草本以區塊抽象,無逐株資料) */
export const MANUAL_LAYERS: ForestLayer[] = ['herb', 'groundcover', 'vine', 'root'];

export interface LayerReport {
  present: ForestLayer[];
  missing: ForestLayer[];
}

/** 食物森林區塊的層次完整度:區塊內植物自動偵測 + 手動勾選層 */
export function foodForestLayers(
  project: HomesteadProject,
  areaId: string,
  speciesById: Map<string, PlantSpecies>
): LayerReport | null {
  const area = project.elements.find((el) => el.id === areaId);
  if (!area || area.kind !== 'area' || area.areaType !== 'food_forest') return null;
  const present = new Set<ForestLayer>(area.manualLayers ?? []);
  for (const el of project.elements) {
    if (el.kind !== 'plant') continue;
    if (!pointInPolygon(el.position, area.polygon)) continue;
    const species = speciesById.get(el.speciesId);
    if (species) present.add(species.forestLayer);
  }
  return {
    present: ALL_LAYERS.filter((l) => present.has(l)),
    missing: ALL_LAYERS.filter((l) => !present.has(l)),
  };
}

export interface SynergyHint {
  kind: 'good' | 'suggest';
  message: string;
}

function centroid(polygon: Point[]): Point {
  const n = polygon.length;
  return {
    x: polygon.reduce((s, p) => s + p.x, 0) / n,
    y: polygon.reduce((s, p) => s + p.y, 0) / n,
  };
}

/**
 * 元素關係分析(輕量規則表):正向提示、不強制。
 * 規則:雞舍鄰菜園(雞糞堆肥)、池塘位於菜園上坡(重力給水)、
 * 溫室鄰住家、swale 上坡於菜園(集水滲灌)。
 */
export function synergyHints(project: HomesteadProject): SynergyHint[] {
  const hints: SynergyHint[] = [];
  const gardens = project.elements.filter(
    (el) => el.kind === 'area' && el.areaType === 'garden'
  );
  const coops = project.elements.filter(
    (el) => el.kind === 'building' && el.modelId === 'coop'
  );
  const greenhouses = project.elements.filter(
    (el) => el.kind === 'building' && el.modelId === 'greenhouse'
  );
  const ponds = project.elements.filter((el) => el.kind === 'water');
  const home = project.settings.homePosition;

  for (const coop of coops) {
    if (coop.kind !== 'building') continue;
    const near = gardens.some(
      (g) => g.kind === 'area' && distance(coop.position, centroid(g.polygon)) <= 20
    );
    hints.push(
      near
        ? { kind: 'good', message: '✓ 雞舍鄰近菜園(≤20m):雞糞就近堆肥、雞可吃菜渣蟲害' }
        : { kind: 'suggest', message: '雞舍距菜園較遠 — 移近可形成雞糞堆肥/除蟲的互利循環' }
    );
  }

  if (project.terrain) {
    for (const pond of ponds) {
      if (pond.kind !== 'water') continue;
      const pondH = sampleHeight(project.terrain, centroid(pond.polygon));
      for (const g of gardens) {
        if (g.kind !== 'area') continue;
        const gH = sampleHeight(project.terrain, centroid(g.polygon));
        if (pondH > gH + 0.5) {
          hints.push({
            kind: 'good',
            message: `✓ 池塘高於菜園約 ${(pondH - gH).toFixed(1)}m:可重力給水,不需抽水`,
          });
        } else if (gardens.length > 0 && pondH < gH - 0.5) {
          hints.push({
            kind: 'suggest',
            message: '池塘低於菜園 — 若移至菜園上坡可重力給水(樸門相對位置原則)',
          });
        }
        break; // 每座池塘只對最近菜園提示一次,避免洗版
      }
    }
  }

  for (const gh of greenhouses) {
    if (gh.kind !== 'building' || !home) continue;
    const near = distance(gh.position, home) <= 30;
    if (near) {
      hints.push({ kind: 'good', message: '✓ 溫室鄰近住家(Zone 1):育苗照顧動線短' });
    }
  }

  return hints;
}

/** swale 是否貼合等高線:回傳線上高程的最大落差(m);無地形回傳 null */
export function swaleLevelness(
  project: HomesteadProject,
  line: Point[]
): number | null {
  if (!project.terrain || line.length < 2) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const p of line) {
    const h = sampleHeight(project.terrain, p);
    if (h < min) min = h;
    if (h > max) max = h;
  }
  return max - min;
}

export { polygonArea };
