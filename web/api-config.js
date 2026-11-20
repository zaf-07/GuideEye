// Public API endpoint for static hosts. Local and Render deployments use their
// own origin; GitHub Pages needs an explicit, HTTPS backend address.
window.GUIDEEYE_API_URL = location.hostname === 'zaf-07.github.io'
  ? 'https://guideeye.onrender.com'
  : '';
