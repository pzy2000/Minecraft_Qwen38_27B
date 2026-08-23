// 玩家：移动、重力、游泳、飞行
window.Voxel = window.Voxel || {};

Voxel.Player = (function () {
  var C = Voxel.Config.PLAYER;
  var pos = new THREE.Vector3();
  var vel = new THREE.Vector3();
  var spawn = new THREE.Vector3();
  var onGround = false, flying = false, inWater = false;
  var hp = C.HP;
  var stepTimer = 0;
  var prevInWater = false, bubbleTimer = 0;
  var air = C.AIR_MAX, drownT = 0;   // 憋气
  var bedPos = null;                 // 床重生点
  var kbx = 0, kbz = 0, kbT = 0;     // 受击击退
  var lastCause = '';                // 最近一次受伤原因
  var headInWater = false;           // 头部浸水（水下滤镜/雾用）
  var food = C.FOOD_MAX;             // 饥饿值
  var exhaust = 0, starveT = 0;      // 疲惫累积 / 饥饿扣血计时
  var ent = { w: C.W, h: C.H, onGround: false, pos: null, vel: null };

  function update(dt) {
    var K = Voxel.Controls.keys;
    var f = (K['KeyW'] || K['ArrowUp'] ? 1 : 0) - (K['KeyS'] || K['ArrowDown'] ? 1 : 0);
    var s = (K['KeyD'] || K['ArrowRight'] ? 1 : 0) - (K['KeyA'] || K['ArrowLeft'] ? 1 : 0);

    // 触摸摇杆：屏幕系向量并入前后/左右轴（保留模拟量，小幅推动=慢走）
    var tSprint = false;
    if (Voxel.Touch && Voxel.Touch.active && Voxel.Touch.active()) {
      var mv = Voxel.Touch.moveVec();
      f += -mv.y;
      s += mv.x;
      tSprint = Voxel.Touch.sprint();
    }

    var yaw = Voxel.Controls.yaw();
    var sin = Math.sin(yaw), cos = Math.cos(yaw);
    var dx = -sin * f + cos * s;
    var dz = -cos * f - sin * s;
    var len = Math.sqrt(dx * dx + dz * dz);
    // 超过 1 归一（键盘全速）；摇杆小幅推动保留模拟量实现慢走
    if (len > 1) { dx /= len; dz /= len; }

    var descend = K['ShiftLeft'] || K['ShiftRight'];
    var sprint = descend || tSprint;

    inWater =
      Voxel.World.get(Math.floor(pos.x), Math.floor(pos.y + 0.4), Math.floor(pos.z)) === 7 ||
      Voxel.World.get(Math.floor(pos.x), Math.floor(pos.y + 1.4), Math.floor(pos.z)) === 7;

    // 入水/出水溅水
    if (inWater && !prevInWater) {
      Voxel.Sound.splash(vel.y < -1.5 ? 0.4 + Math.min(0.6, -vel.y / 12) : 0.12);
    } else if (!inWater && prevInWater) {
      Voxel.Sound.splash(0.1);
    }
    prevInWater = inWater;

    var speed;
    if (flying) speed = sprint ? C.FLY_FAST : C.FLY;
    else if (inWater) speed = C.WALK * 0.55;
    else speed = sprint ? C.SPRINT : C.WALK;

    vel.x = dx * speed;
    vel.z = dz * speed;

    // 受击击退：短时间叠加外力并衰减
    if (kbT > 0) {
      kbT -= dt;
      var k = Math.max(0, kbT / 0.4);
      vel.x += kbx * k;
      vel.z += kbz * k;
      if (kbT <= 0) { kbx = 0; kbz = 0; }
    }

    if (flying) {
      var vy = 0;
      if (K['Space']) vy += 1;
      // 触控摇杆外圈只控制水平快速飞行；下降必须来自独立的 Shift/“降”按钮。
      if (descend) vy -= 1;
      vel.y = vy * C.FLY;
    } else if (inWater) {
      vel.y -= C.SWIM_GRAVITY * dt;
      if (vel.y < -3) vel.y = -3;
      if (K['Space']) { vel.y = C.SWIM_UP; addExhaust(C.EXHAUST_JUMP * 0.5); }
    } else {
      vel.y -= C.GRAVITY * dt;
      if (vel.y < C.MAX_FALL) vel.y = C.MAX_FALL;
      if (K['Space'] && onGround) { vel.y = C.JUMP; Voxel.Sound.jump(); addExhaust(C.EXHAUST_JUMP); }
    }

    ent.pos = pos;
    ent.vel = vel;
    ent.onGround = onGround;
    var wasOnGround = onGround, vyBefore = vel.y;
    Voxel.Physics.move(ent, dt);
    onGround = ent.onGround;

    // 落地声 + 摔落伤害（随下落速度）
    if (onGround && !wasOnGround && vyBefore < -4) {
      Voxel.Sound.land(Math.min(1, -vyBefore / 25));
      if (!flying && !inWater && vyBefore < -C.FALL_SAFE) {
        damage(Math.round((-vyBefore - C.FALL_SAFE) * C.FALL_DMG), 'fall');
      }
    }

    // 头部浸水：闷音 + 水下环境声 + 憋气/溺水
    var headIn = Voxel.World.get(Math.floor(pos.x), Math.floor(pos.y + C.EYE), Math.floor(pos.z)) === 7;
    headInWater = headIn;
    Voxel.Sound.setUnderwater(headIn);
    if (headIn) {
      air -= dt;
      if (air <= 0) {
        air = 0;
        drownT += dt;
        if (drownT >= 1 && hp > 0) { drownT = 0; damage(C.DROWN_DMG, 'drown'); }
      }
    } else {
      air = Math.min(C.AIR_MAX, air + dt * 2.5);
      drownT = 0;
    }
    if (Voxel.HUD && Voxel.HUD.drawAir)
      Voxel.HUD.drawAir(headIn || air < C.AIR_MAX ? air / C.AIR_MAX : 1);

    // 游泳气泡
    if (inWater) {
      if (Math.abs(vel.x) + Math.abs(vel.z) > 1 || K['Space']) {
        bubbleTimer -= dt;
        if (bubbleTimer <= 0) {
          bubbleTimer = 0.35 + Math.random() * 0.55;
          Voxel.Sound.bubble();
        }
      }
    } else bubbleTimer = 0;

    // 饥饿：按活动强度累积疲惫 → 消耗饥饿值；饥饿 0 时缓慢扣血（降到 1 为止）
    var movingNow = (vel.x * vel.x + vel.z * vel.z) > 0.5 && !flying;
    var rate = C.RATE_STILL;
    if (movingNow) rate = sprint ? C.RATE_SPRINT : C.RATE_MOVE;
    if (inWater) rate = Math.max(rate, C.RATE_SWIM);
    addExhaust(rate * dt);
    while (exhaust >= C.EXHAUST_PER_FOOD && food > 0) {
      exhaust -= C.EXHAUST_PER_FOOD;
      food--;
    }
    if (food <= 0 && hp > 1) {
      starveT += dt;
      if (starveT >= C.STARVE_INTERVAL) { starveT = 0; damage(C.STARVE_DMG, 'starve'); }
    } else starveT = 0;
    if (Voxel.HUD && Voxel.HUD.drawFood) Voxel.HUD.drawFood(food);

    // 脚步声（按脚下材质）
    var moving = (vel.x * vel.x + vel.z * vel.z) > 4;
    if (onGround && moving && !flying) {
      stepTimer -= dt * (sprint ? 1.5 : 1);
      if (stepTimer <= 0) {
        stepTimer = 0.42;
        var belowId = Voxel.World.get(Math.floor(pos.x), Math.floor(pos.y - 0.05), Math.floor(pos.z));
        var bdef = Voxel.Blocks.defs[belowId];
        Voxel.Sound.step(bdef && bdef.sound ? bdef.sound : 'stone');
      }
    } else stepTimer = 0;

    // 相机
    var cam = Voxel.Game.camera;
    if (cam) {
      cam.position.set(pos.x, pos.y + C.EYE, pos.z);
      cam.rotation.x = Voxel.Controls.pitch();
      cam.rotation.y = yaw;
      var baseFov = (Voxel.Settings ? Voxel.Settings.get('fov') : 75) || 75;
      var wantFov = (sprint && moving && !flying && !inWater) ? baseFov + 7 : baseFov;
      if (Math.abs(cam.fov - wantFov) > 0.05) {
        cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 8);
        cam.updateProjectionMatrix();
      }
    }
  }

  function init(p, yaw, pitch) {
    pos.copy(p);
    vel.set(0, 0, 0);
    onGround = false;
    flying = false;
    hp = C.HP;
    prevInWater = false;
    air = C.AIR_MAX;
    drownT = 0;
    food = C.FOOD_MAX;
    exhaust = 0;
    starveT = 0;
    Voxel.Sound.setUnderwater(false);
    if (yaw !== undefined) Voxel.Controls.setYaw(yaw);
    if (pitch !== undefined) Voxel.Controls.setPitch(pitch);
  }

  function setSpawn(v) {
    if (!v || !isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z)) return false;
    spawn.copy(v);
    return true;
  }

  function initAtSpawn() {
    var sp = Voxel.World.spawnPoint();
    setSpawn(sp);
    init(sp);
  }

  // 床重生点：优先在床上重生（床被挖掉则回世界出生点）
  function setBed(v) { bedPos = v || null; }
  function getBed() { return bedPos; }

  function canRespawnAt(v) {
    return !!v && isFinite(v.x) && isFinite(v.y) && isFinite(v.z) && v.y > 1 &&
      !Voxel.Physics.aabbCollides(v.x, v.y, v.z, C.W, C.H) &&
      Voxel.Physics.hasFloor(v.x, v.y, v.z, C.W);
  }

  function respawn() {
    var sp = null;
    // bedPos 保存的是床上方站立点，因此床块位于其正下方一格。
    if (canRespawnAt(bedPos) &&
      Voxel.World.get(Math.floor(bedPos.x), Math.floor(bedPos.y) - 1, Math.floor(bedPos.z)) === 17) {
      sp = bedPos.clone();
    } else {
      // 床被挖掉或上方受阻时清除失效重生点，回到当前世界的固定出生点。
      bedPos = null;
      if (canRespawnAt(spawn)) sp = spawn.clone();
      else {
        sp = Voxel.World.spawnPoint();
        setSpawn(sp);
      }
    }
    pos.copy(sp);
    vel.set(0, 0, 0);
    onGround = false;
    inWater = false;
    prevInWater = false;
    headInWater = false;
    hp = C.HP;
    air = C.AIR_MAX;
    drownT = 0;
    food = C.FOOD_MAX;
    exhaust = 0;
    starveT = 0;
    flying = false;
    kbx = 0; kbz = 0; kbT = 0;
    lastCause = '';
    Voxel.Sound.setUnderwater(false);
    Voxel.HUD.drawHealth(hp);
    if (Voxel.HUD.drawAir) Voxel.HUD.drawAir(1);
    if (Voxel.HUD.drawFood) Voxel.HUD.drawFood(food);
    return sp.clone();
  }

  function damage(n, cause, sx, sz) {
    if (hp <= 0) return;
    hp -= n;
    if (hp < 0) hp = 0;
    lastCause = cause || 'generic';
    Voxel.Sound.hurt();
    Voxel.HUD.damageFlash();
    // 受击方向指示（屏幕箭头指向伤害来源）
    if (sx !== undefined && sz !== undefined && Voxel.HUD.damageDir) {
      var a = Math.atan2(-(sx - pos.x), -(sz - pos.z));
      Voxel.HUD.damageDir(a - Voxel.Controls.yaw());
    }
    Voxel.HUD.drawHealth(hp);
    if (hp <= 0 && Voxel.Game) Voxel.Game.onPlayerDead();
  }

  // 外部击退冲量（方向单位向量 × 强度）
  function knockback(dx, dz, power) {
    var len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.001) return;
    kbx = dx / len * power;
    kbz = dz / len * power;
    kbT = 0.4;
    if (onGround) vel.y = Math.max(vel.y, 3.5); // 轻微挑空
  }

  function heal(n) {
    if (hp >= C.HP) return;
    hp = Math.min(C.HP, hp + n);
    Voxel.HUD.drawHealth(hp);
  }

  // ---- 饥饿 ----
  function addExhaust(x) { exhaust += x; }
  function eat(n) {
    var before = food;
    food = Math.min(C.FOOD_MAX, food + n);
    return food - before;   // 实际吃下的饥饿值
  }
  function setFood(v) {
    food = Math.max(0, Math.min(C.FOOD_MAX, v));
    exhaust = Math.min(exhaust, C.EXHAUST_PER_FOOD);
    if (Voxel.HUD && Voxel.HUD.drawFood) Voxel.HUD.drawFood(food);
  }

  return {
    init: init,
    initAtSpawn: initAtSpawn,
    setSpawn: setSpawn,
    getSpawn: function () { return spawn.clone(); },
    respawn: respawn,
    update: update,
    damage: damage,
    knockback: knockback,
    lastDamageCause: function () { return lastCause; },
    heal: heal,
    setBed: setBed,
    getBed: getBed,
    air: function () { return air; },
    pos: function () { return pos; },
    vel: function () { return vel; },
    eyePos: function () { return new THREE.Vector3(pos.x, pos.y + C.EYE, pos.z); },
    lookDir: function () {
      var p = Voxel.Controls.pitch(), y = Voxel.Controls.yaw();
      var cp = Math.cos(p);
      return new THREE.Vector3(-Math.sin(y) * cp, Math.sin(p), -Math.cos(y) * cp);
    },
    hp: function () { return hp; },
    setHp: function (v) { hp = v; },
    headIn: function () { return headInWater; },
    food: function () { return food; },
    setFood: setFood,
    eat: eat,
    addExhaust: addExhaust,
    flying: function () { return flying; },
    setFlying: function (v) { flying = !!v; },
    onGround: function () { return onGround; },
    alive: function () { return hp > 0; }
  };
})();
