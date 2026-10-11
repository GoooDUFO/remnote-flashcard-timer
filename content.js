/* RemNote Flashcard Timer — content script
 *
 * Draws a floating countdown next to the RemNote flashcard queue and resets it
 * every time the card changes. See README.md for how card changes are detected.
 */
(() => {
  const HOST_ID = 'rn-flashcard-timer-host';
  if (document.getElementById(HOST_ID)) return; // already injected

  const DEFAULTS = {
    enabled: true,
    duration: 20,        // seconds per card
    sound: true,         // beep when time runs out
    warn: true,          // softer cue when a quarter of the time is left
    overtime: true,      // keep counting up past zero
    pauseHidden: true,   // pause while the tab is in the background
    pauseOnAnswer: true, // stop counting once the answer / review step is up
    debug: false,        // show the diagnostic panel
    onlyInQueue: true,   // hide unless a flashcard queue is on screen

    // Overtime budget. A card answered past the limit spends one token; every
    // `gameRefillEvery` cards, `gameRefillAmount` tokens come back.
    game: true,
    gameTokens: 5,
    gameRefillEvery: 50,
    gameRefillAmount: 5,
  };

  let opts = { ...DEFAULTS };

  /* ------------------------------------------------------------------ *
   * Widget
   * ------------------------------------------------------------------ */

  const RADIUS = 26;
  const CIRC = 2 * Math.PI * RADIUS;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'position:fixed;top:96px;right:24px;z-index:2147483647;' +
    'width:auto;height:auto;margin:0;padding:0;';

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .wrap {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 8px 8px 6px;
        border-radius: 16px;
        background: rgba(24, 24, 30, 0.82);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
        cursor: grab;
        user-select: none;
        -webkit-user-select: none;
        transition: opacity 0.15s ease;
      }
      .wrap.dragging { cursor: grabbing; }
      .wrap.paused { opacity: 0.55; }
      /* Frozen because the answer / review step is showing, not by the user. */
      .wrap.review { opacity: 0.5; }
      .ico-play { display: none; }
      .wrap.paused .ico-pause { display: none; }
      .wrap.paused .ico-play { display: block; }
      .dial { position: relative; width: 64px; height: 64px; }
      svg { display: block; transform: rotate(-90deg); }
      .track { stroke: rgba(255, 255, 255, 0.14); }
      .bar {
        stroke-linecap: round;
        stroke-dasharray: ${CIRC};
        transition: stroke-dashoffset 0.12s linear, stroke 0.3s ease;
      }
      .label {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 19px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.5px;
        color: #fff;
      }
      .label.over { color: #ff6b6b; }
      .controls {
        display: flex;
        gap: 2px;
        opacity: 0;
        transition: opacity 0.15s ease;
      }
      .wrap:hover .controls, .wrap.paused .controls { opacity: 1; }
      button {
        all: unset;
        cursor: pointer;
        width: 22px;
        height: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 5px;
        color: rgba(255, 255, 255, 0.65);
      }
      button:hover { background: rgba(255, 255, 255, 0.13); color: #fff; }
      button svg { transform: none; }

      /* Score row. Deliberately small and static — it reports, it doesn't
         compete with the card. No motion except the refill flash. */
      .game {
        display: none;
        align-items: center;
        gap: 5px;
        font-size: 10px;
        line-height: 1;
        font-variant-numeric: tabular-nums;
        color: rgba(255, 255, 255, 0.75);
      }
      .wrap.gameon .game { display: flex; }
      .pips { letter-spacing: 1px; }
      .pips .left { color: #7dd3a0; }
      .pips .spent { color: rgba(255, 255, 255, 0.25); }
      .pips.empty .left, .pips.empty .spent { color: #ff6b6b; }
      .streak { color: rgba(255, 255, 255, 0.8); }
      .refill {
        color: #7dd3a0;
        opacity: 0;
        transition: opacity 0.4s ease;
      }
      .refill.show { opacity: 1; }
    </style>
    <div class="wrap" part="wrap">
      <div class="dial">
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle class="track" cx="32" cy="32" r="${RADIUS}" fill="none" stroke-width="5"></circle>
          <circle class="bar" cx="32" cy="32" r="${RADIUS}" fill="none" stroke-width="5"
                  stroke="#4ade80" stroke-dashoffset="0"></circle>
        </svg>
        <div class="label">0</div>
      </div>
      <div class="game" part="game">
        <span class="pips"></span>
        <span class="streak"></span>
        <span class="refill"></span>
      </div>
      <div class="controls">
        <button class="pause" title="Pause">
          <svg class="ico-pause" width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
            <rect x="2" y="1.5" width="3" height="9" rx="1"></rect>
            <rect x="7" y="1.5" width="3" height="9" rx="1"></rect>
          </svg>
          <svg class="ico-play" width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
            <path d="M3 1.8 L10 6 L3 10.2 Z"></path>
          </svg>
        </button>
        <button class="reset" title="Restart this card's timer">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
               stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <path d="M10 6a4 4 0 1 1-1.3-2.95"></path>
            <path d="M10.4 1.4V4H7.8"></path>
          </svg>
        </button>
      </div>
    </div>
  `;

  const wrapEl = shadow.querySelector('.wrap');
  const barEl = shadow.querySelector('.bar');
  const labelEl = shadow.querySelector('.label');
  const pauseBtn = shadow.querySelector('.pause');
  const resetBtn = shadow.querySelector('.reset');
  const gameEl = shadow.querySelector('.game');
  const pipsEl = shadow.querySelector('.pips');
  const streakEl = shadow.querySelector('.streak');
  const refillEl = shadow.querySelector('.refill');

  document.documentElement.appendChild(host);

  /* ------------------------------------------------------------------ *
   * Timer state
   * ------------------------------------------------------------------ */

  let remainingMs = DEFAULTS.duration * 1000;
  let lastTick = performance.now();
  let userPaused = false;
  let firedZero = false;
  let firedWarn = false;
  let inQueue = false;
  // 'question' | 'answer' | null — set by the detection section below. Declared
  // here because the timer needs it to know when the review step is up.
  let phase = null;

  // RemNote shows the answer and a "were you right?" review step before the
  // next card. The countdown is for recall time, so it stops there.
  function reviewing() {
    return opts.pauseOnAnswer && phase === 'answer';
  }

  function resetTimer() {
    remainingMs = opts.duration * 1000;
    firedZero = false;
    firedWarn = false;
    lastTick = performance.now();
    render();
  }

  /* ------------------------------------------------------------------ *
   * Overtime budget
   *
   * A card is judged the moment recall ends — when the answer comes up, or
   * when the next card is dealt if we never saw an answer step. Beating the
   * clock extends a streak; missing it spends a token. Tokens come back in
   * batches so a bad run isn't permanent.
   * ------------------------------------------------------------------ */

  const GAME_DEFAULTS = {
    tokens: DEFAULTS.gameTokens,
    streak: 0,
    bestStreak: 0,
    cardsDone: 0,
    onTime: 0,
    sinceRefill: 0,
  };
  let game = { ...GAME_DEFAULTS };
  let cardScored = true; // nothing in flight yet
  let saveHandle = null;
  let lastWritten = ''; // what we last put in storage, to spot our own echo

  function saveGame() {
    if (saveHandle) return; // coalesce — reviewing can be fast
    saveHandle = setTimeout(() => {
      saveHandle = null;
      lastWritten = JSON.stringify(game);
      // Write a copy: handing over the live object would let later mutations
      // leak into storage without a write, and mask what was actually saved.
      chrome.storage.local.set({ game: JSON.parse(lastWritten) });
    }, 600);
  }

  function beginCard() {
    cardScored = false;
  }

  function scoreCard(wentOver) {
    if (cardScored) return;
    cardScored = true;
    if (!opts.game) return;
    note('scored: ' + (wentOver ? 'OVER' : 'in time') + ' (' + (remainingMs / 1000).toFixed(1) + 's)');

    game.cardsDone++;
    game.sinceRefill++;

    if (wentOver) {
      game.tokens = Math.max(0, game.tokens - 1);
      game.streak = 0;
    } else {
      game.onTime++;
      game.streak++;
      game.bestStreak = Math.max(game.bestStreak, game.streak);
    }

    if (game.sinceRefill >= Math.max(1, opts.gameRefillEvery)) {
      game.sinceRefill = 0;
      const before = game.tokens;
      game.tokens = Math.min(opts.gameTokens, game.tokens + opts.gameRefillAmount);
      if (game.tokens > before) flashRefill(game.tokens - before);
    }

    saveGame();
    renderGame();
  }

  let refillHandle = null;
  function flashRefill(n) {
    refillEl.textContent = '+' + n;
    refillEl.classList.add('show');
    clearTimeout(refillHandle);
    refillHandle = setTimeout(() => refillEl.classList.remove('show'), 2600);
  }

  function renderGame() {
    wrapEl.classList.toggle('gameon', !!opts.game);
    if (!opts.game) return;

    const max = Math.max(1, opts.gameTokens);
    const left = Math.max(0, Math.min(max, game.tokens));

    // Pips while there are few enough to read at a glance, a count beyond that.
    if (max <= 8) {
      pipsEl.innerHTML =
        '<span class="left">' + '●'.repeat(left) + '</span>' +
        '<span class="spent">' + '○'.repeat(max - left) + '</span>';
    } else {
      pipsEl.innerHTML = '<span class="left">● ' + left + '</span>';
    }
    pipsEl.classList.toggle('empty', left === 0);
    pipsEl.title = left + ' of ' + max + ' overtime allowances left';

    streakEl.textContent = game.streak >= 3 ? '🔥' + game.streak : '';
    streakEl.title = 'Best streak: ' + game.bestStreak;
  }

  function tick() {
    const now = performance.now();
    const dt = now - lastTick;
    lastTick = now;

    const frozen =
      userPaused || reviewing() || !inQueue || (opts.pauseHidden && document.hidden);
    if (frozen) return;

    remainingMs -= dt;

    // A quarter of the way from the end, while there's still time to act on it.
    if (!firedWarn && remainingMs > 0 && remainingMs <= opts.duration * 1000 * WARN_AT) {
      firedWarn = true;
      softCue();
    }

    if (remainingMs <= 0) {
      if (!firedZero) {
        firedZero = true;
        firedWarn = true; // a very short card can cross both in one tick
        beep();
      }
      if (!opts.overtime) remainingMs = 0;
    }
    render();
  }

  function render() {
    const total = Math.max(1, opts.duration) * 1000;
    const over = remainingMs <= 0;
    const secs = remainingMs / 1000;

    if (over) {
      labelEl.textContent = '+' + Math.floor(-secs);
      labelEl.classList.add('over');
      barEl.setAttribute('stroke-dashoffset', String(CIRC));
      barEl.setAttribute('stroke', '#ff6b6b');
    } else {
      const frac = Math.min(1, remainingMs / total);
      labelEl.textContent = String(Math.ceil(secs));
      labelEl.classList.remove('over');
      barEl.setAttribute('stroke-dashoffset', String(CIRC * (1 - frac)));
      barEl.setAttribute('stroke', frac > 0.5 ? '#4ade80' : frac > 0.2 ? '#fbbf24' : '#fb7185');
    }

    wrapEl.classList.toggle('paused', userPaused);
    wrapEl.classList.toggle('review', !userPaused && reviewing());
    pauseBtn.title = userPaused ? 'Resume' : 'Pause';

    // The timer gets out of the way on the review step. It stays put in debug
    // mode, otherwise the diagnostic panel would vanish exactly when you're
    // trying to watch the review step.
    const hideForReview = reviewing() && !opts.debug;
    const shown = opts.enabled && (inQueue || !opts.onlyInQueue) && !hideForReview;
    host.style.display = shown ? '' : 'none';
  }

  let audioCtx = null;
  // Fraction of the card's time remaining when the soft cue plays.
  const WARN_AT = 0.25;

  function tone({ freq, peak, attack, release }) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
      osc.start(t);
      osc.stop(t + attack + release + 0.02);
    } catch (_) {
      /* autoplay blocked until the user interacts with the page — ignore */
    }
  }

  // Time's up: brighter and firmer.
  function beep() {
    if (!opts.sound) return;
    tone({ freq: 880, peak: 0.14, attack: 0.01, release: 0.31 });
  }

  // A quarter left: lower, a third the volume, and eased in rather than
  // struck, so it registers without pulling you off the card.
  function softCue() {
    if (!opts.warn) return;
    tone({ freq: 587.33, peak: 0.045, attack: 0.06, release: 0.5 });
  }

  /* ------------------------------------------------------------------ *
   * Card-change detection
   *
   * RemNote generates its class names, so nothing here keys off a specific
   * selector. Three independent signals drive the reset, strongest first:
   *
   *   1. The answer->question flip. When the rating row (Again/Hard/Good/Easy)
   *      is replaced by the reveal control, a new card has been dealt. This
   *      needs no knowledge of the card's markup at all.
   *   2. An explicit rating: a click on a rating button, or 1-4 / space on the
   *      keyboard. Resets instantly rather than waiting for the DOM.
   *   3. The card's text changing, measured inside a region derived from the
   *      buttons rather than from a hardcoded selector.
   * ------------------------------------------------------------------ */

  const REVEAL_RE = /\b(show\s+answer|show\s+back|reveal|flip|space\s+to\s+(show|reveal))\b/i;
  const RATING_RE =
    /\b(again|hard|good|easy|forgot|remembered|partial(ly)?|unsure|skip|next|continue|correct|incorrect|got\s+it|(did\s*n[o']?t|do\s*n[o']?t)\s+know)\b/i;
  const CONTROL_SEL =
    'button, [role="button"], input, textarea, select, nav, [role="navigation"], [role="toolbar"], [role="menu"]';
  const SIG_LIMIT = 400;

  function isVisible(el) {
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true });
    }
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function norm(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  // Text of a subtree with controls stripped out. Button labels are excluded
  // because they change on reveal ("Show Answer" -> "Again/Hard/Good/Easy")
  // while the card itself has not changed.
  function cardText(root, limit) {
    if (!root) return '';
    const cap = limit || SIG_LIMIT;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.data.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest(CONTROL_SEL)) return NodeFilter.FILTER_REJECT;
        if (!isVisible(parent)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let out = '';
    while (out.length < cap && walker.nextNode()) out += walker.currentNode.data + ' ';
    return out;
  }

  function textLen(el) {
    return cardText(el, 4000).replace(/\s+/g, ' ').trim().length;
  }

  /* --- the queue's own controls --------------------------------------- */

  // Icon-only buttons carry their meaning in aria-label / title, not in text.
  function btnLabel(el) {
    return (
      norm(el.textContent) ||
      norm(el.getAttribute('aria-label')) ||
      norm(el.getAttribute('title')) ||
      ''
    );
  }

  function queueButtons() {
    const reveal = [];
    const rating = [];
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      const t = btnLabel(el);
      if (!t || t.length > 40) continue; // long text is not a rating button
      if (!isVisible(el)) continue;
      if (REVEAL_RE.test(t)) reveal.push(el);
      else if (RATING_RE.test(t)) rating.push(el);
    }
    return { reveal, rating };
  }

  function buttonPhase(btns) {
    if (btns.rating.length >= 2) return 'answer';
    if (btns.reveal.length >= 1) return 'question';
    if (btns.rating.length === 1) return 'answer';
    return null;
  }

  /* --- is the answer on screen? ---------------------------------------- *
   * Independent of button labels. The question text is remembered when a
   * card starts; once the region has grown well past it while still
   * containing it, the answer / review step is up. This is what catches a
   * review step whose controls we don't recognise.
   * -------------------------------------------------------------------- */

  let questionSig = null;

  // Both guards matter: a card whose question streams in over a few frames also
  // grows, so we require a real jump in size before calling it an answer.
  function answerShowing(sig) {
    if (!questionSig || !sig) return false;
    if (sig.length < questionSig.length + 25) return false;
    if (sig.length < questionSig.length * 1.35) return false;
    const head = questionSig.slice(0, Math.min(40, questionSig.length));
    return sig.includes(questionSig) || sig.startsWith(head);
  }

  function phaseOf(btns, sig) {
    if (buttonPhase(btns) === 'answer') return 'answer';
    if (answerShowing(sig)) return 'answer'; // text says so even if buttons don't
    return buttonPhase(btns); // 'question' or null
  }

  /* --- the card region ------------------------------------------------- *
   * Walk up from a queue button until we hit an ancestor that holds real
   * card text but is still clearly smaller than the whole app shell. That
   * keeps the sidebar and document list out of the signature — including
   * them was what made every card look identical.
   * -------------------------------------------------------------------- */

  function pickRegion(btns) {
    const anchor = btns.rating[0] || btns.reveal[0];
    const pageLen = textLen(document.body) || 1;
    if (anchor) {
      let node = anchor.parentElement;
      for (let i = 0; i < 12 && node && node !== document.body; i++) {
        const len = textLen(node);
        if (len >= 8 && len <= Math.max(120, pageLen * 0.6)) return node;
        node = node.parentElement;
      }
    }
    return biggestCentralBlock() || document.querySelector('main') || document.body;
  }

  // Fallback when the buttons tell us nothing: the meatiest text block sitting
  // near the middle of the viewport, which is where the card is.
  function biggestCentralBlock() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let best = null;
    let bestScore = 0;
    const nodes = document.querySelectorAll('div, section, article, main');
    for (let i = 0; i < nodes.length && i < 2500; i++) {
      const el = nodes[i];
      const r = el.getBoundingClientRect();
      if (r.width < vw * 0.2 || r.height < 40) continue;
      if (r.width > vw * 0.95 && r.height > vh * 0.95) continue; // app shell
      const cx = r.left + r.width / 2;
      if (cx < vw * 0.15 || cx > vw * 0.9) continue; // sidebars
      const len = textLen(el);
      if (len < 4) continue;
      const score = 1 / (1 + Math.abs(cx - vw / 2) / vw) + Math.min(len, 300) / 1000;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function describe(el) {
    if (!el) return 'none';
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
    if (cls.length) s += '.' + cls.join('.');
    return s;
  }

  /* --- signature ------------------------------------------------------- */

  function signatureOf(el) {
    return cardText(el)
      .replace(/\[\s*(\.\.\.|…|\?)\s*\]/g, ' ') // cloze blanks
      .replace(/_{3,}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, SIG_LIMIT);
  }

  // Containment rather than equality: revealing an answer adds or removes text
  // around the question, so one signature stays inside the other.
  function isSameCard(a, b) {
    if (!a || !b) return true;
    if (a.length < 8 || b.length < 8) return true;
    return a.includes(b) || b.includes(a);
  }

  /* --- the state machine ----------------------------------------------- */

  let region = null;
  let lastSig = null;
  const trace = [];

  function note(reason) {
    trace.push(new Date().toLocaleTimeString() + '  ' + reason);
    if (trace.length > 12) trace.shift();
    if (opts.debug) renderDebug();
  }

  function urlLooksLikeQueue() {
    return /(flashcard|queue|practice|review)/i.test(location.pathname + location.search + location.hash);
  }

  // A new card is on screen: re-anchor the region, the question text and the
  // countdown together, so the answer-growth test measures from this question.
  function startCard(btns, reason) {
    // Judge the outgoing card if no answer step ever showed up to do it.
    scoreCard(remainingMs <= 0);

    region = pickRegion(btns);
    lastSig = signatureOf(region);
    questionSig = lastSig;
    phase = buttonPhase(btns) === 'answer' ? 'answer' : 'question';
    resetTimer();
    beginCard();
    note(reason);
  }

  // How long the queue may go unrecognised before we accept that it's gone.
  // The answer step often has no button we can name, and losing the queue there
  // would hide the timer and stop the clock for the wrong reason.
  const QUEUE_GRACE_MS = 6000;
  let lastSignalAt = 0;

  function evaluate(force, forceReason) {
    const btns = queueButtons();
    const bPhase = buttonPhase(btns);
    const urlHint = urlLooksLikeQueue();

    // Cheap exit for ordinary note-taking pages: no queue signal, and we
    // weren't in a queue a moment ago.
    if (!inQueue && bPhase === null && !urlHint) {
      if (phase !== null) {
        phase = null;
        render();
      }
      return;
    }

    if (!region || !document.contains(region)) region = pickRegion(btns);

    const sig = signatureOf(region);
    const signal = bPhase !== null || urlHint || answerShowing(sig);
    if (signal) lastSignalAt = Date.now();

    const nowInQueue =
      signal ||
      (Date.now() - lastSignalAt < QUEUE_GRACE_MS && !!region && document.contains(region));

    if (nowInQueue !== inQueue) {
      inQueue = nowInQueue;
      if (inQueue) {
        region = null;
        questionSig = null;
        startCard(btns, 'entered queue');
      } else {
        region = null;
        questionSig = null;
        phase = null;
        note('left queue');
      }
      render();
      return;
    }
    if (!inQueue) return;

    const newPhase = phaseOf(btns, sig);
    const prevPhase = phase;
    const flipped = prevPhase === 'answer' && newPhase === 'question';
    phase = newPhase;

    if (prevPhase !== newPhase) {
      // Recall is over the instant the answer appears — that's the verdict.
      if (prevPhase === 'question' && newPhase === 'answer') {
        scoreCard(remainingMs <= 0);
      }
      render(); // freeze/unfreeze for the review step takes effect immediately
      if (opts.pauseOnAnswer && newPhase === 'answer') note('paused: review step');
    }

    if (force) return startCard(btns, 'reset: ' + forceReason);
    if (flipped) return startCard(btns, 'reset: answer -> question');
    if (lastSig === null) return startCard(btns, 'reset: first card');
    if (!isSameCard(sig, lastSig)) return startCard(btns, 'reset: card text changed');

    // Track small re-renders of the question, but never absorb a whole answer
    // into the baseline — that would hide the growth we're looking for.
    if (newPhase === 'question' && questionSig && sig.length <= questionSig.length + 8) {
      questionSig = sig;
    }
    lastSig = sig;
  }

  let checkTimer = null;
  function scheduleCheck() {
    if (checkTimer) return;
    checkTimer = setTimeout(() => {
      checkTimer = null;
      evaluate(false);
    }, 150);
  }

  /* --- explicit rating actions ----------------------------------------- */

  function onClick(e) {
    const btn = e.target && e.target.closest && e.target.closest('button, [role="button"]');
    if (!btn) return;
    const t = btnLabel(btn);
    if (!t || t.length > 40) return;
    if (RATING_RE.test(t) && !REVEAL_RE.test(t)) {
      setTimeout(() => evaluate(true, 'rating clicked (' + t.slice(0, 20) + ')'), 90);
    }
  }

  function onKeydown(e) {
    if (!inQueue || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    const rated =
      /^[1-4]$/.test(e.key) ||
      (phase === 'answer' && (e.key === ' ' || e.key === 'Enter' || e.key === 'Spacebar'));
    if (rated) {
      setTimeout(() => evaluate(true, 'key "' + e.key.trim() + '"'), 90);
    }
  }

  /* ------------------------------------------------------------------ *
   * Start / stop
   *
   * Turning the timer off unhooks everything — observer, intervals and
   * listeners — rather than just hiding the widget, so nothing of ours runs
   * on the page. Turning it back on re-hooks and starts a fresh card.
   * ------------------------------------------------------------------ */

  let running = false;
  let observer = null;
  let timers = [];
  let lastPath = location.pathname;

  function start() {
    if (running) return;
    running = true;

    observer = new MutationObserver(scheduleCheck);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    timers.push(setInterval(tick, 100));
    timers.push(setInterval(() => evaluate(false), 700));
    timers.push(setInterval(renderDebug, 700));
    // SPA navigation — RemNote never does a full page load.
    timers.push(
      setInterval(() => {
        if (location.pathname !== lastPath) {
          lastPath = location.pathname;
          region = null;
          lastSig = null;
          evaluate(false);
        }
      }, 500)
    );

    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeydown, true);

    evaluate(false);
    renderGame();
    render();
  }

  function stop() {
    running = false;

    if (observer) {
      observer.disconnect();
      observer = null;
    }
    for (const id of timers) clearInterval(id);
    timers = [];
    if (checkTimer) {
      clearTimeout(checkTimer);
      checkTimer = null;
    }

    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeydown, true);

    // Forget where we were, so switching back on starts a clean card.
    inQueue = false;
    phase = null;
    region = null;
    lastSig = null;
    questionSig = null;
    userPaused = false;

    host.style.display = 'none';
  }

  function applyEnabled() {
    if (opts.enabled) start();
    else stop();
  }

  /* ------------------------------------------------------------------ *
   * Diagnostics
   *
   * Off by default. Turn on "Diagnostic panel" in the popup to see what the
   * extension actually detects on the page, and to copy a report.
   * ------------------------------------------------------------------ */

  const dbg = document.createElement('div');
  dbg.style.cssText =
    'display:none;width:300px;margin-top:6px;padding:8px 9px;border-radius:10px;' +
    'background:rgba(12,12,16,.92);color:#d8d8e0;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;' +
    'text-align:left;';

  const dbgText = document.createElement('div');
  dbgText.style.cssText = 'white-space:pre-wrap;word-break:break-word;';

  const dbgCopy = document.createElement('button');
  dbgCopy.textContent = 'Copy report';
  dbgCopy.style.cssText =
    'all:unset;display:block;box-sizing:border-box;width:100%;margin-top:7px;padding:5px 8px;' +
    'border-radius:6px;cursor:pointer;background:#4f46e5;color:#fff;' +
    'font:11px/1 -apple-system,BlinkMacSystemFont,sans-serif;text-align:center;';

  dbg.appendChild(dbgText);
  dbg.appendChild(dbgCopy);
  shadow.querySelector('.wrap').appendChild(dbg);

  function debugReport() {
    const btns = queueButtons();
    const labels = [];
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      const t = btnLabel(el);
      if (t && t.length <= 40 && isVisible(el)) labels.push(t);
    }
    const sig = region ? signatureOf(region) : '';
    return {
      url: location.hostname + location.pathname,
      inQueue: inQueue,
      phase: phase || 'none',
      phaseFromButtons: buttonPhase(btns) || 'none',
      answerShowingByGrowth: answerShowing(sig),
      frozenForReview: opts.pauseOnAnswer && phase === 'answer',
      revealButtons: btns.reveal.map(btnLabel),
      ratingButtons: btns.rating.map(btnLabel),
      // The key field when the review step isn't detected: everything the page
      // offers that we could have matched on.
      allVisibleButtons: labels.slice(0, 40),
      region: describe(region),
      regionTextLen: region ? textLen(region) : 0,
      questionLen: questionSig ? questionSig.length : 0,
      currentLen: sig.length,
      signature: sig.slice(0, 140),
      secondsLeft: Math.round(remainingMs / 100) / 10,
      settings: { duration: opts.duration, pauseOnAnswer: opts.pauseOnAnswer },
      trace: trace.slice(),
    };
  }

  function renderDebug() {
    if (!opts.debug) {
      dbg.style.display = 'none';
      return;
    }
    dbg.style.display = '';
    const r = debugReport();
    dbgText.textContent =
      'queue: ' + r.inQueue + '   phase: ' + r.phase +
      (r.frozenForReview ? '  [FROZEN]' : '') + '\n' +
      'phase from buttons: ' + r.phaseFromButtons + '\n' +
      'answer by text growth: ' + r.answerShowingByGrowth +
      '  (q=' + r.questionLen + ' now=' + r.currentLen + ')\n' +
      'reveal btns: ' + (r.revealButtons.join(' | ') || '—') + '\n' +
      'rating btns: ' + (r.ratingButtons.join(' | ') || '—') + '\n' +
      'all btns: ' + (r.allVisibleButtons.join(' | ').slice(0, 160) || '—') + '\n' +
      'region: ' + r.region + '  (' + r.regionTextLen + ' chars)\n' +
      '— recent —\n' + (r.trace.join('\n') || 'nothing yet');
  }

  dbgCopy.addEventListener('click', (e) => {
    e.stopPropagation();
    const text = JSON.stringify(debugReport(), null, 2);
    navigator.clipboard.writeText(text).then(
      () => {
        dbgCopy.textContent = 'Copied ✓';
        setTimeout(() => (dbgCopy.textContent = 'Copy report'), 1500);
      },
      () => {
        dbgCopy.textContent = 'Copy failed — see console';
        console.log('[RemNote Timer] diagnostic report:\n' + text);
      }
    );
  });

  /* ------------------------------------------------------------------ *
   * Controls + dragging
   * ------------------------------------------------------------------ */

  function togglePause() {
    userPaused = !userPaused;
    lastTick = performance.now();
    render();
  }

  pauseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePause();
  });

  // The keyboard shortcut arrives from background.js. It only acts while a
  // card is actually being timed — pausing an invisible timer from a notes
  // page would leave it silently frozen for the next review.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'toggle-pause' && running && inQueue) togglePause();
  });

  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetTimer();
  });

  let drag = null;
  wrapEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = host.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
    wrapEl.classList.add('dragging');
    wrapEl.setPointerCapture(e.pointerId);
  });

  wrapEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.moved = true;
    const r = host.getBoundingClientRect();
    const left = clamp(e.clientX - drag.dx, 0, window.innerWidth - r.width);
    const top = clamp(e.clientY - drag.dy, 0, window.innerHeight - r.height);
    host.style.left = left + 'px';
    host.style.top = top + 'px';
    host.style.right = 'auto';
  });

  wrapEl.addEventListener('pointerup', (e) => {
    if (!drag) return;
    wrapEl.classList.remove('dragging');
    wrapEl.releasePointerCapture(e.pointerId);
    if (drag.moved) {
      chrome.storage.local.set({
        pos: { left: parseFloat(host.style.left), top: parseFloat(host.style.top) },
      });
    }
    drag = null;
  });

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /* ------------------------------------------------------------------ *
   * Settings
   * ------------------------------------------------------------------ */

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    opts = { ...DEFAULTS, ...stored };
    resetTimer();
    applyEnabled();
  });

  chrome.storage.local.get({ pos: null, game: null }, (stored) => {
    const pos = stored.pos;
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      host.style.left = clamp(pos.left, 0, window.innerWidth - 90) + 'px';
      host.style.top = clamp(pos.top, 0, window.innerHeight - 110) + 'px';
      host.style.right = 'auto';
    }
    if (stored.game) game = { ...GAME_DEFAULTS, ...stored.game };
    renderGame();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    // The popup can reset the score, so adopt it rather than overwrite it.
    if (area === 'local') {
      if (changes.game && changes.game.newValue) {
        // Ignore the echo of our own write — adopting it would roll back any
        // cards scored while that write was in flight.
        if (JSON.stringify(changes.game.newValue) === lastWritten) return;
        game = { ...GAME_DEFAULTS, ...changes.game.newValue };
        renderGame();
      }
      return;
    }
    if (area !== 'sync') return;

    let durationChanged = false;
    let enabledChanged = false;
    let gameChanged = false;
    for (const [k, v] of Object.entries(changes)) {
      if (k in opts) {
        opts[k] = v.newValue;
        if (k === 'duration') durationChanged = true;
        if (k === 'enabled') enabledChanged = true;
        if (k.startsWith('game')) gameChanged = true;
      }
    }
    if (gameChanged) {
      game.tokens = Math.min(game.tokens, Math.max(1, opts.gameTokens));
      renderGame();
    }
    if (durationChanged) resetTimer();
    // Switching on/off takes effect here — no page reload needed.
    if (enabledChanged) applyEnabled();
    else render();
  });

  render();
})();
