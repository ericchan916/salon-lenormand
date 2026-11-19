// Positions are fixed for the round, including after a card leaves the hand.
const GROUP_SIZE = 6;
export class TouchHand {
  constructor(root, deal, onSelection) {
    this.root = root;
    this.cards = root.querySelector('.hand-cards');
    this.prev = root.querySelector('#pick-prev');
    this.next = root.querySelector('#pick-next');
    this.confirm = root.querySelector('#pick-confirm');
    this.pageLabel = root.querySelector('#pick-page');
    this.hint = root.querySelector('.pick-hint');
    this.deal = deal;
    this.onSelection = onSelection;
    this.prev.addEventListener('click', () => this.turn(-1));
    this.next.addEventListener('click', () => this.turn(1));
    this.confirm.addEventListener('click', () => this.submit());

    this.cards.addEventListener('pointerdown', e => {
      if (!e.isPrimary) { this.cancel(); return; }
      const button = e.target.closest('.hand-card');
      if (!button || button.disabled || e.button !== 0 || this.pending.size) return;
      const rank = Number(button.dataset.rank);
      this.stroke = { id: e.pointerId, start: rank, end: rank, x: e.clientX, y: e.clientY, before: this.selected.slice() };
      this.cards.setPointerCapture(e.pointerId);
      this.sweep(rank);
    });
    const track = e => {
      if (this.stroke?.id !== e.pointerId) return;
      if (e.clientX === this.stroke.x && e.clientY === this.stroke.y) return;
      this.stroke.x = e.clientX;
      this.stroke.y = e.clientY;
      const button = document.elementFromPoint(e.clientX, e.clientY)?.closest('.hand-card');
      if (button && this.cards.contains(button) && Number(button.dataset.rank) !== this.stroke.end) {
        this.sweep(Number(button.dataset.rank));
      }
    };
    this.cards.addEventListener('pointermove', track);
    this.cards.addEventListener('pointerup', e => {
      if (this.stroke?.id !== e.pointerId) return;
      track(e);
      this.stroke = null;
    });
    for (const event of ['pointercancel', 'lostpointercapture']) {
      this.cards.addEventListener(event, e => { if (this.stroke?.id === e.pointerId) this.cancel(); });
    }
    this.cards.addEventListener('click', e => {
      // Native keyboard and assistive-technology activation has no pointer stroke.
      const button = e.target.closest('.hand-card');
      if (e.detail || !button || button.disabled || this.pending.size) return;
      const rank = Number(button.dataset.rank);
      this.stroke = { start: rank, before: this.selected.slice() };
      this.sweep(rank);
      this.stroke = null;
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancel(); });
  }

  start(total, size) {
    this.total = total;
    this.size = size;
    this.page = 0;
    this.taken = new Set();
    this.pending = new Set();
    this.selected = [];
    this.stroke = null;
    this.renderPage();
  }

  cancel() {
    if (!this.stroke) return;
    this.selected = this.stroke.before;
    this.stroke = null;
    this.sync();
  }

  turn(delta) {
    this.cancel();
    this.page = Math.max(0, Math.min(Math.ceil(this.size / GROUP_SIZE) - 1, this.page + delta));
    this.renderPage();
  }

  renderPage() {
    const buttons = [];
    const start = this.page * GROUP_SIZE;
    for (let rank = start; rank < Math.min(start + GROUP_SIZE, this.size); rank++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hand-card';
      b.dataset.rank = rank;
      const back = document.createElement('span');
      back.className = 'hand-back';
      back.setAttribute('aria-hidden', 'true');
      const number = document.createElement('span');
      number.className = 'hand-number';
      number.textContent = String(rank + 1).padStart(2, '0');
      back.append(number);
      b.append(back);
      buttons.push(b);
    }
    this.cards.replaceChildren(...buttons);
    this.pageLabel.textContent = `${this.page + 1} / ${Math.ceil(this.size / GROUP_SIZE)} 组`;
    this.sync();
  }

  sweep(end) {
    const { start, before } = this.stroke;
    this.stroke.end = end;
    const step = end >= start ? 1 : -1;
    const next = before.slice();
    const lower = before.includes(start);
    const limit = this.total - this.taken.size;
    let full = false;
    for (let i = start; ; i += step) {
      const at = next.indexOf(i);
      if (lower && at !== -1) next.splice(at, 1);
      if (!lower && at === -1 && !this.taken.has(i)) {
        if (next.length < limit) next.push(i);
        else if (limit === 1) next[0] = i;
        else full = true;
      }
      if (i === end) break;
    }
    this.selected = next;
    this.sync(full);
  }

  sync(full = false) {
    for (const b of this.cards.children) {
      const rank = Number(b.dataset.rank);
      const order = this.selected.indexOf(rank);
      b.disabled = this.taken.has(rank) || this.pending.size > 0;
      const label = this.taken.has(rank) ? '已入阵' : order >= 0 ? `选中顺序 ${order + 1}` : '暗牌';
      b.setAttribute('aria-label', `第 ${rank + 1} 张，${label}`);
      b.classList.toggle('is-dealt', this.taken.has(rank));
      b.setAttribute('aria-pressed', String(order >= 0));
      b.firstChild.dataset.order = order < 0 ? '' : order + 1;
    }
    this.prev.disabled = this.page === 0 || this.pending.size > 0;
    this.next.disabled = (this.page + 1) * GROUP_SIZE >= this.size || this.pending.size > 0;
    this.onSelection(this.selected.length > 0 || this.pending.size > 0);
    this.confirm.disabled = !this.selected.length || this.pending.size > 0;
    this.confirm.textContent = this.selected.length > 1 ? `抽这 ${this.selected.length} 张` : '抽这张';
    this.hint.textContent = full ? '牌位已选满，轻点抬起的牌可收回' : '轻点选牌，再点收回 · 横划连选';
  }

  submit() {
    if (!this.selected.length || this.pending.size) return;
    this.stroke = null;
    const choices = this.selected.map(rank => {
      const back = this.cards.querySelector(`[data-rank="${rank}"] .hand-back`);
      return { rank, origin: (back || this.cards).getBoundingClientRect() };
    });
    this.pending = new Set(this.selected);
    this.sync();
    this.deal(choices);
  }

  dealt(rank) {
    this.taken.add(rank);
    this.pending.delete(rank);
    this.selected = this.selected.filter(i => i !== rank);
    this.sync();
  }
}
