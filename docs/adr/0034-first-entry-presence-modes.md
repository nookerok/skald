# ADR-0034: FirstEntryDTO and first/return Presence modes

- Status: Accepted
- Date: 2026-08-16
- Scope: observer Presence read model and onboarding UX

## Context

A new living-region story and a returning player were rendered through the same Presence wording. That made the first launch look like a return and encouraged the UI to invent context from incomplete profile data.

## Decision

The backend distinguishes the modes by the observer checkpoint:

- missing checkpoint + authored background/entrypoint: FirstEntryDTO, phase «Начало пути», CTA «Начать путь»;
- valid or incompatible checkpoint: return Presence, phase «Возвращение», CTA «Вернуться».

FirstEntryDTO is a pure, observer-safe read model. It is derived from the accepted background and entrypoint, the current observer-scoped BeliefModel, visible conditions and accessible inventory. It never enters the Event Log and never changes Projection. The observer session contract is version 2 and carries firstEntry: FirstEntryDTO | null.

The new-game prologue uses the same deterministic composition source. One click keeps the existing idempotent sequence: create/replay the world, fetch one revision, acknowledge Presence and open the Game Shell. No confirmation screen is added. LLM/Narrative may rephrase the DTO but cannot add facts, contacts, items, events or state changes.

## Consequences

Legacy worlds without an authored background/entrypoint keep the compatibility Presence surface and do not receive a fabricated first-entry scene. An incompatible checkpoint is treated as return mode with an explicit recovery message, never as a new first entry.
