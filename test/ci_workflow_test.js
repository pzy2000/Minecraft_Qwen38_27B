// CI 静态契约：本地 canonical 测试必须在两个并行 CI 任务中恰好覆盖一次。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const nvmrc = fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim();
let failed = 0;

function check(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    console.error('FAIL ' + message);
    failed++;
  }
}

function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

console.log('Node 版本与锁文件契约');
check(pkg.engines && pkg.engines.node === '>=22.12.0', 'package.json 要求 Node >=22.12.0');
check(nvmrc === '22.23.2', '.nvmrc 锁定 Node 22.23.2');
check(lock.packages && lock.packages[''] &&
  lock.packages[''].engines && lock.packages[''].engines.node === pkg.engines.node,
  'package-lock 根包保留相同 Node engine');
check(lock.name === pkg.name && lock.packages[''].name === pkg.name,
  'package-lock 根包名称与 package.json 一致');
check(pkg.devDependencies && pkg.devDependencies['@puppeteer/browsers'] === '3.2.1',
  '浏览器安装 CLI 是直接锁定依赖');
check(lock.packages && lock.packages['node_modules/@puppeteer/browsers'] &&
  lock.packages['node_modules/@puppeteer/browsers'].version === pkg.devDependencies['@puppeteer/browsers'],
  '浏览器安装 CLI 版本存在于锁文件');

console.log('npm canonical 测试拆分契约');
const nodeFiles = [
  'test/smoke.js',
  'test/universe_test.js',
  'test/planet_rules_test.js',
  'test/resource_registry_test.js',
  'test/portal_network_test.js',
  'test/redstone_test.js',
  'test/park_economy_test.js',
  'test/terrain_parity_test.js',
  'test/ship_flight_test.js',
  'test/flight_sequence_test.js',
  'test/audio_asset_budget_test.js',
  'test/ci_workflow_test.js',
  'test/pages_workflow_test.js'
];
// 高保真仿真：运行时长 60s+，单独承载为 test:sim，不进入快速链
const simFiles = [
  'test/landing_success_test.js'
];
const browserFiles = [
  'test/run_browser_tests.js',
  'test/space_travel_test.js',
  'test/cockpit_resume_test.js',
  'test/jump_flow_test.js'
];
check(pkg.scripts.test === 'npm run test:node && npm run test:browser',
  'test 依次组合 test:node 与 test:browser');
for (const file of nodeFiles) {
  check(occurrences(pkg.scripts['test:node'] || '', file) === 1,
    'test:node 唯一覆盖 ' + file);
  check(!String(pkg.scripts['test:browser'] || '').includes(file),
    'test:browser 不重复 ' + file);
}
for (const file of browserFiles) {
  check(occurrences(pkg.scripts['test:browser'] || '', file) === 1,
    'test:browser 唯一覆盖 ' + file);
  check(!String(pkg.scripts['test:node'] || '').includes(file),
    'test:node 不重复 ' + file);
}
for (const file of simFiles) {
  check(occurrences(pkg.scripts['test:sim'] || '', file) === 1,
    'test:sim 唯一覆盖 ' + file);
  check(!String(pkg.scripts['test:node'] || '').includes(file) &&
    !String(pkg.scripts['test:browser'] || '').includes(file),
    'test:sim 不与快速链重复 ' + file);
}

console.log('GitHub Actions 契约');
check(occurrences(workflow, 'actions/checkout@v7') === 2,
  '两个任务均使用 actions/checkout@v7');
check(occurrences(workflow, 'actions/setup-node@v7') === 2,
  '两个任务均使用 actions/setup-node@v7');
check(occurrences(workflow, 'node-version: 22.23.2') === 2,
  '两个任务均锁定 Node 22.23.2');
check(!workflow.includes('package-manager-cache:'),
  '不向 setup-node 传入不存在的 package-manager-cache 参数');
check(occurrences(workflow, 'npm ci --engine-strict') === 2,
  '两个任务均严格校验 engine 并按锁文件安装');
check(occurrences(workflow, 'npm run build') === 1, '远程唯一执行 build');
check(occurrences(workflow, 'npm run test:node') === 1, '远程唯一执行 test:node');
check(occurrences(workflow, 'npm run test:sim') === 1, '远程唯一执行 test:sim（高保真仿真回归）');
check(occurrences(workflow, 'npm run test:browser') === 1, '远程唯一执行 test:browser');
check(workflow.includes("CHROME_BUILD=\"$(node -p \"require('puppeteer-core').PUPPETEER_REVISIONS.chrome\")\"") &&
  /^[0-9]+(?:\.[0-9]+){3}$/.test(require('puppeteer-core').PUPPETEER_REVISIONS.chrome),
  'Chrome 版本来自锁定 puppeteer-core 的兼容修订');
check(workflow.includes('./node_modules/.bin/browsers install "chrome@$CHROME_BUILD"') &&
  workflow.includes("--format '{{path}}'") && !workflow.includes('chrome@stable'),
  'Chrome 使用锁文件 CLI 安装精确版本并直接返回路径');
check(occurrences(workflow, 'actions/cache@v6') === 1 &&
  workflow.includes('${{ steps.browser-version.outputs.chrome }}'),
  'Chrome 按 OS/架构/精确版本使用 actions/cache@v6');
check(!/\bnpx\b/.test(workflow), 'CI 不使用可能漂移的 npx 包解析');
check(!/node test\//.test(workflow), 'CI 仅通过 canonical npm scripts 执行测试');
check(/^permissions:\n  contents: read$/m.test(workflow), 'CI 使用只读 contents 权限');
check(/^concurrency:\n  group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n  cancel-in-progress: true$/m.test(workflow),
  '新提交会取消同分支旧 CI，防止旧 SHA 迟到部署');
check(occurrences(workflow, 'persist-credentials: false') === 2,
  '两个 checkout 均不保留写凭据');
check(workflow.includes('BROWSER_PATH: ${{ steps.chrome.outputs.path }}'),
  '两套浏览器测试共享锁定 Chrome 路径');

console.log(failed === 0 ? '\nCI-WORKFLOW-PASS' : '\n' + failed + ' 项失败');
process.exit(failed === 0 ? 0 : 1);
