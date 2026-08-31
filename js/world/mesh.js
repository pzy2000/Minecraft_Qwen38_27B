// 区块网格构建：隐藏面剔除 + 顶点环境光遮蔽(AO) + 双通道光照（天光×昼夜 / 块光）
// 实时光影：树叶独立几何组（顶点风摇）+ 树叶实时投影（正交深度图 PCF）
//           + 程序化云影（与可见云层同向漂移）+ 太阳方向 wrap-diffuse 侧光
window.Voxel = window.Voxel || {};

Voxel.MeshBuilder = (function () {
  var B = null;
  var G = null, GSky = null, GBlk = null;
  var texture, opaqueMat, waterMat, foliageMat;
  var mats = [];          // 全部地形材质（uniform 批量更新用）
  var inited = false;
  var UVK = [[0, 0], [1, 0], [1, 1], [0, 1]];
  // n: 法线, u/v: 切线, c: 4 顶点局部坐标, b: 基础亮度
  var FACES = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], b: 0.7 },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], b: 0.7 },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], b: 1.0 },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], b: 0.55 },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], b: 0.85 },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], b: 0.85 }
  ];
  var AO = [0.5, 0.72, 0.86, 1.0];
  var tmpUV = [0, 0];
  // 当前正在发射的方块的面标记（build 每个体素设一次，emit* 系列直接取用）：
  // curEmit=1 表示高发光方块（交给 Bloom 阈值），curWater=1 表示水体。
  var curEmit = 0, curWater = 0;
  // 自发光门槛：只有火把级以上（≥12）才越过 Bloom 阈值，
  // 金饰块(2)/辉光饰条(7) 这类弱发光装饰不参与，否则城堡整体泛光。
  var EMIT_MIN_LIGHT = 12;
  // 默认绑定的 1×1 白色纹理：阴影关闭时保证采样器完整（部分驱动对未绑定采样器告警）
  var whiteTex = null;
  function makeWhiteTex() {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    var cx2 = cv.getContext('2d');
    cx2.fillStyle = '#fff';
    cx2.fillRect(0, 0, 1, 1);
    var t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    return t;
  }

  // 树叶风摇位移场：以世界坐标为自变量的连续函数——相邻面共享的顶点位移一致，天然无裂缝。
  // 主视图与阴影深度 pass 必须引用同一份代码，影子才会跟着叶子一起晃。
  var SWAY_GLSL = [
    'vec3 voxelSway(vec3 wp, float t, vec2 wind, float amp){',
    '  float ph1 = dot(wp.xz, vec2(0.11, 0.13));',
    '  float ph2 = dot(wp.xz, vec2(-0.07, 0.17));',
    '  float s1 = sin(t * 1.6 + ph1);',
    '  float s2 = sin(t * 2.7 + ph2);',
    '  return vec3(',
    '    wind.x * (s1 * 0.6 + s2 * 0.4),',
    '    (s2 - s1) * 0.22,',
    '    wind.y * (-s1 * 0.45 + s2 * 0.55)',
    '  ) * amp;',
    '}'
  ].join('\n');

  var VERT = [
    'attribute vec3 acolor;',
    'attribute vec2 alight;',
    'attribute vec3 anrm;',
    // x=自发光增益开关(0/1)，y=水面标记(0/1，与玻璃同组但只有水做反射)
    'attribute vec2 aflag;',
    'uniform mat4 uShadowMat;',
    '#ifdef SWAY',
    'uniform float uTime;',
    'uniform vec2 uWind;',
    'uniform float uSwayAmp;',
    SWAY_GLSL,
    '#endif',
    'varying vec2 vUv;',
    'varying vec3 vCol;',
    'varying vec2 vL;',
    'varying float vDepth;',
    'varying vec3 vNrm;',
    'varying vec3 vWPos;',
    'varying vec2 vFlag;',
    'varying vec4 vShadowCoord;',
    'void main(){',
    '  vUv = uv; vCol = acolor; vL = alight; vNrm = anrm; vFlag = aflag;',
    '  vec3 p = position;',
    '  #ifdef SWAY',
    '  p += voxelSway(p, uTime, uWind, uSwayAmp);',
    '  #endif',
    '  vWPos = p;',
    '  vShadowCoord = uShadowMat * vec4(p, 1.0);',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  vDepth = -mv.z;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  // 距离雾 + 谷雾：谷雾只在距离雾之外**追加**遮蔽，且随高度指数衰减，
  // 于是湖面/沙丘起雾而雪脊峰顶露出（uFogHeightStr=0 时退化为纯距离雾）。
  var FOG_GLSL = [
    'float fogAmount(){',
    '  float f = smoothstep(uFogNear, uFogFar, vDepth);',
    '  if (uFogHeightStr <= 0.001) return f;',
    '  float hz = exp(-max(0.0, vWPos.y - uFogBase) / max(1.0, uFogFalloff));',
    // 谷雾按距离迟起：近处保持清晰，只有中远景才蒙上雾，
    // 否则脚下的水面也会糊成一片、整屏读成灰。
    '  float d = smoothstep(uFogFar * 0.3, uFogFar * 1.05, vDepth);',
    '  return clamp(f + (1.0 - f) * uFogHeightStr * hz * d, 0.0, 1.0);',
    '}'
  ].join('\n');

  // 块光染色：火把/灯笼主导的表面偏暖，天光主导的表面不动。
  // 避免引入真实点光源（本项目全程零 THREE.*Light）也能得到暖光池。
  var BLKTINT_GLSL = [
    'vec3 blkTint(){',
    '  float skyPart = vL.x * sun;',
    '  float share = vL.y / max(1e-4, max(skyPart, vL.y) + skyPart * 0.6);',
    '  return mix(vec3(1.0), uBlkTint, clamp(share, 0.0, 1.0));',
    '}'
  ].join('\n');

  function frag(cut) {
    return [
      'uniform sampler2D map;',
      'uniform vec3 tint;',
      'uniform float sun;',
      'uniform vec3 uFogColor;',
      'uniform float uFogNear;',
      'uniform float uFogFar;',
      'uniform float uFogBase;',
      'uniform float uFogFalloff;',
      'uniform float uFogHeightStr;',
      'uniform float uAlpha;',
      'uniform sampler2D uShadowTex;',
      'uniform vec3 uSunDir;',
      'uniform float uShadowStr;',
      'uniform float uShadowSize;',
      'uniform vec2 uCloudDrift;',
      'uniform float uCloudStr;',
      'uniform float uDirStr;',
      'uniform vec3 uBlkTint;',
      'uniform float uEmitGain;',
      'uniform float uExposure;',
      'varying vec2 vUv;',
      'varying vec3 vCol;',
      'varying vec2 vL;',
      'varying float vDepth;',
      'varying vec3 vNrm;',
      'varying vec3 vWPos;',
      'varying vec2 vFlag;',
      'varying vec4 vShadowCoord;',
      // 深度图 RGBA 三通道打包（WebGL1 兼容，不依赖 depth texture 扩展）
      'float unpackD(vec4 c){ return dot(c, vec4(1.0, 1.0/255.0, 1.0/65025.0, 1.0/16581375.0)); }',
      // 树叶实时投影：正交深度图 PCF 2×2 软采样
      'float leafShadow(){',
      '  if (uShadowStr <= 0.001) return 1.0;',
      '  vec3 sc = vShadowCoord.xyz;',
      '  if (sc.x < 0.002 || sc.x > 0.998 || sc.y < 0.002 || sc.y > 0.998 || sc.z >= 0.999) return 1.0;',
      '  float bias = 0.0016 + 0.0035 * (1.0 - max(dot(vNrm, uSunDir), 0.0));',
      '  vec2 ts = vec2(1.0 / uShadowSize);',
      '  float sum = 0.0;',
      '  for (int i = 0; i < 2; i++) {',
      '    for (int j = 0; j < 2; j++) {',
      '      float d = unpackD(texture2D(uShadowTex, sc.xy + vec2(float(i) - 0.5, float(j) - 0.5) * ts));',
      '      sum += step(sc.z - bias, d);',
      '    }',
      '  }',
      '  return mix(1.0, mix(0.42, 1.0, sum * 0.25), uShadowStr);',
      '}',
      // 程序化云影：大尺度多层噪声，与可见云层同向漂移（零额外 draw call）
      'float cloudShadow(){',
      '  if (uCloudStr <= 0.001) return 1.0;',
      '  vec2 q = vWPos.xz * 0.010 + uCloudDrift * 0.010;',
      '  float n = sin(q.x) * sin(q.y);',
      '  n += 0.55 * sin(q.x * 2.17 + 1.7) * sin(q.y * 1.93 - 0.4);',
      '  n += 0.34 * sin(q.x * 3.9 - 2.3) * sin(q.y * 4.6 + 2.1);',
      '  float c = smoothstep(-0.15, 0.75, n);',
      '  return mix(1.0, mix(0.80, 1.0, c), uCloudStr);',
      '}',
      FOG_GLSL,
      BLKTINT_GLSL,
      'void main(){',
      '  vec4 tex = texture2D(map, vUv);',
      '  if (tex.a < ' + cut + ') discard;',
      '  float br = max(vL.x * sun, vL.y);',
      // 太阳方向 wrap-diffuse：晨昏侧光明暗（夜晚由 uDirStr 压平为均匀月光感）
      '  float nl = clamp(dot(vNrm, uSunDir) * 0.62 + 0.38, 0.0, 1.0);',
      '  br *= mix(1.0, mix(0.87, 1.09, nl), uDirStr);',
      '  br = 0.05 + 0.95 * pow(br, 1.35);',
      // 实时树影只作用于天光主导的露天表面：
      // 树冠正下方/洞穴已由烘焙天光变暗，再叠加会双重压黑
      '  float shade = cloudShadow();',
      '  float sm = smoothstep(0.30, 0.80, vL.x);',
      '  shade *= 1.0 - (1.0 - leafShadow()) * sm;',
      '  vec3 c = tex.rgb * vCol * tint * br * shade * blkTint();',
      // 自发光增益：只有被标记的高发光方块超过 1.0，交给 Bloom 的选择性阈值
      '  c *= (1.0 + vFlag.x * uEmitGain) * uExposure;',
      // 曝光在雾之前施加：雾色本身就是天空色，已经是"正确曝光"的
      '  gl_FragColor = vec4(mix(c, uFogColor, fogAmount()), tex.a * uAlpha);',
      '}'
    ].join('\n');
  }

  function mkMat(alpha, cut, opts) {
    opts = opts || {};
    var m = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        tint: { value: new THREE.Color(1, 1, 1) },
        sun: { value: 1 },
        uFogColor: { value: new THREE.Color(0x87ceeb) },
        uFogNear: { value: 60 },
        uFogFar: { value: 240 },
        uFogBase: { value: 0 },
        uFogFalloff: { value: 32 },
        uFogHeightStr: { value: 0 },
        uBlkTint: { value: new THREE.Color(1, 1, 1) },
        uEmitGain: { value: 0 },
        uExposure: { value: 1 },
        uAlpha: { value: alpha },
        uShadowTex: { value: whiteTex },
        uShadowMat: { value: new THREE.Matrix4() },
        uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
        uShadowStr: { value: 0 },
        uShadowSize: { value: 1024 },
        uCloudDrift: { value: new THREE.Vector2(0, 0) },
        uCloudStr: { value: 0 },
        uDirStr: { value: 0 },
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector2(1, 0) },
        uSwayAmp: { value: 0.03 }
      },
      vertexShader: VERT,
      fragmentShader: frag(cut),
      transparent: !!opts.transparent,
      depthWrite: !opts.transparent,
      side: THREE.FrontSide,
      defines: opts.sway ? { SWAY: '' } : {}
    });
    mats.push(m);
    return m;
  }

  // ---- 水面材质 ----
  //
  // 水原本与地形共用一套着色，只是半透明贴图，所以既没有掠射角反射也没有
  // 涟漪——峡湾镜湖和湿黑沙的观感全靠这两样。这里不做屏幕空间/平面镜像，
  // 而是解析式反射：由反射方向查天穹渐变，再叠加极光带的方位角贡献。
  // 成本是几条三角函数，任何画质档都开得起；uReflect=0 时退回原来的样子。
  var WATER_FRAG = [
    'uniform sampler2D map;',
    'uniform vec3 tint;',
    'uniform float sun;',
    'uniform vec3 uFogColor;',
    'uniform float uFogNear;',
    'uniform float uFogFar;',
    'uniform float uFogBase;',
    'uniform float uFogFalloff;',
    'uniform float uFogHeightStr;',
    'uniform float uAlpha;',
    'uniform vec3 uSunDir;',
    'uniform float uDirStr;',
    'uniform vec3 uBlkTint;',
    'uniform float uEmitGain;',
    'uniform float uExposure;',
    'uniform vec3 uCamPos;',
    'uniform vec3 uSkyTop;',
    'uniform vec3 uSkyHorizon;',
    'uniform vec3 uDeepColor;',
    'uniform float uDeepMix;',
    'uniform vec3 uAurColor;',
    // 每条极光帘：x=方位中心(rad) y=半张角 z=强度 w=保留
    'uniform vec4 uAurBands[3];',
    'uniform float uReflect;',
    'uniform float uSkyMix;',
    'uniform float uRipple;',
    'uniform float uWaterTime;',
    'varying vec2 vUv;',
    'varying vec3 vCol;',
    'varying vec2 vL;',
    'varying float vDepth;',
    'varying vec3 vNrm;',
    'varying vec3 vWPos;',
    'varying vec2 vFlag;',
    'varying vec4 vShadowCoord;',
    FOG_GLSL,
    BLKTINT_GLSL,
    // 极长波长的双层扰动：参考照片里的湖面近乎静止，幅度必须很小，
    // 否则反射会碎成噪点而不是长条倒影。
    'vec3 rippleNormal(){',
    '  if (uRipple <= 0.001) return vNrm;',
    '  vec2 q = vWPos.xz;',
    '  float t = uWaterTime;',
    '  float nx = sin(q.x * 0.29 + t * 0.33) * 0.6 + sin(q.x * 0.11 - q.y * 0.08 + t * 0.19) * 0.4;',
    '  float nz = sin(q.y * 0.25 - t * 0.27) * 0.6 + sin(q.y * 0.09 + q.x * 0.07 + t * 0.15) * 0.4;',
    '  return normalize(vec3(nx * uRipple, 1.0, nz * uRipple));',
    '}',
    // 反射方向落在某条光帘的方位扇区内时加色。掠射反射看到的是靠近地平线的
    // 天空，而绿帘本身就一直压到山脊上方，所以 elev 的下界给得很松——
    // 否则近水平的倒影拿不到极光，湖面在夜里会读成黑洞。
    'vec3 auroraReflect(vec3 R){',
    '  float az = atan(R.x, -R.z);',
    '  float elev = smoothstep(-0.02, 0.25, R.y);',
    '  float acc = 0.0;',
    '  for (int i = 0; i < 3; i++) {',
    '    vec4 bd = uAurBands[i];',
    '    if (bd.z <= 0.001) continue;',
    '    float d = abs(az - bd.x);',
    '    if (d > 3.14159265) d = 6.28318531 - d;',
    '    acc += bd.z * (1.0 - smoothstep(bd.y * 0.35, bd.y, d));',
    '  }',
    // 0.5 是"倒影总比光源暗"的经验系数：不压的话湖面会比天上的绿帘更亮，
    // 整片水读成荧光绿。
    '  return uAurColor * clamp(acc, 0.0, 1.0) * elev * 0.5;',
    '}',
    'void main(){',
    '  vec4 tex = texture2D(map, vUv);',
    '  if (tex.a < 0.02) discard;',
    '  float br = max(vL.x * sun, vL.y);',
    '  float nl = clamp(dot(vNrm, uSunDir) * 0.62 + 0.38, 0.0, 1.0);',
    '  br *= mix(1.0, mix(0.87, 1.09, nl), uDirStr);',
    '  br = 0.05 + 0.95 * pow(br, 1.35);',
    // 曝光只作用于水体自身：反射项取的是天穹色，天穹由自己的着色器绘制、
    // 不过曝光，若一起放大湖面会比它反射的天空还亮。
    '  vec3 body = tex.rgb * vCol * tint * br * blkTint() * uExposure;',
    '  float a = tex.a * uAlpha;',
    // 只有朝上的水面做反射：玻璃/彩玻与水同组，靠 vFlag.y 区分；
    // 水的侧面也维持原样，避免与相邻地形出现接缝色差
    '  float upper = vFlag.y * step(0.5, vNrm.y);',
    '  if (upper * uReflect > 0.001) {',
    '    vec3 N = rippleNormal();',
    '    vec3 V = normalize(uCamPos - vWPos);',
    '    float ndv = clamp(dot(N, V), 0.0, 1.0);',
    // 菲涅尔：只有很掠射时才接近全镜，近处水面保留自己的贴图色
    '    float fres = pow(1.0 - ndv, 4.2);',
    '    vec3 R = reflect(-V, N);',
    '    vec3 refl = mix(uSkyHorizon, uSkyTop, clamp(R.y * 1.7, 0.0, 1.0));',
    '    refl += auroraReflect(R);',
    // 深水压暗：仅当主题声明了 deepWater（uDeepMix>0）时启用，
    // 默认 0，未声明主题的水面观感与旧版逐像素一致。
    '    if (uDeepMix > 0.001)',
    '      body = mix(body, uDeepColor * (0.45 + 0.55 * br), ndv * uDeepMix);',
    // uSkyMix 是"水体散射天光"的基底：纯菲涅尔在俯视角只有 3% 反射率，
    // 但真实水面之所以在暮色里发亮，主要是水体散射天光而非镜面反射。
    // 没有它，湖面在夜景里会读成黑洞（也就看不到极光倒影）。
    '    float k = clamp(uSkyMix + fres * (1.0 - uSkyMix), 0.0, 1.0) * uReflect * 0.85;',
    '    body = mix(body, refl, k);',
    '    a = mix(a, 0.96, k);',
    '  }',
    '  body *= 1.0 + vFlag.x * uEmitGain;',
    '  gl_FragColor = vec4(mix(body, uFogColor, fogAmount()), a);',
    '}'
  ].join('\n');

  function mkWaterMat() {
    var m = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        tint: { value: new THREE.Color(1, 1, 1) },
        sun: { value: 1 },
        uFogColor: { value: new THREE.Color(0x87ceeb) },
        uFogNear: { value: 60 },
        uFogFar: { value: 240 },
        uFogBase: { value: 0 },
        uFogFalloff: { value: 32 },
        uFogHeightStr: { value: 0 },
        uBlkTint: { value: new THREE.Color(1, 1, 1) },
        uEmitGain: { value: 0 },
        uExposure: { value: 1 },
        uAlpha: { value: 1 },
        uShadowMat: { value: new THREE.Matrix4() },
        uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
        uDirStr: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uSkyTop: { value: new THREE.Color(0x87ceeb) },
        uSkyHorizon: { value: new THREE.Color(0x87ceeb) },
        uDeepColor: { value: new THREE.Color(0x11384f) },
        uDeepMix: { value: 0 },
        uAurColor: { value: new THREE.Color(0, 0, 0) },
        uAurBands: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
        uReflect: { value: 0 },
        uSkyMix: { value: 0.05 },
        uRipple: { value: 0.05 },
        uWaterTime: { value: 0 }
      },
      vertexShader: VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide
    });
    mats.push(m);
    return m;
  }

  function init() {
    B = Voxel.Blocks;
    G = Voxel.World.get;
    GSky = Voxel.World.getSky;
    GBlk = Voxel.World.getBlk;
    texture = B.getTexture();
    whiteTex = makeWhiteTex();
    opaqueMat = mkMat(1, '0.5', {});
    waterMat = mkWaterMat();
    foliageMat = mkMat(1, '0.5', { sway: true });
    inited = true;
  }

  function tileUV(tile, ux, uy) {
    var tpr = Voxel.Blocks.TILES_PER_ROW || 16;
    var asz = Voxel.Blocks.ATLAS_SIZE || 256;
    var c = tile % tpr, r = (tile / tpr) | 0;
    tmpUV[0] = (c * 16 + 0.5 + ux * 15) / asz;
    tmpUV[1] = 1 - (r * 16 + 0.5 + (1 - uy) * 15) / asz;
  }

  // 单顶点平滑光照：对面朝格 N 及其两个侧邻、角邻共 4 格采样（不透明格不参与平均，
  // 但通过 AO 因子变暗）；返回该顶点的天光/块光与 AO 等级
  function vertexLight(x, y, z, F, au, av, aw, bu, bv, bw) {
    var bx = x + F.n[0], by = y + F.n[1], bz = z + F.n[2];
    var ox1 = bx + au, oy1 = by + av, oz1 = bz + aw;
    var ox2 = bx + bu, oy2 = by + bv, oz2 = bz + bw;
    var oxc = bx + au + bu, oyc = by + av + bv, ozc = bz + aw + bw;
    var s1 = B.isOpaque(G(ox1, oy1, oz1)) ? 1 : 0;
    var s2 = B.isOpaque(G(ox2, oy2, oz2)) ? 1 : 0;
    var sc = B.isOpaque(G(oxc, oyc, ozc)) ? 1 : 0;
    var aoIdx = (s1 && s2) ? 3 : s1 + s2 + sc;
    var sky = GSky(bx, by, bz), blk = GBlk(bx, by, bz), n = 1;
    if (!s1) { sky += GSky(ox1, oy1, oz1); blk += GBlk(ox1, oy1, oz1); n++; }
    if (!s2) { sky += GSky(ox2, oy2, oz2); blk += GBlk(ox2, oy2, oz2); n++; }
    if (!sc && !(s1 && s2)) { sky += GSky(oxc, oyc, ozc); blk += GBlk(oxc, oyc, ozc); n++; }
    vLight.ls = sky / (n * 15);
    vLight.lb = blk / (n * 15);
    vLight.ao = aoIdx;
    return vLight;
  }
  var vLight = { ls: 0, lb: 0, ao: 0 };

  // ---- 填充式快速采样（P0，空间换时间）----
  // 构建前把目标区块及 3×3 邻居的 blocks/sky/blk 拷入模块级复用的草稿缓冲
  // (34×66×34 ≈ 229KB×3)，构建期间所有体素/光照/AO 查询都是纯 TypedArray
  // 读取——消除旧路径上每体素"两次字符串拼接 + 哈希查找"的门面开销。
  // 未加载列的默认值（石/天光15/无块光）与全局门面语义逐位一致。
  var PW = 0, PH = 0;
  var bPad = null, sPad = null, pPad = null;
  var padX0 = 0, padZ0 = 0;

  function ensurePad(CS, H) {
    var w = CS + 2, h = H + 2;
    if (bPad && bPad.length === w * h * w) return;
    PW = w; PH = h;
    bPad = new Uint16Array(PW * PH * PW);
    sPad = new Uint8Array(PW * PH * PW);
    pPad = new Uint8Array(PW * PH * PW);
  }

  function padG(wx, wy, wz) {
    return bPad[(wx - padX0 + 1) + PW * (wy + 1 + PH * (wz - padZ0 + 1))];
  }
  function padSky(wx, wy, wz) {
    return sPad[(wx - padX0 + 1) + PW * (wy + 1 + PH * (wz - padZ0 + 1))];
  }
  function padBlk(wx, wy, wz) {
    return pPad[(wx - padX0 + 1) + PW * (wy + 1 + PH * (wz - padZ0 + 1))];
  }

  function fillPad(cx, cz) {
    var CFG = Voxel.Config;
    var H = CFG.WORLD_H, CS = CFG.CHUNK;
    ensurePad(CS, H);
    padX0 = cx * CS; padZ0 = cz * CS;
    // 默认=未加载语义；就绪区块的列随后整列覆盖（含 y=0..H-1 全行）
    bPad.fill(12); sPad.fill(15); pPad.fill(0);
    var n33 = [];
    if (Voxel.World.buildChunkArrays) {
      for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++)
        n33.push(Voxel.World.buildChunkArrays(cx + dx, cz + dz));
    }
    var core = Voxel.World.buildCoreArrays ? Voxel.World.buildCoreArrays() : null;
    var CW = core ? core.W : 0, CD = core ? core.D : 0;
    var CSH = CS * H, CHW = CW * H;
    // 门面回退（fillPad 发生在采样器切换前，G/GSky/GBlk 仍是全局门面）：
    // 覆盖"无直接数组且不在核心范围内"的列——如未加载边缘、光照未初始化的核心。
    // 未加载时门面返回 12/15/0，与默认填充一致，语义永远不劣于旧路径。
    var fg = G || Voxel.World.get, fsky = GSky || Voxel.World.getSky, fblk = GBlk || Voxel.World.getBlk;
    for (var lz = -1; lz <= CS; lz++) {
      var wz = padZ0 + lz;
      for (var lx = -1; lx <= CS; lx++) {
        var wx = padX0 + lx;
        var ccx = Math.floor(wx / CS), ccz = Math.floor(wz / CS);
        var src = null;
        if (ccx >= cx - 1 && ccx <= cx + 1 && ccz >= cz - 1 && ccz <= cz + 1)
          src = n33[(ccz - cz + 1) * 3 + (ccx - cx + 1)];
        var dstCol = (lx + 1) + PW * PH * (lz + 1);
        if (src) {
          // 外围区块：chunkIndex(lx,y,lz)=lx+CS*(y+H*lz) → 列基址 lx+CS*H*lz，y 步长 CS
          var slx = wx - ccx * CS, slz = wz - ccz * CS;
          var sBase = slx + CSH * slz;
          for (var y = 1; y <= H; y++) {
            var di = dstCol + PW * y, si = sBase + CS * (y - 1);
            bPad[di] = src.blocks[si]; sPad[di] = src.sky[si]; pPad[di] = src.blk[si];
          }
        } else if (core && wx >= 0 && wx < CW && wz >= 0 && wz < CD) {
          // legacy 核心：idx(x,y,z)=x+W*(y+H*z) → 列基址 x+W*H*z，y 步长 W；
          // 块光需叠加外围火把进入核心的 overlay
          var cBase = wx + CHW * wz;
          var ov = core.overlay;
          for (var y2 = 1; y2 <= H; y2++) {
            var di2 = dstCol + PW * y2, ci = cBase + CW * (y2 - 1);
            bPad[di2] = core.data[ci]; sPad[di2] = core.sky[ci];
            var bl = core.blk[ci];
            pPad[di2] = ov && ov[ci] > bl ? ov[ci] : bl;
          }
        } else {
          for (var y3 = 1; y3 <= H; y3++) {
            var di3 = dstCol + PW * y3;
            bPad[di3] = fg(wx, y3 - 1, wz);
            sPad[di3] = fsky(wx, y3 - 1, wz);
            pPad[di3] = fblk(wx, y3 - 1, wz);
          }
        }
      }
    }
    // y=-1 行：实体石 + 无光（底面 AO 采样）；y=H 行：空气 + 满天光
    for (var iz = 0; iz < PW; iz++) {
      var rBot = PW * PH * iz, rTop = rBot + PW * (H + 1);
      for (var ix = 0; ix < PW; ix++) {
        bPad[rBot + ix] = 12; sPad[rBot + ix] = 0; pPad[rBot + ix] = 0;
        bPad[rTop + ix] = 0; sPad[rTop + ix] = 15; pPad[rTop + ix] = 0;
      }
    }
    // 最高非空气行（只扫中心区块本体）：网格主循环据此截断，上方必为空气
    for (var yy = H; yy >= 1; yy--) {
      var rowOfs = PW * yy;
      for (var iz2 = 1; iz2 < PW - 1; iz2++) {
        var rb = rowOfs + PW * PH * iz2 + 1;
        for (var ix2 = 0; ix2 < PW - 2; ix2++)
          if (bPad[rb + ix2] !== 0) return yy - 1;
      }
    }
    return 0;
  }

  // 发射一个面：yBot/yTop 为底/顶边绝对高度，uvLo/uvHi 为纹理 V 范围
  // （整块=y..y+1/0..1；床=y..y+0.5/0..1；邻居为床时只发上半面 y+0.5..y+1/0.5..1）
  // ls/lb: 面所朝格子的天光/块光（兜底值）
  function emitFace(t, F, tile, x, y, z, yBot, yTop, uvLo, uvHi, ls, lb) {
    var base = t.pos.length / 3;
    var aoArr = [0, 0, 0, 0];
    for (var k = 0; k < 4; k++) {
      var corner = F.c[k];
      t.pos.push(x + corner[0], y + (corner[1] ? yTop - y : yBot - y), z + corner[2]);
      t.nrm.push(F.n[0], F.n[1], F.n[2]);

      var uvx = UVK[k][0], uvy = UVK[k][1];
      tileUV(tile, uvx, uvy ? uvHi : uvLo);
      t.uv.push(tmpUV[0], tmpUV[1]);

      var au = (uvx ? F.u[0] : -F.u[0]);
      var av = (uvx ? F.u[1] : -F.u[1]);
      var aw = (uvx ? F.u[2] : -F.u[2]);
      var bu = (uvy ? F.v[0] : -F.v[0]);
      var bv = (uvy ? F.v[1] : -F.v[1]);
      var bw = (uvy ? F.v[2] : -F.v[2]);
      var vl = vertexLight(x, y, z, F, au, av, aw, bu, bv, bw);
      aoArr[k] = vl.ao;
      var shade = F.b * AO[vl.ao];
      t.col.push(shade, shade, shade);
      t.lgt.push(vl.ls, vl.lb);
      t.flg.push(curEmit, curWater);
    }
    // AO 各向异性：按对角和选择四边形剖分对角线，避免遮蔽插值出现三角面痕迹
    if (aoArr[0] + aoArr[2] > aoArr[1] + aoArr[3]) {
      t.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      t.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    }
  }

  // 子盒发射器（门/活板门/台阶/楼梯等薄板形状）：box=[x0,y0,z0,x1,y1,z1] 格内局部坐标。
  // 面剔除：面恰好贴格边界且邻格不透明 → 跳过；其余 6 面照常发射（含 AO/平滑光照）。
  function emitBoxInner(t, def, id, x, y, z, b) {
    var bx0 = b[0], by0 = b[1], bz0 = b[2], bx1 = b[3], by1 = b[4], bz1 = b[5];
    for (var f = 0; f < 6; f++) {
      var F = FACES[f];
      var nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
      // 面位置：沿法线轴的盒边界
      var ext;
      if (F.n[0]) ext = F.n[0] > 0 ? bx1 : bx0;
      else if (F.n[1]) ext = F.n[1] > 0 ? by1 : by0;
      else ext = F.n[2] > 0 ? bz1 : bz0;
      var bound = (F.n[0] || F.n[1] || F.n[2]) > 0 ? 1 : 0;
      if (Math.abs(ext - bound) < 1e-6 && B.isOpaque(G(nx, ny, nz))) continue;

      var tile = B.tileForFace(id, f);
      var ls = GSky(nx, ny, nz) / 15;
      var lb = GBlk(nx, ny, nz) / 15;
      var base = t.pos.length / 3;
      var aoArr = [0, 0, 0, 0];
      for (var k = 0; k < 4; k++) {
        var c = F.c[k];
        t.pos.push(
          x + (c[0] ? bx1 : bx0),
          y + (c[1] ? by1 : by0),
          z + (c[2] ? bz1 : bz0));
        t.nrm.push(F.n[0], F.n[1], F.n[2]);

        var uvx = UVK[k][0], uvy = UVK[k][1];
        tileUV(tile, uvx, uvy);
        t.uv.push(tmpUV[0], tmpUV[1]);

        var au = (uvx ? F.u[0] : -F.u[0]);
        var av = (uvx ? F.u[1] : -F.u[1]);
        var aw = (uvx ? F.u[2] : -F.u[2]);
        var bu = (uvy ? F.v[0] : -F.v[0]);
        var bv = (uvy ? F.v[1] : -F.v[1]);
        var bw = (uvy ? F.v[2] : -F.v[2]);
        var vl = vertexLight(x, y, z, F, au, av, aw, bu, bv, bw);
        aoArr[k] = vl.ao;
        var shade = F.b * AO[vl.ao];
        t.col.push(shade, shade, shade);
        t.lgt.push(vl.ls, vl.lb);
        t.flg.push(curEmit, curWater);
      }
      if (aoArr[0] + aoArr[2] > aoArr[1] + aoArr[3]) {
        t.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      } else {
        t.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
      }
    }
  }

  // 连接型形状（栅栏/玻璃板）：中心柱 + 按邻居延伸的横臂/面板。
  // 连接判定：同类型相邻（fence↔fence / pane↔pane）或不透明实体。
  function connectorConn(kind) {
    return function (nbId) {
      var nd = B.defs[nbId];
      if (!nd) return false;
      if (B.isOpaque(nbId)) return true;
      return !!nd.connector && nd.connector.kind === kind;
    };
  }
  function emitConnector(t, def, id, x, y, z) {
    var conn = connectorConn(def.connector.kind);
    var isFence = def.connector.kind === 'fence';
    var hw = isFence ? 0.125 : 0.03125;         // 半厚度：栅栏柱粗，玻璃板薄
    var c0 = 0.5 - hw, c1 = 0.5 + hw;
    var conns = [
      conn(G(x + 1, y, z)), conn(G(x - 1, y, z)),
      conn(G(x, y, z + 1)), conn(G(x, y, z - 1))
    ];
    var anyConn = conns[0] || conns[1] || conns[2] || conns[3];
    // 中心柱
    emitBoxInner(t, def, id, x, y, z,
      isFence ? [c0, 0, c0, c1, 1, c1] : [c0, 0, c0, c1, 1, c1]);
    // X 向臂
    var armY0 = isFence ? 0.4375 : 0, armY1 = isFence ? 0.8125 : 1;
    if (conns[0] || (!isFence && !anyConn)) {
      emitBoxInner(t, def, id, x, y, z, [c1, armY0, c0, 1, armY1, c1]);
    }
    if (conns[1]) emitBoxInner(t, def, id, x, y, z, [0, armY0, c0, c0, armY1, c1]);
    // Z 向臂
    if (conns[2] || (!isFence && !anyConn)) {
      emitBoxInner(t, def, id, x, y, z, [c0, armY0, c1, c1, armY1, 1]);
    }
    if (conns[3]) emitBoxInner(t, def, id, x, y, z, [c0, armY0, 0, c1, armY1, c0]);
  }

  // 火把等十字面片：两条对角竖 quad × 正反两面。
  // selfLit 只给真正发光的十字块（火把/红石火把）：它们的贴图本身就是光源，
  // 必须无视烘焙光全亮。花草之类不发光的十字块要走正常光照，否则在夜景里
  // 会整片自发光，读起来像噪点地毯。
  function emitCross(t, tile, x, y, z, crossH, selfLit) {
    var ls = GSky(x, y, z) / 15;
    var lb = selfLit ? 1 : GBlk(x, y, z) / 15;
    var h = (typeof crossH === 'number') ? crossH : 0.7;
    var m = 0.15, M = 0.85;
    var quads = [
      [[m, m], [M, M]],
      [[M, m], [m, M]]
    ];
    for (var q = 0; q < quads.length; q++) {
      for (var side = 0; side < 2; side++) {
        var a = quads[q][side ? 1 : 0], b = quads[q][side ? 0 : 1];
        var base = t.pos.length / 3;
        // 4 顶点：a底 b底 b顶 a顶
        var vs = [
          [x + a[0], y, z + a[1], 0, 0],
          [x + b[0], y, z + b[1], 1, 0],
          [x + b[0], y + h, z + b[1], 1, 1],
          [x + a[0], y + h, z + a[1], 0, 1]
        ];
        for (var k = 0; k < 4; k++) {
          var v = vs[k];
          t.pos.push(v[0], v[1], v[2]);
          t.nrm.push(0, 1, 0);
          tileUV(tile, v[3], v[4]);
          t.uv.push(tmpUV[0], tmpUV[1]);
          t.col.push(1, 1, 1);
          t.lgt.push(ls, lb);
          t.flg.push(curEmit, curWater);
        }
        if (side === 1) t.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        else t.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }

  function makeGeo(a) {
    if (!a.pos.length) return null;
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
    g.setAttribute('acolor', new THREE.Float32BufferAttribute(a.col, 3));
    g.setAttribute('alight', new THREE.Float32BufferAttribute(a.lgt, 2));
    g.setAttribute('anrm', new THREE.Float32BufferAttribute(a.nrm, 3));
    g.setAttribute('aflag', new THREE.Float32BufferAttribute(a.flg, 2));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(a.idx), 1));
    g.computeBoundingSphere();
    return g;
  }

  function build(cx, cz) {
    var CFG = Voxel.Config;
    var H = CFG.WORLD_H, CS = CFG.CHUNK;
    var o = { pos: [], uv: [], col: [], idx: [], lgt: [], nrm: [], flg: [] };
    var w = { pos: [], uv: [], col: [], idx: [], lgt: [], nrm: [], flg: [] };
    var fl = { pos: [], uv: [], col: [], idx: [], lgt: [], nrm: [], flg: [] };
    var x0 = cx * CS, z0 = cz * CS;

    // 填充草稿缓冲并切换到本地数组采样器；退出时恢复全局门面，
    // 保证 emitCross/vertexLight 等共享辅助函数在两种模式下都正确。
    var gPrev = G, gsPrev = GSky, gbPrev = GBlk;
    var yTop = fillPad(cx, cz);
    G = padG; GSky = padSky; GBlk = padBlk;
    try {
      for (var lx = 0; lx < CS; lx++) {
        var x = x0 + lx;
        for (var lz = 0; lz < CS; lz++) {
          var z = z0 + lz;
          // yTop 以上必为空气（fillPad 已扫描确认），跳过可省去大量空体素访问
          for (var y = 0; y <= yTop; y++) {
          var id = G(x, y, z);
          if (id === 0) continue;
          var def = B.defs[id];
          if (!def) continue;
          var isWater = id === 7;
          var isStained = !!def.stained;                 // 彩色玻璃 → 半透明水材质组
          var isBed = !!def.half;
          // 树叶独立组：参与实时阴影投射与顶点风摇
          var target = (isWater || id === 13 || isStained) ? w : (def.leaves ? fl : o);
          curEmit = B.LIGHT[id] >= EMIT_MIN_LIGHT ? 1 : 0;
          curWater = isWater ? 1 : 0;

          // 火把等十字面片：不参与面剔除
          if (def.cross) {
            emitCross(target, def.tiles[1], x, y, z, def.crossHeight, B.LIGHT[id] > 0);
            continue;
          }

          // 薄板/子盒形状（门/活板门/台阶/楼梯等 v8 扩展）：跳过整块面剔除循环
          // （须在 isBed 判定之前——活板门关闭态借 half 标记半高物理）
          if (def.box || def.boxes || def.connector) {
            if (def.connector) {
              emitConnector(target, def, id, x, y, z);
            } else if (def.box) {
              emitBoxInner(target, def, id, x, y, z, def.box);
            } else {
              var bi2;
              for (bi2 = 0; bi2 < def.boxes.length; bi2++)
                emitBoxInner(target, def, id, x, y, z, def.boxes[bi2]);
            }
            continue;
          }

          for (var f = 0; f < 6; f++) {
            var F = FACES[f];
            var nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
            var nb = G(nx, ny, nz);
            var show;
            if (isWater) show = (nb === 0 || nb === 13 || nb === 19);
            else if (isStained) show = (nb !== id && !B.isOpaque(nb));
            else if (isBed) {
              // 床占格子下半：侧面被不透明邻居或相邻床半格遮盖，顶/底面被不透明邻居遮盖
              show = !B.isOpaque(nb) && (f === 2 || f === 3 || !B.isBed(nb));
            }
            else if (def.opaque) show = !B.isOpaque(nb);
            else show = (nb !== id && !B.isOpaque(nb)); // 玻璃
            if (!show) continue;

            // 面所朝格子的光照（天光/块光归一化）
            var ls = GSky(nx, ny, nz) / 15;
            var lb = GBlk(nx, ny, nz) / 15;
            // 火把自身所在格有块光，其邻居格也已被 BFS 照亮；贴着火把的面直接取邻格值即可

            var tile = B.tileForFace(id, f);
            if (isBed) {
              emitFace(target, F, tile, x, y, z, y, y + 0.5, 0, 1, ls, lb);
            } else if (isWater) {
              emitFace(target, F, tile, x, y, z, y, (f === 2 && aboveWaterOf(x, y, z)) ? y + 0.89 : y + 1, 0, 1, ls, lb);
            } else if (B.isBed(nb) && (f === 2 || f === 3)) {
              // 顶面正上方是床 → 被床底面完全覆盖，剔除；底面正下方是床 → 床顶在 y-0.5 处，不遮盖，照常发射
              if (f === 2) continue;
              emitFace(target, F, tile, x, y, z, y, y + 1, 0, 1, ls, lb);
            } else if (B.isBed(nb)) {
              // 侧面邻居是半高床：只发未被遮盖的上半面，避免同平面 z-fight
              emitFace(target, F, tile, x, y, z, y + 0.5, y + 1, 0.5, 1, ls, lb);
            } else {
              emitFace(target, F, tile, x, y, z, y, y + 1, 0, 1, ls, lb);
            }
          }
        }
      }
    }
    } finally {
      G = gPrev; GSky = gsPrev; GBlk = gbPrev;
    }
    return { opaque: makeGeo(o), water: makeGeo(w), foliage: makeGeo(fl) };
  }

  function aboveWaterOf(x, y, z) {
    return G(x, y + 1, z) !== 7;
  }

  function eachUniform(name, apply) {
    for (var i = 0; i < mats.length; i++) {
      var u = mats[i].uniforms[name];
      if (u) apply(u);
    }
  }

  return {
    init: init,
    build: build,
    opaqueMat: function () { return opaqueMat; },
    waterMat: function () { return waterMat; },
    foliageMat: function () { return foliageMat; },
    // 供阴影深度 pass 复用的摇摆位移 GLSL（必须与主视图一致）
    swayGLSL: SWAY_GLSL,
    applyTint: function (t) {
      eachUniform('tint', function (u) { u.value.copy(t); });
    },
    setSun: function (s) {
      eachUniform('sun', function (u) { u.value = s; });
    },
    setEnv: function (fogColor, fogNear, fogFar) {
      eachUniform('uFogColor', function (u) { u.value.copy(fogColor); });
      eachUniform('uFogNear', function (u) { u.value = fogNear; });
      eachUniform('uFogFar', function (u) { u.value = fogFar; });
    },
    // 谷雾：base 以下满强度，往上按 falloff 指数衰减；str=0 关闭
    setHeightFog: function (base, falloff, str) {
      eachUniform('uFogBase', function (u) { u.value = base; });
      eachUniform('uFogFalloff', function (u) { u.value = falloff; });
      eachUniform('uFogHeightStr', function (u) { u.value = str; });
    },
    // 块光染色 + 自发光增益（gain>0 需要 Bloom 的半浮点缓冲，否则会被截到 1）
    // + 地表曝光（长曝光式极夜主题用；天穹/雾色不受影响）
    setBlockLightLook: function (tintColor, emitGain, exposure) {
      eachUniform('uBlkTint', function (u) { u.value.copy(tintColor); });
      eachUniform('uEmitGain', function (u) { u.value = emitGain; });
      eachUniform('uExposure', function (u) { u.value = exposure; });
    },
    // 水面解析式反射：相机位、天穹上下色、深水色/权重、反射/天光散射/涟漪
    setWaterLook: function (camPos, skyTop, skyHorizon, deep, deepMix, reflect, skyMix, ripple, time) {
      if (!waterMat) return;
      var u = waterMat.uniforms;
      u.uCamPos.value.copy(camPos);
      u.uSkyTop.value.copy(skyTop);
      u.uSkyHorizon.value.copy(skyHorizon);
      u.uDeepColor.value.copy(deep);
      u.uDeepMix.value = deepMix;
      u.uReflect.value = reflect;
      u.uSkyMix.value = skyMix;
      u.uRipple.value = ripple;
      u.uWaterTime.value = time;
    },
    // 极光帘的方位/强度（由 Atmosphere 每帧下发，供水面倒影采样）
    setAuroraBands: function (color, bands) {
      if (!waterMat) return;
      var u = waterMat.uniforms;
      if (color) u.uAurColor.value.copy(color); else u.uAurColor.value.setRGB(0, 0, 0);
      var arr = u.uAurBands.value;
      for (var i = 0; i < arr.length; i++) {
        var b = bands && bands[i];
        if (b) arr[i].set(b[0], b[1], b[2], 0);
        else arr[i].set(0, 1, 0, 0);
      }
    },
    // 风摇：时间 + 风矢量 + 振幅（树叶材质生效；其余材质 SWAY 未定义自动忽略）
    setWind: function (time, wx, wz, amp) {
      eachUniform('uTime', function (u) { u.value = time; });
      eachUniform('uWind', function (u) { u.value.set(wx, wz); });
      eachUniform('uSwayAmp', function (u) { u.value = amp; });
    },
    // 实时树影参数（深度图 + 世界→[0,1]³ 投影矩阵 + 强度 + 图尺寸）
    setLeafShadow: function (tex, mat4, str, size) {
      eachUniform('uShadowTex', function (u) { u.value = tex; });
      eachUniform('uShadowMat', function (u) { u.value.copy(mat4); });
      eachUniform('uShadowStr', function (u) { u.value = str; });
      eachUniform('uShadowSize', function (u) { u.value = size; });
    },
    // 太阳方向（世界系，指向太阳）+ 方向光强度（白天 1 → 夜晚趋近 0）
    setSunDirection: function (x, y, z, dirStr) {
      eachUniform('uSunDir', function (u) { u.value.set(x, y, z); });
      eachUniform('uDirStr', function (u) { u.value = dirStr; });
    },
    // 程序化云影：漂移偏移（与可见云层同步）+ 强度
    setCloudShadow: function (dx, dz, str) {
      eachUniform('uCloudDrift', function (u) { u.value.set(dx, dz); });
      eachUniform('uCloudStr', function (u) { u.value = str; });
    },
    // 测试钩子：填充式采样与全局门面语义的等价性校验（Node 冒烟）
    _test: {
      fillPad: fillPad,
      ready: function () { return inited; },
      sample: function (wx, wy, wz) {
        return { b: padG(wx, wy, wz), s: padSky(wx, wy, wz), p: padBlk(wx, wy, wz) };
      }
    }
  };
})();
