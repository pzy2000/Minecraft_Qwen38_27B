// WebAudio 程序化音效（无音频文件）
window.Voxel = window.Voxel || {};

Voxel.Sound = (function () {
  var ctx = null, master = null, noiseBuffer = null;

  function ac() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function getNoise(c) {
    if (noiseBuffer) return noiseBuffer;
    var len = (c.sampleRate * 0.5) | 0;
    noiseBuffer = c.createBuffer(1, len, c.sampleRate);
    var d = noiseBuffer.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  function noiseHit(freq, q, dur, vol) {
    var c = ac();
    if (!c) return;
    var src = c.createBufferSource();
    src.buffer = getNoise(c);
    var f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    var g = c.createGain();
    var t = c.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(type, f0, f1, dur, vol) {
    var c = ac();
    if (!c) return;
    var o = c.createOscillator();
    o.type = type;
    var t = c.currentTime;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    var g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  var matFreq = { stone: 260, dirt: 420, wood: 320, leaves: 950, sand: 620, water: 500, glass: 1400 };

  return {
    unlock: ac,
    dig: function (m) { noiseHit(matFreq[m] || 500, 1.2, 0.11, 0.5); },
    place: function (m) {
      noiseHit((matFreq[m] || 500) * 0.7, 1.5, 0.08, 0.4);
      tone('sine', 110, 70, 0.07, 0.22);
    },
    step: function () { noiseHit(280 + Math.random() * 220, 0.8, 0.05, 0.15); },
    hit: function () { tone('square', 170, 90, 0.1, 0.28); },
    pop: function () {
      tone('square', 320, 55, 0.22, 0.28);
      noiseHit(900, 1, 0.15, 0.18);
    },
    hurt: function () { tone('sine', 75, 45, 0.25, 0.5); },
    select: function () { tone('square', 750, 700, 0.045, 0.12); }
  };
})();
