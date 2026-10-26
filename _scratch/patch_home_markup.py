from pathlib import Path

p = Path('frontend/index.html')
s = p.read_text()

start = s.index('<!-- ============================== HOMEPAGE ============================== -->')
end = s.index('<!-- ============================== WORKBENCH APP ============================== -->')

new = '''<!-- ============================== HOMEPAGE ============================== -->
<!-- The front door keeps the composition it always had: a split two-tone
     backdrop with the channel across its seam, the headline and the one button
     on the left, the note under them, and a picker that lists the benches. What
     it wears is the workbench's own furniture - the same dark bar, the same
     wordmark and page name, the same violet on the single action, the same type
     scale - so walking from here into an experiment is a change of scene rather
     than a change of website. -->
<div id="home" class="home">

  <div class="titlebar home-bar">
    <div class="titlebar-left">
      <span class="home-wordmark">Physics<b>Workbench</b></span>
      <span class="titlebar-divider" aria-hidden="true"></span>
      <span class="name">Welcome</span>
      <span class="title-meta">Rigid bodies, kinetic gas, vibration, fluids</span>
    </div>
    <div class="title-actions">
      <span class="home-live"><i aria-hidden="true"></i>4 benches live</span>
    </div>
  </div>

  <div class="home-hero">

    <div class="home-hero-visual" aria-hidden="true">
      <div class="tube-stage">
        <!-- The channel, painted to the canvas by tube.js: a half torus whose
             two mouths are cut flat on the bend's centre line, shaded across
             its wall exactly as the reference is. The seam runs through the
             bend's centre, frosting whatever is on its left. -->
        <canvas class="tube-canvas"></canvas>
      </div>
    </div>

    <div class="home-hero-copy">
      <div class="home-copy-block">
        <h1 class="home-headline"><span class="accent">Real</span> physics<br>in your browser.</h1>
        <button class="home-cta" id="tryItBtn">
          <span data-icon="Play"></span>
          <span>Try it</span>
        </button>
      </div>

      <div class="home-foot">
        <div class="home-eyebrow">Workbench</div>
        <p class="home-desc">A rigid-body engine, a kinetic gas, a chain of springs and a tank of liquid: four benches, all real, all playable in the tab. No install, no account.</p>
      </div>
    </div>

  </div>
</div>

<!-- ============================== EXPERIMENT PICKER ============================== -->
<!-- A sheet of the page's own light with a row per bench: the same palette, the
     same type, one accent, and no per-topic colour anywhere. -->
<div class="modal-backdrop" id="topicModal">
  <div class="modal-card" role="dialog" aria-modal="true" aria-label="Choose an experiment">

    <div class="topic-head">
      <div>
        <div class="topic-eyebrow">Workbench</div>
        <p class="topic-sub">Dynamics, Thermo, Vibrations and Fluids are live. The rest are on the way.</p>
      </div>
      <button class="icon-btn-light" id="closeModalBtn" aria-label="Close" data-icon="X"></button>
    </div>

    <div class="topic-list">
      <button class="topic-row" data-topic="dynamics" style="--i:0">
        <span class="topic-index">01</span>
        <span class="topic-body">
          <span class="topic-name">Dynamics</span>
          <span class="topic-desc">Gravity, collisions, momentum: a real rigid-body engine.</span>
        </span>
        <span class="topic-go" data-icon="ArrowRight"></span>
      </button>

      <button class="topic-row" data-topic="kinematics" style="--i:1" disabled>
        <span class="topic-index">02</span>
        <span class="topic-body">
          <span class="topic-name">Kinematics</span>
          <span class="topic-desc">Position, velocity, and acceleration in motion.</span>
        </span>
        <span class="topic-soon">Soon</span>
      </button>

      <button class="topic-row" data-topic="thermo" style="--i:2">
        <span class="topic-index">03</span>
        <span class="topic-body">
          <span class="topic-name">Thermo</span>
          <span class="topic-desc">Kinetic theory: a gas in a box, heat, work, and the laws they make.</span>
        </span>
        <span class="topic-go" data-icon="ArrowRight"></span>
      </button>

      <button class="topic-row" data-topic="mech" style="--i:3">
        <span class="topic-index">04</span>
        <span class="topic-body">
          <span class="topic-name">Vibrations</span>
          <span class="topic-desc">Masses, springs and dashpots: modes, poles, and the transfer function between them.</span>
        </span>
        <span class="topic-go" data-icon="ArrowRight"></span>
      </button>

      <button class="topic-row" data-topic="fluids" style="--i:4">
        <span class="topic-index">05</span>
        <span class="topic-body">
          <span class="topic-name">Fluids</span>
          <span class="topic-desc">A free surface with surface tension, viscosity, and a body in it.</span>
        </span>
        <span class="topic-go" data-icon="ArrowRight"></span>
      </button>

      <button class="topic-row" data-topic="waves" style="--i:5" disabled>
        <span class="topic-index">06</span>
        <span class="topic-body">
          <span class="topic-name">Waves</span>
          <span class="topic-desc">Oscillation, interference, and resonance.</span>
        </span>
        <span class="topic-soon">Soon</span>
      </button>
    </div>

  </div>
</div>

'''

p.write_text(s[:start] + new + s[end:])
print('markup replaced')
