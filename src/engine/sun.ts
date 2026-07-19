// M7 光照分析 — 太陽位置(簡化 NOAA/Cooper 公式)與陰影投影
// 座標約定:平面 x = 東、y = 南(SVG y 向下,上方為北);方位角自北順時針
import type { HomesteadProject, PlantSpecies, Point } from '../types';
import { boundingBox, pointInPolygon } from './geometry';
import { canopyRadiusAtAge, interpolateCurve, isPlantAlive } from './growth';

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export interface SunPosition {
  elevationDeg: number; // 仰角(<0 = 夜間)
  azimuthDeg: number; // 方位角(0=北、90=東、180=南、270=西)
}

/** 太陽位置:緯度 + 年中第幾日 + 太陽時(12 = 正午) */
export function solarPosition(latDeg: number, dayOfYear: number, solarHour: number): SunPosition {
  const lat = rad(latDeg);
  // Cooper 赤緯公式
  const decl = rad(23.45) * Math.sin(rad((360 * (284 + dayOfYear)) / 365));
  const hourAngle = rad(15 * (solarHour - 12));
  const sinEl =
    Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const el = Math.asin(Math.min(Math.max(sinEl, -1), 1));
  const cosAz =
    (Math.sin(decl) - Math.sin(el) * Math.sin(lat)) / (Math.cos(el) * Math.cos(lat) || 1e-9);
  let az = Math.acos(Math.min(Math.max(cosAz, -1), 1));
  if (hourAngle > 0) az = 2 * Math.PI - az; // 下午在西半邊
  return { elevationDeg: deg(el), azimuthDeg: deg(az) };
}

/** 月份(1-12)取每月 15 日的年中日序 */
export function dayOfYearForMonth(month: number): number {
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return cum[Math.min(Math.max(month, 1), 12) - 1] + 15;
}

/**
 * 高度 h 的物體的影子位移向量(平面座標)。
 * 太陽在地平線下回傳 null。影子方向 = 方位角反方向。
 */
export function shadowVector(sun: SunPosition, heightM: number): Point | null {
  if (sun.elevationDeg <= 0.5) return null;
  const d = heightM / Math.tan(rad(sun.elevationDeg));
  const az = rad(sun.azimuthDeg);
  // 太陽方向單位向量(x=東, y=南):(sin az, -cos az);影子反向
  return { x: -Math.sin(az) * d, y: Math.cos(az) * d };
}

export interface ShadowShape {
  center: Point; // 樹冠影子中心
  radius: number; // 影子半徑(≈ 冠幅半徑)
  anchor: Point; // 樹的位置(畫影子連接線用)
}

/** 指定時刻所有存活植物的樹冠陰影(球形樹冠近似 → 圓形影子) */
export function shadowShapes(
  project: HomesteadProject,
  speciesById: Map<string, PlantSpecies>,
  viewYear: number,
  sun: SunPosition
): ShadowShape[] {
  const shapes: ShadowShape[] = [];
  if (sun.elevationDeg <= 0.5) return shapes;
  for (const el of project.elements) {
    // 建物陰影(M8):以外接圓近似
    if (el.kind === 'building') {
      const vec = shadowVector(sun, el.height * 0.8);
      if (!vec) continue;
      shapes.push({
        center: { x: el.position.x + vec.x, y: el.position.y + vec.y },
        radius: Math.max(el.width, el.depth) / 2,
        anchor: el.position,
      });
      continue;
    }
    if (el.kind !== 'plant') continue;
    if (!isPlantAlive(el.plantedYear, el.removedYear, viewYear)) continue;
    const species = speciesById.get(el.speciesId);
    if (!species) continue;
    const age = viewYear - el.plantedYear;
    const height = interpolateCurve(species.growth.heightCurve, age);
    const radius = canopyRadiusAtAge(species.growth.canopyCurve, age);
    if (height < 0.3 || radius < 0.1) continue;
    // 樹冠中心高 ≈ 0.7 × 樹高
    const vec = shadowVector(sun, height * 0.7);
    if (!vec) continue;
    shapes.push({
      center: { x: el.position.x + vec.x, y: el.position.y + vec.y },
      radius,
      anchor: el.position,
    });
  }
  return shapes;
}

export interface InsolationGrid {
  origin: Point;
  step: number;
  cols: number;
  rows: number;
  /** 0~1 = 日照時數比例(被遮蔭扣除);-1 = 地界外 */
  values: number[][];
}

/**
 * 全年日照累積熱圖:逐月(每月 15 日)× 白天逐時取樣,
 * 計算每格「未被樹冠遮蔭的日照時數比例」。
 */
export function insolationGrid(
  project: HomesteadProject,
  speciesById: Map<string, PlantSpecies>,
  viewYear: number,
  latDeg = 23.5,
  step = 4
): InsolationGrid | null {
  if (project.boundary.length < 3) return null;
  const box = boundingBox(project.boundary);
  const cols = Math.ceil((box.maxX - box.minX) / step);
  const rows = Math.ceil((box.maxY - box.minY) / step);
  const origin = { x: box.minX, y: box.minY };

  // 預先算出所有取樣時刻的陰影
  const timeShadows: ShadowShape[][] = [];
  let totalDaylight = 0;
  for (let month = 1; month <= 12; month += 2) {
    const day = dayOfYearForMonth(month);
    for (let hour = 7; hour <= 17; hour++) {
      const sun = solarPosition(latDeg, day, hour);
      if (sun.elevationDeg <= 0.5) continue;
      totalDaylight++;
      timeShadows.push(shadowShapes(project, speciesById, viewYear, sun));
    }
  }
  if (totalDaylight === 0) return null;

  const values: number[][] = Array.from({ length: rows }, () => Array(cols).fill(-1));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = { x: origin.x + (c + 0.5) * step, y: origin.y + (r + 0.5) * step };
      if (!pointInPolygon(p, project.boundary)) continue;
      let sunny = 0;
      for (const shadows of timeShadows) {
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
      values[r][c] = sunny / totalDaylight;
    }
  }
  return { origin, step, cols, rows, values };
}
