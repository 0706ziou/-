(() => {
  'use strict';
  const canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay'), arena = document.getElementById('arena');
  const WORLD_W = Math.round(960 * Math.sqrt(50)), WORLD_H = Math.round(680 * Math.sqrt(50));
  let W = 960, H = 680;
  const stages = window.ORCHARD_STAGES;
  const experience = window.ORCHARD_EXPERIENCE, pressure = window.ORCHARD_PRESSURE;
  const rescueDefs = window.ORCHARD_RESCUES, bossDefs = window.ORCHARD_BOSSES;
  const gardenDefs = window.ORCHARD_GARDENS;
  const relicDefs = window.ORCHARD_RELICS;
  const relicPoints = window.ORCHARD_RELIC_POINTS;
  const relicEffects = window.ORCHARD_RELIC_EFFECTS, builds = window.ORCHARD_BUILDS;
  const legacyRelics = new Set(['lightning', 'orbit', 'dash', 'frost', 'shield', 'bees']);
  const growth = window.ORCHARD_GROWTH, world = window.ORCHARD_WORLD, art = window.ORCHARD_ART;
  const mapCatalog = window.ORCHARD_MAPS, mapRenderer = window.ORCHARD_MAP_RENDER;
  const trainingCatalog = window.ORCHARD_TRAINING, store = window.ORCHARD_STORE;
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
  const heroAtlas = typeof Image === 'function' ? new Image() : null;
  if (heroAtlas) heroAtlas.src = art.heroAtlas;
  const heroImages = {};
  for (const [id, path] of Object.entries(art.heroImages || {})) {
    if (typeof Image === 'function') { heroImages[id] = new Image(); heroImages[id].src = path; }
  }
  const combat = Object.freeze({ standDelay: .6, standDamage: 1.35, standRate: 1.35, leechPerSecond: .03, killHealPerSecond: .015 });
  const gearGrowth = Object.freeze({ damage: .06, rate: .02, hp: 8, defense: .5, speed: 3, pickup: 6 });
  const SAVE_KEY = 'orchard-save-v1';
  let currentSaveKey = SAVE_KEY, currentAccount = null, loginBusy = false, loginAttempt = 0, sessionGreeting = '';
  const frontierRewards = window.ORCHARD_FRONTIER_REWARDS?.create({
    getClient: () => window.ORCHARD_FRONTIER,
    getName: () => currentAccount?.nickname || '', getOwner: () => currentAccount?.id || '',
    storage: window.localStorage, onChange: updateWorldRewardMessage
  });
  let authService = null;
  try { authService = window.ORCHARD_AUTH.create({ storage: window.localStorage, crypto: window.crypto }); } catch {}
  const keys = new Set(), camera = { x: 0, y: 0 };
  let state = 'cover', player, enemies = [], bullets = [], gems = [], particles = [];
  let elapsed = 0, kills = 0, shotClock = 0, still = 0, lastTime = 0, choices = [], shake = 0;
  let pointer = null, audioCtx = null, selectedStage = 1, activeStage = stages[0], runRewarded = false;
  let storageAvailable = true;
  let previewStage = 1, helpReturnState = 'playing', helpTab = 'conversation', tutorialStep = 0, tutorialIsFirstRun = false, helpFocusReturn = null;
  let cinematicTime = 0, bossIndex = 0, bossKills = 0, nonBossKills = 0;
  let bossArrivalUntil = 0;
  let victoryRewardHTML = '';
  let runMode = 'stage', stageVictoryReady = false, endlessEntered = false;
  let training = null;
  let storeReturnState = 'lobby', storeFocusReturn = null, storeTab = 'shop', storeRevision = 0;
  let permanentMenuRefresh = false;
  let stageXP = experience.create(stages[0]);
  let selectedGearSlot = 'weapon', selectedSprite = 0, selectedGarden = 1;
  let endlessWave = 0, waveClock = 0, endlessCreditedSeeds = 0, endlessCreditedCores = 0;
  let relicDrops = [], skillEffects = [], selectedRelic = relicDefs[0].id, trackedRelic = null, mapReturnState = 'lobby';
  let runRelicDefs = [], challengeStarted = false, noticeQueue = [], currentNotice = null, noticeClock = 0;
  let relicHudSignature = '', buildHudSignature = '';
  let heroTab = 'heroes', heroSkillView = 'active', inspectedHero = 'orange', heroEffects = [];
  const ENDLESS_INTERVAL = 8, ENDLESS_ENEMY_CAP = 240;
  const endlessTuning = Object.freeze({ openingBonus: 16, perWave: 5, batchCap: 90, hp: .12, hpCurve: .002, damage: .045, speed: .012, speedCap: 1.3, xpEvery: 4 });
  const XP_NODE_CAP = 400;
  // Battle time only: menus and pauses must not consume the breathing window.
  let nextStageUpgradeAt = experience.interval(1);
  const runStates = ['playing', 'paused', 'upgrade', 'roulette', 'rescue'];
  let rouletteQueue = [], pendingEndlessXP = 0, rouletteAnimation = null;
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
    charm_harvest: { slot: 'charm', name: '丰收徽记', icon: '🌻', desc: '移速 220，拾取范围 140，经验提前释放 +15%', speed: 220, pickup: 140, xpMult: 1.15 },
    weapon_grape: { slot: 'weapon', name: '紫藤连珠弩', icon: '🍇', desc: '双籽连射，适合快速清群', damage: 14, rate: 3.4, shots: 2, color: '#c9a3ed', range: 540 },
    weapon_blueberry: { slot: 'weapon', name: '月露法杖', icon: '🫐', desc: '双发月露弹，50%概率额外穿透一只', damage: 30, rate: 1.4, shots: 2, color: '#a5beff', range: 620, pierce: .5 },
    weapon_sunbow: { slot: 'weapon', name: '日耀长弓', icon: '☀', desc: '远距离重箭，每箭额外穿透一只', damage: 46, rate: 1.85, shots: 1, color: '#ffe09a', range: 720, pierce: 1 },
    weapon_coconut: { slot: 'weapon', name: '星核椰炮', icon: '🥥', desc: '三籽齐射，百关远征的终章重炮', damage: 38, rate: 1.15, shots: 3, color: '#d8c9ff', range: 600 },
    armor_moon: { slot: 'armor', name: '月叶游侠衣', icon: '🌙', desc: '轻装游侠 · 移速 +6%', hp: 130, defense: 1, speedMult: 1.06 },
    armor_thorn: { slot: 'armor', name: '赤棘重甲', icon: '🌹', desc: '坚韧重甲 · 移速 −6%', hp: 185, defense: 5, speedMult: .94 },
    armor_frost: { slot: 'armor', name: '霜瓜壁垒', icon: '❄', desc: '高生命护甲 · 移速 −8%', hp: 220, defense: 6, speedMult: .92 },
    charm_moon: { slot: 'charm', name: '月露坠饰', icon: '💧', desc: '扩大拾取 · 经验提前释放 +12%', speed: 218, pickup: 165, xpMult: 1.12 },
    charm_gale: { slot: 'charm', name: '疾风叶环', icon: '🍃', desc: '高速走位 · 轻盈突围', speed: 245, pickup: 120, xpMult: 1 },
    charm_star: { slot: 'charm', name: '星辉罗盘', icon: '✦', desc: '远距离采集 · 经验提前释放 +25%', speed: 230, pickup: 185, xpMult: 1.25 }
  };
  const gearAtlases = { weapon: 'assets/equipment/weapons.png', armor: 'assets/equipment/armor.png', charm: 'assets/equipment/charms.png' };
  const gearArtOrder = {
    weapon: ['weapon_seed', 'weapon_pea', 'weapon_cherry', 'weapon_pumpkin', 'weapon_grape', 'weapon_blueberry', 'weapon_sunbow', 'weapon_coconut'],
    armor: ['armor_leaf', 'armor_bark', 'armor_rind', 'armor_moon', 'armor_thorn', 'armor_frost'],
    charm: ['charm_sprout', 'charm_bloom', 'charm_harvest', 'charm_moon', 'charm_gale', 'charm_star']
  };
  function gearPortrait(id, extraClass = '') {
    const g = gearDefs[id], cols = g.slot === 'weapon' ? 4 : 3, index = gearArtOrder[g.slot].indexOf(id);
    const weaponViews = ['10 60 305 450', '314 50 314 450', '627 100 314 430', '940 130 314 390', '0 660 314 500', '314 620 314 565', '627 580 314 605', '940 700 314 485'];
    const armorViews = ['0 0 512 490', '512 0 512 490', '1024 0 512 490', '0 490 512 534', '512 512 512 512', '1024 512 512 512'];
    const viewBox = g.slot === 'weapon' ? weaponViews[index] : g.slot === 'armor' ? armorViews[index] : index % cols * 512 + ' ' + Math.floor(index / cols) * 512 + ' 512 512';
    const size = g.slot === 'weapon' ? 'width="1254" height="1254"' : 'width="1536" height="1024"';
    const [x, y, width, height] = viewBox.split(' '), clip = 'equipment-clip-' + id + '-' + (extraClass || 'card');
    return '<svg class="equipment-art ' + extraClass + '" role="img" aria-label="' + g.name + '装备图" viewBox="' + viewBox + '" preserveAspectRatio="xMidYMid meet"><defs><clipPath id="' + clip + '" clipPathUnits="userSpaceOnUse"><rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '"/></clipPath></defs><image href="' + gearAtlases[g.slot] + '" ' + size + ' clip-path="url(#' + clip + ')"/></svg>';
  }
  function freshProfile() {
    const base = { version: 1, unlockedStage: 1, clearedStages: [], seeds: 0, cores: 0, tutorialSeen: false, trainingComplete: false, trainingSkipped: false, featureGuideStep: 0, featureGuideRound: 1,
      rescuedSprites: [], spriteLevels: {}, firstCultivationUsed: false, worldHarvestSeen: false, orchard: { level: 0 },
      inventory: { weapon_seed: { level: 0 }, armor_leaf: { level: 0 }, charm_sprout: { level: 0 } },
      equipped: { weapon: 'weapon_seed', armor: 'armor_leaf', charm: 'charm_sprout' } };
    growth.migrate({}, base); store.migrate({}, base); return base;
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
      result.trainingComplete = raw.trainingComplete === true;
      result.trainingSkipped = raw.trainingSkipped === true;
      result.unlockedStage = integer(raw.unlockedStage, 1, stages.length);
      result.seeds = integer(raw.seeds, 0, 999999); result.cores = integer(raw.cores, 0, 999999);
      result.clearedStages = [...new Set((Array.isArray(raw.clearedStages) ? raw.clearedStages : []).filter(n => Number.isInteger(n) && n >= 1 && n <= stages.length))];
      result.featureGuideStep = raw.featureGuideStep === undefined ? (result.clearedStages.length ? 4 : 0) : integer(raw.featureGuideStep, 0, 4);
      result.featureGuideRound = raw.featureGuideRound === 2 ? 2 : 1;
      result.orchard.level = integer(raw.orchard?.level, 0, 10);
      // Old saves already completed these rescues; preserve their earned residents on migration.
      const residents = [...(Array.isArray(raw.rescuedSprites) ? raw.rescuedSprites : []), ...result.clearedStages];
      result.rescuedSprites = [...new Set(residents.filter(n => Number.isInteger(n) && n >= 1 && n <= rescueDefs.length))].sort((a, b) => a - b);
      for (const id of result.rescuedSprites) result.spriteLevels[id] = integer(raw.spriteLevels?.[id], 0, 5);
      result.firstCultivationUsed = raw.firstCultivationUsed === true || Object.values(result.spriteLevels).some(level => level > 0);
      result.worldHarvestSeen = raw.worldHarvestSeen === true;
      for (const id of Object.keys(gearDefs)) {
        if (raw.inventory && Object.hasOwn(raw.inventory, id)) result.inventory[id] = { level: integer(raw.inventory[id]?.level, 0, 10) };
      }
      for (const stage of stages) {
        if (stage.firstClearGear && result.clearedStages.includes(stage.id)) result.inventory[stage.firstClearGear] ??= { level: 0 };
      }
      for (const slot of ['weapon', 'armor', 'charm']) {
        const id = raw.equipped?.[slot];
        if (result.inventory[id] && gearDefs[id]?.slot === slot) result.equipped[slot] = id;
      }
      if (result.clearedStages.length) result.unlockedStage = Math.max(result.unlockedStage, Math.min(stages.length, Math.max(...result.clearedStages) + 1));
      growth.migrate(raw, result); store.migrate(raw, result);
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
    rouletteQueue = []; pendingEndlessXP = 0;
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
      critMultiplier: heroStats.critMultiplier, pierce: (heroStats.pierce || 0) + (weapon.pierce || 0), weaponRange: weapon.range || 540, regen: heroStats.regen, regenDelay: heroStats.regenDelay, sinceHit: 0,
      dodge: heroStats.dodge || 0, thorns: heroStats.thorns || 0, skillPower: heroStats.skillPower || 1, standPower: heroStats.standDamage || 0,
      guardUntil: 0, guardDefense: 0,
      skills: {}, skillTimers: {}, shield: 0, facingX: 1, facingY: 0, leechEvents: [], killHealEvents: [] };
    builds.init(result); return result;
  }
  player = freshPlayer();
  function el(id) { return document.getElementById(id); }
  function showCover() {
    window.ORCHARD_FRONTIER?.close();
    window.ORCHARD_LEADERBOARD?.close();
    state = 'cover'; keys.clear(); pointer = null; overlay.classList.add('hidden');
    document.body.classList.add('is-cover'); el('coverScreen').classList.remove('hidden'); el('playerAccount').classList.add('hidden');
    el('loginAccount').value = authService?.getLastAccount() || '';
    el('loginPassword').value = ''; el('loginPassword').type = 'password';
    el('togglePassword').textContent = '显示'; el('togglePassword').setAttribute?.('aria-pressed', 'false');
    el('loginFeedback').textContent = ''; el('loginFeedback').classList.remove('error', 'success');
    el('loginAccount').focus?.();
  }
  function resetAccountSession() {
    frontierRewards?.reset(); window.ORCHARD_FRONTIER?.close();
    window.ORCHARD_LEADERBOARD?.close();
    training = null; storeReturnState = 'lobby'; storeFocusReturn = null; storeTab = 'shop'; storeRevision++;
    keys.clear(); pointer = null; selectedStage = profile.unlockedStage; previewStage = selectedStage; activeStage = stage();
    enemies = []; bullets = []; gems = []; particles = []; choices = []; heroEffects = []; skillEffects = [];
    elapsed = 0; kills = 0; shotClock = 0; still = 0; shake = 0; cinematicTime = 0; bossIndex = 0; bossKills = 0; nonBossKills = 0; bossArrivalUntil = 0;
    runRewarded = false; victoryRewardHTML = ''; runMode = 'stage'; stageVictoryReady = false; endlessEntered = false;
    endlessWave = 0; waveClock = 0; endlessCreditedSeeds = 0; endlessCreditedCores = 0;
    selectedGearSlot = 'weapon'; selectedSprite = profile.rescuedSprites[0] || 0; selectedGarden = selectedSprite ? Math.ceil(selectedSprite / 10) : 1; inspectedHero = profile.selectedHero; heroTab = 'heroes'; heroSkillView = 'active';
    mapReturnState = 'lobby'; helpReturnState = 'playing'; helpTab = 'conversation'; tutorialStep = 0; tutorialIsFirstRun = false; helpFocusReturn = null;
    relicHudSignature = ''; buildHudSignature = ''; runRelicDefs = []; challengeStarted = false;
    setMap(selectedStage); player = freshPlayer(); stageXP = experience.create(activeStage); resetRelics(true); updateCamera();
  }
  function acceptAccount(user, created = false, legacyClaimed = false, gamePassword = '') {
    currentAccount = user; currentSaveKey = authService.profileKey(user.id); storageAvailable = true;
    profile = loadProfile(); resetAccountSession();
    sessionGreeting = (created ? '注册成功，欢迎 ' : '欢迎回来，') + user.nickname + (legacyClaimed ? ' · 已保留原有进度' : '');
    el('playerName').textContent = user.nickname; el('playerAccount').classList.remove('hidden');
    document.body.classList.remove('is-cover'); el('coverScreen').classList.add('hidden'); el('loginPassword').value = '';
    startScreen();
    if (needsFirstTraining()) startTraining(true);
    prepareWorldSession(gamePassword); return true;
  }
  function prepareWorldSession(gamePassword = '') {
    if (!currentAccount || !window.ORCHARD_FRONTIER) return;
    const name = currentAccount.nickname;
    const frontier = window.ORCHARD_FRONTIER;
    const pending = gamePassword && frontier.enterGame ? frontier.enterGame(name, gamePassword) : frontier.prepareSession?.(name);
    return pending?.then(() => {
      if (currentAccount?.nickname === name) frontierRewards?.retry();
    }).catch(() => {});
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
      return acceptAccount(result.user, result.created, result.legacyClaimed, info.password);
    } catch (error) {
      if (attempt === loginAttempt && state === 'cover') {
        el('loginFeedback').textContent = error.message || '暂时无法登录，请稍后重试。'; el('loginFeedback').classList.add('error');
        el('loginPassword').value = '';
      }
      return false;
    } finally {
      info.password = '';
      loginBusy = false;
      for (const id of ['loginAccount', 'loginPassword', 'togglePassword', 'loginSubmit']) el(id).disabled = false;
      el('loginSubmit').textContent = '登录 / 首次注册';
    }
  }
  function logoutAccount() {
    if (!currentAccount || isRunActive() || loginBusy) return false;
    if (!saveProfile()) { el('logoutAccount').title = '进度保存失败，请稍后重试'; return false; }
    if (window.ORCHARD_FRONTIER?.leaveGame) window.ORCHARD_FRONTIER.leaveGame().catch(() => {});
    else window.ORCHARD_FRONTIER?.setPlayerName?.('');
    loginAttempt++; currentAccount = null; currentSaveKey = SAVE_KEY; profile = freshProfile(); sessionGreeting = '';
    resetAccountSession(); showCover(); return true;
  }
  function patchPermanentMenu(markup) {
    const live = overlay.querySelector?.('.menu-dialog');
    if (!live || !document.createElement) return false;
    const template = document.createElement('template'); template.innerHTML = markup;
    const fresh = template.content.firstElementChild; if (!fresh) return false;
    // Upgrade layouts keep the same rows/cards. Update attributes and text in
    // place so images, progress controls, buttons and nested scrollers survive.
    function patch(node, next) {
      if (node.nodeType !== next.nodeType || node.nodeName !== next.nodeName) {
        node.replaceWith(next.cloneNode(true)); return;
      }
      if (node.nodeType === 3 || node.nodeType === 8) { if (node.nodeValue !== next.nodeValue) node.nodeValue = next.nodeValue; return; }
      if (node.nodeType !== 1) return;
      for (const attribute of [...node.attributes]) if (!next.hasAttribute(attribute.name)) node.removeAttribute(attribute.name);
      for (const attribute of [...next.attributes]) if (node.getAttribute(attribute.name) !== attribute.value) node.setAttribute(attribute.name, attribute.value);
      const oldChildren = [...node.childNodes], newChildren = [...next.childNodes];
      for (let i = 0; i < newChildren.length; i++) {
        if (oldChildren[i]) patch(oldChildren[i], newChildren[i]);
        else node.appendChild(newChildren[i].cloneNode(true));
      }
      for (let i = newChildren.length; i < oldChildren.length; i++) oldChildren[i].remove();
    }
    patch(live, fresh); return true;
  }
  function updatePermanentMenu(action, render, source) {
    if (!currentAccount || isRunActive() || !['heroes', 'armory', 'orchard'].includes(state) || source?.disabled) return false;
    const scrolled = [overlay, ...overlay.querySelectorAll('*')].filter(node => node.scrollTop || node.scrollLeft)
      .map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }));
    if (!action()) return false;
    permanentMenuRefresh = true;
    try { render(); }
    finally {
      permanentMenuRefresh = false;
      // Restoring focus must not scroll the page to the upgraded control.
      if (source?.isConnected && !source.disabled) source.focus({ preventScroll: true });
      for (const saved of scrolled) if (saved.node.isConnected) { saved.node.scrollTop = saved.top; saved.node.scrollLeft = saved.left; }
    }
    return true;
  }
  function show(html, menu = false) {
    const markup = '<div class="dialog' + (menu ? ' menu-dialog' : '') + '">' + html + '</div>';
    if (permanentMenuRefresh && menu && patchPermanentMenu(markup)) { overlay.classList.remove('hidden'); return; }
    window.ORCHARD_FRONTIER?.close();
    window.ORCHARD_LEADERBOARD?.close();
    overlay.classList.remove('upgrade-overlay', 'relic-map-overlay', 'lobby-overlay', 'help-overlay', 'armory-overlay', 'pause-overlay', 'roulette-overlay', 'store-overlay', 'result-overlay');
    arena.classList.remove('is-lobby');
    for (const attribute of ['role', 'aria-modal', 'aria-label', 'data-menu-kind']) overlay.removeAttribute?.(attribute);
    overlay.innerHTML = markup;
    overlay.classList.remove('hidden');
  }
  function showMenu(title, subtitle, body, actions, activeTab, note = '进度自动保存 · 所有操作无需滚轮') {
    if (!currentAccount) return false;
    const tabs = [['stages', '关卡挑战', 'navStages'], ['armory', '装备工坊', 'navArmory'], ['heroes', '英雄育成', 'navHeroes'], ['orchard', '我的果园', 'navOrchard'], ['world', '共享世界', 'navWorld'], ['leaderboard', '通关排行', 'navLeaderboard'], ['map', '投放地图', 'navMap']];
    show('<div class="menu-top"><div><div class="tag">' + subtitle + '</div><h2 class="menu-title">' + title + '</h2></div><div class="wallet">☀ 阳光籽 ' + profile.seeds + '　◆ 果核 ' + profile.cores + '<small>通关 ' + profile.clearedStages.length + ' / ' + stages.length + ' · 精灵 ' + profile.rescuedSprites.length + ' / ' + rescueDefs.length + '</small></div></div>' +
      '<div class="menu-body">' + featureGuideHTML(activeTab) + body + '</div><div class="menu-footer"><div class="menu-actions">' + actions + '</div>' +
      '<nav class="menu-nav" aria-label="果园功能">' + tabs.map(([tab, name, id]) => '<button class="nav-button ' + (activeTab === tab ? 'active' : '') + '" id="' + id + '" ' + (!featuresUnlocked() && ['armory', 'heroes', 'orchard', 'world'].includes(tab) ? 'disabled title="首次通关后解锁" ' : '') + 'aria-pressed="' + (activeTab === tab) + '">' + name + '</button>').join('') + '</nav>' +
      '<div class="micro">' + (!storageAvailable ? '浏览器存储不可用，进度仅在当前页面中保留' : note) + '</div></div>', true);
    overlay.dataset.menuKind = activeTab;
    el('navStages').onclick = startScreen; el('navHeroes').onclick = () => showHeroes(); el('navArmory').onclick = showArmory; el('navOrchard').onclick = showOrchard; el('navWorld').onclick = showWorld; el('navMap').onclick = showRelicMap;
    el('navLeaderboard').onclick = showLeaderboard;
    bindFeatureGuide(activeTab);
  }
  function showWorld(initialTab = 'map') {
    if (!currentAccount || isRunActive() || !featuresUnlocked()) return false;
    window.ORCHARD_LEADERBOARD?.close();
    state = 'world'; keys.clear(); pointer = null;
    if (!window.ORCHARD_FRONTIER) {
      showPanel('世界暂未载入', '共享世界 / 家园与公会', featureGuideHTML('world') + '<p>请刷新游戏后再次进入世界。</p>', '<button class="secondary" id="worldBackLobby">返回关卡</button>');
      el('worldBackLobby').onclick = startScreen;
      bindFeatureGuide('world');
    } else {
      const owner = currentAccount.id;
      window.ORCHARD_FRONTIER.open({ overlay, name: currentAccount.nickname, initialTab: typeof initialTab === 'string' ? initialTab : 'map', onExit: startScreen, onAuthenticated: () => frontierRewards?.retry(), guideHTML: featureGuideHTML('world'), onGuideDone: () => advanceFeatureGuide('world'), harvestSeen: profile.worldHarvestSeen, onHarvest: () => { if (currentAccount?.id === owner) { profile.worldHarvestSeen = true; saveProfile(); } } });
    }
    updateHUD(); return true;
  }
  function showLeaderboard() {
    if (!currentAccount || isRunActive() || training) return false;
    window.ORCHARD_FRONTIER?.close();
    state = 'leaderboard'; keys.clear(); pointer = null;
    if (!window.ORCHARD_LEADERBOARD) {
      showPanel('排行榜暂未载入', '通关远征 / 玩家排名', '<p>请刷新游戏后再次打开排行榜。</p>', '<button class="secondary" id="leaderboardBackLobby">返回关卡</button>');
      el('leaderboardBackLobby').onclick = startScreen;
    } else {
      window.ORCHARD_LEADERBOARD.open({ overlay, name: currentAccount.nickname, onExit: startScreen, localHighestStage: Math.max(0, ...profile.clearedStages) });
    }
    updateHUD(); return true;
  }
  function featuresUnlocked() { return profile.clearedStages.length > 0; }
  function firstGrowthStep() {
    if (!profile.clearedStages.includes(1) || profile.clearedStages.includes(2)) return null;
    if (!profile.firstCultivationUsed) return { index: 0, tab: 'orchard', name: '免费培养伙伴', tip: '苹果铃铃的第一次培养免费，全队生命祝福永久提升。' };
    if (!Object.entries(profile.inventory).some(([id, item]) => gearDefs[id]?.slot === 'weapon' && item.level > 0)) {
      const cost = gearCost(profile.equipped.weapon);
      if (canAfford(cost)) return { index: 1, tab: 'armory', name: '强化一件武器', tip: '先查看强化前后的属性，再用首通材料提升武器。' };
      return { index: 2, tab: 'stages', name: '挑战第二关', tip: '强化材料不足，先挑战第二关补充阳光籽和果核，之后再回来强化。' };
    }
    return { index: 2, tab: 'stages', name: '挑战第二关', tip: '伙伴祝福和装备强化已生效，带着成长出发。' };
  }
  function growthRouteHTML(tab, withAction = true) {
    const step = firstGrowthStep();
    if (!step || !['lobby', 'result', 'orchard', 'armory'].includes(tab)) return '';
    const done = [profile.firstCultivationUsed, Object.entries(profile.inventory).some(([id, item]) => gearDefs[id]?.slot === 'weapon' && item.level > 0), profile.clearedStages.includes(2)];
    return '<aside class="growth-route" aria-label="首通成长路线"><div><strong>新功能已解锁 · 推荐下一步：' + step.name + '</strong><p>' + step.tip + '</p><ol>' + ['免费培养', '强化武器', '挑战第二关'].map((label, index) => '<li class="' + (done[index] ? 'done' : index === step.index ? 'current' : '') + '">' + (done[index] ? '✓ ' : (index + 1) + ' ') + label + '</li>').join('') + '</ol></div>' + (withAction ? '<button class="primary" id="growthNext">' + (tab === 'armory' && step.tab === 'armory' ? '查看强化效果与费用' : tab === step.tab ? step.name : '前往' + step.name) + '</button>' : '') + '</aside>';
  }
  function followGrowthRoute(tab) {
    const step = firstGrowthStep(); if (!step || isRunActive()) return false;
    if (step.tab === 'orchard') {
      selectedSprite = 1; selectedGarden = 1;
      if (tab === 'orchard') return updatePermanentMenu(() => upgradeSprite(1), () => showOrchard(), el('growthNext'));
      return showOrchard(1);
    }
    if (step.tab === 'armory') {
      if (tab === 'armory') {
        if (selectedGearSlot !== 'weapon') showArmory('weapon');
        const button = Array.from(overlay.querySelectorAll('[data-enhance]')).find(item => item.dataset.enhance === profile.equipped.weapon);
        button?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); button?.focus?.({ preventScroll: true }); return !!button;
      }
      return showArmory('weapon');
    }
    selectStage(2); start(); return true;
  }
  function featureGuideSteps() {
    return [
      { tab: 'armory', id: 'navArmory', name: '装备工坊', tip: '选择武器、护甲或饰品卡片，查看属性。通关材料可以强化已拥有的装备。' },
      { tab: 'heroes', id: 'navHeroes', name: '英雄育成', tip: '点击英雄头像查看技能，选择出战英雄。训练与全队天赋会永久提升实力。' },
      { tab: 'orchard', id: 'navOrchard', name: '我的果园', tip: '点击第一位伙伴，免费培养一次，体验全队祝福。后续培养和扩建使用通关材料。' },
      { tab: 'world', id: 'navWorld', name: '共享世界', tip: '点击地图上的空地查看建家选项。家园建好后可以造兵、结盟；通关所得世界物资用于这里。' }
    ].slice(0, profile.featureGuideRound === 2 ? 3 : 4);
  }
  function featureGuideHTML(tab) {
    if (firstGrowthStep()) return growthRouteHTML(tab);
    if (!featuresUnlocked() || profile.featureGuideStep >= featureGuideSteps().length) return '';
    const step = featureGuideSteps()[profile.featureGuideStep];
    if (tab !== 'lobby' && tab !== step.tab) return '';
    if (profile.featureGuideRound === 2) return '';
    const secondRound = false;
    return '<aside class="feature-guide" aria-live="polite"><div><strong>' + (profile.featureGuideStep + 1) + ' / ' + featureGuideSteps().length + ' · ' + (tab === 'lobby' ? secondRound ? '第二关成长练习：' : '新功能已解锁：' : '认识') + step.name + '</strong><p>' + (tab === 'lobby' ? '点击下方发光的「' + step.name + '」按钮，' + (secondRound ? '再熟悉一次通关后的养成操作。' : '看看首次通关带来的新成长。') : step.tip) + '</p></div>' + (tab === 'lobby' ? '<button class="secondary" id="skipFeatureGuide">跳过指引</button>' : '<button class="primary" id="nextFeatureGuide" data-world-action="guide-done">' + (profile.featureGuideStep === featureGuideSteps().length - 1 ? '完成指引' : '了解了，下一项') + '</button>') + '</aside>';
  }
  function advanceFeatureGuide(tab) {
    if (!featuresUnlocked() || profile.featureGuideStep >= featureGuideSteps().length || featureGuideSteps()[profile.featureGuideStep].tab !== tab || isRunActive()) return false;
    profile.featureGuideStep++; saveProfile(); window.ORCHARD_FRONTIER?.close(); startScreen(); return true;
  }
  function bindFeatureGuide(tab) {
    if (firstGrowthStep()) {
      if (el('growthNext')) el('growthNext').onclick = () => followGrowthRoute(tab);
      return;
    }
    if (!featuresUnlocked() || profile.featureGuideRound === 2 || profile.featureGuideStep >= featureGuideSteps().length) return;
    const step = featureGuideSteps()[profile.featureGuideStep];
    if (tab === 'lobby') {
      el(step.id)?.classList.add('feature-guide-target');
      el('skipFeatureGuide').onclick = () => { profile.featureGuideStep = featureGuideSteps().length; saveProfile(); startScreen(); };
    } else if (tab === step.tab) el('nextFeatureGuide').onclick = () => advanceFeatureGuide(tab);
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
  function syncViewport() {
    const rect = canvas.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) return false;
    const aspect = rect.width / rect.height;
    const height = aspect >= 1 ? 680 : 620 / aspect;
    const fit = Math.min(1, WORLD_W / (height * aspect), WORLD_H / height);
    W = Math.min(WORLD_W, (aspect >= 1 ? rect.width * 680 / rect.height : 620) * fit);
    H = Math.min(WORLD_H, height * fit);
    const density = Math.max(1, Math.min(2, Number(window.devicePixelRatio) || 1));
    const pixelFit = Math.min(density, 4096 / Math.max(rect.width, rect.height));
    const pixelWidth = Math.max(1, Math.round(rect.width * pixelFit));
    const pixelHeight = Math.max(1, Math.round(rect.height * pixelFit));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth; canvas.height = pixelHeight;
    }
    if (player) updateCamera();
    return true;
  }
  function isRunActive() { return runStates.includes(state) || (state === 'relicMap' && ['playing', 'paused'].includes(mapReturnState)) || (state === 'help' && ['playing', 'paused'].includes(helpReturnState)) || (state === 'itemStore' && ['playing', 'paused'].includes(storeReturnState)); }
  function randomRelics() {
    const pool = [...relicDefs];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool.slice(0, 6);
  }
  function resetRelics(reroll = true) {
    trackedRelic = null;
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
    if (enemy.boss && elapsed < (enemy.arrivalGuardUntil || 0)) damage *= .1;
    // Keep the practice boss alive until a real charge has been avoided.
    if (training && enemy.boss && !training.bossDodges) damage = Math.min(damage, Math.max(0, enemy.hp - 1));
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
  function nearestRelic() {
    const origin = isRunActive() ? player : mapLayout.spawn;
    return relicDrops.filter(drop => !drop.claimed).sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y))[0];
  }
  function showRelicMap(preferredId = null) {
    if (!currentAccount) return false;
    if (state !== 'relicMap') {
      if (!['lobby', 'heroes', 'armory', 'orchard', 'playing', 'paused'].includes(state)) return false;
      mapReturnState = state; state = 'relicMap'; keys.clear(); pointer = null; still = 0;
      selectedRelic = (relicDrops.find(drop => String(drop.id) === String(preferredId)) || relicDrops.find(drop => String(drop.id) === String(trackedRelic) && !drop.claimed) || nearestRelic() || relicDrops[0]).id;
    }
    const battle = ['playing', 'paused'].includes(mapReturnState), def = runRelicDefs.find(d => String(d.id) === String(selectedRelic)) || runRelicDefs[0];
    if (training && trainingCatalog.steps[training.step].id === 'map' && battle) training.mapOpened = true;
    selectedRelic = def.id;
    const points = relicDrops;
    const selected = points.find(d => d.id === def.id), distance = Math.round(Math.hypot(selected.x - player.x, selected.y - player.y));
    const body = '<div class="relic-layout"><div class="relic-board">' + mapRenderer.svg(mapLayout) +
      '<span class="relic-start" style="left:' + mapLayout.spawn.x / WORLD_W * 100 + '%;top:' + mapLayout.spawn.y / WORLD_H * 100 + '%">🌱 起点</span>' +
      points.map((point, index) => { const d = relicDefs.find(item => item.id === point.id); return '<button class="relic-marker ' + (point.id === selectedRelic ? 'selected ' : '') + (point.claimed ? 'claimed' : '') + '" data-relic-id="' + point.id + '" style="left:' + point.x / WORLD_W * 100 + '%;top:' + point.y / WORLD_H * 100 + '%;--relic-color:' + d.color + '" aria-label="' + d.name + (point.claimed ? '已领取' : '投放点') + '"><span>' + (index + 1) + '</span><b>' + d.icon + '</b></button>'; }).join('') +
      (battle ? '<span class="relic-player" style="left:' + player.x / WORLD_W * 100 + '%;top:' + player.y / WORLD_H * 100 + '%">●</span>' : '') + '</div><div class="relic-details"><div class="relic-selector">' +
      points.map((point, index) => '<button class="secondary ' + (point.id === selectedRelic ? 'selected ' : '') + (point.claimed ? 'claimed' : '') + '" data-relic-id="' + point.id + '">' + (index + 1) + ' ' + relicDefs.find(d => d.id === point.id).icon + (point.claimed ? ' ✓' : '') + '</button>').join('') + '</div><button class="secondary relic-nearest" id="nearestRelic" ' + (!nearestRelic() ? 'disabled' : '') + '>推荐最近的未领取饰品</button><article class="relic-detail"><strong>' + def.icon + ' ' + def.name + '</strong><span class="relic-skill">获得技能：' + def.skillName + '</span><p class="relic-description">' + def.description + '</p><p class="relic-summary">' + def.summary + '</p><small>' + (def.family === 'stats' ? '本局持续属性增益' : '冷却 ' + def.cooldown + ' 秒') + (def.key === 'dash' ? ' · Space / 闪步按钮' : def.family === 'stats' ? '' : ' · 自动触发') + '</small><span class="relic-status">' + (selected.claimed ? '✓ 本局已领取' : String(trackedRelic) === String(selected.id) ? '➤ 正在追踪此饰品' : '靠近亮光即可领取') + (battle ? ' · 距离 ' + distance : '') + '</span><details><summary>查看投放坐标</summary><small>' + Math.round(selected.x) + ' / ' + Math.round(selected.y) + '</small></details></article><div class="relic-route">第 ' + mapLayout.id + ' 关 · ' + mapLayout.name + '<br>沿道路绕过障碍，水域和裂谷需要从桥上通过。每局随机 6 件饰品，每件可领一次，无尽保留。</div></div></div>';
    if (battle) showPanel('特殊饰品投放图', '第 ' + activeStage.id + ' 关 / 探索领技能', body, '<button class="primary" id="trackSelectedRelic" ' + (selected.claimed ? 'disabled' : '') + '>' + (String(trackedRelic) === String(selected.id) ? '取消追踪' : '追踪此饰品并返回') + '</button><button class="secondary" id="closeRelicMap">返回战场 · M / Esc</button>', '查看地图期间战斗、增援与技能冷却暂停');
    else showMenu('特殊饰品投放图', '第 ' + selectedStage + ' 关 / ' + mapLayout.name, body, '<button class="primary" id="start">挑战第 ' + selectedStage + ' 关</button><button class="secondary" id="closeRelicMap">返回</button>', 'map', '当前关卡真实地形 · 点选投放点查看技能效果');
    overlay.classList.add('relic-map-overlay');
    overlay.querySelectorAll('[data-relic-id]').forEach(button => { button.onclick = () => { selectedRelic = relicDefs.find(d => String(d.id) === button.dataset.relicId).id; showRelicMap(); }; });
    el('nearestRelic').onclick = () => { const target = nearestRelic(); if (target) { selectedRelic = target.id; showRelicMap(); } };
    if (battle) el('trackSelectedRelic').onclick = () => { if (selected.claimed || state !== 'relicMap') return; trackedRelic = String(trackedRelic) === String(selected.id) ? null : selected.id; closeRelicMap(); };
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
    const trainingEntry = needsFirstTraining() ? '<div class="training-entry"><div><strong>🌱 新手引导关 · 晨芽练习场</strong><small>10 项实操任务，认识战斗与全部养成功能</small></div><button class="secondary" id="startTraining">开始引导</button></div>' : '';
    show('<div class="lobby-heading"><div class="chapter-heading"><small class="chapter-eyebrow">ORCHARD GUARDIANS / 第 ' + String(id).padStart(2, '0') + ' 关</small><h2 class="chapter-name">' + s.name + '</h2><span class="chapter-status">' + status + '</span></div><div class="lobby-wallet">☀ ' + profile.seeds + '　◆ ' + profile.cores + '<small>通关 ' + profile.clearedStages.length + ' / ' + stages.length + ' · 救援 ' + profile.rescuedSprites.length + ' / ' + rescueDefs.length + '</small></div></div>' +
      '<div class="menu-body lobby-body"><section class="chapter-showcase" aria-label="关卡图片"><img class="chapter-image" style="filter:hue-rotate(' + (art.stages[id - 1].hue || 0) + 'deg)" src="' + art.stages[id - 1].image + '" alt="' + s.name + '主题图"><div class="chapter-shade"></div><span class="chapter-ribbon">' + String(id).padStart(2, '0') + ' / ' + stages.length + ' · ' + (unlocked ? cleared ? '已通关' : '可挑战' : '未解锁') + '</span>' +
      '<button class="chapter-arrow previous" id="previousStage" aria-label="切换上一关" ' + (id === 1 ? 'disabled' : '') + '>‹</button><button class="chapter-arrow next" id="nextStagePreview" aria-label="切换下一关" ' + (id === stages.length ? 'disabled' : '') + '>›</button>' +
      '<div class="chapter-overlay-content"><div class="chapter-guide">' + featureGuideHTML('lobby') + '</div><div class="chapter-caption"><strong>守护这片果园</strong><span>' + s.description + '</span></div></div></section>' +
      '<div class="campaign-picker"><label>篇章 <select id="chapterJump" aria-label="选择远征篇章">' + ['青叶启程', '月露群岛', '赤焰山林', '霜晶高原', '星辉王庭'].map((name, index) => '<option value="' + (index * 20 + 1) + '" ' + (Math.floor((id - 1) / 20) === index ? 'selected' : '') + '>' + (index + 1) + ' · ' + name + '</option>').join('') + '</select></label><label>关卡 <select id="stageJump" aria-label="选择篇章关卡">' + stages.slice(Math.floor((id - 1) / 20) * 20, Math.floor((id - 1) / 20) * 20 + 20).map(item => '<option value="' + item.id + '" ' + (item.id === id ? 'selected' : '') + '>第 ' + item.id + ' 关 · ' + (profile.clearedStages.includes(item.id) ? '✓' : item.id <= profile.unlockedStage ? '可挑战' : '未解锁') + '</option>').join('') + '</select></label></div>' +
      '<div class="chapter-brief"><span class="chapter-chip">普通 ' + s.normalCount + ' · 精英 ' + s.eliteCount + ' · Boss ' + s.bossCount + '</span><span class="chapter-chip">虫王 ' + s.bossSchedule[0] + ' 秒起 · ' + (s.bossCount > 1 ? '每' + s.bossInterval + '秒一位，可同时在场' : '固定时间登场') + '</span><span class="chapter-chip">首通 ☀ ' + s.reward.seeds + ' · ◆ ' + s.reward.cores + reward + '</span></div></div>' +
      '<div class="menu-footer lobby-footer">' + trainingEntry + '<div class="lobby-actions"><button class="lobby-play primary" id="start" ' + (!unlocked ? 'disabled' : '') + '><span class="action-icon">▶</span><strong>' + (unlocked ? '进入游戏' : '关卡未解锁') + '</strong><small>' + (unlocked ? '挑战第 ' + id + ' 关' : '先通关第 ' + (id - 1) + ' 关') + '</small></button>' +
      [['navArmory', '⚒', '装备工坊', '搭配与强化'], ['navHeroes', '✦', '英雄育成', '技能与出战'], ['navOrchard', '♧', '我的果园', '精灵与养成'], ['navWorld', '⚑', '共享世界', '建家 · 造兵 · 公会']].map(([key, icon, name, detail]) => '<button class="lobby-feature secondary" id="' + key + '" ' + (!featuresUnlocked() ? 'disabled title="首次通关后解锁"' : '') + '><span class="action-icon">' + (featuresUnlocked() ? icon : '🔒') + '</span><strong>' + name + '</strong><small>' + (featuresUnlocked() ? detail : '首次通关后解锁') + '</small></button>').join('') + '</div>' +
      '<div class="lobby-bottom"><span class="lobby-note">' + (!storageAvailable ? '浏览器存储不可用，进度仅在当前页面中保留' : escapeHTML(sessionGreeting) + (sessionGreeting ? ' · ' : '') + '出战：' + growth.hero(profile.selectedHero).name) + '</span><div class="lobby-links"><button class="chapter-map-link leaderboard-entry" id="navLeaderboard">🏆 通关排行</button><button class="chapter-map-link" id="navMap" ' + (!unlocked ? 'disabled' : '') + '>本关地形与饰品 ↗</button></div></div></div>', true);
    overlay.classList.add('lobby-overlay'); arena.classList.add('is-lobby');
    el('start').onclick = () => { if (unlocked && state === 'lobby') start(); };
    if (trainingEntry) el('startTraining').onclick = showTrainingIntro;
    el('previousStage').onclick = () => browseStage(-1); el('nextStagePreview').onclick = () => browseStage(1);
    for (const key of ['chapterJump', 'stageJump']) el(key).onchange = () => {
      if (state !== 'lobby') return;
      const target = Number(el(key).value);
      if (!Number.isInteger(target) || target < 1 || target > stages.length) return;
      if (target <= profile.unlockedStage) { selectStage(target); player = freshPlayer(); updateCamera(); updateHUD(); }
      renderLobby(target);
    };
    el('navArmory').onclick = showArmory; el('navHeroes').onclick = () => { inspectedHero = profile.selectedHero; showHeroes('heroes'); }; el('navOrchard').onclick = showOrchard;
    el('navWorld').onclick = showWorld;
    el('navLeaderboard').onclick = showLeaderboard;
    el('navMap').onclick = () => { if (unlocked && state === 'lobby') showRelicMap(); };
    bindFeatureGuide('lobby');
  }
  function browseStage(direction) {
    if (state !== 'lobby' || ![-1, 1].includes(direction)) return false;
    const id = Math.max(1, Math.min(stages.length, previewStage + direction));
    if (id === previewStage) return false;
    if (id <= profile.unlockedStage) { selectStage(id); player = freshPlayer(); updateCamera(); updateHUD(); }
    renderLobby(id); return true;
  }
  function startScreen() {
    if (training) return exitTraining();
    if (!currentAccount) { showCover(); return false; }
    state = 'lobby'; keys.clear(); pointer = null; enemies = []; bullets = []; gems = []; particles = []; still = 0; shake = 0;
    bossIndex = 0; bossKills = 0; nonBossKills = 0; bossArrivalUntil = 0; heroEffects = [];
    runMode = 'stage'; stageVictoryReady = false; setMap(selectedStage); player = freshPlayer(); stageXP = experience.create(stage());
    resetRelics(challengeStarted || runRelicDefs.length !== 6); challengeStarted = false; updateCamera(); updateHUD();
    renderLobby();
  }
  function heroPortrait(hero) {
    const frame = art.heroFrames?.[hero.id];
    if (frame) return '<span class="hero-portrait" role="img" aria-label="' + hero.name + '立绘" style="background-image:url(\'' + art.heroAtlas + '\');background-size:' + 100 / frame.w + '% ' + 100 / frame.h + '%;background-position:' + frame.x / (1 - frame.w) * 100 + '% ' + frame.y / (1 - frame.h) * 100 + '%;--hero-color:' + hero.color + '"></span>';
    if (art.heroImages?.[hero.id]) return '<span class="hero-portrait" role="img" aria-label="' + hero.name + '立绘" style="background-image:url(\'' + art.heroImages[hero.id] + '\');background-size:contain;background-position:center;--hero-color:' + hero.color + '"></span>';
    const index = art.sprites[hero.id], column = index % 4, row = Math.floor(index / 4);
    return '<span class="hero-portrait" role="img" aria-label="' + hero.name + '立绘" style="background-image:url(\'' + art.atlas + '\');background-size:400% 400%;background-position:' + column * 100 / 3 + '% ' + row * 100 / 3 + '%;--hero-color:' + hero.color + '"></span>';
  }
  function heroSummary(hero) {
    return heroSkillView === 'active' ? hero.skillDescription : hero.passiveDescription;
  }
  function selectHero(id) {
    if (!currentAccount || !featuresUnlocked() || isRunActive() || !growth.isUnlocked(id, profile)) return false;
    profile.selectedHero = id; inspectedHero = id; saveProfile(); player = freshPlayer(); updateHUD(); return true;
  }
  function trainHero(id) {
    if (!currentAccount || !featuresUnlocked()) return false;
    const hero = growth.hero(id), level = profile.heroLevels[id] || 0;
    if (!hero || isRunActive() || !growth.isUnlocked(hero, profile)) return false;
    const cost = growth.cost('hero', id, level); if (!cost || !canAfford(cost)) return false;
    profile.seeds -= cost.seeds; profile.cores -= cost.cores; profile.heroLevels[id] = level + 1;
    saveProfile(); player = freshPlayer(); updateHUD(); return true;
  }
  function researchTalent(id) {
    if (!currentAccount || !featuresUnlocked()) return false;
    if (isRunActive() || !growth.talents.some(t => t.id === id)) return false;
    const cost = growth.cost('talent', id, profile.talents[id] || 0); if (!cost || !canAfford(cost)) return false;
    profile.seeds -= cost.seeds; profile.cores -= cost.cores; profile.talents[id] = (profile.talents[id] || 0) + 1;
    saveProfile(); player = freshPlayer(); updateHUD(); return true;
  }
  function showHeroes(tab = heroTab) {
    if (!currentAccount || !featuresUnlocked()) return false;
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
    const talentsHTML = '<div class="growth-grid talent-grid">' + growth.talents.map(talent => {
      const level = profile.talents[talent.id] || 0, cost = growth.cost('talent', talent.id, level);
      return '<article class="growth-card talent-card' + (!cost ? ' mastered' : '') + '"><img class="talent-art" src="' + talent.art + '" alt="' + talent.name + '天赋插画" width="1254" height="1254"><div class="talent-copy"><small class="talent-category">全队永久天赋</small><strong>' + talent.name + '</strong><span>' + talent.description + '</span><div class="talent-progress"><small>研究 ' + level + ' / ' + talent.maxLevel + (!cost ? ' · 已满级' : '') + '</small><progress max="' + talent.maxLevel + '" value="' + level + '" aria-label="' + talent.name + '研究进度"></progress></div></div><button class="secondary" data-research="' + talent.id + '" ' + (!cost || !canAfford(cost) ? 'disabled' : '') + '>' + (!cost ? '研究已完成' : '研究 · ☀' + cost.seeds + ' ◆' + cost.cores) + '</button></article>';
    }).join('') + '</div>';
    showMenu('守卫集结', '英雄育成 / 永久成长', tabs + (heroTab === 'heroes' ? heroesHTML : talentsHTML), '<button class="primary" id="start">出战第 ' + selectedStage + ' 关</button><button class="secondary" id="backLobby">返回关卡</button>', 'heroes', '英雄、训练与研究自动保存 · 战斗中 E 施放专属技能');
    overlay.querySelectorAll('[data-growth-tab]').forEach(b => { b.onclick = () => showHeroes(b.dataset.growthTab); });
    overlay.querySelectorAll('[data-hero-view]').forEach(b => { b.onclick = () => { heroSkillView = b.dataset.heroView; showHeroes(); }; });
    overlay.querySelectorAll('[data-inspect-hero]').forEach(b => { b.onclick = () => { inspectedHero = b.dataset.inspectHero; showHeroes('heroes'); }; });
    overlay.querySelectorAll('[data-research]').forEach(b => { b.onclick = () => updatePermanentMenu(() => researchTalent(b.dataset.research), () => showHeroes('talents'), b); });
    if (heroTab === 'heroes') {
      el('heroGrid').scrollTop = heroListScroll;
      el('equipHero').onclick = () => updatePermanentMenu(() => selectHero(inspectedHero), () => showHeroes(), el('equipHero'));
      el('trainHero').onclick = () => updatePermanentMenu(() => trainHero(inspectedHero), () => showHeroes(), el('trainHero'));
    }
    el('start').onclick = start; el('backLobby').onclick = startScreen; updateHUD(); return true;
  }
  function gearCost(id) {
    const level = profile.inventory[id]?.level || 0;
    return { seeds: 35 + level * 25, cores: 1 + Math.floor(level / 4) };
  }
  function equipGear(id) {
    if (!currentAccount || !featuresUnlocked() || !profile.inventory[id] || !gearDefs[id] || isRunActive()) return false;
    profile.equipped[gearDefs[id].slot] = id; saveProfile(); player = freshPlayer(); updateHUD(); return true;
  }
  function upgradeGear(id) {
    if (!currentAccount || !featuresUnlocked()) return false;
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
  function gearValues(id, level = profile.inventory[id]?.level || 0) {
    const g = gearDefs[id];
    if (g.slot === 'weapon') return [['每籽伤害', g.damage * (1 + level * gearGrowth.damage)], ['每秒齐射', g.rate * (1 + level * gearGrowth.rate)], ['每轮种子', g.shots]];
    if (g.slot === 'armor') return [['生命', g.hp + level * gearGrowth.hp], ['固定减伤', g.defense + level * gearGrowth.defense], ['移速倍率', g.speedMult * 100, '%']];
    return [['移速', g.speed + level * gearGrowth.speed], ['拾取距离', g.pickup + level * gearGrowth.pickup], ['经验倍率', g.xpMult * 100, '%']];
  }
  function gearValueText(value, suffix = '') { return Number(value.toFixed(2)) + suffix; }
  function gearComparisonHTML(id) {
    const g = gearDefs[id], level = profile.inventory[id]?.level || 0, currentId = profile.equipped[g.slot];
    const values = gearValues(id), current = gearValues(currentId);
    const comparison = id === currentId ? '' : '<details class="equipment-comparison"><summary>与当前穿戴的' + gearDefs[currentId].name + '比较</summary><div>' + values.map(([label, value, suffix], index) => {
      const diff = Number((value - current[index][1]).toFixed(2));
      return '<span>' + label + '<b>' + gearValueText(current[index][1], suffix) + ' → ' + gearValueText(value, suffix) + '</b><small>' + (diff > 0 ? '+' : '') + gearValueText(diff, suffix) + '</small></span>';
    }).join('') + '</div></details>';
    if (!profile.inventory[id] || level >= 10) return comparison;
    const next = gearValues(id, level + 1);
    const output = values[0][1] * values[1][1] * values[2][1], nextOutput = next[0][1] * next[1][1] * next[2][1];
    return '<div class="equipment-upgrade-preview"><strong>强化到 +' + (level + 1) + '</strong>' + values.map(([label, value, suffix], index) => next[index][1] === value ? '' : '<span>' + label + '<b>' + gearValueText(value, suffix) + ' → ' + gearValueText(next[index][1], suffix) + '</b></span>').join('') +
      (g.slot === 'weapon' ? '<small>基础参考输出 / 秒：' + gearValueText(output) + ' → ' + gearValueText(nextOutput) + '（+' + gearValueText((nextOutput / output - 1) * 100) + '%）<br>按全部命中计算，不含技能、穿透和英雄加成。</small>' : '') + '</div>' + comparison;
  }
  function gearStatChips(id) {
    const g = gearDefs[id], level = profile.inventory[id]?.level || 0;
    const stats = g.slot === 'weapon' ? [['每籽伤害', statText(g.damage * (1 + level * gearGrowth.damage))], ['每秒齐射', Number((g.rate * (1 + level * gearGrowth.rate)).toFixed(2))], ['每轮种子', g.shots]] :
      g.slot === 'armor' ? [['生命', g.hp + level * gearGrowth.hp], ['固定减伤', g.defense + level * gearGrowth.defense], ['移速倍率', Math.round(g.speedMult * 100) + '%']] :
      [['移速', g.speed + level * gearGrowth.speed], ['拾取距离', g.pickup + level * gearGrowth.pickup], ['经验倍率', Math.round(g.xpMult * 100) + '%']];
    return '<div class="equipment-stats">' + stats.map(([label, value]) => '<div><small>' + label + '</small><b>' + value + '</b></div>').join('') + '</div>';
  }
  function showArmory(slot = selectedGearSlot) {
    if (!currentAccount || !featuresUnlocked() || isRunActive()) return false;
    const listScroll = el('equipmentGrid')?.scrollTop || 0, sameSlot = slot === selectedGearSlot;
    if (['weapon', 'armor', 'charm'].includes(slot)) selectedGearSlot = slot;
    state = 'armory';
    const groups = [['weapon', '武器', '每级：伤害 +6% 基础值，射速 +2% 基础值'], ['armor', '护甲', '每级：生命 +8，减伤 +0.5'], ['charm', '饰品', '每级：移速 +3，拾取范围 +6']];
    const note = groups.find(([slot]) => slot === selectedGearSlot)[2];
    showMenu('装备工坊', '更换装备 / 永久强化', '<div class="gear-toolbar"><div class="gear-tabs">' + groups.map(([slot, title]) => '<button class="secondary ' + (slot === selectedGearSlot ? 'active' : '') + '" data-gear-slot="' + slot + '">' + title + '</button>').join('') + '</div><span class="gear-note">' + note + '</span></div>' +
      '<div class="armory-loadout" aria-label="当前穿戴">' + groups.map(([slot, title]) => {
        const id = profile.equipped[slot];
        return '<button type="button" class="loadout-item" data-gear-slot="' + slot + '">' + gearPortrait(id, 'loadout-art') + '<div><small>' + title + ' · 当前穿戴</small><strong>' + gearDefs[id].name + '</strong><span>强化 +' + profile.inventory[id].level + '</span></div></button>';
      }).join('') + '</div><div id="equipmentGrid" class="gear-grid equipment-grid">' + Object.entries(gearDefs).filter(([, g]) => g.slot === selectedGearSlot).map(([id, g]) => {
        const owned = !!profile.inventory[id], level = profile.inventory[id]?.level || 0, equipped = profile.equipped[selectedGearSlot] === id, cost = gearCost(id);
        const unlock = stages.find(s => s.firstClearGear === id)?.id;
        const tier = !unlock ? '初始' : unlock <= 20 ? '青叶' : unlock <= 40 ? '月露' : unlock <= 60 ? '赤焰' : unlock <= 80 ? '霜晶' : '星辉';
        const role = { weapon_seed: '均衡单发 · 稳定起步', weapon_pea: '高频单发 · 持续清理小虫', weapon_cherry: '双籽覆盖 · 兼顾两侧虫群', weapon_pumpkin: '三籽重击 · 覆盖密集虫群', armor_leaf: '轻巧自在', armor_bark: '坚韧守护', armor_rind: '厚甲生存', charm_sprout: '基础采集', charm_bloom: '灵活采集', charm_harvest: '加快成长' }[id] || g.desc;
        return '<article class="gear-card equipment-card ' + (owned ? '' : 'locked ') + (equipped ? 'equipped' : '') + '"><div class="equipment-picture"><span class="equipment-tier">' + tier + '</span>' + (equipped ? '<b class="equipment-equipped">✓ 穿戴中</b>' : !owned ? '<b class="equipment-locked">待解锁</b>' : '') + gearPortrait(id) + '</div><div class="equipment-copy"><strong>' + g.name + '</strong><p>' + role + '</p></div>' + gearStatChips(id) + gearComparisonHTML(id) +
          (owned ? '<div class="equipment-level"><span>强化 +' + level + ' / 10</span><div><i style="width:' + level * 10 + '%"></i></div></div><div class="gear-actions"><button class="secondary" data-equip="' + id + '" ' + (equipped ? 'disabled' : '') + '>' + (equipped ? '已装备' : '穿戴') + '</button>' +
            '<button class="secondary enhance-gear" data-enhance="' + id + '" ' + (level >= 10 || profile.seeds < cost.seeds || profile.cores < cost.cores ? 'disabled' : '') + '>' + (level >= 10 ? '已满级' : '强化 · ☀' + cost.seeds + ' ◆' + cost.cores) + '</button></div>' : '<div class="equipment-unlock">首通第 <b>' + unlock + '</b> 关获得</div>') + '</article>';
      }).join('') + '</div>', '<button class="primary" id="start">挑战第 ' + selectedStage + ' 关</button><button class="secondary" id="backLobby">返回关卡</button>', 'armory', '切换上方武器 / 护甲 / 饰品按钮查看全部装备 · 强化永久保留');
    el('backLobby').onclick = startScreen; el('start').onclick = start;
    overlay.querySelectorAll('[data-gear-slot]').forEach(b => b.onclick = () => showArmory(b.dataset.gearSlot));
    overlay.querySelectorAll('[data-equip]').forEach(b => b.onclick = () => updatePermanentMenu(() => equipGear(b.dataset.equip), () => showArmory(), b));
    overlay.querySelectorAll('[data-enhance]').forEach(b => b.onclick = () => updatePermanentMenu(() => upgradeGear(b.dataset.enhance), () => showArmory(), b));
    overlay.classList.add('armory-overlay');
    el('equipmentGrid').scrollTop = sameSlot ? listScroll : 0;
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
  function spriteCost(id) {
    const level = profile.spriteLevels[id] || 0;
    if (id === 1 && level === 0 && profile.rescuedSprites.includes(id) && !profile.firstCultivationUsed) return { seeds: 0, cores: 0, free: true };
    return { seeds: 20 + level * 22, cores: 1 + Math.floor(level / 4) };
  }
  function canAfford(cost) { return profile.seeds >= cost.seeds && profile.cores >= cost.cores; }
  function upgradeOrchard() {
    if (!currentAccount || !featuresUnlocked() || profile.orchard.level >= 10 || isRunActive()) return false;
    const cost = orchardCost(); if (!canAfford(cost)) return false;
    profile.seeds -= cost.seeds; profile.cores -= cost.cores; profile.orchard.level++; saveProfile(); player = freshPlayer(); updateHUD(); return true;
  }
  function upgradeSprite(id) {
    if (!currentAccount || !featuresUnlocked() || !Number.isInteger(id) || !profile.rescuedSprites.includes(id) || profile.spriteLevels[id] >= 5 || isRunActive()) return false;
    const cost = spriteCost(id); if (!canAfford(cost)) return false;
    profile.seeds -= cost.seeds; profile.cores -= cost.cores; profile.spriteLevels[id] = (profile.spriteLevels[id] || 0) + 1;
    if (cost.free) profile.firstCultivationUsed = true;
    saveProfile(); player = freshPlayer(); updateHUD(); return true;
  }
  function bonusText(type, amount) {
    const labels = { damage: '伤害', rate: '射速', hp: '生命', speed: '移速', pickup: '拾取范围' };
    return labels[type] + ' +' + (type === 'damage' || type === 'rate' ? Number((amount * 100).toFixed(1)) + '%' : Number(amount.toFixed(1)));
  }
  function spritePortrait(sprite, extraClass = '') {
    const name = escapeHTML(sprite.name + '精灵');
    const image = /^assets\/sprites\/[a-z]+\.svg$/.test(sprite.image || '') ? sprite.image : '';
    const variant = Number.isInteger(sprite.artVariant) && sprite.artVariant >= 0 && sprite.artVariant <= 4 ? sprite.artVariant : 0;
    // The fallback is a small drawn companion, rather than another unsupported emoji.
    const fallback = '<svg class="sprite-art-fallback" viewBox="0 0 96 96" role="img" aria-label="' + name + '，图片暂时无法显示"><ellipse cx="48" cy="84" rx="26" ry="6" fill="#173d2b" opacity=".22"/><path d="M49 31C45 12 58 9 72 14c-2 16-13 23-23 17Z" fill="#75b553" stroke="#284b32" stroke-width="3"/><path d="M46 35 43 20" stroke="#284b32" stroke-width="3" stroke-linecap="round"/><ellipse cx="48" cy="58" rx="28" ry="27" fill="#cfdd92" stroke="#284b32" stroke-width="3"/><path d="m23 63-9 7m58-7 9 7m-43 12-5 5m25-5 5 5" stroke="#284b32" stroke-width="5" stroke-linecap="round"/><ellipse cx="38" cy="55" rx="3" ry="4" fill="#284b32"/><ellipse cx="58" cy="55" rx="3" ry="4" fill="#284b32"/><path d="M42 65q6 7 12 0" fill="none" stroke="#284b32" stroke-width="3" stroke-linecap="round"/><circle cx="31" cy="62" r="4" fill="#e79f8d"/><circle cx="65" cy="62" r="4" fill="#e79f8d"/></svg>';
    return '<span class="sprite-portrait sprite-variant-' + variant + (extraClass ? ' ' + extraClass : '') + (!image ? ' sprite-image-unavailable' : '') + '">' +
      (image ? '<img src="' + image + '" alt="' + name + '" width="96" height="96" decoding="async" data-sprite-image="' + sprite.id + '">' : '') + fallback + '</span>';
  }
  function bindSpritePortraits() {
    overlay.querySelectorAll('[data-sprite-image]').forEach(image => {
      const unavailable = () => image.parentElement?.classList.add('sprite-image-unavailable');
      image.addEventListener('error', unavailable, { once: true });
      if (image.complete && image.naturalWidth === 0) unavailable();
    });
  }
  function showOrchard(gardenId = selectedGarden) {
    if (!currentAccount || !featuresUnlocked()) return false;
    if (isRunActive()) return false;
    state = 'orchard'; player = freshPlayer(); updateHUD();
    if (Number.isInteger(gardenId) && gardenId >= 1 && gardenId <= gardenDefs.length) selectedGarden = gardenId;
    const garden = gardenDefs[selectedGarden - 1], residents = rescueDefs.filter(s => s.gardenId === selectedGarden);
    const rescued = residents.filter(s => profile.rescuedSprites.includes(s.id));
    const cost = orchardCost(), bonus = orchardBonuses(), level = profile.orchard.level;
    const gardenName = garden.name;
    if (!rescued.some(s => s.id === selectedSprite)) selectedSprite = rescued[0]?.id || 0;
    const sprite = rescueDefs[selectedSprite - 1], spriteLevel = profile.spriteLevels[selectedSprite] || 0, trainingCost = spriteCost(selectedSprite);
    const detail = sprite ? '<article class="gear-card sprite-detail"><div class="companion-detail-heading">' + spritePortrait(sprite, 'companion-detail-portrait') + '<strong>' + sprite.name + ' · +' + spriteLevel + ' / 5</strong></div><span class="sprite-personality">' + sprite.personality + '</span><span>当前祝福：' + bonusText(sprite.bonusType, sprite.bonusPerLevel * (1 + spriteLevel)) + '</span><small>每次培养：' + bonusText(sprite.bonusType, sprite.bonusPerLevel) + '</small><div class="gear-actions"><button class="secondary" id="growSelectedSprite" data-grow-sprite="' + selectedSprite + '" ' + (spriteLevel >= 5 || !canAfford(trainingCost) ? 'disabled' : '') + '>' + (spriteLevel >= 5 ? '已满级' : trainingCost.free ? '首次培养 · 免费' : '培养 · ☀' + trainingCost.seeds + ' ◆' + trainingCost.cores) + '</button></div></article>' : '<article class="gear-card sprite-detail"><strong>等待第一位伙伴</strong><span>通关救出精灵后，它们会住进这里。点击园中的精灵，就能查看和培养。</span></article>';
    const gardenPicker = '<nav class="garden-picker" aria-label="十座果园">' + gardenDefs.map(g => '<button class="secondary ' + (g.id === selectedGarden ? 'active' : '') + '" data-garden-id="' + g.id + '" aria-pressed="' + (g.id === selectedGarden) + '"><strong>' + g.name + '</strong><small>' + profile.rescuedSprites.filter(id => Math.ceil(id / 10) === g.id).length + ' / 10</small></button>').join('') + '</nav>';
    showMenu(gardenName + ' · LV. ' + level, '我的果园 / 10 座果园 · 100 位精灵', gardenPicker + '<div class="orchard-layout"><div class="orchard-visual"><div class="orchard-scene garden-level-' + Math.floor(level / 3) + ' garden-region-' + selectedGarden + '"><div class="garden-sun" aria-hidden="true"></div><div class="garden-cloud" aria-hidden="true"></div><div class="garden-trees" aria-hidden="true"><span class="garden-tree"></span><span class="garden-tree"></span>' + (level >= 2 ? '<span class="garden-tree"></span>' : '') + (level >= 5 ? '<span class="garden-tree"></span>' : '') + '</div><div class="garden-path"></div><div class="garden-range">第 ' + garden.firstStage + '–' + garden.lastStage + ' 关 · 已入住 ' + rescued.length + ' / 10</div><div class="garden-residents">' +
      residents.map(sprite => { const owned = profile.rescuedSprites.includes(sprite.id); return owned ? '<button class="garden-resident ' + (sprite.id === selectedSprite ? 'selected' : '') + '" data-select-sprite="' + sprite.id + '" style="--delay:' + (sprite.id % 5) * -.35 + 's" title="' + sprite.name + '" aria-label="选择' + sprite.name + '">' + spritePortrait(sprite) + '<small>' + sprite.name + '</small></button>' : '<div class="garden-missing"><span>?</span><small>第 ' + sprite.id + ' 关救援</small></div>'; }).join('') + '</div></div>' +
      '<div class="garden-summary"><strong>全队永久加成</strong><span>' + Object.entries(bonus).map(([type, value]) => bonusText(type, value)).join(' · ') + '</span></div></div><div class="orchard-controls">' +
      '<div class="stage-detail"><strong>扩建全部果园 · ' + level + ' / 10</strong><span>10 座果园共享扩建等级。每级全队：伤害 +1%、生命 +4、拾取范围 +2。每关首通救援一位精灵，每座住10位。</span><div class="menu-actions"><button class="secondary" id="growOrchard" ' + (level >= 10 || !canAfford(cost) ? 'disabled' : '') + '>' + (level >= 10 ? '果园已满级' : '扩建 · ☀' + cost.seeds + ' ◆' + cost.cores) + '</button></div></div>' +
      detail + '</div></div>', '<button class="primary" id="start">挑战第 ' + selectedStage + ' 关</button><button class="secondary" id="backLobby">返回关卡</button>', 'orchard', '点击园中的精灵切换培养对象 · 果园与精灵祝福全队共享');
    el('growOrchard').onclick = () => updatePermanentMenu(upgradeOrchard, () => showOrchard(), el('growOrchard'));
    overlay.querySelectorAll('[data-garden-id]').forEach(b => b.onclick = () => showOrchard(Number(b.dataset.gardenId)));
    overlay.querySelectorAll('[data-select-sprite]').forEach(b => b.onclick = () => { selectedSprite = Number(b.dataset.selectSprite); showOrchard(); });
    overlay.querySelectorAll('[data-grow-sprite]').forEach(b => b.onclick = () => updatePermanentMenu(() => upgradeSprite(Number(b.dataset.growSprite)), () => showOrchard(), b));
    bindSpritePortraits();
    el('backLobby').onclick = startScreen; el('start').onclick = start; return true;
  }
  // Run growth uses the starting build as a baseline; repeated picks never compound.
  function experienceNeed(level) { return runMode === 'training' && level === 1 ? 180 : experience.need(level); }
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
    const recommendation = builds.recommended(player);
    // The first choice introduces a visible automatic skill, even when a hero
    // starts with extra projectiles or the player has chosen a recipe goal.
    if (player.level === 1) {
      const starters = pool.filter(def => ['chain', 'leafstorm', 'fireball'].includes(def.id));
      if (starters.length) {
        const starter = starters[Math.floor(Math.random() * starters.length)];
        picked.push(starter); pool.splice(pool.indexOf(starter), 1);
      }
    }
    if (recommendation && pool.includes(recommendation)) { picked.push(recommendation); pool.splice(pool.indexOf(recommendation), 1); }
    if (!picked.some(d => d.category === 'attack')) take('attack');
    if (!picked.some(d => d.category === 'attribute')) take('attribute');
    while (picked.length < 3 && pool.length) take();
    return picked.map(u => {
      const roll = Math.random(), rarity = rarities[roll < .65 ? 0 : roll < .93 ? 1 : 2];
      return { ...u, rarity, desc: u.describe(rarity.mult, player) };
    });
  }
  function start() {
    if (!currentAccount) { showCover(); return false; }
    if (training?.firstEntry) return false;
    if (!training && needsFirstTraining()) return startTraining(true);
    if (training) exitTraining(false);
    activeStage = stage(); setMap(activeStage.id); player = freshPlayer(); enemies = []; bullets = []; gems = []; particles = [];
    resetRelics(challengeStarted); challengeStarted = true;
    heroEffects = [];
    elapsed = 0; nextStageUpgradeAt = experience.interval(1); kills = 0; shotClock = 0; still = 0; shake = 0; choices = []; runRewarded = false;
    cinematicTime = 0; bossIndex = 0; bossKills = 0; nonBossKills = 0; bossArrivalUntil = 0; victoryRewardHTML = '';
    runMode = 'stage'; stageVictoryReady = false; endlessEntered = false; endlessWave = 0;
    frontierRewards?.begin(activeStage.id);
    stageXP = experience.create(activeStage);
    keys.clear(); pointer = null;
    for (let i = 0; i < activeStage.enemyCount; i++) spawn();
    enemies.forEach((enemy, index) => { enemy.xp = activeStage.xpRewards[index]; });
    updateCamera(); state = 'playing'; overlay.classList.add('hidden'); arena.classList.remove('is-lobby');
    try { audioCtx ??= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume().catch(() => {}); } catch {}
    updateHUD();
  }
  function trainingFeatures() {
    const primary = ['stages', 'builds', 'relics'];
    const cards = items => '<div class="training-features">' + items.map(item => '<article><span aria-hidden="true">' + item.icon + '</span><strong>' + escapeHTML(item.title) + '</strong><p>' + escapeHTML(item.description) + '</p></article>').join('') + '</div>';
    return cards(trainingCatalog.features.filter(item => primary.includes(item.id))) +
      '<details class="training-more"><summary>首次通关后还能做什么？</summary>' + cards(trainingCatalog.features.filter(item => !primary.includes(item.id))) + '</details>';
  }
  function needsFirstTraining() {
    return !!currentAccount && !profile.trainingComplete && !profile.trainingSkipped && !profile.tutorialSeen &&
      profile.unlockedStage === 1 && profile.clearedStages.length === 0;
  }
  function showTrainingIntro() {
    if (!currentAccount || isRunActive()) return false;
    state = 'trainingIntro'; keys.clear(); pointer = null;
    showPanel('欢迎来到' + trainingCatalog.name, '新手引导关 / 10 项实操', '<div class="training-summary"><p>跟着任务学会操作，再出发守护果园。虫群只在对应步骤出现，练习生命最低保留 50%，可以随时退出、重玩。</p><p>先移动、蓄力、击杀和升级，再练英雄技能、饰品、地图、精英与虫王。下面这些功能都会在正式游戏中用到：</p>' + trainingFeatures() + '</div>', '<button class="primary" id="beginTraining">进入练习场</button><button class="secondary" id="backTrainingLobby">返回关卡</button>', '练习升级和饰品只在本次练习生效 · 完成后记录学习进度');
    arena.classList.add('is-lobby');
    el('beginTraining').onclick = startTraining; el('backTrainingLobby').onclick = startScreen; updateHUD(); return true;
  }
  function trainingPoint(dx, dy, radius = 25) {
    const x = Math.max(training.center.x - 360, Math.min(training.center.x + 360, player.x + dx));
    const y = Math.max(training.center.y - 240, Math.min(training.center.y + 240, player.y + dy));
    return world.safePoint(x, y, radius + 20, obstacles, WORLD_W, WORLD_H);
  }
  function trainingEnemy(kind, index = 0) {
    const point = trainingPoint(index ? -170 : 170, index ? 80 : -50, kind === 'boss' ? 40 : 25);
    const enemy = { ...point, type: 0, r: 19, hp: Math.max(22, player.damage * 1.5), speed: 45, damage: 3,
      xp: kind === 'normal' && trainingCatalog.steps[training.step].id === 'combat' ? experienceNeed(1) / 2 : 0, pursuitAt: 0, aggro: true, phase: 0, flash: 0, elite: kind === 'elite' };
    if (kind === 'elite') { enemy.r = 25; enemy.hp = Math.max(70, player.damage * 4); enemy.speed = 55; }
    if (kind === 'boss') Object.assign(enemy, bossDefs[0], { ...point, boss: true, elite: false, type: 2, name: '练习虫王 · 青叶甲王',
      r: 37, hp: Math.max(160, player.damage * 10), speed: 45, damage: 5, chargeSpeed: 180, chargeInterval: 6,
      bossOrder: 0, bossArrivalAt: elapsed, introduced: true, pursuitAt: 0, aggro: true, xp: 0,
      chargeClock: 1, windup: 0, dashTime: 0, dashX: 0, dashY: 0 });
    enemy.maxHp = enemy.hp; enemies.push(enemy); return enemy;
  }
  function enterTrainingStep() {
    if (!training || training.step >= trainingCatalog.steps.length) return finishTraining();
    const id = trainingCatalog.steps[training.step].id;
    const droppedExperience = id === 'xp' ? gems : [];
    enemies = []; bullets = []; gems = droppedExperience; heroEffects = []; skillEffects = [];
    training.lastKills = kills; training.lastElites = nonBossKills; training.lastBosses = bossKills;
    training.lastCasts = player.heroCasts; training.standTime = 0; still = 0;
    if (id === 'combat') { trainingEnemy('normal'); trainingEnemy('normal', 1); }
    if (id === 'skill') { player.heroClock = 0; trainingEnemy('normal'); trainingEnemy('normal', 1); }
    if (id === 'relic') { const point = trainingPoint(155, 60, 44); Object.assign(relicDrops[0], point); mapLayout = { ...mapLayout, relics: [{ ...point, id: 'training-relic' }] }; }
    if (id === 'elite') trainingEnemy('elite');
    if (id === 'boss') { trainingEnemy('boss'); bossArrivalUntil = elapsed + 3; }
    updateHUD(); return true;
  }
  function startTraining(firstEntry = false) {
    if (!currentAccount || !trainingCatalog || isRunActive() || training) return false;
    const saved = { selectedStage, previewStage, defs: [...runRelicDefs], drops: relicDrops.map(drop => ({ ...drop })) };
    setMap(1);
    const center = { ...mapLayout.spawn };
    mapLayout = { ...mapLayout, name: trainingCatalog.name, obstacles: mapLayout.obstacles.filter(o => Math.hypot(o.x - center.x, o.y - center.y) > 750),
      landmarks: mapLayout.landmarks.filter(o => Math.hypot(o.x - center.x, o.y - center.y) > 750) };
    mapLayout.obstacles.push({ id: 'training-rock', kind: 'rock', shape: 'circle', x: center.x - 280, y: center.y + 145, r: 30, variant: 0 },
      { id: 'training-crate', kind: 'crate', shape: 'rect', x: center.x + 280, y: center.y - 180, w: 50, h: 50, variant: 0 });
    obstacles = mapLayout.obstacles; navigator = window.ORCHARD_NAV.create(mapLayout, world);
    activeStage = { ...stages[0], name: trainingCatalog.name, enemyCount: 4, normalCount: 2, fastCount: 0, eliteCount: 1, bossCount: 1, bossSchedule: [Infinity] };
    runMode = 'training'; training = { step: 0, distance: 0, standTime: 0, xpCollected: 0, mapOpened: false, bossDodges: 0, firstEntry: firstEntry === true, center, saved };
    player = freshPlayer(); enemies = []; bullets = []; gems = []; particles = []; heroEffects = []; skillEffects = [];
    keys.clear(); pointer = null; elapsed = 0; kills = 0; shotClock = 0; still = 0; shake = 0; choices = [];
    bossKills = 0; nonBossKills = 0; bossIndex = 0; bossArrivalUntil = 0;
    runRewarded = false; stageVictoryReady = false; endlessEntered = false; victoryRewardHTML = '';
    runRelicDefs = [relicDefs.find(def => def.key === 'lightning')]; selectedRelic = runRelicDefs[0].id; trackedRelic = null;
    relicDrops = [{ id: selectedRelic, key: 'lightning', slotId: 'training-relic', slotIndex: 0, x: center.x + 1000, y: center.y, claimed: false }];
    noticeQueue = []; currentNotice = null; noticeClock = 0; relicHudSignature = ''; buildHudSignature = '';
    state = 'playing'; overlay.classList.add('hidden'); arena.classList.remove('is-lobby');
    try { audioCtx ??= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume().catch(() => {}); } catch {}
    updateCamera(); enterTrainingStep(); return true;
  }
  function exitTraining(returnToLobby = true) {
    if (!training) return false;
    const saved = training.saved; training = null; runMode = 'stage'; state = 'lobby';
    selectedStage = saved.selectedStage; setMap(selectedStage); activeStage = stage();
    runRelicDefs = saved.defs; relicDrops = saved.drops; challengeStarted = false;
    keys.clear(); pointer = null; noticeQueue = []; currentNotice = null; noticeClock = 0;
    heroEffects = []; skillEffects = []; relicHudSignature = ''; buildHudSignature = '';
    if (returnToLobby) { startScreen(); renderLobby(saved.previewStage); }
    return true;
  }
  function skipTraining() {
    if (!training || !['playing', 'paused'].includes(state)) return false;
    if (training.firstEntry) {
      profile.trainingSkipped = true; profile.tutorialSeen = true; saveProfile();
    }
    return exitTraining();
  }
  function finishTraining() {
    if (!training || training.step < trainingCatalog.steps.length) return false;
    profile.trainingComplete = true; profile.tutorialSeen = true; saveProfile();
    exitTraining(); state = 'trainingDone';
    showPanel('你已经是一位果园守护者了！', '晨芽练习场 / 10 项任务完成', '<div class="training-summary"><p>你已经完成移动、蓄力、击杀、经验升级、技能、饰品与地图练习，并击败了精英和虫王。接下来挑战第一关；首次通关后解锁装备、英雄、果园和世界。</p>' + trainingFeatures() + '</div>',
      '<button class="primary" id="trainingCampaign">挑战正式关卡</button>' + (featuresUnlocked() ? '<button class="secondary" id="trainingHeroes">选英雄</button><button class="secondary" id="trainingEquipment">看装备</button><button class="secondary" id="trainingOrchard">逛果园</button>' : '') + '<button class="secondary" id="trainingBack">返回首页</button>',
      '学习进度已保存 · 练习不消耗材料，也不计入正式关卡通关');
    arena.classList.add('is-lobby');
    el('trainingCampaign').onclick = start; el('trainingBack').onclick = startScreen;
    if (featuresUnlocked()) { el('trainingHeroes').onclick = () => showHeroes(); el('trainingEquipment').onclick = showArmory; el('trainingOrchard').onclick = showOrchard; }
    updateHUD(); return true;
  }
  function trainingTick(dt = 0, distance = 0) {
    if (!training || state !== 'playing' || runMode !== 'training') return false;
    const id = trainingCatalog.steps[training.step].id;
    player.x = Math.max(training.center.x - 400, Math.min(training.center.x + 400, player.x));
    player.y = Math.max(training.center.y - 260, Math.min(training.center.y + 260, player.y));
    if (id === 'move') training.distance += distance;
    if (id === 'stand') training.standTime = movementVector().moving ? 0 : training.standTime + dt;
    const complete = id === 'move' ? training.distance >= 140 : id === 'stand' ? training.standTime >= 1.2 && still >= combat.standDelay : id === 'combat' ? kills - training.lastKills >= 2 :
      id === 'xp' ? training.xpCollected >= experienceNeed(1) - 1e-6 : id === 'upgrade' ? player.level >= 2 : id === 'skill' ? player.heroCasts > training.lastCasts :
      id === 'relic' ? relicDrops.some(drop => drop.claimed) : id === 'map' ? training.mapOpened : id === 'elite' ? nonBossKills > training.lastElites : id === 'boss' ? training.bossDodges > 0 && bossKills > training.lastBosses : false;
    if (complete) { training.step++; enterTrainingStep(); }
    updateCamera(); return complete;
  }
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }
  function tutorialSteps() {
    if (training) return trainingCatalog.steps.map(step => ({ icon: step.icon, title: step.title, text: step.description + ' ' + step.hint }));
    const hero = growth.hero(player.heroId);
    return [
      { icon: '↔', title: '先移动，果子会自动攻击', text: '电脑使用 WASD 或方向键移动。手机按住场地拖动，松手停止。武器会自动攻击虫群，先保持距离，绕开果树与石块。' },
      { icon: '✦', title: '安全时停下来，火力更强', text: '停下 ' + combat.standDelay + ' 秒后蓄力完成：伤害 +35%，射速 +35%。虫群靠近或虫王准备冲锋时，立刻移动避开，找到空隙再站定输出。' },
      { icon: '◆', title: '捡经验，选出你的构筑', text: '击杀掉落发光经验，靠近即可拾取。升级时三选一，也可按 1 / 2 / 3。关卡中攻击与属性各最多 4 种、每种 5 级；配方两项满级后自动合成超级技能。' },
      { icon: hero.skillIcon, title: '施放专属技能，探索特殊饰品', text: '当前英雄：' + hero.name + '，按 E 或右下按钮施放“' + hero.skillName + '”。' + hero.skillDescription + '每局从 50 件饰品随机投放 6 件，按 M 查看位置；拾取后右下角显示效果。' },
      { icon: '⚠', title: '留意虫群苏醒和虫王预警', text: '普通虫与精英按时间逐批加入。首位虫王固定 ' + activeStage.bossSchedule[0] + ' 秒到达，后续每 ' + activeStage.bossInterval + ' 秒登场；上一位未死也不会阻挡下一位，可以多位同时在场。击杀和清空小怪都不改变排程；暂停、升级和轮盘冻结实战时间。前三关虫王登场护壳1.5秒，减伤90%，然后正常受伤。看到冲锋预警就绕开攻击方向。' },
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
    if (!currentAccount || !['lobby', 'heroes', 'armory', 'orchard', 'world', 'leaderboard', 'relicMap', 'playing', 'paused'].includes(state) || (state === 'relicMap' && isRunActive())) return false;
    helpReturnState = state; helpTab = 'conversation'; tutorialStep = 0; tutorialIsFirstRun = false; helpFocusReturn = el('gameHelp');
    state = 'help'; keys.clear(); pointer = null; renderGameHelp(); updateHUD(); return true;
  }
  function openTutorial(firstRun = false) {
    if (!['playing', 'paused'].includes(state)) return false;
    helpReturnState = state; helpTab = 'guide'; tutorialStep = 0; tutorialIsFirstRun = firstRun; helpFocusReturn = firstRun ? null : el('combatGuide');
    state = 'help'; keys.clear(); pointer = null; renderGameHelp(); updateHUD(); return true;
  }
  function openBuildDetails(category, sourceButton) {
    if (!['playing', 'paused'].includes(state) || !['attack', 'attribute', 'super'].includes(category)) return false;
    const build = builds.summary(player), superView = category === 'super';
    const entries = superView ? build.supers : build[category];
    const label = superView ? '超级技能' : category === 'attack' ? '攻击词条' : '属性词条';
    const content = entries.length ? '<div class="build-detail-list">' + entries.map(def => {
      const recipe = superView ? def : builds.recipes.find(r => r.attack === def.id || r.attribute === def.id);
      const progress = recipe && !superView ? '<small>合成：' + escapeHTML(builds.get(recipe.attack).name) + ' ' + (player.build.levels[recipe.attack] || 0) + '/5 ＋ ' + escapeHTML(builds.get(recipe.attribute).name) + ' ' + (player.build.levels[recipe.attribute] || 0) + '/5 → ' + escapeHTML(recipe.name) + (player.build.superSkills.includes(recipe.id) ? '（已合成）' : '') + '</small>' : '';
      const effect = superView ? def.description : build.mode !== 'endless' && def.level >= def.maxLevel ? '已达关卡满级，进入无尽模式后可继续强化。' : '下次普通品质升级预览：' + def.describe(1, player);
      const short = superView ? builds.briefRecipe(def.id) : build.mode !== 'endless' && def.level >= def.maxLevel ? '本关已满级' : '下次升级：' + builds.brief(def, 1, player);
      return '<article class="build-detail"><img src="' + def.image + '" alt="' + escapeHTML(def.name) + '技能图示" width="48" height="48"><div><strong>' + escapeHTML(def.name) + (superView ? '' : ' · Lv.' + def.level) + '</strong><p>' + escapeHTML(short) + '</p>' + progress + '<details class="skill-numbers"><summary>详细数值</summary><p>' + escapeHTML(effect) + '</p></details></div></article>';
    }).join('') + '</div>' : '<p>目前还没有' + label + '。击杀虫子、拾取经验后，在升级三选一中学习。</p>';
    helpReturnState = state; helpTab = 'build'; tutorialIsFirstRun = false; helpFocusReturn = sourceButton || null;
    state = 'help'; keys.clear(); pointer = null;
    showPanel(label, '本局成长 / ' + (superView ? '已合成 ' + entries.length + ' 种' : entries.length + ' 种 · ' + build[category + 'Choices'] + ' 次成长'), content,
      '<button class="primary" id="closeGameHelp">返回' + (helpReturnState === 'paused' ? '暂停菜单' : '游戏') + '</button>', '查看期间战斗暂停 · Esc 返回 · 实际属性显示在左下角');
    overlay.classList.add('help-overlay'); overlay.setAttribute?.('role', 'dialog'); overlay.setAttribute?.('aria-modal', 'true'); overlay.setAttribute?.('aria-label', label);
    el('closeGameHelp').onclick = closeGameHelp;
    updateHUD(); el('closeGameHelp').focus?.(); return true;
  }
  function nextTutorial() {
    if (state !== 'help' || helpTab !== 'guide') return false;
    if (tutorialStep < tutorialSteps().length - 1) { tutorialStep++; renderGameHelp(); }
    else closeGameHelp();
    return true;
  }
  function closeGameHelp() {
    if (state !== 'help') return false;
    const focusReturn = helpFocusReturn; helpFocusReturn = null;
    if (tutorialIsFirstRun) { profile.tutorialSeen = true; saveProfile(); tutorialIsFirstRun = false; }
    keys.clear(); pointer = null; overlay.classList.remove('help-overlay');
    if (helpReturnState === 'paused') { state = 'playing'; pause(); }
    else if (helpReturnState === 'lobby') { state = 'lobby'; renderLobby(previewStage); }
    else if (helpReturnState === 'heroes') showHeroes();
    else if (helpReturnState === 'armory') showArmory();
    else if (helpReturnState === 'orchard') showOrchard();
    else if (helpReturnState === 'world') showWorld();
    else if (helpReturnState === 'leaderboard') showLeaderboard();
    else if (helpReturnState === 'relicMap') { state = 'relicMap'; showRelicMap(); }
    else resume();
    updateHUD(); focusReturn?.focus?.(); return true;
  }
  function openItemStore(source = el('openStoreShop'), tab = 'shop') {
    if (!currentAccount || training || !['lobby', 'heroes', 'armory', 'orchard', 'playing', 'paused'].includes(state)) return false;
    storeReturnState = state; storeFocusReturn = source; storeTab = tab === 'recharge' ? 'recharge' : 'shop';
    state = 'itemStore'; keys.clear(); pointer = null; renderItemStore(); return true;
  }
  function renderItemStore(message = '', success = false) {
    if (state !== 'itemStore' || !currentAccount) return false;
    storeRevision++; const c = profile.commerce;
    const diamond = '<img src="assets/store/diamond.svg" alt="" width="18" height="18">';
    const content = storeTab === 'recharge'
      ? '<div class="commerce-section-title"><h3>给钻石账户补充能量</h3><p>当前是免费测试模式，点击充值立即到账，不支付真钱。</p></div><div class="diamond-packs">' + store.packs.map((pack, i) =>
        '<article class="diamond-pack' + (i === 1 ? ' recommended' : '') + '"><span class="pack-label">' + pack.name + '</span><img src="assets/store/diamond.svg" alt="钻石" width="100" height="100"><strong>' + pack.diamonds.toLocaleString('en-US') + '<small>钻石</small></strong><p>免费测试充值 · 无真实支付</p><button type="button" class="primary" data-commerce-topup="' + pack.id + '">免费测试充值</button></article>').join('') + '</div>'
      : '<div class="commerce-section-title"><h3>钻石商城</h3><p>用钻石购买外观或补给。外观不会增加生命、伤害或拾取范围。</p></div><div class="commerce-products">' + store.products.map(product => {
        const owned = store.owns(profile, product.id), equipped = c.equippedAura === product.id || c.equippedFrame === product.id;
        return '<article class="commerce-product"><div class="product-visual"><span class="product-category">' + product.category + '</span><img src="' + product.art + '" alt="' + product.name + '" width="130" height="130">' + '<span class="product-owned' + (owned ? '' : ' hidden') + '" data-commerce-owned="' + product.id + '">✓ 已拥有</span>' + '</div><div class="product-description"><h4>' + product.name + '</h4><p>' + product.description + '</p><div class="product-bottom"><span class="diamond-price">' + diamond + product.price + '</span><button type="button" class="' + (owned ? 'secondary' : 'primary') + '" ' + (owned ? 'data-commerce-equip' : 'data-commerce-buy') + '="' + product.id + '" data-commerce-product="' + product.id + '">' + (owned ? equipped ? '已装备 · 取消' : '装备外观' : '钻石购买') + '</button></div></div></article>';
      }).join('') + '</div>';
    const records = c.receipts.slice(-5).reverse().map(record => {
      const label = record.kind === 'preview-topup' ? store.getPack(record.sku)?.name + '测试充值' : store.get(record.sku)?.name;
      return '<li><span>' + escapeHTML(label || record.sku) + '</span><strong class="' + (record.delta > 0 ? 'credit' : 'debit') + '">' + (record.delta > 0 ? '+' : '') + record.delta + ' ◆</strong></li>';
    }).join('');
    showPanel('果园钻石商城', '商业化体验 / DIAMOND STORE',
      '<div class="commerce-toolbar"><nav aria-label="钻石商城分类"><button type="button" class="commerce-tab' + (storeTab === 'shop' ? ' active' : '') + '" id="commerceShopTab" aria-pressed="' + (storeTab === 'shop') + '">商城商品</button><button type="button" class="commerce-tab' + (storeTab === 'recharge' ? ' active' : '') + '" id="commerceRechargeTab" aria-pressed="' + (storeTab === 'recharge') + '">钻石充值</button></nav><div class="commerce-wallet">' + diamond + '<span><small>当前钻石</small><strong id="commerceDiamondBalance">' + c.diamonds.toLocaleString('en-US') + '</strong></span><button type="button" id="commerceWalletPlus" aria-label="点击加号测试充值钻石">＋</button></div></div>' +
      '<div class="commerce-mode"><span></span><strong>免费测试模式</strong><p>充值不花真钱；商城购买会实际扣除钻石。</p></div>' + content +
      '<details id="commerceRecords" class="commerce-records' + (records ? '' : ' hidden') + '"><summary>最近测试记录 · 非真实支付订单</summary><ul id="commerceRecordsList">' + records + '</ul></details>' +
      '<div class="commerce-save-note">当前钻石与商品只保存在此浏览器的登录账号中，不是云端钱包，也不是付费凭证。换浏览器或清理存储可能丢失；真实支付尚未开放。</div>',
      '<p class="commerce-feedback' + (message ? success ? ' success' : ' error' : '') + '" id="commerceFeedback" role="status" aria-live="polite" aria-atomic="true">' + escapeHTML(message || (storeTab === 'shop' ? '选择商品购买，购买后保留当前位置。' : '充值后留在本页，可连续充值；点「商城商品」去购物。')) + '</p><button type="button" class="secondary" id="closeItemStore">返回' + (['playing', 'paused'].includes(storeReturnState) ? '战斗' : '游戏') + '</button>', 'Esc 返回 · 查看、充值与购买期间战斗暂停');
    overlay.classList.add('store-overlay'); overlay.setAttribute?.('role', 'dialog'); overlay.setAttribute?.('aria-modal', 'true'); overlay.setAttribute?.('aria-label', '钻石商城与免费测试充值');
    el('commerceShopTab').onclick = () => { storeTab = 'shop'; renderItemStore(); };
    el('commerceRechargeTab').onclick = el('commerceWalletPlus').onclick = () => { storeTab = 'recharge'; renderItemStore(); };
    bindCommerceControls();
    el('closeItemStore').onclick = closeItemStore; updateHUD(); el('closeItemStore').focus?.({ preventScroll: true }); return true;
  }
  function bindCommerceControls() {
    const revision = storeRevision;
    overlay.querySelectorAll('[data-commerce-topup]').forEach(button => { button.onclick = () => topUpDiamonds(button.dataset.commerceTopup, revision); });
    overlay.querySelectorAll('[data-commerce-product]').forEach(button => {
      const id = button.dataset.commerceProduct, product = store.get(id), owned = store.owns(profile, id);
      if (!product) return;
      const equipped = profile.commerce.equippedAura === id || profile.commerce.equippedFrame === id;
      delete button.dataset.commerceBuy; delete button.dataset.commerceEquip;
      button.dataset[owned ? 'commerceEquip' : 'commerceBuy'] = id;
      button.classList?.toggle('primary', !owned); button.classList?.toggle('secondary', owned);
      button.textContent = owned ? equipped ? '已装备 · 取消' : '装备外观' : '钻石购买';
      button.onclick = () => performCommerce(owned ? 'equip' : 'diamond-purchase', id, revision);
    });
  }
  function refreshCommerceUI(message, success = false) {
    if (state !== 'itemStore' || !currentAccount) return false;
    const body = overlay.querySelector?.('.menu-body'), scrollTop = body?.scrollTop;
    // Do not replace the dialog/cards or move focus: repeat purchases stay at
    // the same screen location. Rotate callbacks to keep stale clicks harmless.
    storeRevision++; const c = profile.commerce;
    el('commerceDiamondBalance').textContent = c.diamonds.toLocaleString('en-US');
    const wallet = overlay.querySelector?.('.menu-top .wallet');
    if (wallet) wallet.textContent = '☀ 阳光籽 ' + profile.seeds + '　◆ 果核 ' + profile.cores;
    overlay.querySelectorAll('[data-commerce-owned]').forEach(badge => { badge.classList.toggle('hidden', !store.owns(profile, badge.dataset.commerceOwned)); });
    el('commerceRecords').classList.toggle('hidden', !c.receipts.length);
    el('commerceRecordsList').innerHTML = c.receipts.slice(-5).reverse().map(record => {
      const label = record.kind === 'preview-topup' ? store.getPack(record.sku)?.name + '测试充值' : store.get(record.sku)?.name;
      return '<li><span>' + escapeHTML(label || record.sku) + '</span><strong class="' + (record.delta > 0 ? 'credit' : 'debit') + '">' + (record.delta > 0 ? '+' : '') + record.delta + ' ◆</strong></li>';
    }).join('');
    el('commerceFeedback').textContent = message + (success ? ' 余额：' + c.diamonds.toLocaleString('en-US') + '钻石。' : '');
    el('commerceFeedback').classList.toggle('success', success); el('commerceFeedback').classList.toggle('error', !success);
    bindCommerceControls(); updateHUD();
    if (body && Number.isFinite(scrollTop)) body.scrollTop = scrollTop;
    return true;
  }
  function performCommerce(kind, id, revision = storeRevision) {
    if (state !== 'itemStore' || !currentAccount || training || revision !== storeRevision) return false;
    const result = store.transaction(profile, kind, id);
    if (!result.ok) { refreshCommerceUI(result.message); return false; }
    const previous = { commerce: profile.commerce, seeds: profile.seeds, cores: profile.cores };
    Object.assign(profile, { commerce: result.commerce, seeds: result.seeds, cores: result.cores });
    if (!saveProfile()) {
      Object.assign(profile, previous);
      refreshCommerceUI('存档写入失败：本次钻石、商品与材料变动已撤销，请允许浏览器存储后重试。'); return false;
    }
    // Profile-only transaction: current HP, XP, skills, bosses and waves never reset.
    refreshCommerceUI(result.message, true); return true;
  }
  function topUpDiamonds(pack, revision = storeRevision) { return performCommerce('preview-topup', pack, revision); }
  function buyDiamondProduct(product, revision = storeRevision) { return performCommerce('diamond-purchase', product, revision); }
  function closeItemStore() {
    if (state !== 'itemStore') return false;
    const focus = storeFocusReturn; storeFocusReturn = null; keys.clear(); pointer = null; overlay.classList.remove('store-overlay');
    if (storeReturnState === 'lobby') { state = 'lobby'; renderLobby(previewStage); }
    else if (storeReturnState === 'heroes') showHeroes();
    else if (storeReturnState === 'armory') showArmory();
    else if (storeReturnState === 'orchard') showOrchard();
    else if (storeReturnState === 'paused') { state = 'playing'; pause(); }
    else { state = 'playing'; overlay.classList.add('hidden'); }
    updateHUD(); focus?.focus?.(); return true;
  }
  el('openStoreLobby').onclick = () => openItemStore(el('openStoreLobby'), 'recharge');
  el('openStoreShop').onclick = () => openItemStore(el('openStoreShop'), 'shop');
  el('openStoreRun').onclick = () => openItemStore(el('openStoreRun'));
  function sound(freq, length = .05, volume = .015) {
    if (!audioCtx || audioCtx.state !== 'running') return;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(freq, audioCtx.currentTime); o.frequency.exponentialRampToValueAtTime(freq * .5, audioCtx.currentTime + length);
    g.gain.setValueAtTime(volume, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + length);
    o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + length);
  }
  function pauseStatsHTML() {
    const stats = [['单籽伤害', statText(seedDamage())], ['射击频率', statText(player.rate) + ' / 秒'],
      ['移动速度', statText(player.speed)], ['种子数量', player.shots], ['拾取范围', statText(player.pickup)], ['已驱赶', kills]];
    return '<section class="pause-stats" aria-label="本局详细属性">' +
      stats.map(([name, value]) => '<div><span>' + name + '</span><strong>' + value + '</strong></div>').join('') +
      '<p>' + escapeHTML(el('loadout').textContent) + '</p></section>' +
      (!training ? '<button class="secondary pause-store" id="pauseStore">钻石商城</button>' : '');
  }
  function pause() {
    if (state === 'playing') {
      state = 'paused'; keys.clear(); pointer = null;
      showPanel('喘口气，再出发。', '果园小憩 / 第 ' + activeStage.id + ' 关', '<p>战斗与虫群苏醒已暂停。</p>' + pauseStatsHTML(), '<button class="primary" id="resume">继续清剿</button><button class="secondary" id="leave">放弃本次挑战</button>', '放弃本次挑战不会获得通关奖励');
      if (runMode === 'endless') showPanel('喘口气，再出发。', '无尽虫潮 / 第 ' + endlessWave + ' 波', '<p>无尽波次与战斗已暂停，已获得的材料已经保存。</p>' + pauseStatsHTML(), '<button class="primary" id="resume">继续无尽</button><button class="secondary" id="leave">结束无尽并结算</button>');
      el('resume').onclick = resume; el('leave').onclick = runMode === 'endless' ? () => finishEndless(true) : startScreen;
      if (training) {
        showPanel('练习随时可以继续。', '晨芽练习场 / 暂停', '<p>当前任务进度和练习战斗已暂停。</p>' + pauseStatsHTML(), '<button class="primary" id="resume">继续练习</button><button class="secondary" id="leave">' + (training.firstEntry ? '跳过引导' : '退出练习') + '</button>', '退出后可从首页重新开始');
        el('resume').onclick = resume; el('leave').onclick = skipTraining;
      }
      overlay.classList.add('pause-overlay');
      if (!training) el('pauseStore').onclick = () => openItemStore(el('pauseStore'));
      overlay.setAttribute?.('role', 'dialog'); overlay.setAttribute?.('aria-modal', 'true'); overlay.setAttribute?.('aria-label', '游戏暂停');
      el('resume').focus?.();
      updateHUD();
    } else if (state === 'paused') resume();
  }
  function resume() { state = 'playing'; overlay.classList.add('hidden');  updateHUD(); }
  function grantVictoryRewards() {
    if (runMode === 'training') return;
    if (!runRewarded) {
      frontierRewards?.victory();
      runRewarded = true;
      stageVictoryReady = true;
      const firstClear = !profile.clearedStages.includes(activeStage.id);
      if (firstClear && profile.clearedStages.length === 0) { profile.featureGuideRound = 1; profile.featureGuideStep = 0; }
      if (firstClear && activeStage.id >= 2) profile.featureGuideStep = featureGuideSteps().length;
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
      const resident = rescueDefs[activeStage.id - 1], newResident = !profile.rescuedSprites.includes(resident.id);
      if (newResident) {
        profile.rescuedSprites.push(resident.id); profile.spriteLevels[resident.id] = 0;
        selectedSprite = resident.id; selectedGarden = resident.gardenId;
      }
      saveProfile();
      victoryRewardHTML = '<div class="reward-box">' + (firstClear ? '首通奖励' : '重复通关奖励（首通的 25%，至少 1）') + '<strong>☀ 阳光籽 +' + seeds + '　◆ 果核 +' + cores + '</strong>' + gear +
        '<div class="reward-resident">' + spritePortrait(resident, 'sprite-reward-portrait') + '<span>' + resident.name + (newResident ? '已安置到果园' : '的家园再次得到守护') + '</span></div><small>' + (storageAvailable ? '奖励、精灵和关卡进度已保存' : '存储不可用，请保持本页面打开') + '</small></div>';
    }
  }
  function worldRewardHTML() {
    const info = frontierRewards?.status() || { text: '游戏账号会自动连接世界，通关后领取世界专属物资。', canRetry: false };
    return '<div class="world-reward-box"><strong>⚑ 世界专属物资</strong><p id="worldRewardStatus">' + escapeHTML(info.text) + '</p><button class="secondary" id="retryWorldReward" ' + (!info.canRetry ? 'hidden' : '') + '>重试入库</button></div>';
  }
  function updateWorldRewardMessage(info) {
    if (state !== 'ended' || runMode !== 'stage') return;
    const message = el('worldRewardStatus'), retry = el('retryWorldReward');
    if (message) message.textContent = info.text;
    if (retry) retry.hidden = !info.canRetry;
  }
  function finish(win) {
    if (!currentAccount) return false;
    if (runMode === 'training') { exitTraining(); return false; }
    if (runMode === 'endless') { finishEndless(win); return; }
    if (state === 'ended') return;
    state = 'ended'; keys.clear(); pointer = null;
    if (win) { grantVictoryRewards(); selectedStage = Math.min(stages.length, activeStage.id + 1); }
    const growthStep = win && firstGrowthStep();
    const otherActions = '<details class="result-options"><summary>更多玩法与养成</summary>' + (win ? '<div class="endless-offer"><strong>∞ 无尽虫潮</strong><span>保留本关构筑，补满生命；剩余成长和最后轮盘进入无尽后领取。每 8 秒一波，可随时结算。</span></div><button class="secondary" id="startEndless">进入无尽模式 ∞</button>' : '') + '<div class="result-other-actions"><button class="secondary" id="resultWorld" ' + (!featuresUnlocked() ? 'disabled' : '') + '>进入共享世界</button><button class="secondary" id="resultOrchard" ' + (!featuresUnlocked() ? 'disabled' : '') + '>我的果园</button><button class="secondary" id="resultArmory" ' + (!featuresUnlocked() ? 'disabled' : '') + '>装备工坊</button></div></details>';
    showPanel(win ? '青叶果园，平安无恙。' : '小果子，歇一歇。', '第 ' + activeStage.id + ' 关 / ' + activeStage.name, '<div class="result-layout"><div class="result-summary"><p>' +
      (win ? '本关 ' + activeStage.bossCount + ' 位虫王已全部击败，精灵已经回家。' : '虫群暂时占了上风。培养精灵、强化装备后，再试一次。') + '</p>' + (win ? victoryRewardHTML + worldRewardHTML() : '') +
      '<div class="result-stats"><div><b>' + kills + ' / ' + activeStage.enemyCount + '</b><span>驱赶害虫</span></div><div><b>' + player.level + '</b><span>本关成长等级</span></div></div>' +
      '</div><div class="result-next">' + (growthStep ? growthRouteHTML('result', false) : '<div class="endless-offer"><strong>' + (win ? '🌱 带着成长，继续远征。' : '🌱 再准备一下，重新出发。') + '</strong><span>' + (win ? '新伙伴的祝福已生效。下一关还会带来新的精灵和装备。' : '到果园培养伙伴，或在装备工坊强化装备，提升下一次挑战的实力。') + '</span></div>') + otherActions + '</div></div>',
      (growthStep ? '<button class="primary" id="resultGrowth">' + growthStep.name + '</button>' : '') + (win && activeStage.id < stages.length ? '<button class="' + (growthStep ? 'secondary' : 'primary') + '" id="nextStage">挑战下一关</button>' : '<button class="primary" id="restart">再挑战一次</button>') + '<button class="secondary" id="backLobby">选择关卡</button>', '奖励与关卡进度自动保存');
    overlay.classList.add('result-overlay');
    if (growthStep) el('resultGrowth').onclick = () => followGrowthRoute('result');
    bindSpritePortraits();
    if (win && activeStage.id < stages.length) el('nextStage').onclick = () => { selectStage(activeStage.id + 1); start(); };
    else el('restart').onclick = start;
    el('resultArmory').onclick = showArmory; el('backLobby').onclick = startScreen;
    el('resultOrchard').onclick = showOrchard; el('resultWorld').onclick = showWorld; updateHUD();
    if (win) el('retryWorldReward').onclick = () => frontierRewards?.retry();
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
    keys.clear(); pointer = null; overlay.classList.add('hidden');
    spawnEndlessWave(); player.xp += pendingEndlessXP; pendingEndlessXP = 0; updateHUD();
    if (rouletteQueue.length) openRoulette(); else if (player.xp >= player.need) offerUpgrade();
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
    if (runMode !== 'stage') return null;
    // Absolute battle-time deadline only. Alive bosses, kills and cleared bugs
    // never postpone or accelerate another boss's arrival.
    return enemies.find(e => e.boss && !e.introduced && e.hp > 0 && elapsed >= e.bossArrivalAt) || null;
  }
  function beginnerBossHealth() {
    // Measure the actual chosen attacks on an isolated dummy; no live cooldown,
    // zone, relic, XP or save state is changed by this once-per-arrival estimate.
    const sample = { ...player, x: 0, y: 0, hp: player.maxHp, shield: 1, skillTimers: {}, relicDots: [],
      build: { ...player.build, timers: {}, zones: [] } };
    const target = { x: 1, y: 0, hp: 1e12, maxHp: 1e12, r: 40, boss: true };
    let automaticDamage = 0;
    const context = { active: true, standing: true, targets: () => [target], hit: (_enemy, damage) => { automaticDamage += damage; } };
    const owned = runRelicDefs.filter(def => player.skills[def.key]);
    for (let step = 0; step < 120; step++) {
      context.elapsed = step * .1;
      builds.tick(sample, .1, context);
      relicEffects.tick(sample, owned, .1, { ...context, includeLegacy: true,
        hit: (_enemy, damage) => { automaticDamage += damage * player.skillPower; },
        projectile: spec => { automaticDamage += spec.damage * player.skillPower; } });
    }
    const crit = 1 + player.critChance * (player.critMultiplier - 1);
    const weaponDps = seedDamage() * player.shots * player.rate * (combat.standDamage + player.standPower) * combat.standRate * crit;
    const hero = growth.active(player.heroId, player);
    const heroDps = (hero?.damage || 0) * player.skillPower * (hero?.kind === 'volley' ? hero.count : 1) / Math.max(1, hero?.cooldown || 1);
    return Math.max(activeStage.beginner.bossHp, Math.ceil((weaponDps + automaticDamage / 12 + heroDps) * activeStage.beginner.bossTargetSeconds));
  }
  function announceBossArrival() {
    if (state !== 'playing' || runMode !== 'stage') return false;
    const boss = readyBoss(); if (!boss) return false;
    boss.introduced = true; bossIndex++;
    if (activeStage.beginner) {
      boss.hp = boss.maxHp = beginnerBossHealth();
      boss.baseCombat.hp = boss.hp;
      boss.arrivalGuardUntil = elapsed + activeStage.beginner.arrivalGuard;
    }
    applyTimeGrowth(boss);
    const angle = Math.random() * Math.PI * 2 + boss.bossOrder * 2.399963;
    // Bounded spread avoids spawning a new boss directly inside a living one.
    for (let attempt = 0; attempt < 12; attempt++) {
      const direction = angle + attempt * 2.399963, radius = 260 + attempt * 12;
      const x = Math.max(boss.r + 25, Math.min(WORLD_W - boss.r - 25, player.x + Math.cos(direction) * radius));
      const y = Math.max(boss.r + 25, Math.min(WORLD_H - boss.r - 25, player.y + Math.sin(direction) * radius));
      const point = world.safePoint(x, y, boss.r + 22, obstacles, WORLD_W, WORLD_H);
      boss.x = point.x; boss.y = point.y;
      if (!enemies.some(e => e !== boss && e.boss && e.introduced && e.hp > 0 && Math.hypot(e.x - boss.x, e.y - boss.y) < e.r + boss.r + 20)) break;
    }
    boss.pursuitAt = elapsed; boss.aggro = true; boss.chargeClock = Math.min(3, boss.chargeInterval);
    bossArrivalUntil = elapsed + 4;
    burst(boss.x, boss.y, boss.color, 14); sound(110, .4, .04); updateHUD(); return true;
  }
  function beginRescue() {
    if (state === 'rescue' || state === 'ended') return false;
    const sprite = rescueDefs[activeStage.id - 1];
    state = 'rescue'; cinematicTime = 0; keys.clear(); pointer = null; bullets = []; still = 0;
    // Save the actual win immediately; closing during the rescue movie does not lose rewards.
    grantVictoryRewards(); updateHUD();
    showPanel(sprite.name + '，自由啦！', '救援成功 / 精灵回家', '<div class="cinematic rescue-cinematic" style="--accent:' + sprite.color + '"><div class="rescue-stage"><div class="rescue-glow"></div><div class="rescue-cage"><i></i><i></i><i></i><i></i></div>' + spritePortrait(sprite, 'rescued-hero') + '<span class="rescue-spark spark-one">✦</span><span class="rescue-spark spark-two">✦</span><span class="rescue-spark spark-three">✦</span><div class="rescue-ground">🌿　🌸　🌿</div></div><p>“' + sprite.personality + '”<br>当前祝福：' + bonusText(sprite.bonusType, sprite.bonusPerLevel * (1 + profile.spriteLevels[sprite.id])) + '。</p></div>', '<button class="primary" id="settleSprite">完成救援 · 跳过动画</button>', '精灵已安置，进度已经保存 · Enter 可跳过');
    bindSpritePortraits();
    el('settleSprite').onclick = completeRescue; sound(720, .4, .03); return true;
  }
  function completeRescue() { if (state !== 'rescue') return false; finish(true); return true; }
  function checkStageCompletion() {
    const cleared = runMode === 'stage' && !enemies.length && bossKills >= activeStage.bossCount && nonBossKills >= activeStage.normalCount + activeStage.eliteCount;
    if (!cleared) {
      if (rouletteQueue.length) { openRoulette(); return true; }
      return false;
    }
    if (!stageXP.settled) {
      stageXP.finish(); pendingEndlessXP += stageXP.collect(stageXP.issued - stageXP.collected); gems = [];
      grantVictoryRewards();
    }
    beginRescue(); return true;
  }
  function wheelEntries() {
    const pool = [...builds.pool(player)];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return Array.from({ length: 6 }, (_, i) => ({ def: pool.length ? pool[i % pool.length] : null,
      rarity: pool.length ? rarities[i % rarities.length] : rarities[0] }));
  }
  function wheelSVG(entries) {
    const radius = 147, center = 160, step = 360 / entries.length;
    const point = degrees => { const radians = (degrees - 90) * Math.PI / 180; return [center + radius * Math.cos(radians), center + radius * Math.sin(radians)]; };
    return entries.map((entry, i) => {
      const angle = i * step, [x1, y1] = point(angle - step / 2), [x2, y2] = point(angle + step / 2);
      const color = entry.rarity.mult === 2 ? '#604573' : entry.rarity.mult === 1.5 ? '#255864' : '#36543b';
      const name = entry.def?.name || '生命补给', icon = entry.def?.icon || '♥';
      return '<g class="wheel-sector" data-reward-id="' + (entry.def?.id || 'healing') + '"><title>' + escapeHTML(name + ' · ' + (entry.def ? entry.rarity.name : '恢复25%生命')) + '</title>' +
        '<path d="M160 160 L' + x1 + ' ' + y1 + ' A147 147 0 0 1 ' + x2 + ' ' + y2 + ' Z" fill="' + color + '" stroke="#e8cc8c" stroke-width="1.3"/>' +
        '<g transform="rotate(' + angle + ' 160 160)"><text x="160" y="46" class="wheel-icon">' + escapeHTML(icon) + '</text>' +
        '<text x="160" y="68" class="wheel-name">' + escapeHTML(name) + '</text><text x="160" y="85" class="wheel-rarity" fill="' + entry.rarity.color + '">' + escapeHTML(entry.def ? entry.rarity.name : '生命 +25%') + '</text></g></g>';
    }).join('');
  }
  function rouletteTick(dt) {
    if (!rouletteAnimation || state !== 'roulette') return;
    rouletteAnimation.remaining -= Math.max(0, dt);
    if (rouletteAnimation.remaining > 0) return;
    el('wheelResults').classList.add('is-revealed'); el('wheelResults').setAttribute?.('aria-busy', 'false');
    el('wheelStatus').textContent = '好运已入袋 · 奖励已加入本局构筑';
    el('spinReward').disabled = false; el('spinReward').textContent = '收下好运 · 继续守护';
    rouletteAnimation = null; el('spinReward').focus?.(); sound(760, .16);
  }
  function openRoulette() {
    if (!rouletteQueue.length || state === 'roulette') return;
    const reward = rouletteQueue.shift();
    rouletteAnimation = null; state = 'roulette'; keys.clear(); pointer = null;
    let entries = wheelEntries();
    showPanel(reward.boss ? '虫王的丰收礼' : '精英的幸运礼', '幸运轮盘 / ' + (reward.boss ? 'Boss 三连抽' : '精英单抽') + ' / ' + reward.count + ' 个词条',
      '<div class="roulette-layout"><section class="roulette-stage" aria-label="幸运奖励轮盘"><div class="roulette-eyebrow">ORCHARD LUCKY DRAW</div>' +
      '<div class="wheel-cabinet"><div class="wheel-pointer" aria-hidden="true"></div><svg id="rewardWheel" class="reward-wheel" viewBox="0 0 320 320" role="img" aria-label="六个扇区显示可抽中的词条与品质">' + wheelSVG(entries) + '</svg>' +
      '<div class="wheel-hub" aria-hidden="true"><span>✦</span><strong>果园好运</strong><small>LUCKY</small></div></div>' +
      '<div class="wheel-legend"><span class="common">● 普通</span><span class="rare">● 稀有</span><span class="epic">● 史诗</span></div><p class="wheel-status" id="wheelStatus">' + (reward.boss ? '击败虫王，赢取 3 份构筑奖励' : '击败精英，赢取 1 份构筑奖励') + '</p></section>' +
      '<section class="roulette-receipt"><div class="receipt-heading"><span>本次收获</span><b>' + (reward.boss ? 'THREE REWARDS' : 'ONE REWARD') + '</b></div><div id="wheelResults" class="wheel-results" aria-live="polite">' +
      '<div class="receipt-empty"><span>✧</span><strong>好运，等你转动</strong><p>转盘上的词条均可抽中<br>奖励自动加入当前构筑</p></div></div><p class="receipt-note">不消耗经验 · 不占用升级次数<br>构筑已满时，自动转为生命补给</p></section></div>',
      '<button class="primary roulette-spin" id="spinReward">✦ ' + (reward.boss ? '开启丰收三连抽' : '转动幸运轮盘') + '</button>', '战斗已暂停 · 指针落点对应实际抽中奖励');
    overlay.classList.add('roulette-overlay'); overlay.setAttribute?.('role', 'dialog'); overlay.setAttribute?.('aria-modal', 'true');
    overlay.setAttribute?.('aria-label', reward.boss ? '虫王三连抽轮盘' : '精英幸运轮盘');
    el('spinReward').onclick = () => {
      if (state !== 'roulette' || el('spinReward').disabled) return;
      el('spinReward').disabled = true; el('spinReward').textContent = '好运转动中…';
      const results = []; let selected = 0;
      for (let index = 0; index < reward.count; index++) {
        // Refresh after each pick: a full skill or newly unlocked super changes the next pool.
        if (index) entries = wheelEntries();
        selected = Math.floor(Math.random() * entries.length);
        const { def, rarity } = entries[selected];
        if (!def) { healPlayer(player.maxHp * .25); results.push({ name: '生命补给', icon: '♥', rarity: rarities[0], description: '构筑已满 · 恢复最大生命的25%' }); continue; }
        const description = def.describe?.(rarity.mult, player) || def.description || '强化当前构筑';
        const result = builds.choose(player, def.id, rarity.mult);
        if (result.applied) results.push({ name: def.name, icon: def.icon, rarity, level: player.build.levels[def.id], description });
        for (const recipe of result.newSuper) queueNotice(recipe.name, recipe.description, recipe.icon, recipe.color, 'super');
      }
      const wheel = el('rewardWheel'); wheel.innerHTML = wheelSVG(entries);
      wheel.style.transition = 'none'; wheel.style.transform = 'rotate(0deg)';
      wheel.getBoundingClientRect(); // Commit the starting layout before CSS interpolation.
      wheel.style.transition = 'transform 1.75s cubic-bezier(.12,.7,.12,1)';
      // Sector centers start at twelve o'clock. Pointer and real reward always agree.
      wheel.style.transform = 'rotate(' + (1440 + (360 - selected * 60) % 360) + 'deg)';
      el('wheelResults').innerHTML = results.map((item, i) => '<article class="wheel-reward" style="--reward-color:' + item.rarity.color + '"><span class="reward-number">0' + (i + 1) + '</span>' +
        '<span class="reward-icon" aria-hidden="true">' + escapeHTML(item.icon || '✦') + '</span><div><small>' + escapeHTML(item.rarity.name) + (item.level ? ' · Lv.' + item.level : '') + '</small><strong>' + escapeHTML(item.name) + '</strong><p>' + escapeHTML(item.description) + '</p></div></article>').join('');
      el('wheelResults').setAttribute?.('aria-busy', 'true'); el('wheelResults').classList.remove('is-revealed'); el('wheelResults').classList.add('has-rewards');
      el('wheelStatus').textContent = reward.boss ? '三份好运正在揭晓…' : '指针即将揭晓你的好运…';
      rouletteAnimation = { remaining: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 1.85 };
      el('spinReward').onclick = () => {
        if (state !== 'roulette' || el('spinReward').disabled) return;
        rouletteAnimation = null; state = 'playing'; overlay.classList.add('hidden'); updateHUD();
        if (rouletteQueue.length) openRoulette();
        else if (player.xp >= player.need) offerUpgrade(); else checkStageCompletion();
      };
      rouletteTick(0); updateHUD();
    };
    el('spinReward').focus?.(); updateHUD();
  }
  function offerUpgrade() {
    if (player.xp < player.need) return false;
    if (runMode === 'stage' && elapsed < nextStageUpgradeAt) return false;
    upgrade(); return true;
  }
  function upgrade() {
    choices = randomChoices();
    if (!choices.length) {
      let levels = 0;
      while (player.xp >= player.need) { player.xp -= player.need; player.level++; player.need = experienceNeed(player.level); healPlayer(player.maxHp * .25); levels++; }
      if (levels) queueNotice('构筑已完成', '升级 ' + levels + ' 次，每次恢复最大生命的 25%；词条槽位和等级保持上限。', '♥', '#bce4a0', 'supply');
      state = 'playing'; overlay.classList.add('hidden'); updateHUD(); checkStageCompletion(); return;
    }
    state = 'upgrade'; keys.clear(); pointer = null;
    renderUpgrade(); sound(620, .14);
  }
  function recipeGuideHTML() {
    const target = builds.goal(player), recommendation = builds.recommended(player);
    const picture = (id, name) => '<img src="assets/skills/' + id + '.svg" alt="' + name + '技能图示" width="48" height="48">';
    const progress = r => builds.get(r.attack).name + ' ' + Math.min(5, r.attackLevel) + '/5 ＋ ' + builds.get(r.attribute).name + ' ' + Math.min(5, r.attributeLevel) + '/5';
    const banner = target ? '<div class="recipe-goal ' + (target.crafted ? 'complete' : '') + '">' + picture(target.id, target.name) + '<div><strong>' + (target.crafted ? '✓ 已合成 · ' : '目标 · ') + target.name + '</strong><span>' + progress(target) + '</span><small>' + (target.crafted ? builds.briefRecipe(target.id) : target.reason || (recommendation ? '推荐下一步：' + builds.get(recommendation.id).name : '配方材料均已齐备')) + '</small></div></div>' : '<p class="recipe-intro">选一条合成路线，逐步练成超级技能。</p>';
    return '<div class="recipe-guide">' + banner + '<details class="recipe-picker"><summary>选择超级技能' + (target ? ' · 更换目标' : ' · 8种路线') + '</summary><div class="recipe-options">' + builds.recipes.map(recipe => {
      const r = builds.recipeState(player, recipe), selected = target?.id === r.id;
      return '<button type="button" class="recipe-option' + (selected ? ' selected' : '') + '" data-recipe-goal="' + r.id + '" aria-pressed="' + selected + '" ' + (!r.possible ? 'disabled' : '') + '>' + picture(r.id, r.name) + '<div><strong>' + r.name + '</strong><span>' + builds.briefRecipe(r.id) + '</span><small>' + progress(r) + '</small><b>' + (r.reason || (selected ? '当前目标' : r.started ? '已有材料 · 选择此路线' : '选择此路线')) + '</b></div></button>';
    }).join('') + '</div>' + (target ? '<button type="button" class="recipe-clear" id="clearRecipeGoal">取消目标，自由搭配</button>' : '') + '</details></div>';
  }
  function renderUpgrade() {
    if (state !== 'upgrade') return false;
    const b = player.build, endless = runMode === 'endless';
    const rule = endless ? '无尽突破：攻击 ' + b.attackSlots.length + ' 种 · 属性 ' + b.attributeSlots.length + ' 种 · 词条等级持续成长' : '攻击 ' + b.attackSlots.length + ' / 4 种 · 属性 ' + b.attributeSlots.length + ' / 4 种 · 每种最高 5 级';
    const target = builds.goal(player), recommendation = builds.recommended(player);
    showPanel(training ? '选出你的第一枚词条' : endless ? '继续突破成长' : '选择你的成长', 'LEVEL UP / LV. ' + (player.level + 1), '<div class="build-limit">' + rule + ' · 配方两项均5级自动合成</div>' + recipeGuideHTML() + '<div class="cards" style="--choices:' + choices.length + '">' + choices.map((u, i) => {
      const level = b.levels[u.id] || 0, recipe = builds.recipes.find(r => r.id === u.recipe);
      const recommended = target?.possible && [target.attack, target.attribute].includes(u.id);
      return '<button class="card' + (recommended ? ' recommended' : '') + '" data-choice="' + i + '" style="border-color:' + u.rarity.color + '" title="' + escapeHTML(u.desc) + '"><div class="build-category">' + (recommended ? '✦ 推荐 · ' + target.name : u.category === 'attack' ? '攻击' : '属性') + '</div><div class="card-icon"><img src="' + u.image + '" alt="' + u.name + '技能图示" width="72" height="72"></div><strong>' + u.name + '</strong><span>' + escapeHTML(builds.brief(u, u.rarity.mult, player)) + '</span><small style="color:' + u.rarity.color + '">' + u.rarity.name + ' · Lv.' + level + ' → ' + (level + 1) + '<br>按 ' + (i + 1) + ' 选择</small>' + (recipe ? '<div class="recipe-progress">' + (b.superSkills.includes(recipe.id) ? '✓ ' : '合成 → ') + recipe.name + '</div>' : '') + '</button>';
    }).join('') + '</div>', '', (training ? '180 经验完成第一次成长 · 本次词条仅在练习中生效' : endless ? '无尽随机成长 · 等级持续提升' : '本关总经验 ' + stageXP.budget.toLocaleString('en-US') + ' · ' + activeStage.experience.choices + ' 次经验升级 · 成长间隔随等级增加 · 精英抽1个 / Boss抽3个' + (stageXP.settled ? ' · 完成成长后救援' : '')) + ' · 战斗已暂停 · 按 1 / 2 / 3 选择');
    overlay.classList.add('upgrade-overlay');
    overlay.querySelectorAll('[data-choice]').forEach(b => b.onclick = () => choose(Number(b.dataset.choice)));
    overlay.querySelectorAll('[data-recipe-goal]').forEach(button => button.onclick = () => {
      if (state !== 'upgrade' || !builds.setGoal(player, button.dataset.recipeGoal)) return;
      renderUpgrade();
    });
    if (el('clearRecipeGoal')) el('clearRecipeGoal').onclick = () => { if (state !== 'upgrade') return; builds.setGoal(player, ''); renderUpgrade(); };
    updateHUD(); return true;
  }
  function choose(i) {
    if (state !== 'upgrade' || !choices[i]) return;
    const u = choices[i], result = builds.choose(player, u.id, u.rarity.mult); if (!result.applied) return;
    for (const recipe of result.newSuper) queueNotice(recipe.name, recipe.description, recipe.icon, recipe.color, 'super');
    player.xp -= player.need; player.level++; player.need = experienceNeed(player.level);
    if (runMode === 'stage') nextStageUpgradeAt = elapsed + experience.interval(player.level);
    state = 'playing'; still = 0; overlay.classList.add('hidden'); updateHUD();
    if (training) { trainingTick(); updateHUD(); return; }
    if (player.xp >= player.need) offerUpgrade(); else checkStageCompletion();
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
  el('combatGuide').onclick = () => openTutorial(false);
  el('trainingExit').onclick = skipTraining;
  addEventListener('keydown', e => {
    if (state === 'cover') return;
    if (state === 'world' || state === 'leaderboard') {
      if (e.target?.closest?.('input, select, textarea')) return;
      if (e.key.toLowerCase() === 'h') openGameHelp();
      else if (e.key === 'Escape') startScreen();
      return;
    }
    if (state !== 'help' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (state === 'itemStore') {
      if (['escape', 'p'].includes(k)) { e.preventDefault(); closeItemStore(); }
      else if (k === 'tab') {
        const buttons = [...overlay.querySelectorAll('button, [tabindex="0"]')].filter(button => !button.disabled);
        const first = buttons[0], last = buttons.at(-1), active = document.activeElement;
        if (first && (e.shiftKey && active === first || !e.shiftKey && active === last || !buttons.includes(active))) {
          e.preventDefault(); (e.shiftKey ? last : first).focus?.();
        }
      }
      return;
    }
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
  function experiencePickupRange() {
    // Introduce the first choice using earned drops, without granting extra XP.
    // Later choices still reward moving towards the visible blue experience.
    if (runMode === 'stage' && activeStage.id <= 2) return Math.max(player.pickup, player.level === 1 ? 620 : 140);
    return player.pickup;
  }
  function applyTimeGrowth(enemy) {
    if (runMode !== 'stage' || enemy.timeScaleApplied || !enemy.baseCombat || enemy.hp <= 0) return;
    enemy.timeScaleApplied = true;
    // Never grant a wounded monster extra HP. This also makes repeated updates idempotent.
    if (enemy.hp < (enemy.maxHp ?? enemy.baseCombat.hp)) return;
    const factor = pressure.multipliers(activeStage, elapsed, enemy.boss ? 'boss' : enemy.elite ? 'elite' : 'normal');
    enemy.maxHp = enemy.hp = Math.ceil(enemy.baseCombat.hp * factor.hp);
    enemy.damage = Math.round(enemy.baseCombat.damage * factor.damage * 10) / 10;
    enemy.strengthAt = elapsed;
  }
  function spawn() {
    const index = enemies.length, s = activeStage; let x, y;
    if (index >= s.normalCount + s.eliteCount) {
      const bossOrder = index - s.normalCount - s.eliteCount, baseBoss = bossDefs[s.bossIds[bossOrder] - 1];
      const boss = baseBoss && s.beginner ? { ...baseBoss, hp: s.beginner.bossHp, damage: s.beginner.bossDamage, speed: s.beginner.bossSpeed, chargeSpeed: s.beginner.chargeSpeed, chargeInterval: s.beginner.chargeInterval } : baseBoss;
      if (!boss) return;
      enemies.push({ x: player.x, y: player.y, type: 2, boss: true, r: boss.radius, ...boss, maxHp: boss.hp, baseCombat: { hp: boss.hp, damage: boss.damage }, xp: s.fast.xp * 8,
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
      enemies.push({ x, y, type: 0, elite: true, r: 25, ...s.elite, maxHp: s.elite.hp, baseCombat: { hp: s.elite.hp, damage: s.elite.damage },
        pursuitAt, aggro: false, phase: Math.random() * 6, flash: 0 });
      return;
    }
    // Evenly distribute the exact configured flying-insect count through normal batches.
    const type = Math.floor((index + 1) * s.fastCount / s.normalCount) > Math.floor(index * s.fastCount / s.normalCount) ? 1 : 0;
    const stats = type ? s.fast : s.slow;
    const pursuitAt = index < s.initialPursuers ? 0 : (1 + Math.floor((index - s.initialPursuers) / s.batchSize)) * s.pursuitInterval;
    enemies.push({ x, y, type, elite: false, r: type ? 15 : 19, ...stats, maxHp: stats.hp, baseCombat: { hp: stats.hp, damage: stats.damage }, timeScaleApplied: pursuitAt === 0, pursuitAt, aggro: pursuitAt === 0, phase: Math.random() * 6, flash: 0 });
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
    const trainingOrigin = training ? { x: player.x, y: player.y } : null;
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
    if (runMode === 'stage' && activeStage.beginner && player.sinceHit > activeStage.beginner.regenerationDelay) player.hp = Math.min(player.maxHp, player.hp + activeStage.beginner.regeneration * Math.min(dt, player.sinceHit - activeStage.beginner.regenerationDelay));
    // Scheduled activation happens before targeting or collisions. Dormant enemies never interact.
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      const awake = elapsed >= e.pursuitAt;
      if (awake && !e.aggro) { applyTimeGrowth(e); placeAwakeningEnemy(e); }
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
        if (training && e.trainingCharge) {
          const attempt = e.trainingCharge;
          attempt.moved ||= Math.hypot(player.x - attempt.x, player.y - attempt.y) >= 40;
          if (d < e.r + player.r) attempt.hit = true;
        }
        if (e.windup > 0) {
          e.windup = Math.max(0, e.windup - dt);
          if (e.windup === 0) e.dashTime = .7;
        } else if (e.dashTime > 0) {
          e.dashTime = Math.max(0, e.dashTime - dt);
          const movement = world.move(e, e.dashX * e.chargeSpeed * speedScale * dt, e.dashY * e.chargeSpeed * speedScale * dt, obstacles, WORLD_W, WORLD_H);
          if (movement.blocked) e.dashTime = 0;
          if (training && e.trainingCharge) {
            const attempt = e.trainingCharge;
            if (Math.hypot(player.x - e.x, player.y - e.y) < e.r + player.r) attempt.hit = true;
            if (e.dashTime === 0) {
              if (attempt.moved && !attempt.hit && !movement.blocked) {
                training.bossDodges++;
                queueNotice('躲闪成功！', '已避开虫王冲锋，现在站定输出击败它。', '↔', '#c9ed75', 'training');
              }
              delete e.trainingCharge;
            }
          }
        } else if (e.chargeClock <= 0) {
          e.windup = .9; e.dashX = dx / d; e.dashY = dy / d; e.chargeClock = e.chargeInterval;
          if (training) e.trainingCharge = { x: player.x, y: player.y, moved: false, hit: d < e.r + player.r };
        } else navigator.moveEnemy(e, player.x, player.y, e.speed * speedScale, dt);
        e.x = Math.max(e.r + 22, Math.min(WORLD_W - e.r - 22, e.x)); e.y = Math.max(e.r + 22, Math.min(WORLD_H - e.r - 22, e.y));
      } else navigator.moveEnemy(e, player.x, player.y, e.speed * speedScale, dt);
      if (Math.hypot(player.x - e.x, player.y - e.y) < e.r + player.r && player.inv === 0) {
        if (player.dodge > 0 && Math.random() < player.dodge) { player.inv = .35; burst(player.x, player.y, '#bbefd5', 6); continue; }
        let lifeDamage = 0;
        if (player.shield > 0) {
          relicEffects.consumeShield(player, runRelicDefs.filter(def => player.skills[def.key]));
          relicEffect('shield', { type: 'ring', x: player.x, y: player.y, radius: 45 }); sound(900, .1, .02);
        } else { const guard = elapsed < player.guardUntil ? player.guardDefense : 0; const before = player.hp; player.hp = Math.max(training ? player.maxHp * .5 : 0, player.hp - Math.max(1, e.damage - player.defense - guard)); lifeDamage = before - player.hp; player.sinceHit = 0; }
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
      if (e.boss) bossKills++; else nonBossKills++;
      if (runMode !== 'training' && (e.elite || e.boss)) rouletteQueue.push({ count: e.boss ? 3 : 1, boss: !!e.boss });
      const reward = runMode !== 'training' && (e.elite || e.boss) ? 0 : runMode === 'training' ? e.xp : runMode === 'stage' ? stageXP.grant(e.xp, player.xpMult, e) : e.xp * player.xpMult;
      if (e.boss) player.xp += runMode === 'stage' ? stageXP.collect(reward, e) : reward;
      else if (reward > 0) dropExperience(e.x, e.y, reward);
      burst(e.x, e.y, e.boss ? e.color : e.elite ? '#f6c26b' : e.type ? '#e1aa80' : '#aec582', e.boss ? 36 : e.elite ? 16 : 8); return false;
    });
    gems = gems.filter(g => {
      if (training && trainingCatalog.steps[training.step].id === 'combat') return true;
      const dx = player.x - g.x, dy = player.y - g.y, d = Math.hypot(dx, dy);
      if (d < experiencePickupRange()) { g.x += dx / (d || 1) * Math.min(d, 320 * player.magnetMult * dt); g.y += dy / (d || 1) * Math.min(d, 320 * player.magnetMult * dt); }
      if (d < 19) { const value = runMode === 'stage' ? stageXP.collect(g.value, g) : g.value; player.xp += value; if (training) training.xpCollected += value; return false; } return true;
    });
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    particles = particles.filter(p => p.life > 0);
    if (runMode === 'endless') bankEndlessRewards();
    if (training) {
      const distance = Math.hypot(player.x - trainingOrigin.x, player.y - trainingOrigin.y);
      trainingTick(dt, distance); updateHUD();
      if (training && state === 'playing' && player.xp >= player.need) offerUpgrade();
      return;
    }
    // Process every due arrival before a reward/upgrade can open a menu.
    // Normally one is due; an overdue catch-up tick must not delay the rest.
    if (runMode === 'stage') while (announceBossArrival()) {}
    updateHUD();
    if (checkStageCompletion()) return;
    if (offerUpgrade()) return;
  }
  function updateHUD() {
    const activeHUD = isRunActive(), hudButtonsReady = ['playing', 'paused'].includes(state);
    const storeEnabled = !!currentAccount && !training && ['lobby', 'heroes', 'armory', 'orchard', 'playing', 'paused'].includes(state);
    el('commerceHeader').classList.toggle('hidden', !currentAccount || !!training);
    el('openStoreLobby').disabled = el('openStoreShop').disabled = !storeEnabled;
    el('diamondBalance').textContent = profile.commerce.diamonds.toLocaleString('en-US');
    el('storeHud').classList.toggle('hidden', !activeHUD || !!training); el('openStoreRun').disabled = !storeEnabled;
    el('storeItemState').textContent = profile.commerce.diamonds.toLocaleString('en-US') + ' 钻石';
    el('heroIcon').classList.toggle('commerce-gold-frame', !training && profile.commerce.equippedFrame === 'gold_frame' && store.owns(profile, 'gold_frame'));
    const pauseAction = state === 'help' ? '返回' : state === 'paused' ? '继续' : '暂停';
    const pauseButton = el('pause');
    if (pauseButton.dataset.action !== pauseAction || !pauseButton.innerHTML.includes('pause-label')) {
      pauseButton.innerHTML = '<span class="pause-icon" aria-hidden="true">' + (state === 'help' ? '↩' : state === 'paused' ? '▶' : 'Ⅱ') + '</span><span class="pause-label">' + pauseAction + '</span>';
      pauseButton.dataset.action = pauseAction;
    }
    pauseButton.disabled = !activeHUD || !['playing', 'paused', 'help'].includes(state);
    pauseButton.setAttribute?.('aria-label', pauseAction);
    pauseButton.title = pauseAction + '（P / Esc）';
    document.body.classList.toggle('run-hud-active', activeHUD);
    document.body.classList.toggle('run-hud-blocked', activeHUD && !hudButtonsReady);
    document.body.classList.toggle('training-active', !!training && activeHUD);
    el('trainingHud').classList.toggle('hidden', !training || !activeHUD || !hudButtonsReady);
    el('trainingExit').disabled = !training || !hudButtonsReady;
    if (training) {
      el('trainingExit').textContent = training.firstEntry ? '跳过引导' : '退出练习';
      const step = trainingCatalog.steps[training.step];
      el('trainingIcon').textContent = step.icon; el('trainingProgress').textContent = '晨芽练习场 · ' + (training.step + 1) + ' / 10';
      el('trainingTitle').textContent = step.title; el('trainingHint').textContent = step.hint;
      const target = { upgrade: '选择一次升级', skill: '施放一次英雄技能', relic: '走近发光饰品', map: '打开投放图并返回', elite: '击败这只精英虫', boss: '击败训练虫王' };
      el('trainingTarget').textContent = step.id === 'move' ? '已移动 ' + Math.min(140, Math.floor(training.distance)) + ' / 140' : step.id === 'stand' ? '站定 ' + Math.min(1.2, training.standTime).toFixed(1) + ' / 1.2 秒' : step.id === 'xp' ? '已拾取 ' + Math.round(training.xpCollected) + ' / 180 经验' : step.id === 'combat' ? '已击杀 ' + (kills - training.lastKills) + ' / 2' : '目标：' + target[step.id];
      if (step.id === 'boss') el('trainingTarget').textContent = training.bossDodges ? '✓ 已躲过冲锋 · 击败虫王' : '躲过 1 次冲锋 · 预警时侧向移动';
    }
    el('guardianHud').classList.toggle('hidden', !activeHUD); el('combatRail').classList.toggle('hidden', !activeHUD);
    el('combatGuide').disabled = !hudButtonsReady;
    el('logoutAccount').disabled = !currentAccount || isRunActive();
    el('logoutAccount').title = isRunActive() ? '先结束或放弃当前挑战，再切换账号' : '保存进度并切换账号';
    const outsideHelp = !!currentAccount && !isRunActive() && ['lobby', 'heroes', 'armory', 'orchard', 'world', 'relicMap', 'help'].includes(state);
    el('gameHelp').classList.toggle('hidden', !outsideHelp);
    el('gameHelp').disabled = !outsideHelp;
    el('endEndless').disabled = !['playing', 'paused'].includes(state);
    const s = isRunActive() || state === 'ended' ? activeStage : stage();
    el('hpFill').style.width = Math.max(0, Math.min(100, player.hp / player.maxHp * 100)) + '%'; el('hpText').textContent = Math.ceil(player.hp) + ' / ' + player.maxHp;
    el('hpMeter').setAttribute?.('aria-valuemax', String(player.maxHp)); el('hpMeter').setAttribute?.('aria-valuenow', String(Math.max(0, Math.ceil(player.hp))));
    const inRun = isRunActive() || state === 'ended';
    el('remaining').textContent = training ? (training.step + 1) + ' / 10' : inRun ? enemies.length : s.enemyCount;
    el('populationLabel').textContent = training ? '练习进度' : runMode === 'endless' && inRun ? '无尽第 ' + endlessWave + ' 波' : '剩余害虫';
    el('pursuing').textContent = inRun ? enemies.filter(e => e.aggro && e.hp > 0).length : s.initialPursuers;
    el('enemyTypes').textContent = runMode === 'endless' && inRun ? '无尽虫潮 · 连续增援' : '普通 ' + (inRun ? enemies.filter(e => !e.boss && !e.elite).length : s.normalCount) + ' · 精英 ' + (inRun ? enemies.filter(e => e.elite).length : s.eliteCount) + ' · Boss ' + (inRun ? bossKills : 0) + ' / ' + s.bossCount;
    el('level').textContent = 'LV. ' + player.level + (runMode === 'stage' && inRun ? ' / ' + (s.experience.choices + 1) : '');
    el('xpFill').style.width = Math.min(100, player.xp / player.need * 100) + '%'; el('xpText').textContent = Number(player.xp.toFixed(1)) + ' / ' + player.need;
    if (runMode === 'stage' && inRun && state !== 'upgrade' && player.xp >= player.need && elapsed < nextStageUpgradeAt) {
      el('xpText').textContent += ' · 待选 ' + Math.ceil(nextStageUpgradeAt - elapsed) + 's';
    }
    const boost = still >= combat.standDelay;
    el('stance').textContent = boost && inRun ? '✦ 站定蓄力 · 伤害 +' + Math.round((combat.standDamage - 1 + player.standPower) * 100) + '% / 射速 +35%' : still > 0 && inRun ? '✧ 蓄力中…' : '移动保命 · 停下蓄力';
    el('stance').classList.toggle('active', boost && inRun);
    el('damageStat').textContent = seedDamage().toFixed(1); el('rateStat').textContent = player.rate.toFixed(1) + ' / 秒';
    el('speedStat').textContent = Math.round(player.speed); el('shotsStat').textContent = player.shots; el('pickupStat').textContent = Math.round(player.pickup); el('killsStat').textContent = inRun ? kills : 0;
    el('stageName').textContent = training ? '新手引导关 · ' + trainingCatalog.name : '第 ' + s.id + ' / ' + stages.length + ' 关 · ' + (runMode === 'endless' && inRun ? '无尽虫潮' : s.name);
    el('pursuitRule').innerHTML = runMode === 'endless' && inRun ? '每 8 秒一波，数量与强度持续增加<br>可随时结束，材料获得即保存' : '普通：开局 ' + s.initialPursuers + '，每 ' + s.pursuitInterval + ' 秒 +' + s.batchSize + '<br>精英：' + s.eliteFirstAt + ' 秒首批，每 ' + s.eliteInterval + ' 秒 +' + s.eliteBatchSize + '<br>Boss ' + s.bossSchedule[0] + ' 秒起' + (s.bossCount > 1 ? ' · 每 ' + s.bossInterval + ' 秒一位 · 可同时在场，不等击杀' : ' · 固定时间登场，不受清场影响');
    el('loadout').textContent = gearDefs[profile.equipped.weapon].name + ' · ' + gearDefs[profile.equipped.armor].name + ' · ' + gearDefs[profile.equipped.charm].name;
    const hero = growth.hero(player.heroId);
    el('heroName').textContent = hero.name + ' · ' + hero.role; if (el('heroIcon').dataset.hero !== hero.id) { el('heroIcon').innerHTML = heroPortrait(hero); el('heroIcon').dataset.hero = hero.id; }
    el('heroSkill').disabled = state !== 'playing' || player.heroClock > 0;
    el('heroSkill').textContent = player.heroClock > 0 ? hero.skillIcon + ' ' + hero.skillName + ' · ' + player.heroClock.toFixed(1) + 's' : hero.skillIcon + ' ' + hero.skillName + ' · E';
    el('heroSkill').title = hero.skillDescription + ' ' + hero.passiveDescription;
    el('runBuild').textContent = '暴击 ' + Math.round(player.critChance * 100) + '% · 穿透 ' + statText(player.pierce) + ' · 减伤 ' + statText(player.defense + (elapsed < player.guardUntil ? player.guardDefense : 0)) + ' · 回复 ' + statText(player.regen) + '/秒' + (elapsed < player.guardUntil ? ' · 护体 ' + (player.guardUntil - elapsed).toFixed(1) + 's' : '');
    const activeBosses = inRun ? enemies.filter(e => e.boss && e.introduced && e.hp > 0) : [];
    const boss = activeBosses[0] || null, latestBoss = activeBosses.find(e => e.bossOrder === bossIndex - 1) || boss;
    el('bossHud').classList.toggle('hidden', !boss);
    if (boss) { el('bossName').textContent = (boss.bossOrder + 1) + ' / ' + s.bossCount + ' · ' + boss.name + (activeBosses.length > 1 ? ' · 同场 ' + activeBosses.length + ' 位' : ''); el('bossHp').style.width = Math.max(0, boss.hp / boss.maxHp * 100) + '%'; el('bossHpText').textContent = Math.ceil(boss.hp) + ' / ' + boss.maxHp + (elapsed < (boss.arrivalGuardUntil || 0) ? ' · 护壳减伤90%' : ''); }
    const pendingBoss = runMode === 'stage' && inRun ? enemies.find(e => e.boss && !e.introduced && e.hp > 0) : null;
    const arrivalNotice = !!latestBoss && elapsed < bossArrivalUntil;
    el('bossForecast').classList.toggle('hidden', !arrivalNotice && !pendingBoss);
    el('bossForecast').classList.toggle('arrival-notice', arrivalNotice);
    if (arrivalNotice) {
      const label = '⚠ Boss登场 · ' + latestBoss.name + (activeStage.beginner ? ' · 护壳展开，先移动躲开' : ' · 注意冲锋预警') + (activeBosses.length > 1 ? ' · 同场 ' + activeBosses.length + ' 位' : '');
      if (el('bossForecast').textContent !== label) el('bossForecast').textContent = label;
    } else if (pendingBoss) {
      const wait = Math.max(0, Math.ceil(pendingBoss.bossArrivalAt - elapsed));
      const label = (bossIndex ? '下一位虫王' : '首位虫王') + ' · ' + (wait ? wait + ' 秒后抵达' : '即将抵达') + (activeBosses.length ? ' · 场上 ' + activeBosses.length + ' 位，不等击杀' : ' · 固定时间登场');
      if (el('bossForecast').textContent !== label) el('bossForecast').textContent = label;
    }
    el('bossOthers').innerHTML = activeBosses.filter(e => e !== boss).map(e => '<div class="boss-extra"><strong>' + (e.bossOrder + 1) + ' · ' + e.name + '</strong><div class="bar"><div class="fill" style="width:' + Math.max(0, e.hp / e.maxHp * 100) + '%"></div></div><small>' + Math.ceil(e.hp) + ' / ' + e.maxHp + '</small></div>').join('');
    el('endlessHud').classList.toggle('hidden', !(runMode === 'endless' && isRunActive()));
    el('endlessWave').textContent = '∞ 第 ' + endlessWave + ' 波 · 已击杀 ' + kills;
    el('endlessLoot').textContent = '已存入：☀ ' + endlessCreditedSeeds + '　◆ ' + endlessCreditedCores;
    const canExplore = ['playing', 'paused'].includes(state) || (state === 'relicMap' && isRunActive());
    const showXPGuide = runMode === 'stage' && activeStage.id <= 2 && state === 'playing' && player.level <= 2;
    el('xpGuide').classList.toggle('hidden', !showXPGuide);
    if (showXPGuide) el('xpGuide').textContent = player.level === 1 ? '蓝色 XP 是经验 · 首次成长会额外吸附，集满后选技能' : '靠近蓝色 XP 拾取经验，继续升级你的技能';
    el('exploreControls').classList.toggle('hidden', !canExplore); el('relicHud').classList.toggle('hidden', !isRunActive());
    el('dashSkill').classList.toggle('hidden', !player.skills.dash);
    el('dashSkill').disabled = state !== 'playing' || (player.skillTimers.dash || 0) > 0;
    el('dashSkill').textContent = (player.skillTimers.dash || 0) > 0 ? '闪步 · ' + player.skillTimers.dash.toFixed(1) + 's' : '闪步 · Space';
    const claimed = relicDrops.filter(d => d.claimed).length;
    el('relicStatus').textContent = training ? '训练饰品 ' + claimed + ' / 1' : '本局饰品 ' + claimed + ' / 6 · M 查看';
    const targetDrop = relicDrops.find(drop => String(drop.id) === String(trackedRelic) && !drop.claimed);
    const showTracker = !!targetDrop && canExplore;
    el('relicTracker').classList.toggle('hidden', !showTracker);
    if (showTracker) {
      const def = runRelicDefs.find(item => String(item.id) === String(targetDrop.id));
      const dx = targetDrop.x - player.x, dy = targetDrop.y - player.y, angle = Math.atan2(dy, dx);
      const direction = ['东', '东南', '南', '西南', '西', '西北', '北', '东北'][(Math.round(angle / (Math.PI / 4)) + 8) % 8];
      el('relicTrackerArrow').style.transform = 'rotate(' + (angle * 180 / Math.PI + 90) + 'deg)';
      el('relicTrackerText').textContent = def.name + ' · ' + direction + ' ' + Math.round(Math.hypot(dx, dy)) + ' 距离';
    }
    const ownedDefs = runRelicDefs.filter(def => player.skills[def.key]);
    const relicSignature = (training ? 'training:' : '') + (ownedDefs.map(def => def.id).join(',') || 'empty');
    if (relicSignature !== relicHudSignature) {
      relicHudSignature = relicSignature;
      el('relicSlots').innerHTML = ownedDefs.length ? ownedDefs.map(def => '<button class="relic-slot active" data-owned-relic="' + def.id + '" title="' + def.name + '：' + def.description + '" aria-label="查看' + def.name + '效果">' + def.icon + '<b>' + def.name + '</b></button>').join('') : '<span class="relic-empty">' + (training ? '饰品将在第 7 步出现<br>M 可查看位置和效果' : '探索亮光投放点，拾取后显示于此<br>M 查看本局 6 件的位置与效果') + '</span>';
      el('relicSlots').querySelectorAll('[data-owned-relic]').forEach(button => { button.onclick = () => { selectedRelic = button.dataset.ownedRelic; showRelicMap(selectedRelic); }; });
    }
    el('lootTicker').classList.toggle('hidden', !currentNotice || !isRunActive());
    el('lootTicker').classList.toggle('frozen', state !== 'playing');
    el('buildHud').classList.toggle('hidden', !isRunActive());
    const buildSignature = player.build.mode + JSON.stringify(player.build.levels) + player.build.superSkills.join(',');
    if (buildSignature !== buildHudSignature) {
      buildHudSignature = buildSignature; const build = builds.summary(player);
      el('buildSlots').innerHTML = ['attack', 'attribute'].map(category => {
        const endless = build.mode === 'endless', entries = build[category], visible = entries.slice(-4);
        const name = category === 'attack' ? '攻击' : '属性';
        return '<div class="build-row"><strong title="' + name + ' ' + entries.length + ' 种 · ' + build[category + 'Choices'] + ' 次成长"><span>' + name + '</span><small>' + entries.length + (endless ? ' 种' : '/4') + '</small></strong><div class="build-chips">' + Array.from({ length: 4 }, (_, i) => {
          const def = visible[i], hint = def ? def.name + ' · Lv.' + def.level + (endless ? '' : ' / 5') + ' · 点击查看' + name + '构筑' : name + '空槽 · 点击查看构筑说明';
          return '<button type="button" class="build-chip ' + (def ? category : 'empty') + '" data-build-category="' + category + '" title="' + hint + '" aria-label="' + hint + '"><span class="build-chip-icon" aria-hidden="true">' + (def ? def.icon : '＋') + '</span>' + (def ? '<small class="build-chip-level">' + def.level + '</small>' : '') + '</button>';
        }).join('') + '</div>' + (entries.length > 4 ? '<button type="button" class="build-more" data-build-category="' + category + '" aria-label="查看全部' + entries.length + '种' + name + '词条">全部 ' + entries.length + ' 种</button>' : '') + '</div>';
      }).join('');
      el('superSkills').innerHTML = build.supers.length ? '<div class="super-strip"><strong>超级</strong>' + build.supers.map(recipe => '<button type="button" class="super-chip" data-build-category="super" title="' + recipe.name + '：' + recipe.description + '" aria-label="查看' + recipe.name + '效果"><span aria-hidden="true">' + recipe.icon + '</span></button>').join('') + '</div>' : '';
      el('buildSlots').querySelectorAll('[data-build-category]').forEach(button => { button.onclick = () => openBuildDetails(button.dataset.buildCategory, button); });
      el('superSkills').querySelectorAll('[data-build-category]').forEach(button => { button.onclick = () => openBuildDetails('super', button); });
    }
    el('buildSlots').querySelectorAll('[data-build-category]').forEach(button => { button.disabled = !hudButtonsReady; });
    el('superSkills').querySelectorAll('[data-build-category]').forEach(button => { button.disabled = !hudButtonsReady; });
  }
  function ellipse(x, y, rx, ry, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
  function drawSprite(key, x, y, width, height = width, angle = 0) {
    const frame = art.heroFrames?.[key];
    if (frame && heroAtlas?.complete && heroAtlas.naturalWidth) {
      ctx.save(); ctx.translate(x, y); if (angle) ctx.rotate(angle);
      ctx.drawImage(heroAtlas, frame.x * heroAtlas.naturalWidth, frame.y * heroAtlas.naturalHeight, frame.w * heroAtlas.naturalWidth, frame.h * heroAtlas.naturalHeight, -width / 2, -height / 2, width, height);
      ctx.restore(); return true;
    }
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
    if (training) return;
    const x = W - 177, y = H > W ? 160 : 95, w = 150, h = 106, sx = w / WORLD_W, sy = h / WORLD_H;
    ctx.fillStyle = '#12261ee8'; ctx.fillRect(x - 9, y - 24, w + 18, h + 61); ctx.strokeStyle = '#88a75888'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#d8e7b5'; ctx.font = '11px "Microsoft YaHei",sans-serif'; ctx.fillText(mapLayout.id + ' · ' + mapLayout.name, x, y - 9);
    mapRenderer.mini(ctx, mapLayout, x, y, w, h);
    for (const e of enemies) { if (!e.aggro || e.hp <= 0) continue; ctx.fillStyle = e.boss ? '#fa8b79' : e.elite ? '#ffd16c' : e.type ? '#dbad7b' : '#b1cc79'; const r = e.boss ? 4 : e.elite ? 3 : 2; ctx.fillRect(x + e.x * sx - r / 2, y + e.y * sy - r / 2, r, r); }
    for (let i = 0; i < relicDrops.length; i++) {
      const drop = relicDrops[i], px = x + drop.x * sx, py = y + drop.y * sy;
      ellipse(px, py, 5, 5, drop.claimed ? '#466753' : runRelicDefs[i].color);
      if (!drop.claimed && String(drop.id) === String(trackedRelic)) {
        ctx.strokeStyle = '#fff2cd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.stroke();
      }
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
    if (elapsed < (e.arrivalGuardUntil || 0)) {
      ctx.strokeStyle = '#b9eaff'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 15 + Math.sin(elapsed * 14) * 3, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#e5faff'; ctx.font = 'bold 12px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('护壳 ' + (e.arrivalGuardUntil - elapsed).toFixed(1) + 's · 减伤90%', e.x, e.y - e.r - 24); ctx.textAlign = 'start';
    }
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
  function drawCommerceAura(p) {
    if (training || !isRunActive() || profile.commerce.equippedAura !== 'star_aura' || !store.owns(profile, 'star_aura')) return;
    ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = '#dfc17c'; ctx.shadowColor = '#99e4e9'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 19, 33, 12, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#9ce9e5'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(p.x, p.y + 19, 26, 8, 0, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const angle = elapsed * .45 + i * Math.PI / 2, x = p.x + Math.cos(angle) * 33, y = p.y + 19 + Math.sin(angle) * 12;
      ctx.fillStyle = '#fff0ba'; ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x + 3, y); ctx.lineTo(x, y + 4); ctx.lineTo(x - 3, y); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function draw() {
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
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
    drawCommerceAura(p);
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
    else if (state === 'roulette' && !document.hidden) rouletteTick(dt);
    else if (state === 'rescue' && !document.hidden) {
      cinematicTime += dt;
      if (cinematicTime >= 3.8) completeRescue();
    }
    if (state !== 'cover') draw(); requestAnimationFrame(frame);
  }
  addEventListener('resize', syncViewport);
  if (typeof ResizeObserver === 'function') new ResizeObserver(syncViewport).observe(canvas);
  syncViewport(); updateCamera();
  showCover();requestAnimationFrame(frame);
})();
