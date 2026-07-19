import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { buildingModelById } from '../data/buildings';
import { CATEGORY_LABELS, speciesById } from '../data/plants';
import { boundingBox, distance, polygonArea, polylineLength } from '../engine/geometry';
import { canopyRadiusAtAge, isPlantAlive, matureCanopyRadius } from '../engine/growth';
import { spacingConflicts } from '../engine/metrics';
import {
  applyBrush,
  createTerrain,
  generateContours,
  hillshadeGrid,
  sampleHeight,
  sampleProfile,
  slopeGrid,
} from '../engine/terrain';
import { generateHedgePlants, nearestPerimeterT, pointAtPerimeter } from '../engine/hedge';
import { polygonPerimeter } from '../engine/geometry';
import { ZONE_RADII } from '../engine/zones';
import { newId, useProjectStore } from '../store/useProjectStore';
import type { AreaType, HomesteadProject, PlacedElement, Point } from '../types';
import { AnalysisLayers } from './AnalysisLayers';

interface View {
  scale: number; // px / m
  tx: number;
  ty: number;
}

type DragState =
  | { type: 'pan'; startClientX: number; startClientY: number; startTx: number; startTy: number; moved: boolean }
  | { type: 'plant'; id: string; offset: Point }
  | { type: 'poly'; id: string; last: Point }
  | { type: 'vertex'; target: 'boundary' | string; index: number }
  | { type: 'brush' }
  | null;

const AREA_STYLES: Record<AreaType, { fill: string; stroke: string; label: string }> = {
  forest: { fill: 'rgba(45,106,79,0.35)', stroke: '#2d6a4f', label: '林地' },
  garden: { fill: 'rgba(224,178,84,0.4)', stroke: '#a67c26', label: '菜園' },
  meadow: { fill: 'rgba(163,181,107,0.35)', stroke: '#7a8c4a', label: '草地' },
  food_forest: { fill: 'rgba(64,145,108,0.3)', stroke: '#40916c', label: '食物森林' },
};

const CANOPY_STYLES: Record<string, { fill: string; stroke: string }> = {
  tree_fruit: { fill: 'rgba(82,183,136,0.4)', stroke: '#3f9e6f' },
  tree_forest: { fill: 'rgba(45,106,79,0.4)', stroke: '#2d6a4f' },
  shrub: { fill: 'rgba(149,213,178,0.5)', stroke: '#5aa87e' },
  bamboo: { fill: 'rgba(116,160,87,0.4)', stroke: '#5d8043' },
};

function pointsAttr(polygon: Point[]): string {
  return polygon.map((p) => `${p.x},${p.y}`).join(' ');
}

/** 移除連續且幾乎重合的點(雙擊結束時的重複點) */
function dedupe(points: Point[], epsilon = 0.05): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    if (out.length === 0 || distance(out[out.length - 1], p) > epsilon) out.push(p);
  }
  return out;
}

