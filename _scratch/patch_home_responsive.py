from pathlib import Path

p = Path('frontend/workbench.css')
s = p.read_text()

start = s.index('/* ---- responsive -------------------------------------------------------- */')
new = '''/* ---- responsive -------------------------------------------------------- */
/* Under a laptop the absolute composition stops making sense: the channel
   leads and the copy follows it, and both stay on a two-tone page whose seam
   is at half the width - the canvas's own seam, so the picture's panels and the
   page's meet with no edge of their own. */
@media (max-width: 1100px) {
  .home { height: auto; min-height: 100vh; overflow: visible; }
  .home-hero { display: flex; flex-direction: column; overflow: visible; padding-bottom: clamp(30px, 5vw, 52px); }
  .home-hero::before { width: 50%; }
  .home-hero-visual {
    position: relative;
    inset: auto;
    order: -1;
    padding-top: clamp(18px, 4vh, 42px);
  }
  /* centred on the seam, not on the box: the bend centre rides the divider */
  .tube-stage {
    position: relative;
    left: 50%;
    top: auto;
    width: min(88vw, 54vh);
    margin: 0;
    transform: translate(-48.548%, 0);
  }
  .home-hero-copy { position: static; inset: auto; padding: clamp(18px, 3.4vh, 34px) 32px 0; }
  .home-copy-block { position: static; max-width: min(100%, 30ch); }
  .home-headline { font-size: clamp(32px, 6.4vw, 56px); white-space: normal; }
  .home-cta { margin-top: 22px; }
  .home-foot { position: static; max-width: min(100%, 52ch); margin-top: clamp(26px, 4vw, 40px); }
}

@media (max-width: 560px) {
  .home { --home-gutter: 20px; }
  .home-bar { padding: 0 12px; }
  .home-bar .titlebar-divider,
  .home-bar .name,
  .home-bar .title-meta { display: none; }
  .home-hero-visual { padding-top: 14px; }
  /* 94vw and not 98: the bend sits 48.548% across the canvas and the stage is
     translated by that much, which leaves 51.452% of the tube to the right of
     the seam; any wider and its tail is shaved by the page's own overflow. */
  .tube-stage { width: min(94vw, 50vh); }
  .home-hero-copy { padding-left: 20px; padding-right: 20px; }
  .home-headline { font-size: clamp(30px, 9.2vw, 42px); }
  .home-eyebrow { font-size: 9.5px; }
  .home-desc { font-size: 13px; }
  .modal-backdrop { padding: 14px; }
  .modal-card { padding: 18px 12px 12px; border-radius: 16px; }
  .topic-row { padding: 12px; gap: 12px; }
  .topic-desc { font-size: 12px; }
}
'''

p.write_text(s[:start] + new)
print('responsive replaced')
