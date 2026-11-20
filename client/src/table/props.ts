import * as T from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { TextureBundle } from "./textures";
import { seeded } from "./textures";

/**
 * Real-world scale: 1 unit = 10 cm. The tabletop surface is y = 0 and the table is 2.0 × 0.9 m,
 * 75 cm high. Chairs, mug, plate and glass keep their real sizes so the cards read at their true scale.
 */
export const FLOOR = -7.5;
export const TOP = 0;
export const TABLE = { halfW: 10, halfD: 4.5 };

export interface SceneBuilders {
  shape<G extends T.BufferGeometry>(g: G): G;
  own<M extends T.Material>(m: M): M;
  solid(color: string, roughness?: number, metalness?: number): T.MeshStandardMaterial;
  textures: TextureBundle;
}

/** Cozy warm dining-room studio environment fed into PMREM for photorealistic reflections. */
export function buildEnvScene() {
  const env = new T.Scene();
  env.background = new T.Color("#322620");

  const panel = (color: string, intensity: number, pos: [number, number, number], size: [number, number], rot: [number, number, number]) => {
    const geo = new T.PlaneGeometry(size[0], size[1]);
    const mat = new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(intensity), side: T.DoubleSide });
    const mesh = new T.Mesh(geo, mat);
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    env.add(mesh);
  };

  // Off-axis overhead warm pendant diffuser (creates rich curved reflections without glaring flat cards overhead)
  panel("#ffe8c6", 3.6, [-2.8, 5.4, -2.4], [4.2, 3.0], [Math.PI / 2, 0, 0]);
  // Soft warm ceiling bounce
  panel("#f4ca98", 1.1, [0, 5.8, 0], [12, 12], [Math.PI / 2, 0, 0]);
  // Cool kitchen-window twilight highlight on right-front
  panel("#c6e4ff", 2.9, [6.5, 2.4, 3.5], [3.6, 4.2], [0, -Math.PI * 0.62, 0]);
  // Warm side wall bounce on left
  panel("#ebaf76", 1.5, [-6.8, 1.8, -1.5], [5.5, 3.5], [0, Math.PI / 2, 0]);
  // Subtle warm floor bounce
  panel("#6b422a", 0.85, [0, -3.5, 0], [14, 14], [-Math.PI / 2, 0, 0]);

  return env;
}

export function addContactShadow(
  parent: T.Object3D,
  planeGeo: T.BufferGeometry,
  shadowMat: T.Material,
  x: number,
  y: number,
  z: number,
  sx: number,
  sz: number,
  rotY = 0,
) {
  const m = new T.Mesh(planeGeo, shadowMat);
  m.rotation.set(-Math.PI / 2, 0, rotY);
  m.position.set(x, y, z);
  m.scale.set(sx, sz, 1);
  m.renderOrder = 1;
  parent.add(m);
  return m;
}

