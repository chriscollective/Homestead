import { useMemo } from 'react';
import { speciesById } from '../data/plants';
import {
  m2ToHectare,
  m2ToPing,
  polygonArea,
  polygonPerimeter,
} from '../engine/geometry';
import {
  elementStats,
  FOREST_TARGET_RATIO,
  forestCoverageRatio,
  spacingConflicts,
} from '../engine/metrics';
import { synergyHints } from '../engine/permaculture';
import { zoneWarnings } from '../engine/zones';
import { useProjectStore } from '../store/useProjectStore';

export function Dashboard() {
  const project = useProjectStore((s) => s.project);
  const viewYear = useProjectStore((s) => s.viewYear);

  const areaM2 = useMemo(() => polygonArea(project.boundary), [project.boundary]);
  const perimeter = useMemo(() => polygonPerimeter(project.boundary), [project.boundary]);

  const forestRatio = useMemo(() => {
    // 取樣間距依地界規模調整,維持互動流暢;依時間軸年份計算當年冠幅
    const step = Math.max(1, Math.sqrt(areaM2) / 100);
    return forestCoverageRatio(project, speciesById, step, viewYear);
  }, [project, areaM2, viewYear]);

  const warnings = useMemo(() => zoneWarnings(project), [project]);
  const synergies = useMemo(() => synergyHints(project), [project]);

  const stats = useMemo(() => elementStats(project), [project]);
  const conflictCount = useMemo(
    () => spacingConflicts(project, speciesById).length,
    [project]
  );

  const ratioPct = Math.round(forestRatio * 100);
  const targetPct = FOREST_TARGET_RATIO * 100;
  const ratioClass = ratioPct >= targetPct ? 'ok' : ratioPct >= targetPct / 2 ? 'mid' : 'low';

  return (
    <div className="panel dashboard">
      <h3>設計儀表</h3>
      {project.boundary.length >= 3 ? (
        <>
          <div className="stat-row">
            <span>面積</span>
            <strong>
              {Math.round(areaM2).toLocaleString()} ㎡
              <small>
                ≈ {m2ToHectare(areaM2).toFixed(2)} 公頃 / {Math.round(m2ToPing(areaM2)).toLocaleString()} 坪
              </small>
            </strong>
          </div>
          <div className="stat-row">
            <span>周長</span>
            <strong>{Math.round(perimeter)} m</strong>
          </div>

          <div className="forest-meter">
            <div className="forest-meter-head">
              <span>森林覆蓋比例(第 {viewYear} 年)</span>
              <strong className={ratioClass}>{ratioPct}%</strong>
            </div>
            <div className="forest-meter-bar">
              <div className={`forest-meter-fill ${ratioClass}`} style={{ width: `${Math.min(ratioPct, 100)}%` }} />
              <div className="forest-meter-target" style={{ left: `${targetPct}%` }} title={`目標 ${targetPct}%`} />
            </div>
            <small>祖傳家園原則:森林約佔 {targetPct}%(含樹冠與林地區塊)</small>
          </div>

          <div className="stat-grid">
            <div>
              <strong>{stats.plants}</strong>
              <span>植栽</span>
            </div>
            <div>
              <strong>{Math.round(stats.gardenAreaM2)}</strong>
              <span>菜園 ㎡</span>
            </div>
            <div>
              <strong>{Math.round(stats.pondAreaM2)}</strong>
              <span>水體 ㎡</span>
            </div>
          </div>

          {stats.pondAreaM2 === 0 && (
            <div className="advice">💧 尚未配置水體 — 祖傳家園原則建議至少一處池塘或水源</div>
          )}
          {conflictCount > 0 && (
            <div className="warning">⚠ {conflictCount} 組喬木間距過近(依成熟冠幅),畫布上以紅色虛線標示</div>
          )}
          {warnings.map((w) => (
            <div key={w.elementId} className="warning">
              🧭 {w.message}
            </div>
          ))}
          {synergies.map((h, i) => (
            <div key={i} className={h.kind === 'good' ? 'advice' : 'warning'}>
              {h.message}
            </div>
          ))}
        </>
      ) : (
        <div className="advice">尚未繪製地界 — 請用「⬠ 繪製地界」工具開始</div>
      )}
    </div>
  );
}
