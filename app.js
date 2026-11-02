/* Cœur de l'application : état, navigation, accueil, leçons, révision, progrès, réglages. */
const U = window.CauUtil;
const E = window.PronEngine; E.setGlobal(window.PronGlobal);
const App = { state: null, course: [], pronUnits: [], engineOk: null, view: 'home', ctx: {} };
const DEFAULT = { biAudio: true, useSR: false, catalogs: [], ui: null, trans: 'vi', voice: 'f', viVoice: true, mic: '', profiles: [], current: null };
const AVATARS = ['🐱', '🐶', '🐰', '🦊', '🐼', '🐯', '🐸', '🦁', '🐵', '🐢', '🦉', '🐬'];

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
// La police d'emoji a des chiffres vides : les nombres utilisent la police normale.
const emo = (e, cls = '') => h('span', { class: (/^\d+$/.test(e) ? 'digit ' : 'emoji ') + cls, 'aria-hidden': 'true' }, e);
const T = () => I18N[App.state.ui || 'vi'];
const t = (k, ...a) => { const v = T()[k]; return typeof v === 'function' ? v(...a) : (v == null ? k : v); };
const prof = () => App.state.profiles.find(p => p.id === App.state.current);
const pick = o => (o ? (o[App.state.ui] || o.fr || o.vi || '') : '');
const gloss = o => { const l = App.state.trans; return l === 'none' ? '' : (o[l] || o.vi || o.en || ''); };
const isKid = () => { const p = prof(); return p && p.age < 6; };
const voice = () => (App.state.voice === 'm' ? 'a' : 'f');
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sample = (a, n) => shuffle(a).slice(0, n);
const today = () => new Date().toISOString().slice(0, 10);
let saveTimer; const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => window.cau.store.set(App.state), 150); };
function toast(msg) { document.querySelectorAll('.toast').forEach(x => x.remove()); const n = h('div', { class: 'toast', role: 'status' }, msg); document.body.append(n); setTimeout(() => n.remove(), 3500); }
const sayWord = (txt, slow) => Audio_.say(txt, voice(), U.SPEED.word, slow ? 0.8 : 1);
const sayVi = txt => Audio_.say(txt, 'v', 1);
const sayPhrase = (txt, slow) => Audio_.say(txt, voice(), U.SPEED.phrase, slow ? 0.8 : 1);
function viPrompt(k) { if (isKid() && App.state.viVoice) return Audio_.say(App.prompts[k], 'v', 1); return Promise.resolve(); }
App.prompts = { listen: 'Con hãy nghe nhé.', repeat: 'Con hãy nói theo nào.', choose: 'Con hãy chọn đúng hình nhé.', bravo: 'Giỏi lắm!', again: 'Con thử lại lần nữa nhé.', done: 'Con đã làm xong rồi. Tuyệt vời!' };
function touchDay() { const p = prof(); if (!p) return; const d = today(); if (p.lastDay !== d) { const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10); p.streak = p.lastDay === y ? (p.streak || 0) + 1 : 1; p.lastDay = d; save(); } }
const levelFor = age => (App.course.find(l => age >= l.age[0] && age <= l.age[1]) || App.course[age < 3 ? 0 : App.course.length - 1]).id;
const levelOf = () => App.course.find(l => l.id === (App.ctx.levelId || prof().level)) || App.course[0];

function mount(...nodes) { const root = document.getElementById('app'); root.replaceChildren(...nodes); }
function nav(view, ctx) { Audio_.stop(); App.view = view; if (ctx) Object.assign(App.ctx, ctx); render(); }
function shell(content) {
  const items = isKid()
    ? [['home', '🧸'], ['pron', '🗣️'], ['settings', '⚙️']]
    : [['home', '📖'], ['pron', '🗣️'], ['phrases', '💬'], ['review', '🔁'], ['library', '🌐'], ['progress', '🌟'], ['settings', '⚙️']];
  const rail = h('nav', { class: 'rail', 'aria-label': 'Menu' },
    h('div', { class: 'logo' }, 'Cầu', h('br'), 'Français'),
    items.map(([v, e], i) => [
      v === 'settings' ? h('div', { class: 'spacer' }) : null,
      h('button', { 'aria-current': App.view === v ? 'page' : null, onclick: () => (v === 'settings' && isKid() ? gate(() => nav(v)) : v === 'library' && prof().age < 13 ? gate(() => nav(v)) : nav(v)) }, emo(e), t(v)),
    ]));
  return h('div', { class: 'shell ' + (isKid() ? 'kids-mode' : '') }, rail, h('main', { class: 'main paper', tabindex: '-1' }, content));
}
function modal(build) { const back = h('div', { class: 'modal-back', role: 'dialog', 'aria-modal': 'true' }); const close = () => back.remove(); back.append(h('div', { class: 'modal' }, build(close))); document.body.append(back); const f = back.querySelector('input,button'); if (f) f.focus(); return close; }
/* Barrière parentale simple : empêche un jeune enfant d'accéder à Internet ou aux réglages. */
function gate(ok) {
  const a = 6 + Math.floor(Math.random() * 7), b = 3 + Math.floor(Math.random() * 7);
  modal(close => {
    const inp = h('input', { type: 'number', inputmode: 'numeric', 'aria-label': t('gateQ', a, b) }), err = h('p', { style: 'color:var(--son)', role: 'alert' });
    const go = () => { if (+inp.value === a * b) { close(); ok(); } else { err.textContent = t('gateNo'); inp.value = ''; inp.focus(); } };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    return [h('h2', {}, t('gateTitle')), h('p', {}, t('gateQ', a, b)), h('div', { class: 'field' }, inp), err, h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: go }, t('confirm')), h('button', { class: 'btn', onclick: close }, t('cancel')))];
  });
}