export function buildRoomAndTable(scene: T.Scene, b: SceneBuilders) {
  const { shape, own, textures } = b;
  const plane = shape(new T.PlaneGeometry(1, 1));
  const box = shape(new T.BoxGeometry(1, 1, 1));

  const shadowMatSoft = own(new T.MeshBasicMaterial({
    map: textures.shadowBlob, transparent: true, depthWrite: false, opacity: 0.42,
  }));
  const shadowMatTable = own(new T.MeshBasicMaterial({
    map: textures.shadowBlob, transparent: true, depthWrite: false, opacity: 0.7,
  }));

  function lathe(points: [number, number][], segments = 44) {
    return shape(new T.LatheGeometry(points.map(([r, y]) => new T.Vector2(r, y)), segments));
  }

  function mesh(parent: T.Object3D, geo: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // --- 1. Glazed terracotta kitchen floor (≈ 29 cm tiles) ---
  const floorMat = own(new T.MeshStandardMaterial({
    map: textures.tiles.map,
    color: "#a8978a",
    bumpMap: textures.tiles.bump,
    bumpScale: 0.6,
    roughnessMap: textures.tiles.rough,
    roughness: 1,
    envMapIntensity: 0.5,
  }));
  const floor = new T.Mesh(plane, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR;
  floor.scale.set(160, 160, 1);
  floor.receiveShadow = true;
  scene.add(floor);

  // --- 2. Woven kilim rug, 3.0 × 2.0 m, 1 cm thick, with braided fringe ---
  const rugMat = own(new T.MeshStandardMaterial({
    map: textures.rug.map,
    bumpMap: textures.rug.bump,
    bumpScale: 0.4,
    roughness: 0.95,
    envMapIntensity: 0.2,
  }));
  const rug = new T.Mesh(shape(new RoundedBoxGeometry(30, 0.1, 20, 2, 0.04)), rugMat);
  rug.position.set(0, FLOOR + 0.05, 0.4);
  rug.receiveShadow = true;
  scene.add(rug);

  const fringeMat = own(new T.MeshStandardMaterial({ color: "#dfd0b4", roughness: 0.96 }));
  const tasselGeo = shape(new T.CylinderGeometry(0.035, 0.025, 0.6, 5));
  const randFringe = seeded(17);
  for (const side of [-1, 1]) {
    for (let z = -9.3; z <= 10.1; z += 0.42) {
      const t = new T.Mesh(tasselGeo, fringeMat);
      t.position.set(side * 15.28, FLOOR + 0.03, z + (randFringe() - 0.5) * 0.1);
      t.rotation.set(0, (randFringe() - 0.5) * 0.2, Math.PI / 2);
      t.receiveShadow = true;
      scene.add(t);
    }
  }

  // --- 3. Varnished oak top (4 cm), painted apron and turned legs ---
  const tabletopMat = own(new T.MeshPhysicalMaterial({
    map: textures.wood.map,
    color: "#e6d3bf",
    bumpMap: textures.wood.bump,
    bumpScale: 0.3,
    roughnessMap: textures.wood.rough,
    roughness: 1,
    clearcoat: 0.3,
    clearcoatRoughness: 0.32,
    envMapIntensity: 0.8,
  }));
  const top = mesh(scene, shape(new RoundedBoxGeometry(TABLE.halfW * 2, 0.4, TABLE.halfD * 2, 4, 0.12)), tabletopMat, 0, TOP - 0.2, 0);
  top.castShadow = false;

  const mahoganyMat = own(new T.MeshPhysicalMaterial({
    map: textures.mahogany.map,
    bumpMap: textures.mahogany.bump,
    bumpScale: 0.2,
    roughness: 0.44,
    clearcoat: 0.22,
    clearcoatRoughness: 0.38,
    envMapIntensity: 0.75,
  }));
  const legPaint = own(new T.MeshPhysicalMaterial({
    color: "#2b5e5c",
    roughness: 0.42,
    clearcoat: 0.28,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.8,
  }));
  const brassMat = own(new T.MeshStandardMaterial({
    color: "#d4a64a",
    roughness: 0.24,
    metalness: 0.86,
    envMapIntensity: 1.5,
  }));
  // Apron 9 cm deep, set 6 cm in from the edge of the top
  mesh(scene, box, legPaint, 0, TOP - 0.85, 3.85, 17.4, 0.9, 0.22);
  mesh(scene, box, legPaint, 0, TOP - 0.85, -3.85, 17.4, 0.9, 0.22);
  for (const x of [-9.0, 9.0]) mesh(scene, box, legPaint, x, TOP - 0.85, 0, 0.22, 0.9, 7.5);
  mesh(scene, shape(new RoundedBoxGeometry(18.6, 0.08, 8.4, 2, 0.03)), mahoganyMat, 0, TOP - 0.44, 0);

  // 7.5 cm turned legs, 71 cm from floor to the underside of the top
  const legShape = lathe([
    [0, 0.3], [0.24, 0.3], [0.29, 0.5], [0.25, 0.8], [0.27, 1.6], [0.33, 3.6], [0.38, 4.5],
    [0.39, 4.85], [0.27, 5.15], [0.36, 5.45], [0.38, 5.6], [0, 5.6],
  ]);
  const legBlock = shape(new RoundedBoxGeometry(0.62, 1.5, 0.62, 2, 0.04));
  const ferruleShape = lathe([[0, 0], [0.23, 0], [0.25, 0.32], [0, 0.32]], 28);
  for (const x of [-8.85, 8.85]) {
    for (const z of [-3.7, 3.7]) {
      mesh(scene, legShape, legPaint, x, FLOOR, z);
      mesh(scene, legBlock, legPaint, x, TOP - 1.15, z);
      mesh(scene, ferruleShape, brassMat, x, FLOOR, z);
      addContactShadow(scene, plane, shadowMatSoft, x, FLOOR + 0.11, z, 1.4, 1.4);
    }
  }
  // Broad soft ambient occlusion under the table, on top of the rug
  addContactShadow(scene, plane, shadowMatTable, 0, FLOOR + 0.105, 0, 25, 14);

  // --- 4. Kitchen Props (All carefully positioned outside the card play zone) ---

  // 4a. Softly Draped Folded Gingham Kitchen Towel
  const towelGroup = new T.Group();
  towelGroup.position.set(-7.9, TOP, -2.3);
  towelGroup.rotation.y = 0.15;
  towelGroup.scale.setScalar(1.7);
  scene.add(towelGroup);

  const towelMat = own(new T.MeshStandardMaterial({
    map: textures.towel.map,
    bumpMap: textures.towel.bump,
    bumpScale: 0.018,
    roughness: 0.92,
    metalness: 0,
    envMapIntensity: 0.25,
  }));

  function makeFoldedCloth(w: number, d: number, h: number, seed: number) {
    const g = shape(new T.BoxGeometry(w, h, d, 18, 2, 14));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      const nx = vx / (w * 0.5), nz = vz / (d * 0.5);
      // Soft pillowed rounding on edges + natural organic linen drape wave
      const edge = Math.max(0, 1 - Math.max(Math.abs(nx), Math.abs(nz)) * 0.85);
      const wave = (Math.sin(vx * 4.2 + seed) * 0.004 + Math.cos(vz * 5.4 + seed * 1.7) * 0.003) * (vy > 0 ? 1 : 0.25);
      const tuck = vy > 0 ? -0.006 * (nx * nx + nz * nz) * 0.5 : 0;
      p.setY(i, vy + wave + tuck + (vy > 0 ? edge * 0.004 : 0));
    }
    g.computeVertexNormals();
    return g;
  }

  mesh(towelGroup, makeFoldedCloth(1.56, 1.16, 0.026, 1), towelMat, 0, 0.014, 0);
  mesh(towelGroup, makeFoldedCloth(1.5, 0.58, 0.024, 3.2), towelMat, 0.025, 0.038, -0.28);
  addContactShadow(towelGroup, plane, shadowMatSoft, 0.02, 0.002, 0.02, 1.75, 1.32);

  // 4b. Artisan Speckled Ceramic Coffee Mug with Espresso Crema
  const mug = new T.Group();
  mug.position.set(-8.05, TOP + 0.085, -2.35);
  mug.rotation.y = 0.56;
  // 9 cm wide, 9 cm tall
  mug.scale.set(1.6, 1.95, 1.6);
  scene.add(mug);

  const mugOuterMat = own(new T.MeshPhysicalMaterial({
    map: textures.ceramicBlue,
    roughness: 0.26,
    clearcoat: 0.86,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.25,
  }));
  const mugInnerMat = own(new T.MeshPhysicalMaterial({
    map: textures.ceramicCream,
    roughness: 0.24,
    clearcoat: 0.8,
    clearcoatRoughness: 0.14,
    side: T.BackSide,
  }));
  const mugLipGeo = lathe([
    [0, 0.005], [0.22, 0.005], [0.25, 0.025], [0.268, 0.12], [0.278, 0.34],
    [0.284, 0.445], [0.274, 0.468], [0.254, 0.468], [0.246, 0.44], [0.236, 0.05], [0, 0.045],
  ], 48);
  mesh(mug, mugLipGeo, mugOuterMat, 0, 0, 0);
  // Subtle warm cream glaze lining inside upper bowl
  const innerWallGeo = shape(new T.CylinderGeometry(0.247, 0.238, 0.13, 40, 1, true));
  const innerWall = new T.Mesh(innerWallGeo, mugInnerMat);
  innerWall.position.y = 0.39;
  mug.add(innerWall);

  // Smooth organic C-handle seamlessly fused to mug body
  const handleCurve = new T.CatmullRomCurve3([
    new T.Vector3(-0.24, 0.37, 0),
    new T.Vector3(-0.37, 0.38, 0),
    new T.Vector3(-0.415, 0.25, 0),
    new T.Vector3(-0.365, 0.12, 0),
    new T.Vector3(-0.235, 0.11, 0),
  ]);
  mesh(mug, shape(new T.TubeGeometry(handleCurve, 28, 0.036, 14, false)), mugOuterMat, 0, 0, 0);

  // Glossy espresso with golden crema ring
  const coffeeMat = own(new T.MeshPhysicalMaterial({
    map: textures.coffee,
    roughness: 0.1,
    clearcoat: 0.95,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.4,
  }));
  const coffeeDisc = new T.Mesh(shape(new T.CircleGeometry(0.246, 40)), coffeeMat);
  coffeeDisc.rotation.x = -Math.PI / 2;
  coffeeDisc.position.y = 0.392;
  coffeeDisc.receiveShadow = true;
  mug.add(coffeeDisc);
  addContactShadow(mug, plane, shadowMatSoft, 0.02, 0.002, 0.02, 0.72, 0.72);

  // 4c. Stoneware Plate & Sculpted Wood-Fired Pizza Slice
  const plate = new T.Group();
  plate.position.set(8.1, TOP, -2.15);
  plate.rotation.y = 0.3;
  // 22 cm dessert plate
  plate.scale.setScalar(1.75);
  scene.add(plate);

  const plateMat = own(new T.MeshPhysicalMaterial({
    map: textures.ceramicCream,
    roughness: 0.22,
    clearcoat: 0.85,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.2,
  }));
  mesh(plate, lathe([
    [0, 0.005], [0.41, 0.005], [0.46, 0.022], [0.58, 0.065], [0.64, 0.088],
    [0.648, 0.098], [0.632, 0.104], [0.56, 0.075], [0.44, 0.036], [0, 0.032],
  ], 56), plateMat, 0, 0, 0);
  // Hand-painted terracotta rim band
  const rimBand = mesh(plate, shape(new T.TorusGeometry(0.59, 0.008, 8, 64)),
    own(new T.MeshPhysicalMaterial({ color: "#c96f55", roughness: 0.28, clearcoat: 0.7 })), 0, 0.084, 0);
  rimBand.rotation.x = Math.PI / 2;
  addContactShadow(plate, plane, shadowMatSoft, 0.02, 0.003, 0.02, 1.45, 1.45);

  // Sculpted pizza slice
  const pizza = new T.Group();
  pizza.position.set(0.02, 0.038, 0.02);
  pizza.rotation.y = -0.44;
  plate.add(pizza);

  const sliceShape = new T.Shape();
  sliceShape.moveTo(-0.39, -0.25);
  sliceShape.quadraticCurveTo(-0.02, -0.45, 0.36, -0.27);
  sliceShape.lineTo(0.09, 0.45);
  sliceShape.closePath();

  const sliceGeo = shape(new T.ExtrudeGeometry(sliceShape, {
    depth: 0.03,
    bevelEnabled: true,
    bevelSize: 0.014,
    bevelThickness: 0.01,
    bevelSegments: 3,
    curveSegments: 16,
  }));
  // Normalize UVs onto [0..1] for clean blistered mozzarella texture mapping
  const sPos = sliceGeo.attributes.position, sUv = sliceGeo.attributes.uv;
  for (let i = 0; i < sUv.count; i++) {
    sUv.setXY(i, (sPos.getX(i) + 0.45) / 0.9, (sPos.getY(i) + 0.48) / 0.96);
  }
  const cheeseMat = own(new T.MeshPhysicalMaterial({
    map: textures.pizza.map,
    bumpMap: textures.pizza.bump,
    bumpScale: 0.025,
    roughness: 0.36,
    clearcoat: 0.35,
    clearcoatRoughness: 0.32,
    envMapIntensity: 0.85,
  }));
  const sliceMesh = mesh(pizza, sliceGeo, cheeseMat, 0, 0.006, 0);
  sliceMesh.rotation.x = -Math.PI / 2;

  // Curved puffy wood-fired cornicione crust along the back arc
  const crustCurve = new T.CatmullRomCurve3([
    new T.Vector3(-0.39, 0.048, 0.25),
    new T.Vector3(-0.20, 0.056, 0.34),
    new T.Vector3(-0.01, 0.058, 0.375),
    new T.Vector3(0.18, 0.055, 0.345),
    new T.Vector3(0.36, 0.048, 0.27),
  ]);
  const crustGeo = shape(new T.TubeGeometry(crustCurve, 26, 0.058, 14, false));
  const crustMat = own(new T.MeshStandardMaterial({
    map: textures.crust.map,
    bumpMap: textures.crust.bump,
    bumpScale: 0.028,
    roughness: 0.82,
  }));
  const crustMesh = mesh(pizza, crustGeo, crustMat, 0, 0, 0);
  crustMesh.scale.set(1, 0.82, 1);

  // Cupped glistening solid pepperoni slices (proper upward-facing normals!)
  const pepMat = own(new T.MeshPhysicalMaterial({
    color: "#ad2b22",
    roughness: 0.34,
    clearcoat: 0.46,
    clearcoatRoughness: 0.24,
  }));
  const pepEdgeMat = own(new T.MeshStandardMaterial({ color: "#68150f", roughness: 0.56 }));
  const pepCupGeo = lathe([
    [0, 0], [0.068, 0], [0.082, 0.011], [0.076, 0.017], [0.056, 0.009], [0, 0.008],
  ], 24);
  for (const [x, z, sc, rot] of [
    [-0.15, 0.14, 1.06, 0.3],
    [0.13, 0.11, 0.98, -0.5],
    [0.05, -0.15, 0.94, 0.8],
    [-0.03, 0.02, 1.02, -0.2],
  ] as [number, number, number, number][]) {
    const p = mesh(pizza, pepCupGeo, pepMat, x, 0.044, z, sc, 1, sc);
    p.rotation.y = rot;
    const rim = mesh(pizza, shape(new T.TorusGeometry(0.074 * sc, 0.0055, 6, 20)), pepEdgeMat, x, 0.057, z);
    rim.rotation.x = Math.PI / 2;
  }

  // Sculpted curved fresh basil leaves
  const leafShape = new T.Shape();
  leafShape.moveTo(0, -0.042);
  leafShape.quadraticCurveTo(0.035, -0.01, 0.026, 0.026);
  leafShape.quadraticCurveTo(0, 0.054, -0.026, 0.026);
  leafShape.quadraticCurveTo(-0.035, -0.01, 0, -0.042);
  const leafGeo = shape(new T.ShapeGeometry(leafShape, 8));
  const lp = leafGeo.attributes.position;
  for (let i = 0; i < lp.count; i++) {
    const x = lp.getX(i), y = lp.getY(i);
    lp.setZ(i, 0.01 * Math.cos(y * 28) - x * x * 5);
  }
  leafGeo.computeVertexNormals();
  const basilMat = own(new T.MeshPhysicalMaterial({
    color: "#2f6b29",
    roughness: 0.42,
    clearcoat: 0.25,
    side: T.DoubleSide,
  }));
  for (const [x, z, rot] of [[-0.05, 0.21, 0.7], [0.06, -0.04, -1.1], [0.16, 0.2, 2.2]] as [number, number, number][]) {
    const leaf = mesh(pizza, leafGeo, basilMat, x, 0.055, z, 1.15, 1.15, 1.15);
    leaf.rotation.set(-Math.PI / 2 + 0.14, rot, 0.08);
  }

  // 4d. Pressed Cork Coaster & Crystal-Clear Pub Glass with Amber Drink + Creamy Foam
  const drink = new T.Group();
  drink.position.set(8.75, TOP, 3.2);
  // 9 cm tumbler on a 10 cm cork coaster
  drink.scale.setScalar(1.75);
  scene.add(drink);

  const corkMat = own(new T.MeshStandardMaterial({
    map: textures.cork.map,
    bumpMap: textures.cork.bump,
    bumpScale: 0.016,
    roughness: 0.88,
  }));
  mesh(drink, shape(new T.CylinderGeometry(0.28, 0.285, 0.018, 40)), corkMat, 0, 0.009, 0);
  addContactShadow(drink, plane, shadowMatSoft, 0.015, 0.002, 0.015, 0.68, 0.68);

  // Amber liquid core (warm backlit depth)
  const amberMat = own(new T.MeshPhysicalMaterial({
    color: "#d97a16",
    emissive: "#5c2604",
    emissiveIntensity: 0.22,
    roughness: 0.14,
    clearcoat: 0.9,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.5,
  }));
  mesh(drink, lathe([[0, 0.055], [0.165, 0.055], [0.188, 0.385], [0, 0.385]], 36), amberMat, 0, 0.018, 0);

  // Sculpted creamy frothy foam crown (strictly bottom-to-top profile for outward/upward normals!)
  const foamMat = own(new T.MeshStandardMaterial({
    map: textures.foam.map,
    bumpMap: textures.foam.bump,
    bumpScale: 0.018,
    roughness: 0.82,
  }));
  mesh(drink, lathe([
    [0, 0.382], [0.189, 0.382], [0.193, 0.422], [0.175, 0.445], [0.11, 0.455], [0, 0.46],
  ], 36), foamMat, 0, 0.018, 0);

  // Thick-bottomed crystal-clear glass shell catching warm pendant & cool window reflections
  const glassMat = own(new T.MeshPhysicalMaterial({
    color: "#f2faff",
    roughness: 0.04,
    metalness: 0.02,
    reflectivity: 0.96,
    ior: 1.52,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    envMapIntensity: 2.3,
    side: T.DoubleSide,
  }));
  const shell = mesh(drink, lathe([
    [0, 0], [0.185, 0], [0.195, 0.015], [0.222, 0.515], [0.214, 0.525],
    [0.204, 0.525], [0.18, 0.052], [0, 0.052],
  ], 44), glassMat, 0, 0.018, 0);
  shell.castShadow = false;
  shell.renderOrder = 3;

  // Heavy refractive glass base disc highlight
  const glassBaseMat = own(new T.MeshPhysicalMaterial({
    color: "#ffffff",
    roughness: 0.06,
    transparent: true,
    opacity: 0.42,
    clearcoat: 1,
    envMapIntensity: 2.2,
    depthWrite: false,
  }));
  const baseDisc = mesh(drink, shape(new T.CylinderGeometry(0.182, 0.185, 0.044, 36)), glassBaseMat, 0, 0.04, 0);
  baseDisc.castShadow = false;
  baseDisc.renderOrder = 2;

  return { plane, box, mahoganyMat, brassMat, shadowMatSoft };
}

/**
 * Chairs and gavel are rebuilt whenever seats change (every round), so their geometries and
 * per-colour materials are created once per scene here and only reused afterwards.
 */
export function createSeatKit(
  b: SceneBuilders,
  mahoganyMat: T.Material,
  brassMat: T.Material,
  plane: T.BufferGeometry,
  shadowMat: T.Material,
) {
  const { shape, own, textures } = b;
  const lathe = (pts: [number, number][], seg = 36) => shape(new T.LatheGeometry(pts.map(([r, y]) => new T.Vector2(r, y)), seg));

  const legGeo = shape(new T.CylinderGeometry(0.036, 0.028, 0.85, 12));
  const stretcherGeo = shape(new T.CylinderGeometry(0.018, 0.018, 0.66, 10));
  const postGeo = shape(new T.CylinderGeometry(0.036, 0.038, 1.05, 12));
  const spindleGeo = shape(new T.CylinderGeometry(0.019, 0.022, 0.74, 10));
  const seatBaseGeo = shape(new RoundedBoxGeometry(0.88, 0.075, 0.78, 3, 0.025));
  const cushionGeo = shape(new RoundedBoxGeometry(0.78, 0.095, 0.68, 4, 0.036));
  const crestGeo = shape(new RoundedBoxGeometry(0.86, 0.21, 0.075, 4, 0.03));

  const blockGeo = lathe([
    [0, 0], [0.22, 0], [0.23, 0.018], [0.21, 0.055], [0.195, 0.072], [0.165, 0.072], [0.155, 0.065], [0, 0.065],
  ], 44);
  const inlayGeo = shape(new T.TorusGeometry(0.175, 0.007, 10, 44));
  const handleGeo = lathe([
    [0, 0], [0.032, 0], [0.042, 0.06], [0.034, 0.12], [0.028, 0.42], [0.038, 0.56], [0.044, 0.65], [0.028, 0.71], [0, 0.72],
  ], 22);
  const collarGeo = shape(new T.CylinderGeometry(0.036, 0.038, 0.04, 18));
  const headGeo = lathe([
    [0, -0.185], [0.094, -0.185], [0.106, -0.155], [0.098, -0.11], [0.104, 0],
    [0.098, 0.11], [0.106, 0.155], [0.094, 0.185], [0, 0.185],
  ], 32);
  const bandGeo = shape(new T.CylinderGeometry(0.104, 0.104, 0.038, 32));

  // Seat colours come from a small fixed palette, so this cache stays bounded.
  const paints = new Map<string, { cushion: T.Material; crest: T.Material }>();
  function paint(color: string) {
    let p = paints.get(color);
    if (!p) {
      p = {
        cushion: own(new T.MeshStandardMaterial({
          color,
          bumpMap: textures.fabricBump,
          bumpScale: 0.014,
          roughness: 0.88,
          envMapIntensity: 0.35,
        })),
        crest: own(new T.MeshPhysicalMaterial({
          color,
          roughness: 0.46,
          clearcoat: 0.25,
          clearcoatRoughness: 0.35,
        })),
      };
      paints.set(color, p);
    }
    return p;
  }

  function add(parent: T.Object3D, geo: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number) {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /** Handcrafted wooden dining chair with turned spindles, curved crest rail and woven linen cushion. */
  function chair(color: string) {
    const c = new T.Group();
    const { cushion, crest } = paint(color);

    // Tapered legs + side stretchers
    for (const x of [-0.34, 0.34]) {
      for (const z of [-0.3, 0.3]) add(c, legGeo, mahoganyMat, x, 0.425, z);
      const st = add(c, stretcherGeo, mahoganyMat, x, 0.28, 0);
      st.rotation.x = Math.PI / 2;
    }
    const cross = add(c, stretcherGeo, mahoganyMat, 0, 0.28, 0.3);
    cross.rotation.z = Math.PI / 2;

    // Seat base & upholstered woven linen cushion
    add(c, seatBaseGeo, mahoganyMat, 0, 0.86, 0);
    add(c, cushionGeo, cushion, 0, 0.935, -0.02);

    // Backrest posts, turned spindles & accent painted top crest rail
    for (const x of [-0.34, 0.34]) {
      const post = add(c, postGeo, mahoganyMat, x, 1.37, 0.34);
      post.rotation.x = 0.04;
    }
    for (const x of [-0.18, -0.06, 0.06, 0.18]) {
      const sp = add(c, spindleGeo, mahoganyMat, x, 1.32, 0.34);
      sp.rotation.x = 0.04;
    }
    const lowerRail = add(c, stretcherGeo, mahoganyMat, 0, 1.0, 0.33);
    lowerRail.rotation.z = Math.PI / 2;

    const rail = add(c, crestGeo, crest, 0, 1.80, 0.36);
    rail.rotation.x = 0.06;

    addContactShadow(c, plane, shadowMat, 0, 0.027, 0.04, 1.25, 1.18);
    // Modelled at half scale: 46 cm seat, 88 cm crest rail, 43 cm wide.
    c.scale.setScalar(4.9);
    return c;
  }

  /** Polished mahogany & brushed-brass judge's gavel and sounding block. */
  function gavel() {
    const g = new T.Group();

    // Turned mahogany sounding block with inset brass ring
    add(g, blockGeo, mahoganyMat, 0, 0, 0);
    const inlay = add(g, inlayGeo, brassMat, 0, 0.072, 0);
    inlay.rotation.x = Math.PI / 2;

    // Mallet resting proudly across the sounding block
    const mallet = new T.Group();
    mallet.position.set(0.06, 0.165, 0.02);
    mallet.rotation.z = 0.1;
    g.add(mallet);

    // Ergonomic turned handle
    const handle = add(mallet, handleGeo, mahoganyMat, 0.02, 0, 0);
    handle.rotation.z = -Math.PI / 2;

    // Brass collar where handle meets head
    const collar = add(mallet, collarGeo, brassMat, 0.04, 0, 0);
    collar.rotation.z = Math.PI / 2;
    collar.castShadow = collar.receiveShadow = false;

    // Contoured mahogany barrel head + gleaming brushed-brass bands
    const head = add(mallet, headGeo, mahoganyMat, -0.06, 0, 0);
    head.rotation.x = Math.PI / 2;

    for (const z of [-0.095, 0.095]) {
      const band = add(mallet, bandGeo, brassMat, -0.06, 0, z);
      band.rotation.x = Math.PI / 2;
      band.receiveShadow = false;
    }

    addContactShadow(g, plane, shadowMat, 0.06, 0.003, 0.02, 0.75, 0.58);
    // 22 cm mallet on a 10 cm sounding block
    g.scale.setScalar(2.3);
    return g;
  }

  return { chair, gavel };
}
