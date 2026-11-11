// The trailer's picture, drawn in a page (cut.mjs builds it): renderAt(t) lays out the frame at `t` seconds, every
// layer a pure function of time (no CSS animations or transitions), and resolves once its images are decoded.
// window.TRAILER holds the cut: the clips (which shot, from when, how fast), the captions and the brand.
(() => {
  const { fps, duration, clips, captions, finale, brand } = window.TRAILER;
  const $ = (selector) => document.querySelector(selector);

  // ---- Easing ----
  const clamp = (value) => Math.min(1, Math.max(0, value));
  const span = (t, from, to) => clamp((t - from) / (to - from));
  const outExpo = (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p));
  const outCubic = (p) => 1 - (1 - p) ** 3;
  const inCubic = (p) => p * p * p;
  const inOutSine = (p) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(p));
  const lerp = (a, b, p) => a + (b - a) * p;
  /** A damped spring from 0 to 1, `seconds` after it lets go (overshoots a little, then settles). */
  const spring = (seconds, stiffness = 12, damping = 0.55) => {
    if (seconds <= 0) return 0;
    const damped = stiffness * Math.sqrt(1 - damping * damping);
    return (
      1 -
      Math.exp(-damping * stiffness * seconds) *
        (Math.cos(damped * seconds) + ((damping * stiffness) / damped) * Math.sin(damped * seconds))
    );
  };

  // ---- Footage: two layers, so a transition can show both ----
  const pending = [];
  const layers = [$('#clip-a'), $('#clip-b')];
  function show(img, src) {
    if (img.getAttribute('src') !== src) {
      img.setAttribute('src', src);
      pending.push(img.decode().catch(() => undefined));
    }
  }
  /** The shot's frame for clip `c` at `t`: its start, its pace, held on its last frame past its end. */
  function frameOf(c, t) {
    const seconds = c.at + (t - c.from) * c.speed;
    const index = Math.min(c.frames - 1, Math.max(0, Math.floor(seconds * fps + 1e-6)));
    return `shots/${c.shot}/${String(index + 1).padStart(4, '0')}.jpg`;
  }
  function drawClip(layer, c, t, extra = '') {
    const p = clamp((t - c.from) / (c.to - c.from));
    const zoom = c.zoom ? lerp(c.zoom[0], c.zoom[1], inOutSine(p)) : 1;
    // The first moments after a hard cut on a hit: a short punch in.
    const punch = c.punch ? 1 + 0.06 * Math.exp(-(t - c.from) * 9) : 1;
    layer.style.cssText = `display:block;transform:scale(${zoom * punch});${extra}`;
    show(layer.querySelector('img'), frameOf(c, t));
  }

  // ---- Words ----
  /**
   * A caption: lines whose letters rise out of their line's mask; the last line amber. `pack` (characters) re-flows
   * the words into short lines, for a narrow column beside a panel.
   */
  function caption(lines, className, pack = 0) {
    const root = document.createElement('div');
    root.className = `caption ${className}`;
    const bar = document.createElement('div');
    bar.className = 'caption__bar';
    root.append(bar);
    const letters = [];
    let rows = lines.map((text, index) => text.split(' ').map((word) => ({ word, accent: index === lines.length - 1 })));
    if (pack > 0) {
      rows = [];
      for (const item of lines.flatMap((text, index) => text.split(' ').map((word) => ({ word, accent: index === lines.length - 1 })))) {
        const row = rows.at(-1);
        const length = row === undefined ? Infinity : row.reduce((sum, w) => sum + w.word.length + 1, 0) + item.word.length;
        if (length > pack || row.at(-1).accent !== item.accent) rows.push([item]);
        else row.push(item);
      }
    }
    // Packed, rows keep their line's colour; a caption of one line gets its last row amber.
    if (pack > 0 && lines.length === 1) {
      rows = rows.map((row, index) => row.map((item) => ({ ...item, accent: index === rows.length - 1 })));
    }
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'caption__line';
      for (const { word, accent } of row) {
        const wordElement = document.createElement('span');
        wordElement.className = `caption__word${accent ? ' is-accent' : ''}`;
        for (const character of word) {
          const letter = document.createElement('span');
          letter.className = 'caption__letter';
          letter.textContent = character;
          wordElement.append(letter);
          letters.push(letter);
        }
        line.append(wordElement, ' ');
      }
      root.append(line);
    }
    $('#copy').append(root);
    return { root, bar, letters };
  }

  /** Shrinks a caption's type until its widest line fits `width` CSS pixels. */
  function fit(block, width) {
    block.root.style.display = 'block';
    const lines = [...block.root.querySelectorAll('.caption__line')];
    const widest = Math.max(...lines.map((line) => line.scrollWidth));
    if (widest > width) {
      const size = parseFloat(getComputedStyle(lines[0]).fontSize);
      block.root.style.setProperty('--size', `${Math.floor((size * width) / widest)}px`);
    }
  }

  function renderCaption(block, t, from, to, stagger = 0.018) {
    const visible = t >= from - 0.01 && t < to;
    block.root.style.display = visible ? 'block' : 'none';
    if (!visible) return;
    const out = span(t, to - 0.22, to);
    block.root.style.opacity = String(1 - inCubic(out));
    block.root.style.transform = `translateY(${-40 * inCubic(out)}px)`;
    block.bar.style.transform = `scaleX(${outExpo(span(t, from, from + 0.4))})`;
    block.letters.forEach((letter, index) => {
      const p = outExpo(span(t, from + 0.04 + index * stagger, from + 0.5 + index * stagger));
      letter.style.transform = `translateY(${(1 - p) * 108}%)`;
    });
  }

  const blocks = captions.map((c) => ({ ...c, block: caption(c.lines, `at-${c.place ?? 'lower'}`, c.place === 'side' ? 9 : 0) }));
  const finaleWords = finale.words.map((word, index) => ({
    at: finale.at[index],
    block: caption([word], `at-finale is-finale-${index}${index === finale.words.length - 1 ? '' : ' is-white'}`),
  }));

  // ---- The brand ----
  const brandRoot = $('#brand');
  const tile = $('#brand-tile');
  const word = $('#brand-word');
  const tagline = $('#brand-tagline');
  const wordParts = [...word.querySelectorAll('path, rect, polygon, circle')];

  function renderBrand(t) {
    const from = brand.at;
    const visible = t >= from;
    brandRoot.style.display = visible ? 'block' : 'none';
    $('#brand-shade').style.opacity = String(visible ? 0.75 * outCubic(span(t, from, from + 0.5)) : 0);
    if (!visible) return;
    const s = spring(t - from);
    tile.style.transform = `scale(${s}) rotate(${(1 - s) * -14}deg)`;
    wordParts.forEach((part, index) => {
      const p = outExpo(span(t, from + 0.12 + index * 0.035, from + 0.62 + index * 0.035));
      part.style.opacity = String(p);
      part.style.translate = `0 ${(1 - p) * 40}px`;
    });
    const line = outExpo(span(t, from + 0.45, from + 1.05));
    tagline.style.opacity = String(line);
    tagline.style.transform = `translateY(${(1 - line) * 24}px)`;
    tagline.style.letterSpacing = `${lerp(0.16, 0.06, line)}em`;
  }

  // ---- The frame ----
  let fitted = false;
  window.renderAt = async (t) => {
    if (!fitted) {
      await document.fonts.ready;
      for (const c of blocks) fit(c.block, c.place === 'side' ? 470 : 1500);
      for (const w of finaleWords) fit(w.block, 1500);
      fitted = true;
    }
    for (const layer of layers) layer.style.display = 'none';
    // The clip on screen, and a transition into it: a whip (both blurred along the motion, the old one sliding
    // out), a flash, or a dip through black.
    const index = clips.findIndex((c) => t >= c.from && t < c.to);
    const current = clips[Math.max(0, index)];
    let flash = 0;
    let dip = 0;
    const since = t - current.from;
    if (current.in === 'whip' && since < 0.16 && index > 0) {
      const p = since / 0.16;
      const blur = 70 * (1 - outCubic(p));
      $('#whip-blur').setAttribute('stdDeviation', `${blur} 0`);
      drawClip(layers[0], current, t, `filter:url(#whip);translate:${(1 - outCubic(p)) * 140}px 0`);
    } else {
      drawClip(layers[0], current, t);
    }
    // The outgoing clip's last moments under a whip into the next one.
    const next = clips[index + 1];
    if (next?.in === 'whip' && next.from - t < 0.12) {
      const p = 1 - (next.from - t) / 0.12;
      $('#whip-blur').setAttribute('stdDeviation', `${70 * inCubic(p)} 0`);
      drawClip(layers[0], current, t, `filter:url(#whip);translate:${-160 * inCubic(p)}px 0`);
    }
    if (current.in === 'flash') flash = Math.max(flash, 0.85 * (1 - outCubic(span(since, 0, 0.3))));
    if (current.in === 'dip') dip = Math.max(dip, 1 - outCubic(span(since, 0, 0.18)));
    if (next?.in === 'dip') dip = Math.max(dip, inCubic(span(t, next.from - 0.12, next.from)));
    for (const hit of finale.at) flash = Math.max(flash, t >= hit ? 0.35 * (1 - outCubic(span(t, hit, hit + 0.22))) : 0);
    if (t >= brand.at) flash = Math.max(flash, 0.7 * (1 - outCubic(span(t, brand.at, brand.at + 0.4))));

    for (const c of blocks) renderCaption(c.block, t, c.from, c.to);
    finaleWords.forEach((w) => {
      renderCaption(w.block, t, w.at, finale.to, 0.012);
      const p = t - w.at;
      if (p >= 0) w.block.root.style.transform += ` scale(${1 + 0.08 * Math.exp(-p * 10)})`;
    });
    $('#shade').style.opacity = String(
      Math.max(
        ...blocks.map((c) => (t >= c.from - 0.1 && t < c.to ? 1 : 0)),
        t >= finale.at[0] && t < finale.to ? 1 : 0,
      ),
    );
    renderBrand(t);
    $('#flash').style.opacity = String(flash);
    $('#dip').style.opacity = String(dip);
    // The last moments fade to black.
    $('#fade').style.opacity = String(inCubic(span(t, duration - 0.35, duration)));
    await Promise.all(pending.splice(0));
    await document.fonts.ready;
  };

})();
