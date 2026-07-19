import { create } from 'zustand';
import type {
  AreaType,
  HomesteadProject,
  PlacedElement,
  Point,
  ProjectFile,
} from '../types';
import { PROJECT_FILE_VERSION } from '../types';

export type Tool = 'select' | 'boundary' | 'plant' | 'area' | 'pond' | 'measure';

/** undo/redo 快照:僅含設計資料,不含檢視設定 */
interface Snapshot {
  boundary: Point[];
  elements: PlacedElement[];
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

export function createDefaultProject(): HomesteadProject {
  return {
    name: '我的家園',
    boundary: defaultBoundary(),
    elements: [],
    settings: { northAngle: 0, gridVisible: true, gridSize: 5 },
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
      return file.project;
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
  return file.project;
}

function snapshotOf(project: HomesteadProject): Snapshot {
  return {
    boundary: project.boundary,
    elements: project.elements,
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
  selectedId: string | null; // 元素 id 或 'boundary'

  // ── 動作 ──
  setTool: (tool: Tool) => void;
  setAreaType: (t: AreaType) => void;
  setSelectedSpecies: (id: string) => void;
  select: (id: string | null) => void;

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
  selectedId: null,

  setTool: (tool) => set({ tool, selectedId: null }),
  setAreaType: (areaType) => set({ areaType }),
  setSelectedSpecies: (selectedSpeciesId) => set({ selectedSpeciesId }),
  select: (selectedId) => set({ selectedId }),

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
      project: { ...project, boundary: prev.boundary, elements: prev.elements },
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
      project: { ...project, boundary: next.boundary, elements: next.elements },
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
    set({ project, past: [], future: [], selectedId: null, pendingSnapshot: null }),

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
