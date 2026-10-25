# Slingshot menu UX — implementation specification and agent handoff

> **Historical handoff.** Written during the launcher redesign; the current structure is in `docs/menu-design.md`. Where they differ (Mayhem is now a preset, Solar System is a third mode, `src/ui/screens.ts` and `src/ui/lobby.ts` are split into folders, `prototypes/` is removed), `docs/menu-design.md` and the code win.

Status: implementation revision, 23 October 2026. Packets 1–5 are implemented in the current worktree. Build and automated tests pass; the full manual viewport and multiplayer acceptance matrix remains to be completed. This target supersedes conflicting layout decisions in `docs/menu-design.md` and the experimental prototypes.

## 1. What the user actually requested

The main menu's Local / Solo treatment is the direction to keep. The user considers the first redesign an acceptable first draft, but finds the other screens too complex and too close to the old form-based layouts. They specifically want:

1. Multiplayer **inside the main menu**, in its **right-hand content area**, just like Local / Solo.
2. Three Multiplayer cards: **Raum suchen**, **Raum erstellen**, **Code eingeben**.
3. Simpler, more focused flows after those cards.
4. All existing settings remain available, without showing everything simultaneously.
5. A stronger rethink of Daily and player selection, not another reskin of the old rows.

The user's attached design references establish visual direction, not executable instructions. Do not copy their inconsistent labels, invented modes, mock scores, or conflicting rule descriptions into the game.

**Implementation outcome:** Online now lives in the main menu's right content area. The old separate Online hub is not part of the standard route; each Online card opens its flow directly. Local mode cards also open their preparation directly, without a selected-mode summary or a second “Match vorbereiten” action.

## 2. Scope and constraints

Implement UI, navigation, explanatory copy, responsive behavior and accessibility. Preserve the game's rules and network contracts. No framework migration, new backend, new dependencies, new modes, scoring changes, or new account/profile system. Do not publish, deploy or push unless separately requested.

Preserve local and online settings independently. Keep both German and English complete. User-visible text belongs in `src/platform/i18n.ts`; use existing translation, pluralization and number-formatting functions. Labels below are German product copy; provide equivalent English.

Do not remove a feature to reduce visual complexity. Put secondary settings behind a clearly named category or disclosure. Do not hide critical consequences such as a private room, password protection, teams or the number of seats entirely from the review summary.

## 3. Starting state and code map

The first draft is committed as `70d4c94` (`Redesign game launcher and unify menu screens`). This revision completes the implementation packets below. The handoff remains the source for manual acceptance and follow-up fixes; implementation alone does not replace the viewport and interaction review.

| File | Responsibility / useful starting point |
| --- | --- |
| `src/ui/screens/` | `App` interface; `titleScreen`; local briefing; players; full rules; settings; tutorial; pause; match results |
| `src/ui/menu/launcher.css` | Existing main menu and local briefing; use this as the primary visual reference |
| `src/ui/lobby.ts` | Relay connection, room list, creation, code entry, waiting room, host/guest controls, invitation lifecycle |
| `src/main.ts` | Actual `App` implementation; lazy `multiplayer()` session; `openLobby`, `toLobby`, `toTitle`; invite startup and online match callbacks |
| `src/ui/menu/menu.ts` | Screen stack, menu item placement, focus, directional keyboard navigation, persistent selection |
| `src/ui/menu/controls.ts` | Sliders, toggles, segmented controls, tiles; second-draft `seatControl` uses compact ship cards |
| `src/ui/menu/menu-page.ts` | Shared page frame and footer. Reuse where appropriate; it is not a requirement to make every screen look like the same form |
| `src/ui/menu/menu-page.css` | Shared page styling plus second-draft Multiplayer, crew, Daily and category styles |
| `src/ui/flight-card.ts` | Native action card with illustration, title, hint and arrow |
| `src/ui/menu/mode-icons.ts` | Repo-native SVG art: modes, Daily, find/create/code; `pilotArt()` for crew |
| `src/ui/presets/match-presets.ts` | Four real rule presets and detection of custom rules |
| `src/ui/menu/rules.ts` | Authoritative UI rule inventory, groups, valid values and conditional visibility |
| `src/data/settings.ts` | Local seats, teams and device preferences; add/remove/balance/validation helpers |
| `src/data/lobbyPrefs.ts` | Separate online preferences, defaults, local storage, Mayhem rule normalization |
| `src/ui/daily/daily.ts` | Daily briefing, result, copy/share text; current implementation has a selectable route |
| `src/ui/daily/leaderboard.ts` | Explicit read/post flows and feature availability |
| `src/net/invite.ts`, `src/net/multiplayer.ts` | Preserve tested invite and session semantics |
| `src/ui/room/roomLook.ts` | Existing room visibility, symbol and color pickers / dialog |

