import { create } from 'zustand';
import type { BrushMode } from '../engine/terrain';
import type {
  AreaType,
  BoundaryHedgeConfig,
  HomesteadProject,
  PlacedElement,
  Point,
  ProjectFile,
  ProjectSettings,
  Terrain,
} from '../types';
import { PROJECT_FILE_VERSION } from '../types';

export type Tool =
  | 'select'
  | 'boundary'
  | 'plant'
  | 'area'
  | 'pond'
  | 'stream'
  | 'swale'
  | 'building'
  | 'hedge'
  | 'measure'
  | 'terrain'
  | 'profile'
  | 'home';

export type ViewMode = '2d' | '3d';

/** undo/redo 快照:僅含設計資料,不含檢視設定 */
interface Snapshot {
  boundary: Point[];
  elements: PlacedElement[];
  terrain: Terrain | null;
  hedge: BoundaryHedgeConfig | null;
}

const STORAGE_KEY = 'homestead-planner:project';
const HISTORY_LIMIT = 100;

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

/** 預設示範地界:一塊約 1 公頃的不規則五邊形 */
function defaultBoundary(): Point[] {
  return [
    { x: 10, y: 20 },
    { x: 95, y: 8 },
    { x: 118, y: 60 },
    { x: 86, y: 108 },
    { x: 6, y: 92 },
  ];
}

function defaultSettings(): ProjectSettings {
  return {
    northAngle: 0,
    gridVisible: true,
    gridSize: 5,
    showContours: false,
    showSlope: false,
    showZones: false,
    contourInterval: 1,
    homePosition: null,
    showShadows: false,
    showInsolation: false,
    showFlow: false,
    showWind: false,
    sunMonth: 6,
    sunHour: 14,
    windDir: 'NE',
    people: 4,
    windTurbineKw: 0,
    windClass: 'normal',
    showSectors: false,
  };
}

export function createDefaultProject(): HomesteadProject {
  return {
    name: '我的家園',
    boundary: defaultBoundary(),
    terrain: null,
    hedge: null,
    elements: [],
    settings: defaultSettings(),
  };
}

/** 舊版存檔遷移:補齊 Phase 2 新增欄位 */
function normalizeProject(raw: HomesteadProject): HomesteadProject {
  return {
    ...raw,
    terrain: raw.terrain ?? null,
    hedge: raw.hedge ?? null,
    settings: { ...defaultSettings(), ...raw.settings },
  };
}

function loadInitialProject(): HomesteadProject {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultProject();
    const file = JSON.parse(raw) as ProjectFile;
    if (
      file &&
      typeof file === 'object' &&
      file.project &&
      Array.isArray(file.project.boundary) &&
      Array.isArray(file.project.elements) &&
      file.project.settings
    ) {
      return normalizeProject(file.project);
    }
  } catch {
    // 格式錯誤時回退為預設專案
  }
  return createDefaultProject();
}

export function serializeProject(project: HomesteadProject): string {
  const file: ProjectFile = {
    version: PROJECT_FILE_VERSION,
    savedAt: new Date().toISOString(),
    project,
  };
  return JSON.stringify(file, null, 2);
}

export function parseProjectFile(raw: string): HomesteadProject {
  const file = JSON.parse(raw) as ProjectFile;
  if (
    !file ||
    typeof file !== 'object' ||
    !file.project ||
    !Array.isArray(file.project.boundary) ||
    !Array.isArray(file.project.elements) ||
    !file.project.settings
  ) {
    throw new Error('檔案格式不正確');
  }
  return normalizeProject(file.project);
}

function snapshotOf(project: HomesteadProject): Snapshot {
  return {
    boundary: project.boundary,
    elements: project.elements,
    terrain: project.terrain,
    hedge: project.hedge,
  };
}

function restoreSnapshot(project: HomesteadProject, s: Snapshot): HomesteadProject {
  return {
    ...project,
    boundary: s.boundary,
    elements: s.elements,
    terrain: s.terrain,
    hedge: s.hedge,
  };
}

interface ProjectState {
  project: HomesteadProject;
  past: Snapshot[];
  future: Snapshot[];
  /** 拖曳開始時暫存的快照;第一次 transient 變更時才進入 past(避免無效歷史) */
  pendingSnapshot: Snapshot | null;

