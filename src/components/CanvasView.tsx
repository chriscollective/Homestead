import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { CATEGORY_LABELS, speciesById } from '../data/plants';
import { boundingBox, distance, polygonArea, polylineLength } from '../engine/geometry';
import { matureCanopyRadius } from '../engine/growth';
import { spacingConflicts } from '../engine/metrics';
import { newId, useProjectStore } from '../store/useProjectStore';
import type { AreaType, PlacedElement, Point } from '../types';

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
  | null;

const AREA_STYLES: Record<AreaType, { fill: string; stroke: string; label: string }> = {
  forest: { fill: 'rgba(45,106,79,0.35)', stroke: '#2d6a4f', label: '林地' },
  garden: { fill: 'rgba(224,178,84,0.4)', stroke: '#a67c26', label: '菜園' },
  meadow: { fill: 'rgba(163,181,107,0.35)', stroke: '#7a8c4a', label: '草地' },
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
  const selectedId = useProjectStore((s) => s.selectedId);
  const select = useProjectStore((s) => s.select);
  const setTool = useProjectStore((s) => s.setTool);
  const commit = useProjectStore((s) => s.commit);
  const beginDrag = useProjectStore((s) => s.beginDrag);
  const transient = useProjectStore((s) => s.transient);
  const endDrag = useProjectStore((s) => s.endDrag);

  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 5, tx: 60, ty: 40 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [draft, setDraft] = useState<Point[]>([]);
  const [measure, setMeasure] = useState<Point[]>([]);
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
  }, []);

  // 工具切換時取消進行中的繪製
  useEffect(() => {
    cancelDraft();
  }, [tool, cancelDraft]);

  const finishDraft = useCallback(() => {
    setDraft((points) => {
      const clean = dedupe(points);
      if (clean.length >= 3) {
        if (tool === 'boundary') {
          commit((p) => ({ ...p, boundary: clean }));
          setTool('select');
        } else if (tool === 'area') {
          commit((p) => ({
            ...p,
            elements: [
              ...p.elements,
              { id: newId('area'), kind: 'area', areaType, polygon: clean },
            ],
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
      }
      return [];
    });
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
    } else if (tool === 'boundary' || tool === 'area' || tool === 'pond') {
      // 點擊起點附近 → 閉合
      if (draft.length >= 3 && distance(p, draft[0]) < 12 / view.scale) {
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
            plantedYear: 0,
          },
        ],
      }));
    } else if (tool === 'measure') {
      setMeasure((m) => [...m, p]);
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
    } else if (drag.type === 'plant') {
      transient((proj) => ({
        ...proj,
        elements: proj.elements.map((el) =>
          el.id === drag.id && el.kind === 'plant'
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
        elements: proj.elements.map((el) =>
          el.id === drag.id && (el.kind === 'area' || el.kind === 'water')
            ? { ...el, polygon: el.polygon.map((q) => ({ x: q.x + dx, y: q.y + dy })) }
            : el
        ),
      }));
    } else if (drag.type === 'vertex') {
      transient((proj) => {
        if (drag.target === 'boundary') {
          const boundary = proj.boundary.map((q, i) => (i === drag.index ? p : q));
          return { ...proj, boundary };
        }
        return {
          ...proj,
          elements: proj.elements.map((el) =>
            el.id === drag.target && (el.kind === 'area' || el.kind === 'water')
              ? { ...el, polygon: el.polygon.map((q, i) => (i === drag.index ? p : q)) }
              : el
          ),
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
    if (el.kind === 'plant') {
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
        elements: proj.elements.map((el) =>
          el.id === target && (el.kind === 'area' || el.kind === 'water') && el.polygon.length > 3
            ? { ...el, polygon: el.polygon.filter((_, i) => i !== index) }
            : el
        ),
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
          if (el.id !== target || (el.kind !== 'area' && el.kind !== 'water')) return el;
          const polygon = [...el.polygon];
          polygon.splice(index + 1, 0, p);
          return { ...el, polygon };
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

  // 比例尺:取接近 80px 的整數公尺
  const scaleBar = useMemo(() => {
    const target = 80 / view.scale;
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    const meters = nice.find((n) => n >= target) ?? 500;
    return { meters, px: meters * view.scale };
  }, [view.scale]);

  const selectedPolygonTarget = useMemo(() => {
    if (selectedId === 'boundary') return { target: 'boundary' as const, polygon: project.boundary };
    const el = project.elements.find((x) => x.id === selectedId);
    if (el && (el.kind === 'area' || el.kind === 'water')) {
      return { target: el.id, polygon: el.polygon };
    }
    return null;
  }, [selectedId, project]);

  const toolHint: string = {
    select: '點選元素/拖曳移動;右鍵頂點可刪除;空白處拖曳平移、滾輪縮放',
    boundary: '逐點點擊繪製地界;點擊起點或雙擊完成;Esc 取消',
    plant: `點擊放置「${speciesById.get(selectedSpeciesId)?.nameZh ?? ''}」`,
    area: `逐點點擊繪製${AREA_STYLES[areaType].label}區塊;雙擊完成`,
    pond: '逐點點擊繪製池塘;雙擊完成',
    measure: '逐點點擊測距;Esc 清除',
  }[tool];

  const draftClosable = draft.length >= 3;
  const measureLen = polylineLength(cursor && measure.length > 0 ? [...measure, cursor] : measure);

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
              : tool === 'plant'
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

          {/* 植栽(樹冠圈 + 植株點) */}
          {project.elements.map((el) => {
            if (el.kind !== 'plant') return null;
            const species = speciesById.get(el.speciesId);
            if (!species) return null;
            const radius = matureCanopyRadius(species.growth.canopyCurve);
            const style = CANOPY_STYLES[species.category] ?? CANOPY_STYLES.tree_fruit;
            const conflicted = conflictIds.has(el.id);
            const isSelected = el.id === selectedId;
            return (
              <g
                key={el.id}
                pointerEvents={tool === 'select' ? 'auto' : 'none'}
                onPointerDown={(e) => onElementPointerDown(e, el)}
                style={{ cursor: tool === 'select' ? 'move' : undefined }}
              >
                <circle
                  cx={el.position.x}
                  cy={el.position.y}
                  r={Math.max(radius, 0.3)}
                  fill={style.fill}
                  stroke={conflicted ? '#d62828' : isSelected ? '#1b4332' : style.stroke}
                  strokeWidth={isSelected || conflicted ? 2.5 : 1.2}
                  strokeDasharray={conflicted ? '6 4' : undefined}
                  vectorEffect="non-scaling-stroke"
                />
                <circle cx={el.position.x} cy={el.position.y} r={0.25} fill="#5c4326" />
                {view.scale > 3 && (
                  <text
                    x={el.position.x}
                    y={el.position.y - radius - 4 / view.scale}
                    fontSize={12 / view.scale}
                    fill="#3d3425"
                    textAnchor="middle"
                    pointerEvents="none"
                  >
                    {species.nameZh}
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
                const next =
                  selectedPolygonTarget.polygon[(i + 1) % selectedPolygonTarget.polygon.length];
                const mid = { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 };
                return (
                  <g key={i}>
                    <rect
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
                    />
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

          {/* 繪製中的草稿 */}
          {draft.length > 0 && (
            <g pointerEvents="none">
              <polyline
                points={pointsAttr(cursor ? [...draft, cursor] : draft)}
                fill={
                  tool === 'pond'
                    ? 'rgba(103,169,207,0.25)'
                    : tool === 'area'
                      ? AREA_STYLES[areaType].fill
                      : 'rgba(107,79,42,0.08)'
                }
                stroke={tool === 'pond' ? '#2b6c96' : tool === 'area' ? AREA_STYLES[areaType].stroke : '#6b4f2a'}
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

      {/* 狀態列 */}
      <div className="status-bar">
        <span className="status-hint">{toolHint}</span>
        <span className="status-coords">
          {cursor ? `x ${cursor.x.toFixed(1)}m, y ${cursor.y.toFixed(1)}m` : ''}
          {'　'}縮放 {view.scale.toFixed(1)} px/m
        </span>
        <button className="status-fit" onClick={fitView} title="縮放至地界">
          ⌖ 全覽
        </button>
      </div>
    </div>
  );
}

export { AREA_STYLES, CATEGORY_LABELS };
