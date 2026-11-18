// Diana's Salon — 口语化连读叙事、零模板复读语法与语音伴读脚本引擎

import { CURATED_PAIR_READINGS, SPREAD_CONFIGS } from './cards-data.js';

export function detectQuestionFocus(question = '') {
  const q = question.trim();
  if (!q) return 'general';
  const workRe = /工作|职场|事业|跳槽|辞职|离职|offer|面试|老板|上司|同事|钱|收入|财运|创业|副业|项目|客户|考试|升职|加薪/i;
  const loveRe = /心动|喜欢|感情|恋爱|暧昧|复合|分手|冷战|结婚|婚姻|相亲|前任|约会|断联/;
  if (workRe.test(q)) return 'work';
  return loveRe.test(q) ? 'love' : 'general';
}

const CARD_TERMS = {
  love: '主动靠近|偶然的机会|距离与想念|共同生活|慢慢养成的感情|态度不明|试探与牵扯|告别|善意与欣赏|突然的决定|重复的争执|联系与对话|新的相处方式|权衡与保留|占有与保护|对未来的期待|相处方式的变化|信任和陪伴|情感边界|公开场合的相处|现实的阻力|双方的选择|细处的消耗|心意|承诺和约定|没说出口的事|文字和消息|对方的行动|对方的感受|从容和熟悉感|坦明的态度|思念与情绪|解开误会的办法|各自的自由度|安稳的相处|肩上的压力'.split('|'),
  work: '新消息|短期机会|外部市场|现有基础|长期成长|职责不清|复杂的人事|结束旧任务|认可与邀约|果断取舍|反复争执|沟通成本|新项目|利益与条件|资源与权限|长线规划|岗位变化|可靠同事|组织规则|团队协作|落地障碍|路线选择|时间与成本损耗|对工作的热情|合同与承诺|待核实的信息|书面沟通|关键执行者|关键决策者|经验与节奏|成果能见度|声誉与反馈|解法与权限|收入和流动资源|稳定积累|责任负担'.split('|'),
  general: '来信与动向|小机会|出行与变化|家与秩序|长期养成|信息模糊|复杂的牵扯|旧事收尾|礼物与善意|及时止损|反复摩擦|消息往来|新的尝试|动机与分寸|资源与边界|方向感|生活变动|可靠的支持|独处与界限|公共场合|眼前障碍|不同选择|小处的消耗|在意的事|约定与持续投入|未知信息|文字消息|相关当事人|相关当事人|从容与经验|清晰可见的进展|情绪和感受|打通关节的办法|可调配的资源|稳住节奏|眼前的负担'.split('|')
};

const WORK_PAIRS = {
  '24-25': '对手头工作的投入值得认真衡量。想继续做下去，先谈清职责、回报和双方能兑现的承诺。',
  '25-24': '先看看约定里还有多少可以调整的空间，再判断这份合作能否重新让你愿意投入。',
  '25-31': '把职责和交付标准写清楚，也让阶段成果更容易被看见。',
  '24-14': '你对这件事的投入是真实的，把口头条件和实际回报分开核实，会更容易判断值不值得。',
  '23-34': '把零碎支出和回款分别查一遍，找出持续吃掉预算的地方。',
  '27-14': '书面条件还有值得追问的地方，核对职责与交付细则后再答复。'
};

function cardTerm(card, focus) {
  return CARD_TERMS[focus]?.[card.id - 1] || card.noun;
}

function cardContext(card, focus) {
  if (focus === 'work') return card.work;
  if (focus === 'love') return card.love;
  return `「${card.zh}」指向${cardTerm(card, focus)}。想想近几天有没有一件具体小事，让你留意到这一点。`;
}

export function composePairMeaning(cardA, cardB, pairIdx = 0, kind = 'core', focus = 'general') {
  const key = `${cardA.id}-${cardB.id}`;
  const a = cardTerm(cardA, focus);
  const b = cardTerm(cardB, focus);
  const curated = focus === 'love' ? CURATED_PAIR_READINGS[key] : focus === 'work' ? WORK_PAIRS[key] : '';
  const byPosition = {
    mask_truth: `表面浮着的是${a}，更深一层要看${b}。`,
    past_now: `最早牵动这件事的是${a}，眼下更值得留意的是${b}。`,
    now_next: `眼下要看的还是${a}，往后多留意${b}。`,
    echo: `回看首尾，${a}与${b}相互呼应。`
  };
  const core = [
    `两张牌一起看，${a}会受到${b}的影响。`,
    `先看${a}，再看${b}给它带来的变化。`
  ];
  const bridge = byPosition[kind] || core[pairIdx % core.length];
  return `${bridge}${curated || (focus === 'general' ? '用手头已经发生的小事对照这一组牌，再决定眼下能做哪一步。' : cardContext(cardB, focus))}`;
}

