import { useMemo } from 'react';
import { BUILDING_MODELS, buildingModelById, facingLabel } from '../data/buildings';
import { CATEGORY_LABELS, PLANT_SPECIES, speciesById } from '../data/plants';
import { polygonArea, polygonPerimeter } from '../engine/geometry';
import { futureShadeYear, shadeFactorAt, solarRoofKwh } from '../engine/energy';
import { dayOfYearForMonth, solarPosition } from '../engine/sun';
import { useProjectStore } from '../store/useProjectStore';
import type { AreaType, BuildingElement } from '../types';

const AREA_LABELS: Record<AreaType, string> = {
  forest: '林地',
  garden: '菜園',
  meadow: '草地',
};

/** M12 屋頂光電估算 + 未來樹蔭遮蔽警示 */
function SolarEstimate({ building }: { building: BuildingElement }) {
  const project = useProjectStore((s) => s.project);
  const viewYear = useProjectStore((s) => s.viewYear);
  const area = building.solarRoofM2 ?? 0;
  const est = useMemo(() => {
    if (area <= 0) return null;
    const factor = shadeFactorAt(project, speciesById, viewYear, building);
    return {
      factor,
      kwh: solarRoofKwh(area, factor),
      shadeYear: futureShadeYear(project, speciesById, viewYear, building),
    };
  }, [area, project, viewYear, building]);
  if (!est) return null;
  return (
    <div className="species-detail">
      ☀ 第 {viewYear} 年估年發電約 <strong>{Math.round(est.kwh).toLocaleString()} 度</strong>
      (日照係數 {(est.factor * 100).toFixed(0)}%)
      {est.shadeYear !== null && est.shadeYear > viewYear && (
        <div>⚠ 依時間軸模擬,約第 {est.shadeYear} 年起面板將被長大的樹冠明顯遮蔽,建議調整樹或面板位置</div>
      )}
      {est.factor < 0.7 && <div>⚠ 目前已有明顯樹蔭遮蔽,發電效益偏低</div>}
      <div>規劃參考值;實際安裝需專業評估</div>
    </div>
  );
}