/* Accueil */
function allLessons(level) { return level.lessons; }
function viewHome() {
  const p = prof(), level = levelOf(), kid = isKid();
  const next = allLessons(level).find(l => !p.stars[l.id]);
  const page = h('div', { class: 'page' },
    h('h1', { class: 'page-title opaque' }, t('hello', p.name)),
    h('p', { class: 'sub opaque' }, pick(level.desc)),
    window.cau.platform === 'web' && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches && h('div', { class: 'install-tip' }, emo('📲'), h('span', {}, t('installTip'))),
    !kid && h('div', { class: 'level-tabs', role: 'group', 'aria-label': t('level') }, App.course.map(l => h('button', { 'aria-pressed': String(l.id === level.id), onclick: () => nav('home', { levelId: l.id }) }, emo(l.emoji), ' ', pick(l.title), ' ', h('small', {}, l.cefr)))),
    next && !kid && h('div', { class: 'continue' }, emo(next.emoji, 'pic'), h('div', { style: 'flex:1' }, h('h2', {}, pick(next.title)), h('p', {}, next.title.fr)), h('button', { class: 'btn primary', onclick: () => startLesson(next) }, t('continue'))),
    h('div', { class: 'path' }, allLessons(level).map((l, i) => {
      const s = p.stars[l.id] || 0;
      return h('button', { class: 'stone ' + (s ? 'done' : ''), onclick: () => startLesson(l) }, emo(l.emoji, 'pic'),
        h('span', {}, !kid && h('span', { class: 'n' }, `${t('lesson')} ${i + 1}`), h('div', { class: 'ttl' }, pick(l.title)), !kid && App.state.ui !== 'fr' && h('div', { class: 'fr' }, l.title.fr)), starNode(s));
    })));
  return page;
}
function starNode(n) { return h('span', { class: 'stars', 'aria-label': `${n}/3` }, [1, 2, 3].map(i => h('span', { class: i <= n ? '' : 'off' }, '★'))); }

