// Controls: time of day, the slow cycle, sound and fullscreen. The dock and cursor step
// aside when nobody is touching anything, so the window is all that is left.

const STORE_KEY = 'finestra-prefs';

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function savePrefs(p) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch {
    /* storage may be unavailable; preferences are only a convenience */
  }
}

export function createUI({ state, ambience }) {
  const body = document.body;
  const card = document.getElementById('card');
  const hint = document.getElementById('hint');
  const timeButtons = [...document.querySelectorAll('.times button')];
  const cycleBtn = document.getElementById('tog-cycle');
  const soundBtn = document.getElementById('tog-sound');
  const fullBtn = document.getElementById('tog-full');
  const prefs = loadPrefs();
  if (matchMedia('(pointer: coarse)').matches) {
    hint.textContent = '横になぞると景色を見渡せます';
  }

  const setPressed = (el, on) => el.setAttribute('aria-pressed', on ? 'true' : 'false');

  function goTo(index) {
    // take the short way round the loop
    let d = index - (((state.target % 4) + 4) % 4);
    if (d > 2) d -= 4;
    if (d < -2) d += 4;
    state.target += d;
    state.mode = 'fixed';
    setPressed(cycleBtn, false);
    prefs.time = index;
    prefs.cycle = false;
    savePrefs(prefs);
    syncTimeButtons();
  }

  function syncTimeButtons() {
    const cur = Math.round(((state.target % 4) + 4) % 4) % 4;
    timeButtons.forEach((b, i) => setPressed(b, i === cur));
  }

  timeButtons.forEach((b) => b.addEventListener('click', () => goTo(Number(b.dataset.time))));

  function setCycle(on) {
    state.mode = on ? 'cycle' : 'fixed';
    if (!on) state.target = Math.round(state.t);
    setPressed(cycleBtn, on);
    prefs.cycle = on;
    savePrefs(prefs);
  }
  cycleBtn.addEventListener('click', () => setCycle(state.mode !== 'cycle'));

  async function toggleSound() {
    if (ambience.on) {
      ambience.stop();
      setPressed(soundBtn, false);
    } else {
      setPressed(soundBtn, true);
      try {
        await ambience.start();
      } catch (err) {
        console.warn('sound could not start', err);
        ambience.stop();
        setPressed(soundBtn, false);
      }
    }
  }
  soundBtn.addEventListener('click', toggleSound);

  async function toggleFull() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      fullBtn.hidden = true; // not available here (some app views and phones)
    }
  }
  fullBtn.addEventListener('click', toggleFull);
  document.addEventListener('fullscreenchange', () => setPressed(fullBtn, !!document.fullscreenElement));
  if (!document.fullscreenEnabled) fullBtn.hidden = true;

  // keyboard: 1-4 time, C cycle, S sound, F fullscreen, H hide the dock
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '4') goTo(Number(k) - 1);
    else if (k === 'c') setCycle(state.mode !== 'cycle');
    else if (k === 's') toggleSound();
    else if (k === 'f') toggleFull();
    else if (k === 'h') { body.classList.toggle('idle'); return; }
    else return;
    wake();
  });

  // idle handling
  let lastActive = performance.now();
  function wake() {
    lastActive = performance.now();
    body.classList.remove('idle');
  }
  window.addEventListener('pointermove', wake, { passive: true });
  window.addEventListener('pointerdown', wake, { passive: true });
  document.querySelector('.dock').addEventListener('focusin', wake);
  setInterval(() => {
    const idleFor = performance.now() - lastActive;
    const a = document.activeElement;
    const dockFocused = a && a.closest && a.closest('.dock') && a.matches(':focus-visible');
    if (idleFor > 4200 && !dockFocused) body.classList.add('idle');
  }, 500);
  setTimeout(() => card.classList.add('faded'), 9000);
  setTimeout(() => { hint.style.opacity = '0'; }, 12000);

  // restore the last visit
  if (typeof prefs.time === 'number') {
    state.t = state.target = prefs.time;
  }
  if (prefs.cycle) setCycle(true);
  syncTimeButtons();

  return {
    tick() {
      if (state.mode === 'cycle') syncTimeButtons();
    },
  };
}
