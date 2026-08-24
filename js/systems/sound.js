// WebAudio 音效系统：内嵌采样（js/assets.js）优先，程序化合成为兜底
window.Voxel = window.Voxel || {};

Voxel.Sound = (function () {
  var ctx = null, master = null, noiseBuffer = null;
  var MAX_SOUND_DIST = 34;
  var uwActive = false, muffle = null, uwSrc = null, uwLoopGain = null;

  // ---- 采样层 ----
  var buffers = {};          // name -> AudioBuffer
  var decodeStarted = false;
  var musicGain = null;      // BGM 独立增益（走 master，水下闷音自然生效）
  var musicMode = 'off';     // off | day | night（当前目标模式）
  var musicName = '';        // 当前实际在放的曲目
  var musicStopTimer = null;
  var MUSIC_VOL = 0.32;
  var userVol = 0.5;         // 用户音量（设置菜单）
  var flightAudio = { active: false, mode: '', phase: 'idle', arrived: false };
  var flightAudioEpoch = 0;

  // 雨声循环（程序化滤波噪声）
  var rainSrc = null, rainGain = null;

  function ac() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = userVol;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0;
      musicGain.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // 用户音量（0~1）
  function setVolume(v) {
    v = Math.max(0, Math.min(1, v));
    userVol = v * 0.75;
    var c = ac();
    if (!c) return;
    master.gain.setTargetAtTime(uwActive ? Math.min(1, userVol * 1.2) : userVol, c.currentTime, 0.05);
  }

  // base64 dataURI -> ArrayBuffer（不经过 fetch，file:// 下也可用）
  function dataURIToArrayBuffer(uri) {
    var b64 = uri.split(',')[1];
    var bin = atob(b64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function decodeAll(c) {
    if (decodeStarted || !Voxel.Assets || !Voxel.Assets.audio) return;
    decodeStarted = true;
    var names = Object.keys(Voxel.Assets.audio);
    names.forEach(function (name) {
      try {
        c.decodeAudioData(dataURIToArrayBuffer(Voxel.Assets.audio[name]), function (buf) {
          buffers[name] = buf;
        }, function () { });
      } catch (e) { }
    });
  }

  // 播放采样；返回是否成功（失败则调用方退回合成）。pan -1(左)~1(右)
  function play(name, vol, rate, pan) {
    var c = ac();
    if (!c || !buffers[name]) return false;
    var src = c.createBufferSource();
    src.buffer = buffers[name];
    var r = rate || 1;
    src.playbackRate.value = r * (0.95 + Math.random() * 0.1); // ±5% 随机变速，消除重复感
    var g = c.createGain();
    g.gain.value = Math.max(0, Math.min(1.5, vol === undefined ? 1 : vol));
    src.connect(g);
    var tail = g;
    if (pan && c.createStereoPanner) {
      var p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      tail.connect(p);
      tail = p;
    }
    tail.connect(master);
    src.start();
    return true;
  }

  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  // 材质 -> 采样池
  var STEP_POOL = {
    grass: ['step_grass_0', 'step_grass_1', 'step_grass_2'],
    dirt: ['step_dirt_0', 'step_dirt_1'],
    stone: ['step_stone_0', 'step_stone_1', 'step_stone_2'],
    wood: ['step_wood_0', 'step_wood_1', 'step_wood_2'],
    leaves: ['step_leaves_0', 'step_leaves_1'],
    sand: ['step_sand_0', 'step_sand_1'],
    snow: ['step_snow_0', 'step_snow_1', 'step_snow_2'],
    wool: ['step_wool_0', 'step_wool_1', 'step_wool_2']
  };
  var DIG_POOL = {
    stone: ['dig_0', 'dig_1', 'dig_2'],
    wood: ['dig_wood_0', 'dig_wood_1', 'dig_wood_2'],
    glass: ['dig_glass_0', 'dig_glass_1', 'dig_glass_2']
  };

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

  // 带颤音（LFO 调频）的振荡器，用于羊叫/僵尸呻吟兜底
  function toneVib(type, f0, f1, dur, vol, vibFreq, vibDepth, lowpass) {
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
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
    lfo.start(t);
    lfo.stop(t + dur + 0.02);
  }

  var matFreq = { stone: 260, dirt: 420, wood: 320, leaves: 950, sand: 620, water: 500, glass: 1400, wool: 240, snow: 1800 };

  // 距离衰减：超过 MAX_SOUND_DIST 返回 0
  function volAt(x, z) {
    return spatial(x, z).vol;
  }

  // 距离衰减 + 立体声定位
  function spatial(x, z) {
    if (!Voxel.Player) return { vol: 0, pan: 0 };
    var p = Voxel.Player.pos();
    var dx = x - p.x, dz = z - p.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d > MAX_SOUND_DIST) return { vol: 0, pan: 0 };
    // 以玩家朝向为参照做左右定位
    var yaw = (Voxel.Controls && Voxel.Controls.yaw()) || 0;
    var sin = Math.sin(yaw), cos = Math.cos(yaw);
    var right = dx * cos - dz * sin;   // 玩家右手方向分量
    var pan = Math.max(-1, Math.min(1, right / 10));
    return { vol: 1 - d / MAX_SOUND_DIST, pan: pan };
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
      master.gain.setTargetAtTime(Math.min(1, userVol * 1.2), c.currentTime, 0.05);
      startUwLoop(c);
    } else {
      if (muffle) {
        try { muffle.disconnect(); } catch (e) { }
      }
      try { master.disconnect(); } catch (e) { }
      master.connect(c.destination);
      master.gain.setTargetAtTime(userVol, c.currentTime, 0.05);
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

  // ---- 雨声（程序化滤波噪声循环，intensity 0~1）----
  function rainSet(intensity) {
    var c = ac();
    if (!c) return;
    var v = Math.max(0, Math.min(1, intensity || 0));
    if (v > 0 && !rainSrc) {
      rainSrc = c.createBufferSource();
      rainSrc.buffer = getNoise(c);
      rainSrc.loop = true;
      var f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1400;
      f.Q.value = 0.35;
      rainGain = c.createGain();
      rainGain.gain.value = 0.0001;
      rainSrc.connect(f);
      f.connect(rainGain);
      rainGain.connect(master);
      rainSrc.start();
    }
    if (rainGain) {
      rainGain.gain.setTargetAtTime(v * 0.28, c.currentTime, 0.8);
      if (v <= 0 && rainSrc) {
        var s = rainSrc;
        rainSrc = null;
        setTimeout(function () {
          try { s.stop(); s.disconnect(); } catch (e) { }
        }, 2500);
      }
    }
  }

  // 雷声：低频轰鸣（程序化）
  function thunder(vol) {
    var c = ac();
    if (!c) return;
    var v = Math.max(0.1, Math.min(1, vol || 0.7));
    var src = c.createBufferSource();
    src.buffer = getNoise(c);
    src.playbackRate.value = 0.3 + Math.random() * 0.15;
    var f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 220 + Math.random() * 120;
    var g = c.createGain();
    var t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.9 * v, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.6 + Math.random() * 0.8);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + 2.6);
    tone('sine', 60, 32, 1.2, 0.3 * v);
  }

  // ---- 背景音乐：昼夜交叉淡化 ----
  function setMusic(mode) {
    if (mode !== 'day' && mode !== 'night' && mode !== 'off') mode = 'off';
    if (mode === musicMode) return;
    musicMode = mode;
    var c = ac();
    if (!c) return;
    if (musicStopTimer) { clearTimeout(musicStopTimer); musicStopTimer = null; }
    var want = mode === 'off' ? '' : 'music_' + mode;
    if (want === musicName) {
      musicGain.gain.setTargetAtTime(MUSIC_VOL, c.currentTime, 1.0);
      return;
    }
    var prevName = musicName;
    var prevSource = musicSrc;
    musicName = want;
    // 旧曲淡出
    if (prevName && buffers[prevName]) {
      musicGain.gain.setTargetAtTime(0.0001, c.currentTime, 0.8);
      // 切换到另一首时 startMusicTrack 会立即停止旧 source；只有真正关闭
      // 音乐才延迟停止。闭包必须捕获旧 source，绝不能在 3.5s 后停止全局
      // musicSrc（那时它可能已经是新曲）。
      if (!want && prevSource) {
        musicStopTimer = setTimeout(function () {
          try { prevSource.stop(); } catch (e) { }
          if (musicSrc === prevSource) musicSrc = null;
          musicStopTimer = null;
        }, 3500);
      }
    }
    // 新曲淡入
    if (want && buffers[want]) startMusicTrack(c, want);
  }

  var musicSrc = null;
  function startMusicTrack(c, name) {
    if (musicSrc) { try { musicSrc.stop(); } catch (e) { } }
    musicSrc = c.createBufferSource();
    musicSrc.buffer = buffers[name];
    musicSrc.loop = true;
    musicSrc.connect(musicGain);
    musicSrc.start();
    musicGain.gain.cancelScheduledValues(c.currentTime);
    musicGain.gain.setValueAtTime(Math.max(0.0001, musicGain.gain.value), c.currentTime);
    musicGain.gain.setTargetAtTime(MUSIC_VOL, c.currentTime, 1.5);
  }

  // ---- 登舰/跃迁/抵达：无常驻 oscillator，phase 幂等 ----
  function warpStart(mode) {
    mode = mode === 'portal' ? 'portal' : 'ship';
    var epoch = ++flightAudioEpoch;
    flightAudio = { active: true, mode: mode, phase: 'ignition', arrived: false };
    // 来源世界环境音不得泄漏到驾驶舱/目标loading。
    setMusic('off');
    rainSet(0);
    setUnderwater(false);
    if (mode === 'portal') {
      tone('sine', 280, 620, 0.18, 0.18);
      setTimeout(function () {
        if (epoch === flightAudioEpoch && flightAudio.active && flightAudio.mode === 'portal')
          tone('sine', 420, 860, 0.14, 0.12);
      }, 90);
    } else {
      toneVib('sawtooth', 58, 128, 0.42, 0.16, 9, 9, 520);
      tone('sine', 92, 184, 0.5, 0.12);
    }
    return true;
  }

  function warpPhase(mode, phase) {
    mode = mode === 'portal' ? 'portal' : 'ship';
    if (!flightAudio.active || flightAudio.mode !== mode || typeof phase !== 'string' ||
      flightAudio.phase === phase) return false;
    flightAudio.phase = phase;
    if (phase === 'warp' || phase === 'transit') {
      if (mode === 'portal') toneVib('sine', 360, 920, 0.34, 0.13, 18, 24, 1400);
      else {
        toneVib('sawtooth', 105, 48, 0.55, 0.16, 13, 14, 700);
        noiseHit(820, 1.3, 0.28, 0.09);
      }
    } else if (phase === 'target_loading') {
      tone('sine', mode === 'portal' ? 720 : 330, mode === 'portal' ? 540 : 260, 0.2, 0.08);
    }
    return true;
  }

  function warpSkip() {
    if (!flightAudio.active) return false;
    tone('square', 760, 620, 0.055, 0.1);
    return true;
  }

  function warpArrive(mode) {
    mode = mode === 'portal' ? 'portal' : 'ship';
    if (!flightAudio.active || flightAudio.arrived) return false;
    flightAudio.arrived = true;
    flightAudio.phase = 'arrived';
    var epoch = flightAudioEpoch;
    tone('sine', mode === 'portal' ? 520 : 360, mode === 'portal' ? 880 : 720, 0.28, 0.16);
    setTimeout(function () {
      if (epoch === flightAudioEpoch && flightAudio.arrived)
        tone('sine', mode === 'portal' ? 780 : 540, mode === 'portal' ? 1040 : 900, 0.18, 0.1);
    }, 150);
    return true;
  }

  function warpEnd(arrived) {
    if (!flightAudio.active && (flightAudio.phase === 'idle' ||
      flightAudio.phase === 'complete' || flightAudio.phase === 'aborted')) return false;
    if (!arrived && flightAudio.active) tone('sine', 180, 70, 0.22, 0.12);
    flightAudioEpoch++;
    flightAudio = { active: false, mode: '', phase: arrived ? 'complete' : 'aborted', arrived: !!arrived };
    return true;
  }

  function flightAudioSnapshot() {
    return {
      active: flightAudio.active,
      mode: flightAudio.mode,
      phase: flightAudio.phase,
      arrived: flightAudio.arrived
    };
  }

  function musicStateSnapshot() {
    return {
      mode: musicMode,
      name: musicName,
      sourceActive: !!musicSrc,
      stopPending: !!musicStopTimer
    };
  }

  return {
    unlock: function () {
      var c = ac();
      if (c) decodeAll(c);
      return c;
    },
    volAt: volAt,
    spatial: spatial,
    // BGM：main.js 按昼夜切换
    setMusic: setMusic,
    warpStart: warpStart,
    warpPhase: warpPhase,
    warpSkip: warpSkip,
    warpArrive: warpArrive,
    warpEnd: warpEnd,
    flightAudioSnapshot: flightAudioSnapshot,
    musicStateSnapshot: musicStateSnapshot,
    matFreq: matFreq,
    decodedCount: function () { var n = 0; for (var k in buffers) n++; return n; },
    setVolume: setVolume,
    rainSet: rainSet,
    thunder: thunder,
    dig: function (m) {
      var pool = DIG_POOL[m];
      if (pool && play(pick(pool), 0.55)) return;
      if (!pool && m && STEP_POOL[m] && play(pick(STEP_POOL[m]), 1.15, 0.85)) return;
      noiseHit(matFreq[m] || 500, 1.2, 0.11, 0.5);
    },
    // 挖掘进行中的周期性敲击（比 dig 轻、短）
    digTick: function (m) {
      var pool = DIG_POOL[m];
      if (pool && play(pick(pool), 0.28, 1.2)) return;
      if (!pool && m && STEP_POOL[m] && play(pick(STEP_POOL[m]), 0.6, 1.05)) return;
      noiseHit(matFreq[m] || 500, 1.4, 0.06, 0.28);
    },
    place: function (m) {
      var pool = DIG_POOL[m];
      if (pool && play(pick(pool), 0.45, 0.8)) return;
      if (!pool && m && STEP_POOL[m] && play(pick(STEP_POOL[m]), 1.0, 0.75)) return;
      noiseHit((matFreq[m] || 500) * 0.7, 1.5, 0.08, 0.4);
      tone('sine', 110, 70, 0.07, 0.22);
    },
    // 材质化脚步声
    step: function (mat) {
      var pool = STEP_POOL[mat];
      if (pool && play(pick(pool), 0.5)) return;
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
      if (p > 0.35) { if (play('splash_0', 0.3 + p * 0.4)) return; }
      else if (play(pick(['splash_step_0', 'splash_step_1']), 0.35 + p * 0.5)) return;
      noiseHit(500 + Math.random() * 300, 0.7, 0.15 + p * 0.25, 0.25 + p * 0.35);
      noiseHit(150 + Math.random() * 100, 0.8, 0.2 + p * 0.2, 0.2 + p * 0.3);
      tone('sine', 160 + Math.random() * 60, 50, 0.25 + p * 0.2, 0.2 + p * 0.25);
    },
    // 游泳气泡（保持合成：短促轻量）
    bubble: function () {
      tone('sine', 250 + Math.random() * 150, 700 + Math.random() * 400, 0.09, 0.12);
    },
    jump: function () {
      tone('sine', 220, 430, 0.08, 0.07);
    },
    // 落地：hard 0~1 随下落速度
    land: function (hard) {
      var h = Math.max(0, Math.min(1, hard || 0.3));
      if (play(pick(['land_0', 'land_1', 'land_2']), 0.25 + h * 0.5, 0.85 + h * 0.25)) return;
      noiseHit(250 + Math.random() * 80, 0.9, 0.08, 0.1 + h * 0.3);
      tone('sine', 95 - h * 20, 40, 0.09 + h * 0.08, 0.12 + h * 0.35);
    },
    // 羊叫：vol 0~1（已含距离衰减），pan -1~1
    sheep: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0));
      if (v <= 0.02) return;
      if (play(pick(['sheep_0', 'sheep_1', 'sheep_2']), v * 0.75, 0.92 + Math.random() * 0.16, pan)) return;
      toneVib('sawtooth', 330, 270, 0.5, v * 0.32, 7, 35, 1200);
      toneVib('sine', 165, 135, 0.5, v * 0.25, 7, 18, 0);
    },
    sheepHurt: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0));
      if (v <= 0.02) return;
      if (play('sheep_hurt', v * 0.8, undefined, pan)) return;
      toneVib('sawtooth', 420, 330, 0.28, v * 0.3, 9, 40, 1400);
    },
    // 僵尸呻吟：vol 0~1（同一采样以变速做变体）
    zombie: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0));
      if (v <= 0.02) return;
      if (play('zombie_0', v * 0.65, 0.82 + Math.random() * 0.36, pan)) return;
      toneVib('sawtooth', 85 + Math.random() * 15, 60, 0.6 + Math.random() * 0.3, v * 0.3, 3.5, 18, 350);
    },
    // 猪哼（程序化）：短促两段低哼
    pig: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0));
      if (v <= 0.02) return;
      var f = 95 + Math.random() * 25;
      toneVib('sawtooth', f, f * 0.72, 0.11, v * 0.3, 22, 12, 480);
      setTimeout(function () { toneVib('sawtooth', f * 1.12, f * 0.8, 0.09, v * 0.24, 22, 10, 480); }, 110);
    },
    pigHurt: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0));
      if (v <= 0.02) return;
      toneVib('sawtooth', 190 + Math.random() * 40, 120, 0.14, v * 0.34, 26, 20, 700);
    },
    // 鸡咯（程序化）：短促高频咯咯
    chicken: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0));
      if (v <= 0.02) return;
      var n2 = 2 + ((Math.random() * 2) | 0);
      for (var i = 0; i < n2; i++) {
        (function (k) {
          setTimeout(function () {
            tone('square', 640 + Math.random() * 160, 380, 0.055, v * 0.16);
          }, k * 130);
        })(i);
      }
    },
    chickenHurt: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0));
      if (v <= 0.02) return;
      tone('square', 900 + Math.random() * 200, 500, 0.12, v * 0.22);
      noiseHit(1800, 1.2, 0.08, v * 0.15);
    },
    // 兔子尖叫（程序化）：轻短上滑哨音
    rabbit: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0)) * 0.55;
      if (v <= 0.02) return;
      tone('sine', 780 + Math.random() * 140, 1250 + Math.random() * 250, 0.08, v * 0.3);
    },
    rabbitHurt: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0)) * 0.7;
      if (v <= 0.02) return;
      tone('sine', 1400 + Math.random() * 300, 900, 0.11, v * 0.34);
    },
    // 进食咀嚼：两声闷响 + 收尾吞咽
    eat: function () {
      noiseHit(320 + Math.random() * 120, 1.1, 0.07, 0.22);
      setTimeout(function () { noiseHit(280 + Math.random() * 120, 1.1, 0.06, 0.2); }, 140);
      setTimeout(function () { tone('sine', 180, 90, 0.09, 0.16); }, 300);
    },
    // 头部浸水：闷音 + 水下环境声
    setUnderwater: setUnderwater,
    hit: function () {
      if (play(pick(['land_0', 'land_1']), 0.5, 1.5)) return;
      tone('square', 170, 90, 0.1, 0.28);
    },
    pop: function () {
      if (play('ui_0', 0.6, 0.6)) return;
      tone('square', 320, 55, 0.22, 0.28);
      noiseHit(900, 1, 0.15, 0.18);
    },
    hurt: function () { tone('sine', 75, 45, 0.25, 0.5); },
    select: function () {
      if (play('ui_0', 0.3)) return;
      tone('square', 750, 700, 0.045, 0.12);
    }
  };
})();
