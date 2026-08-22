// WebAudio 程序化音效（无音频文件）
window.Voxel = window.Voxel || {};

Voxel.Sound = (function () {
  var ctx = null, master = null, noiseBuffer = null;
  var MAX_SOUND_DIST = 34;
  var uwActive = false, muffle = null, uwSrc = null, uwLoopGain = null;
  var baseVol = (Voxel.Settings ? Voxel.Settings.get('volume') : 0.5);

  // 音量设置（0~1）
  function setVolume(v) {
    baseVol = Math.max(0, Math.min(1, v || 0));
    if (!ctx) return;
    var t = ctx.currentTime;
    var target = uwActive ? baseVol * 1.2 : baseVol;
    master.gain.setTargetAtTime(Math.max(0.0001, target), t, 0.05);
  }

  function ac() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = Math.max(0.0001, baseVol);
      master.connect(ctx.destination);
      if (rainPending > 0) rainSet(rainPending); // 解锁后补开雨声
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

  function noiseHit(freq, q, dur, vol, pan) {
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
    var pn = makePan(c, pan);
    if (pn) { g.connect(pn); pn.connect(master); }
    else g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(type, f0, f1, dur, vol, pan) {
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
    var pn = makePan(c, pan);
    if (pn) { g.connect(pn); pn.connect(master); }
    else g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // 带颤音（LFO 调频）的振荡器，用于羊叫/僵尸呻吟
  function toneVib(type, f0, f1, dur, vol, vibFreq, vibDepth, lowpass, pan) {
    var c = ac();
    if (!c) return;
    var o = c.createOscillator();
    o.type = type;
    var t = c.currentTime;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    o.frequency.linearRampToValueAtTime(Math.max(1, f1), t + dur);
    var lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = vibFreq;
    var lg = c.createGain();
    lg.gain.value = vibDepth;
    lfo.connect(lg);
    lg.connect(o.frequency);
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.04);
    g.gain.setValueAtTime(vol, t + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    var tail = o;
    if (lowpass) {
      var f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      o.connect(f);
      tail = f;
    }
    tail.connect(g);
    var pn = makePan(c, pan);
    if (pn) { g.connect(pn); pn.connect(master); }
    else g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
    lfo.start(t);
    lfo.stop(t + dur + 0.02);
  }

  var matFreq = { stone: 260, dirt: 420, wood: 320, leaves: 950, sand: 620, water: 500, glass: 1400, wool: 240, snow: 1800 };

  // 距离衰减：超过 MAX_SOUND_DIST 返回 0
  function volAt(x, z) {
    if (!Voxel.Player) return 0;
    var p = Voxel.Player.pos();
    var dx = x - p.x, dz = z - p.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d > MAX_SOUND_DIST) return 0;
    return 1 - d / MAX_SOUND_DIST;
  }

  // 立体声空间定位：返回 {vol 距离衰减, pan 声像 -1左~1右}
  function spatial(x, z) {
    var p = Voxel.Player.pos();
    var dx = x - p.x, dz = z - p.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    var vol = d > MAX_SOUND_DIST ? 0 : 1 - d / MAX_SOUND_DIST;
    var pan = 0;
    if (d > 0.01 && Voxel.Controls) {
      // 玩家朝向的右向量：(cos(yaw), -sin(yaw))
      var yaw = Voxel.Controls.yaw();
      var rx = Math.cos(yaw), rz = -Math.sin(yaw);
      pan = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d * 0.85));
    }
    return { vol: vol, pan: pan };
  }

  // 可选立体声节点：pan 为 0 时省略
  function makePan(c, pan) {
    if (!pan || !c.createStereoPanner) return null;
    var p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    return p;
  }

  // 水下：master 串入低通闷音 + 持续低频水声
  function setUnderwater(on) {
    if (!!on === uwActive) return;
    var c = ac();
    if (!c) return;
    uwActive = !!on;
    if (on) {
      if (!muffle) {
        muffle = c.createBiquadFilter();
        muffle.type = 'lowpass';
        muffle.frequency.value = 750;
      }
      try { master.disconnect(); } catch (e) { }
      master.connect(muffle);
      muffle.connect(c.destination);
      master.gain.setTargetAtTime(Math.max(0.0001, baseVol * 1.2), c.currentTime, 0.05);
      startUwLoop(c);
    } else {
      if (muffle) {
        try { muffle.disconnect(); } catch (e) { }
      }
      try { master.disconnect(); } catch (e) { }
      master.connect(c.destination);
      master.gain.setTargetAtTime(Math.max(0.0001, baseVol), c.currentTime, 0.05);
      stopUwLoop(c);
    }
  }

  function startUwLoop(c) {
    if (uwSrc) return;
    uwSrc = c.createBufferSource();
    uwSrc.buffer = getNoise(c);
    uwSrc.loop = true;
    var f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 320;
    var g = c.createGain();
    g.gain.value = 0.0001;
    uwSrc.connect(f);
    f.connect(g);
    g.connect(master);
    uwSrc.start();
    uwLoopGain = g;
    g.gain.setTargetAtTime(0.22, c.currentTime, 0.25);
  }

  function stopUwLoop(c) {
    if (!uwSrc) return;
    var s = uwSrc, g = uwLoopGain;
    uwSrc = null; uwLoopGain = null;
    g.gain.setTargetAtTime(0.0001, c.currentTime, 0.2);
    setTimeout(function () {
      try { s.stop(); s.disconnect(); } catch (e) { }
    }, 600);
  }

  // 雨声：常驻滤波噪声循环，音量随雨量强度 0~1
  var rainSrc = null, rainGain = null, rainPending = 0;

  function rainSet(v) {
    v = Math.max(0, Math.min(1, v || 0));
    var c = ac();
    if (!c) { rainPending = v; return; }
    rainPending = 0;
    if (!rainSrc) {
      rainSrc = c.createBufferSource();
      rainSrc.buffer = getNoise(c);
      rainSrc.loop = true;
      var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 950;
      var hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 260;
      rainGain = c.createGain(); rainGain.gain.value = 0.0001;
      rainSrc.connect(lp); lp.connect(hp); hp.connect(rainGain); rainGain.connect(master);
      rainSrc.start();
    }
    rainGain.gain.setTargetAtTime(0.0001 + v * 0.3, c.currentTime, 0.35);
  }

  // 雷鸣：低频噪声长衰减 + 次声隆隆（vol 0~1）
  function thunder(vol) {
    var c = ac();
    if (!c) return;
    var v = Math.max(0.2, Math.min(1, vol || 0.8));
    var t = c.currentTime;
    var src = c.createBufferSource();
    src.buffer = getNoise(c);
    var lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(420, t);
    lp.frequency.exponentialRampToValueAtTime(55, t + 2.6);
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v * 0.8, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8 + Math.random() * 1.6);
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start(t); src.stop(t + 4.8);
    var o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(52, t);
    o.frequency.exponentialRampToValueAtTime(27, t + 2.6);
    var g2 = c.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(v * 0.45, t + 0.09);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);
    o.connect(g2); g2.connect(master);
    o.start(t); o.stop(t + 3.2);
  }

  return {
    unlock: ac,
    volAt: volAt,
    spatial: spatial,
    setVolume: setVolume,
    dig: function (m) { noiseHit(matFreq[m] || 500, 1.2, 0.11, 0.5); },
    // 挖掘中的周期敲击声（比破坏声更轻更短）
    digTick: function (m) {
      noiseHit((matFreq[m] || 500) * 1.15, 1.6, 0.05, 0.16);
      noiseHit((matFreq[m] || 500) * 2.2, 2.5, 0.03, 0.08);
    },
    place: function (m) {
      noiseHit((matFreq[m] || 500) * 0.7, 1.5, 0.08, 0.4);
      tone('sine', 110, 70, 0.07, 0.22);
    },
    // 材质化脚步声
    step: function (mat) {
      var r = Math.random();
      switch (mat) {
        case 'grass':
          noiseHit(1000 + r * 500, 1.2, 0.045, 0.13);
          noiseHit(260 + r * 80, 1, 0.04, 0.05);
          break;
        case 'dirt':
          noiseHit(320 + r * 120, 1, 0.05, 0.15);
          break;
        case 'stone':
          noiseHit(900 + r * 700, 1.6, 0.04, 0.16);
          break;
        case 'wood':
          tone('sine', 170 + r * 30, 120, 0.06, 0.13);
          noiseHit(300 + r * 100, 1, 0.05, 0.08);
          break;
        case 'leaves':
          noiseHit(2200 + r * 600, 0.9, 0.06, 0.10);
          break;
        case 'sand':
          noiseHit(480 + r * 160, 1.1, 0.07, 0.10);
          break;
        case 'snow':
          noiseHit(1500 + r * 800, 0.8, 0.08, 0.07);
          break;
        case 'wool':
          noiseHit(180 + r * 40, 1, 0.05, 0.06);
          break;
        case 'glass':
          tone('sine', 1800 + r * 200, 1700, 0.03, 0.05);
          break;
        default:
          noiseHit(280 + r * 220, 0.8, 0.05, 0.15);
      }
    },
    // 溅水：power 0~1
    splash: function (power) {
      var p = Math.max(0.05, Math.min(1, power || 0.3));
      noiseHit(500 + Math.random() * 300, 0.7, 0.15 + p * 0.25, 0.25 + p * 0.35);
      noiseHit(150 + Math.random() * 100, 0.8, 0.2 + p * 0.2, 0.2 + p * 0.3);
      tone('sine', 160 + Math.random() * 60, 50, 0.25 + p * 0.2, 0.2 + p * 0.25);
    },
    // 游泳气泡
    bubble: function () {
      tone('sine', 250 + Math.random() * 150, 700 + Math.random() * 400, 0.09, 0.12);
    },
    jump: function () {
      tone('sine', 220, 430, 0.08, 0.07);
    },
    // 落地：hard 0~1 随下落速度
    land: function (hard) {
      var h = Math.max(0, Math.min(1, hard || 0.3));
      noiseHit(250 + Math.random() * 80, 0.9, 0.08, 0.1 + h * 0.3);
      tone('sine', 95 - h * 20, 40, 0.09 + h * 0.08, 0.12 + h * 0.35);
    },
    // 羊叫：vol 0~1（已含距离衰减），pan 声像
    sheep: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0));
      if (v <= 0.02) return;
      toneVib('sawtooth', 330, 270, 0.5, v * 0.32, 7, 35, 1200, pan);
      toneVib('sine', 165, 135, 0.5, v * 0.25, 7, 18, 0, pan);
    },
    sheepHurt: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0));
      if (v <= 0.02) return;
      toneVib('sawtooth', 420, 330, 0.28, v * 0.3, 9, 40, 1400, pan);
    },
    // 僵尸呻吟：vol 0~1，pan 声像
    zombie: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0));
      if (v <= 0.02) return;
      toneVib('sawtooth', 85 + Math.random() * 15, 60, 0.6 + Math.random() * 0.3, v * 0.3, 3.5, 18, 350, pan);
    },
    // 头部浸水：闷音 + 水下环境声
    setUnderwater: setUnderwater,
    // 雨天环境声（常驻循环，v=0 静音）
    rainSet: rainSet,
    // 雷鸣
    thunder: thunder,
    hit: function () { tone('square', 170, 90, 0.1, 0.28); },
    pop: function () {
      tone('square', 320, 55, 0.22, 0.28);
      noiseHit(900, 1, 0.15, 0.18);
    },
    hurt: function () { tone('sine', 75, 45, 0.25, 0.5); },
    select: function () { tone('square', 750, 700, 0.045, 0.12); }
  };
})();
