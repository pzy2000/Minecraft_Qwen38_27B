// 星海嘉年华 · 动态设施运行时：非体素 THREE 组件 + 时间驱动注册表。
// 与体素静态基底（structures.buildPark）共用 parkStations() 参数事实源，
// 保证轮心/轨道样条与静态支柱永远一致。
//
// 设计约束：
// - 纯视觉动画在渲染帧路径上用 now 秒直接驱动 transform（对齐空间站装饰环模式）；
// - 尊重 reducedMotion：暂停外观自转与音效，仍保留位置与乘坐功能；
// - 距离预算：玩家 <130 格生成、>150 格释放；跨世界立即释放；
// - 绘制瘦身：同一动画组内静态部件用顶点色合并为单一 Mesh（见 PartBuilder），
//   全园 draw call 从 ~200 压到 ~40；帧内热路径复用模块级 scratch 向量；
// - 音效：按设施相位触发程序化合成提示（Sound.rideXxx），不新增常驻节点；
// - 不写入任何存档字段（未互动零开销）。
window.Voxel = window.Voxel || {};

Voxel.Amusement = (function () {
  'use strict';

  var CFG = Voxel.Config;
  var SPAWN_R = 130, DESPAWN_R = 155;

  var sceneRef = null;
  var root = null;
  var active = null;          // { worldId, park, stations, pieces, disposables }
  var reducedMotion = false;
  var _searchCd = 0;

  // ---- 帧内 scratch（避免每帧 new Vector3 造成 GC 抖动）----
  var _v1, _v2, _v3, _q1;
  function scratch() {
    if (!_v1) {
      _v1 = new THREE.Vector3(); _v2 = new THREE.Vector3();
      _v3 = new THREE.Vector3(); _q1 = new THREE.Quaternion();
    }
    return true;
  }

  function mat(color, opts) {
    opts = opts || {};
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      fog: true,
      transparent: !!opts.transparent,
      opacity: opts.opacity === undefined ? 1 : opts.opacity,
      depthWrite: opts.depthWrite === undefined ? true : !!opts.depthWrite,
      side: opts.side !== undefined ? opts.side : THREE.FrontSide,
      vertexColors: !!opts.vertexColors
    });
  }

  // ---------- PartBuilder：几何合并（顶点色） ----------
  // 用法：pb.box(color,{x,y,z},{w,h,d},rotZ…) / pb.torus(...)…
  // build() 输出单个 BufferGeometry；材质统一 MeshBasicMaterial({vertexColors})，
  // 玻璃等透明件用独立透明批次。合并后立即释放源几何。
  function PartBuilder() {
    this.parts = [];
  }
  PartBuilder.prototype._push = function (geo, hex, x, y, z, rx, ry, rz) {
    if (rx) geo.rotateX(rx);
    if (ry) geo.rotateY(ry);
    if (rz) geo.rotateZ(rz);
    geo.translate(x || 0, y || 0, z || 0);
    this.parts.push({ geo: geo, color: hex });
  };
  PartBuilder.prototype.box = function (hex, size, t, rot) {
    var g = new THREE.BoxGeometry(size[0], size[1], size[2]);
    this._push(g, hex, t[0], t[1], t[2], rot && rot[0], rot && rot[1], rot && rot[2]);
    return this;
  };
  PartBuilder.prototype.cyl = function (hex, r0, r1, h, seg, t, rot) {
    var g = new THREE.CylinderGeometry(r0, r1 === undefined ? r0 : r1, h, seg || 8);
    this._push(g, hex, t[0], t[1], t[2], rot && rot[0], rot && rot[1], rot && rot[2]);
    return this;
  };
  PartBuilder.prototype.cone = function (hex, r, h, seg, t, rot) {
    var g = new THREE.ConeGeometry(r, h, seg || 4);
    this._push(g, hex, t[0], t[1], t[2], rot && rot[0], rot && rot[1], rot && rot[2]);
    return this;
  };
  PartBuilder.prototype.sphere = function (hex, r, t) {
    var g = new THREE.SphereGeometry(r, 8, 6);
    this._push(g, hex, t[0], t[1], t[2], 0, 0, 0);
    return this;
  };
  PartBuilder.prototype.torus = function (hex, R, r, segT, segR, t, rot) {
    var g = new THREE.TorusGeometry(R, r, segR || 8, segT || 32);
    this._push(g, hex, t[0], t[1], t[2], rot && rot[0], rot && rot[1], rot && rot[2]);
    return this;
  };
  PartBuilder.prototype.merge = function (dis) {
    var pos = [], nor = [], uv = [], col = [], idx = [];
    var c = new THREE.Color();
    for (var i = 0; i < this.parts.length; i++) {
      var part = this.parts[i];
      var g = part.geo;
      var p = g.attributes.position.array;
      var n = g.attributes.normal ? g.attributes.normal.array : null;
      var u = g.attributes.uv ? g.attributes.uv.array : null;
      var base = pos.length / 3;
      for (var k = 0; k < p.length; k++) pos.push(p[k]);
      if (n) for (k = 0; k < n.length; k++) nor.push(n[k]);
      else for (k = 0; k < p.length; k++) nor.push(0, 1, 0);
      if (u) for (k = 0; k < u.length; k++) uv.push(u[k]);
      else for (k = 0; k < p.length / 3 * 2; k++) uv.push(0);
      c.setHex(part.color);
      for (k = 0; k < p.length / 3; k++) col.push(c.r, c.g, c.b);
      if (g.index) {
        var gi = g.index.array;
        for (k = 0; k < gi.length; k++) idx.push(gi[k] + base);
      } else {
        for (k = 0; k < p.length / 3; k++) idx.push(k + base);
      }
      g.dispose();                       // 源几何即刻释放，避免滞留至园区卸载
    }
    this.parts.length = 0;
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    dis(geo);
    return geo;
  };

  // ---------- 运动曲线 ----------
  function dropProfile(u) {
    // 升慢 → 顶部悬停 → 自由坠（重力感二次加速）→ 液压缓冲回座
    if (u < 0.52) {                                   // 缓升
      var r = u / 0.52;
      return r * r * (3 - 2 * r);
    }
    if (u < 0.62) return 1;                           // 顶悬
    if (u < 0.74) {                                   // 急坠（二次缓入）
      var d = (u - 0.62) / 0.12;
      return 1 - d * d;
    }
    if (u < 0.92) {                                   // 回弹缓冲
      var b = (u - 0.74) / 0.18;
      var wob = Math.exp(-4.5 * b) * Math.sin(b * Math.PI * 3.1);
      return wob * 0.16;
    }
    return 0;
  }

  function easeInOutCubic(x) {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  // ---------- 音效节流状态（update 循环共享） ----------
  var snd = {
    clankAt: 0, whooshAt: 0, tWhooshAt: 0,
    noteStep: 0, noteAt: 0, creakQ: -1
  };
  function sndVol(px, pz, x, z, range) {
    var dx = x - px, dz = z - pz;
    var d = Math.sqrt(dx * dx + dz * dz);
    return d > (range || 70) ? 0 : 1 - d / (range || 70);
  }

  // ---------- 设施构建 ----------

  function buildFerris(st, dis, nowSec) {
    scratch();
    var g = new THREE.Group();
    g.position.set(st.cx + 0.5, st.hubY + 0.5, st.cz + 0.5);
    // 轮平面法线：垂直于园区 rot 的水平朝向（rot=0/2 → 法线沿 x；rot=1/3 → 沿 z）
    var axleY = new THREE.Vector3(0, 1, 0);
    var horiz = ((st.rotHint & 1) === 1)
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(1, 0, 0);

    // 轮体框架：双圈轮缘 + 内衬圈 + 辐条×24 + 轮毂节点×12 + 中轴 —— 合并为 1 个 Mesh
    var pb = new PartBuilder();
    pb.torus(0xe8b64c, st.R, 0.32, 56, 10, [0, 0, 1.15], [0, 0, 0]);
    pb.torus(0xcf9a35, st.R, 0.32, 56, 10, [0, 0, -1.15], [0, 0, 0]);
    pb.torus(0x9a7526, st.R - 1.1, 0.14, 48, 8, [0, 0, 0], [0, 0, 0]);
    for (var sIdx = 0; sIdx < 12; sIdx++) {
      var ang = sIdx / 12 * Math.PI * 2;
      for (var zz = -1; zz <= 1; zz += 2) {
        pb.box(0xd8d2c4, [0.22, st.R * 2 - 1.6, 0.22], [0, 0, zz * 1.05], [0, 0, ang]);
      }
      pb.box(0xb98a2e, [0.7, 0.7, 2.6],
        [Math.cos(ang) * (st.R - 1.1), Math.sin(ang) * (st.R - 1.1), 0], [0, 0, ang]);
    }
    pb.cyl(0xc79a38, 1.4, 1.4, 3.4, 18, [0, 0, 0], [Math.PI / 2, 0, 0]);
    var frameGeo = pb.merge(dis);
    var wheelFrame = new THREE.Mesh(frameGeo, dis(mat(0xffffff, { vertexColors: true })));
    wheelFrame.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      _v1.crossVectors(horiz, axleY).normalize());
    g.add(wheelFrame);

    // 外圈灯珠（独立半透明材质做呼吸脉冲）：第二个同旋 Mesh
    var pbBulb = new PartBuilder();
    for (var bi = 0; bi < 24; bi++) {
      var bAng = bi / 24 * Math.PI * 2;
      pbBulb.sphere(0xffe08a, 0.28,
        [Math.cos(bAng) * st.R, Math.sin(bAng) * st.R, 0]);
    }
    var bulbGeo = pbBulb.merge(dis);
    var bulbMat = dis(mat(0xffe08a, { transparent: true, opacity: 0.9 }));
    var bulbs = new THREE.Mesh(bulbGeo, bulbMat);
    bulbs.quaternion.copy(wheelFrame.quaternion);
    g.add(bulbs);

    // 座舱 ×N：每舱合并为 1 个 Mesh（车窗以实体浅蓝烘进顶点色，弃透明省批次）
    var cabins = [];
    var CAB_COLORS = [0xd8574f, 0xf3b13e, 0x59a86b, 0x4f8fd0, 0xdf8fb4];
    for (var ci = 0; ci < st.cabins; ci++) {
      var col = CAB_COLORS[ci % CAB_COLORS.length];
      var pcb = new PartBuilder();
      pcb.box(col, [2.4, 2.1, 1.7], [0, -1.5, 0]);
      pcb.cone(0xefeadf, 1.75, 0.9, 4, [0, -0.25, 0], [0, Math.PI / 4, 0]);
      pcb.cyl(0x777268, 0.09, 0.09, 1.2, 6, [0, 0.45, 0]);
      pcb.box(0xbfe3ee, [1.7, 0.8, 0.08], [0, -1.55, 0.88]);
      pcb.box(0xbfe3ee, [1.7, 0.8, 0.08], [0, -1.55, -0.88]);
      var cab = new THREE.Mesh(pcb.merge(dis),
        dis(mat(0xffffff, { vertexColors: true })));
      root.add(cab);
      cabins.push(cab);
    }

    // 面朝角：座舱正面面向轮轴水平切向
    var faceYaw = Math.atan2(horiz.x, -(horiz.z || 0.0001));

    return {
      group: g, kind: 'ferris',
      tick: function (now) {
        var omega = (Math.PI * 2) / st.periodS;
        var theta = reducedMotion ? 0 : omega * (now - (st._t0 || now));
        wheelFrame.rotation.z = theta;
        bulbs.rotation.z = theta;
        for (var i = 0; i < st.cabins; i++) {
          var a = theta + i / st.cabins * Math.PI * 2;
          scratch();
          _v1.set(Math.cos(a) * st.R, Math.sin(a) * st.R, 0)
            .applyQuaternion(_q1.copy(wheelFrame.quaternion));
          cabins[i].position.copy(g.position).add(_v1);
          cabins[i].rotation.set(0, faceYaw, reducedMotion ? 0 : Math.sin(a) * 0.08);
        }
        // 灯珠呼吸
        var glowP = reducedMotion ? 0.5 : (0.65 + 0.35 * Math.sin(now * 2.2));
        bulbMat.opacity = 0.72 + 0.28 * glowP;
        bulbMat.transparent = true;
        return theta;
      },
      riderPose: function (now) {
        var omega = (Math.PI * 2) / st.periodS;
        var theta = reducedMotion ? -Math.PI / 2 : omega * (now - (st._t0 || now)) - Math.PI / 2;
        var a = theta;
        scratch();
        _pose.pos.copy(g.position)
          .add(_v1.set(Math.cos(a) * st.R, Math.sin(a) * st.R, 0)
            .applyQuaternion(_q1.copy(wheelFrame.quaternion)));
        _pose.yaw = faceYaw; _pose.pitch = 0; _pose.fovOff = 0;
        return _pose;
      },
      creakPhase: function (now) {
        var omega = (Math.PI * 2) / st.periodS;
        var theta = reducedMotion ? 0 : omega * (now - (st._t0 || now));
        return Math.floor(theta / (Math.PI / 2));
      }
    };
  }

  function buildCarousel(st, dis, nowSec) {
    var g = new THREE.Group();
    g.position.set(st.cx + 0.5, st.baseY + 0.5, st.cz + 0.5);
    var spin = new THREE.Group();
    g.add(spin);
    // 每匹马合并为 1 个 Mesh（含金色栏杆柱），共 8 draw
    var HORSE_COLORS = [0xf0eee6, 0xd8574f, 0x4f8fd0, 0xf3b13e, 0x8e6cc0, 0x59a86b];
    var seats = [];
    var nHorse = 8;
    for (var i = 0; i < nHorse; i++) {
      var col = HORSE_COLORS[i % HORSE_COLORS.length];
      var phb = new PartBuilder();
      phb.box(col, [1.5, 0.72, 0.62], [0, 0, 0]);
      phb.box(col, [0.42, 0.66, 0.5], [0.62, 0.5, 0], [0, 0, -0.35]);
      phb.box(col, [0.58, 0.4, 0.44], [0.95, 0.78, 0]);
      phb.cyl(0xe8c34a, 0.07, 0.07, 5.4, 8, [0, 0.55, 0]);
      phb.box(0xe4797d, [0.6, 0.16, 0.5], [0, 0.42, 0]);
      var hg = new THREE.Mesh(phb.merge(dis),
        dis(mat(0xffffff, { vertexColors: true })));
      spin.add(hg);
      seats.push(hg);
    }
    // 转盘顶缘小灯环（static-in-g）
    var trim = new THREE.Mesh((function () {
      var pbt = new PartBuilder();
      pbt.torus(0xffe08a, 4.7, 0.09, 40, 6, [0, 1.4, 0], [Math.PI / 2, 0, 0]);
      return pbt.merge(dis);
    })(), dis(mat(0xffe08a)));
    g.add(trim);

    return {
      group: g, kind: 'carousel',
      tick: function (now) {
        var omega = (Math.PI * 2) / st.periodS;
        var theta = reducedMotion ? 0 : omega * (now - (st._t0 || now));
        spin.rotation.y = theta;
        for (var i = 0; i < nHorse; i++) {
          var ha = i / nHorse * Math.PI * 2;
          seats[i].position.set(Math.cos(ha) * 4.2, 1.6 + (reducedMotion ? 0 :
            Math.sin(now * 2.1 + i * 1.7) * 0.34), Math.sin(ha) * 4.2);
          seats[i].rotation.y = -ha;
        }
        return theta;
      },
      riderPose: function (now) {
        var omega = (Math.PI * 2) / st.periodS;
        var theta = reducedMotion ? 0 : omega * (now - (st._t0 || now));
        var ha = theta;                                     // 第 0 匹马
        _pose.pos.set(g.position.x + Math.cos(ha) * 4.2,
          g.position.y + 1.6 + (reducedMotion ? 0 : Math.sin(now * 2.1) * 0.34) + 0.9,
          g.position.z + Math.sin(ha) * 4.2);
        _pose.yaw = -(ha + Math.PI / 2); _pose.pitch = 0; _pose.fovOff = 0;
        return _pose;
      }
    };
  }

  function buildDrop(st, dis, nowSec) {
    var g = new THREE.Group();
    g.position.set(st.cx + 0.5, st.baseY + st.towerH + 1.5, st.cz + 0.5);
    var carriage = new THREE.Group();
    g.add(carriage);
    // 吊环 + 8 吊舱 + 8 安全杆 → 单 Mesh
    var pdb = new PartBuilder();
    pdb.torus(0xe8b64c, 2.1, 0.22, 26, 8, [0, 0, 0], [Math.PI / 2, 0, 0]);
    var POD_COLORS = [0xd8574f, 0xf3b13e, 0x59a86b, 0x4f8fd0, 0xdf8fb4, 0xefeadf, 0xd8574f, 0x4f8fd0];
    for (var i = 0; i < 8; i++) {
      var pa = i / 8 * Math.PI * 2;
      var px2 = Math.cos(pa) * 2.1, pz2 = Math.sin(pa) * 2.1;
      pdb.box(POD_COLORS[i], [0.9, 1.5, 0.8], [px2, -0.85, pz2]);
      pdb.box(0x777268, [0.14, 0.9, 0.14], [px2, 0.3, pz2]);
    }
    carriage.add(new THREE.Mesh(pdb.merge(dis),
      dis(mat(0xffffff, { vertexColors: true }))));
    var lastFrac = 0;

    return {
      group: g, kind: 'drop',
      tick: function (now) {
        var u = ((now - (st._t0 || now)) / st.periodS) % 1;
        if (u < 0) u += 1;
        var frac = reducedMotion ? 0 : dropProfile(u);
        carriage.position.y = -(g.position.y - (st.baseY + 2.2)) * (1 - frac);
        carriage.rotation.y = reducedMotion ? 0 :
          Math.sin(u * Math.PI * 2 * (st.towerH / 22)) * 0.35;
        lastFrac = frac;
        return u;
      },
      phase: function (now) {
        var u = ((now - (st._t0 || now)) / st.periodS) % 1;
        if (u < 0) u += 1;
        return u;
      },
      riderPose: function (now) {
        var u = this.phase(now);
        var frac = reducedMotion ? 0 : dropProfile(u);
        var topY = st.baseY + st.towerH + 1.5;
        var y = st.baseY + 2.2 + (topY - st.baseY - 2.2) * frac;
        // FOV 冲击：下落速度 ∝ |d(frac)/dt|，坠段归一化斜率 0..1 → 最多 +12°
        var fovOff = 0;
        if (!reducedMotion && u > 0.58 && u < 0.78) {
          fovOff = Math.min(12, dropProfileSlope(u) * 12);
        }
        _pose.pos.set(st.cx + 0.5, y, st.cz + 0.5);
        _pose.yaw = 0;
        _pose.pitch = reducedMotion ? 0 : -(frac > 0.9 ? -0.5 : 0.25);
        _pose.fovOff = fovOff;
        return _pose;
      }
    };
  }
  function dropProfileSlope(u) {
    // 急坠段导数近似（profile 在 u∈(0.62,0.74) 为 1-(du)^2，|slope|max≈2/0.12）
    var h = 0.004;
    return Math.abs(dropProfile(u + h) - dropProfile(u - h)) / (2 * h) /
      (1 / 0.12 * 2);
  }

  function makeCurve(points, closed) {
    var vts = [];
    for (var i = 0; i < points.length; i++)
      vts.push(new THREE.Vector3(points[i][0] + 0.5, points[i][1] + 1.4, points[i][2] + 0.5));
    return new THREE.CatmullRomCurve3(vts, !!closed, 'catmullrom', 0.5);
  }

  function buildCoaster(st, dis, nowSec) {
    var curve = makeCurve(st.path, true);
    var g = new THREE.Group();
    // 轨道：主梁 + 顶层金轨各 1 Mesh
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.16, 6, true),
      dis(mat(0x5a4632))));
    var railTop = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 120, 0.1, 6, true), dis(mat(0xc9a04a)));
    railTop.scale.set(1, 1.18, 1);
    g.add(railTop);
    // 列车 3 节，每节合并为 1 Mesh（头车带白鼻锥）
    var cars = [];
    var CAR_COLORS = [0xd8574f, 0xf3b13e, 0x59a86b];
    for (var i = 0; i < 3; i++) {
      var pcb2 = new PartBuilder();
      pcb2.box(CAR_COLORS[i], [1.3, 0.9, 2.1], [0, 0, 0]);
      if (i === 0)
        pcb2.cone(0xefeadf, 0.62, 0.9, 4, [0, 0.1, -1.35], [Math.PI / 2, 0, 0]);
      var car = new THREE.Mesh(pcb2.merge(dis),
        dis(mat(0xffffff, { vertexColors: true })));
      root.add(car);
      car.rotation.order = 'YXZ';
      cars.push(car);
    }
    var lastTanY = 0;

    return {
      group: g, kind: 'coaster', curve: curve,
      tick: function (now) {},
      cars: cars,
      trainPose: function (now, out) {
        var T = st.periodS;
        var u0 = reducedMotion ? 0 : ((now - (st._t0 || now)) / T) % 1;
        if (u0 < 0) u0 += 1;
        if (!tmpA || !tmpB) {
          ensureShared();
          _missingTmpWarned === undefined && (
            (typeof console !== 'undefined') && console.warn('[Amusement] tmp vectors rebuilt'),
            _missingTmpWarned = true);
        }
        var poses = out || [];
        poses.length = cars.length;
        for (var c = 0; c < cars.length; c++) {
          var uu = (u0 - c * 0.014 + 1) % 1;
          curve.getPointAt(uu, tmpA);
          curve.getTangentAt(uu, tmpB);
          if (!poses[c]) poses[c] = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, tanY: 0 };
          poses[c].pos.copy(tmpA);
          poses[c].yaw = Math.atan2(-tmpB.x, -tmpB.z);
          poses[c].pitch = Math.asin(Math.max(-1, Math.min(1, tmpB.y))) * -1;
          if (c === 0) poses[c].tanY = lastTanY = tmpB.y;
        }
        return poses;
      },
      slope: function () { return lastTanY; },
      riderPose: function (now) {
        var poses = this.trainPose(now, _carPoses);
        var lead = poses[0];
        _pose.pos.copy(lead.pos); _pose.pos.y += 1.0;
        _pose.yaw = lead.yaw; _pose.pitch = lead.pitch;
        // FOV：俯冲越陡越冲（爬坡轻微收窄感可忽略）
        _pose.fovOff = reducedMotion ? 0 :
          5 + Math.max(0, -lead.tanY) * 8;
        return _pose;
      }
    };
  }

  function buildTron(st, dis, nowSec) {
    scratch();
    var ax = _v1.set(st.g1[0] - st.g0[0], 0, st.g1[1] - st.g0[1]).normalize().clone();
    var side = _v2.crossVectors(new THREE.Vector3(0, 1, 0), ax).normalize().clone();
    var y0 = st.baseY + 2.2, loopR = (st.loopTopY - st.baseY) / 2 + 2;
    var exitP = new THREE.Vector3(st.g1[0] + 0.5, y0, st.g1[1] + 0.5);
    var entryBack = new THREE.Vector3(st.g0[0] + 0.5, y0, st.g0[1] + 0.5)
      .sub(ax.clone().multiplyScalar(6));
    var pts = [
      [entryBack.x, entryBack.y - 1.2, entryBack.z],
      [entryBack.x + ax.x * 6, y0, entryBack.z + ax.z * 6],
      [st.g0[0] + 0.5, y0, st.g0[1] + 0.5]
    ];
    for (var f = 0.25; f < 1; f += 0.25)
      pts.push([st.g0[0] + 0.5 + (st.g1[0] - st.g0[0]) * f, y0,
        st.g0[1] + 0.5 + (st.g1[1] - st.g0[1]) * f]);
    pts.push([st.g1[0] + 0.5, y0, st.g1[1] + 0.5]);
    // 出口高架直立回环（垂直面内圆）
    var circCx = exitP.clone().add(ax.clone().multiplyScalar(loopR * 1.05));
    var NLP = 9;
    for (var li = 0; li <= NLP; li++) {
      var aa = Math.PI / 2 - li / NLP * Math.PI * 2;
      var cp = circCx.clone()
        .add(side.clone().multiplyScalar(Math.cos(aa) * loopR))
        .add(new THREE.Vector3(0, Math.sin(aa) * loopR, 0));
      pts.push([cp.x, Math.max(st.baseY + 1.4, cp.y), cp.z]);
    }
    pts.push([entryBack.x, y0, entryBack.z]);
    var curve = makeCurve(pts, true);

    var g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 140, 0.14, 6, true),
      dis(mat(0x1d2430))));
    var neonMat = dis(mat(0x7ef3ff, { transparent: true, opacity: 0.85 }));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 140, 0.06, 6, true), neonMat));
    // 弹舱：壳+尾焰合并 1 Mesh + 透明顶棚单独 1 Mesh
    var podGrp = new THREE.Group();
    var ppb = new PartBuilder();
    ppb.box(0x232c44, [1.1, 0.62, 2.6], [0, 0, 0]);
    ppb.box(0xb06bff, [0.8, 0.3, 0.12], [0, 0.12, 1.36]);
    podGrp.add(new THREE.Mesh(ppb.merge(dis),
      dis(mat(0xffffff, { vertexColors: true }))));
    var canopy = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.5, 1.3),
      dis(mat(0x39d7ff, { transparent: true, opacity: 0.9 })));
    canopy.position.set(0, 0.5, 0.1);
    podGrp.add(canopy);
    root.add(podGrp);
    podGrp.rotation.order = 'YXZ';

    return {
      group: g, kind: 'tron', curve: curve, neonMat: neonMat,
      tick: function (now) {
        if (!reducedMotion) {
          var pulse = 0.55 + 0.45 * Math.sin(now * 9);
          this.neonMat.opacity = 0.55 + pulse * 0.45;
        } else this.neonMat.opacity = 0.8;
      },
      pod: podGrp,
      riderPose: function (now) {
        var T = st.periodS;
        var u = reducedMotion ? 0.12 : ((now - (st._t0 || now)) / T) % 1;
        if (u < 0) u += 1;
        var pu = u < 0.5 ? u * 1.6 : 0.8 + (u - 0.5) * 0.4;
        pu %= 1;
        curve.getPointAt(pu, tmpA);
        curve.getTangentAt(pu, tmpB);
        _pose.pos.set(tmpA.x, tmpA.y + 1.05, tmpA.z);
        _pose.yaw = Math.atan2(-tmpB.x, -tmpB.z);
        _pose.pitch = Math.asin(Math.max(-1, Math.min(1, tmpB.y))) * -1;
        _pose.fovOff = reducedMotion ? 0 : 8 + 3 * Math.sin(now * 9);
        return _pose;
      }
    };
  }

  // ---------- 音效推进（每次渲染帧） ----------
  function driveSounds(dt, nowSec, px, pz) {
    if (reducedMotion) return;
    var S = Voxel.Sound;
    if (!S || !S.rideClank || !active.boardPos) return;

    var piece = active.pieces.coaster;
    if (piece && active.boardPos.coaster) {
      var v = sndVol(px, pz, active.boardPos.coaster.x, active.boardPos.coaster.z, 60);
      if (v > 0) {
        var slope = piece.slope();
        if (slope > 0.22) {                          // 爬坡链条
          if (nowSec - snd.clankAt > 0.3) {
            snd.clankAt = nowSec;
            S.rideClank(v * Math.min(1, slope * 2.4));
          }
        } else if (slope < -0.42) {                  // 陡降风啸
          if (nowSec - snd.whooshAt > 0.34) {
            snd.whooshAt = nowSec;
            S.rideWhoosh(v * Math.min(1, -slope * 1.5));
          }
        }
      }
    }
    piece = active.pieces.tron;
    if (piece && active.boardPos.tron) {
      var vT = sndVol(px, pz, active.boardPos.tron.x, active.boardPos.tron.z, 46);
      if (vT > 0 && nowSec - snd.tWhooshAt > 0.52) {
        snd.tWhooshAt = nowSec;
        S.rideWhoosh(vT * 0.62);
      }
    }
    piece = active.pieces.drop;
    if (piece && active.boardPos.drop) {
      var vD = sndVol(px, pz, active.boardPos.drop.x, active.boardPos.drop.z, 80);
      if (vD > 0) {
        var u = piece.phase(nowSec);
        var pu = snd.prevDropU === undefined ? u : snd.prevDropU;
        if (pu < 0.615 && u >= 0.615) S.dropFallWhistle(vD);
        if (pu < 0.76 && u >= 0.76) S.dropThud(vD * 0.85);
        snd.prevDropU = u;
      } else snd.prevDropU = undefined;
    }
    piece = active.pieces.carousel;
    if (piece && active.boardPos.carousel) {
      var vC = sndVol(px, pz, active.boardPos.carousel.x, active.boardPos.carousel.z, 26);
      if (vC > 0 && nowSec - snd.noteAt > 0.5) {
        snd.noteAt = nowSec;
        S.carouselNote(snd.noteStep++, vC * 0.9);
      }
    }
    piece = active.pieces.ferris;
    if (piece && active.boardPos.ferris) {
      var vF = sndVol(px, pz, active.boardPos.ferris.x, active.boardPos.ferris.z, 54);
      if (vF > 0) {
        var q = piece.creakPhase(nowSec);
        if (snd.creakQ >= 0 && q !== snd.creakQ) S.ferrisCreak(vF);
        snd.creakQ = q;
      } else snd.creakQ = -1;
    }
    piece = active.pieces.pirate;
    if (piece && active.boardPos.pirate) {
      var vP = sndVol(px, pz, active.boardPos.pirate.x, active.boardPos.pirate.z, 60);
      var vel = piece.vel(nowSec);
      if (vP > 0 && vel > 0.62 && nowSec - (snd.pirWhooshAt || 0) > 0.45) {
        snd.pirWhooshAt = nowSec;
        S.rideWhoosh(vP * Math.min(1, vel * 0.7));
      }
    }
  }

  function buildPirate(st, dis, nowSec) {
    scratch();
    var g = new THREE.Group();
    g.position.set(st.cx + 0.5, st.baseY + 0.5, st.cz + 0.5);
    // 朝向：rot 奇偶决定摆动平面法线（与摩天轮同规则）
    var yaw0 = ((st.rotHint & 1) === 1) ? Math.PI / 2 : 0;
    g.rotation.y = yaw0;

    // 支架 + 轴：合并 1 Mesh（A 架双三角 + 顶轴）
    var H = st.axleY, Larm = st.R;
    var psb = new PartBuilder();
    // 前后两片 A 架（沿 z ±1.4）：腿斜率使顶点汇聚于 (0,H,±1.4)
    for (var fz = -1; fz <= 1; fz += 2) {
      var legLen = Math.sqrt(H * H + 6 * 6) + 1;
      psb.box(0x8a4a34, [0.7, legLen, 0.7], [-3, H / 2, fz * 1.4], [0, 0, -Math.atan2(6, H)]);
      psb.box(0x8a4a34, [0.7, legLen, 0.7], [3, H / 2, fz * 1.4], [0, 0, Math.atan2(6, H)]);
      psb.box(0x6e3a28, [7, 0.5, 0.6], [0, 0.4, fz * 1.4]);      // 底梁
      psb.box(0xdca843, [6.2, 0.4, 0.5], [0, H * 0.55, fz * 1.4]); // 金饰横撑
    }
    psb.cyl(0xc79a38, 0.45, 0.45, 3.6, 12, [0, H, 0], [Math.PI / 2, 0, 0]); // 轴
    g.add(new THREE.Mesh(psb.merge(dis), dis(mat(0xffffff, { vertexColors: true }))));

    // 摆臂 + 船体：合并 1 Mesh，挂在摆动组（枢轴=轴心）
    var swing = new THREE.Group();
    swing.position.set(0, H, 0);
    var psw = new PartBuilder();
    psw.box(0x5c4632, [0.5, Larm * 2 - 3, 0.5], [0, 0, 0]);       // 主吊臂
    psw.box(0xdca843, [1.6, 0.5, 0.8], [0, -Larm + 1.2, 0]);      // 船梁吊点
    // 船体（船头 -x）：底舱 + 两舷 + 船头艏柱 + 乘客排
    psw.box(0x7a4a2e, [7.4, 1.0, 2.4], [0, -Larm - 0.4, 0]);
    psw.box(0x8a5a38, [7.4, 0.5, 0.4], [0, -Larm + 0.15, 1.1]);
    psw.box(0x8a5a38, [7.4, 0.5, 0.4], [0, -Larm + 0.15, -1.1]);
    psw.box(0xdca843, [0.6, 1.6, 0.6], [-3.9, -Larm + 0.6, 0]);   // 艏柱
    psw.cone(0xd8574f, 0.5, 1.1, 4, [-3.9, -Larm + 1.7, 0], [0, Math.PI / 4, 0.9]);
    for (var row = -1; row <= 2; row++) {
      psw.box(0xe4797d, [0.7, 0.5, 2.0], [row * 1.8, -Larm + 0.55, 0]); // 座椅排
    }
    var swingMesh = new THREE.Mesh(psw.merge(dis),
      dis(mat(0xffffff, { vertexColors: true })));
    swing.add(swingMesh);
    g.add(swing);

    var AMP = 0.96; // 摆幅 55°
    return {
      group: g, kind: 'pirate',
      tick: function (now) {
        var omega = (Math.PI * 2) / st.periodS;
        var th = reducedMotion ? 0 : Math.sin(omega * (now - (st._t0 || now))) * AMP;
        swing.rotation.z = th;
        return th;
      },
      vel: function (now) {                       // 角速度（√ 比例用于音效/FOV）
        var omega = (Math.PI * 2) / st.periodS;
        return reducedMotion ? 0 :
          Math.abs(Math.cos(omega * (now - (st._t0 || now))) * AMP * omega);
      },
      riderPose: function (now) {
        var omega = (Math.PI * 2) / st.periodS;
        var th = reducedMotion ? 0 : Math.sin(omega * (now - (st._t0 || now))) * AMP;
        // 船中心 = 轴心 + R*[sinθ, -cosθ]（局部 x-y 平面），随 g 的 yaw0 旋转到世界
        scratch();
        _pose.pos.set(g.position.x + Math.sin(th) * Larm,
          g.position.y + H - Math.cos(th) * Larm + 0.4,
          g.position.z);
        _pose.pos.applyAxisAngle(_v1.set(0, 1, 0), yaw0);
        _pose.yaw = -th * 0.55;                   // 随摆轻甩头
        _pose.pitch = -th * 0.8;
        _pose.fovOff = reducedMotion ? 0 :
          Math.min(9, this.vel(now) * 16);
        return _pose;
      }
    };
  }

  // ---------- 城堡探照灯束（纯非体素，随 root 卸载） ----------
  function buildSearchlights(st, dis, nowSec) {
    var g = new THREE.Group();
    // 城堡尖塔顶（castle station: c=局部转全局, baseY=ah）
    g.position.set(st.c[0] + 0.5, st.baseY + 55, st.c[1] + 0.5);
    var beamMat = dis(mat(0xfff3c8, {
      transparent: true, opacity: 0.16, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending
    }));
    var beamLen = 64, beamRad = 9;
    for (var i = 0; i < 4; i++) {
      var holder = new THREE.Group();
      holder.rotation.y = i / 4 * Math.PI * 2;
      var cone = new THREE.Mesh(new THREE.ConeGeometry(beamRad, beamLen, 12, 1, true), beamMat);
      cone.rotation.z = Math.PI / 2 + 0.5;             // 外倾约 29°
      cone.position.set(beamLen / 2 + 2, 0, 0);
      holder.add(cone);
      g.add(holder);
    }
    // 尖顶信标光球（缓慢脉动）
    var beaconMat = dis(mat(0xffe08a, { transparent: true, opacity: 0.9 }));
    var beacon = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8), beaconMat);
    beacon.position.y = -1;
    g.add(beacon);

    return {
      group: g, kind: 'lights',
      tick: function (now) {
        if (!reducedMotion) g.rotation.y = now * 0.13;
        beacon.material.opacity = reducedMotion ? 0.85 :
          0.65 + 0.35 * Math.sin(now * 1.7);
        var bs = 1.2 + 0.35 * (reducedMotion ? 0 : Math.sin(now * 1.7));
        beacon.scale.set(bs, bs, bs);
      }
    };
  }

  // ---------- 夜间烟花（粒子迸裂，仅夜间/园区活跃时） ----------
  var FW = { bursts: [], nextAt: 0, launchAt: 0, pending: null, colors: [
    0xffd27a, 0xff8fb4, 0x8fe8ff, 0xc7a6ff, 0xa5f27a] };

  function spawnFirework(origin) {
    scratch();
    var n = 64;
    var pos = new Float32Array(n * 3);
    var vel = [];
    var color = FW.colors[(Math.random() * FW.colors.length) | 0];
    for (var i = 0; i < n; i++) {
      pos[i * 3] = origin.x; pos[i * 3 + 1] = origin.y; pos[i * 3 + 2] = origin.z;
      // 均匀球面方向 × 随机速率
      var th = Math.random() * Math.PI * 2;
      var ph = Math.acos(2 * Math.random() - 1);
      var sp = 7 + Math.random() * 5;
      vel.push(new THREE.Vector3(
        Math.sin(ph) * Math.cos(th) * sp,
        Math.cos(ph) * sp,
        Math.sin(ph) * Math.sin(th) * sp));
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var pmat = new THREE.PointsMaterial({
      color: color, size: 0.42, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true
    });
    var points = new THREE.Points(geo, pmat);
    points.frustumCulled = false;
    root.add(points);
    FW.bursts.push({ points: points, vel: vel, life: 0, ttl: 1.7,
      geo: geo, mat: pmat });
  }

  function updateFireworks(dt, nowSec, px, pz) {
    // 触发调度：夜间 + 园区活跃，间隔 90–150s；升空哨 → 0.9s 后爆裂
    var castlePiece = active.pieces.lights;
    if (castlePiece) {
      var S = Voxel.Sound;
      var night = Voxel.DayNight && Voxel.DayNight.isNight && Voxel.DayNight.isNight();
      if (!night) { FW.nextAt = nowSec + 45; FW.pending = null; }
      else if (!FW.pending && nowSec >= FW.nextAt) {
        scratch();
        _v3.copy(castlePiece.group.position);
        _v3.y += 6;
        _v3.x += (Math.random() - 0.5) * 24;
        _v3.z += (Math.random() - 0.5) * 24;
        FW.pending = { at: nowSec + 0.9, origin: _v3.clone() };
        FW.launchAt = nowSec;
        if (S && S.fireworkLaunch) {
          var d0 = Math.sqrt((_ppx - _v3.x) * (_ppx - _v3.x) + (_ppz - _v3.z) * (_ppz - _v3.z));
          S.fireworkLaunch(Math.max(0, 1 - d0 / 90));
        }
      } else if (FW.pending && nowSec >= FW.pending.at) {
        spawnFirework(FW.pending.origin);
        if (S && S.fireworkBoom) {
          var o = FW.pending.origin;
          var d1 = Math.sqrt((_ppx - o.x) * (_ppx - o.x) + (_ppz - o.z) * (_ppz - o.z));
          S.fireworkBoom(Math.max(0, 1 - d1 / 110));
        }
        FW.pending = null;
        FW.nextAt = nowSec + 90 + Math.random() * 60;
      }
    }
    // 活跃迸裂推进
    for (var i = FW.bursts.length - 1; i >= 0; i--) {
      var b = FW.bursts[i];
      b.life += dt;
      var arr = b.geo.attributes.position.array;
      for (var k = 0; k < b.vel.length; k++) {
        var vv = b.vel[k];
        vv.y -= 9.5 * dt;                      // 重力
        vv.multiplyScalar(1 - 1.4 * dt);       // 空气阻尼
        arr[k * 3] += vv.x * dt;
        arr[k * 3 + 1] += vv.y * dt;
        arr[k * 3 + 2] += vv.z * dt;
      }
      b.geo.attributes.position.needsUpdate = true;
      var k2 = Math.max(0, 1 - b.life / b.ttl);
      b.mat.opacity = k2;
      b.mat.size = 0.42 * (0.5 + 0.5 * k2);
      if (b.life >= b.ttl) {
        root.remove(b.points);
        b.geo.dispose(); b.mat.dispose();
        FW.bursts.splice(i, 1);
      }
    }
  }

  // ---------- 载入/卸载 ----------

  function disposeActive() {
    if (!active || !root) return;
    _lastDispose = { t: performance.now(), worldId: active.worldId,
      pending: _pendingWorldId,
      dx: Math.abs((_ppx ?? active.park.ax) - active.park.ax),
      dz: Math.abs((_ppz ?? active.park.az) - active.park.az) };
    root.parent && root.parent.remove(root);
    active.disposables.forEach(function (d) {
      try { d.obj.dispose && d.obj.dispose(); } catch (e) { /* 忽略重复释放 */ }
    });
    // 烟花迸裂对象不进 disposables（自带生命周期），这里显式清理
    FW.bursts.forEach(function (b) {
      try { b.geo.dispose(); b.mat.dispose(); } catch (e) { }
    });
    FW.bursts.length = 0;
    FW.pending = null;
    active = null;
  }
  var _lastDispose = null, _ppx = null, _ppz = null;

  // 自愈：任何原因导致 root 脱离场景后，下一帧重新挂回（组内件随根恢复）
  function ensureAttached() {
    if (root && sceneRef && root.parent !== sceneRef) sceneRef.add(root);
  }

  function spawnPark(park, worldId) {
    var stations = Voxel.Structures.parkStations(park);
    var dis = function (m) { active.disposables.push(m); return m; };
    stations.forEach(function (s) { s.rotHint = park.rot | 0; });
    // 音效/查询用的乘坐台坐标索引（kind -> {x,z}）
    var boardPos = {};
    stations.forEach(function (s) {
      if (s.board) boardPos[s.kind] = { x: s.board.x, z: s.board.z };
    });
    var pieces = {};
    stations.forEach(function (st) {
      var built = null;
      switch (st.kind) {
        case 'ferris': built = buildFerris(st, dis, performance.now() / 1000); break;
        case 'carousel': built = buildCarousel(st, dis, performance.now() / 1000); break;
        case 'drop': built = buildDrop(st, dis, performance.now() / 1000); break;
        case 'pirate': built = buildPirate(st, dis, performance.now() / 1000); break;
        case 'coaster': built = buildCoaster(st, dis, performance.now() / 1000); break;
        case 'tron': built = buildTron(st, dis, performance.now() / 1000); break;
        default: return;    // castle 体素主体为静态；动态部分单独建探照灯
      }
      pieces[st.kind] = built;
      if (built.group) root.add(built.group);
    });
    // 城堡探照灯束（挂在 castle 站点位形上）
    var castleSt = null;
    stations.forEach(function (s) { if (s.kind === 'castle') castleSt = s; });
    if (castleSt) {
      var lights = buildSearchlights(castleSt, dis, performance.now() / 1000);
      pieces.lights = lights;
      root.add(lights.group);
    }

    active.park = park;
    active.stations = stations;
    active.boardPos = boardPos;
    active.pieces = pieces;
    return active;
  }

  function findNearestPark(playerX, playerZ) {
    return Voxel.Structures.findParkNear(Math.floor(playerX), Math.floor(playerZ), 2);
  }

  // ---------- 公共 API ----------

  return {
    bind: function (opts) {
      if (opts && opts.scene && !sceneRef) {
        sceneRef = opts.scene;
        root = new THREE.Group();
        root.name = 'AmusementRoot';
        sceneRef.add(root);
      }
    },
    setReducedMotion: function (v) { reducedMotion = !!v; },
    notifyWorld: function (worldId) {
      if (active && active.worldId !== worldId) disposeActive();
      _pendingWorldId = worldId;
    },

    // 每渲染帧调用
    update: function (dt, nowSec, playerPos, worldId) {
      if (!root || !Voxel.Structures.enabled) return;
      ensureAttached();
      var px = playerPos ? playerPos.x : 1e9;
      var pz = playerPos ? playerPos.z : 1e9;
      _ppx = px < 1e8 ? px : null; _ppz = pz < 1e8 ? pz : null;
      if (worldId !== undefined) _pendingWorldId = worldId;

      // 世界切换或超距离：释放
      if (active && (active.worldId !== _pendingWorldId ||
        Math.abs(px - active.park.ax) > DESPAWN_R ||
        Math.abs(pz - active.park.az) > DESPAWN_R)) {
        disposeActive();
      }
      // 进入范围：生成（探针搜索较重，节流到约 0.7s 一次）
      if (!active && _pendingWorldId && Math.abs(px) < 1e8 && Math.abs(pz) < 1e8) {
        _searchCd -= dt;
        if (_searchCd <= 0) {
          _searchCd = 0.7;
          var parkFound = findNearestPark(px, pz);
          if (parkFound && Math.abs(px - parkFound.ax) < SPAWN_R &&
            Math.abs(pz - parkFound.az) < SPAWN_R) {
            active = { worldId: _pendingWorldId, park: parkFound, disposables: [], groups: [] };
            spawnPark(parkFound, _pendingWorldId);
            _searchCd = 0;
          }
        }
      }
      if (!active) return;
      // 动画推进
      for (var k in active.pieces) {
        var piece = active.pieces[k];
        if (piece.tick) piece.tick.call(piece, nowSec);
        if (piece.kind === 'coaster') {
          var poses = piece.trainPose(nowSec, _carPoses);
          for (var c = 0; c < piece.cars.length; c++) {
            piece.cars[c].position.copy(poses[c].pos);
            piece.cars[c].rotation.y = poses[c].yaw;
            piece.cars[c].rotation.x = poses[c].pitch;
          }
        }
        if (piece.kind === 'tron') {
          var rp = piece.riderPose(nowSec);
          piece.pod.position.copy(rp.pos);
          piece.pod.rotation.y = rp.yaw;
          piece.pod.rotation.x = rp.pitch;
        }
      }
      driveSounds(dt, nowSec, px, pz);
      updateFireworks(dt, nowSec, px, pz);
    },

    // 最近的乘坐台（供提示/上车判定）。radius 内返回。
    nearestBoard: function (playerPos, radius) {
      if (!active) return null;
      var best = null;
      var boards = Voxel.Structures.boardPositions(active.park);
      for (var i = 0; i < boards.length; i++) {
        var dx = boards[i].x + 0.5 - playerPos.x;
        var dy = boards[i].y + 1.0 - playerPos.y;
        var dz = boards[i].z + 0.5 - playerPos.z;
        var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < (radius || 5) && (!best || dist < best.dist))
          best = { kind: boards[i].kind, name: boards[i].name, dist: dist,
            x: boards[i].x, y: boards[i].y, z: boards[i].z };
      }
      return best;
    },

    // 开始乘坐：对齐该设施的运动相位（摩天轮从最低点起步等）
    beginRide: function (kind, nowSec) {
      if (!active) return false;
      var st = null, piece = active.pieces[kind];
      if (!piece) return false;
      active.stations.forEach(function (s) { if (s.kind === kind) st = s; });
      if (!st) return false;
      var t0 = nowSec;
      st._t0 = t0;
      if (piece.curve) {
        // 样条类把起点吸附到"乘车站台"附近：取最接近站台时相 u 并让 now 反推
        scratch();
        _v2.set(st.board.x + 0.5, st.board.y + (kind === 'coaster' ? 2.4 : 3.2), st.board.z + 0.5);
        var bestU = 0, bestD = Infinity;
        for (var ui = 0; ui < 64; ui++) {
          var uTest = ui / 64;
          piece.curve.getPointAt(uTest, tmpA);
          var d2 = tmpA.distanceToSquared(_v2);
          if (d2 < bestD) { bestD = d2; bestU = uTest; }
        }
        var T = st.periodS;
        st._t0 = nowSec - bestU * T;
      }
      _ridingKind = kind;
      return true;
    },

    endRide: function () { _ridingKind = null; },

    // 乘坐中每帧的眼睛位姿（pos/yaw/pitch + fovOff FOV 增量）
    riderState: function (nowSec) {
      if (!_ridingKind || !active || !active.pieces[_ridingKind]) return null;
      var pose = active.pieces[_ridingKind].riderPose.call(active.pieces[_ridingKind], nowSec);
      return pose;
    },

    ridingKind: function () { return _ridingKind; },
    // 测试钩子：强制下一帧放一发烟花（并立即进入夜间调度分支）
    _fwForce: function () { FW.nextAt = 0; FW.pending = null; },
    _debug: function () { return { lastDispose: _lastDispose,
      attached: root && root.parent === sceneRef,
      fwBursts: FW.bursts.length, fwPending: !!FW.pending }; },
    // 当前活跃园区中心（发现档案用；无园区返回 null）
    parkCenter: function () {
      if (!active) return null;
      return { x: active.park.ax, y: active.park.ah, z: active.park.az };
    },
    activeParkName: function () {
      if (!active) return null;
      var names = { 0: '东门', 1: '南门', 2: '西门', 3: '北门' };
      return '星海嘉年华 · ' + (names[active.park.rot & 3] || '');
    }
  };

  function curveDist2(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
  }

  // 共享临时量：_pose 由 riderState 返回后调用方必须立即拷贝消费（相机/代理均如此）
  var _pose = null;
  var tmpA = null, tmpB = null;
  var _carPoses = [];
  var _missingTmpWarned;

  function ensureShared() {
    if (_pose) return;
    _pose = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, fovOff: 0 };
    tmpA = new THREE.Vector3(); tmpB = new THREE.Vector3();
  }

  var _pendingWorldId = null;
  var _ridingKind = null;

  // 构建期就绪（builders 依赖 scratch/tmp）
  scratch(); ensureShared();
})();
