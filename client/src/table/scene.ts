import * as T from "three";
import type { TableModel } from "./model";
import { CARD_ASPECT, cardPrint, type PrintKind } from "./print";
import { createTextureBundle, seeded } from "./textures";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { addContactShadow, buildEnvScene, buildRoomAndTable, createSeatKit, FLOOR, TABLE, TOP } from "./props";

interface CardFinish {
  bumpScale: number; linenRoughness: boolean; roughness: number; metalness: number;
  clearcoat: number; clearcoatRoughness: number; envMapIntensity: number; emissiveIntensity: number;
}
const PAPER_FINISH = { bumpScale: 0.35, linenRoughness: true, metalness: 0, clearcoatRoughness: 0.5 } as const;
const BACK_FINISH: CardFinish = { ...PAPER_FINISH, roughness: 0.66, clearcoat: 0.12, envMapIntensity: 0.5, emissiveIntensity: 0.03 };
const CARD_FINISHES: Record<PrintKind, CardFinish> = {
  white: { ...PAPER_FINISH, roughness: 0.86, clearcoat: 0, envMapIntensity: 0.25, emissiveIntensity: 0.04 },
  black: { ...PAPER_FINISH, roughness: 0.9, clearcoat: 0, envMapIntensity: 0.2, emissiveIntensity: 0.08 },
  back: BACK_FINISH,
  promptBack: BACK_FINISH,
  gold: { bumpScale: 0.25, linenRoughness: false, roughness: 0.3, metalness: 0.55, clearcoat: 0.5,
    clearcoatRoughness: 0.22, envMapIntensity: 1.5, emissiveIntensity: 0.05 },
};

const ROOM = "#3b2b23";
/** Big-format cards, 8.4 × 11.8 cm (1 unit = 10 cm), with the 5:7 ratio of real playing cards. */
const CW = 0.84, CH = CW / CARD_ASPECT;
/** Cardstock lying on a table bows a little: 1.2 mm across the width. */
const CURL = 0.012;
const STOCK = 0.006;
/** Height of a lying card's group so its back clears the tabletop. */
const LAY = STOCK + 0.002;
const FLAT = -Math.PI / 2;
const RACK_Z = 3.55, CENTER_Z = 1.75, PROMPT_Z = -0.65;
/** The hand stands in a walnut card rack, leaning back 30° from upright; the prompt sits on a small easel. */
const RACK = { lean: 1.05, seat: 0.17, front: 0.12, length: 7.8 };
const EASEL = { lean: 1.2, seat: 0.1, front: 0.1 };
const leanUp = (lean: number) => new T.Vector3(0, Math.sin(lean), -Math.cos(lean));
const leanOut = (lean: number) => new T.Vector3(0, Math.cos(lean), Math.sin(lean));
const WHITE_DECK = { x: -3.85, z: -0.35, yaw: -0.1, h: 0.34 };
const BLACK_DECK = { x: -2.45, z: -0.6, yaw: 0.08, h: 0.24 };
const PILE = { x: 2.4, z: -0.4 };

type Film = ReturnType<typeof cardPrint>;
interface Spawn { x: number; y: number; z: number; roll: number }

/** On-demand renderer: only resize, selection, hover, camera glides and short card movements cost frames. */
export interface TableOptions {
  /** Ctrl/⌘ + wheel, pinch, drag-to-pan and zoomBy(); off for the decorative home preview. */
  zoomable?: boolean;
  onZoom?: (zoom: number) => void;
  /** A plain wheel over the canvas scrolls the page; the stage can explain how to zoom instead. */
  onWheelHint?: () => void;
}

/** Also used by TableStage.tsx for the zoom buttons. */
const MAX_ZOOM = 3.5;

