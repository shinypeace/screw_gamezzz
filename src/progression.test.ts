import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Progression, sanitizeProgress, encodeProgress, dailyDate, HEART_REGEN_MS, LOGIN_REWARDS, SKINS, BACKGROUNDS } from './progression';
import { type VKPlatform } from './platform';
import { Puzzle, generateLevel } from './puzzle';

const local = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => local.get(key) ?? null,
  setItem: (key: string, value: string) => { local.set(key, value); },
} });
beforeEach(() => local.clear());
const initialTime = Date.parse('2026-10-05T09:00:00Z');
function platform(identity = 'guest', cloud = false, remote = new Map<string, string>()) {
  let watched = false;
  const vk = {
    identity, cloudAvailable: cloud, init: async () => {},
    getStorage: async (key: string) => remote.get(key) ?? null,
    setStorage: async (key: string, value: string) => { remote.set(key, value); return true; },
    reward: async () => watched,
  } as unknown as VKPlatform;
  return { vk, remote, setReward: (value: boolean) => { watched = value; } };
}

test('a cancelled video does not grant coins, lives or consumable hints', async () => {
  const mock = platform();
  const progress = new Progression(mock.vk, () => initialTime);
  try {
    await progress.init();
    assert.equal(progress.useBooster('hint'), true);
    assert.equal(progress.useBooster('hint'), true);
    assert.equal(progress.useBooster('hint'), true);
    assert.equal(progress.useBooster('hint'), false);
    progress.spendHeart();
    assert.equal(await progress.claimAdReward({ coins: 100, heart: 1, booster: 'hint' }), false);
    assert.equal(progress.state.coins, 350);
    assert.equal(progress.state.hearts, 4);
    assert.equal(progress.state.boosters.hint, 0);
    mock.setReward(true);
    assert.equal(await progress.claimAdReward({ booster: 'hint' }), true);
    assert.equal(progress.state.boosters.hint, 1);
    assert.equal(progress.useBooster('hint'), true);
    assert.equal(progress.state.boosters.hint, 0);
    assert.equal(progress.state.stats.adsWatched, 1);
  } finally { progress.dispose(); }
});

test('user-scoped local saves and VK cloud round-trip include a real checkpoint', async () => {
  const remote = new Map<string, string>();
  const mock = platform('42', true, remote);
  const progress = new Progression(mock.vk, () => initialTime);
  let loaded: Progression | undefined;
  let other: Progression | undefined;
  try {
    await progress.init();
    progress.completeLevel(1, 3, { screws: 8, seconds: 25 });
    progress.rewardCoins(99);
    const puzzle = new Puzzle(generateLevel(2));
    assert.ok(puzzle.move(puzzle.level.witness[0].from, puzzle.level.witness[0].to));
    puzzle.addExtraHole();
    assert.equal(progress.saveCheckpoint({ level: 2, daily: false, date: dailyDate(initialTime), snapshot: puzzle.snapshot(), seconds: 11, boosterCount: 1 }), true);
    await progress.flush();
    assert.ok(local.has('screw_atelier_v1_42'));
    const payload = remote.get('screw_atelier_v1')!;
    assert.ok(new TextEncoder().encode(payload).length < 4_000);
    assert.equal(typeof JSON.parse(payload).checkpoint.snapshot.screws, 'string');
    local.clear();
    loaded = new Progression(mock.vk, () => initialTime);
    await loaded.init();
    assert.equal(loaded.state.coins, 539);
    assert.equal(loaded.state.level, 2);
    assert.deepEqual(loaded.state.checkpoint?.snapshot, puzzle.snapshot());
    assert.equal(new Puzzle(generateLevel(2), loaded.state.checkpoint!.snapshot).moves, 1);
    other = new Progression(platform('43').vk, () => initialTime);
    await other.init();
    assert.equal(other.state.coins, 350, 'another account must never read account 42 backup');
    assert.equal(other.state.checkpoint, null);
  } finally { progress.dispose(); loaded?.dispose(); other?.dispose(); }
});

test('seven-day login chain pays each date once and resets after a skipped day', async () => {
  let now = initialTime;
  const progress = new Progression(platform().vk, () => now);
  try {
    await progress.init();
    for (let day = 1; day <= 7; day++) {
      const reward = progress.claimLogin();
      assert.equal(reward?.day, day);
      assert.equal(reward?.coins, LOGIN_REWARDS[day - 1].coins);
      assert.equal(progress.claimLogin(), null);
      now += 86_400_000;
    }
    assert.equal(progress.state.coins, 350 + LOGIN_REWARDS.reduce((sum, reward) => sum + reward.coins, 0));
    assert.equal(progress.state.stats.loginDays, 7);
    assert.equal(progress.nextLoginDay, 1, 'day eight starts a new seven-day chain');
    now += 86_400_000;
    assert.equal(progress.claimLogin()?.day, 1);
  } finally { progress.dispose(); }
});

