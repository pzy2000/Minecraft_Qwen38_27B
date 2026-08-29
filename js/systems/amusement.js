// 星海嘉年华 · 动态设施运行时：非体素 THREE 组件 + 时间驱动注册表。
// 与体素静态基底（structures.buildPark）共用 parkStations() 参数事实源，
// 保证轮心/轨道样条与静态支柱永远一致。
//
// 设计约束：
// - 纯视觉动画在渲染帧路径上用 now 秒直接驱动 transform（对齐空间站装饰环模式）；
// - 尊重 reducedMotion：暂停外观自转，仍保留位置与乘坐功能；
// - 距离预算：玩家 <130 格生成、>150 格释放；跨世界立即释放；
// - 不写入任何存档字段（未互动零开销）。
window.Voxel = window.Voxel || {};

Voxel.Amusement = (function () {
  'use strict';

  var CFG = Voxel.Config;
  var SPAWN_R = 130, DESPAWN_R = 155;

  var sceneRef = null;
  var root = null;
  var active = null;          // { worldId, park, stations, items:[{apply}], groups:[], disposables:[] }
  var reducedMotion = false;
  var _searchCd = 0;
  var reducedRef = null;

  function trackDisposables(list, obj, type) {
    list.push({ obj: obj, type: type });
    return obj;
  }

  function mat(color, opts) {
    opts = opts || {};
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      fog: true,
      transparent: !!opts.transparent,
      opacity: opts.opacity === undefined ? 1 : opts.opacity,
      depthWrite: opts.depthWrite === undefined ? true : !!opts.depthWrite,
      side: opts.side !== undefined ? opts.side : THREE.FrontSide
    });
  }

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

  // ---------- 设施构建 ----------

  function buildFerris(st, dis, nowSec) {
    var g = new THREE.Group();
    g.position.set(st.cx + 0.5, st.hubY + 0.5, st.cz + 0.5);
    // 轮平面法线：垂直于园区 rot 的水平朝向（rot=0/2 → 法线沿 x；rot=1/3 → 沿 z）
    var axleY = new THREE.Vector3(0, 1, 0);
    var horiz = ((st.rotHint & 1) === 1)
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(1, 0, 0);

    var wheel = new THREE.Group();
    // 双圈轮缘：亮金主圈 + 内衬暗圈
    var rimGeo = new THREE.TorusGeometry(st.R, 0.32, 10, 56);
    var rim = new THREE.Mesh(rimGeo, dis(mat(0xe8b64c)));
    rim.position.z = 1.15;
    wheel.add(rim);
    var rim2 = new THREE.Mesh(new THREE.TorusGeometry(st.R, 0.32, 10, 56), dis(mat(0xcf9a35)));
    rim2.position.z = -1.15;
    wheel.add(rim2);
    var rimIn = new THREE.Mesh(new THREE.TorusGeometry(st.R - 1.1, 0.14, 8, 48), dis(mat(0x9a7526)));
    wheel.add(rimIn);
    // 辐条 ×12：细长盒，两片前后错位
    var spokeMat = dis(mat(0xd8d2c4));
    for (var sIdx = 0; sIdx < 12; sIdx++) {
      var ang = sIdx / 12 * Math.PI * 2;
      for (var zz = -1; zz <= 1; zz += 2) {
        var sp = new THREE.Mesh(new THREE.BoxGeometry(0.22, st.R * 2 - 1.6, 0.22), spokeMat);
        sp.rotation.z = ang;
        sp.position.z = zz * 1.05;
        wheel.add(sp);
      }
      // 轮毂装饰节点
      var node = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 2.6), dis(mat(0xb98a2e)));
      node.position.set(Math.cos(ang) * (st.R - 1.1), Math.sin(ang) * (st.R - 1.1), 0);
      node.rotation.z = ang;
      wheel.add(node);
    }
    // 中轴轮毂
    var hubMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 3.4, 18), dis(mat(0xc79a38)));
    hubMesh.rotation.x = Math.PI / 2;
    wheel.add(hubMesh);
    wheel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1),
      new THREE.Vector3().crossVectors(horiz, axleY).normalize());
    g.add(wheel);

    // 座舱 ×N（不挂进轮组：保持竖直 + 微摆）
    var cabins = [];
    var CAB_COLORS = [0xd8574f, 0xf3b13e, 0x59a86b, 0x4f8fd0, 0xdf8fb4];
    for (var ci = 0; ci < st.cabins; ci++) {
      var cab = new THREE.Group();
      var col = CAB_COLORS[ci % CAB_COLORS.length];
      var body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.1, 1.7), dis(mat(col)));
      body.position.y = -1.5;
      cab.add(body);
      var roofTop = new THREE.Mesh(new THREE.ConeGeometry(1.75, 0.9, 4), dis(mat(0xefeadf)));
      roofTop.position.y = -0.25; roofTop.rotation.y = Math.PI / 4;
      cab.add(roofTop);
      var hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.2, 6), dis(mat(0x777268)));
      hanger.position.y = 0.45;
      cab.add(hanger);
      var winMat = dis(mat(0xbfe3ee, { transparent: true, opacity: 0.85 }));
      var glassF = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.8, 0.06), winMat);
      glassF.position.set(0, -1.55, 0.88);
      cab.add(glassF);
      var glassB = glassF.clone();
      glassB.position.z = -0.88;
      cab.add(glassB);
      cab.userData.cabColor = col;
      root.add(cab);
      cabins.push(cab);
    }

    // 外圈装饰灯珠（24 颗小球，夜间泛光主角）
    var bulbMat = dis(mat(0xffe08a));
    var bulbs = [];
    for (var bi = 0; bi < 24; bi++) {
      var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), bulbMat);
      bulb.userData.idx = bi;
      rim.add(bulb);
      bulbs.push(bulb);
    }

    return {
      group: g, kind: 'ferris',
      tick: function (now, riderPhase) {
        var omega = (Math.PI * 2) / st.periodS;
        var theta = reducedMotion ? 0 : omega * (now - (st._t0 || now)) ;
        wheel.rotation.z = theta;
        for (var i = 0; i < st.cabins; i++) {
          var a = theta + i / st.cabins * Math.PI * 2;
          var px = Math.cos(a) * st.R, py = Math.sin(a) * st.R;
          var wp = new THREE.Vector3(px, py, 0).applyQuaternion(wheel.quaternion);
          cabins[i].position.copy(g.position).add(wp);
          cabins[i].rotation.set(0, Math.atan2(horiz.x, -horiz.z || 0.0001) , 0);
          cabins[i].rotation.z = reducedMotion ? 0 : Math.sin(a) * 0.08;
        }
        // 灯珠呼吸
        var glowP = reducedMotion ? 0.5 : (0.65 + 0.35 * Math.sin(now * 2.2));
        bulbMat.opacity = 0.72 + 0.28 * glowP;
        bulbMat.transparent = true;
      },
      riderPose: function (now) {
        var omega = (Math.PI * 2) / st.periodS;
        var theta = reducedMotion ? -Math.PI / 2 : omega * (now - (st._t0 || now)) - Math.PI / 2;
        var a = theta;
        var wp = new THREE.Vector3(Math.cos(a) * st.R, Math.sin(a) * st.R, 0)
          .applyQuaternion(wheel.quaternion);
        var p = g.position.clone().add(wp);
        return { pos: p, yaw: Math.atan2(horiz.x, -horiz.z), pitch: 0 };
      }
    };
  }

  function buildCarousel(st, dis, nowSec) {
    var g = new THREE.Group();
    g.position.set(st.cx + 0.5, st.baseY + 0.5, st.cz + 0.5);
    var spin = new THREE.Group();
    g.add(spin);
    var HORSE_COLORS = [0xf0eee6, 0xd8574f, 0x4f8fd0, 0xf3b13e, 0x8e6cc0, 0x59a86b];
    var seats = [];
    var nHorse = 8;
    for (var i = 0; i < nHorse; i++) {
      var hg = new THREE.Group();
      var col = HORSE_COLORS[i % HORSE_COLORS.length];
      var body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.72, 0.62), dis(mat(col)));
      hg.add(body);
      var neck = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.66, 0.5), dis(mat(col)));
      neck.position.set(0.62, 0.5, 0); neck.rotation.z = -0.35;
      hg.add(neck);
      var head = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.4, 0.44), dis(mat(col)));
      head.position.set(0.95, 0.78, 0);
      hg.add(head);
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 5.4, 8), dis(mat(0xe8c34a)));
      hg.add(pole);
      var saddle = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.16, 0.5), dis(mat(0xe4797d)));
      saddle.position.y = 0.42;
      hg.add(saddle);
      spin.add(hg);
      seats.push(hg);
    }
    // 中央灯柱环绕（转盘顶缘小灯）
    var trim = new THREE.Mesh(new THREE.TorusGeometry(4.7, 0.09, 6, 40), dis(mat(0xffe08a)));
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 1.4;
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
      },
      riderPose: function (now) {
        var omega = (Math.PI * 2) / st.periodS;
        var theta = reducedMotion ? 0 : omega * (now - (st._t0 || now));
        var i = 0;
        var ha = theta + i / nHorse * Math.PI * 2;
        var p = new THREE.Vector3(g.position.x + Math.cos(ha) * 4.2,
          g.position.y + 1.6 + (reducedMotion ? 0 : Math.sin(now * 2.1) * 0.34) + 0.9,
          g.position.z + Math.sin(ha) * 4.2);
        var faceA = ha + Math.PI / 2;
        return { pos: p, yaw: -faceA, pitch: 0 };
      }
    };
  }

  function buildDrop(st, dis, nowSec) {
    var g = new THREE.Group();
    g.position.set(st.cx + 0.5, st.baseY + st.towerH + 1.5, st.cz + 0.5);
    var carriage = new THREE.Group();
    g.add(carriage);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.22, 8, 26), dis(mat(0xe8b64c)));
    ring.rotation.x = Math.PI / 2;
    carriage.add(ring);
    var POD_COLORS = [0xd8574f, 0xf3b13e, 0x59a86b, 0x4f8fd0, 0xdf8fb4, 0xefeadf, 0xd8574f, 0x4f8fd0];
    for (var i = 0; i < 8; i++) {
      var pod = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.8), dis(mat(POD_COLORS[i])));
      var pa = i / 8 * Math.PI * 2;
      pod.position.set(Math.cos(pa) * 2.1, -0.85, Math.sin(pa) * 2.1);
      carriage.add(pod);
      var bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.14), dis(mat(0x777268)));
      bar.position.set(Math.cos(pa) * 2.1, 0.3, Math.sin(pa) * 2.1);
      carriage.add(bar);
    }
    return {
      group: g, kind: 'drop',
      tick: function (now) {
        var u = ((now - (st._t0 || now)) / st.periodS) % 1;
        if (u < 0) u += 1;
        var frac = reducedMotion ? 0 : dropProfile(u);
        carriage.position.y = -(g.position.y - (st.baseY + 2.2)) * (1 - frac);
        carriage.rotation.y = reducedMotion ? 0 :
          Math.sin(u * Math.PI * 2 * (st.towerH / 22)) * 0.35;
      },
      riderPose: function (now) {
        var u = ((now - (st._t0 || now)) / st.periodS) % 1;
        if (u < 0) u += 1;
        var frac = reducedMotion ? 0 : dropProfile(u);
        var topY = st.baseY + st.towerH + 1.5;
        var y = st.baseY + 2.2 + (topY - st.baseY - 2.2) * frac;
        return {
          pos: new THREE.Vector3(st.cx + 0.5, y, st.cz + 0.5),
          yaw: 0, pitch: reducedMotion ? 0 : -(frac > 0.9 ? -0.5 : 0.25)
        };
      }
    };
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
    // 轨道可视化：细管沿样条（TubeGeometry 64 段足够顺滑）
    var tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 120, 0.16, 6, true), dis(mat(0x5a4632)));
    g.add(tube);
    var railTop = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 120, 0.1, 6, true), dis(mat(0xc9a04a)));
    railTop.scale.set(1, 1.18, 1);
    g.add(railTop);
    // 列车：头车 + 两节车厢
    var cars = [];
    var CAR_COLORS = [0xd8574f, 0xf3b13e, 0x59a86b];
    for (var i = 0; i < 3; i++) {
      var car = new THREE.Group();
      var body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 2.1), dis(mat(CAR_COLORS[i])));
      car.add(body);
      var nose = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.9, 4), dis(mat(0xefeadf)));
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, i === 0 ? 0.1 : 0.05, i === 0 ? -1.35 : 0);
      if (i > 0) nose.visible = false;
      car.add(nose);
      root.add(car);
      cars.push(car);
    }
    return {
      group: g, kind: 'coaster', curve: curve,
      tick: function (now) {},
      cars: cars,
      trainPose: function (now) {
        var T = st.periodS;
        var u0 = reducedMotion ? 0 : ((now - (st._t0 || now)) / T) % 1;
        if (u0 < 0) u0 += 1;
        var poses = [];
        for (var c = 0; c < cars.length; c++) {
          var uu = (u0 - c * 0.014 + 1) % 1;
          var pnt = curve.getPointAt(uu);
          var tan = curve.getTangentAt(uu);
          var yaw = Math.atan2(-tan.x, -tan.z);
          var pitch = Math.asin(Math.max(-1, Math.min(1, tan.y))) * -1;
          poses.push({ pos: pnt, yaw: yaw, pitch: pitch });
        }
        return poses;
      },
      riderPose: function (now) {
        var poses = this.trainPose(now);
        var lead = poses[0];
        return { pos: lead.pos.clone().add(new THREE.Vector3(0, 1.0, 0)), yaw: lead.yaw, pitch: lead.pitch };
      }
    };
  }

  function buildTron(st, dis, nowSec) {
    var ax = new THREE.Vector3(st.g1[0] - st.g0[0], 0, st.g1[1] - st.g0[1]).normalize();
    var side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), ax).normalize();
    var y0 = st.baseY + 2.2, loopR = (st.loopTopY - st.baseY) / 2 + 2;
    var exitP = new THREE.Vector3(st.g1[0] + 0.5, y0, st.g1[1] + 0.5);
    var entryBack = new THREE.Vector3(st.g0[0] + 0.5, y0, st.g0[1] + 0.5).sub(ax.clone().multiplyScalar(6));
    var pts = [
      [entryBack.x, entryBack.y - 1.2, entryBack.z],
      [entryBack.x + ax.x * 6, y0, entryBack.z + ax.z * 6],
      [st.g0[0] + 0.5, y0, st.g0[1] + 0.5]
    ];
    var Lg = Math.hypot(st.g1[0] - st.g0[0], st.g1[1] - st.g0[1]);
    for (var f = 0.25; f < 1; f += 0.25)
      pts.push([st.g0[0] + 0.5 + (st.g1[0] - st.g0[0]) * f, y0, st.g0[1] + 0.5 + (st.g1[1] - st.g0[1]) * f]);
    pts.push([st.g1[0] + 0.5, y0, st.g1[1] + 0.5]);
    // 出口高架直立回环（垂直面内圆）
    var circCx = exitP.clone().add(ax.clone().multiplyScalar(loopR * 1.05));
    var circCy = st.baseY + 2.2 + loopR;
    var NLP = 9;
    for (var li = 0; li <= NLP; li++) {
      var aa = Math.PI / 2 - li / NLP * Math.PI * 2;
      var cp = circCx.clone()
        .add(side.clone().multiplyScalar(Math.cos(aa) * loopR))
        .add(new THREE.Vector3(0, Math.sin(aa) * loopR, 0));
      pts.push([cp.x, Math.max(st.baseY + 1.4, cp.y), cp.z]);
    }
    // 回落到入口前的加速段
    pts.push([entryBack.x, y0, entryBack.z]);
    var curve = makeCurve(pts, true);

    var g = new THREE.Group();
    var tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 140, 0.14, 6, true), dis(mat(0x1d2430)));
    g.add(tube);
    var neon = new THREE.Mesh(new THREE.TubeGeometry(curve, 140, 0.06, 6, true),
      dis(mat(0x7ef3ff)));
    neon.material.transparent = true;
    g.add(neon);
    var podGrp = new THREE.Group();
    var podBody = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.62, 2.6), dis(mat(0x232c44)));
    podGrp.add(podBody);
    var canopy = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.5, 1.3), dis(mat(0x39d7ff)));
    canopy.position.set(0, 0.5, 0.1);
    canopy.material.transparent = true;
    podGrp.add(canopy);
    var tailGlow = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.12), dis(mat(0xb06bff)));
    tailGlow.position.set(0, 0.12, 1.36);
    podGrp.add(tailGlow);
    root.add(podGrp);

    return {
      group: g, kind: 'tron', curve: curve, neonMat: neon.material,
      tick: function (now) {
        // 霓虹管流光脉冲
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
        // 峰值速度集中在回环段：进度重映射 easeInOut 保底 20% 低速爬行
        var pu = u < 0.5 ? u * 1.6 : 0.8 + (u - 0.5) * 0.4;
        pu %= 1;
        var pnt = curve.getPointAt(pu);
        var tan = curve.getTangentAt(pu);
        var yaw = Math.atan2(-tan.x, -tan.z);
        var pitch = Math.asin(Math.max(-1, Math.min(1, tan.y))) * -1;
        return {
          pos: pnt.clone().add(new THREE.Vector3(0, 1.05, 0)),
          yaw: yaw, pitch: pitch
        };
      }
    };
  }

  // ---------- 载入/卸载 ----------

  function disposeActive() {
    if (!active || !root) return;
    root.parent && root.parent.remove(root);
    active.disposables.forEach(function (d) {
      try { d.obj.dispose && d.obj.dispose(); } catch (e) { /* 忽略重复释放 */ }
    });
    active = null;
  }

  function spawnPark(park, worldId) {
    var stations = Voxel.Structures.parkStations(park);
    var dis = function (m) { active.disposables.push(m); return m; };
    // rot 提示供摩天轮定向使用（wheel 平面必须垂直于园区的旋转朝向）
    stations.forEach(function (s) { s.rotHint = park.rot | 0; });
    var pieces = {};
    var items = [];
    stations.forEach(function (st) {
      var built = null;
      switch (st.kind) {
        case 'ferris': built = buildFerris(st, dis, performance.now() / 1000); break;
        case 'carousel': built = buildCarousel(st, dis, performance.now() / 1000); break;
        case 'drop': built = buildDrop(st, dis, performance.now() / 1000); break;
        case 'coaster': built = buildCoaster(st, dis, performance.now() / 1000); break;
        case 'tron': built = buildTron(st, dis, performance.now() / 1000); break;
        default: return;    // castle 为纯静态体素，无动态组件
      }
      pieces[st.kind] = built;
      if (built.group) root.add(built.group);
    });
    // 过山车车厢加到场景根
    if (pieces.coaster) pieces.coaster.cars.forEach(function (car) { root.add(car); });

    active.park = park;
    active.stations = stations;
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
      var px = playerPos ? playerPos.x : 1e9;
      var pz = playerPos ? playerPos.z : 1e9;
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
          var park = findNearestPark(px, pz);
          if (park && Math.abs(px - park.ax) < SPAWN_R && Math.abs(pz - park.az) < SPAWN_R) {
            active = { worldId: _pendingWorldId, park: park, disposables: [], groups: [] };
            spawnPark(park, _pendingWorldId);
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
          var poses = piece.trainPose(nowSec);
          for (var c = 0; c < piece.cars.length; c++) {
            var pc = poses[c].pos;
            piece.cars[c].position.copy(pc);
            piece.cars[c].rotation.order = 'YXZ';
            piece.cars[c].rotation.y = poses[c].yaw;
            piece.cars[c].rotation.x = poses[c].pitch;
          }
        }
        if (piece.kind === 'tron') {
          var rp = piece.riderPose(nowSec);
          piece.pod.position.copy(rp.pos);
          piece.pod.rotation.order = 'YXZ';
          piece.pod.rotation.y = rp.yaw;
          piece.pod.rotation.x = rp.pitch;
        }
      }
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
      if (kind === 'ferris' || kind === 'carousel' || kind === 'drop') st._t0 = t0;
      else st._t0 = t0;
      if (piece.curve) {
        // 样条类把起点吸附到"乘车站台"附近：取最接近站台时相 u 并让 now 反推
        var target = kind === 'coaster'
          ? new THREE.Vector3(st.board.x + 0.5, st.board.y + 1.6, st.board.z + 0.5)
          : new THREE.Vector3(st.board.x + 0.5, st.board.y + 2.2, st.board.z + 0.5);
        var bestU = 0, bestD = Infinity;
        for (var ui = 0; ui < 64; ui++) {
          var uTest = ui / 64;
          var d2 = curveDist2(piece.curve.getPointAt(uTest), target);
          if (d2 < bestD) { bestD = d2; bestU = uTest; }
        }
        var T = st.periodS;
        st._t0 = nowSec - bestU * T;
        if (kind === 'tron') {
          // tron 的 riderPose 内部另有进度映射，t0 直接偏移近似即可
          st._t0 = nowSec - bestU * T;
        }
      }
      _ridingKind = kind;
      return true;
    },

    endRide: function () { _ridingKind = null; },

    // 乘坐中每帧的眼睛位姿（含视线基向量）
    riderState: function (nowSec) {
      if (!_ridingKind || !active || !active.pieces[_ridingKind]) return null;
      var pose = active.pieces[_ridingKind].riderPose.call(active.pieces[_ridingKind], nowSec);
      return pose;
    },

    ridingKind: function () { return _ridingKind; },
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

  var _pendingWorldId = null;
  var _ridingKind = null;
})();