Second draft already contains reusable pieces:

- A separate Online hub with three illustrated cards and expandable pilot/connection settings.
- A room creation page with mode cards, four presets, collapsed room options and category-based detailed rules.
- Separate code entry and room browsing views.
- Compact crew cards: Human / CPU; difficulty appears only for CPU; team select when applicable.
- Daily route selection and sector result cards.
- Category navigation for device preferences and local full rules.

Reuse and refine these pieces. Do not retain the separate Online hub merely because it already exists. Do not start a second duplicate card system.

## 4. Design contract

### Visual vocabulary

| Role | Token / treatment |
| --- | --- |
| Background | Deep navy `#081426`, `#0b1a33`, `#071122` |
| Main text | Warm white `#e8e4d8` |
| Secondary text | `#9aa6bd`, with sufficient contrast at small sizes |
| Main action / selected choice | Orange `#ffad65` |
| Values / secondary links | Mint `#6fe3c8` |
| Display | Big Shoulders Stencil Display 800, for the brand and short headings |
| Body / labels | B612 400 / 700 |
| Numeric utility | B612 Mono |
| Distinctive imagery | Restrained orbital diagrams and the game's ships, rendered as SVG |

Match the approved launcher's spacing, palette and card treatment. Avoid oversized headings crowding out controls, neon around every element, deeply nested bordered panels, and all-caps stencil text for long explanations. Cards express a destination or a substantial choice, not every individual switch.

A selected card has orange emphasis **and** a non-color signal such as a check. Keyboard focus uses a clear light outline, independent of selection. Hover must not select or activate a card. Motion is subtle and disabled under `prefers-reduced-motion`.

### Density and hierarchy

Each screen must answer one primary question. Keep one visually dominant next action. Make secondary choices discoverable without displaying their entire control set. Use short descriptions that explain consequences. No technical relay terminology in the normal hosted path.

## 5. Main menu: Local and Online share one shell

### Required desktop layout

```text
SLINGSHOT                                           Short game description

LOCAL / SOLO      [ Classic ] [ Event Horizon ] [ Mayhem ]
                  Daily challenge row
ONLINE            OR, when Online is selected:
                  [ Find a room ] [ Create a room ] [ Enter a code ]
HOW TO PLAY
SETTINGS          The shell, padding and rail stay in place

Keyboard help                         Language                      Version
```

- Preserve the wordmark/header, left navigation and bottom language/version area while switching Local / Solo ↔ Online.
- Replace **only the right content area**. The transition must not create a second Online page with another large heading and Back button.
- Preserve edited local rules and crew when switching sections.
- Local has three mode cards and the Daily entry. Clicking a mode card opens its briefing directly; the separate selected-mode summary and **Prepare match** launcher row are removed.
- Online has exactly the three destination cards below. Do not also render local Daily, local presets or the removed launcher action in this state.
- Cards are immediate actions. Online does not need an extra Confirm/Continue button.
- The left navigation's selected state reflects the active section. It must not always mark Local as selected.
- Language switching preserves the active section and meaningful focus. The main menu keeps its established outer padding in both sections; align Online card sizing and spacing so switching sections does not shift the shell.
- Keep the footer at the same vertical position while Local and Online are both short enough to fit the viewport. Let the center content absorb the available height; the section change must not pull the footer upward.

### Online cards

