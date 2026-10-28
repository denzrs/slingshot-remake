import { describe, expect, it } from 'vitest';
import { PICKER_ORDER, PREVIEW_ABOUT, PREVIEW_OF_KIND } from '../../src/debug/previewPicker';
import { createSuddenDeathPreview, SUDDEN_DEATH_PREVIEWS } from '../../src/debug/suddenDeathDemo';
import { SUDDEN_DEATH_KINDS } from '../../src/sim/config';

describe('the sudden death preview picker', () => {
  it('lists a preview for every kind of sudden death, once each, in the order the kinds come', () => {
    expect(PICKER_ORDER).toHaveLength(SUDDEN_DEATH_KINDS.length);
    expect(new Set(PICKER_ORDER).size).toBe(SUDDEN_DEATH_KINDS.length);
    expect(PICKER_ORDER).toEqual(SUDDEN_DEATH_KINDS.map((kind) => PREVIEW_OF_KIND[kind]));
  });

  it('only lists previews that exist, and describes each', () => {
    for (const name of PICKER_ORDER) {
      expect(SUDDEN_DEATH_PREVIEWS).toContain(name);
      expect(PREVIEW_ABOUT[name].name.length).toBeGreaterThan(0);
      expect(PREVIEW_ABOUT[name].text.length).toBeGreaterThan(0);
      const demo = createSuddenDeathPreview(name);
      expect(demo).not.toBeNull();
      demo!.match.dispose();
    }
  });

  it('names every preview a demo can play', () => {
    expect([...PICKER_ORDER].sort()).toEqual([...SUDDEN_DEATH_PREVIEWS].sort());
  });
});
