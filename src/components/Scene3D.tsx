// M6 3D 檢視 — 與 2D 共用同一份 HomesteadProject 資料模型(單一資料源原則)
import { Line, OrbitControls, Sky } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { speciesById } from '../data/plants';
import { boundingBox } from '../engine/geometry';
import { canopyRadiusAtAge, interpolateCurve, isPlantAlive } from '../engine/growth';
import { generateHedgePlants } from '../engine/hedge';
import { applyBrush, createTerrain, sampleHeight } from '../engine/terrain';
import { useProjectStore } from '../store/useProjectStore';
import type { HomesteadProject, Point, Terrain } from '../types';

// 平面座標 (x, y) → 3D (x, 高程, y)
function elevation(terrain: Terrain | null, p: Point): number {
  return terrain ? sampleHeight(terrain, p) : 0;
}

/** 地形網格(heightmap → 起伏面);塑形模式下可直接以筆刷拖曳雕塑 */
function TerrainMesh({
  project,
  sculptMode,
  controlsRef,
}: {
  project: HomesteadProject;
  sculptMode: boolean;
  controlsRef: React.MutableRefObject<{ enabled: boolean } | null>;
}) {
  const brush = useProjectStore((s) => s.brush);
  const beginDrag = useProjectStore((s) => s.beginDrag);
  const transient = useProjectStore((s) => s.transient);
  const endDrag = useProjectStore((s) => s.endDrag);
  const [hover, setHover] = useState<Point | null>(null);
  const paintingRef = useRef(false);

  const applyAt = (worldX: number, worldZ: number) => {
    const pt = { x: worldX, y: worldZ };
    transient((proj) => {
      const t = proj.terrain ?? createTerrain(proj.boundary);
      return {
        ...proj,
        terrain: { ...t, grid: applyBrush(t, pt, brush.radius, brush.mode, brush.strength) },
      };
    });
  };

  // 拖出網格外仍要結束筆畫
  useEffect(() => {
    const up = () => {
      if (paintingRef.current) {
        paintingRef.current = false;
        endDrag();
        if (controlsRef.current) controlsRef.current.enabled = true;
      }
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [endDrag, controlsRef]);

  const inner = <TerrainMeshGeometry project={project} />;

  if (!sculptMode) return inner;

  return (
    <>
      <group
        onPointerDown={(e) => {
          e.stopPropagation();
          if (controlsRef.current) controlsRef.current.enabled = false; // 同步鎖住環繞,避免邊刷邊轉
          paintingRef.current = true;
          beginDrag();
          applyAt(e.point.x, e.point.z);
        }}
        onPointerMove={(e) => {
          setHover({ x: e.point.x, y: e.point.z });
          if (paintingRef.current) applyAt(e.point.x, e.point.z);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {inner}
      </group>
      {/* 筆刷圈指示 */}
      {hover && (
        <mesh
          position={[hover.x, elevation(project.terrain, hover) + 0.3, hover.y]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[Math.max(brush.radius - 0.4, 0.1), brush.radius, 40]} />
          <meshBasicMaterial
            color={brush.mode === 'lower' ? '#b3541e' : '#f2e394'}
            transparent
            opacity={0.85}
            depthTest={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </>
  );
}

function TerrainMeshGeometry({ project }: { project: HomesteadProject }) {
  const geometry = useMemo(() => {
    const terrain = project.terrain;
    if (terrain) {
      const { cols, rows, resolution, origin, grid } = terrain;
      const geo = new THREE.PlaneGeometry(
        (cols - 1) * resolution,
        (rows - 1) * resolution,
        cols - 1,
        rows - 1
      );
      // 直接以世界座標覆寫頂點:平面 (x, y) → 3D (x, 高程, y)
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        // PlaneGeometry 頂點依列排列:每列 cols 個
        const r = Math.floor(i / cols);
        const c = i % cols;
        pos.setXYZ(i, origin.x + c * resolution, grid[r][c], origin.y + r * resolution);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      return geo;
    }
    // 無地形:以地界外接框建立平地
    const box = boundingBox(project.boundary.length >= 3 ? project.boundary : [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ]);
    const w = box.maxX - box.minX + 40;
    const h = box.maxY - box.minY + 40;
    const geo = new THREE.PlaneGeometry(w, h, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate((box.minX + box.maxX) / 2, 0, (box.minY + box.maxY) / 2);
    return geo;
  }, [project.terrain, project.boundary]);

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial color="#9dbb7e" side={THREE.DoubleSide} flatShading />
    </mesh>
  );
}

/** 平面多邊形 → 貼地(近似)薄面 */
function FlatPolygon({
  polygon,
  terrain,
  color,
  opacity,
  yOffset,
}: {
  polygon: Point[];
  terrain: Terrain | null;
  color: string;
  opacity: number;
  yOffset: number;
}) {
  const { geometry, y } = useMemo(() => {
    const shape = new THREE.Shape(polygon.map((p) => new THREE.Vector2(p.x, p.y)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2); // (x, y) → (x, 0, y)
    const centroid = {
      x: polygon.reduce((s, p) => s + p.x, 0) / polygon.length,
      y: polygon.reduce((s, p) => s + p.y, 0) / polygon.length,
    };
    return { geometry: geo, y: elevation(terrain, centroid) + yOffset };
  }, [polygon, terrain, yOffset]);

  return (
    <mesh geometry={geometry} position={[0, y, 0]}>
      <meshStandardMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} />
    </mesh>
  );
}

const FOLIAGE_COLORS: Record<string, string> = {
  tree_fruit: '#4f9e6b',
  tree_forest: '#2d6a4f',
  shrub: '#79b791',
  bamboo: '#84a85c',
};

/** 低模樹:樹幹圓柱 + 樹冠(針葉錐/闊葉球/竹柱) */
function Tree({
  position,
  categoryKey,
  height,
  canopyRadius,
  terrain,
}: {
  position: Point;
  categoryKey: string;
  height: number;
  canopyRadius: number;
  terrain: Terrain | null;
}) {
  const groundY = elevation(terrain, position);
  const trunkH = Math.max(height * 0.3, 0.2);
  const crownH = Math.max(height - trunkH, 0.3);
  const r = Math.max(canopyRadius, 0.25);
  const color = FOLIAGE_COLORS[categoryKey] ?? FOLIAGE_COLORS.tree_fruit;

  return (
    <group position={[position.x, groundY, position.y]}>
      <mesh position={[0, trunkH / 2, 0]} castShadow>
        <cylinderGeometry args={[Math.max(r * 0.08, 0.05), Math.max(r * 0.12, 0.07), trunkH, 6]} />
        <meshStandardMaterial color="#7a5a3a" flatShading />
      </mesh>
      {categoryKey === 'tree_forest' ? (
        <mesh position={[0, trunkH + crownH / 2, 0]} castShadow>
          <coneGeometry args={[r, crownH, 8]} />
          <meshStandardMaterial color={color} flatShading />
        </mesh>
      ) : categoryKey === 'bamboo' ? (
        <mesh position={[0, trunkH + crownH / 2, 0]} castShadow>
          <cylinderGeometry args={[r * 0.55, r * 0.8, crownH, 7]} />
          <meshStandardMaterial color={color} flatShading />
        </mesh>
      ) : (
        <mesh position={[0, trunkH + crownH / 2, 0]} scale={[1, crownH / (r * 2) || 1, 1]} castShadow>
          <sphereGeometry args={[r, 8, 6]} />
          <meshStandardMaterial color={color} flatShading />
        </mesh>
      )}
    </group>
  );
}

/** 住家(簡易小屋) */
function HomeMarker({ position, terrain }: { position: Point; terrain: Terrain | null }) {
  const y = elevation(terrain, position);
  return (
    <group position={[position.x, y, position.y]}>
      <mesh position={[0, 1.5, 0]} castShadow>
        <boxGeometry args={[6, 3, 5]} />
        <meshStandardMaterial color="#d8c3a5" flatShading />
      </mesh>
      <mesh position={[0, 3.9, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[4.6, 1.8, 4]} />
        <meshStandardMaterial color="#8d5b4c" flatShading />
      </mesh>
    </group>
  );
}

/** 1.7m 人形比例參照:讓使用者直觀感受真實尺度 */
function HumanFigure({ position, terrain }: { position: Point; terrain: Terrain | null }) {
  const y = elevation(terrain, position);
  return (
    <group position={[position.x, y, position.y]}>
      <mesh position={[0, 0.7, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.2, 1.4, 8]} />
        <meshStandardMaterial color="#5b7db1" flatShading />
      </mesh>
      <mesh position={[0, 1.55, 0]} castShadow>
        <sphereGeometry args={[0.15, 8, 6]} />
        <meshStandardMaterial color="#d9b38c" flatShading />
      </mesh>
    </group>
  );
}

/** 依觸發重置相機至全覽視角(距離依地界大小自動計算) */
function ResetCamera({
  trigger,
  center,
  extent,
}: {
  trigger: number;
  center: Point;
  extent: number;
}) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(center.x, extent * 0.6, center.y + extent * 0.9);
    camera.lookAt(center.x, 0, center.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  return null;
}

/**
 * 第三人稱漫遊:鍵盤操作人偶在地形上行走,相機跟隨其視角。
 * 滑鼠「拖曳」環視(不用 Pointer Lock,內嵌網頁也能用)。
 * ↑↓/W/S 前進後退、←→/A/D 轉向。
 */
function ThirdPersonWalk({ terrain, start }: { terrain: Terrain | null; start: Point }) {
  const { camera, gl } = useThree();
  const pos = useRef<Point>({ x: start.x, y: start.y + 8 }); // 從住家南側 8m 出發,面向住家
  const yaw = useRef(Math.PI); // 初始面向北(-z)
  const pitch = useRef(0.35); // 視角俯仰(0.05 貼地平視 ~ 1.1 俯瞰)
  const keys = useRef<Record<string, boolean>>({});
  const avatar = useRef<THREE.Group>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      keys.current[e.code] = true;
      if (e.code.startsWith('Arrow')) e.preventDefault(); // 避免頁面捲動
    };
    const up = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // 滑鼠拖曳環視
  useEffect(() => {
    const el = gl.domElement;
    let last: { x: number; y: number } | null = null;
    const downH = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
    };
    const moveH = (e: PointerEvent) => {
      if (!last || e.buttons === 0) {
        last = null;
        return;
      }
      yaw.current -= (e.clientX - last.x) * 0.005;
      pitch.current = Math.min(
        Math.max(pitch.current + (e.clientY - last.y) * 0.004, 0.05),
        1.1
      );
      last = { x: e.clientX, y: e.clientY };
    };
    const upH = () => {
      last = null;
    };
    el.addEventListener('pointerdown', downH);
    window.addEventListener('pointermove', moveH);
    window.addEventListener('pointerup', upH);
    return () => {
      el.removeEventListener('pointerdown', downH);
      window.removeEventListener('pointermove', moveH);
      window.removeEventListener('pointerup', upH);
    };
  }, [gl]);

  useFrame((_, delta) => {
    const k = keys.current;
    const turn = 2.2; // rad/s
    if (k.KeyA || k.ArrowLeft) yaw.current += turn * delta;
    if (k.KeyD || k.ArrowRight) yaw.current -= turn * delta;
    const fwd = { x: Math.sin(yaw.current), y: Math.cos(yaw.current) };
    let move = 0;
    if (k.KeyW || k.ArrowUp) move += 1;
    if (k.KeyS || k.ArrowDown) move -= 1;
    const speed = 6; // m/s(步行略快)
    pos.current = {
      x: pos.current.x + fwd.x * move * speed * delta,
      y: pos.current.y + fwd.y * move * speed * delta,
    };
    const groundY = elevation(terrain, pos.current);
    if (avatar.current) {
      avatar.current.position.set(pos.current.x, groundY, pos.current.y);
      avatar.current.rotation.y = yaw.current;
    }
    // 相機跟在人偶後上方,順著人偶的朝向看
    const dist = 7 + pitch.current * 8;
    const target = new THREE.Vector3(
      pos.current.x - fwd.x * dist,
      groundY + 1.2 + pitch.current * 11,
      pos.current.y - fwd.y * dist
    );
    camera.position.lerp(target, 0.28);
    camera.lookAt(pos.current.x, groundY + 1.6, pos.current.y);
  });

  return (
    <group ref={avatar}>
      <mesh position={[0, 0.7, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.2, 1.4, 8]} />
        <meshStandardMaterial color="#2d6a4f" flatShading />
      </mesh>
      <mesh position={[0, 1.55, 0]} castShadow>
        <sphereGeometry args={[0.15, 8, 6]} />
        <meshStandardMaterial color="#d9b38c" flatShading />
      </mesh>
    </group>
  );
}

export default function Scene3D() {
  const project = useProjectStore((s) => s.project);
  const viewYear = useProjectStore((s) => s.viewYear);
  const [walkMode, setWalkMode] = useState(false);
  const [sculptMode, setSculptMode] = useState(false);
  const controlsRef = useRef<{ enabled: boolean } | null>(null);
  const brush = useProjectStore((s) => s.brush);
  const setBrush = useProjectStore((s) => s.setBrush);

  const { center, extent } = useMemo(() => {
    if (project.boundary.length < 3) return { center: { x: 50, y: 50 }, extent: 120 };
    const box = boundingBox(project.boundary);
    return {
      center: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
      // 取景距離依地界實際大小:1 公頃(~120m 對角)會拉遠到能全覽
      extent: Math.max(box.maxX - box.minX, box.maxY - box.minY, 40),
    };
  }, [project.boundary]);
  const [resetKey, setResetKey] = useState(0);

  const boundaryLine = useMemo(() => {
    if (project.boundary.length < 3) return null;
    const pts = [...project.boundary, project.boundary[0]].map(
      (p) =>
        [p.x, elevation(project.terrain, p) + 0.15, p.y] as [number, number, number]
    );
    return pts;
  }, [project.boundary, project.terrain]);

  return (
    <div className="scene3d-container">
      <Canvas
        shadows
        gl={{ preserveDrawingBuffer: true }}
        camera={{
          position: [center.x, extent * 0.6, center.y + extent * 0.9],
          fov: 50,
          near: 0.3,
          far: extent * 20,
        }}
      >
        <Sky sunPosition={[100, 80, 20]} />
        {/* 遠景霧氣:距離感/尺度感提示 */}
        <fog attach="fog" args={['#dfe6dc', extent * 2, extent * 8]} />
        {!walkMode && <ResetCamera trigger={resetKey} center={center} extent={extent} />}
        <ambientLight intensity={0.55} />
        <directionalLight
          position={[120, 150, 60]}
          intensity={1.1}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-120}
          shadow-camera-right={120}
          shadow-camera-top={120}
          shadow-camera-bottom={-120}
        />

        <TerrainMesh
          project={project}
          sculptMode={sculptMode && !walkMode}
          controlsRef={controlsRef}
        />
        {boundaryLine && <Line points={boundaryLine} color="#6b4f2a" lineWidth={2} />}

        {project.elements.map((el) => {
          if (el.kind === 'area') {
            const colors: Record<string, string> = {
              forest: '#2d6a4f',
              garden: '#c9a24a',
              meadow: '#a3b56b',
            };
            return (
              <FlatPolygon
                key={el.id}
                polygon={el.polygon}
                terrain={project.terrain}
                color={colors[el.areaType]}
                opacity={0.45}
                yOffset={0.08}
              />
            );
          }
          if (el.kind === 'water') {
            return (
              <FlatPolygon
                key={el.id}
                polygon={el.polygon}
                terrain={project.terrain}
                color="#4a90b8"
                opacity={0.85}
                yOffset={0.05}
              />
            );
          }
          if (el.kind === 'stream' || el.kind === 'swale') {
            const pts = el.line.map(
              (p) =>
                [p.x, elevation(project.terrain, p) + 0.15, p.y] as [number, number, number]
            );
            if (pts.length < 2) return null;
            return (
              <Line
                key={el.id}
                points={pts}
                color={el.kind === 'stream' ? '#2b6c96' : '#0e7490'}
                lineWidth={el.kind === 'stream' ? 4 : 2.5}
                dashed={el.kind === 'swale'}
                dashSize={2}
                gapSize={1.2}
              />
            );
          }
          if (el.kind === 'building') {
            const y = elevation(project.terrain, el.position);
            return (
              <group
                key={el.id}
                position={[el.position.x, y, el.position.y]}
                rotation={[0, (-el.rotationDeg * Math.PI) / 180, 0]}
              >
                <mesh position={[0, el.height / 2, 0]} castShadow>
                  <boxGeometry args={[el.width, el.height, el.depth]} />
                  <meshStandardMaterial color="#d8c3a5" flatShading />
                </mesh>
                <mesh position={[0, el.height + Math.min(el.width, el.depth) * 0.18, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
                  <coneGeometry
                    args={[Math.hypot(el.width, el.depth) / 2, Math.min(el.width, el.depth) * 0.4, 4]}
                  />
                  <meshStandardMaterial color="#8d5b4c" flatShading />
                </mesh>
              </group>
            );
          }
          if (el.kind !== 'plant') return null;
          const species = speciesById.get(el.speciesId);
          if (!species || !isPlantAlive(el.plantedYear, el.removedYear, viewYear)) return null;
          const age = viewYear - el.plantedYear;
          return (
            <Tree
              key={el.id}
              position={el.position}
              categoryKey={species.category}
              height={interpolateCurve(species.growth.heightCurve, age)}
              canopyRadius={canopyRadiusAtAge(species.growth.canopyCurve, age)}
              terrain={project.terrain}
            />
          );
        })}

        {project.settings.homePosition && (
          <HomeMarker position={project.settings.homePosition} terrain={project.terrain} />
        )}

        {/* 邊界綠籬(灌木用單一球體省繪製呼叫;間植喬木用完整樹模) */}
        {project.hedge &&
          viewYear >= project.hedge.plantedYear &&
          generateHedgePlants(project.boundary, project.hedge).map((hp, i) => {
            const species = speciesById.get(hp.speciesId);
            if (!species) return null;
            const age = viewYear - project.hedge!.plantedYear;
            const h = interpolateCurve(species.growth.heightCurve, age);
            const r = Math.max(canopyRadiusAtAge(species.growth.canopyCurve, age), 0.2);
            if (hp.isTree) {
              return (
                <Tree
                  key={`hg${i}`}
                  position={hp.position}
                  categoryKey={species.category}
                  height={h}
                  canopyRadius={r}
                  terrain={project.terrain}
                />
              );
            }
            const y = elevation(project.terrain, hp.position);
            return (
              <mesh
                key={`hg${i}`}
                position={[hp.position.x, y + Math.max(h, 0.3) / 2, hp.position.y]}
                scale={[1, Math.max(h, 0.3) / (r * 2) || 1, 1]}
              >
                <sphereGeometry args={[r, 6, 5]} />
                <meshStandardMaterial color="#79b791" flatShading />
              </mesh>
            );
          })}

        {/* 比例參照:住家旁的 1.7m 人形 */}
        <HumanFigure
          position={
            project.settings.homePosition
              ? { x: project.settings.homePosition.x + 5, y: project.settings.homePosition.y + 4 }
              : { x: center.x + 5, y: center.y }
          }
          terrain={project.terrain}
        />

        {walkMode ? (
          <ThirdPersonWalk
            terrain={project.terrain}
            start={project.settings.homePosition ?? center}
          />
        ) : (
          <OrbitControls
            ref={controlsRef as never}
            key={resetKey}
            target={[center.x, 0, center.y]}
            maxPolarAngle={Math.PI / 2 - 0.02}
            minDistance={3}
            maxDistance={extent * 5}
          />
        )}
      </Canvas>

      <div className="scene3d-controls">
        <button
          className={walkMode ? '' : 'active'}
          onClick={() => setWalkMode(false)}
        >
          🛰 環繞
        </button>
        <button className={walkMode ? 'active' : ''} onClick={() => setWalkMode(true)}>
          🚶 漫遊
        </button>
        {!walkMode && (
          <button onClick={() => setResetKey((k) => k + 1)} title="重置為全覽視角">
            ⌖ 全覽
          </button>
        )}
        {!walkMode && (
          <button
            className={sculptMode ? 'active' : ''}
            onClick={() => setSculptMode((v) => !v)}
            title="直接在 3D 地形上拖曳筆刷塑形"
          >
            ⛰ 塑形
          </button>
        )}
        {!walkMode && sculptMode && (
          <>
            {(['raise', 'lower', 'smooth'] as const).map((m) => (
              <button
                key={m}
                className={brush.mode === m ? 'active' : ''}
                onClick={() => setBrush({ mode: m })}
              >
                {{ raise: '⬆ 抬升', lower: '⬇ 下降', smooth: '〰 平滑' }[m]}
              </button>
            ))}
            <button
              onClick={() => {
                if (confirm('🚜 整地:將全部地形恢復平整?(可 Ctrl+Z 復原)')) {
                  useProjectStore.getState().commit((p) =>
                    p.terrain
                      ? {
                          ...p,
                          terrain: {
                            ...p.terrain,
                            grid: p.terrain.grid.map((row) => row.map(() => 0)),
                          },
                        }
                      : p
                  );
                }
              }}
              title="將全部地形恢復平整"
            >
              🚜 整地
            </button>
            <label className="scene3d-hint">
              半徑
              <input
                type="range"
                min={2}
                max={30}
                value={brush.radius}
                onChange={(e) => setBrush({ radius: Number(e.target.value) })}
                style={{ width: 70, verticalAlign: 'middle' }}
              />
              {brush.radius}m
            </label>
          </>
        )}
        <span className="scene3d-hint">
          {walkMode
            ? '↑↓(W/S)前進後退、←→(A/D)轉向;滑鼠拖曳環視'
            : sculptMode
              ? '在地面左鍵拖曳塑形(即時看到起伏);Ctrl+Z 復原'
              : '拖曳環繞、滾輪縮放、右鍵平移'}
        </span>
      </div>
    </div>
  );
}