| Title | Short explanation | Action |
| --- | --- | --- |
| Raum suchen | Entdecke offene Matches und flieg mit. | Open room browser |
| Raum erstellen | Wähle dein Spiel. Lade deine Freunde ein. | Open creation flow |
| Code eingeben | Schon eine Einladung? Direkt in euren Raum. | Open code entry |

Use the existing `rooms`, `create`, `code` art or improve it in the same SVG vocabulary. A room code is an invitation/access code, not programming syntax.

Connection is not a prerequisite for seeing these cards. Do not display “0 rooms” before a successful room list has arrived. A live count is optional; omit it unless genuinely known.

### Navigation state and integration seam

Track the active launcher section separately from the local game mode. Keep it in UI state, not `Settings` or persisted game rules.

A concrete acceptable integration:

- Add an exported UI entry type such as `LobbyEntry = 'rooms' | 'create' | 'code'`.
- Allow `App.openLobby(entry?: LobbyEntry)` and `lobbyScreen(app, session, entry?)` to open the requested child directly.
- The main menu's Online navigation item changes the launcher section. It must no longer call `app.openLobby()` itself.
- Its three right-side cards call `app.openLobby('rooms' | 'create' | 'code')`.
- Remove or repurpose `homeView` in `lobby.ts`; do not leave a duplicate Online hub in the normal route.
- Returning from an Online child restores the main menu with **Online** selected and useful focus on the originating card.
- Audit **all** `lobbyScreen` callers in `main.ts`, including `matchEnded`, `toLobby` and invite startup. An existing room always takes precedence over a requested child view.

Do not unconditionally use `menu.push` for a network view without checking the existing lifecycle: the session subscription currently unsubscribes when its root is detached. It must resubscribe on remount and must not leak listeners across rebuilds. `App.toTitle()` currently disconnects and disposes a match; do not accidentally invoke it during a mere Local/Online section switch.

### Keyboard and mobile

- Tab order follows visual reading order. Enter activates the focused destination.
- Existing ↑/↓ menu navigation remains functional; horizontal cards support ←/→.
- Selecting Online by keyboard leaves a clear focus path into its cards. Merely focusing the rail item does not activate it.
- Escape from an Online child returns to main-menu Online. Escape on main-menu Online can return to Local; it must not create another full-page hub.
- At ≤520 px the rail becomes the existing compact navigation area and the three cards become vertical illustrated rows. Do not squeeze three desktop cards into unreadable columns.
- No horizontal page overflow at 320 px. Preserve accessible touch targets and the language selector.

## 6. Multiplayer child flows

### A. Find a room

Primary question: “Which room do I want to join?”

Show a compact page title and a scannable room list. Each room exposes its real name, mode, host, occupied/maximum seats, lock state and playing/waiting state. Join is the primary action for a waiting room; Watch is available according to the existing rules. A full room can still accept a human if an eligible CPU gives up its seat; preserve this behavior.

- Separate loading, error and genuinely empty states.
- Empty: explain that no rooms are open, and offer **Raum erstellen** plus the route back to Online.
- Do not combine this list with the entire code entry form or all creation fields.
- Ask for a password only for a locked room. Do not erase a partially typed password when room-list updates arrive.
- Keep spectating and spectator capacity behavior. Do not invent filtering, matchmaking or friend availability.

### B. Create a room

Primary question: “What do we want to play?”

Show the same three real game-mode cards as the local launcher: Classic, Event Horizon, Mayhem. Then show a concise rule-preset choice for normal modes. Mayhem shows its real, short set of setup controls instead of inappropriate normal presets.

```text
CREATE A ROOM
[ Classic ] [ Event Horizon ] [ Mayhem ]
[ Standard ] [ Trickshot ] [ Sniper ] [ Party ]
Rules: selected preset / Custom rules             Adjust rules
Room: 4 seats · Public · Free for all              Room options
← Online play                                      Create room →
```

