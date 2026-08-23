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

  const shipJump = await page.evaluate(() => Voxel.Game.requestTravel('station-0', 'ship'));
  check('飞船接受空间站跃迁请求', shipJump === true);
  await waitWorld('station-0');
  const station = await page.evaluate(() => ({
    kind: Voxel.World.getProfile().kind,
    fuel: Voxel.Game._test.galaxy().ship.fuel,
    max: Voxel.Game._test.galaxy().ship.maxFuel,
    deck: Voxel.World.get(128, 23, 128),
    portals: Voxel.SpaceTravel.portals().length
  }));
  check('抵达独立空间站体素世界', station.kind === 'station' && station.deck !== 0);
  check('空间站自动补满跃迁能量', station.fuel === station.max);
  check('空间站拥有返回用传送门', station.portals === 3);

  await page.evaluate(() => Voxel.World.set(130, 24, 130, 13));
  const returnJump = await page.evaluate(() => Voxel.Game.requestTravel('planet-0', 'ship'));
  check('空间站航行终端可返回行星', returnJump === true);
  await waitWorld('planet-0');
  const afterShipFuel = await page.evaluate(() => Voxel.Game._test.galaxy().ship.fuel);
  check('飞船跃迁实际消耗能量', afterShipFuel < station.max);

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
    discovered: Object.keys(Voxel.Game._test.galaxy().discovered).length
  }));
  check('重返空间站后再次完成补能', roundTrip.fuel === station.max);
  check('空间站修改在跨世界往返后恢复', roundTrip.edit === 13);
  check('发现记录随旅行更新', roundTrip.discovered >= 2);

  await page.evaluate(() => {
    Voxel.Game.onKey('KeyP');
    document.getElementById('btn-save').click();
  });
  const saved = await page.evaluate(() => Voxel.Save.load());
  check('v5 存档保留当前天体', saved.v === 5 && saved.galaxy.currentId === 'station-0');
  check('v5 存档隔离多个世界快照', saved.galaxy.worlds['planet-0'] && saved.galaxy.worlds['station-0']);
  check('页面运行无未捕获异常', errors.length === 0);

  await browser.close();
  console.log('\nSPACE-TRAVEL-PASS');
})().catch(async e => {
  console.error(e.stack || e.message);
  process.exitCode = 1;
});
