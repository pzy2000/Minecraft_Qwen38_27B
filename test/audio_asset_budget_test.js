#!/usr/bin/env node
// Audio/image startup budget and deterministic lazy-asset contract.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');
const INDEX = path.join(ROOT, 'index.html');
const MANIFEST = path.join(JS, 'assets.js');
const MAX_DIRECT_JS_GZIP = 450 * 1024;
const MAX_MANIFEST = 16 * 1024;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function scriptRefs(html) {
  const refs = [];
  const re = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = re.exec(html))) refs.push(match[1]);
  return refs;
}

function loadManifest() {
  const manifestUrl = pathToFileURL(MANIFEST).href + '?v=test';
  const context = {
    URL,
    console,
    document: { currentScript: { src: manifestUrl }, scripts: [{ src: manifestUrl }] }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(MANIFEST, 'utf8'), context, { filename: MANIFEST });
  return context;
}

function payloadHash(names, audio) {
  const hash = crypto.createHash('sha256');
  names.forEach(name => {
    hash.update(name, 'utf8');
    hash.update(Buffer.from([0]));
    const prefix = 'data:audio/mpeg;base64,';
    assert(audio[name].startsWith(prefix), name + ' must be an MP3 data URI');
    hash.update(Buffer.from(audio[name].slice(prefix.length), 'base64'));
  });
  return hash.digest('hex');
}

function checkAudioManifest() {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build_audio.js'), '--check'], { stdio: 'pipe' });
  const context = loadManifest();
  const assets = context.Voxel.Assets;
  const ids = ['sfx', 'music-day', 'music-night'];

  assert.strictEqual(assets.schemaVersion, 2);
  assert.strictEqual(Object.keys(assets.audio).length, 0, 'menu manifest must contain zero audio payload');
  assert(assets.baseUrl.startsWith('file:'), 'file:// manifest must retain a file base URL');
  assert(assets.baseUrl.endsWith('/js/'), 'baseUrl must name the manifest directory');
  assert.deepStrictEqual(Object.keys(assets.chunks).sort(), ids.slice().sort());
  assert.strictEqual(assets.chunks.sfx.count, 42);
  assert.strictEqual(assets.chunks['music-day'].count, 1);
  assert.strictEqual(assets.chunks['music-night'].count, 1);
  assert.deepStrictEqual(Array.from(assets.chunks['music-day'].names), ['music_day']);
  assert.deepStrictEqual(Array.from(assets.chunks['music-night'].names), ['music_night']);

  const allNames = ids.flatMap(id => Array.from(assets.chunks[id].names));
  assert.strictEqual(new Set(allNames).size, 44, 'every source name belongs to exactly one chunk');
  allNames.forEach(name => assert.strictEqual(assets.audioToChunk[name],
    name === 'music_day' ? 'music-day' : name === 'music_night' ? 'music-night' : 'sfx'));

  ids.forEach(id => {
    const chunk = assets.chunks[id];
    assert(/^[0-9a-f]{64}$/.test(chunk.hash));
    assert(/^[0-9a-f]{64}$/.test(chunk.payloadHash));
    assert.strictEqual(chunk.version, 'sha256-' + chunk.hash);
    assert.strictEqual(chunk.url, assets.baseUrl + chunk.file + '?v=' + chunk.hash);
    assert.strictEqual(sha256(fs.readFileSync(path.join(JS, chunk.file))), chunk.hash,
      id + ' URL hash must cover the complete generated script');
    assert.strictEqual(assets.isChunkLoaded(id), false);
    vm.runInNewContext(fs.readFileSync(path.join(JS, chunk.file), 'utf8'), context,
      { filename: path.join(JS, chunk.file) });
    assert.strictEqual(assets.isChunkLoaded(id), true);
    assert.strictEqual(payloadHash(Array.from(chunk.names), assets.audio), chunk.payloadHash);
    const decodedBytes = Array.from(chunk.names).reduce((sum, name) =>
      sum + Buffer.from(assets.audio[name].slice('data:audio/mpeg;base64,'.length), 'base64').length, 0);
    assert.strictEqual(decodedBytes, chunk.bytes);
  });
  assert.strictEqual(Object.keys(assets.audio).length, 44);
}

