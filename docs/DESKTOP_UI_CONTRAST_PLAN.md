# Desktop UI contrast plan

Status: implemented locally; rendered acceptance review pending

## Cause and chosen direction

The desktop shell used global `[class*="..."]` selectors with `!important` to
reinterpret light-theme utilities as dark colors. These rules matched pieces of
hover classes as well as active classes, flattened text hierarchy, and changed
warning text to cyan without changing its pale warning background. Archives
exposed the mismatch in saved-recording badges and the metadata panel.

Three approaches were considered: Archives-only corrections, shared status styles,
and a complete desktop theme migration. The user selected the complete migration,
keeping the VS Code dark appearance and delivering the work in feature stages.

## Theme contract

- `desktop/app/src/app/theme.css` owns the desktop color palette. Use semantic
  Tailwind roles for surfaces, foregrounds, lines, control borders, actions,
  selection, focus, and paired status colors.
- The native reminder loads that same stylesheet. Raw `--mosaic-*` values are
  shared with its HTML; Tailwind `--color-*` aliases expose them to app components.
  Electron's file allowlist includes this stylesheet so it is available in ASAR.
- Body text, metadata, placeholders, labels, and status text must meet 4.5:1
  against their rendered background. Essential control boundaries, icons, focus,
  and selection indicators must meet 3:1. Decorative separators may be subtler.
- Pair status foregrounds with their status surface. Pair filled primary,
  destructive, and success actions with `on-action`. Links use `link`, not the
  primary button background. Never lower foreground opacity to create hierarchy.
- Use subdued gray edges for filled actions and separators (`line`). Fields use
  a softer gray `control-border` on neutral surfaces; selection and keyboard
  focus use the separate blue focus accent.
- Use a root dark color scheme so dialogs, portals, dates, selects, and scrollbars
  inherit the same theme. Respect Windows forced colors without disabling it.
- Use labels, icons, an outline, or a selection marker alongside color to convey
  status. A saved recording is neutral/informational; interrupted recordings and
  recovery checkpoints are warnings.
- New desktop UI must use the semantic roles. Do not add palette utilities, raw
  color classes, or CSS that selects fragments of class names to recolor UI.
  Historical UI prototypes, original brand artwork, and document exports retain
  their own colors and are excluded from the desktop source guard.

## Migration stages

1. [x] Foundation: semantic theme, native dark controls, shared buttons and focus.
2. [x] Meetings: Archives, meeting workspace, forms, and related dialogs.
3. [x] Notebook and Dashboard: cards, tasks, statuses, tables, and editors.
4. [x] Notetaker and Echo: recording states, chat, Markdown, and drawers.
5. [x] IT Projects, Tasks, Settings, shell, shared controls, and native reminder.
6. [x] Remove the class-fragment color adapter; add automated regression checks.
7. [ ] Record static checks and rendered UI evidence, including narrow windows.

## Verification and maintenance

- Run `npm run check:theme` from `desktop/app`. It checks approved color pairs and
  prevents raw palette classes and class-fragment color overrides from returning.
- Run TypeScript, relevant existing component tests, and a production build.
  Compare existing lint failures before attributing them to this migration.
- Review Archives, workspace tabs, Notebook, recording states, Echo, IT Projects,
  Settings, and shared dialogs in the rendered app. Include normal, hover,
  selected, keyboard focus, disabled, empty, loading, and error states.
- Check at desktop and narrow widths, plus Windows forced colors. Keep exports,
  data, recording persistence, API behavior, and feature permissions intact.
- A stage is complete only when its styles are migrated and the checks are
  recorded below. Do not imply unobserved runtime coverage or publish a release
  as part of this local implementation.

## Verification record

- `check:theme`: 73 contract color pairs and 546 explicit normal/hover/focus/disabled
  foreground/background pairs passed. Forty-seven app UI sources and the native
  reminder are guarded against palette drift. CI runs this check before building.
- Border refinement: filled-action edges use subdued gray, and field edges use
  softer gray. The field-boundary checks cover their neutral surfaces; blue
  selected items retain the independently checked focus/selection accent.
- TypeScript passed with `tsc --noEmit --incremental false`.
- Production build passed, with ten existing filesystem tracing warnings from
  local JSON record storage. This is source/build evidence, not installed proof.
- Relevant existing component tests: 26 passed, 9 failed. All nine failures throw
  `useEchoAI must be used inside EchoAIProvider` in the old Echo drawer, summary
  editor, and IT Projects tests. The provider dependency and bare component
  renders are present in HEAD; they predate this theme migration.
- Lint comparison across 32 changed TSX sources: HEAD has 87 errors and the
  working tree has 86. Existing hook/`any` findings remain; lint is not clean.
- `git diff --check` passed. Existing unrelated worktree edits were preserved.
- The computer-use host reported both native pipe and browser access unavailable.
  Live desktop/narrow-window screenshots, hover/focus click-through, and actual
  Windows forced-colors rendering remain unverified. Static color-pair checks
  do not certify whole-page WCAG conformance or replace rendered review.
- No installer was built or installed. The native reminder stylesheet was added
  to the packaging allowlist and the theme check guards that inclusion.

Contrast references: [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)
and [WCAG non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast).
