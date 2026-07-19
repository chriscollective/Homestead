// M8 房型選擇面板(建物工具啟用時顯示)
import { BUILDING_MODELS } from '../data/buildings';
import { useProjectStore } from '../store/useProjectStore';

export function BuildingPalette() {
  const selectedBuildingId = useProjectStore((s) => s.selectedBuildingId);
  const setSelectedBuilding = useProjectStore((s) => s.setSelectedBuilding);

  return (
    <div className="panel">
      <h3>預設房型({BUILDING_MODELS.length} 種)</h3>
      {BUILDING_MODELS.map((m) => (
        <button
          key={m.id}
          className={`species-item ${m.id === selectedBuildingId ? 'active' : ''}`}
          onClick={() => setSelectedBuilding(m.id)}
        >
          <span className="species-name">
            <span
              style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                borderRadius: 3,
                background: m.color,
              }}
            />
            {m.label}
          </span>
          <span className="species-meta">
            {m.width}×{m.depth}m・高 {m.height}m
          </span>
        </button>
      ))}
      <small className="species-note">放置後在屬性面板調整朝向;建物會投影到光照分析</small>
    </div>
  );
}
