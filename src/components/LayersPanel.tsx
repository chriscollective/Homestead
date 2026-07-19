// 分析圖層開關(M5 等高線/坡度、M13 分區環)
import { useProjectStore } from '../store/useProjectStore';

export function LayersPanel() {
  const settings = useProjectStore((s) => s.project.settings);
  const terrain = useProjectStore((s) => s.project.terrain);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const showRelief = useProjectStore((s) => s.showRelief);
  const setShowRelief = useProjectStore((s) => s.setShowRelief);

  return (
    <div className="panel layers-panel">
      <h3>分析圖層</h3>
      <label className="layer-toggle">
        <input
          type="checkbox"
          checked={showRelief}
          onChange={(e) => setShowRelief(e.target.checked)}
          disabled={!terrain}
        />
        地形立體陰影(高程著色 + hillshade)
      </label>
      <label className="layer-toggle">
        <input
          type="checkbox"
          checked={settings.showContours}
          onChange={(e) => updateSettings({ showContours: e.target.checked })}
          disabled={!terrain}
        />
        等高線
        {settings.showContours && terrain && (
          <select
            value={settings.contourInterval}
            onChange={(e) =>
              updateSettings({ contourInterval: Number(e.target.value) as 0.5 | 1 })
            }
          >
            <option value={0.5}>0.5m</option>
            <option value={1}>1m</option>
          </select>
        )}
      </label>
      <label className="layer-toggle">
        <input
          type="checkbox"
          checked={settings.showSlope}
          onChange={(e) => updateSettings({ showSlope: e.target.checked })}
          disabled={!terrain}
        />
        坡度熱圖(&gt;15° 橘、&gt;30° 紅)
      </label>
      <label className="layer-toggle">
        <input
          type="checkbox"
          checked={settings.showZones}
          onChange={(e) => updateSettings({ showZones: e.target.checked })}
          disabled={!settings.homePosition}
        />
        樸門分區環(Zone 1-4)
      </label>
      <label className="layer-toggle">
        <input
          type="checkbox"
          checked={settings.showSectors}
          onChange={(e) => updateSettings({ showSectors: e.target.checked })}
        />
        扇形分析(季風/颱風/冬陽方向)
      </label>
      {!terrain && <small>地勢圖層需先用「⛰ 地形」工具塑形</small>}
      {!settings.homePosition && <small>分區環需先用「🏠 住家」工具放置住家</small>}
    </div>
  );
}