- Basic creation with remembered/default preferences must not require opening advanced settings.
- Show a readable recap of capacity, visibility, team mode and password protection before creation. Room name may use the real server/default name when not explicitly entered; do not show invented final names.
- **Room options** exposes name, capacity 2–6, FFA/teams, public/private, optional password, symbol and color. Preserve all existing controls.
- **Adjust rules** exposes every rule in `rulesFor(mode, true, mayhem)`, one named category at a time.
- Applying a preset replaces gameplay rules intentionally. Preserve online-only choices `betting` and `chatPlayersOnly`, the room's appearance, capacity, pilot and team/FFA setting.
- The preset label is derived from actual values. Manual deviations become “Eigene Regeln”; reverting to a preset's effective values restores its label. Preserve conditional/inactive-rule handling from `matchingPreset`.
- Switching mode changes the applicable rules without corrupting remembered choices. Mayhem remains distinct from Party.
- Use one dominant **Raum erstellen** action. Keep it reachable on small screens without covering focused inputs or most of the content.
- Do not start an online game as a side effect of creating a room. Creation opens the waiting room.

### C. Enter a code

Primary question: “What code did my friend send?”

Show one clearly labelled code input, optional password disclosure and a primary **Raum beitreten** button. Watch is secondary. Back returns to main-menu Online. Do not repeat the server, full profile picker or room list around this form.

Preserve case: current real room codes can include mixed case, `_` and `-`. Trimming outer whitespace is fine; do **not** uppercase the actual submitted code unless the server contract explicitly guarantees case-insensitivity. Pasting and Enter submit must work. Show field-relevant errors without discarding the code or password. Do not include a real password in general status text.

### D. Waiting room

Primary question: “Who is here, and are we ready?”

Prioritize the real room name, mode, invitation/code, crew and readiness. Put pilot renaming/avatar, appearance, full rules and other administration behind clearly named secondary controls.

- Host: **Spiel starten** is the primary game action. Do not present both Ready and Start as competing host actions; the existing start contract already treats the host click as ready.
- Guest: Ready / Cancel ready. Spectator: watching context, no player-only actions.
- Leave is secondary, distinct from game start.
- Explain a disabled Start using the existing actual condition: another human is needed, guests are not ready, or teams are empty. Do not allow an online match consisting of host + CPUs only.
- Preserve CPU add/remove/level/team controls, real seat limits, team balance, rename/name validation, avatar selection, copy invite/code/password rules, room appearance and chat.
- Guests can inspect the actual rules but cannot edit host-only values.
- Editing rules still resets readiness and preserves the existing debounced update behavior. Do not rebuild a dragged control on every server update.
- Never make the gameplay chat overlap a primary action or a field on small screens.

### Connection and invitations

The standard configured secure relay connects in the background when needed. Local/self-hosted server configuration is secondary. A failed connection reveals a clear retry path with the selected child destination preserved.

Preserve the tested invitation behavior in `src/net/invite.ts`: direct links can join the target room, password fragments are removed from history promptly, invitation attempts are consumed correctly, and a different relay requires the existing explicit confirmation interaction. No silent connection to an unrelated invitation relay. No new login step.

## 7. Crew selection: choose pilots, not a matrix of options

Primary question: “Who is flying?”

Use a compact squadron of ship cards. The second-draft `seatControl` is a starting point, not accepted final layout.

Each active card has:

- Ship illustration and stable player number/color.
- Two obvious choices: **Mensch** / **CPU**.
- A labelled CPU difficulty select **only when CPU is selected**; keep all four real levels.
- A team select only in team mode.
- A clearly labelled remove control, disabled at the two-seat minimum.

Use a single add-pilot card while fewer than six seats are active. It adds a Human by default; the new card immediately exposes Human/CPU selection. Focus moves to the added card. No hidden click sequence or cycling through CPU levels to find Human.

Three active cards per row on large desktops, two on typical narrow layouts; if 320 px makes two cards unusable, use one column. Choose based on an actual screenshot, not a theoretical breakpoint. Keep Done reachable with a small footer. Do not pin a large block of add/balance actions over the crew.

Team mode remains a distinct, short choice above the squadron. Preserve FFA, two teams, three teams, team counts, invalid-team warnings and Balance teams. Use the helpers in `settings.ts`. Do not silently change team assignments, renumber remaining players or change ship colors when removing a seat. Two local humans share a device; do not imply online players or individual controllers.

Done returns to the originating local/Mayhem briefing with its rules unchanged. Changing crew does not apply a gameplay preset. Remember a card's last CPU level when switching Human ↔ CPU within the current edit.

