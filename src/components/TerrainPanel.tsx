// M5 地形筆刷設定面板(地形工具啟用時顯示)
import { createTerrain, type BrushMode } from '../engine/terrain';
import { useProjectStore } from '../store/useProjectStore';

const MODES: { id: BrushMode; label: string }[] = [
  { id: 'raise', label: '⛰ 抬升' },
  { id: 'lower', label: '⏷ 下降' },
  { id: 'smooth', label: '〰 平滑' },
];

export function TerrainPanel() {
  const brush = useProjectStore((s) => s.brush);
  const setBrush = useProjectStore((s) => s.setBrush);
  const terrain = useProjectStore((s) => s.project.terrain);
  const commit = useProjectStore((s) => s.commit);

  const rebuild = () => {
    if (
      terrain &&
      !confirm('重建地形網格會清除目前的地勢塑形(可用 Ctrl+Z 復原),確定嗎?')
    ) {
      return;
    }
    commit((p) => ({ ...p, terrain: createTerrain(p.boundary) }));
  };

  return (
    <div className="panel terrain-panel">
      <h3>地形筆刷</h3>
      <div className="brush-modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`tool-sub-btn ${brush.mode === m.id ? 'active' : ''}`}
            onClick={() => setBrush({ mode: m.id })}
          >
            {m.label}
          </button>
        ))}
      </div>
      <label className="field">
        <span>筆刷半徑:{brush.radius} m</span>
        <input
          type="range"
          min={2}
          max={30}
          step={1}
          value={brush.radius}
          onChange={(e) => setBrush({ radius: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        <span>
          強度:{brush.strength} {brush.mode === 'smooth' ? '(混合比)' : 'm/筆'}
        </span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.1}
          value={brush.strength}
          onChange={(e) => setBrush({ strength: Number(e.target.value) })}
        />
      </label>
      <small>
        {terrain
          ? `網格 ${terrain.cols}×${terrain.rows} @ ${terrain.resolution}m`
          : '第一筆會自動建立地形網格(解析度 2m)'}
      </small>
      <small>
        🎨 塑形時畫布會即時顯示「立體陰影 + 高程著色」(亮 = 高、暗 = 低);
        想更直觀,切到 <strong>3D 立體</strong> 按「⛰ 塑形」直接在立體地形上雕塑
      </small>
      {terrain && (
        <button className="danger-btn" onClick={rebuild}>
          重建地形網格(地界變更後用)
        </button>
      )}
    </div>
  );
}
