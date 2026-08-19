/* ---------- Preloader ----------
   Kept in its own IIFE, first in the file, so the site is always revealed even
   if something later in this script throws. */
(function () {
  'use strict';

  const pre = document.getElementById('preloader');
  if (!pre) return;

  const root = document.documentElement;
  const pop = document.getElementById('preloaderPop');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const MIN_SHOW = reduce ? 200 : 1500;   // let the dots complete a beat
  const CROUCH = reduce ? 0 : 240;        // anticipation before the launch
  const POP = reduce ? 0 : 480;           // middle dot pops, outer two tuck in behind
  const REVEAL = reduce ? 0 : 720;        // circle opening onto the page
  const started = Date.now();

  let closing = false;
  let released = false;

  const release = () => {
    if (released) return;
    released = true;
    root.classList.remove('is-loading');
    pre.classList.add('is-done');
    window.setTimeout(() => pre.remove(), 400);
  };

  // The last dot doesn't fill the screen with colour — it becomes a hole in
  // the black cover, so the page is revealed through it and there is never a
  // flat orange frame in between.
  const openReveal = () => {
    if (!pop) { release(); return; }

    const r = pop.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const r0 = Math.max(1, r.width / 2);
    const r1 = Math.max(
      Math.hypot(cx, cy),
      Math.hypot(window.innerWidth - cx, cy),
      Math.hypot(cx, window.innerHeight - cy),
      Math.hypot(window.innerWidth - cx, window.innerHeight - cy)
    ) * 1.04;

    const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / REVEAL);
      const e = 1 - Math.pow(1 - p, 3);              // ease out, quick then settling
      const rad = r0 + (r1 - r0) * e;
      const g = 'radial-gradient(circle at ' + cx + 'px ' + cy + 'px, transparent ' +
                rad.toFixed(1) + 'px, #000 ' + (rad + 1.5).toFixed(1) + 'px)';
      pre.style.webkitMaskImage = g;
      pre.style.maskImage = g;
      if (p < 1) requestAnimationFrame(step);
      else release();
    };
    requestAnimationFrame(step);

    // If frames stall, hand the page over anyway.
    window.setTimeout(release, REVEAL + 500);
  };

  const close = () => {
    if (closing) return;
    closing = true;

    if (reduce) { release(); return; }

    pre.classList.add('is-anticipating');
    window.setTimeout(() => {
      pre.classList.add('is-exiting');
      window.setTimeout(openReveal, POP);
    }, CROUCH);
  };

  const closeWhenReady = () => {
    window.setTimeout(close, Math.max(0, MIN_SHOW - (Date.now() - started)));
  };

  root.classList.add('is-loading');

  if (document.readyState === 'complete') closeWhenReady();
  else window.addEventListener('load', closeWhenReady);

  // Never let a stalled asset trap the visitor behind the loader.
  window.setTimeout(close, 6000);
  window.setTimeout(release, 9000);
})();

