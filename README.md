# Mage Knight Web

一个规则自动执行的《法师骑士》(Mage Knight) 风格单人网页游戏：六边形地图探索、手牌组合产生移动/交涉/攻击/格挡资源、日夜与法力的时间压力，以及场景目标和首领战。当前版本 **v0.8.0**。

> 本项目为个人学习与爱好作品，与 WizKids 及原版桌游权利方无关。卡牌和版图使用可替换的占位表现，仓库中不包含任何官方图片素材。

## 功能概览

- **教学关卡**：固定剧本的入门切片。
- **单人征服 (Solo Conquest)**：四位原版英雄及 Braevalar，完整牌池、市场、单位招募、技能与神器。
- **扩展模块**：原版、Lost Legion、Krang、Shades of Tezla 可单独或组合启用（共八种组合）。
- **存档与回放**：IndexedDB 本地存档，支持撤销；存档 schema 8，旧版本存档自动迁移；回放校验模块、内容哈希和终局哈希。
- **求解器**：内置征服场景求解器，用于验收与回归（结果见 `artifacts/solver/`）。
- **多人预留**：`server/` 提供一个本地多人 API 雏形，前端有在线模式入口。
- **响应式布局**：桌面优先，兼顾平板与手机窄屏。

## 技术栈

TypeScript · React 19 · Vite · Zod · Vitest · Playwright · ESLint（npm workspaces 单仓多包）

## 目录结构

```
apps/web/              前端应用（React），含 e2e 测试
packages/engine/       规则引擎：回合、战斗、效果 DSL、征服模式、求解器
packages/content/      内容数据与各版本内容清单
packages/content-schema/  内容与存档的 Zod 模式
packages/test-kit/     测试夹具
server/                本地多人 API（Node + tsx）
docs/                  规则规格、开发计划、各版本实现状态/测试覆盖/验收报告
artifacts/solver/      求解器报告与回放
```

## 快速开始

需要 Node.js 22+。

```bash
npm install
npm run dev          # 前端开发服务器 http://127.0.0.1:4173
npm run server       # 可选：多人 API，默认端口 4174
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run build` | 类型检查并构建到 `dist/` |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint |
| `npm test` | Vitest 单元测试 |
| `npm run test:replay` | 教学与征服回放测试 |
| `npm run test:property` | 属性测试 |
| `npm run solver` | 求解器验收 |
| `npm run test:e2e` | Playwright 端到端测试 |
| `npm run test:acceptance` | 完整发布门禁 |

## 关于游戏图包

开发时参考的 Tabletop Simulator Mod 资源（`Mage Knight Plus (Highly Scripted) (...)/`）以及 `tmp/` 下的图片体积大且涉及版权，已在 `.gitignore` 中排除，**不会提交到仓库**。如需本地参考，请自行获取并放在项目根目录。规则实体通过 `assetAlias` 与素材解耦，没有这些文件也能正常构建和运行。

## 文档

从 [docs/README.md](docs/README.md) 开始，按顺序阅读规则源清单、开发规则规格、实施计划和各版本说明。