/* Leçon : suite d'étapes */
function buildSteps(lesson) {
  const kid = isKid(), steps = [];
  for (const w of lesson.words) steps.push({ type: 'word', w });
  if (kid) {
    for (const w of sample(lesson.words, Math.min(5, lesson.words.length))) steps.push({ type: 'qPic', w, opts: lesson.words, mode: lesson.letters ? 'letter' : 'pic' });
    if (lesson.count) for (const w of sample(lesson.words, 3)) steps.push({ type: 'qPic', w, opts: lesson.words, mode: 'count', thing: lesson.count });
    for (const p of (lesson.phrases || []).slice(0, 1)) steps.push({ type: 'phrase', p });
    return steps;
  }
  for (const p of lesson.phrases || []) steps.push({ type: 'phrase', p });
  for (const g of lesson.grammar || []) steps.push({ type: 'grammar', g });
  const q = [];
  const pool = lesson.words;
  const distract = (w, f) => sample(pool.filter(x => f(x) !== f(w)), 3).map(f);
  for (const w of sample(pool, Math.min(pool.length, 6))) {
    const kind = Math.floor(Math.random() * 3);
    if (kind === 0) q.push({ type: 'quiz', prompt: 'qListenPick', audio: w.say || w.fr, answer: w.fr, options: shuffle([w.fr, ...distract(w, x => x.fr)]) });
    else if (kind === 1 && gloss(w)) q.push({ type: 'quiz', prompt: 'qWordToTr', show: w.fr, audio: w.say || w.fr, answer: gloss(w), options: shuffle([gloss(w), ...distract(w, gloss)]) });
    else q.push({ type: 'quiz', prompt: 'qTrToWord', show: gloss(w) || w.en, answer: w.fr, sayOf: { [w.fr]: w.say }, audio: null, options: shuffle([w.fr, ...distract(w, x => x.fr)]) });
  }
  // Phrases : du vietnamien au français et inversement, puis à l'oral.
  const ph = (lesson.phrases || []).filter(x => x.vi && x.fr);
  if (ph.length >= 3) {
    const [a, b] = sample(ph, 2);
    q.push({ type: 'quiz', wide: true, prompt: 'qViToFr', show: a.vi, showVi: a.vi, answer: a.fr, sayOf: { [a.fr]: a.fr }, options: shuffle([a.fr, ...sample(ph.filter(x => x !== a), 3).map(x => x.fr)]), phrase: true });
    q.push({ type: 'quiz', wide: true, prompt: 'qFrToVi', show: b.fr, phraseAudio: b.fr, answer: b.vi, options: shuffle([b.vi, ...sample(ph.filter(x => x !== b), 3).map(x => x.vi)]), phrase: true });
    q.push({ type: 'sayFr', p: sample(ph, 1)[0] });
  }
  for (const p of sample((lesson.phrases || []).filter(x => x.fr.split(' ').length >= 3 && x.fr.split(' ').length <= 9), 2)) q.push({ type: 'order', p });
  return steps.concat(q);
}
function startLesson(lesson) { touchDay(); App.ctx.lesson = lesson; App.ctx.steps = buildSteps(lesson); App.ctx.idx = 0; App.ctx.right = 0; App.ctx.total = App.ctx.steps.filter(s => ['quiz', 'order', 'qPic'].includes(s.type)).length; nav('lesson'); }
function nextStep() { Audio_.stop(); App.ctx.idx++; render(); }
function learnWord(fr, wordObj) {
  const p = prof(); if (!p.words[fr]) { p.words[fr] = { box: 0, due: Date.now() + 864e5, vi: wordObj.vi, en: wordObj.en, e: wordObj.e, say: wordObj.say }; save(); }
}
function viewLesson() {
  const { lesson, steps, idx } = App.ctx;
  const top = h('div', { class: 'lesson-top' },
    h('button', { class: 'btn quiet', onclick: () => nav('home') }, '✕ ', t('close')),
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': idx, 'aria-valuemax': steps.length }, h('i', { style: `width:${Math.round(100 * idx / steps.length)}%` })),
    h('span', { style: 'color:var(--ink-soft)' }, `${Math.min(idx + 1, steps.length)}/${steps.length}`));
  if (idx >= steps.length) return h('div', {}, finishLesson(lesson));
  const s = steps[idx];
  const stage = h('div', { class: 'stage' });
  if (s.type === 'word') stepCard(stage, s.w.fr, s.w, true);
  else if (s.type === 'phrase') stepCard(stage, s.p.fr, s.p, false);
  else if (s.type === 'grammar') stepGrammar(stage, s.g);
  else if (s.type === 'quiz') stepQuiz(stage, s);
  else if (s.type === 'qPic') stepPic(stage, s);
  else if (s.type === 'order') stepOrder(stage, s);
  else if (s.type === 'sayFr') stepSayFr(stage, s.p);
  return h('div', {}, top, stage);
}
function stepCard(stage, fr, obj, isWord) {
  const kid = isKid();
  if (isWord) learnWord(fr, obj);
  const spoken = obj.say || fr;
  const speakFn = (slow) => (isWord ? sayWord(spoken, slow) : sayPhrase(spoken, slow));
  if (obj.e) stage.append(emo(obj.e, 'word-pic'));
  stage.append(h('div', { class: isWord ? 'word-fr' : 'phrase-fr opaque' }, fr));
  if (!isWord && obj.vi) stage.append(h('div', { class: 'gloss', lang: 'vi' }, obj.vi));
  if (!isWord && App.state.trans === 'en' && obj.en) stage.append(h('div', { class: 'gloss minor' }, obj.en));
  if (isWord && gloss(obj)) stage.append(h('div', { class: 'gloss' }, gloss(obj)));
  stage.append(h('div', { class: 'control-row' },
    h('div', { class: 'ctl' }, h('button', { class: 'round', 'aria-label': 'Français', onclick: () => speakFn(false) }, emo('🔊')), 'Français'),
    obj.vi && !kid && h('div', { class: 'ctl' }, h('button', { class: 'round', 'aria-label': 'Tiếng Việt', onclick: () => sayVi(obj.vi) }, emo('🔊')), 'Tiếng Việt'),
    !kid && h('div', { class: 'ctl' }, h('button', { class: 'round', 'aria-label': t('slow'), onclick: () => speakFn(true) }, emo('🐢')), t('slow'))));
  const fb = h('div', { style: 'display:contents' });
  stage.append(window.Practice.micButton({ text: spoken, kind: isWord && !obj.say ? 'word' : 'sentence', out: fb }));
  stage.append(fb);
  stage.append(h('button', { class: 'btn primary', onclick: nextStep }, t('next')));
  const here = App.ctx.steps[App.ctx.idx];
  const viFirst = !kid && !isWord && obj.vi && App.state.biAudio ? sayVi(obj.vi) : Promise.resolve();
  (kid ? viPrompt('listen') : viFirst).then(() => App.ctx.steps[App.ctx.idx] === here && speakFn(false)).then(() => { if (kid && isWord && App.state.viVoice && App.view === 'lesson' && App.ctx.steps[App.ctx.idx] === here) Audio_.say(obj.vi, 'v', 1); });
}
function stepGrammar(stage, g) {
  stage.append(h('div', { class: 'note' }, h('h2', {}, pick(g.t)), h('p', {}, pick(g.b)),
    g.ex.map(e => h('div', { class: 'ex' }, h('button', { class: 'small-play', 'aria-label': t('listen'), onclick: () => (App.state.biAudio && e.vi ? sayVi(e.vi).then(() => sayPhrase(e.fr)) : sayPhrase(e.fr)) }, emo('🔊')), h('div', {}, h('b', {}, e.fr), h('div', { lang: 'vi' }, e.vi || gloss(e)))))));
  stage.append(h('button', { class: 'btn primary', onclick: nextStep }, t('next')));
}
function answered(stage, ok, answer) {
  if (ok) App.ctx.right++;
  if (!isKid()) stage.append(h('div', { class: 'feedback ' + (ok ? 'good' : 'bad'), role: 'status' }, h('div', { class: 'msg' }, ok ? t('correct') : `${t('wrong')} ${answer}`)));
  else viPrompt(ok ? 'bravo' : 'again');
  stage.append(h('button', { class: 'btn primary', onclick: nextStep }, t('next')));
}
/* Écouter en vietnamien, dire en français, puis vérifier. */
function stepSayFr(stage, p) {
  const fb = h('div', { style: 'display:contents' }); let shown = false;
  stage.append(h('div', { class: 'q-prompt' }, t('sayInFr')), h('div', { class: 'phrase-fr', lang: 'vi' }, p.vi),
    h('button', { class: 'round', 'aria-label': 'Tiếng Việt', onclick: () => sayVi(p.vi) }, emo('🔊')),
    window.Practice.micButton({ text: p.fr, kind: 'sentence', out: fb, onResult: () => reveal() }), fb);
  const ans = h('div', { style: 'display:contents' });
  const reveal = () => { if (shown) return; shown = true; btn.remove(); ans.append(h('div', { class: 'phrase-fr' }, p.fr), h('button', { class: 'round', 'aria-label': 'Français', onclick: () => sayPhrase(p.fr) }, emo('🔊'))); sayPhrase(p.fr); };
  const btn = h('button', { class: 'btn', onclick: reveal }, t('show'));
  stage.append(btn, ans, h('button', { class: 'btn primary', onclick: nextStep }, t('next')));
  sayVi(p.vi);
}
function stepQuiz(stage, s) {
  stage.append(h('div', { class: 'q-prompt' }, t(s.prompt)));
  if (s.phrase) { if (s.show) stage.append(h('div', { class: 'phrase-fr', lang: s.showVi ? 'vi' : 'fr' }, s.show)); if (s.phraseAudio) stage.append(h('button', { class: 'round', 'aria-label': t('listen'), onclick: () => sayPhrase(s.phraseAudio) }, emo('🔊'))); if (s.showVi) sayVi(s.showVi); else sayPhrase(s.phraseAudio); }
  else if (s.show) stage.append(h('div', { class: 'word-fr', style: 'font-size:44px;line-height:56px' }, s.show));
  if (s.audio) stage.append(h('button', { class: 'round', 'aria-label': t('listen'), onclick: () => sayWord(s.audio) }, emo('🔊')));
  const box = h('div', { class: 'choices' + (s.wide ? ' wide' : '') }); let done = false;
  for (const o of s.options) {
    const b = h('button', { class: 'choice', onclick: () => {
      if (done) return; done = true; const ok = o === s.answer;
      b.classList.add(ok ? 'correct' : 'wrong'); [...box.children].forEach(c => { if (c.textContent === s.answer) c.classList.add('correct'); });
      answered(stage, ok, s.answer);
      if (s.prompt === 'qViToFr') sayPhrase(s.answer); else if (s.prompt !== 'qWordToTr' && s.prompt !== 'qFrToVi' && !s.audio) sayWord((s.sayOf && s.sayOf[s.answer]) || s.answer);
    } }, o);
    box.append(b);
  }
  stage.append(box);
  if (s.audio) sayWord(s.audio);
}
/* Jeu des petits : écouter puis choisir une image ou une lettre, ou compter des objets. */
const numberOf = w => { const n = parseInt(w.e, 10); return Number.isNaN(n) ? 10 : n; };
function stepPic(stage, s) {
  const key = o => (s.mode === 'letter' ? o.fr : o.e);
  const opts = shuffle([s.w, ...sample(s.opts.filter(x => x.fr !== s.w.fr && key(x) !== key(s.w)), 3)]);
  const say = () => sayWord(s.mode === 'letter' ? s.w.name : s.w.fr);
  if (s.mode === 'count') stage.append(h('div', { class: 'count-box', role: 'img', 'aria-label': String(numberOf(s.w)) }, Array.from({ length: numberOf(s.w) }, () => emo(s.thing))));
  else stage.append(h('button', { class: 'round', style: 'width:96px;height:96px;font-size:42px', 'aria-label': t('listen'), onclick: say }, emo('🔊')));
  const box = h('div', { class: 'choices' }); let done = false, missed = false;
  for (const o of opts) {
    const b = h('button', { class: 'choice pic', 'aria-label': o.fr, onclick: async () => {
      if (done) return;
      if (o.fr !== s.w.fr) { missed = true; b.classList.add('wrong'); b.disabled = true; viPrompt('again').then(() => (s.mode === 'count' ? null : say())); return; }
      done = true; b.classList.add('correct'); if (!missed) App.ctx.right++;
      await say(); await viPrompt('bravo'); nextIfSame(s)();
    } }, emo(key(o)));
    box.append(b);
  }
  stage.append(box);
  viPrompt('choose').then(() => { if (s.mode !== 'count' && App.ctx.steps[App.ctx.idx] === s) say(); });
}
const nextIfSame = s => () => { if (App.ctx.steps[App.ctx.idx] === s) nextStep(); };
function stepOrder(stage, s) {
  stage.append(h('div', { class: 'q-prompt' }, t('qOrder')));
  if (gloss(s.p)) stage.append(h('div', { class: 'gloss' }, gloss(s.p)));
  const target = s.p.fr.split(' '); const chosen = [];
  const line = h('div', { class: 'tokens answer-line', 'aria-live': 'polite' }), pool = h('div', { class: 'tokens' });
  const check = h('button', { class: 'btn primary', disabled: true }, t('check'));
  const add = (w, btn) => { btn.disabled = true; btn.style.visibility = 'hidden'; const ch = h('button', { class: 'token', onclick: () => { chosen.splice(chosen.indexOf(entry), 1); ch.remove(); btn.disabled = false; btn.style.visibility = ''; check.disabled = chosen.length !== target.length; } }, w); const entry = { w }; chosen.push(entry); line.append(ch); check.disabled = chosen.length !== target.length; };
  let order = shuffle(target.map((w, i) => ({ w, i })));
  if (order.every((x, i) => x.i === i)) order = order.reverse();
  order.forEach(({ w }) => { const b = h('button', { class: 'token', onclick: () => add(w, b) }, w); pool.append(b); });
  check.addEventListener('click', () => {
    const got = chosen.map(c => c.w).join(' ').toLowerCase() === s.p.fr.toLowerCase();
    check.remove(); pool.remove(); answered(stage, got, s.p.fr); sayPhrase(s.p.fr);
  });
  stage.append(line, pool, check);
}
function finishLesson(lesson) {
  const { right, total } = App.ctx, p = prof();
  const ratio = total ? right / total : 1, n = ratio >= 0.9 ? 3 : ratio >= 0.6 ? 2 : 1;
  p.stars[lesson.id] = Math.max(p.stars[lesson.id] || 0, n); save(); if (isKid()) viPrompt('done');
  return h('div', { class: 'stage' }, h('div', { class: 'result' },
    h('div', { class: 'big-stars', 'aria-label': `${n}/3` }, [1, 2, 3].map(i => h('span', { class: i <= n ? '' : 'off' }, '★'))),
    h('h1', { class: 'opaque' }, t('lessonDone')), total > 0 && !isKid() && h('p', { class: 'opaque' }, t('score', right, total)),
    h('div', { class: 'row', style: 'justify-content:center' }, h('button', { class: 'btn', onclick: () => startLesson(lesson) }, t('again')), h('button', { class: 'btn primary', onclick: () => nav('home') }, t('toPath')))));
}

