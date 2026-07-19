// 設計原則檢查引擎(P1:森林覆蓋比例)— 規格書 M2「祖傳家園規則引擎」
import type { HomesteadProject, PlantSpecies, Point } from '../types';
import { boundingBox, pointInPolygon, polygonArea } from './geometry';
import { matureCanopyRadius } from './growth';

export const FOREST_TARGET_RATIO = 0.5; // 祖傳家園原則:森林約佔一半

const TREE_CATEGORIES = new Set(['tree_fruit', 'tree_forest', 'bamboo']);

/**
 * 森林覆蓋比例:以網格取樣估算(可正確處理樹冠與林地區塊的重疊)。
 * 取樣點落在「林地區塊內」或「任一喬木/竹類成熟樹冠投影圈內」即視為森林覆蓋。
 * @param sampleStep 取樣間距(m),1 公頃約 10000 點,足夠即時計算
 */
export function forestCoverageRatio(
  project: HomesteadProject,
  speciesById: Map<string, PlantSpecies>,
  sampleStep = 1
): number {
  const boundary = project.boundary;
  if (boundary.length < 3) return 0;

  const forestPolygons: Point[][] = [];
  const canopies: { center: Point; radius: number }[] = [];

  for (const el of project.elements) {
    if (el.kind === 'area' && el.areaType === 'forest') {
      forestPolygons.push(el.polygon);
    } else if (el.kind === 'plant') {
      const species = speciesById.get(el.speciesId);
      if (species && TREE_CATEGORIES.has(species.category)) {
        const radius = matureCanopyRadius(species.growth.canopyCurve);
        if (radius > 0) canopies.push({ center: el.position, radius });
      }
    }
  }
  if (forestPolygons.length === 0 && canopies.length === 0) return 0;

  const box = boundingBox(boundary);
  let insideCount = 0;
  let coveredCount = 0;
  for (let y = box.minY + sampleStep / 2; y < box.maxY; y += sampleStep) {
    for (let x = box.minX + sampleStep / 2; x < box.maxX; x += sampleStep) {
      const p = { x, y };
      if (!pointInPolygon(p, boundary)) continue;
      insideCount++;
      if (isForestCovered(p, forestPolygons, canopies)) coveredCount++;
    }
  }
  if (insideCount === 0) return 0;
  return coveredCount / insideCount;
}

function isForestCovered(
  p: Point,
  forestPolygons: Point[][],
  canopies: { center: Point; radius: number }[]
): boolean {
  for (const c of canopies) {
    const dx = p.x - c.center.x;
    const dy = p.y - c.center.y;
    if (dx * dx + dy * dy <= c.radius * c.radius) return true;
  }
  for (const poly of forestPolygons) {
    if (pointInPolygon(p, poly)) return true;
  }
  return false;
}

/**
 * 喬木間距檢查(M2 碰撞/間距提示):
 * 兩株樹距離小於「成熟冠幅半徑和 × overlapFactor」時視為過近。
 */
export function spacingConflicts(
  project: HomesteadProject,
  speciesById: Map<string, PlantSpecies>,
  overlapFactor = 0.7
): { a: string; b: string }[] {
  const trees: { id: string; position: Point; radius: number }[] = [];
  for (const el of project.elements) {
    if (el.kind !== 'plant') continue;
    const species = speciesById.get(el.speciesId);
    if (!species || !TREE_CATEGORIES.has(species.category)) continue;
    const radius = matureCanopyRadius(species.growth.canopyCurve);
    if (radius > 0) trees.push({ id: el.id, position: el.position, radius });
  }
  const conflicts: { a: string; b: string }[] = [];
  for (let i = 0; i < trees.length; i++) {
    for (let j = i + 1; j < trees.length; j++) {
      const t1 = trees[i];
      const t2 = trees[j];
      const limit = (t1.radius + t2.radius) * overlapFactor;
      const dx = t1.position.x - t2.position.x;
      const dy = t1.position.y - t2.position.y;
      if (dx * dx + dy * dy < limit * limit) {
        conflicts.push({ a: t1.id, b: t2.id });
      }
    }
  }
  return conflicts;
}

/** 各類元素統計(儀表板用) */
export function elementStats(project: HomesteadProject): {
  plants: number;
  areas: number;
  ponds: number;
  gardenAreaM2: number;
  pondAreaM2: number;
} {
  let plants = 0;
  let areas = 0;
  let ponds = 0;
  let gardenAreaM2 = 0;
  let pondAreaM2 = 0;
  for (const el of project.elements) {
    if (el.kind === 'plant') plants++;
    else if (el.kind === 'area') {
      areas++;
      if (el.areaType === 'garden') gardenAreaM2 += polygonArea(el.polygon);
    } else if (el.kind === 'water') {
      ponds++;
      pondAreaM2 += polygonArea(el.polygon);
    }
  }
  return { plants, areas, ponds, gardenAreaM2, pondAreaM2 };
}
