import { CanvasTexture, SRGBColorSpace } from "three";

const W = 720, H = 1008, PAD = 56, CORNER = 34;
/** Cards follow the 5:7 ratio of real playing cards (63 × 88 mm). */
export const CARD_ASPECT = W / H;
const SANS = `"Helvetica Neue", Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, Consolas, monospace`;

function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** Deterministic fine linen paper fibres so the same card never shimmers between redraws. */
function paperGrain(g: CanvasRenderingContext2D, seed: number, light: boolean) {
  let s = seed || 1;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = light
      ? `rgba(105,78,50,${rand() * 0.04})`
      : `rgba(255,255,255,${rand() * 0.028})`;
    g.fillRect(rand() * W, rand() * H, 1.5 + rand() * 3, 1);
  }
  g.fillStyle = light ? "rgba(95,70,45,0.015)" : "rgba(255,255,255,0.014)";
  for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 1);
}

function hash(text: string) {
  let h = 7;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return (Math.abs(h) % 2147483646) + 1;
}

export type PrintKind = "black" | "white" | "back" | "promptBack" | "gold";

const DEFAULT_INKS = { ink: "#0b0714", spot: "#a80d56" } as const;
const PRINT_INKS: Record<PrintKind, { ink: string; spot: string }> = {
  white: DEFAULT_INKS,
  back: DEFAULT_INKS,
  promptBack: DEFAULT_INKS,
  black: { ink: "#ffffff", spot: "#ff72ba" },
  gold: { ink: "#1e1002", spot: "#6e4000" },
};

