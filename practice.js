/* Prononciation : parcours par son, micro, correction. */
window.Practice = (() => {
  const REF_VOICES = ['f', 'a', 'b'];
  const MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a3.5 3.5 0 0 0-3.5 3.5v6a3.5 3.5 0 0 0 7 0v-6A3.5 3.5 0 0 0 12 2zm-7 9.5h2a5 5 0 0 0 10 0h2a7 7 0 0 1-6 6.9V21h3v2H8v-2h3v-2.6a7 7 0 0 1-6-6.9z"/></svg>';
  const STOP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>';
  /* Références natives enregistrées si elles existent ; sinon voix locale (textes téléchargés). */
  async function refsFor(text, speeds) {
    for (const sp of speeds) {
      const vs = REF_VOICES.filter(v => Audio_.has(v, sp, text));
      if (vs.length) { const out = []; for (const v of vs) { const p = await Audio_.pcmOf(v, sp, text); if (p) out.push(p); } if (out.length) return out; }
    }
    if (!App.engineOk) return [];
    const p = await Audio_.pcmOf('f', speeds[speeds.length - 1], text);
    return p ? [p] : [];
  }

  /* D'autres phrases ou mots de longueur voisine, pour une note qui ne dépend pas du micro. */
  async function impostorsFor(text, kind) {
    const lesson = App.ctx.lesson;
    const pool = kind === 'sentence'
      ? [...App.pronUnits.flatMap(u => u.sentences.map(s => s.fr)), ...((lesson && lesson.phrases) || []).map(p => p.fr)]
      : [...App.pronUnits.flatMap(u => u.drills.map(d => d.t)), ...((lesson && lesson.words) || []).map(w => w.fr)];
    const sp = kind === 'sentence' ? U.SPEED.phrase : U.SPEED.word;
    const c = [...new Set(pool)].filter(x => x !== text && Audio_.has('f', sp, x)).sort((a, b) => Math.abs(a.length - text.length) - Math.abs(b.length - text.length)).slice(0, 6);
    const out = []; for (const x of c.slice(0, 3)) { const p = await Audio_.pcmOf('f', sp, x); if (p) out.push(p); }
    return out;
  }
  /* Reconnaissance du téléphone (Safari/Chrome), seulement si l'utilisateur l'a activée. */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const srUsable = () => window.cau.platform === 'web' && App.state.useSR && SR && navigator.onLine && !isKid() && !App.srBroken;
  function listenOnline(onStart) {
    let rec; const done = new Promise((res, rej) => {
      rec = new SR(); rec.lang = 'fr-FR'; rec.interimResults = false; rec.continuous = false; rec.maxAlternatives = 5;
      let got = null; const limit = setTimeout(() => { try { rec.stop(); } catch {} setTimeout(() => { const x = new Error('timeout'); rej(x); }, 3000); }, 12000);
      rec.onstart = onStart;
      rec.onresult = e => { const r = e.results[e.results.length - 1]; got = Array.from(r, x => x.transcript); };
      rec.onerror = e => { clearTimeout(limit); const x = new Error(e.error); x.name = 'SpeechError'; rej(x); };
      rec.onend = () => { clearTimeout(limit); res(got); };
      rec.start();
    });
    return { done, stop: () => { try { rec.stop(); } catch {} } };
  }
  const ONLINE_A = { ok: true, quality: {}, durationRatio: 1, melody: null };
  async function evaluate(rec, text, kind, foil, tipUnit) {
    const speeds = kind === 'sentence' ? [U.SPEED.phrase] : [U.SPEED.drill, U.SPEED.word];
    const refs = await refsFor(text, speeds);
    if (!refs.length) return { a: { ok: false, quality: {} }, noRef: true };
    const foils = foil ? await refsFor(foil, speeds) : [];
    const impostors = foil ? [] : await impostorsFor(text, kind);
    await new Promise(r => setTimeout(r, 20));
    const a = E.analyze(rec, refs, foils, { fast: kind === 'sentence', cmn: kind === 'sentence', impostors });
    if (!a.ok) return { a };
    let hits = null, heard = null;
    if (App.engineOk) {
      try {
        // Le niveau est normalisé : un micro faible ne doit pas dégrader la reconnaissance.
        const clean = Float32Array.from(a.trimmed, v => v * 0.7);
        const withLimit = p => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('engine timeout')), 45000))]);
        if (kind === 'sentence') heard = await withLimit(window.cau.speech.recognize(clean));
        else {
          const words = foil ? [text, foil] : [text];
          hits = await withLimit(window.cau.speech.keywords(clean, words));
          // Voix d'enfant : on réessaie en ramenant la voix vers la zone du modèle.
          if (!hits.length && a.alpha !== 1) hits = await withLimit(window.cau.speech.keywords(E.warp(clean, a.alpha), words));
        }
        App.engineFails = 0;
      } catch (e) {
        console.warn(e);
        // Après deux échecs, on continue avec la comparaison des sons et on le dit à l'élève.
        App.engineFails = (App.engineFails || 0) + 1; if (App.engineFails >= 2) App.engineOk = false;
      }
    }
    const g = kind === 'sentence' ? E.gradeSentence(a, heard, text) : E.gradeWord(a, hits, text, foil);
    return { a, g, heard, refs, foil, tipUnit, text, kind };
  }

  function drawCurve(canvas, a) {
    const W = canvas.width = canvas.clientWidth * 2 || 1200, H = canvas.height = 192, g = canvas.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const plot = (arr, color, lw) => {
      g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath(); let pen = false;
      arr.forEach((v, i) => { const x = i / Math.max(1, arr.length - 1) * (W - 20) + 10; if (v == null) { pen = false; return; } const y = H / 2 - Math.max(-9, Math.min(9, v)) / 9 * (H / 2 - 12); pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true; });
      g.stroke();
    };
    g.strokeStyle = css.getPropertyValue('--ruler'); g.lineWidth = 2; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    plot(a.refContour, css.getPropertyValue('--jade').trim(), 6);
    plot(a.userContour, css.getPropertyValue('--son').trim(), 6);
  }

  function renderFeedback(out, r, rec) {
    out.replaceChildren();
    const kid = isKid();
    if (!r.a.ok) { out.append(h('div', { class: 'feedback bad', role: 'status' }, h('div', { class: 'msg' }, r.noRef ? t('noTts') : t('tooQuiet')))); if (kid) viPrompt('again'); return; }
    const { g, a } = r, v = g.verdict;
    if (kid) {
      const ok = v === 'good' || v === 'likely';
      out.append(h('div', { class: 'feedback ' + (ok ? 'good' : 'mid'), role: 'status' }, h('div', { class: 'head' }, h('div', { class: 'stars', style: 'font-size:44px' }, ok ? '★★★' : '★★'), h('div', { class: 'msg', style: 'font-size:22px' }, ok ? t('kidGood') : t('kidTry')))));
      viPrompt(ok ? 'bravo' : 'again');
      return;
    }
    const cls = v === 'good' ? 'good' : v === 'likely' || v === 'unsure' ? 'mid' : 'bad';
    const msg = v === 'good' ? t('vGood') : v === 'likely' ? t('vLikely') : v === 'unsure' ? t('vUnsure') : v === 'foil' ? t('vFoil', r.foil) : t('vLikelyFoil', r.foil);
    const box = h('div', { class: 'feedback ' + cls, role: 'status' }, h('div', { class: 'head' }, g.score != null && h('div', { class: 'grade', 'aria-label': `${g.score}/100` }, g.score), h('div', { class: 'msg' }, msg)));
    if ((v === 'foil' || v === 'likelyFoil' || v === 'unsure') && r.tipUnit) box.append(h('p', {}, pick(r.tipUnit.fix)));
    if (g.compare) box.append(h('div', {}, g.compare.words.map((w, i) => [h('span', g.compare.ok[i] ? { class: 'heard-word ok' } : { class: 'heard-word no', role: 'button', tabindex: '0', title: t('listen'), onclick: () => Audio_.say(w, voice(), U.SPEED.word) }, w), ' '])));
    if (a.quality.low) box.append(h('p', {}, t('micLow')));
    if (a.quality.noisy) box.append(h('p', {}, t('noisy')));
    if (a.quality.clipped) box.append(h('p', {}, t('clipped')));
    if (a.durationRatio < 0.6) box.append(h('p', {}, t('tooFast')));
    else if (a.durationRatio > 2.2) box.append(h('p', {}, t('tooSlow')));
    if (r.kind === 'sentence' && a.refContour) {
      if (a.melody != null && a.melody > 5) box.append(h('p', {}, t('melodyFlat')));
      const c = h('canvas', { class: 'curve', role: 'img', 'aria-label': t('melody') });
      box.append(h('div', { class: 'lbl' }, t('melody')), c, h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--jade)' }), t('native')), h('span', {}, h('i', { style: 'background:var(--son)' }), t('yourVoice'))), h('p', { style: 'font-size:14px;color:var(--ink-soft)' }, t('melodyHint')));
      requestAnimationFrame(() => drawCurve(c, a));
    }
    if (r.heard && (v !== 'good')) box.append(h('p', {}, h('b', {}, t('heard')), ' ', r.heard));
    if (g.compare && g.compare.ok.includes(false)) box.append(h('p', { style: 'font-size:14px;color:var(--ink-soft)' }, t('tapRed')));
    box.append(h('div', { class: 'row' },
      r.foil && (v === 'foil' || v === 'likelyFoil' || v === 'unsure') && h('button', { class: 'btn', onclick: () => Audio_.say(r.text, voice(), U.SPEED.word).then(() => Audio_.say(r.foil, voice(), U.SPEED.word)) }, emo('👂'), t('contrast', r.text, r.foil)),
      rec && h('button', { class: 'btn', onclick: () => Audio_.playPcm(rec.pcm, rec.sr) }, emo('🎙️'), t('playMine')),
      h('button', { class: 'btn', onclick: () => (r.kind === 'sentence' ? sayPhrase(r.text) : sayWord(r.text)) }, emo('🔊'), t('playModel'))));
    out.append(box);
  }

  const micError = e => t(/NotAllowed|Permission|Security/.test(e.name) ? 'micDenied' : /NotFound|Overconstrained/.test(e.name) ? 'micNone' : /NotReadable|Abort/.test(e.name) ? 'micBusy' : 'micDenied');
  /* Bouton micro réutilisable partout. */
  function micButton({ text, kind, foil, unit, out, onResult }) {
    const status = h('span', {}, t('speak'));
    let active = null;
    const btn = h('button', { class: 'round mic', 'aria-label': t('speak'), onclick: async () => {
      if (active) { active.stop(); return; }
      Audio_.stop();
      if (srUsable()) {
        status.textContent = t('micPrep'); btn.classList.add('rec'); btn.innerHTML = STOP_SVG; out.replaceChildren();
        const reset = () => { active = null; btn.classList.remove('rec'); btn.innerHTML = MIC_SVG; status.textContent = t('speak'); };
        try {
          active = listenOnline(() => { status.textContent = t('speakNow'); });
          const alts = await active.done; reset();
          if (!alts || !alts.length) { out.replaceChildren(h('div', { class: 'notice', role: 'alert' }, t('noSpeech'))); return; }
          const r = { a: ONLINE_A, g: E.gradeAlternatives(alts, text, foil, kind), heard: alts[0], foil, tipUnit: unit, text, kind };
          renderFeedback(out, r, null); if (onResult && r.g) onResult(r);
          return;
        } catch (e) {
          reset(); console.warn('reconnaissance en ligne', e.message);
          if (e.message === 'no-speech') { out.replaceChildren(h('div', { class: 'notice', role: 'alert' }, t('noSpeech'))); return; }
          if (e.message === 'aborted') return;
          App.srBroken = true; out.replaceChildren(h('div', { class: 'notice', role: 'alert' }, t('srFail')));
          return;
        }
      }
      status.textContent = t('micPrep'); btn.classList.add('rec'); btn.innerHTML = STOP_SVG; out.replaceChildren();
      try {
        active = Audio_.record({ deviceId: App.state.mic, maxMs: kind === 'sentence' ? 15000 : 6000, silenceMs: kind === 'sentence' ? 1300 : 900, onReady: () => { status.textContent = t('speakNow'); }, onLevel: l => btn.style.setProperty('--lvl', l) });
        const rec = await active.done; active = null;
        window.__lastRec = { peak: rec.peak, floor: rec.floor, label: rec.label, seconds: rec.pcm.length / rec.sr, spoke: rec.spoke };
        if (rec.cancelled || !rec.spoke) {
          btn.classList.remove('rec'); btn.innerHTML = MIC_SVG; status.textContent = t('speak');
          if (!rec.cancelled) out.replaceChildren(h('div', { class: 'notice', role: 'alert' }, rec.peak < 1e-5 ? t('micMuted') : t('noSpeech')));
          return;
        }
        btn.classList.remove('rec'); btn.innerHTML = MIC_SVG; status.textContent = t('analyzing');
        const r = await evaluate(rec, text, kind, foil, unit);
        status.textContent = t('speak');
        renderFeedback(out, r, rec);
        if (onResult && r.g) onResult(r);
      } catch (e) {
        console.warn('micro', e); active = null; btn.classList.remove('rec'); btn.innerHTML = MIC_SVG; status.textContent = t('speak');
        out.replaceChildren(h('div', { class: 'notice', role: 'alert' }, micError(e)));
      }
    } });
    btn.innerHTML = MIC_SVG;
    return h('div', { class: 'ctl' }, btn, status);
  }

  /* Charge les modèles avant le premier essai pour que la première correction ne semble pas bloquée. */
  let warmed = false;
  function prewarm() {
    if (warmed || !App.engineOk) return; warmed = true;
    const s = new Float32Array(8000);
    window.cau.speech.keywords(s, ['bonjour']).then(() => window.cau.speech.recognize(s)).catch(e => console.warn(e));
  }
  function record(unit, score) {
    const p = prof(), r = p.pron[unit.id] || { n: 0, sum: 0, avg: 0 };
    r.n = Math.min(r.n + 1, 30); r.sum = r.n === 30 ? r.avg * 29 + score : r.sum + score; r.avg = Math.round(r.sum / r.n);
    p.pron[unit.id] = r; save();
  }
  const unitsFor = () => { const a = prof().age; return App.pronUnits.filter(u => a >= u.ages[0] && a <= u.ages[1]); };
  /* Ordre recommandé : d'abord ce qui gêne le plus la compréhension. */
  const ORDER = ['final', 'u-ou', 'ch', 'r', 'cluster', 'nasal', 'vbp', 'eu', 'j', 's-z', 'vowels', 'gn-ui', 'rhythm', 'melody', 'liaison', 'enchain'];

  function enableSR() { const go = () => { App.state.useSR = true; App.srBroken = false; save(); render(); }; prof().age < 13 ? gate(go) : go(); }
  function viewList() {
    const list = unitsFor().sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
    const open = u => { touchDay(); nav('pronUnit', { unit: u, mode: isKid() ? 'speak' : 'tips', di: 0, si: 0, earN: 0 }); };
    const weak = isKid() ? null : list.filter(u => { const r = prof().pron[u.id]; return r && r.n >= 3 && r.avg < 75; }).sort((a, b) => prof().pron[a.id].avg - prof().pron[b.id].avg)[0];
    return h('div', { class: 'page' }, h('h1', { class: 'page-title opaque' }, t('pronTitle')), h('p', { class: 'sub opaque' }, t('pronSub')),
      weak && h('div', { class: 'priority' }, emo(weak.emoji), h('div', {}, h('b', {}, t('priority')), h('div', {}, pick(weak.title))), h('button', { class: 'btn primary', onclick: () => open(weak) }, t('continue'))),
      App.engineOk === false && h('div', { class: 'notice', style: 'margin-bottom:16px;max-width:none' }, t('engineOff')),
      window.cau.platform === 'web' && SR && !App.state.useSR && !isKid() && h('div', { class: 'priority' }, h('div', {}, h('b', {}, t('srOpt')), h('div', {}, t('srHelp'))), h('button', { class: 'btn primary', onclick: () => enableSR() }, t('srOn'))),
      h('div', { class: 'unit-list' }, list.map(u => { const r = prof().pron[u.id];
        return h('button', { class: 'unit', onclick: () => open(u) }, emo(u.emoji, 'sym'),
          h('span', {}, h('div', { class: 'ttl' }, pick(u.title)), h('div', { class: 'ipa-tag' }, u.ipa), r ? h('div', { class: 'meter' }, h('i', { style: `width:${r.avg}%` })) : null));
      })), !isKid() && h('p', { class: 'opaque', style: 'margin-top:20px;font-size:15px;color:var(--ink-soft)' }, t('honest')));
  }
  function viewUnit() {
    const { unit: u, mode } = App.ctx, kid = isKid();
    const earOK = u.drills.some(d => d.foil);
    const tabs = [['tips', 'tipsT', true], ['ear', 'earT', earOK], ['speak', 'speakT', u.drills.length > 0], ['sent', 'sentT', u.sentences.length > 0]].filter(x => x[2]);
    const realMode = !tabs.find(x => x[0] === mode) ? tabs[tabs.length - 1][0] : mode;
    const top = h('div', { class: 'lesson-top' }, h('button', { class: 'btn quiet', onclick: () => nav('pron') }, '✕ ', t('close')), h('h2', { style: 'flex:1;font-size:20px' }, pick(u.title)), h('span', { class: 'ipa-tag' }, u.ipa));
    const stage = h('div', { class: 'stage' });
    if (!kid) stage.append(h('div', { class: 'mode-tabs' }, tabs.map(([m, k]) => h('button', { class: 'btn ' + (realMode === m ? 'primary' : ''), onclick: () => nav('pronUnit', { mode: m }) }, t(k)))));
    if (App.engineOk === false && !kid && window.cau.platform !== 'web') stage.append(h('div', { class: 'notice' }, t('engineOff')));
    ({ tips: tipsMode, ear: earMode, speak: speakMode, sent: sentMode }[realMode])(stage, u);
    return h('div', {}, top, stage);
  }
  function tipsMode(stage, u) {
    stage.append(h('div', { class: 'note' }, emo(u.emoji, 'word-pic'), h('p', { style: 'font-size:20px;line-height:1.6' }, pick(u.tip)),
      u.drills.slice(0, 4).map(d => h('div', { class: 'ex' }, h('button', { class: 'small-play', 'aria-label': t('listen'), onclick: () => sayWord(d.t) }, emo('🔊')), h('div', {}, h('b', {}, d.t), ' ', h('span', { class: 'ipa-tag' }, `/${d.ipa}/`), phonLine(d.t))))));
    stage.append(h('button', { class: 'btn primary', onclick: () => nav('pronUnit', { mode: u.drills.some(d => d.foil) ? 'ear' : u.drills.length ? 'speak' : 'sent' }) }, t('next')));
  }
  /* Entraîner l'oreille d'abord : on ne corrige bien que ce qu'on entend. */
  function earMode(stage, u) {
    const pairs = u.drills.filter(d => d.foil);
    if (App.ctx.earN >= 8) { App.ctx.earN = 0; return nav('pronUnit', { mode: 'speak', di: 0 }); }
    const d = pairs[Math.floor(Math.random() * pairs.length)], said = Math.random() < 0.5 ? d.t : d.foil;
    const play = () => Audio_.say(said, voice(), U.SPEED.word);
    stage.append(h('div', { class: 'q-prompt' }, t('earQ')), h('button', { class: 'round', style: 'width:96px;height:96px;font-size:42px', 'aria-label': t('listen'), onclick: play }, emo('🔊')));
    const box = h('div', { class: 'choices' }); let done = false;
    for (const o of shuffle([d.t, d.foil])) box.append(h('button', { class: 'choice', onclick: e => {
      if (done) return; done = true; const ok = o === said; e.currentTarget.classList.add(ok ? 'correct' : 'wrong'); [...box.children].forEach(c => { if (c.textContent === said) c.classList.add('correct'); });
      stage.append(h('div', { class: 'feedback ' + (ok ? 'good' : 'bad'), role: 'status' }, h('div', { class: 'msg' }, ok ? t('correct') : `${t('wrong')} ${said}`)));
      App.ctx.earN++;
      stage.append(h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => Audio_.say(d.t, voice(), U.SPEED.word).then(() => Audio_.say(d.foil, voice(), U.SPEED.word)) }, emo('🔊'), `${d.t} / ${d.foil}`), h('button', { class: 'btn primary', onclick: () => render() }, t('next'))));
    } }, o));
    stage.append(box); play();
  }
  function speakMode(stage, u) {
    const list = isKid() ? u.drills.slice(0, 5) : u.drills;
    const i = App.ctx.di % list.length, d = list[i], fb = h('div', { style: 'display:contents' });
    stage.append(h('div', { class: 'word-fr' }, d.t), h('div', { class: 'ipa' }, `/${d.ipa}/`), vipOf(d.t) && phonNode(vipOf(d.t)), h('div', { class: 'gloss minor' }, `${i + 1} / ${list.length}`));
    stage.append(h('div', { class: 'control-row' },
      h('div', { class: 'ctl' }, h('button', { class: 'round', 'aria-label': t('listen'), onclick: () => Audio_.say(d.t, voice(), U.SPEED.word) }, emo('🔊')), t('listen')),
      micButton({ text: d.t, kind: 'word', foil: d.foil, unit: u, out: fb, onResult: r => { if (r.g.score != null) record(u, r.g.score); } })));
    stage.append(fb, h('div', { class: 'row' },
      i > 0 && h('button', { class: 'btn', onclick: () => nav('pronUnit', { di: i - 1 }) }, t('back')),
      h('button', { class: 'btn primary', onclick: () => (i + 1 >= list.length ? nav('pronUnit', { mode: isKid() ? 'speak' : 'sent', di: 0, si: 0 }) : nav('pronUnit', { di: i + 1 })) }, t('next'))));
    (isKid() ? viPrompt('repeat') : Promise.resolve()).then(() => Audio_.say(d.t, voice(), U.SPEED.word));
  }
  function sentMode(stage, u) {
    const i = App.ctx.si % u.sentences.length, s = u.sentences[i], fb = h('div', { style: 'display:contents' });
    stage.append(h('div', { class: 'phrase-fr opaque' }, s.fr), vipOf(s.fr) && phonNode(vipOf(s.fr)), gloss(s) && h('div', { class: 'gloss' }, gloss(s)), h('div', { class: 'gloss minor' }, `${i + 1} / ${u.sentences.length}`));
    stage.append(h('div', { class: 'control-row' },
      h('div', { class: 'ctl' }, h('button', { class: 'round', 'aria-label': t('listen'), onclick: () => sayPhrase(s.fr) }, emo('🔊')), t('listen')),
      micButton({ text: s.fr, kind: 'sentence', unit: u, out: fb, onResult: r => { if (r.g.score != null) record(u, r.g.score); } })));
    stage.append(fb, h('div', { class: 'row' }, i > 0 && h('button', { class: 'btn', onclick: () => nav('pronUnit', { si: i - 1 }) }, t('back')),
      h('button', { class: 'btn primary', onclick: () => (i + 1 >= u.sentences.length ? nav('pron') : nav('pronUnit', { si: i + 1 })) }, t('next'))));
    sayPhrase(s.fr);
  }
  return { micButton, viewList, viewUnit, evaluate, micError, prewarm, enableSR, hasSR: () => !!SR };
})();
