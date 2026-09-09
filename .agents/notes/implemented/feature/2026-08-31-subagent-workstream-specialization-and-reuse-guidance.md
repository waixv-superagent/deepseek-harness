# Agent Note: Subagent workstream naming, durable specialization, and continuable reuse guidance

Status: implemented

English | [中文](2026-08-31-subagent-workstream-specialization-and-reuse-guidance.zh.md)

## Problem

Session forensics from a production session showed a parent delegating twice to the same domain (a "character-agent" workstream) yet starting a second child instead of continuing the first. Three mechanism facts produced the behavior. The `subagent` tool starts a new child conversation on every call and its model-facing text never mentions reuse. A child id is an opaque token with no domain meaning, so nothing maps "character work" back to the id the parent already holds. The creation label is a free-form action description, which cannot serve as a stable workstream identity across follow-ups. On the observed turn the parent translated its routing rule into a second `subagent` call while the earlier child id sat mid-context and the settlement notice had already been consumed. The converse case — genuinely new work that should get a fresh child — needs no new mechanism: reuse is a workstream judgment made with `list_agents`, not a role judgment.

## Decision

The model-facing delegation parameter `description` is renamed `workstream` and its meaning changes from a 3–5 word action description to a stable line-of-work name: it names the work the child will own, remains stable across follow-ups, and is kept as the child's durable label in `list_agents`. Both shipped instances share the parameter name — the continuable `subagent` and the one-shot `subagent_fork` — so the fork keeps its fresh-task wording without divergence.

Reuse guidance is taught where the model can act on it:

- the continuable tool description states that every call starts a new child conversation, that follow-up work in an already-delegated domain should resume the matching child with `send_message` (recalled via `list_agents`), and that a new child is for an independent line of work;
- the `tool:subagent` system-prompt section (continuable instances only) states the same rule;
- the `send_message` description adds that continuing an existing line of work should prefer this call over a new `subagent`, because the child keeps the context and loaded setup it already built;
- the `list_agents` description presents the list as pre-delegation recall — match the workstream or specialization before resuming a child — not a completion poll.

A config-sourced `specialization` field is added to `tool-subagent` Config: a deployment-owned fixed child-kind annotation (e.g. `character-agent`), validated at load as 1–64 lowercase letters, digits, or hyphens starting with a letter. The tool passes it on every child it starts; the service persists it on the child's descriptor in both lifecycle modes as caller-owned display metadata with no routing, uniqueness, or authorization semantics. `SUBAGENT_DESCRIPTOR_VERSION` moves 2 → 3 and the `subagent` identity projection `stateVersion` moves 2 → 3 so older checkpoint rows refold instead of replaying into a value the new schema rejects. The `list_agents` tool renames its model-visible child field `label` to `workstream`, adds an optional `specialization` field, and renders `specialization=<kind>` between the status and the workstream label.

## Verification

Package tests pin the descriptor specialization for one-shot and continuable starts, the served list entry specialization, load-time rejection of invalid specialization values, the `workstream` schema key and its description, the reuse guidance in the tool description and prompt section, and the `list_agents` render and output schema. The keyless ACP snapshot refresh pins the new schemas and descriptions in the `tool-schemas` and `system-prompt` goldens. The tool catalog is regenerated and its Chinese pairing re-recorded.

## Alternatives considered

**A `reuse: none|role|id` parameter on the delegation call.** It merges the start-vs-follow-up asymmetry into one call, assigns "role" a meaning no mechanism defines, and adds a third identity vocabulary beside `workstream` and `specialization`. Follow-up routing already exists as `list_agents` plus `send_message`; the rejected parameter would duplicate it.

**A model-fillable `role` parameter.** Model input would write durable child identity and could invent unbounded roles. Config-sourced `specialization` keeps the annotation deployment-owned, load-validated, and bounded.

**A dynamic child roster system-prompt section.** Assembling a roster during prompt build adds an async prompt path, invalidates the KV-cache prefix whenever the roster changes, grows without bound for long-lived parents, and opens a new prompt-failure surface. On-demand `list_agents` keeps discovery out of the prompt.

**A `retire_agent` tool.** Retiring has at least three distinct semantics — unload the resident Activation, delete the durable Session, drop a row from listings — with no current consumer. `drainContinuableChildren()` only unloads resident Activations and deletes nothing. Deferred until a concrete lifecycle need exists.

**Persona or knowledge-base determinism as the reuse mechanism.** A persona reduces drift but does not prove the child loaded its knowledge base; deterministic child setup is a separate concern from reuse routing.

## Consequences

The schema rename is a breaking model-visible change taken under the pre-release stance: every shipped caller and snapshot updates together, and one-shot instances change behavior only through the renamed parameter. Persisted v2 descriptors from before this change are unclassifiable by the new runtime and surface as `unsupported` diagnostics in listings. Instances without a configured `specialization` render rows without the ` specialization=` fragment, and existing configurations load unchanged. Reuse guidance appears only on continuable instances; one-shot and fork instances keep fresh-task wording because their children cannot be continued.
