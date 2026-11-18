// Diana · 雷诺曼夜沙龙 — 丝滑步进交互、裸眼 3D 景深闪卡、语音伴读与桌面双向联动编排器

import {
  DIANA_DEMO_PAIRS,
  DIANA_QUESTION_TREE,
  LENORMAND_CARDS,
  SPREAD_CONFIGS
} from './cards-data.js';
import { cardFaceUrl } from './card-art.js';
import { DianaVoiceReader, SoundAtelier } from './sound-atelier.js';
import { buildSalonReading } from './reading-engine.js';
import { FlatSalonScene } from './flat-scene.js';
import {
  attachGlassRimGlow,
  buildNakedEyeDioramaCard,
  SparkleAtelier
} from './holo-sparkle.js';

const JOURNAL_STORAGE_KEY = 'diana_lenormand_journal_v2';

const state = {
  step: 1,
  subStageB: false,
  demoIdx: 0,
  selectedCategory: DIANA_QUESTION_TREE[0],
  selectedQuestion: '',
  selectedSpread: 'line3',
  currentReading: null,
  currentSaved: false,
  compendiumFilter: 'all',
  motionPaused: false
};

let supportsDisplayTransition;
function canTransitionDisplay() {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  supportsDisplayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return supportsDisplayTransition;
}

function supportsTopLayerExit() {
  return window.CSS?.supports?.('overlay', 'auto') && canTransitionDisplay();
}

async function closeTopLayer(dialog) {
  if (!dialog || !dialog.open) return;
  if (!supportsTopLayerExit()) {
    dialog.setAttribute('data-closing', '');
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 500))
      ]);
    }
    if (!dialog.hasAttribute('data-closing')) return;
    dialog.removeAttribute('data-closing');
  }
  dialog.close();
}

function setupModalDialogs() {
  const dialogs = document.querySelectorAll('dialog.salon-dialog');
  const needsClosedByFallback = !('closedBy' in HTMLDialogElement.prototype);

  const outsideBox = (e, dialog) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };

  dialogs.forEach((dialog) => {
    dialog.addEventListener('close', () => {
      dialog.returnValue = '';
      dialog.removeAttribute('data-closing');
    });

    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeTopLayer(dialog);
    });

    const closeForm = dialog.querySelector('form[method="dialog"]');
    if (closeForm) {
      closeForm.addEventListener('submit', (event) => {
        event.preventDefault();
        closeTopLayer(dialog);
      });
    }

    if (needsClosedByFallback && dialog.getAttribute('closedby') === 'any') {
      let pressedOutside = false;
      dialog.addEventListener('pointerdown', (e) => {
        pressedOutside = e.target === dialog && outsideBox(e, dialog);
      });
      dialog.addEventListener('pointerup', (e) => {
        if (e.target === dialog && pressedOutside && outsideBox(e, dialog)) {
          closeTopLayer(dialog);
        }
        pressedOutside = false;
      });
    }
  });
}

let toastTimer = null;
let toastHideTimer = null;
function showToast(msg) {
  const el = document.getElementById('salon-toast');
  if (!el) return;
  clearTimeout(toastTimer);
  clearTimeout(toastHideTimer);
  el.textContent = msg;
  el.hidden = false;
  requestAnimationFrame(() => {
    el.classList.add('is-shown');
  });
  toastTimer = setTimeout(() => {
    el.classList.remove('is-shown');
    toastHideTimer = setTimeout(() => {
      el.hidden = true;
    }, 300);
  }, 2600);
}

function readJournalEntries() {
  const entries = JSON.parse(localStorage.getItem(JOURNAL_STORAGE_KEY) || '[]');
  if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry !== 'object')) {
    throw new Error('Invalid journal');
  }
  return entries;
}

function saveJournalEntries(entries) {
  try {
    localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    showToast(error.name === 'QuotaExceededError' ? '本机存储已满，可先导出手札' : '手札未能写入，请重试');
    return false;
  }
  document.getElementById('journal-count-badge').textContent = String(entries.length);
  return true;
}

function journalKey(entry) {
  return entry.id || JSON.stringify([entry.timestamp, entry.question, entry.cardsSummary, entry.closingAdvice]);
}

