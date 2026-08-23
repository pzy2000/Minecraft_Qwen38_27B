// 星际闭环端到端：真实页面中验证飞船、星图、跃迁、空间站补给、传送门与多世界存档。
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

(async () => {
  const browser = await puppeteer.launch({
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
    document.getElementById('seed-input').value = 'STARBOUND-E2E';
    document.getElementById('btn-new').click();
  });

  async function waitWorld(id) {
    await page.waitForFunction((want) => window.Voxel && Voxel.Game && Voxel.Game.state === 'playing' &&
      Voxel.Game._test.currentWorld() && Voxel.Game._test.currentWorld().id === want,
      { timeout: 180000, polling: 250 }, id);
  }
  function check(name, ok) {
    if (!ok) throw new Error('FAIL ' + name);
    console.log('  ok  ' + name);
  }

  await waitWorld('planet-0');
  let first = await page.evaluate(() => ({
    count: Voxel.Game._test.galaxy().catalog.length,
    kind: Voxel.World.getProfile().kind,
    portals: Voxel.SpaceTravel.portals().length,
    ship: !!Voxel.SpaceTravel.ship(),
    hud: document.getElementById('world-name').textContent,
    fuel: Voxel.Game._test.galaxy().ship.fuel
  }));
  check('起始星系包含 7 个天体', first.count === 7);
  check('起始世界是行星且生成飞船', first.kind === 'planet' && first.ship);
  check('行星生成 3-4 扇种子传送门', first.portals >= 3 && first.portals <= 4);
  check('HUD 显示当前天体', first.hud && first.hud.indexOf('未知') < 0);

  const map = await page.evaluate(() => {
    const ship = Voxel.SpaceTravel.ship();
    Voxel.Player.pos().copy(ship.position).add(new THREE.Vector3(0, 1, 1));
    Voxel.SpaceTravel.update(0.016);
    Voxel.Game.openStarMap();
    return { state: Voxel.Game.state, cards: document.querySelectorAll('#starmap-grid .star-card').length };
  });
  check('靠近飞船可打开 7 天体星图', map.state === 'starmap' && map.cards === 7);

  // 在源行星留下带耐久/年龄/速度的工具掉落，并在跃迁动画尚未完成时检查一致源存档。
  const firstDeparture = await page.evaluate(() => {
    const sourceId = Voxel.Game._test.currentWorld().id;
    const p = Voxel.Player.pos().clone().add(new THREE.Vector3(8, 3, 0));
    const d = Voxel.Drops.spawn(102, 1, p, new THREE.Vector3(1.25, 2.5, -0.75), 37);
    if (d) d.age = 12.5;
    const ok = Voxel.Game.requestTravel('station-0', 'ship');
    const beforePagehide = Voxel.Save.load();
    window.dispatchEvent(typeof PageTransitionEvent === 'function'
      ? new PageTransitionEvent('pagehide', { persisted: false }) : new Event('pagehide'));
    const afterPagehide = Voxel.Save.load();
    return {
      ok,
      sourceId,
      state: Voxel.Game.state,
      pending: Voxel.Game._test.travelPending(),
      beforePagehide,
      afterPagehide
    };
  });
  check('飞船接受空间站跃迁请求', firstDeparture.ok === true);
  check('跃迁动画期间保持明确 pending 事务', firstDeparture.state === 'warping' &&
    firstDeparture.pending && firstDeparture.pending.fromId === 'planet-0' &&
    firstDeparture.pending.toId === 'station-0');
  check('跃迁前先保存一致源世界与工具掉落', firstDeparture.beforePagehide &&
    firstDeparture.beforePagehide.galaxy.currentId === firstDeparture.sourceId &&
    firstDeparture.beforePagehide.galaxy.worlds[firstDeparture.sourceId] &&
    firstDeparture.beforePagehide.galaxy.worlds[firstDeparture.sourceId].drops.some(d =>
      d.id === 102 && d.n === 1 && d.dur === 37 && Math.abs(d.age - 12.5) < 0.001 &&
      d.vel[0] === 1.25 && d.vel[1] === 2.5 && d.vel[2] === -0.75));
  check('warping 中 pagehide 不写出源数据与目标 currentId 混合档', firstDeparture.afterPagehide &&
    firstDeparture.afterPagehide.galaxy.currentId === firstDeparture.sourceId &&
    JSON.stringify(firstDeparture.afterPagehide) === JSON.stringify(firstDeparture.beforePagehide));
  await waitWorld('station-0');
  const station = await page.evaluate(() => ({
    kind: Voxel.World.getProfile().kind,
    fuel: Voxel.Game._test.galaxy().ship.fuel,
    max: Voxel.Game._test.galaxy().ship.maxFuel,
    deck: Voxel.World.get(128, 23, 128),
    portals: Voxel.SpaceTravel.portals().length,
    drops: Voxel.Drops.snapshot(),
    savedCurrent: (Voxel.Save.load().galaxy || {}).currentId
  }));
  check('抵达独立空间站体素世界', station.kind === 'station' && station.deck !== 0);
  check('空间站自动补满跃迁能量', station.fuel === station.max);
  check('空间站拥有返回用传送门', station.portals === 3);
  check('抵达后提交目标世界存档', station.savedCurrent === 'station-0');
  check('源行星掉落未泄漏到空间站', station.drops.length === 0);

  await page.evaluate(() => Voxel.World.set(130, 24, 130, 13));
  const returnDeparture = await page.evaluate(() => {
    const p = Voxel.Player.pos().clone().add(new THREE.Vector3(7, 2, 0));
    const d = Voxel.Drops.spawn(10, 3, p, new THREE.Vector3(-1, 1.5, 0.5), null);
    if (d) d.age = 8;
    const ok = Voxel.Game.requestTravel('planet-0', 'ship');
    const saved = Voxel.Save.load();
    return { ok, saved };
  });
  check('空间站航行终端可返回行星', returnDeparture.ok === true);
  check('空间站离场前保存自己的掉落快照', returnDeparture.saved &&
    returnDeparture.saved.galaxy.currentId === 'station-0' &&
    returnDeparture.saved.galaxy.worlds['station-0'].drops.some(d =>
      d.id === 10 && d.n === 3 && d.dur === null && Math.abs(d.age - 8) < 0.001));
  await waitWorld('planet-0');
  const backOnPlanet = await page.evaluate(() => ({
    fuel: Voxel.Game._test.galaxy().ship.fuel,
    drops: Voxel.Drops.snapshot()
  }));
  const afterShipFuel = backOnPlanet.fuel;
  check('飞船跃迁实际消耗能量', afterShipFuel < station.max);
  check('返航行星恢复原工具掉落及耐久且隔离空间站掉落',
    backOnPlanet.drops.some(d => d.id === 102 && d.n === 1 && d.dur === 37 && d.age >= 12.5) &&
    !backOnPlanet.drops.some(d => d.id === 10 && d.n === 3));

  const portalJump = await page.evaluate(() => ({
    ok: Voxel.Game.requestTravel('station-0', 'portal'),
    fuel: Voxel.Game._test.galaxy().ship.fuel
  }));
  check('传送门接受免费旅行请求', portalJump.ok === true);
  check('传送门离场时不扣跃迁能量', portalJump.fuel === afterShipFuel);
  await waitWorld('station-0');
  const roundTrip = await page.evaluate(() => ({
    fuel: Voxel.Game._test.galaxy().ship.fuel,
    edit: Voxel.World.get(130, 24, 130),
    discovered: Object.keys(Voxel.Game._test.galaxy().discovered).length,
    drops: Voxel.Drops.snapshot()
  }));
  check('重返空间站后再次完成补能', roundTrip.fuel === station.max);
  check('空间站修改在跨世界往返后恢复', roundTrip.edit === 13);
  check('发现记录随旅行更新', roundTrip.discovered >= 2);
  check('重返空间站只恢复空间站掉落', roundTrip.drops.some(d => d.id === 10 && d.n === 3) &&
    !roundTrip.drops.some(d => d.id === 102));

  // 再离场并第三次进入空间站：applyEdits 回放后的修改仍须进入下一份世界快照。
  check('二次离开空间站请求成功',
    await page.evaluate(() => Voxel.Game.requestTravel('planet-0', 'portal')) === true);
  await waitWorld('planet-0');
  check('第三次进入空间站请求成功',
    await page.evaluate(() => Voxel.Game.requestTravel('station-0', 'portal')) === true);
  await waitWorld('station-0');
  check('多次离场后空间站修改仍保留',
    await page.evaluate(() => Voxel.World.get(130, 24, 130)) === 13);

  await page.evaluate(() => {
    Voxel.Game.onKey('KeyP');
    document.getElementById('btn-save').click();
  });
  const saved = await page.evaluate(() => Voxel.Save.load());
  check('v5 存档保留当前天体', saved.v === 5 && saved.galaxy.currentId === 'station-0');
  check('v5 存档隔离多个世界快照', saved.galaxy.worlds['planet-0'] && saved.galaxy.worlds['station-0']);
  check('存档按世界隔离行星/空间站掉落',
    saved.galaxy.worlds['planet-0'].drops.some(d => d.id === 102 && d.dur === 37) &&
    saved.galaxy.worlds['station-0'].drops.some(d => d.id === 10 && d.n === 3) &&
    saved.drops.some(d => d.id === 10 && d.n === 3));
  check('页面运行无未捕获异常', errors.length === 0);

  await browser.close();
  console.log('\nSPACE-TRAVEL-PASS');
})().catch(async e => {
  console.error(e.stack || e.message);
  process.exitCode = 1;
});
