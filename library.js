/* Bibliothèque : cours téléchargés (hors ligne) et recherche en ligne. */
window.Library = (() => {
  const SOURCES = [
    { id: 'tatoeba', label: 'sourceSent', minAge: 3 },
    { id: 'vikidia', label: 'sourceKids', minAge: 8 },
    { id: 'wikipedia', label: 'sourceWiki', minAge: 14 },
    { id: 'wikisource', label: 'sourceLit', minAge: 14 },
  ];
  const age = () => prof().age;
  const asLesson = l => ({ id: 'lib-' + l.id, title: { vi: l.title, fr: l.title, en: l.title }, emoji: '🌐', words: l.words || [], phrases: l.phrases.filter(p => p.fr.length < 120).slice(0, 12), grammar: [] });
  /* Vérifie les catalogues mémorisés : ne demande rien si l'ordinateur est hors ligne. */
  async function checkUpdates(box, dlBox) {
    const cats = App.state.catalogs || [];
    box.replaceChildren();
    if (!cats.length || !navigator.onLine) return;
    const have = new Map((await window.cau.lib.list()).filter(l => l.packUrl).map(l => [l.packUrl, l.packVersion]));
    const todo = [];
    for (const url of cats) { try { const c = await window.cau.net.catalog(url); for (const p of c.packs) if (have.has(p.url) && p.version > have.get(p.url)) todo.push(p); } catch (e) { console.warn(e); } }
    if (!todo.length) { box.append(h('div', { class: 'item d', role: 'status' }, t('upToDate'))); return; }
    const btn = h('button', { class: 'btn primary', onclick: async () => {
      btn.disabled = true; btn.textContent = t('loading');
      try { for (const p of todo) for (const l of await window.cau.net.pack(p.url)) await window.cau.lib.save(l); toast(t('saved')); checkUpdates(box, dlBox); refresh(dlBox); }
      catch (e) { btn.disabled = false; btn.textContent = t('updateAll'); toast(errText(e)); }
    } }, t('updateAll'));
    box.append(h('div', { class: 'priority', role: 'status' }, h('div', {}, h('b', {}, t('updatesFound', todo.length)), h('div', {}, todo.map(p => p.title).join(', '))), btn));
  }
  let items = []; let lastResults = null, lastSource = null, query = '';

  async function refresh(box) {
    items = await window.cau.lib.list();
    items.sort((a, b) => b.savedAt - a.savedAt);
    const visible = items.filter(l => !l.age || age() >= l.age[0] || age() >= 18);
    box.replaceChildren(...(visible.length ? visible.map(l => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, l.title), h('div', { class: 'd' }, [l.source, t('sentences', l.phrases.length)].filter(Boolean).join(', '))),
      h('button', { class: 'btn primary', onclick: () => nav('reader', { reading: l }) }, t('open')),
      h('button', { class: 'btn', onclick: () => startLesson(asLesson(l)) }, t('exercises')),
      h('button', { class: 'btn quiet', onclick: async () => { await window.cau.lib.remove(l.id); refresh(box); } }, t('remove')))) : [h('div', { class: 'item d' }, t('nothingDl'))]));
  }
  function errText(e) { return navigator.onLine ? t('netErr') : t('offline'); }
  function view() {
    const dlBox = h('div', { class: 'list' }); refresh(dlBox);
    const results = h('div', { class: 'list', style: 'margin-top:12px', 'aria-live': 'polite' });
    const srcSel = h('select', { 'aria-label': t('source') }, SOURCES.filter(s => age() >= s.minAge).map(s => h('option', { value: s.id, selected: s.id === lastSource }, t(s.label))));
    const q = h('input', { placeholder: t('searchPh'), value: query, style: 'flex:1;min-width:240px;padding:10px 12px;border:2px solid var(--ink);border-radius:6px', 'aria-label': t('search') });
    const showResults = list => {
      if (!list.length) return results.replaceChildren(h('div', { class: 'item d' }, t('noResult')));
      results.replaceChildren(...list.map(r => {
        const dl = h('button', { class: 'btn', onclick: async () => {
          dl.disabled = true; dl.textContent = t('loading');
          try { const lesson = await window.cau.net.lesson(r.source, r, age()); await window.cau.lib.save(lesson); toast(t('saved')); dl.textContent = t('saved'); refresh(dlBox); }
          catch (e) { dl.disabled = false; dl.textContent = t('dlBtn'); toast(errText(e)); }
        } }, t('dlBtn'));
        return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, r.title), h('div', { class: 'd' }, r.snippet || t('sentences', r.count))), dl);
      }));
    };
    const go = async () => {
      query = q.value.trim(); lastSource = srcSel.value; results.replaceChildren(h('div', { class: 'item d' }, t('loading')));
      try { lastResults = await window.cau.net.search(srcSel.value, query, age()); showResults(lastResults); }
      catch (e) { results.replaceChildren(h('div', { class: 'notice' }, errText(e))); }
    };
    q.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    if (lastResults) showResults(lastResults);
    const cat = h('input', { placeholder: t('packUrl'), style: 'flex:1;min-width:240px;padding:10px 12px;border:2px solid var(--ink);border-radius:6px', 'aria-label': t('packUrl') });
    const catOut = h('div', { class: 'list', style: 'margin-top:12px' });
    const savePack = async lessons => { for (const l of lessons) await window.cau.lib.save(l); toast(t('saved')); refresh(dlBox); };
    const loadCat = async () => {
      catOut.replaceChildren(h('div', { class: 'item d' }, t('loading')));
      try {
        const url = cat.value.trim(); const c = await window.cau.net.catalog(url);
        App.state.catalogs = App.state.catalogs || []; if (!App.state.catalogs.includes(url)) { App.state.catalogs.push(url); save(); }
        catOut.replaceChildren(...c.packs.filter(p => !p.age || age() >= p.age[0] || age() >= 18).map(p => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, p.title), p.age && h('span', { class: 'tag' }, `${p.age[0]}–${p.age[1]}`)),
          h('button', { class: 'btn', onclick: async () => { try { await savePack(await window.cau.net.pack(p.url)); } catch (e) { toast(errText(e)); } } }, t('dlBtn')))));
      } catch (e) { catOut.replaceChildren(h('div', { class: 'notice' }, /format/.test(e.message) ? t('badPack') : errText(e))); }
    };
    const updBox = h('div', { style: 'margin-bottom:14px' }); checkUpdates(updBox, dlBox);
    return h('div', { class: 'page' }, h('h1', { class: 'page-title opaque' }, t('libTitle')), h('p', { class: 'sub opaque' }, t('libSub')),
      !navigator.onLine && h('div', { class: 'notice', style: 'max-width:none;margin-bottom:14px' }, t('offline')), updBox,
      h('section', {}, h('h2', { class: 'opaque', style: 'font-size:23px;margin-bottom:10px;display:inline-block' }, t('downloaded')), dlBox),
      h('section', { class: 'section' }, h('h2', {}, t('onlineT')), h('div', { class: 'row', style: 'background:var(--paper);padding:8px' }, srcSel, q, h('button', { class: 'btn primary', onclick: go }, t('search'))), results),
      h('section', { class: 'section' }, h('h2', {}, t('packT')), h('p', { class: 'opaque', style: 'margin-bottom:8px' }, t('packSub')), h('div', { class: 'row', style: 'background:var(--paper);padding:8px' }, cat, h('button', { class: 'btn', onclick: loadCat }, t('loadCat')), h('button', { class: 'btn', onclick: async () => { try { const l = await window.cau.lib.importFile(); if (l) await savePack(l); } catch { toast(t('badPack')); } } }, t('importFile'))), catOut));
  }
  /* Lecteur : écouter, traduire, répéter chaque phrase ; cliquer un mot pour sa définition. */
  function viewReader() {
    const l = App.ctx.reading, pop = h('div', {});
    const define = async w => {
      pop.replaceChildren(h('div', { class: 'def-pop' }, h('b', {}, w), t('loading')));
      const lw = w.toLocaleLowerCase('fr'); l.defs = l.defs || {};
      let d = l.defs[lw] || null;
      if (!d) { try { d = await window.cau.net.define(w); if (d) { l.defs[lw] = d; window.cau.lib.save(l); } } catch {} }
      const add = h('button', { class: 'btn', onclick: () => { const p = prof(); p.words[w.toLocaleLowerCase('fr')] = p.words[w.toLocaleLowerCase('fr')] || { box: 0, due: Date.now() + 864e5, vi: d && d.def || '', en: d && d.def || '' }; save(); add.textContent = t('added'); add.disabled = true; } }, t('addWord'));
      pop.replaceChildren(h('div', { class: 'def-pop' }, h('button', { class: 'small-play', 'aria-label': t('listen'), onclick: () => Audio_.say(w, voice(), U.SPEED.word) }, emo('🔊')), h('div', { style: 'flex:1;min-width:200px' }, h('b', {}, w), d && d.ipa ? h('span', { class: 'ipa-tag' }, ` /${d.ipa}/`) : '', h('div', {}, d ? d.def : t('offline')), d && h('small', { style: 'color:var(--ink-soft)' }, d.source)), add));
    };
    const wordsNode = fr => (fr.match(/[^\s'’]+['’]?|\s+/gu) || []).map(tok => /[\p{L}]{2,}/u.test(tok) ? h('span', { class: 'w', role: 'button', tabindex: '0', onclick: () => define(tok.replace(/[^\p{L}-]/gu, '')), onkeydown: e => { if (e.key === 'Enter') define(tok.replace(/[^\p{L}-]/gu, '')); } }, tok) : tok);
    const row = (p, i) => {
      const trBox = h('div', { class: 'tr' }, p.vi && App.state.trans === 'vi' ? p.vi : p.en && App.state.trans === 'en' ? p.en : p.vi || '');
      const fb = h('div', {}); let shown = null;
      const trBtn = !trBox.textContent && App.state.trans !== 'none' && h('button', { class: 'btn quiet', onclick: async e => {
        const b = e.currentTarget; b.disabled = true;
        try { const out = await window.cau.net.translate(p.fr, App.state.trans); p[App.state.trans] = out; trBox.textContent = out; trBox.append(h('small', { style: 'display:block' }, t('autoTr'))); await window.cau.lib.save(l); b.remove(); }
        catch { b.disabled = false; toast(errText()); }
      } }, t('translate'));
      return h('div', { class: 'reader-sentence' }, h('div', { style: 'display:grid;gap:6px' }, h('button', { class: 'small-play', 'aria-label': t('listen'), onclick: async () => { try { await sayPhrase(p.fr); } catch { toast(t('noTts')); } } }, emo('🔊'))),
        h('div', {}, h('div', { class: 'fr' }, wordsNode(p.fr)), trBox, h('div', { class: 'row' }, trBtn, window.cau.platform !== 'web' && h('button', { class: 'btn quiet', onclick: e => {
          const host = e.currentTarget.parentNode; if (shown) { shown.remove(); shown = null; return; }
          fb.replaceChildren(); shown = window.Practice.micButton({ text: p.fr, kind: 'sentence', out: fb }); host.append(shown);
        } }, emo('🎤'), t('speak'))), fb));
    };
    const words = (l.words || []);
    const missing = () => (App.state.trans === 'none' ? [] : l.phrases.filter(p => !p[App.state.trans]));
    const allTr = missing().length && navigator.onLine ? h('button', { class: 'btn', onclick: async e => {
      const b = e.currentTarget; b.disabled = true; let n = 0; const list = missing().slice(0, 40);
      try { for (const p of list) { p[App.state.trans] = await window.cau.net.translate(p.fr, App.state.trans); b.textContent = `${t('loading')} ${++n}/${list.length}`; } }
      catch { toast(errText()); }
      await window.cau.lib.save(l); render();
    } }, t('translateAll')) : null;
    return h('div', { class: 'page' }, h('button', { class: 'btn quiet', onclick: () => nav('library') }, t('back')), h('h1', { class: 'page-title opaque' }, l.title),
      h('p', { class: 'sub opaque' }, `${t('source')}: ${l.source || ''}${l.license ? ` (${l.license})` : ''} `, l.url && h('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.url.replace(/^https:\/\//, '').slice(0, 60)), ' ', t('tapWord')),
      h('div', { class: 'row', style: 'margin-bottom:14px' }, h('button', { class: 'btn primary', onclick: () => startLesson(asLesson(l)) }, t('exercises')), allTr),
      words.length ? h('div', { class: 'list', style: 'margin-bottom:16px' }, words.map(w => h('div', { class: 'item' }, h('button', { class: 'small-play', 'aria-label': t('listen'), onclick: () => Audio_.say(w.fr, voice(), U.SPEED.word) }, emo('🔊')), h('div', { class: 'grow' }, h('span', { class: 't' }, `${w.e || ''} ${w.fr}`), h('div', { class: 'd' }, gloss(w)))))) : null,
      h('div', {}, l.phrases.map(row)), pop);
  }
  return { view, viewReader };
})();
