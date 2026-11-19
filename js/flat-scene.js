import { LENORMAND_CARDS, SPREAD_CONFIGS } from './cards-data.js';
import { buildNakedEyeDioramaCard } from './holo-sparkle.js';

export class FlatSalonScene {
  constructor(stage, sound, callbacks) {
    this.stage = stage;
    this.sound = sound;
    this.callbacks = callbacks;
    this.spreadId = 'line3';
    this.drawn = [];
    this.timers = new Set();
    this.touch = matchMedia('(pointer: coarse)');
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.stage.hidden = false;
    this.arrangeOnboardingPair();
  }

  setMode(mode) {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.mode = mode;
    this.stage.dataset.mode = mode;
  }

  later(fn, delay) {
    const id = setTimeout(() => { this.timers.delete(id); fn(); }, delay);
    this.timers.add(id);
  }

  get animated() { return !this.motionPaused && !this.reduced.matches; }

  face(card, slot) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'flat-face';
    button.setAttribute('aria-label', `查看${slot ? slot + '的' : ''}${card.zh}牌义`);
    button.append(buildNakedEyeDioramaCard(card));
    button.addEventListener('click', () => this.callbacks.onCardDetail(card));
    return button;
  }

  arrangeOnboardingPair(rightId = 25) {
    this.setMode('onboarding');
    this.stage.replaceChildren(this.face(LENORMAND_CARDS[23]), this.face(LENORMAND_CARDS[rightId - 1]));
  }

  arrangeTopicStage(id = 24) {
    this.setMode('topic');
    this.stage.replaceChildren(this.face(LENORMAND_CARDS[id - 1]));
  }

  previewSpreadOnTable(spreadId) {
    this.spreadId = spreadId;
    this.setMode('preview');
    const cards = SPREAD_CONFIGS[spreadId].positions.map(() => {
      const back = document.createElement('span');
      back.className = 'flat-back';
      back.setAttribute('aria-hidden', 'true');
      return back;
    });
    this.stage.replaceChildren(...cards);
  }

  setSpread(id) { this.spreadId = id; }
  setMotionPaused(paused) { this.motionPaused = paused; }
  dismissInspectCard() { return false; }

  startShuffleRitual() {
    this.setMode('shuffling');
    this.drawn = [];
    this.selected = null;
    this.sound.playShuffleCascade();
    const deck = [...LENORMAND_CARDS];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    const spread = SPREAD_CONFIGS[this.spreadId];
    this.revealed = document.createElement('div');
    this.revealed.className = 'flat-revealed';
    this.revealed.dataset.spread = this.spreadId;
    this.revealed.setAttribute('aria-label', '已翻开的牌');
    for (const position of spread.positions) {
      const slot = document.createElement('span');
      slot.className = 'flat-slot';
      slot.setAttribute('aria-hidden', 'true');
      slot.textContent = position.label;
      this.revealed.append(slot);
    }
    const fan = document.createElement('div');
    fan.className = 'flat-fan';
    this.handOrder = deck.map((card, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'flat-back';
      button.dataset.card = card.id;
      button.setAttribute('aria-label', `翻开第 ${index + 1} 张牌`);
      button.style.setProperty('--delay', `${index * 5}ms`);
      button.addEventListener('click', () => {
        this.pick(button);
        if (this.mode === 'picking' && !this.touch.matches) this.selected?.focus({ preventScroll: true });
      });
      fan.append(button);
      return button;
    });
    this.remaining = this.handOrder.slice();
    this.layoutFan();
    fan.inert = true;
    this.stage.replaceChildren(this.revealed, fan);
    this.later(() => {
      this.setMode('picking');
      fan.inert = this.touch.matches;
      if (!this.touch.matches) this.selected = this.remaining[0];
      this.callbacks.onPickingReady(0, spread.count);
    }, this.animated && this.touch.matches ? 510 : 0);
  }

  layoutFan() {
    this.remaining.forEach((button, i) => {
      const t = i / Math.max(1, this.remaining.length - 1) * 2 - 1;
      button.style.setProperty('--fan-x', `${(t * 40).toFixed(2)}cqw`);
      button.style.setProperty('--fan-y', `${(t * t * 26).toFixed(2)}px`);
      button.style.setProperty('--fan-r', `${(t * 23).toFixed(2)}deg`);
    });
  }

  dealHand(choices) {
    choices.forEach(({rank, origin}, i) => {
      this.later(() => this.pick(this.handOrder[rank], origin), this.animated ? i * 135 : 0);
    });
  }

  pick(button, origin) {
    if (this.mode !== 'picking') return;
    const rank = this.remaining.indexOf(button);
    if (rank < 0) return;
    const card = LENORMAND_CARDS[Number(button.dataset.card) - 1];
    const spread = SPREAD_CONFIGS[this.spreadId];
    const index = this.drawn.length;
    const fly = this.touch.matches && this.animated;
    const from = fly && (origin || this.stage.querySelector('.flat-fan').getBoundingClientRect());
    const face = this.face(card, spread.positions[index].label);
    this.revealed.children[index].replaceWith(face);
    this.sound.playCardFlip(index);
    this.remaining.splice(rank, 1);
    button.disabled = true;
    this.selected = this.remaining[Math.min(rank, this.remaining.length - 1)];
    if (fly) {
      const to = face.getBoundingClientRect();
      const dx = from.x + from.width / 2 - to.x - to.width / 2;
      const dy = from.y + from.height / 2 - to.y - to.height / 2;
      face.classList.add('is-flipping');
      const flip = face.animate([
        { transform: `translate(${dx}px, ${dy}px) rotateY(180deg) scale(1.12)` },
        { transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 12}px) rotateY(90deg) scale(1.16)`, offset: 0.42 },
        { transform: 'none' }
      ], { duration: 445, easing: 'cubic-bezier(.22,.7,.24,1)' });
      flip.onfinish = flip.oncancel = () => face.classList.remove('is-flipping');
    }
    this.drawn.push(card);
    this.callbacks.onCardPicked(this.drawn.length, spread.count, card, this.handOrder.indexOf(button));
    if (this.drawn.length === spread.count) {
      this.setMode('settling');
      this.later(() => {
        this.setMode('reading');
        this.stage.replaceChildren(this.revealed);
        this.callbacks.onSpreadComplete(this.drawn);
      }, fly ? 450 : 0);
    }
  }

  quickDrawRemaining(origin) {
    if (this.mode !== 'picking') return;
    const needed = SPREAD_CONFIGS[this.spreadId].count - this.drawn.length;
    const choices = Array.from({length: needed}, (_, i) => this.remaining[Math.floor((i + 0.5) * this.remaining.length / needed)]);
    choices.forEach((button, i) => this.later(() => this.pick(button, origin), this.animated ? i * 150 : 0));
  }

  highlightPair(a, b) {
    if (this.mode !== 'reading') return;
    [...this.revealed.children].forEach((button, index) => button.classList.toggle('is-paired', index === a || index === b));
  }

  highlightSingleSlot(slot) {
    if (this.mode !== 'reading') return;
    [...this.revealed.children].forEach((button, index) => button.classList.toggle('is-highlighted', index === slot));
  }
}
