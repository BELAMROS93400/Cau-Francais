/* Moteur d'analyse de prononciation — 100 % local, aucun envoi réseau.
 * MFCC + normalisation de locuteur (CMVN, VTLN) + alignement DTW contre plusieurs voix natives.
 * Comparaison discriminante cible / erreur typique (« foil ») + détection de hauteur (intonation). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PronEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SR = 16000, FRAME = 400, HOP = 160, NFFT = 512, NMEL = 26, NCEP = 13;

  function resample(pcm, from, to = SR) {
    if (from === to) return Float32Array.from(pcm);
    const ratio = from / to, n = Math.floor(pcm.length / ratio), out = new Float32Array(n);
    // Anti-repliement simple par moyenne glissante quand on sous-échantillonne.
    const w = Math.max(1, Math.round(ratio));
    let pre = pcm;
    if (w > 1) {
      pre = new Float32Array(pcm.length);
      let acc = 0;
      for (let i = 0; i < pcm.length; i++) {
        acc += pcm[i];
        if (i >= w) acc -= pcm[i - w];
        pre[i] = acc / Math.min(i + 1, w);
      }
    }
    for (let i = 0; i < n; i++) {
      const p = i * ratio, a = Math.floor(p), f = p - a;
      out[i] = pre[a] * (1 - f) + (pre[Math.min(a + 1, pre.length - 1)]) * f;
    }
    return out;
  }

  /* FFT réelle radix-2 */
  const cosT = new Float64Array(NFFT / 2), sinT = new Float64Array(NFFT / 2);
  for (let i = 0; i < NFFT / 2; i++) { cosT[i] = Math.cos(2 * Math.PI * i / NFFT); sinT[i] = Math.sin(2 * Math.PI * i / NFFT); }
  const rev = new Uint16Array(NFFT);
  for (let i = 0, bits = Math.log2(NFFT); i < NFFT; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
  function powerSpectrum(frame, out) {
    const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
    for (let i = 0; i < NFFT; i++) re[rev[i]] = i < frame.length ? frame[i] : 0;
    for (let size = 2; size <= NFFT; size *= 2) {
      const half = size / 2, step = NFFT / size;
      for (let i = 0; i < NFFT; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
        const tr = re[i + j + half] * cosT[k] + im[i + j + half] * sinT[k];
        const ti = im[i + j + half] * cosT[k] - re[i + j + half] * sinT[k];
        re[i + j + half] = re[i + j] - tr; im[i + j + half] = im[i + j] - ti;
        re[i + j] += tr; im[i + j] += ti;
      }
    }
    for (let i = 0; i <= NFFT / 2; i++) out[i] = re[i] * re[i] + im[i] * im[i];
  }

  const hann = new Float64Array(FRAME); for (let i = 0; i < FRAME; i++) hann[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (FRAME - 1));
  const mel = f => 2595 * Math.log10(1 + f / 700), imel = m => 700 * (Math.pow(10, m / 2595) - 1);

  const fbCache = new Map();
  function filterbank(alpha) {
    const key = alpha.toFixed(3); if (fbCache.has(key)) return fbCache.get(key);
    const lo = mel(100), hi = mel(7400), pts = [];
    for (let i = 0; i < NMEL + 2; i++) {
      // VTLN : on déplace les fréquences des filtres pour compenser la taille du conduit vocal.
      const f = imel(lo + (hi - lo) * i / (NMEL + 1));
      pts.push(Math.min(SR / 2 - 1, f * alpha) * NFFT / SR);
    }
    const fb = [];
    for (let m = 1; m <= NMEL; m++) {
      const row = new Float64Array(NFFT / 2 + 1);
      for (let k = Math.floor(pts[m - 1]); k <= Math.ceil(pts[m + 1]) && k <= NFFT / 2; k++) {
        if (k < pts[m - 1] || k > pts[m + 1]) continue;
        row[k] = k <= pts[m] ? (k - pts[m - 1]) / Math.max(1e-6, pts[m] - pts[m - 1]) : (pts[m + 1] - k) / Math.max(1e-6, pts[m + 1] - pts[m]);
      }
      fb.push(row);
    }
    fbCache.set(key, fb); return fb;
  }
  const dct = []; for (let c = 0; c < NCEP; c++) { const r = new Float64Array(NMEL); for (let m = 0; m < NMEL; m++) r[m] = Math.cos(Math.PI * c * (m + 0.5) / NMEL); dct.push(r); }

  /* Découpe sur la parole utile (énergie adaptative). Renvoie aussi le niveau pour avertir si micro trop faible. */
  function trimSpeech(pcm) {
    const win = 320, E = [];
    for (let i = 0; i + win <= pcm.length; i += 160) { let s = 0; for (let j = 0; j < win; j++) s += pcm[i + j] * pcm[i + j]; E.push(Math.sqrt(s / win)); }
    if (!E.length) return { pcm: new Float32Array(0), peak: 0, snr: 0, clipped: 0 };
    const sorted = Array.from(E).sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.1)], peak = sorted[sorted.length - 1];
    const th = Math.max(floor * 2.5, peak * 0.05, 0.0002);
    let a = 0, b = E.length - 1;
    while (a < E.length && E[a] < th) a++;
    while (b > a && E[b] < th) b--;
    let clipped = 0; for (let i = 0; i < pcm.length; i++) if (Math.abs(pcm[i]) > 0.985) clipped++;
    const s = Math.max(0, (a - 3) * 160), e = Math.min(pcm.length, (b + 5) * 160 + win);
    return { pcm: pcm.slice(s, e), peak, snr: peak / Math.max(floor, 1e-5), clipped: clipped / pcm.length };
  }

  function normalizeAmp(pcm) { let m = 0; for (const v of pcm) m = Math.max(m, Math.abs(v)); const o = new Float32Array(pcm.length); if (m > 1e-6) for (let i = 0; i < pcm.length; i++) o[i] = pcm[i] / m; return o; }

  function mfcc(pcmIn, alpha = 1) {
    const pcm = pcmIn, n = Math.max(0, Math.floor((pcm.length - FRAME) / HOP) + 1), fb = filterbank(alpha);
    const ceps = [], buf = new Float64Array(FRAME), ps = new Float64Array(NFFT / 2 + 1), logE = new Float64Array(NMEL);
    for (let t = 0; t < n; t++) {
      const off = t * HOP;
      for (let i = 0; i < FRAME; i++) buf[i] = ((pcm[off + i] || 0) - 0.97 * (pcm[off + i - 1] || 0)) * hann[i];
      powerSpectrum(buf, ps);
      for (let m = 0; m < NMEL; m++) { let s = 0; const r = fb[m]; for (let k = 0; k < r.length; k++) if (r[k]) s += r[k] * ps[k]; logE[m] = Math.log(s + 1e-8); }
      const c = new Float64Array(NCEP);
      for (let i = 0; i < NCEP; i++) { let s = 0; const d = dct[i]; for (let m = 0; m < NMEL; m++) s += d[m] * logE[m]; c[i] = s; }
      ceps.push(c);
    }
    return ceps;
  }

  /* Normalisation : pas de CMN par énoncé — sur un mot court elle effacerait l'identité de la voyelle.
   * On retire une moyenne globale + l'écart de canal estimé (micro) sur les énoncés précédents. */
  const GLOBAL = { mean: null, std: null, channel: null };
  function setGlobal(g) { Object.assign(GLOBAL, g); }
  function features(pcm, alpha, channel, cmn) {
    const c = mfcc(pcm, alpha), T = c.length; if (!T) return [];
    if (cmn) { // phrase : assez longue pour retirer le micro et la voix par énoncé
      const m = new Float64Array(NCEP); for (const f of c) for (let i = 0; i < NCEP; i++) m[i] += f[i] / T;
      for (const f of c) for (let i = 0; i < NCEP; i++) f[i] -= m[i];
    }
    const D = NCEP - 1, out = [], gm = GLOBAL.mean, gs = GLOBAL.std, ch = channel || null;
    for (let t = 0; t < T; t++) {
      const f = new Float64Array(D * 2), p = c[Math.max(0, t - 2)], q = c[Math.min(T - 1, t + 2)];
      for (let i = 0; i < D; i++) {
        const v = c[t][i + 1] - (ch ? ch[i] : 0);
        f[i] = gm ? (cmn ? v : v - gm[i]) / gs[i] : v;
        f[D + i] = (q[i + 1] - p[i + 1]) / 4 / (gs ? gs[D + i] : 1);
      }
      out.push(f);
    }
    return out;
  }
  function rawMean(pcm) { const c = mfcc(pcm, 1), m = new Float64Array(NCEP - 1); for (const f of c) for (let i = 0; i < NCEP - 1; i++) m[i] += f[i + 1] / c.length; return m; }

  /* DTW symétrique avec bande. Renvoie coût normalisé + coût local par trame de référence. */
  function dtw(A, B) {
    const n = A.length, m = B.length; if (!n || !m) return { cost: Infinity, local: [], path: [] };
    const band = Math.max(Math.abs(n - m) + 8, Math.floor(Math.max(n, m) * 0.25));
    const INF = 1e18, C = new Float64Array(n * m).fill(INF), L = new Uint32Array(n * m), dist = (x, y) => { let s = 0; for (let i = 0; i < x.length; i++) { const d = x[i] - y[i]; s += d * d; } return Math.sqrt(s / x.length); };
    const P = new Uint8Array(n * m);
    for (let i = 0; i < n; i++) {
      const c = Math.round(i * m / n), lo = Math.max(0, c - band), hi = Math.min(m - 1, c + band);
      for (let j = lo; j <= hi; j++) {
        const d = dist(A[i], B[j]), id = i * m + j;
        if (i === 0 && j === 0) { C[id] = d; L[id] = 1; continue; }
        let best = INF, bl = 1, bp = 0;
        if (i && j && C[id - m - 1] + 2 * d < best) { best = C[id - m - 1] + 2 * d; bl = L[id - m - 1] + 2; bp = 0; }
        if (i && C[id - m] + d < best) { best = C[id - m] + d; bl = L[id - m] + 1; bp = 1; }
        if (j && C[id - 1] + d < best) { best = C[id - 1] + d; bl = L[id - 1] + 1; bp = 2; }
        C[id] = best; L[id] = bl; P[id] = bp;
      }
    }
    const end = n * m - 1; if (!(C[end] < INF)) return { cost: Infinity, local: [], path: [] };
    const path = []; let i = n - 1, j = m - 1;
    while (i > 0 || j > 0) { path.push([i, j]); const p = P[i * m + j]; if (p === 0) { i--; j--; } else if (p === 1) i--; else j--; if (i < 0 || j < 0) break; }
    path.push([0, 0]); path.reverse();
    const local = new Float64Array(m), cnt = new Float64Array(m);
    for (const [a, b] of path) { local[b] += dist(A[a], B[b]); cnt[b]++; }
    for (let k = 0; k < m; k++) if (cnt[k]) local[k] /= cnt[k];
    return { cost: C[end] / L[end], local: Array.from(local), path };
  }

  /* Compare l'élève à la cible et à l'erreur typique, en ne regardant que les trames qui les distinguent. */
  function discriminate(U, T, F, alpha) {
    const a = bestDistance(U, T, [alpha]), b = bestDistance(U, F, [alpha]), tf = dtw(T.base, F.base);
    if (!a.path.length || !b.path.length || !tf.path.length) return 0;
    const n = T.base.length, m = F.base.length, wT = new Float64Array(n), wF = new Float64Array(m);
    const dist = (x, y) => { let s = 0; for (let i = 0; i < x.length; i++) { const d = x[i] - y[i]; s += d * d; } return Math.sqrt(s / x.length); };
    for (const [i, j] of tf.path) { const d = dist(T.base[i], F.base[j]); wT[i] = Math.max(wT[i], d); wF[j] = Math.max(wF[j], d); }
    const focus = (w, loc) => { const sorted = Array.from(w).sort((x, y) => x - y), th = sorted[Math.floor(sorted.length * 0.5)]; let s = 0, c = 0; for (let i = 0; i < w.length; i++) { const v = Math.max(0, w[i] - th); s += v * loc[i]; c += v; } return c > 0 ? s / c : 0; };
    return focus(wF, b.local) - focus(wT, a.local);
  }

  const ALPHAS = [0.82, 0.88, 0.94, 1, 1.06, 1.12, 1.2];
  function prepare(pcm, sr, channel, cmn) {
    const t = trimSpeech(resample(pcm, sr, SR));
    const norm = normalizeAmp(t.pcm);
    return { pcm: norm, info: t, channel, cmn, base: features(norm, 1, channel, cmn), byAlpha: new Map() };
  }
  /* Distance à une référence : l'élève est « warpé » selon alpha ; on garde le meilleur (enfant vs adulte). */
  function bestDistance(user, ref, alphas = ALPHAS) {
    let best = null;
    for (const a of alphas) {
      if (!user.byAlpha.get(a)) user.byAlpha.set(a, features(user.pcm, a, user.channel, user.cmn));
      const r = dtw(user.byAlpha.get(a), ref.base);
      if (!best || r.cost < best.cost) best = Object.assign(r, { alpha: a });
    }
    return best;
  }

  /* YIN pour la courbe de hauteur (intonation). */
  function pitchTrack(pcm) {
    const win = 640, hop = 160, minLag = Math.floor(SR / 450), maxLag = Math.floor(SR / 70), out = [];
    const d = new Float64Array(maxLag + 1);
    for (let s = 0; s + win + maxLag < pcm.length; s += hop) {
      let e = 0; for (let i = 0; i < win; i++) e += pcm[s + i] ** 2;
      if (e / win < 0.0008) { out.push(0); continue; }
      let run = 0;
      for (let lag = 1; lag <= maxLag; lag++) {
        let sum = 0; for (let i = 0; i < win; i += 2) { const x = pcm[s + i] - pcm[s + i + lag]; sum += x * x; }
        run += sum; d[lag] = run > 0 ? sum * lag / run : 1;
      }
      let best = 0;
      for (let lag = minLag; lag <= maxLag; lag++) if (d[lag] < 0.25) { best = lag; while (best + 1 <= maxLag && d[best + 1] < d[best]) best++; break; }
      if (!best) { let m = minLag; for (let lag = minLag; lag <= maxLag; lag++) if (d[lag] < d[m]) m = lag; if (d[m] < 0.45) best = m; }
      out.push(best ? SR / best : 0);
    }
    return out;
  }
  /* Contour en demi-tons autour de la médiane du locuteur : indépendant de la voix (enfant/adulte). */
  function contour(f0) {
    const v = f0.filter(x => x > 0).sort((a, b) => a - b); if (v.length < 4) return f0.map(() => null);
    const med = v[v.length >> 1];
    return f0.map(x => (x > 0 ? 12 * Math.log2(x / med) : null));
  }
  function contourDistance(userC, refC, path) {
    let s = 0, n = 0;
    for (const [a, b] of path) { const u = userC[a], r = refC[b]; if (u != null && r != null) { s += Math.abs(u - r); n++; } }
    return n > 5 ? s / n : null;
  }

  /* Analyse acoustique seule. La décision finale combine ceci avec le repérage de mots (gradeWord/gradeSentence). */
  function analyze(user, refs, foils = [], opts = {}) {
    const U = prepare(user.pcm, user.sr, opts.channel, opts.cmn);
    const quality = { tooQuiet: U.info.peak < 0.0006, low: U.info.peak < 0.01, tooShort: U.pcm.length < SR * 0.12, clipped: U.info.clipped > 0.01, noisy: U.info.snr < 3 };
    if (quality.tooQuiet || quality.tooShort) return { ok: false, quality };
    const R = refs.map(r => prepare(r.pcm, r.sr, null, opts.cmn));
    const alphas = opts.fast ? [0.88, 1, 1.12] : ALPHAS;
    let best = null, bestRef = null;
    for (const r of R) { const d = bestDistance(U, r, alphas); if (!best || d.cost < best.cost) { best = d; bestRef = r; } }
    let margin = null;
    if (foils.length) {
      const F = foils.map(f => prepare(f.pcm, f.sr)), n = Math.min(R.length, F.length); let s = 0;
      for (let i = 0; i < n; i++) s += discriminate(U, R[i], F[i], best.alpha);
      margin = s / n;
    }
    /* Note relative : la distance à la bonne phrase comparée à la distance à d'autres phrases. Le micro et la voix pèsent sur les deux, donc s'annulent en partie. */
    let relative = null;
    if (opts.impostors && opts.impostors.length) {
      let s = 0, n = 0;
      for (const im of opts.impostors) { const d = bestDistance(U, prepare(im.pcm, im.sr, null, opts.cmn), [best.alpha]); if (Number.isFinite(d.cost)) { s += d.cost; n++; } }
      if (n) relative = best.cost / (s / n);
    }
    const L = best.local, k = Math.max(1, Math.round(L.length / 40)), segments = [];
    for (let i = 0; i < L.length; i += k) { let v = 0, c = 0; for (let j = i; j < Math.min(L.length, i + k); j++) { v += L[j]; c++; } segments.push(v / c); }
    const uC = contour(pitchTrack(U.pcm)), rC = contour(pitchTrack(bestRef.pcm));
    // Courbe de l'élève ramenée sur le temps du modèle : on compare la mélodie, pas la vitesse.
    const aligned = new Array(rC.length).fill(null);
    for (const [ui, ri] of best.path) if (ri < aligned.length && uC[ui] != null) aligned[ri] = uC[ui];
    return {
      ok: true, relative, cost: best.cost, alpha: best.alpha, quality, margin, segments,
      durationRatio: U.pcm.length / Math.max(1, bestRef.pcm.length),
      melody: contourDistance(uC, rC, best.path), userContour: aligned, refContour: rC, trimmed: U.pcm,
    };
  }

  /* Ramène une voix d'enfant vers la zone du modèle de reconnaissance (entraîné sur des adultes). */
  function warp(pcm16k, alpha) { const n = Math.floor(pcm16k.length * alpha), o = new Float32Array(n); for (let i = 0; i < n; i++) { const p = i / alpha, a = Math.floor(p), f = p - a; o[i] = pcm16k[a] * (1 - f) + (pcm16k[Math.min(a + 1, pcm16k.length - 1)] || 0) * f; } return o; }
  const costScore = c => Math.max(35, Math.min(88, Math.round(88 - (c - 0.88) * 150)));
  /* verdict : good | likely | unsure | likelyFoil | foil. Ne félicite ou ne corrige fermement que sur preuve nette. */
  function gradeWord(a, hits, target, foil) {
    const h = hits && hits[0];
    if (foil) {
      if (h === target) return { verdict: 'good', score: Math.max(88, Math.min(100, costScore(a.cost) + 14)), firm: true };
      if (h === foil) return { verdict: 'foil', score: 30, firm: true };
      const m = a.margin || 0;
      if (m > 0.04) return { verdict: 'likely', score: 72 };
      if (m < -0.04) return { verdict: 'likelyFoil', score: 42 };
      return { verdict: 'unsure', score: null };
    }
    if (h === target) return { verdict: 'good', score: Math.max(85, Math.min(100, costScore(a.cost) + 12)), firm: true };
    if (a.relative != null) return a.relative < 0.87 ? { verdict: 'likely', score: 72 } : { verdict: 'unsure', score: null };
    const sc = costScore(a.cost);
    return sc >= 70 ? { verdict: 'likely', score: Math.min(75, sc) } : { verdict: 'unsure', score: null };
  }

  /* Français parlé : on replie orthographe et finales muettes pour ne pas pénaliser les homophones. */
  function foldWord(w) {
    let s = w.toLocaleLowerCase('fr').replace(/œ/g, 'oe').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
    s = s.replace(/(ent|es|s|x|t|d|e)$/, '') || s;
    return s.replace(/(.)\1/g, '$1');
  }
  const splitWords = t => t.replace(/['’-]/g, ' ').split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  /* Résultat d'un service de reconnaissance en ligne : plusieurs hypothèses, la première est la plus probable. */
  function gradeAlternatives(alts, target, foil, kind) {
    const has = (t, w) => { const T = splitWords(t).map(foldWord), W = splitWords(w).map(foldWord); return W.length > 0 && T.join(' ').includes(W.join(' ')); };
    const top = alts[0] || '';
    if (kind === 'sentence') { const compare = compareWords(target, top); const score = Math.round(compare.ratio * 100); return { verdict: compare.ratio >= 0.85 ? 'good' : compare.ratio >= 0.55 ? 'likely' : 'unsure', score, compare, firm: true }; }
    if (has(top, target)) return { verdict: 'good', score: 92, firm: true };
    if (foil && has(top, foil)) return { verdict: 'foil', score: 30, firm: true };
    if (alts.some(x => has(x, target))) return { verdict: 'likely', score: 72 };
    if (foil && alts.some(x => has(x, foil))) return { verdict: 'likelyFoil', score: 42 };
    return { verdict: 'unsure', score: null };
  }
  function compareWords(targetText, heardText) {
    const T = splitWords(targetText), H = splitWords(heardText), n = T.length, m = H.length;
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = foldWord(T[i]) === foldWord(H[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ok = new Array(n).fill(false); let i = 0, j = 0;
    while (i < n && j < m) { if (foldWord(T[i]) === foldWord(H[j])) { ok[i] = true; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
    return { words: T, ok, ratio: n ? dp[0][0] / n : 0 };
  }
  /* Sans reconnaissance vocale (iPhone) : seuils mesurés sur voix native ; ne détecte qu'un écart net, jamais de 'bravo' ferme. */
  function gradeSentenceAcoustic(a) {
    const r = a.relative, melodyPenalty = a.melody == null ? 0 : Math.max(0, Math.min(10, (a.melody - 3.5) * 3));
    // Seuils mesurés sur micros simulés (téléphone, bruit, écho) : une bonne phrase reste en général sous 0,84.
    if (r == null || r > 0.84) return { verdict: 'unsure', score: null, compare: null };
    return { verdict: 'likely', score: Math.round(Math.min(85, 68 + (0.84 - r) * 240) - melodyPenalty), compare: null };
  }
  function gradeSentence(a, heard, target) {
    if (heard == null || !heard.trim()) return gradeSentenceAcoustic(a);
    const compare = compareWords(target, heard);
    const melodyPenalty = a.melody == null ? 0 : Math.max(0, Math.min(10, (a.melody - 3.5) * 3));
    const score = Math.round(Math.max(10, compare.ratio * 100 - melodyPenalty));
    return { verdict: compare.ratio >= 0.85 ? 'good' : compare.ratio >= 0.55 ? 'likely' : 'unsure', score, compare, firm: true };
  }
  return { gradeAlternatives, GLOBAL, analyze, gradeSentenceAcoustic, gradeWord, warp, gradeSentence, compareWords, foldWord, discriminate, setGlobal, rawMean, ALPHAS, prepare, bestDistance, resample, trimSpeech, pitchTrack, contour, features, dtw, SR };
});