test('daily tasks and daily puzzle cannot be claimed twice, and rotate at Moscow midnight', async () => {
  let now = initialTime;
  const progress = new Progression(platform().vk, () => now);
  try {
    await progress.init();
    for (let level = 1; level <= 4; level++) progress.completeLevel(level, 3, { screws: 20, boostersUsed: 0 });
    assert.equal(progress.completeLevel(180, 3, { daily: true, screws: 20 })?.coins, 150);
    assert.equal(progress.completeLevel(180, 3, { daily: true, screws: 20 })?.coins, 0);
    for (const task of progress.tasks()) {
      assert.equal(task.complete, true);
      assert.equal(progress.claimTask(task.id), task.reward);
      assert.equal(progress.claimTask(task.id), 0);
    }
    assert.equal(progress.claimTask('unknown'), 0);
    now = Date.parse('2026-10-05T21:00:00Z');
    progress.tick();
    assert.equal(progress.state.daily.date, '2026-10-06');
    assert.equal(progress.state.daily.completed, false);
    assert.ok(progress.tasks().every(task => task.progress === 0 && !task.claimed));
  } finally { progress.dispose(); }
});

test('replaying pays only new star improvement and cannot farm level rewards', async () => {
  const progress = new Progression(platform().vk, () => initialTime);
  try {
    await progress.init();
    assert.equal(progress.completeLevel(2, 3), null, 'locked levels cannot advance progression');
    assert.equal(progress.completeLevel(1, 2)?.coins, 75);
    assert.equal(progress.completeLevel(1, 2)?.coins, 0);
    assert.equal(progress.completeLevel(1, 3)?.coins, 15);
    assert.equal(progress.completeLevel(1, 3)?.coins, 0);
    assert.equal(progress.state.coins, 440);
    assert.equal(progress.state.level, 2);
  } finally { progress.dispose(); }
});

test('hearts recover every thirty minutes across closures and wins can refund the entry', async () => {
  let now = initialTime;
  const progress = new Progression(platform().vk, () => now);
  try {
    await progress.init();
    progress.spendHeart();
    now += HEART_REGEN_MS - 1;
    progress.tick();
    assert.equal(progress.state.hearts, 4);
    assert.equal(progress.heartCountdownMs, 1);
    now++;
    progress.tick();
    assert.equal(progress.state.hearts, 5);
    progress.spendHeart(); progress.spendHeart();
    now += HEART_REGEN_MS * 2 + 60_000;
    progress.tick();
    assert.equal(progress.state.hearts, 5);
    progress.spendHeart(); progress.refillHearts(1);
    assert.equal(progress.state.hearts, 5);
  } finally { progress.dispose(); }
});

test('all cosmetics can be bought at level one with enough coins and the collection costs 21000', async () => {
  const progress = new Progression(platform().vk, () => initialTime);
  try {
    await progress.init();
    assert.equal(SKINS.reduce((sum, item) => sum + item.price, 0), 10_700);
    assert.equal(BACKGROUNDS.reduce((sum, item) => sum + item.price, 0), 10_300);
    assert.equal(progress.canBuyCosmetic('skins', 'chrome'), false, 'the only purchase constraint is the coin balance');
    assert.equal(progress.buyCosmetic('skin', 'chrome'), false);
    progress.rewardCoins(10_000); progress.rewardCoins(10_000); progress.rewardCoins(10_000);
    assert.equal(progress.state.level, 1);
    assert.equal(progress.canBuyCosmetic('skins', 'chrome'), true);
    assert.equal(progress.canBuyCosmetic('backgrounds', 'arctic'), true);
    const before = progress.state.coins;
    for (const item of SKINS.filter(item => item.price)) assert.equal(progress.buyCosmetic('skins', item.id), true);
    for (const item of BACKGROUNDS.filter(item => item.price)) assert.equal(progress.buyCosmetic('backgrounds', item.id), true);
    assert.equal(before - progress.state.coins, 21_000);
    assert.equal(progress.buyCosmetic('skins', 'chrome'), false);
    assert.equal(progress.selectCosmetic('skins', 'chrome'), true);
  } finally { progress.dispose(); }
});

