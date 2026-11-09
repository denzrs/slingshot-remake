/**
 * Which row of a page to put the focus back on when the page is returned to.
 *
 * `focused` is the row that has the focus; `pressed` the last row a finger or the mouse went down on, on the same page. A
 * tapped button does not take the focus in Safari, so on an iPhone `focused` is -1 although the player has just used a row:
 * the row they pressed is then the one to come back to. Where neither is known (-1), nothing is chosen, and the page opens
 * with no row picked out, not the first one: that row would show as selected for no reason the player can see.
 */
export function rowToRemember(focused: number, pressed: number): number {
  return focused >= 0 ? focused : pressed;
}
