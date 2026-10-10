import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createSounds } from '../src/ui/sounds.js';

test('快速音效与异步首播不丢失，静音、音量与退出保护仍生效', async (t) => {
  let time = 0;
  const played = [],
    listeners = new Map();
  t.mock.method(performance, 'now', () => time);
  const previousDocument = globalThis.document,
    previousXHR = globalThis.XMLHttpRequest;
  globalThis.document = {
    addEventListener: (key, fn) => listeners.set(key, fn),
    removeEventListener: () => {},
  };
  globalThis.XMLHttpRequest = class {
    open(_method, url) {
      this.url = url;
    }
    send() {
      this.status = 200;
      this.response = { byteLength: 1, url: this.url };
      queueMicrotask(() => this.onload());
    }
  };
  const settings = { sound: true, volume: 60 };
  const context = {
    state: 'running',
    destination: {},
    resume: async () => {},
    decodeAudioData: async (bytes) => bytes.url,
    createGain: () => ({ gain: { value: 0 }, connect() {}, disconnect() {} }),
    createBufferSource: () => ({
      connect(gain) {
        this.gain = gain;
      },
      disconnect() {},
      stop() {},
      start() {
        played.push({
          time,
          file: this.buffer.pathname,
          gain: this.gain,
          volume: this.gain.gain.value,
        });
      },
    }),
  };
  const sounds = createSounds(
    () => settings,
    () => context,
  );
  try {
    // Several first gestures can be waiting for decoding at the same time.
    sounds.play('card');
    sounds.play('click');
    sounds.play('tab');
    await setImmediate();
    assert.equal(played.length, 3);
    time = 1;
    sounds.play('click');
    sounds.play('tab');
    sounds.play('card');
    await setImmediate();
    assert.equal(played.length, 6);
    assert.ok(played[1].file.endsWith('p3r-tab.wav'));
    assert.ok(played[3].file.endsWith('p3r-tab.wav'));
    assert.ok(played.every((p) => !p.file.endsWith('p3r-click.wav')));
    time = 2;
    sounds.play('tab');
    assert.equal(played.length, 7);
    assert.ok(played[6].file.endsWith('p3r-tab.wav'));
    assert.equal(played[6].volume, 0.21);
    sounds.play('back');
    sounds.play('quit');
    await setImmediate();
    assert.equal(played.length, 7, 'return and quit never create playback');
    settings.sound = false;
    sounds.play('card');
    assert.equal(played.length, 7);
    settings.sound = true;
    listeners.get('pointerdown')();
    await setImmediate();
    sounds.play('hover');
    sounds.play('card');
    assert.equal(played.length, 9);
    assert.ok(played[7].file.endsWith('p3r-hover.wav'));
    time = 3;
    sounds.play('card');
    await setImmediate();
    assert.equal(played.length, 10);
    assert.ok(played[9].file.endsWith('card-2.wav'));
    assert.ok(played.every((p) => !p.file.endsWith('card-1.wav')));
    assert.ok(Math.abs(played[9].volume - 0.2) < 1e-6);
    assert.deepEqual(
      played.map((p) => p.time),
      [0, 0, 0, 1, 1, 1, 2, 2, 2, 3],
    );
    settings.volume = 30;
    sounds.sync();
    assert.ok(Math.abs(played[9].gain.gain.value - 0.1) < 1e-6);
    assert.equal(played[6].gain.gain.value, 0.105);
    const disposedSounds = createSounds(
      () => settings,
      () => context,
    );
    disposedSounds.play('navigate');
    disposedSounds.dispose();
    await setImmediate();
    assert.equal(played.length, 10, 'dispose blocks playback waiting for decoding');
  } finally {
    sounds.dispose();
    globalThis.document = previousDocument;
    globalThis.XMLHttpRequest = previousXHR;
  }
});
