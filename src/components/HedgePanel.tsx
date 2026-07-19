// 邊界綠籬設定面板(M2)— 沿地界自動佈植灌木、間插喬木、留出入口
// 設計參考:祖傳家園以活籬代替圍牆(喬木+灌木混植,anastasia.ru);
// 俄式單排密籬株距 0.3~0.5m(ogorod.ru)
import { useMemo } from 'react';
import { PLANT_SPECIES, speciesById } from '../data/plants';
import { polygonPerimeter } from '../engine/geometry';
import { generateHedgePlants, hedgeEnclosureRatio } from '../engine/hedge';
import { useProjectStore } from '../store/useProjectStore';

const SHRUBS = PLANT_SPECIES.filter((s) => s.category === 'shrub' || s.category === 'bamboo');
const TREES = PLANT_SPECIES.filter(
  (s) => s.category === 'tree_forest' || s.category === 'tree_fruit'
);

export function HedgePanel() {
  const project = useProjectStore((s) => s.project);
  const viewYear = useProjectStore((s) => s.viewYear);
  const commit = useProjectStore((s) => s.commit);
  const hedge = project.hedge;

  const stats = useMemo(() => {
    if (!hedge || project.boundary.length < 3) return null;
    const plants = generateHedgePlants(project.boundary, hedge);
    const trees = plants.filter((p) => p.isTree).length;
    return {
      shrubs: plants.length - trees,
      trees,
      perimeter: polygonPerimeter(project.boundary),
      enclosure: hedgeEnclosureRatio(project.boundary, hedge.gaps),
    };
  }, [hedge, project.boundary]);

  if (project.boundary.length < 3) {
    return (
      <div className="panel">
        <h3>邊界綠籬</h3>
        <small>請先用「⬠ 繪製地界」畫出地界</small>
      </div>
    );
  }

  if (!hedge) {
    return (
      <div className="panel">
        <h3>邊界綠籬</h3>
        <p className="species-meta" style={{ marginBottom: 8 }}>
          沿整圈地界自動佈滿灌木(可間插喬木、留出入口),
          不必一株一株種 — 祖傳家園以活籬代替圍牆。
        </p>
        <button
          className="primary-btn"
          onClick={() =>
            commit((p) => ({
              ...p,
              hedge: {
                shrubSpeciesId: 'orange_jasmine',
                spacing: 1,
                treeSpeciesId: 'camphor',
                treeEvery: 10,
                inset: 1,
                plantedYear: viewYear,
                gaps: [],
              },
            }))
          }
        >
          🌿 建立邊界綠籬
        </button>
      </div>
    );
  }

  const update = (patch: Partial<NonNullable<typeof hedge>>) =>
    commit((p) => ({ ...p, hedge: p.hedge ? { ...p.hedge, ...patch } : p.hedge }));

  return (
    <div className="panel">
      <h3>邊界綠籬</h3>

      <label className="field">
        <span>綠籬灌木</span>
        <select
          value={hedge.shrubSpeciesId}
          onChange={(e) => update({ shrubSpeciesId: e.target.value })}
        >
          {SHRUBS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nameZh}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>株距:{hedge.spacing.toFixed(1)} m(俄式密籬 0.3~0.5m、一般 1m)</span>
        <input
          type="range"
          min={0.3}
          max={3}
          step={0.1}
          value={hedge.spacing}
          onChange={(e) => update({ spacing: Number(e.target.value) })}
        />
      </label>

      <label className="field">
        <span>間植喬木(無 = 純灌木籬)</span>
        <select
          value={hedge.treeSpeciesId ?? ''}
          onChange={(e) => update({ treeSpeciesId: e.target.value || null })}
        >
          <option value="">無</option>
          {TREES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nameZh}
            </option>
          ))}
        </select>
      </label>

      {hedge.treeSpeciesId && (
        <label className="field">
          <span>每 {hedge.treeEvery} 株灌木插一株喬木</span>
          <input
            type="range"
            min={3}
            max={30}
            value={hedge.treeEvery}
            onChange={(e) => update({ treeEvery: Number(e.target.value) })}
          />
        </label>
      )}

      <label className="field">
        <span>自地界內縮:{hedge.inset.toFixed(1)} m</span>
        <input
          type="range"
          min={0}
          max={3}
          step={0.5}
          value={hedge.inset}
          onChange={(e) => update({ inset: Number(e.target.value) })}
        />
      </label>

      <label className="field">
        <span>種植年份(第 N 年)</span>
        <input
          type="number"
          min={0}
          max={50}
          value={hedge.plantedYear}
          onChange={(e) => update({ plantedYear: Number(e.target.value) || 0 })}
        />
      </label>

      <div className="species-detail">
        <strong>🚪 出入口({hedge.gaps.length} 處)</strong>
        <div>直接點擊畫布上的地界線即可新增;點橘色標記可刪除</div>
        {hedge.gaps.map((g, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            位置 {(g.t * 100).toFixed(0)}%・寬
            <input
              type="number"
              min={1}
              max={20}
              value={g.width}
              style={{ width: 52 }}
              onChange={(e) =>
                update({
                  gaps: hedge.gaps.map((gg, j) =>
                    j === i ? { ...gg, width: Math.max(Number(e.target.value) || 1, 1) } : gg
                  ),
                })
              }
            />
            m
            <button
              className="modal-close"
              onClick={() => update({ gaps: hedge.gaps.filter((_, j) => j !== i) })}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {stats && (
        <div className="species-detail">
          周長 {Math.round(stats.perimeter)}m → 共{' '}
          <strong>
            {stats.shrubs} 株{speciesById.get(hedge.shrubSpeciesId)?.nameZh}
          </strong>
          {stats.trees > 0 && (
            <>
              {' + '}
              <strong>
                {stats.trees} 株{speciesById.get(hedge.treeSpeciesId!)?.nameZh}
              </strong>
            </>
          )}
          <div>
            圍合度 {(stats.enclosure * 100).toFixed(0)}%(儀表板同步顯示);
            綠籬隨時間軸年份成長
          </div>
        </div>
      )}

      <button
        className="danger-btn"
        onClick={() => {
          if (confirm('移除整圈邊界綠籬?(可 Ctrl+Z 復原)')) {
            commit((p) => ({ ...p, hedge: null }));
          }
        }}
      >
        移除邊界綠籬
      </button>
    </div>
  );
}
