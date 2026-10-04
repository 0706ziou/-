/*
 * 参数化饰品执行器。战斗暂停时不要调用 tick；本模块不读取 UI、不修改局外存档。
 * 默认跳过 legacy（主游戏保留旧 6 件执行）；context.includeLegacy=true 可完整运行旧技能。
 * targets 必须只返回已激活、存活且视线可达的敌人，hit 接管飘字/击杀结算。
 * projectile 回调接收 x/y/vx/vy/damage/color/life/size/pierce/source，世界碰撞由主游戏执行。
 */
(() => {
  'use strict';
  const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
  const val = (p, key, fallback = 0) => finite(p?.[key], fallback);
  const cooldown = (def, player) => Math.max(.5, finite(def.cooldown, 1) * Math.max(.5, Math.min(1, val(player, 'relicCooldown', 1))));
  const targets = (ctx, x, y, radius) => (ctx.targets?.(x, y, radius) || []).filter(enemy => val(enemy, 'hp') > 0);
  function applyPickup(player, def) {
    if (!player || !def?.id) return false;
    player.relicApplied ??= {}; player.skillTimers ??= {};
    if (player.relicApplied[def.id]) return false;
    player.relicApplied[def.id] = true;
    player.skillTimers[def.key] = def.family === 'ward' ? cooldown(def, player) : 0;
    if (def.family === 'ward') player.shield = Math.min(1, val(player, 'shield') + 1);
    if (def.family !== 'stats') return true;
    const b = def.bonus || {}, base = player.baseStats || player;
    player.relicBonuses ??= {};
    const before = {};
    for (const key of Object.keys(b)) if (key !== 'heal') before[key] = val(player, key, key === 'xpMult' ? 1 : 0);
    for (const key of ['damage', 'rate', 'speed']) if (finite(b[key])) player[key] = val(player, key) + val(base, key) * b[key];
    for (const key of ['pickup', 'xpMult', 'defense', 'regen']) if (finite(b[key])) player[key] = val(player, key, key === 'xpMult' ? 1 : 0) + b[key];
    if (finite(b.maxHp)) player.maxHp = val(player, 'maxHp') + b.maxHp;
    if (finite(b.heal)) player.hp = Math.min(val(player, 'maxHp'), val(player, 'hp') + b.heal);
    const endless = player.build?.mode === 'endless';
    // A pickup must not clamp down stronger growth carried into endless mode.
    if (finite(b.critChance)) player.critChance = Math.max(val(player, 'critChance'), Math.min(endless ? .7 : .45, val(player, 'critChance') + b.critChance));
    if (finite(b.pierce)) player.pierce = Math.max(val(player, 'pierce'), Math.min(endless ? 8.6 : 4.6, val(player, 'pierce') + b.pierce));
    if (finite(b.regen)) player.regenDelay = Math.max(6, val(player, 'regenDelay', 6));
    for (const key of Object.keys(before)) player.relicBonuses[key] = finite(player.relicBonuses[key]) + val(player, key) - before[key];
    return true;
  }
  function consumeShield(player, ownedDefs = []) {
    if (!player) return;
    player.shield = 0; player.skillTimers ??= {};
    // All ward sources share one charge and start replenishing on its consumption.
    for (const def of ownedDefs) if (def.family === 'ward') player.skillTimers[def.key] = cooldown(def, player);
  }
  function heal(ctx, player, amount) {
    const wanted = Math.max(0, Math.min(Math.max(0, val(player, 'maxHp') - val(player, 'hp')), finite(amount)));
    if (!wanted) return 0;
    if (ctx.heal) ctx.heal(wanted); else player.hp = Math.min(val(player, 'maxHp'), val(player, 'hp') + wanted);
    return wanted;
  }
  function ring(ctx, player, def) { ctx.effect?.(def.key, { type: 'ring', x: player.x, y: player.y, radius: def.radius || 42, life: .55, max: .55 }); }
  function damage(ctx, enemy, amount, def) { if (enemy.hp > 0) ctx.hit?.(enemy, Math.max(0, finite(amount)), def.color); }
  function tickDots(player, dt, ctx, allowed) {
    player.relicDots = (player.relicDots || []).filter(dot => allowed.has(dot.key) && dot.enemy.hp > 0 && dot.remaining > 0);
    for (const dot of player.relicDots) {
      const seconds = Math.min(dt, dot.remaining); dot.remaining -= seconds;
      dot.clock = finite(dot.clock) + seconds;
      if (dot.clock >= .5 - 1e-8 || dot.remaining <= 1e-8) {
        damage(ctx, dot.enemy, dot.dps * dot.clock, dot.def); dot.clock = 0;
      }
    }
    player.relicDots = player.relicDots.filter(dot => dot.enemy.hp > 0 && dot.remaining > 1e-8);
  }
  function tick(player, ownedDefs = [], dt, context = {}) {
    dt = Math.min(1, Math.max(0, finite(dt)));
    if (!player || !dt || context.paused || context.active === false) return;
    player.skillTimers ??= {}; player.relicDots ??= [];
    const allowed = new Set(ownedDefs.map(def => def.key));
    tickDots(player, dt, context, allowed);
    for (const def of ownedDefs) {
      if (!def || (def.legacy && !context.includeLegacy) || def.family === 'stats') continue;
      player.skillTimers[def.key] = Math.max(0, finite(player.skillTimers[def.key]) - dt);
      if (player.skillTimers[def.key] > 0 || def.family === 'dash') continue;
      if (def.family === 'heal') {
        if (def.requireNoHit && val(player, 'sinceHit') < def.requireNoHit) continue;
        const restored = heal(context, player, val(def, 'healFlat') + val(player, 'maxHp') * val(def, 'healMaxHp'));
        if (restored) ring(context, player, def);
        player.skillTimers[def.key] = cooldown(def, player); continue;
      }
      if (def.family === 'ward') {
        if (val(player, 'shield') > 0) continue;
        player.shield = 1; heal(context, player, val(def, 'wardHeal')); ring(context, player, def);
        player.skillTimers[def.key] = cooldown(def, player); continue;
      }
      const list = targets(context, player.x, player.y, def.radius).slice(0, Math.max(1, val(def, 'targets', def.family === 'slow' ? 24 : 1)));
      if (!list.length) continue;
      const attack = Math.max(0, val(player, 'damage'));
      if (def.family === 'chain') {
        const used = new Set(), points = [{ x: player.x, y: player.y }]; let enemy = list[0];
        for (let i = 0; enemy && i < def.targets; i++) {
          used.add(enemy); damage(context, enemy, attack * def.power, def); points.push({ x: enemy.x, y: enemy.y });
          enemy = targets(context, enemy.x, enemy.y, def.chainRadius).find(next => !used.has(next));
        }
        context.effect?.(def.key, { type: 'chain', points, life: .3, max: .3 });
      } else if (def.family === 'projectile') {
        if (!context.projectile) continue;
        const angle = Math.atan2(list[0].y - player.y, list[0].x - player.x);
        for (let i = 0; i < def.count; i++) {
          const aim = angle + (i / Math.max(1, def.count - 1) - .5) * def.spread;
          context.projectile({ x: player.x + Math.cos(aim) * 22, y: player.y + Math.sin(aim) * 22,
            vx: Math.cos(aim) * def.speed, vy: Math.sin(aim) * def.speed, damage: attack * def.power,
            color: def.color, life: def.life, size: def.size || 4, pierce: def.pierce, source: def.key });
        }
      } else if (def.family === 'bee') {
        for (let i = 0; i < def.targets; i++) {
          const enemy = targets(context, player.x, player.y, def.radius)[0]; if (!enemy) break;
          damage(context, enemy, attack * def.power, def);
          context.effect?.(def.key, { type: 'bee', x: player.x, y: player.y, tx: enemy.x, ty: enemy.y, life: .45, max: .45 });
        }
      } else if (def.family === 'poison') {
        for (const enemy of list) {
          let dot = player.relicDots.find(item => item.key === def.key && item.enemy === enemy);
          if (!dot) { dot = { key: def.key, enemy, def }; player.relicDots.push(dot); }
          dot.dps = attack * def.dotPower; dot.remaining = def.duration;
        }
        ring(context, player, def);
      } else if (def.family === 'slow') {
        for (const enemy of list) {
          damage(context, enemy, attack * def.power, def);
          const amount = enemy.boss ? def.bossSlow : def.slow, now = finite(context.elapsed);
          if (finite(enemy.slowUntil) <= now || amount >= finite(enemy.slowAmount)) { enemy.slowUntil = now + def.duration; enemy.slowAmount = amount; }
        }
        ring(context, player, def);
      } else if (def.family === 'execute') {
        for (const enemy of list) {
          const below = enemy.maxHp > 0 && enemy.hp / enemy.maxHp < def.threshold;
          damage(context, enemy, attack * (below ? def.executePower : def.power), def);
          context.effect?.(def.key, { type: 'line', x: player.x, y: player.y, tx: enemy.x, ty: enemy.y, life: .3, max: .3 });
        }
      } else {
        const repeats = def.family === 'surge' ? def.repeats : 1;
        for (let i = 0; i < repeats; i++) for (const enemy of list) damage(context, enemy, attack * def.power, def);
        if (def.family === 'leech') heal(context, player, def.healFlat);
        ring(context, player, def);
      }
      player.skillTimers[def.key] = cooldown(def, player);
    }
  }
  window.ORCHARD_RELIC_EFFECTS = Object.freeze({ applyPickup, tick, consumeShield, cooldown });
})();
