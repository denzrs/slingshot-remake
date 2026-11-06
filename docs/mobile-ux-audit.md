# Mobile UX audit

Reviewed 6 November 2026 against the current working tree. This is a review and proposal, not an implementation plan or an accessibility certification. Related sources and product comparisons: [mobile UX research](mobile-ux-research.md).

## Overall assessment

Slingshot already has a recognizable visual identity: the orbital art, restrained navy, mint and orange, and stencil headings feel like one game rather than a generic mobile dashboard. The launcher gives the main destinations clear names; the shared footer gives primary actions a predictable place; settings categories, card swipes and the optional stick have deliberate mobile treatments. Preserve those strengths.

The largest remaining mismatch is **information priority**, particularly in online play. The game often devotes scarce phone space to connection, form framing and controls while the actual job—recognizing a room, seeing its players, inviting someone or understanding the match—has less room. There are also genuine interaction and content issues that a polished visual pass alone would not solve. Avoid adding back the vertical scroll hint the user explicitly rejected; favor natural content flow and better prioritization instead.

## What was inspected

- Captured the current app using `npm run screens -- --url http://127.0.0.1:5174/ --sizes 390x844,320x740 --out /private/tmp/slingshot-mobile-audit --png --jobs 4`, with a local relay. The harness reported **140/140 captured states fit at each size**; this is a geometry check, not proof that content is legible, visible without scrolling, or operable. It includes local setup, rules, crew, settings, training, daily and online create/find/code/host-room states; it also records alternate preset and editor states. Screenshots and layout dumps are temporary local review artifacts in that directory.
- Ran `npx tsx scripts/mobile-check.ts http://127.0.0.1:5174/`: the existing Retina, touch settings, simulated drag/orientation, preset swipe, language and crew checks passed. The checks include English and German at 320 and 430 px, but are not a full manual review of both languages or all online states.
- A separate Chrome touch-emulation probe at 320 × 740 tested the online tab swipe described below. Captures are primarily English; the probe used German. The 390 × 844 screenshot comparisons included public Lichess and Chess.com mobile web pages; see the research note for what was actually visible and comparison limits.
- The room styling changed during the review, so host-room screenshots were recaptured against the later working tree: `/private/tmp/slingshot-room-current/`, 320 × 740 and 390 × 844. Other captures represent the earlier working-tree snapshot and should be refreshed if related code changes. No app UI was changed for this audit.
- This is Chrome emulation, not a physical phone. VoiceOver/TalkBack, real iOS Safari and Android Chrome, software keyboard and browser chrome, text zoom, safe-area hardware, low bandwidth, full two-player online gameplay, reconnect/error states, chat conversations and finished-match results were not fully tested. The harness's `game-pause` screenshot showed gameplay rather than a reliably opened pause menu, so do not treat it as pause-screen sign-off.

## Findings, in priority order

### 1. Online tabs mix two incompatible swipe models — high, reproduced

**Where:** online find/create/code and host's mode picker. [Online tab styles](../src/ui/menu/menu-page/mobile.css) make the viewport horizontally scrollable, but [online.css](../src/ui/menu/menu-page/online.css) restricts touch panning to the vertical axis and [the touch handler](../src/ui/lobby/index.ts) interprets horizontal swipes as changing pages. At 320 px, “Code eingeben” is clipped; swiping left changed the active page from “Raum suchen” to “Raum erstellen” and reset the rail to its start instead of simply revealing the third label. Tabs also rotate their order around the active item. This is especially confusing because settings and training use stable scrollable lists.

**Impact:** a natural attempt to reveal a tab changes the context; the destinations move around and can be difficult to locate consistently.

**Recommendation:** choose one model for the phone rail: stable-order, freely scrollable tabs with direct tap selection, or a deliberate pager with separate, clear controls. Prefer the same interaction and visual treatment as the other mobile category bars; preserve direct access, active-state semantics and keyboard behavior. Test a clipped third tab with a real finger and switch in both directions.

### 2. The waiting room puts too much chrome before the crew and game — high, observed

