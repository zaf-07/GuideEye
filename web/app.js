// GuideEye Modern Desktop Application Controller
(() => {
  const $ = s => document.querySelector(s);
  const store = { get: key => { try { return localStorage.getItem(key); } catch { return null; } }, set: (key, value) => { try { localStorage.setItem(key, value); } catch {} } };
  const requestedApi = new URLSearchParams(location.search).get('api');
  const publicApi = window.GUIDEEYE_API_URL || '';
  const savedApi = store.get('guideband_api');
  const staleLocalApi = /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(savedApi || '');
  // A local address saved during development must never override the deployed
  // API when this app is opened from GitHub Pages.
  let API = (requestedApi ?? ((publicApi && staleLocalApi) ? publicApi : savedApi) ?? publicApi).replace(/\/$/, '');

  function showService(online, detail) {
    const dot = $('#serviceDot');
    const status = $('#serviceStatus');
    const details = $('#serviceDetails');
    if (dot) dot.className = online ? 'dot' : 'dot dot-bad';
    if (status) status.textContent = online ? 'GuideEye connected' : 'Service unavailable';
    if (details) details.textContent = detail;
  }

  async function checkService() {
    try {
      const response = await fetch(`${API}/system/status`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Service returned ${response.status}`);
      const status = await response.json();
      const voice = status.speech?.voice && status.speech.voice !== 'browser' ? `${status.speech.voice} voice` : 'device voice';
      showService(true, `Connected · ${voice} · ${status.errands?.agent === 'harnessrouter' ? 'HarnessRouter actions ready' : 'assistant ready'}.`);
      return true;
    } catch {
      const address = API || location.origin;
      showService(false, `Could not reach ${address}. Open GuideEye through its service, or enter the deployed API address above.`);
      return false;
    }
  }

  // --- Clock ---
  function updateClock() {
    const d = new Date();
    const dayStr = d.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
    const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const pill = $('#clockPill');
    if (pill) pill.innerHTML = `<span class="dot"></span>${dayStr} · ${timeStr}`;
  }
  function updateSettingsBand(data) {
    const dot = $('#settingsBandDot');
    const state = $('#settingsBandState');
    const details = $('#settingsBandDetails');
    if (!dot || !state || !details) return;
    const connected = Boolean(data.connected);
    dot.className = connected ? 'dot' : 'dot dot-searching';
    state.textContent = connected ? 'Connected' : 'Not connected';
    const transport = (data.transport || 'ble').toUpperCase();
    details.textContent = connected
      ? `${data.band_name || 'Vexo-HACK-20'} · ${transport} · battery ${data.battery?.percent != null ? data.battery.percent + '%' : 'unknown'}`
      : (data.capabilities?.find(item => item.name === 'bluetooth_presence')?.evidence || 'No connected Vexo BLE device detected');
  }
  updateClock();
  setInterval(updateClock, 1000);

  // --- Speech Out (Deepgram Aura TTS with Web Speech fallback) ---
  const player = new Audio();
  async function speak(text) {
    if (!text) return;
    try {
      const body = new FormData();
      body.append('text', text);
      const res = await fetch(`${API}/speech`, { method: 'POST', body });
      if (res.ok) {
        const url = URL.createObjectURL(await res.blob());
        player.src = url;
        player.play();
        return;
      }

    } catch (_) {}
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0;
      window.speechSynthesis.speak(u);
    }
  }

  // --- Vexo Band Status Poller ---
  let bandConnected = false;
  async function pollWearableStatus() {
    try {
      const res = await fetch(`${API}/wearable/status`);
      if (res.ok) {
        const data = await res.json();
        bandConnected = Boolean(data.connected);
        const name = data.band_name || 'Vexo-HACK-20';
        const batt = data.battery?.percent != null ? `${data.battery.percent}%` : 'battery unknown';
        const transport = (data.transport || 'ble').toUpperCase();

        const dot = $('#bandDot');
        const bandName = $('#bandName');
        const bandBattery = $('#bandBattery');
        const bandBtn = $('#bandListenBtn');

        if (dot && bandName && bandBattery) {
          if (bandConnected) {
            dot.className = 'dot';
            bandName.textContent = name;
            bandBattery.textContent = `${batt} (${transport})`;
            if (bandBtn) bandBtn.style.display = 'inline-flex';
          } else {
            dot.className = 'dot dot-searching';
            bandName.textContent = name;
            bandBattery.textContent = 'Searching BLE...';
          }
        }
        updateSettingsBand(data);
      }
    } catch (_) {
      // Backend might be offline
      const dot = $('#bandDot');
      if (dot) dot.className = 'dot dot-searching';
    }
  }
  checkService();
  setInterval(checkService, 15000);

  function showSection(settings) {
    $('#main').hidden = settings;
    $('#settingsPanel').hidden = !settings;
    $('#homeTab').classList.toggle('active', !settings);
    $('#settingsTab').classList.toggle('active', settings);
  }
  $('#homeTab')?.addEventListener('click', () => showSection(false));
  $('#settingsTab')?.addEventListener('click', () => showSection(true));
  $('#apiForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('#apiInput');
    const value = input.value.trim().replace(/\/$/, '');
    API = value === location.origin ? '' : value;
    store.set('guideband_api', API);
    await checkService();
  });
  if ($('#apiInput')) $('#apiInput').value = API || location.origin;

  // --- Camera Frame Snapshot Helper ---
  async function getCameraFrameBlob() {
    const video = $('#appVideo');
    if (!camStream || !video || video.readyState < 2 || !video.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(video.videoWidth, 640);
    canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  }

  // --- Vexo Band Voice Listening (BLE -> Deepgram Nova-3 -> Assistant) ---
  let isListeningBand = false;
  async function listenThroughBand(seconds = 7) {
    if (isListeningBand) return;
    isListeningBand = true;

    const btn = $('#bandListenBtn');
    const orb = $('#talkOrb');
    const stateLabel = $('#talkState');
    const heardEl = $('#heardText');
    const replyEl = $('#replyText');

    if (btn) {
      btn.classList.add('listening');
      $('#bandBtnText').textContent = 'Connecting…';
    }

    if (orb) orb.classList.add('listening');
    if (stateLabel) stateLabel.textContent = 'Connecting to Vexo… wait for the solid blue light, then speak.';
    if (heardEl) heardEl.textContent = 'Recording wristband audio (Deepgram Nova-3)…';

    try {
      const frameBlob = await getCameraFrameBlob();
      const body = new FormData();
      body.append('seconds', String(seconds));
      body.append('language', 'multi');
      if (frameBlob) {
        body.append('image', frameBlob, 'frame.jpg');
      }

      const res = await fetch(`${API}/wearable/listen`, {
        method: 'POST',
        body
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.text) {
          heardEl.textContent = `“${data.text}”`;
          replyEl.textContent = data.say || 'Understood.';
          speak(data.say);
          if (data.open_url) window.open(data.open_url, '_blank', 'noopener');
        } else {
          heardEl.textContent = 'No speech detected on band.';
          replyEl.textContent = data.say || 'No speech was transcribed. Keep the band close to your mouth and speak after the solid blue light appears.';
        }
      } else {
        heardEl.textContent = 'Could not stream band audio.';
        const error = await res.json().catch(() => ({}));
        replyEl.textContent = error.detail || 'Check that the band is powered on and double-tapped.';
      }
    } catch (err) {
      heardEl.textContent = 'Connection error with GuideEye backend.';
      replyEl.textContent = String(err);
    } finally {
      isListeningBand = false;
      if (btn) {
        btn.classList.remove('listening');
        $('#bandBtnText').textContent = 'Listen on Band';
      }
      if (orb) orb.classList.remove('listening');
      if (stateLabel) stateLabel.textContent = 'Tap or hold to speak';
    }
  }

  // --- Talk Orb: browser microphone ---
  const orb = $('#talkOrb');
  if (orb) {
    orb.onclick = () => browserListen();
  }

  // --- Browser Speech Recognition Fallback ---
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  function browserListen() {
    if (!SpeechRec) {
      $('#heardText').textContent = 'Speech recognition unavailable.';
      return;
    }
    const r = new SpeechRec();
    r.lang = 'en-US';
    r.interimResults = true;
    const orb = $('#talkOrb');
    const stateLabel = $('#talkState');
    if (orb) orb.classList.add('listening');
    if (stateLabel) stateLabel.textContent = 'Listening through Mac microphone…';

    r.onresult = async e => {
      const text = [...e.results].map(x => x[0].transcript).join('');
      $('#heardText').textContent = `“${text}”`;
      if (e.results[e.results.length - 1].isFinal) {
        sendAssistantCommand(text);
      }
    };
    r.onerror = e => {
      if (stateLabel) stateLabel.textContent = `Microphone: ${e.error}`;
    };
    r.onend = () => {
      if (orb) orb.classList.remove('listening');
      if (stateLabel) stateLabel.textContent = 'Tap or hold to speak';
    };
    r.start();
  }

  // --- Send Command to Assistant ---
  async function sendAssistantCommand(text) {
    try {
      const frameBlob = await getCameraFrameBlob();
      const body = new FormData();
      body.append('text', text);
      if (frameBlob) {
        body.append('image', frameBlob, 'frame.jpg');
      }
      const res = await fetch(`${API}/assistant`, { method: 'POST', body });
      if (res.ok) {
        const data = await res.json();
        $('#replyText').textContent = data.say || 'Action complete.';
        speak(data.say);
        if (data.open_url) window.open(data.open_url, '_blank', 'noopener');
      } else {
        const error = await res.json().catch(() => ({}));
        $('#replyText').textContent = error.detail || 'The assistant could not complete that action.';
      }
    } catch (error) {
      $('#replyText').textContent = `Assistant error: ${error.message}`;
    }
  }

  // --- Quick Command Chips ---
  document.querySelectorAll('[data-command]').forEach(btn => {
    btn.onclick = () => {
      const cmd = btn.dataset.command;
      $('#heardText').textContent = `“${cmd}”`;
      sendAssistantCommand(cmd);
    };
  });

  // --- Micro-Whisper Tactile Cue Demo ---
  const whisperBtn = $('#whisperBtn');
  if (whisperBtn) {
    whisperBtn.onclick = async () => {
      const cues = [
        { word: 'Ле-во', delay: 1600 },
        { word: 'Пря-мо', delay: 1600 },
        { word: 'Пра-во', delay: 1600 },
        { word: 'Стоп!', delay: 2000 }
      ];
      $('#heardText').textContent = 'Micro-whisper haptic directional cues';
      for (const cue of cues) {
        $('#replyText').textContent = `Haptic audio cue: “${cue.word}”`;
        speak(cue.word);
        await new Promise(r => setTimeout(r, cue.delay));
      }
      $('#replyText').textContent = 'Cues complete.';
    };
  }

  // --- Live Camera Preview & Radar ---
  let camStream = null;
  const camBtn = $('#camToggleBtn');
  if (camBtn) {
    camBtn.onclick = async () => {
      const video = $('#appVideo');
      const emptyMsg = $('#camEmptyMsg');
      if (camStream) {
        camStream.getTracks().forEach(t => t.stop());
        camStream = null;
        if (video) video.style.display = 'none';
        if (emptyMsg) emptyMsg.style.display = 'block';
        camBtn.textContent = 'Turn Camera On';
      } else {
        try {
          camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } } });
          if (video) {
            video.srcObject = camStream;
            video.style.display = 'block';
            video.play();
          }
          if (emptyMsg) emptyMsg.style.display = 'none';
          camBtn.textContent = 'Turn Camera Off';
        } catch (err) {
          alert('Could not access camera: ' + err.message);
        }
      }
    };
  }

  // --- Bridge Dialog ---
  const bridgeDialog = $('#bridgeDialog');
  const bridgeBtn = $('#bridgeBtn');
  if (bridgeBtn && bridgeDialog) {
    bridgeBtn.onclick = () => bridgeDialog.showModal();
    $('#bridgeSpeakBtn').onclick = () => speak($('#bridgeInput').value);

    const bridgeListenBtn = $('#bridgeListenBtn');
    const bridgeCaption = $('#bridgeCaption');
    let bridgeRecognizer = null;
    let bridgeCaptionsOn = false;

    const setBridgeCaption = text => {
      if (bridgeCaption) bridgeCaption.textContent = text;
    };
    const stopBridgeCaptions = () => {
      bridgeCaptionsOn = false;
      bridgeRecognizer?.stop();
      bridgeRecognizer = null;
      bridgeListenBtn.textContent = 'Start Captions';
    };
    const startBridgeCaptions = () => {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) {
        setBridgeCaption('Live captions are not available in this browser. Try Chrome.');
        return;
      }
      bridgeCaptionsOn = true;
      bridgeListenBtn.textContent = 'Stop Captions';
      setBridgeCaption('Listening…');

      bridgeRecognizer = new Recognition();
      bridgeRecognizer.lang = 'en-US';
      bridgeRecognizer.continuous = true;
      bridgeRecognizer.interimResults = true;
      bridgeRecognizer.onresult = event => {
        const transcript = [...event.results]
          .slice(event.resultIndex)
          .map(result => result[0].transcript)
          .join('');
        setBridgeCaption(transcript ? `Caption: ${transcript}` : 'Listening…');
      };
      bridgeRecognizer.onerror = event => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          bridgeCaptionsOn = false;
          bridgeListenBtn.textContent = 'Start Captions';
          setBridgeCaption('Microphone permission is required for live captions.');
        } else if (event.error !== 'aborted') {
          setBridgeCaption(`Captions paused: ${event.error}.`);
        }
      };
      bridgeRecognizer.onend = () => {
        if (bridgeCaptionsOn && bridgeDialog.open) {
          try { bridgeRecognizer.start(); } catch (_) {}
        }
      };
      try { bridgeRecognizer.start(); } catch (_) { setBridgeCaption('Could not start captions. Please try again.'); }
    };
    bridgeListenBtn.onclick = () => bridgeCaptionsOn ? stopBridgeCaptions() : startBridgeCaptions();
    bridgeDialog.addEventListener('close', stopBridgeCaptions);
  }

  // --- Guardian Toggle ---
  const guardian = $('#guardianToggle');
  if (guardian) {
    guardian.onchange = e => {
      const label = $('#guardianStatusLabel');
      if (e.target.checked) {
        if (label) label.textContent = 'Live Sharing Active';
        speak('Guardian live sharing enabled for this journey.');
      } else {
        if (label) label.textContent = 'Off';
        speak('Guardian sharing disabled.');
      }
    };
  }
})();
