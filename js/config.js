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
    HP: 20
  },

  // 生物
  MOB: {
    SHEEP_TARGET: 8, ZOMBIE_TARGET: 6,
    DESPAWN: 52, SPAWN_MIN: 24, SPAWN_MAX: 46,
    ZOMBIE_RANGE: 18, ZOMBIE_DMG: 3,
    ZOMBIE_SPEED: 2.0, SHEEP_SPEED: 1.2,
    HP_SHEEP: 4, HP_ZOMBIE: 10,
    WOOL_DROP: 1              // 击杀羊掉落的羊毛数量
  },

  // 渲染
  REACH: 6,
  FOG_NEAR: 60, FOG_FAR: 240,
  CHUNKS_PER_FRAME: 3,

  SAVE_KEY: 'voxelcraft_save_v1',
  AUTOSAVE_INTERVAL: 30
};