function fillSpacedText(g: CanvasRenderingContext2D, text: string, cx: number, y: number, spacing: number) {
  const chars = [...text];
  const widths = chars.map(ch => g.measureText(ch).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + spacing * Math.max(0, chars.length - 1);
  let x = cx - total / 2;
  g.textAlign = "left";
  for (let i = 0; i < chars.length; i++) {
    g.fillText(chars[i]!, x, y);
    x += widths[i]! + spacing;
  }
}

/** Desenha o rosto travesso (mesmas proporções do favicon.svg / CardFace "mischievous"). */
function drawMischievousFace(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  options: { stroke: string; badge?: string; blushAlpha?: number; hornFill?: string; strokeWidth?: number },
) {
  const scale = size / 32;
  g.save();
  g.translate(cx - size / 2, cy - size / 2);
  g.scale(scale, scale);
  g.lineCap = "round";
  g.lineJoin = "round";

  if (options.badge) {
    g.fillStyle = options.badge;
    rounded(g, 3.2, 6.2, 25.6, 23.6, 8);
    g.fill();
  }

  g.strokeStyle = options.stroke;
  g.lineWidth = options.strokeWidth ?? 2.6;

  for (const horn of [
    [[7.4, 9.2], [5.4, 3.2], [12.8, 7.2]],
    [[24.6, 9.2], [26.6, 3.2], [19.2, 7.2]],
  ] as const) {
    g.beginPath();
    g.moveTo(horn[0][0], horn[0][1]);
    g.lineTo(horn[1][0], horn[1][1]);
    g.lineTo(horn[2][0], horn[2][1]);
    if (options.hornFill) {
      g.closePath();
      g.fillStyle = options.hornFill;
      g.fill();
    }
    g.stroke();
  }

  g.beginPath();
  g.moveTo(9.4, 14.2);
  g.lineTo(13.4, 15.5);
  g.moveTo(22.6, 14.2);
  g.lineTo(18.6, 15.5);
  g.stroke();

  g.beginPath();
  g.moveTo(9.8, 21.2);
  g.quadraticCurveTo(16, 26.2, 22.4, 19.8);
  g.stroke();

  if (options.blushAlpha && options.blushAlpha > 0) {
    g.globalAlpha = options.blushAlpha;
    g.lineWidth = 2.1;
    g.beginPath();
    g.moveTo(7.4, 19.2);
    g.lineTo(9.6, 19.2);
    g.moveTo(22.4, 19.2);
    g.lineTo(24.6, 19.2);
    g.stroke();
  }

  g.restore();
}

function drawBackWordmark(g: CanvasRenderingContext2D, subtitleColor: string) {
  g.save();
  g.fillStyle = "#ffffff";
  g.font = `900 224px ${SANS}`;
  fillSpacedText(g, "FDH", W / 2, 534, 10);

  g.fillStyle = subtitleColor;
  g.font = `800 50px ${SANS}`;
  fillSpacedText(g, "COM AMIGOS", W / 2, 606, 3.5);
  g.restore();
}

function drawResponseBack(g: CanvasRenderingContext2D) {
  const frameInset = 36;
  g.save();
  rounded(g, frameInset, frameInset, W - frameInset * 2, H - frameInset * 2, 24);
  g.clip();

  const watermarkStyle = {
    badge: "rgba(88, 2, 40, 0.42)",
    stroke: "rgba(170, 12, 82, 0.56)",
    hornFill: "rgba(88, 2, 40, 0.42)",
    strokeWidth: 2.3,
  };
  for (const [cx, cy, size] of [
    [164, 112, 184],
    [W - 164, 112, 184],
    [152, 828, 192],
    [W / 2, 828, 192],
    [W - 152, 828, 192],
  ] as const) {
    drawMischievousFace(g, cx, cy, size, watermarkStyle);
  }
  g.restore();

  g.strokeStyle = "rgba(255, 198, 224, 0.78)";
  g.lineWidth = 6;
  rounded(g, frameInset, frameInset, W - frameInset * 2, H - frameInset * 2, 24);
  g.stroke();

  drawMischievousFace(g, W / 2, 224, 152, {
    badge: "#5e042d",
    stroke: "#ff98cc",
    blushAlpha: 0.45,
    strokeWidth: 2.7,
  });

  drawBackWordmark(g, "#ff99cb");
}

function drawPromptBack(g: CanvasRenderingContext2D) {
  const inset = 40;
  const hw = W / 2 - inset;
  const hh = H / 2 - inset;
  const notch = 50;
  const lineStroke = "rgba(176, 170, 188, 0.44)";
  const mutedDot = "rgba(176, 170, 188, 0.48)";
  const pinkAccent = "#f584bc";

  g.save();
  g.translate(W / 2, H / 2);

  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    g.save();
    g.scale(sx, sy);

    // Detalhe triangular arredondado rosa encaixado no canto côncavo.
    g.fillStyle = pinkAccent;
    g.beginPath();
    g.moveTo(-hw + 8, -hh + 2);
    g.lineTo(-hw + 33, -hh + 2);
    g.quadraticCurveTo(-hw + 37, -hh + 2, -hw + 33, -hh + 9);
    g.quadraticCurveTo(-hw + 22, -hh + 22, -hw + 9, -hh + 33);
    g.quadraticCurveTo(-hw + 2, -hh + 37, -hw + 2, -hh + 33);
    g.lineTo(-hw + 2, -hh + 8);
    g.quadraticCurveTo(-hw + 2, -hh + 2, -hw + 8, -hh + 2);
    g.closePath();
    g.fill();

    g.strokeStyle = lineStroke;
    g.lineWidth = 5;
    g.lineCap = "round";
    g.beginPath();
    g.arc(-hw, -hh, notch, 0, Math.PI / 2);
    g.stroke();

    for (let i = 0; i < 4; i++) {
      const offset = notch + 18 + i * 17;
      const isPink = i === 3;
      g.fillStyle = isPink ? pinkAccent : mutedDot;
      const radius = isPink ? 4.6 : 3.4;

      g.beginPath();
      g.arc(-hw + offset, -hh, radius, 0, Math.PI * 2);
      g.fill();

      g.beginPath();
      g.arc(-hw, -hh + offset, radius, 0, Math.PI * 2);
      g.fill();
    }

    const segmentStart = notch + 92;
    g.strokeStyle = lineStroke;
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(-hw + segmentStart, -hh);
    g.lineTo(-38, -hh);
    g.moveTo(-hw, -hh + segmentStart);
    g.lineTo(-hw, -50);
    g.stroke();

    g.restore();
  }

  g.fillStyle = pinkAccent;
  for (const [dx, dy, radius] of [
    [0, -hh, 6],
    [0, hh, 6],
    [-hw, 0, 6.8],
    [hw, 0, 6.8],
  ] as const) {
    g.beginPath();
    g.arc(dx, dy, radius, 0, Math.PI * 2);
    g.fill();
  }

  g.restore();

  drawMischievousFace(g, W / 2, 224, 146, {
    stroke: "#ff8ac3",
    blushAlpha: 0.42,
    strokeWidth: 2.8,
  });

  drawBackWordmark(g, "#f584bc");
}

