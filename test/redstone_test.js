// 红石基础电路单测：node test/redstone_test.js
// 用假世界验证 电源→导线→灯/门 的传播、按钮回弹、火把反相与存档重建。
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var ROOT = path.join(__dirname, '..');

var sandbox = {
  window: {}, console: console, Math: Math,
  Uint8Array: Uint8Array, Uint16Array: Uint16Array,
  performance: { now: function () { return Date.now(); } }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
}
load('js/config.js');
load('js/blocks.js');

var failures = 0;
function check(name, ok) {
  console.log((ok ? '  ok  ' : '  FAIL ') + name);
  if (!ok) failures++;
}

// ---- 假世界：Map 存储 + 手动通知（对齐主线程的 onBlockChanged 约定）----
function makeWorld() {
  var cells = new Map();
  var edits = {};
  return {
    cells: cells,
    edits: edits,
    get: function (x, y, z) { return cells.get(x + ',' + y + ',' + z) || 0; },
    set: function (x, y, z, id) {
      var k = x + ',' + y + ',' + z;
      if (id) { cells.set(k, id); edits[k] = id; }
      else { cells.delete(k); delete edits[k]; }
    },
    getEdits: function () { return edits; }
  };
}

var RS = null, B = null;
vm.runInContext('this.Voxel', sandbox).Blocks.exportedForTest || 0;
B = vm.runInContext('Voxel.Blocks', sandbox);
RS = B.RS;

// 测试用例构建：默认地面 y=0 石头，组件摆在 y=1
function setup(world) {
  Voxel_RedstoneInit(world);
}
function Voxel_RedstoneInit(world) {
  R.init(world, {});
}

// 模块在 sandbox 内初始化
vm.runInContext('window.Voxel.Redstone = undefined;', sandbox);
load('js/systems/redstone.js');
var R = vm.runInContext('Voxel.Redstone', sandbox);

function newScene() {
  var world = makeWorld();
  for (var x = -8; x <= 8; x++) world.set(x, 0, 0, 3);   // 地面
  setup(world);
  return world;
}
function setWithNotify(world, x, y, z, id) {
  world.set(x, y, z, id);
  R.onBlockChanged(x, y, z);
}
function runTicks(n, dt, ents) {
  for (var i = 0; i < n; i++) R.tick(dt || 0.05, ents || []);
}

console.log('红石电路');

// 1) 拉杆 → 导线 → 灯
(function () {
  var w = newScene();
  setWithNotify(w, -1, 1, 0, RS.LEVER_ON);
  setWithNotify(w, 0, 1, 0, RS.WIRE_OFF);
  setWithNotify(w, 1, 1, 0, RS.LAMP_OFF);
  runTicks(4);
  check('拉杆供能点亮相邻导线', w.get(0, 1, 0) === RS.WIRE_ON);
  check('亮导线点亮红石灯', w.get(1, 1, 0) === RS.LAMP_ON);
  // 关闭拉杆 → 全链熄灭
  setWithNotify(w, -1, 1, 0, RS.LEVER_OFF);
  runTicks(4);
  check('关闭拉杆后导线熄灭', w.get(0, 1, 0) === RS.WIRE_OFF);
  check('失电后红石灯熄灭', w.get(1, 1, 0) === RS.LAMP_OFF);
})();

// 2) 隔格导线传播（3 格以上链路）
(function () {
  var w = newScene();
  setWithNotify(w, 0, 1, 0, RS.LEVER_ON);
  for (var x = 1; x <= 5; x++) setWithNotify(w, x, 1, 0, RS.WIRE_OFF);
  setWithNotify(w, 6, 1, 0, RS.LAMP_OFF);
  runTicks(6);
  var allLit = true;
  for (var x2 = 1; x2 <= 5; x2++) if (w.get(x2, 1, 0) !== RS.WIRE_ON) allLit = false;
  check('信号沿导线网络远距传播(5格)', allLit && w.get(6, 1, 0) === RS.LAMP_ON);
})();

// 3) 按钮：按下后 1 秒自动回弹
(function () {
  var w = newScene();
  setWithNotify(w, 1, 1, 0, RS.BTN_UP);
  R.interactToggle(1, 1, 0, RS.BTN_UP);
  check('按钮交互立即变为按压态', w.get(1, 1, 0) === RS.BTN_DOWN);
  runTicks(10, 0.1);   // 1s
  check('按钮到时自动回弹', w.get(1, 1, 0) === RS.BTN_UP);
})();

