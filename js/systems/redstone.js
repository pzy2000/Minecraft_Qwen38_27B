// 红石基础电路（v8）：二值信号模型 + 局域重算 + 延时事件队列（纯逻辑，无 DOM）
//
// 设计约束：
// 1. 元件状态全部编码进方块 ID（灭/亮两形态），持久化零成本——复用床的方向编码先例；
// 2. 世界适配通过注入接口完成（get/set/getEdits），可在 Node 中用假世界做单测；
// 3. 传播采用"触发点局域重算"：方块变更只在周围半径内重建导线网络的通断，
//    每帧预算封顶，防止超大规模电路拖垮主循环；
// 4. 与水的节流队列同一套节奏：tick(dt) 由主循环固定步驱动。
//
// 元件语义（对齐 minecraft.wiki 的简化版）：
//   电源：拉杆(开)/石质按钮(按下 1s 回弹)/木质压力板(有实体压住)/红石火把(亮态)
//   导线：相邻连通洪泛点亮（不做 15 格衰减，简化为网络级二值）
//   中继器：延时二极管——输入侧被供能后延时输出到除输入侧外所有邻居
//   受体：红石灯（亮/灭）、铁门与木门（开/关，门仅被电源格直接供能开启）
window.Voxel = window.Voxel || {};

