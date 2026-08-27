// 真实页面：飞行中verified-save/F5恢复，以及损坏飞船姿态的安全地表回退。
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer-core');
const candidates = [process.env.BROWSER_PATH, process.argv[2],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium', 'google-chrome', 'chromium'].filter(Boolean);
function which(p) {
  if (/^[/A-Za-z:]/.test(p)) return fs.existsSync(p) ? p : null;
  try { return execSync('which ' + p).toString().trim(); } catch (e) { return null; }
}
const executablePath = candidates.map(which).find(Boolean);
if (!executablePath) throw new Error('未找到 Chromium 内核浏览器');
function check(name, ok, detail) { if (!ok) throw new Error('FAIL ' + name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : '')); console.log('  ok  ' + name); }

let browser;
(async () => {
  browser = await puppeteer.launch({ executablePath, headless: 'new',
    args: ['--no-sandbox','--disable-gpu','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 700 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const url = 'file://' + path.join(__dirname, '..', 'index.html');
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.clear(); document.getElementById('seed-input').value = 'COCKPIT-RESUME-E2E'; document.getElementById('btn-new').click(); });
  await page.waitForFunction(() => Voxel.Game.state === 'playing' && Voxel.SpaceTravel.ship(), { timeout: 180000 });
  const saved = await page.evaluate(() => {
    const ship = Voxel.SpaceTravel.ship();
    const door = new THREE.Vector3(...ship.userData.interactionLocal); ship.localToWorld(door);
    Voxel.Player.pos().copy(door); Voxel.SpaceTravel.update(.016, .016); Voxel.Game.onKey('KeyE');
    for (let i = 0; i < 90; i++) Voxel.SpaceTravel.updateFlight(1 / 60, { lift: 1, thrust: i > 35 });
    Voxel.SpaceTravel.applyCockpitCamera(Voxel.Game.camera);
    const ok = Voxel.Game._test.saveNow(), data = Voxel.Save.load();
    return { ok, flight: data.shipFlight, aboard: data.player.aboard, worldId: data.galaxy.currentId };
  });
  check('飞行中verified-save写入有限shipFlight与aboard', saved.ok && saved.aboard && saved.flight &&
    saved.flight.position.every(Number.isFinite) && !saved.flight.landed);
  await page.reload({ waitUntil: 'load' });
  await page.evaluate(() => document.getElementById('btn-start').click());
  await page.waitForFunction(() => Voxel.Game.state === 'cockpit', { timeout: 180000 });
  const resumed = await page.evaluate(() => ({ aboard: Voxel.SpaceTravel.isAboard(),
    flight: Voxel.SpaceTravel.flightSnapshot(), currentId: Voxel.Game._test.currentWorld().id }));
  check('F5继续恢复同一天体座舱与非着陆飞行姿态', resumed.aboard && resumed.currentId === saved.worldId &&
    !resumed.flight.landed && resumed.flight.position.every(Number.isFinite) &&
    Math.hypot(resumed.flight.position[0] - saved.flight.position[0],
      resumed.flight.position[1] - saved.flight.position[1],
      resumed.flight.position[2] - saved.flight.position[2]) < 15);
  await page.evaluate(() => {
    Voxel.Save.save = function () { return false; };
    const key = Voxel.Config.SAVE_KEY, data = JSON.parse(localStorage.getItem(key));
    const bad = { v: 1, position: [null, -999, null], velocity: [9999, 0, 0],
      yaw: null, pitch: null, roll: null, throttle: 9, landed: false };
    data.shipFlight = bad;
    if (data.galaxy && data.galaxy.worlds && data.galaxy.worlds[data.galaxy.currentId])
      data.galaxy.worlds[data.galaxy.currentId].shipFlight = bad;
    data.player.aboard = true;
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.reload({ waitUntil: 'load' });
  await page.evaluate(() => document.getElementById('btn-start').click());
  await page.waitForFunction(() => Voxel.Game.state !== 'loading' && Voxel.Game.state !== 'menu', { timeout: 180000 });
  // 损坏姿态拒绝恢复后，泊位飞行状态还要经一次 resolve 才标记 landed；
  // 显式等到结算完成，消除状态可见但姿态未落地的单帧竞态。
  await page.waitForFunction(() => window.Voxel && Voxel.Game.state === 'playing' &&
    Voxel.SpaceTravel && !Voxel.SpaceTravel.isAboard() &&
    Voxel.SpaceTravel.flightSnapshot() && Voxel.SpaceTravel.flightSnapshot().landed,
    { timeout: 15000 }).catch(() => { });
  const fallback = await page.evaluate(() => ({ state: Voxel.Game.state, aboard: Voxel.SpaceTravel.isAboard(),
    flight: Voxel.SpaceTravel.flightSnapshot(), player: Voxel.Player.pos().toArray(),
    spawn: Voxel.World.spawnPoint().toArray() }));
  check('损坏飞船姿态拒绝恢复座舱并回退安全地表', fallback.state === 'playing' && !fallback.aboard && fallback.flight.landed &&
    fallback.flight.position.every(Number.isFinite) && fallback.player.every(Number.isFinite) &&
    Math.hypot(fallback.player[0] - fallback.spawn[0], fallback.player[2] - fallback.spawn[2]) < 1,
    { state: fallback.state, aboard: fallback.aboard, landed: fallback.flight.landed,
      pos: fallback.flight.position, player: fallback.player, spawn: fallback.spawn });
  check('页面无未捕获异常', errors.length === 0);
  await browser.close();
  console.log('\nCOCKPIT-RESUME-PASS');
})().catch(e => {
  console.error(e.stack || e);
  process.exitCode = 1;
  try { if (browser) browser.close(); } catch (_) { }
  process.exit(1);
});