function summarizeClimate(drawnCards, anchorCard, finalCard) {
  let warm = 0;
  let cool = 0;
  let shift = 0;
  for (const c of drawnCards) {
    if (c.tone.startsWith('暖调')) warm++;
    else if (c.tone.startsWith('冷调')) cool++;
    else if (c.tone.startsWith('变数')) shift++;
  }

  const first = drawnCards[0];
  const arcHint =
    drawnCards.length >= 3
      ? `牌面从「${first.zh}」一路推过「${anchorCard.zh}」，最后停在「${finalCard.zh}」上。`
      : `「${first.zh}」与「${finalCard.zh}」面对面摊在烛光底下。`;

  if (warm > cool && shift === 0) {
    return `${arcHint}这一局暖调居多，看看哪些地方还有余地，哪一步现在就能做。`;
  }
  if (warm > cool && shift > 0) {
    return `${arcHint}牌里暖意在线，但夹了一张催你拿主意的变数牌——局面不坏，只是没法再靠拖延混过去了。`;
  }
  if (cool > warm) {
    return `${arcHint}我得跟你讲实话，这一局风有点凉。牌没顺着你的期待说好听话，而是在提前替你指认暗礁，看清哪儿硌脚才不会踩空。`;
  }
  if (shift > 0) {
    return `${arcHint}正赶上换挡口，旧惯性快撑不住了，近期某件具体小事就会把那层窗户纸捅破。`;
  }
  return `${arcHint}牌气很稳、很克制，没有狗血的大起大落。事情正按现实逻辑一寸寸往前走，看行动比听口号准。`;
}

// 严格区分 anchorCard 与 finalCard 各自真实的冷暖属性，绝不张冠李戴
function buildActionChoices(anchorCard, finalCard, focus) {
  const anchorCool = anchorCard.tone.startsWith('冷调');
  const finalWarm = finalCard.tone.startsWith('暖调');

  if (focus === 'love') {
    return [
      {
        label: 'A · 如果我主动递个台阶',
        reply: finalWarm
          ? anchorCool
            ? `眼下虽然横着「${anchorCard.zh}」这点别扭，但落点在暖调的「${finalCard.zh}」上——递个轻巧自然的台阶是可以的，点到即止，别发长篇大论追问，对方接得住。`
            : `牌眼「${anchorCard.zh}」和落点「${finalCard.zh}」都给你托着底呢。大方发条轻松的消息约一下，不用端着架子硬憋，回应会比你想的温和。`
          : anchorCool
            ? `眼下牌眼压着「${anchorCard.zh}」，落点又停在「${finalCard.zh}」，这时候贸然扑上去很容易撞软钉子。真想联系，只聊有事说事的轻话题，千万别在今晚逼一个态度。`
            : `虽然眼下有「${anchorCard.zh}」这点缓和余地，但后面的「${finalCard.zh}」提醒你别一下子把期待拉太满。轻轻探一句口风就好，看清对方反应再决定走不走下一步。`
      },
      {
        label: 'B · 如果我先安静退半步',
        reply: finalWarm
          ? `退半步并不会把这段关系退凉。落点站在「${finalCard.zh}」上，底子还在，你越从容回去顾好自己的热闹生活，对方反而越容易先按捺不住。`
          : `退半步是今晚最体面也最聪明的选择。把原本准备耗在他身上的心力收回来睡个好觉，顺着「${finalCard.zh}」的节奏先把主动权攥回自己手里。`
      }
    ];
  }

  if (focus === 'general') {
    return [
      { label: 'A · 先试一小步', reply: `从「${anchorCard.zh}」提示的${cardTerm(anchorCard, focus)}入手，选一件今天做得完的小事，再看看「${finalCard.zh}」提示的变化。` },
      { label: 'B · 再观察一阵', reply: `给自己留一点时间，尤其留意${cardTerm(finalCard, focus)}有没有出现新的迹象。` }
    ];
  }

  return [
    {
      label: 'A · 如果我现在主动推一把',
      reply: finalWarm
        ? `值得推一把。最终落点「${finalCard.zh}」给你撑着腰，把诉求和条件大大方方摆在台面上谈，拿回来的结果不会差。`
        : anchorCool
          ? `眼下受「${anchorCard.zh}」掣肘，硬推大动作容易吃力不讨好。更建议先核对细节、留好书面凭据，等这阵逆风过去再发力。`
          : `借着眼下「${anchorCard.zh}」的势头可以先试探推进一小步，但因为后头跟着「${finalCard.zh}」，切记留个备选后手，别把筹码一次押光。`
    },
    {
      label: 'B · 如果我先稳住攒筹码',
      reply: `顺着节奏沉住气完全不亏（时间感约在：${finalCard.tempo}）。先把自己的护城河与现金流照顾妥帖，等风向对准了再出手更稳。`
    }
  ];
}

