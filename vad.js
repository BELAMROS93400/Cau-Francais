/* Détection de parole par trames de 20 ms. Le bruit de fond est appris en continu, même si l'élève parle dès le début. */
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.MicVad = f(); })(typeof self !== 'undefined' ? self : this, function () {
  return class MicVad {
    constructor({ silenceMs = 1000, maxMs = 8000, noSpeechMs = 7000 } = {}) { Object.assign(this, { silenceMs, maxMs, noSpeechMs }); this.floor = Infinity; this.speaking = false; this.peak = 0; this.run = 0; this.t = 0; this.lastLoud = 0; this.maxRms = 0; }
    /* Renvoie true quand l'enregistrement doit s'arrêter. */
    push(rms, frameMs = 20) {
      this.t += frameMs; this.maxRms = Math.max(this.maxRms, rms);
      if (rms > 1e-6) this.floor = Math.min(this.floor * 1.01, rms);
      const floor = this.floor === Infinity ? 0 : this.floor;
      if (!this.speaking) {
        this.run = rms > Math.max(floor * 3.5, 0.0008) ? this.run + 1 : 0;
        if (this.run >= 3) { this.speaking = true; this.lastLoud = this.t; }
      }
      if (this.speaking) {
        this.peak = Math.max(this.peak, rms);
        if (rms > Math.max(floor * 2.2, this.peak * 0.05, 0.0006)) this.lastLoud = this.t;
        if (this.t - this.lastLoud > this.silenceMs) return true;
      } else if (this.t > this.noSpeechMs || (this.t > 2500 && this.maxRms < 1e-5)) return true; // micro muet : inutile d'attendre
      return this.t > this.maxMs;
    }
  };
});