export function CanvasView({ svgRef }: { svgRef: React.RefObject<SVGSVGElement> }) {
  const project = useProjectStore((s) => s.project);
  const tool = useProjectStore((s) => s.tool);
  const areaType = useProjectStore((s) => s.areaType);
  const selectedSpeciesId = useProjectStore((s) => s.selectedSpeciesId);
  const selectedBuildingId = useProjectStore((s) => s.selectedBuildingId);
  const selectedId = useProjectStore((s) => s.selectedId);
  const viewYear = useProjectStore((s) => s.viewYear);
  const brush = useProjectStore((s) => s.brush);
  const select = useProjectStore((s) => s.select);
  const setTool = useProjectStore((s) => s.setTool);
  const commit = useProjectStore((s) => s.commit);
  const beginDrag = useProjectStore((s) => s.beginDrag);
  const transient = useProjectStore((s) => s.transient);
  const endDrag = useProjectStore((s) => s.endDrag);
  const updateSettings = useProjectStore((s) => s.updateSettings);

  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 5, tx: 60, ty: 40 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [draft, setDraft] = useState<Point[]>([]);
  const [measure, setMeasure] = useState<Point[]>([]);
  const [profilePts, setProfilePts] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  const dragRef = useRef<DragState>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  // 容器尺寸追蹤
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    obs.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => obs.disconnect();
  }, []);

  const fitView = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const boundary = useProjectStore.getState().project.boundary;
    if (boundary.length < 3) {
      setView({ scale: 5, tx: 60, ty: 40 });
      return;
    }
    const box = boundingBox(boundary);
    const w = el.clientWidth;
    const h = el.clientHeight;
    const pad = 60;
    const scale = Math.min(
      (w - pad * 2) / Math.max(box.maxX - box.minX, 1),
      (h - pad * 2) / Math.max(box.maxY - box.minY, 1)
    );
    const clamped = Math.min(Math.max(scale, 0.2), 200);
    setView({
      scale: clamped,
      tx: (w - (box.minX + box.maxX) * clamped) / 2,
      ty: (h - (box.minY + box.maxY) * clamped) / 2,
    });
  }, []);

  // 初次載入時自動縮放至地界
  useEffect(() => {
    fitView();
  }, [fitView]);

  // 滾輪縮放(需 non-passive 才能 preventDefault)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const scale = Math.min(Math.max(v.scale * factor, 0.2), 200);
        const wx = (mx - v.tx) / v.scale;
        const wy = (my - v.ty) / v.scale;
        return { scale, tx: mx - wx * scale, ty: my - wy * scale };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return {
      x: (clientX - rect.left - v.tx) / v.scale,
      y: (clientY - rect.top - v.ty) / v.scale,
    };
  }, []);

  const cancelDraft = useCallback(() => {
    setDraft([]);
    setMeasure([]);
    setProfilePts([]);
  }, []);

  // 工具切換時取消進行中的繪製
  useEffect(() => {
    cancelDraft();
  }, [tool, cancelDraft]);

  const draftRef = useRef(draft);
  draftRef.current = draft;

  // 注意:不可在 setDraft 的 updater 內呼叫 commit(副作用會被 React 重複執行)
  const finishDraft = useCallback(() => {
    const clean = dedupe(draftRef.current);
    setDraft([]);
    if (tool === 'swale' || tool === 'stream') {
      if (clean.length >= 2) {
        commit((p) => ({
          ...p,
          elements: [
            ...p.elements,
            tool === 'swale'
              ? { id: newId('swale'), kind: 'swale', line: clean }
              : { id: newId('stream'), kind: 'stream', line: clean },
          ],
        }));
      }
      return;
    }
    if (clean.length < 3) return;
    if (tool === 'boundary') {
      commit((p) => ({ ...p, boundary: clean }));
      setTool('select');
    } else if (tool === 'area') {
      commit((p) => ({
        ...p,
        elements: [...p.elements, { id: newId('area'), kind: 'area', areaType, polygon: clean }],
      }));
    } else if (tool === 'pond') {
      commit((p) => ({
        ...p,
        elements: [
          ...p.elements,
          { id: newId('pond'), kind: 'water', waterType: 'pond', polygon: clean },
        ],
      }));
    }
  }, [tool, areaType, commit, setTool]);

  // 鍵盤:Esc 取消、Delete 刪除選取元素
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        cancelDraft();
        select(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const id = useProjectStore.getState().selectedId;
        if (id && id !== 'boundary') {
          commit((p) => ({ ...p, elements: p.elements.filter((el) => el.id !== id) }));
          select(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelDraft, select, commit]);

  // ── 指標事件 ──

  const startPan = (e: ReactPointerEvent) => {
    dragRef.current = {
      type: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startTx: viewRef.current.tx,
      startTy: viewRef.current.ty,
      moved: false,
    };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const applyTerrainBrush = useCallback(
    (p: Point) => {
      transient((proj) => {
        const terrain = proj.terrain ?? createTerrain(proj.boundary);
        return {
          ...proj,
          terrain: {
            ...terrain,
            grid: applyBrush(terrain, p, brush.radius, brush.mode, brush.strength),
          },
        };
      });
    },
    [transient, brush]
  );

  const onSvgPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button === 1) {
      // 中鍵:任何工具下都可平移
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    const p = toWorld(e.clientX, e.clientY);
    if (tool === 'select') {
      startPan(e);
    } else if (tool === 'boundary' ||
      tool === 'area' ||
      tool === 'pond' ||
      tool === 'swale' ||
      tool === 'stream') {
      // 點擊起點附近 → 閉合(swale 為開放線,不閉合)
      if (tool !== 'swale' && tool !== 'stream' && draft.length >= 3 && distance(p, draft[0]) < 12 / view.scale) {
        finishDraft();
        return;
      }
      setDraft((d) => [...d, p]);
    } else if (tool === 'plant') {
      const species = speciesById.get(selectedSpeciesId);
      if (!species) return;
      commit((proj) => ({
        ...proj,
        elements: [
          ...proj.elements,
          {
            id: newId('plant'),
            kind: 'plant',
            speciesId: selectedSpeciesId,
            position: p,
            plantedYear: viewYear,
          },
        ],
      }));
    } else if (tool === 'building') {
      const model = buildingModelById.get(selectedBuildingId);
      if (!model) return;
      commit((proj) => ({
        ...proj,
        elements: [
          ...proj.elements,
          {
            id: newId('bld'),
            kind: 'building',
            modelId: model.id,
            position: p,
            rotationDeg: 0,
            width: model.width,
            depth: model.depth,
            height: model.height,
          },
        ],
      }));
    } else if (tool === 'measure') {
      setMeasure((m) => [...m, p]);
    } else if (tool === 'terrain') {
      if (project.boundary.length < 3) return;
      beginDrag();
      applyTerrainBrush(p);
      dragRef.current = { type: 'brush' };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } else if (tool === 'profile') {
      setProfilePts((pts) => (pts.length >= 2 ? [p] : [...pts, p]));
    } else if (tool === 'hedge') {
      if (project.hedge && project.boundary.length >= 3) {
        const near = nearestPerimeterT(project.boundary, p);
        if (near.dist < 25 / view.scale + 3) {
          commit((proj) => ({
            ...proj,
            hedge: proj.hedge
              ? { ...proj.hedge, gaps: [...proj.hedge.gaps, { t: near.t, width: 4 }] }
              : proj.hedge,
          }));
        }
      }
    } else if (tool === 'home') {
      updateSettings({ homePosition: p, showZones: true });
      setTool('select');
    }
  };

  const onSvgPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toWorld(e.clientX, e.clientY);
    setCursor(p);
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.type === 'pan') {
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      setView((v) => ({ ...v, tx: drag.startTx + dx, ty: drag.startTy + dy }));
    } else if (drag.type === 'brush') {
      applyTerrainBrush(p);
    } else if (drag.type === 'plant') {
      transient((proj) => ({
        ...proj,
        elements: proj.elements.map((el) =>
          el.id === drag.id && (el.kind === 'plant' || el.kind === 'building')
            ? { ...el, position: { x: p.x - drag.offset.x, y: p.y - drag.offset.y } }
            : el
        ),
      }));
    } else if (drag.type === 'poly') {
      const dx = p.x - drag.last.x;
      const dy = p.y - drag.last.y;
      drag.last = p;
      transient((proj) => ({
        ...proj,
        elements: proj.elements.map((el) => {
          if (el.id !== drag.id) return el;
          if (el.kind === 'area' || el.kind === 'water') {
            return { ...el, polygon: el.polygon.map((q) => ({ x: q.x + dx, y: q.y + dy })) };
          }
          if (el.kind === 'swale' || el.kind === 'stream') {
            return { ...el, line: el.line.map((q) => ({ x: q.x + dx, y: q.y + dy })) };
          }
          return el;
        }),
      }));
    } else if (drag.type === 'vertex') {
      transient((proj) => {
        if (drag.target === 'boundary') {
          const boundary = proj.boundary.map((q, i) => (i === drag.index ? p : q));
          return { ...proj, boundary };
        }
        return {
          ...proj,
          elements: proj.elements.map((el) => {
            if (el.id !== drag.target) return el;
            if (el.kind === 'area' || el.kind === 'water') {
              return { ...el, polygon: el.polygon.map((q, i) => (i === drag.index ? p : q)) };
            }
            if (el.kind === 'swale' || el.kind === 'stream') {
              return { ...el, line: el.line.map((q, i) => (i === drag.index ? p : q)) };
            }
            return el;
          }),
        };
      });
    }
  };

  const onSvgPointerUp = () => {
    const drag = dragRef.current;
    if (drag?.type === 'pan' && !drag.moved && tool === 'select') {
      select(null);
    }
    dragRef.current = null;
    endDrag();
  };

  // ── 元素互動 ──

  const onElementPointerDown = (e: ReactPointerEvent, el: PlacedElement) => {
    if (tool !== 'select' || e.button !== 0) return;
    e.stopPropagation();
    select(el.id);
    const p = toWorld(e.clientX, e.clientY);
    beginDrag();
    if (el.kind === 'plant' || el.kind === 'building') {
      dragRef.current = {
        type: 'plant',
        id: el.id,
        offset: { x: p.x - el.position.x, y: p.y - el.position.y },
      };
    } else {
      dragRef.current = { type: 'poly', id: el.id, last: p };
    }
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  /** 右鍵直接刪除元素(可 Ctrl+Z 復原);任何工具下皆可 */
  const onElementContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    commit((p) => ({ ...p, elements: p.elements.filter((el) => el.id !== id) }));
    if (useProjectStore.getState().selectedId === id) select(null);
  };

  const onVertexPointerDown = (
    e: ReactPointerEvent,
    target: 'boundary' | string,
    index: number
  ) => {
    if (tool !== 'select' || e.button !== 0) return;
    e.stopPropagation();
    beginDrag();
    dragRef.current = { type: 'vertex', target, index };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onVertexContextMenu = (
    e: ReactPointerEvent | React.MouseEvent,
    target: 'boundary' | string,
    index: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    commit((proj) => {
      if (target === 'boundary') {
        if (proj.boundary.length <= 3) return proj;
        return { ...proj, boundary: proj.boundary.filter((_, i) => i !== index) };
      }
      return {
        ...proj,
        elements: proj.elements.map((el) => {
          if (el.id !== target) return el;
          if ((el.kind === 'area' || el.kind === 'water') && el.polygon.length > 3) {
            return { ...el, polygon: el.polygon.filter((_, i) => i !== index) };
          }
          if ((el.kind === 'swale' || el.kind === 'stream') && el.line.length > 2) {
            return { ...el, line: el.line.filter((_, i) => i !== index) };
          }
          return el;
        }),
      };
    });
  };

  const onMidpointPointerDown = (
    e: ReactPointerEvent,
    target: 'boundary' | string,
    index: number // 插入於 index 之後
  ) => {
    if (tool !== 'select' || e.button !== 0) return;
    e.stopPropagation();
    const p = toWorld(e.clientX, e.clientY);
    beginDrag();
    transient((proj) => {
      if (target === 'boundary') {
        const boundary = [...proj.boundary];
        boundary.splice(index + 1, 0, p);
        return { ...proj, boundary };
      }
      return {
        ...proj,
        elements: proj.elements.map((el) => {
          if (el.id !== target) return el;
          if (el.kind === 'area' || el.kind === 'water') {
            const polygon = [...el.polygon];
            polygon.splice(index + 1, 0, p);
            return { ...el, polygon };
          }
          if (el.kind === 'swale' || el.kind === 'stream') {
            const line = [...el.line];
            line.splice(index + 1, 0, p);
            return { ...el, line };
          }
          return el;
        }),
      };
    });
    dragRef.current = { type: 'vertex', target, index: index + 1 };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  // ── 衍生資料 ──

  const conflicts = useMemo(() => spacingConflicts(project, speciesById), [project]);
  const conflictIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of conflicts) {
      s.add(c.a);
      s.add(c.b);
    }
    return s;
  }, [conflicts]);

  const plantById = useMemo(() => {
    const m = new Map<string, Point>();
    for (const el of project.elements) {
      if (el.kind === 'plant') m.set(el.id, el.position);
    }
    return m;
  }, [project.elements]);

  const showRelief = useProjectStore((s) => s.showRelief);

  // 地形立體陰影圖層:高程著色 × hillshade,畫進 canvas 轉 dataURL(塑形時逐筆即時更新)
  const reliefImage = useMemo(() => {
    const terrain = project.terrain;
    if (!terrain || (!showRelief && tool !== 'terrain')) return null;
    const { cols, rows, grid, resolution, origin } = terrain;
    let min = Infinity;
    let max = -Infinity;
    for (const row of grid) {
      for (const z of row) {
        if (z < min) min = z;
        if (z > max) max = z;
      }
    }
    const range = Math.max(max - min, 0.5); // 全平時仍給均勻底色
    const shade = hillshadeGrid(terrain);
    // 高程色帶:低=深綠 → 草綠 → 土黃 → 淺褐
    const stops = [
      [70, 120, 90],
      [158, 189, 110],
      [217, 192, 138],
      [185, 141, 94],
    ];
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(cols, rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = (grid[r][c] - min) / range;
        const seg = Math.min(Math.floor(t * (stops.length - 1)), stops.length - 2);
        const f = t * (stops.length - 1) - seg;
        const bright = 0.55 + 0.45 * shade[r][c];
        const i = (r * cols + c) * 4;
        for (let k = 0; k < 3; k++) {
          img.data[i + k] = Math.round(
            (stops[seg][k] + (stops[seg + 1][k] - stops[seg][k]) * f) * bright
          );
        }
        img.data[i + 3] = 235;
      }
    }
    ctx.putImageData(img, 0, 0);
    return {
      url: canvas.toDataURL(),
      x: origin.x,
      y: origin.y,
      w: cols * resolution,
      h: rows * resolution,
      range: max - min,
    };
  }, [project.terrain, showRelief, tool]);

  // 邊界綠籬植株(純衍生,隨地界/設定/年份自動重算)
  const hedgePlants = useMemo(() => {
    if (!project.hedge || project.boundary.length < 3) return [];
    return generateHedgePlants(project.boundary, project.hedge);
  }, [project.hedge, project.boundary]);

  // 網格線(依可視範圍計算,過密時自動放大間距)
  const gridLines = useMemo(() => {
    if (!project.settings.gridVisible) return null;
    let step = project.settings.gridSize;
    while (step * view.scale < 8) step *= 5;
    const minX = -view.tx / view.scale;
    const minY = -view.ty / view.scale;
    const maxX = (size.w - view.tx) / view.scale;
    const maxY = (size.h - view.ty) / view.scale;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let x = Math.floor(minX / step) * step; x <= maxX; x += step) xs.push(x);
    for (let y = Math.floor(minY / step) * step; y <= maxY; y += step) ys.push(y);
    return { xs, ys, minX, minY, maxX, maxY, step };
  }, [project.settings.gridVisible, project.settings.gridSize, view, size]);

  // 等高線(M5)
  const contourSegs = useMemo(() => {
    if (!project.settings.showContours || !project.terrain) return [];
    return generateContours(project.terrain, project.settings.contourInterval);
  }, [project.settings.showContours, project.settings.contourInterval, project.terrain]);

  // 坡度熱圖(M5):>15° 橘、>30° 紅
  const slopeCells = useMemo(() => {
    if (!project.settings.showSlope || !project.terrain) return [];
    const slopes = slopeGrid(project.terrain);
    const { resolution, origin, cols, rows } = project.terrain;
    const cells: { x: number; y: number; level: 1 | 2 }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const s = slopes[r][c];
        if (s > 15) {
          cells.push({
            x: origin.x + c * resolution - resolution / 2,
            y: origin.y + r * resolution - resolution / 2,
            level: s > 30 ? 2 : 1,
          });
        }
      }
    }
    return cells;
  }, [project.settings.showSlope, project.terrain]);

  // 剖面(M5)
  const profile = useMemo(() => {
    if (profilePts.length !== 2 || !project.terrain) return null;
    return sampleProfile(project.terrain, profilePts[0], profilePts[1]);
  }, [profilePts, project.terrain]);

  // 比例尺:取接近 80px 的整數公尺
  const scaleBar = useMemo(() => {
    const target = 80 / view.scale;
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    const meters = nice.find((n) => n >= target) ?? 500;
    return { meters, px: meters * view.scale };
  }, [view.scale]);

  const selectedPolygonTarget = useMemo(() => {
    if (selectedId === 'boundary')
      return { target: 'boundary' as const, polygon: project.boundary, open: false };
    const el = project.elements.find((x) => x.id === selectedId);
    if (el && (el.kind === 'area' || el.kind === 'water')) {
      return { target: el.id, polygon: el.polygon, open: false };
    }
    if (el && (el.kind === 'swale' || el.kind === 'stream')) {
      return { target: el.id, polygon: el.line, open: true };
    }
    return null;
  }, [selectedId, project]);

  const toolHint: string = {
    select: '點選元素/拖曳移動;右鍵頂點可刪除;空白處拖曳平移、滾輪縮放',
    boundary: '逐點點擊繪製地界;點擊起點或雙擊完成;Esc 取消',
    plant: `點擊放置「${speciesById.get(selectedSpeciesId)?.nameZh ?? ''}」(種植於第 ${viewYear} 年)`,
    area: `逐點點擊繪製${AREA_STYLES[areaType].label}區塊;雙擊完成`,
    pond: '逐點點擊繪製池塘;雙擊完成',
    swale: '沿等高線逐點繪製集水溝;雙擊完成(建議先開等高線圖層對照)',
    stream: '沿溪流路徑逐點繪製(上游→下游);雙擊完成;屬性面板估微水力發電',
    building: `點擊放置「${buildingModelById.get(selectedBuildingId)?.label ?? ''}」(黑粗邊 = 正面/門)`,
    measure: '逐點點擊測距;Esc 清除',
    hedge: project.hedge
      ? '點擊地界線可新增出入口;右側面板調整灌木/喬木/株距'
      : '在右側面板按「建立邊界綠籬」,沿地界自動佈滿灌木',
    terrain: `地形筆刷:${{ raise: '抬升', lower: '下降', smooth: '平滑' }[brush.mode]}(拖曳塗抹;右側面板調整)`,
    profile: project.terrain ? '點擊兩點顯示地形剖面;Esc 清除' : '尚無地形 — 請先用地形筆刷塑形',
    home: '點擊放置住家位置(分區分析中心)',
  }[tool];

  const draftClosable = draft.length >= 3;
  const measureLen = polylineLength(cursor && measure.length > 0 ? [...measure, cursor] : measure);
  const home = project.settings.homePosition;

  return (
    <div className="canvas-container" ref={containerRef}>
      <svg
        ref={svgRef}
        className="canvas-svg"
        width={size.w}
        height={size.h}
        onPointerDown={onSvgPointerDown}
        onPointerMove={onSvgPointerMove}
        onPointerUp={onSvgPointerUp}
        onDoubleClick={finishDraft}
        style={{
          cursor:
            tool === 'select'
              ? 'default'
              : tool === 'plant' || tool === 'home' || tool === 'building'
                ? 'copy'
                : 'crosshair',
        }}
      >
        <rect x={0} y={0} width={size.w} height={size.h} fill="#eae6d8" pointerEvents="none" />
        <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
          {/* 地界填色 */}
          {project.boundary.length >= 3 && (
            <polygon
              points={pointsAttr(project.boundary)}
              fill="#f7f4ea"
              stroke="none"
              pointerEvents="none"
            />
          )}

          {/* 地形立體陰影(高程著色 × hillshade,M5) */}
          {reliefImage && (
            <image
              href={reliefImage.url}
              x={reliefImage.x}
              y={reliefImage.y}
              width={reliefImage.w}
              height={reliefImage.h}
              preserveAspectRatio="none"
              pointerEvents="none"
              style={{ imageRendering: 'pixelated' }}
              opacity={0.85}
            />
          )}

          {/* 網格 */}
          {gridLines && (
            <g pointerEvents="none">
              {gridLines.xs.map((x) => (
                <line
                  key={`vx${x}`}
                  x1={x}
                  y1={gridLines.minY}
                  x2={x}
                  y2={gridLines.maxY}
                  stroke={x === 0 ? '#b9b29c' : '#d8d2bd'}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {gridLines.ys.map((y) => (
                <line
                  key={`hz${y}`}
                  x1={gridLines.minX}
                  y1={y}
                  x2={gridLines.maxX}
                  y2={y}
                  stroke={y === 0 ? '#b9b29c' : '#d8d2bd'}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          )}

          {/* 坡度熱圖(分析層) */}
          {project.terrain && slopeCells.length > 0 && (
            <g pointerEvents="none">
              {slopeCells.map((c, i) => (
                <rect
                  key={i}
                  x={c.x}
                  y={c.y}
                  width={project.terrain!.resolution}
                  height={project.terrain!.resolution}
                  fill={c.level === 2 ? 'rgba(198,40,40,0.4)' : 'rgba(239,140,42,0.35)'}
                />
              ))}
            </g>
          )}

          {/* 等高線(分析層) */}
          {contourSegs.length > 0 && (
            <g pointerEvents="none">
              {contourSegs.map((s, i) => (
                <line
                  key={i}
                  x1={s.a.x}
                  y1={s.a.y}
                  x2={s.b.x}
                  y2={s.b.y}
                  stroke="#8d6e63"
                  strokeWidth={Math.abs(s.level % 5) < 1e-9 ? 1.8 : 1}
                  vectorEffect="non-scaling-stroke"
                  opacity={0.8}
                />
              ))}
            </g>
          )}

          {/* 區塊與池塘 */}
          {project.elements.map((el) => {
            if (el.kind === 'area') {
              const style = AREA_STYLES[el.areaType];
              return (
                <g key={el.id}>
                  <polygon
                    points={pointsAttr(el.polygon)}
                    fill={style.fill}
                    stroke={style.stroke}
                    strokeWidth={el.id === selectedId ? 2.5 : 1.5}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents={tool === 'select' ? 'auto' : 'none'}
                    onPointerDown={(e) => onElementPointerDown(e, el)}
                    onContextMenu={(e) => onElementContextMenu(e, el.id)}
                    style={{ cursor: tool === 'select' ? 'move' : undefined }}
                  />
                  {view.scale > 1.5 && (
                    <text
                      x={el.polygon.reduce((s, p) => s + p.x, 0) / el.polygon.length}
                      y={el.polygon.reduce((s, p) => s + p.y, 0) / el.polygon.length}
                      fontSize={13 / view.scale}
                      fill={style.stroke}
                      textAnchor="middle"
                      pointerEvents="none"
                    >
                      {style.label} {Math.round(polygonArea(el.polygon))}㎡
                    </text>
                  )}
                </g>
              );
            }
            if (el.kind === 'water') {
              return (
                <g key={el.id}>
                  <polygon
                    points={pointsAttr(el.polygon)}
                    fill="rgba(103,169,207,0.55)"
                    stroke={el.id === selectedId ? '#1d5a80' : '#2b6c96'}
                    strokeWidth={el.id === selectedId ? 2.5 : 1.5}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents={tool === 'select' ? 'auto' : 'none'}
                    onPointerDown={(e) => onElementPointerDown(e, el)}
                    onContextMenu={(e) => onElementContextMenu(e, el.id)}
                    style={{ cursor: tool === 'select' ? 'move' : undefined }}
                  />
                  {view.scale > 1.5 && (
                    <text
                      x={el.polygon.reduce((s, p) => s + p.x, 0) / el.polygon.length}
                      y={el.polygon.reduce((s, p) => s + p.y, 0) / el.polygon.length}
                      fontSize={13 / view.scale}
                      fill="#1d5a80"
                      textAnchor="middle"
                      pointerEvents="none"
                    >
                      池塘 {Math.round(polygonArea(el.polygon))}㎡
                    </text>
                  )}
                </g>
              );
            }
            return null;
          })}

          {/* 溪流(M2/M12) */}
          {project.elements.map((el) => {
            if (el.kind !== 'stream') return null;
            return (
              <polyline
                key={el.id}
                points={pointsAttr(el.line)}
                fill="none"
                stroke={el.id === selectedId ? '#1d5a80' : '#2b6c96'}
                strokeWidth={el.id === selectedId ? 6 : 5}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.75}
                vectorEffect="non-scaling-stroke"
                pointerEvents={tool === 'select' ? 'stroke' : 'none'}
                onPointerDown={(e) => onElementPointerDown(e, el)}
                onContextMenu={(e) => onElementContextMenu(e, el.id)}
                style={{ cursor: tool === 'select' ? 'move' : undefined }}
              />
            );
          })}

          {/* 等高集水溝 swale(M13) */}
          {project.elements.map((el) => {
            if (el.kind !== 'swale') return null;
            return (
              <polyline
                key={el.id}
                points={pointsAttr(el.line)}
                fill="none"
                stroke={el.id === selectedId ? '#155e75' : '#0e7490'}
                strokeWidth={el.id === selectedId ? 4 : 3}
                strokeDasharray="10 5"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                pointerEvents={tool === 'select' ? 'stroke' : 'none'}
                onPointerDown={(e) => onElementPointerDown(e, el)}
                onContextMenu={(e) => onElementContextMenu(e, el.id)}
                style={{ cursor: tool === 'select' ? 'move' : undefined }}
              />
            );
          })}

          {/* 建物(M8) */}
          {project.elements.map((el) => {
            if (el.kind !== 'building') return null;
            const model = buildingModelById.get(el.modelId);
            const isSelected = el.id === selectedId;
            return (
              <g
                key={el.id}
                transform={`translate(${el.position.x},${el.position.y}) rotate(${el.rotationDeg})`}
                pointerEvents={tool === 'select' ? 'auto' : 'none'}
                onPointerDown={(e) => onElementPointerDown(e, el)}
                onContextMenu={(e) => onElementContextMenu(e, el.id)}
                style={{ cursor: tool === 'select' ? 'move' : undefined }}
              >
                <rect
                  x={-el.width / 2}
                  y={-el.depth / 2}
                  width={el.width}
                  height={el.depth}
                  fill={model?.color ?? '#b39b7d'}
                  stroke={isSelected ? '#1b4332' : '#6d5232'}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  vectorEffect="non-scaling-stroke"
                  rx={0.3}
                />
                {/* 正面(門)標記:rotation 0 = 朝南(y+) */}
                <line
                  x1={-el.width / 6}
                  y1={el.depth / 2}
                  x2={el.width / 6}
                  y2={el.depth / 2}
                  stroke="#3d3425"
                  strokeWidth={3}
                  vectorEffect="non-scaling-stroke"
                />
                {view.scale > 2 && (
                  <text
                    y={-el.depth / 2 - 3 / view.scale}
                    fontSize={12 / view.scale}
                    fill="#3d3425"
                    textAnchor="middle"
                    transform={`rotate(${-el.rotationDeg})`}
                  >
                    {model?.label ?? '建物'}
                  </text>
                )}
              </g>
            );
          })}

          {/* 邊界綠籬(衍生植株,以設定面板編輯) */}
          {project.hedge && viewYear >= project.hedge.plantedYear && (
            <g pointerEvents="none">
              {hedgePlants.map((hp, i) => {
                const species = speciesById.get(hp.speciesId);
                if (!species) return null;
                const r = canopyRadiusAtAge(
                  species.growth.canopyCurve,
                  viewYear - project.hedge!.plantedYear
                );
                const style = CANOPY_STYLES[species.category] ?? CANOPY_STYLES.shrub;
                return (
                  <circle
                    key={i}
                    cx={hp.position.x}
                    cy={hp.position.y}
                    r={Math.max(r, 0.25)}
                    fill={style.fill}
                    stroke={hp.isTree ? style.stroke : 'none'}
                    strokeWidth={hp.isTree ? 1 : 0}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </g>
          )}

          {/* 綠籬出入口標記(綠籬工具下可點擊刪除) */}
          {project.hedge &&
            project.hedge.gaps.map((g, i) => {
              const total = polygonPerimeter(project.boundary);
              const a = pointAtPerimeter(project.boundary, g.t * total - g.width / 2).point;
              const b = pointAtPerimeter(project.boundary, g.t * total + g.width / 2).point;
              return (
                <g key={`gap${i}`}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="#e07a1f"
                    strokeWidth={5}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents={tool === 'hedge' ? 'stroke' : 'none'}
                    style={{ cursor: tool === 'hedge' ? 'pointer' : undefined }}
                    onPointerDown={(e) => {
                      if (tool !== 'hedge') return;
                      e.stopPropagation();
                      commit((proj) => ({
                        ...proj,
                        hedge: proj.hedge
                          ? { ...proj.hedge, gaps: proj.hedge.gaps.filter((_, j) => j !== i) }
                          : proj.hedge,
                      }));
                    }}
                  />
                  {view.scale > 1.2 && (
                    <text
                      x={(a.x + b.x) / 2}
                      y={(a.y + b.y) / 2 - 6 / view.scale}
                      fontSize={11 / view.scale}
                      fill="#e07a1f"
                      textAnchor="middle"
                      pointerEvents="none"
                    >
                      出入口 {g.width}m
                    </text>
                  )}
                </g>
              );
            })}

          {/* 植栽(依時間軸年份呈現當年冠幅,M4) */}
          {project.elements.map((el) => {
            if (el.kind !== 'plant') return null;
            const species = speciesById.get(el.speciesId);
            if (!species) return null;
            const alive = isPlantAlive(el.plantedYear, el.removedYear, viewYear);
            const age = viewYear - el.plantedYear;
            const radius = alive
              ? canopyRadiusAtAge(species.growth.canopyCurve, age)
              : matureCanopyRadius(species.growth.canopyCurve);
            const style = CANOPY_STYLES[species.category] ?? CANOPY_STYLES.tree_fruit;
            const conflicted = conflictIds.has(el.id);
            const isSelected = el.id === selectedId;
            return (
              <g
                key={el.id}
                pointerEvents={tool === 'select' ? 'auto' : 'none'}
                onPointerDown={(e) => onElementPointerDown(e, el)}
                onContextMenu={(e) => onElementContextMenu(e, el.id)}
                style={{ cursor: tool === 'select' ? 'move' : undefined }}
                opacity={alive ? 1 : 0.3}
              >
                <circle
                  cx={el.position.x}
                  cy={el.position.y}
                  r={alive ? Math.max(radius, 0.3) : 0.8}
                  fill={alive ? style.fill : 'none'}
                  stroke={conflicted ? '#d62828' : isSelected ? '#1b4332' : style.stroke}
                  strokeWidth={isSelected || conflicted ? 2.5 : 1.2}
                  strokeDasharray={conflicted || !alive ? '6 4' : undefined}
                  vectorEffect="non-scaling-stroke"
                />
                {alive && (
                  <circle cx={el.position.x} cy={el.position.y} r={0.25} fill="#5c4326" />
                )}
                {view.scale > 3 && (
                  <text
                    x={el.position.x}
                    y={el.position.y - (alive ? radius : 0.8) - 4 / view.scale}
                    fontSize={12 / view.scale}
                    fill="#3d3425"
                    textAnchor="middle"
                    pointerEvents="none"
                  >
                    {species.nameZh}
                    {!alive &&
                      (viewYear < el.plantedYear
                        ? `(第${el.plantedYear}年種)`
                        : `(第${el.removedYear}年移除)`)}
                  </text>
                )}
              </g>
            );
          })}

          {/* 間距警告連線 */}
          {conflicts.map((c, i) => {
            const a = plantById.get(c.a);
            const b = plantById.get(c.b);
            if (!a || !b) return null;
            return (
              <line
                key={`cf${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#d62828"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            );
          })}

          {/* 環境分析圖層(M7:陰影/日照/水流/風) */}
          <AnalysisLayers project={project} viewYear={viewYear} />

          {/* 扇形分析(M13):外部能量與影響的方向 */}
          {project.settings.showSectors && (
            <SectorLayer project={project} viewScale={view.scale} />
          )}

          {/* 分區距離環(M13 分析層) */}
          {project.settings.showZones && home && (
            <g pointerEvents="none">
              {[...ZONE_RADII].reverse().map((z) => (
                <g key={z.zone}>
                  <circle
                    cx={home.x}
                    cy={home.y}
                    r={z.radius}
                    fill="none"
                    stroke="#7b5ea7"
                    strokeWidth={1.2}
                    strokeDasharray="8 6"
                    vectorEffect="non-scaling-stroke"
                    opacity={0.7}
                  />
                  {view.scale > 1.2 && (
                    <text
                      x={home.x}
                      y={home.y - z.radius + 12 / view.scale}
                      fontSize={11 / view.scale}
                      fill="#7b5ea7"
                      textAnchor="middle"
                      opacity={0.9}
                    >
                      {z.label}
                    </text>
                  )}
                </g>
              ))}
            </g>
          )}

          {/* 住家標記(M13 Zone 0) */}
          {home && (
            <g pointerEvents="none">
              <circle
                cx={home.x}
                cy={home.y}
                r={8 / view.scale}
                fill="#fffdf6"
                stroke="#7b5ea7"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={home.x}
                y={home.y + 4.5 / view.scale}
                fontSize={11 / view.scale}
                textAnchor="middle"
              >
                🏠
              </text>
            </g>
          )}

          {/* 地界外框(可點選) */}
          {project.boundary.length >= 3 && (
            <polygon
              points={pointsAttr(project.boundary)}
              fill="none"
              stroke={selectedId === 'boundary' ? '#8a5a1e' : '#6b4f2a'}
              strokeWidth={selectedId === 'boundary' ? 3.5 : 2.5}
              vectorEffect="non-scaling-stroke"
              pointerEvents={tool === 'select' ? 'stroke' : 'none'}
              onPointerDown={(e) => {
                if (tool !== 'select' || e.button !== 0) return;
                e.stopPropagation();
                select('boundary');
              }}
              style={{ cursor: tool === 'select' ? 'pointer' : undefined }}
            />
          )}

          {/* 選取多邊形的頂點編輯把手 */}
          {selectedPolygonTarget && tool === 'select' && (
            <g>
              {selectedPolygonTarget.polygon.map((p, i) => {
                const isClosingSegment =
                  selectedPolygonTarget.open && i === selectedPolygonTarget.polygon.length - 1;
                const next =
                  selectedPolygonTarget.polygon[(i + 1) % selectedPolygonTarget.polygon.length];
                const mid = { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 };
                return (
                  <g key={i}>
                    {!isClosingSegment && <rect
                      x={mid.x - 3.5 / view.scale}
                      y={mid.y - 3.5 / view.scale}
                      width={7 / view.scale}
                      height={7 / view.scale}
                      fill="#fff"
                      stroke="#8a5a1e"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: 'copy' }}
                      onPointerDown={(e) =>
                        onMidpointPointerDown(e, selectedPolygonTarget.target, i)
                      }
                    />}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={5 / view.scale}
                      fill="#8a5a1e"
                      stroke="#fff"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: 'grab' }}
                      onPointerDown={(e) => onVertexPointerDown(e, selectedPolygonTarget.target, i)}
                      onContextMenu={(e) => onVertexContextMenu(e, selectedPolygonTarget.target, i)}
                    />
                  </g>
                );
              })}
            </g>
          )}

          {/* 地形筆刷游標 */}
          {tool === 'terrain' && cursor && (
            <circle
              cx={cursor.x}
              cy={cursor.y}
              r={brush.radius}
              fill={brush.mode === 'lower' ? 'rgba(141,110,99,0.12)' : 'rgba(141,110,99,0.18)'}
              stroke="#8d6e63"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}

          {/* 剖面線 */}
          {profilePts.length > 0 && (
            <g pointerEvents="none">
              <polyline
                points={pointsAttr(
                  profilePts.length === 1 && cursor ? [...profilePts, cursor] : profilePts
                )}
                fill="none"
                stroke="#5e35b1"
                strokeWidth={2}
                strokeDasharray="6 3"
                vectorEffect="non-scaling-stroke"
              />
              {profilePts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={4 / view.scale} fill="#5e35b1" />
              ))}
            </g>
          )}

          {/* 繪製中的草稿 */}
          {draft.length > 0 && (
            <g pointerEvents="none">
              <polyline
                points={pointsAttr(cursor ? [...draft, cursor] : draft)}
                fill={
                  tool === 'swale' || tool === 'stream'
                    ? 'none'
                    : tool === 'pond'
                      ? 'rgba(103,169,207,0.25)'
                      : tool === 'area'
                        ? AREA_STYLES[areaType].fill
                        : 'rgba(107,79,42,0.08)'
                }
                stroke={
                  tool === 'swale'
                    ? '#0e7490'
                    : tool === 'stream'
                      ? '#2b6c96'
                      : tool === 'pond'
                      ? '#2b6c96'
                      : tool === 'area'
                        ? AREA_STYLES[areaType].stroke
                        : '#6b4f2a'
                }
                strokeWidth={2}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
              {draft.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={(i === 0 && draftClosable ? 6 : 3.5) / view.scale}
                  fill={i === 0 && draftClosable ? '#e07a1f' : '#6b4f2a'}
                  stroke="#fff"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          )}

          {/* 測距 */}
          {measure.length > 0 && (
            <g pointerEvents="none">
              <polyline
                points={pointsAttr(cursor ? [...measure, cursor] : measure)}
                fill="none"
                stroke="#b3261e"
                strokeWidth={2}
                strokeDasharray="2 4"
                vectorEffect="non-scaling-stroke"
              />
              {measure.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={3 / view.scale} fill="#b3261e" />
              ))}
              {cursor && (
                <text
                  x={cursor.x + 10 / view.scale}
                  y={cursor.y - 10 / view.scale}
                  fontSize={13 / view.scale}
                  fill="#b3261e"
                  fontWeight="bold"
                >
                  {measureLen.toFixed(1)} m
                </text>
              )}
            </g>
          )}
        </g>
      </svg>

      {/* 指北針 */}
      <div className="north-arrow" title="北方">
        <div style={{ transform: `rotate(${project.settings.northAngle}deg)` }}>▲</div>
        <span>北</span>
      </div>

      {/* 比例尺 */}
      <div className="scale-bar">
        <div className="scale-bar-line" style={{ width: scaleBar.px }} />
        <span>{scaleBar.meters} m</span>
      </div>

      {/* 剖面圖(M5) */}
      {profile && <ProfileChart profile={profile} />}

      {/* 狀態列 */}
      <div className="status-bar">
        <span className="status-hint">{toolHint}</span>
        <span className="status-coords">
          {cursor
            ? `x ${cursor.x.toFixed(1)}m, y ${cursor.y.toFixed(1)}m` +
              (project.terrain
                ? `, 高程 ${sampleHeight(project.terrain, cursor).toFixed(1)}m`
                : '')
            : ''}
          {'　'}縮放 {view.scale.toFixed(1)} px/m
        </span>
        <button className="status-fit" onClick={fitView} title="縮放至地界">
          ⌖ 全覽
        </button>
      </div>
    </div>
  );
}

// M13 扇形定義:方位角(自北順時針)± 半寬,標註外部能量/影響
const SECTORS: { label: string; azimuth: number; halfAngle: number; color: string }[] = [
  { label: '冬季東北季風', azimuth: 45, halfAngle: 25, color: '#4a6fa5' },
  { label: '夏季西南風', azimuth: 225, halfAngle: 25, color: '#e08e45' },
  { label: '颱風主向(東)', azimuth: 90, halfAngle: 18, color: '#b3261e' },
  { label: '冬至低角度日照', azimuth: 180, halfAngle: 30, color: '#d9a441' },
];

/** 扇形分析圖層:以住家(或地界中心)為圓心的方向扇形 */
function SectorLayer({
  project,
  viewScale,
}: {
  project: HomesteadProject;
  viewScale: number;
}) {
  const data = useMemo(() => {
    if (project.boundary.length < 3) return null;
    const box = boundingBox(project.boundary);
    const center = project.settings.homePosition ?? {
      x: (box.minX + box.maxX) / 2,
      y: (box.minY + box.maxY) / 2,
    };
    const radius = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.75;
    return { center, radius };
  }, [project.boundary, project.settings.homePosition]);
  if (!data) return null;

  // 方位角 → 平面單位向量(x=東、y=南;北 = -y)
  const dir = (azDeg: number) => {
    const az = (azDeg * Math.PI) / 180;
    return { x: Math.sin(az), y: -Math.cos(az) };
  };

  return (
    <g pointerEvents="none">
      {SECTORS.map((s) => {
        const a1 = dir(s.azimuth - s.halfAngle);
        const a2 = dir(s.azimuth + s.halfAngle);
        const mid = dir(s.azimuth);
        const { center, radius } = data;
        const p1 = { x: center.x + a1.x * radius, y: center.y + a1.y * radius };
        const p2 = { x: center.x + a2.x * radius, y: center.y + a2.y * radius };
        const labelPos = {
          x: center.x + mid.x * radius * 0.92,
          y: center.y + mid.y * radius * 0.92,
        };
        return (
          <g key={s.label}>
            <path
              d={`M ${center.x} ${center.y} L ${p1.x} ${p1.y} A ${radius} ${radius} 0 0 1 ${p2.x} ${p2.y} Z`}
              fill={s.color}
              opacity={0.1}
              stroke={s.color}
              strokeWidth={1}
              strokeDasharray="6 5"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={labelPos.x}
              y={labelPos.y}
              fontSize={12 / viewScale}
              fill={s.color}
              textAnchor="middle"
              fontWeight="bold"
            >
              {s.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** 地形剖面小圖 */
function ProfileChart({ profile }: { profile: { dist: number; height: number }[] }) {
  const W = 260;
  const H = 100;
  const pad = 24;
  const maxDist = profile[profile.length - 1].dist || 1;
  let minH = Infinity;
  let maxH = -Infinity;
  for (const p of profile) {
    if (p.height < minH) minH = p.height;
    if (p.height > maxH) maxH = p.height;
  }
  if (maxH - minH < 1) {
    const mid = (maxH + minH) / 2;
    minH = mid - 0.5;
    maxH = mid + 0.5;
  }
  const pts = profile
    .map((p) => {
      const x = pad + (p.dist / maxDist) * (W - pad - 8);
      const y = H - 18 - ((p.height - minH) / (maxH - minH)) * (H - 30);
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <div className="profile-chart">
      <div className="profile-chart-title">地形剖面</div>
      <svg width={W} height={H}>
        <polyline points={pts} fill="none" stroke="#5e35b1" strokeWidth={2} />
        <text x={pad} y={H - 4} fontSize={10} fill="#8a7f68">
          0m
        </text>
        <text x={W - 8} y={H - 4} fontSize={10} fill="#8a7f68" textAnchor="end">
          {maxDist.toFixed(0)}m
        </text>
        <text x={2} y={14} fontSize={10} fill="#8a7f68">
          {maxH.toFixed(1)}m
        </text>
        <text x={2} y={H - 18} fontSize={10} fill="#8a7f68">
          {minH.toFixed(1)}m
        </text>
      </svg>
    </div>
  );
}

export { AREA_STYLES, CATEGORY_LABELS };
