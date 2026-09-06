# AGENTS.md

## 项目目标

本项目是 Claude Code 历史记录的本地只读查看器。核心目标是：启动简单、实时更新、Markdown 导出准确，并避免修改任何原始 Session 文件。

## 开发约定

- 保持零运行时依赖和零前端构建步骤；引入依赖前先评估是否确有必要。
- 支持 Node.js 18 及以上版本。
- 默认只监听 `127.0.0.1`，不得默认暴露到公网。
- 对 `~/.claude/projects/<project>/<session>.jsonl` 只读访问。
- JSONL 最后一行可能正在写入；解析错误行应跳过，不能使整个 Session 加载失败。
- 用户消息中的 `tool_result`、`isMeta` 和 sidechain 记录不得当作普通提问展示。
- 前端渲染 Session 内容前必须进行 HTML 转义，避免历史内容触发脚本执行。
- 修改解析或导出逻辑时，需同步补充 `test/session-store.test.js`。
- 每次功能、修复或行为变更都要在本文件和 `README.md` 的“变更记录”中追加说明。
- 提交前至少运行 `npm test`，并尽可能进行浏览器/API 冒烟检查。

## 架构说明

- `server.js`：Node.js 原生 HTTP 服务、REST API、静态资源与 SSE 文件变更通知。
- `lib/session-store.js`：发现 JSONL 文件，按文件大小和修改时间缓存解析结果，组织交互并导出 Markdown。
- `public/`：原生 HTML/CSS/JavaScript 客户端，不需要打包。
- `test/`：使用 `node:test` 的解析器测试。

## 变更记录

### 2026-09-04

- 创建项目维护规范。
- 初始化 Session 解析、Web API、实时更新、会话浏览和 Markdown 导出能力。
- 加入响应式界面及基础自动化测试。
- 添加 `.gitignore`，排除依赖、日志、环境配置和本地工具文件。
- 添加会话内问题/回答级别的上下快速导航按钮。
