# 边境行动 · BORDER OPS

> ## 📌 默认只改 main；改 B 站 Toy 版需要明确点名（2026-11-10 起）
> `toy` 分支 = B 站 Toy 版（商标合规改名 + 云存档 + **排行榜**），当前 0.37.1。
> **所有日常改动只走 `main`**；只有明确说「改 Toy / 改 B 站版」时才动 `toy`。
> 两条线**不要互相 merge**（toy 的合规改名会被 main 的原版命名覆盖）。
> 细节见 **[AGENTS.md](AGENTS.md)**。

**俯视 / 第一人称双视角**的**拟真撤离射击**网页游戏（中文界面）。主玩法为**塔科夫模式 · 撤离突袭**：配装大厅 → 进入 13000×9600 大地图「海关流域」→ 搜刮 / 交战 / 商店交易 → 活着撤离才入库，阵亡或超时装备与战利品全丢。

> 📖 **新手上路看 [WIKI.md](WIKI.md)** —— 玩法、操作、双视角、地图、词缀、弹药、医疗、经济、联机、FAQ 全在里面。
> 📝 逐版改动看 [CHANGELOG.md](CHANGELOG.md)。

> v0.19.0 起支持**局内 2D / 3D 视角切换**（`ESC` → 设置，或直接按 `V`）：3D 是第一人称软件渲染视图（地面做真透视投影、墙体按方块面光栅化），与 2D 共用同一份地图数据、同一套光照色温、同一套拾取 / AI / 伤害 / 撤离逻辑，切换不丢战局进度。
> 同一版还修好了「医疗品只能用绷带和医疗包」的 bug（现在五种医疗品全部可用、HUD 只显示你实际拥有的），重做了经济四档价格（局内商店 0.8× ±0.1 / 回收超市 1.2× ±0.4 / 背包直售 0.5× / 军火超市 2.0× ±0.5），并把枪械与配件的词缀数量改成**大多 1 条、少数 2 条以上**。

> v0.15.0 起全面拟真化：超现实与魔法内容（混乱等级、附魔、追踪弹、能量武器与神话品质）全部替换为现实弹种、军械改装、防护等级与军工品质。v0.16.0 在此基础上把弹种终点效应（引燃 / 撕裂 / 钝击失能 / 跳弹 / 迟滞）与全新护盾装备折回来，名称与说明仍全部使用现实军工术语。
>
> v0.14.9 起默认**只显示塔科夫模式入口**；战役 / 无尽 / 沙二 / 大逃杀代码仍保留，把 `src/config.js` 的 `CFG.onlyRaid` 改为 `false` 可恢复。塔科夫 HUD 小地图默认关闭，`CFG.raidMinimap` 改为 `true` 可恢复。

线上地址：`https://hex1um.github.io/borderops/`（GitHub Pages，纯静态托管；联机自动走 WebRTC P2P，无需后端）

