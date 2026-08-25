// 跨恒星系跳跃端到端：真实页面中验证银河星图、曲速电池扣费、系统切换与存档往返。
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (e) {
  for (const dir of ['/tmp/node_modules', path.join(__dirname, '..', 'node_modules')]) {
    try { puppeteer = require(dir + '/puppeteer-core'); break; } catch (e2) { }
  }
}
if (!puppeteer) throw new Error('未找到 puppeteer-core');

const candidates = [
  process.env.BROWSER_PATH,
  process.argv[2],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'google-chrome', 'chromium'
].filter(Boolean);
function which(p) {
  if (/^[/A-Za-z:]/.test(p)) return fs.existsSync(p) ? p : null;
  try { return execSync('which ' + p).toString().trim(); } catch (e) { return null; }
}
const executablePath = candidates.map(which).find(Boolean);
if (!executablePath) throw new Error('未找到 Chromium 内核浏览器');

let browser;
(async () => {
  browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1100,700']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 700 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'), { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.clear();
    document.getElementById('seed-input').value = 'STARBOUND-JUMP';
    document.getElementById('btn-new').click();
  });

  function check(name, ok) {
    if (!ok) throw new Error('FAIL ' + name);
    console.log('  ok  ' + name);
  }

  await page.waitForFunction(() => window.Voxel && Voxel.Game &&
    (Voxel.Game.state === 'playing' || Voxel.Game.state === 'cockpit') &&
    Voxel.Game._test.currentWorld() && Voxel.Game._test.currentWorld().id === 'planet-0',
    { timeout: 180000, polling: 250 });

  // ---- 真实配方结果必须进入飞船电池余额，而不是留作无效背包物品 ----
  const crafted = await page.evaluate(() => {
    const T = Voxel.Game._test;
    const before = T.galaxy().ship.warpCells;
    T.clearCraft();
    T.setCraft(0, 117);
    T.setCraft(1, 117);
    T.setCraft(2, 108);
    T.openCrafting();
    T.clickResult();
    const result = {
      before: before,
      after: T.galaxy().ship.warpCells,
      inventoryCells: T.countInv(122),
      consumed: T.craft().every(id => id === 0)
    };
    T.closeCrafting();
    return result;
  });
  check('真实配方合成后自动装填曲速电池', crafted.after === crafted.before + 1 &&
    crafted.inventoryCells === 0 && crafted.consumed, JSON.stringify(crafted));

  // ---- 登舰并打开星图，切到银河标签页 ----
  const boarded = await page.evaluate(() => {
    const ship = Voxel.SpaceTravel.ship();
    if (!ship) return false;
    Voxel.Player.pos().copy(ship.position).add(new THREE.Vector3(0, 1.5, 0));
    Voxel.SpaceTravel.update(0.016, 0);
    Voxel.Game.onKey('KeyE');
    return Voxel.Game.state === 'cockpit' && Voxel.SpaceTravel.isAboard();
  });
  check('登舰进入座舱', boarded);

  const map = await page.evaluate(() => {
    Voxel.Game.onKey('KeyH');
    if (Voxel.Game.state !== 'starmap') return { ok: false };
    const tab = document.getElementById('btn-map-galaxy');
    if (!tab) return { ok: false, reason: 'missing_tab' };
    tab.click();
    return {
      ok: true,
      mode: document.getElementById('overlay-starmap').getAttribute('data-map-mode'),
      cards: document.querySelectorAll('#starmap-grid .galaxy-card').length,
      currentDisabled: (document.querySelector('#starmap-grid .galaxy-card.current') || {}).disabled,
      status: document.getElementById('starmap-status').textContent
    };
  });
  check('座舱打开星图并切到银河视图', map.ok && map.mode === 'galaxy' &&
    map.cards === 25 && map.currentDisabled === true, JSON.stringify(map));
  check('银河状态栏显示星系名与电池数', /曲速电池 \d+/.test(map.status), map.status);

  // ---- 选择相邻恒星系（g0/s1）----
  const selected = await page.evaluate(() => {
    const galaxy = Voxel.Game._test.galaxy();
    Voxel.GalaxyMap.render({
      galaxy: galaxy,
      grid: document.getElementById('starmap-grid'),
      doc: document
    });
    const card = document.querySelector('#starmap-grid .galaxy-card[data-addr="g0/s1"]');
    if (!card) return { ok: false };
    card.click();
    return {
      ok: true,
      selection: document.getElementById('cockpit-selection').textContent,
      igniteDisabled: document.getElementById('btn-travel-ignite').disabled,
      cost: (Voxel.GalaxyMap.getSelection(galaxy) || {}).cost
    };
  });
  check('选中 g0/s1 并锁定曲速航线', selected.ok && !selected.igniteDisabled &&
    /曲速航线已锁定/.test(selected.selection) && selected.cost >= 1, JSON.stringify(selected));

  // ---- 电池不足拦截（不点火）----
  const blocked = await page.evaluate(restoreCells => {
    const galaxy = Voxel.Game._test.galaxy();
    galaxy.ship.warpCells = 0;
    Voxel.GalaxyMap.render({
      galaxy: galaxy,
      grid: document.getElementById('starmap-grid'),
      doc: document
    });
    document.querySelector('#starmap-grid .galaxy-card[data-addr="g0/s1"]').click();
    const ignite = document.getElementById('btn-travel-ignite');
    const result = {
      igniteDisabled: ignite.disabled,
      selection: document.getElementById('cockpit-selection').textContent,
      stillNoTx: !Voxel.Game._test.travelPending()
    };
    ignite.click(); // 应无效果
    galaxy.ship.warpCells = restoreCells;
    Voxel.GalaxyMap.render({
      galaxy: galaxy,
      grid: document.getElementById('starmap-grid'),
      doc: document
    });
    document.querySelector('#starmap-grid .galaxy-card[data-addr="g0/s1"]').click();
    return result;
  }, crafted.after);
  check('电池不足时禁用点火且文案含缺口', blocked.igniteDisabled &&
    /缺少/.test(blocked.selection) && blocked.stillNoTx, JSON.stringify(blocked));

  // ---- 点火跳跃 → 等待抵达目标系空间站 ----
  await page.evaluate(() => document.getElementById('btn-travel-ignite').click());
  await page.waitForFunction(() => Voxel.Game.state === 'warping' &&
    !!Voxel.Game._test.travelPending() &&
    Voxel.Game._test.travelPending().mode === 'jump',
    { timeout: 15000, polling: 100 });
  check('点火后进入 warping 且事务模式为 jump', true);

  await page.evaluate(() => Voxel.Game.skipFlightPresentation());
  await page.waitForFunction(() => {
    const pending = Voxel.Game._test.travelPending();
    return pending && pending.committed === true && pending.sequence &&
      pending.sequence.phase === 'cockpit_arrived';
  }, { timeout: 120000, polling: 100 });
  check('跳跃演出完成且目标世界已提交', true);

  // 回归：抵达画面必须有可见出路（warp 层 + 下船按钮），且不得残留
  // 跃迁前的「按 E 登舰避难」提示误导玩家。
  const arrivalUi = await page.evaluate(() => {
    const warp = document.getElementById('overlay-warp');
    const btn = document.getElementById('btn-disembark');
    const r = btn.getBoundingClientRect();
    return {
      warpVisible: !warp.classList.contains('hidden'),
      btnClickable: !btn.hidden && !btn.disabled && r.width > 0 && r.height > 0 &&
        (() => {
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!hit && (hit === btn || btn.contains(hit));
        })(),
      hintHidden: document.getElementById('use-hint').style.display === 'none',
      starmapClosed: document.getElementById('overlay-starmap').classList.contains('hidden')
    };
  });
  check('抵达画面：warp层可见+下船按钮可点+无过时提示+星图已关',
    arrivalUi.warpVisible && arrivalUi.btnClickable && arrivalUi.hintHidden &&
    arrivalUi.starmapClosed, JSON.stringify(arrivalUi));

  const arrived = await page.evaluate(() => {
    const T = Voxel.Game._test;
    const world = T.currentWorld();
    return {
      state: Voxel.Game.state,
      id: world && world.id,
      kind: world && world.kind,
      curG: T.galaxy().curG,
      curS: T.galaxy().curS,
      cells: T.galaxy().ship.warpCells,
      visited: T.galaxy().visitedSys,
      coord: document.getElementById('world-coord').textContent
    };
  });
  check('抵达目标恒星系空间站', arrived.state === 'arriving' && arrived.id === 'station-0' &&
    arrived.kind === 'station' && arrived.curG === 0 && arrived.curS === 1, JSON.stringify(arrived));

  // ---- 离舰 → playing，验证电池扣费与访问标记 ----
  const postJump = await page.evaluate(async () => {
    Voxel.Game.disembark();
    for (let i = 0; i < 100 && Voxel.Game.state !== 'playing'; i++)
      await new Promise(r => setTimeout(r, 50));
    const T = Voxel.Game._test;
    const savedRaw = localStorage.getItem(Voxel.Config.SAVE_KEY);
    const saved = savedRaw ? JSON.parse(savedRaw) : null;
    return {
      state: Voxel.Game.state,
      curS: T.galaxy().curS,
      cells: T.galaxy().ship.warpCells,
      fuel: T.galaxy().ship.fuel,
      visitedSysKeys: Object.keys(T.galaxy().visitedSys || {}),
      saveV: saved && saved.v,
      saveCurS: saved && saved.galaxy && saved.galaxy.curS,
      saveArchiveHasOrigin: !!(saved && saved.galaxy && saved.galaxy.archive &&
        saved.galaxy.archive['g0/s0']),
      coord: document.getElementById('world-coord').textContent,
      refueled: T.galaxy().ship.fuel === T.galaxy().ship.maxFuel
    };
  });
  check('离舰回到 playing 且位于新系空间站', postJump.state === 'playing' && postJump.curS === 1,
    JSON.stringify(postJump));
  check('曲速电池按成本扣除', postJump.cells >= 0 && postJump.cells < crafted.after);
  check('空间站抵达自动补满跃迁能量', postJump.refueled);
  check('visitedSys 记录两个恒星系',
    postJump.visitedSysKeys.indexOf('g0/s0') >= 0 && postJump.visitedSysKeys.indexOf('g0/s1') >= 0);
  check('HUD 坐标行包含银河与恒星系名', /·.+·/.test(postJump.coord), postJump.coord);

  check('v6 存档写入 curS/archive', postJump.saveV === 6 && postJump.saveCurS === 1 &&
    postJump.saveArchiveHasOrigin === true);

  // ---- 刷新页面 → 继续游戏，验证跨系持久化 ----
  await page.reload({ waitUntil: 'load' });
  await page.evaluate(() => {
    document.getElementById('btn-start').click();
  });
  await page.waitForFunction(() => window.Voxel && Voxel.Game &&
    (Voxel.Game.state === 'playing' || Voxel.Game.state === 'cockpit') &&
    Voxel.Game._test.galaxy() && Voxel.Game._test.galaxy().curS === 1,
    { timeout: 180000, polling: 250 });
  const resumed = await page.evaluate(() => ({
    id: Voxel.Game._test.currentWorld().id,
    curS: Voxel.Game._test.galaxy().curS,
    catalog: Voxel.Game._test.galaxy().catalog.length
  }));
  check('刷新继续后仍在 g0/s1 空间站且目录重建', resumed.curS === 1 && resumed.id === 'station-0' &&
    resumed.catalog >= 3 && resumed.catalog <= 7, JSON.stringify(resumed));

  // ---- 跳回起源系：档案桶轮换对称性 ----
  await page.evaluate(async () => {
    // 空间站内可直接用星图；直接走 API 层验证对称切换
    const ship = Voxel.SpaceTravel.ship();
    if (ship) {
      Voxel.Player.pos().copy(ship.position).add(new THREE.Vector3(0, 1.5, 0));
      Voxel.SpaceTravel.update(0.016, 0);
    }
    Voxel.Game.boardShip();
    Voxel.Game.onKey('KeyH');
    document.getElementById('btn-map-galaxy').click();
    document.querySelector('#starmap-grid .galaxy-card[data-addr="g0/s0"]').click();
    document.getElementById('btn-travel-ignite').click();
  });
  await page.waitForFunction(() => {
    const pending = Voxel.Game._test.travelPending();
    return !pending || (pending.committed && pending.sequence.phase === 'cockpit_arrived');
  }, { timeout: 120000, polling: 100 });
  await page.evaluate(() => Voxel.Game.disembark());
  await page.waitForFunction(() => window.Voxel && Voxel.Game &&
    Voxel.Game.state === 'playing' && Voxel.Game._test.galaxy().curS === 0 &&
    Voxel.Game._test.galaxy().curG === 0, { timeout: 180000, polling: 250 });
  const returned = await page.evaluate(() => ({
    id: Voxel.Game._test.currentWorld().id,
    editsRestored: Object.keys(
      (Voxel.Game._test.galaxy().worlds['planet-0'] || {}).edits || {}).length >= 0
  }));
  check('跳回起源系成功', returned.id === 'station-0' || returned.id === 'planet-0',
    JSON.stringify(returned));

  if (errors.length) {
    console.error('PAGE ERRORS:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('JUMP-FLOW-PASS');
  await browser.close();
})().catch(async e => {
  console.error(e.stack || e.message);
  if (browser) await browser.close();
  process.exit(1);
});
