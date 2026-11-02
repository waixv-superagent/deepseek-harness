# Agent Note: MCP Streamable HTTP 恢复被服务端丢弃的会话

Status: implemented

[English](2026-09-09-mcp-streamable-http-session-recovery.md) | 中文

## Problem

mcp-client 的连接监督器只在 transport 触发 `onclose` 或 `onerror` 时重连。Streamable HTTP 服务端重启会遗忘它签发过的所有会话。此后 MCP SDK 会把服务端对下一次请求返回的 404 抛给该请求的调用方，而不触发 `onclose`，因此监督器永远察觉不到这一代连接已死：工具保持注册，之后每次调用都以 `Streamable HTTP session not found` 失败，直到 Host 重启。重启过的 IDE MCP 服务端每次都复现该问题。

## Decision

[createTransport](../../../../packages/mcp/mcp-client/src/transport.ts) 构造 `SessionRecoveringStreamableHTTPTransport`——`StreamableHTTPClientTransport` 的子类，其 `send` 把一种失败翻译为监督器已处理的断开信号：携带会话 id 的请求被 HTTP 404 拒绝时触发 `onclose`。监督器下一次尝试会新建 transport，其 `initialize` 不携带会话 id，因此服务端签发新会话，工具列表通过既有路径重新同步。退避、尝试预算与工具重同步均未改动。

两个条件保证信号精确：

- 只有当请求携带会话 id 时，404 才计为会话过期。没有会话 id 的 transport 收到 404 说明端点不可达，连接路径已将其报告为一次失败尝试。
- 关闭信号延后到宏任务触发。同步关闭会让 SDK 用通用的 `Connection closed` 错误拒绝该在途请求；延后则让该请求先以服务端自身的 404 消息落定，监督器在下一个 tick 重连。

失败的调用不重试：MCP 工具调用可能携带非幂等的服务端动作（调试器命令、提交、文件写入），因此在 transport 失败时静默重放并不安全。

## Alternatives considered

**在 transport 内部重新 initialize。** transport 可以自行清空会话 id 并发送 `initialize`。它既不拥有工具注册表也不拥有重连预算，这会重复监督器的机制，并在其尝试上限之外重新 initialize。

**重连后重试失败的调用。** 重试会向模型隐藏该失败，让首次调用成功，代价是重放一个可能非幂等的动作。

**从 404 响应体识别过期。** 响应体文本由服务端拥有。状态码加上请求携带的会话 id 正是传输规范所定义的条件，且无需解析响应体。

## Consequences

重启过的 Streamable HTTP MCP 服务端现在只损失一次失败的调用，而不是永久中断；监督器通过既有的 `connection lost; reconnecting` 日志行报告恢复。若服务端对已建立的会话返回 404 却始终不签发新会话，现在会消耗重连预算（默认 10 次）并注销其工具，而此前是静默且永久地失败；这条路径有日志。[session-recovery.spec.ts](../../../../packages/mcp/mcp-client/tests/session-recovery.spec.ts) 固定了会话被丢弃时 transport 的关闭信号、无会话的 404、非 404 拒绝、transport 级失败，以及缺失关闭回调这五种情形；[session-recovery-integration.spec.ts](../../../../packages/mcp/mcp-client/tests/session-recovery-integration.spec.ts) 针对会遗忘会话的服务端端到端固定了恢复过程。
