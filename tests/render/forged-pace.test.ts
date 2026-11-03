import { afterEach, describe, expect, it } from 'vitest';
import { setPostLevel } from '../../src/data/look';
import { paceOf } from '../../src/render/looks/forged-sky';

const canvas = () => ({}) as HTMLCanvasElement;

afterEach(() => setPostLevel('high'));

describe('forged post pass pace', () => {
  it('starts at the lean the post level asks for', () => {
    setPostLevel('low');
    expect(paceOf(canvas())).toMatchObject({ lean: 2, floor: 2 });
  });

  it('keeps what it learnt while the setting stays', () => {
    const c = canvas();
    setPostLevel('medium');
    paceOf(c).lean = 2;
    expect(paceOf(c)).toMatchObject({ lean: 2, floor: 1 });
  });

  it('starts over from the new level when the setting changes, up or down', () => {
    const c = canvas();
    setPostLevel('medium');
    paceOf(c).lean = 2;
    setPostLevel('high');
    expect(paceOf(c)).toMatchObject({ lean: 0, floor: 0 });
    setPostLevel('off');
    expect(paceOf(c)).toMatchObject({ lean: 3, floor: 3 });
  });

  it('judges each canvas on its own', () => {
    setPostLevel('high');
    const a = canvas();
    paceOf(a).lean = 1;
    expect(paceOf(canvas()).lean).toBe(0);
  });
});
