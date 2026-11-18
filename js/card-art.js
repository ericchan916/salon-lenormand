let THREE;
let cachedBack;
let cachedVelvet;
let cachedWood;

const deckRoot = './assets/deck/37731952f989/';
const artRoot = './assets/art/ea6a923413e0/';
const mobileArt = matchMedia('(max-width: 767px) and (pointer: coarse)').matches;

export function enableCardTextures(three) {
  THREE = three;
}

export function cardFaceUrl(card) {
  return `${deckRoot}face-${card.num}.webp`;
}

export async function loadDeckAtlas(loader) {
  const [faces, foils] = await Promise.all([
    loader.loadAsync(deckRoot + 'faces.webp'),
    loader.loadAsync(deckRoot + 'foils.png')
  ]);
  faces.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [faces, foils]) {
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
  }
  return { faces, foils };
}

const GOLD = {
  bright: '#fae4b8',
  rich: '#e0b775',
  antique: '#a87d42',
  ivory: '#fcf5ea'
};

function makeGoldGradient(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, GOLD.bright);
  g.addColorStop(0.35, GOLD.rich);
  g.addColorStop(0.68, '#f7d8a2');
  g.addColorStop(1, GOLD.antique);
  return g;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paintCardBack(backPlateImg) {
  if (!cachedBack) return;
  const { w, h, canvas, foilCanvas, map, metalnessMap } = cachedBack;
  const ctx = canvas.getContext('2d');
  const foilCtx = foilCanvas.getContext('2d');

  // 居中裁切满铺 AI 高定巴洛克牌背
  const srcAspect = backPlateImg.naturalWidth / backPlateImg.naturalHeight;
  const dstAspect = w / h;
  let sx = 0, sy = 0, sw = backPlateImg.naturalWidth, sh = backPlateImg.naturalHeight;
  if (srcAspect > dstAspect) {
    sw = sh * dstAspect;
    sx = (backPlateImg.naturalWidth - sw) * 0.5;
  } else {
    sh = sw / dstAspect;
    sy = (backPlateImg.naturalHeight - sh) * 0.5;
  }
  ctx.drawImage(backPlateImg, sx, sy, sw, sh, 0, 0, w, h);

  const goldGrad = makeGoldGradient(ctx, 0, 0, w, h);
  ctx.strokeStyle = goldGrad;
  ctx.lineWidth = 4;
  drawRoundedRect(ctx, 26, 26, w - 52, h - 52, 34);
  ctx.stroke();

  foilCtx.fillStyle = 'rgb(150, 180, 140)';
  foilCtx.fillRect(0, 0, w, h);
  foilCtx.strokeStyle = '#ffffff';
  foilCtx.lineWidth = 6;
  drawRoundedRect(foilCtx, 26, 26, w - 52, h - 52, 34);
  foilCtx.stroke();

  map.needsUpdate = true;
  metalnessMap.needsUpdate = true;
}

export function createCardBackTextures() {
  if (cachedBack) return cachedBack;

  const w = 576;
  const h = 864;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const foilCanvas = document.createElement('canvas');
  foilCanvas.width = w;
  foilCanvas.height = h;
  const foilCtx = foilCanvas.getContext('2d');

  const bg = ctx.createRadialGradient(w / 2, h / 2, 24, w / 2, h / 2, h * 0.62);
  bg.addColorStop(0, '#3a1636');
  bg.addColorStop(0.55, '#1d0b21');
  bg.addColorStop(1, '#0b040e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const goldGrad = makeGoldGradient(ctx, 0, 0, w, h);
  ctx.strokeStyle = goldGrad;
  ctx.lineWidth = 3.5;
  drawRoundedRect(ctx, 26, 26, w - 52, h - 52, 34);
  ctx.stroke();

  foilCtx.fillStyle = 'rgb(110, 200, 120)';
  foilCtx.fillRect(0, 0, w, h);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const metalnessMap = new THREE.CanvasTexture(foilCanvas);
  metalnessMap.anisotropy = 4;

  cachedBack = { w, h, canvas, foilCanvas, map, metalnessMap };
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => paintCardBack(image);
  image.src = artRoot + (mobileArt ? 'mobile/' : '') + 'card_back.webp';
  return cachedBack;
}

export function createVelvetTableTextures() {
  if (cachedVelvet) return cachedVelvet;

  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createRadialGradient(size * 0.5, size * 0.48, 30, size * 0.5, size * 0.5, size * 0.54);
  grad.addColorStop(0, '#2e152b');
  grad.addColorStop(0.58, '#1a0c1b');
  grad.addColorStop(1, '#0b040d');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  let s = 1843;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let i = 0; i < 16000; i++) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255, 220, 235, 0.022)' : 'rgba(5, 2, 8, 0.06)';
    ctx.fillRect(rand() * size, rand() * size, 2, 1);
  }

  const cx = size / 2;
  const cy = size / 2;
  ctx.strokeStyle = 'rgba(226, 188, 128, 0.30)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.43, 0, Math.PI * 2);
  ctx.arc(cx, cy, size * 0.30, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < 36; i++) {
    const a = (i * Math.PI * 2) / 36;
    const rIn = size * 0.412;
    const rOut = i % 3 === 0 ? size * 0.44 : size * 0.425;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
    ctx.lineTo(cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut);
    ctx.stroke();
  }

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 512;
  bumpCanvas.height = 512;
  const bCtx = bumpCanvas.getContext('2d');
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 16000; i++) {
    const v = Math.floor(106 + rand() * 46);
    bCtx.fillStyle = `rgb(${v},${v},${v})`;
    bCtx.fillRect(rand() * 512, rand() * 512, 2, 1);
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(4, 4);

  cachedVelvet = { map, bumpMap };
  return cachedVelvet;
}

export function createRosewoodTexture() {
  if (cachedWood) return cachedWood;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1b0f10';
  ctx.fillRect(0, 0, 512, 512);
  let s = 77;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let y = 0; y < 512; y += 2) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(58, 28, 24, 0.32)' : 'rgba(14, 6, 8, 0.35)';
    ctx.fillRect(0, y, 512, 1 + rand() * 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  cachedWood = tex;
  return tex;
}
