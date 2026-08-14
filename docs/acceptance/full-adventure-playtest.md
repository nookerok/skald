# Full adventure playtest

The deterministic acceptance slice proves the HTTP/SQLite path, not that a human spent 30–60 minutes enjoying the game. A release candidate needs two separate pieces of evidence.

The human review is machine-checked for completeness, but the validator does not invent the tester's answers:
`npm run acceptance:adventure:review -- docs/acceptance/full-adventure-review.json`
The `evidence` object must also identify the scenario commit SHA, deterministic
JSON report, fixed browser task, model/provider and timeout, DOM notes and an
explicit `blockedChecks` array. These fields describe provenance; they do not
turn an automated run into a human review.
Start from `docs/acceptance/full-adventure-review.template.json`. Record the real disposable world, ISO start/end timestamps, exact command budget, one Presence acknowledgement, 24–48 offline ticks, desktop/mobile screenshot paths and all ten rubric answers. A valid report is a release evidence requirement, not a deterministic simulation test.

## Deterministic gate

Run:

```bash
npm run acceptance:adventure
```

The runner creates a fresh `living_region`, uses only HTTP routes, persists every command in SQLite, and removes its temporary database. It must report `pass: true`, zero HTTP failures, idempotency success, restart stability, no personal observation leak during offline ticks, and no raw internal keys in player-facing narrative fields.

## Live AI-DM/browser playtest

Use the fixed NTFS browser QA task and a configured live model. The playtest is authorized for one fresh test world and a bounded command budget of 35 player commands plus 24–48 offline ticks; do not use production player saves. Record PASS/FAIL/BLOCKED separately from unit, Canon, simulation and deterministic acceptance gates.

A reviewer should complete this arc in natural language rather than selecting canned buttons:

1. Enter the `living_region`; confirm the map has a current marker and fog-of-war, and the first response is a master reply.
2. Ask what can be heard near the crossing; verify the rumour is useful but contains no exact coordinates.
3. State a compound intention (for example, take the western road below the ridge while watching the lights). The AI-DM may propose an interpretation or ask a clarification; it may not decide success.
4. Choose a destination and travel through at least three explicit waits/steps. Confirm the player can interrupt or change intent without teleporting.
5. During travel, observe a weather, river or crossing change and explain the consequence in the next master reply.
6. Reach the old ruins and inspect a structural trace twice at different world times. The Knowledge/Discovery view must show a trace or hypothesis, never a Canon fact.
7. Return to the waystation. Compare the map before/after: a traversed route and newly observed locations are visible, while unobserved geometry remains fogged.
8. Leave the world absent for 24–48 autonomous ticks. On reconnect, confirm the region changed without creating a personal observation or moving the player, and Presence is limited to two or three useful highlights.
9. Acknowledge Presence, reload/reconnect, and read the chat feed and chronicle. The sequence must remain Player → Master, ordered, coherent and free of event IDs, internal location IDs, coordinates or raw diagnostic keys.

The evidence bundle should contain the scenario commit SHA, deterministic JSON report, browser screenshots/DOM notes, command count, model/provider/timeout, and an explicit list of blocked checks. A live model timeout or unavailable browser is a release evidence gap, not a reason to weaken deterministic checks.