(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.CauUtil = f(); })(typeof self !== 'undefined' ? self : this, function () {
  function hash(s) { let a = 0x811c9dc5, b = 0xcbf29ce4; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x000001b3) >>> 0; b = (b + (a >>> 7)) >>> 0; } return ('00000000' + a.toString(16)).slice(-8) + ('00000000' + b.toString(16)).slice(-8); }
  const audioKey = (voice, speed, text) => hash(voice + '|' + speed + '|' + text);
  const parseWord = s => { const [fr, vi, en, e, say, name] = s.split('|'); const w = { fr, vi, en, e }; if (say) w.say = say; if (name) w.name = name; return w; };
  const parsePhrase = s => { const [fr, vi, en] = s.split('|'); return { fr, vi, en }; };
  const parseDrill = s => { const [t, foil, ipa] = s.split('|'); return { t, foil: foil || null, ipa }; };
  return { hash, audioKey, parseWord, parsePhrase, parseDrill, SPEED: { word: 0.85, phrase: 0.95, drill: 0.75 } };
});
