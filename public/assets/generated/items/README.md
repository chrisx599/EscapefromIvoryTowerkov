# 物品图标

本目录保留 35 种物品的透明像素 PNG，用于当前仓库、装备、商店、背包与结算界面。

- 图标映射：`public/item-art.js`。
- 材料与装备定义：`src/content.js` 和 `src/loot-content.js`。
- 文件名与物品 ID 一致，未知 ID 不生成图片地址。
- 原始生成提示词分别保存在 `prompts-documents.json`、`prompts-gear.json`、`prompts-devices.json`、`prompts-research-tools.json`、`prompts-storage.json`、`prompts-supplies.json`。

素材使用低饱和像素风，保留透明背景；界面用 CSS 控制缩放。完整映射与安全转义通过 `npm test` 验证。