export function buildSalonReading(spreadId, drawnCards, rawQuestion = '', selectedFocus) {
  const config = SPREAD_CONFIGS[spreadId] || SPREAD_CONFIGS.line3;
  const question = rawQuestion.trim();
  const focus = ['love', 'work', 'general'].includes(selectedFocus) ? selectedFocus : detectQuestionFocus(question);

  const centerIdx = spreadId === 'line3' ? 1 : spreadId === 'box9' ? 4 : 0;
  const anchorCard = drawnCards[centerIdx] || drawnCards[0];
  const finalCard = drawnCards[drawnCards.length - 1];

  const focusLabel =
    focus === 'love' ? 'Diana · 情感切面' : focus === 'work' ? 'Diana · 事业与钱' : 'Diana · 夜沙龙手记';

  const anchorFocusText = cardContext(anchorCard, focus);

  const cardNotes = drawnCards.map((card, i) => {
    const pos = config.positions[i];
    const domainHint = cardContext(card, focus);
    return {
      slotIndex: i,
      slotLabel: pos.label,
      slotHint: pos.hint,
      card,
      domainHint
    };
  });

  const pairings = config.pairs.map((pairDef, idx) => {
    const cardA = drawnCards[pairDef.a];
    const cardB = drawnCards[pairDef.b];
    return {
      a: pairDef.a,
      b: pairDef.b,
      title: pairDef.title,
      formula: `${cardA.num} ${cardA.zh} × ${cardB.num} ${cardB.zh}`,
      text: composePairMeaning(cardA, cardB, idx, pairDef.kind || 'core', focus)
    };
  });

  const openingLine = question
    ? `你问我：「${question}」`
    : '你没把问题框死，让指尖替今晚的心事挑了这一局。';

  const climateLine = summarizeClimate(drawnCards, anchorCard, finalCard);

  const closingAdvice =
    anchorCard.id === finalCard.id
      ? `整局重心就落在「${anchorCard.zh}」上（应验节奏：${anchorCard.tempo}）。${anchorFocusText}`
      : `眼下最绕不开的牌眼是「${anchorCard.zh}」，顺着当前惯性往下走会停在「${finalCard.zh}」（节奏多在：${finalCard.tempo}）。${cardContext(finalCard, focus)}`;

  const actionChoices = buildActionChoices(anchorCard, finalCard, focus);

  // 为「听 Diana 轻读」准备的自然呼吸停顿口播稿
  const voiceClauses = [
    question ? `关于你问的这件事。` : `来看看你今晚抽到的这一局。`,
    climateLine,
    `落在核心位置的是，第${Number(anchorCard.num)}号牌，${anchorCard.zh}。${anchorFocusText}`,
    pairings[0] ? `连起来读，${pairings[0].text}` : '',
    pairings[1] ? `再往下看，${pairings[1].text}` : '',
    `最后留一句悄悄话给你：${closingAdvice}`
  ].filter(Boolean);

  return {
    spreadId: config.id,
    spreadName: `${config.roman} · ${config.name}`,
    question: question || '未署名的夜间心事',
    focus,
    focusLabel,
    openingLine,
    climateLine,
    anchorCard,
    anchorSlotLabel: config.positions[centerIdx]?.label || '核心牌眼',
    anchorFocusText,
    pairings,
    cardNotes,
    actionChoices,
    closingAdvice,
    voiceClauses,
    timestamp: new Date().toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  };
}
