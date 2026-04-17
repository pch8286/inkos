# Cockpit Legacy Redirect Design

## Goal

Make `/cockpit/` the single real Cockpit UI entrypoint by automatically forwarding legacy `/?page=cockpit` Studio routes into the standalone Cockpit shell.

## Why This Slice

Cockpit already has a standalone shell at `/cockpit/`, but the legacy Studio route still renders Cockpit inside the full Studio frame. That creates an unnecessary split:

- users can reach the same product surface through two different shells
- the "focused" Cockpit experience depends on discovering a separate entrypoint
- UI work for Cockpit routing has to account for both direct render and standalone render paths

The requested outcome is effectively a focus mode, but the approved design does not add a new button. Instead, it treats the standalone shell as the default destination and turns the legacy route into a compatibility redirect.

## Scope

Included in this slice:

- keep parsing legacy `?page=cockpit` routes
- redirect legacy cockpit entry to `/cockpit/`
- preserve `bookId` when redirecting
- avoid back-stack churn by replacing history during redirect
- stop rendering the full Cockpit UI from the legacy Studio shell path
- update tests around routing and standalone entry behavior
- update README wording so docs match the new behavior

Explicitly excluded:

- adding a new "focus mode" or "cockpit only" button
- redesigning Cockpit's internal three-column layout
- changing non-cockpit Studio routes
- changing CLI deep-link behavior beyond the already-supported `/cockpit/` entry
- backend API changes

## User Decisions Captured

The design is locked to the choices validated during brainstorming:

- desired outcome: page-level focus, not just hiding internal side rails
- preferred entry behavior: automatic redirect, not a new button
- canonical destination: `/cockpit/`
- legacy compatibility: keep old links working by forwarding them

## UX Summary

### Canonical Entry

`/cockpit/` becomes the only real Cockpit screen. All focused Cockpit usage should end up there, whether the user arrived through:

- `inkos cockpit`
- a direct `/cockpit/` browser entry
- a legacy `/?page=cockpit` link

### Legacy Entry Behavior

When the app loads on `/?page=cockpit`, the Studio app should not show a full Cockpit-in-Studio render. Instead:

1. detect the legacy cockpit route
2. compute the matching standalone Cockpit URL
3. immediately replace the current location with `/cockpit/` plus any supported query parameters

If `bookId` is present, it must be preserved:

- `/?page=cockpit` -> `/cockpit/`
- `/?page=cockpit&bookId=alpha` -> `/cockpit/?bookId=alpha`

### History Behavior

Use `window.location.replace(...)` for the redirect so the browser history does not keep a redundant legacy cockpit step. This prevents a back-button loop where the user returns to the legacy URL only to be redirected again.

### Transitional UI

If the redirect logic lives inside the Studio app boot path, the user may briefly see a shell frame before navigation completes. That transition should use a minimal loading placeholder only. The old embedded Cockpit surface should not render during that handoff.

## Routing Design

### Legacy Parsing Stays

`parseRouteFromSearch` should continue recognizing `page=cockpit`. Existing bookmarks, copied links, and older code paths may still produce that query string. Removing the parse path would break compatibility rather than preserve it.

### Canonical URL Builder

Add or reuse a focused helper that converts the current mounted Studio pathname into the standalone Cockpit URL. It must support both root and mounted deployments:

- `/` + `?page=cockpit` -> `/cockpit/`
- `/tenant-a/` + `?page=cockpit` -> `/tenant-a/cockpit/`
- preserve `bookId` as a query parameter when present

The helper should stay pure and unit-testable.

### App Responsibility Split

Responsibility after this slice:

- `App.tsx`: detect legacy cockpit route and forward to standalone entry
- `CockpitStandaloneApp.tsx`: own the actual standalone Cockpit shell
- shared helper(s): build redirect targets consistently for mounted deployments

This removes the need to maintain two real rendering paths for Cockpit.

## Implementation Approach

### App Changes

`App.tsx` should stop treating `route.page === "cockpit"` as a normal in-shell page render. Instead:

- detect that route early enough to avoid rendering embedded Cockpit content
- compute the standalone Cockpit destination
- call `window.location.replace(...)`
- show only a tiny loading state while the redirect happens

### Standalone Navigation

`CockpitStandaloneApp.tsx` already knows how to navigate from `/cockpit/` back to normal Studio routes. That behavior remains the reverse half of the routing model:

- standalone Cockpit can link back to `/`, `?page=book`, `?page=truth`, and `?page=book-create`
- legacy Studio cockpit links go forward into `/cockpit/`

This makes the routing contract one-directional and easier to reason about.

### Documentation Change

README text should no longer claim that `/?page=cockpit` remains a normal migration-compatible Studio route. After this slice, it remains compatible as an accepted entry, but its behavior is forwarding, not embedded rendering.

## Failure Handling

Failure handling should stay minimal:

- if the canonical URL can be computed, always redirect
- if path normalization fails unexpectedly, fall back to the default Studio dashboard behavior instead of attempting a partial embedded Cockpit render

No custom error page is needed for this slice.

## Implementation Targets

Expected files for this slice:

- `packages/studio/src/App.tsx`
- `packages/studio/src/App.test.ts`
- `packages/studio/src/CockpitStandaloneApp.tsx`
- `packages/studio/src/CockpitStandaloneApp.test.ts`
- `packages/studio/src/pages/entrypoint-routing.test.ts`
- `README.md`

The exact helper placement can be adjusted during implementation, but the routing behavior should stay concentrated in app-entry files rather than spread through Cockpit page components.

## Testing Strategy

### Helper Tests

Add or extend tests to verify canonical redirect URL building:

- root deployment redirects to `/cockpit/`
- mounted deployment redirects to `/tenant-a/cockpit/`
- `bookId` is preserved

### App Routing Tests

Verify that legacy cockpit route handling no longer depends on rendering the full Cockpit page inside `App.tsx`:

- `page=cockpit` is still recognized as a valid incoming route
- redirect behavior is triggered for cockpit routes
- no embedded Cockpit render is required to satisfy the route

### Standalone Entry Tests

Keep coverage around standalone path helpers so mounted deployments still navigate back to Studio correctly after the redirect architecture is in place.

### Verification

Implementation should be considered complete only after:

- targeted Vitest coverage passes for the new routing helpers and app behavior
- any affected Cockpit entrypoint tests pass
- docs reflect the forwarding behavior

## Success Criteria

This slice is complete when:

- opening `/?page=cockpit` always lands on `/cockpit/`
- `bookId` deep links survive the redirect
- the user never sees the full embedded Cockpit UI rendered inside the legacy Studio shell
- `/cockpit/` is the only real Cockpit rendering surface
- README wording matches actual runtime behavior
