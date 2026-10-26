from pathlib import Path

p = Path('frontend/workbench.css')
s = p.read_text()

marker = '/* ============================================================================\n   THE HOMEPAGE'
start = s.index(marker)

new = '''/* ============================================================================
   THE HOMEPAGE
   ============================================================================
   The composition is the one the page has always had: a split backdrop with the
   glass channel across its seam, the headline and the one button on the left,
   the note under them, and a picker that lists the benches. What it wears now is
   the workbench's own finish - the same dark bar, the same wordmark and page
   name, the same violet on the single action, the same type scale - so the front
   door and the rooms behind it read as one website.

   Nothing here is a shell: no rails, no stage bar, no readout strip. The
   homepage is a page, and it looks like one.
   ============================================================================ */

.home {
  --home-ink-strong: #1b1a22;
  --home-ink-body: #5d5a6b;
  --home-ink-label: #87839a;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--home-bg-left);
  color: var(--home-ink-strong);
  font-family: var(--font);
}
#home[hidden] { display: none; }
html.route-workbench #home { display: none; }

/* ---- the bar ----------------------------------------------------------- */
.home-wordmark {
  flex: 0 0 auto;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: -0.006em;
  color: var(--chrome-muted);
  white-space: nowrap;
}
.home-wordmark b { font-weight: 700; color: var(--chrome-ink); }

/* The one lamp on the bar: the same violet dot the benches light when they run,
   standing for the benches that are live. A readout, not a button. */
.home-live {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--line-1);
  border-radius: var(--radius-pill);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: -0.002em;
  color: var(--chrome-muted);
  white-space: nowrap;
}
.home-live i {
  flex: 0 0 auto;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 3px rgba(124, 92, 255, 0.16);
}

/* ---- the hero ---------------------------------------------------------- */
.home-hero {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
/* the full-height second panel - its edge always passes through the channel */
.home-hero::before {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: calc((100 - var(--home-split)) * 1vw);
  background: var(--home-bg-right);
}

.home-hero-copy { position: absolute; inset: 0; pointer-events: none; }

/* The headline and the button travel together, so the button sits under the
   type at any size rather than at a height that only suits one of them. */
.home-copy-block {
  position: absolute;
  left: var(--home-gutter);
  top: 23%;
  max-width: min(34vw, 470px);
}
.home-headline {
  margin: 0;
  font-size: clamp(34px, 4.6vw, 78px);
  font-weight: 700;
  line-height: 1.02;
  letter-spacing: -0.035em;
  color: var(--home-ink-strong);
  white-space: nowrap;
}
.home-headline .accent { color: var(--accent); }

/* The one action on the page, in the one violet every Run button wears. */
.home-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  height: clamp(44px, 3.3vw, 54px);
  margin-top: clamp(20px, 3.4vh, 32px);
  padding: 0 clamp(24px, 1.9vw, 32px) 0 clamp(20px, 1.6vw, 26px);
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-family: var(--font);
  font-size: clamp(13px, 0.95vw, 14.5px);
  font-weight: 600;
  letter-spacing: -0.006em;
  cursor: pointer;
  pointer-events: auto;
  box-shadow:
    0 16px 34px -18px rgba(124, 92, 255, 0.95),
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
  transition: background 0.16s ease, box-shadow 0.16s ease, transform 0.1s ease;
}
.home-cta svg { width: 15px; height: 15px; }
.home-cta:hover {
  background: #6a49ff;
  box-shadow:
    0 18px 38px -18px rgba(124, 92, 255, 1),
    inset 0 1px 0 rgba(255, 255, 255, 0.24);
}
.home-cta:active { transform: translateY(1px); }
.home-cta:focus-visible { outline: 2px solid var(--home-ink-strong); outline-offset: 3px; }

/* The note: the workbench's panel label with its violet tick, then one
   sentence of muted ink. It sits on the bottom-left, as it always has, so the
   middle of the sheet is the channel's. */
.home-foot {
  position: absolute;
  left: var(--home-gutter);
  bottom: clamp(30px, 7vh, 74px);
  max-width: min(38vw, 470px);
}
.home-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--home-ink-label);
}
.home-eyebrow::before {
  content: "";
  flex: 0 0 auto;
  width: 2px;
  height: 10px;
  border-radius: 1px;
  background: var(--accent);
  opacity: 0.8;
}
.home-desc {
  margin: 10px 0 0;
  font-size: clamp(13px, 0.98vw, 15px);
  line-height: 1.55;
  letter-spacing: -0.005em;
  color: var(--home-ink-body);
}

/* ---- the channel ------------------------------------------------------- */
/* The canvas is the reference frame (854 x 622 reference units) with its bend
   centre on the split - 48.548% across and 37.942% down the box - so the
   divider passes through the bend and the canvas's own two panels are the
   hero's two panels, leaving no edge of its own behind. */
.home-hero-visual { position: absolute; inset: 0; pointer-events: none; }
.tube-stage {
  position: absolute;
  left: calc(var(--home-split) * 1vw);
  top: 46%;
  width: min(47.2vw, 88vh);
  transform: translate(-48.548%, -37.942%);
}
.tube-canvas { display: block; width: 100%; height: auto; aspect-ratio: 854 / 622; }

/* ---- the picker -------------------------------------------------------- */
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  /* the page recedes into a wash of its own background rather than a dark
     scrim, so the picker still reads as part of the page */
  background: rgba(219, 218, 227, 0.72);
  backdrop-filter: blur(34px) saturate(0.9);
  -webkit-backdrop-filter: blur(34px) saturate(0.9);
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.3s ease, visibility 0s linear 0.3s;
}
.modal-backdrop.open {
  opacity: 1;
  visibility: visible;
  transition: opacity 0.3s ease, visibility 0s linear 0s;
}

/* the sheet: a piece of the page's light lifted off it - a hairline rather
   than a border, and one soft shadow */
.modal-card {
  width: 100%;
  max-width: 560px;
  padding: 22px 18px 18px;
  border-radius: 20px;
  background: #f6f5fa;
  color: var(--home-ink-strong);
  box-shadow:
    inset 0 0 0 1px rgba(23, 22, 28, 0.07),
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 44px 90px -44px rgba(23, 22, 28, 0.55);
  transition: transform 0.42s cubic-bezier(0.22, 1, 0.36, 1);
}
.modal-backdrop:not(.open) .modal-card { transform: translateY(16px) scale(0.98); }

.topic-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 6px 18px;
}
.topic-eyebrow {
  font-size: 10px;
  line-height: 1;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--home-ink-label);
}
.topic-sub {
  margin: 11px 0 0;
  font-size: 13px;
  line-height: 1.5;
  letter-spacing: -0.005em;
  color: var(--home-ink-body);
}

.icon-btn-light {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(23, 22, 28, 0.05);
  color: var(--home-ink-label);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease, transform 0.28s ease;
}
.icon-btn-light:hover {
  background: rgba(23, 22, 28, 0.09);
  color: var(--home-ink-strong);
  transform: rotate(90deg);
}
.icon-btn-light svg { width: 15px; height: 15px; }

/* the rows: one column, one surface each, numbered so they read as a list */
.topic-list { display: flex; flex-direction: column; gap: 6px; }
.topic-row {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 14px 16px;
  border: none;
  border-radius: 12px;
  text-align: left;
  font-family: var(--font);
  cursor: pointer;
  background: rgba(255, 255, 255, 0.6);
  box-shadow: inset 0 0 0 1px rgba(23, 22, 28, 0.06);
  transition: opacity 0.2s ease, transform 0.2s ease, background 0.16s ease,
    box-shadow 0.16s ease;
}
/* the rows rise in, one behind the other; the hidden state is the closed one,
   so a skipped frame can never leave them invisible */
.modal-backdrop:not(.open) .topic-row { opacity: 0; transform: translateY(9px); }
.modal-backdrop.open .topic-row {
  transition:
    opacity 0.5s ease calc(var(--i) * 45ms + 60ms),
    transform 0.55s cubic-bezier(0.22, 1, 0.36, 1) calc(var(--i) * 45ms + 60ms),
    background 0.16s ease, box-shadow 0.16s ease;
}

.topic-index {
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  font-variant-numeric: tabular-nums;
  color: var(--home-ink-label);
  transition: color 0.16s ease;
}
.topic-body { display: flex; flex-direction: column; gap: 4px; flex: 1 1 auto; min-width: 0; }
.topic-name {
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.015em;
  color: var(--home-ink-strong);
}
.topic-desc {
  font-size: 12.5px;
  line-height: 1.45;
  letter-spacing: -0.005em;
  color: var(--home-ink-body);
}
.topic-go {
  flex: 0 0 auto;
  display: flex;
  color: var(--home-ink-label);
  transition: color 0.16s ease, transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
.topic-go svg { display: block; width: 15px; height: 15px; }

.topic-row:not(:disabled):hover {
  background: #fff;
  box-shadow:
    inset 0 0 0 1px rgba(23, 22, 28, 0.12),
    0 14px 28px -22px rgba(23, 22, 28, 0.55);
}
.topic-row:not(:disabled):hover .topic-index,
.topic-row:not(:disabled):hover .topic-go { color: var(--accent); }
.topic-row:not(:disabled):hover .topic-go { transform: translateX(3px); }
.topic-row:not(:disabled):active { background: rgba(255, 255, 255, 0.85); }
.topic-row:focus-visible { outline: none; box-shadow: inset 0 0 0 1.5px var(--accent); }

.topic-row:disabled {
  cursor: default;
  background: rgba(255, 255, 255, 0.32);
  box-shadow: inset 0 0 0 1px rgba(23, 22, 28, 0.04);
}
.topic-row:disabled .topic-name { color: color-mix(in srgb, var(--home-ink-strong) 55%, transparent); }
.topic-row:disabled .topic-desc { color: color-mix(in srgb, var(--home-ink-body) 60%, transparent); }
.topic-row:disabled .topic-index { color: color-mix(in srgb, var(--home-ink-label) 70%, transparent); }
.topic-soon {
  flex: 0 0 auto;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--home-ink-label);
  background: rgba(23, 22, 28, 0.055);
  border-radius: 999px;
  padding: 5px 9px;
}

/* ---- responsive -------------------------------------------------------- */
/* Under a laptop the absolute composition stops making sense: the copy goes
   back into flow and the channel sits under it, still on its own two panels. */
@media (max-width: 1100px) {
  .home { height: auto; min-height: 100vh; overflow: visible; }
  .home-hero { display: flex; flex-direction: column; overflow: visible; padding: clamp(30px, 6vw, 60px) 0 clamp(30px, 5vw, 48px); }
  .home-hero::before { display: none; }
  .home-hero-copy { position: static; order: 0; padding: 0 32px; }
  .home-copy-block { position: static; max-width: none; }
  .home-headline { font-size: clamp(34px, 7.2vw, 58px); white-space: normal; }
  .home-cta { margin-top: 22px; }
  .home-foot { position: static; max-width: min(100%, 52ch); margin-top: clamp(26px, 4vw, 40px); }
  .home-hero-visual { position: static; order: 1; margin-top: clamp(20px, 4vw, 40px); }
  .tube-stage {
    position: relative;
    left: auto;
    top: auto;
    width: min(100%, 720px);
    margin: 0 auto;
    transform: none;
  }
}

@media (max-width: 760px) {
  .home-bar { padding: 0 12px; }
  .home-bar .titlebar-divider { display: none; }
  .home-bar .name { display: none; }
  .home-bar .title-meta { display: none; }
  .home-hero-copy { padding: 0 20px; }
  .home-headline { font-size: clamp(30px, 9vw, 40px); }
  .home-eyebrow { font-size: 9.5px; }
  .home-hero-visual { margin-top: 18px; }
  .modal-backdrop { padding: 14px; }
  .modal-card { padding: 18px 12px 12px; border-radius: 16px; }
  .topic-row { padding: 12px 12px; gap: 12px; }
  .topic-desc { font-size: 12px; }
}
'''

p.write_text(s[:start] + new)
print('css replaced')
