#!/usr/bin/env node
// 构建 js/assets.js：把 assets_src/audio/*.mp3 以 base64 dataURI 内嵌
// 用法: node tools/build_audio.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets_src', 'audio');
const OUT = path.join(ROOT, 'js', 'assets.js');

// 出处清单（与文件对应，写入生成物头部）
const CREDITS = [
  { files: 'step_grass_*, step_snow_*, step_stone_*, step_wood_*, step_wool_*, dig_*, dig_wood_*, dig_glass_*, land_*, ui_*',
    source: 'Kenney "Impact Sounds" (kenney.nl)', license: 'CC0 1.0' },
  { files: 'step_dirt_0', source: 'Kenney "Impact Sounds" (kenney.nl), pitch-shifted', license: 'CC0 1.0' },
  { files: 'step_dirt_1, step_leaves_0, step_leaves_1',
    source: '"Different steps on wood, stone, leaves, gravel and mud" by kdd (opengameart.org)', license: 'CC0 1.0' },
  { files: 'step_sand_0, step_sand_1, splash_step_0, splash_step_1, sheep_0, sheep_1, sheep_2, sheep_hurt, splash_0',
    source: 'Yo Frankie! game assets via opengameart.org (sfx_step_*/sheep*/watersplash)', license: 'CC-BY 3.0 (Blender Foundation / Apricot project)' },
  { files: 'zombie_0', source: '"Zombie Sound" (opengameart.org/content/zombie-sound)', license: 'CC0 1.0' },
  { files: 'music_day', source: '"Calm Ambient 3 - Lifewave 2k" by The Cynic Project / Pixelsphere (opengameart.org)', license: 'CC0 1.0' },
  { files: 'music_night', source: '"Calm Piano 1 - Vaporware" by The Cynic Project / Pixelsphere (opengameart.org)', license: 'CC0 1.0' }
];

if (!fs.existsSync(SRC)) {
  console.error('找不到 ' + SRC + '，请先运行 tools/process_audio.sh');
  process.exit(1);
}

const names = fs.readdirSync(SRC).filter(f => f.endsWith('.mp3')).sort();
if (!names.length) { console.error('assets_src/audio 为空'); process.exit(1); }

let total = 0;
const entries = [];
for (const f of names) {
  const buf = fs.readFileSync(path.join(SRC, f));
  total += buf.length;
  entries.push('    ' + JSON.stringify(f.replace(/\.mp3$/, '')) + ": 'data:audio/mpeg;base64," +
    buf.toString('base64') + "'");
}

const header =
  '// 自动生成：音频资源以 base64 dataURI 内嵌（由 tools/build_audio.js 从 assets_src/audio 构建）\n' +
  '// 请勿手编；原始素材出处见下方 credits 与 README「音频致谢」\n' +
  'window.Voxel = window.Voxel || {};\n\n' +
  'Voxel.Assets = {\n' +
  '  audio: {\n' + entries.join(',\n') + '\n  },\n' +
  '  credits: ' + JSON.stringify(CREDITS, null, 2).split('\n').join('\n  ') + '\n' +
  '};\n';

fs.writeFileSync(OUT, header);
console.log('已生成 js/assets.js：' + names.length + ' 个音频，原始大小 ' +
  (total / 1024 / 1024).toFixed(2) + ' MB，base64 后约 ' + (total * 4 / 3 / 1024 / 1024).toFixed(2) + ' MB');
