// The on-device detector's pure steps: orientation, input tensor, output decoding.
const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

const core = loadTs('src/detectorCore.ts');
const blockedView = loadTs('src/blockedView.ts');

/** A 3x2 image: each pixel's red channel is its index, so positions can be traced. */
function numbered(width, height) {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = index;
    data[index * 4 + 1] = 100;
    data[index * 4 + 2] = 200;
    data[index * 4 + 3] = 255;
  }
  return { width, height, data };
}

const reds = (frame) => Array.from({ length: frame.width * frame.height }, (_, index) => frame.data[index * 4]);

test('EXIF orientation is read whichever way the decoder trimmed the header', () => {
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
  assert.strictEqual(core.readExifOrientation(new Uint8Array(tiff)), 6);
  // jpeg-js leaves one byte of the "Exif\0\0" marker in front.
  assert.strictEqual(core.readExifOrientation(new Uint8Array([0, ...tiff])), 6);
  assert.strictEqual(core.readExifOrientation(new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff])), 6);
  const intel = [0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0];
  assert.strictEqual(core.readExifOrientation(new Uint8Array(intel)), 8);
  assert.strictEqual(core.readExifOrientation(undefined), 1);
  assert.strictEqual(core.readExifOrientation(new Uint8Array(20)), 1);
});

test('a photo stored sideways is turned upright', () => {
  // Stored 3 wide, 2 high:   0 1 2
  //                          3 4 5
  const stored = numbered(3, 2);
  // Orientation 6: rotate a quarter turn clockwise to display.
  const clockwise = core.uprightFrame(stored, 6, 100);
  assert.deepStrictEqual([clockwise.width, clockwise.height], [2, 3]);
  assert.deepStrictEqual(reds(clockwise), [3, 0, 4, 1, 5, 2]);
  // Orientation 8: a quarter turn the other way.
  const counter = core.uprightFrame(stored, 8, 100);
  assert.deepStrictEqual(reds(counter), [2, 5, 1, 4, 0, 3]);
  // Orientation 3: upside down.
  assert.deepStrictEqual(reds(core.uprightFrame(stored, 3, 100)), [5, 4, 3, 2, 1, 0]);
  // Already upright and small: returned as it is, without a copy.
  assert.strictEqual(core.uprightFrame(stored, 1, 100), stored);
});

test('a large frame is shrunk to the size the model needs', () => {
  const frame = core.uprightFrame(numbered(40, 20), 6, 10);
  assert.deepStrictEqual([frame.width, frame.height], [5, 10]);
});

test('the model input is blue-green-red with grey padding', () => {
  const box = core.letterboxBgr(numbered(2, 1), 4);
  const plane = 16;
  // 2x1 scaled by 2 fills rows 1-2; rows 0 and 3 are padding.
  assert.strictEqual(box.scale, 2);
  assert.strictEqual(box.padY, 1);
  assert.strictEqual(box.input[0], 114);
  // First plane is blue (200), second green (100), third red (the pixel index).
  assert.strictEqual(box.input[4], 200);
  assert.strictEqual(box.input[plane + 4], 100);
  assert.strictEqual(box.input[plane * 2 + 4], 0);
  assert.strictEqual(box.input[plane * 2 + 7], 1);
});

test('model output becomes a box in upright-frame coordinates', () => {
  const values = new Float32Array(core.YOLOX_ROWS * 85);
  // First cell of the stride-32 grid (the last 13x13 block), centre of the cell.
  const row = core.YOLOX_ROWS - 13 * 13 + 6 * 13 + 6;
  values[row * 85] = 0.5;
  values[row * 85 + 1] = 0.5;
  values[row * 85 + 2] = Math.log(2);
  values[row * 85 + 3] = Math.log(4);
  values[row * 85 + 4] = 0.9;
  values[row * 85 + 5] = 0.9; // class 0: person
  const frame = { width: 208, height: 416 };
  const box = core.letterboxBgr({ ...frame, data: new Uint8Array(frame.width * frame.height * 4) });
  const [found, ...rest] = core.decodeYolox(values, box, frame);
  assert.strictEqual(rest.length, 0);
  assert.strictEqual(found.label, 'person');
  assert.ok(Math.abs(found.confidence - 0.81) < 1e-6);
  // Centre (208, 208) of the 416 input is the centre of the frame.
  assert.ok(Math.abs(found.x + found.width / 2 - 0.5) < 0.01);
  assert.ok(Math.abs(found.y + found.height / 2 - 0.5) < 0.01);
  assert.ok(Math.abs(found.height - 128 / 416) < 0.01);
  assert.throws(() => core.decodeYolox(new Float32Array(10), box, frame));
});

test('a person filling the frame is kept; any other frame-filling box is dropped', () => {
  const make = (classIndex) => {
    const values = new Float32Array(core.YOLOX_ROWS * 85);
    const row = core.YOLOX_ROWS - 13 * 13 + 6 * 13 + 6;
    values[row * 85] = 0.5;
    values[row * 85 + 1] = 0.5;
    values[row * 85 + 2] = Math.log(13);
    values[row * 85 + 3] = Math.log(13);
    values[row * 85 + 4] = 0.9;
    values[row * 85 + 5 + classIndex] = 0.9;
    return values;
  };
  const frame = { width: 416, height: 416 };
  const box = core.letterboxBgr({ ...frame, data: new Uint8Array(416 * 416 * 4) });
  assert.strictEqual(core.decodeYolox(make(0), box, frame).length, 1);
  assert.strictEqual(core.decodeYolox(make(72), box, frame).length, 0);
});

test('distance comes out nearer than the old estimate, never farther', () => {
  const person = { label: 'person', confidence: 0.9, x: 0.3, y: 0, width: 0.4, height: 1 };
  const spatial = core.estimateSpatialInfo(person);
  // A person filling the height of the frame is a little over a metre away.
  assert.ok(spatial.distance_m >= 1.1 && spatial.distance_m <= 1.5, String(spatial.distance_m));
  assert.strictEqual(spatial.direction, 'ahead');
  assert.strictEqual(core.estimateSpatialInfo({ ...person, x: 0, width: 0.2 }).direction, 'left');
});

test('a newly seen object is not treated as already missed', () => {
  const tracker = new core.TemporalObjectTracker();
  const chair = { label: 'chair', confidence: 0.6, x: 0.4, y: 0.4, width: 0.2, height: 0.3 };
  const [first] = tracker.update([chair], 1000);
  assert.strictEqual(first.confidence, 0.6);
  // It survives two frames without a detection, then goes.
  assert.strictEqual(tracker.update([], 1500).length, 1);
  assert.strictEqual(tracker.update([], 2000).length, 1);
  assert.strictEqual(tracker.update([], 2500).length, 0);
});

test('a pocket edge over the bottom of the lens is recognised', () => {
  const width = 96;
  const height = 216;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      // Busy texture on top, flat cloth over the bottom 40%.
      const value = y < height * 0.6 ? ((x * 37 + y * 91) % 2 ? 230 : 40) : 90;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  const view = blockedView.analyzeBlockedView(data, width, { x: 0, y: 0, width, height });
  assert.strictEqual(view.lowerCovered, true);
  assert.strictEqual(view.covered, false);
  // A fully textured frame is neither.
  for (let index = 0; index < width * height; index += 1) {
    const value = (index * 53) % 2 ? 230 : 40;
    data[index * 4] = value;
    data[index * 4 + 1] = value;
    data[index * 4 + 2] = value;
  }
  const open = blockedView.analyzeBlockedView(data, width, { x: 0, y: 0, width, height });
  assert.strictEqual(open.lowerCovered, false);
});
