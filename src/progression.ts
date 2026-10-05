import { platform, type VKPlatform } from './platform';
import { generateLevel, Puzzle, type Hole, type PuzzleSnapshot } from './puzzle';

export const CAMPAIGN_LEVELS = 600;
export const MAX_HEARTS = 5;
export const HEART_REGEN_MS = 30 * 60 * 1_000;
export type BoosterType = 'undo' | 'remove' | 'shuffle' | 'hint';
export type CosmeticType = 'skin' | 'background' | 'skins' | 'backgrounds';
export type Setting = 'sound' | 'music' | 'haptic';
export const BOOSTER_PRICES: Record<BoosterType, number> = { undo: 80, remove: 160, shuffle: 120, hint: 100 };
export const SKINS = [
  { id: 'classic', name: 'Классика', description: 'Яркие эмалевые винты', price: 0, unlockLevel: 1, color: '#41bfdd' },
  { id: 'chrome', name: 'Хром', description: 'Холодный блеск металла', price: 1_200, unlockLevel: 20, color: '#a9d4ed' },
  { id: 'gold', name: 'Золото', description: 'Тёплое сияние победы', price: 2_400, unlockLevel: 50, color: '#ffd05b' },
  { id: 'aurora', name: 'Аврора', description: 'Перламутр северного света', price: 3_200, unlockLevel: 90, color: '#74efcb' },
  { id: 'neon', name: 'Неон', description: 'Энергия ночного города', price: 4_200, unlockLevel: 200, color: '#c18aff' },
  { id: 'candy', name: 'Конфетти', description: 'Сладкие цвета мастерской', price: 2_000, unlockLevel: 140, color: '#ff8fb3' },
] as const;
export const BACKGROUNDS = [
  { id: 'workshop', name: 'Мастерская', description: 'Тёплый свет и дерево', price: 0, unlockLevel: 1, color: '#315768' },
  { id: 'midnight', name: 'Полночь', description: 'Лунный свет и глубокий индиго', price: 1_500, unlockLevel: 35, color: '#26364e' },
  { id: 'forest', name: 'Лес', description: 'Изумрудная тишина', price: 1_800, unlockLevel: 80, color: '#285d47' },
  { id: 'sunset', name: 'Закат', description: 'Медовое вечернее небо', price: 2_200, unlockLevel: 160, color: '#815846' },
  { id: 'arctic', name: 'Арктика', description: 'Чистый свет и ледяная свежесть', price: 2_500, unlockLevel: 300, color: '#3f7686' },
] as const;
export const LOGIN_REWARDS = [
  { coins: 60 }, { coins: 80 }, { coins: 100, booster: 'undo' },
  { coins: 125 }, { coins: 150, booster: 'shuffle' }, { coins: 175 },
  { coins: 250, booster: 'remove' },
] as const;
export interface ProgressState {
  version: 1;
  revision: number;
  updatedAt: number;
  coins: number;
  hearts: number;
  heartRegenAt: number;
  /** 601 means all 600 campaign puzzles are unlocked and complete. */
  level: number;
  stars: Record<string, number>;
  boosters: Record<BoosterType, number>;
  ownedSkins: string[];
  skin: string;
  ownedBackgrounds: string[];
  background: string;
  daily: { date: string; completed: boolean; taskProgress: Record<string, number>; taskClaimed: string[] };
  login: { lastClaim: string; streak: number };
  stats: { totalWins: number; totalScrews: number; playSeconds: number; bestSeconds: number; adsWatched: number; loginDays: number };
  settings: Record<Setting, boolean>;
  tutorialDone: boolean;
  checkpoint: GameCheckpoint | null;
}
export interface GameCheckpoint { level: number; daily: boolean; date: string; snapshot: PuzzleSnapshot; seconds: number; boosterCount: number }
export interface DailyTask { id: string; title: string; goal: number; target: number; progress: number; reward: number; claimed: boolean; complete: boolean }
export interface LevelResult { screws?: number; seconds?: number; boostersUsed?: number; daily?: boolean }
export interface WinReward { coins: number; stars: number; firstClear: boolean; unlocked: number; daily: boolean }
export type LoginReward = { day: number; coins: number; booster?: BoosterType };
type Data = Record<string, unknown>;
const object = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
const integer = (value: unknown, fallback: number, min = 0, max = 1_000_000): number => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
};
const CLOUD_KEY = 'screw_atelier_v1';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Fixed UTC+3 day boundary: daily levels and tasks agree across phones/timezones. */
export function dailyDate(now = Date.now()): string { return new Date(now + 3 * 60 * 60 * 1_000).toISOString().slice(0, 10); }
export function dailySeed(date = dailyDate()): number {
  let seed = 2_166_136_261;
  for (const character of `screw-ateliers-daily:${date}`) { seed ^= character.charCodeAt(0); seed = Math.imul(seed, 16_777_619); }
  return seed >>> 0;
}
const previousDate = (date: string): string => new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const validDate = (value: unknown): string => typeof value === 'string' && DATE_RE.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) ? value : '';
function newState(now: number): ProgressState {
  return {
    version: 1, revision: 0, updatedAt: now, coins: 350, hearts: MAX_HEARTS,
    heartRegenAt: now, level: 1, stars: {}, boosters: { undo: 3, remove: 2, shuffle: 2, hint: 3 },
    ownedSkins: ['classic'], skin: 'classic', ownedBackgrounds: ['workshop'], background: 'workshop',
    daily: { date: dailyDate(now), completed: false, taskProgress: {}, taskClaimed: [] },
    login: { lastClaim: '', streak: 0 },
    stats: { totalWins: 0, totalScrews: 0, playSeconds: 0, bestSeconds: 0, adsWatched: 0, loginDays: 0 },
    settings: { sound: true, music: true, haptic: true }, tutorialDone: false, checkpoint: null,
  };
}
/** Corrupt / old / tampered saves cannot introduce negative balances, unknown
 * shop items, unbounded collections or prototype keys. */