function exportJournal() {
  try {
    const entries = readJournalEntries();
    const url = URL.createObjectURL(new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Diana-夜沙龙手札.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (_) {
    showToast('未能读到手札，请重试');
  }
}

// 丝滑可打断的方向感知步进过渡（Apple §3 & §7：前进从右滑入，返回从左滑回）
function animateActivePanelIn(panelEl, direction = 1) {
  if (!panelEl) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || state.motionPaused;
  panelEl.getAnimations?.().forEach((a) => a.cancel());
  if (reduced || !panelEl.animate) return;

  panelEl.animate(
    [
      { opacity: 0, transform: `translate3d(${direction * 16}px, 0, 0)` },
      { opacity: 1, transform: 'translate3d(0, 0, 0)' }
    ],
    {
      duration: 340,
      easing: 'cubic-bezier(0.32, 0.72, 0, 1)'
    }
  );
}

let readingOpenFrame;
function openReadingSheet() {
  const panel = document.getElementById('reading-panel');
  if (!panel) return;
  panel.hidden = false;
  cancelAnimationFrame(readingOpenFrame);
  readingOpenFrame = requestAnimationFrame(() => {
    panel.classList.add('is-open');
  });
}

function setReadingExpanded(expanded) {
  document.getElementById('reading-panel').classList.toggle('is-expanded', expanded);
  const button = document.getElementById('btn-expand-reading');
  button.setAttribute('aria-expanded', String(expanded));
  button.textContent = expanded ? '收起解读' : '展开解读';
}

function closeReadingSheet() {
  cancelAnimationFrame(readingOpenFrame);
  setReadingExpanded(false);
  const panel = document.getElementById('reading-panel');
  if (!panel || panel.hidden) return;
  panel.classList.remove('is-open');
  setTimeout(() => {
    if (!panel.classList.contains('is-open')) {
      panel.hidden = true;
    }
  }, 380);
}

function goToStep(stepNum, { subStageB = false, salonScene = null, direction = 1 } = {}) {
  state.step = stepNum;
  state.subStageB = subStageB;

  const s1 = document.getElementById('step-1');
  const s2 = document.getElementById('step-2');
  const s3 = document.getElementById('step-3');

  s1.hidden = stepNum !== 1;
  s2.hidden = stepNum !== 2;
  s3.hidden = stepNum !== 3;

  document.querySelectorAll('[data-step-dot]').forEach((dot) => {
    dot.classList.toggle('is-active', Number(dot.dataset.stepDot) === stepNum);
  });

  if (stepNum === 1) {
    animateActivePanelIn(s1, direction);
    if (salonScene) {
      const rightId = DIANA_DEMO_PAIRS[state.demoIdx]?.rightId || 25;
      salonScene.arrangeOnboardingPair(rightId, false);
    }
  } else if (stepNum === 2) {
    const stageA = document.getElementById('topic-stage-a');
    const stageB = document.getElementById('topic-stage-b');
    stageA.hidden = subStageB;
    stageB.hidden = !subStageB;
    animateActivePanelIn(subStageB ? stageB : stageA, direction);
    if (salonScene) {
      salonScene.arrangeTopicStage(state.selectedCategory?.topicCardId || 24);
    }
  } else if (stepNum === 3) {
    document.getElementById('selected-q-preview').textContent = `所问：「${state.selectedQuestion}」`;
    animateActivePanelIn(s3, direction);
    if (salonScene) {
      salonScene.previewSpreadOnTable(state.selectedSpread);
    }
  }
}

function initDianaStepper(getScene, sound, sparkle, enterRitualCallback) {
  const demoContainer = document.getElementById('demo-pair-choices');
  const formulaEl = document.getElementById('demo-formula-text');
  const lineEl = document.getElementById('demo-line-text');
  const meaningPill = document.getElementById('demo-meaning-pill');

  const renderDemoButtons = () => {
    demoContainer.replaceChildren();
    DIANA_DEMO_PAIRS.forEach((item, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.role = 'radio';
      const active = idx === state.demoIdx;
      btn.setAttribute('aria-checked', String(active));
      btn.className = `apple-pill-choice${active ? ' is-selected' : ''}`;
      btn.textContent = item.chip;
      btn.addEventListener('click', (e) => {
        if (state.demoIdx === idx) return;
        state.demoIdx = idx;
        sound.playUiTap();
        formulaEl.textContent = item.formula;
        lineEl.textContent = item.line;
        animateActivePanelIn(meaningPill, 1);
        renderDemoButtons();
        getScene().arrangeOnboardingPair(item.rightId, true);
        sparkle.burst(e.clientX || window.innerWidth * 0.5, e.clientY || window.innerHeight * 0.6, 12);
      });
      demoContainer.appendChild(btn);
    });
  };
  renderDemoButtons();

  document.getElementById('btn-to-step-2').addEventListener('click', () => {
    sound.playUiTap();
    goToStep(2, { subStageB: false, salonScene: getScene(), direction: 1 });
  });
  const demo = document.getElementById('demo-example');
  const demoToggle = document.getElementById('btn-toggle-demo');
  demoToggle.addEventListener('click', () => {
    demo.hidden = !demo.hidden;
    demoToggle.setAttribute('aria-expanded', String(!demo.hidden));
    demoToggle.textContent = demo.hidden ? '先看连读示例' : '收起连读示例';
  });
  document.getElementById('btn-back-to-1').addEventListener('click', () => {
    sound.playUiTap();
    goToStep(1, { salonScene: getScene(), direction: -1 });
  });
  document.getElementById('btn-back-to-2a').addEventListener('click', () => {
    sound.playUiTap();
    goToStep(2, { subStageB: false, salonScene: getScene(), direction: -1 });
  });
  document.getElementById('btn-back-to-2b').addEventListener('click', () => {
    sound.playUiTap();
    goToStep(2, { subStageB: true, salonScene: getScene(), direction: -1 });
  });

  // Step 2A：四大提问方向（悬停时牌桌中央同步切换对应裸眼 3D 代表牌！）
  const catGrid = document.getElementById('category-choices');
  const sitList = document.getElementById('situation-choices');

  const renderSituationChoices = (cat) => {
    sitList.replaceChildren();
    document.getElementById('subtopic-heading').textContent = `${cat.icon} ${cat.title} · 选最贴近的一句：`;
    cat.choices.forEach((qText) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'apple-pill-choice situation-btn';
      btn.textContent = qText;
      btn.addEventListener('click', () => {
        sound.playUiTap();
        state.selectedQuestion = qText;
        clearQuestionError();
        goToStep(3, { salonScene: getScene(), direction: 1 });
      });
      sitList.appendChild(btn);
    });
  };

  DIANA_QUESTION_TREE.forEach((cat) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'apple-choice-card';

    const icon = document.createElement('span');
    icon.className = 'choice-icon';
    icon.textContent = cat.icon;

    const title = document.createElement('span');
    title.className = 'choice-title';
    title.textContent = cat.title;

    const sub = document.createElement('span');
    sub.className = 'choice-sub';
    sub.textContent = cat.sub;

    card.append(icon, title, sub);
    card.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch' && state.step === 2 && !state.subStageB) {
        getScene().arrangeTopicStage(cat.topicCardId);
      }
    });
    card.addEventListener('click', () => {
      sound.playUiTap();
      if (state.selectedCategory !== cat || !state.selectedQuestion) customInput.value = '';
      state.selectedQuestion = '';
      customBox.hidden = true;
      clearQuestionError();
      state.selectedCategory = cat;
      renderSituationChoices(cat);
      goToStep(2, { subStageB: true, salonScene: getScene(), direction: 1 });
    });
    catGrid.appendChild(card);
  });

  // Step 2B 可选自定义一句输入
  const toggleCustomBtn = document.getElementById('btn-toggle-custom-q');
  const customBox = document.getElementById('custom-q-box');
  const customInput = document.getElementById('custom-question-input');

  const customError = document.getElementById('custom-q-error');
  const clearQuestionError = () => {
    customInput.removeAttribute('aria-invalid');
    customError.hidden = true;
  };
  customInput.addEventListener('input', clearQuestionError);

  toggleCustomBtn.addEventListener('click', () => {
    customBox.hidden = !customBox.hidden;
    if (!customBox.hidden) customInput.focus();
    else clearQuestionError();
  });

  const submitCustomQ = () => {
    const v = customInput.value.trim();
    if (!v) {
      customInput.setAttribute('aria-invalid', 'true');
      customError.hidden = false;
      customInput.focus();
      return;
    }
    clearQuestionError();
    state.selectedQuestion = v;
    customInput.blur();
    sound.playUiTap();
    goToStep(3, { salonScene: getScene(), direction: 1 });
  };
  const confirmCustom = document.getElementById('btn-confirm-custom-q');
  confirmCustom.addEventListener('click', submitCustomQ);
  customInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      submitCustomQ();
    }
  });

  // Step 3：四种罗马牌阵卡片（悬停即在丝绒牌桌上实时亮起对应金色阵位框！）
  const spreadGrid = document.getElementById('spread-choice-cards');
  const renderSpreadCards = () => {
    spreadGrid.replaceChildren();
    Object.values(SPREAD_CONFIGS).forEach((cfg) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `apple-choice-card${cfg.id === state.selectedSpread ? ' is-selected' : ''}`;

      const roman = document.createElement('span');
      roman.className = 'choice-roman';
      roman.textContent = cfg.roman;

      const title = document.createElement('span');
      title.className = 'choice-title';
      title.textContent = cfg.name;

      const sub = document.createElement('span');
      sub.className = 'choice-sub';
      sub.textContent = `${cfg.count} 张 · ${cfg.use}`;

      card.append(roman, title, sub);
      card.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'touch' && state.step === 3 && state.selectedSpread !== cfg.id) {
          state.selectedSpread = cfg.id;
          getScene().previewSpreadOnTable(cfg.id);
          spreadGrid.querySelectorAll('.apple-choice-card').forEach((el, i) => {
            el.classList.toggle('is-selected', Object.values(SPREAD_CONFIGS)[i]?.id === cfg.id);
          });
        }
      });
      card.addEventListener('click', () => {
        sound.playUiTap();
        if (!state.selectedQuestion) return;
        state.selectedSpread = cfg.id;
        enterRitualCallback();
      });
      spreadGrid.appendChild(card);
    });
  };
  renderSpreadCards();
}

