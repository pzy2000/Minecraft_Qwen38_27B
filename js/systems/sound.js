// WebAudio 音效系统：采样按需分块加载，程序化合成为兜底
window.Voxel = window.Voxel || {};

Voxel.Sound = (function () {
  var ctx = null, master = null, noiseBuffer = null;
  var MAX_SOUND_DIST = 34;
  var uwActive = false, muffle = null, uwSrc = null, uwLoopGain = null;

  // ---- 采样层 ----
  var buffers = {};          // name -> AudioBuffer
  var decodeRecords = {};    // name -> { state, promise }
  var decodeAttempts = {};   // name -> count（正常情况下永远 <= 1）
  var chunkRecords = {};     // id -> { state, promise }
  var chunkDecodePromises = {};
  var chunkRequests = {};
  var chunkDecodeCounts = {};
  var chunkLoader = defaultChunkLoader;
  var sfxWarmPromise = null;
  var playedNames = [];
  var synthesizedCount = 0;
  var musicGain = null;      // BGM 独立增益（走 master，水下闷音自然生效）
  var musicMode = 'off';     // off | day | night（当前目标模式）
  var musicName = '';        // 当前目标曲目（加载完成后才开始播放）
  var musicPlayingName = ''; // 当前实际在放的曲目
  var musicStopTimer = null;
  var musicEpoch = 0;
  var activeMusicStarts = 0;
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
    if (ctx.state === 'suspended') {
      // 某些浏览器在手势已失效时会拒绝 resume；音效仍可继续使用程序化兜底。
      try {
        var resumeResult = ctx.resume();
        if (resumeResult && resumeResult.catch) resumeResult.catch(function () { });
      } catch (e) { }
    }
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

  function assets() {
    return Voxel.Assets || null;
  }

  function chunkMeta(id) {
    var a = assets();
    return a && a.chunks && a.chunks[id] ? a.chunks[id] : null;
  }

  function chunkNames(id) {
    var meta = chunkMeta(id);
    if (meta && Array.isArray(meta.names)) return meta.names.slice();
    // 兼容 schemaVersion 1 的单文件内嵌资源，便于旧存档/离线缓存平滑升级。
    var a = assets();
    var names = a && a.audio ? Object.keys(a.audio) : [];
    if (id === 'music-day') return names.indexOf('music_day') >= 0 ? ['music_day'] : [];
    if (id === 'music-night') return names.indexOf('music_night') >= 0 ? ['music_night'] : [];
    if (id === 'sfx') return names.filter(function (name) { return name.indexOf('music_') !== 0; });
    return [];
  }

  function chunkIsRegistered(id) {
    var a = assets();
    if (!a) return false;
    try {
      if (typeof a.isChunkLoaded === 'function' && a.isChunkLoaded(id)) return true;
    } catch (e) { }
    var meta = chunkMeta(id);
    if (meta && a.loadedChunks && a.loadedChunks[id] === meta.hash) return true;
    var names = chunkNames(id);
    if (!names.length || !a.audio) return false;
    for (var i = 0; i < names.length; i++) {
      if (!a.audio[names[i]] && !buffers[names[i]]) return false;
    }
    return true;
  }

  function chunkUrl(meta) {
    if (!meta) return '';
    var raw = meta.url || meta.file || '';
    if (!raw) return '';
    try {
      return new URL(raw, (assets() && assets().baseUrl) || document.baseURI).href;
    } catch (e) {
      return raw;
    }
  }

  function defaultChunkLoader(id, url) {
    return new Promise(function (resolve) {
      if (!url || typeof document === 'undefined' || !document.createElement) { resolve(false); return; }
      var parent = document.head || document.documentElement;
      if (!parent || !parent.appendChild) { resolve(false); return; }
      var script = document.createElement('script');
      var settled = false;
      function finish(ok) {
        if (settled) return;
        settled = true;
        script.onload = null;
        script.onerror = null;
        if (script.parentNode) {
          try { script.parentNode.removeChild(script); } catch (e) { }
        }
        resolve(!!ok);
      }
      script.async = true;
      script.src = url;
      script.setAttribute('data-audio-chunk', id);
      script.onload = function () { finish(chunkIsRegistered(id)); };
      script.onerror = function () { finish(false); };
      try { parent.appendChild(script); } catch (e) { finish(false); }
    });
  }

  function getChunkRecord(id) {
    if (!chunkRecords[id]) chunkRecords[id] = { state: 'idle', promise: null };
    return chunkRecords[id];
  }

  // 只负责脚本加载。所有失败都解析为 false，调用方永远不会收到未处理的拒绝。
  function ensureChunk(id) {
    var record = getChunkRecord(id);
    if (record.state === 'loaded') return record.promise || Promise.resolve(true);
    if (record.state === 'failed') return record.promise || Promise.resolve(false);
    if (record.state === 'loading' && record.promise) return record.promise;
    if (chunkIsRegistered(id)) {
      record.state = 'loaded';
      record.promise = Promise.resolve(true);
      return record.promise;
    }
    var meta = chunkMeta(id);
    if (!meta) {
      record.state = 'failed';
      record.promise = Promise.resolve(false);
      return record.promise;
    }
    record.state = 'loading';
    chunkRequests[id] = (chunkRequests[id] || 0) + 1;
    try {
      record.promise = Promise.resolve(chunkLoader(id, chunkUrl(meta), meta)).then(function (ok) {
        ok = !!ok && chunkIsRegistered(id);
        record.state = ok ? 'loaded' : 'failed';
        return ok;
      }, function () {
        record.state = 'failed';
        return false;
      });
    } catch (e) {
      record.state = 'failed';
      record.promise = Promise.resolve(false);
    }
    return record.promise;
  }

  function decodeName(c, name, chunkId) {
    if (buffers[name]) return Promise.resolve(true);
    if (decodeRecords[name]) return decodeRecords[name].promise;
    var a = assets();
    var uri = a && a.audio ? a.audio[name] : '';
    if (typeof uri !== 'string' || uri.indexOf(',') < 0) return Promise.resolve(false);
    var record = { state: 'loading', promise: null };
    decodeRecords[name] = record;
    decodeAttempts[name] = (decodeAttempts[name] || 0) + 1;
    chunkDecodeCounts[chunkId] = (chunkDecodeCounts[chunkId] || 0) + 1;
    record.promise = new Promise(function (resolve) {
      var settled = false;
      function finish(buf) {
        if (settled) return;
        settled = true;
        // 后续只依赖 AudioBuffer 或程序化兜底；永久失败也不会重试，
        // 因此两条路径都应释放当前 chunk 注入的 base64 字符串。
        var current = assets();
        if (current && current.audio && current.audio[name] === uri) delete current.audio[name];
        if (buf) {
          buffers[name] = buf;
          record.state = 'decoded';
          uri = '';
          resolve(true);
        } else {
          record.state = 'failed';
          uri = '';
          resolve(false);
        }
      }
      try {
        var result = c.decodeAudioData(dataURIToArrayBuffer(uri), function (buf) {
          finish(buf || null);
        }, function () {
          finish(null);
        });
        // 同时兼容现代 Promise API 与旧版 callback API；settled 保证只记一次。
        if (result && typeof result.then === 'function') result.then(finish, function () { finish(null); });
      } catch (e) {
        finish(null);
      }
    });
    return record.promise;
  }

  function ensureDecodedChunk(id, c) {
    if (chunkDecodePromises[id]) return chunkDecodePromises[id];
    chunkDecodePromises[id] = ensureChunk(id).then(function (loaded) {
      if (!loaded) return false;
      var names = chunkNames(id);
      return Promise.all(names.map(function (name) {
        return decodeName(c, name, id);
      })).then(function (results) {
        for (var i = 0; i < results.length; i++) if (!results[i]) return false;
        return results.length > 0;
      });
    }, function () { return false; }).then(function (ready) {
      return !!ready;
    }, function () {
      return false;
    });
    return chunkDecodePromises[id];
  }

  function warmSfx(c) {
    if (!sfxWarmPromise) {
      // 保证 unlock 同步返回 AudioContext，资源加载从下一微任务才开始。
      sfxWarmPromise = Promise.resolve().then(function () {
        return ensureDecodedChunk('sfx', c);
      }).then(function (ready) { return !!ready; }, function () { return false; });
    }
    return sfxWarmPromise;
  }

  // 播放采样；返回是否成功（失败则调用方退回合成）。pan -1(左)~1(右)
  function play(name, vol, rate, pan) {
    var c = ac();
    if (!c || !buffers[name]) return false;
    try {
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
      playedNames.push(name);
      if (playedNames.length > 64) playedNames.shift();
      return true;
    } catch (e) {
      return false;
    }
  }

  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  // 分音效开关：读取设置里的 sndXxx（0=关），默认全开
  function catOn(cat) {
    var s = Voxel.Settings;
    if (s && s.get('snd' + cat) === 0) return false;
    return true;
  }

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
    synthesizedCount++;
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
    synthesizedCount++;
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
    synthesizedCount++;
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
    if (!catOn('Rain')) intensity = 0;
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
    if (!catOn('Thunder')) return;
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

  // ---- 背景音乐：昼夜曲目按需加载，并以 epoch 隔离迟到的异步结果 ----
  function setMusic(mode, force) {
    if (mode !== 'day' && mode !== 'night' && mode !== 'off') mode = 'off';
    if (!catOn('Music')) mode = 'off';
    if (mode === musicMode && !force) return;
    musicMode = mode;
    var epoch = ++musicEpoch;
    var c = ac();
    if (!c) return;
    if (musicStopTimer) { clearTimeout(musicStopTimer); musicStopTimer = null; }
    var want = mode === 'off' ? '' : 'music_' + mode;
    if (want && want === musicPlayingName && musicSrc) {
      musicName = want;
      musicGain.gain.setTargetAtTime(MUSIC_VOL, c.currentTime, 1.0);
      return;
    }
    var prevSource = musicSrc;
    musicName = want;
    // 旧曲淡出
    if (prevSource) {
      musicGain.gain.setTargetAtTime(0.0001, c.currentTime, 0.8);
      // 切换到另一首时 startMusicTrack 会立即停止旧 source；只有真正关闭
      // 音乐才延迟停止。闭包必须捕获旧 source，绝不能在 3.5s 后停止全局
      // musicSrc（那时它可能已经是新曲）。
      if (!want && prevSource) {
        var stopTimer = setTimeout(function () {
          try { prevSource.stop(); } catch (e) { }
          if (musicSrc === prevSource) {
            musicSrc = null;
            musicPlayingName = '';
          }
          if (musicStopTimer === stopTimer) musicStopTimer = null;
        }, 3500);
        musicStopTimer = stopTimer;
      }
    }
    if (!want) return;
    // 已解码曲目可以同步切换；未解码曲目只加载 day/night 对应的一个 chunk。
    if (buffers[want]) {
      if (epoch === musicEpoch && musicMode === mode) startMusicTrack(c, want);
      return;
    }
    ensureDecodedChunk('music-' + mode, c).then(function (ready) {
      if (!ready) {
        // 目标曲永久失败时，旧曲已经淡出，不能让它以静音 loop 常驻。
        // epoch 与 source 身份共同防止迟到失败误停后来启动的新曲。
        if (epoch === musicEpoch && musicMode === mode && musicName === want && musicSrc === prevSource) {
          if (prevSource) {
            try { prevSource.stop(); } catch (e) { }
            try { prevSource.disconnect(); } catch (e) { }
          }
          musicSrc = null;
          musicPlayingName = '';
          musicGain.gain.cancelScheduledValues(c.currentTime);
          musicGain.gain.setValueAtTime(0.0001, c.currentTime);
        }
        return;
      }
      if (epoch !== musicEpoch || musicMode !== mode || musicName !== want || !buffers[want]) return;
      startMusicTrack(c, want);
    }, function () { });
  }

  var musicSrc = null;
  function startMusicTrack(c, name) {
    var next = null;
    try {
      next = c.createBufferSource();
      next.buffer = buffers[name];
      next.loop = true;
      next.connect(musicGain);
      next.start();
      if (musicSrc) { try { musicSrc.stop(); } catch (e) { } }
      musicSrc = next;
      musicPlayingName = name;
      activeMusicStarts++;
      musicGain.gain.cancelScheduledValues(c.currentTime);
      musicGain.gain.setValueAtTime(Math.max(0.0001, musicGain.gain.value), c.currentTime);
      musicGain.gain.setTargetAtTime(MUSIC_VOL, c.currentTime, 1.5);
      return true;
    } catch (e) {
      if (next) { try { next.stop(); } catch (stopError) { } }
      return false;
    }
  }

  function stopEnvironment() {
    // 强制推进音乐 epoch，使所有尚未完成的异步曲目都失效。
    setMusic('off', true);
    rainSet(0);
    setUnderwater(false);
    return true;
  }

  // ---- 登舰/跃迁/抵达：无常驻 oscillator，phase 幂等 ----
  function warpStart(mode) {
    mode = mode === 'portal' ? 'portal' : 'ship';
    var epoch = ++flightAudioEpoch;
    flightAudio = { active: true, mode: mode, phase: 'ignition', arrived: false };
    // 来源世界环境音不得泄漏到驾驶舱/目标loading。
    stopEnvironment();
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

  // ---- 星海嘉年华乘坐音效（程序化合成；v 由调用方按距离预算 0..1） ----

  // 上车双音提示铃（不受距离衰减：玩家刚上车必在场）
  function rideBell() {
    tone('sine', 880, 880, 0.16, 0.12);
    setTimeout(function () { tone('sine', 1174, 1174, 0.24, 0.1); }, 150);
  }

  // 链式提升"咔哒"（过山车爬坡的金属棘轮）
  function rideClank(v) {
    if (v <= 0) return;
    noiseHit(1900 + Math.random() * 320, 3.2, 0.05, 0.62 * v);
    tone('square', 220, 165, 0.055, 0.26 * v);
  }

  // 风啸（俯冲/高速段，宽带噪声短扫）
  function rideWhoosh(v) {
    if (v <= 0) return;
    noiseHit(420 + v * 900, 0.8, 0.28, 0.5 * v);
    noiseHit(1400 + v * 1200, 1.6, 0.15, 0.22 * v);
  }

  // 跳楼机自由坠呼啸（下滑锯齿 + 噪声），着陆闷响单独一击
  function dropFallWhistle(v) {
    if (v <= 0) return;
    var c = ac();
    if (!c) return;
    toneVib('sawtooth', 640, 170, 0.58, 0.3 * v, 7, 30, 1100);
    noiseHit(1100, 0.7, 0.52, 0.36 * v);
  }
  function dropThud(v) {
    if (v <= 0) return;
    noiseHit(160, 0.9, 0.18, 0.55 * v);
    tone('sine', 92, 46, 0.16, 0.4 * v);
  }

  // 旋转木马八音盒音符（C 大调琶音循环，triangle+sine 双层）
  var CAROUSEL_NOTES = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25];
  function carouselNote(step, v) {
    if (v <= 0) return;
    var f = CAROUSEL_NOTES[((step % CAROUSEL_NOTES.length) + CAROUSEL_NOTES.length) %
      CAROUSEL_NOTES.length];
    tone('sine', f, f, 0.32, 0.14 * v);
    tone('triangle', f * 2, f * 2, 0.2, 0.06 * v);
  }

  // 摩天轮低位换向轻响（每 1/4 圈一次的机械呼吸感）
  function ferrisCreak(v) {
    if (v <= 0) return;
    noiseHit(300, 1.6, 0.1, 0.16 * v);
    tone('sine', 130, 108, 0.11, 0.11 * v);
  }

  // 烟花：升空哨 + 爆裂闷响 + 碎裂嘶声（v 为距离衰减 0..1）
  function fireworkLaunch(v) {
    if (v <= 0) return;
    tone('sine', 320, 980, 0.65, 0.05 * v);
  }
  function fireworkBoom(v) {
    if (v <= 0) return;
    noiseHit(170, 0.7, 0.5, 0.26 * v);
    tone('sine', 66, 34, 0.4, 0.2 * v);
    noiseHit(2600, 0.9, 0.22, 0.05 * v);
  }

  function musicStateSnapshot() {
    var chunkId = musicName === 'music_day' ? 'music-day' :
      musicName === 'music_night' ? 'music-night' : '';
    var chunkRecord = chunkId ? chunkRecords[chunkId] : null;
    var decodeRecord = musicName ? decodeRecords[musicName] : null;
    return {
      mode: musicMode,
      name: musicName,
      playingName: musicPlayingName,
      sourceActive: !!musicSrc,
      stopPending: !!musicStopTimer,
      epoch: musicEpoch,
      loading: !!musicName && !buffers[musicName] &&
        !!((chunkRecord && chunkRecord.state === 'loading') ||
          (decodeRecord && decodeRecord.state === 'loading'))
    };
  }

  function copyMap(source) {
    var out = {};
    for (var key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
    }
    return out;
  }

  function audioStateSnapshot() {
    var ids = ['sfx', 'music-day', 'music-night'];
    var a = assets();
    if (a && a.chunks) {
      Object.keys(a.chunks).forEach(function (id) {
        if (ids.indexOf(id) < 0) ids.push(id);
      });
    }
    Object.keys(chunkRecords).forEach(function (id) {
      if (ids.indexOf(id) < 0) ids.push(id);
    });
    var chunks = {}, chunkStates = {};
    ids.forEach(function (id) {
      var record = getChunkRecord(id);
      // manifest 可能由另一段预加载脚本先注册，快照也应如实反映 loaded。
      if (record.state === 'idle' && chunkIsRegistered(id)) record.state = 'loaded';
      var meta = chunkMeta(id);
      chunks[id] = {
        state: record.state,
        requestCount: chunkRequests[id] || 0,
        decodeCount: chunkDecodeCounts[id] || 0,
        names: meta && Array.isArray(meta.names) ? meta.names.slice() : chunkNames(id),
        url: meta ? chunkUrl(meta) : ''
      };
      chunkStates[id] = record.state;
    });
    var decodedNames = Object.keys(buffers).sort();
    var decodeStates = {};
    Object.keys(decodeRecords).forEach(function (name) {
      decodeStates[name] = decodeRecords[name].state;
    });
    return {
      contextCreated: !!ctx,
      decodedNames: decodedNames,
      decodedCount: decodedNames.length,
      decodeStates: decodeStates,
      decodeAttempts: copyMap(decodeAttempts),
      chunks: chunks,
      chunkStates: chunkStates,
      chunkRequests: copyMap(chunkRequests),
      chunkDecodeCounts: copyMap(chunkDecodeCounts),
      synthesizedCount: synthesizedCount,
      fallbackCount: synthesizedCount,
      playedNames: playedNames.slice(),
      activeMusicStarts: activeMusicStarts,
      music: musicStateSnapshot()
    };
  }

  function setChunkLoaderForTests(loader) {
    if (typeof loader !== 'function') return false;
    chunkLoader = loader;
    return true;
  }

  return {
    unlock: function () {
      var c = ac();
      if (c) warmSfx(c);
      return c;
    },
    ensureChunk: ensureChunk,
    audioStateSnapshot: audioStateSnapshot,
    setChunkLoaderForTests: setChunkLoaderForTests,
    stopEnvironment: stopEnvironment,
    volAt: volAt,
    spatial: spatial,
    // BGM：main.js 按昼夜切换
    setMusic: setMusic,
    warpStart: warpStart,
    warpPhase: warpPhase,
    warpSkip: warpSkip,
    warpArrive: warpArrive,
    warpEnd: warpEnd,
    // 星海嘉年华乘坐音效
    rideBell: rideBell,
    rideClank: rideClank,
    rideWhoosh: rideWhoosh,
    dropFallWhistle: dropFallWhistle,
    dropThud: dropThud,
    carouselNote: carouselNote,
    ferrisCreak: ferrisCreak,
    fireworkLaunch: fireworkLaunch,
    fireworkBoom: fireworkBoom,
    flightAudioSnapshot: flightAudioSnapshot,
    musicStateSnapshot: musicStateSnapshot,
    matFreq: matFreq,
    decodedCount: function () { return Object.keys(buffers).length; },
    setVolume: setVolume,
    rainSet: rainSet,
    thunder: thunder,
    dig: function (m) {
      if (!catOn('Dig')) return;
      var pool = DIG_POOL[m];
      if (pool && play(pick(pool), 0.55)) return;
      if (!pool && m && STEP_POOL[m] && play(pick(STEP_POOL[m]), 1.15, 0.85)) return;
      noiseHit(matFreq[m] || 500, 1.2, 0.11, 0.5);
    },
    // 挖掘进行中的周期性敲击（比 dig 轻、短）
    digTick: function (m) {
      if (!catOn('Dig')) return;
      var pool = DIG_POOL[m];
      if (pool && play(pick(pool), 0.28, 1.2)) return;
      if (!pool && m && STEP_POOL[m] && play(pick(STEP_POOL[m]), 0.6, 1.05)) return;
      noiseHit(matFreq[m] || 500, 1.4, 0.06, 0.28);
    },
    place: function (m) {
      if (!catOn('Dig')) return;
      var pool = DIG_POOL[m];
      if (pool && play(pick(pool), 0.45, 0.8)) return;
      if (!pool && m && STEP_POOL[m] && play(pick(STEP_POOL[m]), 1.0, 0.75)) return;
      noiseHit((matFreq[m] || 500) * 0.7, 1.5, 0.08, 0.4);
      tone('sine', 110, 70, 0.07, 0.22);
    },
    // 材质化脚步声
    step: function (mat) {
      if (!catOn('Step')) return;
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
      if (!catOn('Water')) return;
      var p = Math.max(0.05, Math.min(1, power || 0.3));
      if (p > 0.35) { if (play('splash_0', 0.3 + p * 0.4)) return; }
      else if (play(pick(['splash_step_0', 'splash_step_1']), 0.35 + p * 0.5)) return;
      noiseHit(500 + Math.random() * 300, 0.7, 0.15 + p * 0.25, 0.25 + p * 0.35);
      noiseHit(150 + Math.random() * 100, 0.8, 0.2 + p * 0.2, 0.2 + p * 0.3);
      tone('sine', 160 + Math.random() * 60, 50, 0.25 + p * 0.2, 0.2 + p * 0.25);
    },
    // 游泳气泡（保持合成：短促轻量）
    bubble: function () {
      if (!catOn('Water')) return;
      tone('sine', 250 + Math.random() * 150, 700 + Math.random() * 400, 0.09, 0.12);
    },
    jump: function () {
      if (!catOn('Land')) return;
      tone('sine', 220, 430, 0.08, 0.07);
    },
    // 落地：hard 0~1 随下落速度
    land: function (hard) {
      if (!catOn('Land')) return;
      var h = Math.max(0, Math.min(1, hard || 0.3));
      if (play(pick(['land_0', 'land_1', 'land_2']), 0.25 + h * 0.5, 0.85 + h * 0.25)) return;
      noiseHit(250 + Math.random() * 80, 0.9, 0.08, 0.1 + h * 0.3);
      tone('sine', 95 - h * 20, 40, 0.09 + h * 0.08, 0.12 + h * 0.35);
    },
    // 羊叫：vol 0~1（已含距离衰减），pan -1~1
    sheep: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0));
      if (v <= 0.02 || !catOn('Sheep')) return;
      if (play(pick(['sheep_0', 'sheep_1', 'sheep_2']), v * 0.75, 0.92 + Math.random() * 0.16, pan)) return;
      toneVib('sawtooth', 330, 270, 0.5, v * 0.32, 7, 35, 1200);
      toneVib('sine', 165, 135, 0.5, v * 0.25, 7, 18, 0);
    },
    sheepHurt: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0));
      if (v <= 0.02 || !catOn('Sheep')) return;
      if (play('sheep_hurt', v * 0.8, undefined, pan)) return;
      toneVib('sawtooth', 420, 330, 0.28, v * 0.3, 9, 40, 1400);
    },
    // 僵尸呻吟：vol 0~1（同一采样以变速做变体）
    zombie: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0));
      if (v <= 0.02 || !catOn('Zombie')) return;
      if (play('zombie_0', v * 0.65, 0.82 + Math.random() * 0.36, pan)) return;
      toneVib('sawtooth', 85 + Math.random() * 15, 60, 0.6 + Math.random() * 0.3, v * 0.3, 3.5, 18, 350);
    },
    // 猪哼（程序化）：短促两段低哼
    pig: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0));
      if (v <= 0.02 || !catOn('Pig')) return;
      var f = 95 + Math.random() * 25;
      toneVib('sawtooth', f, f * 0.72, 0.11, v * 0.3, 22, 12, 480);
      setTimeout(function () { toneVib('sawtooth', f * 1.12, f * 0.8, 0.09, v * 0.24, 22, 10, 480); }, 110);
    },
    pigHurt: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0));
      if (v <= 0.02 || !catOn('Pig')) return;
      toneVib('sawtooth', 190 + Math.random() * 40, 120, 0.14, v * 0.34, 26, 20, 700);
    },
    // 鸡咯（程序化）：短促高频咯咯
    chicken: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0));
      if (v <= 0.02 || !catOn('Chicken')) return;
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
      if (v <= 0.02 || !catOn('Chicken')) return;
      tone('square', 900 + Math.random() * 200, 500, 0.12, v * 0.22);
      noiseHit(1800, 1.2, 0.08, v * 0.15);
    },
    // 兔子尖叫（程序化）：轻短上滑哨音
    rabbit: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0)) * 0.55;
      if (v <= 0.02 || !catOn('Rabbit')) return;
      tone('sine', 780 + Math.random() * 140, 1250 + Math.random() * 250, 0.08, v * 0.3);
    },
    rabbitHurt: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0)) * 0.7;
      if (v <= 0.02 || !catOn('Rabbit')) return;
      tone('sine', 1400 + Math.random() * 300, 900, 0.11, v * 0.34);
    },
    // 猫叫（真猫采样）：每品种专属叫声（cat_0 橘猫 / cat_1 玄猫 / cat_2 白猫 / cat_3 布偶猫）
    // vol 0~1（已含距离衰减），pan -1~1，breed 为品种叫声索引（0~3，缺省随机）
    cat: function (vol, pan, breed) {
      var v = Math.max(0, Math.min(1, vol || 0));
      if (v <= 0.02 || !catOn('Cat')) return;
      var names = ['cat_0', 'cat_1', 'cat_2', 'cat_3'];
      var name = (breed >= 0 && breed < names.length) ? names[breed] : pick(names);
      if (play(name, v * 0.75, 0.94 + Math.random() * 0.12, pan)) return;
      toneVib('sawtooth', 620, 420, 0.42, v * 0.26, 9, 26, 1600);
      toneVib('sine', 310, 210, 0.42, v * 0.22, 9, 14, 0);
    },
    catHurt: function (vol, pan) {
      var v = Math.max(0, Math.min(1, vol || 0));
      if (v <= 0.02 || !catOn('Cat')) return;
      if (play('cat_hurt', v * 0.8, 1 + Math.random() * 0.08, pan)) return;
      toneVib('sawtooth', 780, 560, 0.24, v * 0.3, 12, 32, 1800);
      noiseHit(1400, 0.8, 0.06, v * 0.12);
    },
    // 进食咀嚼：两声闷响 + 收尾吞咽
    eat: function () {
      if (!catOn('Eat')) return;
      noiseHit(320 + Math.random() * 120, 1.1, 0.07, 0.22);
      setTimeout(function () { noiseHit(280 + Math.random() * 120, 1.1, 0.06, 0.2); }, 140);
      setTimeout(function () { tone('sine', 180, 90, 0.09, 0.16); }, 300);
    },
    // 头部浸水：闷音 + 水下环境声
    setUnderwater: setUnderwater,
    hit: function () {
      if (!catOn('Ui')) return;
      if (play(pick(['land_0', 'land_1']), 0.5, 1.5)) return;
      tone('square', 170, 90, 0.1, 0.28);
    },
    pop: function () {
      if (!catOn('Ui')) return;
      if (play('ui_0', 0.6, 0.6)) return;
      tone('square', 320, 55, 0.22, 0.28);
      noiseHit(900, 1, 0.15, 0.18);
    },
    hurt: function () { tone('sine', 75, 45, 0.25, 0.5); },
    select: function () {
      if (!catOn('Ui')) return;
      if (play('ui_0', 0.3)) return;
      tone('square', 750, 700, 0.045, 0.12);
    }
  };
})();
