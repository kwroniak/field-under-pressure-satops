/*
 * Holy Crop – symulacja przejazdu ciągnika po mapie dawek (VRA).
 *
 * W popupie pola pojawia się przycisk „Symulacja przejazdu”. Panel pozwala:
 *  - wgrać mapę dawek (GeoJSON, poligony z atrybutem dawki N w kg/ha: dose_kg_n_ha | dose | rate),
 *  - albo uruchomić tryb testowy (3 pasy z dawką bazową −20% / 0 / +20%, wyraźnie oznaczony),
 * a potem animuje przejazd: ścieżki robocze co szerokość roboczą (pług przemienny),
 * ślad nawożenia w kolorze dawki, licznik zużycia nawozu i porównanie z dawką jednolitą.
 */
(() => {
    if (window.hc_tractor_loaded) return;
    window.hc_tractor_loaded = true;

    const N_CONTENT = {saletra_amonowa: 0.34, mocznik_inhibitor: 0.46, rsm_32: 0.32, saletrosan_26: 0.26};
    const CLASS_COLORS = {
        low: 'rgba(250,214,92,0.75)',
        mid: 'rgba(132,204,96,0.75)',
        high: 'rgba(36,138,84,0.8)',
    };

    const style = document.createElement('style');
    style.textContent = `
    .hc-tractor-btn{margin-top:12px;width:100%;height:42px;border-radius:12px;border:1px solid #7fe3c4;background:#1f4a3b;color:#e6fff5;font:600 15px system-ui,sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px}
    .hc-tractor-btn:hover{background:#25604b}
    .hc-tractor-btn svg{width:22px;height:22px}
    .hc-trk-panel{position:absolute;right:84px;top:16px;z-index:20;width:330px;background:#141c2bee;color:#e8edf5;border:1px solid #33415a;border-radius:16px;padding:16px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 10px 30px #0008}
    .hc-trk-panel h4{margin:0 0 10px;font-size:17px;display:flex;justify-content:space-between;align-items:center}
    .hc-trk-panel h4 button{background:none;border:0;color:#b8c4d6;font-size:20px;cursor:pointer}
    .hc-trk-row{display:flex;gap:10px;margin:8px 0;align-items:center}
    .hc-trk-row label{flex:1;font-size:13px;color:#b8c4d6}
    .hc-trk-row input[type=number],.hc-trk-row select{width:110px;height:32px;border-radius:8px;border:1px solid #33415a;background:#1b2436;color:#e8edf5;padding:0 8px}
    .hc-trk-file{display:block;width:100%;margin:6px 0;font-size:13px;color:#b8c4d6}
    .hc-trk-actions{display:flex;gap:8px;margin-top:12px}
    .hc-trk-actions button{flex:1;height:38px;border-radius:10px;border:1px solid #33415a;background:#1b2436;color:#e8edf5;font:600 14px system-ui,sans-serif;cursor:pointer}
    .hc-trk-actions button.hc-primary{background:#2fbf8f;border-color:#2fbf8f;color:#0d1a14}
    .hc-trk-actions button:disabled{opacity:.45;cursor:default}
    .hc-trk-note{font-size:12px;color:#e8c95a;margin-top:6px}
    .hc-trk-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
    .hc-trk-stats div{background:#1b2436;border:1px solid #33415a;border-radius:10px;padding:8px 10px}
    .hc-trk-stats small{display:block;font-size:11px;color:#9baac0}
    .hc-trk-stats strong{font-size:17px}
    .hc-trk-bar{height:6px;border-radius:3px;background:#33415a;margin-top:12px;overflow:hidden}
    .hc-trk-bar span{display:block;height:100%;width:0;background:#7fe3c4}
    .hc-trk-summary{margin-top:12px;padding:10px 12px;border-radius:10px;background:#1f4a3b;border:1px solid #7fe3c4;font-size:14px}
    .hc-trk-legend{display:flex;gap:10px;font-size:12px;color:#b8c4d6;margin-top:8px}
    .hc-trk-legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:4px;vertical-align:-2px}
    .hc-tractor{position:absolute;z-index:6;pointer-events:none;transform-origin:50% 50%}
    .hc-tractor .hc-boom{position:absolute;left:50%;top:50%;height:4px;background:#7fe3c4;border-radius:2px;transform:translate(-50%,10px);box-shadow:0 0 8px #7fe3c4}
    .hc-tractor svg{position:absolute;left:50%;top:50%;width:30px;height:40px;transform:translate(-50%,-50%);filter:drop-shadow(0 2px 3px #000a)}
    `;
    document.head.append(style);

    const TRACTOR_SVG = '<svg viewBox="0 0 30 40" aria-hidden="true"><rect x="2" y="22" width="7" height="14" rx="2" fill="#1c2a1e"/><rect x="21" y="22" width="7" height="14" rx="2" fill="#1c2a1e"/><rect x="4" y="4" width="5" height="8" rx="1.5" fill="#1c2a1e"/><rect x="21" y="4" width="5" height="8" rx="1.5" fill="#1c2a1e"/><path d="M9 3h12v20h4v14H5V23h4Z" fill="#2fbf8f" stroke="#e6fff5" stroke-width="1.2"/><rect x="10" y="24" width="10" height="8" rx="1.5" fill="#cfe9c0"/></svg>';
    const BTN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="7" cy="17" r="3"/><circle cx="18" cy="18" r="2"/><path d="M4 14V8h7l2 6h5l2 4M11 8V5h3"/></svg>';

    const getMap = () => window.lizMap?.mainLizmap?.map;
    let sim = null; // stan bieżącej symulacji

    /* ---------- geometria ---------- */

    function polygonsOf(geometry) {
        const type = geometry.getType();
        if (type === 'Polygon') return [geometry.getCoordinates()];
        if (type === 'MultiPolygon') return geometry.getCoordinates();
        return [];
    }

    function longestEdgeAngle(polygons) {
        let best = 0, angle = 0;
        for (const polygon of polygons) {
            const ring = polygon[0];
            for (let i = 0; i < ring.length - 1; i++) {
                const dx = ring[i + 1][0] - ring[i][0], dy = ring[i + 1][1] - ring[i][1];
                const len = Math.hypot(dx, dy);
                if (len > best) { best = len; angle = Math.atan2(dy, dx); }
            }
        }
        return angle;
    }

    const rotate = (p, c, a) => {
        const cos = Math.cos(a), sin = Math.sin(a), x = p[0] - c[0], y = p[1] - c[1];
        return [c[0] + x * cos - y * sin, c[1] + x * sin + y * cos];
    };

    // Ścieżki robocze (pług przemienny): linie równoległe do najdłuższego boku, co szerokość roboczą
    function buildPath(polygons, width_map) {
        const all = polygons.flat(2);
        const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
        const center = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
        const angle = longestEdgeAngle(polygons);
        const rings = polygons.flatMap(polygon => polygon.map(ring => ring.map(p => rotate(p, center, -angle))));
        const ry = rings.flat().map(p => p[1]);
        const y_min = Math.min(...ry), y_max = Math.max(...ry);
        const path = [];
        let line = 0;
        for (let y = y_min + width_map / 2; y < y_max; y += width_map, line++) {
            const hits = [];
            for (const ring of rings) {
                for (let i = 0; i < ring.length - 1; i++) {
                    const [a, b] = [ring[i], ring[i + 1]];
                    if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
                        hits.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
                    }
                }
            }
            hits.sort((p, q) => p - q);
            const segments = [];
            for (let i = 0; i + 1 < hits.length; i += 2) {
                if (hits[i + 1] - hits[i] > width_map * 0.3) segments.push([hits[i], hits[i + 1]]);
            }
            if (line % 2) segments.reverse().forEach(s => s.reverse());
            for (const [x0, x1] of segments) {
                path.push({p: rotate([x0, y], center, angle), work: false});
                path.push({p: rotate([x1, y], center, angle), work: true});
            }
        }
        let total = 0;
        path.forEach((node, i) => {
            if (i) total += Math.hypot(node.p[0] - path[i - 1].p[0], node.p[1] - path[i - 1].p[1]);
            node.d = total;
        });
        return {path, total, center, angle};
    }

    function pointAt(path, distance) {
        let i = 1;
        while (i < path.length - 1 && path[i].d < distance) i++;
        const a = path[i - 1], b = path[i];
        const t = b.d > a.d ? Math.min(1, Math.max(0, (distance - a.d) / (b.d - a.d))) : 1;
        return {
            p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t],
            heading: Math.atan2(b.p[1] - a.p[1], b.p[0] - a.p[0]),
            work: b.work,
        };
    }

    /* ---------- dawki ---------- */

    function doseFromProps(props) {
        for (const key of ['dose_kg_n_ha', 'dose_n', 'dose', 'rate', 'dawka']) {
            const value = Number(props?.[key]);
            if (Number.isFinite(value)) return value;
        }
        return null;
    }

    function doseAt(coordinate) {
        if (sim.test_mode) {
            const local = rotate(coordinate, sim.route.center, -sim.route.angle);
            const third = (local[1] - sim.y_range[0]) / (sim.y_range[1] - sim.y_range[0]);
            return sim.base * (third < 1 / 3 ? 0.8 : third < 2 / 3 ? 1 : 1.2);
        }
        const zone = sim.zones.find(z => z.geometry.intersectsCoordinate(coordinate));
        return zone ? zone.dose : sim.base;
    }

    const doseClass = dose => dose < sim.base * 0.95 ? 'low' : dose > sim.base * 1.05 ? 'high' : 'mid';

    function readZones(map, geojson_text) {
        const geojson = JSON.parse(geojson_text);
        const crs = JSON.stringify(geojson.crs || '');
        const projection = /3857|900913/.test(crs) ? 'EPSG:3857' : 'EPSG:4326';
        map.setHighlightFeatures(geojson, 'geojson', projection);
        const features = map._highlightLayer.getSource().getFeatures().map(f => f.clone());
        map.clearHighlightFeatures();
        return features
            .map(f => ({geometry: f.getGeometry(), dose: doseFromProps(f.getProperties())}))
            .filter(z => z.geometry && z.dose !== null);
    }

    /* ---------- warstwy i znacznik ---------- */

    function makeLayers(map) {
        const highlight = map._highlightLayer;
        const layers = {};
        for (const [key, color] of Object.entries(CLASS_COLORS)) {
            layers[key] = new highlight.constructor({
                source: new (highlight.getSource().constructor)(),
                style: {'fill-color': color},
            });
            layers[key].setZIndex(990);
            map.addLayer(layers[key]);
        }
        return layers;
    }

    function addTrailPiece(from, to) {
        const dx = to[0] - from[0], dy = to[1] - from[1], len = Math.hypot(dx, dy);
        if (!len) return;
        const nx = -dy / len * sim.width_map / 2, ny = dx / len * sim.width_map / 2;
        const ring = [[from[0] + nx, from[1] + ny], [to[0] + nx, to[1] + ny], [to[0] - nx, to[1] - ny], [from[0] - nx, from[1] - ny], [from[0] + nx, from[1] + ny]];
        const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
        const dose = doseAt(mid);
        const area_ha = len * sim.width_map * sim.scale2 / 10000;
        sim.area_ha += area_ha;
        sim.n_vra += dose * area_ha;
        sim.n_uniform += sim.base * area_ha;
        sim.dose_now = dose;
        const feature = new sim.Feature({geometry: new sim.Polygon([ring])});
        sim.layers[doseClass(dose)].getSource().addFeature(feature);
    }

    function placeTractor() {
        const map = getMap();
        if (!sim?.marker || !map) return;
        const pixel = map.getPixelFromCoordinate(sim.pos);
        if (!pixel) return;
        const resolution = map.getView().getResolution();
        const rotation = map.getView().getRotation();
        sim.marker.style.left = pixel[0] + 'px';
        sim.marker.style.top = pixel[1] + 'px';
        sim.marker.style.transform = `rotate(${90 - (sim.heading - rotation) * 180 / Math.PI}deg)`;
        const boom = sim.marker.querySelector('.hc-boom');
        boom.style.width = Math.max(30, sim.width_map / resolution) + 'px';
        boom.style.opacity = sim.working ? 1 : 0.25;
    }

    /* ---------- panel ---------- */

    const fmt = (v, d = 1) => v.toLocaleString('pl-PL', {minimumFractionDigits: d, maximumFractionDigits: d});

    function updateStats() {
        const panel = sim.panel;
        const product_vra = sim.n_vra / sim.n_content, product_uniform = sim.n_uniform / sim.n_content;
        panel.querySelector('[data-k=dose]').textContent = `${fmt(sim.dose_now || 0, 0)} kg N/ha`;
        panel.querySelector('[data-k=area]').textContent = `${fmt(sim.area_ha, 2)} ha`;
        panel.querySelector('[data-k=n]').textContent = `${fmt(sim.n_vra, 0)} kg N`;
        panel.querySelector('[data-k=product]').textContent = `${fmt(product_vra, 0)} kg`;
        panel.querySelector('.hc-trk-bar span').style.width = `${Math.min(100, sim.distance / sim.route.total * 100)}%`;
        if (sim.done) {
            const saved_kg = product_uniform - product_vra;
            const price = Number(panel.querySelector('[data-in=price]').value);
            const money = Number.isFinite(price) && price > 0 ? ` ≈ <b>${fmt(saved_kg * price / 1000, 0)} zł</b>` : '';
            const summary = panel.querySelector('.hc-trk-summary');
            summary.hidden = false;
            summary.innerHTML = `Dawka jednolita: ${fmt(product_uniform, 0)} kg nawozu.<br>Dawka zmienna: ${fmt(product_vra, 0)} kg.<br>` +
                (saved_kg >= 0 ? `Różnica: <b>${fmt(saved_kg, 0)} kg mniej</b>${money}` : `Różnica: ${fmt(-saved_kg, 0)} kg więcej (strategia wyrównawcza)`);
        }
    }

    function stopSim(remove_trail) {
        if (!sim) return;
        cancelAnimationFrame(sim.frame);
        sim.running = false;
        if (remove_trail) {
            Object.values(sim.layers || {}).forEach(layer => getMap()?.removeLayer(layer));
            sim.marker?.remove();
            sim.panel?.remove();
            getMap()?.un('postrender', placeTractor);
            sim = null;
        }
    }

    // Ślad nawożenia między dwiema odległościami na trasie: tylko odcinki robocze, w kawałkach ok. 6 m,
    // każdy kawałek w obrębie jednego odcinka (bez ukośnych kawałków na nawrotach)
    function spread(from_d, to_d) {
        const path = sim.route.path;
        const lerp = (i, x) => {
            const a = path[i - 1], b = path[i], t = (x - a.d) / (b.d - a.d);
            return [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t];
        };
        for (let i = 1; i < path.length; i++) {
            const s0 = path[i - 1].d, s1 = path[i].d;
            if (!path[i].work || s1 <= from_d || s0 >= to_d || s1 <= s0) continue;
            let a = Math.max(s0, from_d);
            const end = Math.min(s1, to_d);
            while (a < end - 1e-6) {
                const b = Math.min(end, a + 6 * sim.k);
                addTrailPiece(lerp(i, a), lerp(i, b));
                a = b;
            }
        }
    }

    function step(now) {
        if (!sim?.running) return;
        const dt = Math.min(0.1, (now - (sim.last || now)) / 1000);
        sim.last = now;
        const meters_per_s = sim.speed_kmh / 3.6 * sim.multiplier;
        const next_distance = Math.min(sim.route.total, sim.distance + meters_per_s * dt * sim.k);
        spread(sim.distance, next_distance);
        sim.distance = next_distance;
        const here = pointAt(sim.route.path, sim.distance);
        sim.pos = here.p;
        sim.heading = here.heading;
        sim.working = here.work;
        placeTractor();
        updateStats();
        if (sim.distance >= sim.route.total) {
            sim.done = true;
            sim.running = false;
            updateStats();
            sim.panel.querySelector('[data-act=start]').textContent = 'Od nowa';
            return;
        }
        sim.frame = requestAnimationFrame(step);
    }

    function openPanel(field_feature, field_id, fertilizer) {
        const map = getMap();
        stopSim(true);
        const panel = document.createElement('div');
        panel.className = 'hc-trk-panel';
        panel.innerHTML = `
          <h4><span>Symulacja przejazdu · pole ${field_id}</span><button type="button" aria-label="Zamknij">×</button></h4>
          <label class="hc-trk-row"><span style="flex:1;font-size:13px;color:#b8c4d6">Mapa dawek (GeoJSON)</span></label>
          <input class="hc-trk-file" type="file" accept=".geojson,.json,application/geo+json">
          <div class="hc-trk-row"><label>Dawka bazowa (kg N/ha)</label><input type="number" data-in="base" value="60" min="0" step="5"></div>
          <div class="hc-trk-row"><label>Szerokość robocza (m)</label><input type="number" data-in="width" value="24" min="6" step="1"></div>
          <div class="hc-trk-row"><label>Prędkość (km/h)</label><input type="number" data-in="speed" value="12" min="2" step="1"></div>
          <div class="hc-trk-row"><label>Przyspieszenie animacji</label><select data-in="mult"><option value="20">×20</option><option value="40" selected>×40</option><option value="80">×80</option></select></div>
          <div class="hc-trk-row"><label>Cena nawozu (zł/t, opcjonalnie)</label><input type="number" data-in="price" min="0" step="10" placeholder="—"></div>
          <div class="hc-trk-note" data-k="mode">Brak mapy dawek: start uruchomi tryb testowy (3 pasy, dawki ±20%, nie z satelity).</div>
          <div class="hc-trk-actions"><button type="button" class="hc-primary" data-act="start">Start</button><button type="button" data-act="pause" disabled>Pauza</button><button type="button" data-act="clear">Wyczyść</button></div>
          <div class="hc-trk-bar"><span></span></div>
          <div class="hc-trk-stats">
            <div><small>Dawka teraz</small><strong data-k="dose">—</strong></div>
            <div><small>Obsiana powierzchnia</small><strong data-k="area">0 ha</strong></div>
            <div><small>Azot (N)</small><strong data-k="n">0 kg N</strong></div>
            <div><small>Nawóz (produkt)</small><strong data-k="product">0 kg</strong></div>
          </div>
          <div class="hc-trk-legend"><span><i style="background:${CLASS_COLORS.low}"></i>niższa</span><span><i style="background:${CLASS_COLORS.mid}"></i>bazowa</span><span><i style="background:${CLASS_COLORS.high}"></i>wyższa</span></div>
          <div class="hc-trk-summary" hidden></div>`;
        map.getViewport().append(panel);

        let zones = [];
        const mode_note = panel.querySelector('[data-k=mode]');
        panel.querySelector('h4 button').onclick = () => stopSim(true);
        panel.querySelector('.hc-trk-file').onchange = async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
                zones = readZones(map, await file.text());
                mode_note.style.color = zones.length ? '#7fe3c4' : '#ef7b85';
                mode_note.textContent = zones.length
                    ? `Wczytano ${zones.length} stref z dawkami z pliku ${file.name}.`
                    : 'W pliku nie ma poligonów z dawką (dose_kg_n_ha / dose / rate).';
            } catch (error) {
                zones = [];
                mode_note.style.color = '#ef7b85';
                mode_note.textContent = `Nie udało się odczytać pliku: ${error.message}`;
            }
        };

        const start = () => {
            const value = key => Number(panel.querySelector(`[data-in=${key}]`).value);
            const polygons = polygonsOf(field_feature.getGeometry());
            if (!polygons.length) return;
            const lat = Math.atan(Math.sinh(field_feature.getGeometry().getExtent()[1] / 6378137));
            const k = 1 / Math.cos(lat); // metry w terenie -> jednostki EPSG:3857
            Object.values(sim?.layers || {}).forEach(layer => map.removeLayer(layer));
            sim?.marker?.remove();
            const width_map = Math.max(6, value('width')) * k;
            const route = buildPath(polygons, width_map);
            const local_y = polygons.flat(2).map(p => rotate(p, route.center, -route.angle)[1]);
            const polygon_ctor = field_feature.getGeometry().getType() === 'Polygon'
                ? field_feature.getGeometry().constructor
                : field_feature.getGeometry().getPolygon(0).constructor;
            const marker = document.createElement('div');
            marker.className = 'hc-tractor';
            marker.innerHTML = `<div class="hc-boom"></div>${TRACTOR_SVG}`;
            map.getViewport().append(marker);
            const previous_panel = panel;
            sim = {
                panel: previous_panel, marker, route, k, scale2: 1 / (k * k), width_map,
                base: Math.max(0, value('base')), speed_kmh: Math.max(2, value('speed')), multiplier: value('mult'),
                n_content: N_CONTENT[fertilizer] || 0.34,
                zones, test_mode: !zones.length, y_range: [Math.min(...local_y), Math.max(...local_y)],
                layers: makeLayers(map), Feature: field_feature.constructor, Polygon: polygon_ctor,
                distance: 0, area_ha: 0, n_vra: 0, n_uniform: 0, dose_now: 0,
                pos: route.path[0]?.p, heading: 0, running: true, done: false, last: 0,
            };
            if (sim.test_mode) {
                mode_note.style.color = '#e8c95a';
                mode_note.textContent = 'Tryb testowy: 3 pasy z dawką −20% / bazowa / +20%. To nie są dawki z satelity.';
            }
            panel.querySelector('.hc-trk-summary').hidden = true;
            panel.querySelector('[data-act=pause]').disabled = false;
            panel.querySelector('[data-act=pause]').textContent = 'Pauza';
            panel.querySelector('[data-act=start]').textContent = 'Start';
            map.on('postrender', placeTractor);
            map.getView().fit(field_feature.getGeometry().getExtent(), {padding: [80, 440, 80, 380], duration: 400});
            sim.frame = requestAnimationFrame(step);
        };

        panel.querySelector('[data-act=start]').onclick = start;
        panel.querySelector('[data-act=pause]').onclick = event => {
            if (!sim || sim.done) return;
            sim.running = !sim.running;
            event.target.textContent = sim.running ? 'Pauza' : 'Wznów';
            if (sim.running) { sim.last = 0; sim.frame = requestAnimationFrame(step); }
        };
        panel.querySelector('[data-act=clear]').onclick = () => {
            stopSim(false);
            Object.values(sim?.layers || {}).forEach(layer => layer.getSource().clear());
            sim?.marker?.remove();
            if (sim) sim.marker = null;
            panel.querySelector('.hc-trk-summary').hidden = true;
            panel.querySelector('[data-act=pause]').disabled = true;
        };
        sim = {panel, layers: {}};
    }

    /* ---------- przycisk w popupie pola ---------- */

    function fieldFeatureFromPopup(feature_div) {
        const map = getMap();
        const wkt = feature_div?.querySelector('.lizmap-popup-layer-feature-geometry')?.value;
        if (!map || !wkt) return null;
        const crs = feature_div.querySelector('.lizmap-popup-layer-feature-crs')?.value || 'EPSG:3857';
        map.setHighlightFeatures(wkt, 'wkt', crs);
        const feature = map._highlightLayer.getSource().getFeatures()[0]?.clone();
        map.clearHighlightFeatures();
        return feature || null;
    }

    function addButtons() {
        document.querySelectorAll('#popupcontent .lizmapPopupSingleFeature[data-layer-id^="fields_"]').forEach(feature_div => {
            const context = feature_div.querySelector('.hc-context');
            if (!context || context.querySelector('.hc-tractor-btn')) return;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'hc-tractor-btn';
            button.innerHTML = `${BTN_ICON}<span>Symulacja przejazdu</span>`;
            button.onclick = () => {
                const feature = fieldFeatureFromPopup(feature_div);
                if (!feature) return;
                const fertilizer = context.querySelector('.fc-fertilizer')?.value || 'saletra_amonowa';
                openPanel(feature, feature_div.dataset.featureId, fertilizer);
            };
            context.append(button);
        });
    }

    function start() {
        if (!window.lizMap?.events || !getMap()) { setTimeout(start, 500); return; }
        lizMap.events.on({lizmappopupdisplayed: () => setTimeout(addButtons, 50)});
        addButtons();
    }
    start();
})();
