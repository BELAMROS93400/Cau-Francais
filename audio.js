/* Lecture des voix (hors ligne), enregistrement du micro. */
const Audio_ = (() => {
  const U = window.CauUtil; let ctx = null, index = new Set(), current = null;
  const ac = () => { if (!ctx) ctx = new AudioContext(); if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {}); return ctx; };
  const VOICE_SID = { f: 0, a: 0 };
  const cache = new Map();
  async function init() { try { index = new Set(await (await fetch('audio-index.json')).json()); } catch { index = new Set(); } }
  async function decode(voice, speed, text) {
    const k = U.audioKey(voice, speed, text);
    if (cache.has(k)) return cache.get(k);
    let buf = null;
    if (index.has(k)) { const ab = window.cau.clip ? await window.cau.clip(k) : await (await fetch(`audio/${k}.ogg`)).arrayBuffer(); buf = await ac().decodeAudioData(ab); }
    else if (voice !== 'v') {
      // Texte téléchargé : synthèse locale à la demande.
      const r = await window.cau.speech.tts(text, 0, speed);
      buf = ac().createBuffer(1, r.pcm.length, r.sr); buf.copyToChannel(r.pcm, 0);
    }
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    if (buf) cache.set(k, buf);
    return buf;
  }
  /* Sortie audio : iOS garde un son faible (écouteur d'appel) si on ne lui dit pas qu'on joue un média. */
  const setSession = type => { try { if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type; } catch {} };
  /* Même niveau pour toutes les voix : chaque clip est ramené au pic maximal, puis compressé pour paraître plus fort sans saturer. */
  const peaks = new WeakMap();
  function lift(buf) { let p = peaks.get(buf); if (p == null) { const d = buf.getChannelData(0); p = 0; for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > p) p = v; } peaks.set(buf, p); } return p > 1e-4 ? Math.min(0.95 / p, 40) : 1; }
  const chains = new WeakMap();
  function output(c) {
    if (chains.has(c)) return chains.get(c);
    const k = c.createDynamicsCompressor(); k.threshold.value = -26; k.knee.value = 8; k.ratio.value = 6; k.attack.value = 0.004; k.release.value = 0.14;
    const g = c.createGain(); g.gain.value = OUT_GAIN;
    const lim = c.createDynamicsCompressor(); lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.06;
    k.connect(g); g.connect(lim); lim.connect(c.destination); chains.set(c, k); return k;
  }
  const OUT_GAIN = 1.4;
  function stop() { if (current) { try { current.stop(); } catch {} current = null; } if (window.speechSynthesis) speechSynthesis.cancel(); }
  function playBuffer(buf, rate = 1) {
    stop();
    setSession('playback');
    return new Promise(res => { const c = ac(), s = c.createBufferSource(), g = c.createGain(); s.buffer = buf; s.playbackRate.value = rate; g.gain.value = lift(buf); s.connect(g); g.connect(output(c)); s.onended = () => res(); s.start(); current = s; });
  }
  async function say(text, voice, speed, rate) {
    if (recording) return; // un son du logiciel ne doit jamais être capté par le micro
    try { const b = await decode(voice, speed, text); if (b) return await playBuffer(b, rate || 1); } catch (e) { console.warn('voix', e); }
    // Dernier recours : voix française installée dans Windows.
    return new Promise(res => {
      if (!window.speechSynthesis) return res(false);
      const u = new SpeechSynthesisUtterance(text); u.lang = voice === 'v' ? 'vi-VN' : 'fr-FR'; u.rate = rate || 0.9;
      u.onend = u.onerror = () => res(); speechSynthesis.speak(u);
    });
  }
  async function pcmOf(voice, speed, text) {
    const b = await decode(voice, speed, text); if (!b) return null;
    return { pcm: b.getChannelData(0), sr: b.sampleRate };
  }
  function playPcm(pcm, sr) { const b = ac().createBuffer(1, pcm.length, sr); b.copyToChannel(pcm instanceof Float32Array ? pcm : Float32Array.from(pcm), 0); return playBuffer(b); }

  /* Ouvre le micro, signale onReady quand le son arrive vraiment, puis enregistre jusqu'au silence. */
  let recording = false, workletReady = null;
  async function openStream(deviceId) {
    const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
    try { return await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { ...base, deviceId: { exact: deviceId } } : base }); }
    catch (e) { if (deviceId && /Overconstrained|NotFound/.test(e.name)) return navigator.mediaDevices.getUserMedia({ audio: base }); throw e; } // micro débranché : micro par défaut
  }
  function record({ deviceId, maxMs = 8000, silenceMs = 1000, noSpeechMs = 7000, onLevel, onReady }) {
    let stopFn = null, stopAsked = false;
    const done = (async () => {
      stop(); if (window.speechSynthesis) speechSynthesis.cancel();
      recording = true; setSession('play-and-record');
      let stream;
      try { stream = await openStream(deviceId); } catch (e) { recording = false; setSession('playback'); throw e; }
      if (stopAsked) { stream.getTracks().forEach(t => t.stop()); recording = false; setSession('playback'); return { pcm: new Float32Array(0), sr: 16000, spoke: false, peak: 0, cancelled: true }; }
      const c = ac(); if (c.state !== 'running') await c.resume();
      const src = c.createMediaStreamSource(stream), sink = c.createGain(); sink.gain.value = 0; sink.connect(c.destination);
      const track = stream.getAudioTracks()[0], label = track ? track.label : '';
      return new Promise(resolve => {
        const vad = new window.MicVad({ silenceMs, maxMs, noSpeechMs }), frame = Math.round(c.sampleRate * 0.02);
        const chunks = []; let total = 0, acc = 0, n = 0, finished = false, node = null, started = false, peak = 0;
        const finish = () => {
          if (finished) return; finished = true; recording = false;
          try { node.disconnect(); src.disconnect(); sink.disconnect(); } catch {}
          stream.getTracks().forEach(t => t.stop()); setSession('playback');
          const pcm = new Float32Array(total); let o = 0; for (const ch of chunks) { pcm.set(ch, o); o += ch.length; }
          resolve({ pcm, sr: c.sampleRate, spoke: vad.speaking, peak, floor: vad.floor === Infinity ? 0 : vad.floor, label, muted: track ? track.muted : false });
        };
        stopFn = finish;
        const onData = d => {
          if (finished) return;
          if (!started) { started = true; if (onReady) onReady(); }
          chunks.push(d); total += d.length;
          for (let i = 0; i < d.length; i++) {
            acc += d[i] * d[i]; if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]);
            if (++n >= frame) { const rms = Math.sqrt(acc / n); acc = 0; n = 0; if (onLevel) onLevel(Math.min(1, Math.sqrt(rms) * 2.2)); if (vad.push(rms)) { finish(); return; } }
          }
        };
        const useScriptProcessor = () => { node = c.createScriptProcessor(2048, 1, 1); node.onaudioprocess = e => onData(new Float32Array(e.inputBuffer.getChannelData(0))); src.connect(node); node.connect(sink); };
        // Si un micro n'envoie jamais rien, on ne reste pas bloqué.
        setTimeout(() => { if (!started) finish(); }, 4000);
        (workletReady = workletReady || c.audioWorklet.addModule('recorder-worklet.js')).then(() => {
          if (finished) return; node = new AudioWorkletNode(c, 'cau-recorder', { numberOfOutputs: 1 }); node.port.onmessage = e => onData(e.data); src.connect(node); node.connect(sink);
        }).catch(e => { console.warn('worklet', e); if (!finished) useScriptProcessor(); });
        if (stopAsked) finish();
      });
    })();
    return { done, stop: () => { stopAsked = true; if (stopFn) stopFn(); } };
  }
  return { output, lift, has: (v, sp, t) => index.has(U.audioKey(v, sp, t)), init, say, pcmOf, playPcm, stop, record, ac };
})();
