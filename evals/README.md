# Eval Harness

这个目录提供一套最小可用的 `评估集与回放` 机制。

## 内容

- `cases.json`：固定评测样本
- `reports/`：每次评测输出的结果

## 使用

```bash
npm run evals
```

运行后会：

1. 逐条执行 `cases.json`
2. 校验结构化答案中的关键词、来源和人工审核标记
3. 输出一个 JSON 报告到 `evals/reports/`

## 回放

每次单次运行和 eval 运行都会落一份日志到 `.agent-runs/`。

你可以用下面的命令回放某次运行：

```bash
npm run replay -- run_2026-06-01T...
```

回放会输出：

- 原始 prompt
- 最终 answer
- 工具调用序列
- token 总量
- 是否需要人工审核