/* Phrases vietnamien-français : parcourir, se tester, écouter en continu. */
let phrasePlay = null;
function viewPhrases() {
  const level = levelOf(), lessons = level.lessons.filter(l => (l.phrases || []).length);
  const pos = lessons.findIndex(l => l.id === App.ctx.phraseLesson), lesson = pos >= 0 ? lessons[pos] : null;
  const list = lesson ? lesson.phrases : lessons.flatMap(l => l.phrases), mode = App.ctx.phraseMode || 'both';
  const rows = list.map(p => {
    const row = h('div', { class: 'pair' }); let open = false;
    const hideFr = mode === 'hideFr', hideVi = mode === 'hideVi';
    const fr = h('div', { class: 'pair-fr' + (hideFr ? ' masked' : ''), role: hideFr ? 'button' : null, tabindex: hideFr ? '0' : null, onclick: e => { e.currentTarget.classList.remove('masked'); sayPhrase(p.fr); } }, p.fr);
    const vi = h('div', { class: 'pair-vi' + (hideVi ? ' masked' : ''), lang: 'vi', role: hideVi ? 'button' : null, tabindex: hideVi ? '0' : null, onclick: e => { e.currentTarget.classList.remove('masked'); sayVi(p.vi); } }, p.vi);
    const fb = h('div', { style: 'display:contents' }); const micHost = h('div', {});
    row.append(h('div', { class: 'pair-btns' }, h('button', { class: 'small-play', 'aria-label': 'Français', title: 'Français', onclick: () => sayPhrase(p.fr) }, 'FR'), h('button', { class: 'small-play', 'aria-label': 'Tiếng Việt', title: 'Tiếng Việt', onclick: () => sayVi(p.vi) }, 'VI'), h('button', { class: 'small-play', 'aria-label': t('speak'), onclick: () => { open = !open; micHost.replaceChildren(...(open ? [window.Practice.micButton({ text: p.fr, kind: 'sentence', out: fb })] : [])); if (!open) fb.replaceChildren(); } }, emo('🎙️'))),
      h('div', { class: 'pair-text' }, fr, vi), micHost, fb);
    return { row, p };
  });
  const playBtn = h('button', { class: 'btn primary', onclick: async () => {
    if (phrasePlay) { phrasePlay.stop = true; Audio_.stop(); phrasePlay = null; playBtn.textContent = t('playAll'); return; }
    const me = phrasePlay = { stop: false }; playBtn.textContent = t('stop');
    const wait = ms => new Promise(r => setTimeout(r, ms));
    for (const { row, p } of rows) {
      if (me.stop || !row.isConnected) break;
      row.classList.add('current'); row.scrollIntoView({ block: 'center', behavior: 'auto' });
      await sayVi(p.vi); if (me.stop) break; await wait(500);
      await sayPhrase(p.fr); if (me.stop) break; await wait(1200);
      await sayPhrase(p.fr, true); if (me.stop) break; await wait(900);
      row.classList.remove('current');
    }
    if (phrasePlay === me) { phrasePlay = null; if (playBtn.isConnected) playBtn.textContent = t('playAll'); }
  } }, t('playAll'));
  return h('div', { class: 'page' }, h('h1', { class: 'page-title opaque' }, t('phrasesTitle')), h('p', { class: 'sub opaque' }, t('phrasesSub')),
    h('div', { class: 'level-tabs', role: 'group' }, App.course.map(l => h('button', { 'aria-pressed': String(l.id === level.id), onclick: () => nav('phrases', { levelId: l.id, phraseLesson: null }) }, emo(l.emoji), ' ', pick(l.title)))),
    h('div', { class: 'pair-tools' },
      h('select', { 'aria-label': t('lesson'), onchange: e => nav('phrases', { phraseLesson: e.target.value || null }) }, h('option', { value: '' }, t('allLessons')), lessons.map(l => h('option', { value: l.id, selected: lesson && l.id === lesson.id }, pick(l.title)))),
      h('select', { 'aria-label': t('phraseMode'), onchange: e => nav('phrases', { phraseMode: e.target.value }) }, [['both', 'modeBoth'], ['hideFr', 'modeHideFr'], ['hideVi', 'modeHideVi']].map(([v, k]) => h('option', { value: v, selected: v === mode }, t(k)))),
      playBtn),
    mode !== 'both' && h('p', { class: 'opaque', style: 'margin-bottom:10px' }, t('tapReveal')),
    h('div', { class: 'pair-list' }, rows.map(r => r.row)));
}