已收录：[deepdemos.top（AI 全民制作人）](https://deepdemos.top/demo/border-ops-73e23136)。封面截图见 `assets/`（`cover.jpg` 俯视实景 / `cover-3d.jpg` 第一人称 / `shot-title.jpg` 标题页）。

## 两个发布线（v0.36.2 起分开）

同一个仓库同时维护两条发布线，**代码内容不同，不要互相 merge**：

| 分支 | 用途 | 当前版本 | 差异 |
|---|---|---|---|
| `main` | GitHub Pages 公开版：`https://hex1um.github.io/borderops/` | **0.36.2** →（继续演进） | 本分支就是完整原版，含真实兵工厂与枪械型号命名 |
| `toy` | B 站 Toy 投稿版——**⛔ 已冻结，不再更新** | 0.37.0（终版） | 12 家兵工厂 / 84 个枪型号改为原创命名、`塔科夫` 等他人游戏名替换、`src/toy-sdk.js` 接入 B 站云存档与云房间 |

`toy` 冻结的原因：Toy 每次更新文件都要重新审核并重新发布，成本高于收益。**新改动一律只进 `main`**，按 main 自己的版本序列走（跨过 0.37 时直接用 0.38.0）。

只有用户**明确要求更新 B 站版**时才切到 `toy`：

```sh
git checkout toy
node tools/build_toy.cjs        # → dist/borderops-toy-v<版本>.zip
python tools/make_toy_cover.py  # 封面与图标（需要时）
git checkout main
```

`tools/` 与 `dist/` 的处理：脚本两条线共用（与版本无关），`dist/` 已在 `.gitignore` 里不入库。

## 特性

- **撤离射击循环**：9 阶军规品质战利品 + 12 阶枪械品质、5 级钥匙与上锁箱、9 家随机商店（枪械/材料/回收/黑市）、GP 币经济、装备保险与撤离费
- **品质显示分层**：`CFG.display = "compact"`（默认）隐藏品质名 / 前后缀 / 厂商，只留真枪型号，数值照常生效；`"full"` 全显示。`CFG.weaponQuality` 是总开关（默认 `true`，设 `false` 时新枪统一按标准品质生成、不吃品质倍率与具名）
- **塔科夫制式弹药**：`5.45×39mm PS gs` / `5.45×39mm T gs` / `7.62×39mm BP gzh` / `9×19mm RIP` / `9×39mm SP-6 gs` / `40mm VOG-25` / `5.45×39mm BT gs`，
  按「无防护 / 护盾 / 硬质插板」三系终点效应区分；引燃、撕裂、钝击失能、跳弹、迟滞均为可解释的弹道效应
- **改装词条**：兵工厂 × 枪型 × 品级 × 改装词条 × 部件组合生成；词条全部为可解释的工艺参数（冷锻枪管、浮置枪管、精磨扳机、制退器、后坐控制、有效射程……）
- **真实型号**：8 家兵工厂（图拉、伊热夫斯克、卡拉什尼科夫、赫克勒-科赫、FN 赫斯塔尔等）与 AK-74N / HK 416A5 / PP-19-01 Vityaz / SV-98 / MP-153 / KS-23M 等塔科夫实装型号；具名枪带口径后缀，护具为 6B43、Altyn、Vulkan-5 等现实装备
- **护甲与耐久**：T1~T9 现实防护等级，插板耐久只能维修、**不会自动回复**；命中部位与弹药穿深决定减伤
- **改装模块**：弹种适配组件（换弹药）、膛压组件（提升改装等级）、7 类工艺改装模块；枪匠台提供重调词条与部件/模块装配
- **分级索敌 AI**：Scav 视距 520 / 反应 0.55s / 视线记忆 2.5s，PMC 900 / 0.22s / 5.5s，Boss 1250 / 0.06s / 9.0s；枪声听距与主动搜寻概率同步分级。另有换弹后撤、残血包扎、翻尸补弹、子弹擦身侧闪
- **回收超市按收购单收货**：每局 2~3 类（枪械 / 配件 / 原材料 / 医疗 / 防护 / 钥匙），价格是估价的 **2~3 倍**，每类限量收满即停；不在单上的一律不收（弹药另按固定 55% 折现）。回收超市不挂每日特价，避免「低价买、高价回收」的搬运
- **走位型精英**：`wraith` 相位无敌（专治贴脸集火）、`shieldbearer` 正面 0.28 减伤（逼你绕侧翼）、**狙击手**（视距 1500，开火前 0.8s 激光预警，站开阔地就会被点名）、**医疗兵**（每 4.5s 给周围同阵营回 22% 血，先杀它前排才打得动）；后两种每局至少各一名，编成里还各占约 15%
- **精英随机词条**：POI 精英必带 1~2 条（迅猛 +30% 移速 / 顽强 +40% 生命 / 硬化 -28% 受伤 / 神射 -60% 抖动 / 召唤者 半血叫增援），名字带 `[迅猛]` 标签 —— 后期难度靠组合而不是纯数值膨胀
- **战地契约**：局外每天 3 条，**6 种任务**（猎杀指挥官 / 清剿精锐 / 清扫 Scav / 带出 N 件 / 单局带出 ₽N / 存活 N 分后撤离），接一条 24h 有效；**奖励分 1~6 档并按任务难度封顶**——清扫 / 搜刮最高 3 档（中阶材料、普通配件、₽8k~14k），清剿 / 运货 / 死守最高 5 档（高阶枪、具名配件），**只有猎杀指挥官能到 6 档**（具名枪 / GP 币 ◈2~4）；奖励在接单前就写明具体物品；**完成即刻刷新下一批，且越做越难**
- **阵亡装备限时赎回**：投保后阵亡、且没被「无人捡走」退回的那部分，24 小时内可按估值 300% 赎回（超时自动过期）——死亡惩罚从纯挫败变成一次决策
- **死亡回放**：结算页写明「被 狙击手「Slick」在 55m 外击杀（RSASS），期间受击 2 次、累计 -100」
- **Scav 低阶配装**：Scav 只拿 PM / MP-133 / TOZ-106 / PP-91 Kedr 等塔科夫拾荒者武器，枪械等级封顶 8、品质封顶蓝品、弹药只出 PS/T/RIP；不会跟随玩家装备膨胀，也不会在局内拾取高阶枪甲
- **词缀枪械**：厂商 × 枪型 × 弹种 × 前后缀 × 改装模块多轴组合生成；**双方词缀池合并共 91 前缀 / 64 后缀**，
  全部为可解释的军工工艺术语（冷锻枪管、浮置枪管、精磨扳机、曳光弹适配、竞赛级装药……），含正负对冲取舍
- **弹种终点效应**：PS / T / BP / RIP / SP-6 / VOG-25 / BT 按「无防护 / 护盾 / 硬质插板」
  三系终点效应区分；引燃 DOT、撕裂破防、钝击失能、跳弹连锁、迟滞减速都有头顶可视化，医疗包可净化
- **护盾装备（全新装备类型）**：由电池组 / 充能模块 / 延时继电器 / 承载框架 4 个配件组成，
  **容量 / 充能速度 / 充能延迟**三数值 + 各自独特加成；血条**上方**独立蓝色护盾条（不是蓝血条），
  伤害先扣盾再扣血，**破盾有一小段无敌**；前后缀、高品质具名护盾、合成 / 融合 / 箱子掉落 / 商店购买
- **乘法律防护**：护甲与头盔减伤按 `1-(1-p)(1-q)` 叠加，头盔对躯干命中同样生效；
  爆炸 / splash 子弹带范围溅射，打穿的护甲报废且不再自愈
- **大地图互动**：8 座桥、河流涉水失温、医疗站/弹药柜/警报器/泄洪闸
- **2~4 人联机**：房主权威模拟；有 `server.js` 时走 HTTP 轮询，GitHub Pages / 纯静态托管自动切 WebRTC P2P（PeerJS），无需后端
- **双视角**：默认 2D 俯视（角色右手上有手持武器的平面模型）；局内可切 3D 第一人称（方块面光栅化，零依赖）。3D 把 2D 的同一批地物（分区 / 密林 / 道路 / 水面 / 桥 / 铁路 / 院子 / 房间 / 贴花 / 暗斑 / 房间名）做真透视投影，含手持武器模型与配件外观
- **医疗品五件套**：绷带 / 止血针 / 急救包 / 强心针 / 手术包，仓库带入与局内捡到的合并计数，**捡到即可用**，HUD 只显示实际拥有的
- 移动端触控（摇杆 + 按钮）、窄屏断点适配

## 运行

```sh
npm start          # 等价于 node server.js，默认 3000 端口
npm run verify     # 无浏览器逻辑回归（60 组 / 1257 条断言：减伤 / 弹种 / 护盾 / 经济 / 联机净化 / 存档迁移 / 文案护栏 / POI 主题装饰）
npm run bump -- 0.36.4  # 一条命令升版（package.json / CFG.version / index.html ?v= / WIKI），
                   # 改完自动跑 check 自证；不用再手工同步三处
npm run check      # 校验版本号三处同步 + 脚本缓存串 + README 目录表（无需安装依赖）
# 真实浏览器冒烟（需系统 Edge + Python playwright，先起服务）：
PORT=3211 node server.js
npm run test:e2e                # 断言 + dist/e2e/shots/*.png + test-report.json
                               # BO_SEED=20261107 固定整局生成（默认已固定），保证 42 项可重播
python probe_mechanics.py      # 只读机制体检 → mechanics-probe.json
node tools/econ_probe.cjs      # 零依赖经济体检：套利 / 撤离费 / 稀有度预算 / 单趟净利
node tools/econ_probe.cjs --out _work/econ.json   # 可选：把实测结果存成 JSON
# 或仅静态托管（自动切 WebRTC P2P 联机，无需 Node 后端）：
python -m http.server 8132
```

访问 `http://127.0.0.1:3000/`。

### 发布到 B 站 Toy

```sh
node tools/build_toy.cjs        # 生成 dist/toy/ + dist/borderops-toy-v<版本>.zip
python tools/make_toy_cover.py  # 生成封面 1920×1080 + 图标 512×512
```

`build_toy.cjs` **自己写 zip**（Node 原生 zlib，零依赖），并且打包后立刻解析产物自检：
**根目录必须有 index.html**（不能多套一层文件夹，这是「上传后打不开」的头号原因）、
入口 ≤1MB、入口引用的每个脚本都在包里。平台整包上限 50MB（本包约 550KB）。
Toy 是纯静态托管，不需要 `server.js`；联机会自动退到 WebRTC P2P
（依赖 PeerJS 公共信令，连接失败不影响单机）。

## 技术约束（给后续维护者）

1. **零构建**：原生 HTML/CSS/JS，不用 ES modules，不用打包器 / 框架；`server.js` 与 `check_version.js` 仅用 Node 原生模块。唯一第三方浏览器库是 `vendor/peerjs.min.js`（MIT，仅 P2P 联机时按需加载，许可原文见 `vendor/peerjs.LICENSE`）；项目自身许可见 `LICENSE`（MIT，版权归属待与合作者确认）。
2. **脚本顺序敏感**：所有 `src/*.js` 为经典脚本、共享全局作用域，靠 `index.html` 的 `<script>` 顺序加载（v0.31.3 共 32 个）：
   `sanitize → config → util → store → weapons → items → shields → skills → player → enemies → combat → lazy-legacy → shop → input → render → ui → viewmode → fpview → raid-data → raid-legends → raid-geometry → raid-core → raid-core2 → raid-core3 → raid-render → raid-ui → raid-ui2 → net → net-p2p → auction → save → main`
   其中 `raid-core2` / `raid-core3` 用 `Object.assign(Raid, {` 续接主控对象，**顺序不可调换**；`lazy-legacy.js` 在 `CFG.onlyRaid=true` 时不请求 `world` / `endless` / `dust2` / `br` 四个旧模式脚本。
3. **版本三处同步**：`package.json` 的 `version`、`src/config.js` 的 `CFG.version`、`index.html` 全部 `?v=` 缓存串。改代码后必须升版并同步，用 `npm run check` 校验。
4. **兼容旧存档**：v0.15.0 保留了全部内部键名（`element` / `mayhem` / `elemPct` / `core` 等）与 localStorage 存档结构，仅改变语义与显示；`ELEMENTS` 是 `AMMO_TYPES` 的兼容别名。新代码请优先使用 `AMMO_TYPES`。
5. 改动沿用现有风格：紧凑单行、中文注释带 `vX.Y.Z` 前缀。
6. **门禁与工具**：`npm run check`（代码三处版本 + 文档版本引用 + 脚本缓存串 + 懒加载清单）、`npm run lint`（ESLint 静态检查，可选本地工具）、`npm run verify`（无浏览器逻辑回归，含旧档迁移 / 净化 / EV / 文案护栏）、`npm run bench:fps`（可选，需本机 Chrome，输出 `fps-baseline.json`）。`.github/workflows/ci.yml` 自 v0.23.2 起已在 GitHub 网页创建并启用，每次 push 自动跑 check / verify / 全量语法检查。`npm run lint` 与 `npm run test:e2e` 的 CI job 已写好但**没能推送**：本机 OAuth 凭据缺 `workflow` scope，GitHub 拒绝 `.github/workflows/*` 变更；文件在 `dist/pending-workflows/`，重新授权或网页端粘贴即可启用（见 CHANGELOG v0.36.4）。
7. **测试的两类断言**：`verify.cjs` 里既有在 vm 中真实调用结算 / 生成逻辑的**行为断言**，也有检查实现或文案是否仍在的**源码护栏断言**（对重命名、重构脆弱）。运行结束时 `npm run verify` 会打印两类占比，别把总条数当成等价的行为覆盖率。

## 目录结构

| 路径 | 职责 |
|---|---|
| `index.html` | 唯一 HTML：画布 + overlay + 局内物品栏层 + 脚本清单 |
| `styles.css` | 全部样式，含移动端断点 |
| `src/config.js` | 全局常量、弹种/品质/改装词条/兵工厂/枪型定义 |
| `src/raid-*.js` | 主战场按自然边界拆成 9 片（合计 ~12.8k 行，单片 ≤2000 行，verify 有护栏）：`raid-data`（数据表/工具/RaidStash）、`raid-core`/`core2`/`core3`（主控 Raid，`Object.assign` 续接）、`raid-render`（RenderRaid + HUD）、`raid-ui`/`ui2`（UI 补丁） |
| `src/sanitize.js` | 联机数据净化内核（UMD 同构）：HTTP 轮询 / WebRTC P2P / 单测共用一份 corpse schema 与文本净化规则 |
| `src/lazy-legacy.js` | 旧模式按需加载器：`onlyRaid=true` 时不请求战役/无尽/沙二/大逃杀 4 个脚本 |
| `src/save.js` | 存档读写 + 存档码导出/导入（`BOPS1-` 前缀，解绑域名） |
| `src/weapons.js` | 枪械生成、改装词条、品级、部件与模块乘区 |
| `src/combat.js` | 实体弹道、命中结算、弹种终点效应 |
| `src/net.js` | 联机客户端（HTTP 轮询）+ 状态 / AI 快照生成 |
| `src/net-p2p.js` | GitHub Pages / 纯静态托管联机（WebRTC P2P，PeerJS） |
| `vendor/peerjs.min.js` | PeerJS 浏览器运行时（MIT，按需动态加载） |
| `server.js` | 联机房服务器 + 静态托管（Node 原生 http，无依赖）；`require` 时不启动监听，纯函数供单测调用 |
| `.github/workflows/ci.yml` | GitHub Actions：版本门禁 + 逻辑回归 + 全量语法检查 + fixtures 校验 |
| `tools/fps_bench.cjs` | FPS 基准探针：本地静态服务 + headless Chromium + CDP，2D/3D 各采 120 帧 |
| `fixtures/legacy-saves.json` | 旧存档迁移回归固定样本（verify 组 32 读取） |
| `check_version.js` | 版本一致性与缓存串校验（`npm run check`） |
| `src/*.js` 其余 | 通用引擎层与附属模式 |
| `verify.cjs` | vm 沙箱逻辑回归（`npm run verify`，1257 项断言） |
| `tools/bump_version.cjs` | 一条命令升版并把四处版本号同步（`npm run bump -- x.y.z`） |
| `tools/e2e.cjs` | 浏览器冒烟运行器：随机端口起 server.js、等 `/api/ping`、跑完收尸（`npm run test:e2e`，找不到 Edge 时用自带 chromium） |
| `playwright_smoke.py` / `probe_mechanics.py` | 真实浏览器冒烟（42 项断言）与只读机制体检 |
| `testshots/` / `test-report.json` / `mechanics-probe.json` | 冒烟截图与结构化测试报告（本地产物；`testshots/` 已 gitignore，不入库） |
| `LICENSE` | 项目 MIT 许可（含第三方 PeerJS 声明） |

## GitHub Pages 部署说明

本仓库已启用 GitHub Pages（静态托管）。**单机与 2~4 人联机都可在 Pages 上直接玩**：

- 进入「联机突袭」后，客户端会先探测同源 `/api/ping`。Pages 没有 Node 后端，会自动切到 **WebRTC P2P 直连**（PeerJS 公共信令 + STUN），房主仍然是权威模拟端。
- 房间码仍是 4 位；房主创建后把房间码发给队友即可。
- **限制**：P2P 只做尽力而为的 NAT 穿透，双方都在严格 NAT / 对称 NAT 后可能连不上；房主离开房间即结束（不做房主迁移）。需要稳定联机时，仍建议部署 `node server.js` 或使用官方部署地址。
- `vendor/peerjs.min.js` 必须随静态站点一起上传；首次创建 / 加入房间时才会按需加载，单机模式不会请求它。

存档保存在浏览器 `localStorage`，与部署域名绑定：Pages 域名与官方域名的存档互不相通。
