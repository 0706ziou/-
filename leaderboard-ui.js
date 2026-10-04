/* Campaign rankings show server records; browser saves never invent online results. */
(() => {
  'use strict';
  const PAGE_SIZE = 20;
  let host = null, expectedName = '', exitCallback = null, localHighest = 0;
  let data = null, loading = false, errorText = '', requestedPage = 1;
  let generation = 0, requestSequence = 0;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const integer = (value, fallback = 0) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
  const count = value => integer(value).toLocaleString('zh-CN');
  const stage = value => Math.min(100, integer(value));
  const row = value => value && typeof value === 'object' ? {
    rank: integer(value.rank), playerId: String(value.playerId ?? ''), name: String(value.name ?? '守护者'),
    highestStage: stage(value.highestStage), isSelf: value.isSelf === true
  } : null;

  function normalize(response) {
    if (!response || !Array.isArray(response.entries)) throw new Error('Invalid leaderboard response');
    const own = row(response.self);
    const totalPlayers = integer(response.totalPlayers);
    const totalPages = Math.max(1, integer(response.totalPages, Math.ceil(totalPlayers / PAGE_SIZE) || 1));
    return {
      entries: response.entries.slice(0, PAGE_SIZE).map(row).filter(Boolean), self: own,
      totalPlayers, totalPages, page: Math.max(1, Math.min(totalPages, integer(response.page, requestedPage) || 1))
    };
  }

  const rankLabel = item => item && item.highestStage > 0 && item.rank > 0 ? `第 ${count(item.rank)} 名` : '暂无排名';
  const stageLabel = value => value > 0 ? `第 ${count(value)} 关` : '尚未通关';
  const medal = item => item.highestStage > 0 && item.rank > 0 && item.rank <= 3 ? ['🥇', '🥈', '🥉'][item.rank - 1] : '';

  function summaryHTML() {
    const own = data?.self;
    return `<section class="leaderboard-summary" aria-label="我的通关排名">
      <div class="leaderboard-self"><div class="leaderboard-self-heading"><span class="leaderboard-self-avatar" aria-hidden="true">🍊</span><div><small>我的远征</small><strong>${escapeHtml(own?.name || expectedName || '守护者')}</strong></div></div>
      <div class="leaderboard-self-stats"><div><small>通关排名</small><strong>${data ? rankLabel(own) : '—'}</strong></div><div><small>最高通关</small><strong>${data ? stageLabel(own?.highestStage || 0) : '—'}</strong></div></div></div>
      <div class="leaderboard-total"><span aria-hidden="true">♧</span><strong>${data ? count(data.totalPlayers) : '—'}<small>位守护者上榜</small></strong><p>挑战更高关卡<br>让果园看见你的勇气</p></div>
    </section>`;
  }

  function warningHTML() {
    if (!data || localHighest <= (data.self?.highestStage || 0)) return '';
    return `<p class="leaderboard-sync-note" role="note"><span aria-hidden="true">↥</span> 本机已通关第 ${count(localHighest)} 关，线上成绩尚未同步。联网完成关卡并同步成绩后，排名才会更新。</p>`;
  }

  function entryHTML(item) {
    const own = item.isSelf || !!(data.self?.playerId && item.playerId === data.self.playerId);
    const prize = medal(item);
    return `<li class="leaderboard-row${own ? ' is-self' : ''}${prize ? ` podium-${item.rank}` : ''}" aria-label="${escapeHtml(`${rankLabel(item)}，${item.name}，最高通关${stageLabel(item.highestStage)}${own ? '，我' : ''}`)}">
      <span class="leaderboard-rank">${prize ? `<span class="leaderboard-medal" aria-hidden="true">${prize}</span><span class="leaderboard-rank-number">${count(item.rank)}</span>` : count(item.rank)}</span>
      <span class="leaderboard-player"><strong>${escapeHtml(item.name)}</strong>${own ? '<small class="leaderboard-me">我</small>' : ''}</span>
      <span class="leaderboard-stage"><strong>${count(item.highestStage)}</strong><small>关</small></span>
    </li>`;
  }

  function listHTML() {
    if (!data && loading) return '<div class="leaderboard-placeholder" role="status"><span class="leaderboard-loading-mark" aria-hidden="true">♧</span><strong>正在寻找果园勇士…</strong><p>通关越高，排名越靠前</p></div>';
    if (!data && errorText) return '<div class="leaderboard-placeholder"><span aria-hidden="true">☁</span><strong>暂时连接不上排行榜</strong><p>检查网络后，再试一次。</p><button class="secondary" type="button" data-board-action="retry">重新连接</button></div>';
    if (!data || !data.entries.length) return '<div class="leaderboard-placeholder"><span aria-hidden="true">🌱</span><strong>第一位果园勇士，会是你吗？</strong><p>完成关卡并同步成绩，即可加入排行榜。</p></div>';
    return `<ol class="leaderboard-rows">${data.entries.map(entryHTML).join('')}</ol>`;
  }

  function render() {
    if (!host) return;
    const oldAction = host.contains?.(document.activeElement) ? document.activeElement?.dataset?.boardAction : null;
    const page = data?.page || requestedPage;
    host.setAttribute('aria-busy', String(loading));
    host.innerHTML = `<div class="dialog menu-dialog leaderboard-dialog">
      <header class="leaderboard-heading"><div><span class="tag">ORCHARD RANKINGS</span><h2 class="menu-title"><span aria-hidden="true">🏆</span> 通关排行榜</h2></div><button class="secondary leaderboard-refresh" type="button" data-board-action="refresh"${loading ? ' disabled' : ''}><span aria-hidden="true">↻</span> ${loading ? '刷新中' : '刷新'}</button></header>
      ${summaryHTML()}
      <p class="leaderboard-rule">按最高通关关卡排名 · 同关卡并列</p>
      ${warningHTML()}
      <div class="leaderboard-feedback${errorText ? ' has-error' : ''}" role="status" aria-live="polite">${errorText ? `${escapeHtml(errorText)} <button type="button" data-board-action="retry"${loading ? ' disabled' : ''}>重试</button>` : loading && data ? '正在更新排行榜…' : ''}</div>
      <section class="leaderboard-list" aria-label="通关玩家列表"><div class="leaderboard-columns" aria-hidden="true"><span>排名</span><span>守护者</span><span>通关关卡</span></div><div class="leaderboard-scroll" tabindex="0">${listHTML()}</div></section>
      <footer class="leaderboard-footer"><div class="leaderboard-pagination" aria-label="排行榜分页"><button class="secondary" type="button" data-board-action="previous"${loading || !data || page <= 1 ? ' disabled' : ''} aria-label="上一页排行榜">‹</button><span>${count(page)} / ${count(data?.totalPages || 1)} <small>页</small></span><button class="secondary" type="button" data-board-action="next"${loading || !data || page >= data.totalPages ? ' disabled' : ''} aria-label="下一页排行榜">›</button></div><button class="primary leaderboard-exit" type="button" data-board-action="exit">返回关卡</button></footer>
    </div>`;
    if (oldAction) host.querySelector(`[data-board-action="${oldAction}"]`)?.focus();
  }

  async function load(page = requestedPage) {
    if (!host) return;
    const owner = host, token = generation, request = ++requestSequence, name = expectedName;
    requestedPage = Math.max(1, integer(page, 1)); loading = true; errorText = ''; render();
    try {
      if (typeof window.ORCHARD_FRONTIER?.getLeaderboard !== 'function') throw new Error('Leaderboard unavailable');
      const response = await window.ORCHARD_FRONTIER.getLeaderboard(requestedPage, name);
      if (host !== owner || generation !== token || requestSequence !== request || expectedName !== name) return;
      data = normalize(response); requestedPage = data.page;
    } catch (_error) {
      if (host !== owner || generation !== token || requestSequence !== request || expectedName !== name) return;
      errorText = '排行榜暂时无法连接，请稍后重试。';
    } finally {
      if (host === owner && generation === token && requestSequence === request && expectedName === name) { loading = false; render(); }
    }
  }

  function exit() {
    const callback = exitCallback;
    close();
    callback?.();
  }

  function onClick(event) {
    const button = event.target?.closest?.('[data-board-action]');
    if (!button || !host?.contains(button) || button.disabled) return;
    switch (button.dataset.boardAction) {
      case 'exit': exit(); break;
      case 'retry': case 'refresh': load(requestedPage); break;
      case 'previous': load((data?.page || 1) - 1); break;
      case 'next': load((data?.page || 1) + 1); break;
    }
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); exit(); }
  }

  function open({ overlay, name, onExit, localHighestStage = 0 } = {}) {
    close();
    if (!overlay) throw new Error('排行榜需要提供 overlay 容器。');
    host = overlay; expectedName = String(name ?? ''); exitCallback = typeof onExit === 'function' ? onExit : null;
    localHighest = stage(localHighestStage); requestedPage = 1; data = null; errorText = ''; loading = false;
    host.classList.remove('hidden', 'upgrade-overlay', 'relic-map-overlay', 'lobby-overlay', 'help-overlay', 'frontier-overlay', 'pause-overlay', 'armory-overlay');
    host.classList.add('leaderboard-overlay');
    host.setAttribute('role', 'dialog'); host.setAttribute('aria-modal', 'true'); host.setAttribute('aria-label', '通关排行榜');
    host.addEventListener('click', onClick); host.addEventListener('keydown', onKeyDown);
    document.getElementById('arena')?.classList.add('is-lobby');
    const pending = load();
    host.querySelector('[data-board-action="exit"]')?.focus();
    return pending;
  }

  function close() {
    generation++; requestSequence++;
    if (host) {
      host.removeEventListener('click', onClick); host.removeEventListener('keydown', onKeyDown);
      host.classList.remove('leaderboard-overlay'); host.removeAttribute?.('aria-busy');
    }
    host = null; expectedName = ''; exitCallback = null; data = null; loading = false; errorText = ''; localHighest = 0;
  }

  window.ORCHARD_LEADERBOARD = Object.freeze({ open, close });
})();
