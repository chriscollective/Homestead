import { useEffect, useRef } from 'react';
import { CanvasView } from './components/CanvasView';
import { Dashboard } from './components/Dashboard';
import { PropertiesPanel } from './components/PropertiesPanel';
import { SpeciesPalette } from './components/SpeciesPalette';
import { Toolbar } from './components/Toolbar';
import {
  parseProjectFile,
  persistProject,
  serializeProject,
  useProjectStore,
} from './store/useProjectStore';
import { downloadText, exportSvgAsPng } from './utils/download';

export default function App() {
  const project = useProjectStore((s) => s.project);
  const tool = useProjectStore((s) => s.tool);
  const selectedId = useProjectStore((s) => s.selectedId);
  const setProjectName = useProjectStore((s) => s.setProjectName);
  const loadProject = useProjectStore((s) => s.loadProject);
  const resetProject = useProjectStore((s) => s.resetProject);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);

  const svgRef = useRef<SVGSVGElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 自動儲存至 localStorage(debounce 500ms)
  useEffect(() => {
    const t = setTimeout(() => persistProject(project), 500);
    return () => clearTimeout(t);
  }, [project]);

  // undo/redo 快捷鍵
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const onExportJson = () => {
    downloadText(serializeProject(project), `${project.name || 'homestead'}.json`);
  };

  const onExportPng = () => {
    if (svgRef.current) {
      void exportSvgAsPng(svgRef.current, `${project.name || 'homestead'}.png`);
    }
  };

  const onImportFile = async (file: File) => {
    try {
      const text = await file.text();
      loadProject(parseProjectFile(text));
    } catch (err) {
      alert(`匯入失敗:${err instanceof Error ? err.message : '未知錯誤'}`);
    }
  };

  const onNewProject = () => {
    if (confirm('確定要開新專案嗎?目前設計已自動儲存並可先匯出 JSON 備份。')) {
      resetProject();
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">🌱</span>
          <div>
            <h1>祖傳家園規劃</h1>
            <small>Homestead Planner・Phase 1 平面規劃</small>
          </div>
        </div>
        <input
          className="project-name"
          value={project.name}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="專案名稱"
        />
        <div className="topbar-actions">
          <span className="autosave-hint">已自動儲存於瀏覽器</span>
          <button onClick={onExportPng}>匯出 PNG</button>
          <button onClick={onExportJson}>匯出 JSON</button>
          <button onClick={() => fileInputRef.current?.click()}>匯入 JSON</button>
          <button onClick={onNewProject}>新專案</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <div className="workspace">
        <Toolbar />
        <CanvasView svgRef={svgRef} />
        <aside className="sidebar">
          <Dashboard />
          {selectedId ? <PropertiesPanel /> : tool === 'plant' ? <SpeciesPalette /> : null}
          {!selectedId && tool !== 'plant' && (
            <div className="panel tips">
              <h3>操作提示</h3>
              <ul>
                <li>⬠ 地界:逐點點擊繪製,雙擊或點起點閉合</li>
                <li>🌳 植栽:先選物種再點擊放置,圈圈為成熟冠幅</li>
                <li>▦ 區塊:林地計入森林比例;菜園規劃輪作</li>
                <li>↖ 選取:拖曳元素移動;拖曳頂點改形狀</li>
                <li>滾輪縮放、空白處拖曳平移;Ctrl+Z 復原</li>
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
