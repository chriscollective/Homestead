import { useProjectStore, type Tool } from '../store/useProjectStore';
import type { AreaType } from '../types';

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: 'select', icon: '↖', label: '選取/編輯' },
  { id: 'boundary', icon: '⬠', label: '繪製地界' },
  { id: 'plant', icon: '🌳', label: '放置植栽' },
  { id: 'area', icon: '▦', label: '繪製區塊' },
  { id: 'pond', icon: '💧', label: '繪製池塘' },
  { id: 'measure', icon: '📏', label: '測距' },
];

const AREA_TYPES: { id: AreaType; label: string }[] = [
  { id: 'forest', label: '林地' },
  { id: 'garden', label: '菜園' },
  { id: 'meadow', label: '草地' },
];

export function Toolbar() {
  const tool = useProjectStore((s) => s.tool);
  const setTool = useProjectStore((s) => s.setTool);
  const areaType = useProjectStore((s) => s.areaType);
  const setAreaType = useProjectStore((s) => s.setAreaType);
  const settings = useProjectStore((s) => s.project.settings);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);

  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool-btn ${tool === t.id ? 'active' : ''}`}
          onClick={() => setTool(t.id)}
          title={t.label}
        >
          <span className="tool-icon">{t.icon}</span>
          <span className="tool-label">{t.label}</span>
        </button>
      ))}

      {tool === 'area' && (
        <div className="tool-sub">
          {AREA_TYPES.map((a) => (
            <button
              key={a.id}
              className={`tool-sub-btn ${areaType === a.id ? 'active' : ''}`}
              onClick={() => setAreaType(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      <div className="toolbar-divider" />

      <button className="tool-btn" onClick={undo} disabled={!canUndo} title="復原 (Ctrl+Z)">
        <span className="tool-icon">↩</span>
        <span className="tool-label">復原</span>
      </button>
      <button className="tool-btn" onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Y)">
        <span className="tool-icon">↪</span>
        <span className="tool-label">重做</span>
      </button>

      <div className="toolbar-divider" />

      <button
        className={`tool-btn ${settings.gridVisible ? 'active' : ''}`}
        onClick={() => updateSettings({ gridVisible: !settings.gridVisible })}
        title="顯示/隱藏網格"
      >
        <span className="tool-icon">▦</span>
        <span className="tool-label">網格</span>
      </button>
      {settings.gridVisible && (
        <div className="tool-sub">
          {([1, 5, 10] as const).map((g) => (
            <button
              key={g}
              className={`tool-sub-btn ${settings.gridSize === g ? 'active' : ''}`}
              onClick={() => updateSettings({ gridSize: g })}
            >
              {g}m
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