/* Révision espacée : boîtes de Leitner */
const BOX_DAYS = [1, 2, 4, 8, 16, 32, 64];
function viewReview() {
  const p = prof(), now = Date.now(), due = Object.entries(p.words).filter(([, w]) => w.due <= now).sort((a, b) => a[1].due - b[1].due);
  const page = h('div', { class: 'page' }, h('h1', { class: 'page-title opaque' }, t('reviewTitle')), h('p', { class: 'sub opaque' }, due.length ? t('reviewCount', due.length) : t('reviewSub')));
  if (!due.length) { page.append(h('div', { class: 'notice' }, t('reviewEmpty'))); return page; }
  const [fr, w] = due[0];
  const stage = h('div', { class: 'stage' }); if (w.e) stage.append(emo(w.e, 'word-pic'));
  const tr = gloss(w) || w.vi || '';
  stage.append(h('div', { class: 'gloss' }, tr));
  const reveal = h('div', { class: 'control-row' }, h('button', { class: 'btn primary', onclick: () => {
    reveal.remove(); stage.append(h('div', { class: 'word-fr' }, fr)); sayWord(w.say || fr);
    const grade = up => { w.box = up ? Math.min(w.box + 1, BOX_DAYS.length - 1) : 0; w.due = Date.now() + BOX_DAYS[w.box] * 864e5; if (!up) w.due = Date.now() + 6e5; save(); render(); };
    const fb = h('div', { style: 'display:contents' });
    stage.append(window.Practice.micButton({ text: w.say || fr, kind: w.say ? 'sentence' : 'word', out: fb }), fb, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => grade(false) }, t('dontKnow')), h('button', { class: 'btn primary', onclick: () => grade(true) }, t('know'))));
  } }, t('show')));
  stage.append(reveal); page.append(stage);
  return page;
}

