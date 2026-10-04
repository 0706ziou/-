/* Shared pursuit flow fields: large groups take bridges and gates instead of pushing through walls. */
(() => {
  'use strict';
  const CELL = 80, BUCKET = 240, SQRT2 = Math.SQRT2;
  const DIRECTIONS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]];
  const clamp = (v, low, high) => Math.max(low, Math.min(high, v));

  function create(layout, world) {
    const width = layout.width, height = layout.height, obstacles = layout.obstacles || [];
    if (!(width > 0 && height > 0) || !world) throw new Error('Navigation requires a valid map and collision world.');
    const columns = Math.ceil(width / CELL), rows = Math.ceil(height / CELL), count = columns * rows;
    const groups = new Map(), buckets = new Map(), waypoints = new WeakMap(), movementSolids = new WeakMap();
    const counters = { grids: 0, fields: 0, direct: 0, routed: 0, fallback: 0, visited: 0, cached: 0 };
    let elapsed = 0, frame = 0, frameTargetX = NaN, frameTargetY = NaN;
    const point = index => ({ x: Math.min((index % columns + .5) * CELL, width - 1),
      y: Math.min((Math.floor(index / columns) + .5) * CELL, height - 1) });
    const indexAt = (x, y) => clamp(Math.floor(y / CELL), 0, rows - 1) * columns + clamp(Math.floor(x / CELL), 0, columns - 1);

    for (const obstacle of obstacles) {
      const ex = obstacle.shape === 'circle' ? obstacle.r : obstacle.w / 2;
      const ey = obstacle.shape === 'circle' ? obstacle.r : obstacle.h / 2;
      for (let by = Math.floor((obstacle.y - ey) / BUCKET); by <= Math.floor((obstacle.y + ey) / BUCKET); by++) {
        for (let bx = Math.floor((obstacle.x - ex) / BUCKET); bx <= Math.floor((obstacle.x + ex) / BUCKET); bx++) {
          const key = bx + ':' + by;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(obstacle);
        }
      }
    }
    // Return only nearby collision objects. A Set keeps a long river rectangle from being checked repeatedly.
    function nearby(minX, minY, maxX, maxY) {
      const found = new Set();
      for (let by = Math.floor(minY / BUCKET); by <= Math.floor(maxY / BUCKET); by++) {
        for (let bx = Math.floor(minX / BUCKET); bx <= Math.floor(maxX / BUCKET); bx++) {
          const list = buckets.get(bx + ':' + by);
          if (list) for (const obstacle of list) found.add(obstacle);
        }
      }
      return [...found];
    }
    const isFree = (x, y, radius) => world.isFree(x, y, radius,
      nearby(x - radius, y - radius, x + radius, y + radius), width, height);
    function segmentClear(x1, y1, x2, y2, radius) {
      if (x1 < radius || y1 < radius || x2 < radius || y2 < radius ||
          x1 > width - radius || x2 > width - radius || y1 > height - radius || y2 > height - radius) return false;
      const dx = x2 - x1, dy = y2 - y1;
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= BUCKET * 2) {
        return !world.blocksSegment(x1, y1, x2, y2,
          nearby(Math.min(x1, x2) - radius, Math.min(y1, y2) - radius,
            Math.max(x1, x2) + radius, Math.max(y1, y2) + radius), radius);
      }
      // March the ray's grid cells instead of visiting a huge diagonal bounding rectangle.
      // Neighbour cells cover the complete swept radius, and any exact collision can stop the search immediately.
      const seenBuckets = new Set(), seenObstacles = new Set(), padding = Math.max(1, Math.ceil(radius / BUCKET));
      let bx = Math.floor(x1 / BUCKET), by = Math.floor(y1 / BUCKET);
      const endX = Math.floor(x2 / BUCKET), endY = Math.floor(y2 / BUCKET), sx = Math.sign(dx), sy = Math.sign(dy);
      const deltaX = dx ? BUCKET / Math.abs(dx) : Infinity, deltaY = dy ? BUCKET / Math.abs(dy) : Infinity;
      let timeX = dx ? ((sx > 0 ? (bx + 1) * BUCKET : bx * BUCKET) - x1) / dx : Infinity;
      let timeY = dy ? ((sy > 0 ? (by + 1) * BUCKET : by * BUCKET) - y1) / dy : Infinity;
      while (true) {
        for (let yy = by - padding; yy <= by + padding; yy++) for (let xx = bx - padding; xx <= bx + padding; xx++) {
          const key = xx + ':' + yy;
          if (seenBuckets.has(key)) continue;
          seenBuckets.add(key); const list = buckets.get(key);
          if (list) for (const obstacle of list) {
            if (seenObstacles.has(obstacle)) continue;
            seenObstacles.add(obstacle);
            if (world.blocksSegment(x1, y1, x2, y2, [obstacle], radius)) return false;
          }
        }
        if (bx === endX && by === endY) return true;
        // A negative ray ending exactly on a bucket boundary belongs to the endpoint's cell.
        // Stop advancing a finished axis so floating-point tie differences cannot step past that cell.
        if (bx === endX) timeX = Infinity;
        if (by === endY) timeY = Infinity;
        if (timeX < timeY) { bx += sx; timeX += deltaX; }
        else if (timeY < timeX) { by += sy; timeY += deltaY; }
        else { bx += sx; by += sy; timeX += deltaX; timeY += deltaY; }
      }
    }
    const radiusGroup = radius => radius <= 19 ? 19 : radius <= 25 ? 25 : Math.max(44, Math.ceil(radius));

    function groupFor(radius) {
      const key = radiusGroup(radius);
      if (groups.has(key)) return groups.get(key);
      const passable = new Uint8Array(count), edges = new Uint8Array(count);
      const clearance = key + 2;
      for (let index = 0; index < count; index++) {
        const p = point(index);
        passable[index] = isFree(p.x, p.y, clearance) ? 1 : 0;
      }
      for (let index = 0; index < count; index++) {
        if (!passable[index]) continue;
        const x = index % columns, y = Math.floor(index / columns), p = point(index);
        // Validate the whole connection, including diagonals crossing thin walls between two free cells.
        for (const d of [0, 2, 4, 5]) {
          const [dx, dy] = DIRECTIONS[d], nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
          const next = ny * columns + nx;
          if (!passable[next]) continue;
          const q = point(next);
          if (segmentClear(p.x, p.y, q.x, q.y, clearance)) {
            edges[index] |= 1 << d;
            const reverse = d === 0 ? 1 : d === 2 ? 3 : d === 4 ? 7 : 6;
            edges[next] |= 1 << reverse;
          }
        }
      }
      const group = { radius: key, passable, edges, distances: null, goal: -1, rawGoal: -1, builtAt: -Infinity,
        checkedFrame: -1, requestedCell: -1 };
      groups.set(key, group); counters.grids++;
      return group;
    }

    function nearNodes(group, x, y, rings = 3, requireSight = true, radius = group.radius) {
      const cx = clamp(Math.floor(x / CELL), 0, columns - 1), cy = clamp(Math.floor(y / CELL), 0, rows - 1);
      const result = [];
      for (let yy = Math.max(0, cy - rings); yy <= Math.min(rows - 1, cy + rings); yy++) {
        for (let xx = Math.max(0, cx - rings); xx <= Math.min(columns - 1, cx + rings); xx++) {
          const index = yy * columns + xx;
          if (!group.passable[index]) continue;
          const p = point(index);
          if (requireSight && !segmentClear(x, y, p.x, p.y, radius)) continue;
          result.push({ index, x: p.x, y: p.y, distance: Math.hypot(x - p.x, y - p.y) });
        }
      }
      return result;
    }

    function goalFor(group, x, y) {
      // A player can stand closer to a wall than a boss; use point visibility for that last approach.
      const targetRadius = isFree(x, y, group.radius + 2) ? group.radius + 2 : 0;
      for (const rings of [2, 5, 10]) {
        const candidates = nearNodes(group, x, y, rings, true, targetRadius);
        if (candidates.length) return candidates.reduce((best, candidate) => candidate.distance < best.distance ? candidate : best).index;
      }
      return -1;
    }

    function buildField(group, goal, rawGoal) {
      const distances = new Float32Array(count); distances.fill(Infinity);
      group.distances = distances; group.goal = goal; group.rawGoal = rawGoal; group.builtAt = elapsed;
      counters.fields++;
      if (goal < 0) return;
      const heap = [];
      function push(index, cost) {
        let at = heap.length; heap.push({ index, cost });
        while (at > 0) {
          const parent = (at - 1) >> 1;
          if (heap[parent].cost <= cost) break;
          heap[at] = heap[parent]; at = parent;
        }
        heap[at] = { index, cost };
      }
      function pop() {
        const result = heap[0], tail = heap.pop();
        if (heap.length) {
          let at = 0;
          while (at * 2 + 1 < heap.length) {
            let child = at * 2 + 1;
            if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++;
            if (heap[child].cost >= tail.cost) break;
            heap[at] = heap[child]; at = child;
          }
          heap[at] = tail;
        }
        return result;
      }
      distances[goal] = 0; push(goal, 0);
      while (heap.length) {
        const current = pop();
        if (current.cost > distances[current.index] + .0001) continue;
        counters.visited++;
        const x = current.index % columns, y = Math.floor(current.index / columns);
        for (let direction = 0; direction < DIRECTIONS.length; direction++) {
          if (!(group.edges[current.index] & 1 << direction)) continue;
          const [dx, dy, cost] = DIRECTIONS[direction], next = (y + dy) * columns + x + dx;
          const total = current.cost + cost;
          if (total + .0001 < distances[next]) { distances[next] = total; push(next, total); }
        }
      }
    }

    function ensureField(group, x, y, force = false) {
      const rawGoal = indexAt(x, y);
      if (!force && group.checkedFrame === frame && group.requestedCell === rawGoal) return;
      group.checkedFrame = frame; group.requestedCell = rawGoal;
      if (group.distances && rawGoal === group.rawGoal) return;
      if (!force && group.distances && elapsed - group.builtAt < .24) return;
      const goal = goalFor(group, x, y);
      if (group.distances && group.goal === goal) { group.rawGoal = rawGoal; return; }
      buildField(group, goal, rawGoal);
    }

    function beginFrame(targetX, targetY, dt) {
      elapsed += Math.max(0, Number.isFinite(dt) ? dt : 0); frame++;
      frameTargetX = targetX; frameTargetY = targetY;
    }

    function steer(body, targetX, targetY) {
      const radius = Number.isFinite(body.r) ? Math.max(1, body.r) : 19;
      const dx = targetX - body.x, dy = targetY - body.y, distance = Math.hypot(dx, dy);
      if (!distance) return { dx: 0, dy: 0, direct: true };
      const cached = waypoints.get(body);
      if (cached && cached.radius === radius && elapsed < cached.expires &&
          Math.hypot(body.x - cached.originX, body.y - cached.originY) < CELL &&
          Math.hypot(targetX - cached.targetX, targetY - cached.targetY) < CELL * .75) {
        const cx = cached.x - body.x, cy = cached.y - body.y, length = Math.hypot(cx, cy);
        if (length > CELL * .4) {
          counters.cached++; counters[cached.direct ? 'direct' : 'routed']++;
          return { dx: cached.direct ? dx / distance : cx / length,
            dy: cached.direct ? dy / distance : cy / length, direct: cached.direct, reachable: true };
        }
      }
      function aim(x, y, direct) {
        waypoints.set(body, { x, y, originX: body.x, originY: body.y, targetX, targetY, radius,
          expires: elapsed + (direct ? .08 : .12) * (.85 + (Math.sin(body.x * .013 + body.y * .017) + 1) * .15), direct });
        const ax = x - body.x, ay = y - body.y, length = Math.hypot(ax, ay);
        return { dx: length ? ax / length : 0, dy: length ? ay / length : 0, direct, reachable: true };
      }
      if (segmentClear(body.x, body.y, targetX, targetY, radius + .5)) {
        counters.direct++; return aim(targetX, targetY, true);
      }
      const group = groupFor(radius); ensureField(group, targetX, targetY);
      let candidates = nearNodes(group, body.x, body.y, 1, true, radius + .5)
        .filter(node => Number.isFinite(group.distances[node.index]));
      if (!candidates.length) candidates = nearNodes(group, body.x, body.y, 3, true, radius + .5)
        .filter(node => Number.isFinite(group.distances[node.index]));
      if (!candidates.length) { counters.fallback++; return { dx: dx / distance, dy: dy / distance, direct: false, reachable: false }; }
      // Include the cost of joining the flow field, preventing shortcuts to the wrong side of a corridor.
      let selected = candidates.reduce((best, node) => group.distances[node.index] + node.distance / CELL <
        group.distances[best.index] + best.distance / CELL - .0001 ? node : best);
      // Once inside the destination area, collision movement handles the final contact approach.
      // This lets a large boss reach a player standing close to a wall instead of stopping at a grid centre.
      if (group.distances[selected.index] === 0 && selected.distance < CELL * .75 &&
          segmentClear(body.x, body.y, targetX, targetY, 0)) {
        counters.routed++; return aim(targetX, targetY, false);
      }
      // Smooth a few safe edges ahead. Collision-tested visibility never cuts across a river or hedge corner.
      let next = selected.index;
      for (let step = 0; step < 5 && group.distances[next] > 0; step++) {
        const x = next % columns, y = Math.floor(next / columns); let lower = next;
        for (let d = 0; d < DIRECTIONS.length; d++) {
          if (!(group.edges[next] & 1 << d)) continue;
          const [ox, oy] = DIRECTIONS[d], candidate = (y + oy) * columns + x + ox;
          if (group.distances[candidate] < group.distances[lower] - .0001) lower = candidate;
        }
        if (lower === next) break;
        next = lower; const p = point(next);
        if (segmentClear(body.x, body.y, p.x, p.y, radius + .5)) selected = { index: next, ...p };
      }
      const sx = selected.x - body.x, sy = selected.y - body.y, length = Math.hypot(sx, sy);
      if (length < .01) return { dx: 0, dy: 0, direct: false, reachable: true };
      counters.routed++;
      return aim(selected.x, selected.y, false);
    }

    function moveEnemy(body, targetX, targetY, speed, dt) {
      if (!(speed > 0 && dt > 0)) return { x: body.x, y: body.y, blocked: false, distance: 0 };
      const direction = steer(body, targetX, targetY);
      const distance = Math.min(Math.max(0, speed * dt), Math.hypot(targetX - body.x, targetY - body.y));
      const reach = (Number.isFinite(body.r) ? body.r : 19) + distance + 1;
      // Every possible local avoidance trajectory stays inside this radius; broad-phase filtering preserves exact collision.
      const bx0 = Math.floor((body.x - reach) / BUCKET), by0 = Math.floor((body.y - reach) / BUCKET);
      const bx1 = Math.floor((body.x + reach) / BUCKET), by1 = Math.floor((body.y + reach) / BUCKET);
      let cached = movementSolids.get(body);
      if (!cached || bx0 !== cached.bx0 || by0 !== cached.by0 || bx1 !== cached.bx1 || by1 !== cached.by1) {
        cached = { bx0, by0, bx1, by1, solids: nearby(body.x - reach, body.y - reach, body.x + reach, body.y + reach) };
        movementSolids.set(body, cached);
      }
      return world.moveEnemy(body, direction.dx * distance, direction.dy * distance, cached.solids, width, height);
    }

    function routeReachable(x1, y1, x2, y2, radius = 19) {
      if (!isFree(x1, y1, radius) || !isFree(x2, y2, radius)) return false;
      if (segmentClear(x1, y1, x2, y2, radius + .5)) return true;
      const group = groupFor(radius); ensureField(group, x2, y2, true);
      return nearNodes(group, x1, y1, 3, true, radius + .5).some(node => Number.isFinite(group.distances[node.index]));
    }

    return Object.freeze({ beginFrame, steer, moveEnemy, routeReachable,
      stats: () => ({ ...counters, cells: count, groups: groups.size, elapsed, frame, targetX: frameTargetX, targetY: frameTargetY }) });
  }

  window.ORCHARD_NAV = Object.freeze({ create, cellSize: CELL });
})();
