// 能量辉光后期处理：给飞船引擎、能量纹路与传送门涡流加一层选择性 Bloom。
//
// 场景里除了能量部件，还有雪地/石英这类本来就很亮的方块，所以不能简单地对整屏
// 做泛光。这里的做法是：能量部件的颜色分量乘以增益后超过 1.0，Bloom 的亮度阈值
// 设在 1.0 以上，于是只有被标记为"能量"的部分会发光，普通方块最亮也就 1.0，
// 刚好卡在阈值下。这要求 composer 的 render target 能存超过 1.0 的值（半浮点）。
//
// 三重降级：软件渲染器（CI 的 SwiftShader）直接禁用；"流畅"画质预设关闭；
// 设置面板或 ?bloom=0 手动关。任何一环禁用后都退回原来的 renderer.render。
window.Voxel = window.Voxel || {};

// 色彩分级收尾 pass：柔和 S 曲线对比 + 饱和度提升 + 高光暖/阴影冷分色 + 暗角。
// 场景是 LDR 直出的手调颜色，直接套 ACES 会把中调整体压暗，所以这里不用
// 严格的色调映射，而是只做"收尾"级别的分级：中调几乎不动，黑位和高光
// 更有层次。挂在 composer 最后（renderToScreen 由 EffectComposer 自动指定），
// 与 Bloom 同生共死：软件渲染器/初始化失败时一并退回原始直出。
var ColorGradeShader = {
  // 每个天体可以带自己的分级（profile.grade）；未声明时用这套默认值。
  DEFAULTS: { contrast: 0.30, saturation: 1.07, split: 0.035, vignette: 0.22, lift: 0 },
  uniforms: {
    tDiffuse: { value: null },
    uContrast: { value: 0.30 },
    uSaturation: { value: 1.07 },
    uSplit: { value: 0.035 },
    uVignette: { value: 0.22 },
    uLift: { value: 0 }
  },
  vertexShader: [
    'varying vec2 vUv;',
    'void main(){',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n'),
  fragmentShader: [
    'uniform sampler2D tDiffuse;',
    'uniform float uContrast;',
    'uniform float uSaturation;',
    'uniform float uSplit;',
    'uniform float uVignette;',
    'uniform float uLift;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec3 col = texture2D(tDiffuse, vUv).rgb;',
    // HDR 缓冲里自发光与极光可以远超 1。S 曲线 c²(3-2c) 在 c>1.5 时是负值，
    // 直接喂进去会把过曝的绿色翻成品红斑（曾在极光夜里出现）。这里先做软削波：
    // ≤1 原样通过，>1 渐近压回 1，既不改动 LDR 观感也挡住翻色。
    '  col = max(col, vec3(0.0)) / (1.0 + max(vec3(0.0), col - vec3(1.0)));',
    '  vec3 sm = col * col * (3.0 - 2.0 * col);', // smoothstep 式 S 曲线
    '  col = mix(col, sm, uContrast);',
    '  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));',
    '  col = mix(vec3(luma), col, uSaturation);',
    '  col += (luma - 0.55) * vec3(uSplit, uSplit * 0.15, -uSplit);',
    // 黑位冷抬：极光夜的暗部不塌成死黑，而是留一层冷蓝（长曝光照片的观感）
    '  col += uLift * vec3(0.35, 0.72, 1.0) * (1.0 - smoothstep(0.0, 0.38, luma));',
    '  float d = distance(vUv, vec2(0.5));',
    '  col *= 1.0 - uVignette * smoothstep(0.42, 0.98, d);',
    '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n')
};

Voxel.Bloom = (function () {
  var renderer = null, composer = null, renderPass = null, bloomPass = null, gradePass = null, rt = null;
  var enabled = true, available = false, hdr = false, lastReason = '';

  // WebGL2 的 RGBA16F 是核心可渲染格式；WebGL1 要靠扩展。
  // 注意 WebGL2 里把 RGBA16F 当渲染目标仍需要 EXT_color_buffer_float，
  // 缺了会 framebuffer 不完整（整屏黑掉且不抛异常）——缺就退回 LDR 路径，功能不受影响。
  function detectHDR(gl) {
    if (!gl) return false;
    try {
      if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext)
        return !!gl.getExtension('EXT_color_buffer_float');
      return !!gl.getExtension('EXT_color_buffer_half_float');
    } catch (e) { return false; }
  }

  // 软件渲染器上多 render target + 全屏 pass 会直接拖垮帧率，索性不开。
  function isSoftware(gl) {
    try {
      var ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      var name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
      return /swiftshader|llvmpipe|softpipe|software|microsoft basic/i.test(name);
    } catch (e) { return false; }
  }

  function init(r, scene, camera, options) {
    options = options || {};
    renderer = r;
    available = false;
    if (!renderer || !scene || !camera || !window.THREE) { lastReason = '缺少渲染器或场景'; return false; }
    if (!THREE.EffectComposer || !THREE.RenderPass || !THREE.UnrealBloomPass) {
      lastReason = '后期处理模块未加载';
      return false;
    }
    try {
      var size = renderer.getSize(new THREE.Vector2());
      var pr = renderer.getPixelRatio();
      var w = Math.max(1, Math.floor(size.width * pr));
      var h = Math.max(1, Math.floor(size.height * pr));
      var gl = renderer.getContext ? renderer.getContext() : null;
      if (isSoftware(gl) && !options.force) { lastReason = '软件渲染器，已禁用'; return false; }
      hdr = detectHDR(gl);
      rt = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
        stencilBuffer: false,
        depthBuffer: true
      });
      composer = new THREE.EffectComposer(renderer, rt);
      composer.setSize(w, h);
      renderPass = new THREE.RenderPass(scene, camera);
      composer.addPass(renderPass);
      // 阈值是选择性的关键：HDR 模式下卡在 1.0 以上，只有能量部件够亮；
      // 不支持半浮点时降到 0.85，靠"比雪地更亮"来区分，效果打折但不至于全屏泛光。
      bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(w, h),
        finiteOption(options.strength, 0.62, 0, 3),
        finiteOption(options.radius, 0.55, 0, 1),
        hdr ? finiteOption(options.threshold, 1.15, 0, 4) : 0.85
      );
      composer.addPass(bloomPass);
      if (THREE.ShaderPass) {
        gradePass = new THREE.ShaderPass(ColorGradeShader);
        composer.addPass(gradePass);
      }
      available = true;
      lastReason = '';
      return true;
    } catch (e) {
      lastReason = '初始化失败：' + (e && e.message ? e.message : String(e));
      available = false;
      return false;
    }
  }

  function finiteOption(v, fallback, min, max) {
    var n = Number(v);
    if (!isFinite(n)) n = fallback;
    return Math.max(min, Math.min(max, n));
  }

  function setEnabled(v) {
    enabled = !!v;
    if (bloomPass) bloomPass.enabled = enabled;
  }

  // 天体级分级覆盖：传 null 恢复默认。Bloom 未初始化时静默忽略
  //（分级 pass 与 composer 同生共死，无 composer 时画面是直出的）。
  function setGrade(g) {
    if (!gradePass) return false;
    var d = ColorGradeShader.DEFAULTS;
    var u = gradePass.uniforms;
    g = g || d;
    u.uContrast.value = finiteOption(g.contrast, d.contrast, 0, 1);
    u.uSaturation.value = finiteOption(g.saturation, d.saturation, 0.5, 2);
    u.uSplit.value = finiteOption(g.split, d.split, 0, 0.3);
    u.uVignette.value = finiteOption(g.vignette, d.vignette, 0, 0.8);
    u.uLift.value = finiteOption(g.lift, d.lift, 0, 0.2);
    return true;
  }

  // 传自定义 renderTarget 时 EffectComposer 的 _pixelRatio 固定为 1，
  // 所以这里要自己把 CSS 尺寸换算成设备像素。
  function setSize(cssWidth, cssHeight, pixelRatio) {
    if (!composer) return;
    var pr = Number(pixelRatio) || 1;
    composer.setSize(Math.max(1, Math.floor(cssWidth * pr)), Math.max(1, Math.floor(cssHeight * pr)));
  }

  // 返回 true 表示这一帧已经由 composer 画完，调用方不要再走 renderer.render。
  function render(deltaTime) {
    if (!available || !enabled || !composer) return false;
    composer.render(deltaTime || 0);
    return true;
  }

  function active() { return !!(available && enabled); }

  function reason() { return lastReason; }

  function dispose() {
    if (bloomPass && typeof bloomPass.dispose === 'function') bloomPass.dispose();
    if (gradePass && typeof gradePass.dispose === 'function') gradePass.dispose();
    if (rt && typeof rt.dispose === 'function') rt.dispose();
    if (composer && composer.renderTarget1) composer.renderTarget1.dispose();
    if (composer && composer.renderTarget2) composer.renderTarget2.dispose();
    renderer = null; composer = null; renderPass = null; bloomPass = null; gradePass = null; rt = null;
    available = false;
  }

  return {
    init: init,
    setEnabled: setEnabled,
    setGrade: setGrade,
    setSize: setSize,
    render: render,
    dispose: dispose,
    active: active,
    reason: reason,
    hdr: function () { return hdr; }
  };
})();
