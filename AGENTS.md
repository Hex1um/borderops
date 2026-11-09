# AGENTS.md — 给所有 AI Agent / 协作者的强制约定

> 本文件优先级高于 README 与 CHANGELOG。动手改代码前**先读完这一页**。

---

# ⛔ 最重要的一条：B 站 Toy 版已冻结，永远不要更新它

| 项 | 状态 |
|---|---|
| B 站 Toy 版分支 | `toy`（版本锚定 **0.37.0**） |
| 状态 | **FROZEN / 已冻结（2026-11-09 起）** |
| 原因 | Toy 每次更新文件都要重新走审核 + 重新发布；收益远小于成本，所以**不再跟随游戏更新** |

**禁止事项（任何 agent 都不要做）：**

1. ❌ 不要把 `main` 的新改动 merge / cherry-pick / 手动搬到 `toy`
2. ❌ 不要在 `toy` 上改任何东西（除非用户**这一次明确要求**改 B 站版）
3. ❌ 不要因为「改了游戏本体」就顺手重新打包 `dist/borderops-toy-*.zip` 或提示用户"该重新发布了"
4. ❌ 不要把 `main` 的版本号推到 0.37.x（0.37.0 是 toy 的终版，避免版本号语义混淆）

**默认行为**：所有新功能、修 bug、数值调整**只改 `main`**，按 main 自己的版本序列升版
（0.36.3 → 0.36.4 …，跨过 0.37 时直接用 **0.38.0**）。

**唯一例外**：用户明确说「改 B 站版 / 更新 toy / 重新发布 Toy」时，才切到 `toy` 操作。

---

## 两条发布线

| 分支 | 用途 | 版本 | 内容差异 |
|---|---|---|---|
| `main` | GitHub Pages 公开版：`https://hex1um.github.io/borderops/` | 0.36.2 →（继续演进） | **原版命名**：图拉兵工厂、AK-74N、塔科夫模式等 |
| `toy` | B 站 Toy 投稿版（**已冻结**） | 0.37.0（终版） | 商标合规化（12 家厂商 + 84 个枪型号原创化、他人游戏名替换）+ `src/toy-sdk.js`（云存档 / 云房间） |

**两条线不要互相 merge**：`toy` 的合规改名会污染 `main` 的原版命名，反之亦然。

## 日常流程

```sh
# 1. 先同步远端（用户要求：每次对话开头检查是否有新提交）
git pull --ff-only

# 2. 改动只在 main 上做，改完即发布（用户长期授权）
node check_version.js && node verify.cjs && npx eslint src/
git add -A && git commit -m "..." && git push origin main
```

`main` 推上去后 GitHub Pages 会自动构建，**不需要**任何额外发布动作。

## 工具脚本

| 脚本 | 作用 | 何时用 |
|---|---|---|
| `npm run check` | 版本三处同步 + 脚本清单 + 文档引用 | 每次改完必跑 |
| `npm run verify` | 无浏览器逻辑回归（`verify.cjs`，1100+ 条断言） | 每次改完必跑 |
| `npm run lint` | ESLint | 每次改完必跑（0 error 才算过） |
| `tools/build_toy.cjs` | 打包 B 站 Toy zip | **仅在明确要更新 B 站版时** |
| `tools/make_toy_cover.py` | 生成 Toy 封面/图标 | 同上 |

## 硬性工程约束（改了会直接挂 CI）

1. **版本三处同步**：`package.json` / `src/config.js` 的 `CFG.version` / `index.html` 全部 `?v=`，`npm run check` 会卡。
2. **分片行数 ≤2000**：`raid-*.js` 每个文件；注意 `verify` 用 `split('\n').length` 判定，实际等于 `wc -l ≤1999`。
3. **经典脚本顺序敏感**：`index.html` 的 `<script>` 顺序不可调换（`raid-core2/3` 用 `Object.assign` 续接）。
4. **零依赖零构建**：不引入打包器/框架/ES modules；唯一第三方是 `vendor/peerjs.min.js`。
5. **只有 `store.js` 能直连 `localStorage`**，其他模块走 `Store`。
6. **不要吞错**：禁止裸 `catch(e){}`（`verify` 会扫）。

## 给接手者的三个坑（都踩过）

- `raid` 系列的枪械是**扁平对象**（`blGunConvert` 产物），不是 `Weapon` 实例；给它加字段要同时改 `blGunConvert` 与读取端（`_fire` / `_startReload` / `raidGunMoveMul`），否则「看起来加了但其实没生效」——v0.36.0 修过一次。
- 改名/替换类批量改动后，务必检查 `SHOTGUN_MODELS`、`SCAV_GUN_MODELS`、具名枪 `model` 字段这三个**用名字做 key 的表**，漏改不会报错，只会静默退回默认值。
- 仓库文件是 **CRLF**；用脚本按行改文件时，`L[i] === '  },'` 这类比较要先 `trimEnd()`。
