# Daily Information Digest Plans

## Active Index

- Current active ExecPlan: None.
- Most recently completed:
  - `docs/exec-plans/completed/2026-08-02-open-source-local-control-plane.md`
    - 已交付开源、本地优先控制台、CLI parity、分平台登录、模型中心、调度、邮件和运行诊断。

## Purpose

`PLANS.md` 是本项目的计划层入口。跨配置、采集器、浏览器登录、转录环境、Web UI、调度和开源发布的工作，应在 `docs/exec-plans/active/` 中维护执行计划；完成后移入 `docs/exec-plans/completed/`。

## Update Rules

- `Progress`：每个可验证阶段完成后更新。
- `Decision Log`：架构、兼容性、安全或产品边界发生变化时更新。
- `Surprises & Discoveries`：真实平台、模型、GPU、登录或打包行为改变原假设时更新。
- `Validation`：记录具体命令、测试、页面路径和真实样本验证。
- `Outcomes & Retrospective`：计划完成或关闭时补充结果，并将计划移动到 `completed/`。

## Plan Layer Boundary

- 稳定架构结论进入 `docs/` 或未来的 `ARCHITECTURE.md`。
- 用户安装和使用方式进入 `README.md`。
- 实施过程、阶段状态和接力信息保留在 ExecPlan。
- `config.json` 继续作为机器、CLI、Web UI 和 AI 共同使用的配置事实来源。
