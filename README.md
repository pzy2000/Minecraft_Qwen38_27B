# 方块世界 VoxelCraft

一个用纯 HTML5 + JavaScript + Three.js 实现的 3D 体素像素游戏（类 Minecraft）。
零依赖、零构建 —— **双击 `index.html` 即可在浏览器中游玩**。

## 运行

```bash
# 方式一：直接双击 index.html（推荐）
open index.html

# 方式二：本地服务器（可选）
python3 -m http.server 8080
# 然后访问 http://localhost:8080
```

> 需要支持 WebGL 的浏览器（Chrome / Edge / Firefox / Safari）。
> 存档使用 localStorage；若浏览器对 file:// 协议限制存储，请用方式二运行。

## 操作说明

| 按键 | 功能 |
|---|---|
| 鼠标 | 视角（点击画面锁定鼠标） |
| WASD / 方向键 | 移动 |
| 空格 | 跳跃 / 游泳上浮 / 飞行上升 |
| Shift | 疾跑 / 飞行下降 |
| 左键 | 放置方块（使用当前快捷栏格） |
| 右键 | 挖掘方块 / 攻击生物 |
| 中键 | 吸取所看方块 |
| 1-9 / 滚轮 | 选择快捷栏 |
| E | 打开/关闭背包（含 2×2 合成）· 准星对准工作台按 E 打开 3×3 合成 |
| F | 切换飞行模式 |
| F3 | 显示/隐藏调试信息 |
| M | 打开/关闭合成手册（配方一览） |
| P | 暂停菜单（含手动存档） |
| Esc | 释放鼠标 |

## 游戏内容

- **程序化世界**：256×256×64，噪声地形、湖泊海洋、沙滩、山脉、洞穴、树木、煤矿/铁矿
- **挖掘与放置**：DDA 体素射线选取，破坏有粒子与音效，基岩不可破坏
- **物理**：重力、跳跃、AABB 碰撞、游泳、飞行（创造式）
- **昼夜循环**：30 分钟一轮，日落霞光、星空、月光
- **生物**：白天游走的小羊（击杀掉落羊毛），夜晚追击的僵尸（日出自燃），可攻击
- **合成系统**：背包 2×2 合成格（橡木→×4 木板、2×2 木板→工作台）、工作台 3×3 合成格、合成手册（M 键查看配方）；床（3 羊毛+3 木板）必须在工作台合成，半高可站上去
- **战斗**：10 颗心血量、受击红屏、缓慢回血、死亡重生
- **存档**：自动存档（30 秒）+ 手动存档，保存种子与修改增量，刷新页面可继续
- **程序化美术/音效**：16×16 像素纹理全部由代码生成，音效由 WebAudio 合成，无任何外部资源

## 项目结构

```
index.html            入口（全部 UI + 脚本加载顺序）
css/style.css         像素风 UI
vendor/three.min.js   Three.js r128（本地，离线可用）
js/
├── config.js         全部可调参数
├── blocks.js         方块定义 + 程序化纹理图集
├── crafting.js       合成配方数据 + 3x3 匹配（纯逻辑）
├── world/
│   ├── noise.js      种子化值噪声 + fBm（2D/3D）
│   ├── world.js      世界数据、地形生成、增量存档
│   └── mesh.js       区块网格：面剔除 + 顶点 AO
├── player/
│   ├── physics.js    AABB 方块碰撞
│   ├── controls.js   指针锁定 + 键盘
│   └── player.js     移动/重力/游泳/飞行
├── interact/raycast.js   DDA 体素射线
├── entities/mobs.js      羊 / 僵尸 AI
├── systems/
│   ├── daynight.js   昼夜、天空、星辰
│   ├── sound.js      WebAudio 合成音效
│   ├── particles.js  破碎粒子
│   └── save.js       localStorage 存档
├── ui/hud.js         快捷栏/背包/血量/调试
└── main.js           状态机 + 主循环
test/smoke.js         Node 冒烟测试（无需浏览器）
```

## 测试

```bash
node test/smoke.js          # Node 冒烟测试：噪声、地形生成、确定性、存档还原（秒级）

# 浏览器端全量测试（需 puppeteer-core）：
npm i puppeteer-core --no-audit --no-fund
node test/run_browser_tests.js     # 自动查找 Chrome/Edge/Chromium，也可显式传入路径
```

| 测试文件 | 覆盖内容 |
|---|---|
| `test/smoke.js` | 噪声确定性、世界生成（水/树/洞/矿）、出生点、增量存档往返、合成配方匹配/消耗 |
| `test/browser_test.html` | 完整游戏栈：主循环、物理落地、DDA 射线、挖放、生物生成/死亡/掉羊毛、背包 2×2 开局合成（橡木→木板→工作台）、工作台 3×3 合成（床）、合成手册、半高床网格+物理、昼夜、受伤/死亡/重生、存档往返、网格重建（渲染置空，纯逻辑验证） |
| `test/render_check.html` | 真实 WebGL 渲染 240 帧 + 像素采样（验证画面中天空与地形均可见） |

截图示例（无头软件渲染生成）：`screenshot_menu.png`、`screenshot_game.png`

## 可调参数

`js/config.js`：世界尺寸、水位线、昼夜时长、玩家速度/跳跃高度、生物数量与行为、雾效距离等。

## 已知限制

- 无熔炉/烧炼、无工具与耐久，方块破坏即时完成
- 单进程世界（无多人联机）、无移动端触控
- 生成整个 256×256 世界约 1-2 秒（进度条可见），区块网格渐进构建
