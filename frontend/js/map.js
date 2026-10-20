const CASPIAN = [[46.8, 44.7], [47.5, 45.6], [48.5, 46.6], [50, 46.8], [51.8, 47], [53.2, 46.6], [53, 45.3],
  [51.3, 45], [51, 44.3], [51.2, 43.6], [52.5, 42.4], [52.8, 41.2], [53, 40], [53.9, 39.2], [53.8, 37.5],
  [51.5, 36.8], [49.5, 37.4], [49, 38.4], [49.4, 39.8], [49.9, 40.4], [50.3, 40.5], [49.5, 40.9],
  [48.6, 41.9], [47.6, 43], [47.4, 43.9]];
const BLACK_SEA = [[38, 44.8], [39.7, 43.6], [41, 43], [41.67, 42.15], [41.6, 41.6], [40.5, 41], [39, 41.1],
  [38, 41], [37, 41], [37, 44.8]];

export const project = (lon, lat) => [((lon - 38) / 52) * 1000, ((48 - lat) / 12) * 320];

// Положение груза по модельному времени t и текущей фазе маршрута.
export function positionOf(s, meta) {
  const route = meta.routes[s.route_id];
  const at = id => project(meta.nodes[id].lon, meta.nodes[id].lat);
  if (!s.started) return at(route.nodes[0]);
  if (s.delivered) return at(route.nodes.at(-1));
  const ph = route.plan.phases[Math.min(s.cursor, route.plan.phases.length - 1)];
  if (ph.kind === 'dwell') return at(ph.node);
  const k = Math.min(1, Math.max(0, (s.t - ph.start) / (ph.end - ph.start)));
  const [x1, y1] = at(ph.from);
  const [x2, y2] = at(ph.to);
  return [x1 + (x2 - x1) * k, y1 + (y2 - y1) * k];
}

export function createMap(svg, meta, onSelect) {
  const poly = (pts, cls) => `<polygon class="${cls}" points="${pts.map(([lon, lat]) => project(lon, lat).map(v => v.toFixed(1)).join(',')).join(' ')}"/>`;
  const region = (text, lon, lat) => { const [x, y] = project(lon, lat); return `<text class="region" x="${x}" y="${y}">${text}</text>`; };

  const edges = new Map();
  for (const route of Object.values(meta.routes)) {
    route.nodes.slice(1).forEach((to, i) => {
      const from = route.nodes[i];
      edges.set([from, to].sort().join('-'), { from, to, mode: route.legs[i].mode });
    });
  }
  const edgeSvg = [...edges.values()].map(e => {
    const [x1, y1] = project(meta.nodes[e.from].lon, meta.nodes[e.from].lat);
    const [x2, y2] = project(meta.nodes[e.to].lon, meta.nodes[e.to].lat);
    return `<line class="edge ${e.mode}" data-a="${e.from}" data-b="${e.to}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }).join('');
  const nodeSvg = Object.values(meta.nodes).map(n => {
    const [x, y] = project(n.lon, n.lat);
    return `<circle class="node ${n.type} ${n.customs ? 'customs' : ''}" cx="${x}" cy="${y}" r="${n.type === 'transit' ? 3.5 : 6}"><title>${n.name}${n.customs ? ' — таможенный контроль' : ''}</title></circle>
      <text class="node-label" x="${x + n.label[0]}" y="${y + n.label[1]}">${n.name}</text>`;
  }).join('');

  svg.setAttribute('viewBox', '0 0 1000 320');
  svg.innerHTML = `${poly(CASPIAN, 'sea')}${poly(BLACK_SEA, 'sea')}
    ${region('КАЗАХСТАН', 60, 47.2)}${region('КНР', 84.5, 47.2)}${region('КАСПИЙ', 50.2, 38.6)}
    <g>${edgeSvg}</g><g>${nodeSvg}</g><g class="cargo-layer"></g>`;
  const layer = svg.querySelector('.cargo-layer');

  layer.addEventListener('click', e => {
    const m = e.target.closest('[data-number]');
    if (m && onSelect) onSelect(m.dataset.number);
  });

  return {
    update(shipments, selected) {
      const sel = shipments.find(s => s.number === selected);
      const onRoute = new Set();
      if (sel) {
        const nodes = meta.routes[sel.route_id].nodes;
        nodes.slice(1).forEach((to, i) => onRoute.add([nodes[i], to].sort().join('-')));
      }
      svg.querySelectorAll('.edge').forEach(el => el.classList.toggle('hl', onRoute.has([el.dataset.a, el.dataset.b].sort().join('-'))));

      // Маркеры создаются один раз и дальше только сдвигаются: CSS-переход делает движение плавным.
      const seen = new Set();
      for (const s of shipments) {
        seen.add(s.number);
        let g = layer.querySelector(`[data-number="${s.number}"]`);
        if (!g) {
          g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          g.dataset.number = s.number;
          g.classList.add('marker');
          g.innerHTML = `<circle class="pulse" r="8"/><circle class="dot" r="7"/><title></title>`;
          layer.append(g);
        }
        const [x, y] = positionOf(s, meta);
        g.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        g.classList.toggle('sel', s.number === selected);
        g.classList.toggle('held', s.status.code === 'held');
        g.querySelector('title').textContent = `${s.number} · ${s.cargo.description} · ${s.status.label}`;
      }
      layer.querySelectorAll('[data-number]').forEach(g => { if (!seen.has(g.dataset.number)) g.remove(); });
      if (sel) layer.append(layer.querySelector(`[data-number="${sel.number}"]`));  // выбранный поверх остальных
    },
  };
}

export const mapLegend = `<div class="legend">
  <span><i class="lg rail"></i>Ж/д</span><span><i class="lg ferry"></i>Паром</span>
  <span><i class="lg customs"></i>Таможня</span><span><i class="lg dot"></i>Груз</span>
  <span><i class="lg dot held"></i>Ждёт ЭД</span></div>`;
