# Chapter Reader Mobile Preview Design

## Goal

Upgrade the chapter reader so authors can evaluate typography from a real reader's perspective, with a mobile-first reading surface, book-level reading defaults, device-specific typography settings, and instant feedback while tuning the page.

## Why This Slice

The current chapter reader is optimized as a generic manuscript page, not as a realistic reading simulator:

- the reading surface does not reflect how the text actually feels on mobile
- typography is effectively fixed inside the chapter page
- Korean serif usage is currently blurred by the global `.font-serif` override, so "myeongjo-like" reading is not controllable at the reader level
- authors cannot compare saved settings against in-progress tweaks while deciding whether the page is actually readable

This is not a cosmetic tweak. It is a reader-experience correction: the chapter page should let the author read the real chapter under realistic mobile conditions before deciding whether the typography works.

## Scope

Included in this slice:

- mobile-first chapter reader presentation
- explicit mobile and desktop reading modes inside the same chapter reader
- book-level persisted reader defaults in `book.json`
- separate typography settings for mobile and desktop
- per-device controls for font preset, font size, and line height
- instant live updates while adjusting reader settings
- compact saved-vs-draft diff feedback inside the settings panel
- regression tests for reader setting persistence and rendering behavior

Explicitly deferred:

- per-chapter overrides
- project-wide typography defaults
- word-spacing, paragraph spacing, margin width, theme color, or justification controls
- EPUB export typography alignment
- end-user storefront or public reader rollout
- full browser automation for this specific slice

## User Decisions Captured

The design is locked to the choices validated during brainstorming:

- persistence scope: book-level defaults
- device handling: mobile and desktop settings are stored separately
- priority: mobile comes first
- preview fidelity: the actual chapter body must be readable in a realistic mobile simulation, not as a tiny sample card
- comparison: instant preview and full reader mode switching must both be supported
- extra comparison signal: show a compact diff against saved settings while editing

## User Experience

### Default Open State

When a user opens a chapter, the page opens in a mobile-first reading state by default:

- the main reading surface is constrained to a realistic mobile width
- the real chapter content is rendered with the mobile reading settings
- the page still allows switching to desktop reading mode without leaving the chapter

This keeps the initial impression anchored in how readers are most likely to encounter the text.

### Reading Mode Toggle

The reader exposes a compact mode toggle:

- `Mobile View`
- `Desktop View`

These modes do not swap to a separate mockup. They re-render the same chapter reader with the correct typography tokens and width rules for each device profile.

The intent is to answer two different questions quickly:

- "How does this actually feel on a phone?"
- "How does this hold up on a wider desktop reading surface?"

### Reader Settings Panel

The chapter page adds a dedicated reader-settings entry point separate from manuscript editing.

The panel contains two grouped sections:

- `Mobile`
- `Desktop`

Each section includes:

- font preset
- font size
- line height

Adjusting any control updates the live reader immediately. The settings panel is about reading simulation, not manuscript editing, so it must stay separate from the existing `Edit` flow.

### Instant Feedback and Diff

While the user adjusts settings, the page shows two kinds of feedback:

- the live reader itself updates immediately
- a compact diff summary shows how the current draft differs from the saved book defaults

The diff is not a text-content diff. It is a settings diff:

- `Mobile font: Saved Sans -> Draft Myeongjo`
- `Mobile size: 15 -> 17`
- `Desktop line height: 1.75 -> 1.9`

This gives the user a decision aid without turning the settings panel into a large comparison tool.

### Full Reading vs Preview Fidelity

The main rule is fidelity over ornament:

- use the real chapter content
- use the same rendering path for preview and reading
- avoid separate decorative sample text
- avoid tiny phone thumbnails that are good for looks but bad for actual readability judgment

If a secondary mini preview is shown at all, it must be subordinate to the main live reading surface. The main chapter body remains the source of truth.

## Design Summary

Keep the chapter reader as the canonical reading surface, but restructure it around a mobile-first reader model:

1. Add persisted `readerSettings` to `BookConfig`.
2. Load those settings with chapter data so the page can render immediately with book defaults.
3. Split the reader into a device-aware presentation model with `mobile` and `desktop` tokens.
4. Add a dedicated reader-settings panel with live draft state and save/reset behavior.
5. Render a compact diff summary between saved and draft settings while editing the reader profile.

This keeps the experience grounded in actual reading instead of adding an isolated settings lab.

## Data Model

Extend `BookConfig` with persisted reader defaults:

