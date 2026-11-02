# Agent Note: MCP Streamable HTTP recovers a dropped server session

Status: implemented

English | [中文](2026-09-09-mcp-streamable-http-session-recovery.zh.md)

## Problem

The mcp-client connection supervisor reconnects only when its transport fires `onclose` or `onerror`. A Streamable HTTP server that restarts forgets every session it issued. The MCP SDK then throws the server's 404 for the client's next request to that request's caller without firing `onclose`, so the supervisor never observes the dead generation: its tools stay registered, and every later call fails with `Streamable HTTP session not found` until the Host restarts. A restarted IDE MCP server reproduced this on every restart.

## Decision

[createTransport](../../../../packages/mcp/mcp-client/src/transport.ts) builds `SessionRecoveringStreamableHTTPTransport`, a `StreamableHTTPClientTransport` subclass whose `send` translates one failure into the disconnect signal the supervisor already handles: a request that carried a session id and was rejected with HTTP 404 fires `onclose`. The supervisor's next attempt builds a new transport, whose `initialize` carries no session id, so the server issues a new session and the tool list re-syncs through the existing path. The backoff, attempt budget, and tool re-sync are unchanged.

Two conditions keep the signal precise:

- A 404 counts as an expired session only when the request carried a session id. A 404 from a transport that has no session id is an unreachable endpoint, which the connect path already reports as a failed attempt.
- The close signal is deferred to a macrotask. Closing synchronously would make the SDK reject the in-flight request with a generic `Connection closed` error; deferring lets that request settle with the server's own 404 message first, and the supervisor reconnects on the next tick.

The failed call is not retried: an MCP tool call can carry a non-idempotent server action (a debugger command, a submit, a file write), so a silent replay is not safe at a transport failure.

## Alternatives considered

**Re-initialize inside the transport.** The transport could clear its session id and send `initialize` itself. It owns neither the tool registry nor the reconnect budget, so this duplicates the supervisor's machinery and would re-initialize outside its attempt cap.

**Retry the failed call after reconnecting.** Retrying hides the failure from the model and makes the first call succeed, at the cost of replaying a possibly non-idempotent action.

**Detect the expiry from the 404 response body.** The body text is server-owned. The status plus the session id the request carried is the condition the transport specification defines, and it needs no body parsing.

## Consequences

A restarted Streamable HTTP MCP server costs one failed tool call instead of a permanent outage; the supervisor reports the recovery through its existing `connection lost; reconnecting` line. A server that answers 404 for an established session but never issues a new one now consumes the reconnect budget (default 10 attempts) and unregisters its tools, where it previously failed silently and permanently; that path is logged. [session-recovery.spec.ts](../../../../packages/mcp/mcp-client/tests/session-recovery.spec.ts) pins the transport's close signal for a dropped session, the 404 without a session, a non-404 rejection, a transport-level failure, and a missing close callback; [session-recovery-integration.spec.ts](../../../../packages/mcp/mcp-client/tests/session-recovery-integration.spec.ts) pins the recovery end to end against a server that forgets its sessions.
