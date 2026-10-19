# Mage Knight 规则源清单

## 1. 结论与范围

当前工作区中的 Tabletop Simulator 存档包含原版、三个官方扩展，以及数个粉丝扩展的规则和组件索引。

本项目按以下层次整理规则：

1. 原版：Mage Knight Board Game 基础规则、场景框架、单人 Dummy Player。
2. 一扩：The Lost Legion。
3. 二扩：Krang Character Expansion。
4. 三扩：Shades of Tezla。
5. 主要粉丝扩展：The Apocalypse Dragon。
6. 可选粉丝模块：Rise of the Forgemasters、Atlantean Weather、Item Shop。

原版与三个官方扩展的规则已经被 Ultimate Edition 的两本规则书合并。开发时不应建立四套彼此独立的规则引擎，而应建立一个基础内核，再按模块注册新增内容和规则钩子。

## 2. 本地索引

主索引文件：

`E:\work\mageknight\Mage Knight Plus (Highly Scripted) (1721301081)\Mods\Workshop\1721301081.json`

关键对象：

| GUID | 名称 | 用途 |
| --- | --- | --- |
| `d4a866` | Rules | 主规则袋，含 9 个 PDF 对象 |
| `aff5f6` | Lost Legion | 一扩组件袋 |
| `6fc671` | Krang (Components) | 二扩英雄组件 |
| `96878f` | Shades of Tezla | 三扩组件袋 |
| `e4b8f4` | Apocalypse Dragon | Apocalypse 主组件袋 |
| `bffdc0` | Quest Cards | Apocalypse 任务牌 |
| `11128e` | Rise of the Forgemaster | Forgemasters 粉丝扩展 |
| `a1e972` | Weather Mod | 天气粉丝模块 |
| `70f4fe` | Item Shop Mod | 商店粉丝模块 |

## 3. 主规则 PDF 映射

| GUID | 识别结果 | 页数 | 开发用途 |
| --- | --- | ---: | --- |
| `b850ab` | Ultimate Edition 主规则书和基础场景书 | 24 | 基础状态机、回合、移动、互动、战斗、结算、场景 |
| `700e93` | Lost Legion、Krang、Shades of Tezla 合并扩展规则书 | 28 | 三个官方扩展的规则差分 |
| `65f2b6` | The Apocalypse Dragon | 48 | 主要粉丝扩展、任务、战役、Proxy Player |
| `9ea4ed` | First Reconnaissance 附加规则 | - | 教学/场景数据，不属于通用内核 |
| `826bf9` | Quest for the Golden Grail 场景规则 | - | 场景插件 |
| `fd700f` | The Chaos Rift 场景规则 | - | 场景插件 |
| `a7aa4a` | The Gauntlet 场景规则 | - | 场景插件 |
| `7c7e53` | Ultimate Conquest 场景规则 | - | 场景插件 |
| `bf27ee` | The War of Four 场景规则 | - | 场景插件 |

另外发现以下规则 PDF：

| GUID | 实际内容 | 说明 |
| --- | --- | --- |
| `0a657b` | Rise of the Forgemasters v1.02 | 7 页扫描版，正文没有可提取文本层 |
| `e03548` | Atlantean Weather | JSON 昵称误写为 Rise of the Forgemasters Rules |
| `b367f0` | Item Shop Mini-Expansion Beta 2.0 | 商店、金币、装备、偷窃规则 |
| `858dee` | Basic Action Card Summary | 参考表，不是独立扩展规则 |

## 4. 规则权威顺序

实现和测试遇到冲突时按下列顺序处理：

1. 当前场景的明确特例。
2. 当前启用扩展的规则及其 FAQ/勘误。
3. 卡牌、技能、地点说明和敌人能力的具体文本。
4. 基础规则书。
5. 教学书中的示例说明。
6. TTS Lua 脚本和自动化行为。

原则是“更具体、更新的规则覆盖更一般、较旧的规则”。TTS 脚本只用于帮助确认模组意图，不能反向定义桌游规则。

## 5. 已发现的模组边界

### 官方扩展

- Lost Legion 是大型系统扩展，新增 Volkare、Wolfhawk、墙、迷宫、难民营、新单位、新敌人能力和新场景。
- Krang 主要是角色内容，只新增可在同一轮按条件翻回正面的技能语义。
- Shades of Tezla 新增阵营敌人、阵营代币、阵营首领、追击/伏击等敌人行为和场景位置覆盖物。

### Apocalypse Dragon

这是工作区里规模最大的粉丝扩展，并且在规则袋中与主规则和官方扩展并列。它应被视为主要粉丝扩展目标，新增：

- 附身敌人组合模板。
- 精神攻击和精神格挡。
- Oasis、Ziggurat、Pyramid。
- 五头 Apocalypse Dragon 多阶段 Boss。
- Four Horsemen 地图敌人。
- Quest 任务牌系统。
- Faction token 一次性能力。
- 跨场景 Campaign。
- 更主动的 Proxy Player。

### 其他粉丝模块

- Rise of the Forgemasters 是卡牌语义扩展，影响效果解析器的深度最大。
- Atlantean Weather 是回合开始触发的地图区域修正器。
- Item Shop 是地点互动和独立装备区扩展。

它们适合在基础版和官方三扩稳定后作为独立开关接入，不应阻塞首个可玩版本。

## 6. 尚需人工核对的内容

- 每张卡牌、技能、单位、地点说明卡的准确文字和图标数据。
- 场景附页中的地图形状、组件数量、终局条件和计分细节。
- Forgemasters 扫描规则与实际牌面版本是否完全一致。
- 模组内自制英雄 Duscenia、Malek、Mevok、Ymirgh、Zirtae 是否属于最终产品范围。
- 中文规则翻译与英文原文发生差异时采用哪一版为准。

第一阶段建议以英文规则为逻辑基准，中文作为显示层本地化。这样可以避免翻译差异进入规则引擎。