function openCardDetailModal(card) {
  const dialog = document.getElementById('card-detail-dialog');
  document.getElementById('detail-card-meta').textContent = `${card.num} · ${card.fr.toUpperCase()} · ${card.pip} · ${card.tone}`;
  document.getElementById('detail-card-title').textContent = `${card.zh}（${card.en}）`;

  const bodyEl = document.getElementById('card-detail-body');
  const dioramaCard = buildNakedEyeDioramaCard(card, { maxTilt: 18, detail: true });

  const infoCol = document.createElement('div');
  const kwWrap = document.createElement('div');
  kwWrap.className = 'detail-keywords';
  card.keywords.forEach((kw) => {
    const span = document.createElement('span');
    span.className = 'detail-kw';
    span.textContent = kw;
    kwWrap.appendChild(span);
  });

  const voiceP = document.createElement('p');
  voiceP.className = 'detail-voice';
  voiceP.textContent = card.voice;

  const dl = document.createElement('dl');
  dl.className = 'detail-dl';
  [
    ['情感切面', card.love],
    ['事业与钱', card.work],
    ['连读角色', `做主语时讲的是${card.noun}；搭在右边修饰邻牌时，${card.modifier}。`],
    ['应验节奏', card.tempo]
  ].forEach(([dtText, ddText]) => {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = dtText;
    const dd = document.createElement('dd');
    dd.textContent = ddText;
    row.append(dt, dd);
    dl.appendChild(row);
  });

  infoCol.append(kwWrap, voiceP, dl);
  bodyEl.replaceChildren(dioramaCard, infoCol);

  if (!dialog.open) dialog.showModal();
}