export function mountTable(canvas: HTMLCanvasElement, pick: (id: string) => void, onReady?: () => void,
  options: TableOptions = {}) {
  const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(ROOM, 1);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;

  const scene = new T.Scene();
  scene.fog = new T.Fog(ROOM, 40, 90);
  const camera = new T.PerspectiveCamera(36, 2, 1, 260);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 16);

  const geometries = new Set<T.BufferGeometry>();
  const textures = new Set<T.Texture>();
  const materials = new Map<string, T.Material>();

  const solid = (color: string, roughness = 0.72, metalness = 0) => {
    const key = `${color}/${roughness}/${metalness}`;
    if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({ color, roughness, metalness }));
    return materials.get(key)! as T.MeshStandardMaterial;
  };
  function own<M extends T.Material>(m: M) { materials.set(m.uuid, m); return m; }
  function shape<G extends T.BufferGeometry>(g: G) { geometries.add(g); return g; }
  function trackTex<X extends T.Texture>(t: X) { textures.add(t); return t; }

  const pmrem = new T.PMREMGenerator(renderer);
  const envScene = buildEnvScene();
  const envMap = pmrem.fromScene(envScene, 0.045).texture;
  trackTex(envMap);
  envScene.traverse(o => {
    if (o instanceof T.Mesh) {
      o.geometry.dispose();
      (o.material as T.Material).dispose();
    }
  });
  pmrem.dispose();
  scene.environment = envMap;
  scene.environmentIntensity = 0.32;

  const hemi = new T.HemisphereLight(0xffeedc, 0x3a261c, 0.26);
  const lamp = new T.SpotLight(0xffdcae, 1750, 0, 0.56, 1, 2);
  lamp.position.set(-1.2, 17, 1.2);
  lamp.target.position.set(0, 0, 0.4);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.radius = 5;
  lamp.shadow.blurSamples = 16;
  lamp.shadow.bias = -0.0002;
  lamp.shadow.normalBias = 0.02;
  lamp.shadow.camera.near = 8;
  lamp.shadow.camera.far = 40;
  const rim = new T.DirectionalLight(0xbcd9ff, 0.38);
  rim.position.set(14, 9, 16);
  const warmBack = new T.PointLight(0xffb36b, 0.5, 0, 0);
  warmBack.position.set(-20, 9, -16);
  scene.add(hemi, lamp, lamp.target, rim, warmBack);

  const tex = createTextureBundle(anisotropy, trackTex);
  const builders = { shape, own, solid, textures: tex };
  const { plane, mahoganyMat, brassMat, shadowMatSoft } = buildRoomAndTable(scene, builders);
  const seatKit = createSeatKit(builders, mahoganyMat, brassMat, plane, shadowMatSoft);

  function bow(g: T.BufferGeometry) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / (CW / 2);
      p.setZ(i, p.getZ(i) + CURL * u * u);
    }
    g.computeVertexNormals();
    return g;
  }
  const faceGeo = shape(bow(new T.PlaneGeometry(CW, CH, 8, 10)));
  const backGeo = new T.PlaneGeometry(CW, CH, 8, 10);
  backGeo.rotateY(Math.PI);
  shape(bow(backGeo)).translate(0, 0, -STOCK);

  function cardMaterial(map: Film, kind: PrintKind) {
    const finish = CARD_FINISHES[kind];
    return new T.MeshPhysicalMaterial({
      map,
      alphaTest: 0.5,
      bumpMap: tex.linen.bump,
      bumpScale: finish.bumpScale,
      roughnessMap: finish.linenRoughness ? tex.linen.rough : undefined,
      roughness: finish.roughness,
      metalness: finish.metalness,
      clearcoat: finish.clearcoat,
      clearcoatRoughness: finish.clearcoatRoughness,
      envMapIntensity: finish.envMapIntensity,
      // A touch of self-illumination keeps the print readable where the lamp light falls off.
      emissive: 0xffffff,
      emissiveMap: map,
      emissiveIntensity: finish.emissiveIntensity,
    });
  }
  function staticPrint(kind: PrintKind) {
    const t = trackTex(cardPrint("", "", kind));
    t.anisotropy = anisotropy;
    return own(cardMaterial(t, kind));
  }
  const reverseMat = staticPrint("back");
  const promptReverseMat = staticPrint("promptBack");

  const covers = new Map<string, { texture: Film; mat: T.MeshPhysicalMaterial }>();
  let used = new Set<string>();
  function printKey(text: string, label: string, kind: PrintKind, order = 0) {
    return JSON.stringify([text, label, kind, order]);
  }
  function print(text: string, label: string, kind: PrintKind, order = 0) {
    const key = printKey(text, label, kind, order);
    used.add(key);
    if (!covers.has(key)) {
      const texture = cardPrint(text, label, kind, order);
      texture.anisotropy = anisotropy;
      covers.set(key, { texture, mat: cardMaterial(texture, kind) });
    }
    return covers.get(key)!.mat;
  }

  const outline = new T.Shape();
  const r = 0.045, hw = CW / 2, hh = CH / 2;
  outline.moveTo(-hw + r, -hh);
  outline.lineTo(hw - r, -hh); outline.quadraticCurveTo(hw, -hh, hw, -hh + r);
  outline.lineTo(hw, hh - r); outline.quadraticCurveTo(hw, hh, hw - r, hh);
  outline.lineTo(-hw + r, hh); outline.quadraticCurveTo(-hw, hh, -hw, hh - r);
  outline.lineTo(-hw, -hh + r); outline.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  const deckEdgeWhite = own(new T.MeshStandardMaterial({ map: tex.deckEdge, roughness: 0.85 }));
  const deckEdgeBlack = own(new T.MeshStandardMaterial({ map: tex.deckEdge, color: "#3d3644", roughness: 0.8 }));
  const shadowMatCard = own(new T.MeshBasicMaterial({ map: tex.cardShadow, transparent: true, depthWrite: false, opacity: 0.55 }));

  function sheet(parent: T.Object3D, front: T.Material, back: T.Material) {
    const f = new T.Mesh(faceGeo, front);
    const b = new T.Mesh(backGeo, back);
    f.castShadow = true;
    f.receiveShadow = b.receiveShadow = true;
    parent.add(f, b);
    return f;
  }

  function deck(spec: typeof WHITE_DECK, top: T.Material, edge: T.Material, seed: number) {
    const group = new T.Group();
    group.position.set(spec.x, TOP, spec.z);
    group.rotation.y = spec.yaw;
    scene.add(group);
    const bevel = 0.006;
    const geo = shape(new T.ExtrudeGeometry(outline, {
      depth: spec.h, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6,
    }));
    // Striations wrap horizontally around the block, one line per card
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + p.getY(i)) * 2, p.getZ(i) / spec.h * (spec.h / 0.12));
    const block = new T.Mesh(geo, edge);
    block.rotation.x = FLAT;
    block.position.y = bevel;
    block.castShadow = block.receiveShadow = true;
    group.add(block);
    const jitter = seeded(seed);
    for (let i = 0; i < 2; i++) {
      const loose = new T.Group();
      loose.position.set((jitter() - 0.5) * 0.06, spec.h + bevel * 2 + LAY + i * 0.014, (jitter() - 0.5) * 0.06);
      loose.rotation.set(FLAT, (jitter() - 0.5) * 0.12, 0, "YXZ");
      sheet(loose, top, top);
      group.add(loose);
    }
    addContactShadow(group, plane, shadowMatCard, 0, 0.003, 0, CW * 1.3, CH * 1.22);
    return spec.h + bevel * 2 + 0.03;
  }
  const whiteTop = deck(WHITE_DECK, reverseMat, deckEdgeWhite, 7);
  const blackTop = deck(BLACK_DECK, promptReverseMat, deckEdgeBlack, 11);

  function block(parent: T.Object3D, w: number, h: number, d: number, at: T.Vector3, tiltX = 0) {
    const m = new T.Mesh(shape(new RoundedBoxGeometry(w, h, d, 2, Math.min(h, d) * 0.3)), mahoganyMat);
    m.position.copy(at);
    m.rotation.x = tiltX;
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
  }
  function stand(z: number, length: number, spec: typeof EASEL, backHeight: number) {
    const group = new T.Group();
    group.position.set(0, TOP, z);
    scene.add(group);
    const up = leanUp(spec.lean), out = leanOut(spec.lean);
    const bottom = new T.Vector3(0, spec.seat, spec.front);
    block(group, length, spec.seat, 0.66, new T.Vector3(0, spec.seat / 2, 0));
    block(group, length, 0.16, 0.08, new T.Vector3(0, spec.seat + 0.06, spec.front + 0.06));
    block(group, length * 0.82, backHeight, 0.06,
      bottom.clone().addScaledVector(up, backHeight / 2 + 0.05).addScaledVector(out, -STOCK - 0.04), spec.lean - Math.PI / 2);
    addContactShadow(group, plane, shadowMatSoft, 0, 0.004, -0.1, length * 1.12, 1.6);
  }
  stand(RACK_Z, RACK.length, RACK, 0.3);
  stand(PROMPT_Z, 1.3, EASEL, 0.7);

  const seatGroup = new T.Group();
  scene.add(seatGroup);
  const seatTextures: T.Texture[] = [], seatMaterials: T.Material[] = [];
  function clearSeats() {
    seatGroup.clear();
    seatTextures.splice(0).forEach(t => t.dispose());
    seatMaterials.splice(0).forEach(m => m.dispose());
  }
  const TENT_W = 1.7, TENT_H = 0.62;
  const tentFaceGeo = shape(new T.BoxGeometry(TENT_W, TENT_H, 0.02));
  // (column, side): side 1 is the local player's long side, -1 the far side, 0 the two ends.
  const PLACES: [number, number][] = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
  const PAINT = ["#c9573f", "#4f7d95", "#8a6aa6", "#6f8b45"];

  function tentTexture(s: TableModel["seats"][number], color: string) {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 188;
    const g = c.getContext("2d")!;
    const highlight = s.winner || s.judge;
    const grad = highlight ? g.createLinearGradient(0, 0, 512, 188) : g.createLinearGradient(0, 0, 0, 188);
    if (highlight) {
      grad.addColorStop(0, "#fae08e"); grad.addColorStop(0.5, "#ffeeb4"); grad.addColorStop(1, "#e5b546");
    } else {
      grad.addColorStop(0, "#fffdf8"); grad.addColorStop(1, "#f1e6d4");
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 188);
    g.fillStyle = color;
    g.fillRect(0, 0, 512, 18);
    g.textAlign = "center";
    const tag = s.judge ? "★ JUIZ" : s.winner ? "★ PONTO!" : s.offline ? "AUSENTE" : "";
    if (tag) {
      g.font = `800 28px ui-monospace, Menlo, monospace`;
      g.fillStyle = "#7d223e";
      g.fillText(tag, 256, 60);
    }
    g.fillStyle = s.offline ? "#5d5560" : "#180f2c";
    g.font = `800 ${tag ? 62 : 72}px "Helvetica Neue", Arial, sans-serif`;
    g.fillText(s.name, 256, tag ? 142 : 124, 470);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = anisotropy;
    return t;
  }

  let seatKey = "";
  /** Top corners of every place card, so the seat view always frames who is at the table. */
  const tentBounds: T.Vector3[] = [];
  function seats(list: TableModel["seats"]) {
    if (seatKey === JSON.stringify(list)) return false;
    seatKey = JSON.stringify(list);
    clearSeats();
    tentBounds.length = 0;
    list.forEach((s, i) => {
      const [col, side] = PLACES[Math.round(i * PLACES.length / list.length) % PLACES.length];
      const color = s.offline ? "#7e858c" : s.winner ? "#e6ab2e" : PAINT[i % PAINT.length];
      const end = side === 0;
      // Neighbours on the local player's side sit a little further out, clear of the rack.
      const x = col * (side > 0 ? 7 : 6.5);
      if (i !== 0) {
        const chair = seatKit.chair(color);
        if (end) chair.position.set(col * (TABLE.halfW + 1.5), FLOOR, 0);
        else chair.position.set(x, FLOOR, side * (TABLE.halfD + 1.35));
        chair.rotation.y = end ? col * Math.PI / 2 : side < 0 ? Math.PI : 0;
        seatGroup.add(chair);
      }

      const highlight = s.winner || s.judge;
      const t = tentTexture(s, color);
      const m = new T.MeshPhysicalMaterial({
        map: t, bumpMap: tex.linen.bump, bumpScale: 0.2,
        roughness: highlight ? 0.4 : 0.7, metalness: highlight ? 0.2 : 0, clearcoat: highlight ? 0.3 : 0.06,
        emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.05,
      });
      seatTextures.push(t);
      seatMaterials.push(m);

      const tent = new T.Group();
      if (i === 0) {
        tent.position.set(-RACK.length / 2 - 1.15, TOP, RACK_Z + 0.1);
        tent.rotation.y = 0.12;
      } else if (end) {
        tent.position.set(col * (TABLE.halfW - 1.15), TOP, 0.1);
        tent.rotation.y = -col * 0.62;
      } else {
        tent.position.set(x, TOP, side * (TABLE.halfD - 0.8));
      }
      seatGroup.add(tent);
      const lean = 0.3, half = TENT_H / 2;
      for (const dir of [1, -1]) {
        const face = new T.Mesh(tentFaceGeo, m);
        face.castShadow = face.receiveShadow = true;
        face.position.set(0, Math.cos(lean) * half, dir * Math.sin(lean) * half);
        // Both leaves lean in toward the fold; the back leaf is turned around so its name reads from behind.
        face.rotation.set(-lean, dir > 0 ? 0 : Math.PI, 0, "YXZ");
        tent.add(face);
      }
      addContactShadow(tent, plane, shadowMatSoft, 0, 0.004, 0, TENT_W * 1.15, 0.75);
      tent.updateMatrixWorld();
      for (const x of [-TENT_W / 2, TENT_W / 2]) tentBounds.push(tent.localToWorld(new T.Vector3(x, TENT_H, 0)));

      if (s.judge) {
        const gavel = seatKit.gavel();
        // Next to the judge's place card, handle toward the judge, clear of cards and props
        if (i === 0) gavel.position.set(RACK.length / 2 + 1.0, TOP, RACK_Z - 0.75);
        else if (end) gavel.position.set(col * (TABLE.halfW - 2.8), TOP, 0.9);
        else gavel.position.set(x + (col > 0 ? -1.9 : 1.9), TOP, side * (TABLE.halfD - 1.95));
        gavel.rotation.y = side < 0 ? Math.PI / 2 + 0.3 : -Math.PI / 2 - 0.3;
        seatGroup.add(gavel);
        gavel.updateMatrixWorld();
        for (const x of [-0.5, 1.9]) tentBounds.push(gavel.localToWorld(new T.Vector3(x / 2.3, 0.3, 0)));
      }
    });
    return true;
  }

  interface Piece {
    group: T.Group;
    face: T.Mesh;
    shadow: T.Mesh;
    pos: T.Vector3;
    tilt: number;
    yaw: number;
    roll: number;
    scale: number;
    /** Offset and extra tilt while hovered: flat cards are tipped up, cards in the rack slide up. */
    lift: T.Vector3;
    liftTilt: number;
    action?: string;
    order: number;
    inRack: boolean;
    printKey: string;
    /** A card just played from the rack: it keeps its print and lands face down on the pile. */
    faceDown?: boolean;
    /** Extra cards of the same play fly to this pile card and are removed when they arrive. */
    leaving?: string;
  }
  const pieces = new Map<string, Piece>();
  let hittable: T.Object3D[] = [];
  let frame = 0, disposed = false, overhead = false, initial = true, hovered: string | undefined;

  const frameTarget = new T.Vector3(0, 0.3, 0.8);
  const camPos = new T.Vector3();
  const camGoal = new T.Vector3();
  // Zoom dollies the camera toward a focus point on the table; pan moves that focus within the table.
  let zoom = 1, fitDistance = 30;
  const viewDir = new T.Vector3(0, 0.8, 1).normalize();
  const pan = new T.Vector3();
  const lookPos = new T.Vector3(), lookGoal = new T.Vector3();
  let fogNearGoal = 40, fogFarGoal = 90;
  let camReady = false;
  const goal = new T.Vector3();
  const euler = new T.Euler(0, 0, 0, "YXZ");
  const turn = new T.Quaternion();

  // Shaders compile in the background (KHR_parallel_shader_compile) instead of stalling the page for
  // seconds on the first frame. Compilation starts one frame after mount so the first update()'s
  // cards and seats are already in the scene and get compiled too.
  let compiled = false, compiling = false;
  function invalidate() {
    if (frame || disposed) return;
    if (compiled) { frame = requestAnimationFrame(draw); return; }
    if (compiling) return;
    compiling = true;
    requestAnimationFrame(() => {
      if (disposed) return;
      // Falha na pré-compilação só atrasa os shaders para o primeiro quadro; desenhar mesmo assim.
      renderer.compileAsync(scene, camera).catch(() => undefined).then(() => {
        if (disposed) return;
        compiled = true;
        invalidate();
        onReady?.();
      });
    });
  }

  function draw() {
    frame = 0;
    let moving = false;
    const snap = reduce.matches;

    if (camReady) {
      if (!snap && (camPos.distanceToSquared(camGoal) > 0.002 || lookPos.distanceToSquared(lookGoal) > 0.0005)) {
        camPos.lerp(camGoal, 0.18);
        lookPos.lerp(lookGoal, 0.18);
        moving = true;
      } else {
        camPos.copy(camGoal);
        lookPos.copy(lookGoal);
      }
      camera.position.copy(camPos);
      camera.lookAt(lookPos);
      const fog = scene.fog as T.Fog;
      fog.near += (fogNearGoal - fog.near) * (snap ? 1 : 0.16);
      fog.far += (fogFarGoal - fog.far) * (snap ? 1 : 0.16);
    }

    for (const [key, p] of pieces) {
      if (p.leaving && p.group.position.distanceToSquared(p.pos) < 0.0004) { drop(key, p); continue; }
      const lifted = Boolean(p.action && p.action === hovered);
      goal.copy(p.pos);
      let tilt = p.tilt;
      if (lifted) {
        goal.add(p.lift);
        tilt += p.liftTilt;
      }
      euler.set(tilt, p.yaw, p.roll);
      turn.setFromEuler(euler);
      const g = p.group;
      if (!snap && (g.position.distanceToSquared(goal) > 0.00002 || g.quaternion.angleTo(turn) > 0.002)) {
        g.position.lerp(goal, 0.2);
        g.quaternion.slerp(turn, 0.2);
        moving = true;
      } else {
        g.position.copy(goal);
        g.quaternion.copy(turn);
      }
      const sc = p.scale * (lifted ? 1.04 : 1);
      g.scale.setScalar(snap ? sc : g.scale.x + (sc - g.scale.x) * 0.25);
      if (Math.abs(g.scale.x - sc) > 0.001) moving = true;

      // The contact shadow stays on the table and fades and spreads as the card rises
      const height = Math.max(0, g.position.y - LAY);
      p.shadow.visible = height < 0.6;
      p.shadow.position.set(g.position.x, TOP + 0.003, g.position.z);
      p.shadow.rotation.z = p.yaw;
      const spread = 1 + height * 0.25;
      p.shadow.scale.set(CW * 1.26 * g.scale.x * spread, CH * 1.2 * g.scale.x * spread, 1);
      (p.shadow.material as T.MeshBasicMaterial).opacity = 0.5 / (1 + height * 1.6);
    }

    renderer.render(scene, camera);
    if (moving) invalidate();
  }

  // Frame the play area for any aspect ratio by finding the closest camera distance that fits it.
  const playBounds = [
    [-RACK.length / 2, 0, RACK_Z + 0.45], [RACK.length / 2, 0, RACK_Z + 0.45], [-RACK.length / 2, 1.6, RACK_Z - 0.5],
    [RACK.length / 2, 1.6, RACK_Z - 0.5], [-4.4, 0.4, -1.5], [3.0, 0.2, -1.5], [0, 1.4, -1.5],
  ].map(([x, y, z]) => new T.Vector3(x, y, z));
  const overheadBounds = [
    [-TABLE.halfW, 0, -TABLE.halfD], [TABLE.halfW, 0, -TABLE.halfD], [-TABLE.halfW, 0, TABLE.halfD], [TABLE.halfW, 0, TABLE.halfD],
  ].map(([x, y, z]) => new T.Vector3(x, y, z));
  const probe = new T.Vector3();

  function fits(dir: T.Vector3, distance: number, bounds: T.Vector3[]) {
    camera.position.copy(frameTarget).addScaledVector(dir, distance);
    camera.lookAt(frameTarget);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    return bounds.every(b => {
      probe.copy(b).project(camera);
      return Math.abs(probe.x) < 0.97 && Math.abs(probe.y) < 0.95;
    });
  }

  function resize(snap = true) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    viewDir.set(0, overhead ? 1 : 0.8, overhead ? 0.14 : 1).normalize();
    const bounds = overhead ? overheadBounds : [...playBounds, ...tentBounds];
    let lo = 4, hi = 200;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      if (fits(viewDir, mid, bounds)) hi = mid;
      else lo = mid;
    }
    fitDistance = hi;
    aim(snap);
  }

  function aim(snap: boolean) {
    // The further in, the further the focus may wander; fully zoomed out it is back on the play area.
    const reach = 1 - 1 / zoom;
    pan.set(T.MathUtils.clamp(pan.x, -(TABLE.halfW - 1) * reach, (TABLE.halfW - 1) * reach), 0,
      T.MathUtils.clamp(pan.z, -TABLE.halfD * reach, TABLE.halfD * reach));
    lookGoal.copy(frameTarget).add(pan);
    const distance = fitDistance / zoom;
    camGoal.copy(lookGoal).addScaledVector(viewDir, distance);
    fogNearGoal = distance + 6;
    fogFarGoal = distance + 60;
    if (snap || !camReady || reduce.matches) {
      camPos.copy(camGoal);
      lookPos.copy(lookGoal);
      const fog = scene.fog as T.Fog;
      fog.near = fogNearGoal;
      fog.far = fogFarGoal;
    }
    camera.position.copy(camPos);
    camera.lookAt(lookPos);
    camReady = true;
    // Zoomed in, one finger pans the view; otherwise it keeps scrolling the page.
    canvas.style.touchAction = zoom > 1.001 ? "none" : "";
    invalidate();
  }

  const observer = new ResizeObserver(() => resize(true));
  observer.observe(canvas);

  function drop(key: string, p: Piece) {
    scene.remove(p.group, p.shadow);
    (p.shadow.material as T.Material).dispose();
    pieces.delete(key);
  }

  const flatLift = new T.Vector3(0, 0.32, 0.2);
  const rackLift = leanUp(RACK.lean).multiplyScalar(0.2);

  function update(model: TableModel) {
    if (seats(model.seats) && camReady) resize(initial);
    used = new Set();
    hittable = [];
    const live = new Set<string>();

    function card(id: string, text: string, label: string, kind: PrintKind, x: number, y: number, z: number,
      opts: { tilt?: number; yaw?: number; order?: number; action?: string; from?: Spawn; lift?: T.Vector3 } = {}) {
      live.add(id);
      const { tilt = FLAT, yaw = 0, order = 0, action, from, lift = flatLift } = opts;
      let p = pieces.get(id);
      const mat = print(text, label, kind, order);
      if (!p) {
        const group = new T.Group();
        const face = sheet(group, mat, kind === "back" ? reverseMat : kind === "black" ? promptReverseMat : reverseMat);
        scene.add(group);
        const shadow = new T.Mesh(plane, shadowMatCard.clone());
        shadow.rotation.x = FLAT;
        shadow.renderOrder = 1;
        scene.add(shadow);
        const start = !initial && !reduce.matches && from ? from : undefined;
        group.position.set(start?.x ?? x, start?.y ?? y, start?.z ?? z);
        group.quaternion.setFromEuler(euler.set(start ? FLAT : tilt, yaw, start?.roll ?? 0));
        p = { group, face, shadow, pos: new T.Vector3(), tilt, yaw, roll: 0, scale: 1, lift, liftTilt: 0, order, inRack: false, printKey: "" };
        pieces.set(id, p);
      }
      if (p.faceDown) {
        p.roll = Math.PI;
      } else {
        p.face.material = mat;
        p.printKey = printKey(text, label, kind, order);
      }
      p.pos.set(x, y, z);
      p.tilt = tilt;
      p.yaw = yaw;
      p.lift = lift;
      p.liftTilt = lift === flatLift ? 0.3 : 0;
      p.inRack = lift === rackLift;
      p.order = order;
      p.action = action;
      if (action) {
        p.face.userData.action = action;
        hittable.push(p.face);
      } else {
        delete p.face.userData.action;
      }
    }

    const easelAt = leanUp(EASEL.lean).multiplyScalar(CH / 2).addScaledVector(leanOut(EASEL.lean), 0.004)
      .add(new T.Vector3(0, TOP + EASEL.seat, PROMPT_Z + EASEL.front));
    card("prompt:" + model.prompt, model.prompt, model.imprint, "black", easelAt.x, easelAt.y, easelAt.z,
      { tilt: FLAT + EASEL.lean, from: { x: BLACK_DECK.x, y: blackTop + 0.4, z: BLACK_DECK.z, roll: Math.PI } });

    // Cards just played from the rack turn over and slide onto the pile instead of vanishing.
    const handIds = new Set(model.zone === "hand" ? model.cards.map(c => "choice:" + c.id) : []);
    const played = [...pieces].filter(([k, p]) => p.inRack && p.order && !p.leaving && !handIds.has(k));
    const fresh = Array.from({ length: model.backs }, (_, i) => "back" + i).filter(k => !pieces.has(k));
    if (!reduce.matches && played.length && fresh.length) {
      const landing = fresh[fresh.length - 1];
      const [[key, first], ...rest] = played;
      pieces.delete(key);
      pieces.set(landing, first);
      first.faceDown = true;
      for (const [, p] of rest) p.leaving = landing;
    }

    for (let i = 0; i < model.backs; i++) {
      const j = seeded(101 + i * 13);
      card("back" + i, "", "", "back", PILE.x + (j() - 0.5) * 0.3, LAY + i * 0.016, PILE.z + (j() - 0.5) * 0.24,
        { yaw: (j() - 0.5) * 0.7, from: { x: PILE.x + 1.2, y: 0.9, z: PILE.z - 2.6, roll: 0 } });
    }

    const n = model.cards.length;
    if (model.zone === "hand") {
      const pitch = Math.min(CW + 0.1, (RACK.length - CW - 0.3) / Math.max(n - 1, 1));
      const up = leanUp(RACK.lean), out = leanOut(RACK.lean);
      model.cards.forEach((c, i) => {
        const at = new T.Vector3((i - (n - 1) / 2) * pitch, TOP + RACK.seat, RACK_Z + RACK.front)
          .addScaledVector(up, CH / 2 + (c.order ? 0.42 : 0)).addScaledVector(out, 0.004 + i * 0.003);
        card("choice:" + c.id, c.text, c.label, "white", at.x, at.y, at.z, {
          tilt: FLAT + RACK.lean, order: c.order, action: model.canPick ? c.id : undefined, lift: rackLift,
          from: { x: WHITE_DECK.x, y: whiteTop + 0.5, z: WHITE_DECK.z, roll: Math.PI },
        });
      });
    } else {
      const pitch = Math.min(CW + 0.3, 7.6 / Math.max(n - 1, 1));
      model.cards.forEach((c, i) => {
        const v = (i - (n - 1) / 2) * pitch;
        const j = seeded(31 + i * 7);
        const yaw = (j() - 0.5) * 0.08;
        const extra = Math.max(0, (c.count ?? 1) - 1);
        const kind = model.result ? "gold" : "white";
        const reveal = { x: v, y: model.result ? 1.2 : 0.5, z: CENTER_Z - 0.3, roll: Math.PI };
        for (let k = extra; k >= 1; k--) {
          card(`choice:${c.id}:${k}`, "", c.label, kind, v + 0.07 * k, LAY + (extra - k) * 0.016, CENTER_Z - 0.06 * k,
            { yaw: yaw + 0.07 * k, from: reveal });
        }
        const picked = Boolean(c.order) || model.result;
        card("choice:" + c.id, c.text, c.label, kind, v, picked ? 1.05 : LAY + extra * 0.016,
          picked ? CENTER_Z + 0.75 : CENTER_Z, {
            tilt: picked ? FLAT + 0.6 : FLAT, yaw: picked ? 0 : yaw, order: c.order,
            action: model.canPick ? c.id : undefined, from: reveal,
          });
      });
    }

    for (const [k, p] of pieces) {
      if (live.has(k)) continue;
      const landing = p.leaving && pieces.get(p.leaving);
      if (landing && !reduce.matches) {
        p.pos.copy(landing.pos).y += 0.012;
        p.tilt = landing.tilt;
        p.yaw = landing.yaw;
        p.roll = Math.PI;
        p.action = undefined;
        delete p.face.userData.action;
      } else drop(k, p);
    }
    for (const p of pieces.values()) if (p.faceDown || p.leaving) used.add(p.printKey);
    for (const [k, art] of covers) if (!used.has(k)) { art.texture.dispose(); art.mat.dispose(); covers.delete(k); }
    if (hovered && !hittable.some(h => h.userData.action === hovered)) hovered = undefined;
    initial = false;
    invalidate();
  }

  const ray = new T.Raycaster();
  const ndc = new T.Vector2();
  function hit(event: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    ray.setFromCamera(ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2), camera);
    return ray.intersectObjects(hittable, false)[0]?.object.userData.action as string | undefined;
  }

  // Points on the plane at the focus height, seen from where the camera is heading (not where it is
  // mid-glide), so zooming about the pointer and dragging stay stable during camera transitions.
  const ground = new T.Plane(new T.Vector3(0, 1, 0), -frameTarget.y);
  const aimCam = new T.PerspectiveCamera();
  const anchor = new T.Vector3(), from = new T.Vector3(), to = new T.Vector3();
  function groundAt(clientX: number, clientY: number, out: T.Vector3) {
    const rect = canvas.getBoundingClientRect();
    aimCam.copy(camera, false);
    aimCam.position.copy(camGoal);
    aimCam.lookAt(lookGoal);
    aimCam.updateMatrixWorld();
    ray.setFromCamera(ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2), aimCam);
    return ray.ray.intersectPlane(ground, out);
  }

  function zoomTo(next: number, clientX?: number, clientY?: number) {
    next = T.MathUtils.clamp(next, 1, MAX_ZOOM);
    if (!camReady || Math.abs(next - zoom) < 0.0005) return;
    if (clientX !== undefined && clientY !== undefined && groundAt(clientX, clientY, anchor)) {
      // Scaling the view about the point under the pointer keeps that point where it is on screen.
      const f = zoom / next;
      pan.x = anchor.x + (frameTarget.x + pan.x - anchor.x) * f - frameTarget.x;
      pan.z = anchor.z + (frameTarget.z + pan.z - anchor.z) * f - frameTarget.z;
    }
    zoom = next;
    aim(false);
    options.onZoom?.(zoom);
  }

  const touches = new Map<number, { x: number; y: number }>();
  let drag: { x: number; y: number; startX: number; startY: number; moved: boolean } | undefined;
  let pinch = 0, suppressClick = false;
  function spread() {
    const [a, b] = [...touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
  function centre() {
    const [a, b] = [...touches.values()];
    return { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
  }
  function cursor(id?: string) {
    canvas.style.cursor = drag?.moved ? "grabbing" : id ? "pointer" : options.zoomable && zoom > 1.001 ? "grab" : "";
  }

  function down(e: PointerEvent) {
    if (!options.zoomable || (e.pointerType === "mouse" && e.button !== 0)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 1) {
      suppressClick = false;
      drag = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false };
    } else if (touches.size === 2) {
      pinch = spread();
      drag = undefined;
    }
  }
  function move(e: PointerEvent) {
    const point = touches.get(e.pointerId);
    if (point) { point.x = e.clientX; point.y = e.clientY; }
    if (touches.size === 2) {
      const now = spread(), mid = centre();
      if (pinch > 0 && now > 0) zoomTo(zoom * now / pinch, mid.x, mid.y);
      pinch = now;
      suppressClick = true;
      return;
    }
    if (drag && point) {
      if (!drag.moved && zoom > 1.001 && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6) {
        drag.moved = true;
        canvas.setPointerCapture(e.pointerId);
        if (hovered) { hovered = undefined; invalidate(); }
      }
      if (drag.moved) {
        if (groundAt(drag.x, drag.y, from) && groundAt(e.clientX, e.clientY, to)) {
          pan.x += from.x - to.x;
          pan.z += from.z - to.z;
          aim(true);
        }
        drag.x = e.clientX;
        drag.y = e.clientY;
        cursor();
        return;
      }
    }
    const id = hittable.length && e.pointerType !== "touch" ? hit(e) : undefined;
    cursor(id);
    if (id !== hovered) { hovered = id; invalidate(); }
  }
  function up(e: PointerEvent) {
    touches.delete(e.pointerId);
    if (drag?.moved) suppressClick = true;
    if (touches.size < 2) pinch = 0;
    if (touches.size === 0) drag = undefined;
    cursor();
  }
  function click(e: MouseEvent) {
    if (suppressClick) { suppressClick = false; return; }
    const id = hit(e);
    if (id) pick(id);
  }
  function leave() { if (hovered) { hovered = undefined; invalidate(); } cursor(); }
  function wheel(e: WheelEvent) {
    if (!options.zoomable) return;
    // Trackpad pinch arrives as ctrl + wheel in Chromium and Firefox.
    if (!e.ctrlKey && !e.metaKey) { options.onWheelHint?.(); return; }
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomTo(zoom * Math.exp(-T.MathUtils.clamp(delta, -120, 120) * 0.0025), e.clientX, e.clientY);
  }
  // Safari reports trackpad pinch as gesture events. During a touch pinch the pointers already zoom.
  let gestureBase = 1;
  function gestureStart(e: Event) {
    if (!options.zoomable) return;
    e.preventDefault();
    gestureBase = zoom;
  }
  function gestureChange(e: Event) {
    if (!options.zoomable) return;
    e.preventDefault();
    const g = e as Event & { scale?: number; clientX?: number; clientY?: number };
    if (touches.size === 0 && g.scale) zoomTo(gestureBase * g.scale, g.clientX, g.clientY);
  }

  const listeners: [string, EventListener, AddEventListenerOptions?][] = [
    ["click", click as EventListener], ["pointerdown", down as EventListener], ["pointermove", move as EventListener],
    ["pointerup", up as EventListener], ["pointercancel", up as EventListener], ["pointerleave", leave],
    ["wheel", wheel as EventListener, { passive: false }],
    ["gesturestart", gestureStart, { passive: false }], ["gesturechange", gestureChange, { passive: false }],
  ];
  for (const [type, fn, opts] of listeners) canvas.addEventListener(type, fn, opts);
  resize(true);

  return {
    update,
    setOverhead(value: boolean) {
      overhead = value;
      zoom = 1;
      pan.set(0, 0, 0);
      resize(false);
      options.onZoom?.(zoom);
    },
    /** Zoom about the middle of the current view; buttons for people who do not use gestures. */
    zoomBy(factor: number) { zoomTo(zoom * factor); },
    resetZoom() {
      zoom = 1;
      pan.set(0, 0, 0);
      aim(false);
      options.onZoom?.(zoom);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      for (const [type, fn] of listeners) canvas.removeEventListener(type, fn);
      clearSeats();
      pieces.forEach(p => (p.shadow.material as T.Material).dispose());
      covers.forEach(c => { c.texture.dispose(); c.mat.dispose(); });
      geometries.forEach(g => g.dispose());
      materials.forEach(m => m.dispose());
      textures.forEach(t => t.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