## 8. Daily: a mission and a route, not a settings table

### Briefing

Primary question: “What is today's mission, and do I want to fly it?”

- Lead with actual Daily number, date, localized theme and short theme description.
- Show a connected sequence of the **five real sectors**. This sequence is meaningful, so sector numbering is appropriate.
- Selecting a sector shows its actual targets, shot budget, difficulty and modifiers in one detail area. This is a preview, not a control that skips directly to that sector.
- Keep best score, attempts, streak and next reset secondary but readable. Use actual `dailyStore` data, including no-run-yet and historical-day cases.
- Explain the scoring/mission rules through a concise disclosure. Make it clear that sector rules are fixed and normal match settings do not apply.
- One primary **Herausforderung starten** action starts the existing complete run. Back and optional leaderboard are secondary.
- At 320 px keep all five route nodes identifiable. Move longer details to the selected-sector area rather than hiding the information entirely.

The current implementation has a selectable route and actual Daily data. Visual, narrow-viewport and keyboard acceptance still need to cover the full matrix below.

### Result

Use a distinct scorecard: actual score/rank first, five sector outcomes next, personal record context afterward. Preserve per-shot hit/trick/miss/self evidence, unused shot budget, failure status, negative scores and the legend. Avoid a second column that merely repeats the same score.

One primary **Erneut versuchen** action belongs at the final/right position in the desktop action row. Copy result, Main menu and optional leaderboard submission are secondary. Retry is the final action in the current implementation.

Keep `shareText()` semantics and real data. Copy is a clipboard action, never automatic publishing. Leaderboard browsing must not submit a run; submission remains explicitly initiated and named. Preserve availability gating from `leaderboardAvailable()`.

## 9. Preferences, full rules and other screens

### Device preferences

One category at a time, with a compact visible category navigator:

| Category | Existing settings |
| --- | --- |
| Darstellung | Gravitational contours, particles, animated menu background |
| Ton & Bildschirm | Sound, fullscreen |
| Sprache | German / English, names recognizable in either language |
| Touch controls | Stick side; only on coarse-pointer devices |

Apply settings according to current behavior. Use **Fertig** to return, not a misleading Save if changes are already immediate. Language changes preserve the selected category, section and meaningful focus. Do not move game rules into device preferences.

### Complete match rules

Use the real `RULE_GROUPS` / `ruleItems` inventory: Match, Field, Shots, Extras. Show a category navigator and only that category's controls. Preserve every conditional control, inactive/reserved state, valid slider stop, reset behavior and value. Keep Done as the primary way back to the briefing.

### Tutorial, pause and match end

Keep them consistent, but do not use them as a reason to delay the main navigation work. Tutorial retains direct chapter selection, Previous/Next and existing diagrams. Pause retains Resume and applicable game actions. Match results retain standings, history, awards and spectator/oracle records. Do not change score calculation or remove records for visual simplicity.

## 10. Functional invariants / regression traps

1. `App.toTitle()` currently disconnects and disposes. A main-menu tab switch must not call it.
2. `openLobby()` currently replaces the menu stack. Back/focus restoration must be designed explicitly.
3. `Menu.focusables` tracks menu rows, not arbitrary descendants. Closed disclosures/hidden categories must not be visited by directional navigation.
4. Action items currently lack a general `hidden` predicate. Add explicit supported behavior if needed, rather than rendering stale Local actions in Online or relying on CSS alone.
5. A category's original `hidden` / `reserve` predicates must be combined with category visibility, not overwritten. Native selects/inputs need their own keys; do not swallow their arrows or Enter.
6. Re-rendering a lobby on each network update must not erase partial name/password edits or close open dialogs unnecessarily.
7. A rejected name may now live inside collapsed pilot settings. Open the relevant disclosure/view **before focusing** its field. Audit both `name-required` invite handling and `session.nameNotice` errors.
8. Current code entry has visual uppercase styling; actual room IDs must retain their original case. Check that typography does not mislead someone reading a code aloud.
9. Subscription cleanup, draft rule debounce timers and look-dialog lifecycle must remain correct across leaving/reentering screens.
10. CSS has older base rules in `style.css` and the first-draft `menu-page.css`. Remove superseded selectors as each component is finalized; do not stack endless overrides. Leave unrelated game styles intact.
11. The optional leaderboard depends on `VITE_MULTIPLAYER_SERVER`; local default UI may correctly omit it.
12. Normal mode presets must not carry Mayhem state into a normal match. Party and Mayhem are different experiences.

