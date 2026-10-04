'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const context = { window: {}, TextEncoder, Uint8Array, Date };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'auth-data.js'), 'utf8'), context, { filename: 'auth-data.js' });
const api = context.window.ORCHARD_AUTH;
const ACCOUNT_KEY = 'orchard-accounts-v1';
const LAST_KEY = 'orchard-last-account-v1';
const LEGACY_KEY = 'orchard-save-v1';
let passed = 0;

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const writes = [];
  return { data, writes, getItem: key => data.has(key) ? data.get(key) : null,
    setItem(key, value) { writes.push([key, value]); data.set(key, String(value)); },
    removeItem: key => data.delete(key) };
}

async function check(name, run) {
  await run();
  passed++;
  console.log(`PASS ${name}`);
}

async function rejectsCode(run, code) {
  await assert.rejects(run, error => error.name === 'AuthError' && error.code === code && /[\u4e00-\u9fff]/.test(error.message));
}

(async () => {
  await check('Frozen API and isolated normalized profile keys', async () => {
    assert.ok(Object.isFrozen(api));
    assert.ok(Object.isFrozen(api.create({ storage: memoryStorage(), crypto: webcrypto })));
    assert.equal(api.profileKey('apple_1'), 'orchard-save-v1:user:apple_1');
    assert.notEqual(api.profileKey('apple_1'), api.profileKey('apple_2'));
    assert.throws(() => api.profileKey('Apple'), error => error.code === 'INVALID_ACCOUNT');
    assert.throws(() => api.profileKey('../profile'), error => error.code === 'INVALID_ACCOUNT');
  });

  await check('First login creates salted PBKDF2 account and never stores plain password', async () => {
    const storage = memoryStorage();
    const auth = api.create({ storage, crypto: webcrypto });
    const result = await auth.login({ account: '  Apple_1  ', password: '六位密码🌱abc', nickname: '  果园主人  ' });
    assert.equal(result.created, true);
    assert.equal(result.legacyClaimed, false);
    assert.equal(result.user.id, 'apple_1');
    assert.equal(result.user.nickname, 'Apple_1');
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.user));
    assert.deepEqual(Object.keys(result.user).sort(), ['account', 'id', 'nickname']);
    assert.equal(auth.getLastAccount(), 'apple_1');
    const registry = JSON.parse(storage.getItem(ACCOUNT_KEY));
    const record = registry.accounts[0];
    assert.match(record.salt, /^[0-9a-f]{32}$/);
    assert.match(record.passwordHash, /^[0-9a-f]{64}$/);
    assert.ok(record.iterations >= 120000);
    assert.equal(record.iterations, 160000);
    assert.equal(registry.legacyClaimed, true);
    assert.ok(Number.isFinite(record.createdAt));
    for (const [, value] of storage.writes) assert.equal(value.includes('六位密码🌱abc'), false);
  });

  await check('Existing account validates real hash and ignores new nickname', async () => {
    const storage = memoryStorage();
    const auth = api.create({ storage, crypto: webcrypto });
    await auth.login({ account: 'orange', password: 'correct-pass', nickname: '橙橙' });
    const registryBefore = storage.getItem(ACCOUNT_KEY);
    const result = await auth.login({ account: ' ORANGE ', password: 'correct-pass', nickname: '换个名字' });
    assert.equal(result.created, false);
    assert.equal(result.user.nickname, 'orange');
    assert.equal(storage.getItem(ACCOUNT_KEY), registryBefore);
    await rejectsCode(() => auth.login({ account: 'orange', password: 'wrong-password' }), 'WRONG_PASSWORD');
    assert.equal(storage.getItem(ACCOUNT_KEY), registryBefore);
    assert.equal(JSON.parse(registryBefore).accounts.length, 1);
    const next = await api.create({ storage, crypto: webcrypto }).login({ account: 'orange', password: 'correct-pass' });
    assert.equal(next.user.nickname, 'orange');
  });

  await check('First account inherits legacy progress exactly once and preserves original', async () => {
    const legacy = '{ "seeds": 123, "hero": "blueberry", "cleared": [1,2] }';
    const storage = memoryStorage({ [LEGACY_KEY]: legacy });
    const auth = api.create({ storage, crypto: webcrypto });
    const first = await auth.login({ account: 'first', password: 'password1', nickname: '第一位' });
    assert.equal(first.legacyClaimed, true);
    assert.equal(storage.getItem(auth.profileKey(first.user.id)), legacy);
    assert.equal(storage.getItem(LEGACY_KEY), legacy);
    const second = await auth.login({ account: 'second', password: 'password2', nickname: '第二位' });
    assert.equal(second.legacyClaimed, false);
    assert.equal(storage.getItem(auth.profileKey(second.user.id)), null);
    storage.setItem(auth.profileKey(first.user.id), '{"seeds":200}');
    await auth.login({ account: 'first', password: 'password1' });
    assert.equal(storage.getItem(auth.profileKey(first.user.id)), '{"seeds":200}');
    assert.equal(storage.getItem(auth.profileKey(second.user.id)), null);
    assert.equal(storage.getItem(LEGACY_KEY), legacy);
  });

  await check('No legacy at first registration cannot grant a later account another save', async () => {
    const storage = memoryStorage();
    const auth = api.create({ storage, crypto: webcrypto });
    await auth.login({ account: 'first', password: 'password1', nickname: '第一位' });
    storage.setItem(LEGACY_KEY, '{"seeds":999}');
    const second = await auth.login({ account: 'second', password: 'password2', nickname: '第二位' });
    assert.equal(second.legacyClaimed, false);
    assert.equal(storage.getItem(auth.profileKey('second')), null);
  });

  await check('Existing destination progress survives first registration', async () => {
    const storage = memoryStorage({ [LEGACY_KEY]: '{"seeds":90}', 'orchard-save-v1:user:first': '{"seeds":10}' });
    const auth = api.create({ storage, crypto: webcrypto });
    const result = await auth.login({ account: 'first', password: 'password1', nickname: '果子' });
    assert.equal(result.legacyClaimed, false);
    assert.equal(storage.getItem(auth.profileKey('first')), '{"seeds":10}');
    assert.equal(storage.getItem(LEGACY_KEY), '{"seeds":90}');
  });

  await check('Registration rollback removes only new target on registry commit failure', async () => {
    const storage = memoryStorage({ [LEGACY_KEY]: '{"seeds":99}', [LAST_KEY]: 'older' });
    const set = storage.setItem;
    storage.setItem = (key, value) => { if (key === ACCOUNT_KEY) throw new Error('quota'); set(key, value); };
    const auth = api.create({ storage, crypto: webcrypto });
    await rejectsCode(() => auth.login({ account: 'newuser', password: 'password1', nickname: '新人' }), 'STORAGE_UNAVAILABLE');
    assert.equal(storage.getItem(auth.profileKey('newuser')), null);
    assert.equal(storage.getItem(ACCOUNT_KEY), null);
    assert.equal(storage.getItem(LAST_KEY), 'older');
    assert.equal(storage.getItem(LEGACY_KEY), '{"seeds":99}');
  });

  await check('Registration rollback also covers username hint failure', async () => {
    const storage = memoryStorage({ [LEGACY_KEY]: '{"seeds":99}' });
    const set = storage.setItem;
    storage.setItem = (key, value) => { if (key === LAST_KEY) throw new Error('quota'); set(key, value); };
    const auth = api.create({ storage, crypto: webcrypto });
    await rejectsCode(() => auth.login({ account: 'newuser', password: 'password1', nickname: '新人' }), 'STORAGE_UNAVAILABLE');
    assert.equal(storage.getItem(auth.profileKey('newuser')), null);
    assert.equal(storage.getItem(ACCOUNT_KEY), null);
    assert.equal(storage.getItem(LEGACY_KEY), '{"seeds":99}');
  });

  await check('Corrupt registry is rejected without overwriting original', async () => {
    for (const raw of ['{bad-json', 'null', '[]', '{"version":1,"accounts":[],"legacyClaimed":"false"}',
      '{"version":1,"accounts":[{}],"legacyClaimed":false}']) {
      const storage = memoryStorage({ [ACCOUNT_KEY]: raw });
      const auth = api.create({ storage, crypto: webcrypto });
      await rejectsCode(() => auth.login({ account: 'apple', password: 'password', nickname: '苹果' }), 'ACCOUNTS_CORRUPT');
      assert.equal(storage.getItem(ACCOUNT_KEY), raw);
      assert.equal(storage.writes.length, 0);
    }
  });

  await check('Blocked or missing storage and crypto never yield guest login', async () => {
    const blocked = { getItem() { throw new Error('blocked'); } };
    const auth = api.create({ storage: blocked, crypto: webcrypto });
    assert.equal(auth.getLastAccount(), '');
    await rejectsCode(() => auth.login({ account: 'apple', password: 'password', nickname: '苹果' }), 'STORAGE_UNAVAILABLE');
    await rejectsCode(() => api.create({ crypto: webcrypto }).login({ account: 'apple', password: 'password', nickname: '苹果' }), 'STORAGE_UNAVAILABLE');
    await rejectsCode(() => api.create({ storage: memoryStorage() }).login({ account: 'apple', password: 'password', nickname: '苹果' }), 'SECURE_LOGIN_UNAVAILABLE');
  });

  await check('Input validation prevents unusable player names and passwords', async () => {
    const storage = memoryStorage();
    const auth = api.create({ storage, crypto: webcrypto });
    for (const account of ['', 'a'.repeat(8), 'a'.repeat(25), '果'.repeat(8), '../abc', 'a b', '<script>', '苹果🍎', '果\n子']) {
      await rejectsCode(() => auth.login({ account, password: 'password', nickname: '苹果' }), 'INVALID_ACCOUNT');
    }
    for (const password of ['', '12345', 'x'.repeat(65), 123456]) {
      await rejectsCode(() => auth.login({ account: 'apple', password, nickname: '苹果' }), 'INVALID_PASSWORD');
    }
    assert.equal(storage.writes.length, 0);
  });

  await check('One input supplies both login identity and displayed nickname', async () => {
    const storage = memoryStorage();
    const auth = api.create({ storage, crypto: webcrypto });
    const one = await auth.login({ account: ' 果 ', password: 'password' });
    assert.equal(one.created, true); assert.equal(one.user.account, '果'); assert.equal(one.user.nickname, '果');
    assert.equal(auth.profileKey(one.user.id), 'orchard-save-v1:user:果');
    assert.equal(auth.getLastAccount(), '果');
    const seven = await auth.login({ account: '  果园小小守护者  ', password: 'password', nickname: '应忽略这个旧参数' });
    assert.equal(seven.user.account, '果园小小守护者');
    assert.equal(seven.user.nickname, '果园小小守护者');
    await rejectsCode(() => auth.login({ account: '果园小小守护者呀', password: 'password' }), 'INVALID_ACCOUNT');
    const number = await auth.login({ account: '1', password: 'password' });
    assert.equal(number.user.nickname, '1');
    const underscore = await auth.login({ account: '_', password: 'password' });
    assert.equal(underscore.user.nickname, '_');
    assert.equal(JSON.parse(storage.getItem(ACCOUNT_KEY)).accounts.length, 4);
  });

  await check('Unicode code points, NFC and case normalization keep one account', async () => {
    const storage = memoryStorage();
    const auth = api.create({ storage, crypto: webcrypto });
    const first = await auth.login({ account: '  E\u0301果ABC  ', password: 'password' });
    assert.equal(first.user.account, 'é果abc');
    assert.equal(first.user.nickname, 'É果ABC');
    const next = await auth.login({ account: 'é果abc', password: 'password', nickname: '不能改名' });
    assert.equal(next.created, false); assert.equal(next.user.nickname, 'É果ABC');
    assert.equal(JSON.parse(storage.getItem(ACCOUNT_KEY)).accounts.length, 1);
    const supplementary = await auth.login({ account: '𠀀'.repeat(7), password: 'password' });
    assert.equal(Array.from(supplementary.user.nickname).length, 7);
    assert.equal(supplementary.user.nickname.length, 14);
    await rejectsCode(() => auth.login({ account: '𠀀'.repeat(8), password: 'password' }), 'INVALID_ACCOUNT');
    const expandedLowercase = await auth.login({ account: 'İ'.repeat(7), password: 'password' });
    assert.equal(expandedLowercase.user.account, 'i\u0307'.repeat(7));
    assert.equal(auth.getLastAccount(), 'i\u0307'.repeat(7));
    assert.equal(auth.profileKey(expandedLowercase.user.id), 'orchard-save-v1:user:' + 'i\u0307'.repeat(7));
    const existingExpanded = await auth.login({ account: 'İ'.repeat(7), password: 'password' });
    assert.equal(existingExpanded.created, false);
    const fromHint = await auth.login({ account: auth.getLastAccount(), password: 'password' });
    assert.equal(fromHint.created, false);
  });

  await check('Legacy long ASCII accounts and nicknames retain passwords and original profile keys', async () => {
    const storage = memoryStorage();
    const auth = api.create({ storage, crypto: webcrypto });
    await auth.login({ account: 'oldseed', password: 'old-password' });
    const registry = JSON.parse(storage.getItem(ACCOUNT_KEY));
    const legacy = { ...registry.accounts[0], id: 'legacy_user_name_2026', account: 'legacy_user_name_2026', nickname: '旧版守护者昵称' };
    storage.setItem(ACCOUNT_KEY, JSON.stringify({ ...registry, accounts: [legacy] }));
    const key = 'orchard-save-v1:user:legacy_user_name_2026';
    storage.setItem(key, '{"seeds":256}');
    storage.setItem(LAST_KEY, legacy.account);
    const originalRegistry = storage.getItem(ACCOUNT_KEY);
    assert.equal(auth.getLastAccount(), legacy.account);
    assert.equal(auth.profileKey(legacy.id), key);
    const result = await auth.login({ account: '  LEGACY_USER_NAME_2026  ', password: 'old-password', nickname: '不能改旧昵称' });
    assert.equal(result.created, false); assert.equal(result.user.nickname, legacy.nickname);
    assert.equal(result.user.account, legacy.account);
    assert.equal(storage.getItem(ACCOUNT_KEY), originalRegistry);
    assert.equal(storage.getItem(key), '{"seeds":256}');
    await rejectsCode(() => auth.login({ account: legacy.account, password: 'wrong-password' }), 'WRONG_PASSWORD');
    await rejectsCode(() => auth.login({ account: 'unknown_long_account', password: 'password' }), 'INVALID_ACCOUNT');
    assert.equal(storage.getItem(ACCOUNT_KEY), originalRegistry);
  });

  await check('Concurrent login on an instance is rejected and later login recovers', async () => {
    const storage = memoryStorage();
    const auth = api.create({ storage, crypto: webcrypto });
    const first = auth.login({ account: 'apple', password: 'password', nickname: '苹果' });
    await rejectsCode(() => auth.login({ account: 'pear', password: 'password', nickname: '梨' }), 'LOGIN_BUSY');
    await first;
    const existing = await auth.login({ account: 'apple', password: 'password' });
    assert.equal(existing.created, false);
    assert.equal(JSON.parse(storage.getItem(ACCOUNT_KEY)).accounts.length, 1);
  });

  await check('Concurrent independent registrations preserve both accounts and claim legacy once', async () => {
    const storage = memoryStorage({ [LEGACY_KEY]: '{"seeds":44}' });
    const a = api.create({ storage, crypto: webcrypto });
    const b = api.create({ storage, crypto: webcrypto });
    const results = await Promise.all([
      a.login({ account: 'apple', password: 'password1', nickname: '苹果' }),
      b.login({ account: 'pear', password: 'password2', nickname: '梨' })
    ]);
    assert.equal(JSON.parse(storage.getItem(ACCOUNT_KEY)).accounts.length, 2);
    assert.equal(results.filter(result => result.legacyClaimed).length, 1);
    assert.equal(results.filter(result => storage.getItem(a.profileKey(result.user.id)) !== null).length, 1);
    assert.equal(storage.getItem(LEGACY_KEY), '{"seeds":44}');
  });

  await check('Concurrent same-account registrations never overwrite an account or password', async () => {
    const storage = memoryStorage();
    const a = api.create({ storage, crypto: webcrypto });
    const b = api.create({ storage, crypto: webcrypto });
    const results = await Promise.allSettled([
      a.login({ account: 'apple', password: 'password1', nickname: '苹果1' }),
      b.login({ account: 'APPLE', password: 'password2', nickname: '苹果2' })
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'ACCOUNT_CHANGED').length, 1);
    assert.equal(JSON.parse(storage.getItem(ACCOUNT_KEY)).accounts.length, 1);
    const winner = results[0].status === 'fulfilled' ? 1 : 2;
    await a.login({ account: 'apple', password: `password${winner}` });
    await rejectsCode(() => a.login({ account: 'apple', password: `password${winner === 1 ? 2 : 1}` }), 'WRONG_PASSWORD');
  });

  await check('Record count and duplicate corruption are bounded', async () => {
    const seed = memoryStorage();
    await api.create({ storage: seed, crypto: webcrypto }).login({ account: 'seed', password: 'password', nickname: '种子' });
    const template = JSON.parse(seed.getItem(ACCOUNT_KEY)).accounts[0];
    const records = Array.from({ length: 100 }, (_, index) => ({ ...template, id: `user${index}`, account: `user${index}` }));
    const storage = memoryStorage({ [ACCOUNT_KEY]: JSON.stringify({ version: 1, accounts: records, legacyClaimed: true }) });
    await rejectsCode(() => api.create({ storage, crypto: webcrypto }).login({ account: 'newuser', password: 'password', nickname: '新人' }), 'ACCOUNT_LIMIT');
    const tooMany = JSON.stringify({ version: 1, accounts: [...records, template], legacyClaimed: true });
    storage.setItem(ACCOUNT_KEY, tooMany);
    await rejectsCode(() => api.create({ storage, crypto: webcrypto }).login({ account: 'newuser', password: 'password', nickname: '新人' }), 'ACCOUNTS_CORRUPT');
    const duplicates = JSON.stringify({ version: 1, accounts: [template, template], legacyClaimed: true });
    storage.setItem(ACCOUNT_KEY, duplicates);
    await rejectsCode(() => api.create({ storage, crypto: webcrypto }).login({ account: 'newuser', password: 'password', nickname: '新人' }), 'ACCOUNTS_CORRUPT');
    assert.equal(storage.getItem(ACCOUNT_KEY), duplicates);
  });

  console.log(`\n${passed} local account checks passed.`);
})().catch(error => {
  console.error(error.name, error.code || '', error.message);
  process.exitCode = 1;
});
