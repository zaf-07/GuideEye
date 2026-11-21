// GuideEye landing — small progressive enhancements. The page works without this file.

// The nav only grows a background once the page has scrolled past the headline.
const navBar = document.querySelector('.nav');
if (navBar) {
  const syncNav = () => navBar.classList.toggle('is-stuck', window.scrollY > 24);
  syncNav();
  addEventListener('scroll', syncNav, { passive: true });
}

// Mobile menu. Below 900px the links collapse behind this button.
const navToggle = document.getElementById('navToggle');
if (navBar && navToggle) {
  const setMenu = open => {
    navBar.dataset.open = String(open);
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Close the menu' : 'Open the menu');
  };
  setMenu(false);
  navToggle.addEventListener('click', () => setMenu(navToggle.getAttribute('aria-expanded') !== 'true'));
  navBar.querySelectorAll('.nav-links a').forEach(a => a.addEventListener('click', () => setMenu(false)));
  addEventListener('keydown', e => { if (e.key === 'Escape' && navBar.dataset.open === 'true') { setMenu(false); navToggle.focus(); } });
  // Leaving the narrow layout must not strand the menu in its open state.
  matchMedia('(min-width: 901px)').addEventListener('change', e => { if (e.matches) setMenu(false); });
}

// Examples shown in the phone demo. `confirm` shows the yes / not-now buttons.
const scenes = {
  see: {
    heard: '“What’s in front of me?”',
    reply: 'Chair ahead, slightly left. The doorway is clear beyond it.',
    eyebrow: 'Detected on device',
    title: 'Chair · ahead, left',
    detail: 'Processed locally. No video stored.'
  },
  remember: {
    heard: '“Where did I leave my keys?”',
    reply: 'On the kitchen counter, next to the kettle. I saw them 20 minutes ago.',
    eyebrow: 'From your memory',
    title: 'Keys · kitchen counter',
    detail: 'Last seen 20 minutes ago.'
  },
  act: {
    heard: '“Buy me a coffee.”',
    reply: 'One medium latte for $4.50. Should I pay?',
    eyebrow: 'Please confirm',
    title: 'Pay $4.50 for a latte?',
    confirm: true
  },
  bridge: {
    heard: '“Start Bridge.”',
    reply: 'I’ll speak signed phrases aloud and show replies as large captions.',
    eyebrow: 'Coming soon',
    title: 'Bridge mode',
    detail: 'Sign language, voiced.'
  }
};
const byId = id => document.getElementById(id);
const chat = document.querySelector('.hero-demo .chat');
// Only the hero's scene chips — the live demo further down has its own chips.
const chips = document.querySelectorAll('.hero-demo .chip[data-scene]');
chips.forEach(chip => chip.addEventListener('click', () => {
  const scene = scenes[chip.dataset.scene];
  if (!scene || !chat) return;
  chips.forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
  byId('demoHeard').textContent = scene.heard;
  byId('demoReply').textContent = scene.reply;
  byId('demoEyebrow').textContent = scene.eyebrow;
  byId('demoTitle').textContent = scene.title;
  byId('demoDetail').textContent = scene.detail || '';
  byId('demoDetail').hidden = !scene.detail;
  byId('demoActions').hidden = !scene.confirm;
  chat.classList.remove('swap');
  void chat.offsetWidth; // restart the entrance animation
  chat.classList.add('swap');
}));

document.querySelectorAll('.os-web').forEach(icon => {
  icon.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"/></svg>';
});
