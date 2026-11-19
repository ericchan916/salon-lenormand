// Diana's Salon — 大师级 2D 裸眼 3D 卡牌弹簧动力学（直接驱动 GPU Transform 零级联重算）与星芒画布

import { cardFaceUrl } from './card-art.js';

export class AppleSpring {
  constructor(initial = 0, { damping = 1.0, response = 0.32 } = {}) {
    this.value = initial;
    this.target = initial;
    this.velocity = 0;
    this.setParams(damping, response);
  }

  setParams(damping, response) {
    const omega = (2 * Math.PI) / Math.max(response, 0.05);
    this.stiffness = omega * omega;
    this.dampingCoeff = 2 * damping * omega;
  }

  setTarget(nextTarget, extraVelocity = 0) {
    this.target = nextTarget;
    if (extraVelocity !== 0) this.velocity += extraVelocity;
  }

  step(dt) {
    // Substeps keep a stiff spring stable when the compositor misses frames.
    const elapsed = Math.min(dt, 0.075);
    const steps = Math.max(1, Math.ceil(elapsed * 120));
    const tick = elapsed / steps;
    for (let i = 0; i < steps; i++) {
      const displacement = this.value - this.target;
      this.velocity += (-this.stiffness * displacement - this.dampingCoeff * this.velocity) * tick;
      this.value += this.velocity * tick;
    }

    if (Math.abs(this.value - this.target) < 0.001 && Math.abs(this.velocity) < 0.004) {
      this.value = this.target;
      this.velocity = 0;
      return false;
    }
    return true;
  }
}

const activeHoloCards = new Set();
let holoRafId = null;
let lastHoloTime = performance.now();

function tickHoloCards(now) {
  const dt = (now - lastHoloTime) / 1000;
  lastHoloTime = now;

  for (const item of activeHoloCards) {
    if (!item.card.isConnected) {
      activeHoloCards.delete(item);
      continue;
    }
    const rx = item.rx.step(dt);
    const ry = item.ry.step(dt);
    const scale = item.scale.step(dt);
    item.face.style.transform = `perspective(680px) rotateX(${item.rx.value.toFixed(2)}deg) rotateY(${item.ry.value.toFixed(2)}deg) scale(${item.scale.value.toFixed(3)})`;
    if (!rx && !ry && !scale) activeHoloCards.delete(item);
  }
  holoRafId = activeHoloCards.size ? requestAnimationFrame(tickHoloCards) : null;
}

function attachHoloCard(card, face, maxTilt, detail) {
  const rx = new AppleSpring(0, { damping: 0.84, response: 0.34 });
  const ry = new AppleSpring(0, { damping: 0.84, response: 0.34 });
  const scale = new AppleSpring(1, { damping: 0.84, response: 0.25 });
  const item = { card, face, rx, ry, scale };
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const pause = () => reduced.matches || document.body.classList.contains('is-motion-paused');
  const wake = () => {
    activeHoloCards.add(item);
    if (holoRafId !== null) return;
    lastHoloTime = performance.now();
    holoRafId = requestAnimationFrame(tickHoloCards);
  };
  const reset = () => {
    rx.setTarget(0);
    ry.setTarget(0);
    scale.setTarget(1);
    wake();
  };

  if (detail) {
    let finger = null;
    const endTilt = () => {
      if (!finger) return;
      finger = null;
      card.classList.remove('is-tilting');
      reset();
    };
    card.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch' || pause()) return;
      if (!event.isPrimary) { endTilt(); return; }
      finger = { id: event.pointerId, x: event.clientX, y: event.clientY };
    });
    card.addEventListener('pointermove', event => {
      if (event.pointerId !== finger?.id) return;
      const dx = event.clientX - finger.x;
      const dy = event.clientY - finger.y;
      if (Math.abs(dx) < 6 || pause()) return;
      card.classList.add('is-tilting');
      ry.setTarget(Math.max(-1, Math.min(1, dx / 78)) * maxTilt);
      rx.setTarget(Math.max(-1, Math.min(1, -dy / 96)) * maxTilt * 0.5);
      face.style.setProperty('--foil-shift', `${Math.max(-38, Math.min(38, dx / 2))}%`);
      wake();
    });
    card.addEventListener('pointerup', endTilt);
    card.addEventListener('lostpointercapture', endTilt);
    card.addEventListener('pointercancel', endTilt);
  }

  card.addEventListener('pointermove', event => {
    if (!finePointer.matches || event.pointerType === 'touch' || pause()) return;
    const rect = card.getBoundingClientRect();
    rx.setTarget((0.5 - (event.clientY - rect.top) / rect.height) * maxTilt * 2);
    ry.setTarget(((event.clientX - rect.left) / rect.width - 0.5) * maxTilt * 2);
    scale.setTarget(1.025);
    wake();
  });
  card.addEventListener('pointerleave', reset);
  card.addEventListener('pointercancel', reset);
}