/* Progrès */
function viewProgress() {
  const p = prof(), stars = Object.values(p.stars).reduce((a, b) => a + b, 0);
  return h('div', { class: 'page' }, h('h1', { class: 'page-title opaque' }, t('progTitle')),
    h('p', { class: 'sub opaque' }, p.name),
    h('div', { class: 'grid-stats' }, [[p.streak || 0, 'streak'], [stars, 'starsT'], [Object.keys(p.words).length, 'wordsT'], [Object.keys(p.stars).length, 'lessonsT']].map(([n, k]) => h('div', { class: 'stat' }, h('b', {}, n), t(k)))),
    h('section', { class: 'section' }, h('h2', {}, t('soundsT')), h('div', { class: 'list' }, App.pronUnits.map(u => {
      const r = p.pron[u.id];
      return h('div', { class: 'item' }, emo(u.emoji), h('div', { class: 'grow' }, h('div', { class: 't' }, pick(u.title)), r ? h('div', { class: 'meter', role: 'meter', 'aria-valuenow': r.avg, 'aria-valuemax': 100 }, h('i', { style: `width:${r.avg}%` })) : h('div', { class: 'd' }, t('notYet'))), r ? `${r.avg}/100` : '');
    }))));
}

/* Réglages */
function viewSettings() {
  const s = App.state;
  const sel = (label, val, opts, on) => h('div', { class: 'field' }, h('label', {}, label), h('select', { onchange: e => on(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l))));
  const micSel = h('select', { onchange: e => { s.mic = e.target.value; save(); } }, h('option', { value: '' }, t('micDefault')));
  navigator.mediaDevices.enumerateDevices().then(ds => ds.filter(d => d.kind === 'audioinput' && d.deviceId !== 'default').forEach((d, i) => micSel.append(h('option', { value: d.deviceId, selected: d.deviceId === s.mic }, d.label || `Micro ${i + 1}`)))).catch(() => {});
  const micMsg = h('div', { role: 'status', style: 'display:grid;gap:6px' }), bar = h('i', { style: 'width:0%' });
  const test = async () => {
    micMsg.replaceChildren(t('micPrep')); bar.style.width = '0%';
    try {
      const d = await Audio_.record({ deviceId: s.mic, maxMs: 5000, silenceMs: 1000, noSpeechMs: 5000, onReady: () => micMsg.replaceChildren(t('micSay')), onLevel: l => { bar.style.width = Math.round(l * 100) + '%'; } }).done;
      bar.style.width = '0%';
      const db = v => (v > 1e-6 ? Math.round(20 * Math.log10(v)) : -120);
      const verdict = d.peak < 1e-5 ? 'micMuted' : !d.spoke ? 'noSpeech' : d.peak > 0.98 ? 'clipped' : d.peak < 0.03 ? 'micLow' : d.peak / Math.max(d.floor, 1e-5) < 8 ? 'noisy' : 'micOk';
      micMsg.replaceChildren(h('b', {}, t(verdict)), h('small', { style: 'color:var(--ink-soft)' }, `${d.label || '?'}, ${t('micPeak')} ${db(d.peak)} dB, ${t('micFloor')} ${db(d.floor)} dB, ${Math.round(d.sr / 1000)} kHz, ${t(App.engineOk ? 'engineOk' : 'engineBad')}`));
      if (d.spoke) { const r = E.prepare(d.pcm, d.sr); if (r.pcm.length) Audio_.playPcm(r.pcm, E.SR); }
    } catch (e) { micMsg.replaceChildren(h('b', {}, window.Practice.micError(e))); }
  };
  const engine = h('span', {}, App.engineOk ? t('engineOk') : t('engineBad'));
  return h('div', { class: 'page' }, h('h1', { class: 'page-title opaque' }, t('setTitle')),
    h('div', { class: 'form' },
      sel(t('uiLang'), s.ui, Object.keys(I18N).map(k => [k, I18N[k].langName]), v => { s.ui = v; document.documentElement.lang = v; save(); render(); }),
      sel(t('transLang'), s.trans, [['vi', 'Tiếng Việt'], ['en', 'English'], ['none', t('none')]], v => { s.trans = v; save(); }),
      sel(t('voice'), s.voice, [['f', t('voiceF')], ['m', t('voiceM')]], v => { s.voice = v; save(); sayWord('bonjour'); }),
      sel(t('biAudio'), s.biAudio ? 'y' : 'n', [['y', t('on')], ['n', t('off')]], v => { s.biAudio = v === 'y'; save(); }),
      window.cau.platform === 'web' && window.Practice.hasSR() && sel(t('srOpt'), s.useSR ? 'y' : 'n', [['n', t('off')], ['y', t('on')]], v => { if (v === 'y') window.Practice.enableSR(); else { s.useSR = false; save(); render(); } }),
      window.cau.platform === 'web' && window.Practice.hasSR() && h('p', { style: 'font-size:14px;color:var(--ink-soft)' }, t('srHelp')),
      sel(t('viVoice'), s.viVoice ? 'y' : 'n', [['y', t('on')], ['n', t('off')]], v => { s.viVoice = v === 'y'; save(); }),
      sel(t('level'), prof().level, App.course.map(l => [l.id, `${pick(l.title)} (${l.age[0]}–${l.age[1]})`]), v => { prof().level = v; App.ctx.levelId = v; save(); }),
      h('div', { class: 'field' }, h('label', {}, t('micSel')), micSel), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: test }, t('testBtn'))), h('div', { class: 'meter', style: 'height:14px' }, bar), micMsg),
    h('section', { class: 'section' }, h('h2', {}, t('profiles')), h('div', { class: 'list' }, s.profiles.map(p => h('div', { class: 'item' }, emo(p.avatar), h('div', { class: 'grow t' }, `${p.name} (${p.age})`),
      p.id !== s.current && h('button', { class: 'btn', onclick: () => { s.current = p.id; App.ctx.levelId = null; save(); nav('home'); } }, t('switchP')),
      s.profiles.length > 1 && h('button', { class: 'btn quiet', onclick: () => confirmBox(t('confirmDel', p.name), () => { s.profiles = s.profiles.filter(x => x.id !== p.id); if (s.current === p.id) s.current = s.profiles[0].id; save(); render(); }) }, t('removeP'))))),
      h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: () => viewProfileForm(true) }, t('addProfile')))),
    h('section', { class: 'section' }, h('h2', {}, t('dataT')), h('div', { class: 'row', style: 'background:var(--paper)' }, h('button', { class: 'btn', onclick: () => window.cau.store.exportTo(s) }, t('exportB')), h('button', { class: 'btn', onclick: async () => { const v = await window.cau.store.importFrom(); if (v && Array.isArray(v.profiles)) { App.state = Object.assign({}, DEFAULT, v); save(); render(); } } }, t('importB')))),
    h('section', { class: 'section' }, h('h2', {}, t('creditsT')), h('div', { style: 'background:var(--paper);display:grid;gap:8px' }, h('p', {}, t('privacy')), s.useSR && h('p', {}, t('srHelp')), h('p', {}, engine), h('p', { style: 'font-size:14px;color:var(--ink-soft)' }, CREDITS))));
}
function confirmBox(msg, ok) { modal(close => [h('p', {}, msg), h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => { close(); ok(); } }, t('confirm')), h('button', { class: 'btn', onclick: close }, t('cancel')))]); }

