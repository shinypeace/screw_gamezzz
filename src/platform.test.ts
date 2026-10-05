import test from 'node:test';
import assert from 'node:assert/strict';
import { VKPlatform, type BridgeAdapter } from './platform';

function bridge(handler: (method: string, params: Record<string, unknown>) => unknown = () => ({ result: true })) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let subscriber: Parameters<NonNullable<BridgeAdapter['subscribe']>>[0] | undefined;
  const adapter: BridgeAdapter = {
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'VKWebAppGetUserInfo') return { id: 42, first_name: 'Анна', last_name: 'Мастер', photo_200: 'https://example.com/avatar.jpg' };
      return handler(method, params);
    },
    supports: () => false,
    subscribe: listener => { subscriber = listener; },
  };
  return { adapter, calls, event: (type: string, data: unknown = {}) => subscriber?.({ detail: { type, data } }) };
}

test('profile authorization and storage use the official VK APIs', async () => {
  let saved = '';
  const mock = bridge((method, params) => {
    if (method === 'VKWebAppStorageSet') { saved = String(params.value); return { result: true }; }
    if (method === 'VKWebAppStorageGet') return { keys: [{ key: 'save', value: saved }] };
    return { result: true, layout_type: 'resize' };
  });
  const platform = new VKPlatform(mock.adapter);
  try {
    await platform.init();
    assert.equal(platform.identity, '42');
    assert.equal(platform.user?.name, 'Анна Мастер');
    assert.equal(platform.cloudAvailable, true);
    assert.equal(await platform.setStorage('save', 'payload'), true);
    assert.equal(await platform.getStorage('save'), 'payload');
    assert.equal(mock.calls[0].method, 'VKWebAppInit');
    assert.equal(platform.bannerHeight, 0, 'resize banners must not reserve height twice');
  } finally { platform.dispose(); }
});

test('cancelled or malformed rewarded ads never report a reward', async () => {
  for (const result of [{ result: false }, {}, { result: 'true' }]) {
    const mock = bridge(method => method === 'VKWebAppShowNativeAds' ? result : { result: true });
    const platform = new VKPlatform(mock.adapter);
    try {
      await platform.init();
      assert.equal(await platform.reward(), false);
      assert.equal(platform.busy, false);
      assert.equal(platform.paused, false);
    } finally { platform.dispose(); }
  }
});

test('VK hide during an ad keeps sound and gameplay paused until restore', async () => {
  let finish!: (result: unknown) => void;
  const mock = bridge(method => method === 'VKWebAppShowNativeAds'
    ? new Promise(resolve => { finish = resolve; }) : { result: true });
  const platform = new VKPlatform(mock.adapter);
  try {
    await platform.init();
    const ad = platform.reward();
    await Promise.resolve();
    assert.equal(platform.paused, true);
    assert.equal(await platform.reward(), false, 'overlapping requests are blocked');
    mock.event('VKWebAppViewHide');
    finish({ result: true });
    assert.equal(await ad, true);
    assert.equal(platform.paused, true);
    mock.event('VKWebAppViewRestore');
    assert.equal(platform.paused, false);
  } finally { platform.dispose(); }
});

test('an explicitly hidden pending banner cannot reappear after its request finishes', async () => {
  let finish!: (result: unknown) => void;
  const mock = bridge(method => method === 'VKWebAppShowBannerAd'
    ? new Promise(resolve => { finish = resolve; }) : { result: true });
  const platform = new VKPlatform(mock.adapter);
  try {
    await platform.init();
    await platform.hideBanner();
    finish({ result: true, layout_type: 'overlay', banner_height: 88 });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(platform.bannerVisible, false);
    assert.equal(platform.bannerHeight, 0);
    assert.equal(mock.calls.filter(call => call.method === 'VKWebAppHideBannerAd').length, 2);
  } finally { platform.dispose(); }
});

test('interstitials wait for three level breaks and a two-minute cooldown', async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  const mock = bridge();
  const platform = new VKPlatform(mock.adapter);
  try {
    await platform.init();
    assert.equal(await platform.interstitial(), false);
    assert.equal(await platform.interstitial(), false);
    now += 120_000;
    assert.equal(await platform.interstitial(), true);
    assert.equal(await platform.interstitial(), false);
    assert.equal(mock.calls.filter(call => call.method === 'VKWebAppShowNativeAds').length, 1);
  } finally { Date.now = realNow; platform.dispose(); }
});
