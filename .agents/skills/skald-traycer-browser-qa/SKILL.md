---
name: skald-traycer-browser-qa
description: Run Skald browser, interaction, DOM, accessibility, responsive and post-deploy UI QA from a non-Codex session (opencode with the Traycer in-app browser) when the fixed NTFS Codex runner is not addressable. Use for screenshots, console inspection, desktop/mobile layout, gameplay clicks, reload/retry verification, and evidence reports against the deployed LAN UI.
---

# Skald Traycer Browser QA

Browser evidence for Skald from an **opencode/Traycer** session, using the
Traycer in-app browser. This is the fallback execution surface, not a
replacement for `$skald-ntfs-browser-qa`.

## When to use which skill

- `$skald-ntfs-browser-qa` — the fixed, projectless NTFS **Codex** runner
  (thread `01a09bbf-37a0-7642-82c5-ed3873add396`). Prefer it whenever the
  session can send that task a message. Its evidence lives on the
  `QA_FILE_BRIDGE_V1` NTFS channel.
- `$skald-traycer-browser-qa` (this skill) — when the session has no Codex
  thread-messaging tool (e.g. a native opencode/Traycer session) and the
  Traycer in-app browser is available. **Do not silently substitute it**: state
  plainly in the report that the fixed Codex runner was not used, and why.

`AGENTS.md` forbids claiming visual success from API/unit/integration tests.
This skill produces real browser evidence; keep the API smoke separate.

## Fixed target

- LAN UI/API: `http://192.168.0.5:3000` (trusted LAN only, unauthenticated)
- Deployed commit: read it from the Orange Pi (`$skald-orange-pi-deploy`) or
  `git rev-parse HEAD` in the pushed repo
- Scratch worlds only: never mutate the canonical player world

## Preflight before the first mutation (plan_9 §15)

Prove and record each capability before creating a world or clicking a gameplay
control:

    browser, viewport, screenshot, dom, console, report_dir

`evaluatePreflightGate` (`packages/cli/src/acceptance/browser-qa-contract.ts`)
allows `proceed_reduced` only with an explicit `acknowledgedBy` naming who
accepted each missing capability; an uncovered area then reports `blocked`,
never `pass`.

### Screenshot capability is frequently blocked

In the Traycer in-app browser `page.screenshot()` can hang indefinitely. Probe
it with a bounded race so the run does not stall:

```js
const shot = await Promise.race([
  page.screenshot({}).then(r => ({ ok: true, r })).catch(e => ({ ok: false, error: String(e) })),
  new Promise(r => setTimeout(() => r({ ok: false, error: "timeout-15s" }), 15000)),
]);
```

If it times out on both a simple `about:blank`/data-URL page and the Skald
page, mark `screenshot` blocked and the `visual` verdict `blocked`. Keep the
DOM/layout evidence (viewport, `scrollWidth` vs `innerWidth`, control bounding
boxes, touch-target sizes) and say the pixels are unverified. `page.locator(...)`
has no `screenshot`; do not rely on it. Tabs whose `viewed` flag is `false` may
be the cause — if the user opens the browser tile, retry once before giving up.

## Driving the app

Navigation is hash-based: `#/new/character`, `#/new/entrypoint`,
`#/new/prologue`, `#/world/<worldId>/return`, `#/world/<worldId>`.

Some controls do not react to a synthesized Playwright click in this surface.
If a click is a no-op, drive it natively and verify the effect:

```js
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find(x => (x.textContent || "").trim() === "Отправить");
  b?.click();
});
```

Fill the composer through the native value setter plus `input`/`change` events,
then click `#send-btn`; a plain `.fill()`/`Enter` may not reach the app handler:

```js
await page.evaluate((text) => {
  const el = document.getElementById("command-input");
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}, text);
```

## Scratch world and click budget

Create a scratch world through the UI New Story flow (`#/new/character` →
background → entrypoint → prologue → «Начать путь»), or via
`POST /api/worlds` with `{ characterName, backgroundId, entrypointId }`. Record
the returned `worldId`. World creation is one mutation.

State the click budget before running (deployment verification: keep it small,
e.g. ≤25 state-changing gameplay sends). Panel opens (Карта / Ты / Знания) and
read-only inspection are not mutations. Count every command sent and every
state-changing control clicked; the report carries the final `mutationCount`.

## Expected UI invariants (assert these)

- One input → one ТЫ→МАСТЕР turn (`masterTurnKey`); no duplicate master bubbles.
- Pending is atomic: while the request is in flight
  `#command-form[aria-busy=true]`, `#command-input.disabled`, `#send-btn.disabled`,
  status text «МАСТЕР отвечает…»; released afterwards.
- Deterministic answers end with an observer-safe continuation hint; narration
  shows «МАСТЕР дополняет эту запись…» while pending and replaces the bubble when
  ready.
- Read-only inquiries never advance `worldTime`; compounds answer every
  understood question in one turn (plan_9 §1).
- Journey continuation advances exactly one tick and a closed crossing blocks
  with a named cause — no «этап 2 из 2» hang (plan_9 §3-§4).
- Reload preserves world, `worldTime` and the feed; composer returns usable.
- Mobile 390×844: no horizontal overflow, ≥44px touch targets.
- Knowledge panel shows only seen / testimony / hypotheses — no truth fields.
- Console: capture and report error count and exact critical messages.

## Evidence contract (plan_9 §16)

Write a JSON report carrying `jobId`, `runToken`, `executionSurface`,
`deployedCommit`, `browserWorldId`, `apiWorldId`, the per-input ledger
(`input`, `httpStatus`, `responseKind`, `worldTimeBefore`, `worldTimeAfter`),
`domAssertions`, `consoleMessages`, `screenshots`, `blockedCapabilities`,
`mutationCount` and `clickBudget`, the preflight probe outcomes and the six
verdicts:

    repository, api, browser, visual, provider, human

`overall` is fail-on-any-fail; a green API smoke never masks a red browser
verdict, and any uncovered area makes `overall` blocked. Store the report as a
Traycer artifact (a `review` artifact under the epic) plus a JSON file under
`C:\Temp\opencode\skald-qa\`. Do not write it to the NTFS `qa-evidence` channel
— that channel belongs to the fixed Codex runner.

## Failure handling

- Do not claim visual success from DOM/source/API inspection alone.
- If the browser cannot reach the LAN URL, report the exact error and stop.
- Never change server, router, CORS or systemd state to force a result.
- Never mutate the canonical player world; use a scratch world and record its id.
