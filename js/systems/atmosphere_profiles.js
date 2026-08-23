// 行星大气与天体描述：只产生可序列化的纯数据，不依赖场景或页面 API。
window.Voxel = window.Voxel || {};

Voxel.AtmosphereProfiles = (function () {
  var TWO_PI = Math.PI * 2;
  var ORDER = ['lush', 'arid', 'frozen', 'toxic', 'volcanic', 'oceanic', 'station'];

  var PRESETS = {
    lush: {
      day: [0x4f9ed8, 0xa8dfd1], dusk: [0x654776, 0xff8b58], night: [0x050a1c, 0x12294a],
      tintDay: 0xf4fff6, tintNight: 0x5979a0, ambientFloor: 0.22, exponent: 0.72, weatherMix: 0.78,
      weather: [0x465d6c, 0x667b80, 0x111925, 0x1b2937, 0xa5b4bc, 0xd5dde0, 'rain', 0x9fc7e6],
      stars: [420, 0xf5ffff, 0x8dd8ff], nebula: [0x2b8f88, 0x6c4fa1, 0.28, 0.35],
      suns: [
        { role: 'sun', style: 'warm-disc', size: 54, color: 0xffdd79, phase: 0, inclination: 0.10, cyclesPerDay: 1 }
      ],
      moons: [
        { role: 'moon', style: 'cratered', size: 34, color: 0xddeaff, phase: 0.50, inclination: -0.12, cyclesPerDay: 1 },
        { role: 'moon', style: 'mottled', size: 17, color: 0x91d6b1, phase: 0.18, inclination: 0.43, cyclesPerDay: 2 }
      ],
      landmark: { role: 'ringed-landmark', style: 'verdant-banded', size: 46, color: 0x6eb99b, phase: 0.77, inclination: 0.31,
        ring: { color: 0xd4efc2, inner: 1.24, outer: 1.82, opacity: 0.62, tilt: 0.44 } },
      signatureRole: 'pollen', particles: { role: 'pollen', count: 34, color: 0xb9ffad }
    },
    arid: {
      day: [0x945234, 0xe8ae67], dusk: [0x6e2d35, 0xff6438], night: [0x100612, 0x321421],
      tintDay: 0xffe0ad, tintNight: 0x835362, ambientFloor: 0.18, exponent: 0.82, weatherMix: 0.58,
      weather: [0x755442, 0xa17a55, 0x201017, 0x3b2527, 0xbba07f, 0xd7b47b, 'dust', 0xd7ae72],
      stars: [360, 0xffefcf, 0xffa96b], nebula: [0xa8452f, 0x7a304e, 0.34, 1.08],
      suns: [
        { role: 'sun', style: 'binary-gold', size: 48, color: 0xffc05c, phase: 0, inclination: 0.17, cyclesPerDay: 1 },
        { role: 'sun', style: 'binary-white', size: 25, color: 0xfff0cf, phase: 0.06, inclination: 0.24, cyclesPerDay: 1 }
      ],
      moons: [
        { role: 'moon', style: 'dune', size: 27, color: 0xd9a66a, phase: 0.48, inclination: -0.19, cyclesPerDay: 1 },
        { role: 'moon', style: 'dark-rock', size: 15, color: 0x5c3b38, phase: 0.72, inclination: 0.52, cyclesPerDay: 3 }
      ],
      landmark: { role: 'ringed-landmark', style: 'ochre-banded', size: 42, color: 0xc77c4d, phase: 0.82, inclination: -0.34,
        ring: { color: 0xf1c887, inner: 1.20, outer: 1.75, opacity: 0.68, tilt: -0.56 } },
      signatureRole: 'dust', particles: { role: 'dust', count: 48, color: 0xe4b46e }
    },
    frozen: {
      day: [0x4f82a9, 0xb8e4ed], dusk: [0x555f92, 0xa6cce2], night: [0x030a1a, 0x102a45],
      tintDay: 0xe7fbff, tintNight: 0x6187b0, ambientFloor: 0.25, exponent: 0.64, weatherMix: 0.82,
      weather: [0x627887, 0x9fb5bd, 0x101a28, 0x233747, 0xb9cbd2, 0xe7f8ff, 'snow', 0xd9f6ff],
      stars: [500, 0xf7ffff, 0x83cfff], nebula: [0x287eb0, 0x5d4fb5, 0.31, 2.16],
      suns: [
        { role: 'sun', style: 'cold-white', size: 47, color: 0xeaf8ff, phase: 0, inclination: -0.08, cyclesPerDay: 1 }
      ],
      moons: [
        { role: 'moon', style: 'glacial', size: 31, color: 0xc8f3ff, phase: 0.51, inclination: 0.16, cyclesPerDay: 1 },
        { role: 'moon', style: 'faceted', size: 18, color: 0x80bcd9, phase: 0.24, inclination: -0.48, cyclesPerDay: 2 },
        { role: 'moon', style: 'smooth', size: 12, color: 0xe9f0ff, phase: 0.79, inclination: 0.57, cyclesPerDay: 3 }
      ],
      landmark: { role: 'ringed-landmark', style: 'ice-banded', size: 50, color: 0x78b8cf, phase: 0.69, inclination: -0.26,
        ring: { color: 0xd8f7ff, inner: 1.18, outer: 1.95, opacity: 0.76, tilt: 0.32 } },
      signatureRole: 'aurora', particles: { role: 'aurora', count: 72, color: 0x70ffd8 }
    },
    toxic: {
      day: [0x415a2b, 0x9db65a], dusk: [0x4e3a31, 0xa49a45], night: [0x08110a, 0x20331d],
      tintDay: 0xd8ef9a, tintNight: 0x54764f, ambientFloor: 0.24, exponent: 0.92, weatherMix: 0.88,
      weather: [0x4c5f3c, 0x75824b, 0x121b13, 0x283528, 0x87966a, 0xb5ca68, 'spores', 0xa9d462],
      stars: [330, 0xeaffc5, 0xb06cff], nebula: [0x77a82d, 0x733a91, 0.42, 3.02],
      suns: [
        { role: 'sun', style: 'acid-star', size: 51, color: 0xd8ff62, phase: 0, inclination: 0.21, cyclesPerDay: 1 }
      ],
      moons: [
        { role: 'moon', style: 'banded', size: 33, color: 0x8da84d, phase: 0.54, inclination: -0.30, cyclesPerDay: 2 }
      ],
      landmark: { role: 'ringed-landmark', style: 'banded-ringed', size: 55, color: 0x75933c, phase: 0.75, inclination: 0.38,
        ring: { color: 0xc5e85e, inner: 1.16, outer: 1.88, opacity: 0.70, tilt: -0.45 } },
      signatureRole: 'spores', particles: { role: 'spores', count: 68, color: 0xb7ed61 }
    },
    volcanic: {
      day: [0x5a1c1b, 0xc14b2b], dusk: [0x4a101b, 0xff3b1f], night: [0x090207, 0x2a090d],
      tintDay: 0xffb06e, tintNight: 0x7f3940, ambientFloor: 0.16, exponent: 1.04, weatherMix: 0.66,
      weather: [0x4d2a29, 0x774038, 0x14080a, 0x321217, 0x87645f, 0x8e5a49, 'ash', 0x8c6860],
      stars: [300, 0xffe0bd, 0xff5b39], nebula: [0xb52d1d, 0x5a1635, 0.39, 4.14],
      suns: [
        { role: 'sun', style: 'red-giant', size: 63, color: 0xff5a2e, phase: 0, inclination: -0.13, cyclesPerDay: 1 },
        { role: 'sun', style: 'ember-dwarf', size: 21, color: 0xffbd5c, phase: 0.09, inclination: -0.02, cyclesPerDay: 1 }
      ],
      moons: [
        { role: 'moon', style: 'black-disc', size: 29, color: 0x09080b, phase: 0.49, inclination: 0.28, cyclesPerDay: 1 }
      ],
      landmark: { role: 'ringed-landmark', style: 'magma-banded', size: 44, color: 0x9f3022, phase: 0.73, inclination: -0.42,
        ring: { color: 0xf0743f, inner: 1.22, outer: 1.73, opacity: 0.61, tilt: 0.61 } },
      signatureRole: 'ash', particles: { role: 'ash', count: 76, color: 0xff7042 }
    },
    oceanic: {
      day: [0x296ca6, 0x72c7d5], dusk: [0x3d4d91, 0xe27f78], night: [0x02091c, 0x0d2850],
      tintDay: 0xdafaff, tintNight: 0x4e73aa, ambientFloor: 0.23, exponent: 0.68, weatherMix: 0.86,
      weather: [0x3b667d, 0x668e9b, 0x0b1728, 0x19344b, 0x8caeb9, 0xb6dce5, 'rain', 0x83cdec],
      stars: [450, 0xf2ffff, 0x69bfff], nebula: [0x225fbd, 0x643d9e, 0.36, 5.08],
      suns: [
        { role: 'sun', style: 'blue-white', size: 52, color: 0xd9f4ff, phase: 0, inclination: 0.06, cyclesPerDay: 1 }
      ],
      moons: [
        { role: 'moon', style: 'ocean-cratered', size: 39, color: 0xb9dcf4, phase: 0.50, inclination: -0.15, cyclesPerDay: 1 },
        { role: 'moon', style: 'pearl', size: 16, color: 0xebffff, phase: 0.27, inclination: 0.49, cyclesPerDay: 2 }
      ],
      landmark: { role: 'ringed-landmark', style: 'large-ringed-ocean', size: 58, color: 0x397dc2, phase: 0.78, inclination: 0.29,
        ring: { color: 0xa8e9ff, inner: 1.12, outer: 2.18, opacity: 0.78, tilt: -0.36 } },
      signatureRole: 'sea-mist', particles: { role: 'sea-mist', count: 40, color: 0xa4e8f2 }
    },
    station: {
      day: [0x02040d, 0x080d1b], dusk: [0x030511, 0x0b1024], night: [0x010208, 0x050918],
      tintDay: 0xb8c9e8, tintNight: 0x7385a8, ambientFloor: 0.32, exponent: 0.88, weatherMix: 0,
      weather: [0x03050e, 0x090e20, 0x02030a, 0x060a18, 0xffffff, 0xffffff, 'none', 0x000000],
      stars: [680, 0xe8f3ff, 0xa488ff], nebula: [0x273f8c, 0x743d91, 0.32, 5.72],
      suns: [], moons: [],
      landmark: { role: 'ringed-landmark', style: 'station-parent-ringed', size: 74, color: 0x477db0, phase: 0.64, inclination: -0.22,
        ring: { color: 0xc8dcff, inner: 1.18, outer: 1.88, opacity: 0.66, tilt: 0.51 } },
      signatureRole: 'station-stars', particles: { role: 'station-stars', count: 96, color: 0xd7e9ff }
    }
  };

  function finite(v, fallback, min, max) {
    var n = typeof v === 'number' && isFinite(v) ? v : fallback;
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
  }

  function normalizeSeed(seed) {
    if (typeof seed === 'bigint') return Voxel.SeedUtil.toString(seed);
    if (typeof seed === 'number' && isFinite(seed)) return Voxel.SeedUtil.toString(Voxel.SeedUtil.toBigInt(seed));
    if (typeof seed === 'string' && seed.trim()) return Voxel.SeedUtil.toString(Voxel.SeedUtil.parse(seed.trim()));
    return '0';
  }

  function hash32(seed, salt) {
    return Voxel.SeedUtil.derive32(normalizeSeed(seed), salt >>> 0) >>> 0;
  }

  function unit(seed, salt) { return hash32(seed, salt) / 4294967296; }
  function signedUnit(seed, salt) { return unit(seed, salt) * 2 - 1; }
  function clamp01(v) { return finite(v, 0, 0, 1); }
  function wrap01(v) { v %= 1; return v < 0 ? v + 1 : v; }

  function varyColor(color, seed, salt, amount) {
    var scale = 1 + signedUnit(seed, salt) * amount;
    var r = Math.max(0, Math.min(255, Math.round(((color >> 16) & 255) * scale)));
    var g = Math.max(0, Math.min(255, Math.round(((color >> 8) & 255) * scale)));
    var b = Math.max(0, Math.min(255, Math.round((color & 255) * scale)));
    return (r << 16) | (g << 8) | b;
  }

  function bodyCopy(body, seed, salt) {
    return {
      role: body.role,
      style: body.style,
      size: Math.round(finite(body.size * (1 + signedUnit(seed, salt) * 0.07), body.size, 4, 128) * 10) / 10,
      color: varyColor(body.color, seed, salt + 1, 0.07),
      phase: wrap01(body.phase + signedUnit(seed, salt + 2) * 0.035),
      inclination: finite(body.inclination + signedUnit(seed, salt + 3) * 0.06, body.inclination, -1.2, 1.2),
      cyclesPerDay: Math.max(1, Math.floor(body.cyclesPerDay))
    };
  }

  function bodiesCopy(list, seed, salt) {
    var out = [];
    for (var i = 0; i < list.length; i++) out.push(bodyCopy(list[i], seed, salt + i * 11));
    return out;
  }

  function pair(base, seed, salt) {
    return { top: varyColor(base[0], seed, salt, 0.055), horizon: varyColor(base[1], seed, salt + 1, 0.055) };
  }

  function profileFor(typeKey, seed) {
    var key = Object.prototype.hasOwnProperty.call(PRESETS, typeKey) ? typeKey : 'lush';
    var base = PRESETS[key];
    var stableSeed = normalizeSeed(seed);
    var landmarkBase = base.landmark;
    var ringBase = landmarkBase.ring;
    var ringScale = 1 + signedUnit(stableSeed, 0x6110) * 0.035;
    var ringInner = ringBase.inner * ringScale;
    var ringWidth = (ringBase.outer - ringBase.inner) * (1 + signedUnit(stableSeed, 0x6111) * 0.06);
    var variantHash = hash32(stableSeed, 0x7a31); // 整个描述的可对比种子签名。

    return {
      role: 'sky-dome',
      typeKey: key,
      worldId: null,
      seed: stableSeed,
      station: key === 'station',
      day: pair(base.day, stableSeed, 0x1000),
      dusk: pair(base.dusk, stableSeed, 0x1010),
      night: pair(base.night, stableSeed, 0x1020),
      tintDay: varyColor(base.tintDay, stableSeed, 0x1030, 0.04),
      tintNight: varyColor(base.tintNight, stableSeed, 0x1031, 0.04),
      ambientFloor: finite(base.ambientFloor + signedUnit(stableSeed, 0x1040) * 0.018, base.ambientFloor, 0.08, 0.5),
      exponent: finite(base.exponent + signedUnit(stableSeed, 0x1041) * 0.045, base.exponent, 0.4, 1.4),
      weatherMix: finite(base.weatherMix + signedUnit(stableSeed, 0x1042) * 0.025, base.weatherMix, 0, 1),
      weather: {
        topDay: varyColor(base.weather[0], stableSeed, 0x2000, 0.045),
        horizonDay: varyColor(base.weather[1], stableSeed, 0x2001, 0.045),
        topNight: varyColor(base.weather[2], stableSeed, 0x2002, 0.045),
        horizonNight: varyColor(base.weather[3], stableSeed, 0x2003, 0.045),
        tint: varyColor(base.weather[4], stableSeed, 0x2004, 0.035),
        cloud: varyColor(base.weather[5], stableSeed, 0x2005, 0.035),
        precipitation: base.weather[6],
        precipitationColor: varyColor(base.weather[7], stableSeed, 0x2006, 0.035)
      },
      stars: {
        role: 'stars',
        count: Math.max(64, Math.min(768, base.stars[0] + (hash32(stableSeed, 0x3000) % 49) - 24)),
        color: varyColor(base.stars[1], stableSeed, 0x3001, 0.04),
        secondaryColor: varyColor(base.stars[2], stableSeed, 0x3002, 0.05)
      },
      nebula: {
        colorA: varyColor(base.nebula[0], stableSeed, 0x4000, 0.07),
        colorB: varyColor(base.nebula[1], stableSeed, 0x4001, 0.07),
        opacity: clamp01(base.nebula[2] + signedUnit(stableSeed, 0x4002) * 0.035),
        rotation: (base.nebula[3] + unit(stableSeed, 0x4003) * 0.28) % TWO_PI,
        seed: hash32(stableSeed, 0x4004)
      },
      suns: bodiesCopy(base.suns, stableSeed, 0x5000),
      moons: bodiesCopy(base.moons, stableSeed, 0x5500),
      landmark: {
        role: landmarkBase.role,
        style: landmarkBase.style,
        size: Math.round(finite(landmarkBase.size * (1 + signedUnit(stableSeed, 0x6000) * 0.06), landmarkBase.size, 8, 128) * 10) / 10,
        color: varyColor(landmarkBase.color, stableSeed, 0x6001, 0.06),
        phase: wrap01(landmarkBase.phase + signedUnit(stableSeed, 0x6002) * 0.035),
        inclination: finite(landmarkBase.inclination + signedUnit(stableSeed, 0x6003) * 0.055, landmarkBase.inclination, -1.2, 1.2),
        ring: {
          color: varyColor(ringBase.color, stableSeed, 0x6100, 0.06),
          inner: Math.round(ringInner * 1000) / 1000,
          outer: Math.round((ringInner + Math.max(0.2, ringWidth)) * 1000) / 1000,
          opacity: clamp01(ringBase.opacity + signedUnit(stableSeed, 0x6101) * 0.035),
          tilt: finite(ringBase.tilt + signedUnit(stableSeed, 0x6102) * 0.055, ringBase.tilt, -1.3, 1.3)
        }
      },
      signatureRole: base.signatureRole,
      particles: {
        role: base.particles.role,
        count: Math.max(0, Math.round(base.particles.count * (1 + signedUnit(stableSeed, 0x7000) * 0.08))),
        color: varyColor(base.particles.color, stableSeed, 0x7001, 0.055)
      },
      variantHash: variantHash
    };
  }

  function create(world) {
    world = world && typeof world === 'object' ? world : {};
    var requested = world.kind === 'station' || world.typeKey === 'station' ? 'station' : world.typeKey;
    var profile = profileFor(requested, world.seed);
    if (typeof world.id === 'string' || typeof world.id === 'number') profile.worldId = String(world.id).slice(0, 64);
    else profile.worldId = profile.station ? 'station' : '';
    return profile;
  }

  function keys() { return ORDER.slice(); }

  return {
    create: create,
    profileFor: profileFor,
    keys: keys,
    _test: {
      hash32: hash32,
      unit: unit,
      normalizeSeed: normalizeSeed
    }
  };
})();
