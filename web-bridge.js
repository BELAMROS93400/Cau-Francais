/* Version iPhone : remplace le processus principal de Windows par les fonctions du navigateur. */
(function () {
  const DB = 'cau-francais';
  const open = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('library', { keyPath: 'id' }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (store, mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(store, mode), q = fn(t.objectStore(store)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  const pickFile = () => new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json'; i.onchange = async () => { const f = i.files[0]; res(f ? JSON.parse(await f.text()) : null); }; i.click(); });
  const packsMeta = fetch('data/audio-packs.json').then(r => r.json()); const packs = new Map();
  const pack = n => { if (!packs.has(n)) packs.set(n, fetch(`audio/pack-${n}.bin`).then(r => { if (!r.ok) throw new Error('pack'); return r.arrayBuffer(); })); return packs.get(n); };
  const noEngine = () => Promise.reject(new Error('no native engine'));
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  window.cau = {
    platform: 'web',
    clip: async k => { const [n, off, len] = (await packsMeta)[k]; return (await pack(n)).slice(off, off + len); },
    store: {
      get: () => tx('kv', 'readonly', s => s.get('state')).then(v => v || null),
      set: state => tx('kv', 'readwrite', s => s.put(JSON.parse(JSON.stringify(state)), 'state')).then(() => true),
      exportTo: async state => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(state)], { type: 'application/json' })); a.download = 'cau-francais-sauvegarde.json'; a.click(); return true; },
      importFrom: pickFile,
    },
    speech: { check: async () => ({ ok: false, detail: 'web' }), tts: noEngine, keywords: noEngine, recognize: noEngine },
    lib: {
      list: () => tx('library', 'readonly', s => s.getAll()),
      save: async l => { const c = CauOnline.validateLesson(l); await tx('library', 'readwrite', s => s.put(c)); return c; },
      remove: id => tx('library', 'readwrite', s => s.delete(id)).then(() => true),
      importFile: async () => { const p = await pickFile(); return p ? CauOnline.parsePack(p) : null; },
    },
    net: { search: (...a) => CauOnline.search(...a), lesson: (...a) => CauOnline.lesson(...a), translate: (...a) => CauOnline.translate(...a), define: (...a) => CauOnline.define(...a), catalog: (...a) => CauOnline.catalog(...a), pack: (...a) => CauOnline.pack(...a) },
    app: { info: async () => ({ version: 'web', platform: 'ios' }), openExternal: async u => { window.open(u, '_blank', 'noopener'); } },
  };
  // Safari n'autorise le son qu'après un geste : on débloque l'audio au premier toucher.
  const unlock = () => { try { Audio_.ac(); } catch {} };
  addEventListener('pointerdown', unlock, { passive: true }); addEventListener('touchend', unlock, { passive: true });
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn(e)));
  /* Textes propres à l'iPhone (appliqués quand i18n.js est chargé). */
  window.cauWebTexts = () => {
    const X = {
      vi: { micDenied: 'Không dùng được micrô. Vào Cài đặt iPhone > Safari > Micrô (hoặc Quyền riêng tư > Micrô) và cho phép.', micLow: 'Micrô thu rất nhỏ. Hãy nói gần iPhone hơn.', micBusy: 'Micrô đang bị ứng dụng khác dùng (cuộc gọi…). Hãy kết thúc rồi thử lại.', engineOff: 'Trên iPhone, việc chấm chỉ dựa trên so sánh âm thanh nên đơn giản hơn trên Windows: hãy xem kết quả như một gợi ý.', engineBad: 'Chấm phát âm: chế độ đơn giản', noTts: 'Trên iPhone chưa nghe được câu này.', privacy: 'Giọng nói được xử lý ngay trên iPhone và không gửi đi đâu. Máy chỉ kết nối Internet khi bạn dùng Thư viện.', installTip: 'Để dùng khi không có mạng: bấm nút Chia sẻ trong Safari rồi chọn "Thêm vào MH chính".' },
      fr: { micDenied: 'Le micro n\'est pas disponible. Ouvre Réglages iPhone > Safari > Microphone et autorise-le.', micLow: 'Le micro capte très faiblement. Parle plus près de l\'iPhone.', micBusy: 'Le micro est utilisé par une autre application (appel…). Termine-la et réessaie.', engineOff: 'Sur iPhone, la correction compare seulement les sons. Elle est plus simple que sur Windows : prends le résultat comme une indication.', engineBad: 'Correction : mode simplifié', noTts: 'Cette phrase ne peut pas être lue sur cet iPhone.', privacy: 'Ta voix est analysée sur l\'iPhone et n\'est envoyée nulle part. L\'application se connecte à Internet seulement pour se mettre à jour et quand tu utilises la Bibliothèque.', installTip: 'Pour l\'utiliser sans Internet : touche Partager dans Safari, puis « Sur l\'écran d\'accueil ».' },
      en: { micDenied: 'The microphone is unavailable. Open iPhone Settings > Safari > Microphone and allow it.', micLow: 'The microphone is very faint. Speak closer to the iPhone.', micBusy: 'Another app is using the microphone (a call?). End it and try again.', engineOff: 'On iPhone, correction only compares sounds. It is simpler than on Windows, so treat the result as a hint.', engineBad: 'Correction: simple mode', noTts: 'This sentence can\'t be read on this iPhone.', privacy: 'Your voice is analysed on the iPhone and sent nowhere. The app only goes online to update itself and when you use the Library.', installTip: 'To use it offline: tap Share in Safari, then "Add to Home Screen".' },
    };
    for (const k of Object.keys(X)) Object.assign(I18N[k], X[k]);
  };
})();
