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
  const ink = kind === "black" ? "#ffffff" : kind === "gold" ? "#1e1002" : "#0b0714";
  const spot = kind === "gold" ? "#6e4000" : kind === "black" ? "#ff72ba" : "#a80d56";

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
    const bg = g.createRadialGradient(W * 0.5, H * 0.44, 60, W * 0.5, H * 0.5, H * 0.76);
    bg.addColorStop(0, promptBack ? "#2a2236" : "#c81967");
    bg.addColorStop(0.68, promptBack ? "#1a1524" : "#a61053");
    bg.addColorStop(1, promptBack ? "#100c17" : "#7b093c");
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
  edgeShade.addColorStop(1, kind === "white" ? "rgba(60,38,18,0.08)" : "rgba(0,0,0,0.2)");
  g.fillStyle = edgeShade;
  g.fillRect(0, 0, W, H);

  if (kind === "back") {
    g.save();
    rounded(g, 42, 42, W - 84, H - 84, 30);
    g.clip();
    g.strokeStyle = "rgba(255,232,242,0.13)";
    g.lineWidth = 3;
    const step = 44;
    for (let x = -H; x < W + H; x += step) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + H, H); g.stroke();
      g.beginPath(); g.moveTo(x + H, 0); g.lineTo(x, H); g.stroke();
    }
    g.fillStyle = "rgba(255,222,175,0.22)";
    for (let x = 66; x < W - 50; x += step) {
      for (let y = 66; y < H - 50; y += step) {
        g.beginPath();
        g.arc(x, y, 2.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();

    g.strokeStyle = "#fff1dc";
    g.lineWidth = 7;
    rounded(g, 36, 36, W - 72, H - 72, 32);
    g.stroke();

    g.strokeStyle = "rgba(255,214,142,0.85)";
    g.lineWidth = 2.5;
    rounded(g, 54, 54, W - 108, H - 108, 22);
    g.stroke();

    g.fillStyle = "#ffe3b0";
    for (const [cx, cy] of [[82, 82], [W - 82, 82], [82, H - 82], [W - 82, H - 82]]) {
      g.save();
      g.translate(cx, cy);
      g.rotate(Math.PI / 4);
      g.fillRect(-7, -7, 14, 14);
      g.restore();
    }

    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(-0.07);
    g.shadowColor = "rgba(42,3,20,0.65)";
    g.shadowOffsetY = 14;
    g.shadowBlur = 24;
    const stampGrad = g.createLinearGradient(-250, -145, 250, 145);
    stampGrad.addColorStop(0, "#fffbf2");
    stampGrad.addColorStop(1, "#f4e5cd");
    g.fillStyle = stampGrad;
    rounded(g, -248, -144, 496, 288, 36);
    g.fill();
    g.shadowColor = "transparent";

    g.strokeStyle = "#1a102f";
    g.lineWidth = 6;
    rounded(g, -230, -126, 460, 252, 24);
    g.stroke();

    g.strokeStyle = "rgba(200,20,106,0.35)";
    g.lineWidth = 2;
    rounded(g, -218, -114, 436, 228, 18);
    g.stroke();

    g.textAlign = "center";
    g.fillStyle = "#180f2c";
    g.font = `900 162px ${SANS}`;
    g.fillText("FDH", 0, 32);

    g.fillStyle = "#b81160";
    g.font = `800 32px ${MONO}`;
    g.fillText("COM  AMIGOS", 0, 96);
    g.restore();
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
