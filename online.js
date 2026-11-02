(function(){
// Récupération de cours sur Internet. Sources publiques connues, ou catalogue choisi par l'utilisateur.
const net = { fetch: (u, o) => fetch(u, { headers: { Accept: 'application/json' } }) };
const ENDPOINTS = {
  tatoeba: 'https://api.tatoeba.org/v1/sentences',
  vikidia: 'https://fr.vikidia.org/w/api.php',
  wikipedia: 'https://fr.wikipedia.org/w/api.php',
  wikisource: 'https://fr.wikisource.org/w/api.php',
  wiktionary: 'https://fr.wiktionary.org/w/api.php',
  mymemory: 'https://api.mymemory.translated.net/get',
};
const SOURCE_INFO = {
  tatoeba: { name: 'Tatoeba', license: 'CC BY 2.0 FR', minAge: 3 },
  vikidia: { name: 'Vikidia', license: 'CC BY-SA', minAge: 8 },
  wikipedia: { name: 'Wikipédia', license: 'CC BY-SA', minAge: 14 },
  wikisource: { name: 'Wikisource', license: 'Domaine public / CC BY-SA', minAge: 14 },
};
// Filtre de prudence pour les comptes mineurs. Il réduit le risque mais ne remplace pas un adulte.
const BLOCK = /\b(sexe?s?|sexuel\w*|baiser?|bais[eé]\w*|nu(e|s|es)?|porno\w*|viol\w*|tuer|tu[eé]\w*|meurtr\w*|suicid\w*|drogu\w*|alcool\w*|merde\w*|putain\w*|pute\w*|connard\w*|salope\w*|bordel\w*|enculé\w*|nazi\w*|arme\w*|fusil\w*|sang\w*|mort\w*|guerre\w*)\b/i;

async function getJSON(url) {
  const res = await net.fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
const qs = o => Object.entries(o.action ? { ...o, origin: '*' } : o).map(([k, v]) => `${encodeURIComponent(k).replace('%3A', ':')}=${encodeURIComponent(v)}`).join('&');
const stripTags = h => h.replace(/<[^>]+>/g, '').replace(/&#(\d+);/g, (m, c) => String.fromCodePoint(+c)).replace(/&#x([0-9a-f]+);/gi, (m, c) => String.fromCodePoint(parseInt(c, 16))).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim();
const wcRange = a => (a <= 5 ? '1-5' : a <= 10 ? '2-8' : a <= 14 ? '4-14' : '8-30');
const sid = s => s.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 60);

function splitSentences(text) {
  const out = []; const re = /[^.!?…]+(?:[.!?…]+["»)]*|$)/g; let m;
  while ((m = re.exec(text))) { const s = m[0].trim(); if (s.length > 2) out.push(s); }
  // Recolle les coupures après une abréviation courante.
  const merged = [];
  for (const s of out) { if (merged.length && /\b(M|Mme|St|Dr|av|J\.-C|etc|p|n|art)\.$/.test(merged[merged.length - 1])) merged[merged.length - 1] += ' ' + s; else merged.push(s); }
  return merged;
}
function articleText(html) {
  const clean = html.replace(/<(table|style|script|sup|figure|nav)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<div[^>]*class="[^"]*(thumb|navbox|bandeau|infobox|reference|hatnote)[^"]*"[\s\S]*?<\/div>/gi, ' ');
  const paras = [...clean.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m => stripTags(m[1]).replace(/\[[^\]]*\]/g, '').replace(/\s+([.,])/g, '$1')).filter(p => p.length > 30);
  return paras;
}

async function search(source, q, maxAge = 18) {
  const info = SOURCE_INFO[source]; if (!info) throw new Error('source');
  if (source === 'tatoeba') {
    const params = { lang: 'fra', 'trans:lang': 'vie', sort: q ? 'relevance' : 'random', limit: 40, word_count: wcRange(maxAge) };
    if (q) params.q = q;
    const data = await getJSON(`${ENDPOINTS.tatoeba}?${qs(params)}`);
    const list = (data.data || []).map(s => ({ fr: s.text, vi: ((s.translations || []).find(t => t.lang === 'vie') || (s.translations || [])[0] || {}).text || '', id: s.id, license: s.license }))
      .filter(s => s.fr && s.vi && (maxAge >= 18 || !BLOCK.test(s.fr)));
    return [{ id: 'tatoeba-' + (q ? sid(q) : Date.now().toString(36)), source, title: q || 'Phrases', count: list.length, items: list }].filter(x => x.count);
  }
  const data = await getJSON(`${ENDPOINTS[source]}?${qs({ action: 'query', list: 'search', srsearch: q || 'Vietnam', srlimit: 12, format: 'json', srnamespace: 0 })}`);
  return ((data.query && data.query.search) || []).map(r => ({ id: `${source}-${sid(r.title)}`, source, title: r.title, snippet: stripTags(r.snippet || ''), ref: r.title })).filter(r => maxAge >= 18 || !BLOCK.test(r.title + ' ' + r.snippet));
}

function lessonFrom({ id, source, title, sentences, url, age }) {
  const info = SOURCE_INFO[source] || { name: source, license: '' };
  return { id, title, source: info.name, license: info.license, url: url || '', age: age || null, savedAt: Date.now(), phrases: sentences };
}
async function lesson(source, ref, maxAge = 18) {
  if (source === 'tatoeba') {
    const list = ref.items.slice(0, 20).map(s => ({ fr: s.fr, vi: s.vi }));
    return lessonFrom({ id: ref.id, source, title: ref.title, sentences: list, url: 'https://tatoeba.org' });
  }
  const data = await getJSON(`${ENDPOINTS[source]}?${qs({ action: 'parse', page: ref.ref, prop: 'text', format: 'json', redirects: 1, disableeditsection: 1 })}`);
  const html = data.parse && (data.parse.text['*'] || data.parse.text);
  if (!html) throw new Error('empty');
  const paras = articleText(typeof html === 'string' ? html : '');
  const limit = maxAge < 14 ? 25 : 60;
  const sentences = paras.flatMap(splitSentences).filter(s => s.length < 320).slice(0, limit).filter(s => maxAge >= 18 || !BLOCK.test(s)).map(fr => ({ fr }));
  if (!sentences.length) throw new Error('empty');
  const base = ENDPOINTS[source].replace(/\/w\/api\.php$/, '');
  return lessonFrom({ id: ref.id, source, title: ref.title, sentences, url: `${base}/wiki/${encodeURIComponent(ref.ref.replace(/ /g, '_'))}` });
}
async function translate(text, to = 'vi') {
  const data = await getJSON(`${ENDPOINTS.mymemory}?${qs({ q: text.slice(0, 480), langpair: `fr|${to}` })}`);
  const t = data.responseData && data.responseData.translatedText;
  if (!t || data.responseStatus >= 400) throw new Error('translate');
  return stripTags(t);
}
/* Wiktionnaire : prononciation et première définition. */
async function define(word) {
  const w = word.toLocaleLowerCase('fr');
  const data = await getJSON(`${ENDPOINTS.wiktionary}?${qs({ action: 'parse', page: w, prop: 'wikitext', format: 'json', redirects: 1 })}`);
  const txt = data.parse && (data.parse.wikitext['*'] || data.parse.wikitext);
  if (typeof txt !== 'string') return null;
  const sec = txt.split(/==\s*\{\{langue\|/).find(s => s.startsWith('fr}}')) || txt;
  const pron = (sec.match(/\{\{pron\|([^|}]+)\|fr\}\}/) || [])[1] || null;
  const line = (sec.match(/^#\s*(?![*:])(.+)$/m) || [])[1] || '';
  const def = line.replace(/\{\{[^{}]*\}\}/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1').replace(/'{2,}/g, '').trim();
  return { word: w, ipa: pron, def, source: 'Wiktionnaire (CC BY-SA)' };
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
function defsOf(d) { const o = {}; if (d && typeof d === 'object') for (const k of Object.keys(d).slice(0, 500)) { const v = d[k] || {}; o[str(k, 60)] = { word: str(v.word, 60), ipa: str(v.ipa, 60), def: str(v.def, 400), source: str(v.source, 60) }; } return o; }
function validateLesson(l) {
  if (!l || typeof l !== 'object') throw new Error('invalid');
  const phrases = (Array.isArray(l.phrases) ? l.phrases : []).slice(0, 200).map(p => ({ fr: str(p.fr, 600), vi: str(p.vi, 600), en: str(p.en, 600) })).filter(p => p.fr);
  const words = (Array.isArray(l.words) ? l.words : []).slice(0, 200).map(w => ({ fr: str(w.fr, 80), vi: str(w.vi, 120), en: str(w.en, 120), e: str(w.e, 16) })).filter(w => w.fr);
  if (!phrases.length && !words.length) throw new Error('empty');
  return { id: str(l.id, 80) || 'pack-' + Date.now().toString(36), title: str(l.title, 120) || 'Cours', source: str(l.source, 80), license: str(l.license, 80), url: /^https:\/\//.test(l.url || '') ? str(l.url, 400) : '', age: Array.isArray(l.age) ? l.age.slice(0, 2).map(Number) : null, savedAt: +l.savedAt || Date.now(), phrases, words, defs: defsOf(l.defs), packUrl: /^https?:\/\//.test(l.packUrl || '') ? str(l.packUrl, 500) : '', packVersion: +l.packVersion || 0 };
}
function parsePack(p, url) {
  if (!p || p.format !== 'cau-pack/1' || !Array.isArray(p.lessons)) throw new Error('format');
  return p.lessons.slice(0, 200).map(l => validateLesson({ ...l, source: l.source || p.title, age: l.age || p.age, id: `${sid(p.id || p.title || 'pack')}-${sid(l.id || l.title || '')}`, packUrl: url, packVersion: +p.version || 1 }));
}
async function catalog(url) {
  if (!/^https?:\/\//.test(url)) throw new Error('url');
  const c = await getJSON(url);
  if (c.format === 'cau-pack/1') return { packs: [{ title: c.title || url, age: c.age || null, url, version: +c.version || 1, lessons: (c.lessons || []).length }] };
  if (c.format !== 'cau-catalog/1' || !Array.isArray(c.packs)) throw new Error('format');
  return { packs: c.packs.slice(0, 100).map(p => ({ title: str(p.title, 120), age: p.age || null, url: new URL(str(p.url, 500), url).href, version: +p.version || 1, lessons: +p.lessons || null })) };
}
async function pack(url) { if (!/^https?:\/\//.test(url)) throw new Error('url'); return parsePack(await getJSON(url), url); }
window.CauOnline = { search, lesson, translate, define, catalog, pack, parsePack, validateLesson, SOURCE_INFO };

})();
