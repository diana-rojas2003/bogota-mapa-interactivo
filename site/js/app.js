/* ==========================
   Mapa interactivo de Bogotá
   app.js
   ========================== */

(function () {
  'use strict';

  // --------------------------------------------------------------------------
  // Configuración
  // --------------------------------------------------------------------------
  const MAP_CENTER = [4.66, -74.07];
  const MAP_ZOOM = 11;
  const DATA_DIR = 'data';
  const BOGOTA_BOUNDS = [[3.5, -74.6], [5.1, -73.7]]; // [[south, west], [north, east]]

  // Capas que usan agrupamiento de marcadores (SITP tiene 7604 paraderos)
  const CLUSTER_LAYERS = new Set(['paraderos_sitp']);

  // Capas activadas por defecto al cargar el mapa
  const DEFAULT_ACTIVE_LAYERS = new Set(['estaciones_tm', 'paraderos_sitp']);

  // --------------------------------------------------------------------------
  // Utilidades
  // --------------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  function formatValue(value, formato, unidad) {
    if (value == null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    let out;
    if (formato === 'numero') {
      out = n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    } else if (formato === 'decimal') {
      out = n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else if (formato === 'entero') {
      out = n.toLocaleString('es-CO');
    } else {
      out = String(value);
    }
    return unidad ? `${out} ${escapeHtml(unidad)}` : out;
  }

  function buildPopup(feature, popupCfg) {
    const props = feature.properties || {};
    let title = '';
    const rows = [];
    popupCfg.forEach((item) => {
      const v = props[item.campo];
      if (v == null || v === '') return;
      if (!title) title = String(v);
      const disp = formatValue(v, item.formato, item.unidad);
      rows.push(
        `<div class="popup-row">` +
        `<span class="popup-label">${escapeHtml(item.etiqueta)}:</span>` +
        `<span class="popup-value">${escapeHtml(disp)}</span>` +
        `</div>`
      );
    });
    const t = escapeHtml(title || 'Elemento');
    return (
      `<div class="popup"><strong>${t}</strong>` +
      rows.join('') +
      `</div>`
    );
  }

  // --------------------------------------------------------------------------
  // Estado de la aplicación
  // --------------------------------------------------------------------------
  let manifest = null;
  let map = null;
  let layerControl = null;
  const layersState = {}; // key -> { key, cfg, container, geojson, loaded, loading, failed, count, active }
  window._debug = { layersState, getMap: () => map };

  // --------------------------------------------------------------------------
  // Mapa base
  // --------------------------------------------------------------------------
  function initMap() {
    map = L.map('map', {
      center: MAP_CENTER,
      zoom: MAP_ZOOM,
      maxBounds: BOGOTA_BOUNDS,
      maxBoundsViscosity: 1.0,
      preferCanvas: true,
      zoomControl: true,
    });

    const baseLayers = {
      'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }),
      'Carto Positron': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
      }),
    };
    layerControl = L.control.layers(baseLayers).addTo(map);
    baseLayers['OpenStreetMap'].addTo(map);

    return map;
  }

  // --------------------------------------------------------------------------
  // Capas temáticas
  // --------------------------------------------------------------------------
  function styleFor(cfg, feature) {
    const isPoint = cfg.geometry === 'point';
    if (isPoint) {
      return {
        radius: 6,
        weight: 1.5,
        color: '#ffffff',
        fillColor: cfg.color,
        fillOpacity: 0.92,
        opacity: 0.9,
      };
    }
    const weight = cfg.key === 'ciclorrutas' ? 2 : 1.5;
    return {
      color: cfg.color,
      weight,
      fillColor: cfg.color,
      fillOpacity: 0.3,
      opacity: 0.9,
    };
  }

  function pointToLayer(cfg, latlng) {
    return L.circleMarker(latlng, styleFor(cfg, null));
  }

  function onEachFeature(cfg) {
    return function (feature, layer) {
      const popupCfg = cfg.popup || [];
      const html = buildPopup(feature, popupCfg);
      if (html.trim()) {
        layer.bindPopup(html, { direction: 'auto', className: 'bogota-popup' });
      }
    };
  }

  async function loadLayer(key) {
    const state = layersState[key];
    if (!state || state.loaded || state.loading || state.failed) return state;
    state.loading = true;
    updateLayerUI(key);
    showInfo(`Cargando ${state.cfg.titulo}…`);

    try {
      const response = await fetch(`${DATA_DIR}/${state.cfg.archivo}`, {
        headers: { 'Accept': 'application/geo+json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!(data && data.type === 'FeatureCollection')) {
        throw new Error('Respuesta no es una FeatureCollection');
      }

      const isPoint = state.cfg.geometry === 'point';
      const useCluster = CLUSTER_LAYERS.has(key);
      const container = useCluster
        ? L.markerClusterGroup({
            showCoverageOnHover: false,
            spiderfyOnMaxZoom: false,
            disableClusteringAtZoom: 16,
          })
        : L.featureGroup();

      const geojson = L.geoJSON(data, {
        style: (f) => styleFor(state.cfg, f),
        pointToLayer: (feature, latlng) => pointToLayer(state.cfg, latlng),
        onEachFeature: onEachFeature(state.cfg),
      }).addTo(container);

      state.container = container;
      state.geojson = geojson;
      state.count = data.features.length;
      state.loaded = true;
      state.loading = false;

      // Si la capa debe estar activa, añadirla al mapa
      if (state.active && map && !map.hasLayer(container)) {
        container.addTo(map);
      }
      updateLayerUI(key);
      updateLegend();
      updateTotal();
      showInfo(`${state.cfg.titulo} cargada (${state.count.toLocaleString('es-CO')} elementos)`, 2500);
    } catch (err) {
      console.error(`Error cargando capa ${key}:`, err);
      state.failed = true;
      state.loading = false;
      state.error = err.message + ' --- ' + (err.stack || '');
      updateLayerUI(key);
      showInfo(`Error cargando ${state.cfg.titulo}: ${err.message}`, 4000);
    }
    return state;
  }

  function toggleLayer(key, checked) {
    const state = layersState[key];
    if (!state) return;
    state.active = Boolean(checked);
    if (checked) {
      if (state.failed) return;
      if (!state.loaded) {
        loadLayer(key);
      } else if (state.container && map && !map.hasLayer(state.container)) {
        state.container.addTo(map);
      }
    } else if (state.container && map && map.hasLayer(state.container)) {
      map.removeLayer(state.container);
    }
    updateLayerUI(key);
    updateLegend();
    updateTotal();
  }

  function zoomToLayer(key) {
    const state = layersState[key];
    if (!state) return;
    const target = state.geojson || state.container;
    if (!target || typeof target.getBounds !== 'function') return;
    try {
      const bounds = target.getBounds();
      if (bounds && bounds.isValid && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 60], maxZoom: 15 });
      }
    } catch (err) {
      // Ignorar si no hay coordenadas válidas
    }
  }

  // --------------------------------------------------------------------------
  // Interfaz: panel de capas
  // --------------------------------------------------------------------------
  function renderLayerList() {
    const list = $('#layer-list');
    list.innerHTML = '';
    const order = Object.keys(layersState);
    order.forEach((key) => {
      const state = layersState[key];
      const cfg = state.cfg;
      const isActive = Boolean(state.active);

      const item = document.createElement('div');
      item.className = 'layer-item' + (isActive ? ' active' : '') + (state.failed ? ' failed' : '');

      const marker = document.createElement('div');
      marker.className = 'layer-marker';
      marker.style.backgroundColor = cfg.color;
      if (cfg.geometry === 'point') marker.style.borderRadius = '50%';

      const isAttached = state.container && map && map.hasLayer(state.container);
      const check = document.createElement('span');
      check.className = 'layer-check';
      check.textContent = '✓';
      check.style.display = isAttached ? 'block' : 'none';

      const body = document.createElement('div');
      body.className = 'layer-body';

      const title = document.createElement('div');
      title.className = 'layer-title';
      title.textContent = cfg.titulo;

      const sub = document.createElement('div');
      sub.className = 'layer-sub';
      sub.textContent = cfg.fuente;

      const count = document.createElement('div');
      count.className = 'layer-count';
      count.textContent = state.loaded ? `${state.count.toLocaleString('es-CO')} elementos` : state.failed ? 'error' : (state.loading ? 'cargando…' : '—');

      body.appendChild(title);
      body.appendChild(sub);
      body.appendChild(count);

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.layer = key;
      input.checked = isActive;
      input.disabled = Boolean(state.failed);
      input.addEventListener('change', (e) => toggleLayer(key, e.target.checked));

      item.appendChild(input);
      item.appendChild(marker);
      item.appendChild(check);
      item.appendChild(body);

      item.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        input.checked = !input.checked;
        input.dispatchEvent(new Event('change'));
      });

      // Doble clic para acercar a la capa
      item.addEventListener('dblclick', () => zoomToLayer(key));

      const btnZoom = document.createElement('button');
      btnZoom.type = 'button';
      btnZoom.className = 'btn-zoom-layer';
      btnZoom.title = `Acercar a ${cfg.titulo}`;
      btnZoom.textContent = '☐';
      btnZoom.addEventListener('click', (e) => {
        e.stopPropagation();
        zoomToLayer(key);
      });

      item.appendChild(btnZoom);
      list.appendChild(item);
    });
  }

  function updateLayerUI(key) {
    const state = layersState[key];
    if (!state) return;
    const input = $(`input[data-layer="${key}"]`);
    if (!input) return;
    const item = input.closest('.layer-item');
    if (!item) return;
    const isAttached = Boolean(state.container && map && map.hasLayer(state.container));
    item.classList.toggle('active', Boolean(state.active));
    item.classList.toggle('failed', Boolean(state.failed));
    const check = item.querySelector('.layer-check');
    if (check) check.style.display = isAttached ? 'block' : 'none';
    const count = item.querySelector('.layer-count');
    if (count) {
      if (state.failed) count.textContent = 'error';
      else if (state.loading) count.textContent = 'cargando…';
      else if (state.loaded) count.textContent = `${state.count.toLocaleString('es-CO')} elementos`;
      else count.textContent = '—';
    }
    input.checked = Boolean(state.active);
    input.disabled = Boolean(state.failed);
  }

  // --------------------------------------------------------------------------
  // Leyenda dinámica
  // --------------------------------------------------------------------------
  function updateLegend() {
    const body = $('#legend-body');
    if (!body) return;
    body.innerHTML = '';
    let any = false;
    Object.keys(layersState).forEach((key) => {
      const state = layersState[key];
      if (!(state.container && map && map.hasLayer(state.container))) return;
      any = true;
      const entry = document.createElement('div');
      entry.className = 'legend-entry';
      const swatch = document.createElement('div');
      swatch.className = 'legend-swatch';
      if (state.cfg.geometry === 'point') swatch.classList.add('legend-point');
      swatch.style.backgroundColor = state.cfg.color;
      const label = document.createElement('div');
      label.className = 'legend-label';
      label.textContent = state.cfg.titulo;
      const count = document.createElement('div');
      count.className = 'legend-count';
      count.textContent = state.count ? `${state.count.toLocaleString('es-CO')}` : '0';
      entry.appendChild(swatch);
      entry.appendChild(label);
      entry.appendChild(count);
      body.appendChild(entry);
    });
    if (!any) {
      const p = document.createElement('p');
      p.className = 'legend-empty';
      p.textContent = 'Ninguna capa activa.';
      body.appendChild(p);
    }
    $('#legend').classList.toggle('hidden', false);
  }

  // --------------------------------------------------------------------------
  // Totales y avisos
  // --------------------------------------------------------------------------
  function updateTotal() {
    let total = 0;
    Object.keys(layersState).forEach((key) => {
      const state = layersState[key];
      if (state.container && map && map.hasLayer(state.container)) total += state.count || 0;
    });
    const chip = $('#chip-total');
    if (chip) chip.textContent = total ? `${total.toLocaleString('es-CO')} elementos` : 'Sin capas activas';

    // Para trazabilidad y tests
    let debugEl = $('#debug-state');
    if (!debugEl) {
      debugEl = document.createElement('div');
      debugEl.id = 'debug-state';
      debugEl.hidden = true;
      document.body.appendChild(debugEl);
    }
    const summary = {};
    Object.keys(layersState).forEach(k => {
      const s = layersState[k];
      summary[k] = {
        loaded: s.loaded,
        loading: s.loading,
        failed: s.failed,
        error: s.error,
        count: s.count,
        active: s.active,
        onMap: Boolean(s.container && map && map.hasLayer(s.container))
      };
    });
    debugEl.textContent = JSON.stringify({ total, summary, mapReady: Boolean(window.__MAP_READY__) });
  }

  let infoTimer = null;
  function showInfo(text, ms = 3000) {
    const el = $('#floating-info');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    if (infoTimer) clearTimeout(infoTimer);
    infoTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  // --------------------------------------------------------------------------
  // Pie de fuentes
  // --------------------------------------------------------------------------
  function renderSources() {
    const detail = $('#sources-detail');
    if (!detail || !manifest) return;
    const gen = manifest.generated_at ? new Date(manifest.generated_at).toLocaleString('es-CO') : '—';
    let html = `<p><strong>Generado:</strong> ${escapeHtml(gen)}</p>`;
    html += `<p><strong>CRS:</strong> ${escapeHtml(manifest.crs || 'EPSG:4326')}</p>`;
    html += `<ul>`;
    Object.values(manifest.layers || {}).forEach((l) => {
      html += `<li><strong>${escapeHtml(l.titulo)}</strong> — ${escapeHtml(l.archivo)} (${l.features.toLocaleString('es-CO')} elementos). Fuente: ${escapeHtml(l.fuente)}.</li>`;
    });
    html += `</ul>`;
    html += `<p style="font-size:11px; margin-top:8px;">Datos obtenidos por script y versionados en el repositorio.</p>`;
    detail.innerHTML = html;
  }

  // --------------------------------------------------------------------------
  // Inicialización
  // --------------------------------------------------------------------------
  async function init() {
    // Cargar manifest
    try {
      const res = await fetch(`${DATA_DIR}/manifest.json`, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
      manifest = await res.json();
    } catch (err) {
      console.error('No se pudo cargar manifest.json:', err);
      showInfo('No se pudo cargar el catálogo de datos.', 5000);
      return;
    }

    // Crear entradas de estado en el orden del manifest
    const layers = manifest.layers || {};
    const order = ['localidades', 'ciclorrutas', 'estaciones_tm', 'paraderos_sitp', 'parques'];
    (order.filter((k) => layers[k])).forEach((key) => {
      layersState[key] = {
        key,
        cfg: layers[key],
        container: null,
        geojson: null,
        loaded: false,
        loading: false,
        failed: false,
        count: 0,
        active: DEFAULT_ACTIVE_LAYERS.has(key)
      };
    });

    renderSources();
    renderLayerList();
    initMap();

    // Iniciar carga de capas activas por defecto
    const loadPromises = [];
    for (const key of DEFAULT_ACTIVE_LAYERS) {
      if (layersState[key]) {
        loadPromises.push(loadLayer(key));
      }
    }
    await Promise.allSettled(loadPromises);

    updateTotal();
    updateLegend();
    window.__MAP_READY__ = true;
    window.dispatchEvent(new CustomEvent('map:ready', {
      detail: {
        activeLayers: Array.from(DEFAULT_ACTIVE_LAYERS),
        layersState
      }
    }));

    // Panel móvil
    const btnToggle = $('#btn-panel-toggle');
    const btnClose = $('#btn-close-panel');
    const panel = $('#layers-panel');
    const btnCloseLegend = $('#btn-close-legend');
    const legend = $('#legend');
    const btnSources = $('#btn-sources');
    const detail = $('#sources-detail');
    const btnReset = $('#btn-reset');

    if (btnToggle) {
      btnToggle.addEventListener('click', () => panel.classList.toggle('open'));
    }
    if (btnClose) {
      btnClose.addEventListener('click', () => panel.classList.remove('open'));
    }
    if (btnCloseLegend) {
      btnCloseLegend.addEventListener('click', () => legend.classList.add('hidden'));
    }
    if (btnSources) {
      btnSources.addEventListener('click', () => {
        const expanded = btnSources.getAttribute('aria-expanded') === 'true';
        btnSources.setAttribute('aria-expanded', String(!expanded));
        detail.hidden = expanded;
        if (!expanded) btnSources.textContent = 'Ocultar fuentes ▾';
        else btnSources.textContent = 'Fuentes de datos ▾';
      });
    }
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (map) map.setView(MAP_CENTER, MAP_ZOOM);
      });
    }

    const defaultNames = Array.from(DEFAULT_ACTIVE_LAYERS)
      .map((k) => layersState[k]?.cfg?.titulo || k);
    showInfo(`Mapa listo. Capas activas: ${defaultNames.join(', ')}`, 3500);
  }

  // Arranque
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
