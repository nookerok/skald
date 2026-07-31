# Playability Principles

> **Design guidance, not architectural invariants.**
> Violating a principle should never stop the server, break a test,
> or produce an invalid domain state. These are criteria for design review
> and UX acceptance, not runtime guarantees.

## 1. The world does not report everything

The player receives meaningful observable facts, not the full Event Log.
Background processes continue to run but do not compete for attention.

## 2. Every previous choice must have a readable consequence

Do not show:
```
ObservationUpdated: risk_taken +1
```
Show:
```
Your risky action did not go unnoticed.
```

## 3. A turn should close one question and leave a new one

Example: *Why is it getting hotter here?* → player approaches → discovers
a heat source → a new question arises about what the fire will change.

Iteration 13 does not introduce separate state for questions or hypotheses.
The principle guides text and information selection.

## 4. The player describes intentions in words

The command composer is the primary action interface. The player describes what
they want to do in their own words. The interface does not choose, complete or
replace that intention with a direction pad, action chips or a fixed action
menu.

The only permanent button inside the command composer submits the player's
text. Navigation, journal, diagnostics, accessibility and other system controls
are not game intentions and may remain buttons.

The interpreter is non-authoritative: it may translate the utterance into a
structured proposal or ask for clarification, but deterministic Rules validate
the action and determine its consequences. Clarification does not advance world
time or create a successful action.

When an outcome is uncertain and its stakes are meaningful, the interface may
show the stakes, difficulty, world-derived modifiers, recorded roll and result.
It must not turn that critical moment into a menu of preselected actions. The
player's choice remains the intention they expressed in their own words before
the check.

A situation with only one reasonable course of action is still a design
warning. Multiple possibilities should be discoverable through the description
of the world and its consequences, not exposed as a fixed command palette.

## 5. Do not use traditional RPG terminology

Do not introduce:

- quests;
- missions;
- XP;
- levels;
- classes;
- skill trees.

For future Discovery Layer use project language:

- Trace (След);
- Hypothesis (Гипотеза);
- Discovery (Открытие);
- Rumor (Слух);
- Omen (Знамение);
- Echo (Эхо);
- Thread (Нить);
- Consequence (Последствие).

Iteration 13 may use these words as presentation labels but must not
create new canonical entities.


## 6. Observation & Belief determines the player UI

The normative data contract is in docs/OBSERVATION_BELIEF_MODEL.md. The player
does not receive the authoritative World or an unfiltered Event Log. The normal
Knowledge renderer receives only observer-scoped BeliefModelDTO and current
ObservationRecord data.

The interface makes uncertainty legible: interpretation, confidence, freshness,
evidence, hypotheses and contradictions remain distinct. The browser never
invents confidence, selects facts, resolves contradictions or turns a belief
into a preselected action. A prose prompt may invite investigation, but the
only permanent game control remains the free-text composer and its submit
button.

Developer Diagnostics is outside normal player presentation and may show raw
events only after explicit opening on the trusted LAN.
