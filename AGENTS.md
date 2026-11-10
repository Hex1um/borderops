# AGENTS.md — 给所有 AI Agent / 协作者的强制约定

> 本文件优先级高于 README 与 CHANGELOG。动手改代码前**先读完这一页**。

---

# ⚠️ 最重要的一条：默认只改 `main`，改 Toy 必须被明确点名

| 项 | 状态 |
|---|---|
| `toy` 分支 | **B 站 Toy 版（合规改名 + 云存档 + 排行榜）** |
| 当前版本 | 0.37.1 |
| 默认动作 | **一律改 `main`** |
| 改 toy 的唯一条件 | 使用者**明确说**「改 Toy / 改 B 站版 / 更新 toy / 给 Toy 加…」 |

**判定规则（照字面执行，不要自由发挥）：**

1. 使用者的需求里**没有**明确提到 Toy / B 站版 / toy → **只改 `main`**，不要顺手动 toy。
2. 明确提到了 → 在 `toy` 分支改，改完出包并提醒「需要在 Toy 后台点『更新』」。
3. **仍然禁止**把 `main` 整体 merge / cherry-pick 到 `toy`：toy 里有商标合规改名，
   被 main 的原版命名覆盖会直接破坏合规（这是硬伤，不是风格问题）。
4. 两条线的版本序列**独立**，不要互相比较：toy 走 0.37.x，main 走自己的序列
   （跨过时直接用 0.38.0 这类新号，避免与 toy 撞号）。
5. 改动 toy 后**不要**顺手改 main 的同名功能：两条线本来就允许功能不一致。

> 历史：2026-11-09 曾决定「toy 永久冻结」；2026-11-10 使用者改为本规则，理由是
> 「只在需要时改，别每次都被迫重新发布 Toy」。以本条为准。

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

# 2. 改动只在 main 上做
#    升版用一条命令，别手工同步四处（会漏）
npm run bump -- 0.36.4        # package.json / CFG.version / index.html ?v= / WIKI，自动跑 check 自证

# 3. 三连门禁 —— 三项都必须过，缺一不算完成
npm run check                 # 版本一致性 + 脚本清单 + README 目录表
npm run verify                # 1100+ 条逻辑回归
npm run lint                  # ESLint，0 error 才算过

# 4. 改完即发布（用户长期授权，不必再问）
git add -A && git commit -m "..." && git push origin main
```

**硬约定**：任何一次「改代码」结束时，`check` / `verify` / `lint` 必须三项全绿；只跑其中一项就汇报「完成」视为未完成。

`main` 推上去后 GitHub Pages 会自动构建，**不需要**任何额外发布动作。

## 工具脚本

| 脚本 | 作用 | 何时用 |
|---|---|---|
| `npm run check` | 版本三处同步 + 脚本清单 + 文档引用 | 每次改完必跑 |
| `npm run verify` | 无浏览器逻辑回归（`verify.cjs`，1100+ 条断言） | 每次改完必跑 |
| `npm run lint` | ESLint | 每次改完必跑（0 error 才算过） |
| `tools/build_toy.cjs` | 打包 B 站 Toy zip | **仅在明确要更新 B 站版时** |
| `tools/make_toy_cover.py` | 生成 Toy 封面/图标 | 同上 |
| `npm run bump -- x.y.z` | 一条命令升版，自动同步四处版本号并自证 | 每次升版 |

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
