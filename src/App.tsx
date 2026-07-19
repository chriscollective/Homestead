import { lazy, Suspense, useEffect, useRef } from 'react';
import { AnalysisPanel } from './components/AnalysisPanel';
import { BuildingPalette } from './components/BuildingPalette';
import { CanvasView } from './components/CanvasView';
import { Dashboard } from './components/Dashboard';
import { LayersPanel } from './components/LayersPanel';
import { SustainPanel } from './components/SustainPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { SpeciesPalette } from './components/SpeciesPalette';
import { TerrainPanel } from './components/TerrainPanel';
import { TimelinePanel } from './components/TimelinePanel';
import { Toolbar } from './components/Toolbar';
import {
  parseProjectFile,
  persistProject,
  serializeProject,
  useProjectStore,
} from './store/useProjectStore';
import { downloadText, exportSvgAsPng } from './utils/download';

// three.js 僅在進入 3D 模式時載入(code splitting)
const Scene3D = lazy(() => import('./components/Scene3D'));

export default function App() {
  const project = useProjectStore((s) => s.project);
  const tool = useProjectStore((s) => s.tool);
  const selectedId = useProjectStore((s) => s.selectedId);
  const viewMode = useProjectStore((s) => s.viewMode);
  const setViewMode = useProjectStore((s) => s.setViewMode);
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
    if (viewMode === '3d') {
      // 3D 模式:直接輸出 WebGL 畫布(gl 已設 preserveDrawingBuffer)
      const canvas = document.querySelector<HTMLCanvasElement>('.scene3d-container canvas');
      if (canvas) {
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `${project.name || 'homestead'}-3d.png`;
        a.click();
      }
      return;
    }
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
            <small>Homestead Planner・Phase 2 時間×立體</small>
          </div>
        </div>
        <input
          className="project-name"
          value={project.name}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="專案名稱"
        />
        <div className="view-mode-toggle">
          <button className={viewMode === '2d' ? 'active' : ''} onClick={() => setViewMode('2d')}>
            2D 平面
          </button>
          <button className={viewMode === '3d' ? 'active' : ''} onClick={() => setViewMode('3d')}>
            3D 立體
          </button>
        </div>
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
        {viewMode === '2d' && <Toolbar />}
        <div className="canvas-column">
          {viewMode === '2d' ? (
            <CanvasView svgRef={svgRef} />
          ) : (
            <Suspense fallback={<div className="scene3d-loading">載入 3D 場景…</div>}>
              <Scene3D />
            </Suspense>
          )}
          <TimelinePanel />
        </div>
        <aside className="sidebar">
          <Dashboard />
          <LayersPanel />
          {viewMode === '2d' && <AnalysisPanel />}
          <SustainPanel />
          {viewMode === '2d' && tool === 'terrain' && <TerrainPanel />}
          {viewMode === '2d' &&
            (selectedId ? (
              <PropertiesPanel />
            ) : tool === 'plant' ? (
              <SpeciesPalette />
            ) : tool === 'building' ? (
              <BuildingPalette />
            ) : tool !== 'terrain' ? (
              <div className="panel tips">
                <h3>操作提示</h3>
                <ul>
                  <li>⬠ 地界:逐點點擊繪製,雙擊或點起點閉合</li>
                  <li>🌳 植栽:先選物種再點擊放置,圈圈為當年冠幅</li>
                  <li>⏳ 時間軸:拉動下方年份滑桿看家園長大</li>
                  <li>⛰ 地形:筆刷塑形;圖層開等高線/坡度</li>
                  <li>🏠 住家:放置後開分區環,檢查頻率-距離</li>
                  <li>滾輪縮放、空白處拖曳平移;Ctrl+Z 復原</li>
                </ul>
              </div>
            ) : null)}
        </aside>
      </div>
    </div>
  );
}