**Where:** host waiting room, [room layout](../src/ui/menu/menu-page/room.css) and [mobile room contract](../src/ui/menu/menu-page/mobile.css). In the refreshed 320 × 740 capture the identity, connection, room symbol/code/share/visibility panel and team switch consume most of the reading area; the first player row is cut by the pinned footer and presets/rules are further below. At 390 × 844 three separate empty invite rows consume much of the visible area. At 320 px the code share actions wrap onto separate lines. The footer also reserves a full-width disabled Start action and a long explanation.

**Impact:** it takes effort to see who is present and find the game choices while hosting. The prominent disabled action competes with the immediate job of inviting or waiting.

**Recommendation:** organize around room status, people and invitation first, followed by game settings; compact the connected state and the code/share presentation without hiding essential room identity or privacy. Consider one clear empty-seat/invite affordance rather than repeated identical empty rows, while keeping all capacity and CPU controls discoverable. Revisit the disabled action and its explanation as one coherent state. Preserve actual scrolling and the persistent primary action where it helps; **do not reintroduce a scroll indicator**.

### 3. Room list cards sacrifice the room name to oversized side actions — high, observed

**Where:** online find at 320 px. The captured card reduces the room title to roughly “Ra…” while Join and Watch occupy the majority of its width and stretch vertically. At 390 px it remains truncated (“Raum von…”). [Room card construction](../src/ui/lobby/browse.ts) and [layout](../src/styles/lobby.css) place information and actions in competing columns.

**Impact:** when several rooms exist, players cannot readily distinguish them before choosing where to join; the action dominates the decision it is meant to support.

**Recommendation:** give the name and host a readable first row and move compact, clearly labeled Join/Watch actions beneath or alongside only when room remains. Check long names, locked rooms and live games at 320 px. Retain separate player and spectator actions and adequate touch targets.

### 4. Training still teaches keyboard-first interaction on a phone — high, confirmed content

**Where:** first training lesson explicitly says “Press Esc”; the aiming lesson spends substantial space on arrow keys, Enter and modifier keys; there is also a keyboard-specific chapter. See [tutorial copy](../src/platform/i18n.ts) and [lesson composition](../src/ui/screens/tutorial.ts). The real match offers a touch wheel, power controls and an optional stick.

**Impact:** a new phone player is taught controls they may not have, while the available touch controls and how to fire deserve the clearest instruction. The discrepancy undermines the training's central purpose.

**Recommendation:** provide touch-specific instructions and visual examples keyed to the chosen control scheme; keep keyboard instructions available when useful. Check both languages, both wheel and stick, in-game controls, and accessibility without relying only on device width to infer an input method.

### 5. Room-code entry relies on a disappearing placeholder — medium, confirmed

**Where:** online code screen, [browse.ts](../src/ui/lobby/browse.ts). The field has an accessible `aria-label`, but its only visible label is its placeholder. Once the player types, the visible field name disappears. The screenshot also shows a large bordered container with the short form centered inside it, consuming a sizable part of the reading area.

**Impact:** after typing or returning from an error, the field's purpose is less visible; the framing makes a short task look heavier than it is.

**Recommendation:** keep a persistent visible “Room code” label, bring the form together near the top of its available space, and retain the join-as choice and contextual error. Test pasting, invalid codes, password follow-up and keyboard dismissal. The accessible name is present; this is not a claim that the field is unnamed to assistive technology.

### 6. Mode and category navigation is visually similar but behaves inconsistently — medium, observed

**Where:** local mode carousel, rules/settings/training category rails, online rails and preset cards. The screens use a mixture of clipped large display headings, underlined labels, carousel arrows and tap-to-select cards. Some active items stay in place; the online rail reorders; the local mode heading shows partially cut, low-opacity neighbors. On 320 px the truncated categories and overlaid chevrons compete with text. The user's request was for roomier tab bars, so solve consistency without returning to cramped labels.

**Impact:** people must relearn whether a horizontal movement scrolls, switches content or selects a preset. Cut-off display text can look broken rather than inviting.

**Recommendation:** establish a small number of clearly differentiated patterns: stable section tabs for categories and an explicitly signposted card selector for presets. Give visible destinations readable labels and preserve an accessible tap alternative. Check German long labels, selected-tab restoration and narrow widths. Do not assume every horizontal rail needs the same component or introduce extra decorative hints.

### 7. Power-up choices are dense and hard to identify at a glance — medium, observed and measured

