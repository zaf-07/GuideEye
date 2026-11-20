// GuideEye live demo: camera + voice in the browser, talking to the GuideEye service.
(() => {
  const el = id => document.getElementById(id);
  if (!el('live')) return;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  // ---------- Service connection ----------
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const sameOrigin = location.port === '8000'; // page is served by the service itself
  const publicApi = window.GUIDEEYE_API_URL || '';
  const savedApi = store.get('guideband_api');
  const staleLocalApi = /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(savedApi || '');
  // GitHub Pages must prefer its configured Render service over a local URL
  // that a developer or previous demo session left in browser storage.
  let api = (((publicApi && staleLocalApi) ? publicApi : savedApi) ?? (sameOrigin ? '' : (publicApi || 'http://localhost:8000'))).replace(/\/$/, '');
  const session = Math.random().toString(36).slice(2, 12);
  let online = false, activeTab = 'assistant';
  let mapsEmbedKey = '', mapDestination = null, mapOrigin = null, mapLastRendered = 0;
  let bandCursor = -1, bandLive = false; // optional external audio device state

  el('apiInput').value = api || location.origin;

  async function call(path, options = {}) {
    const response = await fetch(api + path, options);
    if (!response.ok) {
      const detail = await response.json().then(d => d.detail).catch(() => '');
      throw new Error(typeof detail === 'string' && detail ? detail : 'The service returned an error (' + response.status + ').');
    }
    return response.json();
  }

  // Where the service might be, best guess first. A saved address wins, but a
  // stale one — left over from testing against another port — must not strand
  // the page offline when the service is right there on the origin that served
  // it, so every candidate is tried before giving up.
  function apiCandidates() {
    const list = [];
    if (api) list.push(api);
    if (location.protocol === 'http:' || location.protocol === 'https:') list.push('');
    list.push('http://localhost:8000');
    return [...new Set(list)];
  }

  async function resolveApi() {
    for (const candidate of apiCandidates()) {
      try {
        const response = await fetch(candidate + '/health', { cache: 'no-store' });
        if (!response.ok) continue;
        if (candidate !== api) {
          api = candidate;
          store.set('guideband_api', api);
          el('apiInput').value = api || location.origin;
        }
        return true;
      } catch { /* try the next one */ }
    }
    return false;
  }

  async function checkService(retried = false) {
    try {
      const s = await call('/system/status');
      const map = await call('/maps/config').catch(() => ({ embed_key: '' }));
      mapsEmbedKey = map.embed_key || '';
      online = true;
      const provider = s.vision.cloud_providers[0];
      const cloud = provider ? `${provider[0].toUpperCase()}${provider.slice(1)} connected` : 'no cloud model (local answers only)';
      const detector = s.vision.detector.state === 'unavailable' ? 'detector unavailable' : 'on-device detector';
      const pay = s.payments.mode === 'stripe_test' ? 'Stripe test mode' : 'simulated payments';
      cloudVoice = Boolean(s.speech?.voice && s.speech.voice !== 'browser');
      el('liveStatus').textContent = 'Connected · ' + detector + ' · ' + cloud + ' · ' + (cloudVoice ? ({ deepgram: 'Deepgram', elevenlabs: 'ElevenLabs', minimax: 'MiniMax' }[s.speech.voice] || 'cloud') + ' voice' : 'browser voice') + ' · ' + pay;
      el('liveDot').className = 'dot';
      showBand(s.wearable);
      if (s.wearable?.connected) {
        const wb = s.wearable;
        const bPct = wb.battery?.percent != null ? ` · ${wb.battery.percent}%` : '';
        const trans = (wb.transport || 'ble').toUpperCase();
        el('liveStatus').textContent += ` · external audio device (${wb.band_name || 'connected'}${bPct} via ${trans})`;
        if (el('webBandLabel')) el('webBandLabel').textContent = `${wb.band_name || 'Connected device'}${bPct} (${trans})`;
        if (el('webBandDot')) el('webBandDot').className = 'dot';
        if (el('webBandWidget')) el('webBandWidget').style.display = 'flex';
      } else {
        if (el('webBandDot')) el('webBandDot').className = 'dot dot-bad';
        if (el('webBandWidget')) el('webBandWidget').style.display = 'none';
      }
      el('qrLink').href = api + '/pay/qr.png?item=Coffee&amount=4.50';
    } catch {
      // The address we tried is wrong or dead. Look for the service elsewhere
      // once, then report honestly if it really is not running.
      if (!retried && await resolveApi()) return checkService(true);
      online = false;
      el('liveStatus').textContent = 'Not connected to the GuideEye service';
      el('liveDot').className = 'dot dot-bad';
      // Say what was actually tried. "Not running" is only one of the reasons
      // this fails: the usual one is the page being opened from somewhere the
      // service is not, and that is not visible without naming the addresses.
      const tried = apiCandidates().map(c => c || location.origin);
      const fromFile = location.protocol === 'file:';
      if (el('offlineTried')) {
        el('offlineTried').textContent = 'Tried ' + tried.join(', ') + '.';
        el('offlineTried').hidden = false;
      }
      if (el('offlineTitle')) {
        el('offlineTitle').textContent = fromFile
          ? 'This page cannot reach the service'
          : 'The GuideEye service is not running';
      }
      if (el('offlineHint')) el('offlineHint').hidden = !fromFile && location.port === '8000';
    }
    el('liveOffline').hidden = online;
  }
  el('retryBtn').onclick = () => checkService();
  // Escape hatch for an address saved against a port that is no longer there.
  if (el('resetApiBtn')) el('resetApiBtn').onclick = () => {
    api = '';
    store.set('guideband_api', '');
    el('apiInput').value = location.origin;
    checkService();
  };

  function mapDistance(a, b) {
    if (!a || !b) return Infinity;
    const r = 6371000, p = Math.PI / 180, dLat = (b.lat - a.lat) * p, dLon = (b.lon - a.lon) * p;
    const v = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLon / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(v));
  }
  function renderRouteMap(force = false) {
    if (!mapsEmbedKey || !position || !mapDestination) return;
    if (!force && Date.now() - mapLastRendered < 15000 && mapDistance(position, mapOrigin) < 20) return;
    const params = new URLSearchParams({ key: mapsEmbedKey, origin: `${position.lat},${position.lon}`, destination: `${mapDestination.lat},${mapDestination.lon}`, mode: 'walking' });
    el('routeMapFrame').src = 'https://www.google.com/maps/embed/v1/directions?' + params;
    mapOrigin = { ...position }; mapLastRendered = Date.now();
  }

  const guide = { route: null, nav: null, map: null, line: null, walked: null, me: null, turnMark: null, destMark: null, follow: false, mode: '', loading: null, hideTimer: 0,
    headingUp: store.get('guideband_heading_up') !== 'no', big: store.get('guideband_route_big') === 'yes' };
  const firstSentence = text => (text || '').split('. ')[0].replace(/\.$/, '');
  const darkPage = () => matchMedia('(prefers-color-scheme: dark)').matches;
  let compassHeading = null, compassSent = null, compassOn = false, compassDrawn = 0;
  const currentHeading = () => compassHeading ?? guide.nav?.heading ?? null;
  const turned = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const TURN_BUZZ = { left: [400], 'slight-left': [400], right: [400, 150, 400], 'slight-right': [400, 150, 400], uturn: [400, 150, 400, 150, 400], straight: [80], arrive: [120, 80, 120, 80, 600] };
  function turnBuzz(nav) {
    if (nav.kind === 'arrive') return buzz(TURN_BUZZ.arrive);
    if (nav.kind === 'reroute' || nav.kind === 'off_route') return buzz([80, 60, 80, 60, 80, 60, 80]);
    const pattern = TURN_BUZZ[nav.say_turn] || [200, 100, 200];
    buzz(nav.kind === 'turn' ? [...pattern, 350, ...pattern] : pattern);
  }
  function onCompass(event) {
    let heading = null;
    if (typeof event.webkitCompassHeading === 'number') heading = event.webkitCompassHeading;
    else if (event.absolute && typeof event.alpha === 'number') heading = (360 - event.alpha) % 360;
    if (heading === null || Number.isNaN(heading)) return;
    compassHeading = heading;
    if (!guide.route) return;
    if (Date.now() - compassDrawn > 250) { compassDrawn = Date.now(); placeMe(); }
    if (compassSent === null || turned(heading, compassSent) > 25) reportLocation();
  }
  function startCompass() {
    if (compassOn || typeof DeviceOrientationEvent === 'undefined') return;
    const listen = () => { compassOn = true; addEventListener('deviceorientationabsolute', onCompass); addEventListener('deviceorientation', onCompass); };
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission().then(state => { if (state === 'granted') listen(); }).catch(() => {});
      else listen();
    } catch {}
  }
  function applyGuideLook() {
    el('routeMap').classList.toggle('big', guide.big);
    el('routeBig').textContent = guide.big ? 'Normal text' : 'Larger text';
    el('routeRotate').textContent = guide.headingUp ? 'North up' : 'Heading up';
    if (guide.mode !== 'google' || !guide.line) return;
    const accent = guide.big ? '#ffe600' : (getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0a6a45');
    guide.line.setOptions({ strokeColor: accent, strokeWeight: guide.big ? 11 : 7 });
    guide.walked.setOptions({ strokeWeight: guide.big ? 9 : 6 });
  }
  function splitRoute() {
    if (guide.mode !== 'google' || !guide.line || !guide.route) return;
    const path = guide.route.path, point = ([lat, lng]) => ({ lat, lng });
    if (!position || path.length < 2) { guide.line.setPath(path.map(point)); guide.walked.setPath([]); return; }
    const scale = Math.cos(position.lat * Math.PI / 180);
    let best = Infinity, at = 0, nearest = path[0];
    for (let i = 0; i < path.length - 1; i++) {
      const ax = (path[i][1] - position.lon) * scale, ay = path[i][0] - position.lat;
      const dx = (path[i + 1][1] - path[i][1]) * scale, dy = path[i + 1][0] - path[i][0], length = dx * dx + dy * dy;
      const t = length ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / length)) : 0, gap = Math.hypot(ax + t * dx, ay + t * dy);
      if (gap < best) { best = gap; at = i; nearest = [path[i][0] + t * (path[i + 1][0] - path[i][0]), path[i][1] + t * (path[i + 1][1] - path[i][1])]; }
    }
    guide.walked.setPath([...path.slice(0, at + 1), nearest].map(point));
    guide.line.setPath([nearest, ...path.slice(at + 1)].map(point));
  }
  function loadGoogleMaps() {
    if (window.google?.maps?.Map) return Promise.resolve();
    if (!mapsEmbedKey) return Promise.reject(new Error('no key'));
    if (!guide.loading) guide.loading = new Promise((resolve, reject) => {
      window.__guideMapReady = resolve;
      window.gm_authFailure = () => { guide.mode = 'embed'; guide.map = null; showEmbedMap(); };
      const script = document.createElement('script');
      script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(mapsEmbedKey) + '&v=weekly&loading=async&callback=__guideMapReady';
      script.async = true;
      script.onerror = () => reject(new Error('blocked'));
      document.head.append(script);
      setTimeout(() => reject(new Error('timeout')), 8000);
    });
    return guide.loading;
  }
  function showEmbedMap() {
    el('routeCanvas').hidden = true;
    el('routeCanvas').replaceChildren();
    el('routeMapFrame').hidden = !mapsEmbedKey;
    el('routeView').hidden = !mapsEmbedKey;
    el('routeRecenter').hidden = el('routeOverview').hidden = el('routeRotate').hidden = true;
    renderRouteMap(true);
  }
  async function drawGuideMap(keepView = false) {
    const route = guide.route;
    if (guide.mode === 'embed') return showEmbedMap();
    try { await loadGoogleMaps(); } catch { guide.mode = 'embed'; return showEmbedMap(); }
    if (guide.route !== route || guide.mode === 'embed') return;
    const g = google.maps;
    el('routeView').hidden = false; el('routeCanvas').hidden = false; el('routeMapFrame').hidden = true; el('routeMapFrame').src = 'about:blank';
    el('routeRecenter').hidden = el('routeOverview').hidden = el('routeRotate').hidden = false;
    if (!guide.map) {
      guide.map = new g.Map(el('routeCanvas'), { center: { lat: route.destination.lat, lng: route.destination.lon }, zoom: 17, disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy', clickableIcons: false,
        renderingType: g.RenderingType?.VECTOR, colorScheme: darkPage() ? g.ColorScheme?.DARK : g.ColorScheme?.LIGHT });
      guide.map.addListener('dragstart', () => { guide.follow = false; });
      guide.walked = new g.Polyline({ map: guide.map, strokeColor: '#8a9a92', strokeOpacity: .9, strokeWeight: 6, zIndex: 1 });
      guide.line = new g.Polyline({ map: guide.map, strokeColor: '#0a6a45', strokeOpacity: .95, strokeWeight: 7, zIndex: 2 });
      guide.destMark = new g.Marker({ map: guide.map, zIndex: 3 });
      guide.turnMark = new g.Marker({ map: guide.map, zIndex: 5, icon: { path: g.SymbolPath.CIRCLE, scale: 9, fillColor: '#ffffff', fillOpacity: 1, strokeColor: '#e8590c', strokeWeight: 5 } });
      guide.me = new g.Marker({ map: guide.map, zIndex: 10 });
    }
    guide.mode = 'google';
    applyGuideLook();
    guide.destMark.setPosition({ lat: route.destination.lat, lng: route.destination.lon });
    guide.destMark.setTitle(route.destination.name);
    const next = route.steps[route.next] || route.destination;
    guide.turnMark.setPosition({ lat: next.lat, lng: next.lon });
    placeMe();
    if (!keepView) fitGuideRoute();
  }
  function fitGuideRoute() {
    if (guide.mode !== 'google' || !guide.map || !guide.route) return;
    const bounds = new google.maps.LatLngBounds();
    guide.route.path.forEach(([lat, lng]) => bounds.extend({ lat, lng }));
    if (position) bounds.extend({ lat: position.lat, lng: position.lon });
    guide.follow = false;
    guide.map.setHeading(0);
    guide.map.fitBounds(bounds, 48);
    placeMe();
  }
  function placeMe() {
    if (guide.mode !== 'google' || !guide.map || !position) return;
    const g = google.maps, at = { lat: position.lat, lng: position.lon }, heading = currentHeading();
    if (guide.follow) {
      guide.map.panTo(at);
      const wanted = guide.headingUp && heading !== null ? heading : 0;
      if (turned(wanted, guide.map.getHeading() || 0) > 8) guide.map.setHeading(wanted);
    }
    const scale = guide.big ? 1.4 : 1;
    guide.me.setPosition(at);
    guide.me.setIcon(heading === null
      ? { path: g.SymbolPath.CIRCLE, scale: 9 * scale, fillColor: '#1a73e8', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 }
      : { path: g.SymbolPath.FORWARD_CLOSED_ARROW, rotation: heading - (guide.map.getHeading() || 0), scale: 7 * scale, fillColor: '#1a73e8', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 });
    splitRoute();
  }
  function showTurn(next, nav) {
    el('routeArrow').dataset.turn = next.turn;
    el('routeDistance').textContent = !next.distance ? 'Next' : next.distance_m <= 25 ? 'Now' : 'In ' + next.distance;
    el('routeSay').textContent = firstSentence(next.say);
    el('routeRelative').textContent = nav?.off_route ? 'You are off the route. Finding a new one.' : next.relative ? 'It is ' + next.relative : '';
    el('routeTurn').classList.toggle('off', Boolean(nav?.off_route));
    [...el('routeSteps').children].forEach((item, i) => { item.classList.toggle('done', i < next.index); item.classList.toggle('current', i === next.index); });
    if (nav) {
      el('routeRemaining').textContent = nav.remaining + ' to go';
      const done = nav.total_m ? Math.min(1, Math.max(0, 1 - nav.remaining_m / nav.total_m)) : 0;
      el('routeBar').style.width = Math.round(done * 100) + '%';
    }
    if (guide.mode === 'google' && guide.turnMark && Number.isFinite(next.lat)) guide.turnMark.setPosition({ lat: next.lat, lng: next.lon });
  }
  async function openGuide(keepView = false) {
    let route;
    try { route = await call('/navigation/route?session=' + session); } catch { return; }
    if (!route.active) return closeGuide();
    clearTimeout(guide.hideTimer);
    guide.route = route; guide.nav = null;
    mapDestination = { lat: route.destination.lat, lon: route.destination.lon };
    const external = el('routeExternal');
    if (external) {
      external.href = 'https://www.google.com/maps/dir/?api=1&travelmode=walking&origin='
        + encodeURIComponent(position.lat + ',' + position.lon) + '&destination='
        + encodeURIComponent(route.destination.lat + ',' + route.destination.lon);
      external.hidden = false;
    }
    el('routeDest').textContent = route.destination.name;
    el('routeRemaining').textContent = '';
    el('routeBar').style.width = '0%';
    el('routeSteps').replaceChildren(...route.steps.map(step => { const item = document.createElement('li'); item.textContent = step.say; return item; }));
    el('routeMap').classList.remove('arrived');
    el('routeMap').hidden = false;
    const next = route.steps[route.next] || { say: route.destination.name + ' is ahead.', turn: 'arrive' };
    showTurn({ ...next, index: route.next, distance: '', relative: '' });
    drawGuideMap(keepView);
    reportLocation(true);
  }
  function closeGuide() {
    clearTimeout(guide.hideTimer);
    guide.route = guide.nav = null; mapDestination = null;
    el('routeMap').hidden = true;
    if (el('routeExternal')) el('routeExternal').hidden = true;
    el('routeMapFrame').src = 'about:blank';
  }
  function updateGuide(nav) {
    if (nav.active && nav.next) {
      if (!guide.route || nav.rerouted) return void openGuide(Boolean(guide.route));
      guide.nav = nav;
      showTurn(nav.next, nav);
      placeMe();
      if (guide.mode === 'embed') renderRouteMap();
      if (nav.say) { el('routeTurn').classList.remove('pulse'); void el('routeTurn').offsetWidth; el('routeTurn').classList.add('pulse'); }
    } else if (guide.route && nav.say) {
      el('routeArrow').dataset.turn = 'arrive';
      el('routeDistance').textContent = 'Arrived';
      el('routeSay').textContent = nav.say;
      el('routeRelative').textContent = '';
      el('routeRemaining').textContent = '';
      el('routeBar').style.width = '100%';
      el('routeMap').classList.add('arrived');
      guide.route = null;
      guide.hideTimer = setTimeout(closeGuide, 12000);
    } else if (guide.route) closeGuide();
  }
  el('routeAsk').onclick = () => ask('Which way do I turn?');
  el('routeStop').onclick = () => ask('Stop navigation');
  el('routeOverview').onclick = fitGuideRoute;
  el('routeRecenter').onclick = () => {
    if (guide.mode !== 'google' || !guide.map || !position) return;
    guide.follow = true;
    guide.map.setZoom(18);
    placeMe();
  };
  el('routeRotate').onclick = () => {
    guide.headingUp = !guide.headingUp;
    store.set('guideband_heading_up', guide.headingUp ? 'yes' : 'no');
    applyGuideLook();
    if (guide.mode !== 'google' || !guide.map) return;
    guide.follow = true;
    if (!guide.headingUp) guide.map.setHeading(0);
    placeMe();
  };
  el('routeBig').onclick = () => {
    guide.big = !guide.big;
    store.set('guideband_route_big', guide.big ? 'yes' : 'no');
    applyGuideLook();
    placeMe();
  };
  applyGuideLook();
  if ('vibrate' in navigator && matchMedia('(pointer: coarse)').matches) el('routeHint').hidden = false;
  el('routeMapClose').onclick = () => {
    const hidden = el('routeMap').classList.toggle('no-map');
    el('routeMapClose').textContent = hidden ? 'Show map' : 'Hide map';
    if (!hidden) fitGuideRoute();
  };
  el('apiForm').onsubmit = e => {
    e.preventDefault();
    const value = el('apiInput').value.trim().replace(/\/$/, '');
    api = value === location.origin ? '' : value;
    store.set('guideband_api', api);
    checkService();
  };

  // ---------- Speech out ----------
  // Replies use the ElevenLabs voice when the service has one. Hazard warnings
  // always use the browser's local voice: instant, and no network to wait for.
  let lastReplyAt = 0, lastSpeechEnd = 0, cloudVoice = false, cloudPlaying = false, cloudVoiceRetryAt = 0;
  const buzz = pattern => { try { navigator.vibrate?.(pattern); } catch {} };
  // Safari and mobile Chrome commonly reject HTMLAudioElement.play() after
  // the ElevenLabs fetch has completed, even when the original request began
  // with a tap.  An AudioContext resumed during that tap remains usable when
  // the MP3 arrives, so spoken replies do not disappear silently.
  let audioContext = null, cloudSource = null;
  function unlockAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    if (!audioContext) audioContext = new AudioContextClass();
    audioContext.resume?.().catch(() => {});
    return audioContext.state === 'running';
  }
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
  const hasLocalVoice = () => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const setVoiceState = text => { if (el('voiceState')) el('voiceState').textContent = text; };
  const isSpeaking = () => cloudPlaying || Boolean(window.speechSynthesis?.speaking);
  let lastReplyEnd = 0;
  /** True while a reply is being spoken (not a short hazard warning). */
  const replyTalking = () => cloudPlaying || (replySpeaking && Boolean(window.speechSynthesis?.speaking));
  /** Tell the service the assistant is talking, so the band does not pass that voice back as a request. */
  let replySpeaking = false, bandMuted = false;
  // Once a second: mute the band only while a reply is really being spoken. The mute expires by itself
  // on the service, so it can never get stuck and leave the band deaf.
  setInterval(() => {
    const speaking = cloudPlaying || (replySpeaking && Boolean(window.speechSynthesis?.speaking));
    if (speaking) muteBand(true);
    else if (bandMuted) muteBand(false);
    bandMuted = speaking;
  }, 1000);
  function muteBand(on) {
    if (!bandLive) return;
    const body = new FormData();
    body.append('on', String(on));
    body.append('interrupt', String(el('bargeToggle').checked));
    fetch(api + '/band/mute', { method: 'POST', body, keepalive: true }).catch(() => {});
  }
  function stopSpeaking() {
    replySpeaking = false;
    window.speechSynthesis?.cancel();
    if (cloudSource) {
      try { cloudSource.stop(); } catch {}
      cloudSource = null;
    }
    cloudPlaying = false;
  }
  async function speakCloud(text) {
    const body = new FormData();
    body.append('text', text);
    const response = await fetch(api + '/speech', { method: 'POST', body });
    if (!response.ok) throw new Error('voice unavailable');
    if (!unlockAudio() || audioContext.state !== 'running') throw new Error('audio needs a user gesture');
    const audio = await response.arrayBuffer();
    const buffer = await audioContext.decodeAudioData(audio);
    const done = () => { cloudPlaying = false; cloudSource = null; lastSpeechEnd = lastReplyEnd = Date.now(); if (bandMuted) { muteBand(false); bandMuted = false; } };
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.onended = done;
    cloudSource = source;
    cloudPlaying = true;
    try { source.start(); setVoiceState('Speaking with the ElevenLabs voice.'); } catch (error) { done(); throw error; }
  }
  function speakLocal(text, warning) {
    if (!hasLocalVoice()) {
      setVoiceState('Voice output is unavailable in this browser. Try a current version of Chrome, Safari, or Edge.');
      return false;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = warning ? 1.08 : 1;
    const voices = window.speechSynthesis.getVoices();
    const english = voices.find(voice => /^en(?:[-_]|$)/i.test(voice.lang));
    if (english) utterance.voice = english;
    utterance.onstart = () => { replySpeaking = !warning; };
    utterance.onend = () => { lastSpeechEnd = Date.now(); if (replySpeaking) lastReplyEnd = Date.now(); if (replySpeaking && bandMuted) { muteBand(false); bandMuted = false; } replySpeaking = false; };
    utterance.onerror = () => { replySpeaking = false; setVoiceState('The device voice could not start. Use “Test assistant voice” after allowing sound for this site.'); };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setVoiceState('Speaking with your device voice.');
    return true;
  }
  const plain = text => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const recentlySpoken = [];
  /** True when the microphone just heard GuideEye's own voice coming out of the speakers. */
  function isEcho(heard, source) {
    // Only speech that arrives while the assistant is talking, or just after, can be its own voice.
    // The band is muted while a reply plays, so for the band the window is short. Without this limit,
    // repeating a phrase the assistant had just suggested ("take me home") was thrown away as an echo.
    const text = plain(heard), now = Date.now(), tail = source === 'band' ? 1500 : 4000;
    if (!isSpeaking() && now - lastSpeechEnd > tail) return false;
    return text.length >= 4 && recentlySpoken.some(item => now - item.at < 20000 && item.text.includes(text));
  }
  /**
   * What the user said, with the assistant's own words taken out. Returns '' when it was only an echo.
   * The band hears the speakers too, so a sentence caught during a reply is a mix of both voices, and
   * the speech service mishears the echo ("head west" comes back as "head rest"). So an interruption is
   * only accepted when it starts with a word that begins a request and that the assistant did not say.
   */
  const REQUEST_WORD = /^(what|whats|where|wheres|who|how|when|take|tell|text|send|write|buy|pay|stop|cancel|read|remember|change|set|call|navigate|directions|find|open|show|describe|look|zoom|help|go|get|give|remind|start|save|forget|quiet|enough|wait|nearest|closest|is|are|can|could|please)$/;
  function stripEcho(heard) {
    const spoken = recentlySpoken.filter(item => Date.now() - item.at < 30000).map(item => item.text).join(' ').split(' ');
    const said = new Set(spoken), stems = new Set(spoken.filter(w => w.length >= 4).map(w => w.slice(0, 4)));
    const words = plain(heard).split(' ').filter(Boolean);
    const wake = words.findIndex(w => /^(guide|guides)$/.test(w));
    if (wake >= 0 && words.length > wake + 1) return words.slice(wake + 1).join(' '); // "Guide, ..." always wins
    const own = w => !said.has(w) && !said.has(w.replace(/s$/, '')) && !(w.length >= 4 && stems.has(w.slice(0, 4)));
    // "is", "are", "can", "please" open a request only when the next word is the user's own as well.
    const weak = /^(is|are|can|could|please)$/;
    for (let i = 0; i < words.length; i++) {
      if (!REQUEST_WORD.test(words[i]) || !own(words[i])) continue;
      if (weak.test(words[i]) && !(words[i + 1] && own(words[i + 1]))) continue;
      return words.slice(i).join(' ');
    }
    return '';
  }
  function speak(text, { warning = false, force = false } = {}) {
    if (!text) return;
    recentlySpoken.push({ text: plain(text), at: Date.now() });
    if (recentlySpoken.length > 6) recentlySpoken.shift();
    if (warning) {
      // Warnings never talk over an answer, and stay quiet during a Bridge conversation.
      if (!el('hazardToggle').checked || activeTab === 'bridge' || isSpeaking() || Date.now() - lastReplyAt < 1500) return;
    } else {
      if (!force && !el('voiceToggle').checked) return;
      stopSpeaking();
      lastReplyAt = Date.now();
      if (cloudVoice && Date.now() > cloudVoiceRetryAt) {
        // If the voice service fails (for example, out of credits), use the local voice and retry later.
        return void speakCloud(text).catch(() => {
          cloudVoiceRetryAt = Date.now() + 120000;
          setVoiceState('AI voice could not start, so GuideEye is using your device voice.');
          speakLocal(text, false);
        });
      }
    }
    speakLocal(text, warning);
  }
  // This direct gesture also unlocks audio in browsers that block a first
  // streamed reply until the person has interacted with the page.
  el('voiceTest').onclick = () => {
    unlockAudio();
    window.speechSynthesis?.resume();
    speak('GuideEye voice is working. I can read directions and help add contacts.', { force: true });
  };

  // ---------- Camera ----------
  const video = el('liveVideo'), overlay = el('liveOverlay'), stage = video.parentElement;
  const grab = document.createElement('canvas');
  let stream = null, facing = 'environment';

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot open the camera here. Use Chrome on localhost or HTTPS.');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 960 } }, audio: false });
    } catch (error) {
      // A remembered/virtual device can disappear after a reload. Retrying
      // without a device preference lets the browser choose any real camera.
      if (error.name !== 'NotFoundError' && error.name !== 'OverconstrainedError') throw error;
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    video.srcObject = stream;
    await video.play();
    stage.classList.add('on');
    el('camBtn').textContent = 'Turn camera off';
    hazardLoop();
    syncSigns();
  }
  function stopCamera() {
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    stage.classList.remove('on');
    el('camBtn').textContent = 'Turn camera on';
    el('liveWarning').textContent = '';
    overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
    syncSigns();
  }
  let lastCameraError = '';
  const cameraError = error => {
    const message = error.name === 'NotAllowedError' ? 'Camera permission was denied. Allow the camera for this page and try again.'
      : error.name === 'NotFoundError' ? 'No camera is available. Connect or enable a camera, then try again.' : error.message;
    if (message === lastCameraError) return;
    lastCameraError = message;
    addMessage('error', message);
  };
  el('camBtn').onclick = async () => {
    if (stream) return stopCamera();
    try { await startCamera(); } catch (error) { cameraError(error); }
  };
  el('flipBtn').onclick = async () => {
    facing = facing === 'environment' ? 'user' : 'environment';
    if (!stream) return;
    stopCamera();
    try { await startCamera(); } catch (error) { cameraError(error); }
  };

  // ---------- Zoom ----------
  const ZOOM_STEPS = [1, 1.5, 2, 3, 4];
  let zoom = 1;
  function setZoom(value, announce) {
    zoom = Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], Math.max(1, value));
    video.style.transform = zoom === 1 ? '' : 'scale(' + zoom + ')';
    overlay.dataset.zoom = String(zoom); // the sign reader draws the hand at the same zoom
    el('zoomLabel').textContent = zoom + '×';
    el('zoomOut').disabled = zoom === 1;
    el('zoomIn').disabled = zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1];
    if (announce) speak(zoom === 1 ? 'Zoom off.' : 'Zoom ' + zoom + ' times.');
  }
  const zoomStep = direction => {
    const index = ZOOM_STEPS.indexOf(zoom);
    setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + direction))], false);
  };
  el('zoomIn').onclick = () => zoomStep(1);
  el('zoomOut').onclick = () => zoomStep(-1);
  setZoom(1, false);

  /** Current frame as a JPEG blob, or null when the camera is off. */
  function frame(maxWidth = 640) {
    if (!stream || !video.videoWidth) return Promise.resolve(null);
    // With zoom, only the middle of the picture is sent — the same part that is shown.
    const cropWidth = video.videoWidth / zoom, cropHeight = video.videoHeight / zoom;
    const scale = Math.min(1, maxWidth / cropWidth);
    grab.width = Math.round(cropWidth * scale);
    grab.height = Math.round(cropHeight * scale);
    grab.getContext('2d').drawImage(video, (video.videoWidth - cropWidth) / 2, (video.videoHeight - cropHeight) / 2,
      cropWidth, cropHeight, 0, 0, grab.width, grab.height);
    return new Promise(resolve => grab.toBlob(resolve, 'image/jpeg', 0.72));
  }

  function drawBoxes(detections) {
    const w = overlay.width = stage.clientWidth, h = overlay.height = stage.clientHeight;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (!video.videoWidth) return;
    // The video is shown with object-fit: cover, so map boxes through the same crop.
    const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
    const dx = (w - video.videoWidth * scale) / 2, dy = (h - video.videoHeight * scale) / 2;
    ctx.lineWidth = 3; ctx.font = '600 14px system-ui, sans-serif'; ctx.textBaseline = 'top';
    for (const d of detections) {
      const x = dx + d.box[0] * video.videoWidth * scale, y = dy + d.box[1] * video.videoHeight * scale;
      const bw = (d.box[2] - d.box[0]) * video.videoWidth * scale, bh = (d.box[3] - d.box[1]) * video.videoHeight * scale;
      ctx.strokeStyle = '#d8ff70'; ctx.strokeRect(x, y, bw, bh);
      ctx.fillStyle = '#d8ff70'; ctx.fillRect(x, Math.max(0, y - 20), ctx.measureText(d.label).width + 10, 20);
      ctx.fillStyle = '#07120f'; ctx.fillText(d.label, x + 5, Math.max(0, y - 20) + 3);
    }
  }

  // ---------- See: continuous local hazard warnings ----------
  const sources = { gemini: 'Gemini', groq: 'Groq', llm: 'language model', local: 'on-device', harnessrouter: 'HarnessRouter agent' };
  const spokenAt = new Map(), seenAt = new Map(), waiting = new Set();
  let looping = false, busy = false, personSeenAt = 0;
  let candidateKey = '', stable = 0, narratedKey = '', narratedAt = 0;

  async function narrate(blob) {
    try {
      const body = new FormData();
      body.append('image', blob, 'frame.jpg');
      body.append('question', 'The scene just changed. In one short sentence, tell me what is in front of me now.');
      body.append('remember', 'true');
      addLocation(body);
      const scene = await call('/vision/analyze', { method: 'POST', body });
      if (scene.provider && scene.provider !== 'local' && !busy && !isSpeaking()) {
        addMessage('guide', scene.description, 'automatic · ' + sources[scene.provider]);
        speak(scene.description);
      }
    } catch {}
  }

  async function hazardLoop() {
    if (looping) return;
    looping = true;
    while (stream) {
      const started = Date.now();
      if (online && !document.hidden) {
        try {
          const blob = await frame();
          if (blob) {
            const body = new FormData();
            body.append('image', blob, 'frame.jpg');
            body.append('describe', 'false');
            const scene = await call('/vision/analyze', { method: 'POST', body });
            if (!stream) break;
            if (activeTab !== 'bridge') drawBoxes(scene.detections); // Bridge draws the hand instead
            if (scene.detections.some(d => d.label === 'person')) personSeenAt = Date.now();
            el('liveWarning').textContent = activeTab === 'bridge' ? '' : scene.warnings.join(' ');
            // Speak a warning when it first appears (or returns after being gone), then stay quiet about it.
            const nowMs = Date.now();
            for (const warning of scene.warnings) {
              const gone = nowMs - (seenAt.get(warning) || 0) > 6000;
              if (gone || nowMs - (spokenAt.get(warning) || 0) > 60000) waiting.add(warning);
              seenAt.set(warning, nowMs);
            }
            for (const warning of [...waiting]) if (!scene.warnings.includes(warning)) waiting.delete(warning);
            const fresh = [...waiting][0];
            if (fresh && activeTab !== 'bridge' && el('hazardToggle').checked && !isSpeaking() && nowMs - lastReplyAt > 1500) {
              waiting.delete(fresh); spokenAt.set(fresh, nowMs);
              speak(fresh, { warning: true }); buzz(400);
            }
            // Narrate only when what is in view has changed and stayed changed.
            const key = [...new Set(scene.detections.filter(d => d.area >= 0.02).map(d => d.label))].sort().join(',');
            if (key === candidateKey) stable++; else { candidateKey = key; stable = 0; }
            // Vision providers can rate-limit image calls. Keep the automatic
            // narration useful without consuming the quota needed for an
            // explicit "what is in front of me?" request.
            if (el('autoDescribe').checked && activeTab !== 'bridge' && key && stable >= 2 && key !== narratedKey
                && Date.now() - narratedAt > 30000 && !busy && !isSpeaking()) {
              narratedKey = key; narratedAt = Date.now();
              narrate(blob);
            }
          }
        } catch { online = false; checkService(); }
      }
      await wait(Math.max(150, 700 - (Date.now() - started)));
    }
    looping = false;
  }

  // ---------- Assistant ----------
  const log = el('liveLog');
  function addMessage(kind, text, meta) {
    const item = document.createElement('li');
    item.className = 'msg msg-' + kind;
    const p = document.createElement('p');
    p.textContent = text;
    item.append(p);
    if (meta) { const small = document.createElement('small'); small.textContent = meta; item.append(small); }
    log.append(item);
    log.scrollTop = log.scrollHeight;
    return item;
  }

  let retryWithLocation = '', contactNudgeTimer = null, contactConversation = false;
  /** Show and speak one assistant reply, wherever the request came from. */
  function showReply(reply, asked) {
    clearTimeout(contactNudgeTimer);
    contactConversation = reply.intent === 'contact_waiting' || reply.intent === 'contact_edit_waiting';
    let meta = reply.provider ? sources[reply.provider] + ' · ' + ((reply.latency_ms || 0) / 1000).toFixed(1) + ' s' : '';
    if (reply.intent === 'pay_confirm' && reply.order) {
      meta = reply.order.mode === 'stripe_test' ? 'Stripe test payment · ' + reply.order.status + ' · ' + reply.order.payment_id : 'Simulated payment';
    }
    // If the answer needs a location we do not have yet, ask for it and repeat the request once it arrives.
    if (!position && asked && /location on/i.test(reply.say || '')) {
      retryWithLocation = asked;
      addMessage('guide', 'I need your location for that. Please allow location — I will continue as soon as I have it.');
      speak('Please allow location.');
      enableLocation();
      return;
    }
    // The assistant asked for an address, a name, or a missing detail: a short answer is a complete answer.
    awaitingAnswer = ['place_set', 'contact_edit_waiting', 'clarify'].includes(reply.intent);
    const item = addMessage('guide', reply.say, meta);
    speak(reply.say);
    if (reply.errand && reply.errand.status === 'in_progress') watchErrand(reply.errand.id, 0);
    // Contact setup stays conversational: if a person stops after starting it,
    // gently check whether they still want to dictate the WhatsApp number.
    if (reply.intent === 'contact_waiting') {
      contactNudgeTimer = setTimeout(() => {
        const prompt = 'Do you want to continue adding this contact? Say yes, or say cancel.';
        addMessage('guide', prompt, 'contact setup');
        speak(prompt);
      }, 12000);
    }
    el('confirmBar').hidden = !reply.confirm;
    if (reply.confirm) { el('confirmText').textContent = reply.confirm; buzz([80, 80, 80]); }
    if (reply.open_url) {
      // WhatsApp only sends when the person presses Send, so hand them the prepared chat.
      const link = document.createElement('a');
      link.className = 'btn btn-primary btn-small msg-link';
      link.href = reply.open_url; link.target = '_blank'; link.rel = 'noopener';
      link.textContent = 'Open WhatsApp';
      item.append(link);
      window.open(reply.open_url, '_blank', 'noopener');
    }
    if (reply.map_url) openGuide();
    if (reply.timer) {
      const { seconds, label } = reply.timer;
      setTimeout(() => {
        const text = label ? 'Reminder: ' + label + '.' : 'Your timer is up.';
        addMessage('guide', text, 'timer');
        speak(text);
        buzz([300, 120, 300, 120, 300]);
      }, seconds * 1000);
    }
    if (reply.intent === 'nav_stop' || (reply.intent === 'navigate' && !reply.navigating)) { el('navStatus').textContent = ''; closeGuide(); }
    if (reply.navigating) el('navStatus').textContent = 'Directions are on. Keep walking — I will speak each turn.';
    if (reply.intent === 'bridge') selectTab('bridge');
    if (activeTab === 'memory') loadMemory();
  }

  function watchErrand(id, tries) {
    if (tries >= 40) return;
    setTimeout(async () => {
      try {
        const body = new FormData();
        body.append('text', 'is my errand ready');
        body.append('session', session);
        const reply = await call('/assistant', { method: 'POST', body });
        if (!reply.errand || reply.errand.id !== id) return;
        if (reply.errand.status === 'in_progress') return watchErrand(id, tries + 1);
        showReply(reply, '');
      } catch (error) { watchErrand(id, tries + 1); }
    }, 8000);
  }

  let queued = '';
  async function ask(text) {
    text = text.trim();
    if (!text) return;
    if (busy) { queued = text; return; }
    if (!online) { await checkService(); if (!online) return addMessage('error', 'I can’t reach the GuideEye service. Start it, then try again.'); }
    busy = true;
    addMessage('user', text);
    const pendingItem = addMessage('guide', 'Thinking');
    pendingItem.classList.add('thinking');
    try {
      const body = new FormData();
      body.append('text', text);
      body.append('session', session);
      const blob = await frame();
      if (blob) body.append('image', blob, 'frame.jpg');
      addLocation(body);
      const reply = await call('/assistant', { method: 'POST', body });
      pendingItem.remove();
      showReply(reply, text);
    } catch (error) {
      pendingItem.remove();
      addMessage('error', error.message || 'Something went wrong.');
    }
    busy = false;
    if (queued) { const next = queued; queued = ''; ask(next); }
  }
  el('askForm').onsubmit = e => { e.preventDefault(); const input = el('askInput'); ask(input.value); input.value = ''; };
  document.querySelectorAll('#live [data-say]').forEach(button => button.onclick = () => ask(button.dataset.say));

  // ---------- Speech in: one microphone listener that is always on ----------
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const WAKE = /^(?:hey |okay |ok )?(?:guide|guides|guyed|guy|god)\b[\s,.!?]*(.*)$/i;
  let recognizer = null, micBlocked = false;

  function micState(text, kind) {
    el('micState').textContent = text;
    el('micState').dataset.state = kind;
  }
  // Leave a generous silence window before sending a command. People often
  // pause to think halfway through a request ("take me to… the pharmacy near
  // my hotel"), and sending after the first pause loses the destination.
  const SPEECH_PAUSE_MS = 2000;
  let interimTimer = null, finalSpeechParts = [], handledText = '', handledAt = 0;
  let heardThrough = '';
  function heardNote(text, note) {
    micState('Heard' + heardThrough + ': “' + text + '”' + (note ? ' — ' + note : ''), 'on');
  }
  function queueBrowserSpeech(interim = '') {
    clearTimeout(interimTimer);
    const fullText = [...finalSpeechParts, interim].join(' ').trim();
    if (!fullText) return;
    if (activeTab === 'bridge') el('bridgeCaption').textContent = fullText;
    else el('askInput').placeholder = 'Listening: ' + fullText;
    // Recognition sometimes never supplies a final result in a noisy room,
    // so silence is the reliable end-of-thought signal.
    interimTimer = setTimeout(() => {
      const completed = [...finalSpeechParts, interim].join(' ').trim();
      finalSpeechParts = [];
      el('askInput').placeholder = micPlaceholder();
      if (completed) handleSpeech(completed);
    }, SPEECH_PAUSE_MS);
  }
  function handleSpeech(text, source) {
    el('askInput').placeholder = micPlaceholder();
    if (!text) return;
    heardThrough = source === 'band' ? ' (through the Vexo band)' : '';
    const zoomWord = text.toLowerCase().match(/\bzoom (in|out|off|back)\b|\b(reset|no|stop) zoom\b/);
    if (zoomWord && !isEcho(text, source)) {
      heardNote(text);
      if (zoomWord[1] === 'in') { zoomStep(1); speak('Zoom ' + zoom + ' times.'); }
      else if (zoomWord[1] === 'out') { zoomStep(-1); speak(zoom === 1 ? 'Zoom off.' : 'Zoom ' + zoom + ' times.'); }
      else setZoom(1, true);
      return;
    }
    if (source === 'band' && el('bargeToggle').checked && (replyTalking() || Date.now() - lastReplyEnd < 1500)) {
      // The band heard this while the assistant was talking: keep only the words that are not the assistant's own.
      // A bare "yes" or "no" is the user answering. The assistant never says just that on its own:
      // its own voice comes back as a whole sentence ("say yes to send, or no to cancel").
      const answer = /^(?:yes|yeah|yep|yup|no|nope|cancel|okay|ok|sure|correct|right)(?: (?:please|pay|send|send it|do it|change it|save it|thanks))?$/.test(plain(text));
      const mine = answer ? plain(text) : stripEcho(text);
      if (!mine) return heardNote(text, 'ignored, that was my own voice');
      if (/^(stop|quiet|enough|wait|shut up|be quiet)$/.test(mine)) { // just silence, not a new request
        heardNote(text); stopSpeaking(); buzz(60);
        return;
      }
      text = mine;
    } else if (!/^(?:yes|yeah|yep|yup|no|nope|cancel|okay|ok)$/.test(plain(text)) && isEcho(text, source)) return heardNote(text, 'ignored, that was my own voice');
    // The browser's recogniser can deliver one sentence twice within a moment; the band never does.
    // A sentence the user deliberately repeats must always get through.
    const key = plain(text);
    if (source !== 'band' && key === handledText && Date.now() - handledAt < 2000) return;
    handledText = key; handledAt = Date.now();
    const wake = text.match(WAKE);
    const command = wake ? wake[1].trim() : '';
    if (activeTab === 'bridge') {
      // In a Bridge conversation everything said becomes text and signs for the other person.
      showSpeech(text);
      if (command) ask(command);
      return;
    }
    const answering = !el('confirmBar').hidden && /^(yes|yeah|yep|no|nope|cancel)\b/i.test(text);
    if (command) { heardNote(text); stopSpeaking(); buzz(60); return ask(command); }
    if (answering) { heardNote(text); stopSpeaking(); buzz(60); return ask(text); }
    if (el('wakeToggle').checked) return heardNote(text, 'waiting for “Guide”');
    if (text.split(/\s+/).length < 2 && !contactConversation) return heardNote(text, 'too short');
    heardNote(text); stopSpeaking(); buzz(60);
    ask(text);
  }
  const micPlaceholder = () => el('wakeToggle').checked ? 'Say “Guide, …” or type here' : 'Just talk, or type here';
  function startMic() {
    if (bandLive) return; // the band is the microphone right now
    if (el('micSource').value) return void startDeviceMic(); // a chosen microphone, e.g. the bracelet
    if (!Recognition || recognizer || micBlocked || !el('micToggle').checked) return;
    const r = new Recognition();
    r.lang = 'en-US'; r.continuous = true; r.interimResults = true;
    r.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal) finalSpeechParts.push(text); else interim += text + ' ';
      }
      queueBrowserSpeech(interim.trim());
    };
    r.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        micBlocked = true;
        micState('Microphone blocked — click anywhere here, then allow it', 'off');
      }
    };
    // The browser stops listening after a pause; start again so the microphone stays on.
    r.onend = () => { if (recognizer === r) recognizer = null; if (!micBlocked) setTimeout(startMic, 250); };
    recognizer = r;
    try {
      r.start();
      if (el('micState').dataset.state !== 'on') micState('Microphone on — listening', 'on'); // keep the last "Heard" note
    } catch { recognizer = null; }
  }
  function stopMic() {
    stopDeviceMic();
    const r = recognizer;
    recognizer = null;
    if (r) { r.onend = null; r.abort(); }
    micState('Microphone off', 'off');
  }
  // ----- A chosen microphone (the Vexo bracelet, a headset…) -----
  // The browser's own speech recognition can only use the default microphone, so audio from a
  // chosen one is cut into sentences here by loudness and transcribed by the service (Deepgram).
  let capture = null;
  function stopDeviceMic() {
    if (!capture) return;
    clearInterval(capture.timer);
    capture.stream.getTracks().forEach(track => track.stop());
    capture.context.close();
    capture = null;
  }
  async function sendClip(blob) {
    try {
      const body = new FormData();
      body.append('audio', blob, 'speech.webm');
      const result = await call('/speech/transcribe', { method: 'POST', body });
      if (result.text) handleSpeech(result.text); else micState('Listening through ' + sourceName(), 'on');
    } catch (error) { micState('Could not transcribe: ' + error.message, 'off'); }
  }
  const sourceName = () => el('micSource').selectedOptions[0]?.textContent || 'the chosen microphone';
  async function startDeviceMic() {
    if (capture || !el('micToggle').checked) return;
    const deviceId = el('micSource').value;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true } });
    } catch { return micState('Could not open that microphone', 'off'); }
    if (capture || el('micSource').value !== deviceId) return stream.getTracks().forEach(track => track.stop());
    const context = new AudioContext(), analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let recorder = null, chunks = [], startedAt = 0, lastLoudAt = 0, floor = 0.01;
    capture = { stream, context, timer: setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) sum += value * value;
      const level = Math.sqrt(sum / samples.length), now = performance.now();
      const loud = level > Math.max(0.015, floor * 3) && !isSpeaking();
      if (!recorder) floor = floor * 0.97 + level * 0.03; // follow the room noise while nobody talks
      if (loud) {
        lastLoudAt = now;
        if (!recorder) {
          chunks = []; startedAt = now;
          recorder = new MediaRecorder(stream);
          recorder.ondataavailable = event => chunks.push(event.data);
          recorder.start();
          micState('Hearing you through ' + sourceName() + '…', 'on');
        }
      } else if (recorder && (now - lastLoudAt > 900 || now - startedAt > 15000)) {
        const finished = recorder, spoke = lastLoudAt - startedAt;
        recorder = null;
        finished.onstop = () => { if (spoke > 350) sendClip(new Blob(chunks, { type: finished.mimeType })); };
        finished.stop();
      }
    }, 50) };
    micState('Listening through ' + sourceName(), 'on');
  }
  async function listMicrophones() {
    try {
      // Device names are only shown after the microphone permission has been given once.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach(track => track.stop());
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
      const select = el('micSource'), current = select.value;
      select.length = 1;
      for (const device of devices) select.add(new Option(device.label || 'Microphone', device.deviceId));
      const bracelet = devices.find(d => /vexo|hack/i.test(d.label));
      select.value = bracelet ? bracelet.deviceId : (devices.some(d => d.deviceId === current) ? current : '');
      if (bracelet) addMessage('guide', 'I found the bracelet microphone (' + bracelet.label + ') and I am listening through it.');
      el('micSource').onchange();
    } catch { micState('Microphone permission is needed to list microphones', 'off'); }
  }
  el('micRefresh').onclick = listMicrophones;
  if (el('webBandListenBtn')) {
    el('webBandListenBtn').onclick = async () => {
      const btn = el('webBandListenBtn');
      btn.textContent = 'Connecting…';
      btn.disabled = true;
      micState('Connecting to wristband… wait for the solid blue light, then speak.', 'on');
      try {
        const imageBlob = await frame(640);
        const body = new FormData();
        body.append('seconds', '7');
        body.append('language', 'en'); // English only: the multilingual mode mishears names
        if (imageBlob) body.append('image', imageBlob, 'frame.jpg');
        body.append('session', session);
        addLocation(body);

        const response = await fetch(api + '/wearable/listen', { method: 'POST', body });
        const res = await response.json();
        btn.textContent = 'Processing…';
        if (res.ok && res.text) {
          addMessage('user', '“' + res.text + '” (from wristband)');
          showReply(res, res.text);
        } else {
          addMessage('guide', res.detail || res.say || 'No speech was transcribed. Keep the band close to your mouth and speak after the solid blue light appears.');
        }
      } catch (err) {
        addMessage('guide', 'Wristband connection failed: ' + err.message);
      } finally {
        btn.textContent = 'Listen on band';
        btn.disabled = false;
        micState('Ready', 'on');
      }
    };
  }
  el('micSource').onchange = () => {
    // Switch between the browser's recognition and the chosen microphone.
    const r = recognizer;
    recognizer = null;
    if (r) { r.onend = null; r.abort(); }
    stopDeviceMic();
    micState('Microphone off', 'off');
    if (el('micToggle').checked) startMic();
  };

  if (!Recognition) {
    el('micToggle').checked = false;
    el('micToggle').disabled = true;
    micState('Voice input isn’t available in this browser — type instead, or use Chrome', 'off');
  } else {
    el('micToggle').onchange = () => { micBlocked = false; el('micToggle').checked ? startMic() : stopMic(); };
    // A first click anywhere in the demo is enough for the browser to allow the microphone.
    el('live').addEventListener('click', () => { if (micBlocked) { micBlocked = false; startMic(); } });
    startMic();
  }

  // ---------- Bridge: signs are read on this device and spoken; speech becomes text and fingerspelling ----------
  const signHandlers = {
    onUpdate: state => {
      el('signLive').textContent = state.current
        ? state.current + ' · ' + Math.round(state.confidence * 100) + '% sure'
        : 'No sign in view';
      if (state.handCount) {
        const context = [state.handCount + (state.handCount === 1 ? ' hand' : ' hands'), state.face].filter(Boolean).join(' · ');
        el('signLive').textContent += ' · ' + context;
      }
      el('signMeter').style.width = Math.round(state.progress * 100) + '%';
      el('signOut').textContent = state.text.trim() || '—';
    },
    onWord: word => {
      if (!word) return;
      // SOS is the Signal for Help: say it clearly, and make it felt.
      if (word === 'SOS') { speak('S O S. This person is asking for help.', { force: true }); buzz([400, 150, 400, 150, 400]); return; }
      speak(word.toLowerCase(), { force: true }); buzz(60);
    },
  };
  async function syncSigns() {
    if (activeTab !== 'bridge' || !stream) {
      if (GuideSigns.running) GuideSigns.stop();
      if (activeTab === 'bridge') el('bridgeState').textContent = 'Turn the camera on so I can see signs.';
      return;
    }
    el('bridgeState').textContent = 'Loading the sign reader…';
    try {
      await GuideSigns.start(video, overlay, signHandlers);
      el('bridgeState').textContent = 'Reading signs live, on this device.';
    } catch {
      el('bridgeState').textContent = 'The sign reader could not load. Check the internet connection and reopen Bridge.';
    }
  }
  document.querySelectorAll('#live [name="signMode"]').forEach(radio => {
    radio.onchange = () => { GuideSigns.setMode(radio.value); GuideSigns.clear(); };
  });
  el('signClear').onclick = () => GuideSigns.clear();

  // Speech to sign: show what was said as ASL fingerspelling, one handshape per letter.
  const signImage = letter => 'https://commons.wikimedia.org/wiki/Special:FilePath/Sign_language_' + letter + '.svg';
  let spellRun = 0;
  async function fingerspell(text) {
    const run = ++spellRun, strip = el('spellOut');
    const words = text.replace(/[^A-Za-z' ]/g, '').split(/ +/).filter(Boolean).slice(0, 14);
    strip.replaceChildren();
    for (const word of words) {
      // Each word gets its own line: the word itself, then one handshape per letter.
      const line = document.createElement('div'), label = document.createElement('span'), group = document.createElement('span');
      line.className = 'spell-line';
      label.className = 'spell-label';
      label.textContent = word;
      group.className = 'spell-word';
      line.append(label, group);
      strip.append(line);
      for (const letter of word.toUpperCase().replace(/[^A-Z]/g, '')) {
        if (run !== spellRun) return; // something newer was said
        const card = document.createElement('figure'), image = new Image(), caption = document.createElement('figcaption');
        card.className = 'spell-card';
        image.alt = '';
        image.onerror = () => image.remove(); // the letter itself still shows
        image.src = signImage(letter);
        caption.textContent = letter;
        card.append(image, caption);
        group.append(card);
        strip.scrollTop = strip.scrollHeight;
        await wait(300);
      }
      await wait(250);
    }
  }
  // Big view to turn towards the other person: only what you said, as large as the screen allows.
  const facingView = el('facing');
  el('facingBtn').onclick = () => {
    const open = !facingView.classList.contains('facing-open');
    facingView.classList.toggle('facing-open', open);
    el('facingBtn').textContent = open ? 'Close big view' : 'Show them — big view';
    if (open) facingView.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen();
  };
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && facingView.classList.contains('facing-open')) {
      facingView.classList.remove('facing-open');
      el('facingBtn').textContent = 'Show them — big view';
    }
  });
  function showSpeech(text) {
    el('bridgeCaption').textContent = text;
    fingerspell(text);
  }
  el('speakForm').onsubmit = e => {
    e.preventDefault();
    const text = el('speakInput').value.trim();
    if (!text) return;
    showSpeech(text);
    speak(text, { force: true });
    el('speakInput').value = '';
  };

  // ---------- Location and directions ----------
  let position = null, lastSent = 0, watchId = null;
  function addLocation(body) {
    if (position) { body.append('lat', position.lat); body.append('lon', position.lon); }
  }
  function enableLocation() {
    if (el('locationToggle').checked) return;
    el('locationToggle').checked = true;
    el('locationToggle').onchange();
  }
  function onPosition(fix) {
    const first = !position;
    position = { lat: fix.coords.latitude, lon: fix.coords.longitude };
    placeMe();
    if (first) {
      refreshPermissions();
      if (retryWithLocation) { const again = retryWithLocation; retryWithLocation = ''; ask(again); }
    }
    reportLocation();
  }
  function reportLocation(force = false) {
    if (!online || !position || (!force && Date.now() - lastSent < (guide.route ? 2000 : 4000))) return;
    lastSent = Date.now();
    const body = new FormData();
    addLocation(body);
    body.append('session', session);
    if (compassHeading !== null) { body.append('heading', compassHeading.toFixed(0)); compassSent = compassHeading; }
    call('/location', { method: 'POST', body }).then(nav => {
      if (nav.active) el('navStatus').textContent = 'Walking to ' + nav.destination + ' · ' + nav.remaining + ' to go';
      else if (nav.say) el('navStatus').textContent = '';
      if (nav.say) { addMessage('guide', nav.say, 'directions'); speak(nav.say); turnBuzz(nav); }
      updateGuide(nav);
    }).catch(() => {});
  }
  el('locationToggle').onchange = () => {
    if (!el('locationToggle').checked) {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null; position = null; el('navStatus').textContent = '';
      return;
    }
    if (!navigator.geolocation) { el('locationToggle').checked = false; return addMessage('error', 'This browser cannot share location.'); }
    startCompass();
    watchId = navigator.geolocation.watchPosition(onPosition, () => {
      el('locationToggle').checked = false; watchId = null;
      addMessage('error', 'Location permission was denied. Directions need it.');
    }, { enableHighAccuracy: true, maximumAge: 2000 });
  };

  // ---------- Family contacts ----------
  async function loadContacts() {
    if (!online) return;
    try {
      const contacts = await call('/contacts');
      const list = el('contactList');
      list.replaceChildren();
      for (const contact of contacts) {
        const item = document.createElement('li'), small = document.createElement('small'), remove = document.createElement('button');
        item.textContent = contact.name;
        small.textContent = '+' + contact.phone;
        remove.type = 'button'; remove.className = 'link-button'; remove.textContent = 'Remove';
        remove.setAttribute('aria-label', 'Remove ' + contact.name);
        remove.onclick = () => call('/contacts/' + encodeURIComponent(contact.name), { method: 'DELETE' }).then(loadContacts).catch(() => {});
        item.append(small, remove);
        list.append(item);
      }
      if (!contacts.length) { const empty = document.createElement('li'); empty.className = 'memory-empty'; empty.textContent = 'No contacts yet.'; list.append(empty); }
    } catch {}
  }
  el('contactForm').onsubmit = async e => {
    e.preventDefault();
    const body = new FormData();
    body.append('name', el('contactName').value);
    body.append('phone', el('contactPhone').value);
    try {
      await call('/contacts', { method: 'POST', body });
      el('contactName').value = ''; el('contactPhone').value = ''; el('contactHint').textContent = '';
      loadContacts();
    } catch (error) { el('contactHint').textContent = error.message; }
  };

  // ---------- Memory ----------
  function ago(seconds) {
    if (seconds < 45) return 'just now';
    const minutes = Math.round(seconds / 60);
    return minutes < 60 ? minutes + ' min ago' : Math.round(minutes / 60) + ' h ago';
  }
  async function loadMemory() {
    if (!online) return;
    try {
      const data = await call('/memory');
      const list = el('memoryList'), nowSeconds = Date.now() / 1000;
      list.replaceChildren();
      const add = (text, meta) => {
        const item = document.createElement('li'), small = document.createElement('small');
        item.textContent = text; small.textContent = meta; item.append(small); list.append(item);
      };
      data.notes.forEach(n => add(n.text, n.kind + ' · ' + ago(nowSeconds - n.created)));
      data.objects.forEach(o => add(o.label + ' — ' + o.position, 'detector · ' + ago(nowSeconds - o.last_seen)));
      // The relationship graph: what each thing was found on, in or beside.
      (data.connections || []).forEach(c => add(
        c.subject + ' — ' + c.relation.replace(/_/g, ' ') + ' — ' + c.object,
        'connection · ' + ago(nowSeconds - c.created),
      ));
      if (!list.children.length) { const empty = document.createElement('li'); empty.className = 'memory-empty'; empty.textContent = 'Nothing remembered yet.'; list.append(empty); }
      const remote = data.supermemory || {};
      const hint = el('memoryRemote');
      if (hint) {
        if (!remote.configured) {
          hint.textContent = 'Long-term memory off · everything stays on this machine';
        } else {
          // Spell out what has actually gone over, so "nothing in the dashboard"
          // can be told apart from a broken key.
          const bits = [`Long-term memory on · Supermemory namespace “${remote.namespace}”`];
          bits.push(`${remote.synced || 0} note${remote.synced === 1 ? '' : 's'} synced`);
          if (remote.pending_writes) bits.push(`${remote.pending_writes} in flight`);
          if (remote.errors) bits.push(`${remote.errors} failed`);
          if (remote.skipped_requests) {
            bits.push(`${remote.skipped_requests} spoken request${remote.skipped_requests === 1 ? '' : 's'} kept on this device`);
          }
          hint.textContent = bits.join(' · ');
        }
      }
    } catch {}
  }
  el('memoryRefresh').onclick = loadMemory;
  el('memoryClear').onclick = async () => {
    if (!confirm('Erase everything GuideEye remembers? This cannot be undone.')) return;
    try { await call('/memory', { method: 'DELETE' }); loadMemory(); } catch (error) { addMessage('error', error.message); }
  };
  setInterval(async () => {
    if (!el('autoRemember').checked || !stream || !online || busy) return;
    const blob = await frame();
    if (!blob) return;
    const body = new FormData();
    body.append('image', blob, 'frame.jpg');
    addLocation(body);
    call('/memory/observe', { method: 'POST', body }).then(() => { if (activeTab === 'memory') loadMemory(); }).catch(() => {});
  }, 20000);

  // People pause in the middle of a request: "change my ... home address ... to ...". The band hands
  // each piece over separately, so a piece that plainly is not finished waits for the next one.
  const UNFINISHED = /(?:\b(?:my|to|the|a|an|and|or|but|of|at|in|on|for|from|with|about|is|are|we|please|can|could|would|your|get|change|take|tell|set|buy|pay|show|find|give|where|what|how|near|nearest|closest|next)|,)\s*$/i;
  // Short things that are complete on their own.
  const SHORT_REQUEST = /^(?:yes|yeah|yep|no|nope|okay|ok|cancel|stop|help|pay|pay this|buy this|scan this|read this|read text|read the text|remember this|take me home|take me back|go back|go home|where am i|what is this|whats this|what's this|stop navigation|zoom in|zoom out|reset zoom|forget everything|thank you|thanks)\b[\s.!?]*$|^(?:yes|yeah|yep|no|nope|okay|ok|cancel|stop)\b.{0,24}$/i;
  let heldPiece = '', heldTimer = null, awaitingAnswer = false;
  function bandPiece(text) {
    clearTimeout(heldTimer);
    const whole = (heldPiece + ' ' + text).trim();
    heldPiece = '';
    const words = whole.split(/\s+/).length;
    // A yes or no, or an address, is expected right now: short answers are complete answers.
    const answering = !el('confirmBar').hidden || awaitingAnswer;
    const fragment = words <= 3 && !SHORT_REQUEST.test(whole) && !answering;
    if ((UNFINISHED.test(whole) && words <= 10) || fragment) {
      heldPiece = whole;
      micState('Heard (through the Vexo band): “' + whole + '…”', 'on');
      heldTimer = setTimeout(() => {
        const rest = heldPiece;
        heldPiece = '';
        if (!rest) return;
        // A proper sentence that merely trailed off is still handled. Two or three stray words are not:
        // answering "can you show" or "change it" with a description of the room only gets in the way.
        if (rest.split(/\s+/).length > 3) handleSpeech(rest, 'band');
        else micState('Heard (through the Vexo band): “' + rest + '” — not enough to act on', 'on');
      }, 4500);
      return;
    }
    handleSpeech(whole, 'band');
  }

  // ---------- Vexo band microphone ----------
  // The service keeps one permanent connection to the band. Sentences heard through it arrive here
  // and are handled like any other speech; while the band is connected the laptop microphone rests,
  // so nothing is heard twice.
  function showBandLive(band) {
    const was = bandLive;
    bandLive = Boolean(band && band.connected);
    el('webBandDot').className = 'dot' + (bandLive ? '' : (band?.running ? ' dot-off' : ' dot-bad'));
    el('webBandLabel').textContent = bandLive
      ? (band.name || 'Vexo band') + (band.battery != null ? ' · ' + band.battery + '%' : '') + ' · listening'
      : (band?.running ? 'Looking for the band… double-tap it' : 'Vexo band off');
    el('webBandListenBtn').textContent = band?.running ? 'Disconnect' : 'Connect band';
    el('webBandListenBtn').disabled = false;
    el('bandDot').className = el('webBandDot').className;
    el('bandStatus').textContent = bandLive ? 'Connected — ' + (band.name || 'Vexo band') + ', always listening'
      : (band?.running ? 'Looking for the band…' : 'Not connected');
    el('bandDetail').textContent = bandLive
      ? 'Battery ' + (band.battery ?? '?') + '% · the connection stays open, just speak into the band.'
      : 'Double-tap the band so its light blinks blue and keep it close. It connects by itself and stays connected.';
    if (bandLive && !was) {
      const r = recognizer; recognizer = null;
      if (r) { r.onend = null; r.abort(); }
      stopDeviceMic();
      micState('Listening through the Vexo band', 'on');
      addMessage('guide', 'The band is connected. Just speak into it.');
    }
    if (!bandLive && was) { micState('Microphone off', 'off'); startMic(); }
  }
  setInterval(async () => {
    if (!online) return;
    try {
      // Only the page that is actually on screen takes the band's speech, so two open tabs do not both answer.
      const mine = document.visibilityState === 'visible' ? '&client=' + session : '&client=idle-' + session;
      const heard = await call('/band/heard?after=' + Math.max(0, bandCursor) + mine);
      showBandLive(heard.band);
      if (bandCursor < 0) { bandCursor = heard.last; return; } // ignore anything said before this page opened
      bandCursor = heard.last;
      for (const item of heard.items) bandPiece(item.text);
    } catch {}
  }, 700);
  el('webBandListenBtn').onclick = async () => {
    const running = el('webBandListenBtn').textContent === 'Disconnect';
    el('webBandListenBtn').disabled = true;
    try { await call(running ? '/band/stop' : '/band/start', { method: 'POST' }); }
    catch (error) { addMessage('error', error.message); }
  };

  // ---------- Settings: band connection and permissions ----------
  function showBand() {} // the header pill and the Settings card are kept current by showBandLive
  el('bandCheck').onclick = async () => {
    try { await call('/band/start', { method: 'POST' }); } catch (error) { el('bandStatus').textContent = error.message; }
  };
  el('bandListen').onclick = () => selectTab('assistant');

  const permissionText = { granted: 'Allowed', prompt: 'Not allowed yet', denied: 'Blocked — allow it from the lock icon in the address bar', on: 'On', unknown: 'Ask to find out' };
  async function refreshPermissions() {
    const rows = [['camera', 'permCamera', () => Boolean(stream)], ['microphone', 'permMic', () => Boolean(recognizer || capture)], ['geolocation', 'permLocation', () => Boolean(position)]];
    for (const [name, id, active] of rows) {
      let state = 'unknown';
      try { state = (await navigator.permissions.query({ name })).state; } catch {}
      if (active()) state = 'on';
      el(id).textContent = permissionText[state] || state;
      el(id).dataset.state = state;
    }
  }
  el('allowCamera').onclick = async () => {
    if (!stream) { try { await startCamera(); } catch (error) { cameraError(error); } }
    refreshPermissions();
  };
  el('allowMic').onclick = async () => {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach(track => track.stop());
      micBlocked = false;
      el('micToggle').checked = true;
      startMic();
    } catch {}
    refreshPermissions();
  };
  el('allowLocation').onclick = () => { enableLocation(); setTimeout(refreshPermissions, 2000); };
  el('allowAll').onclick = async () => {
    await el('allowMic').onclick();
    await el('allowCamera').onclick();
    el('allowLocation').onclick();
  };
  // Location that was allowed before is switched on by itself, so directions work straight away.
  navigator.permissions?.query({ name: 'geolocation' }).then(permission => { if (permission.state === 'granted') enableLocation(); }).catch(() => {});

  // ---------- Settings: home address ----------
  async function loadHome() {
    if (!online) return;
    try {
      const home = (await call('/places')).find(place => place.name === 'home');
      el('homeCurrent').textContent = home ? 'Home: ' + home.label + '. Say “Take me home” for directions.' : 'Not set yet. Then you can say “Take me home”.';
    } catch {}
  }
  el('homeForm').onsubmit = async e => {
    e.preventDefault();
    const address = el('homeInput').value.trim();
    if (!address) return;
    el('homeCurrent').textContent = 'Looking the address up…';
    try {
      const body = new FormData();
      body.append('name', 'home');
      body.append('address', address);
      addLocation(body);
      const saved = await call('/places', { method: 'POST', body });
      el('homeInput').value = '';
      el('homeCurrent').textContent = 'Home: ' + saved.label + '. Say “Take me home” for directions.';
    } catch (error) { el('homeCurrent').textContent = error.message; }
  };

  // ---------- Tabs ----------
  const tabs = [...document.querySelectorAll('#live .tab')];
  function selectTab(name) {
    activeTab = name;
    tabs.forEach(tab => {
      const selected = tab.id === 'tab-' + name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      el(tab.getAttribute('aria-controls')).hidden = !selected;
    });
    el('askInput').placeholder = micPlaceholder();
    if (name === 'memory') loadMemory();
    if (name === 'family') loadContacts();
    if (name === 'settings') { refreshPermissions(); loadHome(); }
    if (name === 'bridge') el('liveWarning').textContent = '';
    syncSigns();
    startMic(); // switching tabs never leaves the microphone off
  }
  tabs.forEach((tab, index) => {
    tab.onclick = () => selectTab(tab.id.slice(4));
    tab.onkeydown = e => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      const next = tabs[(index + step + tabs.length) % tabs.length];
      selectTab(next.id.slice(4)); next.focus();
    };
  });

  checkService();
})();
