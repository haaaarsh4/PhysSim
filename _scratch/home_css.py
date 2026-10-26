from pathlib import Path

p = Path('frontend/workbench.css')
s = p.read_text()

marker = '/* ============================================================================\n   THE HOMEPAGE'
start = s.index(marker)
head = s[:start]

new = r'''/* ============================================================================
   THE HOMEPAGE
   ============================================================================
   One composition, the one this page has always had: a two-tone backdrop split
   down the middle of the glass channel, the headline and the one button on the
   left, the note under them, and a picker that lists the benches. No rails, no
   stage bar, no readouts - the front door is a page, not a bench.

   What it wears is the workbench's finish, so walking in is a change of room
   rather than a change of website: the same 52px dark bar, the same wordmark,
   the same three ink weights, the same violet on the one action, and the same
   two surface tones the stage is built from - --stage and --stage-2 - so the
   page and the stage behind a scene are literally the same two greys.
   ============================================================================ */

.home {
  /* The split is the channel's own seam: 62.06vw is where the bend's centre
     sits, and the canvas is placed so its painted seam lands on exactly that
     line. Everything on the left is set on one gutter. */
  --home-split: 62.06;
  --home-gutter: clamp(26px, 3.14vw, 60px);
  --home-ink-strong: #1E1D26;
  --home-ink-body: #5F5D6C;
  --home-ink-label: #8B8899;
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: var(--home-bg-left);
  color: var(--home-ink);
  font-family: var(--font);
}
#home[hidden] { display: none; }
html.route-workbench #home { display: none; }

/* ---- the bar ----------------------------------------------------------- */
.home-bar { padding: 0 14px; }
.home-wordmark {
  flex: 0 0 auto;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: -0.006em;
  color: var(--chrome-muted);
  white-space: nowrap;
}
.home-wordmark b { font-weight: 700; color: var(--chrome-ink); }

/* The one lamp on the bar: the same violet dot the benches light when they
   run, standing for the benches that are live. A readout, not a button. */
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
  box-shadow: 0 0 0 3px rgba(158, 0, 255, 0.18);
}

/* ---- the hero ---------------------------------------------------------- */
.home-hero {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
/* The full-height second panel. Its edge is the channel's seam, so the channel
   is what draws attention to it rather than the other way round. */
.home-hero::before {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: calc((100 - var(--home-split)) * 1vw);
  background: var(--home-bg-right);
}

/* Copy and channel are two guests on one sheet: the type takes the upper left,
   the channel the lower right, and the note closes the bottom left. */
.home-hero-copy { position: absolute; inset: 0; pointer-events: none; }

.home-copy-block {
  position: absolute;
  left: var(--home-gutter);
  top: 26%;
  max-width: min(40vw, 640px);
}
.home-headline {
  margin: 0;
  font-size: clamp(36px, 4.5vw, 76px);
  font-weight: 700;
  line-height: 1.03;
  letter-spacing: -0.038em;
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
  height: clamp(46px, 3.2vw, 54px);
  margin-top: clamp(24px, 3.4vh, 38px);
  padding: 0 clamp(22px, 1.9vw, 32px) 0 clamp(18px, 1.6vw, 26px);
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: #fff;
  font-family: var(--font);
  font-size: clamp(13px, 0.95vw, 14.5px);
  font-weight: 600;
  letter-spacing: -0.006em;
  cursor: pointer;
  pointer-events: auto;
  box-shadow:
    0 12px 28px -14px rgba(158, 0, 255, 0.7),
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
  transition: background 0.16s ease, box-shadow 0.16s ease, transform 0.1s ease;
}
.home-cta svg { width: 15px; height: 15px; }
.home-cta:hover {
  background: var(--accent-hover);
  box-shadow:
    0 16px 32px -14px rgba(158, 0, 255, 0.8),
    inset 0 1px 0 rgba(255, 255, 255, 0.24);
}
.home-cta:active { transform: translateY(1px); }
.home-cta:focus-visible { outline: 2px solid var(--home-ink-strong); outline-offset: 3px; }

/* The note: the workbench's own panel label - a violet tick and 10px tracked
   caps - then one sentence of muted ink. Bottom left, where it has always
   been, so the middle of the sheet stays the channel's. */
.home-foot {
  position: absolute;
  left: var(--home-gutter);
  bottom: clamp(28px, 6.5vh, 66px);
  max-width: min(34vw, 440px);
  pointer-events: auto;
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
  opacity: 0.85;
}
.home-desc {
  margin: 10px 0 0;
  font-size: clamp(13px, 0.98vw, 15px);
  line-height: 1.55;
  letter-spacing: -0.005em;
  color: var(--home-ink-body);
}

/* ---- the channel ------------------------------------------------------- */
/* The canvas is a measured frame (854 x 622 reference units) whose bend centre
   sits 48.548% across and 37.942% down the box. Placing the box so that point
   lands on the split is what makes the painted seam and the page's seam one
   line: the channel straddles the only edge on the page. */
.home-hero-visual { position: absolute; inset: 0; pointer-events: none; }
.tube-stage {
  position: absolute;
  left: calc(var(--home-split) * 1vw);
  top: 44%;
  width: min(50vw, 80vh);
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
  background: rgba(233, 232, 240, 0.74);
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
  background: #F7F6FA;
  color: var(--home-ink-strong);
  box-shadow:
    inset 0 0 0 1px rgba(30, 29, 38, 0.07),
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 44px 90px -44px rgba(30, 29, 38, 0.55);
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
  background: rgba(30, 29, 38, 0.05);
  color: var(--home-ink-label);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease, transform 0.28s ease;
}
.icon-btn-light:hover {
  background: rgba(30, 29, 38, 0.09);
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
  box-shadow: inset 0 0 0 1px rgba(30, 29, 38, 0.06);
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
    inset 0 0 0 1px rgba(30, 29, 38, 0.12),
    0 14px 28px -22px rgba(30, 29, 38, 0.55);
}
.topic-row:not(:disabled):hover .topic-index,
.topic-row:not(:disabled):hover .topic-go { color: var(--accent); }
.topic-row:not(:disabled):hover .topic-go { transform: translateX(3px); }
.topic-row:not(:disabled):active { background: rgba(255, 255, 255, 0.85); }
.topic-row:focus-visible { outline: none; box-shadow: inset 0 0 0 1.5px var(--accent); }

.topic-row:disabled {
  cursor: default;
  background: rgba(255, 255, 255, 0.32);
  box-shadow: inset 0 0 0 1px rgba(30, 29, 38, 0.04);
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
  background: rgba(30, 29, 38, 0.055);
  border-radius: var(--radius-pill);
  padding: 5px 9px;
}

/* ---- narrow ------------------------------------------------------------ */
/* Under a laptop the diagonal composition is gone for good: the type, the
   button and the note stack in one column and the channel closes the page.
   The split moves to the middle - the canvas's own seam - so the picture's
   two panels and the page's are still the same edge. */
@media (max-width: 1080px) {
  .home { height: auto; min-height: 100vh; overflow: visible; }
  .home-hero {
    display: flex;
    flex-direction: column;
    overflow: visible;
    padding: clamp(26px, 5vw, 52px) 0 clamp(24px, 4vw, 44px);
  }
  .home-hero::before { width: 50%; }
  .home-hero-copy { position: static; order: -1; padding: 0 var(--home-gutter); }
  .home-copy-block { position: static; max-width: none; }
  .home-headline { font-size: clamp(34px, 6.6vw, 58px); white-space: normal; }
  .home-cta { margin-top: 22px; }
  .home-foot { position: static; max-width: min(100%, 54ch); margin-top: clamp(26px, 4vw, 40px); }
  .home-hero-visual { position: static; margin-top: clamp(16px, 3vw, 32px); }
  .tube-stage {
    position: relative;
    left: 50%;
    top: auto;
    width: min(86vw, 52vh);
    margin: 0;
    transform: translate(-48.548%, 0);
  }
}

@media (max-width: 560px) {
  .home { --home-gutter: 20px; }
  .home-bar .titlebar-divider,
  .home-bar .name,
  .home-bar .title-meta { display: none; }
  /* 94vw and not 100: the stage is centred on the seam and translated by the
     bend's own 48.548%, which leaves a little more than half of the tube to
     the right of it; any wider and its tail leaves the page. */
  .tube-stage { width: min(94vw, 48vh); }
  .home-headline { font-size: clamp(30px, 8.8vw, 40px); }
  .home-eyebrow { font-size: 9.5px; }
  .home-desc { font-size: 13px; }
  .modal-backdrop { padding: 14px; }
  .modal-card { padding: 18px 12px 12px; border-radius: 16px; }
  .topic-row { padding: 12px; gap: 12px; }
  .topic-desc { font-size: 12px; }
}
'''

p.write_text(head + new)
print('home section rewritten:', len(new.splitlines()), 'lines')