## 11. Implementation packets and acceptance criteria

These packets were implemented in order in the current worktree. Their acceptance criteria remain the checklist for follow-up review. Avoid parallel edits to `screens.ts`, `lobby.ts` or common CSS without explicit coordination. A passing build is not evidence of visual or multiplayer acceptance.

### Packet 1 — integrate Online in the main launcher (highest priority)

**Files:** `screens.ts`, `main.ts`, `lobby.ts`, `menu.ts`, `launcher.css`, `i18n.ts` as needed.

Implement section state, right-side Online cards, direct child entry and return/focus semantics from §5. Eliminate the standalone Online hub in the normal flow. Preserve invite startup and existing-room priority.

**Accept when:** switching Local/Online retains the shell, footer position and edited local rules/crew; local mode cards open their briefing directly; each Online card opens its specific child without another hub click; Back/Esc restores Online and focus; language rebuild preserves active section; hidden local actions cannot receive focus; invitations still work.

### Packet 2 — streamline online children and waiting room

**Files:** `lobby.ts`, `flight-card.ts`, relevant CSS and translations.

Finish §6. Keep default creation short, reveal all secondary options, add real recap and precise disabled-start guidance. Correct collapsed-profile validation. Make server failures recoverable without losing the destination. Simplify competing host Ready/Start actions.

**Accept when:** two local clients can create/join by list/code/invitation, ready/start, change rules, leave, and reconnect; host/guest/spectator permissions remain correct; local CPU-only constraints remain enforced; mobile forms and chat do not overlap.

### Packet 3 — finish crew interaction and layout

**Files:** `controls.ts`, `screens.ts`, crew CSS, translations.

Finish §7. Check CPU type/level/team selects with mouse, keyboard and touch, add/remove/focus, two/six pilots and invalid teams. Refine layout beyond the draft if it still feels like a compressed old form.

**Accept when:** a new user can set “one Human versus one CPU, Newton” directly; add to six and remove back to two; keep colors/IDs; balance teams; return to setup with all edits intact. No overflow at 320 px.

### Packet 4 — finish Daily briefing/results

**Files:** `daily.ts`, `leaderboard.ts` only if needed, related CSS and translations.

Finish §8 using actual challenge/store data. Fix result action order. Test first attempt, existing record, historical date, successful/failed sectors and optional board availability. Improve the visual route until its selected detail and “start the whole mission” behavior are clear.

**Accept when:** every sector's real details are accessible; Start always begins sector 1 of the run; results/share text remain accurate; board view doesn't post; all actions fit on mobile.

### Packet 5 — consistency, accessibility and cleanup

**Files:** category preferences/rules, tutorial/pause/results only as needed, CSS, documentation.

Verify §9–10 and the matrix below. Consolidate obsolete CSS, remove unused draft strings/helpers, update `docs/menu-design.md` and relevant `docs/game.md` flow descriptions. Keep original reference prototypes intact.

**Accept when:** all required options remain reachable, English/German layouts work, reduced motion and keyboard paths work, build/tests pass, screenshots of real screens are supplied. Record any remaining issues plainly.

## 12. Verification matrix and completion evidence

Automated baseline:

```sh
npm run typecheck
npm run build
npm test
```

`npm test` builds the Rust relay in `pretest` and needs permission to open local test sockets. Tests are valuable for behavior, but they do not establish visual quality. Add tests only for new navigation/state behavior or actual regressions; do not mirror styling implementation.

For manual online QA, start the **current** Rust binary after building it. A stale running binary initially rejected the current rules as “Malformed game rules”; restarting the newly built binary resolved it and actual room creation then succeeded. Do not “fix” a protocol payload based only on this stale-binary symptom.

