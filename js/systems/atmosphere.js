// 程序化天空 GPU 所有者：大气穹顶、种子星场、像素天体与单一类型签名层。
// 本模块不持有昼夜/天气时钟；外部每帧以绝对时间驱动 update()。
window.Voxel = window.Voxel || {};

Voxel.Atmosphere = (function () {
  'use strict';

  var scene = null;
  var root = null;
  var worldRef = null;
  var profile = null;
  var generation = 0;
  var density = 1;
  var reducedMotion = false;

  var dome = null;
  var stars = null;
  var signature = null;
  var celestial = [];
  var starCount = 0;
  var geometryHashValue = '00000000';

  var anchorX = 0, anchorY = 0, anchorZ = 0;
  var lastTime = 0.25, lastSunlight = 1, lastDusk = 0, lastIsNight = false;

  var DOME_RADIUS = 700;
  var CELESTIAL_RADIUS = 500;
  var TAU = Math.PI * 2;
  var EMPTY_STATE = { time: 0.25, sunlight: 1, dusk: 0, isNight: false };
  var EMPTY_NEBULA = {};

  var owned = { geometries: [], materials: [], textures: [] };
  var created = { roots: 0, geometries: 0, materials: 0, textures: 0 };
  var disposed = { roots: 0, geometries: 0, materials: 0, textures: 0 };

  var SIGNATURE_ROLE = {
    lush: 'pollen',
    arid: 'dust',
    frozen: 'aurora',
    toxic: 'spores',
    volcanic: 'ash',
    oceanic: 'sea-mist',
    nordic: 'aurora',
    station: 'station-stars'
  };

  function finite(v, fallback, lo, hi) {
    v = Number(v);
    if (!isFinite(v)) v = fallback;
    if (lo !== undefined && v < lo) v = lo;
    if (hi !== undefined && v > hi) v = hi;
    return v;
  }

  function clamp01(v) { return finite(v, 0, 0, 1); }

  function wrap01(v) {
    v = finite(v, 0);
    v %= 1;
    return v < 0 ? v + 1 : v;
  }

  function safeText(v, fallback) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && isFinite(v)) return String(v);
    return fallback;
  }

  function round6(v) { return Math.round(finite(v, 0) * 1000000) / 1000000; }

  function cloneJSON(value) {
    if (value === undefined || value === null) return value === undefined ? null : value;
    try { return JSON.parse(JSON.stringify(value)); }
    catch (e) { return null; }
  }

  function track(kind, resource) {
    if (!resource || !owned[kind] || owned[kind].indexOf(resource) >= 0) return resource;
    owned[kind].push(resource);
    created[kind]++;
    return resource;
  }

  function disposeList(kind) {
    var list = owned[kind];
    for (var i = 0; i < list.length; i++) {
      var resource = list[i];
      if (resource && typeof resource.dispose === 'function') {
        try { resource.dispose(); } catch (e) { /* 资源回收不应阻断世界切换 */ }
      }
      disposed[kind]++;
    }
    list.length = 0;
  }

  // 处理热重载后残留的旧 AtmosphereRoot；不计入本实例资源账本。
  function disposeForeignRoot(node) {
    var gs = [], ms = [], ts = [];
    if (!node || !node.traverse) return;
    node.traverse(function (obj) {
      if (obj.geometry && gs.indexOf(obj.geometry) < 0) gs.push(obj.geometry);
      var mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
      for (var i = 0; i < mats.length; i++) {
        var mat = mats[i];
        if (!mat) continue;
        if (ms.indexOf(mat) < 0) ms.push(mat);
        if (mat.map && ts.indexOf(mat.map) < 0) ts.push(mat.map);
        if (mat.uniforms) {
          for (var key in mat.uniforms) {
            var value = mat.uniforms[key] && mat.uniforms[key].value;
            if (value && value.isTexture && ts.indexOf(value) < 0) ts.push(value);
          }
        }
      }
    });
    for (var t = 0; t < ts.length; t++) try { ts[t].dispose(); } catch (e1) { }
    for (var m = 0; m < ms.length; m++) try { ms[m].dispose(); } catch (e2) { }
    for (var g = 0; g < gs.length; g++) try { gs[g].dispose(); } catch (e3) { }
  }

  function purgeForeignRoots(targetScene) {
    if (!targetScene || !targetScene.children) return;
    for (var i = targetScene.children.length - 1; i >= 0; i--) {
      var child = targetScene.children[i];
      if (!child || child === root || child.name !== 'AtmosphereRoot' ||
        !child.userData || child.userData.system !== 'atmosphere') continue;
      targetScene.remove(child);
      disposeForeignRoot(child);
    }
  }

  function init(targetScene) {
    if (!targetScene || typeof targetScene.add !== 'function' || typeof targetScene.remove !== 'function')
      throw new Error('Voxel.Atmosphere.init 需要有效 THREE.Scene');
    if (scene === targetScene) {
      purgeForeignRoots(scene);
      return true;
    }
    if (root) clear();
    scene = targetScene;
    purgeForeignRoots(scene);
    return true;
  }

  function hashString(value) {
    var s = String(value === undefined || value === null ? '' : value);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h || 0x6d2b79f5;
  }

  function makeRng(seed, salt) {
    var x = (hashString(seed) ^ hashString(salt)) >>> 0;
    if (!x) x = 0x9e3779b9;
    return function () {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) / 4294967296;
    };
  }

  function colorObject(value, fallback) {
    try { return new THREE.Color(value === undefined || value === null ? fallback : value); }
    catch (e) { return new THREE.Color(fallback); }
  }

  function colorBytes(value, fallback) {
    var c = colorObject(value, fallback);
    return [
      Math.round(clamp01(c.r) * 255),
      Math.round(clamp01(c.g) * 255),
      Math.round(clamp01(c.b) * 255)
    ];
  }

  function putPixel(pixels, width, height, x, y, r, g, b, a) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    var i = (y * width + x) * 4;
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = a;
  }

  function blendPixel(pixels, width, height, x, y, r, g, b, a) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= width || y >= height || a <= 0) return;
    var i = (y * width + x) * 4;
    var oa = pixels[i + 3] / 255;
    var na = a / 255;
    var outA = na + oa * (1 - na);
    if (outA <= 0) return;
    pixels[i] = Math.round((r * na + pixels[i] * oa * (1 - na)) / outA);
    pixels[i + 1] = Math.round((g * na + pixels[i + 1] * oa * (1 - na)) / outA);
    pixels[i + 2] = Math.round((b * na + pixels[i + 2] * oa * (1 - na)) / outA);
    pixels[i + 3] = Math.round(outA * 255);
  }

  function textureFromPixels(width, height, pixels, role) {
    if (width > 128 || height > 64) throw new Error('大气纹理超过 128x64 硬预算');
    var texture = null;
    var canvas = null;
    var ctx = null;
    try {
      if (typeof document !== 'undefined' && document.createElement) {
        canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        ctx = canvas.getContext && canvas.getContext('2d');
      } else if (typeof OffscreenCanvas !== 'undefined') {
        canvas = new OffscreenCanvas(width, height);
        ctx = canvas.getContext('2d');
      }
    } catch (e) { canvas = null; ctx = null; }

    if (canvas && ctx && typeof ctx.createImageData === 'function') {
      var image = ctx.createImageData(width, height);
      image.data.set(pixels);
      ctx.putImageData(image, 0, 0);
      texture = new THREE.CanvasTexture(canvas);
    } else {
      texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
    }
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    texture.userData = texture.userData || {};
    texture.userData.role = role;
    texture.userData.width = width;
    texture.userData.height = height;
    return track('textures', texture);
  }

  function makeNebulaTexture(nebula, seed) {
    var width = 128, height = 64;
    var pixels = new Uint8Array(width * height * 4);
    var rng = makeRng(nebula && nebula.seed !== undefined ? nebula.seed : seed, 'nebula');
    var ca = colorBytes(nebula && nebula.colorA, 0x315986);
    var cb = colorBytes(nebula && nebula.colorB, 0x8b4f9f);
    var blobs = [];
    for (var i = 0; i < 12; i++) {
      blobs.push({
        x: rng() * width,
        y: (0.12 + rng() * 0.76) * height,
        rx: 10 + rng() * 28,
        ry: 4 + rng() * 13,
        strength: 0.35 + rng() * 0.65,
        mix: rng()
      });
    }
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var densitySum = 0, mixSum = 0;
        for (var b = 0; b < blobs.length; b++) {
          var blob = blobs[b];
          var dx = Math.abs(x - blob.x);
          dx = Math.min(dx, width - dx);
          var dy = y - blob.y;
          var d = dx * dx / (blob.rx * blob.rx) + dy * dy / (blob.ry * blob.ry);
          if (d >= 1) continue;
          var w = (1 - d) * blob.strength;
          densitySum += w;
          mixSum += w * blob.mix;
        }
        if (densitySum <= 0.08) continue;
        var step = Math.min(1, Math.floor(densitySum * 5) / 5);
        var mix = densitySum > 0 ? mixSum / densitySum : 0;
        var noise = ((hashString(seed + ':' + ((x / 4) | 0) + ':' + ((y / 4) | 0)) >>> 25) / 127) - 0.5;
        mix = clamp01(mix + noise * 0.18);
        putPixel(pixels, width, height, x, y,
          Math.round(ca[0] + (cb[0] - ca[0]) * mix),
          Math.round(ca[1] + (cb[1] - ca[1]) * mix),
          Math.round(ca[2] + (cb[2] - ca[2]) * mix),
          Math.round(step * 178));
      }
    }
    return textureFromPixels(width, height, pixels, 'nebula-map');
  }

  function insideDisc(x, y, cx, cy, radius) {
    var dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  }

  function paintDisc(pixels, width, height, cx, cy, radius, base, light, alpha) {
    for (var y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
      for (var x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        if (!insideDisc(x, y, cx, cy, radius)) continue;
        var shade = clamp01(((cx - x) + (y - cy)) / (radius * 3) + 0.54);
        putPixel(pixels, width, height, x, y,
          Math.round(base[0] + (light[0] - base[0]) * shade),
          Math.round(base[1] + (light[1] - base[1]) * shade),
          Math.round(base[2] + (light[2] - base[2]) * shade), alpha);
      }
    }
  }

  function makeSunPixels(color, seed) {
    var width = 64, height = 64, pixels = new Uint8Array(width * height * 4);
    var base = colorBytes(color, 0xffdd77);
    var light = [Math.min(255, base[0] + 55), Math.min(255, base[1] + 55), Math.min(255, base[2] + 55)];
    var cx = 31.5, cy = 31.5;
    for (var y = 4; y < 60; y++) {
      for (var x = 4; x < 60; x++) {
        var dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy);
        if (d <= 19.5) {
          var band = (((x + y + (hashString(seed) & 7)) / 4) | 0) & 1;
          putPixel(pixels, width, height, x, y,
            Math.min(255, base[0] + band * 25), Math.min(255, base[1] + band * 20),
            Math.min(255, base[2] + band * 12), 255);
        } else if (d <= 23.5 && (((x + y) & 1) === 0)) {
          putPixel(pixels, width, height, x, y, light[0], light[1], light[2], 92);
        }
      }
    }
    return { width: width, height: height, pixels: pixels };
  }

  function makeMoonPixels(style, color, seed) {
    var width = 64, height = 64, pixels = new Uint8Array(width * height * 4);
    var base = colorBytes(color, 0xdde4ff);
    var dark = [Math.round(base[0] * 0.48), Math.round(base[1] * 0.52), Math.round(base[2] * 0.58)];
    var light = [Math.min(255, base[0] + 38), Math.min(255, base[1] + 38), Math.min(255, base[2] + 38)];
    paintDisc(pixels, width, height, 31.5, 31.5, 21, dark, light, 255);
    var rng = makeRng(seed, 'moon-craters');
    for (var i = 0; i < 9; i++) {
      var cx = 18 + ((rng() * 28) | 0), cy = 17 + ((rng() * 30) | 0);
      var r = 2 + ((rng() * 4) | 0);
      for (var y = cy - r; y <= cy + r; y++) {
        for (var x = cx - r; x <= cx + r; x++) {
          if (insideDisc(x, y, cx, cy, r) && insideDisc(x, y, 31.5, 31.5, 20.5))
            blendPixel(pixels, width, height, x, y, dark[0], dark[1], dark[2], 120);
        }
      }
    }
    if (style === 'cracked') {
      var crackX = 30 + ((rng() * 5) | 0);
      for (var s = -17; s <= 17; s++) {
        var x0 = crackX + ((Math.sin(s * 0.8) * 3) | 0);
        var y0 = 32 + s;
        if (insideDisc(x0, y0, 31.5, 31.5, 20)) {
          putPixel(pixels, width, height, x0, y0, dark[0] >> 1, dark[1] >> 1, dark[2] >> 1, 235);
          if ((s % 6) === 0) putPixel(pixels, width, height, x0 + 2, y0 + 1, dark[0] >> 1, dark[1] >> 1, dark[2] >> 1, 210);
        }
      }
    }
    return { width: width, height: height, pixels: pixels };
  }

  function makeBandedPixels(color) {
    var width = 64, height = 64, pixels = new Uint8Array(width * height * 4);
    var base = colorBytes(color, 0x7fa8d8);
    for (var y = 9; y < 55; y++) {
      for (var x = 9; x < 55; x++) {
        var dx = (x - 31.5) / 22.5, dy = (y - 31.5) / 21;
        if (dx * dx + dy * dy > 1) continue;
        var band = ((y / 5) | 0) % 3;
        var k = band === 0 ? 1.18 : (band === 1 ? 0.82 : 1);
        putPixel(pixels, width, height, x, y,
          Math.min(255, Math.round(base[0] * k)),
          Math.min(255, Math.round(base[1] * k)),
          Math.min(255, Math.round(base[2] * k)), 255);
      }
    }
    return { width: width, height: height, pixels: pixels };
  }

  function makeRingedPixels(color, ring) {
    var width = 128, height = 64, pixels = new Uint8Array(width * height * 4);
    var planet = colorBytes(color, 0x659ad0);
    var ringColor = colorBytes(ring && ring.color, 0xdacb9a);
    var cx = 63.5, cy = 31.5;
    var outer = finite(ring && ring.outer, 1.8, 0.4, 3);
    var inner = finite(ring && ring.inner, 1.2, 0.1, outer - 0.04);
    var opacity = Math.round(255 * finite(ring && ring.opacity, 0.82, 0.1, 1));
    // profile 中 inner/outer 是相对半径；先归一化再映射到画布，确保星环不裁边。
    var ringRatio = inner / outer;
    var rx = 57, ry = 15;
    var irx = rx * ringRatio, iry = ry * ringRatio;
    function paintRing(frontOnly) {
      for (var y = 8; y < 56; y++) {
        if (frontOnly && y < cy) continue;
        for (var x = 3; x < 125; x++) {
          var dx = x - cx, dy = y - cy;
          var od = dx * dx / (rx * rx) + dy * dy / (ry * ry);
          var id = dx * dx / (irx * irx) + dy * dy / (iry * iry);
          if (od <= 1 && id >= 1) blendPixel(pixels, width, height, x, y,
            ringColor[0], ringColor[1], ringColor[2], opacity);
        }
      }
    }
    paintRing(false);
    var banded = makeBandedPixels(color).pixels;
    for (var py = 0; py < 64; py++) {
      for (var px = 0; px < 64; px++) {
        var si = (py * 64 + px) * 4;
        if (!banded[si + 3]) continue;
        putPixel(pixels, width, height, px + 32, py,
          banded[si], banded[si + 1], banded[si + 2], banded[si + 3]);
      }
    }
    paintRing(true);
    return { width: width, height: height, pixels: pixels };
  }

  function normalizedStyle(style, kind) {
    style = safeText(style, kind === 'sun' ? 'sun' : 'moon').toLowerCase();
    if (style.indexOf('ring') >= 0) return 'ringed';
    if (style.indexOf('band') >= 0 || style.indexOf('gas') >= 0) return 'banded';
    if (style.indexOf('crack') >= 0 || style.indexOf('fract') >= 0) return 'cracked';
    if (kind === 'sun' || style.indexOf('sun') >= 0 || style.indexOf('star') >= 0) return 'sun';
    return 'moon';
  }

  function makeCelestialTexture(item, kind, seed, index) {
    var style = item && item.ring ? 'ringed' : normalizedStyle(item && item.style, kind);
    var data;
    if (style === 'ringed') data = makeRingedPixels(item && item.color, item && item.ring);
    else if (style === 'banded') data = makeBandedPixels(item && item.color);
    else if (style === 'sun') data = makeSunPixels(item && item.color, seed + ':' + index);
    else data = makeMoonPixels(style, item && item.color, seed + ':' + index);
    return { texture: textureFromPixels(data.width, data.height, data.pixels, kind + '-atlas'), style: style,
      width: data.width, height: data.height };
  }

  function setRole(obj, role) {
    obj.userData = obj.userData || {};
    obj.userData.role = role;
    return obj;
  }

  function createDome() {
    var nebula = profile.nebula || {};
    var nebulaMap = makeNebulaTexture(nebula, profile.seed);
    var top = colorObject(profile.day && profile.day.top, 0x5aa0e0);
    var horizon = colorObject(profile.day && profile.day.horizon, 0xbfe3f2);
    var mat = track('materials', new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        topColor: { value: top },
        horizonColor: { value: horizon },
        exponent: { value: finite(profile.exponent, 0.72, 0.2, 3) },
        nebulaMap: { value: nebulaMap },
        nebulaOpacity: { value: finite(nebula.opacity, 0, 0, 1) },
        nebulaRotation: { value: finite(nebula.rotation, 0) }
      },
      vertexShader:
        'varying vec3 vSkyDir;' +
        'varying vec2 vSkyUv;' +
        'void main(){' +
        '  vSkyDir = normalize(position);' +
        '  vSkyUv = uv;' +
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);' +
        '}',
      fragmentShader:
        'uniform vec3 topColor;' +
        'uniform vec3 horizonColor;' +
        'uniform float exponent;' +
        'uniform sampler2D nebulaMap;' +
        'uniform float nebulaOpacity;' +
        'uniform float nebulaRotation;' +
        'varying vec3 vSkyDir;' +
        'varying vec2 vSkyUv;' +
        'void main(){' +
        '  float h = clamp(vSkyDir.y, 0.0, 1.0);' +
        '  vec3 base = mix(horizonColor, topColor, pow(h, exponent));' +
        '  vec2 nuv = vec2(fract(vSkyUv.x + nebulaRotation), vSkyUv.y);' +
        '  vec4 neb = texture2D(nebulaMap, nuv);' +
        '  vec3 color = base + neb.rgb * neb.a * nebulaOpacity;' +
        '  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);' +
        '}'
    }));
    var geo = track('geometries', new THREE.SphereGeometry(DOME_RADIUS, 24, 14));
    dome = setRole(new THREE.Mesh(geo, mat), profile.station ? 'deep-space-dome' : 'sky-dome');
    dome.name = 'AtmosphereDome';
    dome.renderOrder = -100;
    dome.frustumCulled = false;
    root.add(dome);
  }

  function createStars() {
    var spec = profile.stars || {};
    var baseCount = Math.floor(finite(spec.count, profile.station ? 480 : 380, 1, 512));
    starCount = Math.max(1, Math.min(512, Math.floor(baseCount * density)));
    var positions = new Float32Array(starCount * 3);
    var colors = new Float32Array(starCount * 3);
    var rng = makeRng(profile.seed, 'stars:' + profile.typeKey);
    var c1 = colorObject(spec.color, 0xffffff);
    var c2 = colorObject(spec.secondaryColor, profile.station ? 0x9fc8ff : 0xffefcf);
    for (var i = 0; i < starCount; i++) {
      var a = rng() * TAU;
      var e = profile.station ? (-1.25 + rng() * 2.5) : (0.035 + rng() * 1.42);
      var radius = 470 + rng() * 90;
      var ce = Math.cos(e);
      positions[i * 3] = Math.cos(a) * ce * radius;
      positions[i * 3 + 1] = Math.sin(e) * radius;
      positions[i * 3 + 2] = Math.sin(a) * ce * radius;
      var mix = rng() < 0.28 ? 1 : 0;
      colors[i * 3] = c1.r + (c2.r - c1.r) * mix;
      colors[i * 3 + 1] = c1.g + (c2.g - c1.g) * mix;
      colors[i * 3 + 2] = c1.b + (c2.b - c1.b) * mix;
    }
    var geo = track('geometries', new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    var mat = track('materials', new THREE.PointsMaterial({
      color: 0xffffff,
      size: profile.station ? 1.85 : 1.55,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: profile.station ? 0.96 : 0,
      depthWrite: false,
      depthTest: true,
      fog: false
    }));
    stars = setRole(new THREE.Points(geo, mat), profile.station ? 'station-stars' : 'stars');
    stars.name = profile.station ? 'StationStars' : 'PlanetStars';
    stars.userData.count = starCount;
    stars.renderOrder = -90;
    stars.frustumCulled = false;
    root.add(stars);
  }

  function createCelestial(item, kind, index) {
    item = item || {};
    var atlas = makeCelestialTexture(item, kind, profile.seed, index);
    var size = finite(item.size, kind === 'sun' ? 54 : 34, 8, 170);
    var aspect = atlas.width / atlas.height;
    var geo = track('geometries', new THREE.PlaneGeometry(size * aspect, size));
    var mat = track('materials', new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: atlas.texture,
      transparent: true,
      alphaTest: 0.025,
      opacity: 1,
      depthWrite: false,
      depthTest: true,
      fog: false,
      side: THREE.DoubleSide
    }));
    var role = kind === 'sun' ? 'sun' : (kind === 'moon' ? 'moon' : safeText(item.role, 'ringed-landmark'));
    var mesh = setRole(new THREE.Mesh(geo, mat), role);
    mesh.name = 'AtmosphereCelestial_' + role + '_' + index;
    mesh.renderOrder = -80 + index;
    mesh.frustumCulled = false;
    mesh.userData.kind = kind;
    mesh.userData.style = atlas.style;
    mesh.userData.phase = wrap01(item.phase);
    mesh.userData.inclination = finite(item.inclination, 0, -Math.PI * 0.48, Math.PI * 0.48);
    mesh.userData.cyclesPerDay = finite(item.cyclesPerDay, kind === 'landmark' ? 0 : 1, -4, 4);
    mesh.userData.orbitRadius = CELESTIAL_RADIUS - index * 7;
    mesh.userData.index = index;
    mesh.userData.ringTilt = finite(item.ring && item.ring.tilt, 0, -Math.PI, Math.PI);
    if (atlas.style === 'ringed') mesh.rotation.z = mesh.userData.ringTilt;
    celestial.push(mesh);
    root.add(mesh);
  }

  function createCelestials() {
    var count = 0;
    var suns = Array.isArray(profile.suns) ? profile.suns : [];
    var moons = Array.isArray(profile.moons) ? profile.moons : [];
    if (!profile.station) {
      // 有 landmark 时预留第 4 槽；前 3 槽优先保证至少一日一月，
      // 再补第二太阳或第二月亮。这样 arid 的双日与所有世界的星环同时存在。
      var bodyBudget = profile.landmark ? 3 : 4;
      var si = 0, mi = 0;
      if (suns.length && count < bodyBudget) { createCelestial(suns[si++], 'sun', count++); }
      if (moons.length && count < bodyBudget) { createCelestial(moons[mi++], 'moon', count++); }
      while (count < bodyBudget && (si < suns.length || mi < moons.length)) {
        if (si < suns.length) createCelestial(suns[si++], 'sun', count++);
        else if (mi < moons.length) createCelestial(moons[mi++], 'moon', count++);
      }
    }
    if (profile.landmark && count < 4) createCelestial(profile.landmark, 'landmark', count++);
  }

  // 光帘辐亮度增益：Bloom 的选择性阈值是 1.15，光帘要越过它才有辉散。
  // 没有半浮点缓冲时保持 ≤1，否则会被硬截断而丢掉丝状层次。
  // Bloom 的初始化可能晚于世界加载，所以逐帧取值而不是建材质时定死。
  function auroraGain() {
    return (Voxel.Bloom && Voxel.Bloom.hdr && Voxel.Bloom.hdr()) ? 1.72 : 1.18;
  }

  function createAurora(count, color) {
    count = Math.max(8, Math.min(96, count));
    // DynamicSurroundings 式极光：若干幅绕穹顶弯曲的宽幅光帘（网格带 +
    // 加色混合 shader），底部亮绿、向上渐隐，横向射线随时间扫动呼吸。
    // nordic 主题四层帘（主帘 + 三条副帘），其余世界保持单层。
    // 光帘的高度直接决定它落在视场的哪一段：yb/R 的反正切就是下缘仰角。
    // 原来主帘从 160/430（20.4°）起、顶到 46°，而竖直视场只有 ±37.5°，
    // 于是画面里只剩顶部一条绿边。整体下移后绿帘从约 12° 起铺满上半屏。
    var layers = profile.typeKey === 'nordic' ? [
      // 主光帘：从南岸上空铺到头顶（出生点背后也可见）
      { azc: 3.19, span: 3.4, yb: 92, yt: 340, R: 430, weight: 1.0 },
      // 副帘：更高更淡的斜向交叠层（偏城堡一侧）
      { azc: -0.62, span: 2.9, yb: 150, yt: 430, R: 452, weight: 0.7 },
      // 低幅横带：贴着雪脊上方的一条水平亮绿（参考照片山脚的光弧）
      { azc: 0.35, span: 3.3, yb: 62, yt: 132, R: 436, weight: 0.62 },
      // 南天低带：背对城堡时也有轻微绿晕
      { azc: 3.05, span: 2.4, yb: 70, yt: 165, R: 444, weight: 0.45 }
    ] : [{ azc: 0, span: 2.2, yb: 120, yt: 225, R: 430, weight: 1.0 }];
    var aur = profile.aurora || { low: 0x2bff8f, mid: 0x0ca4a4, high: 0x4a5fb8 };
    var cLow = new THREE.Color(aur.low), cMid = new THREE.Color(aur.mid), cHigh = new THREE.Color(aur.high);
    var rng = makeRng(profile.seed, 'aurora');
    var group = new THREE.Group();
    group.userData.isAuroraGroup = true;
    group.userData.role = 'aurora';
    group.name = 'AtmosphereSignature_aurora';
    group.renderOrder = -70;
    group.userData.uniforms = [];
    var segs = 72, rows = 10;
    for (var li = 0; li < layers.length; li++) {
      var L2 = layers[li];
      var positions = new Float32Array((segs + 1) * (rows + 1) * 3);
      var uvs = new Float32Array((segs + 1) * (rows + 1) * 2);
      var indices = new Uint16Array(segs * rows * 6);
      var seedPhase = rng() * Math.PI * 2;
      var p = 0, q = 0;
      for (var iy = 0; iy <= rows; iy++) {
        var tv = iy / rows;
        for (var ix = 0; ix <= segs; ix++) {
          var tu = ix / segs;
          var az = L2.azc - L2.span / 2 + tu * L2.span;
          var wave = Math.sin(az * 3.1 + seedPhase) * 11 + Math.sin(az * 7.7 + seedPhase * 2.3) * 6;
          positions[p++] = Math.sin(az) * L2.R;
          positions[p++] = L2.yb + (L2.yt - L2.yb) * tv + wave;
          positions[p++] = -Math.cos(az) * L2.R;
          uvs[q++] = tu; uvs[q++] = tv;
        }
      }
      var idx = 0;
      for (var iy2 = 0; iy2 < rows; iy2++)
        for (var ix2 = 0; ix2 < segs; ix2++) {
          var a = iy2 * (segs + 1) + ix2, b = a + 1;
          var c = a + segs + 1, d = c + 1;
          indices[idx++] = a; indices[idx++] = c; indices[idx++] = b;
          indices[idx++] = b; indices[idx++] = c; indices[idx++] = d;
        }
      var geo = track('geometries', new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      var mat = track('materials', new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: rng() * 40 },
          uIntensity: { value: 0 },
          uSeed: { value: seedPhase },
          uLow: { value: cLow },
          uMid: { value: cMid },
          uHigh: { value: cHigh },
          uGain: { value: auroraGain() }
        },
        vertexShader:
          'varying vec2 vUv;' +
          'void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader:
          'uniform float uTime;' +
          'uniform float uIntensity;' +
          'uniform float uSeed;' +
          'uniform vec3 uLow;' +
          'uniform vec3 uMid;' +
          'uniform vec3 uHigh;' +
          'uniform float uGain;' +
          'varying vec2 vUv;' +
          // 竖直细丝：三阶正弦叠加成 fbm 式非周期分布，再整体缓慢横向漂移，
          // 去掉单一正弦那种规律波纹感（真实光帘的丝是疏密不均的）。
          'float ray(float u,float t,float seed){' +
          '  float d=u+t*0.012;' +
          '  float a=sin(d*17.0+seed);' +
          '  float b=sin(d*41.0-seed*1.7+a*1.3);' +
          '  float c=sin(d*97.0+seed*0.6+b*0.8);' +
          '  return clamp(0.5+0.30*a+0.22*b+0.13*c,0.0,1.0);' +
          '}' +
          'void main(){' +
          '  float r=ray(vUv.x,uTime,uSeed);' +
          // 底缘锐利、向上拖长渐隐；丝的疏密再调制一次高度剖面
          '  float curtain=smoothstep(0.015,0.14,vUv.y)*pow(max(0.0,1.0-vUv.y),1.30);' +
          '  curtain*=0.55+0.45*smoothstep(0.15,0.85,r);' +
          // 三段取色：底亮绿 → 中段青 → 高空淡紫冠（氮辉）。
          // 紫冠权重压到 0.42：更高会在两层帘顶重叠处糊成一块紫斑。
          '  float h=clamp(vUv.y*1.35-0.10+r*0.10,0.0,1.0);' +
          '  vec3 col=mix(uLow,uMid,smoothstep(0.0,0.55,h));' +
          '  col=mix(col,uHigh,smoothstep(0.70,1.0,h)*0.42);' +
          // 纯加色：亮度全部走 RGB 通道，alpha 恒为 0——预乘 alpha +
          // 加色混合会把超量 alpha 二次折叠成红/品红伪影。
          // 强度可超过 1（HDR 缓冲），Bloom 的阈值据此挑出辉散区。
          '  float k=clamp(curtain*(0.34+0.66*r*r)*uIntensity,0.0,1.0);' +
          '  gl_FragColor=vec4(col*k*uGain,0.0);' +
          '}',
        transparent: true,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        depthWrite: false,
        // 接受深度测试：透明队列在不透明地形之后绘制，开深度测试后
        // 山体/建筑会正确遮挡光帘（天空穹顶不写深度，不受影响）。
        depthTest: true,
        side: THREE.DoubleSide
      }));
      var mesh = new THREE.Mesh(geo, mat);
      mesh.userData.role = 'aurora';
      mesh.userData.layerWeight = L2.weight;
      mesh.renderOrder = -70 + li;
      mesh.frustumCulled = false;
      mesh.visible = false;
      group.add(mesh);
      group.userData.uniforms.push({
        uniform: mat.uniforms.uIntensity, weight: L2.weight,
        azc: L2.azc, span: L2.span
      });
    }
    group.userData.auroraColor = cLow;
    group.userData.baseOpacity = layers.length > 1 ? 1.35 : 0.85;
    signature = setRole(group, 'aurora');
    signature.userData.count = count;
  }

  // 极光帘的方位快照：供水面解析式倒影采样（取强度最高的三层）。
  // 只描述"天上哪个方位有多亮的绿"，不涉及几何，Mesh 侧零额外 draw call。
  var auroraSnapshot = null;
  function publishAuroraBands(list, color) {
    var bands = [];
    for (var i = 0; i < list.length && bands.length < 3; i++) {
      var v = list[i].uniform.value;
      if (v <= 0.01) continue;
      bands.push([list[i].azc, Math.max(0.2, list[i].span * 0.5), v]);
    }
    auroraSnapshot = bands.length ? { color: color || null, bands: bands } : null;
  }

  function createSignaturePoints(role, count, color) {
    count = Math.max(6, Math.min(128, count));
    var positions = new Float32Array(count * 3);
    var rng = makeRng(profile.seed, 'signature:' + role);
    for (var i = 0; i < count; i++) {
      var a = rng() * TAU;
      var elevation;
      if (role === 'dust' || role === 'sea-mist') elevation = 0.025 + rng() * 0.14;
      else if (role === 'ash') elevation = 0.08 + rng() * 0.48;
      else elevation = 0.06 + rng() * 0.34;
      var radius = 350 + rng() * 105;
      var ce = Math.cos(elevation);
      positions[i * 3] = Math.cos(a) * ce * radius;
      positions[i * 3 + 1] = Math.sin(elevation) * radius;
      positions[i * 3 + 2] = Math.sin(a) * ce * radius;
    }
    var geo = track('geometries', new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    var mat = track('materials', new THREE.PointsMaterial({
      color: color,
      size: role === 'ash' ? 2.2 : (role === 'spores' ? 2.0 : 1.55),
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      fog: false
    }));
    signature = setRole(new THREE.Points(geo, mat), role);
    signature.userData.count = count;
    signature.userData.baseOpacity = role === 'dust' ? 0.30 : (role === 'ash' ? 0.42 : 0.32);
  }

  function createSignature() {
    if (profile.station) return; // station-stars 已由单一星场 draw call 表达。
    var particles = profile.particles || {};
    var role = SIGNATURE_ROLE[profile.typeKey] || safeText(profile.signatureRole, 'pollen');
    var count = Math.floor(finite(particles.count, role === 'aurora' ? 42 : 54, 1, 128) * density);
    var color = particles.color === undefined ? (role === 'ash' ? 0xff794a : 0x9ef5d6) : particles.color;
    if (role === 'aurora') createAurora(count, color);
    else createSignaturePoints(role, count, color);
    signature.name = 'AtmosphereSignature_' + role;
    signature.renderOrder = -70;
    signature.frustumCulled = false;
    root.add(signature);
  }

  function profileForWorld(world) {
    var profiles = Voxel.AtmosphereProfiles;
    if (!profiles || typeof profiles.create !== 'function')
      throw new Error('Voxel.Atmosphere 需要 Voxel.AtmosphereProfiles.create(world)');
    var p = profiles.create(world);
    if (!p || typeof p !== 'object') throw new Error('AtmosphereProfiles.create 未返回有效 profile');
    return p;
  }

  function mixHash(h, n) {
    n = n | 0;
    h ^= n & 255; h = Math.imul(h, 16777619) >>> 0;
    h ^= (n >>> 8) & 255; h = Math.imul(h, 16777619) >>> 0;
    h ^= (n >>> 16) & 255; h = Math.imul(h, 16777619) >>> 0;
    h ^= (n >>> 24) & 255; h = Math.imul(h, 16777619) >>> 0;
    return h;
  }

  function mixString(h, s) {
    s = String(s || '');
    for (var i = 0; i < s.length; i++) h = mixHash(h, s.charCodeAt(i));
    return h;
  }

  function computeGeometryHash() {
    var h = 2166136261 >>> 0;
    if (!root) return '00000000';
    for (var i = 0; i < root.children.length; i++) {
      var child = root.children[i];
      h = mixString(h, child.userData && child.userData.role);
      var attr = child.geometry && child.geometry.attributes && child.geometry.attributes.position;
      var array = attr && attr.array;
      if (array) {
        h = mixHash(h, array.length);
        for (var j = 0; j < array.length; j++) h = mixHash(h, Math.round(array[j] * 1000));
      }
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  function applyColor(target, value) {
    if (!target || value === undefined || value === null) return false;
    try {
      if (value.isColor && typeof target.copy === 'function') target.copy(value);
      else target.set(value);
      return true;
    } catch (e) { return false; }
  }

  function setColors(top, horizon) {
    if (!dome || !dome.material || !dome.material.uniforms) return false;
    var a = applyColor(dome.material.uniforms.topColor.value, top);
    var b = applyColor(dome.material.uniforms.horizonColor.value, horizon);
    return a || b;
  }

  function updateCelestials(time) {
    for (var i = 0; i < celestial.length; i++) {
      var mesh = celestial[i];
      var data = mesh.userData;
      var cycles = data.cyclesPerDay;
      var radius = data.orbitRadius;
      if (data.kind === 'landmark') {
        // 远方带环地标是空间尺度锚点，不应因 profile 的相位落到地平线下方。
        // phase 仅决定方位；倾角的绝对值决定稳定的低空仰角。
        var azimuth = data.phase * TAU;
        var elevation = 0.24 + Math.abs(data.inclination) * 0.38;
        var ce = Math.cos(elevation);
        mesh.position.set(Math.cos(azimuth) * ce * radius,
          Math.sin(elevation) * radius,
          Math.sin(azimuth) * ce * radius);
      } else {
        var angle = (data.phase + time * cycles) * TAU;
        var ca = Math.cos(angle), sa = Math.sin(angle);
        var ci = Math.cos(data.inclination), si = Math.sin(data.inclination);
        mesh.position.set(ca * radius, sa * ci * radius, sa * si * radius);
      }
      mesh.lookAt(anchorX, anchorY, anchorZ);
      if (data.style === 'ringed') mesh.rotateZ(data.ringTilt);
      if (data.kind === 'landmark') mesh.visible = true;
      else mesh.visible = mesh.position.y > -radius * 0.14;
    }
  }

  // 主恒星当前方向（世界系单位向量，指向太阳）。与 updateCelestials 的轨道公式一致
  // （半径约去后即为方向）。空间站/无恒星返回 false。供实时阴影系统投影使用。
  var sunDirOut = null;
  function sunDirection(out, time) {
    for (var i = 0; i < celestial.length; i++) {
      var data = celestial[i].userData;
      if (data.kind !== 'sun' || typeof data.phase !== 'number') continue;
      var angle = (data.phase + (time || 0) * data.cyclesPerDay) * TAU;
      var ca = Math.cos(angle), sa = Math.sin(angle);
      var ci = Math.cos(data.inclination), si = Math.sin(data.inclination);
      if (!out) out = sunDirOut || (sunDirOut = new THREE.Vector3());
      return out.set(ca, sa * ci, sa * si).normalize(), true;
    }
    return false;
  }

  function updateVisualState() {
    if (!root || !profile) return;
    var night = clamp01(1 - lastSunlight);
    if (stars && stars.material) {
      stars.material.opacity = profile.station ? 0.96 : Math.pow(night, 1.75) * 0.92;
      stars.visible = stars.material.opacity > 0.008;
      stars.rotation.y = reducedMotion ? 0 : wrap01(lastTime) * TAU * 0.018;
    }
    if (dome && dome.material && dome.material.uniforms) {
      var nebula = profile.nebula || EMPTY_NEBULA;
      var baseOpacity = finite(nebula.opacity, 0, 0, 1);
      dome.material.uniforms.nebulaOpacity.value = profile.station ? baseOpacity : baseOpacity * (0.12 + night * 0.88);
      dome.material.uniforms.nebulaRotation.value = finite(nebula.rotation, 0) +
        (reducedMotion ? 0 : wrap01(lastTime) * 0.025);
    }
    if (signature && signature.material) {
      var role = signature.userData.role;
      var opacity = signature.userData.baseOpacity || 0.3;
      if (role === 'aurora') opacity *= Math.pow(night, 1.3);
      else if (role === 'pollen' || role === 'sea-mist') opacity *= 0.32 + lastSunlight * 0.68;
      else if (role === 'dust') opacity *= 0.65 + lastSunlight * 0.35;
      signature.material.opacity = opacity;
      signature.visible = opacity > 0.008;
      signature.rotation.y = reducedMotion ? 0 : wrap01(lastTime) * TAU *
        (role === 'ash' ? -0.035 : 0.022);
    } else if (signature && signature.userData.isAuroraGroup) {
      // 光帘极光：强度写进各层 shader uniform；射线扫动用绝对日内时间驱动。
      var aOpacity = (signature.userData.baseOpacity || 1) *
        Math.pow(night, profile.typeKey === 'nordic' ? 0.85 : 1.3);
      var list = signature.userData.uniforms || [];
      for (var ui = 0; ui < list.length; ui++)
        list[ui].uniform.value = Math.min(1.0, aOpacity * list[ui].weight);
      publishAuroraBands(list, signature.userData.auroraColor);
      var gain = auroraGain();
      for (var mi = 0; mi < signature.children.length; mi++) {
        var aMesh = signature.children[mi];
        aMesh.visible = aOpacity > 0.01;
        if (!aMesh.material) continue;
        aMesh.material.uniforms.uGain.value = gain;
        if (!reducedMotion)
          aMesh.material.uniforms.uTime.value = wrap01(lastTime) * 90 + mi * 13.7;
      }
      signature.visible = true;
    }
    updateCelestials(lastTime);
  }

  // 锁定签名：update(dt, cameraOrPosition, {time,sunlight,dusk,isNight})。
  function update(dt, cameraOrPosition, state) {
    if (!root) return false;
    state = state || EMPTY_STATE;
    var p = cameraOrPosition && cameraOrPosition.position ? cameraOrPosition.position : cameraOrPosition;
    if (p) {
      anchorX = finite(p.x, anchorX);
      anchorY = finite(p.y, anchorY);
      anchorZ = finite(p.z, anchorZ);
    }
    root.position.set(anchorX, anchorY, anchorZ);
    lastTime = wrap01(state.time);
    lastSunlight = clamp01(state.sunlight === undefined ? lastSunlight : state.sunlight);
    lastDusk = clamp01(state.dusk === undefined ? lastDusk : state.dusk);
    lastIsNight = state.isNight === undefined ? lastSunlight < 0.4 : !!state.isNight;
    // dt 只做输入健全性边界；所有轨道/漂移由绝对 time 求值，无帧率累积。
    finite(dt, 0, 0, 60);
    updateVisualState();
    return true;
  }

  function loadWorld(world, options) {
    if (!scene) throw new Error('请先调用 Voxel.Atmosphere.init(scene)');
    clear();
    purgeForeignRoots(scene);
    options = options || {};
    density = finite(options.density, density, 0.1, 1);
    reducedMotion = !!options.reducedMotion;
    worldRef = world || {};
    profile = profileForWorld(worldRef);
    profile.typeKey = safeText(profile.typeKey, safeText(worldRef.typeKey, worldRef.kind === 'station' ? 'station' : 'lush'));
    profile.worldId = safeText(profile.worldId, safeText(worldRef.id, 'world'));
    profile.seed = profile.seed === undefined ? (worldRef.seed === undefined ? profile.worldId : worldRef.seed) : profile.seed;
    profile.station = !!(profile.station || profile.typeKey === 'station' || worldRef.kind === 'station');
    generation++;

    root = new THREE.Group();
    root.name = 'AtmosphereRoot';
    root.userData.system = 'atmosphere';
    root.userData.typeKey = profile.typeKey;
    root.userData.worldId = profile.worldId;
    root.userData.generation = generation;
    created.roots++;
    scene.add(root);

    try {
      createDome();
      createStars();
      createCelestials();
      createSignature();
      var day = profile.day || {};
      setColors(day.top === undefined ? 0x5aa0e0 : day.top,
        day.horizon === undefined ? 0xbfe3f2 : day.horizon);
      anchorX = anchorY = anchorZ = 0;
      lastTime = 0.25; lastSunlight = 1; lastDusk = 0; lastIsNight = false;
      root.position.set(0, 0, 0);
      updateVisualState();
      geometryHashValue = computeGeometryHash();
      return root;
    } catch (e) {
      clear();
      throw e;
    }
  }

  function clear() {
    auroraSnapshot = null;
    var had = !!root || owned.geometries.length > 0 || owned.materials.length > 0 || owned.textures.length > 0;
    if (root) {
      if (root.parent && typeof root.parent.remove === 'function') root.parent.remove(root);
      disposed.roots++;
    }
    disposeList('materials');
    disposeList('geometries');
    disposeList('textures');
    root = null;
    worldRef = null;
    profile = null;
    dome = null;
    stars = null;
    signature = null;
    celestial.length = 0;
    starCount = 0;
    geometryHashValue = '00000000';
    anchorX = anchorY = anchorZ = 0;
    return had;
  }

  function setDensity(value) {
    value = finite(value, density, 0.1, 1);
    if (Math.abs(value - density) < 1e-9) return false;
    density = value;
    if (!root || !worldRef) return true;
    var world = worldRef;
    var wasReduced = reducedMotion;
    var x = anchorX, y = anchorY, z = anchorZ;
    var time = lastTime, sunlight = lastSunlight, dusk = lastDusk, isNight = lastIsNight;
    var topColor = dome && dome.material && dome.material.uniforms ? dome.material.uniforms.topColor.value.getHex() : null;
    var horizonColor = dome && dome.material && dome.material.uniforms ? dome.material.uniforms.horizonColor.value.getHex() : null;
    loadWorld(world, { density: density, reducedMotion: wasReduced });
    if (topColor !== null && horizonColor !== null) setColors(topColor, horizonColor);
    anchorX = x; anchorY = y; anchorZ = z;
    lastTime = time; lastSunlight = sunlight; lastDusk = dusk; lastIsNight = isNight;
    root.position.set(x, y, z);
    updateVisualState();
    geometryHashValue = computeGeometryHash();
    return true;
  }

  function setReducedMotion(value) {
    value = !!value;
    if (value === reducedMotion) return false;
    reducedMotion = value;
    updateVisualState();
    return true;
  }

  function colorHex(c) {
    if (!c || typeof c.getHexString !== 'function') return '#000000';
    return '#' + c.getHexString();
  }

  function snapshot() {
    var roles = [];
    var visibility = {};
    var countsByRole = {};
    var relativePositions = [];
    var objects = [];
    var vertices = 0;
    if (root) {
      for (var i = 0; i < root.children.length; i++) {
        var child = root.children[i];
        var role = safeText(child.userData && child.userData.role, 'unclassified');
        var visible = child.visible !== false;
        roles.push(role);
        countsByRole[role] = (countsByRole[role] || 0) + 1;
        visibility[role] = visibility[role] === undefined ? visible : (visibility[role] || visible);
        var positionAttr = child.geometry && child.geometry.attributes && child.geometry.attributes.position;
        if (positionAttr) vertices += positionAttr.count === undefined ?
          ((positionAttr.array && positionAttr.itemSize) ? positionAttr.array.length / positionAttr.itemSize : 0) : positionAttr.count;
        var pos = [round6(child.position.x), round6(child.position.y), round6(child.position.z)];
        relativePositions.push({ role: role, index: i, position: pos });
        objects.push({
          role: role,
          index: i,
          visible: visible,
          opacity: round6(child.material && child.material.opacity !== undefined ? child.material.opacity : 1),
          position: pos
        });
      }
    }
    var uniforms = dome && dome.material && dome.material.uniforms;
    var drawCalls = root ? root.children.length : 0;
    return {
      generation: generation,
      worldId: profile ? profile.worldId : null,
      typeKey: profile ? profile.typeKey : null,
      roles: roles,
      counts: {
        children: drawCalls,
        drawCalls: drawCalls,
        drawables: drawCalls,
        vertices: Math.round(vertices),
        dome: dome ? 1 : 0,
        stars: starCount,
        particles: signature && signature.userData ? finite(signature.userData.count, 0, 0, 999999) : 0,
        celestial: celestial.length,
        celestials: celestial.length,
        signature: signature ? 1 : 0,
        textures: owned.textures.length,
        byRole: countsByRole
      },
      visibility: visibility,
      objects: objects,
      colors: {
        top: uniforms ? colorHex(uniforms.topColor.value) : null,
        horizon: uniforms ? colorHex(uniforms.horizonColor.value) : null
      },
      cameraAnchor: [round6(anchorX), round6(anchorY), round6(anchorZ)],
      geometryHash: geometryHashValue,
      relativePositions: relativePositions
    };
  }

  function statsGroup(values) {
    var total = values.roots + values.geometries + values.materials + values.textures;
    return {
      roots: values.roots,
      geometries: values.geometries,
      materials: values.materials,
      textures: values.textures,
      total: total
    };
  }

  function resourceStats() {
    var live = {
      roots: created.roots - disposed.roots,
      geometries: created.geometries - disposed.geometries,
      materials: created.materials - disposed.materials,
      textures: created.textures - disposed.textures
    };
    return {
      created: statsGroup(created),
      disposed: statsGroup(disposed),
      live: statsGroup(live)
    };
  }

  function currentProfile() { return cloneJSON(profile); }

  return {
    init: init,
    loadWorld: loadWorld,
    setColors: setColors,
    update: update,
    setDensity: setDensity,
    setReducedMotion: setReducedMotion,
    clear: clear,
    snapshot: snapshot,
    resourceStats: resourceStats,
    currentProfile: currentProfile,
    sunDirection: sunDirection,
    auroraBands: function () { return auroraSnapshot; }
  };
})();
