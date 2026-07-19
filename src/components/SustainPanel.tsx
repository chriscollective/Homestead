// M9 自給自足儀表板
import { useMemo } from 'react';
import { speciesById } from '../data/plants';
import {
  KWH_PER_PERSON_YEAR,
  shadeFactorAt,
  solarRoofKwh,
  WIND_CLASS_LABELS,
  windTurbineKwh,
  type WindClass,
} from '../engine/energy';
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

/** M12 能源自給率(併入 M9 儀表板) */
function EnergySection() {
  const project = useProjectStore((s) => s.project);
  const viewYear = useProjectStore((s) => s.viewYear);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const { people, windTurbineKw, windClass } = project.settings;

  const energy = useMemo(() => {
    let solar = 0;
    for (const el of project.elements) {
      if (el.kind === 'building' && (el.solarRoofM2 ?? 0) > 0) {
        solar += solarRoofKwh(el.solarRoofM2!, shadeFactorAt(project, speciesById, viewYear, el));
      }
    }
    const wind = windTurbineKwh(windTurbineKw, windClass);
    const need = people * KWH_PER_PERSON_YEAR;
    return { solar, wind, need, ratio: need > 0 ? (solar + wind) / need : 0 };
  }, [project, viewYear, windTurbineKw, windClass, people]);

  return (
    <>
      <RatioBar
        label="⚡ 能源"
        ratio={energy.ratio}
        detail={`太陽能 ${Math.round(energy.solar)} + 風力 ${Math.round(
          energy.wind
        )} 度/年 vs 需求約 ${energy.need} 度(在建物屬性設光電板;冬季東北季風與夏季日照互補)`}
      />
      <label className="field">
        <span>小型風機(kW,0 = 無)</span>
        <input
          type="number"
          min={0}
          max={20}
          step={0.5}
          value={windTurbineKw}
          onChange={(e) =>
            updateSettings({ windTurbineKw: Math.max(Number(e.target.value) || 0, 0) })
          }
        />
      </label>
      {windTurbineKw > 0 && (
        <label className="field">
          <span>風區等級</span>
          <select
            value={windClass}
            onChange={(e) => updateSettings({ windClass: e.target.value as WindClass })}
          >
            {(Object.keys(WIND_CLASS_LABELS) as WindClass[]).map((c) => (
              <option key={c} value={c}>
                {WIND_CLASS_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
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
      <EnergySection />
      <small className="analysis-note">估算值僅供規劃參考;拉動時間軸看自給率成長曲線</small>
    </div>
  );
}
