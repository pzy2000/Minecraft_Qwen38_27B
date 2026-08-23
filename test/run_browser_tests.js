// 浏览器端全量测试运行器
// 用法: node test/run_browser_tests.js [/path/to/chrome]
// 需要: npm i puppeteer-core (任意目录，默认在 /tmp 或本目录下查找)
// 示例:
//   node test/run_browser_tests.js "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
//   node test/run_browser_tests.js "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
const path = require('path');
const { execSync } = require('child_process');

let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (e) {
  for (const dir of ['/tmp/node_modules', path.join(__dirname, '..', 'node_modules')]) {
    try { puppeteer = require(dir + '/puppeteer-core'); break; } catch (e2) { }
  }
}
if (!puppeteer) {
  console.error('未找到 puppeteer-core，请先: npm i puppeteer-core');
  process.exit(1);
}

const candidates = [
  process.argv[2],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'google-chrome',
  'chromium'
].filter(Boolean);

function which(p) {
  if (/^[/A-Za-z:]/.test(p)) return require('fs').existsSync(p) ? p : null;
  try { return execSync(`which ${p}`).toString().trim(); } catch (e) { return null; }
}
const execPath = candidates.map(which).find(Boolean);
if (!execPath) { console.error('未找到 Chromium 内核浏览器，请传入可执行文件路径'); process.exit(1); }

(async () => {
  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=960,600']
  });
  const root = path.join(__dirname, '..');
  let allPass = true;

  const targets = [
    { file: 'test/browser_test.html', re: '^TEST-PASS' },
    { file: 'test/touch_test.html', re: '^TOUCH-PASS', forceTouch: true },
    { file: 'test/render_check.html', re: '^RENDER-PASS' },
    { file: 'test/render_check.html', re: '^RENDER-PASS', forceTouch: true }
  ];

  for (const t of targets) {
    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 600 });
    if (t.forceTouch)
      await page.evaluateOnNewDocument(() => { window.__FORCE_TOUCH__ = true; });
    await page.goto('file://' + path.join(root, t.file), { waitUntil: 'load' });
    const ok = await page.waitForFunction(
      (re) => new RegExp(re).test(document.title),
      { timeout: 180000, polling: 500 }, t.re
    ).then(() => true).catch(() => false);
    const text = await page.$eval('#results, #out', el => el.textContent).catch(() => '');
    console.log('\n===== ' + t.file + (t.forceTouch ? ' [touch]' : '') + ' : ' + (ok ? 'PASS' : 'FAIL') + ' =====');
    console.log(text);
    allPass = allPass && ok;
    await page.close();
  }

  await browser.close();
  console.log(allPass ? '\n>>> 全部浏览器测试通过' : '\n>>> 存在失败项');
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('RUNNER FAIL', e.message); process.exit(1); });
