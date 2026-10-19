---
name: skald-ntfs-browser-qa
description: Route Skald visual, browser, accessibility, interaction, responsive-layout, and post-deploy UI smoke tests through the existing projectless Codex task on NTFS. Use whenever Skald UI work needs an actual in-app browser run, screenshots, console inspection, desktop/mobile QA, gameplay clicks, reload/retry verification, or visual evidence and the main repository task is WSL-backed.
---

# Skald NTFS Browser QA

Use the existing NTFS-backed Codex task as the browser execution surface. Do
not try to repair or bypass the in-app browser sandbox from the WSL repository
task.

## Fixed task

- Thread ID: `01a09bbf-37a0-7642-82c5-ed3873add396`
- Host ID: `local`
- Title contains: `Skald Browser QA Runner v2`
- Workspace: `C:\Users\<Windows-user>\Documents\Codex\2026-09-13\skald-browser-qa-v2`
- Output root: `C:\Users\<Windows-user>\Documents\Codex\2026-09-13\skald-browser-qa-v2\outputs\qa-evidence`

The task is projectless and exists only for browser control. It must not edit
the repository, deployment, server configuration, or production SQLite.

## Durable result channel

Codex thread messages are advisory notifications, not the result source of
truth. A completed turn with `items: []`, a null assistant message or a lost
final must not hide a report that was already written on NTFS.

Every dispatch must have both:

- a filesystem-safe `jobId` matching `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`;
- an opaque, unique `runToken` of at least 16 characters.

The runner writes these files under the output root, atomically (temporary file
followed by a same-directory rename):

1. `<jobId>.ack.json` before any browser mutation;
2. `<jobId>.progress.json` before and after every potentially
   state-changing browser call;
3. `<jobId>-report.json` and `<jobId>-report.md` after the run;
4. `<jobId>.complete.json` last, as the commit marker.

The ACK uses schema `QA_JOB_ACK_V1`. The result remains `QA_RESULT_V2` and adds
`delivery: { protocol: "QA_FILE_BRIDGE_V1", runToken }`. The completion receipt
uses schema `QA_JOB_COMPLETE_V1` and contains `jobId`, `runToken`, final
status, relative report paths, SHA-256 for both reports and final mutation
counts.

Every new ACK must contain `preflight` with exactly these seven keys:
`browser`, `viewport`, `screenshot`, `rendered_audit`, `dom`, `console`, and
`report_dir`. Each value is exactly `PASS` or `BLOCKED`. The helper derives and
records `preflightGate` (`proceed`, `proceed_reduced`, or `stop`) and
`blockedCapabilities`.

The two visual instruments are ALTERNATIVES. `screenshot` and `rendered_audit`
may each stand in for the other: a rendered-structure audit proves the visual
area when pixel capture is unavailable, and pixel capture proves it when the
render audit cannot run. The gate is `stop` only when a required capability
(`browser`, `viewport`, `dom`, `console`, `report_dir`) is blocked, or when BOTH
visual instruments are blocked; a `proceed_reduced` additionally requires a
non-empty `--acknowledged-by` name. Never open the game or create a world
unless the ACK says `proceed` or `proceed_reduced` with a non-empty
`acknowledgedBy`. If the gate is `stop`, do not open the game or create a
world; publish a `BLOCKED` report and completion receipt with zero gameplay
mutations.

Only a valid completion receipt whose job/token/report hashes agree is a
delivered result. Verify it from the WSL task with:

    node .agents/skills/skald-ntfs-browser-qa/scripts/read-result.mjs \
      --output-root /mnt/c/Users/<Windows-user>/Documents/Codex/2026-09-13/skald-browser-qa-v2/outputs/qa-evidence \
      --job-id <jobId> \
      --run-token <runToken>

The fixed Windows task uses the same helper through `wsl.exe` with modes
`ack`, `progress`, `report`, `complete` and `verify`. The helper refuses a duplicate job ID,
writes JSON by same-directory rename, validates the report before committing it
and calculates the report hashes itself. For example:

    wsl.exe -d Ubuntu-22.04 -u nook -e \
      /home/nook/.nvm/versions/node/v22.23.1/bin/node \
      /home/nook/workspaces/skald/.agents/skills/skald-ntfs-browser-qa/scripts/read-result.mjs \
      --mode ack \
      --output-root /mnt/c/Users/<Windows-user>/Documents/Codex/2026-09-13/skald-browser-qa-v2/outputs/qa-evidence \
      --job-id <jobId> \
      --run-token <runToken> \
      --mutation-limit <limit> \
      --preflight-base64 <base64-encoded-preflight-json> \
      [--acknowledged-by <operator-name>]

Use `progress --phase <phase> --mutation-total <count>` around mutations,
`report --source-json <draft-json> --source-markdown <draft-md>` to publish
validated reports, and `complete` only after both reports exist. Reports and
completion receipts are immutable. A hash mismatch is a blocked delivery and
requires a new reporting job, never repair of committed evidence.

The runner's final thread message should still begin
`QA_RESULT_V2 <jobId> <PASS|FAIL|BLOCKED>`, but an empty message no longer loses
the result once the completion receipt validates.

## Dispatch workflow

