// GuideBand landing — small progressive enhancements. The page works without this file.

// Light that follows the pointer across glass surfaces.
document.querySelectorAll('.glass').forEach(el => {
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    el.style.setProperty('--my', (e.clientY - r.top) + 'px');
  });
});

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
const chat = document.querySelector('.chat');
const chips = document.querySelectorAll('.chip');
chips.forEach(chip => chip.addEventListener('click', () => {
  const scene = scenes[chip.dataset.scene];
  if (!scene) return;
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

// Device-aware download recommendation. Detection stays local in the browser.
const release = 'https://github.com/zaf-07/GuideBand/releases/download/v0.1.0/';
const osIcons = {
  android: '<svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" stroke="none" d="M5 18a7 7 0 0114 0H5zm3.5-4.5a1 1 0 102 0 1 1 0 00-2 0zm7 0a1 1 0 102 0 1 1 0 00-2 0z"/><path d="M7 6.5L8.8 9.5M17 6.5L15.2 9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>',
  macos: '<svg viewBox="0 0 24 24"><path d="M16.8 12.8c0-2.5 2-3.7 2.1-3.8a4.5 4.5 0 00-3.5-1.9c-1.5-.2-2.9.9-3.7.9-.8 0-2-.9-3.3-.8A4.9 4.9 0 004.2 10c-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.5 1.3-.1 1.8-.8 3.4-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5a11 11 0 001.4-2.9 4.4 4.4 0 01-3.2-4.5zM14.4 5.5A4.3 4.3 0 0015.5 2a4.5 4.5 0 00-3 1.7 4 4 0 00-1.1 3.4 3.7 3.7 0 003-1.6z" fill="currentColor" stroke="none"/></svg>',
  windows: '<svg viewBox="0 0 24 24"><path d="M3 5.5l7.5-1v7H3v-6zM12 4.3l9-1.3v8.5h-9V4.3zM3 13h7.5v7L3 19v-6zM12 13h9v8.5l-9-1.3V13z" fill="currentColor" stroke="none"/></svg>',
  linux: '<svg viewBox="0 0 448 512"><path fill="currentColor" stroke="none" d="M220.8 123.3c1 .5 1.8 1.7 3 1.7 1.1 0 2.8-.4 2.9-1.5.2-1.4-1.9-2.3-3.2-2.9-1.7-.7-3.9-1-5.5-.1-.4.2-.8.7-.6 1.1.3 1.3 2.3 1.1 3.4 1.7zm-21.9 1.7c1.2 0 2-1.2 3-1.7 1.1-.6 3.1-.4 3.5-1.6.2-.4-.2-.9-.6-1.1-1.6-.9-3.8-.6-5.5.1-1.3.6-3.4 1.5-3.2 2.9.1 1 1.8 1.5 2.8 1.4zM420 403.8c-3.6-4-5.3-11.6-7.2-19.7-1.8-8.1-3.9-16.8-10.5-22.4-1.3-1.1-2.6-2.1-4-2.9-1.3-.8-2.7-1.5-4.1-2 9.2-27.3 5.6-54.5-3.7-79.1-11.4-30.1-31.3-56.4-46.5-74.4-17.1-21.5-33.7-41.9-33.4-72C311.1 85.4 315.7.1 234.8 0 132.4-.2 158 103.4 156.9 135.2c-1.7 23.4-6.4 41.8-22.5 64.7-18.9 22.5-45.5 58.8-58.1 96.7-6 17.9-8.8 36.1-6.2 53.3-6.5 5.8-11.4 14.7-16.6 20.2-4.2 4.3-10.3 5.9-17 8.3s-14 6-18.5 14.5c-2.1 3.9-2.8 8.1-2.8 12.4 0 3.9.6 7.9 1.2 11.8 1.2 8.1 2.5 15.7.8 20.8-5.2 14.4-5.9 24.4-2.2 31.7 3.8 7.3 11.4 10.5 20.1 12.3 17.3 3.6 40.8 2.7 59.3 12.5 19.8 10.4 39.9 14.1 55.9 10.4 11.6-2.6 21.1-9.6 25.9-20.2 12.5-.1 26.3-5.4 48.3-6.6 14.9-1.2 33.6 5.3 55.1 4.1.6 2.3 1.4 4.6 2.5 6.7v.1c8.3 16.7 23.8 24.3 40.3 23 16.6-1.3 34.1-11 48.3-27.9 13.6-16.4 36-23.2 50.9-32.2 7.4-4.5 13.4-10.1 13.9-18.3.4-8.2-4.4-17.3-15.5-29.7zM223.7 87.3c9.8-22.2 34.2-21.8 44-.4 6.5 14.2 3.6 30.9-4.3 40.4-1.6-.8-5.9-2.6-12.6-4.9 1.1-1.2 3.1-2.7 3.9-4.6 4.8-11.8-.2-27-9.1-27.3-7.3-.5-13.9 10.8-11.8 23-4.1-2-9.4-3.5-13-4.4-1-6.9-.3-14.6 2.9-21.8zM183 75.8c10.1 0 20.8 14.2 19.1 33.5-3.5 1-7.1 2.5-10.2 4.6 1.2-8.9-3.3-20.1-9.6-19.6-8.4.7-9.8 21.2-1.8 28.1 1 .8 1.9-.2-5.9 5.5-15.6-14.6-10.5-52.1 8.4-52.1zm-13.6 60.7c6.2-4.6 13.6-10 14.1-10.5 4.7-4.4 13.5-14.2 27.9-14.2 7.1 0 15.6 2.3 25.9 8.9 6.3 4.1 11.3 4.4 22.6 9.3 8.4 3.5 13.7 9.7 10.5 18.2-2.6 7.1-11 14.4-22.7 18.1-11.1 3.6-19.8 16-38.2 14.9-3.9-.2-7-1-9.6-2.1-8-3.5-12.2-10.4-20-15-8.6-4.8-13.2-10.4-14.7-15.3-1.4-4.9 0-9 4.2-12.3zm3.3 334c-2.7 35.1-43.9 34.4-75.3 18-29.9-15.8-68.6-6.5-76.5-21.9-2.4-4.7-2.4-12.7 2.6-26.4v-.2c2.4-7.6.6-16-.6-23.9-1.2-7.8-1.8-15 .9-20 3.5-6.7 8.5-9.1 14.8-11.3 10.3-3.7 11.8-3.4 19.6-9.9 5.5-5.7 9.5-12.9 14.3-18 5.1-5.5 10-8.1 17.7-6.9 8.1 1.2 15.1 6.8 21.9 16l19.6 35.6c9.5 19.9 43.1 48.4 41 68.9zm-1.4-25.9c-4.1-6.6-9.6-13.6-14.4-19.6 7.1 0 14.2-2.2 16.7-8.9 2.3-6.2 0-14.9-7.4-24.9-13.5-18.2-38.3-32.5-38.3-32.5-13.5-8.4-21.1-18.7-24.6-29.9s-3-23.3-.3-35.2c5.2-22.9 18.6-45.2 27.2-59.2 2.3-1.7.8 3.2-8.7 20.8-8.5 16.1-24.4 53.3-2.6 82.4.6-20.7 5.5-41.8 13.8-61.5 12-27.4 37.3-74.9 39.3-112.7 1.1.8 4.6 3.2 6.2 4.1 4.6 2.7 8.1 6.7 12.6 10.3 12.4 10 28.5 9.2 42.4 1.2 6.2-3.5 11.2-7.5 15.9-9 9.9-3.1 17.8-8.6 22.3-15 7.7 30.4 25.7 74.3 37.2 95.7 6.1 11.4 18.3 35.5 23.6 64.6 3.3-.1 7 .4 10.9 1.4 13.8-35.7-11.7-74.2-23.3-84.9-4.7-4.6-4.9-6.6-2.6-6.5 12.6 11.2 29.2 33.7 35.2 59 2.8 11.6 3.3 23.7.4 35.7 16.4 6.8 35.9 17.9 30.7 34.8-2.2-.1-3.2 0-4.2 0 3.2-10.1-3.9-17.6-22.8-26.1-19.6-8.6-36-8.6-38.3 12.5-12.1 4.2-18.3 14.7-21.4 27.3-2.8 11.2-3.6 24.7-4.4 39.9-.5 7.7-3.6 18-6.8 29-32.1 22.9-76.7 32.9-114.3 7.2zm257.4-11.5c-.9 16.8-41.2 19.9-63.2 46.5-13.2 15.7-29.4 24.4-43.6 25.5s-26.5-4.8-33.7-19.3c-4.7-11.1-2.4-23.1 1.1-36.3 3.7-14.2 9.2-28.8 9.9-40.6.8-15.2 1.7-28.5 4.2-38.7 2.6-10.3 6.6-17.2 13.7-21.1.3-.2.7-.3 1-.5.8 13.2 7.3 26.6 18.8 29.5 12.6 3.3 30.7-7.5 38.4-16.3 9-.3 15.7-.9 22.6 5.1 9.9 8.5 7.1 30.3 17.1 41.6 10.6 11.6 14 19.5 13.7 24.6zM173.3 148.7c2 1.9 4.7 4.5 8 7.1 6.6 5.2 15.8 10.6 27.3 10.6 11.6 0 22.5-5.9 31.8-10.8 4.9-2.6 10.9-7 14.8-10.4s5.9-6.3 3.1-6.6-2.6 2.6-6 5.1c-4.4 3.2-9.7 7.4-13.9 9.8-7.4 4.2-19.5 10.2-29.9 10.2s-18.7-4.8-24.9-9.7c-3.1-2.5-5.7-5-7.7-6.9-1.5-1.4-1.9-4.6-4.3-4.9-1.4-.1-1.8 3.7 1.7 6.5z"/></svg>',
  web: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"/></svg>'
};

const ua = navigator.userAgent || '';
const platform = navigator.userAgentData?.platform || navigator.platform || '';
const touchMac = /Mac/i.test(platform) && navigator.maxTouchPoints > 1;
let detected = 'web';
if (/Android/i.test(ua)) detected = 'android';
else if (/iPhone|iPad|iPod/i.test(ua) || touchMac) detected = 'web';
else if (/Mac/i.test(platform)) detected = 'macos';
else if (/Win/i.test(platform)) detected = 'windows';
else if (/Linux|X11/i.test(platform)) detected = 'linux';

const recommendations = {
  android: { label: 'Android detected', title: 'GuideBand for Android', detail: 'The full phone assistant with Vexo bracelet support.', button: 'Download APK · 12.9 MB', href: release + 'GuideBand-Android.apk' },
  macos: { label: 'macOS detected', title: 'GuideBand for your Mac', detail: 'One universal build for Apple silicon and Intel Macs.', button: 'Download universal DMG', href: release + 'GuideBand-0.1.0-universal.dmg' },
  windows: { label: 'Windows detected', title: 'GuideBand for Windows', detail: 'The guided x64 installer for Windows 10 and later.', button: 'Download Windows installer', href: release + 'GuideBand.Setup.0.1.0.exe' },
  linux: { label: 'Linux detected', title: 'GuideBand for Linux', detail: 'DEB for Debian and Ubuntu. AppImage is available below.', button: 'Download DEB · x64', href: release + 'guideband_0.1.0_amd64.deb' },
  web: { label: /iPhone|iPad|iPod/i.test(ua) || touchMac ? 'iPhone or iPad detected' : 'Browser detected', title: 'Open GuideBand on the web', detail: 'No native build is needed. Add it to your home screen for quick access.', button: 'Open web app', href: 'app.html' }
};
const rec = recommendations[detected];
byId('detectedIcon').innerHTML = osIcons[detected];
byId('detectedLabel').textContent = rec.label;
byId('detectedTitle').textContent = rec.title;
byId('detectedDetail').textContent = rec.detail;
byId('detectedButton').textContent = rec.button;
byId('detectedButton').href = rec.href;
if (detected !== 'web') byId('detectedButton').setAttribute('download', '');
document.querySelector(`[data-platform="${detected}"]`)?.classList.add('is-detected');

document.querySelectorAll('.os-android').forEach(el => el.innerHTML = osIcons.android);
document.querySelectorAll('.os-apple').forEach(el => el.innerHTML = osIcons.macos);
document.querySelectorAll('.os-windows').forEach(el => el.innerHTML = osIcons.windows);
document.querySelectorAll('.os-linux').forEach(el => el.innerHTML = osIcons.linux);
document.querySelectorAll('.os-web').forEach(el => el.innerHTML = osIcons.web);