function renderCompendiumGrid() {
  const grid = document.getElementById('compendium-grid');
  const list =
    state.compendiumFilter === 'all'
      ? LENORMAND_CARDS
      : LENORMAND_CARDS.filter((c) => c.tone.startsWith(state.compendiumFilter));

  const items = list.map((card, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'compendium-item';
    btn.style.setProperty('--stagger-idx', index);

    const diorama = buildNakedEyeDioramaCard(card, { maxTilt: 15 });

    const label = document.createElement('span');
    label.className = 'compendium-item-label';
    label.textContent = `${card.num} · ${card.zh}`;

    btn.append(diorama, label);
    btn.addEventListener('click', () => openCardDetailModal(card));
    return btn;
  });
  grid.replaceChildren(...items);
}

function renderReadingPanel(reading, salonScene, sound, sparkle, voiceReader) {
  voiceReader.stop();
  document.getElementById('reading-focus-tag').textContent = `${reading.focusLabel} · ${reading.timestamp}`;
  document.getElementById('reading-spread-heading').textContent = reading.spreadName;
  document.getElementById('reading-question-line').textContent = reading.openingLine;
  document.getElementById('reading-climate-line').textContent = reading.climateLine;

  const voiceBtn = document.getElementById('btn-voice-read');
  if (voiceBtn) {
    voiceBtn.hidden = !voiceReader.isSupported();
  }

  // 1. 牌眼聚光（采用四层裸眼 3D 景深暗盒闪卡！）
  const spotlight = document.getElementById('anchor-spotlight');
  const holoThumb = buildNakedEyeDioramaCard(reading.anchorCard, { maxTilt: 15 });
  holoThumb.style.cursor = 'pointer';
  holoThumb.addEventListener('click', () => openCardDetailModal(reading.anchorCard));

  const meta = document.createElement('div');
  meta.className = 'anchor-meta';
  const tag = document.createElement('span');
  tag.className = 'diana-tag';
  tag.textContent = `${reading.anchorSlotLabel} · 牌眼`;
  const h4 = document.createElement('h4');
  h4.textContent = `${reading.anchorCard.num} ${reading.anchorCard.zh}（${reading.anchorCard.pip}）`;
  const p = document.createElement('p');
  p.textContent = reading.anchorFocusText;
  meta.append(tag, h4, p);
  spotlight.replaceChildren(holoThumb, meta);

  // 2. 双牌连读互动列表
  const pairingsList = document.getElementById('pairings-list');
  pairingsList.replaceChildren();
  reading.pairings.forEach((pair, idx) => {
    const itemBtn = document.createElement('button');
    itemBtn.type = 'button';
    itemBtn.className = `pair-item-btn${idx === 0 ? ' is-highlighted' : ''}`;

    const top = document.createElement('div');
    top.className = 'pair-item-top';
    const tSpan = document.createElement('span');
    tSpan.className = 'pair-item-title';
    tSpan.textContent = pair.title;
    const fSpan = document.createElement('span');
    fSpan.className = 'pair-item-formula';
    fSpan.textContent = pair.formula;
    top.append(tSpan, fSpan);

    const desc = document.createElement('p');
    desc.className = 'pair-item-desc';
    desc.textContent = pair.text;
    itemBtn.append(top, desc);

    const activatePair = () => {
      pairingsList.querySelectorAll('.pair-item-btn').forEach((el) => el.classList.remove('is-highlighted'));
      itemBtn.classList.add('is-highlighted');
      salonScene.highlightPair(pair.a, pair.b);
    };
    itemBtn.addEventListener('pointerenter', activatePair);
    itemBtn.addEventListener('focus', activatePair);
    itemBtn.addEventListener('click', () => {
      sound.playUiTap();
      activatePair();
    });
    pairingsList.appendChild(itemBtn);
  });

  if (reading.pairings[0]) {
    salonScene.highlightPair(reading.pairings[0].a, reading.pairings[0].b);
  }

  // 3. Diana 行动二选一推演
  const actionWrap = document.getElementById('action-choices-wrap');
  const actionReply = document.getElementById('action-choice-reply');
  actionWrap.replaceChildren();
  actionReply.hidden = true;

  reading.actionChoices.forEach((ac) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'apple-pill-choice';
    btn.textContent = ac.label;
    btn.addEventListener('click', (e) => {
      sound.playUiTap();
      actionWrap.querySelectorAll('.apple-pill-choice').forEach((b) => b.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      actionReply.textContent = ac.reply;
      actionReply.hidden = false;
      animateActivePanelIn(actionReply, 1);
      sparkle.burst(e.clientX || window.innerWidth * 0.75, e.clientY || window.innerHeight * 0.5, 12);
    });
    actionWrap.appendChild(btn);
  });

  // 4. 逐位落牌细读（悬停列表行时，左侧 3D 牌桌上对应卡牌同步浮起发光！）
  const strip = document.getElementById('drawn-cards-strip');
  strip.replaceChildren();
  reading.cardNotes.forEach((note) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'drawn-card-row';

    const cImg = document.createElement('img');
    cImg.loading = 'lazy';
    cImg.src = cardFaceUrl(note.card);
    cImg.alt = note.card.zh;

    const right = document.createElement('div');
    const titleLine = document.createElement('span');
    titleLine.className = 'drawn-row-title';
    const slotSpan = document.createElement('span');
    slotSpan.className = 'drawn-row-slot';
    slotSpan.textContent = `[${note.slotLabel}]`;
    titleLine.append(slotSpan, document.createTextNode(`${note.card.num} ${note.card.zh} · ${note.card.pip}`));

    const hintLine = document.createElement('span');
    hintLine.className = 'drawn-row-hint';
    hintLine.textContent = note.domainHint;

    right.append(titleLine, hintLine);
    row.append(cImg, right);
    row.addEventListener('pointerenter', () => salonScene.highlightSingleSlot(note.slotIndex));
    row.addEventListener('pointerleave', () => salonScene.highlightSingleSlot(-1));
    row.addEventListener('click', () => openCardDetailModal(note.card));
    strip.appendChild(row);
  });

  document.getElementById('reading-closing-text').textContent = reading.closingAdvice;
  document.getElementById('save-reading-label').textContent = '收入手札';
  state.currentSaved = false;

  document.querySelector('#reading-panel .reading-scroll-inner')?.scrollTo({ top: 0 });
  openReadingSheet();
}

