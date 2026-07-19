// M8 預設房型庫(刻意不做自由建模)
export interface BuildingModel {
  id: string;
  label: string;
  width: number; // 面寬 m
  depth: number; // 進深 m
  height: number; // 高 m
  color: string;
}

export const BUILDING_MODELS: BuildingModel[] = [
  { id: 'cabin', label: '小木屋', width: 6, depth: 5, height: 4, color: '#a9825f' },
  { id: 'bungalow', label: '平房', width: 10, depth: 8, height: 4.5, color: '#c2a878' },
  { id: 'two_story', label: '二層宅', width: 10, depth: 8, height: 7, color: '#b39b7d' },
  { id: 'cob_house', label: '土團屋', width: 7, depth: 7, height: 4, color: '#c8965f' },
  { id: 'tool_shed', label: '工具間', width: 4, depth: 3, height: 3, color: '#9c8b74' },
  { id: 'greenhouse', label: '溫室', width: 8, depth: 4, height: 3, color: '#9fc5b8' },
  { id: 'coop', label: '雞舍', width: 3, depth: 2, height: 2.5, color: '#b5a184' },
];

export const buildingModelById = new Map(BUILDING_MODELS.map((m) => [m.id, m]));

/** 旋轉角 → 正面朝向(0 = 南,順時針) */
export function facingLabel(rotationDeg: number): string {
  const dirs = ['南', '西南', '西', '西北', '北', '東北', '東', '東南'];
  const idx = Math.round((((rotationDeg % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}