/* Démarrage */
function viewLangPick() {
  mount(h('div', { class: 'welcome paper' }, h('div', { class: 'welcome-box' }, h('h1', {}, 'Cầu Français'),
    h('div', { class: 'lang-grid' }, Object.keys(I18N).map(k => h('button', { class: 'lang-btn', lang: k, onclick: () => { App.state.ui = k; document.documentElement.lang = k; save(); render(); } }, I18N[k].langName))))));
}
function viewProfileForm(extra) {
  let avatar = AVATARS[0];
  const name = h('input', { id: 'pname', placeholder: t('namePh'), autocomplete: 'off', maxlength: 24 }), age = h('input', { id: 'page', type: 'number', min: 2, max: 99, value: 8 });
  const avs = h('div', { class: 'avatars', role: 'group', 'aria-label': t('avatar') }, AVATARS.map((a, i) => h('button', { type: 'button', 'aria-pressed': String(i === 0), onclick: e => { avatar = a; [...avs.children].forEach(c => c.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); } }, emo(a))));
  const go = () => {
    const n = name.value.trim(); if (!n) { name.focus(); return; }
    const a = Math.max(2, Math.min(99, +age.value || 8));
    const p = { id: 'p' + Date.now().toString(36), name: n, avatar, age: a, level: levelFor(a), stars: {}, words: {}, pron: {}, streak: 0, lastDay: null };
    App.state.profiles.push(p); App.state.current = p.id; App.ctx.levelId = null; save(); nav('home');
  };
  mount(h('div', { class: 'welcome paper' }, h('div', { class: 'welcome-box' }, h('h1', {}, t('profileTitle')),
    h('div', { class: 'field' }, h('label', { for: 'pname' }, t('name')), name), h('div', { class: 'field' }, h('label', { for: 'page' }, t('age')), age),
    h('div', { class: 'field' }, h('span', { class: 'lbl' }, t('avatar')), avs),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: go }, t('start')), extra && h('button', { class: 'btn', onclick: () => nav('settings') }, t('cancel'))))));
  name.focus();
}