/** High-resolution letterpress-style card art. Corners outside the die-cut stay transparent (alphaTest). */
export function cardPrint(text: string, label: string, kind: PrintKind, order = 0) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d")!;
  rounded(g, 0, 0, W, H, CORNER);
  g.clip();
  const promptBack = kind === "promptBack";
  if (promptBack) kind = "back";
  const dark = kind === "black" || kind === "back";
  const { ink, spot } = PRINT_INKS[kind];

  if (kind === "gold") {
    const foil = g.createLinearGradient(0, 0, W, H);
    foil.addColorStop(0, "#f5d376");
    foil.addColorStop(0.28, "#ffefc0");
    foil.addColorStop(0.5, "#e5ac34");
    foil.addColorStop(0.74, "#ffeaa6");
    foil.addColorStop(1, "#cc8f1d");
    g.fillStyle = foil;
    g.fillRect(0, 0, W, H);
    g.save();
    g.strokeStyle = "rgba(255,250,225,0.16)";
    g.lineWidth = 1.5;
    for (let i = -H; i < W + H; i += 10) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + H * 0.45, H);
      g.stroke();
    }
    g.restore();
  } else if (kind === "black") {
    const bg = g.createRadialGradient(W * 0.35, H * 0.28, 40, W * 0.5, H * 0.5, H * 0.78);
    bg.addColorStop(0, "#1f1a2b");
    bg.addColorStop(0.65, "#14101d");
    bg.addColorStop(1, "#0d0a13");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
  } else if (kind === "back") {
    const bg = g.createRadialGradient(W * 0.5, H * 0.44, 60, W * 0.5, H * 0.5, H * 0.78);
    bg.addColorStop(0, promptBack ? "#18171c" : "#a3064c");
    bg.addColorStop(0.68, promptBack ? "#121215" : "#8d0441");
    bg.addColorStop(1, promptBack ? "#0c0c0f" : "#6f0232");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
  } else {
    const bg = g.createRadialGradient(W * 0.42, H * 0.32, 60, W * 0.5, H * 0.5, H * 0.78);
    bg.addColorStop(0, "#fbf7ef");
    bg.addColorStop(0.7, "#f5eee2");
    bg.addColorStop(1, "#e8decb");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
  }

  paperGrain(g, hash(text + kind), !dark);

  const edgeShade = g.createRadialGradient(W / 2, H / 2, W * 0.36, W / 2, H / 2, H * 0.72);
  edgeShade.addColorStop(0, "rgba(0,0,0,0)");
  edgeShade.addColorStop(1, kind === "white" ? "rgba(60,38,18,0.08)" : "rgba(0,0,0,0.18)");
  g.fillStyle = edgeShade;
  g.fillRect(0, 0, W, H);

  if (kind === "back") {
    if (promptBack) drawPromptBack(g);
    else drawResponseBack(g);
  } else {
    const borderColor = order
      ? "#f0532c"
      : kind === "black"
        ? "rgba(255,255,255,0.22)"
        : kind === "gold"
          ? "#8b5a06"
          : "rgba(26,17,46,0.16)";
    g.strokeStyle = borderColor;
    g.lineWidth = order ? 22 : 4;
    const inset = order ? 22 : 28;
    rounded(g, inset, inset, W - inset * 2, H - inset * 2, order ? 36 : 30);
    g.stroke();

    if (kind === "gold") {
      g.strokeStyle = "rgba(139,90,6,0.45)";
      g.lineWidth = 2;
      rounded(g, 42, 42, W - 84, H - 84, 22);
      g.stroke();
      g.fillStyle = "#8b5a06";
      for (const [cx, cy] of [[W - 76, 86], [W - 108, 86]]) {
        g.beginPath();
        g.arc(cx, cy, 4, 0, Math.PI * 2);
        g.fill();
      }
    }

    g.fillStyle = spot;
    g.font = `900 34px ${MONO}`;
    g.fillText(label, PAD, 102, W - PAD * 2);

    g.fillStyle = spot;
    g.globalAlpha = kind === "black" ? 0.72 : 0.58;
    g.fillRect(PAD, 124, W - PAD * 2, 3.5);
    g.globalAlpha = 1;

    const max = W - PAD * 2;
    const maxHeight = 680;
    let size = kind === "black" ? 86 : 102;
    let lines: string[] = [];
    for (; size >= 26; size -= 3) {
      g.font = `900 ${size}px ${SANS}`;
      lines = [];
      for (const word of text.trim().split(/\s+/)) {
        const i = lines.length - 1;
        if (i < 0 || g.measureText(lines[i] + " " + word).width > max) lines.push(word);
        else lines[i] += " " + word;
      }
      if (lines.length * size * 1.15 <= maxHeight && lines.every(l => g.measureText(l).width <= max)) break;
    }

    g.fillStyle = ink;
    g.font = `900 ${size}px ${SANS}`;
    const lineStep = size * 1.15;
    const startY = 172 + size;
    lines.forEach((line, i) => {
      g.fillText(line, PAD, startY + i * lineStep, max);
    });

    g.save();
    g.translate(PAD, H - 94);
    g.fillStyle = kind === "black" ? "#ffffff" : "#180f2c";
    g.globalAlpha = 0.92;
    g.rotate(-0.18);
    rounded(g, 0, 0, 28, 38, 5);
    g.fill();
    g.rotate(0.18);
    g.fillStyle = spot;
    g.rotate(0.12);
    rounded(g, 18, -3, 28, 38, 5);
    g.fill();
    g.rotate(-0.12);
    g.globalAlpha = 1;
    g.fillStyle = kind === "black" ? "#fcfaff" : "#180f2c";
    g.font = `900 38px ${SANS}`;
    g.fillText("FDH", 62, 31);
    g.restore();

    if (kind === "gold") {
      g.save();
      g.textAlign = "right";
      g.fillStyle = "#7a4a00";
      g.font = `800 28px ${MONO}`;
      g.fillText("★ VENCEDORA", W - PAD, H - 64);
      g.restore();
    }

    if (order) {
      g.save();
      g.shadowColor = "rgba(0,0,0,0.35)";
      g.shadowBlur = 14;
      g.shadowOffsetY = 5;
      const bg = g.createLinearGradient(W - 155, H - 155, W - 55, H - 55);
      bg.addColorStop(0, "#ff7847");
      bg.addColorStop(1, "#e2431d");
      g.fillStyle = bg;
      g.beginPath();
      g.arc(W - 104, H - 104, 54, 0, Math.PI * 2);
      g.fill();
      g.shadowColor = "transparent";

      g.strokeStyle = "rgba(255,250,240,0.75)";
      g.lineWidth = 4;
      g.beginPath();
      g.arc(W - 104, H - 104, 46, 0, Math.PI * 2);
      g.stroke();

      g.fillStyle = "#fff9f0";
      g.textAlign = "center";
      g.font = `900 58px ${SANS}`;
      g.fillText(String(order), W - 104, H - 84);
      g.restore();
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
