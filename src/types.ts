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

// M13 食物森林層次
export type ForestLayer =
  | 'canopy' // 樹冠層
  | 'understory' // 林下層
  | 'shrub' // 灌木層
  | 'herb' // 草本層
  | 'groundcover' // 地被層
  | 'vine' // 爬藤層
  | 'root'; // 根系層

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
  forestLayer: ForestLayer; // 所屬食物森林層次(M13)
  isNative: boolean;
  sources: string[]; // 資料來源標註(規格書 M3)
}

// ── 放置元素(discriminated union)──

export type AreaType = 'forest' | 'garden' | 'meadow' | 'food_forest';

export interface PlantElement {
  id: string;
  kind: 'plant';
  speciesId: string;
  position: Point;
  plantedYear: number; // 第 N 年種植(M4 生命週期)
  removedYear?: number; // 第 N 年移除/砍伐(可選)
  note?: string;
}

export interface AreaElement {
  id: string;
  kind: 'area';
  areaType: AreaType;
  polygon: Point[];
  /** 食物森林:草本/地被/爬藤/根系層以配方勾選(P1 蔬菜草本以區塊抽象處理) */
  manualLayers?: ForestLayer[];
  note?: string;
}

/** 溪流(線元素,M2/M12 微水力)*/
export interface StreamElement {
  id: string;
  kind: 'stream';
  line: Point[];
  flowLps?: number; // 常流量估計(L/s,M12 微水力)
  note?: string;
}

/** 等高集水溝(swale,M13)*/
export interface SwaleElement {
  id: string;
  kind: 'swale';
  line: Point[];
  note?: string;
}

export interface WaterElement {
  id: string;
  kind: 'water';
  waterType: 'pond';
  polygon: Point[];
  note?: string;
}

export interface BuildingElement {
  id: string;
  kind: 'building';
  modelId: string; // 預設房型 id(M8)
  position: Point; // 中心點
  rotationDeg: number; // 0 = 正面朝南,順時針
  width: number; // 面寬(m)
  depth: number; // 進深(m)
  height: number; // 簷高/總高(m)
  solarRoofM2?: number; // 屋頂光電板面積(M12)
  note?: string;
}

export type PlacedElement =
  | PlantElement
  | AreaElement
  | WaterElement
  | BuildingElement
  | SwaleElement
  | StreamElement;

// ── 邊界綠籬(M2:沿地界自動佈植)──

export interface HedgeGap {
  t: number; // 出入口中心位置:沿地界周長的比例(0~1,自第一個頂點起算)
  width: number; // 出入口寬度(m)
}

export interface BoundaryHedgeConfig {
  shrubSpeciesId: string; // 綠籬灌木
  spacing: number; // 灌木株距(m)
  treeSpeciesId: string | null; // 間植喬木(null = 純灌木籬)
  treeEvery: number; // 每 N 株灌木插一株喬木(0 = 不插)
  inset: number; // 自地界線內縮距離(m)
  plantedYear: number; // 種植年份(M4 時間軸)
  gaps: HedgeGap[];
}

// ── 地勢(M5)──

export interface Terrain {
  resolution: number; // 網格解析度(m)
  origin: Point; // 網格左上角的世界座標
  cols: number;
  rows: number;
  grid: number[][]; // 高程值(m),grid[row][col]
}

// ── 專案 ──

export interface ProjectSettings {
  northAngle: number; // 指北針角度(度,0 = 上方為北)
  gridVisible: boolean;
  gridSize: 1 | 5 | 10; // 網格間距(m)
  // 分析圖層開關(M5/M13)
  showContours: boolean;
  showSlope: boolean;
  showZones: boolean;
  contourInterval: 0.5 | 1;
  homePosition: Point | null; // 住家位置(M13 分區分析中心)
  // M7 環境分析
  showShadows: boolean;
  showInsolation: boolean;
  showFlow: boolean;
  showWind: boolean;
  sunMonth: number; // 1-12
  sunHour: number; // 6-18(太陽時)
  windDir: 'NE' | 'SW' | 'E';
  // M9 自給自足
  people: number;
  // M12 能源
  windTurbineKw: number; // 0 = 無風機
  windClass: 'strong' | 'normal' | 'weak';
  // M13 扇形分析
  showSectors: boolean;
}

export interface HomesteadProject {
  name: string;
  boundary: Point[]; // 地界多邊形(不重複首點;空陣列 = 尚未繪製)
  terrain: Terrain | null; // 地勢(M5;null = 平地)
  hedge: BoundaryHedgeConfig | null; // 邊界綠籬(null = 未設置)
  elements: PlacedElement[];
  settings: ProjectSettings;
}

export const PROJECT_FILE_VERSION = 1;

export interface ProjectFile {
  version: number;
  savedAt: string;
  project: HomesteadProject;
}
