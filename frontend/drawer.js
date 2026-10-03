/**
 * frontend/drawer.js - the two rails, as drawers, on a phone.
 *
 * A workbench is three things side by side: what you set up, what you watch, and
 * what it says. Three columns is the right shape for that on a desk and the wrong
 * shape on a phone, where the only thing worth the whole screen is the stage -
 * the scene, or the box of gas, or the rig.
 *
 * So below the phone breakpoint the two rails step out of the column and become
 * drawers over the stage, and the stage has the screen to itself. What is left of
 * them on the stage is a tab at each edge: the handle of a drawer, which is what
 * a tab on the edge of a picture has always meant. A tab opens its own drawer,
 * the other tab swaps to the other one, and the stage behind the drawer closes
 * it - so the whole thing is one tap in and one tap out, and the scene never
 * moves while it happens.
 *
 * Nothing here decides *when* the drawers exist: that is the breakpoint in
 * style.css, and this module's only job is the three things CSS cannot do - the
 * scrim, the tabs, and the state they share. It is deliberately inert on a wide
 * screen, where the rails are columns again and the tabs are gone.
 */

const DRAWER_QUERY = "(max-width: 640px)";

/* The tab: a drawer handle on the edge of the stage, with the name of what is
   behind it written down its length the way the spine of a book is. */
function makeTab({ side, label, controls, mountIcon }) {
  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = `stage-peek peek-${side}`;
  tab.setAttribute("aria-controls", controls);
  tab.setAttribute("aria-expanded", "false");
  tab.setAttribute("aria-label", `Show the ${label}`);
  const glyph = document.createElement("span");
  glyph.className = "stage-peek-glyph";
  const text = document.createElement("span");
  text.className = "stage-peek-label";
  text.textContent = label;
  tab.append(glyph, text);
  /* The chevron points the way the drawer moves, which is inward: the handle is
     pulled towards the middle of the stage. */
  if (mountIcon) mountIcon(glyph, side === "left" ? "ChevronRight" : "ChevronLeft", { width: 13, height: 13 });
  return tab;
}

/**
 * Wire the drawers for one workbench shell.
 *
 * @param {HTMLElement} shell the `.app-shell` this bench lives in
 * @param {{left:HTMLElement, right:HTMLElement, labels?:{left?:string,right?:string},
 *          mountIcon?:(el:HTMLElement, name:string, attrs?:object)=>void}} options
 * @returns {{close: () => void, open: (side:string) => void}} the same handles
 *          the tabs use, for anything that wants to open a drawer itself
 */
export function mountStageDrawers(shell, { left, right, labels = {}, mountIcon = null } = {}) {
  const stage = shell?.querySelector(".console");
  if (!stage || !left || !right) return { close() {}, open() {} };

  const sides = {
    left: { rail: left, label: labels.left ?? "Controls" },
    right: { rail: right, label: labels.right ?? "Readouts" },
  };

  /* The scrim is what makes the stage behind a drawer a *thing you press to put
     the drawer away*, rather than a stage you cannot reach. It is a plain div
     with no role of its own because it is not content: it is the stage, dimmed,
     and every press on it means the same single thing. */
  const scrim = document.createElement("div");
  scrim.className = "drawer-scrim";
  scrim.setAttribute("aria-hidden", "true");

  const tabs = {
    left: makeTab({ side: "left", label: sides.left.label, controls: left.id, mountIcon }),
    right: makeTab({ side: "right", label: sides.right.label, controls: right.id, mountIcon }),
  };

  stage.append(scrim, tabs.left, tabs.right);

  let open = null;

  function set(next) {
    if (open === next) return;
    /* One drawer at a time, and the tabs say so: a tab is a press away from its
       own drawer whether or not one is already out, so the one being looked at
       reports itself expanded and the other does not. */
    open = next;
    for (const [side, { rail }] of Object.entries(sides)) {
      const isOpen = side === open;
      rail.classList.toggle("is-open", isOpen);
      tabs[side].classList.toggle("is-open", isOpen);
      tabs[side].setAttribute("aria-expanded", String(isOpen));
      tabs[side].setAttribute("aria-label", isOpen ? `Hide the ${sides[side].label}` : `Show the ${sides[side].label}`);
    }
    stage.classList.toggle("drawer-open", open !== null);
  }

  for (const side of ["left", "right"]) {
    tabs[side].addEventListener("click", () => set(open === side ? null : side));
  }
  scrim.addEventListener("pointerdown", () => set(null));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && open !== null) set(null);
  });

  /* A wide screen puts the rails back in the column, where a leftover `is-open`
     would be a rail translated off the side of a layout that has no drawers -
     so leaving the breakpoint, in either direction, closes whatever was out. */
  const query = typeof matchMedia === "function" ? matchMedia(DRAWER_QUERY) : null;
  const onChange = () => set(null);
  if (query?.addEventListener) query.addEventListener("change", onChange);
  else if (query?.addListener) query.addListener(onChange);

  return {
    open: (side) => set(side === "left" || side === "right" ? side : null),
    close: () => set(null),
  };
}