// 4) 压力板：实体压下 / 离开回弹
(function () {
  var w = newScene();
  setWithNotify(w, 0, 1, 0, RS.PLATE_UP);
  runTicks(14, 0.05, [{ x: 0.4, y: 1.02, z: 0.6 }]);
  check('实体站上压力板→压下', w.get(0, 1, 0) === RS.PLATE_DOWN);
  runTicks(14, 0.05, [{ x: 40.4, y: 1.02, z: 0.6 }]);
  check('实体离开后压力板回弹', w.get(0, 1, 0) === RS.PLATE_UP);
})();

// 5) 红石火把反相：手动电源邻接 → 延时熄灭；撤源 → 复亮
(function () {
  var w = newScene();
  setWithNotify(w, 0, 1, 0, RS.TORCH_ON);
  setWithNotify(w, 1, 1, 0, RS.WIRE_OFF);
  setWithNotify(w, 2, 1, 0, RS.LAMP_OFF);
  runTicks(6);
  check('无抑制源时火把保持点亮并驱动导线', w.get(1, 1, 0) === RS.WIRE_ON);
  setWithNotify(w, 0, 2, 0, RS.LEVER_ON);   // 上方叠电源抑制
  runTicks(8, 0.1);
  check('邻接激活电源使火把延时反相熄灭', w.get(0, 1, 0) === RS.TORCH_OFF);
  check('火把熄灭后下游导线熄灭', w.get(1, 1, 0) === RS.WIRE_OFF);
  setWithNotify(w, 0, 2, 0, 0);             // 撤掉电源
  runTicks(8, 0.1);
  check('撤源后火把复亮', w.get(0, 1, 0) === RS.TORCH_ON);
})();

// 6) 中继器：输入点亮 → 延时输出；断开输入 → 输出复位
(function () {
  var w = newScene();
  setWithNotify(w, 0, 1, 0, RS.LEVER_ON);
  setWithNotify(w, 1, 1, 0, RS.REP_OFF);
  setWithNotify(w, 2, 1, 0, RS.WIRE_OFF);
  runTicks(20);
  check('中继器接收输入后置亮', w.get(1, 1, 0) === RS.REP_ON);
  check('中继器输出点亮下一级导线', w.get(2, 1, 0) === RS.WIRE_ON);
  setWithNotify(w, 0, 1, 0, RS.LEVER_OFF);
  runTicks(24);
  check('输入撤销后中继器复位', w.get(1, 1, 0) === RS.REP_OFF &&
    w.get(2, 1, 0) === RS.WIRE_OFF);
})();

// 7) 铁门红石联动
(function () {
  var w = newScene();
  var doorLower = B.DOOR_BASE + 48;   // 铁门 下半·关·axis0
  setWithNotify(w, 0, 1, 0, RS.LEVER_ON);
  setWithNotify(w, 1, 1, 0, doorLower);
  setWithNotify(w, 1, 2, 0, doorLower + 4);
  runTicks(8);
  check('铁门被供能开启', w.get(1, 1, 0) === doorLower + 1 &&
    w.get(1, 2, 0) === doorLower + 5);
  setWithNotify(w, 0, 1, 0, RS.LEVER_OFF);
  runTicks(10);
  check('失电后铁门关闭', w.get(1, 1, 0) === doorLower &&
    w.get(1, 2, 0) === doorLower + 4);
})();

// 8) 元件登记可从编辑表重建（读档路径）
(function () {
  var w = newScene();
  setWithNotify(w, 0, 1, 0, RS.WIRE_ON);
  setWithNotify(w, 1, 1, 0, RS.LAMP_OFF);
  R.rebuild();                       // 模拟重载世界
  var st = R._testState();
  check('rebuild 从编辑表恢复元件登记',
    st.comps['0,1,0'] === 'wire' && st.comps['1,1,0'] === 'lamp');
})();

if (failures) {
  console.error('\nREDSTONE-FAIL ' + failures);
  process.exit(1);
}
console.log('\nREDSTONE-PASS');
