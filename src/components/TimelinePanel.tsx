// M4 時間軸:年份滑桿 + 關鍵年份快照對比
import { useMemo, useState } from 'react';
import { speciesById } from '../data/plants';
import { boundingBox } from '../engine/geometry';
import { canopyRadiusAtAge, isPlantAlive } from '../engine/growth';
import { useProjectStore } from '../store/useProjectStore';
import type { HomesteadProject } from '../types';

const QUICK_YEARS = [0, 1, 5, 10, 20, 50];
export const MAX_YEAR = 50;

export function TimelinePanel() {
  const viewYear = useProjectStore((s) => s.viewYear);
  const setViewYear = useProjectStore((s) => s.setViewYear);
  const [compareOpen, setCompareOpen] = useState(false);

  return (
    <>
      <div className="timeline-panel">
        <span className="timeline-year">
          第 <strong>{viewYear}</strong> 年
        </span>
        <input
          type="range"
          min={0}
          max={MAX_YEAR}
          step={1}
          value={viewYear}
          onChange={(e) => setViewYear(Number(e.target.value))}
          className="timeline-slider"
        />
        <div className="timeline-quick">
          {QUICK_YEARS.map((y) => (
            <button
              key={y}
              className={y === viewYear ? 'active' : ''}
              onClick={() => setViewYear(y)}
            >
              {y}
            </button>
          ))}
        </div>
        <button className="timeline-compare-btn" onClick={() => setCompareOpen(true)}>
          ⇄ 對比
        </button>
      </div>
      {compareOpen && <CompareModal onClose={() => setCompareOpen(false)} />}
    </>
  );
}

/** 關鍵年份並排對比(規格書 M4) */
function CompareModal({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const [yearA, setYearA] = useState(1);
  const [yearB, setYearB] = useState(10);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal compare-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>年份快照對比</h3>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="compare-grid">
          {[
            { year: yearA, set: setYearA },
            { year: yearB, set: setYearB },
          ].map((side, i) => (
            <div key={i} className="compare-side">
              <label>
                第
                <input
                  type="number"
                  min={0}
                  max={MAX_YEAR}
                  value={side.year}
                  onChange={(e) =>
                    side.set(Math.min(Math.max(Number(e.target.value) || 0, 0), MAX_YEAR))
                  }
                />
                年
              </label>
              <StaticPlanSvg project={project} year={side.year} width={380} height={300} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const AREA_FILLS: Record<string, string> = {
  forest: 'rgba(45,106,79,0.35)',
  garden: 'rgba(224,178,84,0.4)',
  meadow: 'rgba(163,181,107,0.35)',
};

const CANOPY_FILLS: Record<string, string> = {
  tree_fruit: 'rgba(82,183,136,0.5)',
  tree_forest: 'rgba(45,106,79,0.5)',
  shrub: 'rgba(149,213,178,0.6)',
  bamboo: 'rgba(116,160,87,0.5)',
};

/** 純渲染:某年份的家園平面縮圖(對比模式用,無互動) */
export function StaticPlanSvg({
  project,
  year,
  width,
  height,
}: {
  project: HomesteadProject;
  year: number;
  width: number;
  height: number;
}) {
  const viewBox = useMemo(() => {
    if (project.boundary.length < 3) return '0 0 100 100';
    const box = boundingBox(project.boundary);
    const pad = 8;
    return `${box.minX - pad} ${box.minY - pad} ${box.maxX - box.minX + pad * 2} ${
      box.maxY - box.minY + pad * 2
    }`;
  }, [project.boundary]);

  const pts = (poly: { x: number; y: number }[]) => poly.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <svg
      viewBox={viewBox}
      width={width}
      height={height}
      style={{ background: '#eae6d8', borderRadius: 8 }}
      preserveAspectRatio="xMidYMid meet"
    >
      {project.boundary.length >= 3 && (
        <polygon points={pts(project.boundary)} fill="#f7f4ea" stroke="#6b4f2a" strokeWidth={1} />
      )}
      {project.elements.map((el) => {
        if (el.kind === 'area') {
          return (
            <polygon
              key={el.id}
              points={pts(el.polygon)}
              fill={AREA_FILLS[el.areaType]}
              stroke="none"
            />
          );
        }
        if (el.kind === 'water') {
          return (
            <polygon
              key={el.id}
              points={pts(el.polygon)}
              fill="rgba(103,169,207,0.6)"
              stroke="none"
            />
          );
        }
        if (el.kind !== 'plant') return null;
        const species = speciesById.get(el.speciesId);
        if (!species || !isPlantAlive(el.plantedYear, el.removedYear, year)) return null;
        const r = canopyRadiusAtAge(species.growth.canopyCurve, year - el.plantedYear);
        return (
          <circle
            key={el.id}
            cx={el.position.x}
            cy={el.position.y}
            r={Math.max(r, 0.3)}
            fill={CANOPY_FILLS[species.category] ?? CANOPY_FILLS.tree_fruit}
            stroke="rgba(27,67,50,0.6)"
            strokeWidth={0.3}
          />
        );
      })}
    </svg>
  );
}
