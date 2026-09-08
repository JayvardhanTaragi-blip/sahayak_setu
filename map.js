/**
 * map.js — MapLibre GL JS map for SahayakSetu dashboard.
 *
 * Requires: maplibre-gl@4.7.1 (UMD build, loaded before this file)
 * Requires: api.js (window.API.maps.workers / geocode / route)
 *
 * Key fixes applied:
 *  - Uses v4.7.1 CDN which actually has maplibre-gl.js (v5/v6 are ESM-only)
 *  - Uses a raster OSM tile style that renders at street zoom level
 *  - map.resize() called after load to handle any layout-driven sizing issue
 */

console.log('[MAP] map.js loaded');
console.log('[MAP] MapLibre available:', typeof maplibregl);
console.log('[MAP] container el:', document.getElementById('map'));

// A raster-tile style using public OSM tiles.
// This renders streets, buildings, labels at all zoom levels — unlike
// demotiles.maplibre.org/globe.json which only shows country outlines.
// For production replace with a MapTiler / Stadia / self-hosted tile URL.
const OSM_STYLE = {
    version: 8,
    sources: {
        osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }
    },
    layers: [{
        id: 'osm-tiles',
        type: 'raster',
        source: 'osm',
        minzoom: 0,
        maxzoom: 19
    }]
};

console.log('[MAP] initializing map...');

let map;
try {
    map = new maplibregl.Map({
        container: 'map',
        style: OSM_STYLE,
        center: [73.7909, 20.0113],   // [longitude, latitude] — Nashik, until the API says otherwise
        zoom: 12,
        attributionControl: true
    });
} catch (err) {
    console.error('[MAP] Failed to initialize map:', err);
}

if (map) {
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.addControl(
        new maplibregl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: true
        })
    );

    let currentCustomerLngLat = null;
    let currentCustomerMarker = null;

    // ── Workers ──────────────────────────────────────────────────────────────

    async function loadWorkers() {
        try {
            const payload = await window.API.maps.pins();
            const workers = payload.workers || [];
            console.log('[MAP API] workers received:', workers);

            // The API centres on the workers it actually returned, so the map
            // follows the data instead of a city hardcoded above.
            if (payload.center && Number.isFinite(payload.center.lat)) {
                map.jumpTo({ center: [payload.center.lng, payload.center.lat], zoom: 12 });
            }

            workers.forEach(worker => {
                const popupEl = document.createElement('div');
                popupEl.style.cssText = 'font-family:Karla,sans-serif;min-width:160px;';
                popupEl.innerHTML = `
                    <strong style="display:block;margin-bottom:4px;">${worker.name}</strong>
                    <span style="color:#6a6a62;">Service: ${worker.skill}</span><br>
                    <span style="color:#6a6a62;">Rating: ⭐ ${worker.rating}${worker.reviews ? ` (${worker.reviews})` : ''}</span><br>
                    <button
                        onclick="handleShowRoute(${worker.latitude}, ${worker.longitude})"
                        style="margin-top:8px;padding:4px 10px;background:#1f5140;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;">
                        View Route
                    </button>
                `;

                new maplibregl.Marker({ color: '#1f5140' })
                    .setLngLat([worker.longitude, worker.latitude])
                    .setPopup(new maplibregl.Popup({ offset: 25 }).setDOMContent(popupEl))
                    .addTo(map);
            });
        } catch (error) {
            console.error('[MAP] Worker loading error:', error);
        }
    }

    map.on('load', () => {
        console.log('[MAP] map loaded successfully ✓');
        map.resize();   // fix any 0-height race condition from layout
        loadWorkers();
    });

    map.on('error', (e) => {
        console.error('[MAP] MapLibre error event:', e);
    });

    // ── Location search ───────────────────────────────────────────────────────

    const searchBtn = document.getElementById('searchLocation');
    if (searchBtn) {
        searchBtn.addEventListener('click', async () => {
            const input = document.getElementById('locationInput');
            const address = (input && input.value || '').trim();
            if (!address) return;

            try {
                const results = await window.API.maps.geocode(address);
                if (!results || !results.length) {
                    alert('Location not found. Try a more specific address.');
                    return;
                }

                const location = results[0];
                const longitude = Number(location.lon);
                const latitude  = Number(location.lat);

                currentCustomerLngLat = [longitude, latitude];

                map.flyTo({ center: [longitude, latitude], zoom: 14 });

                if (currentCustomerMarker) currentCustomerMarker.remove();

                const customerEl = document.createElement('div');
                customerEl.innerHTML = `
                    <strong style="display:block;margin-bottom:2px;">📍 Your Location</strong>
                    <span style="color:#6a6a62;font-size:12px;">${location.display_name}</span>
                `;

                currentCustomerMarker = new maplibregl.Marker({ color: '#ea4335' })
                    .setLngLat([longitude, latitude])
                    .setPopup(new maplibregl.Popup({ offset: 25 }).setDOMContent(customerEl))
                    .addTo(map);

            } catch (error) {
                console.error('[MAP] Search error:', error);
                alert('Could not search location: ' + error.message);
            }
        });
    }

    // Allow Enter key in search box
    const locationInput = document.getElementById('locationInput');
    if (locationInput) {
        locationInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('searchLocation')?.click();
        });
    }

    // ── Routing ───────────────────────────────────────────────────────────────

    window.handleShowRoute = async function(workerLat, workerLng) {
        if (!currentCustomerLngLat) {
            alert('Please search for your location first, then click View Route.');
            return;
        }

        try {
            const start = { lat: workerLat, lng: workerLng };
            const end   = { lat: currentCustomerLngLat[1], lng: currentCustomerLngLat[0] };

            const data = await window.API.maps.route(start, end);
            console.log('[MAP] route data:', data);

            const geojsonData = { type: 'Feature', geometry: data.geometry };

            if (map.getSource('worker-route')) {
                map.getSource('worker-route').setData(geojsonData);
            } else {
                map.addSource('worker-route', { type: 'geojson', data: geojsonData });
                map.addLayer({
                    id: 'worker-route-line',
                    type: 'line',
                    source: 'worker-route',
                    layout: { 'line-cap': 'round', 'line-join': 'round' },
                    paint: { 'line-color': '#0b57d0', 'line-width': 5, 'line-opacity': 0.85 }
                });
            }

            const coords = data.geometry.coordinates;
            const bounds = coords.reduce(
                (b, c) => b.extend(c),
                new maplibregl.LngLatBounds(coords[0], coords[0])
            );
            map.fitBounds(bounds, { padding: 60 });

            const km = (data.distance / 1000).toFixed(1);
            const min = Math.round(data.duration / 60);
            console.log(`[MAP] Route: ${km} km, ~${min} min`);

        } catch (error) {
            console.error('[MAP] Routing error:', error);
            alert('Could not calculate route: ' + error.message);
        }
    };
}
