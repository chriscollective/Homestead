import { useMemo } from 'react';
import { BUILDING_MODELS, buildingModelById, facingLabel } from '../data/buildings';
import { CATEGORY_LABELS, PLANT_SPECIES, speciesById } from '../data/plants';
import { polygonArea, polygonPerimeter, polylineLength } from '../engine/geometry';
import {
  ALL_LAYERS,
  foodForestLayers,
  LAYER_LABELS,
  MANUAL_LAYERS,
  swaleLevelness,
} from '../engine/permaculture';
import {
  futureShadeYear,
  microHydroKwh,
  shadeFactorAt,
  solarRoofKwh,
  streamHead,
} from '../engine/energy';
import { dayOfYearForMonth, solarPosition } from '../engine/sun';
import { useProjectStore } from '../store/useProjectStore';
import type { AreaElement, AreaType, BuildingElement, ForestLayer } from '../types';

const AREA_LABELS: Record<AreaType, string> = {
  forest: '林地',
  garden: '菜園',
  meadow: '草地',
  food_forest: '食物森林',
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

/** M13 食物森林層次完整度:區塊內植物自動偵測 + 草本類手動勾選 */
function FoodForestLayers({ area }: { area: AreaElement }) {
  const project = useProjectStore((s) => s.project);
  const commit = useProjectStore((s) => s.commit);
  const report = useMemo(
    () => foodForestLayers(project, area.id, speciesById),
    [project, area.id]
  );
  if (!report) return null;
  const toggleManual = (layer: ForestLayer) => {
    commit((p) => ({
      ...p,
      elements: p.elements.map((el) => {
        if (el.id !== area.id || el.kind !== 'area') return el;
        const set = new Set(el.manualLayers ?? []);
        if (set.has(layer)) set.delete(layer);
        else set.add(layer);
        return { ...el, manualLayers: [...set] };
      }),
    }));
  };
  return (
    <div className="species-detail">
      <strong>七層結構檢查({report.present.length}/7)</strong>
      {ALL_LAYERS.map((l) => {
        const present = report.present.includes(l);
        const manual = MANUAL_LAYERS.includes(l);
        return (
          <div key={l}>
            {manual ? (
              <label style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={(area.manualLayers ?? []).includes(l)}
                  onChange={() => toggleManual(l)}
                />{' '}
                {LAYER_LABELS[l]}(草本類以配方勾選)
              </label>
            ) : (
              <span>
                {present ? '✓' : '✗'} {LAYER_LABELS[l]}
                {!present && ' — 在區塊內種植此層物種'}
              </span>
            )}
          </div>
        );
      })}
      {report.missing.includes('groundcover') && (
        <div>⚠ 缺地被層:裸露土壤易生雜草與水分流失</div>
      )}
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
        {element.areaType === 'food_forest' && <FoodForestLayers area={element} />}
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

  // swale 等高集水溝(M13)
  if (element.kind === 'swale') {
    const levelness = swaleLevelness(project, element.line);
    return (
      <div className="panel properties">
        <h3>等高集水溝(swale)</h3>
        <div className="stat-row">
          <span>長度</span>
          <strong>{Math.round(polylineLength(element.line))} m</strong>
        </div>
        {levelness !== null ? (
          levelness <= 0.3 ? (
            <div className="species-detail">✓ 線上高差 {levelness.toFixed(1)}m — 貼合等高線,能有效攔截逕流入滲</div>
          ) : (
            <div className="species-detail">
              ⚠ 線上高差 {levelness.toFixed(1)}m — swale 應沿等高線開挖(建議高差 ≤0.3m),請開啟等高線圖層對照調整頂點
            </div>
          )
        ) : (
          <div className="species-detail">尚無地形資料 — 用「⛰ 地形」塑形後可檢查是否貼合等高線</div>
        )}
        <label className="field">
          <span>備註</span>
          <textarea value={element.note ?? ''} onChange={(e) => setNote(e.target.value)} rows={2} />
        </label>
        <button className="danger-btn" onClick={remove}>
          刪除集水溝
        </button>
      </div>
    );
  }

  // 溪流(M2/M12 微水力)
  if (element.kind === 'stream') {
    const head = project.terrain ? streamHead(project.terrain, element.line) : null;
    const flow = element.flowLps ?? 0;
    const kwh = head !== null && flow > 0 ? microHydroKwh(flow, head) : null;
    return (
      <div className="panel properties">
        <h3>溪流</h3>
        <div className="stat-row">
          <span>長度</span>
          <strong>{Math.round(polylineLength(element.line))} m</strong>
        </div>
        <div className="stat-row">
          <span>落差(head)</span>
          <strong>{head !== null ? `${head.toFixed(1)} m` : '需地形資料'}</strong>
        </div>
        <label className="field">
          <span>常流量估計(L/s,0 = 不設微水力)</span>
          <input
            type="number"
            min={0}
            max={500}
            value={flow}
            onChange={(e) =>
              commit((p) => ({
                ...p,
                elements: p.elements.map((el) =>
                  el.id === element.id && el.kind === 'stream'
                    ? { ...el, flowLps: Math.max(Number(e.target.value) || 0, 0) }
                    : el
                ),
              }))
            }
          />
        </label>
        {kwh !== null && (
          <div className="species-detail">
            ⚡ 微水力估年發電約 <strong>{Math.round(kwh).toLocaleString()} 度</strong>
            (P = ρgQHη,η=0.6,含枯水期折減 0.7)
            <div>💧 頭差來自 M5 地勢沿線自動計算;繪製方向建議上游 → 下游</div>
            <div>⚠ 法規提醒:台灣引水發電須申請水權(水利法),實際設置前請洽主管機關</div>
          </div>
        )}
        {head === null && (
          <small>用「⛰ 地形」塑形後會自動計算沿線落差</small>
        )}
        <label className="field">
          <span>備註</span>
          <textarea value={element.note ?? ''} onChange={(e) => setNote(e.target.value)} rows={2} />
        </label>
        <button className="danger-btn" onClick={remove}>
          刪除溪流
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
