# Mage Knight 风格单人 Web 小游戏实施计划

## 1. 产品定位

目标不是在浏览器里模拟一张物理桌面，而是把核心体验提炼成一个规则自动执行的单人卡牌战棋：

- 六边形地图探索和路径选择。
- 手牌组合产生移动、互动、攻击和格挡资源。
- 日夜、法力、牌库耗尽共同形成时间压力。
- 招募单位、学习高级行动/法术、获得神器和技能形成成长。
- 场景目标和 Boss 战形成一局的结构。
- 原版、三扩和粉丝扩展作为可开关内容包。

第一版只做桌面浏览器，兼容平板横屏。手机竖屏不作为首发验收目标，因为同时查看地图、手牌、战斗和市场会牺牲可读性。

## 2. 参考案例与可借鉴点

### 2.1 产品参考

- [Paladin's Oath](https://store.steampowered.com/app/1671590/Paladins_Oath/)：直接证明“随机地图 + 牌组构筑 + 回合制探索 + 单人解题”可以脱离实体桌游成立。应借鉴其单人优先和自动化结算，不复制视觉或内容。
- [Board Game Arena](https://en.boardgamearena.com/)：说明复杂桌游可在浏览器中以清晰的 2D 状态、操作提示和回合日志呈现，不需要物理模拟。
- Dire Wolf 曾宣布 Mage Knight 数字版，但其[官方页面已标注停止开发](https://news.direwolfdigital.com/bringing-board-games-to-digital-life/)。这说明项目难点不是画面，而是规则覆盖、交互解释和内容 QA，应尽早做垂直切片验证。

### 2.2 工程参考

- [boardgame.io](https://github.com/boardgameio/boardgame.io) 的纯状态、合法 move、阶段、日志和服务端权威模式值得借鉴；本项目单人优先且决策窗口更复杂，不建议首版直接绑定该框架。
- [Red Blob Games 六边形实现指南](https://www.redblobgames.com/grids/hexagons/implementation.html) 提供轴向/立方坐标、邻居、距离、屏幕坐标和寻路的成熟实现方式。
- [PixiJS Assets](https://pixijs.com/8.x/guides/components/assets) 的 alias、manifest、bundle 和 fallback 思路可用于素材主题包；首版地图规模不大，先用 SVG，达到性能瓶颈后再换 PixiJS。
- [Colyseus 状态同步](https://docs.colyseus.io/state) 可作为未来多人服务器的参考：客户端提交意图，服务器修改权威状态并下发增量。
- 开源的 [colonist.play](https://github.com/LJ-Web-Management/colonist.play) 展示了 `TypeScript engine + typed events + SVG hex board + React UI + Vitest` 的可行目录边界，可参考结构而不复制实现。

## 3. 推荐技术方案

### 3.1 首版技术栈

| 层 | 选择 | 原因 |
| --- | --- | --- |
| 语言 | TypeScript strict | 规则对象复杂，需要联合类型和穷尽检查 |
| 构建 | Vite | 单页游戏启动快、静态部署简单 |
| UI | React | 卡牌、市场、日志、弹窗和响应式布局适合 DOM |
| 地图 | SVG + React | 首版通常不足百格，命中区、可访问性和调试最简单 |
| 状态 | 自建纯规则引擎 + UI store | 不让 UI 框架成为规则权威 |
| 校验 | Zod 或等价 schema | 校验内容包、存档和版本迁移 |
| 单测 | Vitest | 快速跑大量纯规则测试和 seed 回放 |
| 组件测试 | React Testing Library | 验证按钮合法性、决策提示和键盘操作 |
| E2E | Playwright | 完整场景、存档、刷新、响应式和视觉回归 |
| 存档 | IndexedDB | 保存大状态、多个槽位和回放日志 |
| 部署 | 静态站点/PWA | 单人版无需后端即可运行 |

不建议首版使用 Phaser 作为全 UI 容器。Mage Knight 的主要复杂度是密集文字、卡牌选择、市场和可解释结算，DOM 比 Canvas 更适合。若后期地图动画、粒子和大量精灵成为重点，可只把 `MapViewport` 替换为 PixiJS，规则层不变。

### 3.2 目录结构

```text
apps/
  web/                    React 页面、路由、PWA、IndexedDB
packages/
  engine/                 纯 TypeScript 规则引擎
    commands/
    events/
    reducers/
    validators/
    combat/
    map/
    rng/
    scenario/
    save/
  content/                原版和各扩展的结构化数据
    core/
    lost-legion/
    krang/
    shades-of-tezla/
    apocalypse/
    forgemasters/
    weather/
    item-shop/
  content-schema/         内容包 schema、迁移和 lint
  ui/                     卡牌、地图、市场、战斗面板等通用组件
  test-kit/               固定牌序、场景夹具、事件断言
assets/
  placeholder/
  themes/
docs/
```

## 4. 架构边界

### 4.1 规则引擎

规则引擎公开四个核心接口：

```ts
createGame(config, content): GameState
getLegalIntents(state, viewerId): LegalIntent[]
executeIntent(state, intent): ExecutionResult
projectView(state, viewerId): GameView
```

`executeIntent` 不播放动画、不读浏览器时间、不访问网络，也不调用未注入的随机数。失败返回结构化错误和 UI 可显示的原因，不产生部分状态。

### 4.2 命令与事件

命令代表玩家意图：

- `PlayCard`
- `UseMana`
- `MoveHero`
- `ExploreTile`
- `StartInteraction`
- `BuyOfferCard`
- `StartCombat`
- `AssignAttack`
- `AssignBlock`
- `AssignDamage`
- `ResolveDecision`
- `EndTurn`

事件代表已发生事实：

- `CardMoved`
- `ManaSpent`
- `HeroMoved`
- `TileRevealed`
- `EnemyRevealed`
- `AttackDeclared`
- `EnemyDefeated`
- `WoundGained`
- `RewardGranted`
- `DecisionOpened`
- `CheckpointCreated`

UI 只根据事件播放动画。事件日志同时用于撤销、回放、Bug 报告和未来多人同步。

### 4.3 决策请求

复杂卡牌游戏不能靠一串同步函数弹多个窗口。引擎遇到玩家选择时生成持久化的 `DecisionRequest`：

```ts
type DecisionRequest = {
  id: string;
  ownerIds: PlayerId[];
  kind: 'choose-card' | 'choose-target' | 'allocate-value' | 'order-events';
  source: EntityRef;
  min: number;
  max: number;
  options: DecisionOption[];
  continuation: ContinuationRef;
};
```

在请求完成前，规则引擎只接受 `ResolveDecision`、查看详情和允许的撤销命令。这样任务、升级、复合效果、Boss 分配和未来合作攻城都能保存并恢复。

## 5. 内容与效果系统

### 5.1 内容包

每个模块有独立 manifest：

```json
{
  "id": "lost-legion",
  "version": "1.0.0",
  "requires": ["core"],
  "conflicts": [],
  "cards": "cards.json",
  "enemies": "enemies.json",
  "sites": "sites.json",
  "scenarios": "scenarios.json",
  "assets": "assets.json"
}
```

模块只能通过注册表增加内容、能力处理器和场景钩子，不能从 UI 中修改基础规则。

### 5.2 卡牌效果 DSL

80% 以上卡牌应由声明式效果树表达：

```json
{
  "id": "core.rage",
  "basic": { "type": "gain", "resource": "attack", "amount": 2 },
  "strong": {
    "type": "sequence",
    "effects": [
      { "type": "spend-mana", "color": "red", "amount": 1 },
      { "type": "gain", "resource": "attack", "amount": 4 }
    ]
  }
}
```

DSL 首批节点：

- `sequence`、`choose-one`、`conditional`、`repeat`。
- `gain`、`spend`、`convert`、`draw`、`discard`、`throw-away`。
- `select-target`、`modify-entity`、`move-entity`。
- `create-triggered-effect`、`create-lasting-effect`、`replace-event`。
- `play-other-effect`、`copy-effect`、`set-aside`、`prepare`、`tuck`。

少数真正特殊的卡牌使用受控脚本处理器：`handlerId + typed params`。不得在 JSON 中执行任意 JavaScript，避免存档不稳定和内容包注入风险。

### 5.3 素材替换

规则实体只引用稳定 asset alias：

```json
{
  "entityId": "core.hero.tovak",
  "portrait": "hero.tovak.portrait",
  "figure": "hero.tovak.figure",
  "cardBack": "card.basic.back"
}
```

主题包把 alias 映射到实际文件：

```json
{
  "themeId": "placeholder-v1",
  "assets": {
    "hero.tovak.portrait": "/themes/placeholder/heroes/tovak.webp",
    "hero.tovak.figure": "/themes/placeholder/figures/tovak.webp"
  }
}
```

要求：

- 缺失素材有统一占位图，不能阻止游戏加载。
- 规则数据不得依赖图片尺寸、文件名或颜色取值。
- 卡面文字由 HTML 渲染，不烘焙进图片，便于中文化和修改。
- 图标使用独立 icon atlas 或字体，并带文本替代说明。
- 主题包可在开发模式热替换。

## 6. UI 信息架构

### 6.1 主界面

桌面布局建议：

- 中央：可平移、缩放的六边形地图。
- 底部：固定高度手牌带，支持点击选择、拖拽到资源区和悬停放大。
- 左侧：英雄、等级、护甲、手牌上限、名望、声望、法力和水晶。
- 右侧：当前阶段、可执行动作、敌人/地点详情、市场或战斗面板。
- 顶部：轮次、日夜、顺位、场景目标、暂停/存档/规则日志。

不要把所有组件做成漂浮卡片。地图是主工作区，侧栏是连续工具面板，卡牌本身才使用卡片视觉。

### 6.2 操作原则

- 任何时刻只突出当前合法目标，非法目标仍可查看但显示具体原因。
- 打牌后先进入“暂定组合”，实时显示 Move/Influence/Attack/Block 总计，再由玩家确认。
- 战斗按四阶段展示，已完成阶段可回看但不可修改到信息屏障之前。
- 数值计算必须可展开，显示每个来源、抗性减半、工事和能力修正。
- 动画不阻塞规则执行，提供快速动画和跳过动画选项。
- 卡牌、敌人和图标均可按住或点击打开规则详情，不依赖 hover。

### 6.3 新手辅助

- 第一侦察场景作为交互教学。
- 合法行动查询驱动提示，不另写一套教程判断逻辑。
- 初次出现新能力时显示一次简短说明，可在设置关闭。
- 规则日志支持点击实体跳转，便于理解“为什么是这个结果”。

## 7. 存档、回放与调试

存档包含完整状态快照和从快照之后的事件。每隔固定事件数建立快照，避免回放整个游戏。

至少提供：

- 三个手动存档槽。
- 每回合开始自动存档。
- 页面关闭/切后台自动存档。
- 事件日志导出为 JSON。
- 从失败报告导入 seed、内容版本和命令序列。
- 内容版本迁移；无法迁移时保留旧内容包或给出明确错误。

开发调试器应显示：当前 phase、pending decision、牌堆顺序、事件日志、模块钩子、战斗修正明细和不变量检查结果。

## 8. 测试策略

### 8.1 测试金字塔

1. 纯函数单测：六边形坐标、资源支付、抗性、格挡、伤害、市场刷新。
2. 命令测试：给定状态和命令，断言事件和新状态。
3. 规则场景测试：固定牌序走完一个短场景。
4. 属性测试：随机合法命令序列下不变量始终成立。
5. 内容 lint：所有 ID、引用、素材 alias、模块依赖和翻译键有效。
6. UI 组件测试：合法/非法按钮、决策弹窗、计算明细。
7. Playwright：新游戏、完整一轮、战斗、升级、存档恢复和不同视口。
8. 视觉回归：地图、手牌、市场、战斗面板在 1440x900、1920x1080、平板横屏下无重叠。

### 8.2 Golden Replay

每个版本保存一组“种子 + 命令序列 + 最终状态哈希”。任何规则改动导致哈希变化时，必须审查是预期规则修正还是回归。

首批 Golden Replay：

- First Reconnaissance 教学局。
- Solo Conquest 基础局。
- Lost Legion 的 Volkare 遭遇。
- Krang Flip Back 技能回合。
- Tezla Pursuit/Ambush 场景。
- Apocalypse Dragon 单人 Boss 战。
- Forgemasters bonus/penalty 和 shard 组合。

## 9. 实施阶段

以下估算按一名熟悉 TypeScript/React 的开发者全职、已有规则分析文档、使用占位美术计算。内容录入和规则 QA 的波动最大。

### 阶段 0：规则与内容基线，3-5 天

交付：

- 确认英文规则为逻辑基准。
- 确认首发场景和首发英雄。
- 建立内容 ID 命名规范和模块 manifest schema。
- 从 TTS JSON 导出组件候选清单，不直接把 TTS 数据当成运行时格式。
- 建立规则疑问清单和裁定记录 ADR。

验收：同一个实体在原版、扩展、中文名和 TTS GUID 之间有稳定映射。

### 阶段 1：引擎骨架，1.5-2 周

交付：

- monorepo、CI、TypeScript strict、Vitest。
- `GameState`、命令、事件、reducer、seed RNG。
- 卡牌区域、资源支付、决策请求和不变量系统。
- 轴向六边形坐标、地图存储和寻路基础。
- JSON 存档 round-trip。

验收：无 UI 也能通过脚本创建游戏、打牌、移动、保存、加载并得到相同哈希。

### 阶段 2：可玩垂直切片，2-3 周

范围：Tovak + 精简 First Reconnaissance。

交付：

- React 主界面、SVG 地图、手牌、英雄面板和行动日志。
- 打牌组合、法力强化、横置牌、移动和探索。
- 一种互动地点、两类敌人、完整四阶段战斗。
- 伤牌、治疗、回合结束、抽牌和轮末。
- IndexedDB 自动存档和信息屏障撤销。

验收：玩家可在浏览器从开局玩到教学场景结束；刷新页面能继续；所有数值有可展开来源。

### 阶段 3：原版单人完整，4-6 周

交付：

- 全部原版英雄、基础行动、技能、单位、法术、高级行动、神器。
- 全部基础地点、城市、遗迹和敌人能力。
- 日夜、战术、市场、升级、声望、标准计分。
- Dummy Player。
- Solo Conquest 和至少两个额外单人场景。
- First Reconnaissance 完整教学。

验收：规则覆盖矩阵中的原版条目全部有自动测试；至少完成 20 局固定 seed 回放。

### 阶段 4：官方三扩，4-7 周

按依赖顺序分批发布：

1. Krang：角色和 Flip Back，风险最低。
2. Lost Legion 内容：墙、新地点、新单位、新敌人能力。
3. Volkare 场景和行为。
4. Shades of Tezla：阵营、Defend、Vampiric、Ambush、Pursuit 和首领。

每个子模块都有独立开关、内容 lint 和 Golden Replay。

验收：模块任意合法组合可开局；关闭模块后不泄漏其牌、敌人、地点或规则钩子。

### 阶段 5：Apocalypse Dragon，4-6 周

交付顺序：

1. Faction token。
2. 附身敌人和精神攻防。
3. Oasis、Ziggurat、Pyramid。
4. Quest 市场与进度。
5. Horsemen。
6. 多头 Dragon Boss。
7. Campaign 存档。
8. Proxy Player。

验收：可完整进行一个 Apocalypse 单人场景和一个跨场景战役；Boss 多阶段状态可保存恢复。

### 阶段 6：其他粉丝模块，3-5 周

推荐顺序：Weather -> Item Shop -> Rise of the Forgemasters。

Forgemasters 最后做，因为它需要 delayed effects、bonus/penalty、复合效果、药水、mana shard 和新攻击类型，最容易暴露 DSL 不足。

验收：每个粉丝模块可单独启用；模块组合冲突有明确提示；不支持的卡牌不能静默降级。

### 阶段 7：打磨与发布，2-4 周

交付：

- 素材主题包、中文本地化、音效和动画。
- 平板横屏、键盘操作和基础无障碍。
- PWA 离线缓存、加载性能和错误恢复。
- 规则版本、内容署名、权利说明和反馈入口。

验收：首屏资源在目标网络条件内完成；完整游戏无内存持续增长；存档向前迁移通过。

## 10. 任务拆分建议

### Epic A：规则内核

- 命令/事件协议。
- phase 和合法行动查询。
- 资源池、卡牌区、持续效果。
- 决策请求和 continuation。
- 随机数、信息屏障、撤销。

### Epic B：地图

- 六边形坐标和板块到空间展开。
- 地形费用、墙、覆盖物和路径。
- 探索、敌人触发、要塞阻挡。
- SVG 命中区、缩放、平移和目标高亮。

### Epic C：战斗

- 遭遇构建器。
- 四阶段状态机。
- 元素、抗性、工事和多段攻击。
- 伤害分配、伤牌、单位和击倒。
- Boss 和组合敌人扩展点。

### Epic D：成长与市场

- Source、库存和法力支付。
- 三类市场、单位招募、互动地点。
- 名望、声望、等级、技能选择。
- 奖励队列和回合末顺序。

### Epic E：场景和 AI

- 场景配置、setup/end/scoring hooks。
- Dummy Player。
- Volkare/Horsemen/Dragon 行为。
- Proxy Player。

### Epic F：产品基础

- 新游戏配置。
- 存档槽、自动存档、回放。
- 本地化和主题素材。
- 规则日志、错误报告和调试器。

## 11. 风险与控制

| 风险 | 影响 | 控制措施 |
| --- | --- | --- |
| 卡牌组合产生规则爆炸 | 后期大量特判 | 先做效果 DSL 和事件钩子；每个特判必须有测试 |
| 自然语言规则存在歧义 | 实现与玩家预期不一致 | 建立裁定 ADR，记录规则来源和版本 |
| 一开始录入全部内容 | 很久没有可玩版本 | 先做一英雄教学垂直切片 |
| UI 与规则耦合 | 换美术/重做界面破坏逻辑 | 规则引擎独立包，UI 只提交命令 |
| 撤销导致刷随机 | 破坏单人解题体验 | 信息屏障 + seed + checkpoint |
| 粉丝模块互相覆盖 | 难以组合和存档 | manifest 依赖/冲突、模块命名空间、组合测试 |
| 素材版权或商标风险 | 无法公开发布 | 开发期使用原创占位素材和改写文本；公开发布前单独做权利审查 |
| 多人后来无法接入 | 状态和隐藏信息需重写 | 从首版保留多玩家数组、viewer projection 和纯命令接口 |

## 12. 多人技术预案

多人不是当前里程碑，但架构应满足：

1. 把本地 `executeIntent` 移到权威 Node 服务。
2. 客户端只发送命令，不上传完整状态。
3. 服务端执行相同引擎并保存事件流和周期快照。
4. `projectView` 为每名玩家隐藏手牌、牌序和私有选择。
5. WebSocket 只同步事件/状态差分；断线后从最近快照恢复。
6. 合作攻城使用 `DecisionRequest` 收集同意、敌人分配和参加者行动。
7. 回合制游戏无需实时帧同步，Colyseus 或轻量 WebSocket 服务都足够。

不建议现在实现账号、匹配、大厅、聊天或反作弊。这些不会帮助验证单人规则内核。

## 13. 首个开发版本的明确范围

建议把 `v0.1` 锁定为：

- 单人。
- Tovak。
- First Reconnaissance 教学场景的精简版。
- 约 16 张基础行动牌、少量高级行动/法术/单位/敌人。
- 日夜、法力、探索、移动、一个互动地点、完整战斗、升级、轮末。
- 占位美术、中文 UI、英文逻辑 ID。
- 存档、撤销、事件日志。

明确不进入 `v0.1`：全部英雄、城市合作攻城、PvP、Volkare、任务、战役、天气、商店和 Forgemasters。

这个范围足以验证最危险的四件事：效果解析是否可扩展、战斗是否可解释、地图与手牌操作是否顺手、保存/撤销是否可靠。通过后再批量录入内容，返工成本最低。
