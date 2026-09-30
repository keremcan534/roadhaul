// The store video's picture, drawn in a page: renderAt(t) lays out the frame at `t` seconds, every layer a pure
// function of time (no CSS animations or transitions), and resolves once its images are decoded. storeVideo.mjs
// screenshots it frame by frame. window.PROMO (set by storeVideo.mjs) holds the timeline, the footage and the
// stills' notes; the page's markup is in storeVideo.mjs.
(() => {
  const { timeline, clips, stills } = window.PROMO;
  const { SCENES, WORLD_CUTS, FINALE_WORDS, TAPS, PAY_COUNT } = timeline;
  const FPS = 30;
  const $ = (selector) => document.querySelector(selector);

  // ---- Easing ----
  const clamp = (value) => Math.min(1, Math.max(0, value));
  /** 0 before `from`, 1 after `to`, linear between. */
  const span = (t, from, to) => clamp((t - from) / (to - from));
  const outExpo = (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p));
  const outCubic = (p) => 1 - (1 - p) ** 3;
  const inCubic = (p) => p * p * p;
  const inOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
  const lerp = (a, b, p) => a + (b - a) * p;
  /** A damped spring from 0 to 1, `seconds` after it lets go (overshoots a little, then settles). */
  const spring = (seconds, stiffness = 11, damping = 0.52) => {
    if (seconds <= 0) {
      return 0;
    }
    const damped = stiffness * Math.sqrt(1 - damping * damping);
    return 1 - Math.exp(-damping * stiffness * seconds) * (Math.cos(damped * seconds) + ((damping * stiffness) / damped) * Math.sin(damped * seconds));
  };

  // ---- Images: set a source, and wait for it before the frame is taken ----
  const pending = [];
  function show(img, src) {
    if (img.getAttribute('src') !== src) {
      img.setAttribute('src', src);
      pending.push(img.decode().catch(() => undefined));
    }
  }
  const clipFrame = (id, index) => {
    const count = clips[id];
    const frame = Math.min(count - 1, Math.max(0, Math.floor(index)));
    return `clips/${id}/${String(frame + 1).padStart(4, '0')}.jpg`;
  };
  const still = (name) => `stills/${name}.png`;

  /** A layer's style, set whole each frame (so nothing lingers from the last one). */
  function style(element, css) {
    element.style.cssText = css;
  }

  // ---- Words ----

  /**
   * A block of words: an amber bar and a kicker over a headline of one or more lines, each letter rising out of its
   * line's mask. `render(t, inAt, outAt)` shows it from `inAt`, and takes it away (rising, fading) at `outAt`.
   */
  function words(parent, { kicker = '', lines, className = '', stagger = 0.022 }) {
    const root = document.createElement('div');
    root.className = `words ${className}`;
    const bar = document.createElement('div');
    bar.className = 'words__bar';
    const kick = document.createElement('div');
    kick.className = 'words__kicker';
    kick.textContent = kicker;
    if (kicker !== '') {
      root.append(bar, kick);
    }
    const letters = [];
    for (const line of lines) {
      const row = document.createElement('div');
      row.className = 'words__line';
      for (const part of line.split(/(\*[^*]+\*)/).filter(Boolean)) {
        const accent = part.startsWith('*');
        for (const character of accent ? part.slice(1, -1) : part) {
          const letter = document.createElement('span');
          letter.className = accent ? 'words__letter is-accent' : 'words__letter';
          letter.textContent = character === ' ' ? ' ' : character;
          row.append(letter);
          letters.push(letter);
        }
      }
      root.append(row);
    }
    parent.append(root);
    return {
      root,
      render(t, inAt, outAt) {
        const visible = t >= inAt - 0.01 && t < outAt + 0.35;
        root.style.display = visible ? '' : 'none';
        if (!visible) {
          return;
        }
        const leave = inCubic(span(t, outAt, outAt + 0.3));
        root.style.transform = `translateY(${-60 * leave}px)`;
        root.style.opacity = String(1 - leave);
        bar.style.transform = `scaleX(${outExpo(span(t, inAt, inAt + 0.5))})`;
        const kickIn = outExpo(span(t, inAt + 0.05, inAt + 0.6));
        kick.style.transform = `translateX(${-30 * (1 - kickIn)}px)`;
        kick.style.opacity = String(kickIn);
        letters.forEach((letter, index) => {
          const p = outExpo(span(t, inAt + 0.08 + index * stagger, inAt + 0.08 + index * stagger + 0.55));
          letter.style.transform = `translateY(${110 * (1 - p)}%)`;
        });
      },
    };
  }

  // ---- The phone: a plain, unbranded handset on its side, holding a still ----

  function phone(parent) {
    const root = document.createElement('div');
    root.className = 'phone';
    const screen = document.createElement('div');
    screen.className = 'phone__screen';
    const img = document.createElement('img');
    const next = document.createElement('img');
    next.className = 'phone__next';
    const tap = document.createElement('div');
    tap.className = 'tap';
    tap.innerHTML = '<div class="tap__ring"></div><div class="tap__dot"></div>';
    screen.append(img, next, tap);
    root.append(screen);
    parent.append(root);
    return {
      root,
      /** Shows `name`, or cross-fades from it to `then` (0..1). */
      screen(name, then = null, mix = 0) {
        show(img, still(name));
        next.style.opacity = then === null ? '0' : String(mix);
        if (then !== null) {
          show(next, still(then));
        }
      },
      /** A finger's tap at (x, y), shares of the screen, `seconds` after it lands (hidden outside 0..0.6). */
      tap(at, seconds) {
        if (at === undefined || seconds < -0.12 || seconds > 0.6) {
          tap.style.display = 'none';
          return;
        }
        const press = outCubic(span(seconds, -0.12, 0));
        const ring = outCubic(span(seconds, 0, 0.5));
        tap.style.cssText = `display:block;left:${at.x * 100}%;top:${at.y * 100}%`;
        tap.firstChild.style.cssText = `transform:translate(-50%,-50%) scale(${0.4 + ring * 1.2});opacity:${seconds < 0 ? 0 : 1 - ring}`;
        tap.lastChild.style.cssText = `transform:translate(-50%,-50%) scale(${seconds < 0.18 ? 0.6 + 0.4 * press : 1 - span(seconds, 0.18, 0.4)});opacity:${seconds < 0.25 ? press : 1 - span(seconds, 0.25, 0.4)}`;
      },
    };
  }

  // ---- The stage ----
  const stage = $('#stage');
  const footage = $('#footage img');
  const footageLayer = $('#footage');
  const backdrop = $('#backdrop img');
  const backdropLayer = $('#backdrop');
  const whip = $('#whip feGaussianBlur');
  const shade = $('#shade');
  const flash = $('#flash');
  const wipe = $('#wipe');
  const lines = [$('#line-top'), $('#line-bottom')];
  const grain = $('#grain');
  const phones = $('#phones');
  const copy = $('#copy');
  const counter = $('#counter');
  const counterValue = $('#counter-value');
  const end = $('#end');
  const mapLayer = $('#map');
  const mapImage = $('#map img');
  /** The middle of the region on the map's still (the phone's screen at twice its size, 1830 × 824). */
  const MAP_REGION = { x: 920, y: 410 };

  const main = phone(phones);
  const fan = [phone(phones), phone(phones), phone(phones)];

  const titles = {
    open: words(copy, { kicker: 'Your company starts here', lines: ['Start with', '*one truck.*'], className: 'at-top' }),
    job: words(copy, { kicker: 'Contracts every day', lines: ['Take', 'the *job.*'], className: 'at-left' }),
    road: words(copy, { kicker: 'Heavy truck, real handling', lines: ['Hit the *road.*'], className: 'at-centre' }),
    world: words(copy, { kicker: 'A living world', lines: [], className: 'at-world' }),
    paid: words(copy, { kicker: 'Every job pays', lines: ['Deliver.', '*Get paid.*'], className: 'at-left is-paid' }),
    paint: words(copy, { kicker: 'Paint shop', lines: ['Make it', '*yours.*'], className: 'at-left' }),
    upgrade: words(copy, { kicker: 'Engine to tyres', lines: ['Upgrade', 'every *part.*'], className: 'at-left is-narrow' }),
    company: words(copy, { kicker: 'Drivers, depots, a fleet', lines: ['Build your', '*company.*'], className: 'at-left' }),
    rivals: words(copy, { kicker: 'Four cities to win', lines: ['Beat your', '*rivals.*'], className: 'at-map' }),
  };
  const worldWords = ['Dawn *mist.*', 'After the *rain.*', 'Night *drives.*', 'Winter *roads.*'].map((line) =>
    words(copy, { lines: [line], className: 'is-world' }),
  );
  const worldLine = $('#world-line');
  const finaleWords = ['Drive.', 'Deliver.', '*Grow.*'].map((line, index) =>
    words(copy, { lines: [line], className: `at-finale is-finale-${index}`, stagger: 0.012 }),
  );

  /** The footage layer: a clip's frame, with a scale and a CSS filter. */
  function film(id, index, scale = 1, filter = '', extra = '') {
    show(footage, clipFrame(id, index));
    style(footageLayer, `display:block;transform:scale(${scale});filter:${filter};${extra}`);
  }

  /** Behind a phone: the words' side darkened, a warm glow where the phone stands. */
  const PHONE_SHADE =
    'display:block;background:radial-gradient(42% 55% at 66% 52%,rgba(242,163,58,.16),rgba(242,163,58,0) 72%),linear-gradient(90deg,rgba(10,8,14,.6),rgba(10,8,14,0) 55%)';

  /** The blurred world behind a phone. */
  function behind(src, scale = 1.12, blur = 26, brightness = 0.5) {
    show(backdrop, src);
    style(backdropLayer, `display:block;transform:scale(${scale});filter:blur(${blur}px) brightness(${brightness}) saturate(1.15)`);
  }

  /** A phone's pose: centre (px), size (scale) and turn in 3D (degrees). */
  function pose(target, { x, y, scale = 1, rx = 0, ry = 0, rz = 0, opacity = 1 }) {
    target.root.style.cssText = `display:block;opacity:${opacity};transform:translate(-50%,-50%) translate3d(${x}px,${y}px,0) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${scale})`;
  }

  /** A white flash that fades over `seconds` from `at`. */
  function flashAt(t, at, strength = 0.55, seconds = 0.14) {
    const p = span(t, at, at + seconds);
    return t >= at && p < 1 ? strength * (1 - p) : 0;
  }

  /** The amber band that sweeps across a cut at `at` (it covers the screen at `at`). */
  function sweep(t, at) {
    const p = span(t, at - 0.22, at + 0.22);
    if (p <= 0 || p >= 1) {
      return false;
    }
    wipe.style.cssText = `display:block;transform:translateX(${lerp(-130, 130, inOutCubic(p))}%) skewX(-14deg)`;
    return true;
  }

  // ---- The scenes, each drawing its span of time ----

  function openScene(t) {
    // The road's centre line runs in, then splits: its halves draw apart and the country opens between them.
    const run = outCubic(span(t, 0, 0.45));
    const open = outExpo(span(t, 0.4, 1.25));
    const half = 540 * open;
    film('hero', t * FPS, lerp(1.14, 1, outCubic(span(t, 0.4, 4))), 'contrast(1.05) saturate(1.12)', `clip-path:inset(${540 - half}px 0 ${540 - half}px 0)`);
    lines.forEach((line, index) => {
      const y = 540 + (index === 0 ? -half : half) - 4;
      line.style.cssText = `display:${open < 1 ? 'block' : 'none'};top:${y}px;transform:scaleX(${run});background-position-x:${-t * 700}px;opacity:${1 - span(t, 0.9, 1.2)}`;
    });
    style(shade, 'display:block;background:radial-gradient(80% 75% at 0% 0%,rgba(14,9,18,.62),rgba(14,9,18,0) 62%)');
    titles.open.render(t, 1.0, 3.45);
    if (t > 3.7) {
      // Into the job board: the country blurs behind the phone.
      const p = inOutCubic(span(t, 3.7, 4));
      film('hero', t * FPS, lerp(1, 1.08, p), `blur(${26 * p}px) brightness(${1 - 0.5 * p}) saturate(1.15)`);
    }
  }

  function jobScene(t) {
    const local = t - SCENES.job;
    film('hero', t * FPS, 1.08, 'blur(26px) brightness(0.5) saturate(1.15)');
    const rise = spring(local + 0.15, 9, 0.62);
    const leave = inCubic(span(t, SCENES.road - 0.3, SCENES.road));
    pose(main, {
      x: 1230,
      y: lerp(820, 560, rise) - 1100 * leave,
      scale: 0.6,
      rx: lerp(38, 8, rise) - 30 * leave,
      ry: lerp(-24, -12, rise) + 4 * span(local, 0, 2),
      rz: lerp(4, 0, rise),
    });
    main.screen('jobs');
    main.tap(stills.tap, t - TAPS.job);
    style(shade, PHONE_SHADE);
    titles.job.render(t, SCENES.job + 0.05, SCENES.road - 0.35);
  }

  function roadScene(t) {
    const local = t - SCENES.road;
    const arrive = outExpo(span(local, 0, 0.5));
    whip.setAttribute('stdDeviation', `${60 * (1 - outCubic(span(local, 0, 0.28)))} 0`);
    film('cabin', local * FPS, lerp(1.3, 1, arrive), 'url(#whip) contrast(1.04) saturate(1.1)');
    style(shade, `display:block;background:radial-gradient(55% 45% at 50% 42%,rgba(8,8,12,${0.42 * (1 - span(t, SCENES.world - 0.5, SCENES.world - 0.2))}),rgba(8,8,12,0) 100%)`);
    titles.road.render(t, SCENES.road + 0.2, SCENES.world - 0.5);
  }

  const WORLD_CLIPS = ['mist', 'rainbow', 'night', 'snow'];

  function worldScene(t) {
    const cut = Math.max(0, WORLD_CUTS.findLastIndex((at) => t >= at));
    const local = t - WORLD_CUTS[cut];
    film(WORLD_CLIPS[cut], local * FPS + 4, lerp(1.07, 1, outCubic(span(local, 0, 0.45))), 'contrast(1.05) saturate(1.12)');
    style(shade, 'display:block;background:linear-gradient(0deg,rgba(8,8,12,.62) 0%,rgba(8,8,12,.28) 26%,rgba(8,8,12,0) 45%)');
    titles.world.render(t, SCENES.world + 0.05, SCENES.paid - 0.35);
    worldWords.forEach((word, index) => word.render(t, WORLD_CUTS[index] + 0.04, (WORLD_CUTS[index + 1] ?? SCENES.paid) - 0.3));
    const lineIn = outExpo(span(t, SCENES.world + 0.3, SCENES.world + 0.9));
    worldLine.style.cssText = `display:block;opacity:${lineIn * (1 - span(t, SCENES.paid - 0.35, SCENES.paid - 0.1))};transform:translateY(${20 * (1 - lineIn)}px)`;
    return Math.max(...WORLD_CUTS.map((at) => flashAt(t, at, 0.5)));
  }

  function paidScene(t) {
    const local = t - SCENES.paid;
    behind(still('result'), 1.14, 26, 0.45);
    const rise = spring(local, 9, 0.6);
    pose(main, { x: lerp(1950, 1300, rise), y: 560, scale: 0.6, ry: lerp(-40, -12, rise), rz: lerp(-3, 0, rise) });
    main.screen('result');
    main.tap(undefined, 0);
    style(shade, PHONE_SHADE);
    titles.paid.render(t, SCENES.paid + 0.1, SCENES.garage - 0.3);
    // The pay counts up and lands with a pop.
    const count = outCubic(span(t, PAY_COUNT[0], PAY_COUNT[1]));
    const pop = t >= PAY_COUNT[1] ? 1 + 0.16 * Math.exp(-(t - PAY_COUNT[1]) * 9) * Math.cos((t - PAY_COUNT[1]) * 22) : 1;
    const shown = t >= PAY_COUNT[0] - 0.05 && t < SCENES.garage;
    counterValue.textContent = `+${Math.round((stills.pay ?? 0) * count).toLocaleString('en-GB')}`;
    counter.style.cssText = `display:${shown ? 'block' : 'none'};opacity:${outCubic(span(t, PAY_COUNT[0] - 0.05, PAY_COUNT[0] + 0.2)) * (1 - span(t, SCENES.garage - 0.3, SCENES.garage - 0.05))};transform:scale(${pop})`;
  }

  function garageScene(t) {
    const local = t - SCENES.garage;
    behind(still('garage'), 1.14, 26, 0.45);
    const rise = spring(local, 9, 0.62);
    const leave = inCubic(span(t, SCENES.company - 0.3, SCENES.company));
    pose(main, {
      x: 1320 + 900 * leave,
      y: lerp(900, 560, rise),
      scale: 0.6,
      rx: lerp(30, 6, rise),
      ry: -12 + 6 * span(local, 0, 4) - 20 * leave,
    });
    // Three paints tried on the beats, the last one bought, then the engine's upgrade. Each tap changes the screen
    // a moment after the finger lands.
    const taps = [
      ...TAPS.paints.map((at, index) => ({ at, where: stills.paints?.[index], then: `paint-${index + 1}` })),
      { at: TAPS.paint, where: stills.paint, then: 'painted' },
      { at: TAPS.upgrade, where: stills.upgrade, then: 'upgraded' },
    ];
    const done = taps.findLastIndex((tap) => t >= tap.at + 0.06);
    if (done < 0) {
      main.screen('garage');
    } else {
      const before = done === 0 ? 'garage' : taps[done - 1].then;
      main.screen(before, taps[done].then, outCubic(span(t, taps[done].at + 0.06, taps[done].at + 0.18)));
    }
    const pressing = taps.findLastIndex((tap) => t >= tap.at - 0.12);
    main.tap(pressing < 0 ? undefined : taps[pressing].where, t - (taps[pressing]?.at ?? 0));
    style(shade, PHONE_SHADE);
    titles.paint.render(t, SCENES.garage + 0.1, TAPS.paint + 0.1);
    titles.upgrade.render(t, TAPS.paint + 0.45, SCENES.company - 0.3);
  }

  function companyScene(t) {
    const local = t - SCENES.company;
    const mapAt = SCENES.company + 2;
    if (t < mapAt) {
      behind(still('company'), 1.14, 26, 0.45);
      ['fleet', 'company', 'rivals'].forEach((name, index) => {
        const land = spring(local - index * timeline.BEAT, 10, 0.6);
        const gather = inOutCubic(span(t, mapAt - 0.35, mapAt));
        pose(fan[index], {
          x: lerp(2400, 1200 + index * 160, land) + 60 * gather,
          y: lerp(700, 350 + index * 185, land),
          scale: lerp(0.36, 0.38, land) * (1 + 1.4 * gather),
          ry: lerp(-50, -22, land) + 22 * gather,
          rx: 8 * (1 - gather),
          rz: lerp(-6, -2 + index * 2, land) * (1 - gather),
          opacity: 1 - gather * (index < 2 ? 1 : 0),
        });
        fan[index].screen(name);
        fan[index].tap(undefined, 0);
      });
      style(shade, PHONE_SHADE);
    } else {
      // The map fills the screen, pushing in on the region: its middle (MAP_REGION, in the still's pixels) right of
      // the words, the sea behind them and the companies' key under them.
      const push = inOutCubic(span(t, mapAt, SCENES.finale));
      const scale = lerp(1.42, 1.52, push);
      show(mapImage, still('map'));
      style(mapLayer, `display:block;transform:translate(${1340 - MAP_REGION.x * scale}px,${540 - MAP_REGION.y * scale}px) scale(${scale})`);
      style(shade, 'display:block;background:linear-gradient(90deg,rgba(10,8,14,.55),rgba(10,8,14,0) 40%)');
    }
    titles.company.render(t, SCENES.company + 0.1, mapAt - 0.35);
    titles.rivals.render(t, mapAt + 0.05, SCENES.finale - 0.3);
    return flashAt(t, mapAt, 0.35);
  }

  function finaleScene(t) {
    const local = t - SCENES.finale;
    const dim = inCubic(span(t, SCENES.end - 1.1, SCENES.end));
    film('sunset', local * FPS, lerp(1.04, 1, outCubic(span(local, 0, 1))), `contrast(1.06) saturate(1.15) brightness(${1 - 0.55 * dim})`);
    style(shade, 'display:block;background:linear-gradient(90deg,rgba(14,9,18,.55),rgba(14,9,18,0) 50%)');
    finaleWords.forEach((word, index) => word.render(t, FINALE_WORDS[index] - 0.06, SCENES.end - 0.75));
    return flashAt(t, SCENES.finale, 0.45);
  }

  function endScene(t) {
    const local = t - SCENES.end;
    film('sunset', clips.sunset - 1, 1.1, 'blur(30px) brightness(0.32) saturate(1.2)');
    style(shade, 'display:block;background:radial-gradient(70% 60% at 50% 100%,rgba(242,163,58,.28),rgba(242,163,58,0) 70%),linear-gradient(180deg,rgba(26,19,32,.35),rgba(22,25,29,.7))');
    const tile = spring(local - 0.05, 10, 0.5);
    $('#end-tile').style.transform = `scale(${Math.max(0, tile)}) rotate(${lerp(-14, 0, tile)}deg)`;
    const glyphs = [...document.querySelectorAll('#end-word path')];
    glyphs.forEach((glyph, index) => {
      const p = outExpo(span(local, 0.28 + index * 0.05, 0.28 + index * 0.05 + 0.6));
      // `translate`, not `transform`: each letter keeps its place (its transform attribute) in the word.
      glyph.style.translate = `0 ${60 * (1 - p)}px`;
      glyph.style.opacity = String(p);
    });
    const motto = outExpo(span(local, 0.85, 1.6));
    $('#end-motto').style.cssText = `opacity:${motto};letter-spacing:${lerp(0.9, 0.55, motto)}em`;
    const tagline = outExpo(span(local, 1.2, 1.9));
    $('#end-tagline').style.cssText = `opacity:${tagline};transform:translateY(${24 * (1 - tagline)}px)`;
    const pill = spring(local - 1.75, 11, 0.55);
    $('#end-pill').style.cssText = `transform:scale(${Math.max(0, pill)})`;
    const small = outExpo(span(local, 2.2, 2.9));
    $('#end-small').style.cssText = `opacity:${small * 0.8};transform:translateY(${16 * (1 - small)}px)`;
    end.style.display = 'block';
    return flashAt(t, SCENES.end, 0.6, 0.3);
  }

  /** Which scene's span each title belongs to: outside it, it is hidden. */
  const OWNERS = {
    open: [0, SCENES.job],
    job: [SCENES.job, SCENES.road],
    road: [SCENES.road, SCENES.world],
    world: [SCENES.world, SCENES.paid],
    paid: [SCENES.paid, SCENES.garage],
    paint: [SCENES.garage, SCENES.company],
    upgrade: [SCENES.garage, SCENES.company],
    company: [SCENES.company, SCENES.finale],
    rivals: [SCENES.company, SCENES.finale],
  };
  const sceneOwns = (name, t) => t >= OWNERS[name][0] && t < OWNERS[name][1];

  /** Lays out the frame at `t` seconds; resolves when it is ready to be taken. */
  window.renderAt = async (t) => {
    for (const layer of [footageLayer, backdropLayer, mapLayer, shade, wipe, end, counter, worldLine, ...lines]) {
      layer.style.display = 'none';
    }
    for (const target of [main, ...fan]) {
      target.root.style.display = 'none';
      target.tap(undefined, 0);
    }
    let flashes = 0;
    if (t < SCENES.job) {
      openScene(t);
    } else if (t < SCENES.road) {
      jobScene(t);
    } else if (t < SCENES.world) {
      roadScene(t);
    } else if (t < SCENES.paid) {
      flashes = worldScene(t);
    } else if (t < SCENES.garage) {
      paidScene(t);
    } else if (t < SCENES.company) {
      garageScene(t);
    } else if (t < SCENES.finale) {
      flashes = companyScene(t);
    } else if (t < SCENES.end) {
      flashes = finaleScene(t);
    } else {
      flashes = endScene(t);
    }
    // Words not in their scene's span hide themselves; the finale's and the world's too.
    for (const [name, block] of Object.entries(titles)) {
      if (!sceneOwns(name, t)) {
        block.root.style.display = 'none';
      }
    }
    if (t < SCENES.world || t >= SCENES.paid) {
      worldWords.forEach((word) => (word.root.style.display = 'none'));
    }
    if (t < SCENES.finale || t >= SCENES.end) {
      finaleWords.forEach((word) => (word.root.style.display = 'none'));
    }
    // The amber band over the cuts into the pay, the garage and the company.
    for (const at of [SCENES.paid, SCENES.garage, SCENES.company]) {
      sweep(t, at);
    }
    flash.style.opacity = String(flashes);
    // A fade to black at the very end.
    stage.style.opacity = String(1 - span(t, timeline.DURATION - 0.6, timeline.DURATION));
    const waiting = pending.splice(0);
    await Promise.all(waiting);
    await document.fonts.ready;
  };


  // The grain: seeded noise on a tile, drawn once.
  const tile = document.createElement('canvas');
  tile.width = tile.height = 512;
  const context = tile.getContext('2d');
  const noise = context.createImageData(512, 512);
  let seed = 1234567;
  for (let i = 0; i < noise.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const value = seed >>> 24;
    noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = value;
    noise.data[i + 3] = 255;
  }
  context.putImageData(noise, 0, 0);
  grain.style.backgroundImage = `url(${tile.toDataURL()})`;
})();
