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

## 4. The player must see different ways to act

The main screen always shows several available intentions:

- four movement directions;
- waiting;
- supported social actions.

The UI does not guarantee that an action will succeed. The final result
is always determined by existing game Rules.

The requirement "at least two meaningful choices" is a design-review gate,
not a runtime invariant — the current world may not yet contain enough
content for a full guarantee.

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
