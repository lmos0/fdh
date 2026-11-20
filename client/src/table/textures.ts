import * as T from "three";

export interface TextureBundle {
  wood: { map: T.CanvasTexture; bump: T.CanvasTexture; rough: T.CanvasTexture };
  mahogany: { map: T.CanvasTexture; bump: T.CanvasTexture };
  tiles: { map: T.CanvasTexture; bump: T.CanvasTexture; rough: T.CanvasTexture };
  rug: { map: T.CanvasTexture; bump: T.CanvasTexture };
  towel: { map: T.CanvasTexture; bump: T.CanvasTexture };
  linen: { bump: T.CanvasTexture; rough: T.CanvasTexture };
  deckEdge: T.CanvasTexture;
  ceramicBlue: T.CanvasTexture;
  ceramicCream: T.CanvasTexture;
  coffee: T.CanvasTexture;
  pizza: { map: T.CanvasTexture; bump: T.CanvasTexture };
  crust: { map: T.CanvasTexture; bump: T.CanvasTexture };
  cork: { map: T.CanvasTexture; bump: T.CanvasTexture };
  fabricBump: T.CanvasTexture;
  foam: { map: T.CanvasTexture; bump: T.CanvasTexture };
  shadowBlob: T.CanvasTexture;
}

/** Deterministic PRNG so procedural surfaces never shimmer or change between visits. */
export function seeded(seed: number) {
  let s = seed || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export function createTextureBundle(anisotropy: number, track: (t: T.Texture) => T.Texture): TextureBundle {
  function make(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true, repeat?: [number, number]) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d")!);
    const t = new T.CanvasTexture(c);
    if (srgb) t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = anisotropy;
    if (repeat) {
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
    }
    track(t);
    return t;
  }

  // --- 1. Artisan Honey-Oak Tabletop Planks (Albedo + Bump + Roughness)
  const boardColors = ["#b87f4e", "#c28a58", "#b17748", "#be8655", "#c8915f", "#b67d4d"];
  const woodMeta = boardColors.map((color, i) => {
    const rand = seeded(41 + i * 19);
    const fibers = Array.from({ length: 48 }, () => ({
      v: rand(),
      phase: rand() * 12,
      amp: 0.8 + rand() * 2.6,
      freq: 55 + rand() * 90,
      alpha: 0.04 + rand() * 0.12,
      width: 0.5 + rand() * 1.5,
      dark: rand() > 0.25,
    }));
    const knot = rand() > 0.3 ? { x: 110 + rand() * 800, y: 0.28 + rand() * 0.44, rx: 14 + rand() * 14, ry: 5 + rand() * 4 } : null;
    const joint = 140 + rand() * 740;
    return { color, fibers, knot, joint };
  });

  const woodMap = make(1024, 512, g => {
    const bh = 512 / woodMeta.length;
    woodMeta.forEach((b, i) => {
      const y = i * bh;
      const grad = g.createLinearGradient(0, y, 1024, y + bh);
      grad.addColorStop(0, b.color);
      grad.addColorStop(0.5, b.color);
      grad.addColorStop(1, "#b98354");
      g.fillStyle = grad;
      g.fillRect(0, y, 1024, bh);

      // Subtle warm plank lighting gradient across width
      const plankShade = g.createLinearGradient(0, y, 0, y + bh);
      plankShade.addColorStop(0, "rgba(255,235,205,0.09)");
      plankShade.addColorStop(0.18, "rgba(255,255,255,0)");
      plankShade.addColorStop(0.84, "rgba(70,35,15,0.03)");
      plankShade.addColorStop(1, "rgba(55,28,12,0.12)");
      g.fillStyle = plankShade;
      g.fillRect(0, y, 1024, bh);

      // Multi-frequency wood grain fibers with deflection around knots
      for (const f of b.fibers) {
        const base = y + f.v * bh;
        g.strokeStyle = f.dark
          ? `rgba(92,48,22,${f.alpha})`
          : `rgba(255,226,186,${f.alpha * 0.7})`;
        g.lineWidth = f.width;
        g.beginPath();
        for (let x = 0; x <= 1024; x += 8) {
          let yy = base + Math.sin(x / f.freq + f.phase) * f.amp + Math.sin(x / 19 + f.phase * 1.9) * 0.55;
          if (b.knot) {
            const dx = (x - b.knot.x) / (b.knot.rx * 2.4);
            const ky = y + b.knot.y * bh;
            const dy = (yy - ky) / (b.knot.ry * 2.4);
            const dist2 = dx * dx + dy * dy;
            if (dist2 < 1.8) {
              const push = Math.exp(-dist2 * 1.8) * (yy >= ky ? 1 : -1) * b.knot.ry * 1.3;
              yy += push;
            }
          }
          if (x === 0) g.moveTo(x, yy);
          else g.lineTo(x, yy);
        }
        g.stroke();
      }

      // Fine wood pores
      const poreRand = seeded(300 + i * 37);
      for (let p = 0; p < 340; p++) {
        g.fillStyle = `rgba(74,38,16,${0.06 + poreRand() * 0.09})`;
        g.fillRect(poreRand() * 1024, y + poreRand() * bh, 4 + poreRand() * 14, 0.8);
      }

      // Natural wood knot
      if (b.knot) {
        const kx = b.knot.x, ky = y + b.knot.y * bh;
        for (let r = 5; r >= 1; r--) {
          g.strokeStyle = `rgba(82,42,18,${0.32 - r * 0.045})`;
          g.lineWidth = 1.4;
          g.beginPath();
          g.ellipse(kx, ky, b.knot.rx * (r / 4.2), b.knot.ry * (r / 4.2), 0.06, 0, Math.PI * 2);
          g.stroke();
        }
        const kg = g.createRadialGradient(kx, ky, 0.5, kx, ky, b.knot.rx * 0.45);
        kg.addColorStop(0, "rgba(56,28,14,0.85)");
        kg.addColorStop(1, "rgba(95,52,24,0.1)");
        g.fillStyle = kg;
        g.beginPath();
        g.ellipse(kx, ky, b.knot.rx * 0.45, b.knot.ry * 0.45, 0.06, 0, Math.PI * 2);
        g.fill();
      }

      // Chamfered plank seams & end-joint
      g.fillStyle = "rgba(58,32,16,0.68)";
      g.fillRect(b.joint, y, 2, bh);
      g.fillStyle = "rgba(255,232,200,0.16)";
      g.fillRect(b.joint + 2, y, 1.5, bh);

      g.fillStyle = "rgba(56,30,14,0.75)";
      g.fillRect(0, y, 1024, 2.2);
      g.fillStyle = "rgba(255,235,205,0.22)";
      g.fillRect(0, y + 2.2, 1024, 1.6);
    });
  }, true);

  const woodBump = make(1024, 512, g => {
    const bh = 512 / woodMeta.length;
    g.fillStyle = "#b8b8b8";
    g.fillRect(0, 0, 1024, 512);
    woodMeta.forEach((b, i) => {
      const y = i * bh;
      for (const f of b.fibers) {
        const base = y + f.v * bh;
        g.strokeStyle = f.dark ? `rgba(70,70,70,${f.alpha * 1.4})` : `rgba(235,235,235,${f.alpha})`;
        g.lineWidth = f.width;
        g.beginPath();
        for (let x = 0; x <= 1024; x += 12) {
          const yy = base + Math.sin(x / f.freq + f.phase) * f.amp;
          if (x === 0) g.moveTo(x, yy);
          else g.lineTo(x, yy);
        }
        g.stroke();
      }
      const poreRand = seeded(300 + i * 37);
      for (let p = 0; p < 340; p++) {
        g.fillStyle = `rgba(40,40,40,${0.18 + poreRand() * 0.2})`;
        g.fillRect(poreRand() * 1024, y + poreRand() * bh, 4 + poreRand() * 14, 1);
      }
      // Deep plank seams
      g.fillStyle = "#181818";
      g.fillRect(0, y, 1024, 2.6);
      g.fillRect(b.joint, y, 2.2, bh);
    });
  }, false);

  const woodRough = make(1024, 512, g => {
    const bh = 512 / woodMeta.length;
    // Base satin varnish roughness (~0.38 -> rgb ~97)
    g.fillStyle = "rgb(98,98,98)";
    g.fillRect(0, 0, 1024, 512);
    woodMeta.forEach((b, i) => {
      const y = i * bh;
      // Subtle board-to-board sheen variance
      const shade = 92 + (i % 3) * 10;
      g.fillStyle = `rgb(${shade},${shade},${shade})`;
      g.fillRect(0, y, 1024, bh);
      for (const f of b.fibers) {
        const base = y + f.v * bh;
        g.strokeStyle = f.dark ? `rgba(170,170,170,${f.alpha * 1.2})` : `rgba(70,70,70,${f.alpha * 0.9})`;
        g.lineWidth = f.width;
        g.beginPath();
        for (let x = 0; x <= 1024; x += 16) {
          const yy = base + Math.sin(x / f.freq + f.phase) * f.amp;
          if (x === 0) g.moveTo(x, yy);
          else g.lineTo(x, yy);
        }
        g.stroke();
      }
      // Matte grooves
      g.fillStyle = "rgb(230,230,230)";
      g.fillRect(0, y, 1024, 3);
      g.fillRect(b.joint, y, 2.5, bh);
    });
  }, false);

  // --- 2. Rich Mahogany / Walnut Wood (Chairs, Apron, Gavel)
  const mahoganyMap = make(512, 256, g => {
    const rand = seeded(91);
    const grad = g.createLinearGradient(0, 0, 512, 256);
    grad.addColorStop(0, "#6c3f26");
    grad.addColorStop(0.5, "#7d4a2d");
    grad.addColorStop(1, "#5e341e");
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 256);
    for (let k = 0; k < 70; k++) {
      const v = rand() * 256, phase = rand() * 8, amp = 1 + rand() * 2;
      g.strokeStyle = rand() > 0.3 ? `rgba(38,16,8,${0.08 + rand() * 0.16})` : `rgba(195,128,82,${0.06 + rand() * 0.08})`;
      g.lineWidth = 0.7 + rand() * 1.5;
      g.beginPath();
      for (let x = 0; x <= 512; x += 12) {
        const yy = v + Math.sin(x / 75 + phase) * amp;
        if (x === 0) g.moveTo(x, yy);
        else g.lineTo(x, yy);
      }
      g.stroke();
    }
  }, true, [1, 1]);

  const mahoganyBump = make(512, 256, g => {
    const rand = seeded(91);
    g.fillStyle = "#909090";
    g.fillRect(0, 0, 512, 256);
    for (let k = 0; k < 70; k++) {
      const v = rand() * 256, phase = rand() * 8, amp = 1 + rand() * 2;
      g.strokeStyle = rand() > 0.3 ? "rgba(45,45,45,0.22)" : "rgba(180,180,180,0.16)";
      g.lineWidth = 0.8 + rand() * 1.4;
      g.beginPath();
      for (let x = 0; x <= 512; x += 12) {
        const yy = v + Math.sin(x / 75 + phase) * amp;
        if (x === 0) g.moveTo(x, yy);
        else g.lineTo(x, yy);
      }
      g.stroke();
    }
  }, false, [1, 1]);

  // --- 3. Glazed Ceramic Kitchen Floor Tiles (Albedo + Bump + Roughness)
  const tilesMap = make(512, 512, g => {
    const rand = seeded(11);
    g.fillStyle = "#8f7b6d";
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const x = i * 128 + 3, y = j * 128 + 3, s = 122;
        const warm = (i + j) % 2 === 1;
        const base = warm ? "#bc8f7d" : "#e3d4c2";
        g.fillStyle = base;
        g.beginPath();
        g.roundRect(x, y, s, s, 4);
        g.fill();

        // Subtle handmade ceramic glaze variation per tile
        const tg = g.createLinearGradient(x, y, x + s, y + s);
        tg.addColorStop(0, `rgba(255,248,236,${0.04 + rand() * 0.08})`);
        tg.addColorStop(1, `rgba(70,38,24,${0.03 + rand() * 0.08})`);
        g.fillStyle = tg;
        g.beginPath();
        g.roundRect(x, y, s, s, 4);
        g.fill();

        // Fine ceramic mineral speckles
        for (let m = 0; m < 28; m++) {
          g.fillStyle = rand() > 0.5 ? "rgba(90,55,40,0.06)" : "rgba(255,250,242,0.08)";
          g.fillRect(x + rand() * s, y + rand() * s, 1.5 + rand() * 2, 1.5 + rand() * 2);
        }
      }
    }
  }, true, [16, 16]);

  const tilesBump = make(512, 512, g => {
    g.fillStyle = "#222222";
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const x = i * 128 + 4, y = j * 128 + 4, s = 120;
        const tg = g.createRadialGradient(x + s / 2, y + s / 2, 10, x + s / 2, y + s / 2, s * 0.72);
        tg.addColorStop(0, "#dedede");
        tg.addColorStop(0.86, "#cccccc");
        tg.addColorStop(1, "#707070");
        g.fillStyle = tg;
        g.beginPath();
        g.roundRect(x, y, s, s, 5);
        g.fill();
      }
    }
  }, false, [16, 16]);

  const tilesRough = make(512, 512, g => {
    const rand = seeded(19);
    // Matte grout (~0.92)
    g.fillStyle = "rgb(235,235,235)";
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const x = i * 128 + 3, y = j * 128 + 3, s = 122;
        const r = Math.round(78 + rand() * 26); // Glazed tile ~0.30 - 0.41
        g.fillStyle = `rgb(${r},${r},${r})`;
        g.beginPath();
        g.roundRect(x, y, s, s, 4);
        g.fill();
      }
    }
  }, false, [16, 16]);

  // --- 4. Woven Kilim Rug (Albedo + Bump)
  const rugMap = make(512, 320, g => {
    g.fillStyle = "#214b4f";
    g.fillRect(0, 0, 512, 320);

    // Subtle tonal depth gradient across the wool field
    const rg = g.createRadialGradient(256, 160, 40, 256, 160, 290);
    rg.addColorStop(0, "rgba(255,240,210,0.06)");
    rg.addColorStop(1, "rgba(10,20,24,0.22)");
    g.fillStyle = rg;
    g.fillRect(0, 0, 512, 320);

    const bands: [number, string, number][] = [
      [10, "#ebd9b7", 6],
      [22, "#cf922c", 6],
      [34, "#ebd9b7", 4],
      [50, "#8f2f41", 8],
      [62, "#ebd9b7", 4],
    ];
    for (const [inset, color, lw] of bands) {
      g.strokeStyle = color;
      g.lineWidth = lw;
      g.strokeRect(inset, inset, 512 - inset * 2, 320 - inset * 2);
    }

    // Woven kilim diamond medallions
    for (let x = 92; x < 428; x += 42) {
      for (let y = 94; y < 236; y += 44) {
        g.save();
        g.translate(x + 14, y + 14);
        g.rotate(Math.PI / 4);
        g.fillStyle = "rgba(239,224,196,0.34)";
        g.fillRect(-7, -7, 14, 14);
        g.fillStyle = "rgba(207,146,44,0.38)";
        g.fillRect(-3.5, -3.5, 7, 7);
        g.restore();
      }
    }

    // Woven yarn horizontal ribs & slub noise
    for (let y = 0; y < 320; y += 3) {
      g.fillStyle = y % 6 === 0 ? "rgba(255,250,235,0.06)" : "rgba(0,0,0,0.08)";
      g.fillRect(0, y, 512, 1.4);
    }
    const rand = seeded(5);
    for (let i = 0; i < 4200; i++) {
      g.fillStyle = rand() > 0.5 ? "rgba(255,248,232,0.07)" : "rgba(0,0,0,0.09)";
      g.fillRect(rand() * 512, rand() * 320, 2 + rand() * 4, 1.2);
    }
  }, true);

  const rugBump = make(512, 320, g => {
    g.fillStyle = "#808080";
    g.fillRect(0, 0, 512, 320);
    for (let y = 0; y < 320; y += 3) {
      g.fillStyle = y % 6 === 0 ? "#bcbcbc" : "#4a4a4a";
      g.fillRect(0, y, 512, 1.5);
    }
    for (let x = 0; x < 512; x += 6) {
      g.fillStyle = x % 12 === 0 ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)";
      g.fillRect(x, 0, 2, 320);
    }
  }, false);

  // --- 5. Woven Linen Gingham Kitchen Towel (Albedo + Bump)
  const towelMap = make(256, 256, g => {
    g.fillStyle = "#faf0dc";
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "rgba(196,64,68,0.52)";
    g.fillRect(0, 0, 128, 256);
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = "rgba(168,38,44,0.34)";
    g.fillRect(0, 0, 128, 128);
    // Fine woven linen threads
    for (let i = 0; i < 256; i += 4) {
      g.fillStyle = i % 8 === 0 ? "rgba(255,250,240,0.22)" : "rgba(90,30,30,0.08)";
      g.fillRect(0, i, 256, 1.2);
      g.fillRect(i, 0, 1.2, 256);
    }
  }, true, [4, 3]);

  const towelBump = make(256, 256, g => {
    g.fillStyle = "#808080";
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 4) {
      for (let x = 0; x < 256; x += 4) {
        const up = ((x + y) / 4) % 2 === 0;
        g.fillStyle = up ? "#c0c0c0" : "#505050";
        g.fillRect(x, y, 2, 4);
        g.fillStyle = up ? "#585858" : "#b8b8b8";
        g.fillRect(x + 2, y, 2, 4);
      }
    }
  }, false, [4, 3]);

  // --- 6. Playing-Card Air-Cushion Linen Micro-Texture (Bump + Roughness)
  const linenBump = make(256, 256, g => {
    g.fillStyle = "#808080";
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 4) {
      for (let x = 0; x < 256; x += 4) {
        const odd = ((x + y) >> 2) & 1;
        g.fillStyle = odd ? "#a8a8a8" : "#646464";
        g.fillRect(x, y, 3, 2);
        g.fillStyle = odd ? "#6c6c6c" : "#9c9c9c";
        g.fillRect(x, y + 2, 2, 2);
      }
    }
  }, false, [5, 6.25]);

  const linenRough = make(256, 256, g => {
    g.fillStyle = "rgb(220,220,220)";
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 4) {
      for (let x = 0; x < 256; x += 4) {
        const odd = ((x + y) >> 2) & 1;
        g.fillStyle = odd ? "rgb(204,204,204)" : "rgb(238,238,238)";
        g.fillRect(x, y, 2, 2);
      }
    }
  }, false, [5, 6.25]);

  // --- 7. Striated Card Deck Side Texture (shows crisp stacked ivory cardstock sheets)
  const deckEdge = make(64, 256, g => {
    const rand = seeded(77);
    g.fillStyle = "#f4ece0";
    g.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 256; y += 5) {
      const shade = 232 + Math.floor(rand() * 20);
      g.fillStyle = `rgb(${shade},${shade - 6},${shade - 16})`;
      g.fillRect(0, y, 64, 3.8);
      g.fillStyle = `rgba(112,86,62,${0.22 + rand() * 0.18})`;
      g.fillRect(0, y + 3.8, 64, 1.2);
    }
  }, true);

  // --- 8. Artisan Speckled Ceramic Glazes (Mug & Plate)
  const ceramicBlue = make(256, 256, g => {
    const rand = seeded(31);
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#7b5e47"); // warm toasted stoneware rim
    grad.addColorStop(0.06, "#468298");
    grad.addColorStop(0.55, "#3b758c");
    grad.addColorStop(1, "#2f5f73");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 420; i++) {
      g.fillStyle = rand() > 0.35 ? `rgba(28,46,56,${0.08 + rand() * 0.16})` : `rgba(220,238,242,${0.08 + rand() * 0.12})`;
      const r = 0.7 + rand() * 1.6;
      g.beginPath();
      g.arc(rand() * 256, rand() * 256, r, 0, Math.PI * 2);
      g.fill();
    }
  }, true);

  const ceramicCream = make(256, 256, g => {
    const rand = seeded(37);
    g.fillStyle = "#f7efe4";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 360; i++) {
      g.fillStyle = `rgba(128,96,72,${0.06 + rand() * 0.13})`;
      g.beginPath();
      g.arc(rand() * 256, rand() * 256, 0.6 + rand() * 1.3, 0, Math.PI * 2);
      g.fill();
    }
  }, true);

  // --- 9. Espresso Coffee with Golden Crema Ring
  const coffee = make(256, 256, g => {
    const rand = seeded(53);
    const rad = g.createRadialGradient(128, 128, 14, 128, 128, 128);
    rad.addColorStop(0, "#1d0e08");
    rad.addColorStop(0.56, "#2c150b");
    rad.addColorStop(0.78, "#6f3c1e");
    rad.addColorStop(0.92, "#b57a42");
    rad.addColorStop(1, "#cfa068");
    g.fillStyle = rad;
    g.fillRect(0, 0, 256, 256);
    // Tiny crema micro-bubbles near rim
    for (let i = 0; i < 180; i++) {
      const a = rand() * Math.PI * 2;
      const d = 82 + rand() * 42;
      g.fillStyle = `rgba(240,204,152,${0.12 + rand() * 0.25})`;
      g.beginPath();
      g.arc(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 0.8 + rand() * 2.2, 0, Math.PI * 2);
      g.fill();
    }
  }, true);

  // --- 10. Artisan Wood-Fired Pizza Cheese & Crust
  const pizzaMap = make(512, 512, g => {
    const rand = seeded(61);
    // Rich tomato sauce base along borders
    g.fillStyle = "#b53322";
    g.fillRect(0, 0, 512, 512);
    // Melted golden mozzarella blanket
    const cg = g.createRadialGradient(256, 256, 30, 256, 256, 310);
    cg.addColorStop(0, "#ffd778");
    cg.addColorStop(0.7, "#f4b94c");
    cg.addColorStop(1, "#d9892e");
    g.fillStyle = cg;
    g.fillRect(14, 14, 484, 484);

    // Melted cheese pools & golden toasted blister spots
    for (let i = 0; i < 240; i++) {
      const x = rand() * 512, y = rand() * 512, r = 6 + rand() * 24;
      const pick = rand();
      g.fillStyle = pick < 0.45
        ? `rgba(255,236,178,${0.18 + rand() * 0.22})`
        : pick < 0.78
          ? `rgba(218,128,36,${0.16 + rand() * 0.22})`
          : `rgba(148,54,18,${0.18 + rand() * 0.24})`;
      g.beginPath();
      g.ellipse(x, y, r, r * (0.6 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    // Red tomato sauce peeks
    for (let i = 0; i < 18; i++) {
      const x = 40 + rand() * 432, y = 40 + rand() * 432, r = 8 + rand() * 14;
      g.fillStyle = "rgba(182,42,24,0.45)";
      g.beginPath();
      g.ellipse(x, y, r, r * 0.7, rand() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    // Fine oregano flecks
    for (let i = 0; i < 160; i++) {
      g.fillStyle = "rgba(48,74,30,0.55)";
      g.fillRect(rand() * 512, rand() * 512, 2 + rand() * 2.5, 1.5);
    }
  }, true);

  const pizzaBump = make(512, 512, g => {
    const rand = seeded(61);
    g.fillStyle = "#808080";
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 240; i++) {
      const x = rand() * 512, y = rand() * 512, r = 6 + rand() * 24;
      g.fillStyle = rand() > 0.45 ? "rgba(210,210,210,0.28)" : "rgba(45,45,45,0.28)";
      g.beginPath();
      g.ellipse(x, y, r, r * 0.8, rand() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }, false);

  const crustMap = make(256, 256, g => {
    const rand = seeded(67);
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#d49452");
    grad.addColorStop(0.5, "#bd7838");
    grad.addColorStop(1, "#9a5926");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    // Leopard-spotted wood-fired char blisters & flour dusting
    for (let i = 0; i < 180; i++) {
      const pick = rand();
      g.fillStyle = pick < 0.25
        ? `rgba(54,24,10,${0.25 + rand() * 0.35})`
        : pick < 0.75
          ? `rgba(138,76,28,${0.18 + rand() * 0.22})`
          : `rgba(248,224,185,${0.14 + rand() * 0.16})`;
      g.beginPath();
      g.ellipse(rand() * 256, rand() * 256, 3 + rand() * 12, 2 + rand() * 8, rand() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }, true);

  const crustBump = make(256, 256, g => {
    const rand = seeded(67);
    g.fillStyle = "#808080";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 200; i++) {
      g.fillStyle = rand() > 0.5 ? "rgba(220,220,220,0.3)" : "rgba(40,40,40,0.3)";
      g.beginPath();
      g.arc(rand() * 256, rand() * 256, 2 + rand() * 8, 0, Math.PI * 2);
      g.fill();
    }
  }, false);

  // --- 11. Pressed Cork Coaster
  const corkMap = make(256, 256, g => {
    const rand = seeded(83);
    g.fillStyle = "#b58657";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 700; i++) {
      g.fillStyle = rand() > 0.5 ? `rgba(82,52,26,${0.12 + rand() * 0.22})` : `rgba(225,186,136,${0.14 + rand() * 0.2})`;
      g.fillRect(rand() * 256, rand() * 256, 2 + rand() * 7, 1.5 + rand() * 4);
    }
  }, true);

  const corkBump = make(256, 256, g => {
    const rand = seeded(83);
    g.fillStyle = "#808080";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 700; i++) {
      g.fillStyle = rand() > 0.5 ? "rgba(40,40,40,0.3)" : "rgba(210,210,210,0.3)";
      g.fillRect(rand() * 256, rand() * 256, 2 + rand() * 7, 2 + rand() * 4);
    }
  }, false);

  // --- 12. Chair Cushion Linen Weave Bump
  const fabricBump = make(128, 128, g => {
    const rand = seeded(101);
    g.fillStyle = "#808080";
    g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 3) {
      g.fillStyle = y % 6 === 0 ? "#a5a5a5" : "#626262";
      g.fillRect(0, y, 128, 1.5);
    }
    for (let x = 0; x < 128; x += 3) {
      g.fillStyle = x % 6 === 0 ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.22)";
      g.fillRect(x, 0, 1.5, 128);
    }
    for (let i = 0; i < 200; i++) {
      g.fillStyle = rand() > 0.5 ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)";
      g.fillRect(rand() * 128, rand() * 128, 4, 1);
    }
  }, false, [3, 3]);

  // --- 13. Beer / Soda Creamy Foam
  const foamMap = make(256, 256, g => {
    const rand = seeded(109);
    const rad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    rad.addColorStop(0, "#fffbf0");
    rad.addColorStop(0.75, "#f7ebd2");
    rad.addColorStop(1, "#e7cea2");
    g.fillStyle = rad;
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = rand() > 0.4 ? "rgba(255,255,255,0.55)" : "rgba(205,172,120,0.24)";
      g.beginPath();
      g.arc(rand() * 256, rand() * 256, 1.5 + rand() * 5.5, 0, Math.PI * 2);
      g.fill();
    }
  }, true);

  const foamBump = make(256, 256, g => {
    const rand = seeded(109);
    g.fillStyle = "#808080";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = rand() > 0.4 ? "rgba(235,235,235,0.35)" : "rgba(50,50,50,0.3)";
      g.beginPath();
      g.arc(rand() * 256, rand() * 256, 1.5 + rand() * 5.5, 0, Math.PI * 2);
      g.fill();
    }
  }, false);

  // --- 14. Soft Radial Contact Shadow Blob
  const shadowBlob = make(128, 128, g => {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(18,10,6,0.72)");
    grad.addColorStop(0.45, "rgba(18,10,6,0.38)");
    grad.addColorStop(0.78, "rgba(18,10,6,0.10)");
    grad.addColorStop(1, "rgba(18,10,6,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }, false);

  return {
    wood: { map: woodMap, bump: woodBump, rough: woodRough },
    mahogany: { map: mahoganyMap, bump: mahoganyBump },
    tiles: { map: tilesMap, bump: tilesBump, rough: tilesRough },
    rug: { map: rugMap, bump: rugBump },
    towel: { map: towelMap, bump: towelBump },
    linen: { bump: linenBump, rough: linenRough },
    deckEdge,
    ceramicBlue,
    ceramicCream,
    coffee,
    pizza: { map: pizzaMap, bump: pizzaBump },
    crust: { map: crustMap, bump: crustBump },
    cork: { map: corkMap, bump: corkBump },
    fabricBump,
    foam: { map: foamMap, bump: foamBump },
    shadowBlob,
  };
}
