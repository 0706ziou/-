/* 关卡账号在当前浏览器保存，首次登录自动注册。本模块只验证本机密码；游戏登录成功后由世界客户端用同一凭证连接同源服务器。 */
(() => {
  'use strict';
  const ACCOUNTS_KEY = 'orchard-accounts-v1';
  const LAST_ACCOUNT_KEY = 'orchard-last-account-v1';
  const LEGACY_PROFILE_KEY = 'orchard-save-v1';
  const ITERATIONS = 160000;
  const MAX_ACCOUNTS = 100;
  const LEGACY_ACCOUNT_PATTERN = /^[a-z0-9_]{3,24}$/;
  const NAME_PATTERN = /^[\p{L}\p{N}_]+$/u;
  const ID_PATTERN = /^(?:\p{L}\p{M}*|\p{N}|_)+$/u;
  const SALT_PATTERN = /^[0-9a-f]{32}$/;
  const HASH_PATTERN = /^[0-9a-f]{64}$/;

  class AuthError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'AuthError';
      this.code = code;
    }
  }

  function normalizeAccount(value) {
    return typeof value === 'string' ? value.trim().normalize('NFC').toLowerCase().normalize('NFC') : '';
  }

  function displayName(value) {
    return typeof value === 'string' ? value.trim().normalize('NFC') : '';
  }

  function validNewName(value) {
    return typeof value === 'string' && Array.from(value).length >= 1 && Array.from(value).length <= 7 && NAME_PATTERN.test(value);
  }

  function validStoredAccount(value) {
    if (typeof value !== 'string' || value !== normalizeAccount(value)) return false;
    if (LEGACY_ACCOUNT_PATTERN.test(value)) return true;
    // 大写字母 İ 转小写后增加组合点；存档标识仍对应最多 7 个输入字符。
    const length = Array.from(value).length, bases = Array.from(value.replace(/\p{M}/gu, '')).length;
    return length >= 1 && length <= 14 && bases <= 7 && ID_PATTERN.test(value);
  }

  function validNickname(value) {
    return typeof value === 'string' && value === value.trim() &&
      Array.from(value).length >= 1 && Array.from(value).length <= 12 &&
      !/[\u0000-\u001f\u007f]/.test(value);
  }

  function profileKey(userId) {
    if (!validStoredAccount(userId)) {
      throw new AuthError('INVALID_ACCOUNT', '玩家名称需为 1～7 个汉字、字母、数字或下划线。');
    }
    const base = window.ORCHARD_ONLINE_RESET?.storageKey(LEGACY_PROFILE_KEY) || LEGACY_PROFILE_KEY;
    return `${base}:user:${userId}`;
  }

  function create({ storage, crypto: cryptoProvider } = {}) {
    let busy = false;
    const accountKey = () => window.ORCHARD_ONLINE_RESET?.storageKey(ACCOUNTS_KEY) || ACCOUNTS_KEY;
    const lastAccountKey = () => window.ORCHARD_ONLINE_RESET?.storageKey(LAST_ACCOUNT_KEY) || LAST_ACCOUNT_KEY;

    function read(key) {
      try {
        if (!storage || typeof storage.getItem !== 'function') throw new Error('missing storage');
        const value = storage.getItem(key);
        if (value !== null && typeof value !== 'string') throw new Error('invalid storage result');
        return value;
      } catch (_) {
        throw new AuthError('STORAGE_UNAVAILABLE', '无法读取本机存档。请允许此页面使用浏览器存储后再登录。');
      }
    }

    function write(key, value) {
      try {
        if (!storage || typeof storage.setItem !== 'function') throw new Error('missing storage');
        storage.setItem(key, value);
      } catch (_) {
        throw new AuthError('STORAGE_UNAVAILABLE', '无法保存本机账号。请检查浏览器存储权限或剩余空间后再登录。');
      }
    }

    function restore(key, value) {
      try {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      } catch (_) {
        // 回滚尽力执行；保留原始保存错误，绝不将未提交账号作为已登录用户返回。
      }
    }

    function readRegistry() {
      const raw = read(accountKey());
      if (raw === null) return { version: 1, accounts: [], legacyClaimed: false };
      let data;
      try {
        data = JSON.parse(raw);
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1 ||
            !Array.isArray(data.accounts) || data.accounts.length > MAX_ACCOUNTS ||
            typeof data.legacyClaimed !== 'boolean') throw new Error('invalid registry');
        const names = new Set();
        for (const record of data.accounts) {
          if (!record || typeof record !== 'object' || Array.isArray(record) ||
              !validStoredAccount(record.account) ||
              record.id !== record.account || names.has(record.account) ||
              !validNickname(record.nickname) || typeof record.salt !== 'string' || !SALT_PATTERN.test(record.salt) ||
              typeof record.passwordHash !== 'string' || !HASH_PATTERN.test(record.passwordHash) || !Number.isInteger(record.iterations) ||
              record.iterations < 120000 || record.iterations > 1000000 ||
              !Number.isFinite(record.createdAt) || record.createdAt < 0 ||
              Object.prototype.hasOwnProperty.call(record, 'password')) throw new Error('invalid account');
          names.add(record.account);
        }
      } catch (_) {
        throw new AuthError('ACCOUNTS_CORRUPT', '本机账号记录损坏，登录已停止以保护原存档。请保留浏览器数据并联系开发者。');
      }
      return data;
    }

    function requireCrypto() {
      if (!cryptoProvider || typeof cryptoProvider.getRandomValues !== 'function' ||
          !cryptoProvider.subtle || typeof cryptoProvider.subtle.importKey !== 'function' ||
          typeof cryptoProvider.subtle.deriveBits !== 'function' || typeof TextEncoder !== 'function') {
        throw new AuthError('SECURE_LOGIN_UNAVAILABLE', '当前浏览器不支持安全的本机登录，请使用新版 Chrome、Edge 或 Safari 打开游戏。');
      }
    }

    const toHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    const fromHex = value => new Uint8Array(value.match(/../g).map(pair => parseInt(pair, 16)));

    async function derive(password, salt, iterations) {
      try {
        const key = await cryptoProvider.subtle.importKey(
          'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
        );
        const bits = await cryptoProvider.subtle.deriveBits({
          name: 'PBKDF2', salt: fromHex(salt), iterations, hash: 'SHA-256'
        }, key, 256);
        if (!bits || bits.byteLength !== 32) throw new Error('invalid derived hash');
        return toHex(new Uint8Array(bits));
      } catch (_) {
        throw new AuthError('SECURE_LOGIN_UNAVAILABLE', '本机密码验证未能完成，请使用支持安全存储的新版本浏览器重新打开游戏。');
      }
    }

    function equalHash(a, b) {
      let difference = a.length ^ b.length;
      for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
      return difference === 0;
    }

    const publicUser = record => Object.freeze({ id: record.id, account: record.account, nickname: record.nickname });

    async function login({ account, password } = {}) {
      if (busy) throw new AuthError('LOGIN_BUSY', '正在验证账号，请稍候再试。');
      busy = true;
      try {
        await window.ORCHARD_ONLINE_RESET?.ensure({ force: true });
        const loginEpoch = window.ORCHARD_ONLINE_RESET?.currentEpoch();
        const assertEpoch = () => window.ORCHARD_ONLINE_RESET?.assertCurrent(loginEpoch);
        const enteredName = displayName(account), normalized = normalizeAccount(enteredName);
        const isNewName = validNewName(enteredName);
        const isLegacyInput = typeof account === 'string' && /^[A-Za-z0-9_]{3,24}$/.test(account.trim());
        const isStoredIdentityInput = enteredName === normalized && ID_PATTERN.test(enteredName);
        if ((!isNewName && !isLegacyInput && !isStoredIdentityInput) || !validStoredAccount(normalized)) {
          throw new AuthError('INVALID_ACCOUNT', '玩家名称需为 1～7 个汉字、字母、数字或下划线。');
        }
        if (typeof password !== 'string' || Array.from(password).length < 6 || Array.from(password).length > 64) {
          throw new AuthError('INVALID_PASSWORD', '密码需为 6～64 个字符。');
        }
        requireCrypto();
        const initial = readRegistry();
        const existing = initial.accounts.find(record => record.account === normalized);
        if (existing) {
          const passwordHash = await derive(password, existing.salt, existing.iterations);
          assertEpoch();
          if (!equalHash(passwordHash, existing.passwordHash)) {
            throw new AuthError('WRONG_PASSWORD', '密码不正确，请重新填写。已有账号不会自动重新注册。');
          }
          const latest = readRegistry().accounts.find(record => record.account === normalized);
          if (!latest || latest.salt !== existing.salt || latest.passwordHash !== existing.passwordHash ||
              latest.iterations !== existing.iterations) {
            throw new AuthError('ACCOUNT_CHANGED', '账号记录在验证期间发生变化，请重新登录。');
          }
          write(lastAccountKey(), normalized);
          return Object.freeze({ created: false, user: publicUser(latest), legacyClaimed: false });
        }

        if (!isNewName) {
          throw new AuthError('INVALID_ACCOUNT', '新玩家名称最多 7 个字符；旧版长账号可继续使用原名称和密码登录。');
        }
        if (initial.accounts.length >= MAX_ACCOUNTS) {
          throw new AuthError('ACCOUNT_LIMIT', '此浏览器的本机账号已达上限，请使用已有账号登录。');
        }
        let salt;
        try {
          salt = toHex(cryptoProvider.getRandomValues(new Uint8Array(16)));
        } catch (_) {
          throw new AuthError('SECURE_LOGIN_UNAVAILABLE', '浏览器无法生成安全密码信息，请更新浏览器后重新登录。');
        }
        const passwordHash = await derive(password, salt, ITERATIONS);
        assertEpoch();
        // 哈希异步计算后重新读取，保留期间由另一登录实例新增的账号。
        const registry = readRegistry();
        if (registry.accounts.some(record => record.account === normalized)) {
          throw new AuthError('ACCOUNT_CHANGED', '该账号刚刚完成注册，请使用相同账号和密码重新登录。');
        }
        if (registry.accounts.length >= MAX_ACCOUNTS) {
          throw new AuthError('ACCOUNT_LIMIT', '此浏览器的本机账号已达上限，请使用已有账号登录。');
        }
        const record = { id: normalized, account: normalized, nickname: enteredName,
          salt, passwordHash, iterations: ITERATIONS, createdAt: Date.now() };
        const targetKey = profileKey(record.id);
        const firstAccount = registry.accounts.length === 0 && !registry.legacyClaimed;
        const legacyProfile = firstAccount && !loginEpoch?.startsWith('reset-') ? read(LEGACY_PROFILE_KEY) : null;
        const originalProfile = read(targetKey);
        const originalLast = read(lastAccountKey());
        const claimLegacy = firstAccount && legacyProfile !== null && originalProfile === null;
        let profileWritten = false;
        let lastWritten = false;
        try {
          if (claimLegacy) {
            write(targetKey, legacyProfile);
            profileWritten = true;
          }
          assertEpoch();
          write(lastAccountKey(), normalized);
          lastWritten = true;
          write(accountKey(), JSON.stringify({ version: 1, accounts: [...registry.accounts, record],
            legacyClaimed: registry.legacyClaimed || firstAccount }));
        } catch (error) {
          if (lastWritten) restore(lastAccountKey(), originalLast);
          if (profileWritten) restore(targetKey, originalProfile);
          throw error;
        }
        return Object.freeze({ created: true, user: publicUser(record), legacyClaimed: claimLegacy });
      } finally {
        busy = false;
      }
    }

    function getLastAccount() {
      try {
        const value = read(lastAccountKey());
        return validStoredAccount(value) ? value : '';
      } catch (_) {
        return '';
      }
    }

    return Object.freeze({ login, getLastAccount, profileKey });
  }

  window.ORCHARD_AUTH = Object.freeze({ create, profileKey, AuthError,
    accountsKey: ACCOUNTS_KEY, lastAccountKey: LAST_ACCOUNT_KEY, iterations: ITERATIONS, maxAccounts: MAX_ACCOUNTS });
})();
