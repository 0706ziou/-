/* One hundred chapter layouts built from twenty terrain themes. Coordinates are world pixels; solid water and
 * cliffs have real collision, and bridges are genuine gaps in those solids. */
(() => {
  'use strict';
  const NAMES = ['青叶入口', '露水小径', '苔石果园', '蜂鸣林地', '溪边果坡', '藤蔓回廊', '樱红果林', '斜阳梯田', '密叶迷径', '厚皮瓜田', '风暴果坳', '虫巢外沿', '荆棘环道', '金穗花圃', '暮色果谷', '赤叶深林', '虫潮裂谷', '南瓜堡垒', '最后一道篱笆', '果园终极保卫战'];
  const THEMES = ['gate', 'dew', 'moss', 'apiary', 'creek', 'vines', 'cherry', 'terrace', 'maze', 'pumpkin-field', 'storm', 'hive', 'thorns', 'flower', 'twilight', 'redleaf', 'rift', 'fortress', 'fence', 'heart'];
  const SUMMARIES = [
    '青叶木门与交错果树行，沿弯曲土路探索第一座果园。',
    '露珠水池与湿石小径，池岸留下宽阔的环行空间。',
    '苔石遗迹围着旧喷泉，碎石与树丛形成错落掩体。',
    '蜂箱分布在梨树林两侧，蜂蜜色步道连接花圃。',
    '溪流贯穿两座果坡，三座木桥连接两岸道路。',
    '三条葡萄藤架长廊，由横向小径连接成回游路线。',
    '樱桃树与落花小径相互交织，果篮点缀林间空地。',
    '四层果树梯田沿坡展开，阶梯缺口连接每层田埂。',
    '层叠篱笆围着旧喷泉，多处宽入口组成真正的迷径。',
    '南瓜与西瓜田铺在土路两侧，大片瓜垄可以绕行。',
    '风车与雨后水洼散落果坳，湿石路穿过迎风林地。',
    '三座蜂蜡虫巢围着土路，巢穴之间留有回旋空地。',
    '荆棘围出双层环道，四个宽入口通往中央遗迹。',
    '金色花床与玻璃温室组成花圃，石径连接种植区。',
    '灯笼映亮暮色池塘，月光小径绕过三片静水。',
    '赤叶林围着旧木门，落叶覆盖多条弯曲林中小径。',
    '深谷将果坡分成两岸，三座吊桥跨过不可踏入的裂谷。',
    '南瓜塔楼与双层木墙构成堡垒，多重门洞保持内外连通。',
    '三道果园篱笆逐层展开，宽木门与侧道连接各区。',
    '金色心树庇护最后果园，放射状道路连接各片果林。'
  ];
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
  };
  const segmentDistance = (x, y, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? clamp(((x - a.x) * dx + (y - a.y) * dy) / length, 0, 1) : 0;
    return Math.hypot(x - a.x - dx * t, y - a.y - dy * t);
  };

  function build(stageId, width, height, relicDefs = []) {
    const actualId = clamp(Math.round(stageId) || 1, 1, 100);
    const id = (actualId - 1) % 20 + 1, chapter = Math.floor((actualId - 1) / 20);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1200 || height < 1000) throw new RangeError('Chapter maps require a valid large world.');
    let seed = (actualId * 2654435761 ^ Math.round(width) * 19349663 ^ Math.round(height)) >>> 0;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const roads = [], areas = [], landmarks = [], obstacles = [];
    const spawn = { x: width / 2, y: height / 2 };
    const relics = relicDefs.map(relic => ({ id: relic.id, x: relic.x * width, y: relic.y * height }));
    const protectedPoints = [{ ...spawn, radius: 240 }, ...relics.map(relic => ({ ...relic, radius: 140 }))];
    const xy = (x, y) => ({ x: x * width, y: y * height });
    const rectangle = (x, y, w, h) => [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]].map(([px, py]) => ({ x: px, y: py }));
    const area = (kind, x, y, w, h, color) => areas.push({ id: 'area-' + (areas.length + 1), kind, color, points: rectangle(x * width, y * height, w * width, h * height) });
    const road = (points, roadWidth = 260, kind = 'main') => roads.push({ id: 'road-' + (roads.length + 1), kind, width: roadWidth, points: points.map(([x, y]) => xy(x, y)) });
    const rawSolid = (kind, shape, x, y, dimensions, extra = {}) => {
      const result = { id: 'map-' + id + '-solid-' + (obstacles.length + 1), kind, shape, x, y, ...dimensions, variant: Math.floor(random() * 3), ...extra };
      obstacles.push(result); return result;
    };
    const obstacleDistance = (x, y, obstacle) => obstacle.shape === 'circle' ? Math.hypot(x - obstacle.x, y - obstacle.y) - obstacle.r
      : Math.hypot(Math.max(0, Math.abs(x - obstacle.x) - obstacle.w / 2), Math.max(0, Math.abs(y - obstacle.y) - obstacle.h / 2));
    const clear = (x, y, extent, spacing = 180) => {
      if (x < extent + 70 || y < extent + 70 || x > width - extent - 70 || y > height - extent - 70) return false;
      if (protectedPoints.some(p => Math.hypot(x - p.x, y - p.y) < p.radius + extent)) return false;
      if (roads.some(r => r.points.some((p, i) => i && segmentDistance(x, y, r.points[i - 1], p) < r.width / 2 + extent + 52))) return false;
      return !obstacles.some(o => obstacleDistance(x, y, o) < extent + spacing);
    };
    const solid = (kind, x, y, radius = 36, extra = {}) => {
      const p = xy(x, y); if (!clear(p.x, p.y, radius)) return null;
      return rawSolid(kind, 'circle', p.x, p.y, { r: radius }, extra);
    };
    // A long wall is cut at EVERY road crossing and protected point. These gaps are
    // wider than a 44 px Boss plus the navigation grid, so a visible gate is usable.
    const wall = (kind, x, y, w, h) => {
      const p = xy(x, y), rw = w * width, rh = h * height, horizontal = rw >= rh;
      const major = horizontal ? 'x' : 'y', minor = horizontal ? 'y' : 'x';
      const length = horizontal ? rw : rh, thickness = horizontal ? rh : rw;
      const start = p[major] - length / 2, end = p[major] + length / 2, intervals = [];
      for (const r of roads) for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1], b = r.points[i], delta = b[minor] - a[minor];
        const pad = r.width / 2 + 76, low = p[minor] - thickness / 2 - pad, high = p[minor] + thickness / 2 + pad;
        let t0 = 0, t1 = 1;
        if (Math.abs(delta) < 1e-8) { if (a[minor] < low || a[minor] > high) continue; }
        else { const first = (low - a[minor]) / delta, last = (high - a[minor]) / delta; t0 = Math.max(0, Math.min(first, last)); t1 = Math.min(1, Math.max(first, last)); if (t0 > t1) continue; }
        const q0 = a[major] + (b[major] - a[major]) * t0, q1 = a[major] + (b[major] - a[major]) * t1;
        intervals.push([Math.min(q0, q1) - pad, Math.max(q0, q1) + pad]);
      }
      for (const point of protectedPoints) if (Math.abs(point[minor] - p[minor]) < thickness / 2 + point.radius + 50) intervals.push([point[major] - point.radius - 90, point[major] + point.radius + 90]);
      intervals.sort((a, b) => a[0] - b[0]);
      let cursor = start;
      const piece = (a, b) => {
        if (b - a < 95) return;
        const center = (a + b) / 2;
        rawSolid(kind, 'rect', horizontal ? center : p.x, horizontal ? p.y : center, { w: horizontal ? b - a : thickness, h: horizontal ? thickness : b - a });
      };
      for (const [a, b] of intervals) { if (b < start || a > end) continue; piece(cursor, Math.min(a, end)); cursor = Math.max(cursor, b); if (cursor >= end) break; }
      piece(cursor, end);
    };
    const landmark = (kind, x, y, w = 260, h = 260, options = {}) => {
      const p = xy(x, y), radius = options.radius || Math.min(w, h) * .24;
      let position = p;
      if (!options.passable && !clear(position.x, position.y, radius, 140)) {
        position = null;
        for (let ring = 1; ring <= 8 && !position; ring++) for (let k = 0; k < 12; k++) {
          const angle = k / 12 * Math.PI * 2, candidate = { x: p.x + Math.cos(angle) * ring * 90, y: p.y + Math.sin(angle) * ring * 90 };
          if (clear(candidate.x, candidate.y, radius, 140)) { position = candidate; break; }
        }
      }
      if (!position) return null;
      const mark = { id: 'landmark-' + (landmarks.length + 1), kind, x: position.x, y: position.y, w, h };
      if (options.rotation) mark.rotation = options.rotation;
      if (!options.passable) mark.obstacleId = rawSolid(kind, 'circle', mark.x, mark.y, { r: radius }, { landmark: true }).id;
      else mark.passable = true;
      landmarks.push(mark); return mark;
    };
    const pool = (x, y, radius, color = '#508f91') => {
      const p = xy(x, y);
      if (!clear(p.x, p.y, radius, 90)) return false;
      const points = Array.from({ length: 40 }, (_, i) => ({ x: p.x + Math.cos(i / 40 * Math.PI * 2) * radius, y: p.y + Math.sin(i / 40 * Math.PI * 2) * radius }));
      areas.push({ id: 'area-' + (areas.length + 1), kind: 'pond', color, points });
      rawSolid('pond', 'circle', p.x, p.y, { r: radius }); return true;
    };
    const grove = (kind, x1, y1, x2, y2, columns = 6, rows = 4) => {
      for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) solid(kind, x1 + (x2 - x1) * i / Math.max(1, columns - 1) + (random() - .5) * .009,
        y1 + (y2 - y1) * j / Math.max(1, rows - 1) + (random() - .5) * .011, 34 + random() * 10);
    };
    const orchardBed = (x, y, w, h, kind = 'field', color) => area(kind, x, y, w, h, color);
    const ringRoad = (cx, cy, rx, ry, roadWidth = 270) => road(Array.from({ length: 17 }, (_, i) => [cx + Math.cos(i / 16 * Math.PI * 2) * rx, cy + Math.sin(i / 16 * Math.PI * 2) * ry]), roadWidth);
    const thornRing = (rx, ry) => {
      const radius = 86, a = rx * width, b = ry * height;
      const circumference = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
      const count = Math.ceil(circumference / 132);
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2, x = spawn.x + Math.cos(angle) * a, y = spawn.y + Math.sin(angle) * b;
        if (protectedPoints.some(p => Math.hypot(x - p.x, y - p.y) < p.radius + radius + 35)) continue;
        if (roads.some(r => r.points.some((p, k) => k && segmentDistance(x, y, r.points[k - 1], p) < r.width / 2 + radius + 20))) continue;
        if (actualId > 20 && obstacles.some(o => o.kind !== 'thorn' && obstacleDistance(x, y, o) < radius + 180)) continue;
        // Adjacent bushes overlap to make one honest curved barrier; the four
        // cross-roads and relic spurs cut genuine wide entrance gaps in the ring.
        rawSolid('thorn', 'circle', x, y, { r: radius });
      }
    };

    // Main routes are designed for the picture's scene, rather than sharing one
    // global road cross. Relic spurs are attached to the nearest point on that route.
    switch (id) {
      case 1:
        road([[.08, .88], [.27, .72], [.39, .59], [.5, .5], [.67, .33], [.88, .13]], 310);
        road([[.12, .26], [.32, .32], [.5, .5], [.75, .64], [.91, .78]], 255);
        break;
      case 2:
        road([[.08, .32], [.25, .24], [.40, .38], [.5, .5], [.67, .64], [.9, .7]], 275, 'stone');
        road([[.22, .84], [.36, .70], [.5, .5], [.67, .33], [.83, .14]], 235, 'stone');
        break;
      case 3:
        ringRoad(.5, .5, .24, .30, 260);
        road([[.12, .5], [.5, .5], [.90, .5]], 280, 'stone'); road([[.5, .10], [.5, .90]], 240, 'stone');
        break;
      case 4:
        road([[.08, .28], [.30, .28], [.5, .5], [.71, .28], [.93, .28]], 285);
        road([[.13, .78], [.30, .70], [.5, .5], [.70, .71], [.90, .78]], 270);
        break;
      case 5:
      case 17:
        for (const y of [.30, .50, .76]) road([[.07, y], [.93, y]], 290, id === 17 ? 'stone' : 'main');
        road([[.60, .09], [.60, .92]], 270); road([[.20, .10], [.20, .90]], 250);
        break;
      case 6:
        for (const x of [.25, .50, .76]) road([[x, .09], [x, .91]], 255);
        for (const y of [.25, .50, .75]) road([[.10, y], [.90, y]], 245);
        break;
      case 7:
        road([[.08, .77], [.27, .67], [.5, .5], [.67, .35], [.90, .24]], 270);
        road([[.08, .27], [.31, .34], [.5, .5], [.70, .64], [.92, .78]], 265);
        ringRoad(.5, .5, .33, .28, 220); break;
      case 8:
        road([[.13, .13], [.28, .26], [.66, .26], [.76, .42], [.5, .5], [.25, .64], [.36, .78], [.87, .83]], 280, 'stone');
        road([[.12, .50], [.5, .5], [.88, .50]], 250); break;
      case 9:
        road([[.08, .50], [.92, .50]], 280, 'stone'); road([[.50, .09], [.50, .92]], 255, 'stone');
        ringRoad(.5, .5, .29, .32, 240); break;
      case 10:
        for (const y of [.22, .50, .79]) road([[.07, y], [.93, y]], 275);
        road([[.18, .10], [.30, .35], [.5, .5], [.71, .66], [.83, .90]], 260); break;
      case 11:
        road([[.07, .66], [.28, .70], [.5, .5], [.65, .27], [.87, .12]], 295, 'stone');
        road([[.17, .12], [.33, .32], [.5, .5], [.71, .63], [.92, .84]], 245, 'stone'); break;
      case 12:
        ringRoad(.5, .5, .30, .29, 280);
        road([[.10, .16], [.30, .33], [.5, .5], [.70, .67], [.9, .86]], 260);
        road([[.13, .84], [.31, .68], [.5, .5], [.71, .34], [.9, .15]], 260); break;
      case 13:
        ringRoad(.5, .5, .25, .27, 310); ringRoad(.5, .5, .39, .40, 265);
        road([[.06, .5], [.94, .5]], 275, 'stone'); road([[.5, .07], [.5, .93]], 275, 'stone'); break;
      case 14:
        road([[.10, .16], [.33, .16], [.33, .50], [.76, .50], [.76, .87], [.93, .87]], 285, 'stone');
        road([[.08, .76], [.5, .5], [.9, .20]], 245, 'stone'); break;
      case 15:
        road([[.10, .83], [.28, .76], [.36, .57], [.5, .5], [.67, .37], [.84, .18]], 270, 'stone');
        road([[.12, .19], [.28, .28], [.5, .5], [.72, .65], [.91, .80]], 255, 'stone'); break;
      case 16:
        road([[.09, .73], [.26, .56], [.37, .62], [.5, .5], [.65, .37], [.78, .45], [.91, .25]], 280);
        road([[.18, .10], [.27, .30], [.5, .5], [.73, .75], [.88, .91]], 235); break;
      case 18:
        road([[.5, .07], [.5, .93]], 320, 'stone'); road([[.07, .5], [.93, .5]], 290, 'stone');
        road([[.16, .2], [.16, .82], [.85, .82], [.85, .2], [.16, .2]], 250); break;
      case 19:
        road([[.08, .15], [.28, .30], [.40, .44], [.5, .5], [.66, .62], [.86, .87]], 300);
        for (const y of [.24, .50, .78]) road([[.09, y], [.90, y]], 245); break;
      case 20:
        ringRoad(.5, .5, .22, .28, 300);
        for (const endpoint of [[.08, .18], [.90, .15], [.94, .72], [.72, .93], [.10, .86], [.48, .08]]) road([[.5, .5], endpoint], 280, 'stone');
        break;
    }
    // Every original relic coordinate is retained. Its short path joins the chapter
    // route without inventing a visible corridor disconnected from the main network.
    for (const relic of relics) {
      let nearest = null;
      for (const route of roads) for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1], b = route.points[i], dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
        const t = len ? clamp(((relic.x - a.x) * dx + (relic.y - a.y) * dy) / len, 0, 1) : 0;
        const p = { x: a.x + t * dx, y: a.y + t * dy }, distance = Math.hypot(p.x - relic.x, p.y - relic.y);
        if (!nearest || distance < nearest.distance) nearest = { ...p, distance };
      }
      if (nearest && nearest.distance > 1) roads.push({ id: 'road-' + (roads.length + 1), kind: 'trail', width: 225, points: [{ x: relic.x, y: relic.y }, { x: nearest.x, y: nearest.y }] });
    }

    // Picture-specific terrain and landmarks. The low-level collision shapes match
    // these painted regions; imagery is never used to conceal passable deep water.
    switch (id) {
      case 1:
        orchardBed(.23, .48, .25, .30, 'field', '#49633b'); orchardBed(.78, .49, .27, .28, 'field', '#4c643a');
        landmark('gate', .39, .59, 420, 390, { passable: true }); landmark('fenceGate', .88, .13, 320, 310, { passable: true });
        grove('tree', .13, .12, .42, .85, 6, 8); grove('tree', .64, .14, .88, .87, 5, 8); break;
      case 2:
        for (const [x, y, r] of [[.19, .54, 240], [.72, .18, 235], [.77, .82, 270], [.39, .82, 155]]) pool(x, y, r, '#78c0bb');
        landmark('fountain', .32, .15, 210, 210); landmark('lantern', .70, .79, 135, 195);
        grove('tree', .12, .12, .88, .86, 9, 6); break;
      case 3:
        landmark('fountain', .50, .36, 280, 270); landmark('gate', .70, .71, 370, 335, { passable: true });
        for (const [x, y] of [[.16, .22], [.32, .16], [.68, .19], [.85, .36], [.80, .77], [.35, .84], [.17, .73]]) {
          solid('rock', x, y, 88 + random() * 45); solid('rock', x + .023, y + .025, 48 + random() * 22);
          area('moss', x, y, .055, .07, '#6d8850');
        }
        grove('tree', .09, .14, .91, .84, 8, 5); break;
      case 4:
        for (const [x, y] of [[.18, .43], [.35, .17], [.75, .15], [.80, .47], [.65, .82], [.24, .85]]) {
          landmark('apiary', x, y, 245, 255); orchardBed(x, y + .055, .085, .07, 'flower', '#a49846');
        }
        grove('tree', .13, .13, .88, .84, 8, 6); break;
      case 5:
      case 17: {
        const waterKind = id === 5 ? 'water' : 'chasm', color = id === 5 ? '#3e9eaa' : '#203e4a';
        const x = .37 * width, bandWidth = id === 5 ? 345 : 440, gap = 310;
        const riverX = y => x + (id === 5 ? Math.sin(y / height * Math.PI * 2 + .3) * 190 : 0);
        const waterSection = (start, end) => {
          const count = id === 5 ? Math.max(1, Math.ceil((end - start) / 220)) : 1;
          for (let i = 0; i < count; i++) {
            const top = start + (end - start) * i / count, bottom = start + (end - start) * (i + 1) / count;
            const mid = (top + bottom) / 2, centerX = riverX(mid);
            rawSolid(waterKind, 'rect', centerX, mid, { w: bandWidth, h: bottom - top });
            areas.push({ id: 'area-' + (areas.length + 1), kind: waterKind, color, points: rectangle(centerX, mid, bandWidth, bottom - top) });
          }
        };
        let cursor = 65;
        for (const y of [.30, .50, .76]) {
          const centerY = y * height, end = centerY - gap / 2;
          if (end > cursor) waterSection(cursor, end);
          // A dry span is physically open, not a bridge picture on a water collider.
          const bridge = landmark('bridge', riverX(centerY) / width, y, bandWidth + 175, gap, { passable: true });
          bridge.widthAxis = 'x'; bridge.clearWidth = gap;
          cursor = centerY + gap / 2;
        }
        const end = height - 65;
        if (cursor < end) waterSection(cursor, end);
        if (id === 5) {
          landmark('windmill', .46, .64, 295, 355); orchardBed(.78, .37, .26, .18, 'field', '#547955');
          grove('tree', .10, .12, .25, .88, 4, 9); grove('tree', .52, .13, .9, .88, 8, 7);
        } else {
          for (const [rx, ry] of [[.29, .13], [.29, .42], [.29, .64], [.29, .90], [.45, .14], [.45, .41], [.45, .63], [.45, .88]]) solid('rock', rx, ry, 70);
          grove('tree', .12, .15, .24, .87, 4, 7); grove('tree', .67, .13, .9, .87, 6, 7);
        }
        break;
      }
      case 6:
        for (const x of [.25, .50, .76]) for (const y of [.16, .36, .63, .84]) {
          landmark('pergola', x, y, 335, 320, { passable: true });
          wall('hedge', x - .043, y, .012, .105); wall('hedge', x + .043, y, .012, .105);
        }
        for (const x of [.12, .38, .62, .88]) grove('tree', x, .12, x, .87, 1, 10);
        area('vines', .5, .5, .88, .86, '#345a37'); break;
      case 7:
        area('petal', .5, .5, .77, .72, '#9b6b65');
        landmark('gate', .26, .68, 325, 345, { passable: true });
        for (const [x, y] of [[.19, .15], [.75, .15], [.82, .51], [.39, .85]]) landmark('cherryTree', x, y, 245, 275);
        grove('cherryTree', .12, .12, .88, .88, 10, 8); break;
      case 8:
        for (let row = 0; row < 4; row++) {
          const y = .18 + row * .195;
          orchardBed(.5, y, .83 - row * .07, .125, 'terrace', ['#728347', '#819048', '#8b984f', '#9ca155'][row]);
          wall('terrace', .50, y + .075, .86 - row * .07, .018);
          grove('tree', .14 + row * .03, y - .026, .89 - row * .03, y + .025, 10 - row, 2);
        }
        landmark('bridge', .76, .42, 245, 330, { passable: true, rotation: Math.PI / 2 });
        break;
      case 9:
        landmark('fountain', .50, .36, 290, 285);
        for (const [x, y, w, h] of [[.5, .14, .72, .015], [.5, .86, .72, .015], [.14, .5, .011, .72], [.86, .5, .011, .72], [.5, .31, .38, .014], [.5, .69, .38, .014], [.31, .5, .011, .38], [.69, .5, .011, .38], [.21, .35, .011, .22], [.79, .65, .011, .22], [.36, .80, .26, .014], [.64, .20, .26, .014]]) wall('hedge', x, y, w, h);
        grove('tree', .075, .07, .93, .93, 8, 5); break;
      case 10:
        for (const [x, y] of [[.22, .34], [.70, .34], [.25, .65], [.75, .68]]) {
          orchardBed(x, y, .24, .15, 'field', '#647541');
          for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) solid('pumpkinBed', x - .095 + col * .047, y - .05 + row * .05, 39 + random() * 9);
        }
        landmark('pumpkinTower', .88, .12, 265, 330); break;
      case 11:
        landmark('windmill', .76, .15, 390, 465); landmark('fenceGate', .19, .80, 280, 290, { passable: true });
        for (const [x, y, r] of [[.13, .46, 135], [.77, .84, 160], [.59, .13, 145], [.37, .88, 175]]) pool(x, y, r, '#596d79');
        grove('tree', .10, .11, .91, .86, 9, 7); break;
      case 12:
        for (const [x, y] of [[.24, .18], [.80, .52], [.31, .86]]) {
          landmark('hive', x, y, 470, 440, { radius: 150 });
          area('hive', x, y, .105, .135, '#88714a');
        }
        for (let i = 0; i < 18; i++) solid('rock', .12 + random() * .77, .10 + random() * .79, 39 + random() * 23);
        grove('tree', .10, .09, .90, .9, 9, 6); break;
      case 13:
        landmark('fountain', .50, .36, 245, 225);
        for (const [rx, ry] of [[.33, .35], [.17, .19]]) thornRing(rx, ry);
        for (const [x, y] of [[.10, .12], [.86, .12], [.13, .88], [.87, .88]]) landmark('thorn', x, y, 255, 245);
        grove('tree', .10, .08, .9, .91, 9, 6); break;
      case 14:
        landmark('greenhouse', .69, .20, 510, 450, { radius: 150 }); landmark('greenhouse', .19, .85, 380, 340, { radius: 110 });
        for (const [x, y] of [[.18, .34], [.48, .19], [.79, .68], [.44, .81], [.17, .58]]) {
          orchardBed(x, y, .13, .13, 'flower', '#b6a254');
          wall('fence', x, y - .065, .13, .007); wall('fence', x, y + .065, .13, .007);
        }
        grove('tree', .08, .10, .91, .90, 8, 5); break;
      case 15:
        for (const [x, y, r] of [[.19, .51, 300], [.75, .19, 270], [.68, .82, 240]]) pool(x, y, r, '#636487');
        for (const [x, y] of [[.18, .12], [.40, .27], [.63, .44], [.79, .78], [.34, .84], [.84, .51]]) landmark('lantern', x, y, 155, 235, { radius: 25 });
        grove('tree', .09, .08, .89, .91, 9, 7); break;
      case 16:
        area('leaves', .5, .5, .90, .88, '#9b573e');
        landmark('gate', .73, .76, 290, 310, { passable: true }); landmark('lantern', .31, .42, 145, 210);
        grove('redTree', .10, .09, .90, .91, 11, 9); break;
      case 18:
        for (const [x, y, w, h] of [[.5, .21, .63, .015], [.5, .80, .63, .015], [.185, .505, .012, .59], [.815, .505, .012, .59], [.5, .33, .36, .014], [.5, .67, .36, .014], [.32, .5, .011, .34], [.68, .5, .011, .34]]) wall('fence', x, y, w, h);
        for (const [x, y] of [[.19, .21], [.81, .21], [.19, .80], [.81, .80], [.32, .33], [.68, .67]]) landmark('pumpkinTower', x, y, 360, 430, { radius: 105 });
        landmark('fenceGate', .5, .80, 420, 380, { passable: true }); landmark('fenceGate', .5, .33, 340, 330, { passable: true });
        for (const [x, y] of [[.12, .13], [.87, .88], [.89, .13], [.10, .87]]) { orchardBed(x, y, .12, .12, 'field', '#8b773b'); grove('pumpkinBed', x - .04, y - .035, x + .04, y + .035, 3, 2); }
        break;
      case 19:
        for (const x of [.28, .55, .78]) wall('fence', x, .5, .009, .84);
        for (const [x, y] of [[.28, .30], [.55, .53], [.78, .71]]) landmark('fenceGate', x, y, 340, 350, { passable: true, rotation: Math.PI / 2 });
        grove('tree', .10, .12, .89, .89, 10, 7); break;
      case 20:
        landmark('heartTree', .50, .34, 600, 670, { radius: 150 });
        for (const [x, y, kind, color] of [[.20, .22, 'tree', '#647e42'], [.77, .26, 'cherryTree', '#8c5f65'], [.83, .78, 'pumpkinBed', '#9d8040'], [.22, .80, 'redTree', '#95623e']]) {
          orchardBed(x, y, .19, .20, 'field', color); grove(kind, x - .075, y - .075, x + .075, y + .075, 5, 5);
        }
        area('glow', .5, .35, .18, .24, '#bbaa59');
        landmark('gate', .5, .90, 380, 380, { passable: true }); landmark('lantern', .73, .48, 155, 235); break;
    }

    // Small props make the entire expanded map explorable, not just its centre.
    // Different seeds, tree species and clustered planting preserve chapter identity.
    const treeKind = id === 7 ? 'cherryTree' : id === 16 ? 'redTree' : 'tree';
    const target = id === 9 || id === 18 ? 164 : id === 16 ? 192 : 172;
    for (let attempt = 0; attempt < 9000 && obstacles.filter(o => !['water', 'chasm', 'pond', 'fence', 'hedge', 'thorn', 'terrace'].includes(o.kind)).length < target; attempt++) {
      const kindRoll = random(), kind = kindRoll < .67 ? treeKind : kindRoll < .83 ? 'rock' : kindRoll < .94 ? 'stump' : 'crate';
      const x = .055 + random() * .89, y = .055 + random() * .89;
      if (kind === 'crate') {
        const p = xy(x, y), size = 52 + random() * 24;
        if (clear(p.x, p.y, size * .72)) rawSolid(kind, 'rect', p.x, p.y, { w: size, h: size });
      } else solid(kind, x, y, kind === 'rock' ? 32 + random() * 25 : 31 + random() * 13);
    }
    // Mirroring whole layouts keeps bridges, roads and collision in agreement.
    if (chapter > 0) {
      const flipX = chapter === 1 || chapter === 3, flipY = chapter === 2 || chapter === 3;
      const point = p => { if (flipX) p.x = width - p.x; if (flipY) p.y = height - p.y; };
      [spawn, ...relics, ...obstacles, ...landmarks].forEach(point);
      [...roads, ...areas].forEach(item => item.points.forEach(point));
      for (const landmark of landmarks) if (landmark.rotation) landmark.rotation *= flipX !== flipY ? -1 : 1;
    }
    return freeze({ id: actualId, name: (window.ORCHARD_STAGES?.[actualId - 1]?.name || window.ORCHARD_ART?.stages[actualId - 1]?.name || NAMES[id - 1]), theme: THEMES[id - 1], summary: SUMMARIES[id - 1], width, height,
      spawn, roads, areas, landmarks, obstacles, relics });
  }
  window.ORCHARD_MAPS = Object.freeze({ build });
})();
