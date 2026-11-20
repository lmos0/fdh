import * as T from "three";
import type { TableModel } from "./model";
import { cardPrint } from "./print";
import { createTextureBundle, seeded } from "./textures";
import { addContactShadow, buildEnvScene, buildRoomAndTable, createSeatKit, FLOOR, TOP } from "./props";

type Film = ReturnType<typeof cardPrint>;
type Kind = Parameters<typeof cardPrint>[2];
const TAU = Math.PI * 2;
const ROOM = "#b59d86";

/** On-demand renderer: only resize, selection, hover, camera glides and short card movements cost frames. */
export function mountTable(canvas: HTMLCanvasElement, pick: (id: string) => void, onReady?: () => void) {
  const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(ROOM, 1);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;

  const scene = new T.Scene();
  scene.fog = new T.Fog(ROOM, 16, 36);
  const camera = new T.PerspectiveCamera(30, 2, 0.5, 80);
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

  // --- Lighting & Warm Dining-Room Studio Environment ---
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
  scene.environmentIntensity = 0.56;

  const hemi = new T.HemisphereLight(0xfff1dc, 0x5c3a28, 0.48);
  const lamp = new T.SpotLight(0xffe0b5, 5.6, 0, 0.56, 0.9, 0.22);
  lamp.position.set(-1.6, 12.2, -1.2);
  lamp.target.position.set(0, 0, 0.3);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.radius = 4.2;
  lamp.shadow.blurSamples = 16;
  lamp.shadow.bias = -0.0003;
  lamp.shadow.normalBias = 0.015;
  lamp.shadow.camera.near = 6;
  lamp.shadow.camera.far = 20;

  const rim = new T.DirectionalLight(0xb8ddff, 0.46);
  rim.position.set(6.4, 5.6, 7.2);

  const warmBack = new T.PointLight(0xffc680, 0.72, 16, 1.6);
  warmBack.position.set(-4.8, 3.2, -3.4);

  scene.add(hemi, lamp, lamp.target, rim, warmBack);

  // --- Procedural PBR Textures, Room, Table & Props ---
  const tex = createTextureBundle(anisotropy, trackTex);
  const builders = { shape, own, solid, textures: tex };
  const { plane, mahoganyMat, brassMat, shadowMatSoft } = buildRoomAndTable(scene, builders);
  const seatKit = createSeatKit(builders, mahoganyMat, brassMat, plane, shadowMatSoft);

  // --- Cards: Beveled Heavy Linen Cardstock with Front & Back Art ---
  const outline = new T.Shape();
  const cr = 0.068;
  outline.moveTo(-0.5 + cr, -0.625);
  outline.lineTo(0.5 - cr, -0.625); outline.quadraticCurveTo(0.5, -0.625, 0.5, -0.625 + cr);
  outline.lineTo(0.5, 0.625 - cr); outline.quadraticCurveTo(0.5, 0.625, 0.5 - cr, 0.625);
  outline.lineTo(-0.5 + cr, 0.625); outline.quadraticCurveTo(-0.5, 0.625, -0.5, 0.625 - cr);
  outline.lineTo(-0.5, -0.625 + cr); outline.quadraticCurveTo(-0.5, -0.625, -0.5 + cr, -0.625);

  const faceGeo = shape(new T.ShapeGeometry(outline, 10));
  const uv = faceGeo.attributes.uv, pos = faceGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) + 0.5, (pos.getY(i) + 0.625) / 1.25);

  const backFaceGeo = shape(faceGeo.clone());
  backFaceGeo.rotateY(Math.PI);

  const STOCK = 0.015;
  const BEVEL = 0.004;
  const bodyGeo = shape(new T.ExtrudeGeometry(outline, {
    depth: STOCK,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 2,
    curveSegments: 10,
  }));
  // Position body so front printed face sits cleanly on z = +0.0008 and back face on z = -(STOCK + 2*BEVEL) - 0.0008
  bodyGeo.translate(0, 0, -STOCK - BEVEL - 0.0008);
  backFaceGeo.translate(0, 0, -STOCK - BEVEL * 2 - 0.0016);

  // Realistic Draw Deck Stack on the left (striated stacked-card block + top askew sheets)
  const DECK_X = -2.55, DECK_Z = -0.6;
  const DECK_H = 0.21;
  const deckGroup = new T.Group();
  deckGroup.position.set(DECK_X, TOP, DECK_Z);
  deckGroup.rotation.y = 0.19;
  scene.add(deckGroup);

  const deckBlockGeo = shape(new T.ExtrudeGeometry(outline, {
    depth: DECK_H,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 2,
    curveSegments: 10,
  }));
  // Map side UVs cleanly along extrusion depth so striated paper-edge lines wrap horizontally around the deck
  const dPos = deckBlockGeo.attributes.position, dUv = deckBlockGeo.attributes.uv;
  for (let i = 0; i < dUv.count; i++) {
    dUv.setXY(i, (dPos.getX(i) + dPos.getY(i)) * 1.5, dPos.getZ(i) / DECK_H);
  }
  const deckEdgeMat = own(new T.MeshStandardMaterial({
    map: tex.deckEdge,
    roughness: 0.82,
    metalness: 0,
  }));
  const deckBlock = new T.Mesh(deckBlockGeo, deckEdgeMat);
  deckBlock.scale.set(0.83, 0.83, 1);
  deckBlock.rotation.x = -Math.PI / 2;
  deckBlock.position.y = 0.004;
  deckBlock.castShadow = deckBlock.receiveShadow = true;
  deckGroup.add(deckBlock);

  // Add 3 subtly askew individual cards near the top of the deck for organic hand-dealt realism
  const jitter = seeded(7);
  for (let i = 0; i < 3; i++) {
    const loose = new T.Mesh(bodyGeo, solid(i % 2 ? "#f4ece0" : "#e9decb", 0.78));
    loose.scale.set(0.83, 0.83, 1);
    loose.position.set((jitter() - 0.5) * 0.022, DECK_H + 0.014 + i * 0.017, (jitter() - 0.5) * 0.022);
    loose.rotation.set(-Math.PI / 2, 0, (jitter() - 0.5) * 0.055);
    loose.castShadow = loose.receiveShadow = true;
    deckGroup.add(loose);
  }
  addContactShadow(deckGroup, plane, shadowMatSoft, 0.02, 0.003, 0.02, 1.06, 1.3);
  const deckTop = TOP + DECK_H + 0.068;

  // Shared card back material for the reverse side of every playing card
  const reverseTex = cardPrint("", "", "back");
  reverseTex.anisotropy = anisotropy;
  trackTex(reverseTex);
  const reverseMat = own(new T.MeshPhysicalMaterial({
    map: reverseTex,
    bumpMap: tex.linen.bump,
    bumpScale: 0.006,
    roughnessMap: tex.linen.rough,
    roughness: 0.62,
    clearcoat: 0.08,
    clearcoatRoughness: 0.52,
    envMapIntensity: 0.45,
  }));

  const covers = new Map<string, { texture: Film; mat: T.MeshPhysicalMaterial }>();
  let used = new Set<string>();
  function print(text: string, label: string, kind: Kind, order = 0) {
    const key = JSON.stringify([text, label, kind, order]);
    used.add(key);
    if (!covers.has(key)) {
      const texture = cardPrint(text, label, kind, order);
      texture.anisotropy = anisotropy;
      const gold = kind === "gold";
      const black = kind === "black";
      const back = kind === "back";
      covers.set(key, {
        texture,
        mat: new T.MeshPhysicalMaterial({
          map: texture,
          bumpMap: tex.linen.bump,
          bumpScale: gold ? 0.004 : 0.006,
          roughnessMap: gold ? undefined : tex.linen.rough,
          roughness: gold ? 0.26 : black ? 0.94 : back ? 0.78 : 0.92,
          metalness: gold ? 0.56 : 0,
          clearcoat: gold ? 0.52 : back ? 0.08 : 0,
          clearcoatRoughness: gold ? 0.2 : 0.52,
          envMapIntensity: gold ? 1.65 : back ? 0.42 : black ? 0.16 : 0.2,
          // Gentle self-illumination keeps cards readable at grazing angles without washing out ink or dark stock
          emissive: 0xffffff,
          emissiveMap: texture,
          emissiveIntensity: black ? 0.09 : gold ? 0.08 : back ? 0.04 : 0.03,
        }),
      });
    }
    return covers.get(key)!.mat;
  }

  // --- Seats: Handcrafted Chairs, Folded Cardstock Place Tents & Judge's Gavel ---
  const seatGroup = new T.Group();
  scene.add(seatGroup);
  const seatTextures: T.Texture[] = [], seatMaterials: T.Material[] = [];
  function clearSeats() {
    seatGroup.clear();
    seatTextures.splice(0).forEach(t => t.dispose());
    seatMaterials.splice(0).forEach(m => m.dispose());
  }
  const tentFaceGeo = shape(new T.BoxGeometry(1, 0.34, 0.012));

  let seatKey = "";
  function seats(list: TableModel["seats"]) {
    if (seatKey === JSON.stringify(list)) return;
    seatKey = JSON.stringify(list);
    clearSeats();
    list.forEach((s, i) => {
      const places = [[0, 1], [0.61, 1], [1, 0], [0.61, -1], [0, -1], [-0.61, -1], [-1, 0], [-0.61, 1]];
      const [x, z] = places[Math.round(i * places.length / list.length) % places.length];
      const color = s.offline ? "#7e858c" : s.winner ? "#e6ab2e" : ["#d65a44", "#588299", "#9474ad", "#7c944c"][i % 4];
      if (i !== 0) {
        const c = seatKit.chair(color);
        c.position.set(z === 0 ? x * 5.55 : x * 5.04, FLOOR, z === 0 ? 0 : z * 2.95);
        c.rotation.y = z === 0 ? x * TAU / 4 : z < 0 ? TAU / 2 : 0;
        seatGroup.add(c);
      }

      // Crisp folded thick-cardstock place card tent
      const highlight = s.winner || s.judge;
      const t = new T.CanvasTexture((() => {
        const c = document.createElement("canvas");
        c.width = 512;
        c.height = 176;
        const g = c.getContext("2d")!;
        if (highlight) {
          const grad = g.createLinearGradient(0, 0, 512, 176);
          grad.addColorStop(0, "#fae08e");
          grad.addColorStop(0.5, "#ffeeb4");
          grad.addColorStop(1, "#e5b546");
          g.fillStyle = grad;
        } else {
          const grad = g.createLinearGradient(0, 0, 0, 176);
          grad.addColorStop(0, "#fffdf8");
          grad.addColorStop(1, "#f4ead9");
          g.fillStyle = grad;
        }
        g.fillRect(0, 0, 512, 176);
        g.fillStyle = color;
        g.fillRect(0, 0, 512, 20);
        g.textAlign = "center";
        const tag = s.judge ? "★ JUIZ" : s.winner ? "★ PONTO!" : s.offline ? "AUSENTE" : "";
        if (tag) {
          g.font = `800 26px ui-monospace, Menlo, monospace`;
          g.fillStyle = "#7d223e";
          g.fillText(tag, 256, 58);
        }
        g.fillStyle = "#180f2c";
        g.font = `800 ${tag ? 58 : 66}px "Helvetica Neue", Arial, sans-serif`;
        g.fillText(s.name, 256, tag ? 132 : 118, 464);
        g.strokeStyle = "rgba(24,15,44,0.22)";
        g.lineWidth = 4;
        g.strokeRect(2, 2, 508, 172);
        return c;
      })());
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = anisotropy;
      const m = new T.MeshPhysicalMaterial({
        map: t,
        bumpMap: tex.linen.bump,
        bumpScale: 0.004,
        roughness: highlight ? 0.36 : 0.68,
        metalness: highlight ? 0.25 : 0,
        clearcoat: highlight ? 0.3 : 0.08,
      });
      seatTextures.push(t);
      seatMaterials.push(m);

      const tent = new T.Group();
      tent.position.set(z === 0 ? x * 4.3 : x * 4.35, TOP, z === 0 ? 0.2 : z < 0 ? -2.26 : 2.02);
      tent.rotation.y = z === 0 ? -x * 0.5 : 0;
      seatGroup.add(tent);

      const lean = 0.32, half = 0.34 / 2;
      const front = new T.Mesh(tentFaceGeo, m);
      front.castShadow = front.receiveShadow = true;
      front.position.set(0, Math.cos(lean) * half, Math.sin(lean) * half);
      front.rotation.x = -lean;
      tent.add(front);

      const back = new T.Mesh(tentFaceGeo, solid(highlight ? "#e3b247" : "#ece0cc", 0.78));
      back.castShadow = back.receiveShadow = true;
      back.position.set(0, Math.cos(lean) * half, -Math.sin(lean) * half);
      back.rotation.x = lean;
      tent.add(back);

      addContactShadow(tent, plane, shadowMatSoft, 0, 0.003, 0, 1.15, 0.38);

      if (s.judge) {
        const gavel = seatKit.gavel();
        seatGroup.add(gavel);
        // Place gavel proudly near the judge without ever clipping into cards or corner props
        let gx: number, gz: number;
        if (z === 1 && x === 0) { gx = 1.55; gz = 1.92; }
        else if (z === 0) { gx = x * 3.85; gz = 0.95; }
        else if (z < 0) {
          gx = x === 0 ? 1.18 : x * 3.55 + (x > 0 ? -0.85 : 0.85);
          gz = -1.84;
        } else {
          gx = x * 3.55;
          gz = 1.88;
        }
        gavel.position.set(gx, TOP, gz);
        gavel.rotation.y = -0.45;
      }
    });
  }

  // --- Cards State, Smooth Camera Transitions & On-Demand Render Loop ---
  interface Piece {
    group: T.Group;
    face: T.Mesh;
    body: T.Mesh;
    target: T.Vector3;
    scale: number;
    tilt: number;
    yaw: number;
    action?: string;
  }
  const pieces = new Map<string, Piece>();
  let hittable: T.Object3D[] = [];
  let frame = 0, disposed = false, overhead = false, initial = true, hovered: string | undefined;

  const frameTarget = new T.Vector3(0, -0.15, 0.25);
  const camPos = new T.Vector3();
  const camGoal = new T.Vector3();
  let fogNearGoal = 15, fogFarGoal = 30;
  let camReady = false;
  const goal = new T.Vector3();

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

    // Smoothly glide camera when switching viewpoints (instant if prefers-reduced-motion)
    if (camReady) {
      if (!reduce.matches && camPos.distanceToSquared(camGoal) > 0.0004) {
        camPos.lerp(camGoal, 0.16);
        moving = true;
      } else {
        camPos.copy(camGoal);
      }
      camera.position.copy(camPos);
      camera.lookAt(frameTarget);
      const fog = scene.fog as T.Fog;
      fog.near += (fogNearGoal - fog.near) * (reduce.matches ? 1 : 0.16);
      fog.far += (fogFarGoal - fog.far) * (reduce.matches ? 1 : 0.16);
    }

    for (const p of pieces.values()) {
      const isHovered = Boolean(p.action && p.action === hovered);
      const pos = p.group.position;
      goal.copy(p.target);
      if (isHovered) {
        goal.y += 0.16;
        goal.z += 0.08;
      }
      if (!reduce.matches && pos.distanceToSquared(goal) > 0.00004) {
        pos.lerp(goal, 0.24);
        moving = true;
      } else {
        pos.copy(goal);
      }

      const targetTilt = p.tilt + (isHovered ? 0.08 : 0);
      const rx = p.group.rotation.x;
      const tilt = !reduce.matches && Math.abs(rx - targetTilt) > 0.003 ? rx + (targetTilt - rx) * 0.22 : targetTilt;
      if (tilt !== targetTilt) moving = true;
      p.group.rotation.set(tilt, p.yaw, 0, "YXZ");

      const targetScale = p.scale * (isHovered ? 1.035 : 1);
      const curScale = p.group.scale.x;
      const sc = !reduce.matches && Math.abs(curScale - targetScale) > 0.001 ? curScale + (targetScale - curScale) * 0.24 : targetScale;
      if (sc !== targetScale) moving = true;
      p.group.scale.set(sc, sc, 1);
    }

    renderer.render(scene, camera);
    if (moving) invalidate();
  }

  // Frame the table, chairs and props for any aspect ratio by finding the closest fitting camera distance.
  const bounds = [
    [-5.6, 0.3, 0], [5.6, 0.3, 0], [-3.4, 0.3, -3.3], [3.4, 0.3, -3.3],
    [-4.95, TOP, 2.5], [4.95, TOP, 2.5], [-4.95, TOP, -2.5], [4.95, TOP, -2.5], [0, FLOOR + 0.6, 2.6],
  ].map(([x, y, z]) => new T.Vector3(x, y, z));
  const probe = new T.Vector3();

  function fits(dir: T.Vector3, distance: number) {
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
    const dir = (overhead ? new T.Vector3(0, 14, 1.4) : new T.Vector3(0, 9.4, 7.9)).normalize();
    let lo = 4, hi = 60;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(dir, mid)) hi = mid;
      else lo = mid;
    }
    camGoal.copy(frameTarget).addScaledVector(dir, hi);
    fogNearGoal = hi + 0.8;
    fogFarGoal = hi + 14;
    if (snap || !camReady || reduce.matches) {
      camPos.copy(camGoal);
      camera.position.copy(camPos);
      camera.lookAt(frameTarget);
      const fog = scene.fog as T.Fog;
      fog.near = fogNearGoal;
      fog.far = fogFarGoal;
    } else {
      // Restore current camera position so draw() smoothly interpolates to camGoal
      camera.position.copy(camPos);
      camera.lookAt(frameTarget);
    }
    camReady = true;
    invalidate();
  }

  const observer = new ResizeObserver(() => resize(true));
  observer.observe(canvas);

  function update(model: TableModel) {
    seats(model.seats);
    used = new Set();
    hittable = [];
    const live = new Set<string>();

    function card(
      id: string,
      text: string,
      label: string,
      kind: Kind,
      x: number,
      y: number,
      z: number,
      w: number,
      tilt: number,
      yaw: number,
      order = 0,
      action?: string,
    ) {
      live.add(id);
      let p = pieces.get(id);
      const mat = print(text, label, kind, order);
      const bodyColor = kind === "black" ? "#100d17" : kind === "gold" ? "#d6a030" : "#efe5d4";
      if (!p) {
        const group = new T.Group();
        const body = new T.Mesh(bodyGeo, solid(bodyColor, kind === "gold" ? 0.35 : 0.72, kind === "gold" ? 0.45 : 0));
        body.castShadow = body.receiveShadow = true;
        group.add(body);

        const face = new T.Mesh(faceGeo, mat);
        face.receiveShadow = true;
        group.add(face);

        const reverse = new T.Mesh(backFaceGeo, reverseMat);
        reverse.receiveShadow = true;
        group.add(reverse);

        scene.add(group);
        group.position.set(x, y + (initial || reduce.matches ? 0 : 0.34), z);
        group.rotation.set(!initial && id.startsWith("choice:") ? tilt + Math.PI * 0.76 : tilt, yaw, 0, "YXZ");
        group.scale.set(w, w, 1);
        p = { group, face, body, target: new T.Vector3(), scale: w, tilt, yaw };
        pieces.set(id, p);
      }
      p.face.material = mat;
      p.body.material = solid(bodyColor, kind === "gold" ? 0.35 : 0.72, kind === "gold" ? 0.45 : 0);
      p.target.set(x, y, z);
      p.scale = w;
      p.tilt = tilt;
      p.yaw = yaw;
      p.action = action;
      if (action) {
        p.face.userData.action = action;
        hittable.push(p.face);
      } else {
        delete p.face.userData.action;
      }
    }

    card("deck", "", "", "back", DECK_X, deckTop, DECK_Z, 0.83, -Math.PI / 2, 0.19);
    // y keeps the near (lowest) edge of the tilted body just above the tabletop
    card("prompt", model.prompt, model.imprint, "black", 0, 0.215, -0.92, 1.62, -1.46, -0.04);
    for (let i = 0; i < model.backs; i++) {
      card("back" + i, "", "", "back", 2.34 + i * 0.045, TOP + 0.024 + i * 0.025, -0.48, 0.89, -Math.PI / 2, -0.17 + i * 0.085);
    }

    const n = model.cards.length;
    const gap = Math.min(1.13, 8 / Math.max(n - 1, 1));
    model.cards.forEach((c, i) => {
      const v = (i - (n - 1) / 2) * gap;
      card(
        "choice:" + c.id,
        c.text,
        c.label,
        model.result ? "gold" : "white",
        v,
        c.order ? 0.87 : 0.50,
        1.14 - 0.025 * v * v,
        Math.min(gap * 0.94, 1.06),
        -0.99,
        -0.035 * v,
        c.order,
        model.canPick ? c.id : undefined,
      );
    });

    for (const [k, p] of pieces) if (!live.has(k)) { scene.remove(p.group); pieces.delete(k); }
    for (const [k, art] of covers) if (!used.has(k)) { art.texture.dispose(); art.mat.dispose(); covers.delete(k); }
    if (hovered && !hittable.some(h => h.userData.action === hovered)) hovered = undefined;
    initial = false;
    invalidate();
  }

  const ray = new T.Raycaster();
  function hit(event: MouseEvent) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new T.Vector2(((event.clientX - r.left) / r.width) * 2 - 1, 1 - ((event.clientY - r.top) / r.height) * 2), camera);
    return ray.intersectObjects(hittable, false)[0]?.object.userData.action as string | undefined;
  }
  function click(e: MouseEvent) { const id = hit(e); if (id) pick(id); }
  function pointer(e: PointerEvent) {
    const id = hittable.length && e.pointerType !== "touch" ? hit(e) : undefined;
    canvas.style.cursor = id ? "pointer" : "";
    if (id !== hovered) { hovered = id; invalidate(); }
  }
  function leave() { if (hovered) { hovered = undefined; canvas.style.cursor = ""; invalidate(); } }

  canvas.addEventListener("click", click);
  canvas.addEventListener("pointermove", pointer);
  canvas.addEventListener("pointerleave", leave);
  resize(true);

  return {
    update,
    setOverhead(value: boolean) { overhead = value; resize(false); },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("click", click);
      canvas.removeEventListener("pointermove", pointer);
      canvas.removeEventListener("pointerleave", leave);
      clearSeats();
      covers.forEach(c => { c.texture.dispose(); c.mat.dispose(); });
      geometries.forEach(g => g.dispose());
      materials.forEach(m => m.dispose());
      textures.forEach(t => t.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
