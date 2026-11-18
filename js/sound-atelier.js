// Diana's Salon — 程序化 Web Audio 拟音工坊 + Diana 轻声语音伴读器（Web Speech API）

export class DianaVoiceReader {
  constructor(onStateChange) {
    this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    this.onStateChange = onStateChange;
    this.speaking = false;
    this.preferredVoice = null;
    this.sessionToken = 0;

    if (this.synth) {
      this.pickVoice();
      this.synth.addEventListener?.('voiceschanged', () => this.pickVoice());
    }
  }

  pickVoice() {
    if (!this.synth) return;
    const voices = this.synth.getVoices() || [];
    const zhVoices = voices.filter((v) => /zh|cmn/i.test(v.lang));
    // 优先挑选 macOS / iOS 高品质自然女声
    const rank = (v) => {
      let score = 0;
      if (/premium|enhanced|natural|neural/i.test(v.name)) score += 40;
      if (/ting-?ting|meijia|xiaoxiao|xiaoyi|sin-?ji/i.test(v.name)) score += 25;
      if (/zh-CN/i.test(v.lang)) score += 10;
      return score;
    };
    zhVoices.sort((a, b) => rank(b) - rank(a));
    this.preferredVoice = zhVoices[0] || null;
  }

  isSupported() {
    return Boolean(this.synth);
  }

  stop() {
    this.sessionToken++;
    if (this.synth) {
      try {
        this.synth.cancel();
      } catch (_) { /* ignore */ }
    }
    if (this.speaking) {
      this.speaking = false;
      this.onStateChange?.(false);
    }
  }

  toggleSpeak(clauses = []) {
    if (!this.synth || !clauses.length) return false;
    if (this.speaking) {
      this.stop();
      return false;
    }

    this.stop();
    this.pickVoice();
    const token = ++this.sessionToken;
    this.speaking = true;
    this.onStateChange?.(true);

    let idx = 0;
    const speakNext = () => {
      if (token !== this.sessionToken) return;
      if (idx >= clauses.length) {
        this.speaking = false;
        this.onStateChange?.(false);
        return;
      }
      const text = clauses[idx++].replace(/[「」]/g, ' ');
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'zh-CN';
      if (this.preferredVoice) utter.voice = this.preferredVoice;
      utter.rate = 0.95;
      utter.pitch = 0.98;
      utter.volume = 0.92;

      utter.onend = () => {
        if (token !== this.sessionToken) return;
        setTimeout(speakNext, 160);
      };
      utter.onerror = () => {
        if (token !== this.sessionToken) return;
        this.speaking = false;
        this.onStateChange?.(false);
      };
      this.synth.speak(utter);
    };

    speakNext();
    return true;
  }
}

export class SoundAtelier {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.ambientGain = null;
    this.ambientNodes = [];
    this.noiseBuffer = null;
    this.lastHoverAt = 0;
  }

  ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();

    const length = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.06;
      b6 = white * 0.115926;
    }
    this.noiseBuffer = buffer;
  }

  toggle() {
    this.ensureContext();
    if (!this.ctx) return false;
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.startAmbience();
      this.playCrystalChime([523.25, 659.25], 0.045);
    } else {
      this.stopAmbience();
    }
    return this.enabled;
  }

  startAmbience() {
    if (!this.ctx || this.ambientGain) return;
    const now = this.ctx.currentTime;
    const master = this.ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.04, now + 1.6);
    master.connect(this.ctx.destination);
    this.ambientGain = master;

    for (const freq of [146.83, 220.0, 293.66]) {
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      filter.type = 'lowpass';
      filter.frequency.value = 360;
      g.gain.value = freq === 146.83 ? 0.22 : 0.10;
      osc.connect(filter);
      filter.connect(g);
      g.connect(master);
      osc.start();
      this.ambientNodes.push(osc);
    }

    if (this.noiseBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 500;
      bp.Q.value = 0.8;
      const ng = this.ctx.createGain();
      ng.gain.value = 0.14;
      src.connect(bp);
      bp.connect(ng);
      ng.connect(master);
      src.start();
      this.ambientNodes.push(src);
    }
  }

  stopAmbience() {
    if (!this.ctx || !this.ambientGain) return;
    const now = this.ctx.currentTime;
    const gain = this.ambientGain;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0002), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    const nodes = this.ambientNodes.slice();
    this.ambientNodes = [];
    this.ambientGain = null;
    setTimeout(() => {
      nodes.forEach((n) => {
        try { n.stop(); } catch (_) { /* ignore */ }
      });
      try { gain.disconnect(); } catch (_) { /* ignore */ }
    }, 460);
  }

  playUiTap() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(680, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.035);
    g.gain.setValueAtTime(0.024, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.042);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.045);
  }

  playCardHover() {
    if (!this.enabled || !this.ctx || !this.noiseBuffer) return;
    const now = performance.now();
    if (now - this.lastHoverAt < 52) return;
    this.lastHoverAt = now;

    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 1.18 + Math.random() * 0.3;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1650 + Math.random() * 450, t);
    filter.Q.value = 2.2;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.028, t + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);

    src.connect(filter);
    filter.connect(g);
    g.connect(this.ctx.destination);
    src.start(t, Math.random() * 0.8, 0.09);
  }

  playShuffleCascade() {
    if (!this.enabled || !this.ctx || !this.noiseBuffer) return;
    for (let i = 0; i < 9; i++) {
      setTimeout(() => {
        if (!this.enabled || !this.ctx) return;
        const t = this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        src.playbackRate.value = 0.95 + i * 0.06;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1350 + i * 110;
        bp.Q.value = 1.8;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.045, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
        src.connect(bp);
        bp.connect(g);
        g.connect(this.ctx.destination);
        src.start(t, Math.random() * 0.6, 0.13);
      }, i * 74);
    }
  }

  playCardFlip(stepIndex = 0) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const thud = this.ctx.createOscillator();
    const tg = this.ctx.createGain();
    thud.type = 'triangle';
    thud.frequency.setValueAtTime(132, t);
    thud.frequency.exponentialRampToValueAtTime(52, t + 0.1);
    tg.gain.setValueAtTime(0.058, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    thud.connect(tg);
    tg.connect(this.ctx.destination);
    thud.start(t);
    thud.stop(t + 0.13);

    const scale = [440, 493.88, 523.25, 587.33, 659.25, 739.99, 783.99, 880, 987.77];
    this.playCrystalChime([scale[stepIndex % scale.length]], 0.032);
  }

  playCrystalChime(freqs = [587.33, 880], peak = 0.038) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    freqs.forEach((f, idx) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t + idx * 0.055);
      g.gain.setValueAtTime(0.0001, t + idx * 0.055);
      g.gain.exponentialRampToValueAtTime(peak, t + idx * 0.055 + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, t + idx * 0.055 + 1.05);
      osc.connect(g);
      g.connect(this.ctx.destination);
      osc.start(t + idx * 0.055);
      osc.stop(t + idx * 0.055 + 1.1);
    });
  }
}
