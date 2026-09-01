---
version: alpha
name: "Skald"
description: "Литературная игра об исследовании живого региона: тёмный атлас, наблюдаемая информация и золото для значимых перемен."
colors:
  primary: "#D7AA52"
  secondary: "#64C7D8"
  background: "#03080C"
  surface: "#0B1720"
  raised: "#10232E"
  text: "#F0EADF"
  text-secondary: "#CBD8D6"
  muted: "#9EADB0"
  danger: "#ED795F"
  success: "#62B78C"
typography:
  display:
    fontFamily: "Georgia, Times New Roman, serif"
    fontSize: "1.25rem"
    lineHeight: "1.55"
  ui:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    lineHeight: "1.5"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
rounded:
  DEFAULT: "12px"
  sm: "8px"
  md: "12px"
  lg: "22px"
spacing:
  control: "44px"
  shell-gutter: "clamp(14px, 3vw, 44px)"
  section: "16px"
  content-max: "860px"
components:
  primary-action:
    background: "#D7AA52"
    foreground: "#071017"
    minHeight: "44px"
  observation:
    accent: "#64C7D8"
    surface: "#0B1720"
  dialog:
    radius: "22px"
    backdrop: "rgba(1, 6, 9, 0.82)"
---

# Skald Design System

## Overview

### Creative North Star

Skald is a dark field atlas opened on a wooden desk at dawn. The atlas is the
memorable reference: quiet ink surfaces hold the world, cyan marks what the
player can currently observe, and a restrained gold line records a meaningful
change. The interface should feel like a literary instrument for noticing
causes and consequences, not like a dashboard or a chat app.

### Product context and register

- **Audience and primary job:** Narrative and systems-minded players describe an
  intention in their own words, then understand how the region changed.
- **Target market(s) and evidence:** Russian-language product; the repository's
  UX contract and worldbuilding documents define the current audience and scope.
- **Locale(s) and language policy:** Russian player copy. Technical names,
  identifiers, provenance and raw propositions remain backend/diagnostics-only.
- **Usage scene:** Desktop and narrow mobile browsers, with reading as the
  dominant activity and one persistent text composer for in-world intent.
- **Register:** Hybrid: atmospheric brand expression on menu and world surfaces;
  familiar product behavior for navigation, loading, errors and recovery.
- **Memorable signature:** A compact world pulse after a turn: consequence,
  observation and what remains uncertain, carried by gold/cyan hierarchy.
- **Restraint:** Map, Ты and Знания support reasoning but never become a second
  action menu or an authoritative event log.
- **Anti-references:** Generic AI chat, admin panels, command palettes and RPG
  HUDs with action chips or directional controls.
- **Token ownership/runtime mapping:** Runtime CSS is canonical (Model B). The
  single mapping lives in `packages/cli/public/tokens.css`; this file mirrors
  its accepted values. Legacy aliases in older stylesheets resolve to the same
  semantic variables. Drift is checked by review and `git diff --check`.

## Colors

The palette is intentionally low-chroma and dark. `primary`/gold marks a
meaningful consequence or the primary safe action; `secondary`/cyan marks
observable information, focus and navigation; `text` is the readable prose
foreground; `muted` is supporting context only; `danger` is reserved for real
failures. Focus is always cyan and is never conveyed by color alone. Surfaces
use `background`, `surface` and `raised` rather than screen-local colors.

## Typography

Display prose uses `Georgia` as an available literary serif with a system serif
fallback. UI copy uses the Inter/Segoe/system stack for stable controls and
Russian metrics. Body text stays at least 16px on mobile, with generous line
height for long narrative sentences. Uppercase is reserved for short eyebrows
and labels; player-facing prose remains sentence case.

## Layout

The conversation and composer share the `content-max` measure. Desktop surfaces
use generous ink around a single readable center; player-space panels open as a
separate overlay. At narrow widths the layout reflows to one column, keeps all
controls at least `control` size, and preserves natural document scrolling.
Content is never made reachable only through horizontal overflow or clipped by
an ancestor. Scrollbars use the global tokenized baseline in `tokens.css`.

## Elevation & Depth

Hierarchy comes from tonal layers, one-pixel warm/cyan borders and restrained
shadows. The menu, presence and player-space overlays may use blur as a
separation cue. Static narrative does not use ornamental elevation that would
compete with text. Loading keeps a stable reserved surface; reduced motion
removes non-essential transforms.

## Shapes

Controls use the small radius; cards and overlays use the default or large
radius. The composer is a grounded panel, not a pill. Circular close/focus
controls are exceptions for compact icon actions and retain visible labels for
screen readers.

## Components

### Foundational visual states

Enabled controls have hover, focus-visible and active states. Busy controls keep
their geometry, expose `aria-busy` and disable conflicting submissions.
Unavailable and error states use explicit copy and recovery actions. Empty
states explain what the player can do next without inventing world facts.

### Buttons and actions

There is one in-world action: the labelled text composer submit. Gold is the
primary safe action; cyan outline/ghost controls are navigation and utilities.
The composer never renders directional buttons or action chips. Icon-only
controls have localized accessible names and a 44px touch target.

### Navigation and data display

Map, Ты and Знания are peer player-space tabs. Tabs use `aria-selected` and
roving focus; overlays trap focus, close on Escape and restore focus to their
opener. The chronicle is a readable list of player/master turns and hides raw
IDs and technical event names from the normal surface.

### Forms and overlays

The composer has a visible label, `novalidate`, IME-safe Enter handling and a
stable pending status. Overlays use app-owned semantics with inert background,
bounded content and reachable actions on mobile.

### Iconography

The product currently uses small text/symbol marks (`✦`, `✧`, `×`) rather than a
separate icon package. Symbols supplement visible labels and are never the only
accessible name.

### Motion

Motion is short and state-driven (roughly 180–300ms), with no motion required to
understand a result. `prefers-reduced-motion: reduce` removes transforms and
non-essential transitions.

### Content and data visualization

Copy is calm, concrete and observational. A fallback says what happened and
what the player can inspect next; it never says only “action impossible” and
never exposes a technical reason. Map colors distinguish current position,
observed places, traversed routes and fog, with textual legend equivalents.

## Do's and Don'ts

- **Do:** Lead every turn with a consequence the player can understand.
- **Do:** Keep the composer as the only persistent in-world action control.
- **Don't:** Reintroduce raw IDs, coordinates, propositions or event types into
  normal player copy.
- **Don't:** add a second CSS token root or use overflow clipping to hide layout
  defects.
