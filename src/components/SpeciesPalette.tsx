import { useMemo, useState } from 'react';
import { CATEGORY_LABELS, PLANT_SPECIES, TAG_LABELS } from '../data/plants';
import { matureCanopyRadius } from '../engine/growth';
import { useProjectStore } from '../store/useProjectStore';
import type { PlantCategory } from '../types';

const CATEGORY_ORDER: PlantCategory[] = ['tree_fruit', 'tree_forest', 'shrub', 'bamboo'];

export function SpeciesPalette() {
  const selectedSpeciesId = useProjectStore((s) => s.selectedSpeciesId);
  const setSelectedSpecies = useProjectStore((s) => s.setSelectedSpecies);
  const [filter, setFilter] = useState('');

  const grouped = useMemo(() => {
    const q = filter.trim();
    const list = q
      ? PLANT_SPECIES.filter(
          (s) => s.nameZh.includes(q) || s.nameSci.toLowerCase().includes(q.toLowerCase())
        )
      : PLANT_SPECIES;
    return CATEGORY_ORDER.map((cat) => ({
      cat,
      species: list.filter((s) => s.category === cat),
    })).filter((g) => g.species.length > 0);
  }, [filter]);

  return (
    <div className="panel species-palette">
      <h3>植物資料庫({PLANT_SPECIES.length} 種)</h3>
      <input
        className="species-filter"
        placeholder="搜尋物種…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {grouped.map((g) => (
        <div key={g.cat} className="species-group">
          <h4>{CATEGORY_LABELS[g.cat]}</h4>
          {g.species.map((s) => {
            const height =
              s.growth.heightCurve[s.growth.heightCurve.length - 1]?.value ?? 0;
            return (
              <button
                key={s.id}
                className={`species-item ${s.id === selectedSpeciesId ? 'active' : ''}`}
                onClick={() => setSelectedSpecies(s.id)}
                title={s.nameSci}
              >
                <span className="species-name">
                  {s.nameZh}
                  {s.isNative && <em className="native-badge">原生</em>}
                </span>
                <span className="species-meta">
                  高 {height}m・冠幅 ⌀{matureCanopyRadius(s.growth.canopyCurve) * 2}m
                  {s.tags.length > 0 && (
                    <> ・{s.tags.map((t) => TAG_LABELS[t] ?? t).join('/')}</>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      ))}
      <small className="species-note">成長與產量為初版估算值,僅供規劃參考</small>
    </div>
  );
}
