import { LENORMAND_CARDS, SPREAD_CONFIGS } from './cards-data.js';
import { buildNakedEyeDioramaCard } from './holo-sparkle.js';

export class FlatSalonScene {
  constructor(stage, sound, callbacks) {
    this.stage = stage;
    this.sound = sound;
    this.callbacks = callbacks;
    this.spreadId = 'line3';
    this.mode = 'onboarding';
    this.drawn = [];
    this.stage.hidden = false;
    this.arrangeOnboardingPair();
  }

  setMode(mode) {
    this.mode = mode;
    this.stage.dataset.mode = mode;
  }

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
  setMotionPaused() {}
  dismissInspectCard() { return false; }

  startShuffleRitual() {
    this.drawn = [];
    this.setMode('picking');
    this.deck = [...LENORMAND_CARDS];
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }

    this.revealed = document.createElement('div');
    this.revealed.className = 'flat-revealed';
    this.revealed.setAttribute('aria-label', '已翻开的牌');
    const fan = document.createElement('div');
    fan.className = 'flat-fan';
    this.deck.forEach((card, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'flat-back';
      button.setAttribute('aria-label', `翻开第 ${index + 1} 张牌`);
      button.addEventListener('click', () => {
        this.pick(card, button);
        if (this.mode === 'picking') fan.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
      });
      fan.append(button);
    });
    this.stage.replaceChildren(this.revealed, fan);
    this.callbacks.onPickingReady(0, SPREAD_CONFIGS[this.spreadId].count);
  }

  pick(card, button) {
    if (this.mode !== 'picking' || this.drawn.includes(card)) return;
    const spread = SPREAD_CONFIGS[this.spreadId];
    this.sound.playCardFlip(this.drawn.length);
    if (button) button.disabled = true;
    this.revealed.append(this.face(card, spread.positions[this.drawn.length].label));
    this.drawn.push(card);
    this.callbacks.onCardPicked(this.drawn.length, spread.count, card);
    if (this.drawn.length === spread.count) {
      this.setMode('reading');
      this.stage.replaceChildren(this.revealed);
      this.callbacks.onSpreadComplete(this.drawn);
    }
  }

  quickDrawRemaining() {
    const count = SPREAD_CONFIGS[this.spreadId].count - this.drawn.length;
    this.deck.filter(card => !this.drawn.includes(card)).slice(0, count).forEach(card => this.pick(card));
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
