// M7 環境分析圖層(渲染於 CanvasView 的世界座標 <g> 內)
import { useMemo } from 'react';
import { speciesById } from '../data/plants';
import { flowArrows } from '../engine/hydrology';
import { dayOfYearForMonth, insolationGrid, shadowShapes, solarPosition } from '../engine/sun';
import { shelterZones } from '../engine/wind';
import type { HomesteadProject } from '../types';

const LATITUDE = 23.5; // 台灣預設緯度

export function AnalysisLayers({
  project,
  viewYear,
}: {
  project: HomesteadProject;
  viewYear: number;
}) {
  const s = project.settings;

  const sun = useMemo(
    () => solarPosition(LATITUDE, dayOfYearForMonth(s.sunMonth), s.sunHour),
    [s.sunMonth, s.sunHour]
  );

  const shadows = useMemo(() => {
    if (!s.showShadows) return [];
    return shadowShapes(project, speciesById, viewYear, sun);
  }, [s.showShadows, project, viewYear, sun]);

  const insolation = useMemo(() => {
    if (!s.showInsolation) return null;
    return insolationGrid(project, speciesById, viewYear, LATITUDE, 4);
  }, [s.showInsolation, project, viewYear]);

  const arrows = useMemo(() => {
    if (!s.showFlow || !project.terrain) return [];
    return flowArrows(project.terrain, 4);
  }, [s.showFlow, project.terrain]);

  const shelters = useMemo(() => {
    if (!s.showWind) return [];
    return shelterZones(project, speciesById, viewYear, s.windDir);
  }, [s.showWind, project, viewYear, s.windDir]);

  return (
    <>
      {/* 日照累積熱圖:陰影多的區域覆上暗色 */}
      {insolation && (
        <g pointerEvents="none">
          {insolation.values.map((row, r) =>
            row.map((v, c) => {
              if (v < 0 || v > 0.85) return null; // 全日照不覆蓋
              return (
                <rect
                  key={`${r}-${c}`}
                  x={insolation.origin.x + c * insolation.step}
                  y={insolation.origin.y + r * insolation.step}
                  width={insolation.step}
                  height={insolation.step}
                  fill="#1a237e"
                  opacity={(0.85 - v) * 0.55}
                />
              );
            })
          )}
        </g>
      )}

      {/* 指定時刻的樹冠陰影 */}
      {shadows.length > 0 && (
        <g pointerEvents="none">
          {shadows.map((sh, i) => (
            <g key={i}>
              <line
                x1={sh.anchor.x}
                y1={sh.anchor.y}
                x2={sh.center.x}
                y2={sh.center.y}
                stroke="rgba(60,60,80,0.25)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={sh.center.x} cy={sh.center.y} r={sh.radius} fill="rgba(50,50,70,0.3)" />
            </g>
          ))}
        </g>
      )}

      {/* 水流方向與匯流(藍色箭頭,粗細依匯流量) */}
      {arrows.length > 0 && (
        <g pointerEvents="none">
          {arrows.map((a, i) => (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={a.x + a.dx}
              y2={a.y + a.dy}
              stroke="#1976d2"
              strokeWidth={1 + a.strength * 3}
              opacity={0.35 + a.strength * 0.6}
              vectorEffect="non-scaling-stroke"
              markerEnd="url(#flowhead)"
            />
          ))}
          <defs>
            <marker id="flowhead" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 z" fill="#1976d2" />
            </marker>
          </defs>
        </g>
      )}

      {/* 防風減風區(綠色橢圓,背風側) */}
      {shelters.length > 0 && (
        <g pointerEvents="none">
          {shelters.map((z, i) => (
            <ellipse
              key={i}
              cx={0}
              cy={0}
              rx={z.halfLength}
              ry={z.halfWidth}
              transform={`translate(${z.center.x},${z.center.y}) rotate(${z.angleDeg})`}
              fill="rgba(46,125,50,0.13)"
              stroke="rgba(46,125,50,0.45)"
              strokeWidth={1}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      )}
    </>
  );
}
