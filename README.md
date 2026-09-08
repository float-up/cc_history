# Claude Session Viewer

一个本地运行的 Claude Code 会话浏览器。它读取 `~/.claude/projects` 下的 JSONL 历史记录，以对话形式展示，并支持快速复制或导出 Markdown。

## 功能

- 按更新时间浏览、搜索不同项目中的 Session
- 将用户提问与 Claude 的分段回答整理为一次完整交互
- 完整渲染标题、列表、任务项、引用、表格、链接及代码块等常用 Markdown
- 新增回答以流式打字效果增量渲染，并在停留底部时自动跟随
- 使用悬浮上下按钮在上一个或下一个问题/回答之间快速跳转
- 单独复制/保存某次回答，或复制/导出完整会话
- 展示工具调用摘要，不把冗长的工具结果混入正文
- 通过 SSE 自动感知 JSONL 文件变化并实时刷新
- 响应式界面，可在桌面端和移动端使用
- 零运行时依赖，仅需 Node.js 18+

## 快速开始

```bash
npm start
```

打开 [http://127.0.0.1:4312](http://127.0.0.1:4312)。默认只监听本机地址。

开发时可启用 Node.js 自动重启：

```bash
npm run dev
```

运行测试：

```bash
npm test
```

## 配置

通过环境变量调整启动参数：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Claude Code 历史目录 |
| `HOST` | `127.0.0.1` | HTTP 监听地址 |
| `PORT` | `4312` | HTTP 监听端口 |
| `POLL_INTERVAL` | `250` | Session 文件变化检查间隔，单位为毫秒，最小为 100 |

示例：

```bash
CLAUDE_PROJECTS_DIR=/path/to/projects PORT=8080 npm start
```

> Session 中可能包含源码、提示词和工具输出等敏感信息。除非明确了解风险，否则不要将服务监听到公网地址。

## 项目结构

```text
.
├── server.js                 # HTTP API、静态服务和 SSE 更新通知
├── lib/session-store.js      # JSONL 解析、缓存和 Markdown 导出
├── public/                   # 无构建步骤的 Web 前端
├── test/session-store.test.js
├── AGENTS.md                 # 维护约定与变更记录规则
└── README.md
```

## 变更记录

### 2026-09-04 · v0.1.0

- 初始化前后端一体的本地 Web 应用
- 支持 Session 列表、搜索、对话查看和工具调用摘要
- 支持单次回答与完整会话的 Markdown 复制/下载
- 加入基于 SSE 的实时更新、响应式 UI 和解析器测试
- 初始化 `AGENTS.md` 与本变更记录
- 添加 `.gitignore`，忽略依赖、日志、覆盖率、环境配置及编辑器临时文件
- 添加会话内问题/回答级别的上下快速导航按钮
- 改进 Markdown 渲染，支持表格、任务列表、代码块语言栏及代码复制
- 将文件变化检查缩短至 250ms，并对新增回答进行增量流式渲染
