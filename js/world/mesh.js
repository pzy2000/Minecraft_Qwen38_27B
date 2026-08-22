// 区块网格构建：隐藏面剔除 + 顶点环境光遮蔽(AO) + 双通道光照（天光×昼夜 / 块光）
window.Voxel = window.Voxel || {};

Voxel.MeshBuilder = (function () {
  var B = null;
  var G = null, GSky = null, GBlk = null;
  var texture, opaqueMat, waterMat;
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

  var VERT =
    'attribute vec3 acolor;\n' +
    'attribute vec2 alight;\n' +
    'varying vec2 vUv;\nvarying vec3 vCol;\nvarying vec2 vL;\nvarying float vDepth;\n' +
    'void main(){\n' +
    '  vUv = uv; vCol = acolor; vL = alight;\n' +
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);\n' +
    '  vDepth = -mv.z;\n' +
    '  gl_Position = projectionMatrix * mv;\n' +
    '}';
  function frag(cut) {
    return [
      'uniform sampler2D map;',
      'uniform vec3 tint;',
      'uniform float sun;',
      'uniform vec3 uFogColor;',
      'uniform float uFogNear;',
      'uniform float uFogFar;',
      'uniform float uAlpha;',
      'varying vec2 vUv;',
      'varying vec3 vCol;',
      'varying vec2 vL;',
      'varying float vDepth;',
      'void main(){',
      '  vec4 tex = texture2D(map, vUv);',
      '  if (tex.a < ' + cut + ') discard;',
      '  float br = max(vL.x * sun, vL.y);',
      '  br = 0.05 + 0.95 * pow(br, 1.35);',
      '  vec3 c = tex.rgb * vCol * tint * br;',
      '  float f = smoothstep(uFogNear, uFogFar, vDepth);',
      '  gl_FragColor = vec4(mix(c, uFogColor, f), tex.a * uAlpha);',
      '}'
    ].join('\n');
  }

  function mkMat(alpha, cut, opts) {
    return new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        tint: { value: new THREE.Color(1, 1, 1) },
        sun: { value: 1 },
        uFogColor: { value: new THREE.Color(0x87ceeb) },
        uFogNear: { value: 60 },
        uFogFar: { value: 240 },
        uAlpha: { value: alpha }
      },
      vertexShader: VERT,
      fragmentShader: frag(cut),
      transparent: !!opts.transparent,
      depthWrite: !opts.transparent,
      side: THREE.FrontSide
    });
  }

  function init() {
    B = Voxel.Blocks;
    G = Voxel.World.get;
    GSky = Voxel.World.getSky;
    GBlk = Voxel.World.getBlk;
    texture = B.getTexture();
    opaqueMat = mkMat(1, '0.5', {});
    waterMat = mkMat(1, '0.02', { transparent: true });
  }

  function tileUV(tile, ux, uy) {
    var c = tile % 16, r = (tile / 16) | 0;
    tmpUV[0] = (c * 16 + 0.5 + ux * 15) / 256;
    tmpUV[1] = 1 - (r * 16 + 0.5 + (1 - uy) * 15) / 256;
  }

  // 发射一个面：yBot/yTop 为底/顶边绝对高度，uvLo/uvHi 为纹理 V 范围
  // （整块=y..y+1/0..1；床=y..y+0.5/0..1；邻居为床时只发上半面 y+0.5..y+1/0.5..1）
  // ls/lb: 面所朝格子的天光/块光（0~1）
  function emitFace(t, F, tile, x, y, z, yBot, yTop, uvLo, uvHi, ls, lb) {
    var base = t.pos.length / 3;
    for (var k = 0; k < 4; k++) {
      var corner = F.c[k];
      t.pos.push(x + corner[0], y + (corner[1] ? yTop - y : yBot - y), z + corner[2]);

      var uvx = UVK[k][0], uvy = UVK[k][1];
      tileUV(tile, uvx, uvy ? uvHi : uvLo);
      t.uv.push(tmpUV[0], tmpUV[1]);

      var au = (uvx ? F.u[0] : -F.u[0]);
      var av = (uvx ? F.u[1] : -F.u[1]);
      var aw = (uvx ? F.u[2] : -F.u[2]);
      var bu = (uvy ? F.v[0] : -F.v[0]);
      var bv = (uvy ? F.v[1] : -F.v[1]);
      var bw = (uvy ? F.v[2] : -F.v[2]);
      var s1 = B.isOpaque(G(x + F.n[0] + au, y + F.n[1] + av, z + F.n[2] + aw)) ? 1 : 0;
      var s2 = B.isOpaque(G(x + F.n[0] + bu, y + F.n[1] + bv, z + F.n[2] + bw)) ? 1 : 0;
      var sc = B.isOpaque(G(x + F.n[0] + au + bu, y + F.n[1] + av + bv, z + F.n[2] + aw + bw)) ? 1 : 0;
      var ao = (s1 && s2) ? 3 : s1 + s2 + sc;
      var shade = F.b * AO[ao];
      t.col.push(shade, shade, shade);
      t.lgt.push(ls, lb);
    }
    t.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
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
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(a.idx), 1));
    g.computeBoundingSphere();
    return g;
  }

  function build(cx, cz) {
    var CFG = Voxel.Config;
    var H = CFG.WORLD_H, CS = CFG.CHUNK;
    var o = { pos: [], uv: [], col: [], idx: [], lgt: [] };
    var w = { pos: [], uv: [], col: [], idx: [], lgt: [] };
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
          var target = (isWater || id === 13) ? w : o;

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
    return { opaque: makeGeo(o), water: makeGeo(w) };
  }

  function aboveWaterOf(x, y, z) {
    return G(x, y + 1, z) !== 7;
  }

  return {
    init: init,
    build: build,
    opaqueMat: function () { return opaqueMat; },
    waterMat: function () { return waterMat; },
    applyTint: function (t) {
      opaqueMat.uniforms.tint.value.copy(t);
      waterMat.uniforms.tint.value.copy(t);
    },
    setSun: function (s) {
      opaqueMat.uniforms.sun.value = s;
      waterMat.uniforms.sun.value = s;
    },
    setEnv: function (fogColor, fogNear, fogFar) {
      opaqueMat.uniforms.uFogColor.value.copy(fogColor);
      waterMat.uniforms.uFogColor.value.copy(fogColor);
      opaqueMat.uniforms.uFogNear.value = fogNear;
      waterMat.uniforms.uFogNear.value = fogNear;
      opaqueMat.uniforms.uFogFar.value = fogFar;
      waterMat.uniforms.uFogFar.value = fogFar;
    }
  };
})();