function checkStartupBudgets() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const refs = scriptRefs(html).filter(ref => !/^(https?:)?\/\//.test(ref));
  const chunkFiles = ['js/assets-sfx.js', 'js/assets-music-day.js', 'js/assets-music-night.js'];
  chunkFiles.forEach(file => assert(!refs.some(ref => ref.split(/[?#]/)[0] === file),
    file + ' must not be a direct menu script'));

  let directGzip = 0;
  refs.forEach(ref => {
    const file = path.join(ROOT, decodeURIComponent(ref.split(/[?#]/)[0]));
    directGzip += zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
  });
  assert(directGzip <= MAX_DIRECT_JS_GZIP,
    'direct menu JS gzip ' + directGzip + ' exceeds ' + MAX_DIRECT_JS_GZIP);
  assert(fs.statSync(MANIFEST).size <= MAX_MANIFEST,
    'audio manifest exceeds ' + MAX_MANIFEST + ' bytes');
  assert(!fs.readFileSync(MANIFEST, 'utf8').includes('data:audio/'),
    'audio manifest must not embed audio payload');

  const manifestRef = refs.find(ref => ref.startsWith('js/assets.js?'));
  const soundRef = refs.find(ref => ref.startsWith('js/systems/sound.js?'));
  const featuredRef = refs.find(ref => ref.startsWith('js/ui/featured.js?'));
  const mainRef = refs.find(ref => ref.startsWith('js/main.js?'));
  assert(manifestRef && manifestRef.split('?v=')[1] === sha256(fs.readFileSync(MANIFEST)),
    'assets.js query must equal its content hash');
  assert(soundRef && soundRef.split('?v=')[1] === sha256(fs.readFileSync(path.join(JS, 'systems', 'sound.js'))),
    'sound.js query must equal its content hash');
  assert(featuredRef && featuredRef.split('?v=')[1] === sha256(fs.readFileSync(path.join(JS, 'ui', 'featured.js'))),
    'featured.js query must equal its content hash');
  assert(mainRef && mainRef.split('?v=')[1] === sha256(fs.readFileSync(path.join(JS, 'main.js'))),
    'main.js query must equal its content hash');
  const styleHash = sha256(fs.readFileSync(path.join(ROOT, 'css', 'style.css')));
  assert(html.includes('css/style.css?v=' + styleHash),
    'style.css query must equal its content hash');

  return directGzip;
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(tagName, counters) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.children = [];
    this.childNodes = this.children;
    this.parentNode = null;
    this.attributes = {};
    this.classList = new FakeClassList();
    this.className = '';
    this.style = {};
    this.counters = counters;
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index < 0) throw new Error('not a child');
    this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  addEventListener() {}
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  querySelectorAll(selector) {
    const result = [];
    const matches = node => selector === 'img[data-src]' && node.tagName === 'IMG' && node.getAttribute('data-src') !== null;
    const visit = node => {
      node.children.forEach(child => { if (matches(child)) result.push(child); visit(child); });
    };
    visit(this);
    return result;
  }
  set src(value) {
    this.attributes.src = String(value);
    this.counters.srcAssignments++;
  }
  get src() { return this.getAttribute('src') || ''; }
}

function checkFeaturedLazyImages() {
  const counters = { srcAssignments: 0 };
  const make = tag => new FakeElement(tag, counters);
  const elements = {
    'featured-grid': make('div'),
    'overlay-featured': make('div'),
    'overlay-start': make('div')
  };
  const document = {
    createElement: make,
    getElementById(id) { return elements[id] || null; }
  };
  const context = { document, Voxel: {} };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'ui', 'featured.js'), 'utf8'), context,
    { filename: path.join(JS, 'ui', 'featured.js') });

  const initialImages = elements['featured-grid'].querySelectorAll('img[data-src]');
  assert.strictEqual(elements['featured-grid'].children.length, 19, 'cards must be built during initialization');
  assert.strictEqual(initialImages.length, 19);
  initialImages.forEach(image => {
    assert.strictEqual(image.getAttribute('src'), null, 'menu must not request a featured image');
    assert(image.getAttribute('data-src').startsWith('screenshots/biomes/'));
    assert.strictEqual(image.loading, 'lazy');
    assert.strictEqual(image.decoding, 'async');
  });
  assert.strictEqual(counters.srcAssignments, 0);

  const expectedSources = initialImages.map(image => image.getAttribute('data-src'));
  context.Voxel.Featured.show();
  initialImages.forEach((image, index) => {
    assert.strictEqual(image.getAttribute('src'), expectedSources[index]);
    assert.strictEqual(image.getAttribute('data-src'), null);
  });
  assert.strictEqual(counters.srcAssignments, 19);
  context.Voxel.Featured.show();
  assert.strictEqual(counters.srcAssignments, 19, 'later show calls must not hydrate twice');

  const failedImage = initialImages[0];
  const wrap = failedImage.parentNode;
  failedImage.onerror();
  assert.strictEqual(wrap.children.length, 1);
  assert.strictEqual(wrap.children[0].className, 'featured-ph', 'failed image must become a color block');
}

checkAudioManifest();
const directGzip = checkStartupBudgets();
checkFeaturedLazyImages();
console.log('AUDIO-ASSET-BUDGET-PASS direct-js-gzip=' + directGzip +
  ' manifest=' + fs.statSync(MANIFEST).size + ' menu-audio=0 featured-initial=0');