**Where:** local/online match briefing. At 320 px the 12 icon-only buttons occupy two rows of six; measured hit boxes are approximately **39 × 44 CSS px** and the icons are 20 px. Their inactive styling is dim. [Power-up buttons](../src/ui/presets/powerup-summary.ts) have accessible names and attach tooltips, but visible text is not present in the grid.

**Impact:** the grid is compact, but unfamiliar symbols and subdued states require learning or interaction before a player can understand the rules. Small width makes adjacent choices less forgiving. This is a usability observation, not a WCAG failure determination.

**Recommendation:** explore fewer columns or a compact labeled summary with a dedicated editor; retain visible selected state and names without requiring hover. Verify touch access to the existing tooltip and the consequences of a tap, as it also changes a selection. Keep an efficient path for experienced players.

### 8. Room controls need a targeted touch-size review — medium, partly measured

**Where:** the room card and roster. Before the concurrent mobile style update, the captured room symbol and copy/share controls measured 34 × 34 CSS px; the latest mobile rules now specify 44 px for those controls, so **do not report those earlier dimensions as current**. The refreshed room shows the larger actions wrapping at 320 px. Other roster move/remove rules in [room.css](../src/ui/menu/menu-page/room.css) still specify 26 px in some states; the default one-player host capture does not establish their final computed hit areas for a CPU or multi-player roster.

**Impact:** compact controls can be difficult to operate, especially when close together. A purely CSS rule is insufficient to establish a defect without checking the rendered hit box and any surrounding interaction target.

**Recommendation:** measure and test CPU removal, moving, invite/share, privacy and chat in actual populated room states at 320 and 390 px, including short landscape. Aim for comfortable targets while preserving the useful larger room controls; avoid shrinking actions just to keep all room content above the fold.

### 9. Secondary teaching and control text gets very small — medium, observed / code-backed

**Where:** training preview labels, selection cards, online room/crew metadata and some result-related labels. [Training styles](../src/ui/menu/menu-page/frame.css) specify 9–11 px in several places; [mobile room styles](../src/ui/menu/menu-page/mobile.css) use 11 px for some choice labels and start guidance. The regular settings controls are notably more readable than some of these denser surfaces.

**Impact:** the display type gives personality, but small utility text and muted labels can be difficult to scan on a physical phone. A 9 px decorative eyebrow is not equivalent to 9 px instructional or state information.

**Recommendation:** prioritize readable body and functional labels, use stencil type for short titles, and remove low-value metadata before reducing text size. Measure actual contrast and real-device readability, including active/inactive states; no contrast pass/fail is asserted from screenshots alone.

### 10. Fixed action areas and forms need keyboard and short-screen validation — medium, risk to verify

**Where:** the shared [menu page frame](../src/ui/menu/menu-page/frame.css), online profile, room name/password, room code and custom rule name. The shared footer stays anchored while content scrolls; several screens contain text fields. The app sets `viewport-fit=cover` in [index.html](../index.html), but emulation screenshots without an actual software keyboard do not demonstrate what happens when the visual viewport shrinks.

**Impact:** a real keyboard or browser toolbar could obscure the active field, its error, or the action needed to finish. This has **not** been reproduced in this audit.

**Recommendation:** test focus, typing, validation, save/join, keyboard dismissal and rotation on current iOS Safari and Android Chrome; check a short phone and an enlarged text setting. Keep focused fields and their errors reachable, and do not assume CSS layout viewport dimensions equal the visible keyboard-free area.

## Comparison and design direction

Lichess's mobile web home and Chess.com's public play area prioritize a plainly named next action and make secondary choices distinguishable without requiring the user to decode a dense control surface. Slingshot's launcher already approaches that clarity. Its next opportunity is to bring the same prioritization into room discovery and hosting, while retaining its own game identity rather than adopting either product's palette or chess-specific layout. See [the research note](mobile-ux-research.md) for the exact pages inspected, primary guidance and caveats.

A sensible sequence for a future implementation is: **(1)** resolve the online tab gesture conflict, **(2)** rethink room list and waiting-room hierarchy together, **(3)** make flight training explain touch, **(4)** improve code entry and dense rule controls, then **(5)** refine typography and validate on real devices. Treat the order as a proposed discussion, not authorization to implement. Keep the previously requested removal of vertical scroll hints.