export function sanitizeProgress(value: unknown, now = Date.now()): ProgressState {
  const source = object(value);
  const state = newState(now);
  if (!Object.keys(source).length) return state;
  state.revision = integer(source.revision, 0, 0, Number.MAX_SAFE_INTEGER);
  state.updatedAt = integer(source.updatedAt, now, 0, now + 60_000);
  state.coins = integer(source.coins, 350);
  state.hearts = integer(source.hearts, MAX_HEARTS, 0, MAX_HEARTS);
  state.heartRegenAt = integer(source.heartRegenAt, now, 0, now);
  state.level = integer(source.level, 1, 1, CAMPAIGN_LEVELS + 1);
  const savedStars = source.stars;
  for (let level = 1; level <= CAMPAIGN_LEVELS; level++) {
    const stars = typeof savedStars === 'string' ? savedStars[level - 1] : object(savedStars)[String(level)];
    const score = integer(stars, 0, 0, 3);
    if (score > 0) state.stars[String(level)] = score;
  }
  // Unlocking is contiguous and based on cleared puzzles, not an editable field.
  let unlocked = 1;
  while (unlocked <= CAMPAIGN_LEVELS && state.stars[String(unlocked)]) unlocked++;
  state.level = unlocked;
  const boosters = object(source.boosters);
  for (const key of ['undo', 'remove', 'shuffle', 'hint'] as const) state.boosters[key] = integer(boosters[key], state.boosters[key], 0, 999);
  state.ownedSkins = SKINS.filter(item => item.id === 'classic' || (Array.isArray(source.ownedSkins) && source.ownedSkins.includes(item.id))).map(item => item.id);
  state.ownedBackgrounds = BACKGROUNDS.filter(item => item.id === 'workshop' || (Array.isArray(source.ownedBackgrounds) && source.ownedBackgrounds.includes(item.id))).map(item => item.id);
  if (typeof source.skin === 'string' && state.ownedSkins.includes(source.skin)) state.skin = source.skin;
  if (typeof source.background === 'string' && state.ownedBackgrounds.includes(source.background)) state.background = source.background;
  const daily = object(source.daily);
  const date = validDate(daily.date);
  if (date === state.daily.date) {
    state.daily.completed = daily.completed === true;
    const taskProgress = object(daily.taskProgress);
    for (const key of ['levels', 'screws', 'perfect', 'daily', 'noBoost']) state.daily.taskProgress[key] = integer(taskProgress[key], 0, 0, 10_000);
    state.daily.taskClaimed = Array.isArray(daily.taskClaimed) ? daily.taskClaimed.filter((id): id is string => typeof id === 'string' && ['levels', 'screws', 'perfect', 'daily', 'noBoost'].includes(id)).slice(0, 3) : [];
  }
  const login = object(source.login);
  state.login.lastClaim = validDate(login.lastClaim);
  state.login.streak = integer(login.streak, 0, 0, 7);
  const stats = object(source.stats);
  for (const key of Object.keys(state.stats) as (keyof ProgressState['stats'])[]) state.stats[key] = integer(stats[key], 0, 0, 100_000_000);
  const settings = object(source.settings);
  for (const key of ['sound', 'music', 'haptic'] as const) if (typeof settings[key] === 'boolean') state.settings[key] = settings[key];
  state.tutorialDone = source.tutorialDone === true;
  state.checkpoint = sanitizeCheckpoint(source.checkpoint, state, now);
  return state;
}
const boolArray = (value: unknown): boolean[] | null => {
  if (typeof value === 'string' && /^[01]{1,256}$/.test(value)) return [...value].map(bit => bit === '1');
  return Array.isArray(value) && value.length > 0 && value.length <= 256 && value.every(bit => typeof bit === 'boolean') ? [...value] as boolean[] : null;
};
function sanitizeCheckpoint(value: unknown, state: ProgressState, now: number): GameCheckpoint | null {
  const checkpoint = object(value), raw = object(checkpoint.snapshot);
  if (!Object.keys(raw).length) return null;
  const level = Number(checkpoint.level), daily = checkpoint.daily === true, date = validDate(checkpoint.date);
  if (!Number.isInteger(level) || level < 1 || level > CAMPAIGN_LEVELS || (!daily && level > state.level) || (daily && date !== dailyDate(now))) return null;
  const screws = boolArray(raw.screws), released = boolArray(raw.released), removed = boolArray(raw.removed);
  if (!screws || !released || !removed || raw.version !== 1 || raw.levelId !== level || !Number.isInteger(raw.seed) || Number(raw.seed) < 0 || Number(raw.seed) > 4_294_967_295 || !Number.isInteger(raw.moves) || Number(raw.moves) < 0 || Number(raw.moves) > 100_000) return null;
  try {
    // A different catalogue must never reinterpret saved screw bitsets as a
    // random daily board. Keep earned currency/stars and discard only that attempt.
    const expectedSeed=daily?Number(date.replace(/-/g,'')):generateLevel(level).seed;
    if(Number(raw.seed)!==expectedSeed)return null;
    const generated = generateLevel(Number(raw.levelId), Number(raw.seed));
    let holes: Hole[];
    if (raw.compact === 1) {
      holes = generated.holes.map(hole => ({ ...hole }));
      if (!Array.isArray(raw.extra) || raw.extra.length > 5) return null;
      for (const extra of raw.extra) {
        if (!Array.isArray(extra) || extra.length !== 2 || !extra.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1)) return null;
        holes.push({ id: holes.length, x: extra[0], y: extra[1], initialScrew: false, extra: true });
      }
    } else {
      if (!Array.isArray(raw.holes) || raw.holes.length > generated.holes.length + 5) return null;
      holes = raw.holes.map((entry, index) => {
        const h = object(entry);
        return { id: Number(h.id), x: Number(h.x), y: Number(h.y), initialScrew: h.initialScrew === true, ...(index >= generated.holes.length ? { extra: true } : {}) };
      });
      if (holes.some(hole => !Number.isFinite(hole.x) || !Number.isFinite(hole.y) || hole.x < 0 || hole.x > 1 || hole.y < 0 || hole.y > 1)) return null;
      if (generated.holes.some((h, i) => holes[i]?.id !== h.id || holes[i]?.x !== h.x || holes[i]?.y !== h.y || holes[i]?.initialScrew !== h.initialScrew)) return null;
    }
    const snapshot: PuzzleSnapshot = { version: 1, levelId: generated.id, seed: generated.seed, screws, released, removed, moves: Number(raw.moves), holes };
    const puzzle = new Puzzle(generated);
    if (!puzzle.restore(snapshot) || puzzle.solved) return null;
    return { level, daily, date, snapshot, seconds: integer(checkpoint.seconds, 0, 0, 86_400), boosterCount: integer(checkpoint.boosterCount, 0, 0, 999) };
  } catch { return null; }
}
function compactCheckpoint(checkpoint: GameCheckpoint | null): unknown {
  if (!checkpoint) return null;
  const snapshot = checkpoint.snapshot;
  return { ...checkpoint, snapshot: {
    version: 1, compact: 1, levelId: snapshot.levelId, seed: snapshot.seed, moves: snapshot.moves,
    screws: snapshot.screws.map(bit => bit ? '1' : '0').join(''),
    released: snapshot.released.map(bit => bit ? '1' : '0').join(''),
    removed: snapshot.removed.map(bit => bit ? '1' : '0').join(''),
    extra: snapshot.holes.filter(hole => hole.extra).map(hole => [hole.x, hole.y]),
  } };
}
function decode(text: string | null, now: number): ProgressState | null {
  if (!text || text.length > 12_000) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (object(value).version !== 1) return null;
    return sanitizeProgress(value, now);
  } catch { return null; }
}
/** Compact star string keeps all 600 levels plus economy below VK's per-key
 * storage limit; UI receives the convenient level-keyed record. */
