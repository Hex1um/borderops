# ⛔ 本分支已冻结（2026-11-09）

`toy` 分支是 **B 站 Toy 投稿版**，锚定在 **v0.37.0**，**不再接收任何更新**。

- 原因：Toy 每次更新文件都要重新审核 + 重新发布，成本高于收益。
- 冻结内容：商标合规化命名 + `src/toy-sdk.js`（B 站云存档 / 云房间）。
- **不要**把 `main` 的改动 merge / cherry-pick 到这里。
- **不要**在这里做任何修改，除非使用者**这一次明确要求**改 B 站版。

游戏本体的持续开发在 **`main`** 分支（GitHub Pages：`https://hex1um.github.io/borderops/`）。
详细约定见 main 分支的 `AGENTS.md` 与 `README.md`。

## 如果确实需要重新出包

```sh
git checkout toy
node tools/build_toy.cjs        # → dist/borderops-toy-v0.37.0.zip（根目录含 index.html）
python tools/make_toy_cover.py  # 封面 1920×1080 + 图标 512×512
```

上传到 B 站 Toy 后不需要在这里改版本号 —— 它已经是终版。
