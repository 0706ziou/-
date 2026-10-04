/* Real world collision geometry. Coordinates of both circles and rectangles are centres. */
(() => {
  'use strict';
  const EPSILON = 1e-7;
  const kinds = ['rock', 'stump', 'hedge', 'crate'];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const radiusOf = body => Number.isFinite(body.r) ? Math.max(1, body.r) : 17;
  const extentOf = obstacle => obstacle.shape === 'circle' ? obstacle.r : Math.hypot(obstacle.w, obstacle.h) / 2;

  function overlaps(x, y, radius, obstacle) {
    if (obstacle.shape === 'circle') {
      const reach = radius + obstacle.r, dx = x - obstacle.x, dy = y - obstacle.y;
      if (Math.abs(dx) >= reach || Math.abs(dy) >= reach) return false;
      return dx * dx + dy * dy < reach * reach - EPSILON;
    }
    const minX = obstacle.x - obstacle.w / 2, maxX = obstacle.x + obstacle.w / 2;
    const minY = obstacle.y - obstacle.h / 2, maxY = obstacle.y + obstacle.h / 2;
    if (x > minX && x < maxX && y > minY && y < maxY) return true;
    const nearestX = clamp(x, minX, maxX);
    const nearestY = clamp(y, minY, maxY);
    const dx = x - nearestX, dy = y - nearestY;
    return dx * dx + dy * dy < radius * radius - EPSILON;
  }

  function isFree(x, y, radius, obstacles, width, height) {
    if (![x, y, radius, width, height].every(Number.isFinite) || radius < 0) return false;
    if (x < radius || y < radius || x > width - radius || y > height - radius) return false;
    for (const obstacle of obstacles) if (overlaps(x, y, radius, obstacle)) return false;
    return true;
  }

  function build(width, height, relicDefs = []) {
    let seed = (Math.round(width) * 73856093 ^ Math.round(height) * 19349663 ^ 0x6f726368) >>> 0;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const obstacles = [], protectedPoints = [{ x: width / 2, y: height / 2, radius: 240 },
      ...relicDefs.map(relic => ({ x: relic.x * width, y: relic.y * height, radius: 140 }))];
    function offer(x, y) {
      const kind = kinds[obstacles.length % kinds.length];
      const circle = kind === 'rock' || kind === 'stump';
      const vertical = random() > .5;
      const long = 105 + Math.round(random() * 70), short = 30 + Math.round(random() * 12);
      const size = 48 + Math.round(random() * 22);
      const obstacle = circle ? { kind, shape: 'circle', x, y, r: kind === 'rock' ? 31 + Math.round(random() * 18) : 26 + Math.round(random() * 12) }
        : { kind, shape: 'rect', x, y, w: kind === 'crate' ? size : vertical ? short : long,
          h: kind === 'crate' ? size : vertical ? long : short };
      const extent = extentOf(obstacle);
      // Separate solids by at least 180 px, so even large bosses have passages around every piece.
      if (x < extent + 90 || y < extent + 90 || x > width - extent - 90 || y > height - extent - 90) return;
      if ([.25, .76].some(value => Math.abs(x - width * value) < 110 + extent)) return;
      if ([.25, .75].some(value => Math.abs(y - height * value) < 110 + extent)) return;
      if (protectedPoints.some(point => Math.hypot(x - point.x, y - point.y) < point.radius + extent)) return;
      if (obstacles.some(other => Math.hypot(x - other.x, y - other.y) < extent + extentOf(other) + 180)) return;
      obstacles.push(Object.freeze({ id: 'obstacle-' + (obstacles.length + 1), ...obstacle, variant: Math.floor(random() * 3) }));
    }
    // Put cover in the first exploration area as well as across the expanded map.
    for (let attempt = 0; attempt < 220 && obstacles.length < 24; attempt++) {
      const angle = random() * Math.PI * 2, distance = 340 + random() * 920;
      offer(width / 2 + Math.cos(angle) * distance, height / 2 + Math.sin(angle) * distance);
    }
    for (let attempt = 0; attempt < 4000 && obstacles.length < 96; attempt++) {
      offer(130 + random() * (width - 260), 130 + random() * (height - 260));
    }
    return Object.freeze(obstacles);
  }

  function safePoint(x, y, radius, obstacles, width, height) {
    if (![x, y, radius, width, height].every(Number.isFinite) || radius < 0 || width < radius * 2 || height < radius * 2) {
      return { x: width / 2, y: height / 2, free: false };
    }
    const originX = clamp(x, radius, width - radius), originY = clamp(y, radius, height - radius);
    if (isFree(originX, originY, radius, obstacles, width, height)) return { x: originX, y: originY, free: true };
    // Search neighbouring free ground before using a broader fallback; no random spawn inside a solid.
    const increment = Math.max(8, Math.min(18, radius / 2));
    const maximum = Math.hypot(width, height);
    for (let distance = increment; distance <= maximum; distance += increment) {
      const samples = Math.min(128, Math.max(16, Math.ceil(Math.PI * 2 * distance / increment)));
      for (let index = 0; index < samples; index++) {
        const angle = index / samples * Math.PI * 2;
        const candidateX = clamp(originX + Math.cos(angle) * distance, radius, width - radius);
        const candidateY = clamp(originY + Math.sin(angle) * distance, radius, height - radius);
        if (isFree(candidateX, candidateY, radius, obstacles, width, height)) return { x: candidateX, y: candidateY, free: true };
      }
    }
    return { x: originX, y: originY, free: false };
  }

  function move(body, dx, dy, obstacles, width, height) {
    const originX = body.x, originY = body.y, radius = radiusOf(body);
    if (![originX, originY, dx, dy].every(Number.isFinite) || !isFree(originX, originY, radius, obstacles, width, height)) {
      return { x: originX, y: originY, blocked: true, distance: 0 };
    }
    const length = Math.hypot(dx, dy), steps = Math.max(1, Math.ceil(length / Math.min(9, radius * .4)));
    const stepX = dx / steps, stepY = dy / steps;
    let blocked = false;
    for (let step = 0; step < steps; step++) {
      const nextX = body.x + stepX, nextY = body.y + stepY;
      if (isFree(nextX, nextY, radius, obstacles, width, height)) { body.x = nextX; body.y = nextY; continue; }
      blocked = true;
      // Recheck the second axis from the actual first-axis position, preventing diagonal corner clipping.
      if (Math.abs(stepX) >= Math.abs(stepY)) {
        if (isFree(nextX, body.y, radius, obstacles, width, height)) body.x = nextX;
        if (isFree(body.x, nextY, radius, obstacles, width, height)) body.y = nextY;
      } else {
        if (isFree(body.x, nextY, radius, obstacles, width, height)) body.y = nextY;
        if (isFree(nextX, body.y, radius, obstacles, width, height)) body.x = nextX;
      }
    }
    return { x: body.x, y: body.y, blocked, distance: Math.hypot(body.x - originX, body.y - originY) };
  }

  function moveEnemy(body, dx, dy, obstacles, width, height) {
    const originX = body.x, originY = body.y, length = Math.hypot(dx, dy);
    const forward = move(body, dx, dy, obstacles, width, height);
    if (!length || forward.distance >= length * .9) {
      if (body._orchardAvoid && ++body._orchardAvoid.clearFrames > 20) delete body._orchardAvoid;
      return forward;
    }
    const avoidance = body._orchardAvoid || { side: Math.sin(originX * .01 + originY * .017) >= 0 ? 1 : -1, clearFrames: 0 };
    avoidance.clearFrames = 0; body._orchardAvoid = avoidance;
    const heading = Math.atan2(dy, dx);
    let best = { ...forward, side: avoidance.side };
    for (const side of [avoidance.side, -avoidance.side]) {
      for (const turn of [Math.PI / 4, Math.PI / 2.4, Math.PI / 1.7]) {
        const angle = heading + side * turn;
        // Choose one complete trajectory from the same origin: a slide followed by an opposite
        // detour would cancel movement at some corners and could leave a pursuer oscillating.
        const candidate = { x: originX, y: originY, r: radiusOf(body) };
        const result = move(candidate, Math.cos(angle) * length, Math.sin(angle) * length, obstacles, width, height);
        if (!best || result.distance > best.distance + .01) best = { ...result, side };
        if (result.distance >= length * .85) break;
      }
      if (best && best.distance >= length * .85) break;
    }
    if (best && best.distance > .001) { body.x = best.x; body.y = best.y; avoidance.side = best.side; }
    return { x: body.x, y: body.y, blocked: forward.blocked,
      distance: Math.hypot(body.x - originX, body.y - originY) };
  }

  function blocksSegment(x1, y1, x2, y2, obstacles, padding = 0) {
    if (![x1, y1, x2, y2, padding].every(Number.isFinite)) return true;
    for (const obstacle of obstacles) {
      if (obstacle.shape === 'circle') {
        const dx = x2 - x1, dy = y2 - y1, lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared ? clamp(((obstacle.x - x1) * dx + (obstacle.y - y1) * dy) / lengthSquared, 0, 1) : 0;
        const distanceX = x1 + dx * t - obstacle.x, distanceY = y1 + dy * t - obstacle.y;
        if (distanceX * distanceX + distanceY * distanceY <= (obstacle.r + padding) ** 2) return true;
      } else {
        const minX = obstacle.x - obstacle.w / 2 - padding, maxX = obstacle.x + obstacle.w / 2 + padding;
        const minY = obstacle.y - obstacle.h / 2 - padding, maxY = obstacle.y + obstacle.h / 2 + padding;
        let enter = 0, exit = 1, intersects = true;
        for (const [origin, delta, min, max] of [[x1, x2 - x1, minX, maxX], [y1, y2 - y1, minY, maxY]]) {
          if (Math.abs(delta) < EPSILON) { if (origin < min || origin > max) { intersects = false; break; } }
          else {
            const t1 = (min - origin) / delta, t2 = (max - origin) / delta;
            enter = Math.max(enter, Math.min(t1, t2)); exit = Math.min(exit, Math.max(t1, t2));
            if (enter > exit) { intersects = false; break; }
          }
        }
        if (intersects) return true;
      }
    }
    return false;
  }

  window.ORCHARD_WORLD = Object.freeze({ build, isFree, safePoint, move, moveEnemy, blocksSegment });
})();
