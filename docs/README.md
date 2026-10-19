# Mage Knight Web 化分析文档

建议阅读顺序：

1. [规则源清单](./rule-source-inventory.md)：确认本地 JSON 中有哪些官方和粉丝扩展，以及规则权威顺序。
2. [开发规则规格](./development-rules-spec.md)：统一的单人规则内核、官方扩展差分、粉丝扩展语义和验收场景。
3. [Web 实施计划](./web-game-implementation-plan.md)：技术选型、工程结构、效果 DSL、素材替换、测试、排期和多人预留。
4. [v0.1 任务与测试](./v0.1-task-breakdown.md)：17 个可独立交付的任务、完成定义、测试 ID、发布门禁和推荐执行顺序。
5. [v0.1 实现状态](./v0.1-implementation-status.md)：M0-M4 的代码、测试证据和已知边界。
6. [v0.1 冻结裁定](./rules-decisions.md)：本版本的歧义裁定、范围边界和存档/撤销规则。
7. [v0.1 测试覆盖](./v0.1-test-coverage.md)：规则条目到自动化测试 ID 的映射。
8. [v0.1 发布说明](./v0.1-release-notes.md)：交付能力、存档版本和已知限制。
9. [v0.1 验收报告](./v0.1-acceptance-report.md)：发布清单、命令结果、哈希和浏览器矩阵。
10. [v0.2 开发计划](./v0.2-development-plan.md)：从固定教学切片走向可重复单人核心的范围、任务、测试和依赖顺序。
11. [v0.2 实现状态](./v0.2-implementation-status.md)：M5-M8 的实现证据、运行入口和边界。
12. [v0.2 测试覆盖](./v0.2-test-coverage.md)：v0.2 规则条目到自动化测试 ID 的映射。
13. [v0.2 发布说明](./v0.2-release-notes.md)：新增功能、兼容策略和已知限制。
14. [v0.2 验收报告](./v0.2-acceptance-report.md)：发布门禁、随机测试、哈希和浏览器矩阵。
15. [v0.3 开发计划](./v0.3-development-plan.md)：原版核心版本的范围、任务、完成判定和发布门禁。
16. [v0.3 实现状态](./v0.3-implementation-status.md)：四英雄、正式 Solo Conquest、牌池、迁移和已知边界。
17. [v0.3 测试覆盖](./v0.3-test-coverage.md)：v0.3 规则条目到自动化测试 ID 的映射。
18. [v0.3 发布说明](./v0.3-release-notes.md)：新增功能、兼容策略和已知限制。
19. [v0.3 验收报告](./v0.3-acceptance-report.md)：发布门禁、测试数量、浏览器和渲染证据。
20. [v0.4 开发计划](./v0.4-development-plan.md)：规则覆盖、Effect DSL、完成判定和版本边界。
21. [v0.4 实现状态](./v0.4-implementation-status.md)：规则数量、运行时接线和已知边界。
22. [v0.4 测试覆盖](./v0.4-test-coverage.md)：规则条目到自动化测试 ID 的映射。
23. [v0.4 发布说明](./v0.4-release-notes.md)：新增能力、兼容策略和限制。
24. [v0.4 验收报告](./v0.4-acceptance-report.md)：发布门禁、浏览器和构建结果。
25. [v0.5 开发计划](./v0.5-development-plan.md)：复杂规则运行时、选择、触发、附件和迁移任务。
26. [v0.5 实现状态](./v0.5-implementation-status.md)：完整规则覆盖、状态模型和已知边界。
27. [v0.5 测试覆盖](./v0.5-test-coverage.md)：复杂规则、存档、属性测试和浏览器验收映射。
28. [v0.5 发布说明](./v0.5-release-notes.md)：玩家可见变化和兼容策略。
29. [v0.5 验收报告](./v0.5-acceptance-report.md)：发布门禁和浏览器人工复查结果。
30. [v0.6 开发计划](./v0.6-development-plan.md)：一扩单人范围、批次与完成判定。
31. [v0.6 实现状态](./v0.6-implementation-status.md)：Lost Legion 规则、内容和技术边界。
32. [v0.6 测试覆盖](./v0.6-test-coverage.md)：内容、引擎、存档和浏览器验收映射。
33. [v0.6 发布说明](./v0.6-release-notes.md)：玩家可见变化和兼容策略。
34. [v0.6 验收报告](./v0.6-acceptance-report.md)：自动化门禁与人工浏览器复查结果。
35. [v0.7 实现状态](./v0.7-implementation-status.md)：模块隔离、Krang 单人内容、存档和规则边界。
36. [v0.7 测试覆盖](./v0.7-test-coverage.md)：模块组合、翻面技能、存档迁移和浏览器验收映射。
37. [v0.7 验收报告](./v0.7-acceptance-report.md)：完整发布门禁与桌面/移动端浏览器证据。
38. [v0.7.1 规则闭环](./v0.7.1-rule-closure.md)：完整对局定义、规则覆盖矩阵、终局哈希和版本边界。
39. [v0.7.1 测试覆盖](./v0.7.1-test-coverage.md)：三条终局 Golden Replay、恢复等价和回放导入验收映射。
40. [v0.7.1 验收报告](./v0.7.1-acceptance-report.md)：发布门禁、浏览器复查与剩余边界。
41. [v0.8 开发计划](./v0.8-development-plan.md)：Shades of Tezla 的内容、规则、场景、存档和验收拆分。
42. [v0.8 实现状态](./v0.8-implementation-status.md)：已接入组件、规则运行时和版本边界。
43. [v0.8 测试覆盖](./v0.8-test-coverage.md)：Tezla 规则、模块组合、存档和回放测试矩阵。
44. [v0.8 发布说明](./v0.8-release-notes.md)：玩家可见变化、兼容策略和保留范围。
45. [v0.8 验收报告](./v0.8-acceptance-report.md)：完整发布门禁、终局哈希和浏览器复查。

当前状态：`v0.8.0 Shades of Tezla` 已实现。Braevalar、两派敌人和奖励、两位阵营首领、三种地点覆盖物及四个单人场景已进入统一规则内核，并保留原版、Lost Legion 与 Krang 的模块隔离和确定性回放。