```sh
npm run dev -- --host 127.0.0.1
DEV_SERVER=1 LEADERBOARD_DB=/private/tmp/slingshot-menu-review.db server/target/debug/slingshot-server
```

Use an isolated temporary leaderboard DB, local clients and test names. Never submit fixture scores to a production leaderboard. Never stop an unrelated server merely because it occupies the desired port.

| Area | Cases |
| --- | --- |
| Main launcher | Local → Online → Local; all three online cards; Back/Esc; mouse vs keyboard; language rebuild |
| Relay | First visit; remembered server; connecting; refused/unreachable; retry; different-relay invitation |
| Browser | Empty list; waiting/full/locked/running rooms; password preserved during live updates; Watch |
| Creation | All three modes; all four normal presets; manual custom rules; all room options; invalid pilot/room names |
| Waiting room | Host/guest/spectator; another human not ready; two humans ready; CPU controls; empty teams; rule edits |
| Code / invite | Mixed-case code with `_`/`-`; wrong/required password; missing room; direct invitation; secret removed from URL |
| Crew | 2, 3 and 6 seats; Human ↔ CPU; all CPU levels; remove/add; FFA / 2 teams / 3 teams; balance / invalid teams |
| Daily | No run; previous best/streak; every sector selected; historical day; result success/failure/negative values; board on/off |
| Preferences | Each category; language change while in Language; touch category on/off; immediate application and return |
| Full rules | Each category; conditional power controls; power-up kinds independently on/off including none; reset; return without lost edits |
| Other menus | Tutorial chapter jump / next / previous; pause / resume; match-end standings / awards |
| Viewports | 1440×900, 1280×720, 768×1024, 390×844, **320×740**; both languages on the narrowest layout |
| Accessibility | Tab, Shift+Tab, arrows, Enter/Space, Esc; visible focus vs selection; correct button/select labels; reduced motion |

The optional local harness `prototypes/menu-check.html` previews match results, Daily results, pause and the leaderboard. It labels its fixture data, does not persist fake scores, and is outside the production Vite entry. Keep the pre-existing `prototypes/menu-redesign/` reference files intact.

Provide real browser screenshots of main-menu Online, creation, crew and Daily at desktop and narrow widths. A synthetic fixture preview must be visibly labelled test data. Check clipping, overlapping sticky actions, hidden keyboard targets, overly small text and long English/German labels. Do not accept a layout solely from an AX tree or a passing build.

### Aktueller Umsetzungs- und Prüfstatus

- The menu implementation covers packets 1–5: integrated Local/Online launcher, direct mode and Online navigation, streamlined room flows, crew controls, Daily route/results, category-based preferences/rules, translation updates and cleanup.
- Current automated verification: `npm run build` passed; `npm test` passed all 600 tests in 33 files. The test command's Rust prebuild also passed. A sandboxed test attempt first failed because local test sockets were denied; the same command passed with local socket access.
- Browser review before the final footer adjustment confirmed the shared title, rail, card structure and removal of the local “Match vorbereiten” strip. The final footer alignment change fills the shell and measures the taller Local/Online content area at the current width; the native browser changed to the separate menu-check prototype during review, and the in-app browser mapped localhost to another app, so the post-change screenshot could not be captured.
- **Manual acceptance remains open:** create/join/guest/invite/reconnect against two local clients; the complete keyboard/touch paths; all Daily history/result cases; both languages at 320 px; and the full viewport matrix. Do not describe these as completed based solely on the build or tests.
- Historical handoff baseline: the second draft had 599 passing tests in 33 files and several room creation checks. Those are baseline evidence only; the current 600-test run is the applicable automated result.

## 13. Copy-ready agent instruction

> Read `docs/menu-ux-spec.md` and the relevant existing source before editing. All five implementation packets are already present in the current worktree. Work on the specific remaining acceptance item requested; treat §1 and §5 as the user's authoritative navigation requirement. Preserve existing behavior and settings. Use the established visual language and helpers, avoid unrelated rewrites, verify the requested acceptance criteria, and report changed files, commands, screenshots and unverified cases. Resolve routine implementation details without asking the user. Do not publish or push anything.
