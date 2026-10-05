import vkBridge from '@vkontakte/vk-bridge';

/** Public platform contract. Init before loading progression. A Pages launch is
 * a real offline-capable guest session; ads and VK cloud need the VK container.
 * Reward grants MUST be conditional on reward() resolving true. */
export interface PlatformUser { id: number; name: string; avatar: string }
export interface BridgeAdapter {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  subscribe?(listener: (event: { detail?: { type: string; data?: unknown }; type?: string; data?: unknown }) => void): void;
  unsubscribe?(listener: (event: { detail?: { type: string; data?: unknown }; type?: string; data?: unknown }) => void): void;
  supports?(method: string): boolean;
  isWebView?(): boolean;
}
type PauseListener = (paused: boolean, reason: string) => void;
type BannerListener = (overlayHeight: number) => void;
type SafeArea = { top: number; right: number; bottom: number; left: number };
type Data = Record<string, unknown>;
const asData = (value: unknown): Data => value && typeof value === 'object' ? value as Data : {};
const unsupported = (error: unknown): boolean => [3, 4].includes(Number(asData(asData(error).error_data).error_code));

/** VK Bridge API shapes verified against VKCOM/vk-bridge packages/core/src/types/data.ts.
 * No access tokens, app secrets or credentials are needed for profile, storage or ads. */
export class VKPlatform {
  user: PlatformUser | null = null;
  isVK = false;
  ready = false;
  busy = false;
  bannerVisible = false;
  bannerHeight = 0;
  safeArea: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
  lastError = '';
  private bridge: BridgeAdapter;
  private initPromise: Promise<void> | null = null;
  private pauseReasons = new Set<string>();
  private pauseListeners = new Set<PauseListener>();
  private bannerListeners = new Set<BannerListener>();
  private areaListeners = new Set<(area: SafeArea) => void>();
  private bannerPending = false;
  private bannerWanted = true;
  private bannerGeneration = 0;
  private lastBannerAttempt = -Infinity;
  private bannerRetry: ReturnType<typeof setTimeout> | null = null;
  private lastAd = Date.now();
  private naturalBreaks = 0;
  private environment: boolean;
  private readonly eventListener = (event: { detail?: { type: string; data?: unknown }; type?: string; data?: unknown }) => {
    const detail = event.detail || event;
    const data = asData(detail.data);
    if (detail.type === 'VKWebAppViewHide') this.setPaused('vk-view', true);
    if (detail.type === 'VKWebAppViewRestore') {
      this.setPaused('vk-view', false);
      if (this.bannerWanted) void this.showBanner(true);
    }
    if (detail.type === 'VKWebAppUpdateConfig') this.updateSafeArea(data);
    if (detail.type === 'VKWebAppBannerAdUpdated') this.layoutBanner(data);
    if (detail.type === 'VKWebAppBannerAdClosedByUser') {
      this.layoutBanner({ result: false });
      this.scheduleBannerRetry(60_000);
    }
  };
  private readonly visibilityListener = () => {
    this.setPaused('document', document.hidden);
    if (!document.hidden && this.bannerWanted) void this.showBanner(true);
  };

  constructor(adapter?: BridgeAdapter, environment?: boolean) {
    const injected = typeof window !== 'undefined' ? (window as unknown as { vkBridge?: BridgeAdapter }).vkBridge : undefined;
    this.bridge = adapter || injected || vkBridge as unknown as BridgeAdapter;
    const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
    this.environment = environment ?? Boolean(adapter || injected || params.has('vk_app_id') || this.bridge.isWebView?.());
  }

