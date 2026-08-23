// 生成星际改造的桌面/移动视觉验收截图。
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (e) { puppeteer = require(path.join(__dirname, '..', 'node_modules', 'puppeteer-core')); }
const candidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium', 'google-chrome', 'chromium'
];
function which(p) {
  if (p[0] === '/') return fs.existsSync(p) ? p : null;
  try { return execSync('which ' + p).toString().trim(); } catch (e) { return null; }
}
const executablePath = candidates.map(which).find(Boolean);
const root = path.join(__dirname, '..');
const out = path.join(root, 'screenshots', 'space');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto('file://' + path.join(root, 'index.html'), { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.clear();
    document.getElementById('seed-input').value = 'STARBOUND-VISUAL-QA';
    document.getElementById('btn-new').click();
  });
  await page.waitForFunction(() => Voxel.Game.state === 'playing', { timeout: 180000 });
  await page.evaluate(() => {
    const s = Voxel.SpaceTravel.ship();
    const p = Voxel.Player.pos();
    p.set(s.position.x + 13, s.position.y + 6, s.position.z + 13);
    const dx = s.position.x - p.x, dz = s.position.z - p.z;
    Voxel.Controls.setYaw(Math.atan2(-dx, -dz));
    Voxel.Controls.setPitch(-0.22);
    Voxel.Player.setFlying(true);
  });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(out, 'planet-ship.png') });
  await page.evaluate(() => {
    const s = Voxel.SpaceTravel.ship();
    Voxel.Player.pos().copy(s.position).add(new THREE.Vector3(0, 1, 1));
    Voxel.SpaceTravel.update(0.016);
    Voxel.Game.openStarMap();
  });
  await page.screenshot({ path: path.join(out, 'desktop-starmap.png') });
  await page.evaluate(() => Voxel.Game.requestTravel('station-0', 'ship'));
  await page.waitForFunction(() => Voxel.Game.state === 'playing' && Voxel.Game._test.currentWorld().id === 'station-0', { timeout: 180000 });
  await page.evaluate(() => {
    Voxel.Player.pos().set(128.5, 27, 143.5);
    Voxel.Controls.setYaw(0);
    Voxel.Controls.setPitch(0.08);
    Voxel.Player.setFlying(true);
  });
  await new Promise(r => setTimeout(r, 700));
  await page.screenshot({ path: path.join(out, 'space-station.png') });

  const mobile = await browser.newPage();
  await mobile.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await mobile.evaluateOnNewDocument(() => { window.__FORCE_TOUCH__ = true; });
  await mobile.goto('file://' + path.join(root, 'index.html'), { waitUntil: 'load' });
  await mobile.evaluate(() => {
    localStorage.clear();
    document.getElementById('seed-input').value = 'STARBOUND-MOBILE-QA';
    document.getElementById('btn-new').click();
  });
  await mobile.waitForFunction(() => Voxel.Game.state === 'playing', { timeout: 180000 });
  await mobile.evaluate(() => {
    const s = Voxel.SpaceTravel.ship();
    Voxel.Player.pos().copy(s.position).add(new THREE.Vector3(0, 1, 1));
    Voxel.SpaceTravel.update(0.016);
    Voxel.Game.openStarMap();
  });
  await mobile.screenshot({ path: path.join(out, 'mobile-starmap.png') });
  await browser.close();
  console.log(out);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
