// 玩家碰撞：游泳贴 1 格岸墙应能自动上台阶上岸。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = { window: {}, console, Math };
sandbox.window = sandbox;
vm.createContext(sandbox);

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
}

load('js/config.js');
load('js/blocks.js');
load('js/player/physics.js');

const V = sandbox.Voxel;
const P = V.Physics;
const C = V.Config.PLAYER;
let failures = 0;

function check(name, condition, detail) {
  if (condition) console.log('  ok  ' + name);
  else {
    failures++;
    console.log('  FAIL ' + name + (detail ? ' :: ' + detail : ''));
  }
}

// 稀疏体素：未写入视为空气。水=7（非固体），石头=3。
var grid = Object.create(null);
function key(x, y, z) { return x + ',' + y + ',' + z; }
function setBlock(x, y, z, id) { grid[key(x, y, z)] = id; }
function fillColumn(x, z, y0, y1, id) {
  for (var y = y0; y <= y1; y++) setBlock(x, y, z, id);
}
V.World = {
  get: function (x, y, z) { return grid[key(x, y, z)] || 0; }
};

function makeEnt(x, y, z, vx, vz, stepHeight) {
  return {
    pos: { x: x, y: y, z: z },
    vel: { x: vx, y: 0, z: vz },
    w: C.W, h: C.H, onGround: false,
    stepHeight: stepHeight || 0
  };
}

function tick(ent, n, dt) {
  dt = dt || 1 / 60;
  for (var i = 0; i < n; i++) P.move(ent, dt);
}

console.log('游泳贴岸上台阶');

// 图1：水面 y=37，岸墙顶块 y=38（视觉高 1 格）。脚底 37.0 需抬到 39 才能站上。
grid = Object.create(null);
setBlock(0, 37, 0, 7);
fillColumn(1, 0, 30, 38, 3);

var blocked = makeEnt(0.5, 37.0, 0.5, 4.3, 0, 0);
tick(blocked, 20);
check('无 stepHeight 时被 1 格岸墙挡住',
  blocked.pos.x < 0.8 && blocked.pos.y < 37.1,
  'x=' + blocked.pos.x.toFixed(3) + ' y=' + blocked.pos.y.toFixed(3));

var climb = makeEnt(0.5, 37.0, 0.5, 4.3, 0, C.WATER_STEP);
tick(climb, 20);
climb.vel.y = -1;
P.move(climb, 1 / 60);
check('游泳 stepHeight 能爬上 1 格岸墙',
  climb.pos.x > 1.0 && climb.pos.y > 38.9 && climb.pos.y < 39.1 && climb.onGround,
  'x=' + climb.pos.x.toFixed(3) + ' y=' + climb.pos.y.toFixed(3) +
    ' onGround=' + climb.onGround);

// 反向（-X）同样能上
grid = Object.create(null);
setBlock(0, 37, 0, 7);
fillColumn(-1, 0, 30, 38, 3);
var west = makeEnt(0.5, 37.0, 0.5, -4.3, 0, C.WATER_STEP);
tick(west, 20);
west.vel.y = -1;
P.move(west, 1 / 60);
check('朝 -X 贴岸同样上台阶',
  west.pos.x < 0 && west.pos.y > 38.9 && west.onGround,
  'x=' + west.pos.x.toFixed(3) + ' y=' + west.pos.y.toFixed(3));

// Z 轴岸墙
grid = Object.create(null);
setBlock(0, 37, 0, 7);
fillColumn(0, 1, 30, 38, 3);
var north = makeEnt(0.5, 37.0, 0.5, 0, 4.3, C.WATER_STEP);
tick(north, 20);
north.vel.y = -1;
P.move(north, 1 / 60);
check('朝 +Z 贴岸同样上台阶',
  north.pos.z > 1.0 && north.pos.y > 38.9 && north.onGround,
  'z=' + north.pos.z.toFixed(3) + ' y=' + north.pos.y.toFixed(3));

console.log('上台阶边界');

// 3 格高墙：抬 2.25 仍头顶卡住，不得穿墙
grid = Object.create(null);
fillColumn(1, 0, 30, 40, 3);
var wall = makeEnt(0.5, 37.0, 0.5, 4.3, 0, C.WATER_STEP);
tick(wall, 20);
check('3 格高墙不会被抬升穿过',
  wall.pos.x < 0.8 && wall.pos.y < 37.1,
  'x=' + wall.pos.x.toFixed(3) + ' y=' + wall.pos.y.toFixed(3));

// 半高台阶（床）在 stepHeight 内应能踏上
grid = Object.create(null);
setBlock(1, 37, 0, 17); // 半高床
var bed = makeEnt(0.5, 37.0, 0.5, 4.3, 0, C.WATER_STEP);
tick(bed, 20);
bed.vel.y = -1;
P.move(bed, 1 / 60);
check('半高方块可踏上',
  bed.pos.x > 1.0 && bed.pos.y > 37.4 && bed.pos.y < 37.6,
  'x=' + bed.pos.x.toFixed(3) + ' y=' + bed.pos.y.toFixed(3));

if (failures) {
  console.log('\n' + failures + ' 项失败 ✗');
  process.exit(1);
}
console.log('\n物理上台阶测试通过 ✓');
