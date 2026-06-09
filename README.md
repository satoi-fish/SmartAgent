# SmartAgent

一个基于 TypeScript 的本地智能体脚手架，适合用来搭建“可执行、可审批、可回放”的工程代理。项目内已经包含模型路由、工具注册、知识库、长期记忆、审批流、队列、调度、多代理协作、附件输入和本地 workbench。

## 它能做什么

- 接收自然语言任务并调用本地工具完成分析、检索和执行
- 按风险等级控制工具调用，支持 `default` / `plan` / `auto` 模式
- 支持审批工作流：先生成计划，再人工批准，再执行
- 支持附件输入，包括文本、图片、表格和文档
- 支持本地知识库和长期记忆检索
- 支持本地浏览器自动化和网页快照
- 支持后台队列、定时任务、执行日志、回放和评测
- 支持单代理模式和 `planner + reviewer` 双代理模式

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制一份环境变量模板：

```bash
copy .env.example .env
```

至少需要配置：

- `MODEL_PROVIDER`：`openai`、`anthropic`、`google`、`deepseek`、`azure-openai`
- 对应厂商的 API Key，例如 `OPENAI_API_KEY`
- 可选模型名，例如 `OPENAI_MODEL`、`OPENAI_MODEL_FAST`

如果你要启用工具权限策略，可以再复制一份：

```bash
copy .agent-permissions.example.json .agent-permissions.json
```

### 3. 运行一个最小示例

```bash
npm run dev -- "总结这个项目的核心能力"
```

## 常用命令

```bash
# 单次任务
npm run dev -- "your task here"

# 查看当前模型路由矩阵
npm run models

# 带附件执行
npm run multimodal -- "请分析这些文件" file1.png file2.pdf

# 双代理模式（planner + reviewer）
npm run team -- "为这个需求生成实施方案"

# 生成审批计划
npm run plan -- "排查生产告警并给出修复方案"

# 更新审批状态
npm run approve -- <approval-id> approved

# 执行已批准请求
npm run execute-approved -- <approval-id>

# 入队 / Worker
npm run enqueue -- "处理这条任务"
npm run worker

# 新增定时任务 / 查看任务 / 调度轮询
npm run schedule:add -- once 2026-06-10T09:00:00Z "生成日报"
npm run schedule:add -- interval 30 "每 30 分钟巡检一次"
npm run schedules
npm run scheduler
npm run scheduler -- watch 30

# 评测 / 回放
npm run evals
npm run replay -- <run-id-or-log-path>

# Workbench
npm run workbench
```

## 审批工作流

推荐的高风险任务流程：

1. `npm run plan -- "<task>"`
2. 记录输出里的 `approval-id`
3. `npm run approve -- <approval-id> approved`
4. `npm run execute-approved -- <approval-id>`

相关模式说明：

- `AGENT_MODE=default`：常规模式，危险工具通常需要人工批准
- `AGENT_MODE=plan`：偏向生成可审核计划
- `AGENT_MODE=auto`：自动执行已允许工具，适合受控环境

## 内置能力

当前项目内置了几类工具：

- 项目文档检索
- 本地知识库检索
- 长期记忆读写
- 工作区文件浏览与文件读取
- 本地网页抓取与浏览器会话控制
- 受限的工作区命令执行
- 行动项草稿写入
- Seq 日志查询（配置后启用）

默认知识内容位于 `knowledge/`，评测样例位于 `evals/`。

## 日志、回放与 Workbench

- 当 `AGENT_PERSIST_RUN_LOG=true` 时，执行日志会写入 `.agent-runs/`
- `npm run replay -- <run-id>` 可以回放某次运行的 prompt、答案、工具序列和 token 使用
- `npm run workbench` 会启动一个本地界面，默认地址是 `http://127.0.0.1:4173`
- `npm run evals` 会自动生成评测报告到 `evals/reports/`

## 常用环境变量

除了模型相关配置，比较常用的还有：

- `AGENT_HISTORY_LIMIT`：注入的历史对话条数
- `AGENT_KNOWLEDGE_LIMIT`：注入的知识片段数量
- `AGENT_PERSIST_SESSION`：是否持久化会话
- `AGENT_PERSIST_RUN_LOG`：是否保存运行日志
- `AGENT_SESSION_BACKEND`：`file`、`redis`、`postgres`
- `AGENT_SESSION_ID`：会话标识
- `AGENT_BROWSER_ALLOWLIST`：允许浏览器访问的主机，默认只允许本地地址
- `AGENT_BROWSER_HEADLESS`：是否无头运行浏览器
- `AGENT_LOG_PLATFORM`：日志平台，配置为 `seq` 时启用 Seq 查询

如果使用 `redis` 或 `postgres` 会话后端，需要额外安装对应依赖包。

## 目录结构

```text
src/          核心源码
knowledge/    本地知识库
evals/        评测样例与报告
scripts/      辅助脚本
```

## 开发建议

- 先跑 `npm run dev -- "<task>"` 验证最小链路
- 需要审计和回放时，打开 `AGENT_PERSIST_RUN_LOG=true`
- 需要浏览器能力时，先确保 Playwright 运行环境可用
- 改完模型配置后，可以用 `npm run models` 检查实际路由结果
