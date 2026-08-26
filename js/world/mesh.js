// 区块网格构建：隐藏面剔除 + 顶点环境光遮蔽(AO) + 双通道光照（天光×昼夜 / 块光）
// 实时光影：树叶独立几何组（顶点风摇）+ 树叶实时投影（正交深度图 PCF）
//           + 程序化云影（与可见云层同向漂移）+ 太阳方向 wrap-diffuse 侧光
window.Voxel = window.Voxel || {};

Voxel.MeshBuilder = (function () {
  var B = null;
  var G = null, GSky = null, GBlk = null;
  var texture, opaqueMat, waterMat, foliageMat;
  var mats = [];          // 全部地形材质（uniform 批量更新用）
  var UVK = [[0, 0], [1, 0], [1, 1], [0, 1]];
  // n: 法线, u/v: 切线, c: 4 顶点局部坐标, b: 基础亮度
  var FACES = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], b: 0.7 },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], b: 0.7 },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], b: 1.0 },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], b: 0.55 },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], b: 0.85 },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], b: 0.85 }
  ];
  var AO = [0.5, 0.72, 0.86, 1.0];
  var tmpUV = [0, 0];
  // 默认绑定的 1×1 白色纹理：阴影关闭时保证采样器完整（部分驱动对未绑定采样器告警）
  var whiteTex = null;
  function makeWhiteTex() {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    var cx2 = cv.getContext('2d');
    cx2.fillStyle = '#fff';
    cx2.fillRect(0, 0, 1, 1);
    var t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    return t;
  }

  // 树叶风摇位移场：以世界坐标为自变量的连续函数——相邻面共享的顶点位移一致，天然无裂缝。
  // 主视图与阴影深度 pass 必须引用同一份代码，影子才会跟着叶子一起晃。
  var SWAY_GLSL = [
    'vec3 voxelSway(vec3 wp, float t, vec2 wind, float amp){',
    '  float ph1 = dot(wp.xz, vec2(0.11, 0.13));',
    '  float ph2 = dot(wp.xz, vec2(-0.07, 0.17));',
    '  float s1 = sin(t * 1.6 + ph1);',
    '  float s2 = sin(t * 2.7 + ph2);',
    '  return vec3(',
    '    wind.x * (s1 * 0.6 + s2 * 0.4),',
    '    (s2 - s1) * 0.22,',
    '    wind.y * (-s1 * 0.45 + s2 * 0.55)',
    '  ) * amp;',
    '}'
  ].join('\n');

  var VERT = [
    'attribute vec3 acolor;',
    'attribute vec2 alight;',
    'attribute vec3 anrm;',
    'uniform mat4 uShadowMat;',
    '#ifdef SWAY',
    'uniform float uTime;',
    'uniform vec2 uWind;',
    'uniform float uSwayAmp;',
    SWAY_GLSL,
    '#endif',
    'varying vec2 vUv;',
    'varying vec3 vCol;',
    'varying vec2 vL;',
    'varying float vDepth;',
    'varying vec3 vNrm;',
    'varying vec3 vWPos;',
    'varying vec4 vShadowCoord;',
    'void main(){',
    '  vUv = uv; vCol = acolor; vL = alight; vNrm = anrm;',
    '  vec3 p = position;',
    '  #ifdef SWAY',
    '  p += voxelSway(p, uTime, uWind, uSwayAmp);',
    '  #endif',
    '  vWPos = p;',
    '  vShadowCoord = uShadowMat * vec4(p, 1.0);',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  vDepth = -mv.z;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  function frag(cut) {
    return [
      'uniform sampler2D map;',
      'uniform vec3 tint;',
      'uniform float sun;',
      'uniform vec3 uFogColor;',
      'uniform float uFogNear;',
      'uniform float uFogFar;',
      'uniform float uAlpha;',
      'uniform sampler2D uShadowTex;',
      'uniform vec3 uSunDir;',
      'uniform float uShadowStr;',
      'uniform float uShadowSize;',
      'uniform vec2 uCloudDrift;',
      'uniform float uCloudStr;',
      'uniform float uDirStr;',
      'varying vec2 vUv;',
      'varying vec3 vCol;',
      'varying vec2 vL;',
      'varying float vDepth;',
      'varying vec3 vNrm;',
      'varying vec3 vWPos;',
      'varying vec4 vShadowCoord;',
      // 深度图 RGBA 三通道打包（WebGL1 兼容，不依赖 depth texture 扩展）
      'float unpackD(vec4 c){ return dot(c, vec4(1.0, 1.0/255.0, 1.0/65025.0, 1.0/16581375.0)); }',
      // 树叶实时投影：正交深度图 PCF 2×2 软采样
      'float leafShadow(){',
      '  if (uShadowStr <= 0.001) return 1.0;',
      '  vec3 sc = vShadowCoord.xyz;',
      '  if (sc.x < 0.002 || sc.x > 0.998 || sc.y < 0.002 || sc.y > 0.998 || sc.z >= 0.999) return 1.0;',
      '  float bias = 0.0016 + 0.0035 * (1.0 - max(dot(vNrm, uSunDir), 0.0));',
      '  vec2 ts = vec2(1.0 / uShadowSize);',
      '  float sum = 0.0;',
      '  for (int i = 0; i < 2; i++) {',
      '    for (int j = 0; j < 2; j++) {',
      '      float d = unpackD(texture2D(uShadowTex, sc.xy + vec2(float(i) - 0.5, float(j) - 0.5) * ts));',
      '      sum += step(sc.z - bias, d);',
      '    }',
      '  }',
      '  return mix(1.0, mix(0.42, 1.0, sum * 0.25), uShadowStr);',
      '}',
      // 程序化云影：大尺度多层噪声，与可见云层同向漂移（零额外 draw call）
      'float cloudShadow(){',
      '  if (uCloudStr <= 0.001) return 1.0;',
      '  vec2 q = vWPos.xz * 0.010 + uCloudDrift * 0.010;',
      '  float n = sin(q.x) * sin(q.y);',
      '  n += 0.55 * sin(q.x * 2.17 + 1.7) * sin(q.y * 1.93 - 0.4);',
      '  n += 0.34 * sin(q.x * 3.9 - 2.3) * sin(q.y * 4.6 + 2.1);',
      '  float c = smoothstep(-0.15, 0.75, n);',
      '  return mix(1.0, mix(0.80, 1.0, c), uCloudStr);',
      '}',
      'void main(){',
      '  vec4 tex = texture2D(map, vUv);',
      '  if (tex.a < ' + cut + ') discard;',
      '  float br = max(vL.x * sun, vL.y);',
      // 太阳方向 wrap-diffuse：晨昏侧光明暗（夜晚由 uDirStr 压平为均匀月光感）
      '  float nl = clamp(dot(vNrm, uSunDir) * 0.62 + 0.38, 0.0, 1.0);',
      '  br *= mix(1.0, mix(0.87, 1.09, nl), uDirStr);',
      '  br = 0.05 + 0.95 * pow(br, 1.35);',
      // 实时树影只作用于天光主导的露天表面：
      // 树冠正下方/洞穴已由烘焙天光变暗，再叠加会双重压黑
      '  float shade = cloudShadow();',
      '  float sm = smoothstep(0.30, 0.80, vL.x);',
      '  shade *= 1.0 - (1.0 - leafShadow()) * sm;',
      '  vec3 c = tex.rgb * vCol * tint * br * shade;',
      '  float f = smoothstep(uFogNear, uFogFar, vDepth);',
      '  gl_FragColor = vec4(mix(c, uFogColor, f), tex.a * uAlpha);',
      '}'
    ].join('\n');
  }

  function mkMat(alpha, cut, opts) {
    opts = opts || {};
    var m = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        tint: { value: new THREE.Color(1, 1, 1) },
        sun: { value: 1 },
        uFogColor: { value: new THREE.Color(0x87ceeb) },
        uFogNear: { value: 60 },
        uFogFar: { value: 240 },
        uAlpha: { value: alpha },
        uShadowTex: { value: whiteTex },
        uShadowMat: { value: new THREE.Matrix4() },
        uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
        uShadowStr: { value: 0 },
        uShadowSize: { value: 1024 },
        uCloudDrift: { value: new THREE.Vector2(0, 0) },
        uCloudStr: { value: 0 },
        uDirStr: { value: 0 },
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector2(1, 0) },
        uSwayAmp: { value: 0.03 }
      },
      vertexShader: VERT,
      fragmentShader: frag(cut),
      transparent: !!opts.transparent,
      depthWrite: !opts.transparent,
      side: THREE.FrontSide,
      defines: opts.sway ? { SWAY: '' } : {}
    });
    mats.push(m);
    return m;
  }

  function init() {
    B = Voxel.Blocks;
    G = Voxel.World.get;
    GSky = Voxel.World.getSky;
    GBlk = Voxel.World.getBlk;
    texture = B.getTexture();
    whiteTex = makeWhiteTex();
    opaqueMat = mkMat(1, '0.5', {});
    waterMat = mkMat(1, '0.02', { transparent: true });
    foliageMat = mkMat(1, '0.5', { sway: true });
  }

  function tileUV(tile, ux, uy) {
    var c = tile % 16, r = (tile / 16) | 0;
    tmpUV[0] = (c * 16 + 0.5 + ux * 15) / 256;
    tmpUV[1] = 1 - (r * 16 + 0.5 + (1 - uy) * 15) / 256;
  }

  // 单顶点平滑光照：对面朝格 N 及其两个侧邻、角邻共 4 格采样（不透明格不参与平均，
  // 但通过 AO 因子变暗）；返回该顶点的天光/块光与 AO 等级
  function vertexLight(x, y, z, F, au, av, aw, bu, bv, bw) {
    var bx = x + F.n[0], by = y + F.n[1], bz = z + F.n[2];
    var ox1 = bx + au, oy1 = by + av, oz1 = bz + aw;
    var ox2 = bx + bu, oy2 = by + bv, oz2 = bz + bw;
    var oxc = bx + au + bu, oyc = by + av + bv, ozc = bz + aw + bw;
    var s1 = B.isOpaque(G(ox1, oy1, oz1)) ? 1 : 0;
    var s2 = B.isOpaque(G(ox2, oy2, oz2)) ? 1 : 0;
    var sc = B.isOpaque(G(oxc, oyc, ozc)) ? 1 : 0;
    var aoIdx = (s1 && s2) ? 3 : s1 + s2 + sc;
    var sky = GSky(bx, by, bz), blk = GBlk(bx, by, bz), n = 1;
    if (!s1) { sky += GSky(ox1, oy1, oz1); blk += GBlk(ox1, oy1, oz1); n++; }
    if (!s2) { sky += GSky(ox2, oy2, oz2); blk += GBlk(ox2, oy2, oz2); n++; }
    if (!sc && !(s1 && s2)) { sky += GSky(oxc, oyc, ozc); blk += GBlk(oxc, oyc, ozc); n++; }
    vLight.ls = sky / (n * 15);
    vLight.lb = blk / (n * 15);
    vLight.ao = aoIdx;
    return vLight;
  }
  var vLight = { ls: 0, lb: 0, ao: 0 };

  // 发射一个面：yBot/yTop 为底/顶边绝对高度，uvLo/uvHi 为纹理 V 范围
  // （整块=y..y+1/0..1；床=y..y+0.5/0..1；邻居为床时只发上半面 y+0.5..y+1/0.5..1）
  // ls/lb: 面所朝格子的天光/块光（兜底值）
  function emitFace(t, F, tile, x, y, z, yBot, yTop, uvLo, uvHi, ls, lb) {
    var base = t.pos.length / 3;
    var aoArr = [0, 0, 0, 0];
    for (var k = 0; k < 4; k++) {
      var corner = F.c[k];
      t.pos.push(x + corner[0], y + (corner[1] ? yTop - y : yBot - y), z + corner[2]);
      t.nrm.push(F.n[0], F.n[1], F.n[2]);

      var uvx = UVK[k][0], uvy = UVK[k][1];
      tileUV(tile, uvx, uvy ? uvHi : uvLo);
      t.uv.push(tmpUV[0], tmpUV[1]);

      var au = (uvx ? F.u[0] : -F.u[0]);
      var av = (uvx ? F.u[1] : -F.u[1]);
      var aw = (uvx ? F.u[2] : -F.u[2]);
      var bu = (uvy ? F.v[0] : -F.v[0]);
      var bv = (uvy ? F.v[1] : -F.v[1]);
      var bw = (uvy ? F.v[2] : -F.v[2]);
      var vl = vertexLight(x, y, z, F, au, av, aw, bu, bv, bw);
      aoArr[k] = vl.ao;
      var shade = F.b * AO[vl.ao];
      t.col.push(shade, shade, shade);
      t.lgt.push(vl.ls, vl.lb);
    }
    // AO 各向异性：按对角和选择四边形剖分对角线，避免遮蔽插值出现三角面痕迹
    if (aoArr[0] + aoArr[2] > aoArr[1] + aoArr[3]) {
      t.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      t.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    }
  }

  // 火把等十字面片：两条对角竖 quad × 正反两面
  function emitCross(t, tile, x, y, z) {
    var ls = GSky(x, y, z) / 15, lb = 1; // 自身全亮
    var h = 0.7, m = 0.15, M = 0.85;
    var quads = [
      [[m, m], [M, M]],
      [[M, m], [m, M]]
    ];
    for (var q = 0; q < quads.length; q++) {
      for (var side = 0; side < 2; side++) {
        var a = quads[q][side ? 1 : 0], b = quads[q][side ? 0 : 1];
        var base = t.pos.length / 3;
        // 4 顶点：a底 b底 b顶 a顶
        var vs = [
          [x + a[0], y, z + a[1], 0, 0],
          [x + b[0], y, z + b[1], 1, 0],
          [x + b[0], y + h, z + b[1], 1, 1],
          [x + a[0], y + h, z + a[1], 0, 1]
        ];
        for (var k = 0; k < 4; k++) {
          var v = vs[k];
          t.pos.push(v[0], v[1], v[2]);
          t.nrm.push(0, 1, 0);
          tileUV(tile, v[3], v[4]);
          t.uv.push(tmpUV[0], tmpUV[1]);
          t.col.push(1, 1, 1);
          t.lgt.push(ls, lb);
        }
        if (side === 1) t.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        else t.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }

  function makeGeo(a) {
    if (!a.pos.length) return null;
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
    g.setAttribute('acolor', new THREE.Float32BufferAttribute(a.col, 3));
    g.setAttribute('alight', new THREE.Float32BufferAttribute(a.lgt, 2));
    g.setAttribute('anrm', new THREE.Float32BufferAttribute(a.nrm, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(a.idx), 1));
    g.computeBoundingSphere();
    return g;
  }

  function build(cx, cz) {
    var CFG = Voxel.Config;
    var H = CFG.WORLD_H, CS = CFG.CHUNK;
    var o = { pos: [], uv: [], col: [], idx: [], lgt: [], nrm: [] };
    var w = { pos: [], uv: [], col: [], idx: [], lgt: [], nrm: [] };
    var fl = { pos: [], uv: [], col: [], idx: [], lgt: [], nrm: [] };
    var x0 = cx * CS, z0 = cz * CS;

    for (var lx = 0; lx < CS; lx++) {
      var x = x0 + lx;
      for (var lz = 0; lz < CS; lz++) {
        var z = z0 + lz;
        for (var y = 0; y < H; y++) {
          var id = G(x, y, z);
          if (id === 0) continue;
          var def = B.defs[id];
          if (!def) continue;
          var isWater = id === 7;
          var isBed = !!def.half;
          // 树叶独立组：参与实时阴影投射与顶点风摇
          var target = (isWater || id === 13) ? w : (def.leaves ? fl : o);

          // 火把等十字面片：不参与面剔除
          if (def.cross) {
            emitCross(target, def.tiles[1], x, y, z);
            continue;
          }

          for (var f = 0; f < 6; f++) {
            var F = FACES[f];
            var nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
            var nb = G(nx, ny, nz);
            var show;
            if (isWater) show = (nb === 0 || nb === 13 || nb === 19);
            else if (isBed) {
              // 床占格子下半：侧面被不透明邻居或相邻床遮盖，顶/底面被不透明邻居遮盖
              show = !B.isOpaque(nb) && (f === 2 || f === 3 || nb !== 17);
            }
            else if (def.opaque) show = !B.isOpaque(nb);
            else show = (nb !== id && !B.isOpaque(nb)); // 玻璃
            if (!show) continue;

            // 面所朝格子的光照（天光/块光归一化）
            var ls = GSky(nx, ny, nz) / 15;
            var lb = GBlk(nx, ny, nz) / 15;
            // 火把自身所在格有块光，其邻居格也已被 BFS 照亮；贴着火把的面直接取邻格值即可

            var tile = B.tileForFace(id, f);
            if (isBed) {
              emitFace(target, F, tile, x, y, z, y, y + 0.5, 0, 1, ls, lb);
            } else if (isWater) {
              emitFace(target, F, tile, x, y, z, y, (f === 2 && aboveWaterOf(x, y, z)) ? y + 0.89 : y + 1, 0, 1, ls, lb);
            } else if (nb === 17 && (f === 2 || f === 3)) {
              // 顶面正上方是床 → 被床底面完全覆盖，剔除；底面正下方是床 → 床顶在 y-0.5 处，不遮盖，照常发射
              if (f === 2) continue;
              emitFace(target, F, tile, x, y, z, y, y + 1, 0, 1, ls, lb);
            } else if (nb === 17) {
              // 侧面邻居是半高床：只发未被遮盖的上半面，避免同平面 z-fight
              emitFace(target, F, tile, x, y, z, y + 0.5, y + 1, 0.5, 1, ls, lb);
            } else {
              emitFace(target, F, tile, x, y, z, y, y + 1, 0, 1, ls, lb);
            }
          }
        }
      }
    }
    return { opaque: makeGeo(o), water: makeGeo(w), foliage: makeGeo(fl) };
  }

  function aboveWaterOf(x, y, z) {
    return G(x, y + 1, z) !== 7;
  }

  function eachUniform(name, apply) {
    for (var i = 0; i < mats.length; i++) {
      var u = mats[i].uniforms[name];
      if (u) apply(u);
    }
  }

  return {
    init: init,
    build: build,
    opaqueMat: function () { return opaqueMat; },
    waterMat: function () { return waterMat; },
    foliageMat: function () { return foliageMat; },
    // 供阴影深度 pass 复用的摇摆位移 GLSL（必须与主视图一致）
    swayGLSL: SWAY_GLSL,
    applyTint: function (t) {
      eachUniform('tint', function (u) { u.value.copy(t); });
    },
    setSun: function (s) {
      eachUniform('sun', function (u) { u.value = s; });
    },
    setEnv: function (fogColor, fogNear, fogFar) {
      eachUniform('uFogColor', function (u) { u.value.copy(fogColor); });
      eachUniform('uFogNear', function (u) { u.value = fogNear; });
      eachUniform('uFogFar', function (u) { u.value = fogFar; });
    },
    // 风摇：时间 + 风矢量 + 振幅（树叶材质生效；其余材质 SWAY 未定义自动忽略）
    setWind: function (time, wx, wz, amp) {
      eachUniform('uTime', function (u) { u.value = time; });
      eachUniform('uWind', function (u) { u.value.set(wx, wz); });
      eachUniform('uSwayAmp', function (u) { u.value = amp; });
    },
    // 实时树影参数（深度图 + 世界→[0,1]³ 投影矩阵 + 强度 + 图尺寸）
    setLeafShadow: function (tex, mat4, str, size) {
      eachUniform('uShadowTex', function (u) { u.value = tex; });
      eachUniform('uShadowMat', function (u) { u.value.copy(mat4); });
      eachUniform('uShadowStr', function (u) { u.value = str; });
      eachUniform('uShadowSize', function (u) { u.value = size; });
    },
    // 太阳方向（世界系，指向太阳）+ 方向光强度（白天 1 → 夜晚趋近 0）
    setSunDirection: function (x, y, z, dirStr) {
      eachUniform('uSunDir', function (u) { u.value.set(x, y, z); });
      eachUniform('uDirStr', function (u) { u.value = dirStr; });
    },
    // 程序化云影：漂移偏移（与可见云层同步）+ 强度
    setCloudShadow: function (dx, dz, str) {
      eachUniform('uCloudDrift', function (u) { u.value.set(dx, dz); });
      eachUniform('uCloudStr', function (u) { u.value = str; });
    }
  };
})();
