// 成長曲線插值 — 規格書 3.4:曲線關鍵點線性插值
import type { YearValue } from '../types';

/**
 * 以線性插值取得曲線在某年份的值。
 * 年份小於首個關鍵點時取首值、大於末個關鍵點時取末值(clamp)。
 * 曲線需依 year 遞增排序。
 */
export function interpolateCurve(curve: YearValue[], year: number): number {
  if (curve.length === 0) return 0;
  if (year <= curve[0].year) return curve[0].value;
  const last = curve[curve.length - 1];
  if (year >= last.year) return last.value;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    if (year <= b.year) {
      const t = (year - a.year) / (b.year - a.year);
      return a.value + t * (b.value - a.value);
    }
  }
  return last.value;
}

/** 成熟冠幅半徑(m)= 冠幅曲線末值 / 2 */
export function matureCanopyRadius(canopyCurve: YearValue[]): number {
  if (canopyCurve.length === 0) return 0;
  return canopyCurve[canopyCurve.length - 1].value / 2;
}

/** 某樹齡的冠幅半徑(m)(M4 時間軸) */
export function canopyRadiusAtAge(canopyCurve: YearValue[], age: number): number {
  return interpolateCurve(canopyCurve, age) / 2;
}

/** 植物在某年份是否存活(已種植且未移除) */
export function isPlantAlive(
  plantedYear: number,
  removedYear: number | undefined,
  year: number
): boolean {
  return year >= plantedYear && (removedYear === undefined || year < removedYear);
}