export function PropertiesPanel() {
  const project = useProjectStore((s) => s.project);
  const selectedId = useProjectStore((s) => s.selectedId);
  const select = useProjectStore((s) => s.select);
  const commit = useProjectStore((s) => s.commit);

  const element = useMemo(
    () => project.elements.find((el) => el.id === selectedId) ?? null,
    [project.elements, selectedId]
  );

  if (selectedId === 'boundary') {
    return (
      <div className="panel properties">
        <h3>地界</h3>
        <div className="stat-row">
          <span>面積</span>
          <strong>{Math.round(polygonArea(project.boundary)).toLocaleString()} ㎡</strong>
        </div>
        <div className="stat-row">
          <span>周長</span>
          <strong>{Math.round(polygonPerimeter(project.boundary))} m</strong>
        </div>
        <div className="stat-row">
          <span>頂點數</span>
          <strong>{project.boundary.length}</strong>
        </div>
        <small>拖曳頂點修改;點邊線中點的方塊插入頂點;右鍵頂點刪除。要整個重畫請用「⬠ 繪製地界」工具。</small>
      </div>
    );
  }

  if (!element) return null;

  const remove = () => {
    commit((p) => ({ ...p, elements: p.elements.filter((el) => el.id !== element.id) }));
    select(null);
  };

  const setNote = (note: string) => {
    commit((p) => ({
      ...p,
      elements: p.elements.map((el) => (el.id === element.id ? { ...el, note } : el)),
    }));
  };

  if (element.kind === 'plant') {
    const species = speciesById.get(element.speciesId);
    return (
      <div className="panel properties">
        <h3>植栽</h3>
        <label className="field">
          <span>物種</span>
          <select
            value={element.speciesId}
            onChange={(e) =>
              commit((p) => ({
                ...p,
                elements: p.elements.map((el) =>
                  el.id === element.id && el.kind === 'plant'
                    ? { ...el, speciesId: e.target.value }
                    : el
                ),
              }))
            }
          >
            {PLANT_SPECIES.map((s) => (
              <option key={s.id} value={s.id}>
                {CATEGORY_LABELS[s.category]}・{s.nameZh}
              </option>
            ))}
          </select>
        </label>
        {species && (
          <div className="species-detail">
            <em>{species.nameSci}</em>
            <div>
              日照:{{ full: '全日照', partial: '半日照', shade: '耐陰' }[species.needs.sun]}
              ・需水 {'💧'.repeat(species.needs.water)}
            </div>
            <div>
              耐風:{['低(避風處)', '中', '高(耐颱風)'][species.needs.windTolerance - 1]}
            </div>
            {species.yield && (
              <div>
                第 {species.yield.startYear} 年起結果,成熟期約 {species.yield.matureKgPerYear} kg/年
              </div>
            )}
          </div>
        )}
        <label className="field">
          <span>種植年份(第 N 年)</span>
          <input
            type="number"
            min={0}
            max={50}
            value={element.plantedYear}
            onChange={(e) =>
              commit((p) => ({
                ...p,
                elements: p.elements.map((el) =>
                  el.id === element.id && el.kind === 'plant'
                    ? { ...el, plantedYear: Number(e.target.value) || 0 }
                    : el
                ),
              }))
            }
          />
        </label>
        <label className="field">
          <span>移除年份(留空 = 不移除)</span>
          <input
            type="number"
            min={0}
            max={50}
            value={element.removedYear ?? ''}
            placeholder="—"
            onChange={(e) =>
              commit((p) => ({
                ...p,
                elements: p.elements.map((el) =>
                  el.id === element.id && el.kind === 'plant'
                    ? {
                        ...el,
                        removedYear:
                          e.target.value === '' ? undefined : Number(e.target.value) || 0,
                      }
                    : el
                ),
              }))
            }
          />
        </label>
        <div className="stat-row">
          <span>位置</span>
          <strong>
            ({element.position.x.toFixed(1)}, {element.position.y.toFixed(1)}) m
          </strong>
        </div>
        <label className="field">
          <span>備註</span>
          <textarea value={element.note ?? ''} onChange={(e) => setNote(e.target.value)} rows={2} />
        </label>
        <button className="danger-btn" onClick={remove}>
          刪除植栽
        </button>
      </div>
    );
  }

  if (element.kind === 'area') {
    return (
      <div className="panel properties">
        <h3>{AREA_LABELS[element.areaType]}區塊</h3>
        <label className="field">
          <span>類型</span>
          <select
            value={element.areaType}
            onChange={(e) =>
              commit((p) => ({
                ...p,
                elements: p.elements.map((el) =>
                  el.id === element.id && el.kind === 'area'
                    ? { ...el, areaType: e.target.value as AreaType }
                    : el
                ),
              }))
            }
          >
            {(Object.keys(AREA_LABELS) as AreaType[]).map((t) => (
              <option key={t} value={t}>
                {AREA_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <div className="stat-row">
          <span>面積</span>
          <strong>{Math.round(polygonArea(element.polygon)).toLocaleString()} ㎡</strong>
        </div>
        <label className="field">
          <span>備註</span>
          <textarea value={element.note ?? ''} onChange={(e) => setNote(e.target.value)} rows={2} />
        </label>
        <small>拖曳可整塊移動;拖曳頂點修改形狀;右鍵頂點刪除。</small>
        <button className="danger-btn" onClick={remove}>
          刪除區塊
        </button>
      </div>
    );
  }

  if (element.kind === 'building') {
    const model = buildingModelById.get(element.modelId);
    const facing = facingLabel(element.rotationDeg);
    const winterNoon = solarPosition(23.5, dayOfYearForMonth(12), 12);
    const goodOrientation = facing === '南' || facing === '東南' || facing === '西南';
    return (
      <div className="panel properties">
        <h3>{model?.label ?? '建物'}</h3>
        <label className="field">
          <span>房型</span>
          <select
            value={element.modelId}
            onChange={(e) => {
              const m = buildingModelById.get(e.target.value);
              if (!m) return;
              commit((p) => ({
                ...p,
                elements: p.elements.map((el) =>
                  el.id === element.id && el.kind === 'building'
                    ? { ...el, modelId: m.id, width: m.width, depth: m.depth, height: m.height }
                    : el
                ),
              }));
            }}
          >
            {BUILDING_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}({m.width}×{m.depth}m)
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>朝向:{element.rotationDeg}°(正面朝{facing})</span>
          <input
            type="range"
            min={0}
            max={359}
            value={element.rotationDeg}
            onChange={(e) =>
              commit((p) => ({
                ...p,
                elements: p.elements.map((el) =>
                  el.id === element.id && el.kind === 'building'
                    ? { ...el, rotationDeg: Number(e.target.value) }
                    : el
                ),
              }))
            }
          />
        </label>
        <div className="species-detail">
          {goodOrientation
            ? `✓ 正面朝${facing} — 冬季日照佳(冬至正午太陽仰角約 ${winterNoon.elevationDeg.toFixed(0)}°,自南方照入)`
            : `⚠ 正面朝${facing} — 台灣主要日照來自南方,建議主要開窗面朝南/東南,冬暖夏涼`}
          <div>提示:西曬面建議種落葉樹遮蔭;開啟「環境分析 → 樹冠陰影」檢查建物與樹的相互遮蔽</div>
        </div>
        <label className="field">
          <span>屋頂光電板面積(㎡,0 = 無;M12)</span>
          <input
            type="number"
            min={0}
            max={Math.round(element.width * element.depth)}
            value={element.solarRoofM2 ?? 0}
            onChange={(e) =>
              commit((p) => ({
                ...p,
                elements: p.elements.map((el) =>
                  el.id === element.id && el.kind === 'building'
                    ? { ...el, solarRoofM2: Math.max(Number(e.target.value) || 0, 0) }
                    : el
                ),
              }))
            }
          />
        </label>
        <SolarEstimate building={element} />
        <label className="field">
          <span>備註</span>
          <textarea value={element.note ?? ''} onChange={(e) => setNote(e.target.value)} rows={2} />
        </label>
        <button className="danger-btn" onClick={remove}>
          刪除建物
        </button>
      </div>
    );
  }

  // 池塘
  return (
    <div className="panel properties">
      <h3>池塘</h3>
      <div className="stat-row">
        <span>水面面積</span>
        <strong>{Math.round(polygonArea(element.polygon)).toLocaleString()} ㎡</strong>
      </div>
      <label className="field">
        <span>備註</span>
        <textarea value={element.note ?? ''} onChange={(e) => setNote(e.target.value)} rows={2} />
      </label>
      <small>拖曳可整塊移動;拖曳頂點修改形狀;右鍵頂點刪除。</small>
      <button className="danger-btn" onClick={remove}>
        刪除池塘
      </button>
    </div>
  );
}