export function encodeProgress(state: ProgressState, forCloud = false): string {
  let stars = '';
  for (let level = 1; level <= CAMPAIGN_LEVELS; level++) stars += String(state.stars[String(level)] || 0);
  const wire = { ...state, stars, checkpoint: compactCheckpoint(state.checkpoint) };
  let payload = JSON.stringify(wire);
  if (forCloud && new TextEncoder().encode(payload).length > 4_000) payload = JSON.stringify({ ...wire, checkpoint: null });
  return payload;
}
const taskDefinitions = (date: string): { id: string; title: string; goal: number; reward: number }[] => {
  const rotation = dailySeed(date) % 3;
  return [
    { id: 'levels', title: 'Пройди уровни', goal: rotation === 1 ? 4 : 3, reward: 70 },
    { id: 'screws', title: 'Собери винты', goal: [36, 45, 30][rotation], reward: 90 },
    rotation === 0 ? { id: 'perfect', title: 'Получи 3 звезды', goal: 2, reward: 100 }
      : rotation === 1 ? { id: 'daily', title: 'Реши загадку дня', goal: 1, reward: 100 }
        : { id: 'noBoost', title: 'Победи без бустеров', goal: 2, reward: 100 },
  ];
};

/** All mutations save a synchronous user-scoped local backup, then debounce a
 * serialized VK cloud write. Call tick() every second for heart/day updates,
 * subscribe() to redraw counters, and flush() before a controlled navigation. */
