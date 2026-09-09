# Agent Note：subagent 工作线命名、持久化 specialization 与可继续复用指引

Status: implemented

[English](2026-08-31-subagent-workstream-specialization-and-reuse-guidance.md) | 中文

## 问题

对一次生产会话的日志取证显示，父 agent（智能体）两次向同一领域（一个「character-agent」工作线）委派工作，却启动了第二个 child，而不是继续第一个。三个机制事实共同导致了这一行为。`subagent` 工具每次调用都会开启新的 child 对话，其面向模型的文本从不提及复用。child id 是没有领域含义的不透明令牌，因此没有任何东西能把「角色工作」映射回父级已经持有的 id。创建标签是自由发挥的动作描述，无法在多次后续操作之间充当稳定的工作线身份。在被观察到的那一轮中，父级把它的路由规则翻译成了第二次 `subagent` 调用，而较早的 child id 还埋在上下文中间，结算通知也已被消费。反过来看，真正的新工作本来就该开新 child，这不需要任何新机制：复用是借助 `list_agents` 做出的工作线判断，而不是角色判断。

## 决策

面向模型的委派参数 `description` 更名为 `workstream`，其含义从 3–5 个词的动作描述改为稳定的工作线名称：它命名 child 将拥有的工作，在多次后续操作之间保持稳定，并作为 child 在 `list_agents` 中的持久标签保存。两个随产品发布的实例共用这一参数名——可继续的 `subagent` 和一次性的 `subagent_fork`——因此 fork 保持其新建任务措辞，不会出现分歧。

复用指引被教给模型可以据此行动的位置：

- 可继续工具描述说明每次调用都会新建 child 对话、在已委派过的领域中做后续工作时应通过 `list_agents` 找回匹配的 child 并用 `send_message` 续接、新 child 只用于独立工作线；
- `tool:subagent` 系统提示词 section（仅可继续实例）陈述同一条规则；
- `send_message` 描述补充：延续某条已有工作线时应优先使用本调用而不是新开 `subagent`，因为 child 会保留它已经建立的上下文与已加载的配置；
- `list_agents` 描述把列表定位为委派前的召回——续接 child 前先匹配 workstream 或 specialization——而不是完成状态轮询。

`tool-subagent` Config 新增由配置提供的 `specialization` 字段：由部署方拥有的固定 child 类别标注（例如 `character-agent`），在加载时校验为 1–64 个小写字母、数字或连字符且以字母开头。工具会把它传给其启动的每个 child；服务在两种生命周期模式下都把它持久化到 child 的描述符上，作为调用方拥有的展示元数据，不含路由、唯一性或授权语义。`SUBAGENT_DESCRIPTOR_VERSION` 从 2 升到 3，`subagent` 身份投影的 `stateVersion` 从 2 升到 3，使旧 checkpoint 行重新折叠，而不是把新 schema 会拒绝的值重放进内存。`list_agents` 工具把其面向模型的 child 字段 `label` 更名为 `workstream`，新增可选的 `specialization` 字段，并在状态与工作线标签之间渲染 `specialization=<kind>`。

## 验证

包测试钉住了：一次性与可继续启动的描述符 specialization、列表条目提供的 specialization、加载时对非法 specialization 值的拒绝、`workstream` schema 键及其描述、工具描述与提示词 section 中的复用指引，以及 `list_agents` 的渲染与输出 schema。无密钥 ACP 快照刷新在 `tool-schemas` 与 `system-prompt` 黄金文件中钉住新的 schema 与描述。工具目录已重新生成，其中文配对已重新记录。

## 备选方案

**在委派调用上加 `reuse: none|role|id` 参数。** 它把「启动 vs 后续」的不对称性合并进一次调用，给「role」赋予任何机制都没有定义的含义，并在 `workstream`、`specialization` 之外新增第三套身份词汇。后续路由已经以 `list_agents` 加 `send_message` 的形式存在；被否的参数只是重复它。

**可由模型填写的 `role` 参数。** 模型输入会写入持久化 child 身份，并可能发明无界的角色。由配置提供的 `specialization` 让标注归部署方拥有、在加载时校验、且有界。

**动态 child 名单系统提示词 section。** 在提示词组装期间拼名单会引入异步提示词路径、名单一变就使 KV Cache 前缀失效、对长期存活的父级无界增长，并打开新的提示词失败面。按需的 `list_agents` 把发现留在提示词之外。

**`retire_agent` 工具。** 退役至少有三种不同语义——卸载驻留 Activation、删除持久化会话、从列表中移除条目——目前没有任何消费方。`drainContinuableChildren()` 只卸载驻留 Activation，不删除任何东西。留待出现具体的生命周期需求。

**把 persona 或知识库确定性当作复用机制。** persona 能减少漂移，但不能证明 child 已加载其知识库；确定性的 child 初始化是与复用路由无关的独立问题。

## 后果

schema 更名是发布前立场下接受的破坏性模型可见变更：所有随产品发布的调用方与快照同步更新，一次性实例的行为只通过更名后的参数变化。此变更之前持久化的 v2 描述符无法被新运行时分类，会在列表中呈现为 `unsupported` 诊断。未配置 `specialization` 的实例渲染条目时不带 ` specialization=` 片段，既有配置照常加载。复用指引只出现在可继续实例上；一次性与 fork 实例保留新建任务措辞，因为它们的 child 无法续接。
