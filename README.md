# 边境行动 · BORDER OPS

俯视角**拟真撤离射击**网页游戏（中文界面）。主玩法为**塔科夫模式 · 撤离突袭**：配装大厅 → 进入 13000×9600 大地图「海关流域」→ 搜刮 / 交战 / 商店交易 → 活着撤离才入库，阵亡或超时装备与战利品全丢。

> v0.15.0 起全面移除超现实与魔法内容：没有元素伤害、混乱等级、附魔、吸血、追踪弹、能量武器与神话品质；全部替换为现实弹种、军械改装、防护等级与军工品相。
>
> v0.14.9 起默认**只显示塔科夫模式入口**；战役 / 无尽 / 沙二 / 大逃杀代码仍保留，把 `src/config.js` 的 `CFG.onlyRaid` 改为 `false` 可恢复。塔科夫 HUD 小地图默认关闭，`CFG.raidMinimap` 改为 `true` 可恢复。

线上地址：`https://borderops.app.workbuddy.host/`（官方部署，含联机后端）

## 特性

- **撤离射击循环**：9 阶军规品相战利品、5 级钥匙与上锁箱、9 家随机商店（枪械/材料/回收/黑市）、黑市代币经济、装备保险与撤离费
- **现实弹种**：FMJ 全被甲 / T 曳光 / AP 钢芯穿甲 / HP 空尖 / US 亚音速 / HE 破片 / BT 穿甲曳光，以穿透等级与软目标·护甲终点效应区分，无持续伤害与状态异常
- **改装词条**：兵工厂 × 枪型 × 品级 × 改装词条 × 部件组合生成；词条全部为可解释的工艺参数（冷锻枪管、浮置枪管、精磨扳机、制退器、后坐控制、有效射程……）
- **真实型号**：8 家兵工厂（图拉、伊热夫斯克、卡拉什尼科夫、赫克勒-科赫、FN 赫斯塔尔等）与 AK-74N / SVD-S / MP5SD / Saiga-12 等型号；具名装备为 6B43、Altyn、Vulkan-5 等现实装备
- **护甲与耐久**：T1~T9 现实防护等级，插板耐久只能维修、**不会自动回复**；命中部位与弹药穿深决定减伤
- **改装模块**：弹种适配组件（换弹药）、膛压组件（提升改装等级）、7 类工艺改装模块；枪匠台提供重调词条与部件/模块装配
- **拟真 AI**：视野/枪声传播/调查行为、打空弹匣换弹后撤、残血包扎、翻尸补弹、子弹擦身侧闪
- **大地图互动**：8 座桥、河流涉水失温、医疗站/弹药柜/警报器/泄洪闸
- **2~4 人联机**：房主权威模拟 + HTTP 轮询快照（需后端，见下）
- 移动端触控（摇杆 + 按钮）、窄屏断点适配

## 运行

```sh
npm start          # 等价于 node server.js，默认 3000 端口
npm run check      # 校验版本号三处同步 + 脚本缓存串（无需安装依赖）
# 或仅静态托管（联机不可用）：
python -m http.server 8132
```

访问 `http://127.0.0.1:3000/`。

## 技术约束（给后续维护者）

1. **零构建**：原生 HTML/CSS/JS，不用 ES modules，不用打包器 / 框架 / npm 运行时依赖（`server.js` 与 `check_version.js` 仅用 Node 原生模块）。
2. **脚本顺序敏感**：所有 `src/*.js` 为经典脚本、共享全局作用域，靠 `index.html` 的 `<script>` 顺序加载：
   `config → util → weapons → items → skills → player → enemies → combat → world → endless → dust2 → shop → input → render → ui → raid → net → auction → br → save → main`
3. **版本三处同步**：`package.json` 的 `version`、`src/config.js` 的 `CFG.version`、`index.html` 全部 `?v=` 缓存串。改代码后必须升版并同步，用 `npm run check` 校验。
4. **兼容旧存档**：v0.15.0 保留了全部内部键名（`element` / `mayhem` / `elemPct` / `core` 等）与 localStorage 存档结构，仅改变语义与显示；`ELEMENTS` 是 `AMMO_TYPES` 的兼容别名。新代码请优先使用 `AMMO_TYPES`。
5. 改动沿用现有风格：紧凑单行、中文注释带 `vX.Y.Z` 前缀。

## 目录结构

| 路径 | 职责 |
|---|---|
| `index.html` | 唯一 HTML：画布 + overlay + 局内物品栏层 + 脚本清单 |
| `styles.css` | 全部样式，含移动端断点 |
| `src/config.js` | 全局常量、弹种/品相/改装词条/兵工厂/枪型定义 |
| `src/raid.js` | 主战场（~7.9k 行）：地图/房间/商店/AI/战利品/钥匙/结算/配装大厅 |
| `src/weapons.js` | 枪械生成、改装词条、品级、部件与模块乘区 |
| `src/combat.js` | 实体弹道、命中结算、弹种终点效应 |
| `src/net.js` | 联机客户端（HTTP 轮询） |
| `server.js` | 联机房服务器 + 静态托管（Node 原生 http，无依赖） |
| `check_version.js` | 版本一致性与缓存串校验（`npm run check`） |
| `src/*.js` 其余 | 通用引擎层与附属模式 |
| `check_*.py` / `smoke_*.py` | Playwright 回归脚本 |

## GitHub Pages 部署说明

本仓库已启用 GitHub Pages（静态托管）。**塔科夫模式的单机玩法在 Pages 上完整可用**；但 2~4 人联机依赖 `server.js` 的 `/api/*` 房间接口，Pages 无法运行 Node 后端，联机入口会提示「连不上服务器」——联机请使用上方官方部署地址，或自行部署 `node server.js`。

存档保存在浏览器 `localStorage`，与部署域名绑定：Pages 域名与官方域名的存档互不相通。
