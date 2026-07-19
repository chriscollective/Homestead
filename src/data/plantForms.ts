// 各物種的 3D 低模造型描述(M6)— 低模風格但每種植物有辨識度
// 造型依真實樹形:芒果寬圓冠、相思樹傘形、竹類桿叢、木瓜單幹傘頂…
// 面數極低(每株 3~8 個簡單幾何體),效能與單球體樹相差無幾。
import type { PlantCategory } from '../types';

export type CrownForm =
  | 'round' // 圓球冠(多球堆疊,常見闊葉樹)
  | 'spreading' // 寬展冠(比高更寬,芒果/樟樹/茄苳)
  | 'conical' // 圓錐層疊(針葉樹)
  | 'columnar' // 高瘦橢圓(酪梨/波羅蜜)
  | 'umbrella' // 傘形平頂(相思樹)
  | 'open' // 疏朗冠(苦楝/九芎)
  | 'palm' // 單幹頂葉(木瓜)
  | 'banana' // 大型拱葉(香蕉)
  | 'bamboo' // 桿叢(竹類)
  | 'shrub'; // 灌木叢(無明顯主幹)

export interface PlantForm {
  crown: CrownForm;
  foliage: string; // 主葉色
  foliage2?: string; // 次葉色(斑駁變化)
  trunk?: string; // 樹幹色(預設褐)
  flower?: string; // 花/果點綴色(少量小球)
}

export const DEFAULT_FORMS: Record<PlantCategory, PlantForm> = {
  tree_fruit: { crown: 'round', foliage: '#4f9e6b' },
  tree_forest: { crown: 'round', foliage: '#2d6a4f' },
  shrub: { crown: 'shrub', foliage: '#79b791' },
  bamboo: { crown: 'bamboo', foliage: '#84a85c' },
};

export const PLANT_FORMS: Record<string, PlantForm> = {
  // ── 果樹 ──
  mango: { crown: 'spreading', foliage: '#2e6b3f', foliage2: '#3f8050' },
  longan: { crown: 'round', foliage: '#3a7d44', foliage2: '#4c8f52' },
  lychee: { crown: 'round', foliage: '#356e41', foliage2: '#47814f', flower: '#c2554f' },
  citrus: { crown: 'round', foliage: '#2f7a3d', flower: '#e8a33d' },
  guava: { crown: 'open', foliage: '#7fae6a', trunk: '#b9a184' },
  papaya: { crown: 'palm', foliage: '#4c9a4f', trunk: '#8f9b6e' },
  banana: { crown: 'banana', foliage: '#5aa84e', trunk: '#7fa05a' },
  avocado: { crown: 'columnar', foliage: '#2c5f3e', foliage2: '#3d7350' },
  wax_apple: { crown: 'round', foliage: '#4c8f5a', flower: '#d46a75' },
  persimmon: { crown: 'open', foliage: '#4e8a4a', flower: '#e07b2a' },
  jackfruit: { crown: 'columnar', foliage: '#3f7d46' },
  mulberry: { crown: 'spreading', foliage: '#5b9552', foliage2: '#6ca55e' },
  kumquat: { crown: 'shrub', foliage: '#35803f', flower: '#e8a33d' },
  // ── 林木 ──
  camphor: { crown: 'spreading', foliage: '#355e3b', foliage2: '#476f47' },
  taiwan_incense_cedar: { crown: 'conical', foliage: '#2a5240', foliage2: '#356049' },
  formosan_michelia: { crown: 'columnar', foliage: '#33684a' },
  griffith_ash: { crown: 'round', foliage: '#5f9b57', foliage2: '#70a862' },
  sweetgum: { crown: 'conical', foliage: '#4f8a48', foliage2: '#659a52' },
  ring_cupped_oak: { crown: 'round', foliage: '#3c6b45', foliage2: '#4d7c50' },
  taiwan_acacia: { crown: 'umbrella', foliage: '#55803e', foliage2: '#668f48' },
  chinaberry: { crown: 'open', foliage: '#6aa45e', flower: '#b9a3d0' },
  autumn_maple: { crown: 'spreading', foliage: '#2f6d43', foliage2: '#417e4e' },
  pongamia: { crown: 'round', foliage: '#3f7b4d' },
  subcostate_crape_myrtle: { crown: 'open', foliage: '#5e9c5b', trunk: '#c9a98a' }, // 九芎:猴不爬的光滑淺樹皮
  // ── 灌木 ──
  orange_jasmine: { crown: 'shrub', foliage: '#2f5d3a', flower: '#f2ede0' },
  hibiscus: { crown: 'shrub', foliage: '#3f7d3f', flower: '#d0342c' },
  golden_dewdrop: { crown: 'shrub', foliage: '#6fae62', flower: '#8e79bd' },
  camellia: { crown: 'shrub', foliage: '#234f33', flower: '#d46a75' },
  // ── 竹類 ──
  green_bamboo: { crown: 'bamboo', foliage: '#7fb069', trunk: '#9fbf74' },
  moso_bamboo: { crown: 'bamboo', foliage: '#8fbf6f', trunk: '#b3c98a' },
};

export function plantForm(speciesId: string, category: PlantCategory): PlantForm {
  return PLANT_FORMS[speciesId] ?? DEFAULT_FORMS[category];
}
