# Trae AI协同开发全局规则 V10.14.3

所有开发任务必须同时满足以下两个规则体系，优先执行Token优化约束：
1. 必须遵守 `.trae/rules/token-optimization.md` 中的Token优化要求，减少无效消耗
2. 必须遵守 `.trae/rules/efficient-development.md` 中的开发规范，提升输出代码质量

所有输出必须符合项目现有技术栈（Vanilla JS + Cordova + PWA）、编码规范，禁止生成偏离需求的无效内容。

项目版本：V10.14.3
核心模块：00-bootstrap / 01-state / 02-auth / 03-vehicles / 04-export / 05-sync / 06-media / 07-cache / 08-main / 09-web-sync
后端：飞书云文档OpenAPI + GitHub Pages静态部署