function openSavedReading(entry) {
  const reading = entry.reading;
  const body = document.getElementById('saved-reading-body');
  document.getElementById('saved-reading-title').textContent = reading.spreadName;
  body.replaceChildren();
  const append = (tag, text) => {
    const element = document.createElement(tag);
    element.textContent = text;
    body.append(element);
  };
  append('p', `${reading.focusLabel} · ${reading.timestamp}`);
  append('h3', reading.question);
  append('p', reading.climateLine);
  append('h3', `牌眼 · ${reading.anchorSlotLabel} ${reading.anchorCard.zh}`);
  append('p', reading.anchorFocusText);
  append('h3', '逐位落牌');
  reading.cardNotes.forEach(note => {
    const row = document.createElement('div');
    row.className = 'saved-card-note';
    row.append(buildNakedEyeDioramaCard(note.card));
    const noteBody = document.createElement('div');
    const title = document.createElement('h4');
    title.textContent = `${note.slotLabel} · ${note.card.num} ${note.card.zh}`;
    const description = document.createElement('p');
    description.textContent = note.domainHint;
    noteBody.append(title, description);
    row.append(noteBody);
    body.append(row);
  });
  append('h3', '双牌连读');
  reading.pairings.forEach(pair => {
    append('h4', `${pair.title} · ${pair.formula}`);
    append('p', pair.text);
  });
  append('h3', '行动推演');
  reading.actionChoices.forEach(choice => {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = choice.label;
    const reply = document.createElement('p');
    reply.textContent = choice.reply;
    details.append(summary, reply);
    body.append(details);
  });
  append('h3', 'Diana 临别夜话');
  append('p', reading.closingAdvice);
  if (entry.reflection) {
    append('h3', '事后小记');
    append('p', entry.reflection);
  }
  document.getElementById('saved-reading-dialog').showModal();
}

