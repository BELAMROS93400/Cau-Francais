// Capture hors du fil principal : l'analyse ou l'affichage ne peuvent plus faire perdre de son.
class Recorder extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('cau-recorder', Recorder);