1. Use the Codex thread listing tool to find the fixed thread by ID or title.
2. Read its recent turns and verify that:
   - the thread ID and host match;
   - its workspace is on `C:\`, not `\\wsl.localhost`;
   - it is not currently running an incompatible test.
3. Generate a new `jobId` and `runToken`. Reject a duplicate job if any ACK,
   progress, report or completion artifact for that `jobId` already exists.
4. Use the Codex thread messaging tool to send the exact QA assignment. Require
   the runner to write the ACK before opening or mutating the game. Do not create
   a replacement task while the fixed task exists.
5. In the assignment include:
   - `jobId`, `runToken` and the durable-channel contract above;
   - URL and deployed commit when known;
   - exact initial state or `worldTime` when known;
   - viewport(s) and flows to inspect;
   - the maximum number of state-changing gameplay clicks;
   - whether screenshots are required, or the run is screenshotless and must
     collect a rendered-structure audit instead;
   - required DOM, console, accessibility, network, and persistence evidence;
   - the instruction to use `$browser:control-in-app-browser`;
   - the prohibition on repository, server, systemd, and SQLite changes.
6. Wait for the ACK artifact before treating the job as accepted. If it is
   absent, stop without assuming that mutations did or did not occur.
7. Wait for the thread by cursor and for the completion receipt independently.
   Validate the receipt with `scripts/read-result.mjs`; the filesystem result
   wins over missing thread items.
8. If the turn completes without a valid receipt, send at most one report-only
   recovery request for the same `jobId` and `runToken`. It may read existing
   artifacts but must not open the browser or repeat mutations.
9. After verified receipt, send `QA_RECEIVED <jobId> <reportJsonSha256>` to the
   fixed task. This is confirmation only and must never trigger another run.
10. Report browser QA separately from API, unit, integration, and deployment
    checks.

Poll the thread sparingly. Do not open a second browser task merely because a
run is slow.

If the fixed task becomes idle with no completion receipt, classify delivery as
`BLOCKED`. The progress file is evidence of the last recorded boundary, not
permission to retry a state-changing operation.

## Preflight before the first mutation (plan_9 §15)

Before opening the browser or creating a scratch world, the runner must prove
these seven capabilities and record each probe outcome in the ACK artifact:

    browser, viewport, screenshot, rendered_audit, dom, console, report_dir

The gate mirrors `packages/cli/src/acceptance/browser-qa-contract.ts`
(`evaluatePreflightGate`): `browser`, `viewport`, `dom`, `console` and
`report_dir` must pass; the visual area is proven by EITHER `screenshot` OR
`rendered_audit`; `proceed_reduced` only with an explicit `acknowledgedBy`
naming who accepted each uncovered capability; otherwise stop before the first
mutation. An area left uncovered by a reduced scope reports `blocked`, never
`pass`.

### Isolated preflight surface (no game access)

To break the "no tab → no DOM probe" loop, the preflight MAY open an isolated
`about:blank` tab and use it ONLY to prove `browser`, `viewport`,
`rendered_audit`, `dom` and `console` (viewport size, computed CSS, DOM
readout, console capture). Before a successful ACK the runner MUST NOT
navigate to Skald, call the Skald API, create a world, or perform any
gameplay action. After a successful ACK the normal flow starts: open the LAN
UI, create the scratch world, then inspect.

### Screenshotless visual acceptance (rendered structure)

When pixel capture is unavailable, the runner may still judge layout and
interface state from the ACTUALLY RENDERED page structure. Collect a bounded
render audit — never the whole DOM and never internal ids:

- viewport and document sizes (`clientWidth/Height`, `scrollWidth/Height`);
- for an allowlist of semantic elements only (`role` or a stable public
  selector): bounding rect, computed CSS (`display`, `visibility`, `opacity`,
  `position`, `overflow*`, `pointerEvents`, `fontSize`, `lineHeight`, `color`,
  `backgroundColor`), content metrics, visible/interactive/text flags, role
  and accessible name, and control state (disabled, `aria-busy`);
- measured overlaps, each marked intentional or harmful.

Then compute exactly these checks per viewport:
`horizontal-overflow`, `key-elements-visible`, `key-elements-in-viewport`,
`no-unintended-overlap`, `key-text-not-clipped`, `interactive-hit-targets`, plus
`mobile-touch-targets` on mobile viewports.

Report it as:

    visualEvidence.method = "rendered_structure"
    visualEvidence.pixelCapture = "not_captured"
    visualEvidence.pixelReview = "not_run"
    visualEvidence.notAssessed = ["pixel_appearance", "subjective_aesthetics"]
    visualEvidence.renderedAudit = { collector: "dom-geometry-computed-style-v1",
                                      complete: true, viewports: [...] }

`visual` may be `pass` only when every mandatory render-audit check passed.
`human` stays `not_run`/`blocked` — a structural audit is machine evidence and
must never be reported as a human judgement. Colour artifacts, anti-aliasing
and subjective appearance CANNOT be confirmed this way; the report must say so
through `notAssessed`. A `BLOCKED` screenshot must be recorded as blocked and
never marked as pass.

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
- for a screenshotless run: the rendered-structure audit and the explicit
  statement that pixel appearance and subjective aesthetics were not assessed;
- distinction between application failure and browser-tool limitation.

The JSON report must also contain the matching delivery protocol and run token.
The completion receipt uses relative paths and lowercase SHA-256 hashes. Write
it once.

Report one verdict per area, never a single blended result (plan_9 §16):

    repository, api, browser, visual, provider, human

`overall` is fail-on-any-fail: a green API smoke never masks a red browser
gameplay verdict. The JSON report must also carry `jobId`, `deployedCommit`,
`browserWorldId`, `apiWorldId`, the per-input ledger (`input`, `httpStatus`,
`responseKind`, `worldTimeBefore`/`worldTimeAfter`), `domAssertions`,
`consoleMessages`, `screenshots`, `blockedCapabilities`, `mutationCount` and the
click budget, matching the field names in `browser-qa-contract.ts`.

Do not claim visual QA from source inspection, `npm run validate`, HTTP smoke,
or API responses. If the fixed task cannot run the browser, report visual QA as
blocked and include its exact error.

## Missing-task handling

If the fixed thread cannot be found, search once by its title fragment and NTFS
workspace. If it is still absent, stop and tell the user. Creating another
Codex task requires an explicit user request.
