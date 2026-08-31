// 跨图召唤实机诊断：进入精选世界「北欧城堡」（出生点在无限外围，距 legacy
// core 的飞船泊位约 1.1km），在出生点召唤飞船并逐段打印阶段/距离/流式工作集。
// 期望终局 result=completed；若停在某一距离不再变化即为航路受阻回归。
// 用法: node tools/repro_summon_nordic_e2e.js   （可用 BROWSER_PATH 指定浏览器）
const path = require('path');
const fs = require('fs');
let puppeteer;
for (const dir of [path.join(__dirname, '..', 'node_modules'), '/tmp/node_modules']) {
  try { puppeteer = require(dir + '/puppeteer-core'); break; } catch (e) { }
}
const candidates = [
  process.env.BROWSER_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
].filter(Boolean).filter(p => fs.existsSync(p));
const executablePath = candidates[0];

(async () => {
  const browser = await puppeteer.launch({
    executablePath, headless: 'new', protocolTimeout: 900000,
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1100,700']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 700 });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  page.on('console', m => { const t = m.text(); if (/error|warn/i.test(m.type())) console.log('CONSOLE', t); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'), { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.clear(); });
  const idx = await page.evaluate(() => Voxel.Featured.WORLDS.findIndex(w => w.name === '北欧城堡'));
  console.log('nordic featured index', idx);
  await page.evaluate((i) => Voxel.Game.startFeatured(i), idx);
  await page.waitForFunction(() => window.Voxel && Voxel.Game &&
    (Voxel.Game.state === 'playing' || Voxel.Game.state === 'cockpit') &&
    Voxel.Game._test.currentWorld() && Voxel.Game._test.currentWorld().kind === 'planet',
    { timeout: 300000, polling: 250 });
  // 等待世界流式稳定
  await new Promise(r => setTimeout(r, 8000));

  const info = await page.evaluate(() => {
    const p = Voxel.Player.pos();
    const snap = Voxel.SpaceTravel.flightSnapshot();
    return {
      player: { x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) },
      ship: snap.position.map(v => +v.toFixed(1)),
      dist: +Math.hypot(snap.position[0] - p.x, snap.position[2] - p.z).toFixed(1),
      stream: Voxel.World.streamStats ? Voxel.World.streamStats() : null,
      size: Voxel.World.size()
    };
  });
  console.log('state', JSON.stringify(info));

  const begin = await page.evaluate(() => {
    const p = Voxel.Player.pos();
    const worldApi = {
      surfaceAt: (x, z) => Voxel.World.surfaceAt(x, z),
      get: (x, y, z) => Voxel.World.get(x, y, z),
      isSolid: (id) => !!Voxel.Blocks.isSolid(id)
    };
    let spot = null, yaw = 0;
    for (let r = 8; r <= 48 && !spot; r += 8) {
      yaw += 0.7;
      spot = Voxel.LandingAssist.findLandingSpot(worldApi, p.x + Math.cos(yaw) * 10, p.z + Math.sin(yaw) * 10, yaw, { searchRadius: r });
    }
    if (!spot) return { ok: false, reason: 'nospot' };
    const t0 = performance.now();
    const r = Voxel.SpaceTravel.summonBegin({ x: spot.x, y: spot.y, z: spot.z });
    return { ok: r.ok, reason: r.reason, cruiseY: r.cruiseY, spot, planMs: +(performance.now() - t0).toFixed(1) };
  });
  console.log('begin', JSON.stringify(begin));

  for (let i = 0; i < 200; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const st = await page.evaluate(() => {
      const s = Voxel.SpaceTravel.summonStatus();
      const snap = Voxel.SpaceTravel.flightSnapshot();
      return {
        active: s.active, phase: s.phase,
        dist: s.distance === null ? null : +s.distance.toFixed(1),
        result: s.result,
        pos: snap.position.map(v => +v.toFixed(1)),
        vel: snap.velocity.map(v => +v.toFixed(2)),
        stream: Voxel.World.streamStats ? Voxel.World.streamStats().loaded : null
      };
    });
    if (i % 5 === 0 || !st.active) console.log(i, JSON.stringify(st));
    if (!st.active) break;
  }
  const final = await page.evaluate(() => {
    const s = Voxel.SpaceTravel.summonStatus();
    const snap = Voxel.SpaceTravel.flightSnapshot();
    const p = Voxel.Player.pos();
    return { result: s.result, fallback: s.fallback, landed: snap.landed,
      pos: snap.position.map(v => +v.toFixed(1)),
      distToPlayer: +Math.hypot(snap.position[0] - p.x, snap.position[2] - p.z).toFixed(1) };
  });
  console.log('FINAL', JSON.stringify(final));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
