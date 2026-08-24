// 全局常量配置
window.Voxel = window.Voxel || {};

Voxel.Config = {
  // 世界
  WORLD_W: 256,        // X 方向方块数
  WORLD_H: 64,         // 高度
  WORLD_D: 256,        // Z 方向方块数
  CHUNK: 32,           // 区块边长（越大区块越少、draw call 越少，对 ANGLE/Edge 更友好）
  // 无限行星的流式区块工作集（单位：区块）。空间站仍保持有限真空平台。
  STREAM_RENDER_RADIUS: 5, // 11×11 网格工作集：视野与桌面/移动性能的平衡点
  STREAM_DATA_RADIUS: 6,   // 多保留一圈数据，供跨区块光照/AO/结构采样
  STREAM_KEEP_RADIUS: 8,   // 卸载滞回半径，避免在边缘往返时反复生成
  STREAM_GENERATE_PER_FRAME: 1, // 游戏中每渲染帧最多生成的外围区块
  WATER_LEVEL: 27,     // 水位线
  SNOW_LEVEL: 49,      // 雪线：地表高度 ≥ 此值覆雪
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
    PIG_TARGET: 5, CHICKEN_TARGET: 5, RABBIT_TARGET: 4,
    DESPAWN: 52, SPAWN_MIN: 24, SPAWN_MAX: 46,
    ZOMBIE_RANGE: 18, ZOMBIE_DMG: 3,
    ZOMBIE_SPEED: 2.0, SHEEP_SPEED: 1.2,
    HP_SHEEP: 4, HP_ZOMBIE: 10,
    HP_PIG: 6, HP_CHICKEN: 3, HP_RABBIT: 3,
    WOOL_DROP: 1,             // 击杀羊掉落的羊毛数量
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
    MAX_ALTITUDE: 64,
    MAX_ABSOLUTE_Y: 120,
    SHIP_BASE_CLEARANCE: 1.02
  },

  SAVE_KEY: 'starbound_voxel_save_v5', // v5：星系、多世界独立进度、飞船与发现状态
  AUTOSAVE_INTERVAL: 30,

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

  // 性能预设（设置面板一键应用；键名对应 Voxel.Settings）
  PERF_PRESETS: {
    smooth:   { fpsCap: 30, res: 0.55, particleDensity: 0.4, rainDensity: 0.4, mobDensity: 0.5 },
    balanced: { fpsCap: 60, res: 0.8,  particleDensity: 0.7, rainDensity: 0.7, mobDensity: 0.75 },
    high:     { fpsCap: 0,  res: 1,    particleDensity: 1,   rainDensity: 1,   mobDensity: 1 }
  }
};