  // UI 狀態(不進歷史)
  tool: Tool;
  areaType: AreaType;
  selectedSpeciesId: string;
  selectedBuildingId: string; // M8 選定房型
  selectedId: string | null; // 元素 id 或 'boundary'
  viewYear: number; // M4 時間軸目前年份
  viewMode: ViewMode; // 2D / 3D
  brush: { mode: BrushMode; radius: number; strength: number }; // M5 地形筆刷
  showRelief: boolean; // 2D 地形立體陰影圖層(hillshade)

  // ── 動作 ──
  setTool: (tool: Tool) => void;
  setAreaType: (t: AreaType) => void;
  setSelectedSpecies: (id: string) => void;
  setSelectedBuilding: (id: string) => void;
  select: (id: string | null) => void;
  setViewYear: (year: number) => void;
  setViewMode: (mode: ViewMode) => void;
  setBrush: (patch: Partial<ProjectState['brush']>) => void;
  setShowRelief: (v: boolean) => void;

  /** 記錄歷史後套用變更 */
  commit: (fn: (p: HomesteadProject) => HomesteadProject) => void;
  /** 開始一段拖曳(下一次 transient 變更時才寫入歷史) */
  beginDrag: () => void;
  /** 拖曳中的即時變更(第一次呼叫時提交 beginDrag 的快照) */
  transient: (fn: (p: HomesteadProject) => HomesteadProject) => void;
  endDrag: () => void;

  undo: () => void;
  redo: () => void;

  updateSettings: (patch: Partial<HomesteadProject['settings']>) => void;
  setProjectName: (name: string) => void;
  loadProject: (project: HomesteadProject) => void;
  resetProject: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: loadInitialProject(),
  past: [],
  future: [],
  pendingSnapshot: null,

  tool: 'select',
  areaType: 'forest',
  selectedSpeciesId: 'mango',
  selectedBuildingId: 'cabin',
  selectedId: null,
  viewYear: 10,
  viewMode: '2d',
  brush: { mode: 'raise', radius: 8, strength: 0.3 },
  showRelief: true,

  setTool: (tool) => set({ tool, selectedId: null }),
  setAreaType: (areaType) => set({ areaType }),
  setSelectedSpecies: (selectedSpeciesId) => set({ selectedSpeciesId }),
  setSelectedBuilding: (selectedBuildingId) => set({ selectedBuildingId }),
  select: (selectedId) => set({ selectedId }),
  setViewYear: (viewYear) => set({ viewYear }),
  setViewMode: (viewMode) => set({ viewMode }),
  setBrush: (patch) => set({ brush: { ...get().brush, ...patch } }),
  setShowRelief: (showRelief) => set({ showRelief }),

  commit: (fn) => {
    const { project, past } = get();
    set({
      past: [...past.slice(-HISTORY_LIMIT + 1), snapshotOf(project)],
      future: [],
      pendingSnapshot: null,
      project: fn(project),
    });
  },

  beginDrag: () => set({ pendingSnapshot: snapshotOf(get().project) }),

  transient: (fn) => {
    const { project, past, pendingSnapshot } = get();
    if (pendingSnapshot) {
      set({
        past: [...past.slice(-HISTORY_LIMIT + 1), pendingSnapshot],
        future: [],
        pendingSnapshot: null,
        project: fn(project),
      });
    } else {
      set({ project: fn(project) });
    }
  },

  endDrag: () => set({ pendingSnapshot: null }),

  undo: () => {
    const { past, future, project } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      future: [snapshotOf(project), ...future],
      project: restoreSnapshot(project, prev),
      selectedId: null,
      pendingSnapshot: null,
    });
  },

  redo: () => {
    const { past, future, project } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      past: [...past, snapshotOf(project)],
      future: future.slice(1),
      project: restoreSnapshot(project, next),
      selectedId: null,
      pendingSnapshot: null,
    });
  },

  updateSettings: (patch) => {
    const { project } = get();
    set({ project: { ...project, settings: { ...project.settings, ...patch } } });
  },

  setProjectName: (name) => {
    const { project } = get();
    set({ project: { ...project, name } });
  },

  loadProject: (project) =>
    set({
      project: normalizeProject(project),
      past: [],
      future: [],
      selectedId: null,
      pendingSnapshot: null,
    }),

  resetProject: () =>
    set({
      project: createDefaultProject(),
      past: [],
      future: [],
      selectedId: null,
      pendingSnapshot: null,
    }),
}));

/** 自動儲存至 localStorage(App 端 debounce 後呼叫) */
export function persistProject(project: HomesteadProject): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeProject(project));
  } catch {
    // 容量滿或隱私模式:靜默失敗,匯出 JSON 仍可用
  }
}
