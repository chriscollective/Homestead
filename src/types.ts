// 核心資料模型 — 依規格書 3.2(P1 範圍子集)
// 座標系統:內部統一使用「公尺」為單位的本地平面座標(規格書 3.3-4)

export interface Point {
  x: number;
  y: number;
}

export interface YearValue {
  year: number;
  value: number;
}

export type ClimateZone = 'north' | 'central' | 'south' | 'east' | 'mountain';

export type PlantCategory = 'tree_fruit' | 'tree_forest' | 'shrub' | 'bamboo';

export type PlantTag =
  | 'windbreak' // 防風
  | 'nectar' // 蜜源
  | 'nitrogen' // 固氮
  | 'bird' // 誘鳥
  | 'medicinal' // 藥用
  | 'timber' // 建材
  | 'firewood'; // 薪柴

export interface PlantSpecies {
  id: string;
  nameZh: string;
  nameSci: string;
  category: PlantCategory;
  growth: {
    matureYears: number;
    heightCurve: YearValue[]; // 各年份高度(m),線性插值
    canopyCurve: YearValue[]; // 各年份冠幅直徑(m),線性插值
    lifespan: number;
  };
  needs: {
    sun: 'full' | 'partial' | 'shade';
    water: 1 | 2 | 3;
    windTolerance: 1 | 2 | 3; // 3 = 耐颱風
  };
  climateZones: ClimateZone[];
  yield?: {
    startYear: number; // 結果始年
    matureKgPerYear: number; // 成熟期年產量估計(kg)
    harvestMonths: number[]; // 產季月份 1-12
    kcalPerKg: number; // 熱量密度(供 M9)
  };
  tags: PlantTag[];
  isNative: boolean;
  sources: string[]; // 資料來源標註(規格書 M3)
}

// ── 放置元素(discriminated union)──

export type AreaType = 'forest' | 'garden' | 'meadow';

export interface PlantElement {
  id: string;
  kind: 'plant';
  speciesId: string;
  position: Point;
  plantedYear: number;
  note?: string;
}

export interface AreaElement {
  id: string;
  kind: 'area';
  areaType: AreaType;
  polygon: Point[];
  note?: string;
}

export interface WaterElement {
  id: string;
  kind: 'water';
  waterType: 'pond';
  polygon: Point[];
  note?: string;
}

export type PlacedElement = PlantElement | AreaElement | WaterElement;

// ── 專案 ──

export interface ProjectSettings {
  northAngle: number; // 指北針角度(度,0 = 上方為北)
  gridVisible: boolean;
  gridSize: 1 | 5 | 10; // 網格間距(m)
}

export interface HomesteadProject {
  name: string;
  boundary: Point[]; // 地界多邊形(不重複首點;空陣列 = 尚未繪製)
  elements: PlacedElement[];
  settings: ProjectSettings;
}

export const PROJECT_FILE_VERSION = 1;

export interface ProjectFile {
  version: number;
  savedAt: string;
  project: HomesteadProject;
}
