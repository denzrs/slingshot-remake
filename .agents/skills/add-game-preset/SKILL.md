---
name: add-game-preset
description: Implement a Slingshot match preset idea across its chosen game mode or modes, including rules, localization, and card art. Use for preset bundles; a genuinely new game mechanic also needs its own implementation.
---

# Add Game Preset

Turn the idea into a playable, easy-to-find preset. Keep the work focused on the mode or modes the user names; if no mode is named and the rules clearly fit only one, choose that mode. Ask only when a missing gameplay choice would materially change the preset.

## Regular presets

- Keep three independent preset groups in `src/ui/presets/match-presets.ts`: `classic`, `solar`, and `horizon`. Do not make Solar System inherit Classic's list. Similar entries may begin with the same rules, but each group can evolve separately.
- Add the preset ID and rule factory only to the intended group or groups. Apply and identify presets with the active mode (`presetsForMode`, `presetRules`, and `matchingPreset`) so the same ID can have different rules in different modes.
- A preset combines existing `RoomRules`. For a genuinely new rule or mechanic, trace its implementation through `src/net/net.ts`, `src/ui/menu/rules.ts`, and the relevant game code before treating the preset as complete.
- Add `preset.<id>` and `preset.<id>.hint` in both English and German in `src/platform/i18n.ts`. Add or adapt its card illustration in `src/ui/menu/mode-icons.ts`.
- The regular preset list feeds both local match setup and online room creation. Confirm the intended modes show the card and applying it sets the authored rules in both flows.

## Today's Pick

Extend the handpicked rotation only when the user wants the preset featured as “Today’s pick.” Update `HandpickedId`, `handpickedPresets` and its mode-specific rules in `src/ui/presets/match-presets.ts`, the card scene in `src/ui/presets/pick-of-day.ts`, and the corresponding English and German `preset.pick.*` strings in `src/platform/i18n.ts`.
