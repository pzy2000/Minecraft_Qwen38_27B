// 区块网格构建：隐藏面剔除 + 顶点环境光遮蔽(AO)
window.Voxel = window.Voxel || {};

Voxel.MeshBuilder = (function () {
  var B = null;
  var G = null;
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

  function init() {
    B = Voxel.Blocks;
    G = Voxel.World.get;
    texture = B.getTexture();
    opaqueMat = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true });
    waterMat = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, transparent: true, depthWrite: false });
  }

  function tileUV(tile, ux, uy) {
    var c = tile % 16, r = (tile / 16) | 0;
    tmpUV[0] = (c * 16 + 0.5 + ux * 15) / 256;
    tmpUV[1] = 1 - (r * 16 + 0.5 + (1 - uy) * 15) / 256;
  }

  // 发射一个面：yBot/yTop 为底/顶边绝对高度，uvLo/uvHi 为纹理 V 范围
  // （整块=y..y+1/0..1；床=y..y+0.5/0..1；邻居为床时只发上半面 y+0.5..y+1/0.5..1）
  function emitFace(t, F, tile, x, y, z, yBot, yTop, uvLo, uvHi) {
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
    }
    t.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  function makeGeo(a) {
    if (!a.pos.length) return null;
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(a.col, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(a.idx), 1));
    g.computeBoundingSphere();
    return g;
  }

  function build(cx, cz) {
    var CFG = Voxel.Config;
    var H = CFG.WORLD_H, CS = CFG.CHUNK;
    var o = { pos: [], uv: [], col: [], idx: [] };
    var w = { pos: [], uv: [], col: [], idx: [] };
    var x0 = cx * CS, z0 = cz * CS;

    for (var lx = 0; lx < CS; lx++) {
      var x = x0 + lx;
      for (var lz = 0; lz < CS; lz++) {
        var z = z0 + lz;
        for (var y = 0; y < H; y++) {
          var id = G(x, y, z);
          if (id === 0) continue;
          var def = B.defs[id];
          var isWater = id === 7;
          var isBed = !!def.half;
          var target = (isWater || id === 13) ? w : o;
          var aboveWater = isWater && G(x, y + 1, z) !== 7;

          for (var f = 0; f < 6; f++) {
            var F = FACES[f];
            var nb = G(x + F.n[0], y + F.n[1], z + F.n[2]);
            var show;
            if (isWater) show = (nb === 0 || nb === 13);
            else if (isBed) {
              // 床占格子下半：侧面被不透明邻居或相邻床遮盖，顶/底面被不透明邻居遮盖
              show = !B.isOpaque(nb) && (f === 2 || f === 3 || nb !== 17);
            }
            else if (def.opaque) show = !B.isOpaque(nb);
            else show = (nb !== id && !B.isOpaque(nb)); // 玻璃
            if (!show) continue;

            var tile = B.tileForFace(id, f);
            if (isBed) {
              emitFace(target, F, tile, x, y, z, y, y + 0.5, 0, 1);
            } else if (isWater) {
              emitFace(target, F, tile, x, y, z, y, (f === 2 && aboveWater) ? y + 0.89 : y + 1, 0, 1);
            } else if (nb === 17 && (f === 2 || f === 3)) {
              // 顶面正上方是床 → 被床底面完全覆盖，剔除；底面正下方是床 → 床顶在 y-0.5 处，不遮盖，照常发射
              if (f === 2) continue;
              emitFace(target, F, tile, x, y, z, y, y + 1, 0, 1);
            } else if (nb === 17) {
              // 侧面邻居是半高床：只发未被遮盖的上半面，避免同平面 z-fight
              emitFace(target, F, tile, x, y, z, y + 0.5, y + 1, 0.5, 1);
            } else {
              emitFace(target, F, tile, x, y, z, y, y + 1, 0, 1);
            }
          }
        }
      }
    }
    return { opaque: makeGeo(o), water: makeGeo(w) };
  }

  return {
    init: init,
    build: build,
    opaqueMat: function () { return opaqueMat; },
    waterMat: function () { return waterMat; },
    applyTint: function (t) {
      opaqueMat.color.copy(t);
      waterMat.color.copy(t);
    }
  };
})();