export class Progression {
  state: ProgressState;
  status: 'local' | 'cloud' | 'saving' | 'pending' = 'local';
  loaded = false;
  private localKey = '';
  private listeners = new Set<(state: ProgressState) => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  private dirty = false;
  private retryDelay = 10_000;
  private initPromise: Promise<void> | null = null;
  private readonly pageHide = () => { this.localSave(); void this.flush(); };
  private readonly online = () => { void this.flush(); };
  constructor(private vk: VKPlatform = platform, private now: () => number = () => Date.now()) { this.state = newState(this.now()); }
  subscribe(listener: (state: ProgressState) => void): () => void {
    this.listeners.add(listener); listener(this.state);
    return () => this.listeners.delete(listener);
  }
  private emit(): void { this.listeners.forEach(listener => listener(this.state)); }
  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.initialize();
    return this.initPromise;
  }
  private async initialize(): Promise<void> {
    await this.vk.init();
    const now = this.now();
    this.localKey = `screw_atelier_v1_${this.vk.identity}`;
    let local: ProgressState | null = null;
    try { local = decode(localStorage.getItem(this.localKey), now); } catch { /* Storage may be restricted. */ }
    let cloud: ProgressState | null = null;
    if (this.vk.cloudAvailable) {
      try { cloud = decode(await this.vk.getStorage(CLOUD_KEY), now); }
      catch { this.status = 'pending'; }
    }
    const localNewer = local && (!cloud || local.updatedAt > cloud.updatedAt || (local.updatedAt === cloud.updatedAt && local.revision > cloud.revision));
    this.state = (localNewer ? local : cloud) || local || newState(now);
    this.loaded = true;
    this.status = this.vk.cloudAvailable ? (cloud && !localNewer ? 'cloud' : 'pending') : 'local';
    this.dirty = this.vk.cloudAvailable && (!cloud || Boolean(localNewer));
    this.tick();
    this.localSave();
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.pageHide);
      window.addEventListener('online', this.online);
    }
    this.emit();
    if (this.dirty) this.scheduleSave();
  }
  private localSave(): void {
    if (!this.localKey) return;
    try { localStorage.setItem(this.localKey, encodeProgress(this.state)); } catch { /* Keep the live session usable. */ }
  }
  private changed(): void {
    this.state.revision++;
    this.state.updatedAt = Math.max(this.state.updatedAt, this.now());
    this.dirty = true;
    this.localSave();
    this.emit();
    this.scheduleSave();
  }
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.flush(); }, 750);
  }
  async flush(): Promise<void> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    this.localSave();
    if (!this.loaded || !this.dirty || !this.vk.cloudAvailable) return;
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.writeCloud();
    try { await this.flushPromise; } finally { this.flushPromise = null; }
  }
  private async writeCloud(): Promise<void> {
    this.status = 'saving';
    const revision = this.state.revision;
    const payload = encodeProgress(this.state, true);
    try {
      if (new TextEncoder().encode(payload).length > 4_000) throw new Error('Save exceeds VK storage limit');
      if (!await this.vk.setStorage(CLOUD_KEY, payload)) throw new Error('Cloud save not acknowledged');
      this.dirty = this.state.revision !== revision;
      this.status = this.dirty ? 'pending' : 'cloud';
      this.retryDelay = 10_000;
      if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
      if (this.dirty) this.scheduleSave();
    } catch {
      this.dirty = true;
      this.status = 'pending';
      if (!this.retryTimer) {
        this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.flush(); }, this.retryDelay);
        this.retryDelay = Math.min(60_000, this.retryDelay * 2);
      }
    }
  }
  tick(): void {
    const now = this.now();
    let changed = false;
    if (this.state.hearts < MAX_HEARTS) {
      const elapsed = Math.max(0, now - this.state.heartRegenAt);
      const recovered = Math.floor(elapsed / HEART_REGEN_MS);
      if (recovered) {
        this.state.hearts = Math.min(MAX_HEARTS, this.state.hearts + recovered);
        this.state.heartRegenAt = this.state.hearts === MAX_HEARTS ? now : this.state.heartRegenAt + recovered * HEART_REGEN_MS;
        changed = true;
      }
    }
    const date = dailyDate(now);
    if (this.state.daily.date !== date) {
      this.state.daily = { date, completed: false, taskProgress: {}, taskClaimed: [] };
      if (this.state.checkpoint?.daily) this.state.checkpoint = null;
      changed = true;
    }
    if (changed) this.changed();
  }
  get heartCountdownMs(): number {
    return this.state.hearts >= MAX_HEARTS ? 0 : Math.max(0, HEART_REGEN_MS - (this.now() - this.state.heartRegenAt));
  }
  /** Consume when a fresh attempt starts. The game refunds refillHearts(1) on
   * success; resumed attempts reuse their checkpoint and do not spend again. */
  spendHeart(): boolean {
    this.tick();
    if (this.state.hearts === 0) return false;
    if (this.state.hearts === MAX_HEARTS) this.state.heartRegenAt = this.now();
    this.state.hearts--; this.changed(); return true;
  }
  refillHearts(amount = MAX_HEARTS): void {
    this.tick();
    this.state.hearts = Math.min(MAX_HEARTS, this.state.hearts + integer(amount, 0, 0, MAX_HEARTS));
    if (this.state.hearts === MAX_HEARTS) this.state.heartRegenAt = this.now();
    this.changed();
  }
  buyHearts(): boolean {
    this.tick();
    if (this.state.hearts === MAX_HEARTS || this.state.coins < 200) return false;
    this.state.coins -= 200; this.state.hearts = MAX_HEARTS; this.state.heartRegenAt = this.now(); this.changed(); return true;
  }
  useBooster(type: BoosterType): boolean {
    if (!Object.hasOwn(BOOSTER_PRICES, type) || this.state.boosters[type] <= 0) return false;
    this.state.boosters[type]--; this.changed(); return true;
  }
  buyBooster(type: BoosterType): boolean {
    if (!Object.hasOwn(BOOSTER_PRICES, type) || this.state.coins < BOOSTER_PRICES[type] || this.state.boosters[type] >= 999) return false;
    this.state.coins -= BOOSTER_PRICES[type]; this.state.boosters[type]++; this.changed(); return true;
  }
  grantBooster(type: BoosterType, amount = 1): void {
    if (!Object.hasOwn(BOOSTER_PRICES, type)) return;
    this.state.boosters[type] = Math.min(999, this.state.boosters[type] + integer(amount, 0, 0, 99)); this.changed();
  }
  addBooster(type: BoosterType, amount = 1): void { this.grantBooster(type, amount); }
  canBuyCosmetic(type: CosmeticType, id: string): boolean {
    if (!['skin', 'skins', 'background', 'backgrounds'].includes(type)) return false;
    const isSkin = type === 'skin' || type === 'skins';
    const item = (isSkin ? SKINS : BACKGROUNDS).find(entry => entry.id === id);
    const owned = isSkin ? this.state.ownedSkins : this.state.ownedBackgrounds;
    return Boolean(item && !owned.includes(id) && this.state.level > item.unlockLevel && this.state.coins >= item.price);
  }
  buyCosmetic(type: CosmeticType, id: string): boolean {
    if (!['skin', 'skins', 'background', 'backgrounds'].includes(type)) return false;
    const isSkin = type === 'skin' || type === 'skins';
    const item = (isSkin ? SKINS : BACKGROUNDS).find(entry => entry.id === id);
    const owned = isSkin ? this.state.ownedSkins : this.state.ownedBackgrounds;
    if (!item || !this.canBuyCosmetic(type, id)) return false;
    this.state.coins -= item.price; owned.push(id);
    if (isSkin) this.state.skin = id; else this.state.background = id;
    this.changed(); return true;
  }
  selectCosmetic(type: CosmeticType, id: string): boolean {
    if (!['skin', 'skins', 'background', 'backgrounds'].includes(type)) return false;
    const isSkin = type === 'skin' || type === 'skins';
    const owned = isSkin ? this.state.ownedSkins : this.state.ownedBackgrounds;
    if (!owned.includes(id)) return false;
    if (isSkin) this.state.skin = id; else this.state.background = id;
    this.changed(); return true;
  }
  get loginAvailable(): boolean { return this.state.login.lastClaim !== dailyDate(this.now()); }
  get nextLoginDay(): number {
    const today = dailyDate(this.now());
    if (this.state.login.lastClaim === today) return this.state.login.streak || 1;
    return this.state.login.lastClaim === previousDate(today) ? this.state.login.streak % 7 + 1 : 1;
  }
  claimLogin(): LoginReward | null {
    this.tick();
    if (!this.loginAvailable) return null;
    const day = this.nextLoginDay;
    const reward = LOGIN_REWARDS[day - 1];
    this.state.coins = Math.min(1_000_000, this.state.coins + reward.coins);
    let booster: BoosterType | undefined;
    if ('booster' in reward) { booster = reward.booster; this.state.boosters[booster] = Math.min(999, this.state.boosters[booster] + 1); }
    this.state.login = { lastClaim: dailyDate(this.now()), streak: day };
    this.state.stats.loginDays++; this.changed();
    return { day, coins: reward.coins, booster };
  }
  tasks(): DailyTask[] {
    this.tick();
    return taskDefinitions(this.state.daily.date).map(task => {
      const progress = Math.min(task.goal, this.state.daily.taskProgress[task.id] || 0);
      return { ...task, target: task.goal, progress, claimed: this.state.daily.taskClaimed.includes(task.id), complete: progress >= task.goal };
    });
  }
  claimTask(id: string): number {
    const task = this.tasks().find(entry => entry.id === id);
    if (!task || !task.complete || task.claimed) return 0;
    this.state.daily.taskClaimed.push(id);
    this.state.coins = Math.min(1_000_000, this.state.coins + task.reward);
    this.changed(); return task.reward;
  }
  completeLevel(level: number, stars: number, result: LevelResult = {}): WinReward | null {
    this.tick();
    const daily = result.daily === true;
    if (!Number.isInteger(level) || level < 1 || level > CAMPAIGN_LEVELS || (!daily && level > this.state.level)) return null;
    if (daily && this.state.daily.completed) return { coins: 0, stars: integer(stars, 1, 1, 3), firstClear: false, unlocked: this.state.level, daily: true };
    const score = integer(stars, 1, 1, 3);
    const prior = daily ? 0 : this.state.stars[String(level)] || 0;
    const firstClear = prior === 0;
    const coins = daily ? 150 : firstClear ? 45 + score * 15 : Math.max(0, score - prior) * 15;
    if (daily) this.state.daily.completed = true;
    else {
      this.state.stars[String(level)] = Math.max(prior, score);
      if (level === this.state.level) this.state.level = Math.min(CAMPAIGN_LEVELS + 1, level + 1);
    }
    this.state.coins = Math.min(1_000_000, this.state.coins + coins);
    const screws = integer(result.screws, 0, 0, 500);
    const seconds = integer(result.seconds, 0, 0, 3_600);
    this.state.stats.totalWins++;
    this.state.stats.totalScrews += screws;
    this.state.stats.playSeconds += seconds;
    if (seconds > 0 && (!this.state.stats.bestSeconds || seconds < this.state.stats.bestSeconds)) this.state.stats.bestSeconds = seconds;
    const progress = this.state.daily.taskProgress;
    progress.levels = (progress.levels || 0) + 1;
    progress.screws = (progress.screws || 0) + screws;
    if (score === 3) progress.perfect = (progress.perfect || 0) + 1;
    if (daily) progress.daily = 1;
    if (!result.boostersUsed) progress.noBoost = (progress.noBoost || 0) + 1;
    this.changed();
    return { coins, stars: score, firstClear, unlocked: this.state.level, daily };
  }
  rewardCoins(amount: number): void {
    const coins = integer(amount, 0, 0, 10_000);
    if (!coins) return;
    this.state.coins = Math.min(1_000_000, this.state.coins + coins); this.changed();
  }
  /** Complete reward flow with no grants for an unavailable/cancelled video. */
  async claimAdReward(reward: { coins?: number; heart?: number; booster?: BoosterType }): Promise<boolean> {
    if (!await this.vk.reward()) return false;
    this.state.stats.adsWatched++;
    this.state.coins = Math.min(1_000_000, this.state.coins + integer(reward.coins, 0, 0, 200));
    if (reward.heart) {
      this.state.hearts = Math.min(MAX_HEARTS, this.state.hearts + integer(reward.heart, 0, 0, MAX_HEARTS));
      if (this.state.hearts === MAX_HEARTS) this.state.heartRegenAt = this.now();
    }
    if (reward.booster && Object.hasOwn(BOOSTER_PRICES, reward.booster)) this.state.boosters[reward.booster] = Math.min(999, this.state.boosters[reward.booster] + 1);
    // The synchronous local backup is already committed; a slow cloud write
    // must not hold the reward animation or leave controls disabled.
    this.changed(); void this.flush(); return true;
  }
  setSetting(key: Setting, value: boolean): void {
    if (!['sound', 'music', 'haptic'].includes(key)) return;
    this.state.settings[key] = value === true; this.changed();
  }
  finishTutorial(): void { this.state.tutorialDone = true; this.changed(); }
  saveCheckpoint(checkpoint: GameCheckpoint): boolean {
    this.tick();
    const valid = sanitizeCheckpoint(checkpoint, this.state, this.now());
    if (!valid) return false;
    this.state.checkpoint = valid; this.changed(); return true;
  }
  clearCheckpoint(): void {
    if (!this.state.checkpoint) return;
    this.state.checkpoint = null; this.changed();
  }
  dispose(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.pageHide);
      window.removeEventListener('online', this.online);
    }
    this.listeners.clear(); this.localSave();
  }
}

export const progression = new Progression();
