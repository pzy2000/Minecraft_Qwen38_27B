// 召唤飞船（无人深空式）：放置预览选址 + 起飞/巡航/自动降落驾驶脑。
// 纯逻辑模块：不依赖 DOM、THREE 或具体世界实现；
// 物理推进与终点精确进场复用 Voxel.ShipFlight 与 Voxel.LandingAssist（由宿主注入）。
//
// 阶段流水线：
//   takeoff —— 纯升力离地；
//   climb   —— 纯升力爬升到规划巡航高度 planCruiseY()（沿途地表采样+余量）；
//   transit —— 跨图巡航：航向对准 + 距离-速度曲线收敛 + 定高；距目标近且
//              低速时移交 Voxel.LandingAssist 控制器（其自选着陆点以当前
//              位置为圆心螺旋搜索，此时圆心≈已验证目标点，必然优先命中）；
//   auto    —— 着陆辅助三阶段（刹车→进场→垂直下降），直到 landed 事件。
window.Voxel = window.Voxel || {};

Voxel.ShipSummon = (function () {
  'use strict';

  var VERSION = 1;
  var MAX_DT = 0.1;
  var TWO_PI = Math.PI * 2;

  var DEFAULTS = {
    // 预览选址
    aimRange: 96,            // 准星射线最大投射距离（格）
    searchRadius: 10,        // 射线命中点附近吸附搜索半径
    fallbackAhead: 10,       // 未命中地形时向前取点的距离
    // 自动驾驶
    approachSpeed: 24,       // 巡航段水平速度上限 (m/s)
    cruiseMargin: 20,        // 巡航高度 = 沿途最高地表 + 余量
    cruiseSampleStep: 24,    // 沿途地表采样间距
    cruiseMaxY: 230,         // 巡航高度硬上限
    targetApproach: 16,      // 巡航高度不得低于目标点上方该值
    handoffDist: 5,          // 移交着陆辅助的水平距离门槛
    handoffSpeed: 3,         // 移交时的水平速度门槛
    yawGain: 2.6,            // 巡航航向比例增益
    takeoffTimeout: 45,      // 起飞+爬升阶段总超时（秒）
    transitTimeout: 420,     // 巡航阶段总超时（秒）
    beginRetries: 120,       // 移交控制器的重试次数（约2秒@60Hz）
    stuckTime: 2,            // 爬升/巡航停滞判定时长（秒）
  };

  function finite(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function pos3(p) {
    return p && finite(p.x) && finite(p.y) && finite(p.z)
      ? { x: p.x, y: p.y, z: p.z } : null;
  }
  function wrapAngle(v) {
    v %= TWO_PI;
    if (v > Math.PI) v -= TWO_PI;
    if (v < -Math.PI) v += TWO_PI;
    return v;
  }

  function config(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var out = {};
    for (var key in DEFAULTS) {
      var v = raw[key];
      out[key] = finite(v) && v > 0 ? v : DEFAULTS[key];
    }
    return out;
  }

  // 机头朝向指定方向。飞船局部机鼻为 -Z；yaw 使得 forward=[-sin,-cos] 指向 (dx,dz)。
  function yawFacing(fromX, fromZ, toX, toZ) {
    return Math.atan2(-(toX - fromX), -(toZ - fromZ));
  }

  // ---- 放置预览选址 ----------------------------------------------------
  // hit 为准星射线命中点（可 null）；playerPos 用于朝向；worldApi 提供 surfaceAt。
  // 返回 { x,y,z,yaw,valid,hit }: valid=false 时坐标仍可用于红色幽灵展示。
  function aimSpot(worldApi, hit, playerPos, options) {
    if (!worldApi || typeof worldApi.surfaceAt !== 'function') return null;
    var player = pos3(playerPos);
    if (!player) return null;
    var o = config(options);
    var cx, cz;
    if (hit && finite(hit.x) && finite(hit.z)) {
      cx = hit.x; cz = hit.z;
    } else {
      // 无命中（准星朝天等）：向玩家移动方向前方投影一个默认点。
      cx = player.x; cz = player.z;
      if (finite(player.yaw)) {
        cx += -Math.sin(player.yaw) * o.fallbackAhead;
        cz += -Math.cos(player.yaw) * o.fallbackAhead;
      }
    }
    var yaw = yawFacing(cx, cz, player.x, player.z);
    var spot = null;
    if (typeof Voxel.LandingAssist !== 'undefined' && Voxel.LandingAssist &&
      typeof Voxel.LandingAssist.findLandingSpot === 'function') {
      spot = Voxel.LandingAssist.findLandingSpot(worldApi, cx, cz, yaw,
        { searchRadius: o.searchRadius });
    }
    var y;
    if (spot) {
      y = spot.y;
    } else {
      var surf = worldApi.surfaceAt(Math.floor(cx), Math.floor(cz));
      y = (finite(surf) && surf >= 0 ? surf : player.y - 1) + 1.02;
    }
    return { x: spot ? spot.x : cx, y: y, z: spot ? spot.z : cz,
      yaw: yaw, valid: !!spot, hit: !!hit };
  }

  // ---- 巡航高度规划 ----------------------------------------------------
  // 沿起点→目标直线采样地表，取沿途最高固体面 + 余量；同时不高于上限、
  // 不低于目标点上空的进场余量。地表不可知时退回目标点相对高度。
  function planCruiseY(surfaceAt, from, to, options) {
    var f = pos3({ x: from.x, y: 0, z: from.z });
    var t = pos3({ x: to.x, y: finite(to.y) ? to.y : 0, z: to.z });
    if (!f || !t || typeof surfaceAt !== 'function') return null;
    var o = config(options);
    var dx = t.x - f.x, dz = t.z - f.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    var steps = clamp(Math.ceil(dist / o.cruiseSampleStep), 3, 64);
    var maxSurf = -Infinity;
    for (var i = 0; i <= steps; i++) {
      var k = i / steps;
      var sx = Math.round(f.x + dx * k), sz = Math.round(f.z + dz * k);
      var s = surfaceAt(sx, sz);
      if (finite(s) && s >= 0) maxSurf = Math.max(maxSurf, s);
    }
    var cruise = maxSurf > -Infinity ? maxSurf + o.cruiseMargin
      : t.y + o.targetApproach;
    cruise = Math.max(cruise, t.y + o.targetApproach);
    return clamp(cruise, 1, o.cruiseMaxY);
  }

  // ---- 召唤驾驶脑 ------------------------------------------------------
  // deps:
  //   step(input, dt) -> events[]           实际推进物理并返回事件（宿主实现）
  //   getPos() -> [x,y,z]                   当前飞船位置
  //   getVel() -> [x,y,z]                   当前飞船速度
  //   getYaw() -> number                    当前机头航向
  //   ctrl.begin() -> truthy|falsy          移交着陆辅助控制器。宿主实现应
  //                 以「确认目标点」替换 state.position 构造只读视图传入
  //                 begin()，使控制器的螺旋搜索圆心恰为已验证着陆点；
  //                 tick() 仍传真实 flightState。
  //   ctrl.tick(dt) -> {input,distance,active,expired,blocked}
  //   ctrl.cancel(reason)
  //   target:{x,z}                          已确认的着陆点（水平）
  //   cruiseY                               规划巡航绝对高度
  //   conf.*                                覆盖 DEFAULTS 子集
  //
  // pilot.tick(dt) -> {active, phase, distance, done}
  //   done ∈ null | 'completed'|'cancelled'|'expired'|'blocked'|'stuck'|'nospot'
  function createPilot(deps) {
    if (!deps || !deps.target || !finite(deps.target.x) || !finite(deps.target.z)) return null;
    var conf = config(Object.assign({}, DEFAULTS, deps.conf || {}));
    var cruiseY = finite(deps.cruiseY) ? deps.cruiseY :
      (deps.getPos ? (deps.getPos()[1] || 2) + 10 : 30);
    var phase = 'takeoff', done = null;
    var dist = null, elapsed = 0, phaseElapsed = 0, beginTries = 0;
    var lastDist = null, stallT = 0;
    // 弧线脱困机动：爬升/巡航被实体方块（树干、岩柱、建筑）顶住时，
    // 纯"再爬升"永远无效——改输出「升力+推进+转向」画弧横移脱离遮挡柱；
    // 连续多轮无起色才放弃（blocked）。
    var escT = 0, escCycles = 0;

    function finish(kind) {
      if (done) return false;
      done = String(kind || 'cancelled');
      phase = 'idle';
      if (deps.ctrl && typeof deps.ctrl.cancel === 'function')
        try { deps.ctrl.cancel(done); } catch (e) { /* 宿主兜底 */ }
      return true;
    }

    function status() {
      return { active: !done, phase: phase, distance: dist, done: done };
    }

    function hspeed(vx, vz) { return Math.sqrt(vx * vx + vz * vz); }

    // 脱困机动输出：每轮固定舵角弧线（升力拉满避免贴地刮擦）。
    function escapeInput(dt) {
      escT -= dt;
      if (escT <= 0) { // 本轮结束：复位滑窗，交给调用方重新评估
        escCycles++;
        stallT = 0;
      }
      return { lift: 1, thrust: true, steerYaw: 0.55 };
    }

    // 上升停滞检测：有升力指令但绝对高度滑窗内无 ≥0.5m 进展即触发脱困；
    // 超过 maxCycles 仍无起色 → blocked。
    var riseBestY = -Infinity, riseT = 0;
    function riseStuck(dt, py, climbing) {
      if (escT > 0 || !climbing) return false;
      if (py > riseBestY + 0.5) {
        riseBestY = py;
        riseT = 0;
        return false;
      }
      riseT += dt;
      if (riseT >= conf.stuckTime) {
        riseT = 0;
        if (escCycles >= 5) { finish('blocked'); return true; }
        escT = 3;
      }
      return false;
    }

    // 巡航单步控制输入：航向比例舵 + 距离-速度曲线推进 + 巡航高度保持。
    // 移动受阻时两段式脱困（先爬升越过障碍，仍无进展则视为 blocked——
    // 巡航高度按沿途采样规划过，持续受阻属于罕见异常，不值得无限重试）。
    function cruiseInput(dt, px, py, pz, vx, vz) {
      var ddx = deps.target.x - px, ddz = deps.target.z - pz;
      var d = Math.sqrt(ddx * ddx + ddz * ddz);
      dist = d;
      var err = wrapAngle(Math.atan2(-ddx, -ddz) -
        (typeof deps.getYaw === 'function' ? deps.getYaw() : 0));
      var speed = hspeed(vx, vz);
      var input = { steerYaw: clamp(err * conf.yawGain, -1, 1),
        lift: py < cruiseY - 0.5 ? 1 : (py > cruiseY + 0.5 ? -1 : 0) };

      if (escT > 0) return escapeInput(dt); // 脱困弧线机动：升力+推进+定舵转向
      var stopDist = Math.max(d - conf.handoffDist, 0);
      var allowedV = Math.min(conf.approachSpeed,
        Math.sqrt(2 * 18 * stopDist), d * 1.5);
      if (d <= conf.handoffDist + 2) {
        // 移交前刹停：空气段没有地面摩擦，不主动收油会带着余速冲过
        // 目标点来回振荡。刹到低速即满足移交门槛。
        input.thrust = false;
        if (speed > conf.handoffSpeed * 0.9) input.brake = true;
      } else if (speed < allowedV - 0.3) input.thrust = true;
      else if (speed > allowedV + 0.5) input.brake = true;

      // 停滞守卫：明确给了推进但距离未有效闭合时计时 → 弧线脱困；
      // 连续多轮无起色则放弃（blocked）。
      if (input.thrust === true && lastDist !== null &&
        lastDist - d < Math.max(speed * dt * 0.35, 0.002)) {
        stallT += dt;
        if (stallT >= conf.stuckTime) {
          stallT = 0;
          lastDist = null;
          if (escCycles >= 5) { finish('blocked'); }
          else escT = 3;
        }
      } else if (input.thrust !== true) stallT = 0;
      lastDist = input.thrust === true ? d : null;
      return input;
    }

    return {
      active: function () { return !done; },
      getPhase: function () { return phase; },
      result: function () { return done; },
      cancel: function (reason) { return finish(reason || 'cancelled'); },
      tick: function (dt) {
        if (done) return status();
        if (!finite(dt) || dt <= 0) return status();
        dt = Math.min(dt, MAX_DT);

        var p = typeof deps.getPos === 'function' ? deps.getPos() : null;
        if (!p || !p.every(finite)) { finish('stuck'); return status(); }
        elapsed += dt; phaseElapsed += dt;

        // 超时守卫按阶段独立计：起飞/爬升与巡航各有限额；auto 阶段的
        // 时长由控制器 maxDuration 兜底（远距召唤航程可达数分钟）。
        if ((phase === 'takeoff' || phase === 'climb') &&
          phaseElapsed > conf.takeoffTimeout) { finish('stuck'); return status(); }
        if (phase === 'transit' && phaseElapsed > conf.transitTimeout) {
          finish('stuck'); return status();
        }

        if (phase === 'takeoff') {
          // 纯升力离地：不带油门/刹车，残留速度由物理层向零收敛，
          // 避免爬升段出现反向漂移。
          var ev = deps.step({ lift: 1 }, dt);
          if (ev && ev.indexOf('takeoff') >= 0) { phase = 'climb'; phaseElapsed = 0; }
          return status();
        }

        if (phase === 'climb') {
          var climbing = p[1] < cruiseY - 0.5;
          if (escT > 0) deps.step(escapeInput(dt), dt);
          else {
            deps.step({ lift: climbing ? 1 : 0 }, dt);
            // 爬升被实体方块顶住时输出弧线机动横移脱离遮挡柱。
            if (climbing && riseStuck(dt, p[1], true)) return status();
          }
          if (done) return status();
          if (p[1] > cruiseY - 0.6 && escT <= 0) { phase = 'transit'; phaseElapsed = 0; lastDist = null; }
          return status();
        }

        if (phase === 'transit') {
          var vel = typeof deps.getVel === 'function' ? (deps.getVel() || [0, 0, 0]) : [0, 0, 0];
          var inp = cruiseInput(dt, p[0], p[1], p[2], vel[0], vel[2]);
          deps.step(inp, dt);
          if (done) return status();
          // 脱困期间距离可能不收敛，跳过移交判定（escT 由 cruiseInput 递减）。
          if (escT <= 0) {
            var dxT = deps.target.x - p[0], dzT = deps.target.z - p[2];
            if (dxT * dxT + dzT * dzT <= conf.handoffDist * conf.handoffDist &&
              hspeed(vel[0], vel[2]) <= conf.handoffSpeed) {
              var okBegin = false;
              try { okBegin = !!deps.ctrl.begin(); } catch (e) { okBegin = false; }
              if (okBegin) { phase = 'auto'; phaseElapsed = 0; }
              else if (++beginTries > conf.beginRetries) finish('nospot');
            }
          }
          return status();
        }

        // auto：完全交由着陆辅助控制器驱动（刹车→进场→垂直下降）。
        var r = null;
        try { r = deps.ctrl.tick(dt); } catch (e) { r = null; }
        if (!r || typeof r !== 'object') { finish('stuck'); return status(); }
        if (finite(r.distance)) dist = r.distance;
        if (!r.active) {
          finish(r.expired ? 'expired' : 'blocked');
          return status();
        }
        var ev2 = deps.step(r.input, dt);
        if (ev2 && ev2.indexOf('landed') >= 0) finish('completed');
        return status();
      }
    };
  }

  return {
    VERSION: VERSION,
    DEFAULTS: Object.freeze(Object.assign({}, DEFAULTS)),
    PHASES: Object.freeze({
      TAKEOFF: 'takeoff', CLIMB: 'climb', TRANSIT: 'transit', AUTO: 'auto', IDLE: 'idle'
    }),
    config: config,
    aimSpot: aimSpot,
    planCruiseY: planCruiseY,
    yawFacing: yawFacing,
    createPilot: createPilot
  };
})();