  /** Local cache identity also uses the launch user ID when a VK client is offline.
   * This ID is never used as proof of authorization for a cloud write. */
  get identity(): string {
    if (this.user) return String(this.user.id);
    const id = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('vk_user_id')) : 0;
    return this.environment && Number.isSafeInteger(id) && id > 0 ? String(id) : 'guest';
  }
  get paused(): boolean { return this.pauseReasons.size > 0; }
  get cloudAvailable(): boolean { return this.isVK && this.user !== null; }

  onPause(listener: PauseListener): () => void {
    this.pauseListeners.add(listener);
    listener(this.paused, 'initial');
    return () => this.pauseListeners.delete(listener);
  }
  onBanner(listener: BannerListener): () => void {
    this.bannerListeners.add(listener);
    listener(this.bannerHeight);
    return () => this.bannerListeners.delete(listener);
  }
  onSafeArea(listener: (area: SafeArea) => void): () => void {
    this.areaListeners.add(listener);
    listener({ ...this.safeArea });
    return () => this.areaListeners.delete(listener);
  }
  private setPaused(reason: string, value: boolean): void {
    const before = this.paused;
    if (value) this.pauseReasons.add(reason); else this.pauseReasons.delete(reason);
    if (before !== this.paused) this.pauseListeners.forEach(listener => listener(this.paused, reason));
  }
  private async send(method: string, params: Data = {}, timeout = 8_000): Promise<Data> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => this.bridge.send(method, params)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`VK timeout: ${method}`)), timeout); }),
      ]);
      return asData(result);
    } finally { if (timer) clearTimeout(timer); }
  }
  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.initialize();
    return this.initPromise;
  }
  private async initialize(): Promise<void> {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityListener);
      this.setPaused('document', document.hidden);
    }
    if (!this.environment) { this.ready = true; return; }
    try {
      await this.send('VKWebAppInit');
      this.isVK = true;
      this.bridge.subscribe?.(this.eventListener);
      this.lastAd = Date.now();
      // Ads do not depend on GetUserInfo / storage success.
      void this.showBanner();
      void this.send('VKWebAppGetConfig').then(data => this.updateSafeArea(data)).catch(() => {});
      if (this.bridge.supports?.('VKWebAppSetOrientation')) {
        void this.send('VKWebAppSetOrientation', { orientation: 'portrait' }).catch(() => {});
      }
      try {
        const user = await this.send('VKWebAppGetUserInfo', {}, 5_000);
        const id = Number(user.id);
        if (Number.isSafeInteger(id) && id > 0) {
          const firstName = String(user.first_name || 'Игрок').slice(0, 32);
          const lastName = String(user.last_name || '').slice(0, 32);
          const avatar = String(user.photo_200 || user.photo_100 || '');
          this.user = { id, name: `${firstName} ${lastName}`.trim(), avatar: /^https:\/\//.test(avatar) ? avatar : '' };
        }
      } catch { this.lastError = 'Профиль VK временно недоступен'; }
    } catch { this.lastError = 'VK недоступен: используется локальный профиль'; }
    this.ready = true;
  }
  private updateSafeArea(data: Data): void {
    const insets = asData(data.insets);
    if (!Object.keys(insets).length) return;
    for (const key of ['top', 'right', 'bottom', 'left'] as const) {
      this.safeArea[key] = Math.min(150, Math.max(0, Number(insets[key]) || 0));
    }
    this.areaListeners.forEach(listener => listener({ ...this.safeArea }));
  }
  async getStorage(key: string): Promise<string | null> {
    if (!this.cloudAvailable) return null;
    const data = await this.send('VKWebAppStorageGet', { keys: [key] });
    if (!Array.isArray(data.keys)) return null;
    const entry = data.keys.map(asData).find(item => item.key === key);
    return entry && typeof entry.value === 'string' && entry.value ? entry.value : null;
  }
  async setStorage(key: string, value: string): Promise<boolean> {
    if (!this.cloudAvailable) return false;
    const data = await this.send('VKWebAppStorageSet', { key, value });
    return data.result === true;
  }
  private layoutBanner(data: Data): void {
    this.bannerVisible = data.result === true || (data.result !== false && data.banner_height !== undefined);
    // In resize mode the VK client already reduces the WebView: reserving twice
    // would shrink gameplay. Overlay mode needs an explicit bottom inset.
    this.bannerHeight = this.bannerVisible && data.layout_type === 'overlay'
      ? Math.min(180, Math.max(0, Number(data.banner_height) || 0)) : 0;
    this.bannerListeners.forEach(listener => listener(this.bannerHeight));
  }
  private scheduleBannerRetry(delay = 60_000): void {
    if (this.bannerRetry) clearTimeout(this.bannerRetry);
    if (!this.bannerWanted || !this.isVK) return;
    this.bannerRetry = setTimeout(() => { this.bannerRetry = null; void this.showBanner(true); }, delay);
  }
  async showBanner(force = false): Promise<boolean> {
    const wasWanted = this.bannerWanted;
    this.bannerWanted = true;
    if (!wasWanted) this.bannerGeneration++;
    if (!this.isVK || this.busy || this.paused || this.bannerPending || (this.bannerVisible && !force)) return this.bannerVisible;
    if (wasWanted && Date.now() - this.lastBannerAttempt < 15_000) return this.bannerVisible;
    this.bannerPending = true;
    this.lastBannerAttempt = Date.now();
    try {
      let data: Data;
      try {
        data = await this.send('VKWebAppShowBannerAd', { banner_location: 'bottom', layout_type: 'resize', can_close: false }, 10_000);
      } catch (error) {
        if (!unsupported(error)) throw error;
        data = await this.send('VKWebAppShowBannerAd', { banner_location: 'bottom' }, 10_000);
      }
      // An explicit hide may arrive while Show is unresolved.
      // Hide again after the pending native Show completes to prevent overlap.
      if (!this.bannerWanted) {
        try { await this.send('VKWebAppHideBannerAd'); } catch { /* Best effort. */ }
        this.layoutBanner({ result: false });
        return false;
      }
      this.layoutBanner(data);
      if (!this.bannerVisible) this.scheduleBannerRetry();
      return this.bannerVisible;
    } catch {
      this.layoutBanner({ result: false });
      this.scheduleBannerRetry();
      return false;
    } finally { this.bannerPending = false; }
  }
  async hideBanner(): Promise<void> {
    this.bannerWanted = false;
    const generation = ++this.bannerGeneration;
    const visibleOrPending = this.bannerVisible || this.bannerPending;
    this.layoutBanner({ result: false });
    if (this.bannerRetry) clearTimeout(this.bannerRetry);
    if (this.isVK && visibleOrPending) {
      try { await this.send('VKWebAppHideBannerAd'); } catch { /* Client may be offline. */ }
    }
    if (generation === this.bannerGeneration) this.layoutBanner({ result: false });
  }
  /** Call at a completed-level/menu break. Rate limited to 1 per 2 minutes and
   * at least 3 such breaks. Reward videos reset the same interstitial cooldown. */
  async interstitial(): Promise<boolean> {
    this.naturalBreaks++;
    if (this.naturalBreaks < 3 || Date.now() - this.lastAd < 120_000) return false;
    return this.ad('interstitial');
  }
  async reward(): Promise<boolean> { return this.ad('reward'); }
  private async ad(format: 'reward' | 'interstitial'): Promise<boolean> {
    if (!this.isVK || this.busy || this.paused) return false;
    this.busy = true;
    this.setPaused('ad', true);
    try {
      if (this.bridge.supports?.('VKWebAppCheckNativeAds')) {
        // Check errors alone do not mean the Show API is unavailable.
        let available: Data | null = null;
        try { available = await this.send('VKWebAppCheckNativeAds', { ad_format: format }, 5_000); } catch { /* Show is authoritative. */ }
        if (available?.result === false) return false;
      }
      this.lastAd = Date.now();
      let data: Data;
      if (format === 'interstitial' && this.bridge.supports?.('VKWebAppShowInterstitialAd')) {
        try { data = await this.send('VKWebAppShowInterstitialAd', {}, 120_000); }
        catch (error) {
          if (!unsupported(error)) throw error;
          data = await this.send('VKWebAppShowNativeAds', { ad_format: format }, 120_000);
        }
      } else data = await this.send('VKWebAppShowNativeAds', { ad_format: format }, 120_000);
      // A resolved Promise or closed video is insufficient: VK must confirm result:true.
      const success = data.result === true;
      if (success && format === 'interstitial') this.naturalBreaks = 0;
      return success;
    } catch { return false; }
    finally {
      this.busy = false;
      this.setPaused('ad', false);
      if (this.bannerWanted) void this.showBanner(true);
    }
  }
  haptic(style: 'light' | 'medium' | 'heavy' = 'light'): void {
    if (this.paused) return;
    if (this.isVK && this.bridge.supports?.('VKWebAppTapticImpactOccurred')) {
      void this.send('VKWebAppTapticImpactOccurred', { style }, 2_000).catch(() => {});
    } else if (typeof navigator !== 'undefined') navigator.vibrate?.(style === 'heavy' ? 20 : 10);
  }
  dispose(): void {
    this.bridge.unsubscribe?.(this.eventListener);
    if (this.bannerRetry) clearTimeout(this.bannerRetry);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibilityListener);
    this.pauseListeners.clear();
    this.bannerListeners.clear();
    this.areaListeners.clear();
  }
}

export const platform = new VKPlatform();
