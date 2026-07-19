// M6 3D 檢視 — 與 2D 共用同一份 HomesteadProject 資料模型(單一資料源原則)
import { Line, OrbitControls, PointerLockControls, Sky } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { speciesById } from '../data/plants';
import { boundingBox } from '../engine/geometry';
import { canopyRadiusAtAge, interpolateCurve, isPlantAlive } from '../engine/growth';
import { generateHedgePlants } from '../engine/hedge';
import { sampleHeight } from '../engine/terrain';
import { useProjectStore } from '../store/useProjectStore';
import type { HomesteadProject, Point, Terrain } from '../types';

// 平面座標 (x, y) → 3D (x, 高程, y)
function elevation(terrain: Terrain | null, p: Point): number {
  return terrain ? sampleHeight(terrain, p) : 0;
}

/** 地形網格(heightmap → 起伏面) */
function TerrainMesh({ project }: { project: HomesteadProject }) {
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

/** 第一人稱漫遊:WASD 移動、視線高 1.7m 貼地 */
function WalkControls({ terrain, start }: { terrain: Terrain | null; start: Point }) {
  const { camera } = useThree();
  const keys = useRef<Record<string, boolean>>({});

  // 進入漫遊時從住家/中心出發(而非環繞相機的遠處)
  useEffect(() => {
    const ground = elevation(terrain, start);
    camera.position.set(start.x, ground + 1.7, start.y + 6);
    camera.lookAt(start.x, ground + 1.6, start.y - 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => (keys.current[e.code] = true);
    const up = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useFrame((_, delta) => {
    const speed = 8; // m/s
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0;
    dir.normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
    const move = new THREE.Vector3();
    if (keys.current.KeyW) move.add(dir);
    if (keys.current.KeyS) move.sub(dir);
    if (keys.current.KeyD) move.add(right);
    if (keys.current.KeyA) move.sub(right);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * delta);
      camera.position.add(move);
    }
    const ground = elevation(terrain, { x: camera.position.x, y: camera.position.z });
    camera.position.y = ground + 1.7;
  });

  return <PointerLockControls />;
}

export default function Scene3D() {
  const project = useProjectStore((s) => s.project);
  const viewYear = useProjectStore((s) => s.viewYear);
  const [walkMode, setWalkMode] = useState(false);

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

        <TerrainMesh project={project} />
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
          <WalkControls
            terrain={project.terrain}
            start={project.settings.homePosition ?? center}
          />
        ) : (
          <OrbitControls
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
        <span className="scene3d-hint">
          {walkMode
            ? '點擊畫面鎖定視角,WASD 移動、滑鼠轉向,Esc 解鎖'
            : '拖曳環繞、滾輪縮放、右鍵平移'}
        </span>
      </div>
    </div>
  );
}