function render() {
  const s = App.state;
  if (App.view === 'lesson' || App.view === 'pronUnit' || App.view === 'review') window.Practice.prewarm();
  if (!s.ui) return viewLangPick();
  document.documentElement.lang = s.ui;
  if (!prof()) return viewProfileForm(false);
  const v = App.view;
  if (v === 'lesson') { mount(h('div', { class: 'paper', style: 'height:100%;overflow:auto' }, viewLesson())); return; }
  if (v === 'pronUnit') { mount(h('div', { class: 'paper', style: 'height:100%;overflow:auto' }, window.Practice.viewUnit())); return; }
  if (v === 'reader') { mount(shell(window.Library.viewReader())); return; }
  const c = { phrases: viewPhrases, home: viewHome, pron: () => window.Practice.viewList(), review: viewReview, library: () => window.Library.view(), progress: viewProgress, settings: viewSettings }[v] || viewHome;
  mount(shell(c()));
}

(async function boot() {
  if (window.cauWebTexts) window.cauWebTexts();
  let saved = null; try { saved = await window.cau.store.get(); } catch (e) { console.warn('stockage', e); }
  App.state = Object.assign({}, DEFAULT, saved || {});
  const getJson = async f => { const r = await fetch(f); if (!r.ok) throw new Error(f + ' (' + r.status + ')'); return r.json(); };
  try { [App.course, App.pronUnits] = await Promise.all([getJson('course.json'), getJson('pron.json')]); }
  catch (e) { if (window.cauFail) window.cauFail(e.message); else console.error(e); return; }
  await Audio_.init();
  // Attend que practice.js et library.js soient chargés.
  await new Promise(r => setTimeout(r));
  render();
  window.cau.speech.check().then(r => { App.engineOk = r.ok; if (App.view === 'pron' || App.view === 'settings') render(); });
  addEventListener('keydown', e => { if (e.key === ' ' && e.target === document.body) e.preventDefault(); });
})();
