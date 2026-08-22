// 全局常量配置
window.Voxel = window.Voxel || {};

Voxel.Config = {
  // 世界
  WORLD_W: 256,        // X 方向方块数
  WORLD_H: 64,         // 高度
  WORLD_D: 256,        // Z 方向方块数
  CHUNK: 32,           // 区块边长（越大区块越少、draw call 越少，对 ANGLE/Edge 更友好）
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
    DROWN_DMG: 2        // 憋气耗尽后每秒伤害
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
    WOOL_DROP: 1              // 击杀羊掉落的羊毛数量
  },

  // 渲染
  REACH: 6,
  FOG_NEAR: 60, FOG_FAR: 240,
  CHUNKS_PER_FRAME: 3,

  // 天气（晴→雨→雷雨自动循环，G 键手动切换）
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

  SAVE_KEY: 'voxelcraft_save_v2',   // v2：生物群系生成算法（v1 旧地形不兼容）
  AUTOSAVE_INTERVAL: 30
};
