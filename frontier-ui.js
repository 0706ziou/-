/* Shared, server-authoritative world. Game credentials stay only in memory. */
(() => {
  'use strict';
  const API = '/api/world';
  const BUILDING_ATLAS = 'assets/world/buildings-v2.png';
  const BUILDING_FRAMES = Object.freeze({ keep: 0, farm: 1, lumbermill: 2, quarry: 3, ironworks: 4, warehouse: 5, wall: 6, barracks: 7, plot: 8 });
  const MATERIALS = {
    wood: { name: '木材', icon: '🪵', image: 'assets/materials/wood.svg' }, stone: { name: '石料', icon: '🪨', image: 'assets/materials/stone.svg' },
    grain: { name: '粮草', icon: '🌾' }, iron: { name: '铁矿', icon: '⛏' },
    token: { name: '世界令', icon: '✦' }
  };
  const BUILDINGS = {
    keep: { name: '主城', icon: '🏡', detail: '家园核心，提升城池等级。' },
    farm: { name: '农田', icon: '🌾', detail: '持续积攒粮草，供应军队。' },
    lumbermill: { name: '伐木场', icon: '🌲', detail: '持续生产木材，用于城池建设。' },
    quarry: { name: '采石场', icon: '🪨', detail: '持续生产石料，巩固家园。' },
    ironworks: { name: '铁矿场', icon: '⛏', detail: '持续生产铁矿，用于训练与升级。' },
    warehouse: { name: '仓库', icon: '🪵', detail: '提升物资储存上限。' },
    wall: { name: '城墙', icon: '🧱', detail: '加强家园防守，减少被袭击的风险。' },
    barracks: { name: '兵营', icon: '⚔', detail: '训练军队，提升驻防能力。' }
  };
  const UNITS = { infantry: { name: '步兵', icon: '🛡' }, archer: { name: '弓兵', icon: '🏹' }, cavalry: { name: '骑兵', icon: '🐎' } };
  const TABS = [['map', '🗺', '世界地图'], ['home', '🏡', '主城'], ['army', '⚔', '小队军营'], ['guild', '⚑', '公会']];
  let host = null, exitCallback = null, authenticatedCallback = null, worldState = null, expectedName = '', authenticatedName = '';
  let featureGuide = '', guideCallback = null;
  let activeTab = 'map', selectedTile = null, selectedTarget = null, editingSquadId = null, attackSquadId = '';
  let connected = false, connecting = false, busy = false, message = null, retryRequest = null;
  let refreshTimer = null, countdownTimer = null, generation = 0, refreshing = null, serverOffset = 0;
  let requestSequence = 0, gameCredential = null, linkRequired = false, accountGeneration = 0, entering = null, leaving = null;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const number = value => Math.max(0, Math.floor(numeric(value))).toLocaleString('zh-CN');
  const now = () => Date.now() + serverOffset;
  const remaining = until => Math.max(0, Math.ceil((numeric(until) - now()) / 1000));
  const duration = seconds => seconds <= 0 ? '已完成' : seconds >= 3600 ? `${Math.floor(seconds / 3600)}小时${Math.ceil(seconds % 3600 / 60)}分` : seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`;
  const countdown = (until, endText = '已结束') => `<span data-world-until="${numeric(until)}" data-world-end="${escapeHtml(endText)}">${remaining(until) ? duration(remaining(until)) : escapeHtml(endText)}</span>`;
  const uid = () => globalThis.crypto?.randomUUID?.() || `world-${Date.now()}-${++requestSequence}-${Math.random().toString(36).slice(2)}`;
  const self = () => isAuthenticated(expectedName) ? worldState?.self : null;
  const enabled = () => connected && !busy && !!self();
  const rule = () => worldState?.rules || {};
  const buildingLevel = (home, key) => numeric(home?.buildings?.[key]?.level ?? home?.buildings?.[key]);
  const buildingArt = key => {
    const frame = BUILDING_FRAMES[key] ?? BUILDING_FRAMES.plot;
    return `<span class="world-building-art" aria-hidden="true" style="background-image:url('${BUILDING_ATLAS}');background-position:${frame % 3 * 50}% ${Math.floor(frame / 3) * 50}%"></span>`;
  };
  const materialIcon = key => MATERIALS[key]?.image ? `<img class="world-material-icon" src="${MATERIALS[key].image}" alt="" width="28" height="28">` : MATERIALS[key]?.icon || '';
  const costText = costs => Object.entries(costs || {}).filter(([key, value]) => MATERIALS[key] && numeric(value) > 0).map(([key, value]) => `<span class="world-cost-material">${materialIcon(key)} ${MATERIALS[key].name} ${number(value)}</span>`).join(' · ') || '无需物资';
  const affordable = costs => !!self() && Object.entries(costs || {}).every(([key, amount]) => !MATERIALS[key] || numeric(self().resources?.[key]) >= numeric(amount));
  const guildById = id => (worldState?.guilds || []).find(guild => guild.id === id);
  const playerById = id => (worldState?.players || []).find(player => player.id === id);
  const tileByXY = (x, y) => (worldState?.map?.cells || []).find(cell => cell.x === x && cell.y === y);
  const guildColor = id => {
    let hash = 0;
    for (const char of String(id || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return `hsl(${hash % 360} 45% 62%)`;
  };

  class WorldError extends Error {
    constructor(text, code, retryable = false) { super(text); this.name = 'WorldError'; this.code = code; this.retryable = retryable; }
  }

  async function request(path, payload) {
    if (globalThis.location?.protocol === 'file:') throw new WorldError('当前是本地文件页面，世界需要通过 HTTP / HTTPS 游戏地址连接世界服务。', 'FILE_MODE', true);
    const epochHeaders = await window.ORCHARD_ONLINE_RESET?.requestHeaders() || {};
    const requestEpoch = epochHeaders['X-Orchard-Data-Epoch'] ?? window.ORCHARD_ONLINE_RESET?.currentEpoch();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${API}/${path}`, {
        method: payload === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json', ...epochHeaders, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal: controller.signal
      });
      let result;
      try { result = await response.json(); } catch (_) {
        throw new WorldError('这个游戏地址尚未连接世界服务。请启动或部署世界服务后重试。', 'SERVICE_UNAVAILABLE', true);
      }
      if (result.code === 'data_reset') await window.ORCHARD_ONLINE_RESET?.handleReset();
      window.ORCHARD_ONLINE_RESET?.assertCurrent(requestEpoch);
      if (!response.ok || result.ok === false) throw new WorldError(result.error || result.message || `世界服务请求失败（${response.status}）。`, result.code || String(response.status), response.status >= 500 || response.status === 429);
      if (!result.state && path === 'state') throw new WorldError('世界服务返回的数据不完整，请刷新重试。', 'INVALID_STATE', true);
      return result;
    } catch (error) {
      if (error instanceof WorldError) throw error;
      throw new WorldError(error.name === 'AbortError' ? '世界服务响应超时，请检查连接后重试。' : '暂时无法连接世界服务，请检查网络或服务是否已启动。', 'CONNECTION_FAILED', true);
    } finally { clearTimeout(timer); }
  }

  function setPlayerName(name) {
    const nextName = String(name || '').trim();
    if (expectedName !== nextName) {
      expectedName = nextName; authenticatedName = ''; generation++;
      accountGeneration++; gameCredential = null; linkRequired = false; entering = null;
      selectedTile = null; selectedTarget = null; message = null; retryRequest = null;
      editingSquadId = null; attackSquadId = ''; worldState = null;
      busy = false; connecting = false; refreshing = null;
    }
  }

  function adoptState(nextState, forName) {
    if (!nextState || forName !== expectedName) return;
    if (worldState && numeric(nextState.serverTime) && numeric(worldState.serverTime) > numeric(nextState.serverTime)) return;
    worldState = nextState;
    authenticatedName = nextState.self?.name === expectedName ? expectedName : '';
    if (authenticatedName) linkRequired = false;
    if (Number.isFinite(nextState.serverTime ?? nextState.now)) serverOffset = (nextState.serverTime ?? nextState.now) - Date.now();
    connected = true;
    if (!selectedTile) selectedTile = self()?.home ? { x: self().home.x, y: self().home.y } : { x: 7, y: 7 };
  }

  function isAuthenticated(name = expectedName) {
    return !!name && String(name).trim() === expectedName && authenticatedName === expectedName && worldState?.self?.name === expectedName;
  }

  function hasGameLogin(name = expectedName) {
    return !!name && String(name).trim() === expectedName && gameCredential?.name === expectedName;
  }

  async function enterGame(name, password) {
    setPlayerName(name);
    if (!expectedName || typeof password !== 'string' || !password) throw new WorldError('请先在游戏首页登录，再进入世界。', 'GAME_LOGIN_REQUIRED');
    if (gameCredential?.name !== expectedName || gameCredential.password !== password) {
      gameCredential = { name: expectedName, password }; accountGeneration++; entering = null;
    }
    return enterCurrentGame();
  }

  async function enterCurrentGame() {
    if (!gameCredential || gameCredential.name !== expectedName) return false;
    if (entering) return entering;
    const credential = gameCredential, token = accountGeneration;
    const operation = Promise.resolve(leaving).catch(() => {}).then(() => {
      if (token !== accountGeneration || credential !== gameCredential) return null;
      return request('enter', credential);
    }).then(result => {
      if (token !== accountGeneration || credential !== gameCredential) return false;
      if (!result) return false;
      linkRequired = false; adoptState(result.state, credential.name);
      if (host) { render(); Promise.resolve().then(() => authenticatedCallback?.()).catch(() => {}); }
      return isAuthenticated(credential.name);
    }).catch(error => {
      if (token === accountGeneration && credential === gameCredential) {
        linkRequired = error.code === 'world_link_required';
        if (linkRequired) connected = true;
        if (host) { message = { text: error.message, kind: linkRequired ? 'error' : 'connection' }; render(); }
      }
      throw error;
    }).finally(() => { if (entering === operation) entering = null; });
    entering = operation;
    return operation;
  }

  async function prepareSession(name = expectedName, { renderUI = true } = {}) {
    setPlayerName(name);
    const forName = expectedName, token = accountGeneration;
    const result = await request('state');
    if (token !== accountGeneration || forName !== expectedName) return false;
    adoptState(result.state, forName);
    if (forName === expectedName && !isAuthenticated(forName) && gameCredential && !linkRequired) await enterCurrentGame();
    if (host && renderUI) render();
    return isAuthenticated(forName);
  }

  async function beginCampaign(stage, name = expectedName) {
    setPlayerName(name);
    const forName = expectedName, token = accountGeneration;
    if (!await prepareSession(forName)) throw new WorldError('世界暂未连接，请进入世界完成连接后再挑战关卡。', 'WORLD_LOGIN_REQUIRED');
    if (token !== accountGeneration || forName !== expectedName) throw new WorldError('已切换账号，本局世界物资登记已取消。', 'ACCOUNT_CHANGED');
    const result = await request('campaign/start', { stage: Number(stage), name: forName });
    if (token !== accountGeneration || forName !== expectedName) throw new WorldError('已切换账号，本局世界物资登记已取消。', 'ACCOUNT_CHANGED');
    adoptState(result.state, forName);
    if (host) render();
    return result;
  }

  async function claimCampaign(ticket, name = expectedName) {
    setPlayerName(name);
    const forName = expectedName, token = accountGeneration;
    if (!await prepareSession(forName)) throw new WorldError('请用本局账号进入世界，再领取世界物资。', 'WORLD_LOGIN_REQUIRED');
    if (token !== accountGeneration || forName !== expectedName) throw new WorldError('已切换账号，请回到本局账号查看世界物资。', 'ACCOUNT_CHANGED');
    const result = await request('campaign/claim', { ticket, requestId: `claim-${String(ticket)}`, name: forName });
    if (token !== accountGeneration || forName !== expectedName) throw new WorldError('已切换账号，请回到本局账号查看世界物资。', 'ACCOUNT_CHANGED');
    adoptState(result.state, forName);
    if (host) render();
    return result;
  }

  async function completeCampaign(ticket, name = expectedName) {
    setPlayerName(name);
    const forName = expectedName, token = accountGeneration;
    if (!await prepareSession(forName)) throw new WorldError('账号服务暂未连接，通关成绩会在连接后同步。', 'WORLD_LOGIN_REQUIRED');
    if (token !== accountGeneration || forName !== expectedName) throw new WorldError('已切换账号，本局通关成绩未提交。', 'ACCOUNT_CHANGED');
    const result = await request('campaign/complete', { ticket, name: forName });
    if (token !== accountGeneration || forName !== expectedName) throw new WorldError('已切换账号，请回到本局账号查看成绩。', 'ACCOUNT_CHANGED');
    adoptState(result.state, forName);
    if (host) render();
    return result;
  }

  async function getLeaderboard(page = 1, name = expectedName) {
    if (!Number.isInteger(page) || page < 1 || page > 1000000) throw new WorldError('排行榜页码无效。', 'INVALID_PAGE');
    setPlayerName(name);
    const forName = expectedName, token = accountGeneration;
    try { await prepareSession(forName, { renderUI: false }); } catch (error) {
      // The global list stays readable even when an old account still needs linking.
      if (error.code === 'ACCOUNT_CHANGED') throw error;
    }
    if (token !== accountGeneration || forName !== expectedName) throw new WorldError('已切换账号，请重新打开排行榜。', 'ACCOUNT_CHANGED');
    const result = await request(`leaderboard?page=${page}`);
    if (token !== accountGeneration || forName !== expectedName) throw new WorldError('已切换账号，请重新打开排行榜。', 'ACCOUNT_CHANGED');
    if (!result.leaderboard || !Array.isArray(result.leaderboard.entries)) throw new WorldError('排行榜数据暂时不可用，请刷新重试。', 'INVALID_LEADERBOARD', true);
    if (!isAuthenticated(forName)) return { ...result.leaderboard, self: null, entries: result.leaderboard.entries.map(row => ({ ...row, isSelf: false })) };
    return result.leaderboard;
  }

  async function refresh({ quiet = false } = {}) {
    if (refreshing || busy) return refreshing;
    const forName = expectedName, token = generation;
    if (!quiet) { connecting = true; render(); }
    const operation = prepareSession(forName, { renderUI: false }).then(() => {
      if (token !== generation || forName !== expectedName) return;
      connecting = false;
      if (message?.kind === 'connection') message = null;
      if (host && (!quiet || !host.contains(document.activeElement) || !document.activeElement.matches('input, select'))) render();
    }).catch(error => {
      if (token !== generation) return;
      connected = false; connecting = false;
      message = { text: error.message, kind: 'connection' };
      if (host) render();
    }).finally(() => { if (refreshing === operation) refreshing = null; if (token === generation) { connecting = false; if (host) renderStatus(); } });
    refreshing = operation;
    return refreshing;
  }

  function saveForm() {
    const values = {};
    if (!host) return values;
    host.querySelectorAll('[data-world-preserve]').forEach(input => { if (input.type !== 'password') values[input.id] = input.value; });
    return values;
  }

  function restoreForm(values) {
    for (const [id, value] of Object.entries(values)) {
      const input = host?.querySelector(`#${id}`);
      if (input) input.value = value;
    }
  }

  function renderStatus() {
    if (!host) return;
    const status = host.querySelector('.world-connection');
    if (status) {
      status.classList.toggle('world-is-offline', !connected);
      status.textContent = connecting ? '正在连接…' : connected ? '世界服务已连接' : '世界服务未连接';
    }
  }

  function header() {
    return `<header class="world-header"><div><small class="world-eyebrow">ORCHARD FRONTIER / 共享世界</small><h2>${activeTab === 'home' ? '我的主城' : '果园世界'}</h2><p>同一片土地，各自建家，结盟远征。</p></div><div class="world-header-actions"><span class="world-connection ${connected ? '' : 'world-is-offline'}">${connecting ? '正在连接…' : connected ? '世界服务已连接' : '世界服务未连接'}</span><button class="world-button world-button-primary world-return-home" data-world-action="tab" data-tab="home">🏡 回到主城</button><button class="world-button world-button-small" data-world-action="refresh" ${busy || connecting ? 'disabled' : ''}>↻ 刷新</button></div></header>`;
  }

  function resourceBar() {
    const resources = self()?.resources;
    return `<div class="world-resources" aria-label="世界专属物资">${Object.entries(MATERIALS).map(([key, material]) => `<div class="world-resource"><span aria-hidden="true">${materialIcon(key)}</span><span>${material.name}<b>${resources ? number(resources[key]) : '—'}</b></span></div>`).join('')}<div class="world-resource-tip">${self() ? `${escapeHtml(self().name)} · 世界专属仓库` : '通关取得 · 仅在世界使用'}</div></div>`;
  }

  function notice() {
    if (!message) return '';
    return `<div class="world-notice world-notice-${escapeHtml(message.kind)}" role="status" aria-live="polite"><span>${escapeHtml(message.text)}</span>${retryRequest && !busy ? '<button class="world-button world-button-small" data-world-action="retry">重试刚才操作</button>' : message.kind === 'connection' && !connecting ? '<button class="world-button world-button-small" data-world-action="refresh">重新连接</button>' : ''}</div>`;
  }

  function authCard() {
    if (self()) return '';
    if (linkRequired) return `<section class="world-card world-auth-card"><div class="world-auth-copy"><span class="world-card-kicker">一次性连接旧家园</span><h3>把旧世界存档接到游戏账号</h3><p><strong>${escapeHtml(expectedName)}</strong> 已有旧世界家园。输入曾设置的世界密码确认归属，原有建筑、军队和物资都会保留。</p><p class="world-muted">连接完成后，登录游戏就能直接进入世界，不再重复填写世界密码。</p></div><form id="worldLinkForm" class="world-auth-form"><label>原世界密码<input id="worldLegacyPassword" type="password" required minlength="6" maxlength="64" autocomplete="current-password" placeholder="仅本次确认旧家园归属" ${busy ? 'disabled' : ''}></label><button class="world-button world-button-primary" type="submit" ${busy || !gameCredential ? 'disabled' : ''}>${busy ? '正在连接…' : '连接并保留旧家园'}</button></form></section>`;
    return `<section class="world-card world-auth-card world-auto-connect"><div class="world-auth-copy"><span class="world-card-kicker">当前守护者 · ${escapeHtml(expectedName || '尚未登录')}</span><h3>${connecting ? '正在接入你的世界' : '使用游戏账号直接进入世界'}</h3><p>世界与游戏共用名字和密码，家园进度保存在服务器。${gameCredential ? '连接成功后即可建设主城。' : '请回游戏首页登录一次，即可自动连接。'}</p></div><button class="world-button" data-world-action="${gameCredential ? 'refresh' : 'exit'}" ${connecting ? 'disabled' : ''}>${connecting ? '连接中…' : gameCredential ? '重新连接' : '返回游戏'}</button></section>`;
  }

  function mapView() {
    if (!worldState?.map) return `<section class="world-card world-offline-card"><span class="world-empty-art" aria-hidden="true">${buildingArt('lumbermill')}</span><h3>等待连接果园世界</h3><p>多人家园、军队和公会由世界服务器统一保存。连接成功后会显示真实玩家的城池。</p><button class="world-button world-button-primary" data-world-action="refresh" ${connecting ? 'disabled' : ''}>${connecting ? '连接中…' : '重新连接世界服务'}</button></section>`;
    const map = worldState.map, width = numeric(map.width) || 16, height = numeric(map.height) || 16;
    const me = self(), occupied = new Map((map.cells || []).map(cell => [`${cell.x},${cell.y}`, cell]));
    let tiles = '';
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const cell = occupied.get(`${x},${y}`), mine = cell?.ownerId === me?.id && !!me;
      const ally = !mine && !!me?.guildId && cell?.guildId === me.guildId;
      const selected = selectedTile?.x === x && selectedTile?.y === y;
      const terrain = (x * 7 + y * 13) % 11 < 2 ? '🌳' : (x + y * 3) % 9 === 0 ? '🌼' : '';
      const label = cell ? `${cell.ownerName}的家园 · 等级 ${cell.level}${cell.guildId ? ` · ${guildById(cell.guildId)?.name || '公会'}` : ''}` : '空地 · 可以建家';
      tiles += `<button type="button" class="world-tile ${cell ? 'world-occupied' : 'world-wild'} ${mine ? 'world-mine' : ally ? 'world-ally' : ''} ${selected ? 'world-selected' : ''}" data-world-action="tile" data-x="${x}" data-y="${y}" aria-label="${escapeHtml(`地块 ${x + 1}, ${y + 1} · ${label}`)}" aria-pressed="${selected}" title="${escapeHtml(label)}" ${cell?.guildId ? `style="--world-guild-color:${guildColor(cell.guildId)}"` : ''}><span class="world-tile-art" aria-hidden="true">${cell ? buildingArt('keep') : terrain ? buildingArt('plot') : ''}</span>${cell ? `<span class="world-tile-level">${number(cell.level)}</span>` : ''}<span class="world-tile-coordinate">${x + 1},${y + 1}</span></button>`;
    }
    return `<div class="world-map-layout"><section class="world-card world-map-card"><div class="world-section-heading"><div><span class="world-card-kicker">所有玩家共用地图</span><h3>青叶平原</h3></div><span class="world-counter">${number((worldState.players || []).length)} 位守护者 · ${number(map.cells?.length)} 座家园</span></div><div class="world-map-grid" role="group" aria-label="世界地块地图" style="--world-map-columns:${width}">${tiles}</div><div class="world-map-legend"><span><i class="world-legend-mine"></i>我的家园</span><span><i class="world-legend-ally"></i>同公会</span><span><i class="world-legend-other"></i>其他玩家</span><span><i class="world-legend-wild"></i>可建空地</span></div><p class="world-muted world-map-help">点击地块查看家园或选择落脚点。城池上的细线代表所属公会。</p></section><aside class="world-tile-panel">${tilePanel()}</aside></div>`;
  }

  function tilePanel() {
    const tile = selectedTile || { x: 7, y: 7 }, cell = tileByXY(tile.x, tile.y), me = self();
    const coordinates = `坐标 ${tile.x + 1}, ${tile.y + 1}`;
    if (!cell) return `<section class="world-card"><span class="world-card-kicker">${coordinates} / 无主地块</span><span class="world-empty-art" aria-hidden="true">${buildingArt('plot')}</span><h3>在这里种下新家</h3><p>选择空地，建立一座属于你的城池。其他真实玩家也会在这片世界建造。</p><div class="world-cost-box"><small>建家所需</small><strong>${costText(rule().costs?.settle)}</strong></div>${!me ? '<p class="world-muted">游戏账号连接世界后即可占地建家。</p>' : me.home ? '<p class="world-muted">你已有一座家园，可以升级建筑和招募军队。</p><button class="world-button world-button-primary" data-world-action="tab" data-tab="home">回到主城</button>' : `<button class="world-button world-button-primary" data-world-action="settle" ${!enabled() || !affordable(rule().costs?.settle) ? 'disabled' : ''}>${busy ? '正在建造…' : '确认在这里建家'}</button>${!affordable(rule().costs?.settle) ? '<p class="world-muted">物资不足，连接世界后通关即可补充。</p>' : ''}`}</section><section class="world-card world-field-notes"><h4>远征 → 建家 → 结盟</h4><p>通关取得木材、石料、粮草、铁矿与世界令，专用于这个世界。农田积粮，兵营造兵，城墙护家。</p></section>`;
    const mine = me?.id === cell.ownerId, player = playerById(cell.ownerId), guild = guildById(cell.guildId);
    return `<section class="world-card"><span class="world-card-kicker">${coordinates} / ${mine ? '我的家园' : '玩家家园'}</span><span class="world-empty-art" aria-hidden="true">${buildingArt('keep')}</span><h3>${escapeHtml(cell.ownerName)}的家园</h3><div class="world-facts"><span>城池等级<b>Lv. ${number(cell.level)}</b></span><span>所属公会<b>${escapeHtml(guild?.name || '暂无公会')}</b></span><span>军队规模<b>${player?.army === undefined ? '未公开' : `${number(player.army)} 人`}</b></span></div>${remaining(cell.protectedUntil) ? `<p class="world-protection">🛡 新城保护 · ${countdown(cell.protectedUntil)}</p>` : '<p class="world-muted">当前没有新城保护。</p>'}${mine ? '<button class="world-button world-button-primary" data-world-action="tab" data-tab="home">回到主城</button>' : `<button class="world-button ${guild && guild.id === me?.guildId ? '' : 'world-button-primary'}" data-world-action="target" data-target-id="${escapeHtml(cell.ownerId)}" ${!enabled() || !me?.home || remaining(cell.protectedUntil) || (!!me?.guildId && me.guildId === cell.guildId) ? 'disabled' : ''}>查看并准备出征</button>${!!me?.guildId && me.guildId === cell.guildId ? '<p class="world-muted">同公会成员不能互相攻打。</p>' : !me?.home ? '<p class="world-muted">建家并训练军队后才能出征。</p>' : ''}`}</section>`;
  }

  function signInEmpty(text) { return `<section class="world-card world-simple-empty"><span class="world-empty-art" aria-hidden="true">${buildingArt('plot')}</span><h3>${text}</h3><p>使用游戏账号连接后即可管理家园、军队与公会，世界进度由服务器保存。</p><button class="world-button" data-world-action="tab" data-tab="map">前往世界地图</button></section>`; }

  function cityScene(home) {
    return `<section class="world-town-scene" aria-label="我的主城建筑"><div class="world-town-sky"><span>青叶家园</span><small>建筑等级与主城实际存档同步</small></div><div class="world-town-plots">${Object.entries(BUILDINGS).map(([key, building]) => {
      const level = buildingLevel(home, key);
      return `<button class="world-town-plot ${level ? 'world-town-built' : 'world-town-unbuilt'} ${key === 'keep' ? 'world-town-keep' : ''}" data-world-action="focus-building" data-building="${key}" aria-label="${building.name}，${level ? `等级 ${level}` : '尚未建造'}"><span class="world-town-art" aria-hidden="true">${buildingArt(level ? key : 'plot')}</span><strong>${building.name}</strong><small>${level ? `Lv. ${number(level)} · 已建造` : '空地 · 待建造'}</small></button>`;
    }).join('')}</div><div class="world-town-path" aria-hidden="true"></div></section>`;
  }

  function productionView(home) {
    const production = home.production || {}, pending = Object.values(production).reduce((sum, item) => sum + numeric(item.stored), 0);
    return `<section class="world-card world-city-production"><div class="world-section-heading"><div><span class="world-card-kicker">建筑生产 / 手动入库</span><h3>收取主城物资</h3></div><button class="world-button world-button-primary" data-world-action="harvest-all" ${!enabled() || !pending ? 'disabled' : ''}>一键收取</button></div><div class="world-production-grid">${['farm', 'lumbermill', 'quarry', 'ironworks'].map(key => {
      const building = BUILDINGS[key], item = production[key], resource = item?.resource || rule().production?.[key]?.resource, material = MATERIALS[resource], built = buildingLevel(home, key) > 0;
      const stored = numeric(item?.stored);
      return `<article class="world-production-item"><div><strong>${buildingArt(key)} ${building.name}</strong><small>${built ? `${material?.name || '物资'} · 每分钟 ${number(item?.ratePerMinute)} / 暂存 ${number(item?.capacity)}` : stored ? '旧家园结余 · 可以收取' : '尚未建造'}</small></div><b>${built || stored ? `${number(stored)} ${material?.name || '物资'}` : '—'}</b><small>${built && item?.nextTickAt ? `下一批 ${countdown(item.nextTickAt, '待同步')}` : built ? '按服务器时间生产' : '建设后开始生产'}</small><button class="world-button world-button-small" data-world-action="harvest" data-building="${key}" ${!enabled() || !stored ? 'disabled' : ''}>收取${material?.name || '物资'}</button></article>`;
    }).join('')}</div><p class="world-muted">生产物资先暂存在对应建筑，收取后才进入世界仓库。仓库装不下的部分会留在建筑中；每种仓库物资上限 ${number(self()?.capacity)}。</p></section>`;
  }

  function homeView() {
    const me = self();
    if (!me) return signInEmpty('连接世界后，回到自己的主城');
    if (!me.home) return `<section class="world-card world-simple-empty"><span class="world-empty-art" aria-hidden="true">${buildingArt('keep')}</span><h3>你的家园，从一块空地开始</h3><p>前往世界地图，选中空地并确认建家。初始物资及通关物资可以用来建设。</p><button class="world-button world-button-primary" data-world-action="tab" data-tab="map">选择建家地块</button></section>`;
    const home = me.home, maxLevel = numeric(rule().buildMaxLevel) || 5;
    return `<section class="world-card world-home-banner"><div class="world-home-illustration" aria-hidden="true">${buildingArt('keep')}</div><div><span class="world-card-kicker">${escapeHtml(me.name)}的领地 / 坐标 ${home.x + 1}, ${home.y + 1}</span><h3>Lv. ${number(home.level || buildingLevel(home, 'keep'))} 果园主城</h3><p>${remaining(home.protectedUntil) ? `🛡 新城保护剩余 ${countdown(home.protectedUntil)}` : '新城保护已结束，可守家或率军出征。'}</p><p class="world-muted">建设生产建筑，收取物资，训练士兵并编成自己的小队。</p></div><div class="world-inline-actions"><button class="world-button" data-world-action="locate-home">在地图中查看</button><button class="world-button world-button-primary" data-world-action="tab" data-tab="army">打造我的小队</button></div></section>${cityScene(home)}${productionView(home)}<div class="world-section-heading"><h3>主城建设</h3><small class="world-muted">点击上方建筑可定位建设卡片</small></div><div class="world-buildings">${Object.entries(BUILDINGS).map(([key, building]) => {
      const level = buildingLevel(home, key), cost = rule().costs?.buildings?.[key]?.[level + 1], maxed = level >= maxLevel;
      const keepRequired = key !== 'keep' && level + 1 > buildingLevel(home, 'keep');
      return `<section id="worldBuilding-${key}" class="world-card world-building-card"><div class="world-building-heading">${buildingArt(key)}<div><h3>${building.name}</h3><small>${level ? `Lv. ${number(level)} / ${maxLevel}` : '尚未建造'}</small></div></div><p>${building.detail}</p><div class="world-level-track" aria-label="${building.name}等级 ${level}">${Array.from({ length: maxLevel }, (_, i) => `<i class="${i < level ? 'world-filled' : ''}"></i>`).join('')}</div><div class="world-card-bottom"><small>${maxed ? '已达到最高等级' : cost ? costText(cost) : '建筑费用由服务器校验'}</small><button class="world-button ${maxed ? '' : 'world-button-primary'}" data-world-action="build" data-building="${key}" ${maxed || keepRequired || !enabled() || (cost && !affordable(cost)) ? 'disabled' : ''}>${maxed ? '建设完成' : keepRequired ? '先升级主城' : level ? '升级建筑' : '建造建筑'}</button></div></section>`;
    }).join('')}</div><section class="world-card world-field-notes"><h4>世界物资从哪里来？</h4><p>游戏账号连接世界后，正式关卡通关物资会存入世界仓库。主城生产建筑也会积攒物资，回城点击收取即可入库。训练与无尽模式不发世界物资。</p><p class="world-muted">当前可领取至第 ${number(me.unlockedStage || 1)} 关；每次远征按服务器签发的票据结算。</p></section>`;
  }

  function armyView() {
    const me = self();
    if (!me) return signInEmpty('连接世界，招募你的守护军');
    if (!me.home) return `<section class="world-card world-simple-empty"><span class="world-empty-art">⚔</span><h3>先有家园，才有军营</h3><p>在地图上建家后，就能修建兵营，训练三种士兵。</p><button class="world-button world-button-primary" data-world-action="tab" data-tab="map">前往建家</button></section>`;
    const total = Object.values(me.troops || {}).reduce((sum, value) => sum + numeric(value), 0);
    return `${squadsView()}<div class="world-section-heading world-army-heading"><div><span class="world-card-kicker">兵营 Lv. ${number(buildingLevel(me.home, 'barracks'))}</span><h3>守护军 · ${number(total)} 人</h3></div><span class="world-counter">训练队列 ${number(me.queues?.length)} / ${number(rule().maxQueues || 3)}</span></div><div class="world-training-grid">${Object.entries(UNITS).map(([key, unit]) => {
      const training = rule().training?.[key] || {}, available = buildingLevel(me.home, 'barracks') > 0;
      return `<section class="world-card world-unit-card"><div class="world-unit-heading"><span aria-hidden="true">${unit.icon}</span><div><h3>${unit.name}</h3><strong>${number(me.troops?.[key])} <small>已集结</small></strong></div></div><p class="world-muted">每人战力 ${number(training.power)} · 训练 ${number(training.seconds)} 秒</p><small>每人：${costText(training.cost)}</small><label class="world-train-control">训练人数<input id="worldTrain-${key}" data-world-preserve type="number" min="1" max="${numeric(rule().maxTrainCount) || 100}" value="10" inputmode="numeric"></label><button class="world-button world-button-primary" data-world-action="train" data-unit="${key}" ${!enabled() || !available || (me.queues?.length || 0) >= numeric(rule().maxQueues || 3) ? 'disabled' : ''}>${available ? '加入训练队列' : '先建造兵营'}</button></section>`;
    }).join('')}</div><section class="world-card"><div class="world-section-heading"><h3>训练队列</h3><small class="world-muted">计时结束后，刷新即自动入伍</small></div>${(me.queues || []).length ? `<div class="world-queue-list">${me.queues.map(queue => `<div class="world-queue"><span>${UNITS[queue.unit]?.icon || '⚔'} ${UNITS[queue.unit]?.name || '士兵'} × ${number(queue.count)}</span><b>${countdown(queue.readyAt, '待入伍 · 点击刷新')}</b></div>`).join('')}</div>` : '<p class="world-muted">暂无训练中的士兵。</p>'}</section>${attackPanel()}${reportsPanel()}`;
  }

  function squadsView() {
    const me = self(), squads = me.squads || [], max = numeric(rule().maxSquads) || 3;
    const editing = squads.find(squad => squad.id === editingSquadId);
    const available = Object.fromEntries(Object.keys(UNITS).map(key => [key, Math.max(0, numeric(me.troops?.[key]) - squads.filter(squad => squad.id !== editingSquadId).reduce((sum, squad) => sum + numeric(squad.units?.[key]), 0))]));
    const canCreate = !!editing || squads.length < max, totalFree = Object.values(available).reduce((sum, value) => sum + value, 0);
    return `<section class="world-card world-squads"><div class="world-section-heading"><div><span class="world-card-kicker">选择兵种 / 编队出征</span><h3>我的小队 · ${number(squads.length)} / ${max}</h3></div><button class="world-button world-button-small" data-world-action="squad-new" ${!enabled() || squads.length >= max ? 'disabled' : ''}>＋ 新建小队</button></div><div class="world-squad-list">${squads.length ? squads.map(squad => `<article class="world-squad-row"><span class="world-squad-flag" aria-hidden="true">⚑</span><div><strong>${escapeHtml(squad.name)}</strong><small>${Object.entries(UNITS).map(([key, unit]) => `${unit.name} ${number(squad.units?.[key])}`).join(' · ')}</small></div><div class="world-inline-actions"><button class="world-button world-button-small" data-world-action="squad-edit" data-squad-id="${escapeHtml(squad.id)}">调整</button><button class="world-button world-button-small" data-world-action="squad-delete" data-squad-id="${escapeHtml(squad.id)}">解散</button></div></article>`).join('') : '<p class="world-muted">还没有小队。下方训练士兵后，选择人数组成自己的远征队。</p>'}</div><form id="worldSquadForm" class="world-squad-editor"><div class="world-section-heading"><h4>${editing ? `调整「${escapeHtml(editing.name)}」` : '编成新小队'}</h4><small class="world-muted">${totalFree ? '编队不消耗士兵' : '先训练士兵，再编成小队'}</small></div><label>小队名字<input id="worldSquadName" data-world-preserve type="text" required minlength="1" maxlength="12" autocomplete="off" placeholder="给自己的小队起个名字" value="${escapeHtml(editing?.name || '')}"></label><div class="world-squad-units">${Object.entries(UNITS).map(([key, unit]) => `<label>${unit.icon} ${unit.name}<input id="worldSquad-${key}" data-world-preserve type="number" min="0" max="${available[key]}" step="1" value="${numeric(editing?.units?.[key])}" inputmode="numeric"><small>可分配 ${number(available[key])} 人</small></label>`).join('')}</div><div class="world-inline-actions"><button class="world-button world-button-primary" type="submit" ${!enabled() || !canCreate || !totalFree ? 'disabled' : ''}>${editing ? '保存小队调整' : '保存我的小队'}</button>${editing ? '<button class="world-button" type="button" data-world-action="squad-new">取消调整</button>' : ''}</div><p class="world-muted">最多保存 ${max} 个小队；同一个士兵只分配给一个小队。解散仅取消编队，士兵仍留在军营。出征战损会同步更新编队人数。</p></form></section>`;
  }

  function attackPanel() {
    const me = self(), target = selectedTarget && playerById(selectedTarget);
    const cell = selectedTarget && (worldState?.map?.cells || []).find(item => item.ownerId === selectedTarget);
    if (!target || !cell) return `<section class="world-card world-field-notes"><h3>向其他家园出征</h3><p>在世界地图选择其他玩家的家园，再查看目标并确认出征。战斗由服务器结算，双方损失和掠夺物资都会保存。</p><button class="world-button" data-world-action="tab" data-tab="map">在地图选择目标</button></section>`;
    const protectedTarget = remaining(cell.protectedUntil), protectedSelf = remaining(me.home?.protectedUntil), cooldown = remaining(me.attackReadyAt);
    const squads = me.squads || [], chosenSquad = squads.find(squad => squad.id === attackSquadId);
    if (attackSquadId && !chosenSquad) attackSquadId = '';
    const units = chosenSquad?.units || me.troops || {};
    const army = Object.values(units).reduce((sum, count) => sum + numeric(count), 0);
    const ally = me.guildId && me.guildId === cell.guildId;
    const cannotAttack = !enabled() || protectedTarget || cooldown || !army || ally;
    return `<section class="world-card world-attack-panel"><span class="world-card-kicker">已侦察目标 / 坐标 ${cell.x + 1}, ${cell.y + 1}</span><h3>出征目标：${escapeHtml(target.name || cell.ownerName)}</h3><label class="world-attack-select">出征队伍<select id="worldAttackSquad"><option value="">全部已集结士兵</option>${squads.map(squad => `<option value="${escapeHtml(squad.id)}" ${chosenSquad?.id === squad.id ? 'selected' : ''}>${escapeHtml(squad.name)} · ${number(Object.values(squad.units || {}).reduce((sum, count) => sum + numeric(count), 0))} 人</option>`).join('')}</select></label><div class="world-facts"><span>目标城池<b>Lv. ${number(cell.level)}</b></span><span>目标军队<b>${target.army === undefined ? '未公开' : `${number(target.army)} 人`}</b></span><span>我的出征军<b>${number(army)} 人 · ${escapeHtml(chosenSquad?.name || '全军')}</b></span></div><p class="world-attack-warning">确认后${chosenSquad ? '仅所选小队' : '全部已集结士兵'}出征。双方可能损失士兵，胜方掠夺部分物资；家园不会被删除。无法撤销已经结算的战斗。</p>${protectedTarget ? `<p class="world-protection">目标正在保护：${countdown(cell.protectedUntil)}</p>` : ''}${protectedSelf ? `<p class="world-attack-warning">你的新城保护还剩 ${countdown(me.home.protectedUntil)}。主动出征将立即结束自己的保护。</p>` : ''}${cooldown ? `<p class="world-muted">出征休整剩余 ${countdown(me.attackReadyAt)}</p>` : ''}${ally ? '<p class="world-muted">同公会成员不能互相攻打。</p>' : ''}${!army ? '<p class="world-muted">所选队伍没有可出征士兵，需要先训练或调整小队。</p>' : ''}<div class="world-inline-actions"><button class="world-button world-button-danger" data-world-action="attack" data-target-id="${escapeHtml(cell.ownerId)}" ${cannotAttack ? 'disabled' : ''}>${protectedSelf ? '结束保护并' : '确认'}${chosenSquad ? '小队' : '全军'}出征</button><button class="world-button" data-world-action="cancel-target">取消目标</button></div></section>`;
  }

  function reportsPanel() {
    const reports = worldState?.reports || [], me = self();
    return `<section class="world-card"><div class="world-section-heading"><h3>我的战报</h3><span class="world-counter">最近 ${number(reports.length)} 场</span></div>${reports.length ? `<div class="world-report-list">${reports.slice(0, 30).map(report => {
      const attacking = report.attackerId === me?.id, victory = attacking ? report.won : !report.won;
      const losses = attacking ? report.losses : report.defenderLosses;
      return `<article class="world-report"><div class="world-report-heading"><strong class="${victory ? 'world-report-win' : 'world-report-loss'}">${attacking ? '出征' : '守城'} · ${victory ? '获胜' : '失利'}</strong><time>${escapeHtml(new Date(numeric(report.at)).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</time></div><p>${escapeHtml(report.attackerName)} → ${escapeHtml(report.defenderName)}</p><small>${attacking ? report.won ? '获得物资' : '对方防守成功' : report.won ? '损失物资' : '守住了家园'}${report.won ? `：${costText(report.loot)}` : ''}</small><small>军队损失：${Object.entries(UNITS).map(([key, unit]) => `${unit.name} ${number(losses?.[key])}`).join(' · ')}</small>${report.detail ? `<details><summary>战斗详情</summary><p>${escapeHtml(typeof report.detail === 'string' ? report.detail : JSON.stringify(report.detail))}</p></details>` : ''}</article>`;
    }).join('')}</div>` : '<p class="world-muted">还没有战报。出征或受到其他玩家攻击后，会在这里留下记录。</p>'}</section>`;
  }

  function guildView() {
    const me = self();
    if (!me) return signInEmpty('连接世界，与其他守护者结盟');
    const mine = guildById(me.guildId), guilds = worldState?.guilds || [];
    return `${mine ? `<section class="world-card world-guild-banner" style="--world-guild-color:${guildColor(mine.id)}"><span class="world-guild-flag" aria-hidden="true">⚑</span><div><span class="world-card-kicker">我的公会 / Lv. ${number(mine.level)}</span><h3>${escapeHtml(mine.name)}</h3><p>会长：${escapeHtml(playerById(mine.ownerId)?.name || '守护者')} · 成员 ${number(mine.members?.length)} 人 · 累计贡献 ${number(mine.donations)}</p></div><button class="world-button" data-world-action="guild-leave">退出公会</button></section><div class="world-guild-layout"><section class="world-card"><h3>公会成员</h3><div class="world-member-list">${(mine.members || []).map(id => {
      const player = playerById(id);
      return `<div class="world-member"><span>${id === mine.ownerId ? '♛' : '🌿'} ${escapeHtml(player?.name || '守护者')}${id === me.id ? '（你）' : ''}</span><small>${player?.home ? `城池 Lv. ${number(player.home.level)}` : '尚未建家'}</small></div>`;
    }).join('')}</div></section><section class="world-card"><h3>一起建设公会</h3><p class="world-muted">捐献世界物资增加公会贡献。成员家园在地图上显示同一面公会旗色，同公会不能互相攻击。</p><label>捐献物资<select id="worldDonateResource" data-world-preserve>${Object.entries(MATERIALS).filter(([key]) => key !== 'token').map(([key, item]) => `<option value="${key}">${item.icon} ${item.name}</option>`).join('')}</select></label><label>捐献数量<input id="worldDonateAmount" data-world-preserve type="number" min="${numeric(rule().costs?.guildDonate?.min) || 10}" max="${numeric(rule().costs?.guildDonate?.max) || 1000}" value="50" inputmode="numeric"></label><button class="world-button world-button-primary" data-world-action="guild-donate" ${enabled() ? '' : 'disabled'}>确认捐献</button></section></div>` : `<section class="world-card world-guild-create"><div><span class="world-card-kicker">以果园为家，以同伴为盟</span><h3>创建你的公会</h3><p>号召其他守护者加入，一起建设公会。</p><small>创建所需：${costText(rule().costs?.guildCreate)}</small></div><form id="worldGuildCreateForm"><label>公会名字<input id="worldGuildName" data-world-preserve required maxlength="7" placeholder="1–7 字：中文、字母、数字或下划线" autocomplete="off"></label><button class="world-button world-button-primary" type="submit" ${!enabled() || !affordable(rule().costs?.guildCreate) ? 'disabled' : ''}>创建公会</button></form></section>`}<section class="world-card"><div class="world-section-heading"><h3>世界中的公会</h3><span class="world-counter">${number(guilds.length)} 个公会</span></div>${guilds.length ? `<div class="world-guild-list">${guilds.map(guild => `<article class="world-guild-row"><span class="world-small-flag" style="color:${guildColor(guild.id)}">⚑</span><div><strong>${escapeHtml(guild.name)}</strong><small>Lv. ${number(guild.level)} · ${number(guild.members?.length)} 人 · 贡献 ${number(guild.donations)}</small></div><button class="world-button world-button-small" data-world-action="guild-join" data-guild-id="${escapeHtml(guild.id)}" ${!enabled() || me.guildId ? 'disabled' : ''}>${guild.id === me.guildId ? '已加入' : '加入公会'}</button></article>`).join('')}</div>` : '<p class="world-muted">世界还没有公会。你可以创建第一个，邀请朋友加入。</p>'}</section>`;
  }

  function render({ resetForms = false } = {}) {
    if (!host) return;
    const values = resetForms ? {} : saveForm(), scroll = host.querySelector('.world-body')?.scrollTop || 0;
    const views = { map: mapView, home: homeView, army: armyView, guild: guildView };
    host.innerHTML = `<div class="world-dialog" aria-busy="${busy || connecting}">${header()}${resourceBar()}${notice()}<main class="world-body">${featureGuide}${authCard()}${(views[activeTab] || mapView)()}</main><footer class="world-footer"><nav class="world-nav" aria-label="世界页面">${TABS.map(([key, icon, name]) => `<button class="world-nav-button ${activeTab === key ? 'world-is-active' : ''}" data-world-action="tab" data-tab="${key}" aria-current="${activeTab === key ? 'page' : 'false'}"><span aria-hidden="true">${icon}</span>${name}</button>`).join('')}<button class="world-nav-button world-exit" data-world-action="exit">↩ 返回关卡</button></nav><small>${busy ? '服务器正在处理，请稍候…' : '家园与军队存于服务器 · 自动同步每 15 秒 · 战斗结果由服务器结算'}</small></footer></div>`;
    restoreForm(values);
    const body = host.querySelector('.world-body');
    if (body) body.scrollTop = scroll;
    if (busy) host.querySelectorAll('button, input, select').forEach(element => { if (!['exit', 'guide-done'].includes(element.dataset.worldAction)) element.disabled = true; });
  }

  async function mutate(payload, successText) {
    if (busy || !connected || !self()) return;
    const forName = expectedName, token = generation;
    busy = true; message = null; render(); let resetForms = false;
    const requestBody = { ...payload, accountName: forName, requestId: payload.requestId || uid() };
    try {
      const result = await request('action', requestBody);
      if (token !== generation) return;
      adoptState(result.state, forName); retryRequest = null;
      message = { text: typeof successText === 'function' ? successText(result) : successText || '世界已同步。', kind: 'success' };
      if (payload.type === 'settle') { activeTab = 'home'; selectedTile = { x: payload.x, y: payload.y }; }
      if (payload.type === 'attack') selectedTarget = null;
      if (['squad-save', 'squad-delete'].includes(payload.type)) { editingSquadId = null; resetForms = true; }
    } catch (error) {
      if (token !== generation) return;
      if (['UNAUTHORIZED', 'AUTH_REQUIRED', 'login_required', 'account_mismatch'].includes(error.code)) authenticatedName = '';
      message = { text: error.message, kind: 'error' };
      retryRequest = error.retryable ? { payload: requestBody, successText, name: forName } : null;
    } finally { if (token === generation) { busy = false; render({ resetForms }); } }
  }

  async function linkLegacy(form) {
    if (busy || !connected || !expectedName || !gameCredential || !linkRequired) return;
    const worldPassword = form.querySelector('#worldLegacyPassword')?.value || '';
    const credential = gameCredential;
    const forName = expectedName, token = generation;
    busy = true; message = null; render();
    try {
      const result = await request('link', { name: forName, password: credential.password, worldPassword });
      if (token !== generation || credential !== gameCredential) return;
      adoptState(result.state, forName); linkRequired = false;
      message = { text: '旧家园已连接，建筑、军队和物资全部保留。以后登录游戏即可进入世界。', kind: 'success' };
      if (authenticatedCallback) Promise.resolve().then(() => authenticatedCallback?.()).catch(() => {});
    } catch (error) { if (token === generation) message = { text: error.message, kind: 'error' }; }
    finally { if (token === generation) { busy = false; render(); } }
  }

  async function leaveGame() {
    close(); setPlayerName(''); gameCredential = null; linkRequired = false; worldState = null; authenticatedName = ''; accountGeneration++; entering = null;
    const operation = Promise.resolve(leaving).catch(() => {}).then(() => request('logout', {}));
    leaving = operation;
    try { await operation; } finally { if (leaving === operation) leaving = null; }
  }

  function onClick(event) {
    const button = event.target.closest('[data-world-action]');
    if (!button || !host?.contains(button) || button.disabled) return;
    const action = button.dataset.worldAction;
    if (action === 'guide-done') { guideCallback?.(); return; }
    if (action === 'exit') { const callback = exitCallback; close(); callback?.(); return; }
    if (busy) return;
    if (action === 'tab') {
      activeTab = button.dataset.tab; message = message?.kind === 'connection' ? message : null;
      render(); host.querySelector('.world-body')?.scrollTo?.(0, 0); return;
    }
    if (action === 'refresh') { refresh(); return; }
    if (action === 'tile') { selectedTile = { x: Number(button.dataset.x), y: Number(button.dataset.y) }; render(); return; }
    if (action === 'locate-home') { selectedTile = { x: self().home.x, y: self().home.y }; activeTab = 'map'; render(); return; }
    if (action === 'target') { selectedTarget = button.dataset.targetId; activeTab = 'army'; render(); host.querySelector('.world-attack-panel')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); return; }
    if (action === 'cancel-target') { selectedTarget = null; render(); return; }
    if (action === 'focus-building') { host.querySelector(`#worldBuilding-${button.dataset.building}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); return; }
    if (action === 'squad-new') { editingSquadId = null; render({ resetForms: true }); host.querySelector('#worldSquadForm')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); return; }
    if (action === 'squad-edit') { editingSquadId = button.dataset.squadId; render({ resetForms: true }); host.querySelector('#worldSquadForm')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); return; }
    if (action === 'retry') {
      const retry = retryRequest;
      if (retry && retry.name === expectedName) mutate(retry.payload, retry.successText);
      return;
    }
    if (!enabled()) return;
    if (action === 'settle') { mutate({ type: 'settle', x: selectedTile.x, y: selectedTile.y }, '家园建成！接下来建设农田、仓库、城墙和兵营。'); return; }
    if (action === 'build') { mutate({ type: 'build', building: button.dataset.building }, `${BUILDINGS[button.dataset.building].name}建设完成。`); return; }
    if (action === 'harvest' || action === 'harvest-all') { mutate({ type: action, ...(action === 'harvest' ? { building: button.dataset.building } : {}) }, result => Object.values(result.harvested || {}).some(value => numeric(value) > 0) ? `物资已入库：${costText(result.harvested)}。` : '本次没有物资入库；请检查生产进度和仓库剩余容量。暂存物资会保留。'); return; }
    if (action === 'squad-delete') { mutate({ type: 'squad-delete', squadId: button.dataset.squadId }, '已解散小队，士兵仍留在军营。'); return; }
    if (action === 'train') {
      const unit = button.dataset.unit, count = Number(host.querySelector(`#worldTrain-${unit}`).value);
      if (!Number.isInteger(count) || count < 1 || count > (numeric(rule().maxTrainCount) || 100)) { message = { text: `训练人数须为 1–${numeric(rule().maxTrainCount) || 100} 的整数。`, kind: 'error' }; render(); return; }
      mutate({ type: 'train', unit, count }, `${count} 名${UNITS[unit].name}已加入训练队列。`); return;
    }
    if (action === 'attack') { mutate({ type: 'attack', targetId: button.dataset.targetId, ...(attackSquadId ? { squadId: attackSquadId } : {}) }, '出征已结算，结果记录在下方战报中。'); return; }
    if (action === 'guild-join') { mutate({ type: 'guild-join', guildId: button.dataset.guildId }, '已加入公会，一起守护果园世界。'); return; }
    if (action === 'guild-leave') {
      const mine = guildById(self().guildId);
      if (mine?.ownerId === self().id && (mine.members?.length || 0) > 1) { message = { text: '退出后会长身份将由服务器转交其他成员。再次点击下方按钮确认退出。', kind: 'error' }; button.textContent = '确认退出公会'; button.dataset.worldAction = 'guild-leave-confirm'; const noticeEl = host.querySelector('.world-notice'); if (noticeEl) noticeEl.remove(); host.querySelector('.world-body').insertAdjacentHTML('beforebegin', notice()); return; }
      mutate({ type: 'guild-leave' }, '已退出公会。'); return;
    }
    if (action === 'guild-leave-confirm') { mutate({ type: 'guild-leave' }, '已退出公会。'); return; }
    if (action === 'guild-donate') {
      const amount = Number(host.querySelector('#worldDonateAmount').value), resource = host.querySelector('#worldDonateResource').value;
      const min = numeric(rule().costs?.guildDonate?.min) || 10, max = numeric(rule().costs?.guildDonate?.max) || 1000;
      if (!Number.isInteger(amount) || amount < min || amount > max) { message = { text: `每次捐献数量须为 ${min}–${max} 的整数。`, kind: 'error' }; render(); return; }
      mutate({ type: 'guild-donate', resource, amount }, `已捐献 ${amount} ${MATERIALS[resource].name}。`);
    }
  }

  function onSubmit(event) {
    if (!host?.contains(event.target)) return;
    event.preventDefault();
    if (event.target.id === 'worldLinkForm') { linkLegacy(event.target); return; }
    if (event.target.id === 'worldSquadForm') {
      const form = event.target, name = String(form.querySelector('#worldSquadName').value || '').trim();
      const units = Object.fromEntries(Object.keys(UNITS).map(key => [key, Number(form.querySelector(`#worldSquad-${key}`).value)]));
      if (!name || Array.from(name).length > 12 || Object.values(units).some(count => !Number.isInteger(count) || count < 0) || !Object.values(units).some(count => count > 0)) {
        message = { text: '填写 1–12 字的小队名字，兵种人数须为非负整数，并至少编入一名士兵。', kind: 'error' }; render(); return;
      }
      mutate({ type: 'squad-save', name, units, ...(editingSquadId ? { squadId: editingSquadId } : {}) }, `小队「${name}」已保存，可在出征时选择。`); return;
    }
    if (event.target.id === 'worldGuildCreateForm') {
      const name = String(event.target.querySelector('#worldGuildName').value || '').trim();
      if (!name) { message = { text: '先给公会取一个名字。', kind: 'error' }; render(); return; }
      mutate({ type: 'guild-create', name }, `公会「${name}」已创建。`);
    }
  }

  function updateCountdowns() {
    if (!host) return;
    host.querySelectorAll('[data-world-until]').forEach(element => { const seconds = remaining(element.dataset.worldUntil); element.textContent = seconds ? duration(seconds) : element.dataset.worldEnd; });
  }

  function onChange(event) {
    if (event.target.id === 'worldAttackSquad') { attackSquadId = event.target.value; render(); }
  }

  function open({ overlay, name, onExit, onAuthenticated, guideHTML = '', onGuideDone, initialTab = 'map' } = {}) {
    close();
    if (!overlay) throw new Error('果园世界需要提供 overlay 容器。');
    setPlayerName(name);
    host = overlay; exitCallback = onExit; authenticatedCallback = onAuthenticated; activeTab = TABS.some(([key]) => key === initialTab) ? initialTab : 'map'; busy = false;
    featureGuide = typeof onGuideDone === 'function' ? guideHTML : ''; guideCallback = onGuideDone;
    host.classList.remove('hidden', 'upgrade-overlay', 'relic-map-overlay', 'lobby-overlay', 'help-overlay');
    host.classList.add('frontier-overlay');
    host.setAttribute('role', 'dialog'); host.setAttribute('aria-modal', 'true'); host.setAttribute('aria-label', '果园世界');
    document.getElementById('arena')?.classList.add('is-lobby');
    host.addEventListener('click', onClick); host.addEventListener('submit', onSubmit); host.addEventListener('change', onChange);
    render(); refresh();
    refreshTimer = setInterval(() => { if (!document.hidden) refresh({ quiet: true }); }, 15000);
    countdownTimer = setInterval(updateCountdowns, 1000);
  }

  function close() {
    generation++;
    clearInterval(refreshTimer); clearInterval(countdownTimer);
    refreshTimer = countdownTimer = null;
    if (host) {
      host.removeEventListener('click', onClick); host.removeEventListener('submit', onSubmit); host.removeEventListener('change', onChange);
      host.classList.remove('frontier-overlay');
    }
    host = null; exitCallback = authenticatedCallback = null; busy = false; connecting = false; refreshing = null;
    featureGuide = ''; guideCallback = null;
  }

  globalThis.addEventListener?.('orchard-player-data-reset', () => {
    close(); setPlayerName(''); connected = false; worldState = null; gameCredential = null;
  });
  window.ORCHARD_FRONTIER = Object.freeze({ open, close, enterGame, leaveGame, prepareSession, setPlayerName, isAuthenticated, hasGameLogin, beginCampaign, completeCampaign, claimCampaign, getLeaderboard });
})();
