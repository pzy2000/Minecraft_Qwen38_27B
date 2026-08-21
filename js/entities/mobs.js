// 生物：羊（游走）+ 僵尸（夜晚追击）
window.Voxel = window.Voxel || {};

Voxel.Mobs = (function () {
  var C = Voxel.Config.MOB;
  var P = Voxel.Config.PLAYER;
  var W = Voxel.Config.WORLD_W, D = Voxel.Config.WORLD_D, H = Voxel.Config.WORLD_H;
  var list = [];
  var group = null;
  var spawnTimer = 1;

  function box(w, h, d, mat, x, y, z) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  }

  function makeSheep() {
    var g = new THREE.Group();
    var wool = [0xffffff, 0xb0b0b0, 0x5a5a5a, 0x9a7248][(Math.random() * 4) | 0];
    var mWool = new THREE.MeshBasicMaterial({ color: wool });
    var mSkin = new THREE.MeshBasicMaterial({ color: 0xe8c8a8 });
    g.add(box(0.8, 0.55, 1.1, mWool, 0, 0.62, -0.05));
    g.add(box(0.45, 0.42, 0.45, mSkin, 0, 0.95, 0.62));
    g.add(box(0.14, 0.16, 0.1, mSkin, 0, 0.88, 0.86));
    var legs = [[-0.25, 0.38], [0.25, 0.38], [-0.25, -0.42], [0.25, -0.42]];
    for (var i = 0; i < 4; i++)
      g.add(box(0.16, 0.38, 0.16, mWool, legs[i][0], 0.19, legs[i][1]));
    return { group: g, mats: [mWool, mSkin], w: 0.8, h: 1.15 };
  }

  function makeZombie() {
    var g = new THREE.Group();
    var mSkin = new THREE.MeshBasicMaterial({ color: 0x5a9a50 });
    var mShirt = new THREE.MeshBasicMaterial({ color: 0x3f6e8c });
    var mPants = new THREE.MeshBasicMaterial({ color: 0x4a4a6e });
    g.add(box(0.42, 0.42, 0.42, mSkin, 0, 1.55, 0));
    g.add(box(0.44, 0.62, 0.26, mShirt, 0, 1.02, 0));
    g.add(box(0.14, 0.55, 0.14, mSkin, -0.32, 1.05, 0.3));
    g.add(box(0.14, 0.55, 0.14, mSkin, 0.32, 1.05, 0.3));
    g.add(box(0.16, 0.55, 0.16, mPants, -0.11, 0.28, 0));
    g.add(box(0.16, 0.55, 0.16, mPants, 0.11, 0.28, 0));
    return { group: g, mats: [mSkin, mShirt, mPants], w: 0.6, h: 1.8 };
  }

  function spawn(type, pos) {
    var b = type === 'sheep' ? makeSheep() : makeZombie();
    var m = {
      type: type,
      pos: pos.clone(),
      vel: new THREE.Vector3(),
      w: b.w, h: b.h,
      group: b.group,
      mats: b.mats,
      baseColors: b.mats.map(function (mt) { return mt.color.getHex(); }),
      hp: type === 'sheep' ? C.HP_SHEEP : C.HP_ZOMBIE,
      onGround: false,
      dir: Math.random() * Math.PI * 2,
      aiTimer: 0.5,
      moveTime: 0,
      attackCd: 0,
      flash: 0,
      bleatTimer: 3 + Math.random() * 12,
      growlTimer: 4 + Math.random() * 10,
      dead: false
    };
    group.add(b.group);
    list.push(m);
    return m;
  }

  function removeAt(i) {
    var m = list[i];
    group.remove(m.group);
    for (var j = 0; j < m.mats.length; j++) m.mats[j].dispose();
    list.splice(i, 1);
  }

  function setFlash(m, on) {
    for (var i = 0; i < m.mats.length; i++)
      m.mats[i].color.setHex(on ? 0xffffff : m.baseColors[i]);
  }

  function damage(m, n, dir) {
    if (m.dead) return;
    m.hp -= n;
    m.flash = 0.15;
    setFlash(m, true);
    m.vel.x += dir.x * 5;
    m.vel.z += dir.z * 5;
    m.vel.y += 3;
    Voxel.Sound.hit();
    if (m.type === 'sheep') Voxel.Sound.sheepHurt(Voxel.Sound.volAt(m.pos.x, m.pos.z));
    if (m.hp <= 0) kill(m);
  }

  function kill(m) {
    m.dead = true;
    Voxel.Sound.pop();
    var p = m.pos.clone();
    p.y += m.h * 0.5;
    Voxel.Particles.burst(p, m.baseColors[0], 14);
    // 羊掉落羊毛（方块 ID 16）
    if (m.type === 'sheep' && Voxel.Game && Voxel.Game.onDrop) {
      Voxel.Game.onDrop(16, C.WOOL_DROP);
    }
    var i = list.indexOf(m);
    if (i >= 0) removeAt(i);
  }

  function trySpawn(type) {
    var Pp = Voxel.Player.pos();
    for (var a = 0; a < 12; a++) {
      var ang = Math.random() * Math.PI * 2;
      var dist = C.SPAWN_MIN + Math.random() * (C.SPAWN_MAX - C.SPAWN_MIN);
      var x = Math.floor(Pp.x + Math.cos(ang) * dist);
      var z = Math.floor(Pp.z + Math.sin(ang) * dist);
      if (x < 2 || z < 2 || x >= W - 2 || z >= D - 2) continue;
      var y = Voxel.World.surfaceAt(x, z);
      if (y < 3 || y >= H - 4) continue;
      if (type === 'sheep' && Voxel.World.get(x, y, z) !== 1) continue;
      if (Voxel.World.get(x, y + 1, z) !== 0 || Voxel.World.get(x, y + 2, z) !== 0) continue;
      return spawn(type, new THREE.Vector3(x + 0.5, y + 1.02, z + 0.5));
    }
    return null;
  }

  function manage(night) {
    var sheep = 0, zom = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].type === 'sheep') sheep++;
      else zom++;
    }
    if (sheep < C.SHEEP_TARGET) trySpawn('sheep');
    if (zom < (night ? C.ZOMBIE_TARGET : 0)) trySpawn('zombie');
  }

  function update(dt) {
    var night = Voxel.DayNight.isNight();
    var Pl = Voxel.Player;
    var alive = Pl.alive();
    var t = performance.now() / 1000;

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = 2;
      manage(night);
    }

    for (var i = list.length - 1; i >= 0; i--) {
      var m = list[i];
      if (m.dead) { removeAt(i); continue; }

      m.aiTimer -= dt;
      m.moveTime -= dt;
      m.attackCd -= dt;

      var speed = 0;
      if (m.type === 'zombie' && alive) {
        var px = Pl.pos().x - m.pos.x;
        var pz = Pl.pos().z - m.pos.z;
        var dist = Math.sqrt(px * px + pz * pz);
        if (dist < C.ZOMBIE_RANGE) {
          m.dir = Math.atan2(-px, -pz);
          m.moveTime = 1;
          speed = dist < 8 ? C.ZOMBIE_SPEED * 1.35 : C.ZOMBIE_SPEED;
          if (dist < 1.6 && m.attackCd <= 0) {
            m.attackCd = 1.2;
            Pl.damage(C.ZOMBIE_DMG);
          }
        }
      }
      if (speed === 0) {
        if (m.aiTimer <= 0) {
          m.aiTimer = 2 + Math.random() * 3.5;
          if (Math.random() < 0.3) { m.moveTime = 0; }
          else { m.dir = Math.random() * Math.PI * 2; m.moveTime = 1.5 + Math.random() * 2; }
        }
        if (m.moveTime > 0) speed = m.type === 'zombie' ? C.ZOMBIE_SPEED * 0.7 : C.SHEEP_SPEED;
      }

      var sin = Math.sin(m.dir), cos = Math.cos(m.dir);
      m.vel.x = -sin * speed;
      m.vel.z = -cos * speed;
      m.vel.y -= P.GRAVITY * dt;
      if (m.vel.y < -40) m.vel.y = -40;

      // 障碍处理：撞墙跳，悬崖转弯
      if (speed > 0 && m.onGround) {
        var aheadX = Math.floor(m.pos.x - sin * 0.9);
        var aheadZ = Math.floor(m.pos.z - cos * 0.9);
        var bodyY = Math.floor(m.pos.y + (m.type === 'sheep' ? 0.5 : 1.2));
        var blocked = Voxel.Physics.isSolidCell(aheadX, bodyY, aheadZ);
        var floorAhead = Voxel.Physics.isSolidCell(aheadX, Math.floor(m.pos.y) - 1, aheadZ);
        if (blocked) m.vel.y = 7.5;
        else if (!floorAhead) m.dir += Math.PI * (0.5 + Math.random());
      }

      Voxel.Physics.move(m, dt);

      // 生物叫声（距离衰减，超 34 块静默）
      var dv = Voxel.Sound.volAt(m.pos.x, m.pos.z);
      if (alive && dv > 0) {
        if (m.type === 'sheep') {
          m.bleatTimer -= dt;
          if (m.bleatTimer <= 0) {
            m.bleatTimer = 12 + Math.random() * 18;
            Voxel.Sound.sheep(dv * 0.8);
          }
        } else {
          m.growlTimer -= dt;
          if (m.growlTimer <= 0) {
            m.growlTimer = (speed > 0 && night) ? 4 + Math.random() * 5 : 6 + Math.random() * 8;
            Voxel.Sound.zombie(dv * 0.9);
          }
        }
      }

      // 渲染
      m.group.position.set(m.pos.x, m.pos.y, m.pos.z);
      m.group.rotation.y = m.dir + Math.PI;
      if (speed > 0 && m.onGround)
        m.group.children[0].position.y = (m.type === 'sheep' ? 0.62 : 1.02) + Math.sin(t * 9 + i) * 0.03;

      // 白天烧僵尸
      if (m.type === 'zombie' && Voxel.DayNight.sunlight() > 0.55) {
        m.hp -= dt * 4;
        if (Math.random() < 0.25) {
          var bp = m.pos.clone();
          bp.y += 1 + Math.random();
          Voxel.Particles.burst(bp, 0xffaa33, 1);
        }
        if (m.hp <= 0) { kill(m); continue; }
      }

      // 过远消失
      if (alive && m.pos.distanceTo(Pl.pos()) > C.DESPAWN) { removeAt(i); continue; }

      // 受击闪白
      if (m.flash > 0) {
        m.flash -= dt;
        if (m.flash <= 0) setFlash(m, false);
      }
    }
  }

  function applyTint(tint) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.flash > 0) continue;
      for (var j = 0; j < m.mats.length; j++)
        m.mats[j].color.setHex(m.baseColors[j]).multiply(tint);
    }
  }

  function clear() {
    for (var i = list.length - 1; i >= 0; i--) removeAt(i);
    spawnTimer = 1;
  }

  function init(scene) {
    group = new THREE.Group();
    scene.add(group);
  }

  return {
    init: init,
    update: update,
    applyTint: applyTint,
    damage: damage,
    clear: clear,
    list: list,
    count: function () { return list.length; }
  };
})();