function renderJournalModal() {
  const container = document.getElementById('journal-entries');
  const exportButton = document.getElementById('btn-export-journal');
  container.replaceChildren();
  exportButton.hidden = true;
  let entries;
  try {
    entries = readJournalEntries();
  } catch (_) {
    container.textContent = '暂时读不到本机手札。';
    return;
  }
  if (!entries.length) {
    container.textContent = '抽完一局，可以把解读收进手札。';
    return;
  }
  exportButton.hidden = false;

  entries.forEach(entry => {
    const card = document.createElement('article');
    card.className = 'journal-card';

    const head = document.createElement('div');
    head.className = 'journal-card-head';
    head.textContent = `${entry.spreadName} · ${entry.timestamp}`;

    const q = document.createElement('h3');
    q.className = 'journal-card-q';
    q.textContent = entry.question;

    const cardsLine = document.createElement('div');
    cardsLine.className = 'journal-card-cards';
    cardsLine.textContent = `牌面：${entry.cardsSummary}`;

    const sum = document.createElement('p');
    sum.className = 'journal-card-summary';
    sum.textContent = entry.closingAdvice;
    card.append(head, q, cardsLine, sum);

    if (entry.reading) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'ghost-pill-btn';
      open.textContent = '打开原局';
      open.addEventListener('click', () => openSavedReading(entry));
      card.append(open);
    } else {
      const note = document.createElement('small');
      note.className = 'journal-card-head';
      note.textContent = '旧版记录 · 摘要';
      card.append(note);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'journal-reflection-input';
    input.placeholder = '写一句事后小记';
    input.value = entry.reflection || '';
    input.setAttribute('aria-label', '事后复盘备注');
    input.addEventListener('change', () => {
      try {
        const latest = readJournalEntries();
        const record = latest.find(item => journalKey(item) === journalKey(entry));
        if (!record) {
          showToast('这条手札已变更，请重新打开手札');
          return;
        }
        record.reflection = input.value.trim();
        if (saveJournalEntries(latest)) {
          entry.reflection = record.reflection;
          showToast('小记已保存');
        }
      } catch (_) {
        showToast('暂时读不到本机手札，请重试');
      }
    });
    card.append(input);
    container.appendChild(card);
  });
}