export function buildNakedEyeDioramaCard(card, { maxTilt = 12, detail = false } = {}) {
  const root = document.createElement('div');
  root.className = 'diorama-card holo-card-surface';
  root.dataset.dioramaCardId = String(card.id);

  const face = document.createElement('div');
  face.className = 'diorama-face';
  const label = document.createElement('span');
  label.className = 'diorama-name';
  label.textContent = `${card.num} · ${card.zh}`;
  const image = document.createElement('img');
  image.className = 'diorama-art-img';
  image.alt = `${card.num} ${card.zh}`;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.addEventListener('load', () => face.classList.add('has-art'), { once: true });
  image.src = cardFaceUrl(card);

  face.append(label, image);
  root.append(face);
  attachHoloCard(root, face, maxTilt, detail);
  return root;
}

export function attachGlassRimGlow(container = document) {
  container.addEventListener('pointermove', (e) => {
    const target = e.target.closest?.('.apple-choice-card, .apple-pill-choice');
    if (!target) return;
    const r = target.getBoundingClientRect();
    target.style.setProperty('--glow-x', `${(e.clientX - r.left).toFixed(0)}px`);
    target.style.setProperty('--glow-y', `${(e.clientY - r.top).toFixed(0)}px`);
  });
}

export class SparkleAtelier {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d') || null;
    this.sparks = [];
    this.paused = false;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.lastSpawn = 0;
    this.frame = null;

    if (this.canvas && this.ctx) {
      this.resize();
      window.addEventListener('resize', () => this.resize());
      window.addEventListener('pointermove', (e) => this.onMove(e), { passive: true });
      window.addEventListener('pointerdown', (e) => {
        if (!this.paused && !this.reduced && !e.target.closest?.('#touch-pick')) {
          this.burst(e.clientX, e.clientY, 9);
        }
      }, { passive: true });
    }
  }

  resize() {
    if (!this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    if (this.paused) {
      this.sparks.length = 0;
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      this.frame = null;
      this.ctx?.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  onMove(e) {
    if (this.paused || this.reduced || !this.ctx || e.pointerType === 'touch' ||
        document.querySelector('dialog[open]')) return;
    const now = performance.now();
    if (now - this.lastSpawn < 36) return;
    this.lastSpawn = now;
    this.spawnSpark(e.clientX, e.clientY, {
      vx: (Math.random() - 0.5) * 0.65,
      vy: -0.35 - Math.random() * 0.65,
      size: 3.2 + Math.random() * 4.5,
      life: 0.55 + Math.random() * 0.35
    });
  }

  burst(x, y, count = 14) {
    if (this.paused || this.reduced || !this.ctx) return;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.35;
      const speed = 1.1 + Math.random() * 2.8;
      this.spawnSpark(x, y, {
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 0.3,
        size: 4.5 + Math.random() * 6.0,
        life: 0.65 + Math.random() * 0.45
      });
    }
  }

  spawnSpark(x, y, { vx, vy, size, life }) {
    if (this.sparks.length > 110) this.sparks.shift();
    const palette = ['#fff7e2', '#f7d69c', '#f5c2d4', '#d8e4ff'];
    this.sparks.push({
      x,
      y,
      vx,
      vy,
      size,
      age: 0,
      life,
      rot: Math.random() * Math.PI,
      vRot: (Math.random() - 0.5) * 2.4,
      color: palette[Math.floor(Math.random() * palette.length)]
    });
    if (this.frame === null) {
      this.lastFrame = performance.now();
      this.frame = requestAnimationFrame(now => this.loop(now));
    }
  }

  drawFourStar(x, y, r, rot, color, alpha) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rad = i % 2 === 0 ? r : r * 0.22;
      const a = (i * Math.PI) / 4;
      if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
      else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  loop(now) {
    this.frame = null;
    this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    const step = dt * 60;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += dt;
      if (s.age >= s.life) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.x += s.vx * step;
      s.y += s.vy * step;
      s.vy += 0.025 * step;
      s.rot += s.vRot * dt;
      const p = s.age / s.life;
      const twinkle = 0.65 + 0.35 * Math.sin(s.age * 28);
      const alpha = Math.sin(p * Math.PI) * twinkle;
      this.drawFourStar(s.x, s.y, s.size * (1 - p * 0.35), s.rot, s.color, alpha);
    }
    if (this.sparks.length) this.frame = requestAnimationFrame(next => this.loop(next));
  }
}