Voxel.Redstone = (function () {
  var B = null;          // Voxel.Blocks（init 注入后缓存）
  var W = null;          // 注入的世界接口 { get, set }
  var worldRef = null;   // 当前世界对象（用于换世界时自动重建元件表）

  var RS = null;         // Blocks.RS 常量组

  var MAX_NODES = 1600;      // 单次重算访问节点上限
  var MAX_EDITS_PER_TICK = 400; // 每帧方块写入预算
  var BTN_HOLD = 1.0;        // 按钮按压时长（秒）
  var REP_DELAY = 0.15;      // 中继器延时
  var TORCH_DELAY = 0.12;    // 红石火把反相延迟
  var DOOR_HOLD_MIN = 0.25;  // 铁门最小翻转间隔（防抖）

  var comps = Object.create(null);   // "x,y,z" -> kind 字符串
  var anchors = [];                  // 待重算锚点 ["x,y,z"]
  var anchorSeen = Object.create(null);
  var events = [];                   // {t, x, y, z, fn:string}
  var clock = 0;
  var doorLastFlip = Object.create(null);

  function key(x, y, z) { return x + ',' + y + ',' + z; }

  function init(worldFacade, worldObj) {
    B = Voxel.Blocks;
    RS = B.RS;
    W = worldFacade;
    worldRef = worldObj || null;
    rebuild();
  }

  function bindWorld(worldObj) {
    if (worldRef === worldObj) return;
    worldRef = worldObj;
    rebuild();
  }

  // 从世界编辑表重建元件登记表（换世界/读档时调用；O(edits)）
  function rebuild(editsList) {
    comps = Object.create(null);
    anchors.length = 0;
    anchorSeen = Object.create(null);
    events.length = 0;
    if (!editsList && W && W.getEdits) editsList = W.getEdits();
    if (!editsList) return;
    for (var k in editsList) {
      var id = editsList[k];
      if (!id) continue;
      var d = B.defs[id];
      if (d && d.rs) comps[k] = d.rs;
    }
  }

  function registerAt(x, y, z) {
    var k = key(x, y, z);
    var d = B.defs[W.get(x, y, z)];
    if (d && d.rs) comps[k] = d.rs;
    else delete comps[k];
  }

  // 主线程在任意方块增删后调用：把变更点周围纳入重算范围
  function onBlockChanged(x, y, z) {
    if (!W) return;
    for (var dy = -1; dy <= 1; dy++)
      for (var dz = -1; dz <= 1; dz++)
        for (var dx = -1; dx <= 1; dx++) {
          var nx = x + dx, ny = y + dy, nz = z + dz;
          if (nx !== x && ny !== y && nz !== z) continue; // 十字邻域即可（含斜上支撑面）
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2) continue;
          var k = key(nx, ny, nz);
          var d = B.defs[W.get(nx, ny, nz)];
          if (d && d.rs) {
            comps[k] = d.rs;
            if (!anchorSeen[k]) { anchorSeen[k] = true; anchors.push([nx, ny, nz]); }
          } else delete comps[k];
        }
    var selfK = key(x, y, z);
    var sd = B.defs[W.get(x, y, z)];
    if (sd && sd.rs && !anchorSeen[selfK]) {
      anchorSeen[selfK] = true; anchors.push([x, y, z]);
    }
  }

  function isSourceOn(def) {
    if (!def || !def.rs) return false;
    if (def.powered) {
      var kind = def.rs;
      // rtorch 只算"直接电源"，其反相输入在下述 torch 规则处理
      return kind === 'lever' || kind === 'button' || kind === 'plate';
    }
    return false;
  }

  function NEIGH(fn, x, y, z) {
    fn(x + 1, y, z); fn(x - 1, y, z); fn(x, y, z + 1); fn(x, y, z - 1);
    fn(x, y + 1, z); fn(x, y - 1, z);
  }

  // 某格是否被供能（用于受体判定）：6 邻内有 激活电源/亮导线/亮中继器/亮红石火把
  function isPoweredCell(x, y, z) {
    var hit = false;
    NEIGH(function (nx, ny, nz) {
      if (hit) return;
      var def = B.defs[W.get(nx, ny, nz)];
      if (!def) return;
      if (isSourceOn(def)) { hit = true; return; }
      if (def.powered && (def.rs === 'wire' || def.rs === 'rtorch' || def.rs === 'repeater')) hit = true;
    }, x, y, z);
    return hit;
  }

  // 导线网络重算：从活跃源出发沿导线洪泛，得出每根导线应有亮/灭并应用差异。
  // 返回实际修改数。访问数超过 MAX_NODES 时放弃本区段（下一帧继续）。
  function refreshWireNetwork(seeds) {
    if (!seeds.length) return 0;
    var srcCells = [];
    var seen = Object.create(null);
    // 收集种子邻域内的全部导线节点
    var q = seeds.slice();
    var head = 0, budget = MAX_NODES;
    while (head < q.length && budget-- > 0) {
      var p = q[head++];
      var pk = key(p[0], p[1], p[2]);
      if (seen[pk]) continue;
      seen[pk] = true;
      var d0 = B.defs[W.get(p[0], p[1], p[2])];
      if (d0 && d0.rs && isSourceOn(d0)) srcCells.push(p);
      // 亮态红石火把与亮态中继器都是驱动导线的电源
      if (d0 && d0.powered && (d0.rs === 'rtorch' || d0.rs === 'repeater')) srcCells.push(p);
      // 沿「导线 + 各类电源」蔓延收集完整连通网络：
      // 只扩一格邻域会因区域边界切断供能路径而误判熄灭。
      if (d0 && (d0.rs === 'wire' || d0.rs === 'lever' || d0.rs === 'button' ||
        d0.rs === 'plate' || d0.rs === 'rtorch' || d0.rs === 'repeater')) {
        NEIGH(function (nx, ny, nz) {
          var nk = key(nx, ny, nz);
          if (seen[nk]) return;
          var nd = B.defs[W.get(nx, ny, nz)];
          // 灯是网络的终结端，不作为通路向外蔓延；其余元件都可能成为供能源
          if (nd && nd.rs && nd.rs !== 'lamp') q.push([nx, ny, nz]);
        }, p[0], p[1], p[2]);
      }
      if (q.length > MAX_NODES * 2) break;
    }
    // 从激活源二次洪泛得到"应亮"集合
    var shouldLit = Object.create(null);
    var q2 = [], h2 = 0, b2 = budget;
    for (var i = 0; i < srcCells.length; i++) {
      NEIGH(function (nx, ny, nz) {
        var nd = B.defs[W.get(nx, ny, nz)];
        if (nd && nd.rs === 'wire') { q2.push([nx, ny, nz]); shouldLit[key(nx, ny, nz)] = true; }
      }, srcCells[i][0], srcCells[i][1], srcCells[i][2]);
    }
    while (h2 < q2.length && b2-- > 0) {
      var p2 = q2[h2++];
      NEIGH(function (nx, ny, nz) {
        var nk = key(nx, ny, nz);
        if (shouldLit[nk]) return;
        var nd = B.defs[W.get(nx, ny, nz)];
        if (nd && nd.rs === 'wire') { shouldLit[nk] = true; q2.push([nx, ny, nz]); }
      }, p2[0], p2[1], p2[2]);
    }
    // 应用差异（只改 seed 邻域内见过的导线）
    var changed = 0;
    for (var kk in seen) {
      var parts = kk.split(',');
      var cx = +parts[0], cy = +parts[1], cz = +parts[2];
      var cd = B.defs[W.get(cx, cy, cz)];
      if (!cd || cd.rs !== 'wire') continue;
      var want = !!shouldLit[kk];
      if (!!cd.powered !== want) {
        var nid = B.rsSwapId(W.get(cx, cy, cz));
        W.set(cx, cy, cz, nid);
        changed++;
        onBlockChanged(cx, cy, cz);   // 导线状态变化可能点亮相邻灯/门
        if (changed > MAX_EDITS_PER_TICK) break;
      }
    }
    return changed;
  }

  // 受体：灯直接由 evaluateRegion 刷新；门由 refreshDoor 联动

  // 门联动：供能开启、失能关闭（铁门专用通道；木门可手开也随信号走）
  function refreshDoor(x, y, z, curId) {
    var d = B.defs[curId];
    var dinf = d.door;
    if (!dinf) return false;
    var k = key(x, y, z);
    var powered = isPoweredCell(x, y, z);
    var last = doorLastFlip[k] || 0;
    if (clock - last < DOOR_HOLD_MIN) return false;
    if (powered === dinf.open) return false;
    // 找下半块坐标统一切换
    var ly = dinf.upper ? y - 1 : y;
    var uy = dinf.upper ? y : y + 1;
    var l0 = W.get(x, ly, z), u0 = W.get(x, uy, z);
    if (!B.isDoor(l0)) l0 = 0;
    if (!B.isDoor(u0)) u0 = 0;
    var nl = l0 ? B.doorToggleId(l0) : 0;
    var nu = nl ? B.doorPartnerId(nl) : 0;
    if (!nl && !nu) return false;
    doorLastFlip[k] = clock;
    if (l0 && nl) W.set(x, ly, z, nl);
    if (u0 && nu) W.set(x, uy, z, nu);
    return true;
  }

  // 计划延时事件
  function schedule(delay, x, y, z, fnName) {
    events.push({ t: clock + delay, x: x, y: y, z: z, fn: fnName });
  }

  // ---- tick 主循环 ----
  function tick(dt, entities) {
    if (!W || !B) return;
    clock += dt;
    var writes = 0;

    // 1) 到期事件：按钮回弹 / 中继器输出 / 火把反相确认
    var due = [];
    for (var i = events.length - 1; i >= 0; i--) {
      if (events[i].t <= clock) { due.push(events[i]); events.splice(i, 1); }
    }
    for (var e = 0; e < due.length; e++) {
      var ev = due[e];
      var id = W.get(ev.x, ev.y, ev.z);
      var d = B.defs[id];
      if (!d) continue;
      if (ev.fn === 'btnRelease' && d.rs === 'button' && d.powered) {
        W.set(ev.x, ev.y, ev.z, B.rsSwapId(id));
        writes++;
        onBlockChanged(ev.x, ev.y, ev.z);
      } else if (ev.fn === 'repOut' && d.rs === 'repeater' && d.powered &&
        !isPoweredCellForRepeaterInput(ev.x, ev.y, ev.z)) {
        // 输入已撤 → 关闭
        W.set(ev.x, ev.y, ev.z, B.rsSwapId(id));
        writes++;
        onBlockChanged(ev.x, ev.y, ev.z);
      } else if (ev.fn === 'repIn') {
        resolveRepIn(ev.x, ev.y, ev.z);
      } else if (ev.fn === 'torch') {
        resolveTorch(ev.x, ev.y, ev.z);
      }
    }

    // 2) 重算锚点（每帧最多 4 个区域）
    var processed = 0;
    while (anchors.length && processed < 4) {
      var a = anchors.pop();
      var ak = a.join(',');
      anchorSeen[ak] = false;
      processed++;
      writes += evaluateRegion(a[0], a[1], a[2]);
      if (writes > MAX_EDITS_PER_TICK) break;
    }

    // 3) 压力板实体检测（每 0.1s 一轮）
    plateTimer -= dt;
    if (plateTimer <= 0) {
      plateTimer = 0.1;
      writes += tickPlates(entities);
    }
    return writes;
  }

  var plateTimer = 0;

  // 中继器输入语义：只认手动开关与红石火把（不含导线——输出导线贴邻会形成
  // 自反馈锁死；这是二值模型下的简化，见 README 已知限制）
  function isPoweredCellForRepeaterInput(x, y, z) {
    var hit = false;
    NEIGH(function (nx, ny, nz) {
      if (hit) return;
      var def = B.defs[W.get(nx, ny, nz)];
      if (!def) return;
      if (isSourceOn(def)) { hit = true; return; }
      if (def.powered && def.rs === 'rtorch') hit = true;
    }, x, y, z);
    return hit;
  }

  function evaluateRegion(x, y, z) {
    var writes = 0;
    var seeds = [];
    NEIGH(function (nx, ny, nz) {
      var d = B.defs[W.get(nx, ny, nz)];
      if (d && d.rs) seeds.push([nx, ny, nz]);
    }, x, y, z);
    var selfD = B.defs[W.get(x, y, z)];

    // 导线网络重算
    if (selfD && selfD.rs === 'wire') seeds.push([x, y, z]);
    writes += refreshWireNetwork(seeds.slice());

    // 六邻组件逐一刷新（灯/门/中继器/火把）
    NEIGH(function (nx, ny, nz) {
      if (writes > MAX_EDITS_PER_TICK) return;
      var nid = W.get(nx, ny, nz);
      var nd = B.defs[nid];
      if (!nd || !nd.rs) return;
      switch (nd.rs) {
        case 'lamp':
          if (!!nd.powered !== isPoweredCell(nx, ny, nz)) {
            W.set(nx, ny, nz, B.rsSwapId(nid)); writes++;
          }
          break;
        case 'repeater': {
          var inp = isPoweredCellForRepeaterInput(nx, ny, nz);
          if (inp && !nd.powered) {
            schedule(REP_DELAY, nx, ny, nz, 'repIn');
            pendingRepOn[key(nx, ny, nz)] = true;
          } else if (!inp && nd.powered) {
            schedule(REP_DELAY, nx, ny, nz, 'repOut');
          }
          break;
        }
        case 'rtorch':
          scheduleRedstoneTorchEval(nx, ny, nz);
          break;
      }
    }, x, y, z);
    // 锚点六邻中的门：红石直接驱动铁门/木门开合
    NEIGH(function (nx, ny, nz) {
      if (writes > MAX_EDITS_PER_TICK) return;
      var nid2 = W.get(nx, ny, nz);
      if (B.isDoor(nid2) && (isPoweredCell(nx, ny, nz) || B.defs[nid2].door.open)) {
        if (refreshDoor(nx, ny, nz, nid2)) writes++;
      }
    }, x, y, z);

    // 自身若是门则直接联动（红石指向门本体的接法）
    if (B.isDoor(W.get(x, y, z))) {
      if (refreshDoor(x, y, z, W.get(x, y, z))) writes++;
    }
    // 锚点上下格是门的情形（门嵌在墙里被侧面导线供能）
    var ax = W.get(x, y + 1, z), bx = W.get(x, y - 1, z);
    if (B.isDoor(ax) && isPoweredCell(x, y, z)) { if (refreshDoor(x, y + 1, z, ax)) writes++; }
    else if (B.isDoor(ax) && !isPoweredCell(x, y, z) && B.defs[ax].door.open) {
      if (refreshDoor(x, y + 1, z, ax)) writes++;
    }
    if (B.isDoor(bx) && B.defs[bx].rs === undefined) { /* 下方的门不受上方信号影响 */ }
    return writes;
  }

  var pendingRepOn = Object.create(null);

  // 中继器“入力接通”事件：到点后若仍有效则置亮
  function resolveRepIn(x, y, z) {
    var id = W.get(x, y, z);
    var d = B.defs[id];
    if (!d || d.rs !== 'repeater') { delete pendingRepOn[key(x, y, z)]; return; }
    if (pendingRepOn[key(x, y, z)]) {
      delete pendingRepOn[key(x, y, z)];
      if (!d.powered) { W.set(x, y, z, B.rsSwapId(id)); onBlockChanged(x, y, z); }
    }
  }

  var torchPending = Object.create(null);

  // 红石火把反相评估（延时去抖）：邻接“手动电源或亮导线”→ 熄灭；否则点亮
  function scheduleRedstoneTorchEval(x, y, z) {
    var k = key(x, y, z);
    if (torchPending[k]) return;
    torchPending[k] = true;
    schedule(TORCH_DELAY, x, y, z, 'torch');
  }

  function resolveTorch(x, y, z) {
    delete torchPending[key(x, y, z)];
    var id = W.get(x, y, z);
    var d = B.defs[id];
    if (!d || d.rs !== 'rtorch') return;
    var suppressed = false;
    NEIGH(function (nx, ny, nz) {
      if (suppressed) return;
      var nd = B.defs[W.get(nx, ny, nz)];
      if (!nd) return;
      // 仅手动开关（拉杆/按钮/压力板）直接邻接时反相；
      // 亮导线不抑制火把——否则火把自己的输出导线会形成自锁。
      if (nd.rs && nd.powered &&
        (nd.rs === 'lever' || nd.rs === 'button' || nd.rs === 'plate')) suppressed = true;
    }, x, y, z);
    if (suppressed === d.powered) {   // 状态需要翻转
      W.set(x, y, z, B.rsSwapId(id));
      onBlockChanged(x, y, z);
    }
  }

  // 压力板扫描：任一实体的脚底所在格与板同格即压下
  function tickPlates(entities) {
    var writes = 0;
    var occupied = Object.create(null);
    if (entities) {
      for (var i = 0; i < entities.length; i++) {
        var p = entities[i];
        if (!p || typeof p.x !== 'number') continue;
        var px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
        occupied[key(px, py, pz)] = true;
        occupied[key(px, py - 1, pz)] = true; // 板在高半格的情形兜底
      }
    }
    for (var k in comps) {
      if (comps[k] !== 'plate') continue;
      var parts = k.split(',');
      var x = +parts[0], y = +parts[1], z = +parts[2];
      var id = W.get(x, y, z);
      var d = B.defs[id];
      if (!d || d.rs !== 'plate') { comps[k] = undefined; continue; }
      var pressed = !!d.powered;
      var occ = !!occupied[k];
      if (pressed !== occ) {
        var nid = B.rsSwapId(id);
        if (nid) { W.set(x, y, z, nid); writes++; onBlockChanged(x, y, z); }
      }
    }
    return writes;
  }

  // 交互入口（main 调）：拉杆拨动 / 按钮按下
  function interactToggle(x, y, z, id) {
    var d = B.defs[id];
    if (!d || !d.rs) return null;
    var kind = d.rs;
    if (kind === 'lever') {
      var nid = B.rsSwapId(id);
      W.set(x, y, z, nid);
      onBlockChanged(x, y, z);
      return nid;
    }
    if (kind === 'button' && !d.powered) {
      var nid2 = B.rsSwapId(id);
      W.set(x, y, z, nid2);
      onBlockChanged(x, y, z);
      schedule(BTN_HOLD, x, y, z, 'btnRelease');
      return nid2;
    }
    return null;
  }

  // 测试钩子与内部转储
  function _testState() { return { comps: JSON.parse(JSON.stringify(comps)), clock: clock }; }

  return {
    init: init,
    bindWorld: bindWorld,
    rebuild: rebuild,
    onBlockChanged: onBlockChanged,
    tick: tick,
    interactToggle: interactToggle,
    refreshWireNetwork: refreshWireNetwork,
    schedule: schedule,
    resolveRepIn: resolveRepIn,
    resolveTorch: resolveTorch,
    _testState: _testState
  };
})();
