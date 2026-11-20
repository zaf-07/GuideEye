// GuideEye sign reading: whole movements, not single frames.
//
// A sign is a handshape plus a movement, and often a place on the body. Reading
// one camera frame at a time sees only the handshape, so a hand on its way up
// was heard as "stop" and a hand on its way down as "thank you".
//
// This reader follows each hand over time and cuts what it sees into
// movements: a movement starts when a hand appears or leaves a rest, and ends
// when the hand comes to rest or leaves the picture. The whole movement is
// then described once (its path, turns, circling, how the handshape changed,
// where it started relative to the face, what the other hand did) and matched
// against every known sign. The best match is spoken, and only if it is clear.
// A handshape with no movement (a number, "I love you") is read when it is held.
//
// Pure functions and plain data: no camera and no DOM, so it runs in tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GuideSignMotion = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const TIMING = {
    lostMs: 350,        // the hand has gone, not just been dropped by the tracker for a frame
    settleMs: 280,      // this long at rest ends a movement
    namedSettleMs: 160, // ...or this long once the movement has been named, so the next sign can start
    staticMs: 800,      // a still handshape is read after being held this long
    quickHoldMs: 450,   // ...or this long, if the hand is then lowered
    earlyMs: 700,       // a repeating movement (a wave, a nod) may be named while it is still going
    maxSegmentMs: 6000,
    prerollMs: 300,     // a movement keeps the moment before it, for the starting shape and place
    repeatMs: 1200,     // the same moving sign twice within this time is one sign
    speedWindowMs: 200,
  };
  const SPEED_ON = 1.0, SPEED_OFF = 0.6;   // hand lengths (wrist to middle knuckle) per second
  const COMMIT = 0.6, EARLY_COMMIT = 0.8, MARGIN = 0.08;
  const FINGERS = ['index', 'middle', 'ring', 'pinky'];

  // ----- geometry -----
  const sub = (a, b) => [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)];
  const len = v => Math.hypot(v[0], v[1], v[2]) || 1e-6;
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const dist = (a, b) => len(sub(a, b));
  const flat = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = v => Math.max(0, Math.min(1, v));
  /** 0 at or below `low`, 1 at or above `high`. */
  const ramp = (value, low, high) => clamp((value - low) / (high - low));
  const under = (value, low, high) => 1 - ramp(value, low, high);
  const all = (...scores) => Math.min(...scores);
  const median = values => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const share = (items, test) => (items.length ? items.filter(test).length / items.length : 0);

  // ----- one hand in one frame -----
  /** 1 = perfectly straight, 0 = bent at a right angle, negative = folded back. */
  function straightness(p, base, middle, tip) {
    const first = sub(p[middle], p[base]), second = sub(p[tip], p[middle]);
    return dot(first, second) / (len(first) * len(second));
  }

  // A finger counts as up or folded by the bend at its joints, not by where it sits in the picture,
  // so the hand can be tilted or turned and the reading stays the same.
  function handShape(p) {
    const size = dist(p[0], p[9]); // wrist to the middle knuckle: the hand's own ruler
    const finger = (mcp, pip, dip, tip) => {
      const bend = Math.min(straightness(p, mcp, pip, dip), straightness(p, pip, dip, tip));
      const reach = dist(p[tip], p[0]) / dist(p[mcp], p[0]); // a folded finger's tip comes back to the palm
      if (bend > 0.75 && reach > 1.45) return 'up';
      if (bend < 0.35 || reach < 1.2) return 'down';
      return 'half';
    };
    const thumbStraight = straightness(p, 2, 3, 4);
    const thumbAway = dist(p[4], p[5]) / size;   // from the index knuckle
    const thumbOut = dist(p[4], p[17]) / dist(p[2], p[17]);
    let thumb = 'half';
    if (thumbStraight > 0.7 && thumbAway > 0.6 && thumbOut > 1.15) thumb = 'up';
    else if (thumbAway < 0.45 || thumbOut < 1.0) thumb = 'down';
    const direction = sub(p[4], p[2]);
    return {
      size, thumb,
      index: finger(5, 6, 7, 8), middle: finger(9, 10, 11, 12), ring: finger(13, 14, 15, 16), pinky: finger(17, 18, 19, 20),
      thumbUpward: -direction[1] / len(direction),            // 1 = pointing to the top of the picture
      pinch: dist(p[4], p[8]) / size,                          // thumb tip to index tip
    };
  }

  /** The word a still handshape means on its own, or ''. */
  function shapeWord(s) {
    const up = name => s[name] === 'up', down = name => s[name] === 'down';
    const fingersUp = FINGERS.filter(up).length, fingersDown = FINGERS.filter(down).length;
    // Thumb and index fingertips touching, the other three fingers up.
    if (s.pinch < 0.3 && up('middle') && up('ring') && up('pinky') && !up('index')) return 'OK';
    // "I love you": thumb, index and little finger up, middle and ring folded.
    if (up('index') && up('pinky') && down('middle') && down('ring') && s.thumb !== 'down') return 'I love you';
    // Numbers are safe to say only when the finger count is clear.
    if (fingersUp === 1 && up('index')) return 'One';
    if (fingersUp === 2 && up('index') && up('middle')) return 'Two';
    if (fingersUp === 3 && up('index') && up('middle') && up('ring')) return 'Three';
    if (fingersUp === 4 && s.thumb === 'down') return 'Four';
    if (fingersUp === 4 && s.thumb === 'up') return 'Five';
    // A fist with only the thumb out: up is yes, down is no.
    if (fingersDown === 4 && s.thumb === 'up') {
      if (s.thumbUpward > 0.55) return 'Yes';
      if (s.thumbUpward < -0.55) return 'No';
      return 'Good';
    }
    if (up('pinky') && s.thumb === 'up' && down('index') && down('middle') && down('ring')) return 'Call me';
    return '';
  }
  const readWord = points => shapeWord(handShape(points));

  /** Everything later steps need to know about one hand in one frame. `aspect` is picture width / height. */
  function observe(points, aspect) {
    const p = points.map(pt => ({ x: pt.x * aspect, y: pt.y, z: (pt.z || 0) * aspect }));
    const s = handShape(p);
    const up = name => s[name] === 'up', down = name => s[name] === 'down';
    const fingersUp = FINGERS.filter(up).length, fingersDown = FINGERS.filter(down).length;
    const palm = [0, 5, 9, 13, 17];
    const c = { x: palm.reduce((sum, i) => sum + p[i].x, 0) / 5, y: palm.reduce((sum, i) => sum + p[i].y, 0) / 5 };
    const bunch = Math.max(...[8, 12, 16, 20].map(i => dist(p[i], p[4]))) / s.size; // every fingertip on the thumb
    return {
      size: s.size, c,
      tip: { x: p[12].x, y: p[12].y }, index: { x: p[8].x, y: p[8].y }, thumb: { x: p[4].x, y: p[4].y },
      knuckle: { x: p[9].x, y: p[9].y },
      tips: { x: (p[8].x + p[12].x) / 2, y: (p[8].y + p[12].y) / 2 },
      rel: [4, 8, 12, 16, 20].map(i => ({ x: (p[i].x - c.x) / s.size, y: (p[i].y - c.y) / s.size })),
      fist: fingersDown === 4, open: fingersUp === 4, point: up('index') && fingersUp === 1,
      five: fingersUp === 4 && s.thumb === 'up',
      w: up('index') && up('middle') && up('ring') && !up('pinky'),
      // Fingertips gathered on the thumb with the fingers still reaching forward: not a fist.
      flatO: bunch < 0.55 && fingersUp === 0 && fingersDown <= 1,
      pinched: (bunch < 0.55 && fingersUp === 0 && fingersDown <= 1) || (s.pinch < 0.35 && !down('index')),
      thumbUp: fingersDown === 4 && s.thumb === 'up' && s.thumbUpward > 0.55,
      snap: (dist(p[4], p[8]) + dist(p[4], p[12])) / 2 / s.size,         // index and middle against the thumb
      ringPinkyDown: down('ring') && down('pinky'),
      palmThumbIn: fingersUp === 4 && s.thumb === 'down',                 // open palm, thumb folded across it
      fistThumbIn: fingersDown >= 3 && s.thumb !== 'up',                  // fingers closed down over the thumb
      tilt: (p[9].y - p[0].y) / s.size,                                   // a nodding fist tips its knuckles
      pinch: s.pinch, word: shapeWord(s),
    };
  }

  /** The face as a ruler for where a sign is made. Never used to recognise who it is. */
  function faceRef(face, aspect) {
    if (!face || !face.chin || !face.forehead) return null;
    const at = pt => ({ x: pt.x * aspect, y: pt.y });
    const chin = at(face.chin), forehead = at(face.forehead);
    const h = flat(chin, forehead);
    if (h < 0.02) return null;
    const mouth = face.mouth ? at(face.mouth) : { x: chin.x, y: chin.y - 0.22 * h };
    const brow = face.brow ? at(face.brow) : { x: forehead.x, y: forehead.y + 0.2 * h };
    return { chin, mouth, brow, h };
  }

  /** A word that needs both a handshape and a place: a hand at the chin, mouth or forehead. */
  function placedWord(o, face) {
    if (!o || !face) return '';
    // A hand touching the face is the face's distance from the camera, so about half a face long.
    // A much bigger hand is held out in front and only looks as if it is at the chin.
    if (o.size / face.h > 0.72) return '';
    const near = (a, b, reach) => flat(a, b) / face.h < reach;
    if (o.flatO && near(o.thumb, face.mouth, 0.35)) return 'Eat';
    if (o.w && near(o.index, face.chin, 0.4)) return 'Water';
    if (o.five && near(o.thumb, face.chin, 0.3)) return 'Mother';
    if (o.five && near(o.thumb, face.brow, 0.3)) return 'Father';
    return '';
  }

  /** A word two still hands make together. */
  function pairWord(a, b) {
    if (!a || !b) return '';
    const size = Math.max(a.size, b.size);
    // HELP: a thumbs-up fist resting on the open palm of the other hand.
    if (((a.thumbUp && b.open) || (b.thumbUp && a.open)) && flat(a.c, b.c) < 2.2 * size) return 'Help';
    // MORE: both pinched hands meet; PAIN: two index fingers meet.
    if (a.pinched && b.pinched && flat(a.index, b.index) < 0.9 * size) return 'More';
    if (a.point && b.point && flat(a.index, b.index) < 0.8 * size) return 'Pain';
    return '';
  }

  // ----- describing a whole movement -----
  /** How many times a value turns round after travelling at least `step` (a wave has two or more). */
  function swings(values, step) {
    let low = values[0], high = values[0], direction = 0, count = 0;
    for (const value of values) {
      if (direction <= 0 && value - low >= step) { if (direction < 0) count++; direction = 1; high = value; }
      else if (direction >= 0 && high - value >= step) { if (direction > 0) count++; direction = -1; low = value; }
      if (direction >= 0) high = Math.max(high, value);
      if (direction <= 0) low = Math.min(low, value);
    }
    return count;
  }
  const span = values => (values.length ? Math.max(...values) - Math.min(...values) : 0);
  const smooth = points => points.map((_, i) => {
    const near = points.slice(Math.max(0, i - 1), i + 2);
    return { x: near.reduce((s, q) => s + q.x, 0) / near.length, y: near.reduce((s, q) => s + q.y, 0) / near.length };
  });

  /** A path's shape: how far, how straight, how round, and how far round a circle it goes. */
  function pathShape(raw, unit) {
    const points = smooth(raw).map(q => ({ x: q.x / unit, y: q.y / unit }));
    const n = points.length;
    const first = points[0], last = points[n - 1];
    let length = 0;
    for (let i = 1; i < n; i++) length += flat(points[i], points[i - 1]);
    const cx = points.reduce((s, q) => s + q.x, 0) / n, cy = points.reduce((s, q) => s + q.y, 0) / n;
    let sxx = 0, syy = 0, sxy = 0, radius = 0;
    for (const q of points) {
      sxx += (q.x - cx) ** 2; syy += (q.y - cy) ** 2; sxy += (q.x - cx) * (q.y - cy);
      radius += Math.hypot(q.x - cx, q.y - cy) / n;
    }
    // Principal axes: a line has one long axis, a circle two equal ones.
    const mean = (sxx + syy) / 2, diff = Math.hypot((sxx - syy) / 2, sxy);
    const round = mean + diff > 1e-9 ? Math.sqrt(Math.max(0, mean - diff) / (mean + diff)) : 0;
    let winding = 0, previous = null;
    for (const q of points) {
      if (Math.hypot(q.x - cx, q.y - cy) < 0.35 * radius) continue; // too near the middle to have a direction
      const angle = Math.atan2(q.y - cy, q.x - cx);
      if (previous !== null) {
        let delta = angle - previous;
        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;
        winding += delta;
      }
      previous = angle;
    }
    // A drawn circle keeps its distance from its middle; a path that merely wanders round does not.
    const even = radius > 1e-6 ? 1 - Math.sqrt(points.reduce((s, q) => s + (Math.hypot(q.x - cx, q.y - cy) - radius) ** 2, 0) / n) / radius : 0;
    const net = { x: last.x - first.x, y: last.y - first.y };
    const xs = points.map(q => q.x), ys = points.map(q => q.y);
    return {
      net, reach: Math.hypot(net.x, net.y), length, straight: length > 1e-6 ? Math.hypot(net.x, net.y) / length : 0,
      spanX: span(xs), spanY: span(ys), travel: Math.hypot(span(xs), span(ys)),
      swingsX: swings(xs, 0.25), swingsY: swings(ys, 0.12),
      round, radius, even, winding: Math.abs(winding),
    };
  }

  /** Cut the reach into the signing space off the front of a movement, and the drop out of view off the end. */
  function strokeRange(list, aspect, fromIdle, endReason) {
    const atEdge = c => c.y > 0.6 || c.y < 0.08 || c.x < 0.12 * aspect || c.x > 0.88 * aspect;
    const unit = median(list.map(f => f.o.size)) || 0.1;
    const step = i => {
      const dt = Math.max(1, list[i + 1].t - list[i].t) / 1000;
      return { x: (list[i + 1].o.c.x - list[i].o.c.x) / unit / dt, y: (list[i + 1].o.c.y - list[i].o.c.y) / unit / dt };
    };
    const run = (start, direction) => {
      // Follow a fast, steady run from `start`; return how many steps it lasts.
      const stop = direction > 0 ? list.length - 1 : 0;
      let heading = null, count = 0;
      for (let i = start; i !== stop; i += direction) {
        const v = step(direction > 0 ? i : i - 1), speed = Math.hypot(v.x, v.y);
        // The run may take a moment to get going (or, at the end, to be seen leaving).
        if (speed < 1.2 && !heading && Math.abs(list[i].t - list[start].t) < 250) { count++; continue; }
        if (speed < 1.2) break;
        if (heading && (v.x * heading.x + v.y * heading.y) / speed < 0.5) break;
        heading = heading || { x: v.x / speed, y: v.y / speed };
        count++;
      }
      return count;
    };
    let from = 0, to = list.length - 1;
    if (fromIdle && list.length > 3) {
      // The tracker's first moments on a hand entering the picture are unreliable.
      while (from < list.length - 2 && list[from].t - list[0].t < 100) from++;
      if (atEdge(list[0].o.c)) from += run(from, 1);
    }
    const tailTo = to;
    if (endReason === 'lost' && list.length > 3 && atEdge(list[to].o.c)) to -= run(to, -1);
    return { from: Math.min(from, list.length - 1), to: Math.max(to, Math.min(from, list.length - 1)), tailTo };
  }

  /**
   * Where the last leg of a movement starts: after the last pause or turn-round that has movement on
   * both sides of it. Signs that go somewhere (thank you, help, stop, a salute) are read from there, so
   * the hand may travel to the starting place first without having to stop and wait.
   */
  function lastLeg(list, from, to) {
    const unit = median(list.map(item => item.o.size)) || 0.1;
    const speed = [];
    for (let i = from; i < to; i++) {
      const dt = Math.max(1, list[i + 1].t - list[i].t) / 1000;
      speed.push(flat(list[i + 1].o.c, list[i].o.c) / unit / dt);
    }
    const calm = speed.map((_, i) => median(speed.slice(Math.max(0, i - 1), i + 2)));
    for (let i = calm.length - 1; i > 0; i--) {
      if (calm[i] >= 0.9) continue;
      const leg = list.slice(from + i, to + 1);
      if (leg.length < 4 || leg[leg.length - 1].t - leg[0].t < 200) continue;
      if (Math.max(...calm.slice(i)) > 1.5 && Math.max(...calm.slice(0, i)) > 1.5) return from + i;
    }
    return from;
  }

  function describe(list, others, face) {
    const o = list.map(f => f.o);
    const unit = median(o.map(x => x.size)) || 0.1;
    const third = Math.max(1, Math.round(o.length * 0.35));
    const firstPart = o.slice(0, third), lastPart = o.slice(-third);
    const centre = pathShape(o.map(x => x.c), unit);
    const tip = pathShape(o.map(x => x.tip), unit);
    const index = pathShape(o.map(x => x.index), unit);
    const knuckle = pathShape(o.map(x => x.knuckle), unit);
    const edge = Math.min(3, o.length);
    const growth = median(o.slice(-edge).map(x => x.size)) / (median(o.slice(0, edge).map(x => x.size)) || 1e-6);
    let snaps = 0, wasOpen = false;
    for (const x of o) {
      if (x.snap > 0.75) wasOpen = true;
      else if (x.snap < 0.42 && wasOpen) { snaps++; wasOpen = false; }
    }
    const shapes = {};
    for (const key of ['fist', 'open', 'point', 'five', 'w', 'flatO', 'pinched', 'thumbUp', 'ringPinkyDown', 'palmThumbIn', 'fistThumbIn']) {
      shapes[key] = share(o, x => x[key]);
    }
    const firstSteps = o.slice(0, 3);
    const f = {
      // How fast the hand was already going when this part began: slow means it started from rest.
      startSpeed: flat(firstSteps[firstSteps.length - 1].c, firstSteps[0].c) / unit
        / (Math.max(1, list[firstSteps.length - 1].t - list[0].t) / 1000),
      n: o.length, duration: list[list.length - 1].t - list[0].t, unit, centre, tip, index, knuckle, growth, snaps, shapes,
      firstPalmThumbIn: share(firstPart, x => x.palmThumbIn), lastFistThumbIn: share(lastPart, x => x.fistThumbIn),
      lastFist: share(lastPart, x => x.fist),
      tiltSwings: swings(o.map(x => x.tilt), 0.15), startY: o[0].c.y,
      face: null, pair: null,
    };
    if (face) {
      const startTips = { x: median(firstPart.slice(0, 3).map(x => x.tips.x)), y: median(firstPart.slice(0, 3).map(x => x.tips.y)) };
      const placed = {};
      for (const x of o) { const word = placedWord(x, face); if (word) placed[word] = (placed[word] || 0) + 1 / o.length; }
      f.face = {
        placed,
        startSize: median(firstPart.slice(0, 3).map(x => x.size)) / face.h,
        startToMouth: flat(startTips, face.mouth) / face.h,
        // A salute starts at the brow or beside it, at the temple: anywhere along the brow line.
        startToBrow: Math.hypot(Math.max(0, Math.abs(startTips.x - face.brow.x) - 0.4 * face.h), startTips.y - face.brow.y) / face.h,
        belowChin: (median(o.map(x => x.c.y)) - face.chin.y) / face.h,
      };
    }
    const pairs = list.map((item, i) => ({ a: item.o, b: others[i] })).filter(pair => pair.b);
    if (pairs.length >= 3) {
      const b = pairs.map(pair => pair.b);
      f.pair = {
        share: pairs.length / list.length,
        open: share(b, x => x.open), point: share(b, x => x.point), pinched: share(b, x => x.pinched),
        path: pathShape(b.map(x => x.c), unit),
        endGap: flat(pairs[pairs.length - 1].a.c, pairs[pairs.length - 1].b.c) / unit,
        tipsGap: Math.min(...pairs.map(pair => flat(pair.a.index, pair.b.index))) / unit,
      };
    }
    return f;
  }

  /**
   * Score every known sign against one described movement.
   * `f` is the whole stroke, `leg` its last leg, and `legWhole` that leg with the drop out of view kept.
   */
  function scoreSigns(f, leg, legWhole, context) {
    const scores = {}, repeating = {};
    // `repeats` marks a sign made of a repeated movement, which can be named before it stops.
    const put = (word, score, repeats = false) => { if (score > (scores[word] || 0)) { scores[word] = score; repeating[word] = repeats; } };
    const s = f.shapes, face = f.face, pair = f.pair;
    const mostly = value => ramp(value, 0.45, 0.65);
    const held = context.endReason === 'hold';
    const turns = Math.PI;

    if (f.n >= 4) {
      // HELLO: an open hand waving side to side about one place, without climbing, dropping or drifting away.
      put('Hello', all(mostly(s.open), ramp(f.tip.swingsX, 1.2, 2), ramp(f.tip.spanX, 0.6, 0.9), under(f.tip.round, 0.55, 0.8),
        under(f.tip.spanY / (f.tip.spanX || 1e-6), 0.5, 0.8), under(f.centre.reach / (f.tip.spanX || 1e-6), 0.6, 0.9)), true);
      // PLEASE / SORRY: a flat hand, or a fist, circling on the chest.
      const circle = all(ramp(f.centre.winding, 1.6 * turns, 2.2 * turns), ramp(f.centre.round, 0.35, 0.5), ramp(f.centre.radius, 0.15, 0.25),
        under(f.centre.radius, 1.2, 1.8), ramp(f.centre.even, 0.5, 0.65), face ? 0.7 + 0.3 * ramp(face.belowChin, 0, 0.3) : 1);
      put('Please', all(mostly(s.open), circle), true);
      put('Sorry', all(mostly(s.fist), under(s.thumbUp, 0.4, 0.6), circle), true);
      // YES: a fist nodding up and down.
      put('Yes', all(mostly(s.fist), under(s.thumbUp, 0.4, 0.6),
        ramp(Math.max(f.knuckle.swingsY, f.tiltSwings), 1.2, 2), ramp(f.knuckle.spanY, 0.18, 0.3),
        // A nod is small and stays where it is.
        under(f.knuckle.spanY, 1.2, 1.8), under(f.centre.reach, 0.6, 1.0),
        under(f.knuckle.spanX / (f.knuckle.spanY || 1e-6), 0.6, 1), under(f.centre.winding, 1.2 * turns, 1.7 * turns)), true);
      // NO: index and middle finger snapping shut onto the thumb. Two fingers closing into a fist is a
      // change of handshape, not a snap.
      put('No', all(mostly(s.ringPinkyDown), under(s.fist, 0.6, 0.8), under(f.lastFist, 0.3, 0.6), f.snaps >= 1 ? 1 : 0,
        under(f.centre.travel, 1.0, 1.6)));
      // NO, the everyday way: an index finger wagging from a hand that stays put.
      put('No', all(mostly(s.point), ramp(f.index.swingsX, 1.2, 2), ramp(f.index.spanX, 0.3, 0.45),
        under(f.index.spanY / (f.index.spanX || 1e-6), 0.5, 0.8), under(f.centre.travel, 1.4, 2.0), under(f.centre.reach, 0.6, 1.0)), true);

      // SOS, the Signal for Help: show the palm with the thumb folded in, then close the fingers over it.
      put('SOS', all(ramp(f.firstPalmThumbIn, 0.4, 0.6), ramp(f.lastFistThumbIn, 0.5, 0.7), under(f.centre.travel, 0.8, 1.2)));

      if (pair) {
        const together = ramp(pair.share, 0.5, 0.7);
        // STOP in ASL: one flat hand chops down onto the other palm.
        put('Stop', all(together, mostly(s.open), mostly(pair.open), ramp(f.centre.net.y, 0.5, 0.8), under(pair.endGap, 1.0, 1.5),
          under(pair.path.travel, 0.6, 1.0)));
        put('More', all(together, mostly(s.pinched), mostly(pair.pinched), under(pair.tipsGap, 0.5, 0.9)));
        put('Pain', all(together, mostly(s.point), mostly(pair.point), under(pair.tipsGap, 0.5, 0.9)));
      }
    }
    // Signs made at a place on the face (eat, water, mother, father). A tap is a small movement,
    // so these need no path: the hand has to stay at the place, not pass it.
    if (face && f.n >= 3) {
      for (const [word, part] of Object.entries(face.placed)) put(word, all(ramp(part, 0.4, 0.6), under(f.centre.travel, 1.0, 1.6)));
    }
    // Signs that go somewhere are read from the last leg of the movement.
    if (leg && leg.n >= 4) {
      const g = leg, shape = g.shapes;
      // STOP: the flat hand pushed towards the camera, so it grows without going anywhere.
      put('Stop', all(ramp(shape.open, 0.5, 0.7), ramp(g.growth, 1.15, 1.28), under(g.centre.reach, 0.7, 1.1), held ? 1 : 0.5,
        under(g.duration, 1500, 2500)));
      // HELP: a thumbs-up fist lifted upward. A thumbs-up that is already on its way up when it comes
      // into view is just "yes" being shown: the lift has to start from rest, or from the other palm.
      const fromRest = g.startSpeed < 1.2 || (g.pair && g.pair.open > 0.5) ? 1 : 0.5;
      put('Help', all(mostly(shape.thumbUp), ramp(-g.centre.net.y, 0.5, 0.75), ramp(g.centre.straight, 0.5, 0.7), fromRest));
      // HELLO as a salute: a flat hand leaving the brow.
      if (g.face) {
        put('Hello', all(mostly(shape.open), under(g.face.startToBrow, 0.3, 0.5), under(g.face.startSize, 0.72, 0.9),
          ramp(g.centre.reach, 0.8, 1.2), ramp(g.centre.straight, 0.55, 0.75), under(g.centre.net.y, 0.5, 1.0)));
      }
    }
    // THANK YOU: a flat hand moving down and away from the chin. Read with the end of the movement
    // kept, because the hand often carries straight on out of the picture.
    if (legWhole && legWhole.n >= 4) {
      const w = legWhole;
      // With no face to measure from (the face model did not load, or the camera shows only hands),
      // settle for a flat hand that starts high, comes straight down a hand's length and stops.
      const blind = context.faceTracked ? 0
        : all(held ? 0.66 : 0, w.startY < 0.55 ? 1 : 0, ramp(w.centre.straight, 0.7, 0.85), ramp(w.centre.net.y, 0.8, 1.1));
      const fromChin = w.face ? all(under(w.face.startToMouth, 0.35, 0.55), under(w.face.startSize, 0.72, 0.9)) : blind;
      const away = Math.max(ramp(w.centre.net.y, 0.5, 0.8), ramp(w.growth, 1.15, 1.3));
      const thanks = all(mostly(w.shapes.open), fromChin, away, ramp(w.centre.straight, 0.5, 0.7), under(w.centre.swingsY + w.centre.swingsX, 1, 2));
      // GOOD is the same movement landing on the other palm.
      const lands = w.pair ? all(ramp(w.pair.share, 0.4, 0.6), mostly(w.pair.open), under(w.pair.endGap, 1.0, 1.5)) : 0;
      put(lands > 0.6 ? 'Good' : 'Thank you', thanks);
    }
    return Object.entries(scores).map(([word, score]) => ({ word, score, repeats: repeating[word] })).sort((a, b) => b.score - a.score);
  }

  /**
   * Name one whole movement. `frames` are { t, h: [hand, hand], face } with hands from `observe`.
   * Returns { word, score, guess, small }: `word` is empty unless one sign clearly fits.
   */
  function classify(frames, context = {}) {
    const aspect = context.aspect || 4 / 3;
    const lists = [0, 1].map(slot => frames.filter(frame => frame.h[slot]).map(frame => ({ t: frame.t, o: frame.h[slot], frame })));
    const travelled = lists.map(list => {
      let total = 0;
      for (let i = 1; i < list.length; i++) total += flat(list[i].o.c, list[i - 1].o.c);
      return total + list.length * 1e-6;
    });
    const main = travelled[1] > travelled[0] ? 1 : 0;
    const list = lists[main];
    const none = { word: '', score: 0, guess: '', small: true };
    if (list.length < 3) return none;
    const faces = frames.map(frame => frame.face).filter(Boolean);
    const face = faces.length >= frames.length * 0.3 ? {
      chin: { x: median(faces.map(q => q.chin.x)), y: median(faces.map(q => q.chin.y)) },
      mouth: { x: median(faces.map(q => q.mouth.x)), y: median(faces.map(q => q.mouth.y)) },
      brow: { x: median(faces.map(q => q.brow.x)), y: median(faces.map(q => q.brow.y)) },
      h: median(faces.map(q => q.h)),
    } : null;
    const range = strokeRange(list, aspect, context.fromIdle, context.endReason);
    const cut = (from, to) => {
      const part = list.slice(from, to + 1);
      return part.length >= 2 ? describe(part, part.map(item => item.frame.h[1 - main]), face) : null;
    };
    const stroke = cut(range.from, range.to), everything = cut(0, list.length - 1);
    if (!stroke) return { ...none, small: everything.centre.travel < 0.6 && everything.tip.travel < 0.9 };
    const legFrom = lastLeg(list, range.from, range.tailTo);
    const ranked = scoreSigns(stroke, cut(legFrom, range.to), cut(legFrom, range.tailTo), context);
    const best = ranked[0] || { word: '', score: 0 }, second = ranked[1] || { word: '', score: 0 };
    const clear = best.score >= COMMIT && best.score - second.score >= MARGIN;
    return {
      word: clear ? best.word : '', score: best.score, guess: best.score >= 0.45 ? best.word : '',
      repeats: Boolean(best.repeats), ranked: ranked.slice(0, 3),
      // A twitch rather than a movement: whatever was being held is still being held.
      small: everything.centre.travel < 0.6 && everything.tip.travel < 0.9,
    };
  }

  // ----- following the hands and cutting what they do into movements -----
  function createReader(options = {}) {
    const T = { ...TIMING, ...options };
    let state = 'idle', tracks = [null, null], seg = null, hold = null;
    let lostSince = 0, stillSince = 0, lastStatic = '', lastMotion = { word: '', end: -1e9 }, aspect = 4 / 3, faceAt = -1e9;

    const newSegment = (t, fromIdle) => ({ frames: [], start: t, fromIdle, word: '', namedAt: 0, guess: '', score: 0, checked: t, pending: null, before: null });

    /** Put each seen hand in the slot of the hand it was a moment ago. */
    function assign(seen, t) {
      const previous = tracks.map(track => (track && t - track.t < 500 ? track.last.c : null));
      const cost = (o, c) => (c ? flat(o.c, c) : 0.25);
      const slots = [null, null];
      if (seen.length === 1) slots[cost(seen[0], previous[1]) < cost(seen[0], previous[0]) ? 1 : 0] = seen[0];
      else if (seen.length >= 2) {
        const straight = cost(seen[0], previous[0]) + cost(seen[1], previous[1]);
        const crossed = cost(seen[0], previous[1]) + cost(seen[1], previous[0]);
        if (crossed < straight) { slots[0] = seen[1]; slots[1] = seen[0]; } else { slots[0] = seen[0]; slots[1] = seen[1]; }
      }
      return slots;
    }

    /** How fast a hand is moving or changing shape, in hand lengths per second. New hands count as moving. */
    function activity(slot, o, t) {
      const fresh = !tracks[slot] || t - tracks[slot].t > 500;
      const track = fresh ? (tracks[slot] = { t, last: o, history: [] }) : tracks[slot];
      track.history.push({ t, c: o.c, rel: o.rel, size: o.size });
      while (track.history.length > 2 && t - track.history[1].t >= T.speedWindowMs) track.history.shift();
      track.t = t; track.last = o;
      const from = track.history[0];
      if (t - from.t < T.speedWindowMs * 0.6) return fresh || track.history.length < 3 ? SPEED_ON * 2 : 0;
      const seconds = (t - from.t) / 1000, unit = median(track.history.map(item => item.size)) || 0.1;
      const palm = flat(o.c, from.c) / unit / seconds;
      // One finger opening or closing is a change of handshape, so the fastest fingertip counts.
      const fingers = Math.max(...o.rel.map((point, i) => flat(point, from.rel[i]))) / seconds;
      // A hand pushed at the camera goes nowhere in the picture: it only grows.
      const depth = Math.abs(o.size - from.size) / unit / seconds;
      return Math.max(palm, 0.6 * fingers, 1.5 * depth);
    }

    function say(said, word, confidence, kind) {
      said.push({ word, confidence: Math.round(clamp(confidence) * 100) / 100, kind });
    }

    /** The word the still hands have mostly shown since `since`, and how steadily. */
    function heldWord(frames) {
      const counts = {};
      for (const frame of frames) {
        const [a, b] = frame.h;
        const word = pairWord(a, b) || placedWord(a, frame.face) || placedWord(b, frame.face) || (a && a.word) || (b && b.word) || '';
        counts[word] = (counts[word] || 0) + 1;
      }
      const [word, count] = Object.entries(counts).sort((x, y) => y[1] - x[1])[0] || ['', 0];
      return { word, steady: frames.length ? count / frames.length : 0 };
    }

    function holdStatus(t) {
      const { word, steady } = heldWord(hold.frames);
      // After a twitch, a hand still showing the same thing carries on where it was.
      const carried = hold.before && hold.before.word === word ? hold.before : null;
      const since = carried ? carried.since : hold.since;
      const done = hold.emitted || Boolean(carried && carried.emitted);
      // A hand resting at the end of a moving sign is the end of that sign, not a new one.
      const partOfSign = Boolean(hold.afterWord || (carried && carried.afterWord));
      return { word, steady, since, done, partOfSign, duration: t - since };
    }

    function endSegment(reason, t, said) {
      let word = seg.word, small = false;
      if (word) {
        // The movement was named while it was still going. If the hand then went straight on into
        // another sign without resting, read that from what came after.
        const after = classify(seg.frames.filter(frame => frame.t >= seg.namedAt), { fromIdle: false, endReason: reason, aspect, faceTracked: t - faceAt < 10000 });
        if (after.word && after.word !== word) { word = after.word; say(said, word, after.score, 'motion'); }
      } else {
        const result = classify(seg.frames, { fromIdle: seg.fromIdle, endReason: reason, aspect, faceTracked: t - faceAt < 10000 });
        small = result.small;
        if (result.word) {
          word = result.word;
          if (!(word === lastMotion.word && seg.start - lastMotion.end < T.repeatMs)) say(said, word, result.score, 'motion');
        } else if (seg.pending && !small) {
          // A handshape shown briefly and then taken away was a sign in itself.
          say(said, seg.pending.word, seg.pending.steady, 'static');
          lastStatic = seg.pending.word;
        }
      }
      if (word) { lastMotion = { word, end: t }; lastStatic = ''; }
      return { word, small };
    }

    function step(input) {
      const t = input.t, hands = (input.hands || []).filter(points => points && points.length >= 21).slice(0, 2);
      aspect = input.aspect || aspect;
      if (input.face) faceAt = t;
      const said = [];
      if (!hands.length) {
        lostSince = lostSince || t;
        if (state !== 'idle' && t - lostSince >= T.lostMs) {
          if (state === 'moving') endSegment('lost', t, said);
          else {
            const status = holdStatus(t);
            if (status.word && !status.done && !status.partOfSign && status.duration >= T.quickHoldMs && status.steady >= 0.7
                && status.word !== lastStatic) say(said, status.word, status.steady, 'static');
          }
          state = 'idle'; seg = null; hold = null; tracks = [null, null]; lastStatic = ''; stillSince = 0;
        }
        return view(t, said, 0);
      }
      lostSince = 0;
      const slots = assign(hands.map(points => observe(points, aspect)), t);
      let speed = 0;
      slots.forEach((o, slot) => { if (o) speed = Math.max(speed, activity(slot, o, t)); });
      const frame = { t, h: slots, face: faceRef(input.face, aspect) };

      if (state === 'idle') {
        seg = newSegment(t, true); seg.frames.push(frame);
        state = 'moving'; stillSince = 0;
      } else if (state === 'moving') {
        seg.frames.push(frame);
        if (speed < SPEED_OFF) stillSince = stillSince || t;
        else if (speed > (SPEED_ON + SPEED_OFF) / 2) stillSince = 0;
        if (stillSince && t - stillSince >= (seg.word ? T.namedSettleMs : T.settleMs)) {
          const cut = seg.frames.findIndex(item => item.t > stillSince + 100);
          const rest = cut >= 0 ? seg.frames.splice(cut) : [];
          const before = seg.before;
          const ended = endSegment('hold', t, said);
          // Stillness is noticed a little after it starts, because speed is measured over a short window.
          hold = { since: stillSince - T.speedWindowMs * 0.6, frames: rest.length ? rest : [frame], emitted: false, afterWord: ended.word,
            before: ended.small && !ended.word ? before : null };
          state = 'holding'; seg = null; stillSince = 0;
        } else if (!seg.word && t - seg.start >= T.earlyMs && t - seg.checked >= 150) {
          // A wave or a nod can go on for a while: name it once it is unmistakable, then let it finish.
          seg.checked = t;
          const result = classify(seg.frames, { fromIdle: seg.fromIdle, endReason: 'going', aspect, faceTracked: t - faceAt < 10000 });
          seg.guess = result.guess; seg.score = result.score;
          if (result.word && result.repeats && result.score >= EARLY_COMMIT) {
            seg.word = result.word; seg.namedAt = t;
            if (!(result.word === lastMotion.word && seg.start - lastMotion.end < T.repeatMs)) say(said, result.word, result.score, 'motion');
            lastMotion = { word: result.word, end: t }; lastStatic = '';
          }
        } else if (t - seg.start >= T.maxSegmentMs) {
          endSegment('long', t, said);
          seg = newSegment(t, false); seg.frames.push(frame);
        }
      } else {
        hold.frames.push(frame);
        if (hold.frames.length > 90) hold.frames.shift();
        const status = holdStatus(t);
        if (speed > SPEED_ON) {
          seg = newSegment(t, false);
          seg.frames = hold.frames.filter(item => item.t >= t - T.prerollMs);
          seg.before = { word: status.word, since: status.since, emitted: status.done, afterWord: status.partOfSign };
          if (status.word && !status.done && !status.partOfSign && status.duration >= T.quickHoldMs && status.steady >= 0.7
              && status.word !== lastStatic) seg.pending = { word: status.word, steady: status.steady };
          state = 'moving'; hold = null; stillSince = 0;
        } else {
          if (status.duration >= 500 && status.steady >= 0.7 && status.word !== lastStatic) lastStatic = '';
          if (status.word && !status.done && !status.partOfSign && status.duration >= T.staticMs && status.steady >= 0.7
              && status.word !== lastStatic) {
            say(said, status.word, status.steady, 'static');
            hold.emitted = true; lastStatic = status.word;
          }
        }
      }
      return view(t, said, hands.length);
    }

    /** What to show while reading: the phase, the best guess so far, and the path being followed. */
    function view(t, said, handCount) {
      let current = '', confidence = 0, progress = 0, trail = [];
      if (state === 'moving' && seg) {
        current = seg.word || seg.guess; confidence = seg.word ? 1 : seg.score;
        const slot = seg.frames.filter(frame => frame.h[1]).length > seg.frames.filter(frame => frame.h[0]).length ? 1 : 0;
        trail = seg.frames.filter(frame => frame.h[slot]).slice(-45).map(frame => ({ x: frame.h[slot].c.x / aspect, y: frame.h[slot].c.y }));
      } else if (state === 'holding' && hold) {
        const status = holdStatus(t);
        if (status.partOfSign) { current = hold.afterWord || status.word; confidence = 1; progress = 1; }
        else if (status.word) {
          current = status.word; confidence = status.steady;
          progress = status.done || status.word === lastStatic ? 1 : clamp(status.duration / T.staticMs);
        }
      }
      if (said.length) { current = said[said.length - 1].word; confidence = said[said.length - 1].confidence; progress = 1; }
      return { said, phase: state, current, confidence, progress, handCount, trail };
    }

    return {
      step,
      reset() {
        state = 'idle'; tracks = [null, null]; seg = null; hold = null;
        lostSince = 0; stillSince = 0; lastStatic = ''; lastMotion = { word: '', end: -1e9 }; faceAt = -1e9;
      },
    };
  }

  return { createReader, classify, observe, faceRef, handShape, readWord, TIMING };
});
