// 全局常量配置
window.Voxel = window.Voxel || {};

// 全局错误兜底：未捕获异常只进控制台时，玩家面对的往往是"无声冻结"。
// 这里把异常落到常驻的 #error-banner（textContent 写入，无 XSS 面）。
// 注意限频：主循环若每帧抛错会持续触发 error 事件，不能刷屏。
(function () {
  var lastReport = 0;
  function report(reason) {
    var now = (window.performance && performance.now()) || Date.now();
    if (now - lastReport < 5000) return;
    lastReport = now;
    var el = document.getElementById('error-banner');
    if (!el) return;
    el.textContent = '发生错误：' + reason;
    el.style.display = 'block';
  }
  // 测试沙箱（node vm）里的 window 可能没有事件 API，守卫后再挂
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('error', function (e) {
      report((e && e.message) || '脚本执行出错');
    });
    window.addEventListener('unhandledrejection', function (e) {
      var r = e && e.reason;
      report((r && (r.message || String(r))) || 'Promise 异常');
    });
  }
})();

Voxel.Config = {
  // 世界
  WORLD_W: 256,        // X 方向方块数
  WORLD_H: 256,        // 高度（v7：限高提升到 256，地形由生成包络钉住不变）
  WORLD_D: 256,        // Z 方向方块数
  CHUNK: 32,           // 区块边长（越大区块越少、draw call 越少，对 ANGLE/Edge 更友好）
  // 无限行星的流式区块工作集（单位：区块）。空间站仍保持有限真空平台。
  STREAM_RENDER_RADIUS: 5, // 11×11 网格工作集：视野与桌面/移动性能的平衡点
  STREAM_DATA_RADIUS: 6,   // 多保留一圈数据，供跨区块光照/AO/结构采样
  STREAM_KEEP_RADIUS: 8,   // 卸载滞回半径，避免在边缘往返时反复生成
  STREAM_GENERATE_PER_FRAME: 1, // 游戏中每渲染帧最多生成的外围区块
  WATER_LEVEL: 27,     // 水位线
  SNOW_LEVEL: 49,      // 雪线：地表高度 ≥ 此值覆雪
  // 生成包络：自然地形+装饰的最高可达高度（巨树树冠峰值 ≈92，含余量）。
  // 生成/光照只处理此高度以下；其上为纯空气域（255 高天空供建造与飞行）。
  GEN_ENVELOPE_TOP: 96,
  // 自然与确定性结构的内容顶：包络之上还允许乐园结构写入（最高 ≈108，含余量）。
  // 光照快路径假设此线以上恒为空气；玩家手动建得更高会即时抬升该列。
  CONTENT_NATURAL_TOP: 116,
  DAY_LENGTH: 1800,    // 昼夜循环秒数

  // 玩家
  PLAYER: {
    W: 0.6, H: 1.8, EYE: 1.62,
    WALK: 4.3, SPRINT: 5.8, FLY: 11, FLY_FAST: 22,
    JUMP: 8.5, GRAVITY: 28, MAX_FALL: -40,
    SWIM_GRAVITY: 6, SWIM_UP: 4.5,
    REACH: 6, DIG_CD: 0.22,
    HP: 20,
    FALL_SAFE: 13,      // 落地速度不超过此值不摔伤（约3格）
    FALL_DMG: 0.9,      // 每超出 1 单位落地速度的伤害
    AIR_MAX: 10,        // 水下憋气秒数
    DROWN_DMG: 2,       // 憋气耗尽后每秒伤害
    FOOD_MAX: 20,       // 饥饿值上限（20 = 10 个鸡腿）
    EXHAUST_PER_FOOD: 4,// 每 4 点疲惫消耗 1 饥饿
    RATE_STILL: 0.03,   // 疲惫速率/秒：静止（基础代谢）
    RATE_MOVE: 0.10,    // 移动
    RATE_SPRINT: 0.35,  // 疾跑
    RATE_SWIM: 0.22,    // 游泳
    EXHAUST_JUMP: 0.08, // 每次跳跃额外疲惫
    EXHAUST_DIG: 0.025, // 每挖一块
    EXHAUST_ATTACK: 0.1,// 每次攻击
    HEAL_FOOD_MIN: 18,  // 饥饿 ≥ 此值才回血
    HEAL_EXHAUST: 1.5,  // 每回复 1 血的额外疲惫
    STARVE_INTERVAL: 4, // 饥饿 0 时每 N 秒扣血
    STARVE_DMG: 1       // 饥饿伤害（降到 1 血为止，不饿死）
  },

  // 生物
  MOB: {
    SHEEP_TARGET: 8, ZOMBIE_TARGET: 6,
    PIG_TARGET: 5, CHICKEN_TARGET: 5, RABBIT_TARGET: 4, CAT_TARGET: 8,
    ARCHER_TARGET: 2, BOOMER_TARGET: 2,
    DESPAWN: 52, SPAWN_MIN: 24, SPAWN_MAX: 46,
    ZOMBIE_RANGE: 18, ZOMBIE_DMG: 3,
    ZOMBIE_SPEED: 2.0, SHEEP_SPEED: 1.2,
    // 骷髅弓手：保持距离射击，白天同僵尸一样曝晒燃烧
    ARCHER_RANGE_MIN: 6, ARCHER_RANGE_MAX: 14, ARCHER_DMG: 3,
    ARCHER_SPEED: 1.7, ARROW_SPEED: 13, ARROW_CD: 2.2, ARROW_LIFE: 3.5,
    // 自爆虫：贴近后点燃引信引爆，逃离可中断
    BOOMER_RANGE: 16, BOOMER_DMG: 7, BOOMER_SPEED: 2.7,
    FUSE_TIME: 1.15, FUSE_CANCEL: 4.5, EXPLODE_R: 2.4,
    HP_SHEEP: 4, HP_ZOMBIE: 10, HP_ARCHER: 8, HP_BOOMER: 6,
    HP_WOLF: 12, HP_VILLAGER: 20, WOLF_TARGET: 2, VILLAGER_TARGET: 2,
    // 喂养繁殖：食物偏好表（id 见 blocks.js）；爱心持续 10s，冷却 40s
    LOVE_TIME: 10, BREED_CD: 40, BABY_SCALE: 0.55, BABY_GROW: 150,
    // 狼：白天也出没；狩猎范围内最近被动生物为猎物；被激怒后扑咬玩家
    WOLF_HUNT_RANGE: 15, WOLF_DMG: 3, WOLF_AGGRO_TIME: 9,
    // 村民对话触发半径
    TALK_RANGE: 3.2,
    HP_PIG: 6, HP_CHICKEN: 3, HP_RABBIT: 3, HP_CAT: 4,
    WOOL_DROP: 1,             // 击杀羊掉落的羊毛数量
    CAT_FUR_DROP: 2,          // 击杀猫掉落的猫毛数量（2 猫毛合成 1 猫毛毡）
    FLEE_TIME: 3.5,           // 被动生物受击后逃跑持续秒数
    FLEE_MULT: 1.7            // 逃跑速度倍率
  },

  // 渲染
  REACH: 6,
  FOG_NEAR: 60, FOG_FAR: 240,
  CHUNKS_PER_FRAME: 3,

  // 天气（晴→雨→雷雨自动循环，N 键手动切换）
  WEATHER: {
    CLEAR_MIN: 180, CLEAR_MAX: 360,          // 晴天持续(秒)
    RAIN_MIN: 90, RAIN_MAX: 180,             // 雨天持续(秒)
    STORM_MIN: 45, STORM_MAX: 90,            // 雷暴持续(秒)
    TRANSITION: 8,                           // 下雨/放晴过渡(秒)
    RAIN_DROPS: 420,                         // 雨滴数量
    RAIN_SPEED: 22,                          // 雨滴下落速度
    RAIN_BOX: 60,                            // 雨滴环绕盒半径
    WIND: 3,                                 // 风速(云漂移+雨滴倾斜)
    CLOUD_COUNT: 16,                         // 云朵数量
    LIGHTNING_MIN: 4, LIGHTNING_MAX: 12,     // 雷暴时闪电间隔(秒)
    STRIKE_CHANCE: 0.15,                     // 每次闪电劈中玩家的概率
    STRIKE_RANGE: 14,                        // 落雷距玩家判定范围(格)
    STRIKE_DMG: 6,                           // 雷击伤害
    RAINBOW_DURATION: 25,                    // 彩虹持续(秒)
    FOG_NEAR_WET: 25, FOG_FAR_WET: 110       // 雨天雾距
  },

  // 行星内飞船驾驶（固定 60Hz，跨天体仍使用星图跃迁）
  SHIP_FLIGHT: {
    MAX_FORWARD: 24,
    MAX_REVERSE: 6,
    MAX_VERTICAL: 8,
    FORWARD_ACCEL: 12,
    BRAKE_DECEL: 18,
    THROTTLE_UP: 0.75,
    THROTTLE_DOWN: 1.2,
    YAW_RATE: 70 * Math.PI / 180,
    PITCH_RATE: 50 * Math.PI / 180,
    PITCH_LIMIT: 50 * Math.PI / 180,
    ROLL_MAX: 18 * Math.PI / 180,
    ROLL_RESPONSE: 4,
    KEY_YAW_RATE: 34 * Math.PI / 180,
    SWEEP_STEP: 0.35,
    LAND_SPEED: 3,
    MAX_ALTITUDE: 190,
    MAX_ABSOLUTE_Y: 250,
    SHIP_BASE_CLEARANCE: 1.02,
    // 着陆辅助（长按 E 自动着陆）
    LANDING_ASSIST_MAX_ALT: 24,        // 激活高度上限(相对地面)
    LANDING_ASSIST_SEARCH_RADIUS: 32,  // 着陆点螺旋搜索半径(格)
    LANDING_ASSIST_HOLD_MS: 600,       // 长按 E 触发阈值
    // 召唤飞船（X 键：准星选点 → 幽灵预览 → 确认后自动驾驶降落）
    SUMMON_AIM_RANGE: 96,              // 放置预览的准星射线投射距离(格)
    SUMMON_PREVIEW_SEARCH_RADIUS: 10,  // 命中点吸附搜索半径(格)
    SUMMON_FALLBACK_AHEAD: 10,         // 准星未命中时向前取点的距离
    SUMMON_APPROACH_SPEED: 24,         // 召唤巡航水平速度(m/s)
    SUMMON_HANDOFF_DIST: 5,            // 移交精确降落控制的水平距离
    SUMMON_MAX_ALT: 400,               // 移交着陆辅助时允许的相对高度上限
    SUMMON_MAX_DURATION: 480,          // 着陆辅助控制器总时长兜底(秒)
    SUMMON_CRUISE_MARGIN: 20,          // 巡航高度 = 沿途最高地表 + 余量
    SUMMON_CRUISE_MAX_Y: 230,          // 巡航高度硬上限
    SUMMON_TAKEOFF_TIMEOUT: 45,        // 起飞+爬升阶段超时(秒)
    SUMMON_TRANSIT_TIMEOUT: 420        // 跨图巡航阶段超时(秒)
  },

  SAVE_KEY: 'starbound_voxel_save_v6', // v6：无限宇宙（银河→恒星系）、跨系曲速电池
  GEN_WORKER_V: '20260830b',           // gen_worker.js 缓存版本号（结构/贴图更新时递增）
  AUTOSAVE_INTERVAL: 30,

  // 无限宇宙（Universe 层）：恒星系档案缓存与跨系跃迁成本
  UNIVERSE: {
    ARCHIVE_MAX_SYSTEMS: 24,   // 当前系之外最多保留的恒星系档案数（LRU）
    JUMP_CELLS_PER_DIST: 0.5,  // 跨系跃迁电池消耗 = ceil(距离 × 此系数)
    JUMP_CELLS_MIN: 1,
    JUMP_CELLS_MAX: 24
  },

  // 触控（移动端虚拟摇杆 + MCPE 式手势）
  TOUCH: {
    LOOK_SENS_BASE: 0.0042,  // 触摸转视角基准灵敏度（rad/px，×tsens 设置）
    STICK_DEADZONE: 0.12,    // 摇杆死区（半径比例）
    STICK_SPRINT: 0.92,      // 推到外圈此比例触发疾跑
    TAP_MS: 220,             // 轻点判定：按下时长上限
    TAP_DIST: 8,             // 轻点判定：累计位移上限 px
    LONGPRESS_MS: 250,       // 长按挖掘触发时长
    LONGPRESS_DIST: 12,      // 长按触发时允许的位移
    LEFT_ZONE_FRAC: 0.45     // 屏幕左侧此比例内为摇杆区，其余为视角/手势区
  },

  // 星海嘉年华乘坐系统（长按 E 上车 / 轻按下车）
  RIDE: {
    HOLD_MS: 600,     // 长按判定阈值
    RADIUS: 5.5       // 乘坐台吸附半径
  },

  // 性能预设（设置面板一键应用；键名对应 Voxel.Settings）
  PERF_PRESETS: {
    smooth:   { fpsCap: 30, res: 0.55, particleDensity: 0.4, rainDensity: 0.4, mobDensity: 0.5, shadows: 0, sway: 0, stream: 3, bloom: 0, waterReflect: 0, heightFog: 0, viewBoost: 0 },
    balanced: { fpsCap: 60, res: 0.8,  particleDensity: 0.7, rainDensity: 0.7, mobDensity: 0.75, shadows: 1, sway: 0.75, stream: 6, bloom: 1, waterReflect: 1, heightFog: 1, viewBoost: 0 },
    high:     { fpsCap: 0,  res: 1,    particleDensity: 1,   rainDensity: 1,   mobDensity: 1, shadows: 2, sway: 1, stream: 12, bloom: 1, waterReflect: 1, heightFog: 1, viewBoost: 1 }
  },

  // 远景主题的流式半径（按 viewBoost 档位）：北欧峡湾雪脊在 140+ 格外，
  // 基础半径 5（雾尾 128）会把整片山体埋进雾里。
  VIEW_BOOST_RADIUS: 8,

  // 实时光影参数
  SHADOW: {
    RANGE: 46,             // 阴影盒半径（格）
    SWAY_AMP: 0.034,       // 风摇基础振幅（格），×设置档位 ×风力系数
    CLOUD_SHADOW: 0.85     // 程序化云影最大强度（晴天也有云影掠过地面）
  }
};
