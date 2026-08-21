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
  var ent = { w: C.W, h: C.H, onGround: false, pos: null, vel: null };

  function update(dt) {
    var K = Voxel.Controls.keys;
    var f = (K['KeyW'] || K['ArrowUp'] ? 1 : 0) - (K['KeyS'] || K['ArrowDown'] ? 1 : 0);
    var s = (K['KeyD'] || K['ArrowRight'] ? 1 : 0) - (K['KeyA'] || K['ArrowLeft'] ? 1 : 0);
    var yaw = Voxel.Controls.yaw();
    var sin = Math.sin(yaw), cos = Math.cos(yaw);
    var dx = -sin * f + cos * s;
    var dz = -cos * f - sin * s;
    var len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0) { dx /= len; dz /= len; }

    var sprint = K['ShiftLeft'] || K['ShiftRight'];

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

    if (flying) {
      var vy = 0;
      if (K['Space']) vy += 1;
      if (sprint) vy -= 1;
      vel.y = vy * C.FLY;
    } else if (inWater) {
      vel.y -= C.SWIM_GRAVITY * dt;
      if (vel.y < -3) vel.y = -3;
      if (K['Space']) vel.y = C.SWIM_UP;
    } else {
      vel.y -= C.GRAVITY * dt;
      if (vel.y < C.MAX_FALL) vel.y = C.MAX_FALL;
      if (K['Space'] && onGround) { vel.y = C.JUMP; Voxel.Sound.jump(); }
    }

    ent.pos = pos;
    ent.vel = vel;
    ent.onGround = onGround;
    var wasOnGround = onGround, vyBefore = vel.y;
    Voxel.Physics.move(ent, dt);
    onGround = ent.onGround;

    // 落地声（随下落速度）
    if (onGround && !wasOnGround && vyBefore < -4)
      Voxel.Sound.land(Math.min(1, -vyBefore / 25));

    // 头部浸水：闷音 + 水下环境声
    Voxel.Sound.setUnderwater(
      Voxel.World.get(Math.floor(pos.x), Math.floor(pos.y + C.EYE), Math.floor(pos.z)) === 7
    );

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
      var wantFov = (sprint && moving && !flying && !inWater) ? 82 : 75;
      if (Math.abs(cam.fov - wantFov) > 0.05) {
        cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 8);
        cam.updateProjectionMatrix();
      }
    }
  }

  function init(p, yaw, pitch) {
    pos.copy(p);
    vel.set(0, 0, 0);
    spawn.copy(p);
    onGround = false;
    flying = false;
    hp = C.HP;
    prevInWater = false;
    Voxel.Sound.setUnderwater(false);
    if (yaw !== undefined) Voxel.Controls.setYaw(yaw);
    if (pitch !== undefined) Voxel.Controls.setPitch(pitch);
  }

  function initAtSpawn() {
    init(Voxel.World.spawnPoint());
  }

  function respawn() {
    var sp = (spawn.y > 1) ? spawn.clone() : Voxel.World.spawnPoint();
    pos.copy(sp);
    vel.set(0, 0, 0);
    hp = C.HP;
    Voxel.HUD.drawHealth(hp);
  }

  function damage(n) {
    if (hp <= 0) return;
    hp -= n;
    if (hp < 0) hp = 0;
    Voxel.Sound.hurt();
    Voxel.HUD.damageFlash();
    Voxel.HUD.drawHealth(hp);
    if (hp <= 0 && Voxel.Game) Voxel.Game.onPlayerDead();
  }

  function heal(n) {
    if (hp >= C.HP) return;
    hp = Math.min(C.HP, hp + n);
    Voxel.HUD.drawHealth(hp);
  }

  return {
    init: init,
    initAtSpawn: initAtSpawn,
    respawn: respawn,
    update: update,
    damage: damage,
    heal: heal,
    pos: function () { return pos; },
    eyePos: function () { return new THREE.Vector3(pos.x, pos.y + C.EYE, pos.z); },
    lookDir: function () {
      var p = Voxel.Controls.pitch(), y = Voxel.Controls.yaw();
      var cp = Math.cos(p);
      return new THREE.Vector3(-Math.sin(y) * cp, Math.sin(p), -Math.cos(y) * cp);
    },
    hp: function () { return hp; },
    setHp: function (v) { hp = v; },
    flying: function () { return flying; },
    setFlying: function (v) { flying = !!v; },
    onGround: function () { return onGround; },
    alive: function () { return hp > 0; }
  };
})();
