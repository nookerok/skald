# Skald - Agent Instructions

Skald is a TypeScript/Node.js event-sourced living-world simulation. The player
discovers laws of the world through actions and consequences. The architectural
source of truth is docs/ARCHITECTURE.md; this file is the short executable policy
for Codex and Hermes sessions.

The C30D/STM32/ROS2 hardware instructions do not belong to this repository.
They must live in the robot workspace AGENTS.md, not in Skald's agent context.

## Workspace boundary

Only these top-level packages are allowed:

    packages/event-bus/
    packages/rule-engine/
    packages/world/
    packages/intent-parser/
    packages/cli/

Consequences, Situations, Observations, Biography, Read Models, Narrative and
Presentation remain inside world/ or rule-engine/. Do not create another
top-level package without revising this file and docs/ARCHITECTURE.md.

## Sources of truth

1. AGENTS.md: permanent rules and safety boundaries.
2. docs/ARCHITECTURE.md: architecture rationale and history.
3. docs/PROJECT_MAP.md: stable navigation and runtime flows.
4. docs/GLOSSARY.md: canonical terminology.
5. docs/DECISIONS.md and docs/adr/: accepted cross-cutting decisions.
6. CODEX_HANDOFF.md: current milestone only; verify it against Git and code.
7. packages/ and tests: executable behavior.

If sources disagree, stop and surface the contradiction. Do not silently choose
the convenient interpretation.

## Permanent invariants

1. Event Log is the only source of truth. It is append-only; recorded Events are
   never edited or deleted.
2. Projection Purity: Projection is fully derived from Event Log. Delete it,
   replay the log and the result must be identical.
3. Rules are deterministic: (Event, ReadonlyWorld) -> Event[]. No Date.now(),
   Math.random(), runtime UUIDs, network, LLM or mutable global state inside a
   Rule. A Rule emits new Events only.
4. Narrative and LLM are never authoritative. They describe existing facts and
   never modify state or decide for the world, NPCs or offline players.
5. No runtime Rule generation. Rules are registered statically at startup.
6. No NPC.decide(). Offline strategy is a deterministic pre-registered Rule.
7. Command is not Event. Only resulting Domain Events enter the canonical log.
8. All Rules for one Event read one snapshot; Projection updates after the batch.
9. Top-level commands commit staged Events and Projection atomically.
10. External commands require an idempotency key; duplicate keys do not create a
    second command or Event.

## Forbidden game concepts

Do not introduce Spell, MagicSchool, Mana, Cooldown, Class, XP, SkillTree,
Talent, QuestManager, DialogueTree, NPC.decide() or LevelSystem. Express new
behavior through existing Events, Rules, Consequences, Situations, Observations,
Relations and Heat laws.

## Presentation and Narrative boundary

PresentationTemplate is a pure, non-authoritative adapter:

    (DomainEvent, ReadonlyWorld) -> PresentationCandidate | null

It is not a Rule, emits no Domain Events and does not write Projection.
Importance (primary, notable, background) is classified on the backend. The
browser only renders the server DTO. LLM may rephrase selected facts but may
not select facts, importance or actions.

Playability guidance is in docs/PLAYABILITY_PRINCIPLES.md. It is design
guidance, not a new runtime invariant.

## Development workflow

At task start:

1. Run git status --short --branch.
2. Read the relevant PROJECT_MAP.md and CODEX_HANDOFF.md sections.
3. Inspect current code and tests before proposing edits.
4. Preserve unrelated dirty changes.

Batch independent read-only reads. Use CodeGraph for stable cross-file
structure only when its local index is available and fresh. Use rg for exact
text, configuration, generated files and unindexed paths. Before editing a
critical file, read its current source directly even if a graph result exists.

Run focused tests after focused changes. Do not repeat unchanged full suites.
Before handoff, commit or deployment run npm run validate. Update
CODEX_HANDOFF.md only when milestone, next step, blocker or validation state
changes. Git and executable code outrank handoff.

## Testing

Every Rule has a unit test:
Given Event + ReadonlyWorld -> Rule -> Expected Events.

Every new PresentationTemplate has a pure unit test. Integration tests cover
the complete command path. Preserve Projection Purity, atomicity, idempotency,
immutable snapshot/payload, poisoning and LLM authority tests.

## Validation

The single repository gate is scripts/validate.sh, exposed as npm run validate.
It runs, fail-fast:

    bash -n scripts/validate.sh packages/cli/deploy/*.sh
    npm run typecheck
    npm test -- --run
    git diff --check

Do not hide failures with || true, truncate the only error output or make
validation depend on a network service.

## Orange Pi deployment rule

Deployment is operational, not a game Rule or Domain Event.

1. Deploy only from a clean branch after npm run validate.
2. Commit and push before device update; Orange Pi update is fast-forward only.
3. Installer/updater run as the deployment user, not sudo ./script.sh. Runtime
   is exactly Node v22.23.1 and is checked before build/start. The installer
   grants `nooker` passwordless access only to restart `skald.service`; updater
   must verify that restricted permission before backup or pull.
4. Before update require a non-empty SQLite source, online backup and
   PRAGMA integrity_check = ok.
5. Restore only through /usr/local/bin/restore-skald.sh. Stop timers/services,
   replace the DB, remove WAL/SHM, start the server, pass HTTP health, then
   re-enable timers.
6. Success requires active systemd service, /api/health, /api/state and one
   idempotent game smoke request.
7. On failure use the saved commit and backup for rollback. Do not report
   success before health recovery.
8. Without authentication/TLS expose the server only to a trusted LAN.

## File and scope limits

Keep modules focused and split before a file becomes difficult to review. Do
not change Event schema, canonical Rules, persistence or deployment while doing
documentation work unless the task explicitly includes it. Never commit .env,
SQLite files, .codegraph/, generated build output or LLM health/usage artifacts.

## Pull request report

Every PR answers:

1. What law or non-authoritative read capability was added?
2. What Events or read models does it consume?
3. What Domain Events does it create? If none, say so explicitly.
