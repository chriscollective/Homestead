// M9 自給自足儀表板
import { useMemo } from 'react';
import { speciesById } from '../data/plants';
import { selfSufficiency } from '../engine/sustain';
import { useProjectStore } from '../store/useProjectStore';

function RatioBar({ label, ratio, detail }: { label: string; ratio: number; detail: string }) {
  const pct = Math.round(ratio * 100);
  const cls = pct >= 100 ? 'ok' : pct >= 50 ? 'mid' : 'low';
  return (
    <div className="forest-meter">
      <div className="forest-meter-head">
        <span>{label}</span>
        <strong className={cls}>{pct}%</strong>
      </div>
      <div className="forest-meter-bar">
        <div className={`forest-meter-fill ${cls}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <small>{detail}</small>
    </div>
  );
}

export function SustainPanel() {
  const project = useProjectStore((s) => s.project);
  const viewYear = useProjectStore((s) => s.viewYear);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const people = project.settings.people;

  const report = useMemo(
    () => selfSufficiency(project, speciesById, viewYear, people),
    [project, viewYear, people]
  );

  return (
    <div className="panel sustain-panel">
      <h3>自給率儀表板(第 {viewYear} 年)</h3>
      <label className="field">
        <span>家庭人數</span>
        <input
          type="number"
          min={1}
          max={20}
          value={people}
          onChange={(e) =>
            updateSettings({ people: Math.min(Math.max(Number(e.target.value) || 1, 1), 20) })
          }
        />
      </label>
      <RatioBar
        label="🍎 食物"
        ratio={report.foodRatio}
        detail={`果樹 ${Math.round(report.fruitKgPerYear)}kg + 菜園 ${Math.round(
          report.gardenKgPerYear
        )}kg/年 ≈ ${Math.round(report.kcalPerDay)} kcal/日(目標:六成熱量自給)`}
      />
      <RatioBar
        label="💧 水"
        ratio={report.waterRatio}
        detail={`池塘集雨約 ${Math.round(report.waterCollectedM3)} m³/年 vs 生活用水需求`}
      />
      <RatioBar
        label="🔥 柴火"
        ratio={report.firewoodRatio}
        detail={`林地永續採伐約 ${report.firewoodSupplyT.toFixed(1)} 噸/年 vs 家庭需求 2 噸`}
      />
      <small className="analysis-note">估算值僅供規劃參考;拉動時間軸看自給率成長曲線</small>
    </div>
  );
}