(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Hero poster carousel (continuous 3D cylinder) ---------- */
  const carousel = document.getElementById('posterCarousel');

  if (carousel) {
    const stage = document.getElementById('posterStage');
    const originals = Array.from(stage.querySelectorAll('.poster-card'));

    // Geometry solved from the reference art: 22.5deg between faces, with the
    // cylinder radius and camera distance expressed as multiples of card width.
    const SLOTS = 16;                      // 360 / 22.5 -> the ring closes cleanly
    const step = 360 / SLOTS;
    const RADIUS_F = 3.15;
    const PERSP_F = 3.70;

    // Pad the ring out to a full circle so there is never a gap at the back.
    // Each filler sits 8 slots (180deg) from its original, so a poster and its
    // duplicate can never be on screen together.
    for (let s = originals.length; s < SLOTS; s++) {
      const clone = originals[s - originals.length + 3].cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      clone.tabIndex = -1;
      stage.appendChild(clone);
    }

    const cards = Array.from(stage.querySelectorAll('.poster-card'));
    const total = cards.length;

    let radius = 0;
    const measure = () => {
      const cardW = cards[0].offsetWidth || 320;
      radius = cardW * RADIUS_F;
      carousel.style.perspective = (cardW * PERSP_F) + 'px';
      stage.style.transform = 'translateZ(' + (-radius) + 'px)';
    };

    const SPEED = 4.6;                     // degrees per second, idle drift
    const DEG_PER_PX = 0.14;               // scrolling takes the wheel
    const SWIPE_DEG_PER_PX = 0.24;         // swiping takes it by hand
    const SCROLL_IDLE = 0.18;              // seconds of stillness before auto resumes

    let angle = 0;                         // current cylinder rotation
    let hovered = -1;
    const heat = new Array(total).fill(0); // eased 0..1 highlight per card
    let dragging = false;
    let dragX = 0;
    let dragVel = 0;                       // deg/sec while the finger is down
    let fling = 0;                         // deg/sec carried after release
    let lastMoveTs = 0;
    let lastTs = null;

    // Scrolling drives the ring by hand; hover only takes effect once still.
    let scrollAccum = 0;
    let lastScrollY = window.pageYOffset;
    let scrollIdle = SCROLL_IDLE;
    let scrolling = false;

    // Hover is driven by real cursor movement, never by a card drifting under a
    // cursor that is sitting still. Once engaged it holds the ring briefly and
    // then lets go, so a parked cursor cannot freeze the carousel.
    const HOVER_HOLD = 2500;               // ms the ring waits under the cursor
    let hoverUntil = 0;
    let ptrX = -1, ptrY = -1;
    let ptrLive = false;                   // has the cursor moved since the scroll

    window.addEventListener('scroll', () => {
      const y = window.pageYOffset;
      scrollAccum += y - lastScrollY;
      lastScrollY = y;
      ptrLive = false;                     // a still cursor must not grab a card
      hovered = -1;
    }, { passive: true });

    // Horizontal wheel / trackpad scroll turns the ring, reusing the same path
    // as vertical scrolling: manual while it moves, automatic once it stops.
    carousel.addEventListener('wheel', (e) => {
      const dx = e.deltaX;
      if (Math.abs(dx) <= Math.abs(e.deltaY)) return;   // vertical: leave the page alone
      e.preventDefault();
      scrollAccum += dx;
      ptrLive = false;
      hovered = -1;
    }, { passive: false });

    const cardAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const card = el && el.closest ? el.closest('.poster-card') : null;
      return card ? cards.indexOf(card) : -1;
    };

    const aimHover = (x, y) => {
      const next = cardAt(x, y);
      if (next !== hovered) {
        hovered = next;
        if (next !== -1) hoverUntil = (window.performance ? performance.now() : Date.now()) + HOVER_HOLD;
      }
    };

    const isPaused = () =>
      !scrolling && (hovered !== -1 || carousel.matches(':focus-within'));

    const render = () => {
      for (let i = 0; i < total; i++) {
        const card = cards[i];

        // Signed angle of this face relative to the viewer.
        let a = (i * step - angle) % 360;
        if (a > 180) a -= 360;
        if (a < -180) a += 360;
        const away = Math.abs(a);

        const hot = heat[i];
        const pop = 1 + hot * 0.06;

        card.style.transform =
          'rotateY(' + a + 'deg) translateZ(' + radius + 'px) scale(' + pop + ')';

        // Five faces read at a time, as in the reference; the rest fade off.
        let op = 1;
        if (away > 50) op = Math.max(0, 1 - (away - 50) / 20);
        card.style.opacity = String(op);
        card.style.pointerEvents = op < 0.35 ? 'none' : 'auto';

        // Front poster reads brightest; a hovered one lights up regardless.
        const depthDim = 1 - Math.min(1, away / 70) * 0.5;
        const bright = depthDim + (1 - depthDim) * hot;
        const sat = 0.72 + 0.28 * Math.max(hot, 1 - away / 70);
        card.querySelector('.poster-inner').style.filter =
          'brightness(' + bright.toFixed(3) + ') saturate(' + sat.toFixed(3) + ')';

        card.classList.toggle('is-hot', hot > 0.5);
      }
    };

    const frame = (ts) => {
      if (lastTs === null) lastTs = ts;
      const dt = Math.max(0, Math.min((ts - lastTs) / 1000, 0.05));
      lastTs = ts;

      // Hand over to the scroll while it is moving: the rotation follows the
      // scroll delta, so its speed is the speed of the scroll. Once the page
      // holds still for a moment, the idle drift takes back over.
      if (scrollAccum !== 0) {
        angle = (angle + scrollAccum * DEG_PER_PX) % 360;
        scrollAccum = 0;
        scrollIdle = 0;
      } else {
        scrollIdle += dt;
      }
      scrolling = scrollIdle < SCROLL_IDLE;

      // A swipe keeps spinning after release, easing back to the idle drift.
      if (fling !== 0) {
        angle = (angle + fling * dt) % 360;
        fling *= Math.pow(0.03, dt);       // settles in roughly a third of a second
        if (Math.abs(fling) < 3) fling = 0;
      }

      // The hold expires on its own; re-engaging needs a fresh cursor move.
      if (hovered !== -1 && ts > hoverUntil) hovered = -1;

      const manual = dragging || fling !== 0;
      if (!scrolling && !manual && !isPaused()) angle = (angle + SPEED * dt) % 360;

      // No highlight while the page is moving.
      const k = Math.min(1, dt * 9);
      for (let i = 0; i < total; i++) {
        const target = (!scrolling && !dragging && i === hovered) ? 1 : 0;
        heat[i] += (target - heat[i]) * k;
      }

      render();
      requestAnimationFrame(frame);
    };

    /* Hover follows the cursor's own movement, not the cards passing beneath it. */
    window.addEventListener('pointermove', (e) => {
      if (e.clientX === ptrX && e.clientY === ptrY) return;   // no real movement
      ptrX = e.clientX;
      ptrY = e.clientY;
      ptrLive = true;
      if (!dragging) aimHover(ptrX, ptrY);
    }, { passive: true });

    cards.forEach((card, i) => {
      card.addEventListener('focus', () => {
        hovered = i;
        hoverUntil = (window.performance ? performance.now() : Date.now()) + HOVER_HOLD;
      });
      card.addEventListener('blur', () => { if (hovered === i) hovered = -1; });
      // Clicking a poster brings it round to the front.
      card.addEventListener('click', () => {
        let diff = (i * step - angle) % 360;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        angle += diff;
      });
    });
    carousel.addEventListener('pointerleave', () => { hovered = -1; });

    /* Swipe to spin: direction and speed both come from the gesture. */
    carousel.addEventListener('pointerdown', (e) => {
      dragging = true;
      dragX = e.clientX;
      dragVel = 0;
      fling = 0;
      lastMoveTs = e.timeStamp;
      carousel.classList.add('is-dragging');
      if (carousel.setPointerCapture) {
        try { carousel.setPointerCapture(e.pointerId); } catch (err) { /* not critical */ }
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - dragX;
      if (!dx) return;
      const spun = -dx * SWIPE_DEG_PER_PX;
      angle = (angle + spun) % 360;
      dragX = e.clientX;
      const gap = Math.max(1, e.timeStamp - lastMoveTs) / 1000;
      lastMoveTs = e.timeStamp;
      dragVel = spun / gap;
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      carousel.classList.remove('is-dragging');
      fling = Math.max(-200, Math.min(200, dragVel));   // carry the swipe through
      dragVel = 0;
    };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    let resizeRaf = null;
    window.addEventListener('resize', () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => { measure(); render(); });
    });

    measure();
    render();
    if (!reduceMotion) requestAnimationFrame(frame);
  }

  /* ---------- Hero: scrolling grows the posters and clears everything else ---------- */
  const heroTrack = document.getElementById('top');
  const heroPin = document.getElementById('heroPin');

  if (heroTrack && heroPin && !reduceMotion) {
    const heroCopy = heroPin.querySelector('.hero-inner');
    const heroBeam = heroPin.querySelector('.hero-beam');
    const heroStars = heroPin.querySelector('.hero-stars');
    const heroCards = heroPin.querySelector('.poster-carousel');

    // Geometry is read live each frame rather than cached: the card size is
    // a vh clamp, so any value measured before layout settles is wrong and
    // silently cuts the scrub short.
    // Match the space above the copy to the space below the buttons. The pin
    // centres its content, so leftover height lands above the copy only —
    // which makes the two gaps drift apart as the viewport height changes.
    // Adding X to the carousel's margin grows the lower gap by X and lifts the
    // whole block by X/2, hence the 2/3 correction.
    const balanceHero = () => {
      const nav = document.getElementById('siteHeader');
      if (!nav || !heroCards || !heroCopy) return;

      // Measure the untransformed layout. Both the copy and the carousel carry a
      // scroll transform, and measuring either while it is applied makes the
      // answer depend on where the page happened to be when this ran.
      const heldCards = heroCards.style.transform;
      const heldCopy = heroCopy.style.transform;
      heroCards.style.transform = 'none';
      heroCopy.style.transform = 'none';
      heroCards.style.marginTop = '';

      // Both gaps come from boxes that layout alone decides. The heading and the
      // buttons enter on a translate, and the posters are always mid-spin — read
      // either of those directly and the answer depends on the instant this ran,
      // which is what used to put the copy somewhere different on every refresh.
      // A parent's box ignores its children's transforms, so these do not move.
      //
      // The upper gap is measured against the pin rather than the viewport, so a
      // refresh that restores a scrolled position cannot change the answer.
      const navH = nav.getBoundingClientRect().height;
      let m = parseFloat(window.getComputedStyle(heroCards).marginTop) || 0;

      // Growing the margin by X pushes the carousel down X and lifts the centred
      // stack by X/2, so the gap closes at 3/2 the rate — hence 2/3. That solves
      // it in one step while the stack fits the frame. It stops being exact once
      // the stack is taller than the frame and centring can no longer share the
      // space out evenly, so run it to a fixed point instead of trusting one pass.
      for (let i = 0; i < 4; i++) {
        const copyBox = heroCopy.getBoundingClientRect();
        const above = copyBox.top - heroPin.getBoundingClientRect().top - navH;
        const below = heroCards.getBoundingClientRect().top - copyBox.bottom;
        const step = (above - below) * (2 / 3);
        if (Math.abs(step) < 0.5) break;
        m = Math.max(0, m + step);
        heroCards.style.marginTop = m.toFixed(1) + 'px';
      }
      heroCards.style.marginTop = Math.round(m) + 'px';

      heroCards.style.transform = heldCards;
      heroCopy.style.transform = heldCopy;
    };

    const smooth = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };

    let queued = false;
    const paintHero = () => {
      queued = false;
      const rect = heroTrack.getBoundingClientRect();
      const pinH = heroPin.offsetHeight;
      const cardsH = heroCards ? heroCards.offsetHeight : 0;
      const travel = rect.height - pinH;
      const p = travel <= 0 ? 0 : Math.min(1, Math.max(0, -rect.top / travel));

      // Bring the carousel to the middle of the pin as it grows to fill it.
      const shift = cardsH ? pinH / 2 - (heroCards.offsetTop + cardsH / 2) : 0;
      const grow = cardsH ? Math.min(3, (pinH * 0.94) / cardsH) : 1;

      // Copy and backdrop clear out early, so the posters are alone on black.
      const gone = smooth(0, 0.55, p);
      if (heroCopy) {
        heroCopy.style.opacity = (1 - gone).toFixed(3);
        heroCopy.style.transform = 'translateY(' + (-56 * gone).toFixed(1) + 'px)';
        heroCopy.style.pointerEvents = gone > 0.9 ? 'none' : '';
      }
      const beamFade = 1 - smooth(0, 0.6, p);
      if (heroBeam) heroBeam.style.opacity = beamFade.toFixed(3);

      // Carry the same fade into the bar's tint so the gradient reads as one.
      const bar = document.getElementById('siteHeader');
      if (bar) bar.style.setProperty('--nav-veil', beamFade.toFixed(3));
      if (heroStars) heroStars.style.opacity = (1 - smooth(0, 0.45, p)).toFixed(3);

      // Growth stays linear against scroll, so the posters track the wheel 1:1.
      if (heroCards) {
        heroCards.style.transform =
          'translateY(' + (shift * p).toFixed(1) + 'px) scale(' + (1 + (grow - 1) * p).toFixed(4) + ')';
      }
    };

    const onHeroScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(paintHero);
    };

    window.addEventListener('scroll', onHeroScroll, { passive: true });
    window.addEventListener('resize', () => { balanceHero(); onHeroScroll(); });
    window.addEventListener('load', () => { balanceHero(); onHeroScroll(); });
    // The balance depends on how tall the copy is, and that is not settled at a
    // moment we can name: the display face is loaded with font-display:swap, so
    // the copy is one height before it lands and another after, and how late
    // that is differs between a cold load and a warm one. Rather than guess at
    // the right moment, watch the copy and re-balance whenever its box actually
    // changes. Adjusting the carousel's margin cannot change the copy's height,
    // so this cannot feed back on itself.
    const rebalance = () => { balanceHero(); onHeroScroll(); };
    if (window.ResizeObserver) new ResizeObserver(rebalance).observe(heroCopy);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(rebalance);

    balanceHero();
    paintHero();
  }

  /* ---------- Services: rail image -> half -> list builds -> full bleed ---------- */
  const svcSection = document.getElementById('services');
  const svcTrack = document.getElementById('svcTrack');
  const svcPin = document.getElementById('svcPin');

  if (svcSection && svcTrack && svcPin) {
    const rail = document.getElementById('svcRail');
    const media = document.getElementById('svcMedia');
    const intro = document.getElementById('svcIntro');
    const shade = document.querySelector('.svc-shade');
    const panel = document.getElementById('svcPanel');
    const list = document.getElementById('svcList');
    const items = Array.from(document.querySelectorAll('.svc-item'));
    const shots = Array.from(document.querySelectorAll('.svc-shot'));
    const N = items.length;

    // Front-loaded: the build happens in the first third so that scrolling back
    // up leaves only a short pinned stretch before the section lets go and the
    // previous one comes in.
    const INTRO_OUT = [0.02, 0.12];
    const SPLIT     = [0.06, 0.34];   // the halving, given room to be a movement
    const LIST_IN   = [0.34, 0.46];   // the list forms in one movement
    const LIST_DONE = LIST_IN[1];
    // A short plateau so the finished layout is a place you can rest and use.
    const EXPAND    = [0.54, 0.88];

    const IMG_SHARE = 0.5, GAP = 0.05, RADIUS = 24;
    const IDLE_WAIT = 1400;    // stillness before the images start cycling
    const CYCLE_GAP = 2200;    // how long each one holds

    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const ramp = (a, b, x) => ease(Math.min(1, Math.max(0, (x - a) / (b - a))));
    // Anything that changes the image's geometry is mapped straight through, with
    // no easing: it then moves at exactly the rate the reader is scrolling
    // rather than running ahead of them and settling.
    const track = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));
    const mix = (a, b, t) => a + (b - a) * t;
    const smooth = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };

    let shown = -1;
    const showShot = (i) => {
      if (i === shown || i < 0 || i >= shots.length) return;
      shown = i;
      shots.forEach((s, n) => s.classList.toggle('is-on', n === i));
    };

    let lastP = 0;
    let settled = false;          // once the list has formed it stays formed
    let cycleTimer = null;
    let idleTimer = null;
    let cycleIdx = 0;

    const stopCycle = () => {
      if (cycleTimer) window.clearInterval(cycleTimer);
      cycleTimer = null;
    };
    const startCycle = () => {
      if (cycleTimer) return;
      // Only once the whole list has formed, and never during the expand.
      if (!(settled && lastP < EXPAND[0])) return;
      cycleIdx = shown;
      cycleTimer = window.setInterval(() => {
        cycleIdx = (cycleIdx + 1) % shots.length;
        showShot(cycleIdx);
      }, CYCLE_GAP);
    };
    // Activity pauses the cycle where it is — the poster on screen stays put.
    const rouse = () => {
      stopCycle();
      if (idleTimer) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(startCycle, IDLE_WAIT);
    };

    /* --- hover: gated on real cursor movement while the page is still --- */
    let svcScrolling = false;
    let scrollIdle = null;
    let ptrX = -1, ptrY = -1;

    window.addEventListener('scroll', () => {
      svcScrolling = true;
      if (list) list.classList.remove('hover-on');
      rouse();
      if (scrollIdle) window.clearTimeout(scrollIdle);
      scrollIdle = window.setTimeout(() => { svcScrolling = false; }, 160);
    }, { passive: true });

    window.addEventListener('pointermove', (e) => {
      if (e.clientX === ptrX && e.clientY === ptrY) return;   // no real movement
      ptrX = e.clientX;
      ptrY = e.clientY;
      rouse();
      if (svcScrolling || !list) return;
      list.classList.add('hover-on');
      const el = document.elementFromPoint(ptrX, ptrY);
      const item = el && el.closest ? el.closest('.svc-item') : null;
      if (item) showShot(items.indexOf(item));   // hovering picks the poster
    }, { passive: true });

    items.forEach((el, i) => el.addEventListener('focus', () => showShot(i), true));

    let queued = false;
    const paintSvc = () => {
      queued = false;

      const rect = svcTrack.getBoundingClientRect();
      const pinR = svcPin.getBoundingClientRect();
      const pinW = svcPin.offsetWidth;
      const pinH = svcPin.offsetHeight;
      const travel = rect.height - pinH;
      const p = travel <= 0 ? 0 : Math.min(1, Math.max(0, -rect.top / travel));
      lastP = p;

      const rr = rail.getBoundingClientRect();
      const cs = window.getComputedStyle(rail);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const railL = rr.left - pinR.left + padL;
      const railW = Math.max(0, rr.width - padL - padR);

      const imgH = Math.round(pinH * 0.76);
      const imgT = Math.round((pinH - imgH) / 2);
      const enter = ramp(0, window.innerHeight * 0.8, window.innerHeight * 0.8 - rect.top);

      // Scrolling back reverses the expand, but never the split or the list:
      // once the layout is established it holds, even back at the section top.
      // Leaving upwards entirely resets it, so returning replays the sequence
      // from the opening statement.
      if (rect.top >= window.innerHeight) settled = false;
      if (p >= LIST_DONE) settled = true;
      const split = settled ? 1 : track(SPLIT[0], SPLIT[1], p);
      const expand = track(EXPAND[0], EXPAND[1], p);

      // Only the width changes: the left edge stays on the rail so the image
      // never crosses the margin the nav and every other section share.
      const wA = mix(railW, railW * IMG_SHARE, split);

      media.style.left = mix(railL, 0, expand).toFixed(1) + 'px';
      media.style.width = mix(wA, pinW, expand).toFixed(1) + 'px';
      media.style.top = mix(imgT, 0, expand).toFixed(1) + 'px';
      media.style.height = mix(imgH, pinH, expand).toFixed(1) + 'px';
      media.style.borderRadius = (RADIUS * (1 - expand)).toFixed(1) + 'px';
      // The fade-in belongs to the first approach only; once the layout is
      // established the image stays solid, including on the way back up.
      media.style.opacity = (settled ? 1 : enter).toFixed(3);
      media.style.zIndex = expand > 0.001 ? '4' : '1';

      const gone = settled ? 1 : ramp(INTRO_OUT[0], INTRO_OUT[1], p);
      intro.style.left = railL.toFixed(1) + 'px';
      intro.style.width = wA.toFixed(1) + 'px';
      intro.style.top = imgT + 'px';
      intro.style.height = imgH + 'px';
      intro.style.opacity = ((1 - gone) * enter).toFixed(3);
      // The wash carries the white statement; it thins out as the image halves
      // and is fully gone once the halving has finished.
      if (shade) shade.style.opacity = (1 - split).toFixed(3);
      intro.style.pointerEvents = gone > 0.9 ? 'none' : '';

      const formed = settled ? 1 : ramp(LIST_IN[0], LIST_IN[1], p);
      const panelIn = formed * (1 - track(EXPAND[0], EXPAND[0] + 0.06, p));
      panel.style.left = (railL + railW * (IMG_SHARE + GAP)).toFixed(1) + 'px';
      panel.style.width = (railW * (1 - IMG_SHARE - GAP)).toFixed(1) + 'px';
      panel.style.top = imgT + 'px';
      panel.style.height = imgH + 'px';
      panel.style.opacity = panelIn.toFixed(3);
      panel.style.transform = 'translateY(' + ((1 - formed) * 30).toFixed(1) + 'px)';
      panel.style.pointerEvents = panelIn < 0.6 ? 'none' : '';

      // Whatever poster is on screen is the one that expands — scrolling never
      // changes it, it only stops the cycle so it cannot change mid-expand.
      if (p >= EXPAND[0]) stopCycle();
      if (shown === -1) showShot(opener);
    };

    const onSvcScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(paintSvc);
    };

    // A different one of the six greets you on each visit, statement and all,
    // rather than the section always opening on the same picture. Whichever is
    // drawn is promoted out of lazy loading so it is there when the panel is.
    const opener = Math.floor(Math.random() * shots.length);
    if (shots[opener]) shots[opener].loading = 'eager';

    svcSection.classList.add('is-ready');
    showShot(opener);
    window.addEventListener('scroll', onSvcScroll, { passive: true });
    window.addEventListener('resize', onSvcScroll);
    window.addEventListener('load', onSvcScroll);
    paintSvc();
  }

  /* ---------- How we work: poster zooms out -> splits -> flips -> justifies ---------- */
  const howSection = document.getElementById('process');
  const howTrack = document.getElementById('howTrack');
  const howPin = document.getElementById('howPin');

  if (howSection && howTrack && howPin) {
    const rail = document.getElementById('howRail');
    const title = document.getElementById('howTitle');
    const cards = document.getElementById('howCards');
    const cardEls = Array.from(cards.querySelectorAll('.how-card'));
    const shots = Array.from(cards.querySelectorAll('.how-card__face--shot'));
    const inners = Array.from(cards.querySelectorAll('.how-card__inner'));
    const N = cardEls.length;
    const SRC = cards.getAttribute('data-shot');

    // The zoom follows the scroll. Everything after it is a self-contained
    // animation fired by crossing a scroll mark, so the split and the turn run
    // at their own pace rather than being dragged frame by frame.
    // The entrance is not part of the track at all: it is tied to the section
    // above clearing the screen, so the picture is already fully up by the time
    // this one reaches the top. With the previous section 10% still showing,
    // the picture stands at 90%.
    //
    // The rest is mapped along the track so every movement is followed by a
    // stretch where nothing changes — the holds, in both directions.
    //
    // Nothing waits once the picture has arrived: the very next scroll starts it
    // shrinking, and the heading comes up as the picture gets out of its way, so
    // the two read as one continuous movement. Both are mapped straight through,
    // so they move at exactly the rate the reader scrolls.
    //
    //   approach   0.02            0.26  0.34      0.52              1.00
    //   |  fade  | shrink + heading --|hold|split| hold |   turn + tail    |
    //
    // The turn is ordered well before the foot of the track, and the tail after
    // it is long enough that a turn started on time has finished by the time the
    // reader reaches the end — the exit lock below is then only a safety net,
    // not the thing that normally stops them.
    const ZOOM     = [0.02, 0.26];  // starts on the next scroll, no waiting
    const SPLIT_AT = 0.34;          // then, on further scroll, it breaks into four
    const FLIP_AT  = 0.52;          // and turns, leaving a long tail to run out
    const HOLD_MS  = 600;           // the beat the whole poster is held for
    const SPLIT_MS = 700;
    const FLIP_MS  = 900;
    // The widening is keyed to the turn's angle, not its clock: it runs only
    // while the cards are within ~15deg of edge-on, where they are all but
    // invisible. Half the change lands either side of the crossing.
    const JUST_FROM = 0.415, JUST_TO = 0.585;
    const ASPECT   = 1400 / 900;
    const GAP_PX   = 16;
    const RADIUS   = 16;

    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const ramp = (a, b, x) => ease(Math.min(1, Math.max(0, (x - a) / (b - a))));
    const mix = (a, b, t) => a + (b - a) * t;
    const smooth = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    // Straight through, no easing: anything mapped with this moves at exactly the
    // rate the reader is scrolling instead of running ahead and settling.
    const track = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));
    const now = () => (window.performance && performance.now) ? performance.now() : Date.now();

    shots.forEach((s) => { s.style.backgroundImage = 'url("' + SRC + '")'; });

    // The picture's own proportions, read from the file so swapping the image
    // needs no numbers changing here.
    let shotAspect = ASPECT;
    const probe = new Image();
    probe.onload = () => {
      if (probe.naturalWidth && probe.naturalHeight) {
        shotAspect = probe.naturalWidth / probe.naturalHeight;
        draw();
      }
    };
    probe.src = SRC;

    let revealAt = 0;               // the entrance: opacity and size together
    let zoomAt = 0;                 // eased towards the scroll's zoom target
    let splitAt = 0, splitFrom = 0, splitTo = 0, splitT0 = 0;
    let flipAt = 0, flipFrom = 0, flipTo = 0, flipT0 = 0;
    let justAt = 0;                 // derived from the turn, never scrubbed
    let flipped = false;
    let zoomFullAt = 0;             // when the poster first finished shrinking
    let mergedAt = 0;               // when the cards last became one again
    // Once the picture has settled at its resting size with the heading up, it
    // stays that way: scrolling back up ends there rather than replaying the
    // entrance. Only leaving the section altogether arms it again.
    let formed = false;
    let seen = false;               // has the reader actually been inside the track
    let raf = null;
        let lastP = 0;
    let lastEnter = 0;              // how far the section above has cleared

    // While the cards are apart, or during either held beat, the poster's size
    // is pinned — the scroll cannot pull it back open.
    const pinned = () => formed || splitAt > 0.02 || (mergedAt && now() - mergedAt < HOLD_MS);
    const zoomTarget = () => (pinned() ? 1 : track(ZOOM[0], ZOOM[1], lastP));
    const revealTarget = () => (pinned() ? 1 : lastEnter);

    const setSplit = (v) => {
      if (splitTo === v) return;
      splitFrom = splitAt;
      splitTo = v;
      splitT0 = now();
      kick();
    };
    const setFlip = (v) => {
      if (flipTo === v) return;
      flipFrom = flipAt;
      flipTo = v;
      flipT0 = now();
      kick();
    };

    // A fast wheel/trackpad fling can otherwise carry the viewport past the
    // sticky track before the final turn has a chance to finish. Keep its foot
    // as a hard, non-animated stop until the turn releases it.
    let exitLockY = null;
    const scrollImmediatelyTo = (top) => {
      const root = document.documentElement;
      const previous = root.style.scrollBehavior;
      root.style.scrollBehavior = 'auto';
      window.scrollTo(0, Math.round(top));
      root.style.scrollBehavior = previous;
    };
    const LOCK_MAX_MS = 3000;       // a failsafe: nobody is ever held longer
    let exitLockAt = 0;
    const holdAtTrackFoot = (rect, travel) => {
      const foot = Math.round(rect.top + window.scrollY + travel);
      if (exitLockY === null) { exitLockY = foot; exitLockAt = now(); }
      if (now() - exitLockAt > LOCK_MAX_MS) { exitLockY = null; return; }
      if (Math.abs(window.scrollY - exitLockY) > 1) scrollImmediatelyTo(exitLockY);
    };
    const releaseExitLock = () => { exitLockY = null; };
    const blockExitScroll = (event) => {
      if (exitLockY === null) return;
      if (event.cancelable) event.preventDefault();
      if (Math.abs(window.scrollY - exitLockY) > 1) scrollImmediatelyTo(exitLockY);
    };
    const exitScrollKeys = new Set([' ', 'ArrowDown', 'PageDown', 'End']);
    window.addEventListener('wheel', blockExitScroll, { passive: false });
    window.addEventListener('touchmove', blockExitScroll, { passive: false });
    window.addEventListener('keydown', (event) => {
      if (exitLockY !== null && exitScrollKeys.has(event.key)) event.preventDefault();
    });

    const settleStep = () => {
      const t = now();

      stage(t);

      // Taken straight, not eased towards: any smoothing here would show up as
      // the picture lagging behind the scroll rather than moving with it.
      const rt = revealTarget();
      revealAt = rt;

      // Taken straight, not eased towards: smoothing here reads as the picture
      // lagging behind the scroll rather than answering it.
      const zt = zoomTarget();
      zoomAt = zt;
      if (zoomAt > 0.999 && !zoomFullAt) zoomFullAt = t;
      if (zoomAt > 0.999) formed = true;      // the resting state is now the floor
      if (zoomAt < 0.99) zoomFullAt = 0;

      if (splitTo !== splitAt) {
        const k = Math.min(1, Math.max(0, (t - splitT0) / SPLIT_MS));
        splitAt = splitFrom + (splitTo - splitFrom) * ease(k);
        if (k >= 1) {
          splitAt = splitTo;
          if (splitTo === 0) mergedAt = t;      // start the held beat
        }
      }

      if (flipTo !== flipAt) {
        const k = Math.min(1, Math.max(0, (t - flipT0) / FLIP_MS));
        flipAt = flipFrom + (flipTo - flipFrom) * ease(k);
        if (k >= 1) {
          flipAt = flipTo;
          if (flipTo === 1) releaseExitLock();
        }
      }
      // One movement: the turn carries the widening with it, so the cards come
      // out of the crossing already at their new width.
      justAt = smooth(JUST_FROM, JUST_TO, flipAt);

      // Keep running through either held beat: the beat itself is what opens
      // the next stage, so the sequence must not stall when the scroll stops.
      const holding = (zoomFullAt && t - zoomFullAt < HOLD_MS) ||
                      (mergedAt && t - mergedAt < HOLD_MS);
      // revealAt and zoomAt never "settle" — both are read straight off the scroll.
      return splitAt !== splitTo || flipAt !== flipTo || !!holding;
    };

    const tick = () => {
      const busy = settleStep();
      draw();
      raf = busy ? requestAnimationFrame(tick) : null;
    };
    function kick() { if (!raf) raf = requestAnimationFrame(tick); }

    function draw() {
      const rect = howTrack.getBoundingClientRect();
      const pinR = howPin.getBoundingClientRect();
      const pinH = howPin.offsetHeight;
      const titleH = title.offsetHeight || 0;

      const rr = rail.getBoundingClientRect();
      const cs = window.getComputedStyle(rail);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const railL = rr.left - pinR.left + padL;
      const railW = Math.max(0, rr.width - padL - padR);

      const fullW = railW;
      const fullH = fullW / ASPECT;
      const restH = Math.min(pinH * 0.49, fullH);
      const zoomTo = restH / fullH;

      // One factor for width and height together, so the poster never squashes.
      // It arrives at the size it will be when it splits, opens out to full
      // width, and later comes back down to exactly that same size.
      const k = mix(mix(zoomTo, 1, revealAt), zoomTo, zoomAt);
      const zoomW = fullW * k;
      const zoomH = fullH * k;

      const bandW = mix(zoomW, railW, justAt);
      const bandH = zoomH;

      const cx = railL + railW / 2;
      // The picture is hung from its foot. At full size it sits centred; as it
      // shrinks the bottom edge stays exactly where it was, so the room it gives
      // up opens above it — which is where the heading then arrives.
      const footY = pinH / 2 + fullH / 2;
      cards.style.left = (cx - bandW / 2).toFixed(1) + 'px';
      cards.style.top = (footY - bandH).toFixed(1) + 'px';
      cards.style.width = bandW.toFixed(1) + 'px';
      cards.style.height = bandH.toFixed(1) + 'px';
      cards.style.opacity = revealAt.toFixed(3);

      // The heading rides the picture's own top edge, always the same distance
      // above it. That is what lets it arrive on the very same progress as the
      // shrink without ever sitting on the picture: while the picture still
      // fills the frame the heading is above the top of it, out of sight, and it
      // descends into place exactly as the picture draws back. It reaches its
      // final state at the moment the picture reaches its final size.
      const titleGap = Math.max(32, Math.min(72, pinH * 0.08));
      const titleTop = footY - bandH - titleGap - titleH;

      title.style.left = railL.toFixed(1) + 'px';
      title.style.width = railW.toFixed(1) + 'px';
      title.style.top = titleTop.toFixed(1) + 'px';
      title.style.opacity = zoomAt.toFixed(3);
      title.style.transform = 'scale(' + mix(0.96, 1, zoomAt).toFixed(4) + ')';

      const gap = GAP_PX * splitAt;
      const cardW = (bandW - gap * (N - 1)) / N;
      cards.style.gap = gap.toFixed(2) + 'px';

      // Sized to the band it currently spans, so the four slices always add back
      // up to one continuous picture. The width is what has to match, so the
      // picture keeps its own shape and is hung from the top — whatever extra
      // height that leaves simply runs off the bottom of the cards.
      const imgW = bandW;
      const imgH = imgW / shotAspect;
      const imgY = 0;
      const deg = (180 * flipAt).toFixed(2) + 'deg';

      for (let i = 0; i < N; i++) {
        cardEls[i].style.width = cardW.toFixed(2) + 'px';
        cardEls[i].style.setProperty('--card-r', (RADIUS * splitAt).toFixed(1) + 'px');
        cardEls[i].style.setProperty('--edge', (0.16 * splitAt).toFixed(3));
        inners[i].style.transform = 'rotateY(' + deg + ')';
        shots[i].style.backgroundSize = imgW.toFixed(1) + 'px ' + imgH.toFixed(1) + 'px';
        shots[i].style.backgroundPosition =
          (-(i * (cardW + gap))).toFixed(1) + 'px ' + imgY.toFixed(1) + 'px';
      }
    }

    // Which stage the section should be in. Driven by the scroll mark the reader
    // has passed *and* by the held beats, so it is re-checked every frame — a
    // beat that runs out while the reader sits still still opens the next step.
    function stage(t) {
      // Split only once the poster has finished shrinking AND been held for a
      // beat, so the whole picture and the heading get a moment on their own.
      // At the very end of the track there is no room left to spend on the beat;
      // making it wait there is what let a fast reader out before the turn.
      const held = zoomFullAt && (t - zoomFullAt >= HOLD_MS || lastP > 0.97);
      if (lastP >= SPLIT_AT && held) setSplit(1);
      // Coming back, the cards turn round first and only then close up, so the
      // two movements never overlap however fast the page is scrolled.
      if (lastP < SPLIT_AT && flipAt < 0.01) setSplit(0);

      // The turn. The widening rides along with it, out and back.
      const wantFlip = lastP >= FLIP_AT && splitAt > 0.98;
      if (wantFlip !== flipped) {
        flipped = wantFlip;
        cards.classList.toggle('is-flipped', flipped);
        setFlip(flipped ? 1 : 0);
      }
      // Hover only once the step cards are fully facing the reader.
      cards.classList.toggle('is-live', flipAt > 0.995);
    }

    const onScrollHow = () => {
      const rect = howTrack.getBoundingClientRect();
      const pinH = howPin.offsetHeight;
      const travel = rect.height - pinH;
      const raw = travel <= 0 ? 0 : -rect.top / travel;
      lastP = Math.min(1, Math.max(0, raw));

      // Straight off the section above: 1 when it has gone, 0 while it still
      // fills the screen. Pegged to the scroll, so it moves at the reader's rate.
      const vh = window.innerHeight || 1;
      lastEnter = Math.min(1, Math.max(0, 1 - rect.top / vh));

      // Dropping back below the fold clears the section down, so coming at it
      // again replays the whole sequence from the picture fading up.
      if (rect.top >= vh) { formed = false; seen = false; }
      if (raw >= 0 && raw <= 1) seen = true;

      // At or beyond the track's foot, wait for the final turn to land before
      // allowing the following section onto the screen. This lock is immediate
      // (rather than a smooth scroll correction), so it cannot flash or shake
      // the next section during a fast fling.
      // Only for a reader on their way down through the section. Coming up at it
      // from the section below, the sequence has not run yet and locking them out
      // at the foot would stop them entering at all.
      if (raw >= 1 && seen && flipAt < 0.999) holdAtTrackFoot(rect, travel);
      if (raw < 1) releaseExitLock();

      kick();
    };

    howSection.classList.add('is-ready');
    window.addEventListener('scroll', onScrollHow, { passive: true });
    window.addEventListener('resize', onScrollHow);
    window.addEventListener('load', onScrollHow);
    onScrollHow();
    draw();
  }

  /* ---------- Brand story: lines blur-swap in time with each ripple ---------- */
  const storySection = document.getElementById('story');
  const storyLines = document.getElementById('storyLines');

  if (storySection && storyLines) {
    const lines = Array.from(storyLines.querySelectorAll('.story-line'));
    const wave = document.getElementById('storyWave');

    // Ripple cadence (kept in step with PERIOD/PULSES in the canvas below).
    const SPAWN_MS = 2400;

    // The crossfade spans a fraction of one ripple, so the copy breathes at the
    // same tempo as the wave. Both lines move together over this window, so one
    // is always arriving as the other leaves.
    const FADE = Math.round(SPAWN_MS * 0.44);
    storyLines.style.setProperty('--fade', FADE + 'ms');

    let current = -1;
    const show = (next) => {
      if (next === current) return;
      const prev = lines[current];
      if (prev) {
        prev.classList.remove('is-in');
        prev.classList.add('is-out');
        window.setTimeout(() => prev.classList.remove('is-out'), FADE + 90);
      }
      current = next;
      lines[current].classList.remove('is-out');
      lines[current].classList.add('is-in');
    };
    const advance = () => show((current + 1) % lines.length);

    // is-ready hands control to JS; without it the CSS just shows the first
    // line statically, so the section still reads with scripting disabled.
    storyLines.classList.add('is-ready');

    if (reduceMotion) {
      storyLines.classList.add('no-motion');
      lines.forEach((l) => l.classList.add('is-in'));
    } else {
      show(0);
    }

    /* ---- circular ripple of dots, spreading from the centre ---- */
    if (wave && wave.getContext && !reduceMotion) {
      const ctx = wave.getContext('2d');

      // Measured off the reference: dots sit on a fixed lattice and only their
      // radius changes, and the motion is a single pulse born at the centre
      // that travels outward and fades — not a continuous wave train.
      const PULSES = 2;                      // overlapped, so one is always travelling
      const SPAWN = SPAWN_MS / 1000;         // a new ripple every 2.4s
      const PERIOD = SPAWN * PULSES;         // seconds for one ripple to cross
      const BUCKETS = 12;                    // alpha groups: 12 fills, not ~1500

      let dpr = 1, w = 0, h = 0, gap = 34, radius = 0, cols = 0, rows = 0, ox = 0, oy = 0;
      let sigma = 100, reach = 0;

      const smoothstep = (a, b, x) => {
        const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
      };

      const resize = () => {
        const rect = wave.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = rect.width; h = rect.height;
        wave.width = Math.round(w * dpr);
        wave.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        gap = Math.max(30, Math.round(Math.sqrt((w * h) / 1500)));
        radius = Math.min(w * 0.38, h * 0.46);
        cols = Math.ceil((radius * 2) / gap) + 1;
        rows = cols;
        ox = w / 2 - ((cols - 1) * gap) / 2;
        oy = h / 2 - ((rows - 1) * gap) / 2;
        sigma = radius * 0.3;
        reach = radius * 1.3;
      };

      const paths = new Array(BUCKETS);

      const draw = (t) => {
        if (!w || !h) return;
        ctx.clearRect(0, 0, w, h);
        for (let b = 0; b < BUCKETS; b++) paths[b] = new Path2D();

        const cx = w / 2, cy = h / 2;
        const fadeFrom = radius * 0.42;

        const ringR = [], ringAmp = [];
        for (let k = 0; k < PULSES; k++) {
          const ph = ((t / PERIOD) + k / PULSES) % 1;
          ringR.push(ph * reach);
          ringAmp.push(smoothstep(0, 0.1, ph) * (1 - smoothstep(0.55, 1, ph)));
        }

        for (let iy = 0; iy < rows; iy++) {
          const y = oy + iy * gap;
          for (let ix = 0; ix < cols; ix++) {
            const x = ox + ix * gap;

            const d = Math.hypot(x - cx, y - cy);
            if (d > radius) continue;                   // circular boundary

            let n = 0;
            for (let k = 0; k < PULSES; k++) {
              if (ringAmp[k] <= 0) continue;
              const z = (d - ringR[k]) / sigma;
              n += ringAmp[k] * Math.exp(-z * z);
            }
            if (n > 1) n = 1;

            let edge = 1;
            if (d > fadeFrom) {
              const e = 1 - (d - fadeFrom) / (radius - fadeFrom);
              edge = e * e * (3 - 2 * e);
            }
            if (edge <= 0.004) continue;

            const r = 0.6 + n * 1.75;                   // small dots: 1.2 - 4.7px
            const alpha = (0.16 + n * 0.84) * edge;

            let b = (alpha * BUCKETS) | 0;
            if (b > BUCKETS - 1) b = BUCKETS - 1;
            const p = paths[b];
            p.moveTo(x + r, y);
            p.arc(x, y, r, 0, Math.PI * 2);
          }
        }

        // Brand amber, brightening towards the crest of the ripple.
        for (let b = 0; b < BUCKETS; b++) {
          ctx.fillStyle = b < BUCKETS / 2 ? '#b9791a' : '#f2b44a';
          ctx.globalAlpha = (b + 0.5) / BUCKETS;
          ctx.fill(paths[b]);
        }
        ctx.globalAlpha = 1;
      };

      // Each new ripple leaving the centre swaps the line.
      let lastSpawn = -1;
      const tick = (t) => {
        const spawn = Math.floor(t / SPAWN);
        if (lastSpawn === -1) lastSpawn = spawn;
        else if (spawn !== lastSpawn) {
          lastSpawn = spawn;
          advance();
        }
      };

      let running = false;
      let raf = null;
      const loop = (ts) => {
        const t = ts / 1000;
        draw(t);
        tick(t);
        raf = requestAnimationFrame(loop);
      };
      const play = () => {
        if (running) return;
        running = true;
        lastSpawn = -1;                                 // re-sync after a pause
        raf = requestAnimationFrame(loop);
      };
      const pause = () => {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = null;
      };

      resize();
      draw(0);

      if ('IntersectionObserver' in window) {
        new IntersectionObserver((entries) => {
          entries.forEach((e) => (e.isIntersecting ? play() : pause()));
        }, { threshold: 0 }).observe(storySection);
      } else {
        play();
      }

      let rrf = null;
      window.addEventListener('resize', () => {
        if (rrf) cancelAnimationFrame(rrf);
        rrf = requestAnimationFrame(() => { resize(); draw(0); });
      });
    }
  }

  /* ---------- Sticky header shadow ---------- */
  const header = document.getElementById('siteHeader');
  const heroSection = document.getElementById('top');
  const onScrollHeader = () => {
    // Wait until the hero's light is gone; switching the bar at 10px made it
    // look like a separate panel turning off on its own.
    const travel = heroSection
      ? heroSection.offsetHeight - window.innerHeight
      : 0;
    const trigger = travel > 0 ? travel * 0.62 : 10;
    header.classList.toggle('scrolled', window.pageYOffset > trigger);
  };
  onScrollHeader();
  window.addEventListener('scroll', onScrollHeader, { passive: true });

  /* ---------- Mobile nav toggle ---------- */
  const navToggle = document.getElementById('navToggle');
  const mainNav = document.getElementById('mainNav');

  navToggle.addEventListener('click', () => {
    const isOpen = mainNav.classList.toggle('open');
    navToggle.classList.toggle('open', isOpen);
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  mainNav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      mainNav.classList.remove('open');
      navToggle.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });

  /* ---------- Active nav link on scroll ---------- */
  const navLinks = Array.from(document.querySelectorAll('.nav-link'));
  const sections = navLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const link = navLinks.find((l) => l.getAttribute('href') === `#${entry.target.id}`);
          if (!link) return;
          if (entry.isIntersecting) {
            navLinks.forEach((l) => l.classList.remove('active'));
            link.classList.add('active');
          }
        });
      },
      { rootMargin: '-40% 0px -55% 0px', threshold: 0 }
    );
    sections.forEach((section) => sectionObserver.observe(section));
  }

  /* ---------- Reveal on scroll ---------- */
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    revealEls.forEach((el) => revealObserver.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('in-view'));
  }

  /* ---------- Animated stat counters ---------- */
  const statNumbers = document.querySelectorAll('.stat-number');
  const animateCount = (el) => {
    const target = parseInt(el.dataset.target, 10) || 0;
    const duration = 1400;
    const start = performance.now();

    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      // The unit sits in its own element beside this one, so only the figure
      // is written here — that is what lets the unit carry the accent colour.
      el.textContent = Math.round(eased * target);
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  if (statNumbers.length) {
    if ('IntersectionObserver' in window) {
      const statObserver = new IntersectionObserver(
        (entries, observer) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              animateCount(entry.target);
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.5 }
      );
      statNumbers.forEach((el) => statObserver.observe(el));
    } else {
      statNumbers.forEach(animateCount);
    }
  }

  /* ---------- Title strip: a hover holds and lights one card, then releases ---------- */
  const titleStrip = document.getElementById('titleStrip');

  if (titleStrip) {
    const titleTrack = titleStrip.querySelector('.title-track');
    const HOLD = 2600;              // how long the card stays held and lit

    let holdTimer = null;
    let litCard = null;
    let ptrX = -1, ptrY = -1;

    const release = () => {
      if (holdTimer) window.clearTimeout(holdTimer);
      holdTimer = null;
      if (litCard) litCard.classList.remove('is-lit');
      litCard = null;
      if (titleTrack) titleTrack.classList.remove('is-paused');
    };

    const hold = (card) => {
      if (holdTimer) window.clearTimeout(holdTimer);
      if (litCard && litCard !== card) litCard.classList.remove('is-lit');
      litCard = card;
      card.classList.add('is-lit');
      if (titleTrack) titleTrack.classList.add('is-paused');
      // After a beat the card drops back to normal and the strip rolls on.
      holdTimer = window.setTimeout(release, HOLD);
    };

    // Driven by real cursor movement rather than pointerover: moving sideways
    // from one card to the next must light the new one, while a cursor sitting
    // still must not keep re-catching cards as they slide underneath it.
    window.addEventListener('pointermove', (e) => {
      if (e.clientX === ptrX && e.clientY === ptrY) return;
      ptrX = e.clientX;
      ptrY = e.clientY;
      const el = document.elementFromPoint(ptrX, ptrY);
      const card = el && el.closest ? el.closest('.title-card') : null;
      if (!card) return;                      // cursor is not over the strip
      if (card === litCard) return;           // already holding this one
      hold(card);
    }, { passive: true });

    titleStrip.addEventListener('pointerleave', release);
  }

  /* ---------- Contact form validation ---------- */
  const contactForm = document.getElementById('contactForm');
  const submitBtn = document.getElementById('submitBtn');
  const formStatus = document.getElementById('formStatus');

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const setFieldError = (id, message) => {
    const field = document.getElementById(id);
    const errorEl = document.getElementById(`${id}Error`);
    const group = field.closest('.form-group');
    group.classList.toggle('has-error', Boolean(message));
    errorEl.textContent = message || '';
  };

  const validateContactForm = () => {
    let valid = true;

    const name = document.getElementById('name').value.trim();
    if (!name) {
      setFieldError('name', 'Please enter your name.');
      valid = false;
    } else {
      setFieldError('name', '');
    }

    const email = document.getElementById('email').value.trim();
    if (!email || !emailPattern.test(email)) {
      setFieldError('email', 'Please enter a valid email address.');
      valid = false;
    } else {
      setFieldError('email', '');
    }

    const projectType = document.getElementById('projectType').value;
    if (!projectType) {
      setFieldError('projectType', 'Please select a project type.');
      valid = false;
    } else {
      setFieldError('projectType', '');
    }

    const message = document.getElementById('message').value.trim();
    if (message.length < 10) {
      setFieldError('message', 'Please tell us a bit more (10+ characters).');
      valid = false;
    } else {
      setFieldError('message', '');
    }

    return valid;
  };

  // The Apps Script web app behind the sheet. Swap this if the script is
  // redeployed — a new deployment issues a new /exec URL.
  const SHEET_ENDPOINT =
    'https://script.google.com/macros/s/AKfycbxoleaMYu0xrQjBupHy7CqG_1E939fyn7CTOMUaKGXbyWiWaJjufKoQ7__wstQTB5XH/exec';

  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      if (!validateContactForm()) {
        formStatus.textContent = 'Please fix the highlighted fields and try again.';
        formStatus.className = 'form-status error';
        return;
      }

      const label = submitBtn.querySelector('.btn-text');
      submitBtn.disabled = true;
      label.textContent = 'Sending...';
      formStatus.textContent = '';
      formStatus.className = 'form-status';

      // Sent as a simple request — url-encoded body, no custom headers — so the
      // browser does not preflight it, which an Apps Script web app will not
      // answer. The reply cannot be read back across origins, so this is sent
      // once and not retried: a retry would post the row to the sheet twice.
      const body = new URLSearchParams(new FormData(contactForm));
      body.append('submittedAt', new Date().toISOString());

      try {
        await fetch(SHEET_ENDPOINT, { method: 'POST', mode: 'no-cors', body });
        formStatus.textContent = "Thanks! Your message has been sent — we'll be in touch within one business day.";
        formStatus.className = 'form-status success';
        contactForm.reset();
      } catch (err) {
        formStatus.textContent =
          'Sorry — that could not be sent. Please check your connection and try again, or email hello@idealdots.studio.';
        formStatus.className = 'form-status error';
      } finally {
        submitBtn.disabled = false;
        label.textContent = 'Send Message';
      }
    });

    contactForm.querySelectorAll('input, select, textarea').forEach((field) => {
      field.addEventListener('input', () => {
        if (field.closest('.form-group').classList.contains('has-error')) {
          validateContactForm();
        }
      });
    });
  }

  /* ---------- Newsletter form ---------- */
  const newsletterForm = document.getElementById('newsletterForm');
  const newsletterStatus = document.getElementById('newsletterStatus');

  if (newsletterForm) {
    newsletterForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const emailField = document.getElementById('newsletterEmail');
      const email = emailField.value.trim();

      if (!emailPattern.test(email)) {
        newsletterStatus.textContent = 'Please enter a valid email address.';
        return;
      }

      newsletterStatus.textContent = "You're on the list!";
      newsletterForm.reset();
    });
  }

  /* ---------- Back to top ---------- */
  const backToTop = document.getElementById('backToTop');
  window.addEventListener('scroll', () => {
    backToTop.classList.toggle('visible', window.scrollY > 500);
  }, { passive: true });

  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ---------- Decorative cursor dot ---------- */
  const dotCursor = document.getElementById('dotCursor');
  if (dotCursor && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    window.addEventListener('mousemove', (e) => {
      dotCursor.style.left = `${e.clientX}px`;
      dotCursor.style.top = `${e.clientY}px`;
    });

    document.querySelectorAll('a, button').forEach((el) => {
      el.addEventListener('mouseenter', () => {
        dotCursor.style.width = '32px';
        dotCursor.style.height = '32px';
        dotCursor.style.opacity = '0.25';
      });
      el.addEventListener('mouseleave', () => {
        dotCursor.style.width = '18px';
        dotCursor.style.height = '18px';
        dotCursor.style.opacity = '0.5';
      });
    });
  }

  /* ---------- Footer year ---------- */
  document.getElementById('year').textContent = new Date().getFullYear();
})();
