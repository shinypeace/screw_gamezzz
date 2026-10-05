export class AudioSystem {
  context: AudioContext | null = null;
  sound = true;
  music = true;
  paused = false;
  private melodyTimer = 0;
  private step = 0;
  unlock() {
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') void this.context.resume();
    if (!this.melodyTimer) this.melodyTimer = window.setInterval(() => this.ambient(), 1800);
  }
  tone(freq: number, duration = .12, type: OscillatorType = 'sine', gain = .08, delay = 0) {
    if (!this.context || this.paused) return;
    const t = this.context.currentTime + delay, o = this.context.createOscillator(), g = this.context.createGain();
    o.type = type; o.frequency.setValueAtTime(freq,t); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(gain,t+.01); g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    o.connect(g); g.connect(this.context.destination); o.start(t); o.stop(t+duration+.01);
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
    const notes=[196,246.94,293.66,369.99,293.66,246.94,220,293.66];
    this.tone(notes[this.step++%notes.length],2.3,'sine',.009);
  }
}
