export type MusicScene = 'menu' | 'game';
type MusicTrack = { element: HTMLAudioElement; gain: GainNode; unavailable: boolean; stopTimer: number };
const MUSIC_VOLUME = .24;
const CROSSFADE_SECONDS = .8;

export class AudioSystem {
  context: AudioContext | null = null;
  private soundEnabled = true;
  private musicEnabled = true;
  private isPaused = false;
  private unlocked = false;
  private scene: MusicScene = 'menu';
  private tracks = new Map<MusicScene, MusicTrack>();
  private effectsBus: GainNode | null = null;
  private ambientBus: GainNode | null = null;
  private melodyTimer = 0;
  private step = 0;

  constructor(private readonly assetBase = import.meta.env?.BASE_URL || './') {}

  get sound() { return this.soundEnabled; }
  set sound(value: boolean) {
    this.soundEnabled = value;
    if (this.effectsBus && this.context) this.effectsBus.gain.setValueAtTime(value ? 1 : 0, this.context.currentTime);
  }
  get music() { return this.musicEnabled; }
  set music(value: boolean) {
    if (value === this.musicEnabled) return;
    this.musicEnabled = value;
    this.syncMusic();
  }
  get paused() { return this.isPaused; }
  set paused(value: boolean) {
    if (value === this.isPaused) return;
    this.isPaused = value;
    this.syncMusic();
    if (this.context) {
      const operation = value ? this.context.suspend() : this.context.resume();
      void operation.catch(() => {});
    }
  }

  /** The first pointer/keyboard gesture unlocks audio in mobile WebViews. */
  unlock() {
    if (!this.context) {
      const Context = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      try {
        this.context = new Context();
        this.effectsBus = this.context.createGain();
        this.effectsBus.gain.value = this.soundEnabled ? 1 : 0;
        this.effectsBus.connect(this.context.destination);
        this.ambientBus = this.context.createGain();
        this.ambientBus.connect(this.context.destination);
      } catch { return; }
    }
    this.unlocked = true;
    if (!this.paused && this.context.state === 'suspended') void this.context.resume().catch(() => {});
    if (!this.melodyTimer) this.melodyTimer = window.setInterval(() => this.ambient(), 1800);
    this.syncMusic();
  }

  setScene(scene: MusicScene) {
    if (scene === this.scene) return;
    this.scene = scene;
    this.syncMusic();
  }

  private ensureTrack(scene: MusicScene): MusicTrack | null {
    const existing = this.tracks.get(scene);
    if (existing) return existing;
    if (!this.context) return null;
    try {
      const element = new Audio(`${this.assetBase}assets/audio/${scene}.mp3`);
      element.loop = true;
      element.preload = 'none';
      element.setAttribute('playsinline', '');
      const gain = this.context.createGain();
      gain.gain.value = 0;
      this.context.createMediaElementSource(element).connect(gain);
      gain.connect(this.context.destination);
      const track: MusicTrack = { element, gain, unavailable: false, stopTimer: 0 };
      element.addEventListener('error', () => this.trackUnavailable(scene, track));
      this.tracks.set(scene, track);
      return track;
    } catch { return null; }
  }

  private trackUnavailable(scene: MusicScene, track: MusicTrack) {
    if (track.unavailable) return;
    track.unavailable = true;
    track.element.pause();
    if (scene === this.scene) this.syncMusic();
  }

  private setTrackVolume(track: MusicTrack, volume: number, duration = 0) {
    if (!this.context) return;
    const time = this.context.currentTime;
    track.gain.gain.cancelScheduledValues(time);
    track.gain.gain.setValueAtTime(track.gain.gain.value, time);
    if (duration) track.gain.gain.linearRampToValueAtTime(volume, time + duration);
    else track.gain.gain.setValueAtTime(volume, time);
  }

  private syncMusic() {
    if (!this.context || !this.unlocked) return;
    const enabled = this.musicEnabled && !this.isPaused;
    if (this.ambientBus) this.ambientBus.gain.setValueAtTime(0, this.context.currentTime);
    for (const [scene, track] of this.tracks) {
      if (track.stopTimer) { window.clearTimeout(track.stopTimer); track.stopTimer = 0; }
      if (!enabled) {
        this.setTrackVolume(track, 0);
        track.element.pause();
      } else if (scene !== this.scene) {
        this.setTrackVolume(track, 0, CROSSFADE_SECONDS);
        track.stopTimer = window.setTimeout(() => { track.element.pause(); track.stopTimer = 0; }, CROSSFADE_SECONDS * 1000 + 30);
      }
    }
    if (!enabled) return;
    const track = this.ensureTrack(this.scene);
    if (!track || track.unavailable) {
      if (this.ambientBus) this.ambientBus.gain.setValueAtTime(1, this.context.currentTime);
      return;
    }
    const scene = this.scene;
    const started = track.element.play();
    if (started) void started.then(() => {
      if (this.scene === scene && this.musicEnabled && !this.isPaused) this.setTrackVolume(track, MUSIC_VOLUME, CROSSFADE_SECONDS);
      else { this.setTrackVolume(track, 0); track.element.pause(); }
    }).catch((error: unknown) => {
      // A blocked autoplay attempt waits for the next gesture; missing or
      // unsupported files use the quiet procedural music without blocking boot.
      if (error instanceof DOMException && error.name === 'NotAllowedError') return;
      this.trackUnavailable(scene, track);
    });
  }

  tone(freq: number, duration = .12, type: OscillatorType = 'sine', gain = .08, delay = 0, music = false) {
    if (!this.context || this.paused) return;
    const t = this.context.currentTime + delay, o = this.context.createOscillator(), g = this.context.createGain();
    o.type = type; o.frequency.setValueAtTime(freq,t); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(gain,t+.01); g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    o.connect(g); g.connect((music ? this.ambientBus : this.effectsBus) || this.context.destination); o.start(t); o.stop(t+duration+.01);
  }
  play(kind: 'tap'|'screw'|'drop'|'error'|'win'|'reward') {
    if (!this.sound) return;
    if (kind==='tap') this.tone(700,.045,'sine',.025);
    if (kind==='screw') { this.tone(1100,.075,'triangle',.04); this.tone(1500,.06,'sine',.025,.065); }
    if (kind==='drop') { this.tone(115,.15,'triangle',.065); this.tone(170,.08,'sine',.04,.09); }
    if (kind==='error') this.tone(170,.13,'triangle',.04);
    if (kind==='win'||kind==='reward') [523,659,784,1047].forEach((f,i)=>this.tone(f,.4,'sine',.07,i*.12));
  }
  private ambient() {
    if (!this.music || this.paused) return;
    const selected = this.tracks.get(this.scene);
    if (selected && !selected.unavailable) return;
    const notes = this.scene === 'menu' ? [196,246.94,293.66,369.99,293.66,246.94,220,293.66] : [146.83,196,220,293.66,246.94,196,164.81,220];
    this.tone(notes[this.step++%notes.length],2.3,'sine',.009,0,true);
  }
  dispose() {
    if (this.melodyTimer) window.clearInterval(this.melodyTimer);
    this.melodyTimer = 0;
    for (const track of this.tracks.values()) {
      if (track.stopTimer) window.clearTimeout(track.stopTimer);
      track.element.pause();
      track.element.removeAttribute('src');
      track.element.load();
    }
    this.tracks.clear();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.unlocked = false;
  }
}