function bootDianaSalon() {
  setupModalDialogs();
  attachGlassRimGlow(document);

  const badge = document.getElementById('journal-count-badge');
  try {
    badge.textContent = String(readJournalEntries().length);
  } catch (_) {
    badge.hidden = true;
  }

  const sparkle = new SparkleAtelier(document.getElementById('sparkle-canvas'));
  const sound = new SoundAtelier();

  const voiceBtn = document.getElementById('btn-voice-read');
  const voiceLabel = document.getElementById('voice-read-label');
  const voiceReader = new DianaVoiceReader((speaking) => {
    voiceBtn?.classList.toggle('is-speaking', speaking);
    if (voiceLabel) {
      voiceLabel.textContent = speaking ? '停止轻读' : '听 Diana 轻读';
    }
  });

  voiceBtn?.addEventListener('click', () => {
    if (!state.currentReading) return;
    sound.playUiTap();
    voiceReader.toggleSpeak(state.currentReading.voiceClauses);
  });

  const canvas = document.getElementById('salon-canvas');
  const ritualOverlay = document.getElementById('ritual-overlay');
  const hudSpreadName = document.getElementById('hud-spread-name');
  const hudProgress = document.getElementById('hud-progress-text');
  const quickDrawBtn = document.getElementById('btn-quick-draw');
  const dock = document.getElementById('diana-dock-wrap');
  const readingPanel = document.getElementById('reading-panel');
  const inspectActions = document.getElementById('inspect-actions');
  const inspectMeaningBtn = document.getElementById('btn-inspect-meaning');
  const flatStage = document.getElementById('flat-stage');
  const stageNotice = document.getElementById('stage-notice');
  const stageStatus = document.getElementById('stage-status');
  const retry3D = document.getElementById('btn-retry-3d');
  let inspectedCard = null;
  let activeRound = null;
  let salonScene;
  let loading3D = false;

  const callbacks = {
    onCardDetail: openCardDetailModal,
    onPickingReady(drawn, total) {
      hudProgress.textContent = `轻点挑牌 ${drawn} / ${total}`;
      quickDrawBtn.hidden = false;
    },
    onCardPicked(drawn, total, cardData) {
      sparkle.burst(window.innerWidth * 0.45, window.innerHeight * 0.48, 14);
      if (drawn < total) {
        hudProgress.textContent = `已翻「${cardData.zh}」· ${drawn} / ${total}`;
      } else {
        hudProgress.textContent = 'Diana 正在连读…';
        quickDrawBtn.hidden = true;
      }
    },
    onSpreadComplete(drawnCardDataList) {
      if (!activeRound) return;
      const { spread, question, focus } = activeRound;
      const reading = buildSalonReading(spread, drawnCardDataList, question, focus);
      state.currentReading = reading;
      hudProgress.textContent = '全阵已落定';
      renderReadingPanel(reading, salonScene, sound, sparkle, voiceReader);
    },
    onInspect3DChange(cardData) {
      inspectedCard = cardData;
      const isInspecting = Boolean(cardData);
      if (isInspecting) {
        inspectActions.setAttribute('aria-label', `手持牌 · ${cardData.zh}`);
      } else if (inspectActions.contains(document.activeElement)) {
        canvas.focus({ preventScroll: true });
      }
      inspectActions.hidden = !isInspecting;
      document.body.classList.toggle('is-inspecting', isInspecting);
      dock.inert = isInspecting || document.body.classList.contains('is-ritual-mode');
      readingPanel.inert = isInspecting;
    },
    onCrystalWhisper(msg, x, y) {
      sparkle.burst(x || window.innerWidth * 0.7, y || window.innerHeight * 0.3, 18);
      showToast(msg);
    }
  };
  salonScene = new FlatSalonScene(flatStage, sound, callbacks);

  function setStageStatus(message, canRetry = false) {
    stageNotice.hidden = !message;
    stageStatus.textContent = message;
    retry3D.hidden = !canRetry;
  }

  async function tryOpen3D() {
    if (loading3D || activeRound || salonScene.mode === 'reading' || flatStage.hidden) return;
    loading3D = true;
    setStageStatus('正在加载三维牌桌…');
    let timeout;
    try {
      if (!window.WebGL2RenderingContext) throw new Error('WebGL 2 unavailable');
      const { SalonScene, deck } = await Promise.race([
        import('./salon-scene.js').then(async ({ SalonScene }) => ({
          SalonScene, deck: await SalonScene.loadDeck()
        })),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('3D load timed out')), 6500);
        })
      ]);
      if (activeRound) {
        setStageStatus('本局使用平面牌桌', true);
        return;
      }
      const next = new SalonScene(canvas, sound, callbacks, deck);
      next.setMotionPaused(state.motionPaused);
      salonScene = next;
      if (state.step === 1) next.arrangeOnboardingPair(DIANA_DEMO_PAIRS[state.demoIdx].rightId, false);
      if (state.step === 2) next.arrangeTopicStage(state.selectedCategory.topicCardId);
      if (state.step === 3) next.previewSpreadOnTable(state.selectedSpread);
      flatStage.hidden = true;
      flatStage.replaceChildren();
      canvas.hidden = false;
      canvas.removeAttribute('aria-hidden');
      setStageStatus('');
    } catch (_) {
      setStageStatus('三维暂不可用，已用平面牌桌', true);
    } finally {
      clearTimeout(timeout);
      loading3D = false;
    }
  }

  retry3D.addEventListener('click', tryOpen3D);

  inspectMeaningBtn.addEventListener('click', () => {
    if (!inspectedCard) return;
    sound.playUiTap();
    inspectMeaningBtn.focus({ preventScroll: true });
    openCardDetailModal(inspectedCard);
  });
  document.getElementById('btn-inspect-dismiss').addEventListener('click', () => {
    salonScene.dismissInspectCard();
  });

  const enterRitualMode = () => {
    voiceReader.stop();
    const cfg = SPREAD_CONFIGS[state.selectedSpread];
    activeRound = { spread: cfg.id, question: state.selectedQuestion, focus: state.selectedCategory.focus };
    state.currentReading = null;
    document.body.classList.add('is-ritual-mode');
    dock.inert = true;
    ritualOverlay.hidden = false;
    closeReadingSheet();
    quickDrawBtn.hidden = true;
    hudSpreadName.textContent = `${cfg.roman} · ${cfg.name}`;
    hudProgress.textContent = '正在洗牌…';
    salonScene.setSpread(state.selectedSpread);
    salonScene.startShuffleRitual();
  };

  const exitRitualMode = (targetStep = 1) => {
    voiceReader.stop();
    activeRound = null;
    state.currentReading = null;
    if (targetStep < 3) state.selectedQuestion = '';
    document.body.classList.remove('is-ritual-mode');
    dock.inert = false;
    closeReadingSheet();
    ritualOverlay.hidden = true;
    goToStep(targetStep, { subStageB: false, salonScene, direction: -1 });
  };

  initDianaStepper(() => salonScene, sound, sparkle, enterRitualMode);
  document.getElementById('btn-export-journal').addEventListener('click', exportJournal);
  document.getElementById('btn-expand-reading').addEventListener('click', () => {
    setReadingExpanded(!readingPanel.classList.contains('is-expanded'));
  });

  const customInput = document.getElementById('custom-question-input');
  const viewport = window.visualViewport;
  let keyboardOpen = false;
  const syncKeyboard = () => {
    const active = document.activeElement === customInput;
    const inset = viewport?.scale === 1
      ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      : 0;
    keyboardOpen = inset > 60 && (active || keyboardOpen);
    dock.style.setProperty('--keyboard-inset', `${keyboardOpen ? inset : 0}px`);
    dock.classList.toggle('has-keyboard', keyboardOpen);
    if (active && keyboardOpen) customInput.scrollIntoView({ block: 'nearest' });
  };
  viewport?.addEventListener('resize', syncKeyboard);
  viewport?.addEventListener('scroll', syncKeyboard);
  customInput.addEventListener('focus', syncKeyboard);

  document.getElementById('btn-exit-ritual').addEventListener('click', () => {
    sound.playUiTap();
    exitRitualMode(3);
  });
  document.getElementById('btn-brand-home').addEventListener('click', () => {
    sound.playUiTap();
    exitRitualMode(1);
  });
  document.getElementById('btn-new-question').addEventListener('click', () => {
    sound.playUiTap();
    exitRitualMode(2);
  });

  document.getElementById('btn-reshuffle').addEventListener('click', () => {
    voiceReader.stop();
    sound.playUiTap();
    closeReadingSheet();
    state.currentReading = null;
    quickDrawBtn.hidden = true;
    hudProgress.textContent = '重新洗牌…';
    salonScene.startShuffleRitual();
  });

  quickDrawBtn.addEventListener('click', () => {
    sound.playUiTap();
    quickDrawBtn.hidden = true;
    salonScene.quickDrawRemaining();
  });

  document.getElementById('btn-save-reading').addEventListener('click', (e) => {
    if (!state.currentReading || state.currentSaved) {
      if (state.currentSaved) showToast('这一局已收入手札');
      return;
    }
    const r = state.currentReading;
    try {
      const entries = readJournalEntries();
      entries.unshift({
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        spreadName: r.spreadName,
        timestamp: r.timestamp,
        question: r.question,
        cardsSummary: r.cardNotes.map((n) => `${n.card.num}${n.card.zh}`).join(' · '),
        closingAdvice: r.closingAdvice,
        reflection: '',
        reading: r
      });
      if (!saveJournalEntries(entries)) return;
    } catch (_) {
      showToast('暂时读不到本机手札，保存未完成');
      return;
    }
    state.currentSaved = true;
    document.getElementById('save-reading-label').textContent = '已收入';
    sparkle.burst(e.clientX || window.innerWidth * 0.8, e.clientY || window.innerHeight * 0.85, 16);
    showToast('已妥帖收进 Diana 私藏手札');
  });

  document.getElementById('btn-copy-reading').addEventListener('click', async () => {
    if (!state.currentReading) return;
    const r = state.currentReading;
    const lines = [
      `【Diana · 雷诺曼夜沙龙｜${r.spreadName}】(${r.timestamp})`,
      `${r.openingLine}`,
      `落牌：${r.cardNotes.map((n) => `${n.slotLabel}[${n.card.num} ${n.card.zh}]`).join(' / ')}`,
      '',
      ...r.pairings.map((p) => `· ${p.title}（${p.formula}）：${p.text}`),
      '',
      `Diana 临别夜话：${r.closingAdvice}`
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      showToast('解牌手记已复制');
    } catch (_) {
      showToast('当前环境不支持自动复制');
    }
  });

  const compendiumDialog = document.getElementById('compendium-dialog');
  document.getElementById('btn-open-compendium').addEventListener('click', () => {
    sound.playUiTap();
    renderCompendiumGrid();
    if (!compendiumDialog.open) compendiumDialog.showModal();
  });

  document.getElementById('compendium-filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    sound.playUiTap();
    state.compendiumFilter = chip.dataset.filter || 'all';
    document.querySelectorAll('#compendium-filters .filter-chip').forEach((c) => {
      c.classList.toggle('is-active', c === chip);
    });
    renderCompendiumGrid();
  });

  const journalDialog = document.getElementById('journal-dialog');
  document.getElementById('btn-open-journal').addEventListener('click', () => {
    sound.playUiTap();
    renderJournalModal();
    if (!journalDialog.open) journalDialog.showModal();
  });

  const soundBtn = document.getElementById('btn-toggle-sound');
  const soundWave = document.getElementById('sound-wave-path');
  soundBtn.addEventListener('click', () => {
    const on = sound.toggle();
    soundBtn.classList.toggle('is-active', on);
    soundWave.setAttribute('opacity', on ? '1' : '0.32');
    soundBtn.setAttribute('aria-label', on ? '关闭沙龙声景' : '开启沙龙声景');
    showToast(on ? '沙龙声景已开启' : '沙龙声景已静音');
  });

  const motionBtn = document.getElementById('btn-toggle-motion');
  const motionText = document.getElementById('motion-status-text');
  const motionGlyph = document.getElementById('motion-icon-glyph');
  motionBtn.addEventListener('click', () => {
    state.motionPaused = !state.motionPaused;
    document.body.classList.toggle('is-motion-paused', state.motionPaused);
    salonScene.setMotionPaused(state.motionPaused);
    sparkle.setPaused(state.motionPaused);
    motionBtn.classList.toggle('is-active', state.motionPaused);
    motionText.textContent = state.motionPaused ? '恢复微动效' : '暂停微动效';
    motionGlyph.setAttribute(
      'd',
      state.motionPaused ? 'M10 8.5l6 3.5-6 3.5V8.5Z' : 'M10 9v6M14 9v6'
    );
    showToast(state.motionPaused ? '已暂停环境微动效' : '已恢复环境微动效');
  });

  window.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape' && salonScene.dismissInspectCard()) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape' && readingPanel.classList.contains('is-expanded')) setReadingExpanded(false);
    if (e.target === canvas && salonScene.mode === 'picking') {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        salonScene.stepKeyboardFocus(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        salonScene.stepKeyboardFocus(-1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        salonScene.confirmKeyboardPick();
      }
    }
  });
  setTimeout(tryOpen3D, 0);
}

bootDianaSalon();
