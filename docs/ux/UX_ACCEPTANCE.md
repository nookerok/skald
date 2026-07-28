# UX-0 Acceptance

## Architecture

- No new source of truth is introduced.
- Production controls map to existing commands or read-only routes.
- LLM does not select facts, importance, actions or outcomes.
- Concept controls are visibly marked as non-functional.
- Developer data is absent from normal player presentation.

## Playability

- The player can read the consequence of the previous action.
- The current Game Screen exposes at least two supported intentions.
- Primary and notable presentation remain distinct.
- Journal and thread state survive reload.
- No mandatory scripted path is presented as an invariant of the world.

## Accessibility and performance

- Touch targets are at least 44x44px.
- Mobile body text is at least 16px.
- Keyboard focus, screen-reader announcements and `aria-busy` are defined.
- WCAG AA contrast is checked.
- `prefers-reduced-motion` disables non-essential animation.
- Returning players are not forced through a 3–5 second splash.
- Critical LAN UI becomes usable within an agreed performance budget.

## Validation

UX-0 changes documentation only. Before handoff run:

```bash
npm run validate
git diff --check
```

The next implementation milestone additionally requires browser smoke tests for
pending, retry, reload, journal filters and error recovery.