```ts
export interface ReaderDeviceSettings {
  readonly fontPreset: "sans" | "serif" | "myeongjo";
  readonly fontSize: number;
  readonly lineHeight: number;
}

export interface ReaderSettings {
  readonly mobile: ReaderDeviceSettings;
  readonly desktop: ReaderDeviceSettings;
}
```

Book shape:

```ts
readerSettings?: ReaderSettings;
```

### Defaults

When `readerSettings` is missing:

- initialize mobile defaults first
- initialize desktop defaults from a desktop-friendly baseline, not by reusing current Tailwind literals everywhere
- prefer a readable Korean mobile baseline over visual flourish

Recommended initial baselines:

- mobile: `myeongjo`, `16`, `1.72`
- desktop: `myeongjo`, `18`, `1.82`

These become the implementation baselines for this slice unless a concrete technical constraint forces a different mapping during execution.

### Font Presets

The reader must stop relying on the current global `html:lang(ko) .font-serif` override for book prose. Instead, introduce explicit reader typography classes or tokens so the chapter body can intentionally render:

- Korean sans
- Korean serif
- Korean myeongjo-oriented prose

This isolates reader typography from the rest of the studio chrome.

## State Model

The chapter reader uses three layers of state:

- persisted book defaults
- current view mode: `mobile` or `desktop`
- in-panel draft settings before save

Rules:

- opening a chapter uses persisted book defaults
- opening the settings panel clones persisted settings into draft state
- changing draft values updates the live reader immediately
- `Save` persists draft values to the book
- `Reset` discards the draft and returns to saved values

The chapter page may remember the last selected `mobile` vs `desktop` view locally for the session, but that is not part of the book-level contract for this slice.

## Rendering Plan

### Main Layout

Restructure the chapter reader header actions to clearly separate reading controls from manuscript controls:

- back to list
- mobile/desktop view toggle
- reader settings
- edit
- approve / reject

The main manuscript paper treatment can remain, but the actual reading column must adapt by mode:

- mobile view: narrow centered column with mobile padding and realistic phone-like width
- desktop view: wider single-column reading surface, still constrained for readability

### Reader Typography

Replace hard-coded paragraph typography classes with a small device-aware resolver:

- resolve font class from device settings
- resolve font size class or inline CSS variable from device settings
- resolve line height from device settings

This keeps the chapter body rendering consistent across preview and saved states.

### Settings Diff Presentation

Show a compact "changes" area inside the settings panel only when draft values differ from saved values.

Each diff item should:

- identify device scope
- show saved value
- show draft value

Examples:

- `Mobile / Font: Myeongjo -> Serif`
- `Desktop / Size: 18 -> 19`

Do not build a complex side-by-side matrix unless necessary. A concise change list is enough for this slice.

## API and Persistence Impact

The backend and studio contracts need to accept `readerSettings` as part of book config:

- core `BookConfigSchema`
- state manager save/load round-trips
- studio contracts for book payloads
- book update endpoint or equivalent persistence path

The reader page should not invent its own local-only source of truth for book defaults. Saving must land in the same durable book config used by the rest of the system.

## Error Handling and Compatibility

### Existing Books

Existing books without `readerSettings` must continue to load without migration failures.

At read time:

- missing settings resolve to defaults
- invalid partial settings should be sanitized or replaced with defaults

At save time:

- only valid normalized reader settings should be written

### Editing Separation

Reader settings must never mutate manuscript text.

Failure cases should be isolated:

- saving reader settings can fail without dropping manuscript content
- toggling view mode can fail safe to the saved book defaults
- canceling reader changes should not affect chapter edit mode

## Testing

Add focused regression coverage for:

- `BookConfigSchema` accepting and validating `readerSettings`
- state-manager round-trip persistence for reader settings
- chapter reader rendering the correct typography class and sizing for mobile and desktop
- live draft updates changing the rendered reader without requiring save
- diff summary appearing only when draft and saved settings differ
- fallback behavior when a book has no reader settings

This slice does not require end-to-end browser automation, but the rendering and persistence paths must be locked with unit tests.

## Implementation Summary

1. Extend core book models and persistence with `readerSettings`.
2. Extend studio book contracts and book update APIs to round-trip the new fields.
3. Refactor `ChapterReader` into a device-aware reading surface.
4. Add a reader settings panel with draft/save/reset behavior.
5. Add a saved-vs-draft diff summary.
6. Lock the behavior with persistence and reader rendering tests.
