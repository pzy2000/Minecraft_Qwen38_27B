// 构建检查（零依赖）：node test/build_check.js
// 1) 对所有 js 源文件做语法校验（node --check）
// 2) 校验 index.html 引用的本地资源文件存在，防止资源缺失/404
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === 'node_modules' || name === '.git') continue;
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

let failed = 0;
function fail(msg) { console.error('FAIL ' + msg); failed++; }

// ---- 1. JS 语法检查 ----
console.log('JS 语法检查 (node --check)');
var jsFiles = []
  .concat(walk(path.join(ROOT, 'js'), []))
  .concat(walk(path.join(ROOT, 'test'), []))
  .concat(walk(path.join(ROOT, 'vendor'), []));
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    fail(f.replace(ROOT + path.sep, '') + ': ' + e.stderr.toString().trim());
    continue;
  }
  console.log('  ok  ' + f.replace(ROOT + path.sep, ''));
}

// ---- 2. index.html 资源完整性 ----
console.log('index.html 资源完整性');
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var refs = [];
var re = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
var m;
while ((m = re.exec(html))) refs.push(m[1]);

if (refs.length === 0) fail('index.html 未解析到任何资源引用');
for (const ref of refs) {
  // 跳过外链、内锚、data URI、协议地址
  if (/^(https?:)?\/\//.test(ref) || ref.startsWith('#') || ref.startsWith('data:')) continue;
  var file = path.join(ROOT, decodeURIComponent(ref.split('?')[0].split('#')[0]));
  if (!fs.existsSync(file)) fail('引用的资源不存在: ' + ref);
  else console.log('  ok  ' + ref);
}

console.log(failed === 0 ? '\n构建检查通过 ✓' : '\n' + failed + ' 项失败 ✗');
process.exit(failed === 0 ? 0 : 1);
