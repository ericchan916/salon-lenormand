// Browser-side rasterization for the static deck builder.

const SUIT_THEMES = {
  hearts: { bgInner: '#4a182c', bgMid: '#240b18', bgOuter: '#0e040a', enamel: '#5e1a2e' },
  diamonds: { bgInner: '#422316', bgMid: '#21100d', bgOuter: '#0e0608', enamel: '#542c18' },
  spades: { bgInner: '#182246', bgMid: '#0d1026', bgOuter: '#060712', enamel: '#1b244a' },
  clubs: { bgInner: '#15332d', bgMid: '#0b1a18', bgOuter: '#050b0c', enamel: '#183a32' }
};

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

function traceArchSubpath(ctx, w, h) {
  ctx.moveTo(52, h - 188);
  ctx.lineTo(52, 236);
  ctx.bezierCurveTo(52, 108, w * 0.5 - 42, 68, w * 0.5, 52);
  ctx.bezierCurveTo(w * 0.5 + 42, 68, w - 52, 108, w - 52, 236);
  ctx.lineTo(w - 52, h - 188);
  ctx.closePath();
}

function drawArchWindowPath(ctx, w, h) {
  ctx.beginPath();
  traceArchSubpath(ctx, w, h);
}

function drawSuitJewel(ctx, suit, cx, cy, size) {
  ctx.save();
  ctx.translate(cx, cy);
  const isRed = suit === 'hearts' || suit === 'diamonds';
  const grad = ctx.createLinearGradient(0, -size, 0, size);
  if (isRed) {
    grad.addColorStop(0, '#ff7f90');
    grad.addColorStop(0.5, '#c92a3e');
    grad.addColorStop(1, '#6e0f1c');
  } else {
    grad.addColorStop(0, '#fae2b4');
    grad.addColorStop(0.5, '#c99b56');
    grad.addColorStop(1, '#6e4d20');
  }
  ctx.fillStyle = grad;
  ctx.strokeStyle = GOLD.bright;
  ctx.lineWidth = 1.2;

  ctx.beginPath();
  if (suit === 'hearts') {
    const s = size * 0.56;
    ctx.moveTo(0, s * 0.9);
    ctx.bezierCurveTo(-s * 1.3, s * 0.1, -s * 1.2, -s * 0.95, 0, -s * 0.3);
    ctx.bezierCurveTo(s * 1.2, -s * 0.95, s * 1.3, s * 0.1, 0, s * 0.9);
  } else if (suit === 'diamonds') {
    const s = size * 0.65;
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s * 0.25, -s * 0.25, s * 0.85, 0);
    ctx.quadraticCurveTo(s * 0.25, s * 0.25, 0, s);
    ctx.quadraticCurveTo(-s * 0.25, s * 0.25, -s * 0.85, 0);
    ctx.quadraticCurveTo(-s * 0.25, s * 0.25, 0, -s);
  } else if (suit === 'spades') {
    const s = size * 0.56;
    ctx.moveTo(0, -s * 0.95);
    ctx.bezierCurveTo(s * 1.25, -s * 0.05, s * 1.05, s * 0.8, 0, s * 0.35);
    ctx.bezierCurveTo(-s * 1.05, s * 0.8, -s * 1.25, -s * 0.05, 0, -s * 0.95);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.18, s * 0.25);
    ctx.lineTo(s * 0.18, s * 0.25);
    ctx.lineTo(s * 0.36, s * 0.95);
    ctx.lineTo(-s * 0.36, s * 0.95);
  } else {
    const r = size * 0.28;
    ctx.arc(0, -r * 0.95, r, 0, Math.PI * 2);
    ctx.arc(-r * 0.94, r * 0.18, r, 0, Math.PI * 2);
    ctx.arc(r * 0.94, r * 0.18, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.26, r * 0.15);
    ctx.lineTo(r * 0.26, r * 0.15);
    ctx.lineTo(r * 0.52, r * 1.75);
    ctx.lineTo(-r * 0.52, r * 1.75);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// 当 AI 画板尚未落盘或加载中时的精致玑镂金纹垫底图
function drawAiQuadrantArt(ctx, img, quadIndex, destX, destY, destW, destH) {
  const col = quadIndex % 2;
  const row = Math.floor(quadIndex / 2);
  const halfW = img.naturalWidth * 0.5;
  const halfH = img.naturalHeight * 0.5;

  // 内缩 3.5% 安全边距以裁除任何网格分割暗线，保留最纯净饱满的中心油画
  const insetX = halfW * 0.035;
  const insetY = halfH * 0.035;
  let sx = col * halfW + insetX;
  let sy = row * halfH + insetY;
  let sw = halfW - insetX * 2;
  let sh = halfH - insetY * 2;

  const targetAspect = destW / destH;
  const srcAspect = sw / sh;
  if (srcAspect > targetAspect) {
    const newSw = sh * targetAspect;
    sx += (sw - newSw) * 0.5;
    sw = newSw;
  } else {
    const newSh = sw / targetAspect;
    sy += (sh - newSh) * 0.5;
    sh = newSh;
  }

  ctx.drawImage(img, sx, sy, sw, sh, destX, destY, destW, destH);
}

// 绘制悬浮顶层巴洛克金框、左上圆章、右上扑克徽章与底部法汉铭牌（同时输出透明前景层供 2D 裸眼3D景深盒使用！）
function paintFloatingFrameOverlay(frameCtx, maskCtx, card, w, h, theme) {
  const goldGrad = makeGoldGradient(frameCtx, 30, 30, w - 30, h - 30);

  // 1. 拱窗外围暗夜丝绒遮罩边衬 + 挖空中央哥特尖拱透明画窗（露出底层高定 AI 油画！）
  frameCtx.save();
  frameCtx.fillStyle = theme.bgOuter;
  frameCtx.fillRect(0, 0, w, h);
  frameCtx.globalCompositeOperation = 'destination-out';
  drawArchWindowPath(frameCtx, w, h);
  frameCtx.fill();
  frameCtx.globalCompositeOperation = 'source-over';

  // 画窗内沿一圈柔和深邃内阴影（强化裸眼 3D 暗盒纵深感）
  frameCtx.save();
  drawArchWindowPath(frameCtx, w, h);
  frameCtx.clip();
  frameCtx.strokeStyle = 'rgba(0, 0, 0, 0.72)';
  frameCtx.lineWidth = 18;
  drawArchWindowPath(frameCtx, w, h);
  frameCtx.stroke();
  frameCtx.restore();
  frameCtx.restore();

  // 在 maskCtx 的 G 通道仅标记拱窗外侧前景框区域（内部画窗保持 G=0 以触发裸眼 3D 视差！）
  maskCtx.save();
  maskCtx.fillStyle = 'rgb(160, 255, 0)';
  maskCtx.beginPath();
  maskCtx.rect(0, 0, w, h);
  traceArchSubpath(maskCtx, w, h);
  maskCtx.fill('evenodd');
  maskCtx.restore();

  // 2. 双层圆角巴洛克鎏金外框与穆夏尖拱金线
  frameCtx.strokeStyle = goldGrad;
  frameCtx.lineWidth = 3.6;
  drawRoundedRect(frameCtx, 26, 26, w - 52, h - 52, 34);
  frameCtx.stroke();

  frameCtx.strokeStyle = 'rgba(250, 228, 184, 0.52)';
  frameCtx.lineWidth = 1.4;
  drawRoundedRect(frameCtx, 38, 38, w - 76, h - 76, 26);
  frameCtx.stroke();

  frameCtx.strokeStyle = goldGrad;
  frameCtx.lineWidth = 3.4;
  drawArchWindowPath(frameCtx, w, h);
  frameCtx.stroke();

  // 3. 左上角皇家圆章牌号
  frameCtx.save();
  frameCtx.fillStyle = 'rgba(16, 8, 22, 0.92)';
  frameCtx.strokeStyle = goldGrad;
  frameCtx.lineWidth = 2.6;
  frameCtx.beginPath();
  frameCtx.arc(94, 106, 33, 0, Math.PI * 2);
  frameCtx.fill();
  frameCtx.stroke();

  frameCtx.fillStyle = GOLD.bright;
  frameCtx.font = '700 31px "Cormorant Garamond", Georgia, serif';
  frameCtx.textAlign = 'center';
  frameCtx.textBaseline = 'middle';
  frameCtx.fillText(card.num, 94, 107);
  frameCtx.restore();

  maskCtx.fillStyle = '#ffffcc';
  maskCtx.beginPath();
  maskCtx.arc(94, 106, 35, 0, Math.PI * 2);
  maskCtx.fill();

  // 4. 右上角小雷诺曼古典扑克象牙金章
  frameCtx.save();
  drawRoundedRect(frameCtx, w - 130, 66, 70, 86, 13);
  frameCtx.fillStyle = 'rgba(253, 246, 234, 0.96)';
  frameCtx.fill();
  frameCtx.strokeStyle = goldGrad;
  frameCtx.lineWidth = 2.6;
  frameCtx.stroke();

  const rankStr = card.pip.replace(/[♥♦♠♣]/g, '');
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  frameCtx.fillStyle = isRed ? '#a81e32' : '#1b1020';
  frameCtx.font = '700 25px "Cormorant Garamond", Georgia, serif';
  frameCtx.textAlign = 'center';
  frameCtx.fillText(rankStr, w - 95, 96);
  drawSuitJewel(frameCtx, card.suit, w - 95, 126, 23);
  frameCtx.restore();

  maskCtx.fillStyle = '#ffffcc';
  drawRoundedRect(maskCtx, w - 132, 64, 74, 90, 14);
  maskCtx.fill();

  // 5. 底部皇家珐琅鎏金铭牌框
  const plaqueX = 66;
  const plaqueY = h - 172;
  const plaqueW = w - 132;
  const plaqueH = 108;

  const plaqueGrad = frameCtx.createLinearGradient(plaqueX, plaqueY, plaqueX, plaqueY + plaqueH);
  plaqueGrad.addColorStop(0, theme.enamel);
  plaqueGrad.addColorStop(1, '#110614');
  drawRoundedRect(frameCtx, plaqueX, plaqueY, plaqueW, plaqueH, 20);
  frameCtx.fillStyle = plaqueGrad;
  frameCtx.fill();
  frameCtx.strokeStyle = goldGrad;
  frameCtx.lineWidth = 3.0;
  frameCtx.stroke();

  drawRoundedRect(frameCtx, plaqueX + 7, plaqueY + 7, plaqueW - 14, plaqueH - 14, 14);
  frameCtx.strokeStyle = 'rgba(250, 228, 184, 0.44)';
  frameCtx.lineWidth = 1.1;
  frameCtx.stroke();

  frameCtx.textAlign = 'center';
  frameCtx.fillStyle = GOLD.rich;
  frameCtx.font = 'italic 600 20px "Cormorant Garamond", Georgia, serif';
  frameCtx.fillText(card.fr.toUpperCase(), w / 2, plaqueY + 38);

  frameCtx.fillStyle = GOLD.ivory;
  frameCtx.font = '500 35px "Noto Serif SC", "Songti SC", serif';
  frameCtx.fillText(card.zh.split('').join(' '), w / 2, plaqueY + 80);

  maskCtx.fillStyle = '#ffffdd';
  drawRoundedRect(maskCtx, plaqueX - 2, plaqueY - 2, plaqueW + 4, plaqueH + 4, 21);
  maskCtx.fill();
}

function renderBundleIntoCanvases(bundle, card, plateImg) {
  const { w, h, fullCanvas, artCanvas, frameCanvas, depthCanvas } = bundle;
  const fullCtx = fullCanvas.getContext('2d');
  const artCtx = artCanvas.getContext('2d');
  const frameCtx = frameCanvas.getContext('2d');
  const depthCtx = depthCanvas.getContext('2d');

  const theme = SUIT_THEMES[card.suit] || SUIT_THEMES.hearts;

  artCtx.clearRect(0, 0, w, h);
  frameCtx.clearRect(0, 0, w, h);

  // 1. 绘制背景油画层（若对应 AI 2x2 画板已就绪则镶嵌高定油画，否则显示玑镂金纹垫底）
  const quadIdx = (card.id - 1) % 4;

  artCtx.fillStyle = theme.bgOuter;
  artCtx.fillRect(0, 0, w, h);
  drawAiQuadrantArt(artCtx, plateImg, quadIdx, 36, 42, w - 72, h - 208);

  // 轻微暖金暗角柔化融合边缘
  const vig = artCtx.createRadialGradient(w * 0.5, 390, 90, w * 0.5, 390, 360);
  vig.addColorStop(0, 'rgba(255, 236, 200, 0.04)');
  vig.addColorStop(0.75, 'rgba(18, 8, 22, 0.14)');
  vig.addColorStop(1, 'rgba(10, 4, 14, 0.62)');
  artCtx.fillStyle = vig;
  artCtx.fillRect(0, 0, w, h);
  // 2. 构建真实像素级裸眼 3D 视差深度与烫金蒙版（R=画作高光烫金强度, G=顶层外框遮罩, B=画作真实明度立体浮雕高度！）
  const artPixels = artCtx.getImageData(0, 0, w, h);
  const depthImg = depthCtx.createImageData(w, h);
  const src = artPixels.data;
  const dst = depthImg.data;
  const cx = w * 0.5;
  const cy = 388;

  for (let y = 0; y < h; y++) {
    const dy = (y - cy) / 340;
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = src[idx];
      const g = src[idx + 1];
      const b = src[idx + 2];

      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const warmGold = Math.max(0, (r * 0.6 + g * 0.4 - b * 0.65));
      const dx = (x - cx) / 240;
      const radialDome = Math.max(0, 1 - (dx * dx + dy * dy) * 0.72);

      // R 通道：画芯金色与高光折射强度
      dst[idx] = Math.min(255, Math.floor(42 + warmGold * 0.85 + (lum > 185 ? (lum - 185) * 1.4 : 0)));
      // G 通道：0 表示内凹画窗内部（稍后前景框会覆写为 255）
      dst[idx + 1] = 0;
      // B 通道：真实油画明度 + 中心球面共同决定的裸眼 3D 浮雕高度！
      dst[idx + 2] = Math.min(255, Math.floor(radialDome * 135 + (lum / 255) * 120));
      dst[idx + 3] = 255;
    }
  }
  depthCtx.putImageData(depthImg, 0, 0);
  // 3. 绘制悬浮前景巴洛克拱框与徽章
  paintFloatingFrameOverlay(frameCtx, depthCtx, card, w, h, theme);

  // 4. 合成完整平面贴图供 Three.js 单材质采样与分享截图使用
  fullCtx.clearRect(0, 0, w, h);
  fullCtx.drawImage(artCanvas, 0, 0);
  fullCtx.drawImage(frameCanvas, 0, 0);

}

export function bakeCardFace(card, plate) {
  const w = 576;
  const h = 864;
  const canvas = () => Object.assign(document.createElement('canvas'), { width: w, height: h });
  const bundle = { w, h, fullCanvas: canvas(), artCanvas: canvas(), frameCanvas: canvas(), depthCanvas: canvas() };
  renderBundleIntoCanvases(bundle, card, plate);
  bundle.artCanvas.width = bundle.frameCanvas.width = 0;
  return { face: bundle.fullCanvas, foil: bundle.depthCanvas };
}
