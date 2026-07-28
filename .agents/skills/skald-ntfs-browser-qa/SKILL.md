---
name: skald-ntfs-browser-qa
description: Route Skald visual, browser, accessibility, interaction, responsive-layout, and post-deploy UI smoke tests through the existing projectless Codex task on NTFS. Use whenever Skald UI work needs an actual in-app browser run, screenshots, console inspection, desktop/mobile QA, gameplay clicks, reload/retry verification, or visual evidence and the main repository task is WSL-backed.
---

# Skald NTFS Browser QA

Use the existing NTFS-backed Codex task as the browser execution surface. Do
not try to repair or bypass the in-app browser sandbox from the WSL repository
task.

## Fixed task

- Thread ID: `019fa52b-1610-7b23-9567-37891d24c782`
- Host ID: `local`
- Title: `??????? browser QA Skald`
- Workspace: `C:\Users\?????\Documents\Codex\2026-07-27\skald-browser`
- Production URL: `http://192.168.0.5:3000`

The task is projectless and exists only for browser control. It must not edit
the repository, deployment, server configuration, or production SQLite.

## Dispatch workflow

1. Use the Codex thread listing tool to find the fixed thread by ID or title.
2. Read its recent turns and verify that:
   - the thread ID and host match;
   - its workspace is on `C:\`, not `\\wsl.localhost`;
   - it is not currently running an incompatible test.
3. Use the Codex thread messaging tool to send the exact QA assignment. Do not
   create a replacement task while the fixed task exists.
4. In the assignment include:
   - URL and deployed commit when known;
   - exact initial state or `worldTime` when known;
   - viewport(s) and flows to inspect;
   - the maximum number of state-changing gameplay clicks;
   - whether screenshots are required;
   - required DOM, console, accessibility, network, and persistence evidence;
   - the instruction to use `$browser:control-in-app-browser`;
   - the prohibition on repository, server, systemd, and SQLite changes.
5. Read the completed turn from the fixed task. If it reports a defect or an
   instrumental limitation, preserve the exact symptom and evidence.
6. Report browser QA separately from API, unit, integration, and deployment
   checks.

Poll the thread sparingly. Do not open a second browser task merely because a
run is slow.

## Mutation boundary

Read-only loading, screenshots, DOM inspection, console inspection, responsive
checks, and navigation may proceed as part of requested UI QA.

Gameplay controls mutate the canonical Event Log. Click them only when the user
has requested a gameplay smoke test, deployment verification, or equivalent
state-changing QA. State the click budget in the delegated prompt and do not
exceed it.

Never create a network failure by changing server, browser, router, CORS, or
system configuration. Test Retry only after a naturally occurring safe failure
or when the user explicitly authorizes a controlled scenario.

## Evidence contract

Require a compact PASS/FAIL report covering the requested checks, with:

- actual URL and viewport;
- initial and final `worldTime` for gameplay tests;
- controls used and number of state-changing clicks;
- visible primary/notable/status result;
- pending/disabled and `aria-busy` state when applicable;
- reload/persistence result;
- console error count and exact critical messages;
- screenshot paths when requested;
- distinction between application failure and browser-tool limitation.

Do not claim visual QA from source inspection, `npm run validate`, HTTP smoke,
or API responses. If the fixed task cannot run the browser, report visual QA as
blocked and include its exact error.

## Missing-task handling

If the fixed thread cannot be found, search once by its exact title and NTFS
workspace. If it is still absent, stop and tell the user. Creating another
Codex task requires an explicit user request.
