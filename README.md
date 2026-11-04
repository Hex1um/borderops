# 边境行动 · BORDER OPS

俯视角撤离射击 / 刷宝 RPG 网页游戏（中文界面）。主玩法为**塔科夫模式 · 撤离突袭**：配装大厅 → 进入 13000×9600 大地图「海关流域」→ 搜刮 / 交战 / 商店交易 → 活着撤离才入库，阵亡或超时装备与战利品全丢。

> v0.14.9 起默认**只显示塔科夫模式入口**；战役 / 无尽 / 沙二 / 大逃杀代码仍保留，把 `src/config.js` 的 `CFG.onlyRaid` 改为 `false` 可恢复。塔科夫 HUD 小地图默认关闭，`CFG.raidMinimap` 改为 `true` 可恢复。

线上地址：`https://borderops.app.workbuddy.host/`（官方部署，含联机后端）

## 特性

- **撤离射击循环**：9 阶品质战利品、5 级钥匙与上锁箱、9 家随机商店（枪械/材料/回收/黑市）、黑市代币经济、装备保险与撤离费
- **拟真 AI**：视野/枪声传播/调查行为、打空弹匣换弹后撤、残血包扎、翻尸补弹、子弹擦身侧闪
- **词缀枪械**：厂商 × 枪型 × 元素 × 词缀 × 核心（元素/混乱/强化）多轴组合生成；109 条前后缀含元素专属与正负对冲取舍
- **元素克制**：血肉 / 护盾 / 装甲三系克制，T4+ 护甲为装甲型并显示黄色血条，护甲耐久打穿后转回血肉型；
  轻甲精锐带能量护盾（蓝色血条 + 青蓝护盾条），三种类型同场共存
- **元素持续效果**：火焰灼烧 DOT、腐蚀啃甲破防、辐射连锁、电击干扰开火、冰冻减速，
  每种都有头顶状态可视化；医疗包可净化灼烧 / 冰冻 / 干扰
- **乘法律防护**：护甲与头盔减伤按 `1-(1-p)(1-q)` 叠加，头盔对躯干命中同样生效；
  爆炸 / splash 子弹带范围溅射，打穿的护甲报废且不再自愈
- **大地图互动**：8 座桥、河流涉水失温、医疗站/弹药柜/警报器/泄洪闸
- **2~4 人联机**：房主权威模拟 + HTTP 轮询快照（需后端，见下）
- 移动端触控（摇杆 + 按钮）、窄屏断点适配

## 运行

```sh
npm start          # 等价于 node server.js，默认 3000 端口
npm run verify     # 无浏览器依赖的逻辑回归：减伤 / 克制 / 元素状态 / 词缀池，95 项断言
# 真实浏览器冒烟（需系统 Edge + Python playwright，先起服务）：
PORT=3211 node server.js
python playwright_smoke.py      # 28 项断言 + testshots/*.png + test-report.json
python probe_mechanics.py      # 只读机制体检 → mechanics-probe.json
# 或仅静态托管（联机不可用）：
python -m http.server 8132
```

访问 `http://127.0.0.1:3000/`。

## 技术约束（给后续维护者）

1. **零构建**：原生 HTML/CSS/JS，不用 ES modules，不用打包器 / 框架 / npm 运行时依赖（`server.js` 仅用 Node 原生模块）。
2. **脚本顺序敏感**：所有 `src/*.js` 为经典脚本、共享全局作用域，靠 `index.html` 的 `<script>` 顺序加载：
   `config → util → weapons → items → skills → player → enemies → combat → world → endless → dust2 → shop → input → render → ui → raid → net → auction → br → save → main`
3. **版本三处同步**：`package.json` 的 `version`、`src/config.js` 的 `CFG.version`、`index.html` 全部 `?v=` 缓存串。
4. 改动沿用现有风格：紧凑单行、中文注释带 `vX.Y.Z` 前缀。

## 目录结构

| 路径 | 职责 |
|---|---|
| `index.html` | 唯一 HTML：画布 + overlay + 局内物品栏层 + 脚本清单 |
| `styles.css` | 全部样式，含移动端断点 |
| `src/config.js` | 全局常量、品质/词缀/元素定义、MAYHEM 平衡数值 |
| `src/raid.js` | 主战场（~7.8k 行）：地图/房间/商店/AI/战利品/钥匙/结算/配装大厅 |
| `src/weapons.js` | 枪械生成、词条、稀有度、核心乘区 |
| `src/net.js` | 联机客户端（HTTP 轮询） |
| `server.js` | 联机房服务器 + 静态托管（Node 原生 http，无依赖） |
| `src/*.js` 其余 | 通用引擎层与附属模式 |
| `verify_v01410.cjs` | vm 沙箱逻辑回归（`npm run verify`，95 项断言） |
| `playwright_smoke.py` / `probe_mechanics.py` | 真实浏览器冒烟（28 项断言）与只读机制体检 |
| `testshots/` / `test-report.json` / `mechanics-probe.json` | 冒烟截图与结构化测试报告 |

## GitHub Pages 部署说明

本仓库已启用 GitHub Pages（静态托管）。**塔科夫模式的单机玩法在 Pages 上完整可用**；但 2~4 人联机依赖 `server.js` 的 `/api/*` 房间接口，Pages 无法运行 Node 后端，联机入口会提示「连不上服务器」——联机请使用上方官方部署地址，或自行部署 `node server.js`。

存档保存在浏览器 `localStorage`，与部署域名绑定：Pages 域名与官方域名的存档互不相通。
