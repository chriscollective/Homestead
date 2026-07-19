// M7 環境分析控制面板
import { dayOfYearForMonth, solarPosition } from '../engine/sun';
import { WIND_LABELS } from '../engine/wind';
import { useProjectStore } from '../store/useProjectStore';
import type { ProjectSettings } from '../types';

export function AnalysisPanel() {
  const settings = useProjectStore((s) => s.project.settings);
  const terrain = useProjectStore((s) => s.project.terrain);
  const updateSettings = useProjectStore((s) => s.updateSettings);

  const sun = solarPosition(23.5, dayOfYearForMonth(settings.sunMonth), settings.sunHour);

  return (
    <div className="panel analysis-panel">
      <h3>環境分析</h3>

      <label className="layer-toggle">
        <input
          type="checkbox"
          checked={settings.showShadows}
          onChange={(e) => updateSettings({ showShadows: e.target.checked })}
        />
        樹冠陰影(指定時刻)
      </label>
      {settings.showShadows && (
        <div className="analysis-sub">
          <label className="field">
            <span>
              月份:{settings.sunMonth} 月
              {settings.sunMonth === 6 ? '(近夏至)' : settings.sunMonth === 12 ? '(近冬至)' : ''}
            </span>
            <input
              type="range"
              min={1}
              max={12}
              value={settings.sunMonth}
              onChange={(e) => updateSettings({ sunMonth: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>時刻:{settings.sunHour}:00(太陽時)</span>
            <input
              type="range"
              min={6}
              max={18}
              value={settings.sunHour}
              onChange={(e) => updateSettings({ sunHour: Number(e.target.value) })}
            />
          </label>
          <div className="analysis-quick">
            <button onClick={() => updateSettings({ sunMonth: 6, sunHour: 12 })}>夏至正午</button>
            <button onClick={() => updateSettings({ sunMonth: 12, sunHour: 12 })}>冬至正午</button>
          </div>
          <small>
            太陽仰角 {sun.elevationDeg.toFixed(0)}°、方位 {sun.azimuthDeg.toFixed(0)}°
            {sun.elevationDeg <= 0 && '(夜間,無陰影)'}
          </small>
        </div>
      )}

      <label className="layer-toggle">
        <input
          type="checkbox"
          checked={settings.showInsolation}
          onChange={(e) => updateSettings({ showInsolation: e.target.checked })}
        />
        全年日照熱圖(暗 = 長期遮蔭)
      </label>

      <label className="layer-toggle">
        <input
          type="checkbox"
          checked={settings.showFlow}
          onChange={(e) => updateSettings({ showFlow: e.target.checked })}
          disabled={!terrain}
        />
        地表逕流與匯流(D8)
      </label>
      {!terrain && <small>水流分析需先用「⛰ 地形」工具塑形</small>}
      {settings.showFlow && terrain && (
        <small>箭頭越粗 = 匯流越多;粗箭頭匯集處適合設池塘/swale</small>
      )}

      <label className="layer-toggle">
        <input
          type="checkbox"
          checked={settings.showWind}
          onChange={(e) => updateSettings({ showWind: e.target.checked })}
        />
        季風與防風效果
      </label>
      {settings.showWind && (
        <div className="analysis-sub">
          <select
            value={settings.windDir}
            onChange={(e) =>
              updateSettings({ windDir: e.target.value as ProjectSettings['windDir'] })
            }
          >
            {(Object.keys(WIND_LABELS) as (keyof typeof WIND_LABELS)[]).map((d) => (
              <option key={d} value={d}>
                {WIND_LABELS[d]}
              </option>
            ))}
          </select>
          <small>綠色橢圓 = 樹木背風側減風區(樹高 × 12 倍簡化模型)</small>
        </div>
      )}

      <small className="analysis-note">分析為規劃參考的簡化模型,非科學模擬</small>
    </div>
  );
}
