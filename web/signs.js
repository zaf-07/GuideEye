// GuideEye sign reading, fully on-device.
// MediaPipe finds both sets of hand landmarks and facial landmarks per frame.
// ASL uses non-manual markers (brows, mouth and head movement) as well as one
// or two hands, so face landmarks are used as signing context -- never to
// identify a person. Nothing leaves the browser.
//
// Signs are read as whole movements by sign-motion.js: this file runs the
// camera models, hands each frame's landmarks to that reader, and draws.
window.GuideSigns = (() => {
  const BUNDLE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/vision_bundle.mjs';
  const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm';
  const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

  const MIN_LETTER_CONFIDENCE = 0.62, HOLD_MS = 400, LETTER_GRACE_MS = 250, REPEAT_MS = 1200, SPACE_MS = 1800;
  // Movement is only as well understood as it is sampled: read the hands as often as the device
  // allows, up to 25 times a second. The face barely moves, so it is read every third frame.
  const FRAME_MS = 40, FACE_EVERY = 3;
  // Face landmarks used as a ruler for where a sign is made: chin, lips, between the brows, hairline.
  const CHIN = 152, MOUTH = 13, BROW = 9, FOREHEAD = 10;

  let detector = null, faceDetector = null, model = null, loading = null;
  let running = false, video = null, canvas = null, handlers = {}, mode = 'words';
  let lastDetect = 0, frameCount = 0, lastFaces = null;
  // letters
  let candidate = '', candidateSince = 0, candidateSeen = 0, lastLetter = '', lastLetterAt = 0, lastHandAt = 0, spelled = '', wordStart = 0;
  // words
  const reader = window.GuideSignMotion.createReader();
  let trail = [];

  function load() {
    loading ||= (async () => {
      const [vision, json] = await Promise.all([
        import(BUNDLE),
        fetch('models/asl_fingerspelling_landmarks.json').then(r => r.json()),
      ]);
      model = json;
      const files = await vision.FilesetResolver.forVisionTasks(WASM);
      detector = await vision.HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.45, minHandPresenceConfidence: 0.45, minTrackingConfidence: 0.45,
      });
      // Facial context improves interpretation but must not prevent signing
      // from working on an older GPU or while the optional model is loading.
      try {
        faceDetector = await vision.FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
          runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
        });
      } catch {
        try {
          faceDetector = await vision.FaceLandmarker.createFromOptions(files, {
            baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' },
            runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
          });
        } catch { faceDetector = null; }
      }
      // The Sign2Text model in models/sign2text is not loaded here: its 150 dataset glosses are not
      // conversational words, it never spoke, and running its pose tracker on every frame halved how
      // often the hands were read.
    })().catch(error => { loading = null; throw error; });
    return loading;
  }

  // ----- letters: same normalisation and linear model as the GuideLens training pipeline -----
  function classifyLetter(points, handedness) {
    const left = handedness.toLowerCase() === 'left';
    const p = points.map(pt => [left ? 1 - pt.x : pt.x, pt.y, pt.z || 0]);
    const scale = Math.hypot(p[9][0] - p[0][0], p[9][1] - p[0][1]);
    if (scale < 1e-5) return null;
    const x = new Float32Array(63);
    for (let i = 0; i < 21; i++) for (let k = 0; k < 3; k++) {
      const j = i * 3 + k;
      x[j] = ((p[i][k] - p[0][k]) / scale - model.scaler.mean[j]) / (model.scaler.scale[j] || 1);
    }
    const logits = model.classifier.coef.map((row, c) => row.reduce((sum, w, j) => sum + w * x[j], model.classifier.intercept[c]));
    const max = Math.max(...logits);
    const exps = logits.map(v => Math.exp(v - max));
    const total = exps.reduce((a, b) => a + b, 0);
    const best = exps.indexOf(Math.max(...exps));
    return { label: model.labels[best], confidence: exps[best] / total };
  }

  function emit(current, confidence, progress, context = {}) {
    handlers.onUpdate?.({ mode, current, confidence, progress, text: spelled, ...context });
  }

  function stepLetters(points, handedness, now) {
    if (!points) {
      // A pause with no hand in view ends the word: say it.
      if (spelled.length > wordStart && now - lastHandAt > SPACE_MS) {
        handlers.onWord?.(spelled.slice(wordStart).trim(), null);
        spelled += ' ';
        wordStart = spelled.length;
        lastLetter = '';
      }
      if (now - candidateSeen > LETTER_GRACE_MS) candidate = '';
      return emit('', 0, 0);
    }
    lastHandAt = now;
    const guess = classifyLetter(points, handedness);
    if (!guess || guess.confidence < MIN_LETTER_CONFIDENCE) {
      // One unsure frame does not restart the letter; a longer gap does.
      if (now - candidateSeen > LETTER_GRACE_MS) candidate = '';
      return emit(guess?.label || '', guess?.confidence || 0, 0);
    }
    // A letter is taken once its handshape has been held, however many frames that is on this device.
    if (guess.label !== candidate) { candidate = guess.label; candidateSince = now; }
    candidateSeen = now;
    if (now - candidateSince >= HOLD_MS && (candidate !== lastLetter || now - lastLetterAt >= REPEAT_MS)) {
      spelled += candidate;
      lastLetter = candidate; lastLetterAt = now; candidateSince = now;
      handlers.onLetter?.(candidate);
    }
    emit(guess.label, guess.confidence, Math.min(1, (now - candidateSince) / HOLD_MS));
  }

  function faceContext(result) {
    const categories = result?.faceBlendshapes?.[0]?.categories || [];
    const score = name => categories.find(item => item.categoryName === name)?.score || 0;
    const brow = Math.max(score('browInnerUp'), score('browOuterUpLeft'), score('browOuterUpRight'));
    const frown = Math.max(score('mouthFrownLeft'), score('mouthFrownRight'));
    const smile = Math.max(score('mouthSmileLeft'), score('mouthSmileRight'));
    if (brow > 0.45) return 'raised brows (question)';
    if (frown > 0.45) return 'frown';
    if (smile > 0.45) return 'smile';
    return '';
  }

  // ----- signs: every frame goes to the movement reader, which says a word when a whole sign is done -----
  function stepWords(hands, facePoints, face, now) {
    const view = reader.step({
      t: now, hands, aspect: video.videoWidth / video.videoHeight || 4 / 3,
      face: facePoints.length ? { chin: facePoints[CHIN], mouth: facePoints[MOUTH], brow: facePoints[BROW], forehead: facePoints[FOREHEAD] } : null,
    });
    trail = view.trail;
    for (const item of view.said) {
      spelled = (spelled + ' ' + item.word).trim().split(' ').slice(-12).join(' ');
      handlers.onWord?.(item.word, item.confidence);
    }
    emit(view.current, view.confidence, view.progress, { handCount: view.handCount, face, phase: view.phase });
  }

  function draw(points, allHands = [], facePoints = []) {
    const stage = canvas.parentElement;
    const w = canvas.width = stage.clientWidth, h = canvas.height = stage.clientHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if ((!points && !facePoints.length && !trail.length) || !video.videoWidth) return;
    // Same mapping as object-fit: cover on the video element.
    const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
    const dx = (w - video.videoWidth * scale) / 2, dy = (h - video.videoHeight * scale) / 2;
    // The camera picture may be zoomed around its centre; draw the hand at the same zoom.
    const zoom = Number(canvas.dataset.zoom) || 1;
    const at = pt => [w / 2 + (dx + pt.x * video.videoWidth * scale - w / 2) * zoom,
      h / 2 + (dy + pt.y * video.videoHeight * scale - h / 2) * zoom];
    // The path of the movement being read, so the signer can see the whole motion is followed.
    if (mode === 'words' && trail.length > 2) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#8ad7ff';
      for (let i = 1; i < trail.length; i++) {
        ctx.globalAlpha = 0.15 + 0.75 * (i / trail.length); ctx.lineWidth = 2 + 5 * (i / trail.length);
        ctx.beginPath(); ctx.moveTo(...at(trail[i - 1])); ctx.lineTo(...at(trail[i])); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = '#d8ff70'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (const hand of allHands) {
      for (const [a, b] of BONES) { ctx.beginPath(); ctx.moveTo(...at(hand[a])); ctx.lineTo(...at(hand[b])); ctx.stroke(); }
      ctx.fillStyle = '#ffffff';
      for (const pt of hand) { ctx.beginPath(); ctx.arc(...at(pt), 4, 0, Math.PI * 2); ctx.fill(); }
    }
    // A sparse face contour makes the non-manual marker tracking visible
    // without covering the signer’s face or turning this into face ID.
    if (facePoints.length) {
      ctx.fillStyle = '#8ad7ff';
      for (let i = 0; i < facePoints.length; i += 12) { ctx.beginPath(); ctx.arc(...at(facePoints[i]), 1.5, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const now = performance.now();
    if (!detector || video.readyState < 2 || now - lastDetect < FRAME_MS) return;
    lastDetect = now;
    let result;
    try {
      result = detector.detectForVideo(video, now);
      if (faceDetector && frameCount++ % FACE_EVERY === 0) lastFaces = faceDetector.detectForVideo(video, now);
    } catch { return; }
    const hands = result.landmarks || [];
    const points = hands[0] || null;
    const handedness = (result.handednesses || result.handedness)?.[0]?.[0]?.categoryName || 'Right';
    const facePoints = lastFaces?.faceLandmarks?.[0] || [];
    if (mode === 'letters') stepLetters(points, handedness, Date.now());
    else stepWords(hands, facePoints, faceContext(lastFaces), now);
    draw(points, hands, facePoints);
  }

  return {
    get running() { return running; },
    async start(videoElement, canvasElement, callbacks) {
      video = videoElement; canvas = canvasElement; handlers = callbacks || {};
      if (running) return;
      running = true;
      try { await load(); } catch (error) { running = false; throw error; }
      if (running) loop();
    },
    stop() {
      running = false; reader.reset(); trail = [];
      canvas?.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    },
    setMode(next) { mode = next; reader.reset(); trail = []; candidate = ''; },
    clear() { spelled = ''; wordStart = 0; lastLetter = ''; emit('', 0, 0); },
  };
})();
