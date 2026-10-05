import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AudioSystem } from './audio';

class Parameter {
  value = 1;
  ramps: { value: number; time: number }[] = [];
  cancelScheduledValues() {}
  setValueAtTime(value: number) { this.value = value; }
  linearRampToValueAtTime(value: number, time: number) { this.value = value; this.ramps.push({ value, time }); }
  exponentialRampToValueAtTime(value: number) { this.value = value; }
}
class Gain {
  gain = new Parameter();
  connect() {}
}
class Context {
  static instances: Context[] = [];
  currentTime = 10;
  state = 'running';
  destination = {};
  gains: Gain[] = [];
  oscillatorCount = 0;
  constructor() { Context.instances.push(this); }
  createGain() { const gain = new Gain(); this.gains.push(gain); return gain; }
  createMediaElementSource() { return { connect() {} }; }
  createOscillator() {
    this.oscillatorCount++;
    return { frequency: new Parameter(), type: 'sine', connect() {}, start() {}, stop() {} };
  }
  async suspend() { this.state = 'suspended'; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}
class Media {
  static instances: Media[] = [];
  static nextError: Error | null = null;
  paused = true;
  loop = false;
  preload = '';
  plays = 0;
  constructor(public src: string) { Media.instances.push(this); }
  setAttribute() {}
  removeAttribute() {}
  addEventListener() {}
  load() {}
  pause() { this.paused = true; }
  play(): Promise<void> {
    this.plays++;
    const error = Media.nextError;
    Media.nextError = null;
    if (error) return Promise.reject(error);
    this.paused = false;
    return Promise.resolve();
  }
}
const timers = new Map<number, () => void>();
let timerId = 0;
let ambientTick: (() => void) | null = null;
beforeEach(() => {
  Context.instances = []; Media.instances = []; Media.nextError = null;
  timers.clear(); timerId = 0; ambientTick = null;
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: Media });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    AudioContext: Context,
    setInterval: (fn: () => void) => { ambientTick = fn; return ++timerId; },
    clearInterval: () => { ambientTick = null; },
    setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id: number) => { timers.delete(id); },
  } });
});
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('music starts after a gesture and crossfades the correct relative tracks', async () => {
  const audio = new AudioSystem('/screw_gamezzz/');
  try {
    audio.setScene('game');
    assert.equal(Media.instances.length, 0, 'no autoplay request during boot');
    audio.unlock(); await settle();
    const game = Media.instances[0];
    assert.equal(game.src, '/screw_gamezzz/assets/audio/game.mp3');
    assert.equal(game.loop, true);
    assert.equal(game.paused, false);
    const context = Context.instances[0];
    assert.deepEqual(context.gains[2].gain.ramps.at(-1), { value: .24, time: 10.8 });
    audio.setScene('menu'); await settle();
    const menu = Media.instances[1];
    assert.equal(menu.src, '/screw_gamezzz/assets/audio/menu.mp3');
    assert.equal(menu.paused, false);
    assert.equal(game.paused, false, 'old track remains audible during its fade');
    assert.equal(context.gains[2].gain.ramps.at(-1)?.value, 0);
    for (const callback of [...timers.values()]) callback();
    assert.equal(game.paused, true);
    audio.setScene('game'); await settle();
    assert.equal(Media.instances.length, 2, 'scene changes reuse tracks and resume their position');
    assert.equal(game.paused, false);
  } finally { audio.dispose(); }
});

test('VK/ad pauses and the music setting stop both tracks without changing sound effects', async () => {
  const audio = new AudioSystem('./');
  try {
    audio.unlock(); await settle();
    audio.setScene('game'); await settle();
    const context = Context.instances[0];
    audio.paused = true;
    assert.equal(context.state, 'suspended');
    assert.ok(Media.instances.every(media => media.paused));
    assert.equal(timers.size, 0, 'pause clears crossfade stop callbacks');
    audio.paused = false; await settle();
    assert.equal(context.state, 'running');
    assert.equal(Media.instances[1].paused, false);
    audio.music = false;
    assert.ok(Media.instances.every(media => media.paused));
    assert.equal(context.gains[0].gain.value, 1, 'effect channel remains enabled');
    audio.sound = false;
    audio.music = true; await settle();
    assert.equal(context.gains[0].gain.value, 0);
    assert.equal(Media.instances[1].paused, false, 'music and effects settings are independent');
  } finally { audio.dispose(); }
});

test('autoplay rejection retries on a gesture and missing music gracefully uses ambient sound', async () => {
  const audio = new AudioSystem('./');
  try {
    Media.nextError = new DOMException('Gesture required', 'NotAllowedError');
    audio.unlock(); await settle();
    assert.equal(Media.instances[0].paused, true);
    audio.unlock(); await settle();
    assert.equal(Media.instances.length, 1);
    assert.equal(Media.instances[0].paused, false);
    Media.nextError = new DOMException('No music file yet', 'NotSupportedError');
    audio.setScene('game'); await settle();
    const context = Context.instances[0];
    assert.equal(context.gains[1].gain.value, 1, 'missing track enables the ambient fallback');
    (ambientTick as (() => void) | null)?.();
    assert.equal(context.oscillatorCount, 1);
    audio.music = false;
    (ambientTick as (() => void) | null)?.();
    assert.equal(context.oscillatorCount, 1);
    audio.setScene('menu');
    audio.music = true; await settle();
    assert.equal(context.gains[1].gain.value, 0, 'existing MP3 track silences ambient fallback');
    assert.equal(Media.instances[0].paused, false);
  } finally { audio.dispose(); }
});
