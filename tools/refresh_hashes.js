// 刷新 index.html 中以 sha256 内容哈希作为 ?v= 的 script/css 引用。
// 短版本号标签（如 ?v=20260823f）保持原样。用法：node tools/refresh_hashes.js
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const htmlPath = path.join(ROOT, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

html = html.replace(/(src|href)="([^"?]+\.(?:js|css))\?v=([0-9a-f]{64})"/g,
  (m, attr, file) => {
    const buf = fs.readFileSync(path.join(ROOT, file));
    return `${attr}="${file}?v=${sha256(buf)}"`;
  });

fs.writeFileSync(htmlPath, html);
console.log('refreshed content-hash query strings');