test('a normal 300-level campaign funds all cosmetics after a 4000-coin booster budget', async () => {
  const progress = new Progression(platform().vk, () => initialTime);
  try {
    await progress.init();
    for (let level = 1; level <= 300; level++) {
      progress.completeLevel(level, level % 2 ? 2 : 3);
      if (level % 12 === 0) assert.equal(progress.buyBooster('remove'), true);
    }
    assert.equal(progress.state.coins, 21_100, '2.5 stars average, 350 starting coins, 25 remove boosts');
    for (const item of SKINS.filter(item => item.price)) assert.equal(progress.buyCosmetic('skins', item.id), true);
    for (const item of BACKGROUNDS.filter(item => item.price)) assert.equal(progress.buyCosmetic('backgrounds', item.id), true);
    assert.equal(progress.state.coins, 100);
  } finally { progress.dispose(); }
});

test('sanitization rejects invalid economy and checkpoint identity; all levels fit cloud storage', () => {
  const state = sanitizeProgress({ version: 1, coins: -30, hearts: 9, boosters: { hint: -4 }, level: 601, skin: 'hack', ownedSkins: ['hack'] }, initialTime);
  assert.equal(state.coins, 0);
  assert.equal(state.hearts, 5);
  assert.equal(state.boosters.hint, 0);
  assert.equal(state.level, 1);
  assert.equal(state.skin, 'classic');
  const puzzle = new Puzzle(generateLevel(1));
  const checkpoint = { level: 1, daily: false, date: dailyDate(initialTime), snapshot: puzzle.snapshot(), seconds: 2, boosterCount: 0 };
  const resumed = sanitizeProgress({ ...state, checkpoint }, initialTime);
  assert.deepEqual(resumed.checkpoint?.snapshot, puzzle.snapshot(), 'saved seed must reconstruct the same geometry');
  const obsolete={...checkpoint,snapshot:{...puzzle.snapshot(),seed:123456}};
  assert.equal(sanitizeProgress({...state,checkpoint:obsolete},initialTime).checkpoint,null,'An obsolete campaign seed cannot select a random daily board');
  const date=dailyDate(initialTime),dailyPuzzle=new Puzzle(generateLevel(1,Number(date.replaceAll('-',''))));
  const dailyCheckpoint={...checkpoint,daily:true,date,snapshot:dailyPuzzle.snapshot()};
  assert.deepEqual(sanitizeProgress({...state,checkpoint:dailyCheckpoint},initialTime).checkpoint?.snapshot,dailyPuzzle.snapshot(),'The current daily seed resumes exactly');
  assert.equal(sanitizeProgress({...state,checkpoint:{...dailyCheckpoint,snapshot:{...dailyPuzzle.snapshot(),seed:123456}}},initialTime).checkpoint,null,'An obsolete daily seed is rejected');
  assert.equal(sanitizeProgress({ ...state, checkpoint: { ...checkpoint, level: 2 } }, initialTime).checkpoint, null);
  for (let level = 1; level <= 600; level++) resumed.stars[String(level)] = 3;
  resumed.level = 601;
  resumed.ownedSkins = SKINS.map(item => item.id);
  resumed.ownedBackgrounds = BACKGROUNDS.map(item => item.id);
  const encoded = encodeProgress(resumed, true);
  assert.ok(new TextEncoder().encode(encoded).length < 4_000);
  assert.equal(sanitizeProgress(JSON.parse(encoded), initialTime).stars['600'], 3);
});

test('physical VK checkpoints preserve moving bodies and bindings within the cloud value limit',()=>{
  const state=sanitizeProgress({stars:'3'.repeat(600),coins:5000,ownedSkins:SKINS.map(item=>item.id),ownedBackgrounds:BACKGROUNDS.map(item=>item.id)},initialTime);
  for(let level=1;level<=600;level++){
    const puzzle=new Puzzle(generateLevel(level),undefined,{physical:true});
    const from=puzzle.holes.find(h=>puzzle.canSelect(h.id)&&puzzle.holes.some(to=>puzzle.canMove(h.id,to.id)))!;
    const to=puzzle.holes.find(to=>puzzle.canMove(from.id,to.id))!;assert.ok(puzzle.move(from.id,to.id));
    puzzle.syncPhysics(puzzle.livePlanks.map(p=>({id:p.id,x:p.x,y:p.y,angle:p.angle,vx:.1234,vy:-.2345,angularVelocity:.3456})));
    state.checkpoint={level,daily:false,date:dailyDate(initialTime),snapshot:puzzle.snapshot(),seconds:12,boosterCount:0};
    const encoded=encodeProgress(state,true),wire=JSON.parse(encoded);
    assert.ok(new TextEncoder().encode(encoded).length<4000,`Physical level${level} fits VK storage`);
    assert.ok(wire.checkpoint,`Level${level} must not silently discard the saved attempt`);
    const restored=sanitizeProgress(wire,initialTime);
    assert.deepEqual(restored.checkpoint?.snapshot,puzzle.snapshot(),`Physical level${level} cloud roundtrip`);
  }
});
