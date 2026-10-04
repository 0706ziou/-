(() => {
  'use strict';
  const canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay'), arena = document.getElementById('arena');
  const W = 960, H = 680, WORLD_W = Math.round(W * Math.sqrt(50)), WORLD_H = Math.round(H * Math.sqrt(50));
  const stages = window.ORCHARD_STAGES;
  const experience = window.ORCHARD_EXPERIENCE;
  const rescueDefs = window.ORCHARD_RESCUES, bossDefs = window.ORCHARD_BOSSES;
  const relicDefs = window.ORCHARD_RELICS;
  const relicPoints = window.ORCHARD_RELIC_POINTS;
  const relicEffects = window.ORCHARD_RELIC_EFFECTS, builds = window.ORCHARD_BUILDS;
  const legacyRelics = new Set(['lightning', 'orbit', 'dash', 'frost', 'shield', 'bees']);
  const growth = window.ORCHARD_GROWTH, world = window.ORCHARD_WORLD, art = window.ORCHARD_ART;
  const mapCatalog = window.ORCHARD_MAPS, mapRenderer = window.ORCHARD_MAP_RENDER;
  const mapCache = new Map();
  let mapLayout, obstacles, navigator;
  function setMap(id) {
    if (!mapCache.has(id)) mapCache.set(id, mapCatalog.build(id, WORLD_W, WORLD_H, relicPoints));
    const next = mapCache.get(id);
    if (mapLayout !== next) {
      mapLayout = next; obstacles = next.obstacles;
      navigator = window.ORCHARD_NAV.create(mapLayout, world);
    }
  }
  setMap(1);
  const atlas = typeof Image === 'function' ? new Image() : null;
  if (atlas) atlas.src = art.atlas;
  const heroImages = {};
  for (const [id, path] of Object.entries(art.heroImages || {})) {
    if (typeof Image === 'function') { heroImages[id] = new Image(); heroImages[id].src = path; }
  }
  const combat = Object.freeze({ standDelay: .6, standDamage: 1.35, standRate: 1.35, bossRecovery: 12, leechPerSecond: .03, killHealPerSecond: .015 });
  const gearGrowth = Object.freeze({ damage: .06, rate: .02, hp: 8, defense: .5, speed: 3, pickup: 6 });
  const SAVE_KEY = 'orchard-save-v1';
  let currentSaveKey = SAVE_KEY, currentAccount = null, loginBusy = false, loginAttempt = 0, sessionGreeting = '';
  let authService = null;
  try { authService = window.ORCHARD_AUTH.create({ storage: window.localStorage, crypto: window.crypto }); } catch {}
  const keys = new Set(), camera = { x: 0, y: 0 };
  let state = 'cover', player, enemies = [], bullets = [], gems = [], particles = [];
  let elapsed = 0, kills = 0, shotClock = 0, still = 0, lastTime = 0, choices = [], shake = 0;
  let pointer = null, audioCtx = null, selectedStage = 1, activeStage = stages[0], runRewarded = false;
  let storageAvailable = true;
  let previewStage = 1, helpReturnState = 'playing', helpTab = 'conversation', tutorialStep = 0, tutorialIsFirstRun = false;
  let cinematicTime = 0, bossIndex = 0, bossKills = 0, nonBossKills = 0;
  let nextBossAllowedAt = 0;
  let bossArrivalUntil = 0;
  let victoryRewardHTML = '';
  let runMode = 'stage', stageVictoryReady = false, endlessEntered = false;
  let stageXP = experience.create(stages[0]);
  let selectedGearSlot = 'weapon', selectedSprite = 0;
  let endlessWave = 0, waveClock = 0, endlessCreditedSeeds = 0, endlessCreditedCores = 0;
  let relicDrops = [], skillEffects = [], selectedRelic = relicDefs[0].id, mapReturnState = 'lobby';
  let runRelicDefs = [], challengeStarted = false, noticeQueue = [], currentNotice = null, noticeClock = 0;
  let relicHudSignature = '', buildHudSignature = '';
  let heroTab = 'heroes', heroSkillView = 'active', inspectedHero = 'orange', heroEffects = [];
  const ENDLESS_INTERVAL = 8, ENDLESS_ENEMY_CAP = 240;
  const endlessTuning = Object.freeze({ openingBonus: 16, perWave: 5, batchCap: 90, hp: .12, hpCurve: .002, damage: .045, speed: .012, speedCap: 1.3, xpEvery: 4 });
  const XP_NODE_CAP = 400;
  const runStates = ['playing', 'paused', 'upgrade', 'rescue'];
  const gearDefs = {
    weapon_seed: { slot: 'weapon', name: '橙籽弹弓', icon: '🌱', desc: '22 伤害 · 每秒 3 轮，均衡起步', damage: 22, rate: 3, shots: 1, color: '#fff1b4' },
    weapon_pea: { slot: 'weapon', name: '豌豆速射器', icon: '🫛', desc: '16 伤害 · 每秒 4.3 轮，快速清理飞虫', damage: 16, rate: 4.3, shots: 1, color: '#bbeb88' },
    weapon_cherry: { slot: 'weapon', name: '樱桃双生弩', icon: '🍒', desc: '18 伤害 · 每秒 2.05 轮 · 双籽覆盖', damage: 18, rate: 2.05, shots: 2, color: '#f99a95' },
    weapon_pumpkin: { slot: 'weapon', name: '南瓜重炮', icon: '🎃', desc: '27 伤害 · 每秒 1.05 轮 · 三籽重击', damage: 27, rate: 1.05, shots: 3, color: '#ffd37a' },
    armor_leaf: { slot: 'armor', name: '嫩叶披风', icon: '🍃', desc: '轻巧自在，生命 110', hp: 110, defense: 0, speedMult: 1 },
    armor_bark: { slot: 'armor', name: '树皮护甲', icon: '🪵', desc: '生命 140，减伤 2，移速 -3%', hp: 140, defense: 2, speedMult: .97 },
    armor_rind: { slot: 'armor', name: '金橙果壳', icon: '🍊', desc: '生命 170，减伤 4，移速 -5%', hp: 170, defense: 4, speedMult: .95 },
    charm_sprout: { slot: 'charm', name: '萌芽护符', icon: '🌿', desc: '初始移速 205，拾取范围 85', speed: 205, pickup: 85, xpMult: 1 },
    charm_bloom: { slot: 'charm', name: '春花吊坠', icon: '🌸', desc: '移速 215，拾取范围 115', speed: 215, pickup: 115, xpMult: 1 },
    charm_harvest: { slot: 'charm', name: '丰收徽记', icon: '🌻', desc: '移速 220，拾取范围 140，经验提前释放 +15%', speed: 220, pickup: 140, xpMult: 1.15 }
  };
  function freshProfile() {
    const base = { version: 1, unlockedStage: 1, clearedStages: [], seeds: 0, cores: 0, tutorialSeen: false,
      rescuedSprites: [], spriteLevels: {}, orchard: { level: 0 },
      inventory: { weapon_seed: { level: 0 }, armor_leaf: { level: 0 }, charm_sprout: { level: 0 } },
      equipped: { weapon: 'weapon_seed', armor: 'armor_leaf', charm: 'charm_sprout' } };
    growth.migrate({}, base); return base;
  }
  function integer(value, min, max, fallback = min) {
    return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
  }
  function loadProfile() {
    const result = freshProfile();
    try {
      const raw = JSON.parse(window.localStorage.getItem(currentSaveKey) || 'null');
      if (!raw || raw.version !== 1) return result;
      result.tutorialSeen = raw.tutorialSeen === true;
      result.unlockedStage = integer(raw.unlockedStage, 1, stages.length);
      result.seeds = integer(raw.seeds, 0, 999999); result.cores = integer(raw.cores, 0, 999999);
      result.clearedStages = [...new Set((Array.isArray(raw.clearedStages) ? raw.clearedStages : []).filter(n => Number.isInteger(n) && n >= 1 && n <= stages.length))];
      result.orchard.level = integer(raw.orchard?.level, 0, 10);
      // Old saves already completed these rescues; preserve their earned residents on migration.
      const residents = Array.isArray(raw.rescuedSprites) ? raw.rescuedSprites : result.clearedStages;
      result.rescuedSprites = [...new Set(residents.filter(n => Number.isInteger(n) && n >= 1 && n <= 20))];
      for (const id of result.rescuedSprites) result.spriteLevels[id] = integer(raw.spriteLevels?.[id], 0, 5);
      for (const id of Object.keys(gearDefs)) {
        if (raw.inventory && Object.hasOwn(raw.inventory, id)) result.inventory[id] = { level: integer(raw.inventory[id]?.level, 0, 10) };
      }
      for (const slot of ['weapon', 'armor', 'charm']) {
        const id = raw.equipped?.[slot];
        if (result.inventory[id] && gearDefs[id]?.slot === slot) result.equipped[slot] = id;
      }
      if (result.clearedStages.length) result.unlockedStage = Math.max(result.unlockedStage, Math.min(stages.length, Math.max(...result.clearedStages) + 1));
      growth.migrate(raw, result);
    } catch { storageAvailable = false; }
    return result;
  }
  let profile = loadProfile();
  selectedStage = profile.unlockedStage;
  function saveProfile() {
    if (!currentAccount) return false;
    try { window.localStorage.setItem(currentSaveKey, JSON.stringify(profile)); storageAvailable = true; return true; }
    catch { storageAvailable = false; return false; }
  }
  function freshPlayer() {
    const weapon = gearDefs[profile.equipped.weapon], armor = gearDefs[profile.equipped.armor], charm = gearDefs[profile.equipped.charm];
    const wl = profile.inventory[profile.equipped.weapon].level, al = profile.inventory[profile.equipped.armor].level, cl = profile.inventory[profile.equipped.charm].level;
    const bonus = orchardBonuses(), heroStats = growth.makeRunStats(profile), hp = armor.hp + al * gearGrowth.hp + bonus.hp + heroStats.hp;
    const baseStats = Object.freeze({
      damage: weapon.damage * (1 + wl * gearGrowth.damage) * (1 + bonus.damage) * heroStats.damageMult, rate: weapon.rate * (1 + wl * gearGrowth.rate) * (1 + bonus.rate) * heroStats.rateMult, shots: weapon.shots,
      speed: (charm.speed + cl * gearGrowth.speed) * armor.speedMult * heroStats.speedMult + bonus.speed + heroStats.speed, pickup: charm.pickup + cl * gearGrowth.pickup + bonus.pickup + heroStats.pickup
    });
    const result = { x: mapLayout.spawn.x, y: mapLayout.spawn.y, r: 17, hp, maxHp: hp, defense: armor.defense + al * gearGrowth.defense + heroStats.defense,
      ...baseStats, baseStats, volleyBonus: 0,
      xpMult: charm.xpMult * heroStats.xpMult, bulletColor: weapon.color, xp: 0, need: experienceNeed(1), level: 1, inv: 0, upgrades: {},
      heroId: heroStats.heroId, heroClock: 0, heroCasts: 0, skillCooldown: heroStats.skillCooldown, baseSkillCooldown: heroStats.skillCooldown, critChance: heroStats.critChance,
      critMultiplier: heroStats.critMultiplier, pierce: heroStats.pierce, regen: heroStats.regen, regenDelay: heroStats.regenDelay, sinceHit: 0,
      dodge: heroStats.dodge || 0, thorns: heroStats.thorns || 0, skillPower: heroStats.skillPower || 1, standPower: heroStats.standDamage || 0,
      guardUntil: 0, guardDefense: 0,
      skills: {}, skillTimers: {}, shield: 0, facingX: 1, facingY: 0, leechEvents: [], killHealEvents: [] };
    builds.init(result); return result;
  }
  player = freshPlayer();
  function el(id) { return document.getElementById(id); }
  function showCover() {
    state = 'cover'; keys.clear(); pointer = null; overlay.classList.add('hidden');
    document.body.classList.add('is-cover'); el('coverScreen').classList.remove('hidden'); el('playerAccount').classList.add('hidden');
    el('loginAccount').value = authService?.getLastAccount() || '';
    el('loginPassword').value = ''; el('loginPassword').type = 'password';
    el('togglePassword').textContent = '显示'; el('togglePassword').setAttribute?.('aria-pressed', 'false');
    el('loginFeedback').textContent = ''; el('loginFeedback').classList.remove('error', 'success');
    el('loginAccount').focus?.();
  }
  function resetAccountSession() {
    keys.clear(); pointer = null; selectedStage = profile.unlockedStage; previewStage = selectedStage; activeStage = stage();
    enemies = []; bullets = []; gems = []; particles = []; choices = []; heroEffects = []; skillEffects = [];
    elapsed = 0; kills = 0; shotClock = 0; still = 0; shake = 0; cinematicTime = 0; bossIndex = 0; bossKills = 0; nonBossKills = 0; nextBossAllowedAt = 0; bossArrivalUntil = 0;
    runRewarded = false; victoryRewardHTML = ''; runMode = 'stage'; stageVictoryReady = false; endlessEntered = false;
    endlessWave = 0; waveClock = 0; endlessCreditedSeeds = 0; endlessCreditedCores = 0;
    selectedGearSlot = 'weapon'; selectedSprite = profile.rescuedSprites[0] || 0; inspectedHero = profile.selectedHero; heroTab = 'heroes'; heroSkillView = 'active';
    mapReturnState = 'lobby'; helpReturnState = 'playing'; helpTab = 'conversation'; tutorialStep = 0; tutorialIsFirstRun = false;
    relicHudSignature = ''; buildHudSignature = ''; runRelicDefs = []; challengeStarted = false;
    setMap(selectedStage); player = freshPlayer(); stageXP = experience.create(activeStage); resetRelics(true); updateCamera();
  }
  function acceptAccount(user, created = false, legacyClaimed = false) {
    currentAccount = user; currentSaveKey = authService.profileKey(user.id); storageAvailable = true;
    profile = loadProfile(); resetAccountSession();
    sessionGreeting = (created ? '注册成功，欢迎 ' : '欢迎回来，') + user.nickname + (legacyClaimed ? ' · 已保留原有进度' : '');
    el('playerName').textContent = user.nickname; el('playerAccount').classList.remove('hidden');
    document.body.classList.remove('is-cover'); el('coverScreen').classList.add('hidden'); el('loginPassword').value = '';
    startScreen(); return true;
  }
  async function submitLogin() {
    if (state !== 'cover' || loginBusy) return false;
    const attempt = ++loginAttempt;
    const info = { account: el('loginAccount').value, password: el('loginPassword').value };
    loginBusy = true;
    for (const id of ['loginAccount', 'loginPassword', 'togglePassword', 'loginSubmit']) el(id).disabled = true;
    el('loginSubmit').textContent = '正在进入果园…'; el('loginFeedback').textContent = '正在核对守护者信息…'; el('loginFeedback').classList.remove('error', 'success');
    try {
      if (!authService) throw new Error('当前浏览器无法保存账号，请允许本地存储后再试。');
      const result = await authService.login(info);
      if (attempt !== loginAttempt || state !== 'cover') return false;
      return acceptAccount(result.user, result.created, result.legacyClaimed);
    } catch (error) {
      if (attempt === loginAttempt && state === 'cover') {
        el('loginFeedback').textContent = error.message || '暂时无法登录，请稍后重试。'; el('loginFeedback').classList.add('error');
        el('loginPassword').value = '';
      }
      return false;
    } finally {
      loginBusy = false;
      for (const id of ['loginAccount', 'loginPassword', 'togglePassword', 'loginSubmit']) el(id).disabled = false;
      el('loginSubmit').textContent = '登录 / 首次注册';
    }
  }
  function logoutAccount() {
    if (!currentAccount || isRunActive() || loginBusy) return false;
    if (!saveProfile()) { el('logoutAccount').title = '进度保存失败，请稍后重试'; return false; }
    loginAttempt++; currentAccount = null; currentSaveKey = SAVE_KEY; profile = freshProfile(); sessionGreeting = '';
    resetAccountSession(); showCover(); return true;
  }
  function show(html, menu = false) {
    overlay.classList.remove('upgrade-overlay', 'relic-map-overlay', 'lobby-overlay', 'help-overlay');
    arena.classList.remove('is-lobby');
    for (const attribute of ['role', 'aria-modal', 'aria-label']) overlay.removeAttribute?.(attribute);
    overlay.innerHTML = '<div class="dialog' + (menu ? ' menu-dialog' : '') + '">' + html + '</div>';
    overlay.classList.remove('hidden');
  }
  function showMenu(title, subtitle, body, actions, activeTab, note = '进度自动保存 · 所有操作无需滚轮') {
    if (!currentAccount) return false;
    const tabs = [['stages', '关卡挑战', 'navStages'], ['heroes', '英雄育成', 'navHeroes'], ['armory', '装备工坊', 'navArmory'], ['orchard', '我的果园', 'navOrchard'], ['map', '投放地图', 'navMap']];
    show('<div class="menu-top"><div><div class="tag">' + subtitle + '</div><h2 class="menu-title">' + title + '</h2></div><div class="wallet">☀ 阳光籽 ' + profile.seeds + '　◆ 果核 ' + profile.cores + '<small>通关 ' + profile.clearedStages.length + ' / ' + stages.length + ' · 精灵 ' + profile.rescuedSprites.length + ' / 20</small></div></div>' +
      '<div class="menu-body">' + body + '</div><div class="menu-footer"><div class="menu-actions">' + actions + '</div>' +
      '<nav class="menu-nav" aria-label="果园功能">' + tabs.map(([tab, name, id]) => '<button class="nav-button ' + (activeTab === tab ? 'active' : '') + '" id="' + id + '" aria-pressed="' + (activeTab === tab) + '">' + name + '</button>').join('') + '</nav>' +
      '<div class="micro">' + (!storageAvailable ? '浏览器存储不可用，进度仅在当前页面中保留' : note) + '</div></div>', true);
    el('navStages').onclick = startScreen; el('navHeroes').onclick = () => showHeroes(); el('navArmory').onclick = showArmory; el('navOrchard').onclick = showOrchard; el('navMap').onclick = showRelicMap;
  }
  function showPanel(title, subtitle, body, actions, note = '') {
    if (!currentAccount) return false;
    show('<div class="menu-top"><div><div class="tag">' + subtitle + '</div><h2 class="menu-title">' + title + '</h2></div><div class="wallet">☀ 阳光籽 ' + profile.seeds + '　◆ 果核 ' + profile.cores + '</div></div>' +
      '<div class="menu-body panel-body">' + body + '</div><div class="menu-footer"><div class="menu-actions">' + actions + '</div><div class="micro">' + note + '</div></div>', true);
  }
  function updateCamera() {
    camera.x = Math.max(0, Math.min(WORLD_W - W, player.x - W / 2));
    camera.y = Math.max(0, Math.min(WORLD_H - H, player.y - H / 2));
  }
  function isRunActive() { return runStates.includes(state) || (state === 'relicMap' && ['playing', 'paused'].includes(mapReturnState)) || (state === 'help' && ['playing', 'paused'].includes(helpReturnState)); }
  function randomRelics() {
    const pool = [...relicDefs];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool.slice(0, 6);
  }
  function resetRelics(reroll = true) {
    if (reroll || runRelicDefs.length !== 6) runRelicDefs = randomRelics();
    const previous = relicDrops;
    relicDrops = runRelicDefs.map((d, index) => {
      const point = mapLayout.relics[index], old = previous.find(p => p.slotId === point.id);
      let x = old && !reroll ? old.x : point.x, y = old && !reroll ? old.y : point.y;
      if (reroll) {
        const angle = Math.random() * Math.PI * 2, distance = 20 + Math.random() * 50;
        const nextX = point.x + Math.cos(angle) * distance, nextY = point.y + Math.sin(angle) * distance;
        if (world.isFree(nextX, nextY, 44, obstacles, WORLD_W, WORLD_H) && !world.blocksSegment(point.x, point.y, nextX, nextY, obstacles, 17)) { x = nextX; y = nextY; }
      }
      return { id: d.id, key: d.key, slotId: point.id, slotIndex: index, x, y, claimed: false };
    });
    if (!runRelicDefs.some(d => d.id === selectedRelic)) selectedRelic = runRelicDefs[0].id;
    skillEffects = [];
    noticeQueue = []; currentNotice = null; noticeClock = 0;
  }
  function queueNotice(title, description, icon = '✦', color = '#d8ec93', kind = 'relic') {
    noticeQueue.push({ title, description, icon, color, kind });
    if (!currentNotice) advanceNotice();
  }
  function advanceNotice() {
    currentNotice = noticeQueue.shift() || null; noticeClock = currentNotice ? 8 : 0;
    const banner = el('lootTicker');
    banner.classList.toggle('hidden', !currentNotice);
    if (currentNotice) {
      banner.style.setProperty('--notice-color', currentNotice.color);
      el('lootTickerTitle').textContent = currentNotice.icon + ' ' + (currentNotice.kind === 'super' ? '超级合成 · ' : currentNotice.kind === 'supply' ? '成长补给 · ' : '获得饰品 · ') + currentNotice.title;
      el('lootTickerText').textContent = currentNotice.description;
      banner.classList.remove('ticker-new'); void banner.offsetWidth; banner.classList.add('ticker-new');
      requestAnimationFrame(() => {
        const text = el('lootTickerText');
        text.style.setProperty('--ticker-distance', Math.max(0, (text.scrollWidth || 0) - (text.parentElement?.clientWidth || banner.clientWidth || 0)) + 'px');
      });
    }
  }
  function updateNotices(dt) {
    if (!currentNotice) return;
    noticeClock -= dt; if (noticeClock <= 0) advanceNotice();
  }
  function healPlayer(amount) { player.hp = Math.min(player.maxHp, player.hp + Math.max(0, amount)); }
  function spawnSkillProjectile(spec) {
    const angle = Number.isFinite(spec.angle) ? spec.angle : Math.atan2((spec.ty ?? player.y) - (spec.y ?? player.y), (spec.tx ?? player.x + 1) - (spec.x ?? player.x));
    const speed = spec.speed || 460;
    bullets.push({ x: spec.x ?? player.x, y: spec.y ?? player.y, vx: spec.vx ?? Math.cos(angle) * speed, vy: spec.vy ?? Math.sin(angle) * speed,
      damage: spec.damage ?? player.damage * (spec.power || 1), color: spec.color || '#e9f5b6', life: spec.life || 1.8, size: spec.size || 5,
      pierces: spec.pierces ?? spec.pierce ?? 0, hitTargets: new Set(), skill: true });
  }
  function relicEffect(key, values) {
    const def = relicDefs.find(d => d.key === key);
    skillEffects.push({ key, color: def?.color || '#d5ec9c', life: .5, max: .5, ...values });
    if (skillEffects.length > 80) skillEffects.splice(0, skillEffects.length - 80);
  }
  function claimRelic(id) {
    const drop = relicDrops.find(d => String(d.id) === String(id));
    if (state !== 'playing' || !drop || drop.claimed || Math.hypot(drop.x - player.x, drop.y - player.y) > 56) return false;
    const def = relicDefs.find(d => d.id === drop.id);
    drop.claimed = true; player.skills[def.key] = true; player.skillTimers[def.key] = def.key === 'shield' ? def.cooldown : 0;
    if (def.key === 'shield') player.shield = 1;
    if (!legacyRelics.has(def.key)) relicEffects.applyPickup(player, def);
    queueNotice(def.name, def.description, def.icon, def.color);
    burst(drop.x, drop.y, def.color, 20); sound(830, .18, .025); updateHUD(); return true;
  }
  function movementVector() {
    let x = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    let y = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
    if (pointer) { const dx = pointer.x - pointer.sx, dy = pointer.y - pointer.sy, length = Math.hypot(dx, dy); if (length > 8) { x = dx / length; y = dy / length; } }
    const length = Math.hypot(x, y); return { x: length ? x / length : 0, y: length ? y / length : 0, moving: length > 0 };
  }
  function activateDash() {
    if (state !== 'playing' || !player.skills.dash || (player.skillTimers.dash || 0) > 0) return false;
    const def = relicDefs.find(d => d.key === 'dash'), direction = movementVector();
    const x = direction.moving ? direction.x : player.facingX, y = direction.moving ? direction.y : player.facingY;
    const origin = { x: player.x, y: player.y };
    world.move(player, x * def.distance, y * def.distance, obstacles, WORLD_W, WORLD_H);
    player.x = Math.max(28, Math.min(WORLD_W - 28, player.x)); player.y = Math.max(28, Math.min(WORLD_H - 28, player.y));
    player.facingX = x; player.facingY = y; player.inv = Math.max(player.inv, def.duration); player.skillTimers.dash = def.cooldown; still = 0;
    relicEffect('dash', { type: 'line', ...origin, tx: player.x, ty: player.y, life: .3, max: .3 });
    burst(origin.x, origin.y, def.color, 7); burst(player.x, player.y, def.color, 7); updateCamera(); sound(680, .08, .02); updateHUD(); return true;
  }
  function skillTargets(x, y, radius) {
    return enemies.filter(e => e.aggro && e.hp > 0 && Math.hypot(e.x - x, e.y - y) <= radius + e.r && !world.blocksSegment(x, y, e.x, e.y, obstacles))
      .sort((a, b) => (a.x - x) ** 2 + (a.y - y) ** 2 - (b.x - x) ** 2 - (b.y - y) ** 2);
  }
  function slowEnemy(enemy, amount, duration) {
    const current = enemy.slowUntil > elapsed ? enemy.slowAmount || 0 : 0;
    if (current > amount) return;
    enemy.slowUntil = current === amount ? Math.max(enemy.slowUntil || 0, elapsed + duration) : elapsed + duration;
    enemy.slowAmount = amount;
  }
  function skillHit(enemy, damage, color) {
    const actual = Math.min(Math.max(0, enemy.hp), Math.max(0, damage));
    enemy.hp -= damage; enemy.flash = .12; burst(enemy.x, enemy.y, color, 4);
    if (actual > 0 && player.lifeSteal > 0 && player.hp < player.maxHp) {
      player.leechEvents = player.leechEvents.filter(entry => entry.at > elapsed - 1);
      const spent = player.leechEvents.reduce((sum, entry) => sum + entry.amount, 0);
      const amount = Math.max(0, Math.min(actual * player.lifeSteal, player.maxHp * combat.leechPerSecond - spent, player.maxHp - player.hp));
      if (amount > 0) {
        const last = player.leechEvents.at(-1);
        if (last && last.at === elapsed) last.amount += amount; else player.leechEvents.push({ at: elapsed, amount });
        healPlayer(amount);
      }
    }
  }
  function updateSkills(dt) {
    player.heroClock = Math.max(0, player.heroClock - dt);
    heroEffects.forEach(effect => { effect.life -= dt; }); heroEffects = heroEffects.filter(effect => effect.life > 0);
    skillEffects.forEach(effect => { effect.life -= dt; }); skillEffects = skillEffects.filter(effect => effect.life > 0);
    updateNotices(dt);
    for (const def of runRelicDefs.filter(d => legacyRelics.has(d.key))) {
      if (!player.skills[def.key]) continue;
      player.skillTimers[def.key] = Math.max(0, (player.skillTimers[def.key] || 0) - dt);
      if (player.skillTimers[def.key] > 0 || def.key === 'dash') continue;
      if (def.key === 'shield') {
        if (player.shield === 0) { player.shield = 1; player.skillTimers.shield = def.cooldown; relicEffect('shield', { type: 'ring', x: player.x, y: player.y, radius: 40 }); }
        continue;
      }
      const targets = skillTargets(player.x, player.y, def.radius); if (!targets.length) continue;
      if (def.key === 'lightning') {
        const used = new Set(), points = [{ x: player.x, y: player.y }]; let target = targets[0];
        for (let i = 0; target && i < def.targets; i++) {
          used.add(target); skillHit(target, player.damage * def.power * player.skillPower, def.color); points.push({ x: target.x, y: target.y });
          target = skillTargets(target.x, target.y, def.chainRadius).find(e => !used.has(e));
        }
        relicEffect(def.key, { type: 'chain', points, life: .28, max: .28 });
      } else if (def.key === 'frost') {
        for (const enemy of targets.slice(0, def.targets)) {
          skillHit(enemy, player.damage * def.power * player.skillPower, def.color);
          slowEnemy(enemy, enemy.boss ? def.bossSlow : def.slow, def.duration);
        }
        relicEffect(def.key, { type: 'ring', x: player.x, y: player.y, radius: def.radius, life: .65, max: .65 });
      } else if (def.key === 'orbit') {
        targets.slice(0, def.targets).forEach(enemy => skillHit(enemy, player.damage * def.power * player.skillPower, def.color));
        relicEffect(def.key, { type: 'ring', x: player.x, y: player.y, radius: def.radius, life: .25, max: .25 });
      } else if (def.key === 'bees') {
        for (let i = 0; i < def.targets; i++) {
          const target = skillTargets(player.x, player.y, def.radius)[0]; if (!target) break;
          skillHit(target, player.damage * def.power * player.skillPower, def.color);
          relicEffect(def.key, { type: 'bee', x: player.x, y: player.y, tx: target.x, ty: target.y, life: .45, max: .45 });
        }
      }
      player.skillTimers[def.key] = def.cooldown;
    }
    const owned = runRelicDefs.filter(def => player.skills[def.key]);
    const context = { active: state === 'playing', elapsed, standing: still >= combat.standDelay, targets: skillTargets, hit: skillHit,
      heal: healPlayer, effect: (key, values) => relicEffect(key, values), projectile: spawnSkillProjectile };
    relicEffects.tick(player, owned, dt, { ...context,
      hit: (enemy, damage, color) => skillHit(enemy, damage * player.skillPower, color),
      projectile: spec => spawnSkillProjectile({ ...spec, damage: spec.damage * player.skillPower }) });
    builds.tick(player, dt, { ...context, effect: effect => relicEffect(effect.key, effect) });
  }
  function activateHeroSkill() {
    if (state !== 'playing' || player.heroClock > 0) return false;
    const spec = growth.active(player.heroId, player); if (!spec) return false;
    if (spec.kind === 'dashStrike') {
      const direction = movementVector(), x = direction.moving ? direction.x : player.facingX, y = direction.moving ? direction.y : player.facingY;
      world.move(player, x * spec.distance, y * spec.distance, obstacles, WORLD_W, WORLD_H);
      player.inv = Math.max(player.inv, spec.invDuration); still = 0; updateCamera();
    }
    const candidates = skillTargets(player.x, player.y, spec.radius);
    if (spec.kind === 'execute') candidates.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
    const targets = candidates.slice(0, spec.targets || 0);
    if (spec.kind === 'radialVolley') {
      for (let i = 0; i < spec.count; i++) {
        const angle = i / spec.count * Math.PI * 2;
        spawnSkillProjectile({ x: player.x, y: player.y, angle, speed: spec.speed, life: spec.life,
          damage: spec.damage * player.skillPower, color: spec.color, pierce: spec.pierces });
      }
    } else if (spec.kind === 'volley') {
      const direction = movementVector(), x = direction.moving ? direction.x : player.facingX, y = direction.moving ? direction.y : player.facingY;
      const angle = Math.atan2(y, x);
      const rows = spec.rows || 1, perRow = Math.ceil(spec.count / rows);
      for (let i = 0; i < spec.count; i++) {
        const column = i % perRow, row = Math.floor(i / perRow), offset = (row - (rows - 1) / 2) * (spec.rowOffset || 0);
        const aim = angle + (column / Math.max(1, perRow - 1) - .5) * spec.spread;
        bullets.push({ x: player.x + Math.cos(aim) * 22 - Math.sin(angle) * offset, y: player.y + Math.sin(aim) * 22 + Math.cos(angle) * offset, vx: Math.cos(aim) * spec.speed, vy: Math.sin(aim) * spec.speed,
          damage: spec.damage * player.skillPower, life: spec.life, size: 6, color: spec.color, pierces: 0, hitTargets: new Set(), hero: true });
      }
    } else if (spec.kind === 'chain') {
      let target = targets[0]; const used = new Set(), points = [{ x: player.x, y: player.y }];
      for (let hop = 0; hop < spec.targets && target; hop++) {
        used.add(target); points.push({ x: target.x, y: target.y });
        skillHit(target, spec.damage * player.skillPower * Math.pow(spec.falloff || 1, hop), spec.color);
        target = skillTargets(target.x, target.y, spec.jumpRadius).find(enemy => !used.has(enemy));
      }
      if (points.length > 1) relicEffect('hero-chain', { type: 'chain', points, color: spec.color, life: .6, max: .6 });
    } else {
      targets.forEach(enemy => {
        const power = spec.kind === 'execute' && enemy.hp / enemy.maxHp <= spec.threshold ? spec.executePower / spec.power : 1;
        skillHit(enemy, spec.damage * player.skillPower * power, spec.color);
        if (spec.kind === 'frostShield') slowEnemy(enemy, enemy.boss ? spec.bossSlow : spec.slow, spec.duration);
        if (spec.kind === 'slam') {
          const dx = enemy.x - player.x, dy = enemy.y - player.y, length = Math.hypot(dx, dy) || 1;
          if (!enemy.boss) world.move(enemy, dx / length * spec.knockback, dy / length * spec.knockback, obstacles, WORLD_W, WORLD_H);
          slowEnemy(enemy, enemy.boss ? spec.bossSlow : spec.slow, spec.duration);
        }
      });
      const heal = ['healPulse', 'healGuard'].includes(spec.kind) ? spec.heal : targets.length ? spec.healOnHit || 0 : 0;
      player.hp = Math.min(player.maxHp, player.hp + heal);
      if (spec.kind === 'frostShield') player.shield = Math.max(player.shield, 1);
      if (['guardRing', 'healGuard'].includes(spec.kind)) { player.guardUntil = elapsed + spec.guardDuration; player.guardDefense = spec.guardDefense; }
      heroEffects.push({ x: player.x, y: player.y, radius: spec.radius, color: spec.color, life: .7, max: .7 });
    }
    player.heroClock = spec.cooldown; player.heroCasts++; sound(740, .18, .03);
    burst(player.x, player.y, spec.color, 16); updateHUD(); return true;
  }
  function showRelicMap() {
    if (!currentAccount) return false;
    if (state !== 'relicMap') {
      if (!['lobby', 'heroes', 'armory', 'orchard', 'playing', 'paused'].includes(state)) return false;
      mapReturnState = state; state = 'relicMap'; keys.clear(); pointer = null; still = 0;
    }
    const battle = ['playing', 'paused'].includes(mapReturnState), def = runRelicDefs.find(d => String(d.id) === String(selectedRelic)) || runRelicDefs[0];
    selectedRelic = def.id;
    const points = relicDrops;
    const selected = points.find(d => d.id === def.id), distance = Math.round(Math.hypot(selected.x - player.x, selected.y - player.y));
    const body = '<div class="relic-layout"><div class="relic-board">' + mapRenderer.svg(mapLayout) +
      '<span class="relic-start" style="left:' + mapLayout.spawn.x / WORLD_W * 100 + '%;top:' + mapLayout.spawn.y / WORLD_H * 100 + '%">🌱 起点</span>' +
      points.map((point, index) => { const d = relicDefs.find(item => item.id === point.id); return '<button class="relic-marker ' + (point.id === selectedRelic ? 'selected ' : '') + (point.claimed ? 'claimed' : '') + '" data-relic-id="' + point.id + '" style="left:' + point.x / WORLD_W * 100 + '%;top:' + point.y / WORLD_H * 100 + '%;--relic-color:' + d.color + '" aria-label="' + d.name + (point.claimed ? '已领取' : '投放点') + '"><span>' + (index + 1) + '</span><b>' + d.icon + '</b></button>'; }).join('') +
      (battle ? '<span class="relic-player" style="left:' + player.x / WORLD_W * 100 + '%;top:' + player.y / WORLD_H * 100 + '%">●</span>' : '') + '</div><div class="relic-details"><div class="relic-selector">' +
      points.map((point, index) => '<button class="secondary ' + (point.id === selectedRelic ? 'selected ' : '') + (point.claimed ? 'claimed' : '') + '" data-relic-id="' + point.id + '">' + (index + 1) + ' ' + relicDefs.find(d => d.id === point.id).icon + (point.claimed ? ' ✓' : '') + '</button>').join('') + '</div><article class="relic-detail"><strong>' + def.icon + ' ' + def.name + '</strong><span class="relic-skill">获得技能：' + def.skillName + '</span><p class="relic-description">' + def.description + '</p><p class="relic-summary">' + def.summary + '</p><small>' + (def.family === 'stats' ? '本局持续属性增益' : '冷却 ' + def.cooldown + ' 秒') + (def.key === 'dash' ? ' · Space / 闪步按钮' : def.family === 'stats' ? '' : ' · 自动触发') + '</small><span class="relic-status">' + (selected.claimed ? '✓ 本局已领取' : '靠近 56 像素自动领取') + '</span><small>坐标 ' + Math.round(selected.x) + ' / ' + Math.round(selected.y) + (battle ? ' · 距你 ' + distance : '') + '</small></article><div class="relic-route">第 ' + mapLayout.id + ' 关 · ' + mapLayout.name + '<br>' + WORLD_W + ' × ' + WORLD_H + ' · 浅棕：道路 / 桥 · 青蓝：水域 · 深蓝：裂谷<br>沿道路绕过障碍，水域和裂谷需要从桥上通过。50 件饰品每局随机 6 件，每件可领一次，无尽保留。</div></div></div>';
    if (battle) showPanel('特殊饰品投放图', '第 ' + activeStage.id + ' 关 / 探索领技能', body, '<button class="primary" id="closeRelicMap">返回战场 · M / Esc</button>', '查看地图期间战斗、增援与技能冷却暂停');
    else showMenu('特殊饰品投放图', '第 ' + selectedStage + ' 关 / ' + mapLayout.name, body, '<button class="primary" id="start">挑战第 ' + selectedStage + ' 关</button><button class="secondary" id="closeRelicMap">返回</button>', 'map', '当前关卡真实地形 · 点选投放点查看技能效果');
    overlay.classList.add('relic-map-overlay');
    overlay.querySelectorAll('[data-relic-id]').forEach(button => { button.onclick = () => { selectedRelic = relicDefs.find(d => String(d.id) === button.dataset.relicId).id; showRelicMap(); }; });
    el('closeRelicMap').onclick = closeRelicMap; if (!battle) el('start').onclick = start;
    updateHUD(); return true;
  }
  function closeRelicMap() {
    if (state !== 'relicMap') return false;
    if (mapReturnState === 'playing') { state = 'playing'; overlay.classList.add('hidden'); keys.clear(); pointer = null; updateHUD(); }
    else if (mapReturnState === 'paused') { state = 'playing'; pause(); }
    else if (mapReturnState === 'armory') showArmory();
    else if (mapReturnState === 'orchard') showOrchard();
    else if (mapReturnState === 'heroes') showHeroes();
    else startScreen();
    return true;
  }
  function stage(id = selectedStage) { return stages[id - 1]; }
  function selectStage(id) {
    if (!currentAccount || !Number.isInteger(id) || id < 1 || id > profile.unlockedStage || id > stages.length || isRunActive()) return false;
    selectedStage = id; setMap(id); resetRelics(true); challengeStarted = false; return true;
  }
  function renderLobby(id = selectedStage) {
    previewStage = id;
    const s = stages[id - 1], unlocked = id <= profile.unlockedStage, cleared = profile.clearedStages.includes(id);
    const status = unlocked ? cleared ? '已通关 · 可以再次挑战' : '已解锁 · 等你守护' : '通关第 ' + (id - 1) + ' 关后解锁';
    const reward = s.firstClearGear ? ' · ' + gearDefs[s.firstClearGear].name : '';
    show('<div class="lobby-heading"><div class="chapter-heading"><small class="chapter-eyebrow">ORCHARD GUARDIANS / 第 ' + String(id).padStart(2, '0') + ' 关</small><h2 class="chapter-name">' + s.name + '</h2><span class="chapter-status">' + status + '</span></div><div class="lobby-wallet">☀ ' + profile.seeds + '　◆ ' + profile.cores + '<small>通关 ' + profile.clearedStages.length + ' / ' + stages.length + ' · 救援 ' + profile.rescuedSprites.length + ' / 20</small></div></div>' +
      '<div class="menu-body lobby-body"><section class="chapter-showcase" aria-label="关卡图片"><img class="chapter-image" style="filter:hue-rotate(' + (art.stages[id - 1].hue || 0) + 'deg)" src="' + art.stages[id - 1].image + '" alt="' + s.name + '主题图"><div class="chapter-shade"></div><span class="chapter-ribbon">' + String(id).padStart(2, '0') + ' / ' + stages.length + ' · ' + (unlocked ? cleared ? '已通关' : '可挑战' : '未解锁') + '</span>' +
      '<button class="chapter-arrow previous" id="previousStage" aria-label="切换上一关" ' + (id === 1 ? 'disabled' : '') + '>‹</button><button class="chapter-arrow next" id="nextStagePreview" aria-label="切换下一关" ' + (id === stages.length ? 'disabled' : '') + '>›</button>' +
      '<div class="chapter-caption"><strong>守护这片果园</strong><span>' + s.description + '</span></div></section>' +
      '<div class="campaign-picker"><label>篇章 <select id="chapterJump" aria-label="选择远征篇章">' + ['青叶启程', '月露群岛', '赤焰山林', '霜晶高原', '星辉王庭'].map((name, index) => '<option value="' + (index * 20 + 1) + '" ' + (Math.floor((id - 1) / 20) === index ? 'selected' : '') + '>' + (index + 1) + ' · ' + name + '</option>').join('') + '</select></label><label>关卡 <select id="stageJump" aria-label="选择篇章关卡">' + stages.slice(Math.floor((id - 1) / 20) * 20, Math.floor((id - 1) / 20) * 20 + 20).map(item => '<option value="' + item.id + '" ' + (item.id === id ? 'selected' : '') + '>第 ' + item.id + ' 关 · ' + (profile.clearedStages.includes(item.id) ? '✓' : item.id <= profile.unlockedStage ? '可挑战' : '未解锁') + '</option>').join('') + '</select></label></div>' +
      '<div class="chapter-brief"><span class="chapter-chip">普通 ' + s.normalCount + ' · 精英 ' + s.eliteCount + ' · Boss ' + s.bossCount + '</span><span class="chapter-chip">虫王 ' + s.bossSchedule[0] + ' 秒起 · 逐位登场</span><span class="chapter-chip">首通 ☀ ' + s.reward.seeds + ' · ◆ ' + s.reward.cores + reward + '</span></div></div>' +
      '<div class="menu-footer lobby-footer"><div class="lobby-actions"><button class="lobby-play primary" id="start" ' + (!unlocked ? 'disabled' : '') + '><span class="action-icon">▶</span><strong>' + (unlocked ? '进入游戏' : '关卡未解锁') + '</strong><small>' + (unlocked ? '挑战第 ' + id + ' 关' : '先通关第 ' + (id - 1) + ' 关') + '</small></button>' +
      '<button class="lobby-feature secondary" id="navArmory"><span class="action-icon">⚒</span><strong>装备</strong><small>搭配与强化</small></button><button class="lobby-feature secondary" id="navHeroes"><span class="action-icon">✦</span><strong>英雄</strong><small>13 位初始解锁</small></button><button class="lobby-feature secondary" id="navOrchard"><span class="action-icon">♧</span><strong>果园</strong><small>精灵与养成</small></button></div>' +
      '<div class="lobby-bottom"><span class="lobby-note">' + (!storageAvailable ? '浏览器存储不可用，进度仅在当前页面中保留' : escapeHTML(sessionGreeting) + (sessionGreeting ? ' · ' : '') + '出战：' + growth.hero(profile.selectedHero).name) + '</span><button class="chapter-map-link" id="navMap" ' + (!unlocked ? 'disabled' : '') + '>本关地形与饰品 ↗</button></div></div>', true);
    overlay.classList.add('lobby-overlay'); arena.classList.add('is-lobby');
    el('start').onclick = () => { if (unlocked && state === 'lobby') start(); };
    el('previousStage').onclick = () => browseStage(-1); el('nextStagePreview').onclick = () => browseStage(1);
    for (const key of ['chapterJump', 'stageJump']) el(key).onchange = () => {
      if (state !== 'lobby') return;
      const target = Number(el(key).value);
      if (!Number.isInteger(target) || target < 1 || target > stages.length) return;
      if (target <= profile.unlockedStage) { selectStage(target); player = freshPlayer(); updateCamera(); updateHUD(); }
      renderLobby(target);
    };
    el('navArmory').onclick = showArmory; el('navHeroes').onclick = () => { inspectedHero = profile.selectedHero; showHeroes('heroes'); }; el('navOrchard').onclick = showOrchard;
    el('navMap').onclick = () => { if (unlocked && state === 'lobby') showRelicMap(); };
  }
  function browseStage(direction) {
    if (state !== 'lobby' || ![-1, 1].includes(direction)) return false;
    const id = Math.max(1, Math.min(stages.length, previewStage + direction));
    if (id === previewStage) return false;
    if (id <= profile.unlockedStage) { selectStage(id); player = freshPlayer(); updateCamera(); updateHUD(); }
    renderLobby(id); return true;
  }
  function startScreen() {
    if (!currentAccount) { showCover(); return false; }
    state = 'lobby'; keys.clear(); pointer = null; enemies = []; bullets = []; gems = []; particles = []; still = 0; shake = 0;
    bossIndex = 0; bossKills = 0; nonBossKills = 0; nextBossAllowedAt = 0; bossArrivalUntil = 0; heroEffects = [];
    runMode = 'stage'; stageVictoryReady = false; setMap(selectedStage); player = freshPlayer(); stageXP = experience.create(stage());
    resetRelics(challengeStarted || runRelicDefs.length !== 6); challengeStarted = false; updateCamera(); updateHUD();
    renderLobby();
  }
  function heroPortrait(hero) {
    if (art.heroImages?.[hero.id]) return '<span class="hero-portrait" role="img" aria-label="' + hero.name + '立绘" style="background-image:url(\'' + art.heroImages[hero.id] + '\');background-size:contain;background-position:center;--hero-color:' + hero.color + '"></span>';
    const index = art.sprites[hero.id], column = index % 4, row = Math.floor(index / 4);
    return '<span class="hero-portrait" role="img" aria-label="' + hero.name + '立绘" style="background-image:url(\'' + art.atlas + '\');background-size:400% 400%;background-position:' + column * 100 / 3 + '% ' + row * 100 / 3 + '%;--hero-color:' + hero.color + '"></span>';
  }
  function heroSummary(hero) {
    return heroSkillView === 'active' ? hero.skillDescription : hero.passiveDescription;
  }
  function selectHero(id) {
    if (!currentAccount || isRunActive() || !growth.isUnlocked(id, profile)) return false;
    profile.selectedHero = id; inspectedHero = id; saveProfile(); player = freshPlayer(); updateHUD(); return true;
  }
  function trainHero(id) {
    if (!currentAccount) return false;
    const hero = growth.hero(id), level = profile.heroLevels[id] || 0;
    if (!hero || isRunActive() || !growth.isUnlocked(hero, profile)) return false;
    const cost = growth.cost('hero', id, level); if (!cost || !canAfford(cost)) return false;
    profile.seeds -= cost.seeds; profile.cores -= cost.cores; profile.heroLevels[id] = level + 1;
    saveProfile(); player = freshPlayer(); updateHUD(); return true;
  }
  function researchTalent(id) {
    if (!currentAccount) return false;
    if (isRunActive() || !growth.talents.some(t => t.id === id)) return false;
    const cost = growth.cost('talent', id, profile.talents[id] || 0); if (!cost || !canAfford(cost)) return false;
    profile.seeds -= cost.seeds; profile.cores -= cost.cores; profile.talents[id] = (profile.talents[id] || 0) + 1;
    saveProfile(); player = freshPlayer(); updateHUD(); return true;
  }
  function showHeroes(tab = heroTab) {
    if (!currentAccount) return false;
    if (isRunActive()) return false;
    const heroListScroll = el('heroGrid')?.scrollTop || 0;
    if (['heroes', 'talents'].includes(tab)) heroTab = tab;
    state = 'heroes'; keys.clear(); pointer = null;
    const inspected = growth.hero(inspectedHero) || growth.hero(profile.selectedHero);
    inspectedHero = inspected.id;
    const owned = growth.isUnlocked(inspected, profile), level = profile.heroLevels[inspected.id] || 0;
    const cost = growth.cost('hero', inspected.id, level);
    const tabs = '<div class="hero-tabs"><button class="secondary ' + (heroTab === 'heroes' ? 'active' : '') + '" data-growth-tab="heroes">英雄与训练</button><button class="secondary ' + (heroTab === 'talents' ? 'active' : '') + '" data-growth-tab="talents">全队天赋研究</button><small>全部 ' + growth.heroes.length + ' 位初始解锁 · 出战：' + growth.hero(profile.selectedHero).name + '</small></div>';
    const heroesHTML = '<div class="hero-layout"><div id="heroGrid" class="hero-grid">' + growth.heroes.map(hero => '<button class="hero-card ' + (hero.id === inspectedHero ? 'selected ' : '') + (!growth.isUnlocked(hero, profile) ? 'locked' : '') + '" data-inspect-hero="' + hero.id + '">' + heroPortrait(hero) + '<div><strong>' + hero.name + '</strong><span>' + hero.role + '</span><small>' + (growth.isUnlocked(hero, profile) ? hero.id === profile.selectedHero ? '正在出战 ✓' : '训练 ' + profile.heroLevels[hero.id] + ' / ' + hero.maxLevel : '通关第 ' + hero.unlockStage + ' 关解锁') + '</small></div></button>').join('') + '</div><article class="hero-detail"><strong>' + inspected.icon + ' ' + inspected.name + ' · ' + inspected.role + '</strong><p class="hero-description hero-lore">' + inspected.description + '</p><span>' + inspected.statsText + '</span><div class="hero-skill-copy"><div class="hero-skill-tabs"><button class="secondary ' + (heroSkillView === 'active' ? 'active' : '') + '" data-hero-view="active" aria-pressed="' + (heroSkillView === 'active') + '">主动技能</button><button class="secondary ' + (heroSkillView === 'passive' ? 'active' : '') + '" data-hero-view="passive" aria-pressed="' + (heroSkillView === 'passive') + '">专属被动</button></div><b>' + (heroSkillView === 'active' ? inspected.skillIcon + ' ' + inspected.skillName + ' · E' : inspected.passiveName) + '</b><p class="hero-full-description">' + (heroSkillView === 'active' ? inspected.skillDescription : inspected.passiveDescription) + '</p><p class="hero-compact-description">' + heroSummary(inspected) + '</p></div><small>训练 ' + level + ' / ' + inspected.maxLevel + '：前5级每级伤害 +2.5%、生命 +5、冷却 −2%；6～30级每级伤害 +1%、生命 +3、冷却 −0.8%。</small><div class="hero-actions"><button class="secondary" id="equipHero" ' + (!owned || inspected.id === profile.selectedHero ? 'disabled' : '') + '>' + (owned ? inspected.id === profile.selectedHero ? '已出战' : '选择出战' : '尚未解锁') + '</button><button class="secondary" id="trainHero" ' + (!owned || !cost || !canAfford(cost) ? 'disabled' : '') + '>' + (!cost ? '训练已满级' : '训练 · ☀' + cost.seeds + ' ◆' + cost.cores) + '</button></div></article></div>';
    const talentsHTML = '<div class="growth-grid">' + growth.talents.map(talent => {
      const level = profile.talents[talent.id] || 0, cost = growth.cost('talent', talent.id, level);
      return '<article class="growth-card"><strong>' + talent.icon + ' ' + talent.name + '</strong><span>' + talent.description + '</span><small>永久研究 ' + level + ' / ' + talent.maxLevel + ' · 全英雄共享</small><button class="secondary" data-research="' + talent.id + '" ' + (!cost || !canAfford(cost) ? 'disabled' : '') + '>' + (!cost ? '已满级' : '研究 · ☀' + cost.seeds + ' ◆' + cost.cores) + '</button></article>';
    }).join('') + '</div>';
    showMenu('守卫集结', '英雄育成 / 永久成长', tabs + (heroTab === 'heroes' ? heroesHTML : talentsHTML), '<button class="primary" id="start">出战第 ' + selectedStage + ' 关</button><button class="secondary" id="backLobby">返回关卡</button>', 'heroes', '英雄、训练与研究自动保存 · 战斗中 E 施放专属技能');
    overlay.querySelectorAll('[data-growth-tab]').forEach(b => { b.onclick = () => showHeroes(b.dataset.growthTab); });
    overlay.querySelectorAll('[data-hero-view]').forEach(b => { b.onclick = () => { heroSkillView = b.dataset.heroView; showHeroes(); }; });
    overlay.querySelectorAll('[data-inspect-hero]').forEach(b => { b.onclick = () => { inspectedHero = b.dataset.inspectHero; showHeroes('heroes'); }; });
    overlay.querySelectorAll('[data-research]').forEach(b => { b.onclick = () => { if (researchTalent(b.dataset.research)) showHeroes('talents'); }; });
    if (heroTab === 'heroes') {
      el('heroGrid').scrollTop = heroListScroll;
      el('equipHero').onclick = () => { if (selectHero(inspectedHero)) showHeroes(); };
      el('trainHero').onclick = () => { if (trainHero(inspectedHero)) showHeroes(); };
    }
    el('start').onclick = start; el('backLobby').onclick = startScreen; updateHUD(); return true;
  }
  function gearCost(id) {
    const level = profile.inventory[id]?.level || 0;
    return { seeds: 35 + level * 25, cores: 1 + Math.floor(level / 4) };
  }
  function equipGear(id) {
    if (!currentAccount || !profile.inventory[id] || !gearDefs[id] || isRunActive()) return false;
    profile.equipped[gearDefs[id].slot] = id; saveProfile(); player = freshPlayer(); updateHUD(); return true;
  }
  function upgradeGear(id) {
    if (!currentAccount) return false;
    const item = profile.inventory[id];
    if (!item || item.level >= 10 || isRunActive()) return false;
    const cost = gearCost(id);
    if (profile.seeds < cost.seeds || profile.cores < cost.cores) return false;
    profile.seeds -= cost.seeds; profile.cores -= cost.cores; item.level++; saveProfile(); player = freshPlayer(); updateHUD(); return true;
  }
  function gearStats(id) {
    const g = gearDefs[id], level = profile.inventory[id]?.level || 0;
    if (g.slot === 'weapon') return '伤害 ' + (g.damage * (1 + level * gearGrowth.damage)).toFixed(1) + ' · 射速 ' + (g.rate * (1 + level * gearGrowth.rate)).toFixed(2) + ' / 秒 · ' + g.shots + ' 籽';
    if (g.slot === 'armor') return '生命 ' + (g.hp + level * gearGrowth.hp) + ' · 每次减伤 ' + (g.defense + level * gearGrowth.defense) + ' · 移速 ' + Math.round(g.speedMult * 100) + '%';
    return '移速 ' + (g.speed + level * gearGrowth.speed) + ' · 拾取 ' + (g.pickup + level * gearGrowth.pickup) + ' · 经验 ' + Math.round(g.xpMult * 100) + '%';
  }
  function showArmory(slot = selectedGearSlot) {
    if (!currentAccount || isRunActive()) return false;
    if (['weapon', 'armor', 'charm'].includes(slot)) selectedGearSlot = slot;
    state = 'armory';
    const groups = [['weapon', '武器', '每级：伤害 +6% 基础值，射速 +2% 基础值'], ['armor', '护甲', '每级：生命 +8，减伤 +0.5'], ['charm', '饰品', '每级：移速 +3，拾取范围 +6']];
    const note = groups.find(([slot]) => slot === selectedGearSlot)[2];
    showMenu('装备工坊', '更换装备 / 永久强化', '<div class="gear-toolbar"><div class="gear-tabs">' + groups.map(([slot, title]) => '<button class="secondary ' + (slot === selectedGearSlot ? 'active' : '') + '" data-gear-slot="' + slot + '">' + title + '</button>').join('') + '</div><span class="gear-note">' + note + '</span></div>' +
      '<div class="gear-grid">' + Object.entries(gearDefs).filter(([, g]) => g.slot === selectedGearSlot).map(([id, g]) => {
        const owned = !!profile.inventory[id], level = profile.inventory[id]?.level || 0, equipped = profile.equipped[selectedGearSlot] === id, cost = gearCost(id);
        const unlock = stages.find(s => s.firstClearGear === id)?.id;
        return '<article class="gear-card ' + (owned ? '' : 'locked') + '"><strong>' + g.icon + ' ' + g.name + '</strong><span>' + g.desc + '</span><span>' + gearStats(id) + '</span>' +
          (owned ? '<small>强化 +' + level + ' / 10</small><div class="gear-actions"><button class="secondary" data-equip="' + id + '" ' + (equipped ? 'disabled' : '') + '>' + (equipped ? '已装备' : '装备') + '</button>' +
            '<button class="secondary" data-enhance="' + id + '" ' + (level >= 10 || profile.seeds < cost.seeds || profile.cores < cost.cores ? 'disabled' : '') + '>' + (level >= 10 ? '已满级' : '强化 · ☀' + cost.seeds + ' ◆' + cost.cores) + '</button></div>' : '<small>第 ' + unlock + ' 关首通获得</small>') + '</article>';
      }).join('') + '</div>', '<button class="primary" id="start">挑战第 ' + selectedStage + ' 关</button><button class="secondary" id="backLobby">返回关卡</button>', 'armory', '切换上方武器 / 护甲 / 饰品按钮查看全部装备 · 强化永久保留');
    el('backLobby').onclick = startScreen; el('start').onclick = start;
    overlay.querySelectorAll('[data-gear-slot]').forEach(b => b.onclick = () => showArmory(b.dataset.gearSlot));
    overlay.querySelectorAll('[data-equip]').forEach(b => b.onclick = () => { if (equipGear(b.dataset.equip)) showArmory(); });
    overlay.querySelectorAll('[data-enhance]').forEach(b => b.onclick = () => { if (upgradeGear(b.dataset.enhance)) showArmory(); });
    updateHUD(); return true;
  }
  function orchardBonuses() {
    const level = profile.orchard.level;
    const bonus = { damage: level * .01, hp: level * 4, speed: 0, pickup: level * 2, rate: 0 };
    for (const id of profile.rescuedSprites) {
      const sprite = rescueDefs[id - 1], power = 1 + (profile.spriteLevels[id] || 0);
      bonus[sprite.bonusType] += sprite.bonusPerLevel * power;
    }
    return bonus;
  }
  function orchardCost() { const level = profile.orchard.level; return { seeds: 50 + level * 35, cores: 1 + Math.floor(level / 4) }; }
  function spriteCost(id) { const level = profile.spriteLevels[id] || 0; return { seeds: 20 + level * 22, cores: 1 + Math.floor(level / 4) }; }
  function canAfford(cost) { return profile.seeds >= cost.seeds && profile.cores >= cost.cores; }
  function upgradeOrchard() {
    if (!currentAccount || profile.orchard.level >= 10 || isRunActive()) return false;
    const cost = orchardCost(); if (!canAfford(cost)) return false;
    profile.seeds -= cost.seeds; profile.cores -= cost.cores; profile.orchard.level++; saveProfile(); player = freshPlayer(); updateHUD(); return true;
  }
  function upgradeSprite(id) {
    if (!currentAccount || !Number.isInteger(id) || !profile.rescuedSprites.includes(id) || profile.spriteLevels[id] >= 5 || isRunActive()) return false;
    const cost = spriteCost(id); if (!canAfford(cost)) return false;
    profile.seeds -= cost.seeds; profile.cores -= cost.cores; profile.spriteLevels[id] = (profile.spriteLevels[id] || 0) + 1;
    saveProfile(); player = freshPlayer(); updateHUD(); return true;
  }
  function bonusText(type, amount) {
    const labels = { damage: '伤害', rate: '射速', hp: '生命', speed: '移速', pickup: '拾取范围' };
    return labels[type] + ' +' + (type === 'damage' || type === 'rate' ? Number((amount * 100).toFixed(1)) + '%' : Number(amount.toFixed(1)));
  }
  function showOrchard() {
    if (!currentAccount) return false;
    if (isRunActive()) return false;
    state = 'orchard'; player = freshPlayer(); updateHUD();
    const cost = orchardCost(), bonus = orchardBonuses(), level = profile.orchard.level;
    const gardenName = level >= 8 ? '丰收乐园' : level >= 5 ? '繁花果园' : level >= 2 ? '嫩芽果园' : '青叶小院';
    if (!profile.rescuedSprites.includes(selectedSprite)) selectedSprite = profile.rescuedSprites[0] || 0;
    const sprite = rescueDefs[selectedSprite - 1], spriteLevel = profile.spriteLevels[selectedSprite] || 0, trainingCost = spriteCost(selectedSprite);
    const detail = sprite ? '<article class="gear-card sprite-detail"><strong>' + sprite.icon + ' ' + sprite.name + ' · +' + spriteLevel + ' / 5</strong><span class="sprite-personality">' + sprite.personality + '</span><span>当前祝福：' + bonusText(sprite.bonusType, sprite.bonusPerLevel * (1 + spriteLevel)) + '</span><small>每次培养：' + bonusText(sprite.bonusType, sprite.bonusPerLevel) + '</small><div class="gear-actions"><button class="secondary" id="growSelectedSprite" data-grow-sprite="' + selectedSprite + '" ' + (spriteLevel >= 5 || !canAfford(trainingCost) ? 'disabled' : '') + '>' + (spriteLevel >= 5 ? '已满级' : '培养 · ☀' + trainingCost.seeds + ' ◆' + trainingCost.cores) + '</button></div></article>' : '<article class="gear-card sprite-detail"><strong>🌱 等待第一位伙伴</strong><span>通关救出精灵后，它们会住进这里。点击园中的精灵，就能查看和培养。</span></article>';
    showMenu(gardenName + ' · LV. ' + level, '我的果园 / 点击居民培养', '<div class="orchard-layout"><div class="orchard-visual"><div class="orchard-scene garden-level-' + Math.floor(level / 3) + '"><div class="garden-sun">☀</div><div class="garden-cloud">☁</div><div class="garden-trees">🌳　🌳　' + (level >= 2 ? '🌸　🌳' : '🌱') + (level >= 5 ? '　🌻　🌳' : '') + '</div><div class="garden-path"></div>' +
      (profile.rescuedSprites.length ? profile.rescuedSprites.map((id, i) => { const sprite = rescueDefs[id - 1], x = 9 + (i % 7) * 13, y = 29 + Math.floor(i / 7) * 24; return '<button class="garden-resident ' + (id === selectedSprite ? 'selected' : '') + '" data-select-sprite="' + id + '" style="left:' + x + '%;top:' + y + '%;--delay:' + (i % 5) * -.35 + 's" title="' + sprite.name + '" aria-label="选择' + sprite.name + '"><span>' + sprite.icon + '</span><small>' + sprite.name + '</small></button>'; }).join('') : '<div class="garden-empty">小院准备好了。<br>击败第 1 关 Boss，带第一位精灵回家。</div>') + '</div>' +
      '<div class="garden-summary"><strong>全队永久加成</strong><span>' + Object.entries(bonus).map(([type, value]) => bonusText(type, value)).join(' · ') + '</span></div></div><div class="orchard-controls">' +
      '<div class="stage-detail"><strong>扩建果园 · ' + level + ' / 10</strong><span>每级全队：伤害 +1%、生命 +4、拾取范围 +2。扩建也会让小院长出更多花草。</span><div class="menu-actions"><button class="secondary" id="growOrchard" ' + (level >= 10 || !canAfford(cost) ? 'disabled' : '') + '>' + (level >= 10 ? '果园已满级' : '扩建 · ☀' + cost.seeds + ' ◆' + cost.cores) + '</button></div></div>' +
      detail + '</div></div>', '<button class="primary" id="start">挑战第 ' + selectedStage + ' 关</button><button class="secondary" id="backLobby">返回关卡</button>', 'orchard', '点击园中的精灵切换培养对象 · 果园与精灵祝福全队共享');
    el('growOrchard').onclick = () => { if (upgradeOrchard()) showOrchard(); };
    overlay.querySelectorAll('[data-select-sprite]').forEach(b => b.onclick = () => { selectedSprite = Number(b.dataset.selectSprite); showOrchard(); });
    overlay.querySelectorAll('[data-grow-sprite]').forEach(b => b.onclick = () => { if (upgradeSprite(Number(b.dataset.growSprite))) showOrchard(); });
    el('backLobby').onclick = startScreen; el('start').onclick = start; return true;
  }
  // Run growth uses the starting build as a baseline; repeated picks never compound.
  function experienceNeed(level) { return experience.need(level); }
  function upgradeBase(p) {
    if (!p.baseStats) p.baseStats = Object.freeze({ damage: p.damage, rate: p.rate, speed: p.speed, pickup: p.pickup, shots: p.shots });
    return p.baseStats;
  }
  function seedDamage(p = player) { return p.damage * upgradeBase(p).shots * (1 + (p.volleyBonus || 0)) / p.shots; }
  function statText(value) { return Number(value.toFixed(1)); }
  const upgradeDefs = builds.defs;
  const rarities = [{ name: '普通', color: '#a9c38d', mult: 1 }, { name: '稀有', color: '#8bd6df', mult: 1.5 }, { name: '史诗', color: '#ddb0ef', mult: 2 }];
  function randomChoices() {
    const pool = builds.pool(player), picked = [], b = player.build;
    function weight(def) {
      const recipe = builds.recipes.find(r => r.attack === def.id || r.attribute === def.id);
      const partner = recipe && (recipe.attack === def.id ? recipe.attribute : recipe.attack);
      return (b.levels[def.id] ? 2.5 : 1) + (partner && b.levels[partner] ? 3 : 0);
    }
    function take(category) {
      const available = pool.filter(def => !category || def.category === category); if (!available.length) return;
      let roll = Math.random() * available.reduce((sum, def) => sum + weight(def), 0), chosen = available.at(-1);
      for (const def of available) { roll -= weight(def); if (roll <= 0) { chosen = def; break; } }
      picked.push(chosen); pool.splice(pool.indexOf(chosen), 1);
    }
    take('attack'); take('attribute'); if (picked.length < 3) take();
    return picked.map(u => {
      const roll = Math.random(), rarity = rarities[roll < .65 ? 0 : roll < .93 ? 1 : 2];
      return { ...u, rarity, desc: u.describe(rarity.mult, player) };
    });
  }
  function start() {
    if (!currentAccount) { showCover(); return false; }
    activeStage = stage(); setMap(activeStage.id); player = freshPlayer(); enemies = []; bullets = []; gems = []; particles = [];
    resetRelics(challengeStarted); challengeStarted = true;
    heroEffects = [];
    elapsed = 0; kills = 0; shotClock = 0; still = 0; shake = 0; choices = []; runRewarded = false;
    cinematicTime = 0; bossIndex = 0; bossKills = 0; nonBossKills = 0; nextBossAllowedAt = 0; bossArrivalUntil = 0; victoryRewardHTML = '';
    runMode = 'stage'; stageVictoryReady = false; endlessEntered = false; endlessWave = 0;
    stageXP = experience.create(activeStage);
    keys.clear(); pointer = null;
    for (let i = 0; i < activeStage.enemyCount; i++) spawn();
    enemies.forEach((enemy, index) => { enemy.xp = activeStage.xpRewards[index]; });
    updateCamera(); state = 'playing'; overlay.classList.add('hidden'); arena.classList.remove('is-lobby'); el('pause').textContent = 'Ⅱ';
    try { audioCtx ??= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume().catch(() => {}); } catch {}
    updateHUD();
    if (!profile.tutorialSeen) openTutorial(true);
  }
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }
  function tutorialSteps() {
    const hero = growth.hero(player.heroId);
    return [
      { icon: '↔', title: '先移动，果子会自动攻击', text: '电脑使用 WASD 或方向键移动。手机按住场地拖动，松手停止。武器会自动攻击虫群，先保持距离，绕开果树与石块。' },
      { icon: '✦', title: '安全时停下来，火力更强', text: '停下 ' + combat.standDelay + ' 秒后蓄力完成：伤害 +35%，射速 +35%。虫群靠近或虫王准备冲锋时，立刻移动避开，找到空隙再站定输出。' },
      { icon: '◆', title: '捡经验，选出你的构筑', text: '击杀掉落发光经验，靠近即可拾取。升级时三选一，也可按 1 / 2 / 3。关卡中攻击与属性各最多 4 种、每种 5 级；配方两项满级后自动合成超级技能。' },
      { icon: hero.skillIcon, title: '施放专属技能，探索特殊饰品', text: '当前英雄：' + hero.name + '，按 E 或右下按钮施放“' + hero.skillName + '”。' + hero.skillDescription + '每局从 50 件饰品随机投放 6 件，按 M 查看位置；拾取后右下角显示效果。' },
      { icon: '⚠', title: '留意虫群苏醒和虫王预警', text: '普通虫与精英按时间逐批加入。第 ' + activeStage.id + ' 关首位虫王最早 ' + activeStage.bossSchedule[0] + ' 秒到达，场上最多 1 位，击败后至少有 ' + combat.bossRecovery + ' 秒间隔。看到冲锋预警就绕开攻击方向。' },
      { icon: '♧', title: '救回精灵，继续守护果园', text: '清理本关全部虫群与虫王即可通关，材料自动保存，可培养果园、精灵、英雄和装备。通关后可进入无尽，突破肉鸽种类与等级上限。P / Esc 暂停；“提示词”按钮可重看引导和开发对话。' }
    ];
  }
  function renderGameHelp() {
    const guide = helpTab === 'guide', steps = tutorialSteps(), step = steps[tutorialStep];
    const outside = !['playing', 'paused'].includes(helpReturnState);
    const tabs = '<div class="help-tabs"><button class="secondary ' + (!guide ? 'active' : '') + '" id="viewConversation" aria-pressed="' + !guide + '">提示词 / 对话</button><button class="secondary ' + (guide ? 'active' : '') + '" id="viewTutorial" aria-pressed="' + guide + '">新手引导</button></div>';
    const conversation = window.ORCHARD_CONVERSATION || { description: '当前版本尚未载入对话记录。', messages: [] };
    const content = guide ? '<div class="tutorial-progress" aria-label="引导第 ' + (tutorialStep + 1) + ' 步，共 ' + steps.length + ' 步">' + steps.map((_, index) => '<span class="' + (index === tutorialStep ? 'active' : index < tutorialStep ? 'done' : '') + '"></span>').join('') + '</div><div class="help-layout tutorial-layout"><article class="help-card"><span class="tutorial-step">新手引导 ' + (tutorialStep + 1) + ' / ' + steps.length + '</span><div class="tutorial-visual" aria-hidden="true">' + step.icon + '</div><strong class="tutorial-title">' + step.title + '</strong><p class="tutorial-text">' + step.text + '</p></article></div>' :
      '<div class="help-context">' + escapeHTML(conversation.description) + '</div><div class="conversation-list" tabindex="0" aria-label="开发对话记录">' + conversation.messages.map((message, index) => '<article class="conversation-message ' + (message.role === 'assistant' ? 'assistant' : 'user') + '"><div class="conversation-role">' + (message.role === 'assistant' ? 'Codex' : '你') + ' · ' + String(index + 1).padStart(2, '0') + '</div><div class="conversation-copy">' + escapeHTML(message.text) + '</div></article>').join('') + '</div>';
    const actions = guide ? '<button class="secondary" id="previousTutorial" ' + (!tutorialStep ? 'disabled' : '') + '>上一步</button><button class="secondary" id="closeGameHelp">' + (tutorialIsFirstRun ? '跳过引导' : outside ? '返回局外' : '返回游戏') + '</button><button class="primary" id="nextTutorial">' + (tutorialStep === steps.length - 1 ? tutorialIsFirstRun ? '开始守护' : '完成引导' : '下一步 →') + '</button>' : '<button class="primary" id="closeGameHelp">' + (outside ? '返回局外' : helpReturnState === 'paused' ? '返回暂停菜单' : '继续游戏') + '</button>';
    showPanel(guide ? '欢迎来到果园' : '我们的开发对话', guide ? '新手引导 / 随时可以重看' : '提示词记录 / 果园保卫战', tabs + content, actions, outside ? '查看开发对话与新手引导 · 关闭后返回原页面' : '阅读期间，战斗、虫群登场与技能冷却均已暂停');
    overlay.classList.add('help-overlay');
    overlay.setAttribute?.('role', 'dialog'); overlay.setAttribute?.('aria-modal', 'true'); overlay.setAttribute?.('aria-label', guide ? '新手引导' : '提示词与开发对话');
    el('viewConversation').onclick = () => { helpTab = 'conversation'; renderGameHelp(); };
    el('viewTutorial').onclick = () => { helpTab = 'guide'; tutorialStep = 0; renderGameHelp(); };
    el('closeGameHelp').onclick = closeGameHelp;
    if (guide) {
      el('previousTutorial').onclick = () => { if (tutorialStep > 0) { tutorialStep--; renderGameHelp(); } };
      el('nextTutorial').onclick = nextTutorial;
    }
    (guide ? el('nextTutorial') : el('closeGameHelp')).focus?.();
  }
  function openGameHelp() {
    if (!currentAccount || !['lobby', 'heroes', 'armory', 'orchard', 'relicMap', 'playing', 'paused'].includes(state) || (state === 'relicMap' && isRunActive())) return false;
    helpReturnState = state; helpTab = 'conversation'; tutorialStep = 0; tutorialIsFirstRun = false;
    state = 'help'; keys.clear(); pointer = null; renderGameHelp(); updateHUD(); return true;
  }
  function openTutorial(firstRun = false) {
    if (!['playing', 'paused'].includes(state)) return false;
    helpReturnState = state; helpTab = 'guide'; tutorialStep = 0; tutorialIsFirstRun = firstRun;
    state = 'help'; keys.clear(); pointer = null; renderGameHelp(); updateHUD(); return true;
  }
  function nextTutorial() {
    if (state !== 'help' || helpTab !== 'guide') return false;
    if (tutorialStep < tutorialSteps().length - 1) { tutorialStep++; renderGameHelp(); }
    else closeGameHelp();
    return true;
  }
  function closeGameHelp() {
    if (state !== 'help') return false;
    if (tutorialIsFirstRun) { profile.tutorialSeen = true; saveProfile(); tutorialIsFirstRun = false; }
    keys.clear(); pointer = null; overlay.classList.remove('help-overlay');
    if (helpReturnState === 'paused') { state = 'playing'; pause(); }
    else if (helpReturnState === 'lobby') { state = 'lobby'; renderLobby(previewStage); }
    else if (helpReturnState === 'heroes') showHeroes();
    else if (helpReturnState === 'armory') showArmory();
    else if (helpReturnState === 'orchard') showOrchard();
    else if (helpReturnState === 'relicMap') { state = 'relicMap'; showRelicMap(); }
    else { resume(); el('gameHelp').focus?.(); }
    updateHUD(); return true;
  }
  function sound(freq, length = .05, volume = .015) {
    if (!audioCtx || audioCtx.state !== 'running') return;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(freq, audioCtx.currentTime); o.frequency.exponentialRampToValueAtTime(freq * .5, audioCtx.currentTime + length);
    g.gain.setValueAtTime(volume, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + length);
    o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + length);
  }
  function pause() {
    if (state === 'playing') {
      state = 'paused'; keys.clear(); pointer = null;
      showPanel('喘口气，再出发。', '果园小憩 / 第 ' + activeStage.id + ' 关', '<p>战斗与虫群苏醒已暂停。</p>', '<button class="primary" id="resume">继续清剿</button><button class="secondary" id="leave">放弃本次挑战</button>', '放弃本次挑战不会获得通关奖励');
      if (runMode === 'endless') showPanel('喘口气，再出发。', '无尽虫潮 / 第 ' + endlessWave + ' 波', '<p>无尽波次与战斗已暂停，已获得的材料已经保存。</p>', '<button class="primary" id="resume">继续无尽</button><button class="secondary" id="leave">结束无尽并结算</button>');
      el('resume').onclick = resume; el('leave').onclick = runMode === 'endless' ? () => finishEndless(true) : startScreen; el('pause').textContent = '▶';
    } else if (state === 'paused') resume();
  }
  function resume() { state = 'playing'; overlay.classList.add('hidden'); el('pause').textContent = 'Ⅱ'; }
  function grantVictoryRewards() {
    if (!runRewarded) {
      runRewarded = true;
      stageVictoryReady = true;
      const firstClear = !profile.clearedStages.includes(activeStage.id);
      const seeds = firstClear ? activeStage.reward.seeds : Math.max(1, Math.floor(activeStage.reward.seeds * .25));
      const cores = firstClear ? activeStage.reward.cores : Math.max(1, Math.floor(activeStage.reward.cores * .25));
      profile.seeds += seeds; profile.cores += cores;
      if (firstClear) profile.clearedStages.push(activeStage.id);
      profile.unlockedStage = Math.max(profile.unlockedStage, Math.min(stages.length, activeStage.id + 1));
      let gear = '';
      if (firstClear && activeStage.firstClearGear) {
        const id = activeStage.firstClearGear;
        profile.inventory[id] ??= { level: 0 };
        gear = '<br>新装备：' + gearDefs[id].icon + ' ' + gearDefs[id].name;
      }
      const newHeroes = firstClear ? growth.heroes.filter(hero => hero.unlockStage === activeStage.id).map(hero => hero.icon + ' ' + hero.name).join('、') : '';
      if (newHeroes) gear += '<br>新英雄：' + newHeroes + '（英雄育成中选择）';
      const resident = rescueDefs[(activeStage.id - 1) % rescueDefs.length], newResident = !profile.rescuedSprites.includes(resident.id);
      if (newResident) { profile.rescuedSprites.push(resident.id); profile.spriteLevels[resident.id] = 0; }
      saveProfile();
      victoryRewardHTML = '<div class="reward-box">' + (firstClear ? '首通奖励' : '重复通关奖励（首通的 25%，至少 1）') + '<strong>☀ 阳光籽 +' + seeds + '　◆ 果核 +' + cores + '</strong>' + gear +
        '<br>' + resident.icon + ' ' + resident.name + (newResident ? '已安置到果园' : '的家园再次得到守护') + '<small>' + (storageAvailable ? '奖励、精灵和关卡进度已保存' : '存储不可用，请保持本页面打开') + '</small></div>';
    }
  }
  function finish(win) {
    if (!currentAccount) return false;
    if (runMode === 'endless') { finishEndless(win); return; }
    if (state === 'ended') return;
    state = 'ended'; keys.clear(); pointer = null;
    if (win) grantVictoryRewards();
    showPanel(win ? '青叶果园，平安无恙。' : '小果子，歇一歇。', '第 ' + activeStage.id + ' 关 / ' + activeStage.name, '<div class="result-layout"><div class="result-summary"><p>' +
      (win ? '本关 ' + activeStage.bossCount + ' 位虫王已全部击败，精灵已经回家。' : '虫群暂时占了上风。培养精灵、强化装备后，再试一次。') + '</p>' + (win ? victoryRewardHTML : '') +
      '<div class="result-stats"><div><b>' + kills + ' / ' + activeStage.enemyCount + '</b><span>驱赶害虫</span></div><div><b>' + player.level + '</b><span>本关成长等级</span></div></div>' +
      '</div>' + (win ? '<div class="endless-offer"><strong>∞ 无尽虫潮 · 突破成长</strong><span>保留本关构筑，补满生命，放开种类与等级上限。<br>每 8 秒一波，材料获得即保存，可随时结束。</span></div>' : '<div class="endless-offer"><strong>🌱 下一次，带着成长出发。</strong><span>到果园培养伙伴，或在工坊强化装备。局外成长永久保留。</span></div>') + '</div>',
      (win ? '<button class="primary" id="startEndless">进入无尽模式 ∞</button>' : '') + (win && activeStage.id < stages.length ? '<button class="secondary" id="nextStage">挑战下一关</button>' : '<button class="secondary" id="restart">再挑战一次</button>') + '<button class="secondary" id="resultOrchard">看看果园</button><button class="secondary" id="resultArmory">装备与养成</button><button class="secondary" id="backLobby">选择关卡</button>', '奖励与关卡进度自动保存');
    if (win && activeStage.id < stages.length) el('nextStage').onclick = () => { selectStage(activeStage.id + 1); start(); };
    else el('restart').onclick = start;
    el('resultArmory').onclick = showArmory; el('backLobby').onclick = startScreen;
    el('resultOrchard').onclick = showOrchard; updateHUD();
    if (win) el('startEndless').onclick = startEndless;
    sound(win ? 660 : 180, .3, .03);
  }
  function startEndless() {
    if (state !== 'ended' || runMode !== 'stage' || !stageVictoryReady || endlessEntered) return false;
    endlessEntered = true; runMode = 'endless'; state = 'playing'; enemies = []; bullets = []; particles = []; skillEffects = []; heroEffects = [];
    builds.setMode(player, 'endless');
    // Keep the chapter's earned upgrades and unlock further growth for the next challenge.
    player.hp = player.maxHp; player.inv = 1.5; elapsed = 0; kills = 0; still = 0; shake = 0; shotClock = 0;
    player.guardUntil = 0; player.guardDefense = 0; player.leechEvents = []; player.killHealEvents = [];
    endlessWave = 0; endlessCreditedSeeds = 0; endlessCreditedCores = 0; waveClock = ENDLESS_INTERVAL;
    keys.clear(); pointer = null; overlay.classList.add('hidden'); el('pause').textContent = 'Ⅱ';
    spawnEndlessWave(); updateHUD();
    if (player.xp >= player.need) upgrade();
    return true;
  }
  function spawnEndlessWave() {
    if (runMode !== 'endless') return false;
    endlessWave++;
    const count = Math.min(endlessTuning.batchCap, activeStage.initialPursuers + endlessTuning.openingBonus + (endlessWave - 1) * endlessTuning.perWave);
    const available = Math.max(0, ENDLESS_ENEMY_CAP - enemies.length);
    for (let i = 0; i < Math.min(count, available); i++) {
      let x, y;
      for (let attempt = 0; attempt < 30; attempt++) {
        const a = Math.random() * Math.PI * 2, distance = 590 + Math.random() * 170;
        x = Math.max(40, Math.min(WORLD_W - 40, player.x + Math.cos(a) * distance));
        y = Math.max(40, Math.min(WORLD_H - 40, player.y + Math.sin(a) * distance));
        if (Math.hypot(x - player.x, y - player.y) >= 350) break;
      }
      if (Math.hypot(x - player.x, y - player.y) < 350) { x = player.x < WORLD_W / 2 ? WORLD_W - 40 : 40; y = player.y; }
      const type = Math.random() < Math.min(.7, activeStage.fastCount / activeStage.normalCount + endlessWave * .004) ? 1 : 0;
      const base = type ? activeStage.fast : activeStage.slow;
      const point = world.safePoint(x, y, (type ? 15 : 19) + 22, obstacles, WORLD_W, WORLD_H); x = point.x; y = point.y;
      enemies.push({ x, y, type, r: type ? 15 : 19, hp: Math.round(base.hp * (1 + endlessWave * endlessTuning.hp + endlessWave ** 2 * endlessTuning.hpCurve)),
        damage: Math.round(base.damage * (1 + endlessWave * endlessTuning.damage)), speed: base.speed * Math.min(endlessTuning.speedCap, 1 + endlessWave * endlessTuning.speed),
        xp: activeStage.experience.typical[type ? 'fast' : 'slow'] + Math.floor(endlessWave / endlessTuning.xpEvery), pursuitAt: 0, aggro: true, phase: Math.random() * 6, flash: 0 });
    }
    return true;
  }
  function bankEndlessRewards() {
    if (runMode !== 'endless') return;
    const seeds = Math.floor(kills / 5) * (2 + Math.floor(activeStage.id / 5)), cores = Math.floor(kills / 40);
    const extraSeeds = Math.max(0, seeds - endlessCreditedSeeds), extraCores = Math.max(0, cores - endlessCreditedCores);
    if (extraSeeds || extraCores) {
      profile.seeds += extraSeeds; profile.cores += extraCores;
      endlessCreditedSeeds = seeds; endlessCreditedCores = cores; saveProfile();
    }
  }
  function finishEndless(voluntary = false) {
    if (runMode !== 'endless' || state === 'ended') return false;
    bankEndlessRewards(); state = 'ended'; keys.clear(); pointer = null; bullets = [];
    const time = Math.floor(elapsed), minutes = Math.floor(time / 60), seconds = String(time % 60).padStart(2, '0');
    showPanel(voluntary ? '把收获带回果园。' : '虫潮暂时占了上风。', '第 ' + activeStage.id + ' 关 / 无尽虫潮结算', '<div class="result-layout"><div class="result-summary"><p>通关、救援与无尽材料都已保存。</p>' +
      '<div class="result-stats"><div><b>' + minutes + ':' + seconds + '</b><span>坚持时长</span></div><div><b>' + endlessWave + '</b><span>抵达波次</span></div><div><b>' + kills + '</b><span>无尽击杀</span></div></div>' +
      '</div><div class="reward-box">本次无尽额外收获<strong>☀ 阳光籽 +' + endlessCreditedSeeds + '　◆ 果核 +' + endlessCreditedCores + '</strong><small>材料获得时即保存，结算不重复发放</small></div></div>',
      '<button class="primary" id="resultOrchard">返回果园</button>' + (activeStage.id < stages.length ? '<button class="secondary" id="nextStage">挑战下一关</button>' : '<button class="secondary" id="restart">重玩本关</button>') + '<button class="secondary" id="backLobby">选择关卡</button>');
    el('resultOrchard').onclick = showOrchard; el('backLobby').onclick = startScreen;
    if (activeStage.id < stages.length) el('nextStage').onclick = () => { selectStage(activeStage.id + 1); start(); }; else el('restart').onclick = start;
    updateHUD(); return true;
  }
  function readyBoss() {
    if (elapsed < nextBossAllowedAt) return null;
    const active = enemies.filter(e => e.boss && e.introduced && e.hp > 0).length;
    if (active >= activeStage.bossActiveCap) return null;
    return enemies.find(e => e.boss && !e.introduced && e.hp > 0 && elapsed >= e.bossArrivalAt) || null;
  }
  function announceBossArrival() {
    if (state !== 'playing' || runMode !== 'stage') return false;
    const boss = readyBoss(); if (!boss) return false;
    boss.introduced = true; bossIndex++;
    const angle = Math.random() * Math.PI * 2;
    boss.x = Math.max(boss.r + 25, Math.min(WORLD_W - boss.r - 25, player.x + Math.cos(angle) * 235));
    boss.y = Math.max(boss.r + 25, Math.min(WORLD_H - boss.r - 25, player.y + Math.sin(angle) * 235));
    const point = world.safePoint(boss.x, boss.y, boss.r + 22, obstacles, WORLD_W, WORLD_H); boss.x = point.x; boss.y = point.y;
    boss.pursuitAt = elapsed; boss.aggro = true; boss.chargeClock = Math.min(3, boss.chargeInterval);
    bossArrivalUntil = elapsed + 4;
    burst(boss.x, boss.y, boss.color, 14); sound(110, .4, .04); updateHUD(); return true;
  }
  function beginRescue() {
    if (state === 'rescue' || state === 'ended') return false;
    const sprite = rescueDefs[(activeStage.id - 1) % rescueDefs.length];
    state = 'rescue'; cinematicTime = 0; keys.clear(); pointer = null; bullets = []; still = 0;
    // Save the actual win immediately; closing during the rescue movie does not lose rewards.
    grantVictoryRewards(); updateHUD();
    showPanel(sprite.name + '，自由啦！', '救援成功 / 精灵回家', '<div class="cinematic rescue-cinematic" style="--accent:' + sprite.color + '"><div class="rescue-stage"><div class="rescue-glow"></div><div class="rescue-cage"><i></i><i></i><i></i><i></i></div><span class="rescued-hero">' + sprite.icon + '</span><span class="rescue-spark spark-one">✦</span><span class="rescue-spark spark-two">✦</span><span class="rescue-spark spark-three">✦</span><div class="rescue-ground">🌿　🌸　🌿</div></div><p>“' + sprite.personality + '”<br>当前祝福：' + bonusText(sprite.bonusType, sprite.bonusPerLevel * (1 + profile.spriteLevels[sprite.id])) + '。</p></div>', '<button class="primary" id="settleSprite">完成救援 · 跳过动画</button>', '精灵已安置，进度已经保存 · Enter 可跳过');
    el('settleSprite').onclick = completeRescue; sound(720, .4, .03); return true;
  }
  function completeRescue() { if (state !== 'rescue') return false; finish(true); return true; }
  function checkStageCompletion() {
    if (runMode !== 'stage' || enemies.length || bossKills < activeStage.bossCount || nonBossKills < activeStage.normalCount + activeStage.eliteCount) return false;
    // Finish the exact XP budget once, including every crystal left anywhere on the map.
    if (!stageXP.settled) {
      stageXP.finish(); player.xp += stageXP.collect(stageXP.issued - stageXP.collected); gems = [];
      grantVictoryRewards();
    }
    if (player.xp >= player.need) { upgrade(); return true; }
    beginRescue(); return true;
  }
  function upgrade() {
    choices = randomChoices();
    if (!choices.length) {
      let levels = 0;
      while (player.xp >= player.need) { player.xp -= player.need; player.level++; player.need = experienceNeed(player.level); healPlayer(player.maxHp * .25); levels++; }
      if (levels) queueNotice('构筑已完成', '升级 ' + levels + ' 次，每次恢复最大生命的 25%；词条槽位和等级保持上限。', '♥', '#bce4a0', 'supply');
      state = 'playing'; overlay.classList.add('hidden'); updateHUD(); return;
    }
    state = 'upgrade'; keys.clear(); pointer = null;
    const b = player.build, endless = runMode === 'endless';
    const rule = endless ? '无尽突破：攻击 ' + b.attackSlots.length + ' 种 · 属性 ' + b.attributeSlots.length + ' 种 · 词条等级持续成长' : '攻击 ' + b.attackSlots.length + ' / 4 种 · 属性 ' + b.attributeSlots.length + ' / 4 种 · 每种最高 5 级';
    showPanel(endless ? '继续突破成长' : '选择你的成长', 'LEVEL UP / LV. ' + (player.level + 1), '<div class="build-limit">' + rule + '<br>配对攻击与属性达到 5 级，自动合成。' + (endless ? '合成后继续升级攻击可强化超级技能。' : '已有词条与配方伙伴更容易出现。') + '</div><div class="cards" style="--choices:' + choices.length + '">' + choices.map((u, i) => {
      const level = b.levels[u.id] || 0, recipe = builds.recipes.find(r => r.id === u.recipe);
      return '<button class="card" data-choice="' + i + '" style="border-color:' + u.rarity.color + '"><div class="build-category" style="color:' + (u.category === 'attack' ? '#f6c18a' : '#aee3c0') + '">' + (u.category === 'attack' ? '攻击 · 火力技能' : '属性 · 生存成长') + '</div><div class="card-icon" style="color:' + u.rarity.color + '">' + u.icon + '</div><strong>' + u.name + '</strong><span>' + u.desc + '</span><small style="color:' + u.rarity.color + '">' + u.rarity.name + ' · ' + level + ' → ' + (level + 1) + (endless ? ' 级 · ' : ' / 5 级 · ') + (level ? '继续培养' : '学习新词条') + '<br>按 ' + (i + 1) + ' 选择</small>' + (recipe ? '<div class="recipe-progress">' + (b.superSkills.includes(recipe.id) ? '✓ 已合成 ' + recipe.icon + ' ' + recipe.name + (endless ? ' · 可继续强化' : '') : builds.get(recipe.attack).name + ' ' + (b.levels[recipe.attack] || 0) + '/5 ＋ ' + builds.get(recipe.attribute).name + ' ' + (b.levels[recipe.attribute] || 0) + '/5<br>→ ' + recipe.icon + ' ' + recipe.name) + '</div>' : '') + '</button>';
    }).join('') + '</div>', '', (endless ? '无尽随机成长 · 等级持续提升' : '本关总经验 ' + stageXP.budget.toLocaleString('en-US') + ' · ' + experience.choices + ' 次升级' + (stageXP.settled ? ' · 完成成长后救援' : '')) + ' · 战斗已暂停 · 按 1 / 2 / 3 选择');
    overlay.classList.add('upgrade-overlay');
    overlay.querySelectorAll('[data-choice]').forEach(b => b.onclick = () => choose(Number(b.dataset.choice))); sound(620, .14);
  }
  function choose(i) {
    if (state !== 'upgrade' || !choices[i]) return;
    const u = choices[i], result = builds.choose(player, u.id, u.rarity.mult); if (!result.applied) return;
    for (const recipe of result.newSuper) queueNotice(recipe.name, recipe.description, recipe.icon, recipe.color, 'super');
    player.xp -= player.need; player.level++; player.need = experienceNeed(player.level);
    state = 'playing'; still = 0; overlay.classList.add('hidden'); updateHUD();
    if (player.xp >= player.need) upgrade(); else checkStageCompletion();
  }
  el('pause').onclick = () => state === 'help' ? closeGameHelp() : pause();
  el('loginForm').onsubmit = event => { event.preventDefault(); void submitLogin(); };
  el('togglePassword').onclick = () => {
    const showPassword = el('loginPassword').type === 'password';
    el('loginPassword').type = showPassword ? 'text' : 'password'; el('togglePassword').textContent = showPassword ? '隐藏' : '显示';
    el('togglePassword').setAttribute?.('aria-pressed', String(showPassword));
  };
  el('logoutAccount').onclick = logoutAccount;
  el('gameHelp').onclick = () => state === 'help' ? closeGameHelp() : openGameHelp();
  el('endEndless').onclick = () => ['playing', 'paused'].includes(state) ? finishEndless(true) : false;
  el('openRelicMap').onclick = showRelicMap;
  el('dashSkill').onclick = activateDash;
  el('heroSkill').onclick = activateHeroSkill;
  addEventListener('keydown', e => {
    if (state === 'cover') return;
    if (state !== 'help' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (state === 'help') {
      if (k === 'tab') {
        const focusable = [...overlay.querySelectorAll('button, [tabindex="0"]')].filter(node => !node.disabled);
        const first = focusable[0], last = focusable.at(-1), active = document.activeElement;
        if (first && (e.shiftKey && active === first || !e.shiftKey && active === last || !focusable.includes(active))) {
          e.preventDefault(); (e.shiftKey ? last : first).focus?.();
        }
      }
      else if (['escape', 'h', 'p'].includes(k)) { e.preventDefault(); closeGameHelp(); }
      else if (k === 'enter' && helpTab === 'guide' && !e.target?.closest?.('button')) { e.preventDefault(); nextTutorial(); }
      return;
    }
    if (k === 'h') { openGameHelp(); return; }
    if (state === 'lobby' && ['arrowleft', 'arrowright'].includes(k)) { browseStage(k === 'arrowleft' ? -1 : 1); return; }
    if (k === 'm' || (k === 'escape' && state === 'relicMap')) { if (state === 'relicMap') closeRelicMap(); else showRelicMap(); return; }
    if (k === ' ') { activateDash(); return; }
    if (k === 'e') { activateHeroSkill(); return; }
    if (k === 'enter' && state === 'rescue') { completeRescue(); return; }
    if (k === 'p' || k === 'escape') { pause(); return; }
    if (state === 'upgrade' && ['1', '2', '3'].includes(k)) { choose(Number(k) - 1); return; }
    keys.add(k);
  });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => { keys.clear(); pointer = null; if (state === 'playing') pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pause(); });
  arena.addEventListener('pointerdown', e => {
    if (state !== 'playing' || e.target.closest('button')) return;
    pointer = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY }; arena.setPointerCapture(e.pointerId);
  });
  arena.addEventListener('pointermove', e => { if (pointer?.id === e.pointerId) { pointer.x = e.clientX; pointer.y = e.clientY; } });
  function release(e) { if (pointer?.id === e.pointerId) pointer = null; }
  arena.addEventListener('pointerup', release); arena.addEventListener('pointercancel', release);
  function burst(x, y, color, n = 8) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = 35 + Math.random() * 100; particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: .35 + Math.random() * .25, max: .6, color }); }
  }
  function dropExperience(x, y, value) {
    let nearest = null, distance = Infinity;
    for (const gem of gems) { const d = (gem.x - x) ** 2 + (gem.y - y) ** 2; if (d < distance) { distance = d; nearest = gem; } }
    if (nearest && (distance < 26 ** 2 || gems.length >= XP_NODE_CAP)) nearest.value += value;
    else gems.push({ x, y, value });
  }
  function spawn() {
    const index = enemies.length, s = activeStage; let x, y;
    if (index >= s.normalCount + s.eliteCount) {
      const bossOrder = index - s.normalCount - s.eliteCount, boss = bossDefs[s.bossIds[bossOrder] - 1];
      if (!boss) return;
      enemies.push({ x: player.x, y: player.y, type: 2, boss: true, r: boss.radius, ...boss, maxHp: boss.hp, xp: s.fast.xp * 8,
        bossOrder, bossArrivalAt: s.bossSchedule[bossOrder], introduced: false,
        pursuitAt: Infinity, aggro: false, phase: 0, flash: 0, chargeClock: Math.min(1.8, boss.chargeInterval), windup: 0, dashTime: 0, dashX: 0, dashY: 0 });
      return;
    }
    if (index < s.initialPursuers) {
      const angle = index / s.initialPursuers * Math.PI * 2 + (Math.random() - .5) * .4, radius = 380 + Math.random() * 140;
      x = player.x + Math.cos(angle) * radius; y = player.y + Math.sin(angle) * radius;
    } else {
      do { x = 40 + Math.random() * (WORLD_W - 80); y = 40 + Math.random() * (WORLD_H - 80); } while (Math.hypot(x - player.x, y - player.y) < 340);
    }
    const spawnRadius = index >= s.normalCount ? 25 : 19;
    const point = world.safePoint(x, y, spawnRadius + 22, obstacles, WORLD_W, WORLD_H); x = point.x; y = point.y;
    if (index >= s.normalCount) {
      const eliteIndex = index - s.normalCount, pursuitAt = s.eliteFirstAt + Math.floor(eliteIndex / s.eliteBatchSize) * s.eliteInterval;
      enemies.push({ x, y, type: 0, elite: true, r: 25, ...s.elite, maxHp: s.elite.hp,
        pursuitAt, aggro: false, phase: Math.random() * 6, flash: 0 });
      return;
    }
    // Evenly distribute the exact configured flying-insect count through normal batches.
    const type = Math.floor((index + 1) * s.fastCount / s.normalCount) > Math.floor(index * s.fastCount / s.normalCount) ? 1 : 0;
    const stats = type ? s.fast : s.slow;
    const pursuitAt = index < s.initialPursuers ? 0 : (1 + Math.floor((index - s.initialPursuers) / s.batchSize)) * s.pursuitInterval;
    enemies.push({ x, y, type, elite: false, r: type ? 15 : 19, ...stats, pursuitAt, aggro: pursuitAt === 0, phase: Math.random() * 6, flash: 0 });
  }
  function shoot(boost, overclock = 1) {
    let target = null, best = Infinity;
    for (const e of enemies) {
      if (e.hp <= 0 || !e.aggro) continue;
      const d = (e.x - player.x) ** 2 + (e.y - player.y) ** 2;
      if (d < best && !world.blocksSegment(player.x, player.y, e.x, e.y, obstacles, 2)) { best = d; target = e; }
    }
    if (!target || best > player.weaponRange * player.weaponRange) return;
    const angle = Math.atan2(target.y - player.y, target.x - player.x);
    // Keep high-count builds aimed at the target instead of spreading behind the player.
    // Dense long-run builds fuse seeds into stronger projectiles without losing total firepower.
    const count = Math.min(16, player.shots), fusion = player.shots / count * overclock;
    const spread = Math.min(.15, .8 / Math.max(1, count - 1));
    for (let i = 0; i < count; i++) {
      const a = angle + (i - (count - 1) / 2) * spread;
      const critical = player.critChance > 0 && Math.random() < player.critChance;
      const pierces = Math.floor(player.pierce) + (player.pierce % 1 > 0 && Math.random() < player.pierce % 1 ? 1 : 0);
      const speed = 450 * player.projectileSpeedMult;
      bullets.push({ x: player.x + Math.cos(a) * 20, y: player.y + Math.sin(a) * 20, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        damage: seedDamage() * (boost ? combat.standDamage + player.standPower : 1) * fusion * (critical ? player.critMultiplier : 1), size: Math.min(8, 5 + Math.log2(Math.max(1, fusion)) * .4), life: Math.max(1.6, player.weaponRange / speed + .25),
        critical, color: critical ? '#ffdf83' : player.bulletColor, pierces, hitTargets: new Set() });
    }
    sound(boost ? 530 : 430, .035, .008);
  }
  function placeAwakeningEnemy(enemy) {
    if (enemy.boss || Math.hypot(enemy.x - player.x, enemy.y - player.y) <= 900) return;
    // Large-map reinforcements arrive outside the viewport, instead of spending a minute crossing the orchard.
    // Only a dormant enemy's first scheduled awakening can change its location.
    for (let attempt = 0; attempt < 16; attempt++) {
      const angle = Math.random() * Math.PI * 2, distance = 640 + Math.random() * 160;
      const x = Math.max(enemy.r + 22, Math.min(WORLD_W - enemy.r - 22, player.x + Math.cos(angle) * distance));
      const y = Math.max(enemy.r + 22, Math.min(WORLD_H - enemy.r - 22, player.y + Math.sin(angle) * distance));
      const margin = enemy.r + 25;
      const outsideView = x + margin < camera.x || x - margin > camera.x + W || y + margin < camera.y || y - margin > camera.y + H;
      if (Math.hypot(x - player.x, y - player.y) >= 640 && outsideView && world.isFree(x, y, enemy.r + 22, obstacles, WORLD_W, WORLD_H)) { enemy.x = x; enemy.y = y; return; }
    }
    // Vertical fallback remains outside the viewport even when the camera is clamped at a corner.
    for (let i = 0; i < 64; i++) {
      const angle = (player.y < WORLD_H / 2 ? Math.PI / 2 : -Math.PI / 2) + i / 64 * Math.PI * 2;
      const x = player.x + Math.cos(angle) * 780, y = player.y + Math.sin(angle) * 780, margin = enemy.r + 25;
      const outsideView = x + margin < camera.x || x - margin > camera.x + W || y + margin < camera.y || y - margin > camera.y + H;
      if (outsideView && world.isFree(x, y, enemy.r + 22, obstacles, WORLD_W, WORLD_H)) { enemy.x = x; enemy.y = y; return; }
    }
    const point = world.safePoint(Math.max(enemy.r + 22, Math.min(WORLD_W - enemy.r - 22, player.x)), player.y + (player.y < WORLD_H / 2 ? 780 : -780), enemy.r + 22, obstacles, WORLD_W, WORLD_H);
    enemy.x = point.x; enemy.y = point.y;
  }
  function update(dt) {
    elapsed += dt;
    if (runMode === 'endless') {
      waveClock -= dt;
      if (waveClock <= 0) { spawnEndlessWave(); waveClock += ENDLESS_INTERVAL; }
    }
    const direction = movementVector();
    if (direction.moving) {
      const movement = world.move(player, direction.x * player.speed * dt, direction.y * player.speed * dt, obstacles, WORLD_W, WORLD_H);
      player.x = Math.max(28, Math.min(WORLD_W - 28, player.x)); player.y = Math.max(28, Math.min(WORLD_H - 28, player.y));
      player.facingX = direction.x; player.facingY = direction.y; if (movement.distance > 1e-5) still = 0; else still += dt;
    } else still += dt;
    updateCamera(); const boost = still >= combat.standDelay; player.inv = Math.max(0, player.inv - dt); shake = Math.max(0, shake - dt * 20);
    player.sinceHit += dt;
    if (player.regen > 0 && player.sinceHit > player.regenDelay) player.hp = Math.min(player.maxHp, player.hp + player.regen * Math.min(dt, player.sinceHit - player.regenDelay));
    // Scheduled activation happens before targeting or collisions. Dormant enemies never interact.
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      const awake = elapsed >= e.pursuitAt;
      if (awake && !e.aggro) placeAwakeningEnemy(e);
      e.aggro = awake; e.flash = Math.max(0, e.flash - dt);
    }
    for (const drop of relicDrops) if (!drop.claimed && Math.hypot(drop.x - player.x, drop.y - player.y) <= 56) claimRelic(drop.id);
    updateSkills(dt);
    navigator.beginFrame(player.x, player.y, dt);
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      if (!e.aggro) continue;
      const dx = player.x - e.x, dy = player.y - e.y, d = Math.hypot(dx, dy) || 1;
      const speedScale = elapsed < (e.slowUntil || 0) ? 1 - e.slowAmount : 1;
      if (e.boss) {
        e.chargeClock -= dt;
        if (e.windup > 0) {
          e.windup = Math.max(0, e.windup - dt);
          if (e.windup === 0) e.dashTime = .7;
        } else if (e.dashTime > 0) {
          e.dashTime = Math.max(0, e.dashTime - dt);
          const movement = world.move(e, e.dashX * e.chargeSpeed * speedScale * dt, e.dashY * e.chargeSpeed * speedScale * dt, obstacles, WORLD_W, WORLD_H);
          if (movement.blocked) e.dashTime = 0;
        } else if (e.chargeClock <= 0) {
          e.windup = .9; e.dashX = dx / d; e.dashY = dy / d; e.chargeClock = e.chargeInterval;
        } else navigator.moveEnemy(e, player.x, player.y, e.speed * speedScale, dt);
        e.x = Math.max(e.r + 22, Math.min(WORLD_W - e.r - 22, e.x)); e.y = Math.max(e.r + 22, Math.min(WORLD_H - e.r - 22, e.y));
      } else navigator.moveEnemy(e, player.x, player.y, e.speed * speedScale, dt);
      if (Math.hypot(player.x - e.x, player.y - e.y) < e.r + player.r && player.inv === 0) {
        if (player.dodge > 0 && Math.random() < player.dodge) { player.inv = .35; burst(player.x, player.y, '#bbefd5', 6); continue; }
        let lifeDamage = 0;
        if (player.shield > 0) {
          relicEffects.consumeShield(player, runRelicDefs.filter(def => player.skills[def.key]));
          relicEffect('shield', { type: 'ring', x: player.x, y: player.y, radius: 45 }); sound(900, .1, .02);
        } else { const guard = elapsed < player.guardUntil ? player.guardDefense : 0; const before = player.hp; player.hp = Math.max(0, player.hp - Math.max(1, e.damage - player.defense - guard)); lifeDamage = before - player.hp; player.sinceHit = 0; }
        if (lifeDamage > 0 && player.hp > 0 && player.thorns > 0) skillHit(e, player.damage * player.thorns, '#d6be8c');
        player.inv = .7; shake = 5;
        burst(player.x, player.y, '#ffc286', 8); sound(130, .12, .025);
        if (player.hp <= 0) { finish(false); updateHUD(); return; }
      }
    }
    shotClock -= dt;
    if (shotClock <= 0) {
      const rate = player.rate * (boost ? combat.standRate : 1), drawnRate = Math.min(14, rate);
      shoot(boost, rate / drawnRate); shotClock = 1 / drawnRate;
    }
    for (const b of bullets) {
      const previousX = b.x, previousY = b.y;
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0) continue;
      if (world.blocksSegment(previousX, previousY, b.x, b.y, obstacles, b.size || 4)) { b.life = 0; burst(b.x, b.y, '#d2c59d', 3); continue; }
      b.hitTargets ??= new Set();
      for (const e of enemies) {
        if (e.aggro && e.hp > 0 && !b.hitTargets.has(e) && (b.x - e.x) ** 2 + (b.y - e.y) ** 2 < (e.r + (b.size || 4)) ** 2) {
          skillHit(e, b.damage, b.critical ? '#ffce6c' : b.color || '#e9df94'); b.hitTargets.add(e);
          if ((b.pierces || 0) > 0) b.pierces--; else { b.life = 0; break; }
        }
      }
    }
    bullets = bullets.filter(b => b.life > 0 && b.x > -30 && b.x < WORLD_W + 30 && b.y > -30 && b.y < WORLD_H + 30);
    enemies = enemies.filter(e => {
      if (e.hp > 0) return true;
      kills++;
      if (player.killHeal > 0 && player.hp < player.maxHp) {
        player.killHealEvents = player.killHealEvents.filter(entry => entry.at > elapsed - 1);
        const spent = player.killHealEvents.reduce((sum, entry) => sum + entry.amount, 0);
        const amount = Math.max(0, Math.min(player.killHeal, player.maxHp * combat.killHealPerSecond - spent, player.maxHp - player.hp));
        healPlayer(amount); if (amount) player.killHealEvents.push({ at: elapsed, amount });
      }
      if (e.boss) { bossKills++; nextBossAllowedAt = elapsed + combat.bossRecovery; } else nonBossKills++;
      const reward = runMode === 'stage' ? stageXP.grant(e.xp, player.xpMult, e) : e.xp * player.xpMult;
      if (e.boss) player.xp += runMode === 'stage' ? stageXP.collect(reward, e) : reward;
      else if (reward > 0) dropExperience(e.x, e.y, reward);
      burst(e.x, e.y, e.boss ? e.color : e.elite ? '#f6c26b' : e.type ? '#e1aa80' : '#aec582', e.boss ? 36 : e.elite ? 16 : 8); return false;
    });
    gems = gems.filter(g => {
      const dx = player.x - g.x, dy = player.y - g.y, d = Math.hypot(dx, dy);
      if (d < player.pickup) { g.x += dx / (d || 1) * Math.min(d, 320 * player.magnetMult * dt); g.y += dy / (d || 1) * Math.min(d, 320 * player.magnetMult * dt); }
      if (d < 19) { player.xp += runMode === 'stage' ? stageXP.collect(g.value, g) : g.value; return false; } return true;
    });
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    particles = particles.filter(p => p.life > 0);
    if (runMode === 'endless') bankEndlessRewards();
    updateHUD();
    if (checkStageCompletion()) return;
    if (player.xp >= player.need) { upgrade(); return; }
    if (runMode === 'stage') announceBossArrival();
  }
  function updateHUD() {
    el('logoutAccount').disabled = !currentAccount || isRunActive();
    el('logoutAccount').title = isRunActive() ? '先结束或放弃当前挑战，再切换账号' : '保存进度并切换账号';
    const outsideHelp = !!currentAccount && !isRunActive() && ['lobby', 'heroes', 'armory', 'orchard', 'relicMap', 'help'].includes(state);
    el('gameHelp').classList.toggle('hidden', !outsideHelp);
    el('gameHelp').disabled = !outsideHelp;
    el('endEndless').disabled = !['playing', 'paused'].includes(state);
    const s = isRunActive() || state === 'ended' ? activeStage : stage();
    el('hpFill').style.width = player.hp / player.maxHp * 100 + '%'; el('hpText').textContent = Math.ceil(player.hp) + ' / ' + player.maxHp;
    const inRun = isRunActive() || state === 'ended';
    el('remaining').textContent = inRun ? enemies.length : s.enemyCount;
    el('populationLabel').textContent = runMode === 'endless' && inRun ? '无尽第 ' + endlessWave + ' 波' : '剩余害虫';
    el('pursuing').textContent = inRun ? enemies.filter(e => e.aggro && e.hp > 0).length : s.initialPursuers;
    el('enemyTypes').textContent = runMode === 'endless' && inRun ? '无尽虫潮 · 连续增援' : '普通 ' + (inRun ? enemies.filter(e => !e.boss && !e.elite).length : s.normalCount) + ' · 精英 ' + (inRun ? enemies.filter(e => e.elite).length : s.eliteCount) + ' · Boss ' + (inRun ? bossKills : 0) + ' / ' + s.bossCount;
    el('level').textContent = 'LV. ' + player.level + (runMode === 'stage' && inRun ? ' / ' + experience.levelCap : '');
    el('xpFill').style.width = Math.min(100, player.xp / player.need * 100) + '%'; el('xpText').textContent = Number(player.xp.toFixed(1)) + ' / ' + player.need;
    const boost = still >= combat.standDelay;
    el('stance').textContent = boost && inRun ? '✦ 站定蓄力 · 伤害 +' + Math.round((combat.standDamage - 1 + player.standPower) * 100) + '% / 射速 +35%' : still > 0 && inRun ? '✧ 蓄力中…' : '移动保命 · 停下蓄力';
    el('stance').classList.toggle('active', boost && inRun);
    el('damageStat').textContent = seedDamage().toFixed(1); el('rateStat').textContent = player.rate.toFixed(1) + ' / 秒';
    el('speedStat').textContent = Math.round(player.speed); el('shotsStat').textContent = player.shots; el('pickupStat').textContent = Math.round(player.pickup); el('killsStat').textContent = inRun ? kills : 0;
    el('stageName').textContent = '第 ' + s.id + ' / ' + stages.length + ' 关 · ' + (runMode === 'endless' && inRun ? '无尽虫潮' : s.name);
    el('pursuitRule').innerHTML = runMode === 'endless' && inRun ? '每 8 秒一波，数量与强度持续增加<br>可随时结束，材料获得即保存' : '普通：开局 ' + s.initialPursuers + '，每 ' + s.pursuitInterval + ' 秒 +' + s.batchSize + '<br>精英：' + s.eliteFirstAt + ' 秒首批，每 ' + s.eliteInterval + ' 秒 +' + s.eliteBatchSize + '<br>Boss ' + s.bossSchedule[0] + ' 秒起与小怪混合登场 · 同时最多 ' + s.bossActiveCap + ' 位';
    el('loadout').textContent = gearDefs[profile.equipped.weapon].name + ' · ' + gearDefs[profile.equipped.armor].name + ' · ' + gearDefs[profile.equipped.charm].name;
    const hero = growth.hero(player.heroId);
    el('heroName').textContent = hero.name + ' · ' + hero.role; if (el('heroIcon').dataset.hero !== hero.id) { el('heroIcon').innerHTML = heroPortrait(hero); el('heroIcon').dataset.hero = hero.id; }
    el('heroSkill').disabled = state !== 'playing' || player.heroClock > 0;
    el('heroSkill').textContent = player.heroClock > 0 ? hero.skillIcon + ' ' + hero.skillName + ' · ' + player.heroClock.toFixed(1) + 's' : hero.skillIcon + ' ' + hero.skillName + ' · E';
    el('heroSkill').title = hero.skillDescription + ' ' + hero.passiveDescription;
    el('runBuild').textContent = '暴击 ' + Math.round(player.critChance * 100) + '% · 穿透 ' + statText(player.pierce) + ' · 减伤 ' + statText(player.defense + (elapsed < player.guardUntil ? player.guardDefense : 0)) + ' · 回复 ' + statText(player.regen) + '/秒' + (elapsed < player.guardUntil ? ' · 护体 ' + (player.guardUntil - elapsed).toFixed(1) + 's' : '');
    const boss = inRun ? enemies.find(e => e.boss && e.introduced && e.hp > 0) : null;
    el('bossHud').classList.toggle('hidden', !boss);
    if (boss) { el('bossName').textContent = (boss.bossOrder + 1) + ' / ' + s.bossCount + ' · ' + boss.name; el('bossHp').style.width = Math.max(0, boss.hp / boss.maxHp * 100) + '%'; el('bossHpText').textContent = Math.ceil(Math.max(0, boss.hp)) + ' / ' + boss.maxHp; }
    const pendingBoss = inRun && runMode === 'stage' ? enemies.find(e => e.boss && !e.introduced && e.hp > 0) : null;
    const arrivalNotice = !!boss && elapsed < bossArrivalUntil;
    el('bossForecast').classList.toggle('hidden', !arrivalNotice && (!pendingBoss || !!boss));
    el('bossForecast').classList.toggle('arrival-notice', arrivalNotice);
    if (arrivalNotice) {
      const label = '⚠ Boss登场 · ' + boss.name + ' · 第 ' + (boss.bossOrder + 1) + ' / ' + s.bossCount + ' 位';
      if (el('bossForecast').textContent !== label) el('bossForecast').textContent = label;
    } else if (pendingBoss && !boss) {
      const wait = Math.max(0, Math.ceil(Math.max(pendingBoss.bossArrivalAt, nextBossAllowedAt) - elapsed));
      const label = (bossKills ? '下一位虫王' : '首位虫王') + ' · ' + (wait ? wait + ' 秒后抵达' : '即将抵达') + ' · 每次仅 1 位';
      if (el('bossForecast').textContent !== label) el('bossForecast').textContent = label;
    }
    el('bossOthers').innerHTML = (inRun ? enemies.filter(e => e.boss && e.introduced && e.hp > 0 && e !== boss) : []).map(e => '<div class="boss-extra"><strong>' + (e.bossOrder + 1) + ' · ' + e.name + '</strong><div class="bar"><div class="fill" style="width:' + Math.max(0, e.hp / e.maxHp * 100) + '%"></div></div><small>' + Math.ceil(e.hp) + ' / ' + e.maxHp + '</small></div>').join('');
    el('endlessHud').classList.toggle('hidden', !(runMode === 'endless' && isRunActive()));
    el('endlessWave').textContent = '∞ 第 ' + endlessWave + ' 波 · 已击杀 ' + kills;
    el('endlessLoot').textContent = '已存入：☀ ' + endlessCreditedSeeds + '　◆ ' + endlessCreditedCores;
    const canExplore = ['playing', 'paused'].includes(state) || (state === 'relicMap' && isRunActive());
    el('exploreControls').classList.toggle('hidden', !canExplore); el('relicHud').classList.toggle('hidden', !isRunActive());
    el('dashSkill').classList.toggle('hidden', !player.skills.dash);
    el('dashSkill').disabled = state !== 'playing' || (player.skillTimers.dash || 0) > 0;
    el('dashSkill').textContent = (player.skillTimers.dash || 0) > 0 ? '闪步 · ' + player.skillTimers.dash.toFixed(1) + 's' : '闪步 · Space';
    const claimed = relicDrops.filter(d => d.claimed).length;
    el('relicStatus').textContent = '本局饰品 ' + claimed + ' / 6 · 50 件随机投放';
    const ownedDefs = runRelicDefs.filter(def => player.skills[def.key]);
    const relicSignature = ownedDefs.map(def => def.id).join(',') || 'empty';
    if (relicSignature !== relicHudSignature) {
      relicHudSignature = relicSignature;
      el('relicSlots').innerHTML = ownedDefs.length ? ownedDefs.map(def => '<button class="relic-slot active" data-owned-relic="' + def.id + '" title="' + def.name + '：' + def.description + '" aria-label="查看' + def.name + '效果">' + def.icon + '<b>' + def.name + '</b></button>').join('') : '<span class="relic-empty">探索亮光投放点，拾取后显示于此<br>M 查看本局 6 件的位置与效果</span>';
      el('relicSlots').querySelectorAll('[data-owned-relic]').forEach(button => { button.onclick = () => { selectedRelic = button.dataset.ownedRelic; showRelicMap(); }; });
    }
    el('lootTicker').classList.toggle('hidden', !currentNotice || !isRunActive());
    el('lootTicker').classList.toggle('frozen', state !== 'playing');
    el('buildHud').classList.toggle('hidden', !isRunActive());
    const buildSignature = player.build.mode + JSON.stringify(player.build.levels) + player.build.superSkills.join(',');
    if (buildSignature !== buildHudSignature) {
      buildHudSignature = buildSignature; const build = builds.summary(player);
      el('buildSlots').innerHTML = ['attack', 'attribute'].map(category => {
        const endless = build.mode === 'endless', entries = build[category], visible = entries.slice(-4);
        return '<div class="build-row"><strong title="' + entries.map(def => def.name + ' Lv.' + def.level).join('、') + '">' + (category === 'attack' ? '⚔ 攻击' : '🌿 属性') + ' ' + entries.length + (endless ? ' 种 · ' + build[category + 'Choices'] + ' 次成长' : '/4 种 · ' + build[category + 'Choices'] + '/20 次') + (entries.length > 4 ? '（近4种）' : '') + '</strong><div class="build-chips">' + Array.from({ length: 4 }, (_, i) => {
          const def = visible[i]; return def ? '<span class="build-chip ' + category + '" title="' + def.name + ' Lv.' + def.level + '">' + def.icon + ' ' + (endless ? 'Lv.' + def.level : def.level + '/5') + '</span>' : '<span class="build-chip empty">空槽</span>';
        }).join('') + '</div></div>';
      }).join('');
      el('superSkills').innerHTML = build.supers.length ? '<div class="super-strip">' + build.supers.map(recipe => '<span title="' + recipe.description + '">' + recipe.icon + ' ' + recipe.name + '</span>').join(' · ') + '</div>' : '';
    }
  }
  function ellipse(x, y, rx, ry, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
  function drawSprite(key, x, y, width, height = width, angle = 0) {
    const portrait = heroImages[key];
    if (portrait?.complete && portrait.naturalWidth) {
      ctx.save(); ctx.translate(x, y); if (angle) ctx.rotate(angle);
      ctx.drawImage(portrait, -width / 2, -height / 2, width, height); ctx.restore(); return true;
    }
    if (!atlas || !atlas.complete || !atlas.naturalWidth || !Number.isInteger(art.sprites[key])) return false;
    const cellW = atlas.naturalWidth / 4, cellH = atlas.naturalHeight / 4, index = art.sprites[key];
    ctx.save(); ctx.translate(x, y); if (angle) ctx.rotate(angle);
    ctx.drawImage(atlas, index % 4 * cellW, Math.floor(index / 4) * cellH, cellW, cellH, -width / 2, -height / 2, width, height);
    ctx.restore(); return true;
  }
  function drawObstacles() {
    mapRenderer.solids(ctx, mapLayout, { ...camera, w: W, h: H }, elapsed, drawSprite);
  }
  function background() {
    mapRenderer.ground(ctx, mapLayout, { ...camera, w: W, h: H }, elapsed, drawSprite);
  }
  function onScreen(o, margin = 40) { return o.x > camera.x - margin && o.x < camera.x + W + margin && o.y > camera.y - margin && o.y < camera.y + H + margin; }
  function minimap() {
    const x = W - 177, y = 95, w = 150, h = 106, sx = w / WORLD_W, sy = h / WORLD_H;
    ctx.fillStyle = '#12261ee8'; ctx.fillRect(x - 9, y - 24, w + 18, h + 61); ctx.strokeStyle = '#88a75888'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#d8e7b5'; ctx.font = '11px "Microsoft YaHei",sans-serif'; ctx.fillText(mapLayout.id + ' · ' + mapLayout.name, x, y - 9);
    mapRenderer.mini(ctx, mapLayout, x, y, w, h);
    for (const e of enemies) { if (!e.aggro || e.hp <= 0) continue; ctx.fillStyle = e.boss ? '#fa8b79' : e.elite ? '#ffd16c' : e.type ? '#dbad7b' : '#b1cc79'; const r = e.boss ? 4 : e.elite ? 3 : 2; ctx.fillRect(x + e.x * sx - r / 2, y + e.y * sy - r / 2, r, r); }
    for (let i = 0; i < relicDrops.length; i++) {
      const drop = relicDrops[i], px = x + drop.x * sx, py = y + drop.y * sy;
      ellipse(px, py, 5, 5, drop.claimed ? '#466753' : runRelicDefs[i].color);
      ctx.fillStyle = drop.claimed ? '#adcbb0' : '#1a2b20'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(drop.claimed ? '✓' : String(i + 1), px, py + 3); ctx.textAlign = 'start';
    }
    ctx.strokeStyle = '#d9e5aa55'; ctx.strokeRect(x + camera.x * sx, y + camera.y * sy, W * sx, H * sy); ellipse(x + player.x * sx, y + player.y * sy, 3, 3, '#ffbd69');
    ctx.fillStyle = '#a9b996'; ctx.font = '9px "Microsoft YaHei",sans-serif'; ctx.fillText('①–⑥ 饰品 · 橙点：你', x, y + h + 15); ctx.fillText('棕：路桥 · 蓝：水/谷', x, y + h + 29);
  }
  function drawRelics() {
    for (let i = 0; i < relicDrops.length; i++) {
      const drop = relicDrops[i]; if (!onScreen(drop, 100)) continue;
      const def = runRelicDefs[i], pulse = 1 + Math.sin(elapsed * 3 + i) * .08;
      ellipse(drop.x, drop.y + 10, 33, 16, '#14251e99');
      if (!drop.claimed) drawSprite('relic', drop.x, drop.y, 60);
      ctx.save(); ctx.translate(drop.x, drop.y);
      ctx.shadowBlur = drop.claimed ? 0 : 15; ctx.shadowColor = def.color;
      ctx.strokeStyle = drop.claimed ? '#759378' : def.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 29 * pulse, 0, Math.PI * 2); ctx.stroke();
      ellipse(0, 0, 20, 20, drop.claimed ? '#33533c' : '#21382c'); ctx.shadowBlur = 0;
      ctx.font = '24px "Segoe UI Emoji",sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = drop.claimed ? '#a5c4a3' : def.color; ctx.fillText(drop.claimed ? '✓' : def.icon, 0, 8);
      ctx.font = 'bold 11px "Microsoft YaHei",sans-serif'; ctx.fillStyle = drop.claimed ? '#8fa986' : '#fff4c5'; ctx.fillText((i + 1) + ' ' + def.name, 0, -40);
      if (!drop.claimed && Math.hypot(drop.x - player.x, drop.y - player.y) < 130) { ctx.font = '10px "Microsoft YaHei",sans-serif'; ctx.fillText('靠近领取 · ' + def.skillName, 0, 49); }
      ctx.restore();
    }
  }
  function drawSkills() {
    if (elapsed < player.guardUntil) {
      ctx.save(); ctx.strokeStyle = '#ffe38e'; ctx.lineWidth = 3; ctx.globalAlpha = .55 + Math.sin(elapsed * 6) * .15;
      ctx.beginPath(); ctx.arc(player.x, player.y, 31, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    for (const effect of heroEffects) {
      const phase = 1 - effect.life / effect.max;
      ctx.save(); ctx.globalAlpha = effect.life / effect.max; ctx.strokeStyle = effect.color; ctx.fillStyle = effect.color + '22'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(effect.x, effect.y, effect.radius * (.35 + phase * .65), 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    for (const effect of skillEffects) {
      ctx.save(); ctx.globalAlpha = Math.max(0, effect.life / effect.max); ctx.strokeStyle = effect.color; ctx.lineWidth = effect.type === 'line' ? 7 : 3;
      if (effect.type === 'ring') { ctx.beginPath(); ctx.arc(effect.x, effect.y, effect.radius * (1.1 - effect.life / effect.max * .35), 0, Math.PI * 2); ctx.stroke(); }
      else if (effect.type === 'chain') {
        ctx.beginPath(); ctx.moveTo(effect.points[0].x, effect.points[0].y);
        for (let i = 1; i < effect.points.length; i++) {
          const a = effect.points[i - 1], b = effect.points[i]; ctx.lineTo((a.x + b.x) / 2 + 9, (a.y + b.y) / 2 - 7); ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(effect.x, effect.y); ctx.lineTo(effect.tx, effect.ty); ctx.stroke();
        if (effect.type === 'bee') {
          const progress = 1 - effect.life / effect.max; ctx.font = '21px "Segoe UI Emoji",sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('🐝', effect.x + (effect.tx - effect.x) * progress, effect.y + (effect.ty - effect.y) * progress);
        }
      }
      ctx.restore();
    }
    if (player.skills.orbit) for (let i = 0; i < 3; i++) {
      const angle = elapsed * 2.8 + i * Math.PI * 2 / 3, radius = relicDefs.find(d => d.key === 'orbit').radius;
      ctx.save(); ctx.translate(player.x + Math.cos(angle) * radius, player.y + Math.sin(angle) * radius); ctx.rotate(angle); ellipse(0, 0, 11, 5, '#a6ec9d'); ctx.restore();
    }
    if (player.shield > 0) { ctx.strokeStyle = '#f6bbd0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(player.x, player.y, 29, 0, Math.PI * 2); ctx.stroke(); }
  }
  function bug(e) {
    if (e.boss) { drawBoss(e); return; }
    if (elapsed < (e.slowUntil || 0)) { ctx.strokeStyle = '#a3dffa'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 4, 0, Math.PI * 2); ctx.stroke(); }
    if (drawSprite(e.elite ? 'elite' : e.type ? 'fly' : 'beetle', e.x, e.y, e.r * 2.8, e.r * 2.8, Math.atan2(player.y - e.y, player.x - e.x) - Math.PI / 2)) {
      if (e.flash) ellipse(e.x, e.y, e.r * .8, e.r * .65, '#fff1b566');
      if (e.elite) {
        ctx.strokeStyle = '#ffd16c99'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 5, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#17251e'; ctx.fillRect(e.x - 25, e.y - e.r - 9, 50, 5); ctx.fillStyle = '#ffd16c'; ctx.fillRect(e.x - 25, e.y - e.r - 9, 50 * Math.max(0, e.hp / e.maxHp), 5);
        ctx.font = 'bold 10px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'center'; ctx.fillText('精英', e.x, e.y - e.r - 14); ctx.textAlign = 'start';
      }
      return;
    }
    ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(Math.atan2(player.y - e.y, player.x - e.x));
    if (e.elite) { ctx.scale(1.3, 1.3); ctx.strokeStyle = '#ffd16c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.stroke(); }
    ellipse(3, 4, e.r, e.r * .7, '#11251966');
    const wiggle = Math.sin(elapsed * 14 + e.phase) * 3; ctx.strokeStyle = e.elite ? '#d5a052' : e.type ? '#bf9572' : '#7d9b65'; ctx.lineWidth = 3;
    for (const s of [-1, 1]) for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 8, s * 7); ctx.lineTo(i * 8 - 5 + wiggle, s * (e.r * .8 + 3)); ctx.stroke(); }
    if (e.type) {
      ellipse(-3, -7, 12, 7, '#dce3ac99'); ellipse(-3, 7, 12, 7, '#dce3ac99'); ellipse(0, 0, 14, 9, e.flash ? '#fff1b5' : '#ce945e');
      ctx.fillStyle = '#60422d'; ctx.fillRect(-5, -8, 3, 16); ctx.fillRect(2, -8, 3, 16);
    } else {
      ellipse(0, 0, 18, 14, e.flash ? '#fff1b5' : e.elite ? '#daa354' : '#8da963'); ctx.strokeStyle = e.elite ? '#805a30' : '#627b43'; ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(9, 0); ctx.stroke();
    }
    ellipse(12, 0, 8, 9, e.flash ? '#fff1b5' : e.elite ? '#966333' : '#5a713d'); ellipse(15, -4, 2.2, 2.4, '#fff0cf'); ellipse(15, 4, 2.2, 2.4, '#fff0cf'); ellipse(16, -4, 1, 1, '#2a3223'); ellipse(16, 4, 1, 1, '#2a3223'); ctx.restore();
    if (e.elite) {
      ctx.fillStyle = '#17251e'; ctx.fillRect(e.x - 25, e.y - e.r - 9, 50, 5);
      ctx.fillStyle = '#ffd16c'; ctx.fillRect(e.x - 25, e.y - e.r - 9, 50 * Math.max(0, e.hp / e.maxHp), 5);
      ctx.font = 'bold 10px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'center'; ctx.fillText('精英', e.x, e.y - e.r - 14); ctx.textAlign = 'start';
    }
  }
  function drawBoss(e) {
    if (e.windup > 0) {
      ctx.strokeStyle = '#fa796c'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + e.dashX * 165, e.y + e.dashY * 165); ctx.stroke();
      ctx.strokeStyle = '#fa796caa'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 14 + Math.sin(elapsed * 24) * 3, 0, Math.PI * 2); ctx.stroke();
    }
    if (drawSprite('boss', e.x, e.y, e.r * 2.9, e.r * 2.9, Math.atan2(player.y - e.y, player.x - e.x) - Math.PI / 2)) {
      ctx.strokeStyle = e.color + '99'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 6, 0, Math.PI * 2); ctx.stroke();
      if (e.flash) ellipse(e.x, e.y, e.r * .8, e.r * .65, '#fff1b566'); return;
    }
    ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(Math.atan2(player.y - e.y, player.x - e.x));
    ellipse(3, 7, e.r + 5, e.r * .8, '#10241966');
    ctx.strokeStyle = '#cab881'; ctx.lineWidth = 5;
    for (const side of [-1, 1]) for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 16, side * e.r * .45); ctx.lineTo(i * 16 - 9, side * (e.r + 8)); ctx.stroke(); }
    ellipse(0, 0, e.r, e.r * .77, e.flash ? '#fff1b5' : e.color); ellipse(-7, -8, e.r * .65, e.r * .46, '#ffe2ac44');
    ctx.strokeStyle = '#462f2999'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-e.r + 4, 0); ctx.lineTo(e.r * .5, 0); ctx.stroke();
    ellipse(e.r * .65, 0, e.r * .44, e.r * .52, '#564832');
    for (const side of [-1, 1]) { ctx.strokeStyle = '#e5ce8e'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(e.r * .9, side * 10); ctx.lineTo(e.r + 12, side * 17); ctx.stroke(); ellipse(e.r * .9, side * 10, 4, 4, '#ffecb1'); ellipse(e.r * .95, side * 10, 2, 2, '#582e27'); }
    ctx.restore();
  }
  function draw() {
    ctx.save(); if (shake) ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake); ctx.translate(-camera.x, -camera.y); background();
    drawObstacles();
    drawRelics();
    for (const g of gems) {
      if (!onScreen(g)) continue;
      const pulse = 1 + Math.sin(elapsed * 4 + g.x * .03) * .1;
      // Dark outer halo and pale outline keep XP legible against green orchard scenery.
      ellipse(g.x, g.y + 2, 17 * pulse, 13 * pulse, '#10221dd9');
      if (drawSprite('xp', g.x, g.y, 30 * pulse)) {
        ctx.fillStyle = '#fff8db'; ctx.font = 'bold 10px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'center'; ctx.fillText('XP', g.x, g.y - 19); ctx.textAlign = 'start'; continue;
      }
      ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(Math.PI / 4);
      ctx.shadowBlur = 16; ctx.shadowColor = '#8deaff'; ctx.fillStyle = '#6bdcf2'; ctx.strokeStyle = '#fff6c5'; ctx.lineWidth = 2.5;
      ctx.fillRect(-7 * pulse, -7 * pulse, 14 * pulse, 14 * pulse); ctx.strokeRect(-7 * pulse, -7 * pulse, 14 * pulse, 14 * pulse);
      ctx.shadowBlur = 0; ctx.fillStyle = '#f1ffff'; ctx.fillRect(-4, -5, 3, 6); ctx.restore();
      ctx.fillStyle = '#fff8db'; ctx.font = 'bold 10px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'center'; ctx.fillText('XP', g.x, g.y - 18); ctx.textAlign = 'start';
    }
    for (const e of enemies) if (e.aggro && e.hp > 0 && onScreen(e)) bug(e);
    for (const b of bullets) { if (!onScreen(b)) continue; ctx.strokeStyle = b.hero ? '#ff859c88' : '#e7d18c66'; ctx.lineWidth = b.critical ? 4 : 3; ctx.beginPath(); ctx.moveTo(b.x - b.vx * .023, b.y - b.vy * .023); ctx.lineTo(b.x, b.y); ctx.stroke(); ellipse(b.x, b.y, b.size || 5, (b.size || 5) * .6, b.color || player.bulletColor); }
    const p = player; ellipse(p.x, p.y + 17, 21, 8, '#14251e77');
    if (still > 0 && (isRunActive() || state === 'ended')) {
      ctx.strokeStyle = still >= combat.standDelay ? '#d4ec83' : '#b5cd6766'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, 27, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, still / combat.standDelay)); ctx.stroke();
    }
    ctx.save(); if (p.inv > 0 && Math.floor(p.inv * 16) % 2 === 0) ctx.globalAlpha = .45;
    if (!drawSprite(p.heroId, p.x, p.y - 5 + Math.sin(elapsed * 9) * (still ? 1 : 2), 49, 52)) {
    ellipse(p.x, p.y, 18, 19, '#efab55'); ellipse(p.x - 4, p.y - 4, 13, 13, '#f8bd67'); ellipse(p.x - 8, p.y - 9, 4, 3, '#ffe2a1');
    ctx.save(); ctx.translate(p.x + 2, p.y - 20); ctx.rotate(-.5); ellipse(6, 0, 10, 4, '#a7d56b'); ctx.restore();
    ctx.strokeStyle = '#697841'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p.x, p.y - 16); ctx.lineTo(p.x + 2, p.y - 23); ctx.stroke();
    ellipse(p.x - 6, p.y, 1.8, 2.6, '#4a3b28'); ellipse(p.x + 6, p.y, 1.8, 2.6, '#4a3b28'); ctx.strokeStyle = '#78502e'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y + 4, 4, 0, Math.PI); ctx.stroke();
    ellipse(p.x - 11, p.y + 5, 3, 2, '#e59354'); ellipse(p.x + 11, p.y + 5, 3, 2, '#e59354'); ctx.restore();
    } else ctx.restore();
    drawSkills();
    for (const q of particles) { ctx.globalAlpha = Math.max(0, q.life / q.max); ellipse(q.x, q.y, 3, 3, q.color); } ctx.globalAlpha = 1; ctx.restore(); minimap();
    if (pointer) {
      const rect = arena.getBoundingClientRect(), x = (pointer.sx - rect.left) * W / rect.width, y = (pointer.sy - rect.top) * H / rect.height;
      const dx = (pointer.x - pointer.sx) * W / rect.width, dy = (pointer.y - pointer.sy) * H / rect.height, l = Math.hypot(dx, dy) || 1;
      ctx.strokeStyle = '#e5f3bb66'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 38, 0, Math.PI * 2); ctx.stroke(); ellipse(x + dx / l * Math.min(30, l), y + dy / l * Math.min(30, l), 14, 14, '#e5f3bb66');
    }
  }
  function frame(now) {
    const dt = Math.min(.04, (now - lastTime) / 1000 || 0); lastTime = now;
    if (state === 'playing') update(dt);
    else if (state === 'rescue' && !document.hidden) {
      cinematicTime += dt;
      if (cinematicTime >= 3.8) completeRescue();
    }
    if (state !== 'cover') draw(); requestAnimationFrame(frame);
  }
  updateCamera();
  showCover();requestAnimationFrame(frame);
})();
