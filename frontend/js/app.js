// Configuración inicial del Cliente API (resiliente a despliegue local o file://)
const API_BASE = window.location.protocol.startsWith('http')
    ? window.location.origin
    : 'https://ayuda-venezuela-backend-291864207498.us-central1.run.app';
let gaMetricsData = null;
let lastConnectivityData = null;

// Elementos del DOM
const reportForm = document.getElementById('reportForm');
const typeSelect = document.getElementById('type');
const urgencySelect = document.getElementById('urgency');
const missingSubform = document.getElementById('missingSubform');
const btnGPS = document.getElementById('btnGPS');
const btnSyncIA = document.getElementById('btnSyncIA');
const reportsList = document.getElementById('reportsList');
const reportsCount = document.getElementById('reportsCount');
const heroReportsCount = document.getElementById('heroReportsCount');
const heroCentersCount = document.getElementById('heroCentersCount');
const collectionCenterForm = document.getElementById('collectionCenterForm');
const btnCenterGPS = document.getElementById('btnCenterGPS');
const btnCenterSubmit = document.getElementById('btnCenterSubmit');
const btnFindNearest = document.getElementById('btnFindNearest');
const centersCount = document.getElementById('centersCount');
const centersList = document.getElementById('centersList');
const nearestCenter = document.getElementById('nearestCenter');
const filterChips = document.querySelectorAll('.dashboard-actions .filter-chip');
const mobileActionLinks = document.querySelectorAll('.mobile-quick-actions a');
const btnToggleExternalFrame = document.getElementById('btnToggleExternalFrame');
const externalFrameWrap = document.getElementById('externalFrameWrap');
const externalFrame = document.getElementById('externalFrame');
const missingImportForm = document.getElementById('missingImportForm');
const missingImportFile = document.getElementById('missingImportFile');
const missingImportJson = document.getElementById('missingImportJson');
const btnImportMissing = document.getElementById('btnImportMissing');
const missingImportSummary = document.getElementById('missingImportSummary');
const missingSyncStatus = document.getElementById('missingSyncStatus');
const btnScrapeMissing = document.getElementById('btnScrapeMissing');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

// Estado global de la vista
let currentFilter = 'all';
let collectionCenters = [];
let centerSearchQuery = '';
let activeCenterChipFilter = 'all';
let allLoadedReports = [];
let incidentsSearchQuery = '';
let userPosition = null;
let centersMap = null;
let centersLayer = null;
let userMarker = null;
let leafletLoadPromise = null;
let centersMapRequested = false;

// Mostrar subformulario dinámico si es desaparecido
if (typeSelect && missingSubform) {
    typeSelect.addEventListener('change', () => {
        if (typeSelect.value === 'desaparecido') {
            missingSubform.style.display = 'block';
            document.getElementById('mp_name').setAttribute('required', 'true');
        } else {
            missingSubform.style.display = 'none';
            document.getElementById('mp_name').removeAttribute('required');
        }
    });
}

// Capturar GPS
if (btnGPS) {
    btnGPS.addEventListener('click', () => {
        if (navigator.geolocation) {
            btnGPS.textContent = '⏳ Geolocalizando...';
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    document.getElementById('lat').value = position.coords.latitude.toFixed(6);
                    document.getElementById('lng').value = position.coords.longitude.toFixed(6);
                    btnGPS.textContent = '✅ GPS Capturado';
                    showToast('Coordenadas capturadas exitosamente.', 'success');
                },
                (error) => {
                    console.error(error);
                    btnGPS.textContent = '❌ Error GPS';
                    showToast('No se pudo acceder al GPS. Ingresa las coordenadas manualmente o usa la referencia de texto.', 'error');
                },
                { enableHighAccuracy: true, timeout: 5000 }
            );
        } else {
            showToast('El GPS no está soportado por tu dispositivo.', 'error');
        }
    });
}

if (btnCenterGPS) {
    btnCenterGPS.addEventListener('click', () => {
        if (!navigator.geolocation) {
            showToast('El GPS no está soportado por tu dispositivo.', 'error');
            return;
        }

        btnCenterGPS.textContent = '⏳ Geolocalizando...';
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                document.getElementById('center_lat').value = lat.toFixed(6);
                document.getElementById('center_lng').value = lng.toFixed(6);
                btnCenterGPS.textContent = '✅ GPS Capturado';
                requestCentersMap();
                if (centersMap) {
                    centersMap.setView([lat, lng], 14);
                }
                showToast('Coordenadas del centro capturadas.', 'success');
            },
            (error) => {
                console.error(error);
                btnCenterGPS.textContent = '❌ Error GPS';
                showToast('No se pudo acceder al GPS. Ingresa latitud y longitud manualmente.', 'error');
            },
            { enableHighAccuracy: true, timeout: 5000 }
        );
    });
}

if (btnFindNearest) {
    btnFindNearest.addEventListener('click', () => {
        if (!navigator.geolocation) {
            showToast('El GPS no está soportado por tu dispositivo.', 'error');
            return;
        }

        btnFindNearest.disabled = true;
        btnFindNearest.textContent = 'Calculando ubicación...';
        navigator.geolocation.getCurrentPosition(
            (position) => {
                userPosition = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                btnFindNearest.disabled = false;
                btnFindNearest.textContent = 'Encontrar centro más cercano';
                requestCentersMap();
                updateUserMarker();
                renderCollectionCenters();
                focusNearestCenter();
                showToast('Centro más cercano calculado.', 'success');
            },
            (error) => {
                console.error(error);
                btnFindNearest.disabled = false;
                btnFindNearest.textContent = 'Encontrar centro más cercano';
                showToast('No se pudo usar tu ubicación para calcular distancia.', 'error');
            },
            { enableHighAccuracy: true, timeout: 7000 }
        );
    });
}

const centerSearchInput = document.getElementById('centerSearchInput');
const btnClearSearch = document.getElementById('btnClearSearch');
const chipFilters = document.querySelectorAll('.chip-filter');

if (chipFilters.length > 0) {
    chipFilters.forEach(chip => {
        chip.addEventListener('click', () => {
            chipFilters.forEach(c => {
                c.classList.remove('active');
                c.style.background = 'var(--surface-default)';
                c.style.color = 'var(--text-secondary)';
                c.style.fontWeight = 'normal';
            });
            chip.classList.add('active');
            chip.style.background = 'var(--surface-muted)';
            chip.style.color = 'var(--text-primary)';
            chip.style.fontWeight = '600';
            
            activeCenterChipFilter = chip.getAttribute('data-filter');
            renderCollectionCenters();
        });
    });
}

if (centerSearchInput) {
    centerSearchInput.addEventListener('input', () => {
        centerSearchQuery = centerSearchInput.value;
        if (btnClearSearch) {
            btnClearSearch.style.display = centerSearchQuery ? 'block' : 'none';
        }
        renderCollectionCenters();
    });
}

if (btnClearSearch) {
    btnClearSearch.addEventListener('click', () => {
        if (centerSearchInput) centerSearchInput.value = '';
        centerSearchQuery = '';
        btnClearSearch.style.display = 'none';
        renderCollectionCenters();
    });
}

const incidentsSearchInput = document.getElementById('incidentsSearchInput');
if (incidentsSearchInput) {
    incidentsSearchInput.addEventListener('input', () => {
        incidentsSearchQuery = incidentsSearchInput.value;
        applyReportsSearchAndFilter();
    });
}

if (collectionCenterForm) {
    collectionCenterForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const lat = parseFloat(document.getElementById('center_lat').value);
        const lng = parseFloat(document.getElementById('center_lng').value);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            showToast('El centro necesita coordenadas GPS válidas para mostrarse en el mapa.', 'error');
            return;
        }

        const payload = {
            name: document.getElementById('center_name').value,
            location_text: document.getElementById('center_location').value,
            lat,
            lng,
            capacity_status: document.getElementById('center_status').value,
            schedule: document.getElementById('center_schedule').value || null,
            supplies: document.getElementById('center_supplies').value || null,
            contact_info: document.getElementById('center_contact').value || null
        };

        if (btnCenterSubmit) {
            btnCenterSubmit.disabled = true;
            btnCenterSubmit.textContent = 'Guardando...';
        }

        try {
            const res = await fetch(`${API_BASE}/api/collection-centers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (btnCenterSubmit) {
                btnCenterSubmit.disabled = false;
                btnCenterSubmit.textContent = 'Guardar centro de acopio';
            }

            if (data.success) {
                showToast('Centro de acopio registrado.', 'success');
                collectionCenterForm.reset();
                if (btnCenterGPS) btnCenterGPS.textContent = '📍 Usar mi ubicación para el centro';
                loadCollectionCenters();
            } else {
                showToast(`Error: ${data.error}`, 'error');
            }
        } catch (err) {
            console.error(err);
            if (btnCenterSubmit) {
                btnCenterSubmit.disabled = false;
                btnCenterSubmit.textContent = 'Guardar centro de acopio';
            }
            showToast('Error de conexión. Centro no guardado.', 'error');
        }
    });
}

if (btnToggleExternalFrame) {
    btnToggleExternalFrame.addEventListener('click', () => {
        const isOpen = externalFrameWrap.classList.toggle('show');
        if (isOpen && !externalFrame.src) {
            externalFrame.src = 'https://desaparecidosterremotovenezuela.com/';
        }
        btnToggleExternalFrame.textContent = isOpen ? 'Ocultar sitio original' : 'Ver sitio original aquí';
    });
}

if (missingImportFile) {
    missingImportFile.addEventListener('change', async () => {
        const file = missingImportFile.files && missingImportFile.files[0];
        if (!file) return;

        try {
            missingImportJson.value = await file.text();
        } catch (error) {
            console.error(error);
            showToast('No se pudo leer el archivo JSON.', 'error');
        }
    });
}

if (missingImportForm) {
    missingImportForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        let payload;
        try {
            payload = JSON.parse(missingImportJson.value);
        } catch {
            showToast('El JSON no es válido.', 'error');
            return;
        }

        if (btnImportMissing) {
            btnImportMissing.disabled = true;
            btnImportMissing.textContent = 'Importando...';
        }
        if (missingImportSummary) {
            missingImportSummary.style.display = 'block';
            missingImportSummary.textContent = 'Procesando registros y buscando duplicados...';
        }

        try {
            const body = Array.isArray(payload)
                ? { source: 'desaparecidosterremotovenezuela.com', items: payload }
                : { source: 'desaparecidosterremotovenezuela.com', ...payload };

            const res = await fetch(`${API_BASE}/api/import/missing-persons`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();

            if (btnImportMissing) {
                btnImportMissing.disabled = false;
                btnImportMissing.textContent = 'Importar y quitar duplicados';
            }

            if (!data.success) {
                if (missingImportSummary) missingImportSummary.innerHTML = `<strong>Error:</strong> ${escapeHTML(data.error || 'No se pudo importar.')}`;
                showToast('No se pudo importar la base externa.', 'error');
                return;
            }

            if (missingImportSummary) {
                missingImportSummary.innerHTML = `
                    <strong>Importación lista.</strong><br>
                    Recibidos: ${data.received}. Nuevos: ${data.created}. Duplicados fusionados: ${data.merged_duplicates}. Localizados omitidos: ${data.skipped_resolved}. Inválidos: ${data.skipped_invalid}. Errores: ${data.errors}.
                `;
            }
            showToast('Base externa importada y deduplicada.', 'success');
            loadReports();
        } catch (error) {
            console.error(error);
            if (btnImportMissing) {
                btnImportMissing.disabled = false;
                btnImportMissing.textContent = 'Importar y quitar duplicados';
            }
            if (missingImportSummary) missingImportSummary.innerHTML = '<strong>Error:</strong> No se pudo conectar con el servidor.';
            showToast('Error de conexión al importar.', 'error');
        }
    });
}

if (btnScrapeMissing) {
    btnScrapeMissing.addEventListener('click', async () => {
        btnScrapeMissing.disabled = true;
        const originalText = btnScrapeMissing.textContent;
        btnScrapeMissing.textContent = 'Sincronizando con IA...';
        if (missingImportSummary) {
            missingImportSummary.style.display = 'block';
            missingImportSummary.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span class="pulse" style="display: inline-block; width: 8px; height: 8px; background: #7c3aed; border-radius: 50%;"></span>
                    <span>Sincronizando desaparecidosterremotovenezuela.com vía ScrapeGraphAI + Gemini (esto puede tardar de 25 a 45 segundos)...</span>
                </div>
            `;
        }
        
        try {
            const res = await fetch(`${API_BASE}/api/import/missing-persons/sync`, {
                method: 'POST'
            });
            const data = await res.json();
            
            btnScrapeMissing.disabled = false;
            btnScrapeMissing.textContent = originalText;
            
            if (!data.success) {
                const errMsg = data.error || (data.summary && data.summary.error) || 'No se pudo completar la sincronización.';
                if (missingImportSummary) missingImportSummary.innerHTML = `<strong>Error de Sincronización:</strong> ${escapeHTML(errMsg)}`;
                showToast('Fallo en la sincronización con IA.', 'error');
                loadMissingSyncStatus();
                return;
            }
            
            const summary = data.summary || {};
            if (missingImportSummary) {
                missingImportSummary.innerHTML = `
                    <strong>Sincronización con IA Completada.</strong><br>
                    Recibidos: ${summary.received ?? 0}. Nuevos: ${summary.created ?? 0}. Duplicados fusionados: ${summary.merged_duplicates ?? 0}. Localizados omitidos: ${summary.skipped_resolved ?? 0}. Errores: ${summary.errors ?? 0}.
                `;
            }
            showToast('Base externa sincronizada con IA.', 'success');
            loadReports();
            loadMissingSyncStatus();
        } catch (error) {
            console.error(error);
            btnScrapeMissing.disabled = false;
            btnScrapeMissing.textContent = originalText;
            if (missingImportSummary) missingImportSummary.innerHTML = '<strong>Error:</strong> No se pudo comunicar con el servidor para iniciar la sincronización.';
            showToast('Error de red al iniciar sincronización.', 'error');
            loadMissingSyncStatus();
        }
    });
}

function loadLeafletAssets() {
    if (window.L) return Promise.resolve();
    if (leafletLoadPromise) return leafletLoadPromise;

    leafletLoadPromise = new Promise((resolve, reject) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(css);

        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('No se pudo cargar Leaflet.'));
        document.head.appendChild(script);
    });

    return leafletLoadPromise;
}

async function initCentersMap() {
    const mapElement = document.getElementById('centersMap');
    if (!mapElement) return;

    try {
        await loadLeafletAssets();
    } catch (error) {
        console.error(error);
        mapElement.innerHTML = '<div class="map-fallback">No se pudo cargar el mapa. El listado de centros seguirá disponible.</div>';
        return;
    }

    mapElement.innerHTML = '';
    centersMap = L.map(mapElement, { scrollWheelZoom: false }).setView([10.4806, -66.9036], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
    }).addTo(centersMap);
    centersLayer = L.layerGroup().addTo(centersMap);
    setTimeout(() => centersMap.invalidateSize(), 0);
    updateCenterMarkers();
    updateUserMarker();
}

function requestCentersMap() {
    if (centersMapRequested || centersMap) return;
    centersMapRequested = true;
    initCentersMap();
}

function initCentersMapWhenVisible() {
    const target = document.getElementById('collectionCentersCard');
    if (!target) return;

    if (!('IntersectionObserver' in window)) {
        setTimeout(requestCentersMap, 1200);
        return;
    }

    const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
            requestCentersMap();
            observer.disconnect();
        }
    }, {
        rootMargin: '240px 0px',
        threshold: 0.01
    });

    observer.observe(target);
}

function initMobileNavigation() {
    if (!mobileActionLinks.length) return;

    mobileActionLinks.forEach(link => {
        link.addEventListener('click', () => {
            mobileActionLinks.forEach(item => item.classList.remove('active'));
            link.classList.add('active');
            setTimeout(() => {
                if (centersMap) centersMap.invalidateSize();
            }, 350);
        });
    });

    if (!('IntersectionObserver' in window)) return;

    const sections = [...mobileActionLinks]
        .map(link => document.getElementById(link.dataset.mobileTarget))
        .filter(Boolean);

    const observer = new IntersectionObserver(entries => {
        const visibleEntry = entries
            .filter(entry => entry.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (!visibleEntry) return;

        mobileActionLinks.forEach(link => {
            link.classList.toggle('active', link.dataset.mobileTarget === visibleEntry.target.id);
        });
    }, {
        rootMargin: '-20% 0px -55% 0px',
        threshold: [0.12, 0.35, 0.01]
    });

    sections.forEach(sec => observer.observe(sec));
}

async function loadCollectionCenters() {
    if (!centersList) return;
    try {
        const res = await fetch(`${API_BASE}/api/collection-centers`);
        const responseData = await res.json();
        if (responseData.success) {
            collectionCenters = responseData.data;
            renderCollectionCenters();
        }
    } catch (err) {
        console.error('Error al cargar centros de acopio:', err.message);
    }
}

function getFilteredCenters(sourceList) {
    const sortedList = sourceList || collectionCenters;
    const query = (centerSearchQuery || '').trim().toLowerCase();
    
    let filtered = query
        ? sortedList.filter(c => 
            (c.name || '').toLowerCase().includes(query) || 
            (c.location_text || '').toLowerCase().includes(query) ||
            (c.supplies || '').toLowerCase().includes(query)
          )
        : sortedList;

    if (activeCenterChipFilter !== 'all') {
        if (activeCenterChipFilter === 'operativo') {
            filtered = filtered.filter(c => c.capacity_status === 'operativo');
        } else if (activeCenterChipFilter === 'agua') {
            filtered = filtered.filter(c => 
                (c.supplies || '').toLowerCase().includes('agua') || 
                (c.supplies || '').toLowerCase().includes('líquido') ||
                (c.supplies || '').toLowerCase().includes('hidratación')
            );
        } else if (activeCenterChipFilter === 'alimentos') {
            filtered = filtered.filter(c => 
                (c.supplies || '').toLowerCase().includes('comida') || 
                (c.supplies || '').toLowerCase().includes('alimento') ||
                (c.supplies || '').toLowerCase().includes('enlatado')
            );
        } else if (activeCenterChipFilter === 'medicinas') {
            filtered = filtered.filter(c => 
                (c.supplies || '').toLowerCase().includes('medicina') || 
                (c.supplies || '').toLowerCase().includes('fármaco') ||
                (c.supplies || '').toLowerCase().includes('gasas') ||
                (c.supplies || '').toLowerCase().includes('suero')
            );
        }
    }
    return filtered;
}

function renderCollectionCenters() {
    if (!centersList) return;
    const sortedCenters = getCentersWithDistance();
    const nearest = getNearestCenter();
    const filteredCenters = getFilteredCenters(sortedCenters);

    // Actualizar contador del buscador premium
    const searchResultCount = document.getElementById('searchResultCount');
    if (searchResultCount) {
        searchResultCount.textContent = `Mostrando ${filteredCenters.length} de ${collectionCenters.length}`;
    }

    if (centersCount) {
        centersCount.textContent = centerSearchQuery || activeCenterChipFilter !== 'all'
            ? `${filteredCenters.length} filtrados` 
            : `${collectionCenters.length} activos`;
    }
    
    if (heroCentersCount) heroCentersCount.textContent = collectionCenters.length;
    updateCenterMarkers();
    updateNearestPanel(nearest);

    if (filteredCenters.length === 0) {
        centersList.innerHTML = `
            <div style="padding: 1rem; color: var(--text-secondary); border: 1px dashed var(--border-color); border-radius: 8px; grid-column: span 3; text-align: center;">
                No se encontraron centros que coincidan con los filtros de búsqueda.
            </div>
        `;
        return;
    }

    centersList.innerHTML = filteredCenters.map(center => {
        const capacityStatus = center.capacity_status || 'operativo';
        const distanceText = center.distanceKm !== null ? `<div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">📍 <strong>A ${formatDistance(center.distanceKm)} de ti</strong></div>` : '';
        
        const suppliesText = center.supplies 
            ? `<div class="center-supplies-detail" style="margin: 0.65rem 0; padding: 0.65rem 0.85rem; background: rgba(59, 130, 246, 0.05); border-left: 3px solid #3b82f6; border-radius: 4px; font-size: 0.85rem; color: var(--text-primary);">
                 <strong style="color: #3b82f6;">📦 Insumos Requeridos:</strong> <span style="font-weight: 500;">${escapeHTML(center.supplies)}</span>
               </div>` 
            : '<div style="margin: 0.5rem 0; font-size: 0.8rem; color: var(--text-muted); font-style: italic;">No hay requerimientos activos de insumos registrados.</div>';
            
        const scheduleText = center.schedule ? `<p style="font-size: 0.8rem; margin: 0.25rem 0; display: flex; align-items: center; gap: 0.35rem; color: var(--text-secondary);">⏰ <strong>Horario:</strong> ${escapeHTML(center.schedule)}</p>` : '';
        const contactText = center.contact_info ? `<p style="font-size: 0.8rem; margin: 0.25rem 0; display: flex; align-items: center; gap: 0.35rem; color: var(--text-secondary);">📞 <strong>Contacto:</strong> ${escapeHTML(center.contact_info)}</p>` : '';
        const nearestClass = nearest && nearest.id === center.id ? ' nearest' : '';

        return `
            <article class="center-item${nearestClass}" style="border: 1px solid var(--border-color); border-radius: 10px; padding: 1rem; margin-bottom: 0.75rem; background: var(--surface-default); transition: all 0.2s; box-shadow: 0 2px 6px rgba(0,0,0,0.02);">
                <div style="display: flex; justify-content: space-between; gap: 0.75rem; align-items: flex-start; margin-bottom: 0.5rem;">
                    <h3 style="font-size: 1rem; font-weight: 700; margin: 0; color: var(--text-primary);">${escapeHTML(center.name)}</h3>
                    <span class="capacity-badge capacity-${capacityStatus}" style="flex-shrink: 0;">${formatCapacityStatus(capacityStatus)}</span>
                </div>
                <p style="font-size: 0.85rem; margin: 0.35rem 0; color: var(--text-primary);"><strong>Dirección:</strong> ${escapeHTML(center.location_text)}</p>
                ${distanceText}
                ${suppliesText}
                ${scheduleText}
                ${contactText}
                <div class="center-actions" style="margin-top: 0.75rem; display: flex; justify-content: flex-end; border-top: 1px solid var(--border-color); padding-top: 0.5rem;">
                    <a class="text-link" href="${createDirectionsUrl(center)}" target="_blank" rel="noopener noreferrer" style="font-size: 0.8rem; font-weight: 600; color: #3b82f6; display: flex; align-items: center; gap: 0.25rem;">Abrir ruta en mapa ↗</a>
                </div>
            </article>
        `;
    }).join('');
}

function updateCenterMarkers() {
    if (!centersMap || !centersLayer) return;

    centersLayer.clearLayers();
    const bounds = [];

    const filteredForMarkers = getFilteredCenters(collectionCenters);

    filteredForMarkers.forEach(center => {
        const lat = Number(center.lat);
        const lng = Number(center.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const popup = `
            <strong>${escapeHTML(center.name)}</strong><br>
            ${escapeHTML(center.location_text)}<br>
            <a href="${createDirectionsUrl(center)}" target="_blank" rel="noopener noreferrer">Abrir ruta</a>
        `;

        L.marker([lat, lng]).addTo(centersLayer).bindPopup(popup);
        bounds.push([lat, lng]);
    });

    if (bounds.length > 0) {
        centersMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 13 });
    }

    updateUserMarker();
}

function updateUserMarker() {
    if (!centersMap || !userPosition) return;

    if (userMarker) {
        userMarker.setLatLng([userPosition.lat, userPosition.lng]);
        return;
    }

    userMarker = L.circleMarker([userPosition.lat, userPosition.lng], {
        radius: 8,
        color: '#2563eb',
        fillColor: '#2563eb',
        fillOpacity: 0.8
    }).addTo(centersMap).bindPopup('Tu ubicación aproximada');
}

function updateNearestPanel(nearest) {
    if (!nearestCenter) return;
    if (!userPosition) {
        nearestCenter.textContent = 'Activa tu ubicación para calcular el centro de acopio más cercano.';
        return;
    }

    if (!nearest) {
        nearestCenter.textContent = 'No hay centros de acopio con coordenadas disponibles.';
        return;
    }

    nearestCenter.innerHTML = `
        <strong>Más cercano:</strong> ${escapeHTML(nearest.name)} está a ${formatDistance(nearest.distanceKm)}.
        <a class="text-link" href="${createDirectionsUrl(nearest)}" target="_blank" rel="noopener noreferrer">Ver ruta</a>
    `;
}

function focusNearestCenter() {
    const nearest = getNearestCenter();
    if (!nearest || !centersMap) return;
    centersMap.setView([Number(nearest.lat), Number(nearest.lng)], 14);
}

function getCentersWithDistance() {
    return collectionCenters
        .map(center => {
            const lat = Number(center.lat);
            const lng = Number(center.lng);
            const hasValidCoords = Number.isFinite(lat) && Number.isFinite(lng);
            const distanceKm = userPosition && hasValidCoords
                ? getDistanceKm(userPosition.lat, userPosition.lng, lat, lng)
                : null;
            return { ...center, lat, lng, distanceKm };
        })
        .sort((a, b) => {
            if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
            if (a.distanceKm !== null) return -1;
            if (b.distanceKm !== null) return 1;
            return new Date(b.created_at) - new Date(a.created_at);
        });
}

function getNearestCenter() {
    return getCentersWithDistance().find(center => center.distanceKm !== null) || null;
}

function getDistanceKm(lat1, lng1, lat2, lng2) {
    const toRad = value => value * Math.PI / 180;
    const earthRadiusKm = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
}

function formatDistance(distanceKm) {
    if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`;
    return `${distanceKm.toFixed(1)} km`;
}

function formatCapacityStatus(status) {
    const labels = {
        operativo: 'Operativo',
        alta_demanda: 'Alta demanda',
        sin_capacidad: 'Sin capacidad'
    };
    return labels[status] || 'Operativo';
}

function createDirectionsUrl(center) {
    return `https://www.google.com/maps/dir/?api=1&destination=${Number(center.lat)},${Number(center.lng)}`;
}

// Cargar Reportes
async function loadReports() {
    try {
        let url = `${API_BASE}/api/reports?is_resolved=false`;
        if (currentFilter !== 'all') {
            url += `&type=${currentFilter}`;
        }
        if (currentStateFilter) {
            url += `&state=${encodeURIComponent(currentStateFilter)}`;
        }

        const res = await fetch(url);
        const responseData = await res.json();
        
        if (responseData.success) {
            allLoadedReports = responseData.data;
            applyReportsSearchAndFilter();
        } else {
            if (reportsCount) reportsCount.textContent = 'Error';
            if (heroReportsCount) heroReportsCount.textContent = '--';
            showToast('Error al actualizar incidentes.', 'error');
        }
    } catch (err) {
        console.error(err);
        if (reportsCount) reportsCount.textContent = 'Sin Conexión';
        if (heroReportsCount) heroReportsCount.textContent = '--';
    }
}

// Filtrar localmente por búsqueda
function applyReportsSearchAndFilter() {
    const query = incidentsSearchQuery.toLowerCase().trim();
    let filtered = allLoadedReports;
    
    if (query) {
        filtered = allLoadedReports.filter(r => {
            const titleMatch = r.title && r.title.toLowerCase().includes(query);
            const descMatch = r.description && r.description.toLowerCase().includes(query);
            const locMatch = r.location_text && r.location_text.toLowerCase().includes(query);
            const contactMatch = r.contact_info && r.contact_info.toLowerCase().includes(query);
            
            let mpMatch = false;
            if (r.missing_persons && r.missing_persons.length > 0) {
                mpMatch = r.missing_persons.some(mp => {
                    const nameMatch = mp.full_name && mp.full_name.toLowerCase().includes(query);
                    const physMatch = mp.physical_description && mp.physical_description.toLowerCase().includes(query);
                    const lastSeenMatch = mp.last_seen_location && mp.last_seen_location.toLowerCase().includes(query);
                    return nameMatch || physMatch || lastSeenMatch;
                });
            }
            
            return titleMatch || descMatch || locMatch || contactMatch || mpMatch;
        });
    }
    
    renderReports(filtered);
    if (reportsCount) reportsCount.textContent = `${filtered.length} activos`;
    if (heroReportsCount) heroReportsCount.textContent = filtered.length;
}

// Renderizar Reportes en Pantalla
function renderReports(reports) {
    if (!reportsList) return;
    if (reports.length === 0) {
        reportsList.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: var(--text-secondary); border: 1px dashed var(--border-color); border-radius: 12px;">
                <p style="font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem;">No hay incidentes reportados</p>
                <p style="font-size: 0.85rem;">Todos los incidentes del filtro seleccionado están resueltos o no se han cargado.</p>
            </div>
        `;
        return;
    }

    reportsList.innerHTML = reports.map(r => {
        const dateStr = new Date(r.created_at).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
        
        let missingBox = '';
        if (r.missing_persons && r.missing_persons.length > 0) {
            const filtered = r.missing_persons.filter(mp => {
                if (r.missing_persons.length === 1 && r.title && r.title.toLowerCase().includes(mp.full_name.toLowerCase())) {
                    return false;
                }
                return true;
            });
            if (filtered.length > 0) {
                missingBox = filtered.map(mp => `
                    <div class="missing-box">
                        <h4>🔍 Persona Desaparecida: ${escapeHTML(mp.full_name)}</h4>
                        ${mp.physical_description ? `<p><strong>Físico:</strong> ${escapeHTML(mp.physical_description)}</p>` : ''}
                        ${mp.last_seen_location ? `<p><strong>Visto en:</strong> ${escapeHTML(mp.last_seen_location)}</p>` : ''}
                    </div>
                `).join('');
            }
        }

        // Generar enlaces de fuentes y buscador automatizado de Google Noticias
        let sourcesHTML = '';
        const searchQuery = `terremoto caracas ${r.title || r.type} ${r.location_text}`;
        const googleNewsUrl = `https://news.google.com/search?q=${encodeURIComponent(searchQuery)}&hl=es-419&gl=VE&ceid=VE:es`;

        sourcesHTML = `
            <div class="meta-item" style="grid-column: span 2; margin-top: 0.25rem; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;">
                📰 <strong>Noticias:</strong> 
                <a href="${googleNewsUrl}" target="_blank" style="color: var(--color-success); text-decoration: underline; font-weight: 600; margin-right: 0.5rem;">
                    [Buscar en Google Noticias]
                </a>
        `;

        if (r.source_url) {
            const urls = r.source_url.split(' | ');
            const validUrls = urls.filter(url => 
                url.startsWith('http') && 
                !url.includes('example.com') && 
                !url.includes('twitter.com/user/status') && 
                !url.includes('placeholder.com')
            );

            if (validUrls.length > 0) {
                sourcesHTML += `
                    <span style="color: var(--text-secondary); font-size: 0.75rem;">| Fuentes:</span>
                    ${validUrls.map((url, idx) => `
                        <a href="${escapeHTML(url)}" target="_blank" style="color: var(--color-info); text-decoration: underline; font-weight: 600;">
                            [Fuente ${idx + 1}]
                        </a>
                    `).join('')}
                `;
            }
        }

        sourcesHTML += `</div>`;
        
        // Generar enlace de WhatsApp si el contacto es un teléfono
        const waLink = getWhatsAppLink(r.contact_info, r.title, r.type, r.location_text);

        // Generar enlace de Twitter/X
        const twLink = getTwitterShareLink(r.type, r.location_text, r.description, r.title, r.source_url);

        return `
            <div class="report-card">
                <div class="priority-stripe stripe-${r.urgency}"></div>
                <div class="report-header">
                    <div class="badge-group">
                        <span class="badge badge-urgency-${r.urgency}">${r.urgency}</span>
                        <span class="badge badge-type">${r.type.replace('_', ' ')}</span>
                    </div>
                    <span class="report-time">${dateStr}</span>
                </div>
                
                ${r.title ? `<h3 style="font-size: 1.1rem; font-weight: 800; margin-bottom: 0.5rem; letter-spacing: -0.3px; color: var(--text-primary);">${escapeHTML(r.title)}</h3>` : ''}
                
                <p class="report-desc">${escapeHTML(r.description)}</p>
                
                ${missingBox}

                <div class="report-meta">
                    <div class="meta-item">📍 <strong>Ubicación:</strong> ${escapeHTML(r.location_text)} ${r.state ? `<span style="opacity: 0.8; font-size: 0.75em; background: rgba(255,255,255,0.06); padding: 0.1rem 0.3rem; border-radius: 4px; margin-left: 0.25rem;">${escapeHTML(r.state)}</span>` : ''}</div>
                    ${r.lat && r.lng ? `<div class="meta-item">🌐 <strong>GPS:</strong> ${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}</div>` : ''}
                    
                    <div class="meta-item">
                        📞 <strong>Contacto:</strong> ${r.contact_info ? escapeHTML(r.contact_info) : 'Anónimo'}
                        ${waLink ? `
                            <a href="${waLink}" target="_blank" class="btn-whatsapp">
                                💬 WhatsApp
                            </a>
                        ` : ''}
                        <a href="${twLink}" target="_blank" class="btn-twitter">
                            <svg viewBox="0 0 24 24" style="width: 10px; height: 10px; fill: currentColor;"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                            <span>Compartir X</span>
                        </a>
                    </div>

                    ${sourcesHTML}
                </div>

                <button class="btn btn-secondary" onclick="resolveReport('${r.id}')" style="width: auto; padding: 0.4rem 0.8rem; font-size: 0.8rem; height: auto; margin-top: 0.25rem;">
                    ✓ Marcar como Resuelto
                </button>
            </div>
        `;
    }).join('');
}

// Resolver Reporte
window.resolveReport = async function(id) {
    try {
        const res = await fetch(`${API_BASE}/api/reports/${id}/resolve`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.success) {
            showToast('Incidente resuelto exitosamente.', 'success');
            loadReports();
        } else {
            showToast(`No autorizado: ${data.error}`, 'error');
        }
    } catch (err) {
        showToast('Error de red al intentar resolver.', 'error');
    }
}

// Enviar Formulario de Reporte
if (reportForm) {
    reportForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const type = typeSelect.value;
        const urgency = urgencySelect.value;
        const title = document.getElementById('title').value || null;
        const description = document.getElementById('description').value;
        const location_text = document.getElementById('location_text').value;
        const latVal = document.getElementById('lat').value;
        const lngVal = document.getElementById('lng').value;
        const contact_info = document.getElementById('contact_info').value;
        const state = document.getElementById('state').value;

        const payload = {
            type,
            urgency,
            title,
            description,
            location_text,
            lat: latVal ? parseFloat(latVal) : null,
            lng: lngVal ? parseFloat(lngVal) : null,
            contact_info: contact_info || null,
            state: state || null
        };

        if (type === 'desaparecido') {
            payload.missing_person = {
                full_name: document.getElementById('mp_name').value,
                physical_description: document.getElementById('mp_desc').value || null,
                last_seen_location: document.getElementById('mp_seen').value || null
            };
        }

        const btnSubmit = document.getElementById('btnSubmit');
        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.textContent = 'Enviando...';
        }

        try {
            const res = await fetch(`${API_BASE}/api/reports`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.textContent = '⚠️ Enviar reporte de emergencia';
            }

            if (data.success) {
                if (data.status === 'merged') {
                    showToast('Reporte duplicado detectado. La información ha sido FUSIONADA en el reporte existente.', 'info');
                } else {
                    showToast('Reporte enviado exitosamente.', 'success');
                }
                reportForm.reset();
                if (missingSubform) missingSubform.style.display = 'none';
                if (btnGPS) btnGPS.textContent = '📍 Capturar GPS';
                loadReports();
            } else {
                showToast(`Error: ${data.error}`, 'error');
            }
        } catch (err) {
            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.textContent = '⚠️ Enviar reporte de emergencia';
            }
            showToast('Error de conexión. Reporte no enviado.', 'error');
        }
    });
}

// Sincronizar alertas públicas
if (btnSyncIA) {
    btnSyncIA.addEventListener('click', async () => {
        btnSyncIA.disabled = true;
        btnSyncIA.textContent = '🤖 Buscando alertas públicas...';
        showToast('Buscando alertas públicas. Esto puede tomar unos segundos...', 'info');

        try {
            const res = await fetch(`${API_BASE}/api/sync-external`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();
            btnSyncIA.disabled = false;
            btnSyncIA.textContent = '🤖 Rastrear alertas públicas';

            if (data.success) {
                showToast(`Sincronización completada. Se capturaron ${data.synchronized_records} alertas potenciales con sus fuentes.`, 'success');
                loadReports();
            } else {
                showToast(`Error de sincronización: ${data.error}`, 'error');
            }
        } catch (err) {
            btnSyncIA.disabled = false;
            btnSyncIA.textContent = '🤖 Rastrear alertas públicas';
            showToast('Error de red al rastrear alertas públicas.', 'error');
        }
    });
}

// Control de Filtros
if (filterChips.length > 0) {
    filterChips.forEach(chip => {
        chip.addEventListener('click', () => {
            filterChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentFilter = chip.getAttribute('data-filter');
            loadReports();
        });
    });
}

// Mostrar Notificación Toast
function showToast(message, type = 'info') {
    if (!toast) return;
    toastMessage.textContent = message;
    toast.className = `toast show toast-${type}`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 5000);
}

async function loadMissingSyncStatus() {
    if (!missingSyncStatus) return;

    try {
        const res = await fetch(`${API_BASE}/api/import/missing-persons/status`);
        const data = await res.json();
        const sync = data.sync || {};
        const nextRun = sync.next_run_at
            ? new Date(sync.next_run_at).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
            : null;

        if (!sync.enabled) {
            missingSyncStatus.innerHTML = `
                <strong>Sincronización automática pendiente.</strong><br>
                Se puede activar con un export/API autorizado. Mientras tanto, usa importación JSON manual.
            `;
            return;
        }

        if (sync.last_status === 'error') {
            missingSyncStatus.innerHTML = `
                <strong>Última sincronización con error.</strong><br>
                Se reintentará automáticamente${nextRun ? ` cerca de las ${nextRun}` : ''}. También puedes importar JSON manual.
            `;
            return;
        }

        const summary = sync.last_summary;
        const summaryText = summary
            ? `Último lote: ${summary.created} nuevos, ${summary.merged_duplicates} duplicados fusionados.`
            : 'Esperando primera sincronización.';
        missingSyncStatus.innerHTML = `
            <strong>Sincronización automática activa.</strong><br>
            Revisa la fuente externa cada ${data.interval_minutes || 10} minutos como máximo. ${summaryText}
        `;
    } catch (error) {
        console.error(error);
        missingSyncStatus.innerHTML = `
            <strong>Estado no disponible.</strong><br>
            La importación manual sigue disponible.
        `;
    }
}

// Helper para generar enlace de WhatsApp dinámico
function getWhatsAppLink(contactInfo, title, type, locationText) {
    if (!contactInfo) return null;
    const cleaned = contactInfo.replace(/\D/g, '');
    if (cleaned.length >= 10 && cleaned.length <= 15) {
        let phone = cleaned;
        if (phone.startsWith('0')) {
            phone = '58' + phone.substring(1);
        }
        if (phone.length === 10 && (phone.startsWith('412') || phone.startsWith('414') || phone.startsWith('416') || phone.startsWith('424') || phone.startsWith('426'))) {
            phone = '58' + phone;
        }
        const incident = title || type.replace('_', ' ');
        const message = `Hola, nos comunicamos desde la plataforma de emergencia SismoVenezuela. Vimos tu reporte sobre: "${incident}" en "${locationText}". ¿Dónde se encuentran exactamente y qué ayuda necesitan en este momento?`;
        return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    }
    return null;
}

// Helper para generar enlace de Twitter/X Web Intent
function getTwitterShareLink(type, locationText, description, title, reportUrl) {
    const formattedType = type ? type.replace(/_/g, ' ').toUpperCase() : 'INCIDENTE';
    const incidentName = title ? title.toUpperCase() : formattedType;
    const alertHeader = `🚨 URGENTE: Reporte de ${incidentName} en ${locationText}\n\n`;
    const alertFooter = `\n\nRescate: @PCivil_Ve @paramedicosmtt @bomberos_dc @MirandaPCivil\n#SismoVenezuela #EmergenciaVzla`;

    const maxTextLimit = 280;
    const availableLength = maxTextLimit - alertHeader.length - alertFooter.length;

    let cleanDescription = description || '';
    if (cleanDescription.length > availableLength && availableLength > 10) {
        cleanDescription = cleanDescription.substring(0, availableLength - 3) + '...';
    }

    const fullText = `${alertHeader}${cleanDescription}${alertFooter}`;
    const encodedText = encodeURIComponent(fullText);
    const encodedUrl = encodeURIComponent(reportUrl || window.location.origin);

    return `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`;
}

// Helper para escapar HTML
function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

function scheduleVisibleRefresh(callback, intervalMs) {
    return setInterval(() => {
        if (document.visibilityState === 'visible') {
            callback();
        }
    }, intervalMs);
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        loadReports();
        loadCollectionCenters();
    }
});

let currentStateFilter = null;
const connectivityGrid = document.getElementById('connectivityGrid');
const userStateSelectorContainer = document.getElementById('userStateSelectorContainer');
const userStateSelect = document.getElementById('userStateSelect');

// Carga inicial con refrescos moderados para conexiones lentas.
initCentersMapWhenVisible();
initMobileNavigation();
loadReports();
loadCollectionCenters();
loadMissingSyncStatus();
initConnectivityMonitoring();
loadRecentSeismicEvents();
scheduleVisibleRefresh(loadReports, 60000);
scheduleVisibleRefresh(loadCollectionCenters, 120000);
scheduleVisibleRefresh(loadMissingSyncStatus, 300000);
scheduleVisibleRefresh(loadRecentSeismicEvents, 60000);

function initConnectivityMonitoring() {
    if (!userStateSelectorContainer) return;
    const savedState = localStorage.getItem('user_state');
    if (!savedState) {
        userStateSelectorContainer.style.display = 'flex';
        if (userStateSelect) {
            userStateSelect.addEventListener('change', () => {
                const selectedState = userStateSelect.value;
                if (selectedState) {
                    localStorage.setItem('user_state', selectedState);
                    userStateSelectorContainer.style.display = 'none';
                    sendTelemetryProbe();
                }
            });
        }
    } else {
        sendTelemetryProbe();
        setInterval(sendTelemetryProbe, 60000);
    }

    scheduleVisibleRefresh(loadConnectivityStatus, 30000);
}

async function sendTelemetryProbe() {
    const state = localStorage.getItem('user_state');
    if (!state) return;

    const startTime = performance.now();
    try {
        await fetch(`${API_BASE}/health`, { cache: 'no-store' });
        const duration = Math.round(performance.now() - startTime);

        await fetch(`${API_BASE}/api/telemetry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state, latency_ms: duration })
        });
    } catch (err) {
        console.error('Error de telemetría de red pasiva:', err.message);
    }
}

async function loadGA4Metrics() {
    try {
        const res = await fetch('https://api.vnzl.technolink.tech/api/analytics-metrics');
        const responseData = await res.json();
        if (responseData.success) {
            gaMetricsData = responseData.data;
        }
    } catch (err) {
        console.warn('No se pudieron cargar métricas de GA4 desde el Worker:', err.message);
    }
}

async function loadConnectivityStatus() {
    if (!connectivityGrid) return;
    
    try {
        loadGA4Metrics().then(() => {
            if (lastConnectivityData) {
                renderConnectivityGrid(lastConnectivityData);
                renderConnectivityMap(lastConnectivityData);
            }
        }).catch(err => console.warn('Error en segundo plano al cargar GA4:', err.message));

        const res = await fetch(`${API_BASE}/api/connectivity-status`);
        const responseData = await res.json();
        
        if (responseData.success) {
            lastConnectivityData = responseData.data;
            
            renderConnectivityGrid(responseData.data);
            renderConnectivityMap(responseData.data);
            
            const activeLatencies = responseData.data.filter(item => item.avg_latency !== null).map(item => item.avg_latency);
            const liveAvgLatencyEl = document.getElementById('liveAvgLatency');
            const liveQualityLabelEl = document.getElementById('liveQualityLabel');
            
            if (liveAvgLatencyEl && liveQualityLabelEl) {
                if (activeLatencies.length > 0) {
                    const avg = Math.round(activeLatencies.reduce((sum, val) => sum + val, 0) / activeLatencies.length);
                    liveAvgLatencyEl.textContent = `~${avg} ms`;
                    
                    if (avg < 100) {
                        liveQualityLabelEl.textContent = '🟢 Excelente (Banda Ancha)';
                        liveQualityLabelEl.style.color = 'var(--color-success)';
                    } else if (avg < 500) {
                        liveQualityLabelEl.textContent = '🟡 Aceptable (3G / 4G)';
                        liveQualityLabelEl.style.color = 'var(--color-moderate)';
                    } else if (avg < 2000) {
                        liveQualityLabelEl.textContent = '🟠 Crítico (2G Inestable)';
                        liveQualityLabelEl.style.color = 'var(--color-high)';
                    } else {
                        liveQualityLabelEl.textContent = '🔴 Caído (Sin Salida)';
                        liveQualityLabelEl.style.color = 'var(--color-critical)';
                    }
                } else {
                    liveAvgLatencyEl.textContent = 'Sin datos';
                    liveQualityLabelEl.textContent = '⚪ Sin telemetría';
                    liveQualityLabelEl.style.color = 'var(--text-secondary)';
                }
            }
        }
    } catch (err) {
        console.error('Error al cargar estado de conectividad nacional:', err.message);
    }
}

function renderConnectivityMap(statusData) {
    const mapContainer = document.getElementById('connectivityMapContainer');
    if (!mapContainer) return;

    const stateGrid = {
        "Distrito Capital": { abbr: "DCA", x: 320, y: 130 },
        "Amazonas": { abbr: "AMA", x: 290, y: 400 },
        "Anzoátegui": { abbr: "ANZ", x: 420, y: 210 },
        "Apure": { abbr: "APU", x: 230, y: 290 },
        "Aragua": { abbr: "ARA", x: 300, y: 150 },
        "Barinas": { abbr: "BAR", x: 160, y: 240 },
        "Bolívar": { abbr: "BOL", x: 460, y: 320 },
        "Carabobo": { abbr: "CAR", x: 270, y: 150 },
        "Cojedes": { abbr: "COJ", x: 260, y: 200 },
        "Delta Amacuro": { abbr: "DEL", x: 540, y: 200 },
        "Falcón": { abbr: "FAL", x: 190, y: 80 },
        "Guárico": { abbr: "GUA", x: 320, y: 220 },
        "Lara": { abbr: "LAR", x: 190, y: 150 },
        "Mérida": { abbr: "MER", x: 110, y: 220 },
        "Miranda": { abbr: "MIR", x: 350, y: 140 },
        "Monagas": { abbr: "MON", x: 490, y: 180 },
        "Nueva Esparta": { abbr: "NES", x: 460, y: 100 },
        "Portuguesa": { abbr: "POR", x: 210, y: 210 },
        "Sucre": { abbr: "SUC", x: 470, y: 130 },
        "Táchira": { abbr: "TAC", x: 80, y: 250 },
        "Trujillo": { abbr: "TRU", x: 140, y: 200 },
        "La Guaira": { abbr: "LAG", x: 320, y: 115 },
        "Yaracuy": { abbr: "YAR", x: 230, y: 140 },
        "Zulia": { abbr: "ZUL", x: 120, y: 120 }
    };

    const links = [
        ["Zulia", "Falcón"], ["Zulia", "Lara"], ["Zulia", "Trujillo"],
        ["Táchira", "Mérida"], ["Mérida", "Trujillo"], ["Trujillo", "Portuguesa"],
        ["Barinas", "Apure"], ["Barinas", "Portuguesa"], ["Falcón", "Yaracuy"],
        ["Lara", "Yaracuy"], ["Yaracuy", "Carabobo"], ["Portuguesa", "Cojedes"],
        ["Cojedes", "Carabobo"], ["Carabobo", "Aragua"], ["Aragua", "Distrito Capital"],
        ["Aragua", "Guárico"], ["Distrito Capital", "La Guaira"], ["Distrito Capital", "Miranda"],
        ["Miranda", "Anzoátegui"], ["Guárico", "Anzoátegui"], ["Apure", "Guárico"],
        ["Apure", "Amazonas"], ["Amazonas", "Bolívar"], ["Anzoátegui", "Bolívar"],
        ["Anzoátegui", "Sucre"], ["Anzoátegui", "Monagas"], ["Sucre", "Monagas"],
        ["Monagas", "Delta Amacuro"], ["Nueva Esparta", "Sucre"], ["Delta Amacuro", "Bolívar"]
    ];

    let svgContent = `
        <svg viewBox="0 0 600 440" style="width: 100%; height: auto; max-width: 480px; margin: 0 auto; display: block;">
    `;

    links.forEach(([from, to]) => {
        const p1 = stateGrid[from];
        const p2 = stateGrid[to];
        if (p1 && p2) {
            svgContent += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="var(--border-color)" stroke-width="1.2" stroke-dasharray="3,3" opacity="0.35" style="pointer-events: none;" />`;
        }
    });

    function getStatusColors(status, isActive) {
        let border = 'var(--text-secondary)';
        let fill = 'rgba(120, 120, 120, 0.05)';
        
        if (status === 'estable') {
            border = '#10b981';
            fill = isActive ? 'rgba(16, 185, 129, 0.3)' : 'rgba(16, 185, 129, 0.15)';
        } else if (status === 'degradado') {
            border = '#eab308';
            fill = isActive ? 'rgba(234, 179, 8, 0.3)' : 'rgba(234, 179, 8, 0.15)';
        } else if (status === 'caido') {
            border = '#ef4444';
            fill = isActive ? 'rgba(239, 68, 68, 0.3)' : 'rgba(239, 68, 68, 0.15)';
        }
        
        if (isActive) border = 'var(--color-info)';
        return { border, fill };
    }

    statusData.forEach(item => {
        const coord = stateGrid[item.state];
        if (!coord) return;

        const isActive = currentStateFilter === item.state;
        const colors = getStatusColors(item.status, isActive);
        const strokeWidth = isActive ? '3.5' : '1.5';
        const radius = isActive ? 16 : 14;
        
        // Agregar pulso animado para nodos degradados o caídos
        const pulseClass = (item.status === 'caido' || item.status === 'degradado') ? 'map-node-pulse' : '';

        const gaDataForState = gaMetricsData ? gaMetricsData[item.state] : null;
        const activeUsersText = gaDataForState ? `\n👥 Usuarios Activos GA4: ${gaDataForState.active_users}` : '';

        svgContent += `
            <g class="map-tile" onclick="toggleStateFilter('${escapeHTML(item.state)}')" style="cursor: pointer;">
                <title>${escapeHTML(item.state)}: ${item.status.toUpperCase()} (Latencia: ${item.avg_latency || 'N/A'}ms)${activeUsersText}</title>
                <circle cx="${coord.x}" cy="${coord.y}" r="${radius}" 
                        class="${pulseClass}"
                        fill="${colors.fill}" stroke="${colors.border}" stroke-width="${strokeWidth}" 
                        style="transform-origin: ${coord.x}px ${coord.y}px;" />
                <text x="${coord.x}" y="${coord.y + 3}" 
                      font-family="system-ui, sans-serif" font-size="8.5" font-weight="900" 
                      text-anchor="middle" fill="var(--text-primary)" style="pointer-events: none; text-shadow: 0 1px 2px rgba(0,0,0,0.15);">${coord.abbr}</text>
            </g>
        `;
    });

    svgContent += `</svg>`;
    mapContainer.innerHTML = svgContent;
    
    // Actualizar también el panel de detalles del estado seleccionado (si existe)
    updateStateTelemetryDetail();
}

function renderConnectivityGrid(statusData) {
    if (!connectivityGrid) return;

    connectivityGrid.innerHTML = statusData.map(item => {
        const isActive = currentStateFilter === item.state;
        const cardClass = `state-telemetry-card ${isActive ? 'active-filter' : ''}`;
        const latencyText = item.avg_latency !== null ? `${item.avg_latency} ms` : '--';
        const countText = item.report_count > 0 ? `(${item.report_count} pings)` : '';
        
        const gaDataForState = gaMetricsData ? gaMetricsData[item.state] : null;
        const gaText = gaDataForState ? `<span style="font-size: 0.7rem; opacity: 0.8; margin-left: auto; color: var(--color-info); font-weight: 700;">👥 ${gaDataForState.active_users}</span>` : '';
        
        return `
            <div class="${cardClass}" onclick="toggleStateFilter('${escapeHTML(item.state)}')" title="Filtrar incidentes en ${escapeHTML(item.state)}">
                <div style="display: flex; align-items: center; gap: 0.5rem; font-weight: 600; width: 100%;">
                    <span class="status-indicator status-${item.status}"></span>
                    <span>${escapeHTML(item.state)}</span>
                    ${gaText}
                </div>
                <div style="font-size: 0.75rem; text-align: right; color: var(--text-secondary); margin-top: 0.25rem;">
                    <div>${latencyText}</div>
                    <div style="font-size: 0.65rem; opacity: 0.7;">${countText}</div>
                </div>
            </div>
        `;
    }).join('');
}

function updateStateTelemetryDetail() {
    const stateDetailContent = document.getElementById('stateDetailContent');
    if (!stateDetailContent) return;

    if (currentStateFilter) {
        const item = lastConnectivityData ? lastConnectivityData.find(x => x.state === currentStateFilter) : null;
        const statusLabels = {
            estable: '🟢 Estable (Excelente)',
            degradado: '🟡 Degradado / Inestable',
            caido: '🔴 Caído / Interrumpido',
            sin_datos: '⚫ Sin datos / Desconectado'
        };
        const statusColor = item && item.status === 'estable' ? 'var(--color-success)' :
                            item && item.status === 'degradado' ? 'var(--color-moderate)' :
                            item && item.status === 'caido' ? 'var(--color-critical)' : 'var(--text-secondary)';
        
        const latencyVal = item && item.avg_latency !== null ? `${item.avg_latency} ms` : 'N/A';
        const pingVal = item && item.report_count ? `${item.report_count} pings` : '0 pings';
        
        const gaData = gaMetricsData ? gaMetricsData[currentStateFilter] : null;
        const gaUsers = gaData ? gaData.active_users : 0;
        
        const totalReportsState = allLoadedReports ? allLoadedReports.filter(r => r.state === currentStateFilter).length : 0;
        
        stateDetailContent.innerHTML = `
            <div style="text-align: left; display: flex; flex-direction: column; gap: 0.85rem;">
                <div style="font-size: 1.1rem; font-weight: 800; color: var(--text-primary); border-bottom: 1px dashed var(--border-color); padding-bottom: 0.35rem; display: flex; justify-content: space-between; align-items: center;">
                    <span>📍 ${currentStateFilter}</span>
                    <button type="button" onclick="window.toggleStateFilter('${escapeHTML(currentStateFilter)}')" style="background: none; border: none; font-size: 1.15rem; cursor: pointer; padding: 0.2rem; color: var(--text-secondary);">&times;</button>
                </div>
                <div>
                    <div style="font-weight: 700; font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase;">Estado de la Red</div>
                    <div style="font-size: 0.95rem; font-weight: 700; color: ${statusColor}; margin-top: 0.15rem;">
                        ${statusLabels[item ? item.status : 'sin_datos'] || statusLabels.sin_datos}
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                    <div>
                        <div style="font-weight: 700; font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase;">Latencia Promedio</div>
                        <div style="font-size: 1.1rem; font-weight: 800; color: var(--text-primary); margin-top: 0.15rem;">${latencyVal}</div>
                    </div>
                    <div>
                        <div style="font-weight: 700; font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase;">Telemetría Recibida</div>
                        <div style="font-size: 1.1rem; font-weight: 800; color: var(--text-primary); margin-top: 0.15rem;">${pingVal}</div>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; border-top: 1px solid var(--border-color); padding-top: 0.75rem;">
                    <div>
                        <div style="font-weight: 700; font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase;">Usuarios Activos (GA4)</div>
                        <div style="font-size: 1.1rem; font-weight: 800; color: var(--color-info); margin-top: 0.15rem;">👥 ${gaUsers}</div>
                    </div>
                    <div>
                        <div style="font-weight: 700; font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase;">Alertas Humanitarias</div>
                        <div style="font-size: 1.1rem; font-weight: 800; color: var(--color-critical); margin-top: 0.15rem;">🚨 ${totalReportsState}</div>
                    </div>
                </div>
                <div style="background: rgba(59, 130, 246, 0.05); padding: 0.5rem; border-radius: 6px; border: 1px solid rgba(59, 130, 246, 0.15); font-size: 0.75rem; text-align: center; color: var(--color-info); font-weight: 600; margin-top: 0.5rem;">
                    💡 Filtrando incidentes activos abajo.
                </div>
            </div>
        `;
    } else {
        stateDetailContent.innerHTML = `
            Selecciona un estado en el mapa o en la lista de abajo para ver su telemetría detallada, pings de red y reportes activos de ayuda.
        `;
    }
}

window.toggleStateFilter = function(stateName) {
    if (currentStateFilter === stateName) {
        currentStateFilter = null;
    } else {
        currentStateFilter = stateName;
    }
    
    loadReports();
    loadConnectivityStatus();
    updateStateTelemetryDetail();
    
    showToast(
        currentStateFilter 
            ? `Filtrando incidentes para el estado: ${stateName}` 
            : 'Mostrando incidentes de todos los estados', 
        'info'
    );
};

let seismicChartInstance = null;

function renderSeismicChart(events) {
    const canvas = document.getElementById('seismicChartCanvas');
    if (!canvas) return;

    const summaryEl = document.getElementById('seismicChartSummary');
    if (summaryEl) {
        summaryEl.textContent = `${events.length} sismos registrados`;
    }

    const chronEvents = [...events].reverse();
    const labels = chronEvents.map(e => {
        const time = new Date(e.properties.time);
        return time.toLocaleDateString('es-VE', { month: 'short', day: 'numeric' }) + ' ' + time.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
    });
    const magnitudes = chronEvents.map(e => e.properties.mag);
    const places = chronEvents.map(e => e.properties.place);

    if (seismicChartInstance) {
        seismicChartInstance.destroy();
    }

    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 160);
    gradient.addColorStop(0, 'rgba(239, 68, 68, 0.35)');
    gradient.addColorStop(0.5, 'rgba(249, 115, 22, 0.15)');
    gradient.addColorStop(1, 'rgba(234, 179, 8, 0.02)');

    seismicChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Magnitud (M)',
                data: magnitudes,
                borderColor: '#ef4444',
                borderWidth: 2,
                pointBackgroundColor: chronEvents.map(e => {
                    const m = e.properties.mag;
                    if (m >= 5.0) return '#ef4444';
                    if (m >= 4.0) return '#f97316';
                    return '#eab308';
                }),
                pointBorderColor: '#ffffff',
                pointBorderWidth: 1,
                pointRadius: 3,
                pointHoverRadius: 5,
                tension: 0.3,
                fill: true,
                backgroundColor: gradient
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (context) => {
                            const index = context[0].dataIndex;
                            return places[index];
                        },
                        label: (context) => {
                            return ` Magnitud: ${context.parsed.y.toFixed(1)} M`;
                        }
                    },
                    backgroundColor: '#172033',
                    titleColor: '#ffffff',
                    bodyColor: '#ffffff',
                    borderWidth: 1,
                    borderColor: '#d8e1ec',
                    padding: 8,
                    titleFont: { size: 10, weight: 'bold' },
                    bodyFont: { size: 11 }
                }
            },
            scales: {
                x: { display: false },
                y: {
                    min: 1.0,
                    max: 8.0,
                    grid: { color: 'rgba(0, 0, 0, 0.04)' },
                    ticks: {
                        font: { size: 9 },
                        stepSize: 1,
                        color: '#526175'
                    }
                }
            }
        }
    });
}

// USGS Seismic Events Monitoring
async function loadRecentSeismicEvents() {
    const seismicList = document.getElementById('seismicList');
    if (!seismicList) return;
    
    try {
        const url = 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2026-06-01&minmagnitude=2.0&minlatitude=5&maxlatitude=13&minlongitude=-73&maxlongitude=-59';
        const res = await fetch(url);
        const data = await res.json();
        
        if (!data.features || data.features.length === 0) {
            seismicList.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 1.5rem;">No se detectaron sismos recientes en la zona de Venezuela.</div>`;
            return;
        }
        
        const sortedEvents = data.features.sort((a, b) => b.properties.time - a.properties.time);
        renderSeismicChart(sortedEvents);
        
        seismicList.innerHTML = sortedEvents.map(e => {
            const props = e.properties;
            const date = new Date(props.time).toLocaleString('es-VE', { timeZone: 'America/Caracas' });
            const coords = e.geometry.coordinates;
            const mag = props.mag.toFixed(1);
            
            let alertColor = 'var(--text-secondary)';
            let alertBg = 'rgba(255, 255, 255, 0.02)';
            let borderStyle = '1px solid var(--border-color)';
            
            if (props.mag >= 5.0) {
                alertColor = 'var(--color-critical)';
                alertBg = 'rgba(239, 68, 68, 0.06)';
                borderStyle = '1px solid var(--color-critical)';
            } else if (props.mag >= 4.0) {
                alertColor = 'var(--color-high)';
                alertBg = 'rgba(249, 115, 22, 0.06)';
                borderStyle = '1px solid var(--color-high)';
            } else if (props.mag >= 3.0) {
                alertColor = 'var(--color-moderate)';
                alertBg = 'rgba(234, 179, 8, 0.06)';
                borderStyle = '1px solid var(--color-moderate)';
            }
            
            return `
                <div style="background: ${alertBg}; border: ${borderStyle}; border-radius: 8px; padding: 0.75rem; display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; transition: transform 0.15s;" onmouseover="this.style.transform='translateX(4px)'" onmouseout="this.style.transform='none'">
                    <div style="flex-grow: 1;">
                        <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary); margin-bottom: 0.25rem;">
                            ${escapeHTML(props.place)}
                        </div>
                        <div style="font-size: 0.7rem; color: var(--text-secondary);">
                            📅 ${date} | 📍 ${coords[1].toFixed(4)}, ${coords[0].toFixed(4)} | ⬇️ Prof: ${coords[2].toFixed(1)} km
                        </div>
                    </div>
                    <div style="text-align: right; min-width: 60px; flex-shrink: 0;">
                        <div style="font-size: 1.15rem; font-weight: 900; color: ${alertColor};">
                            M ${mag}
                        </div>
                        <a href="${props.url}" target="_blank" style="font-size: 0.65rem; color: var(--color-info); text-decoration: underline;">Detalles ↗</a>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Error al conectar con la API de sismos USGS:', err.message);
        seismicList.innerHTML = `<div style="text-align: center; color: var(--color-critical); padding: 1.5rem;">Error de conexión con el servicio de alertas sísmicas (USGS).</div>`;
    }
}

// Buscador, filtros y base de datos completa de teléfonos de emergencia
const emergencyPhonesDb = [
    { type: "bomberos", name: "🚒 Bomberos Antímano", tel: "02124722054", formatted: "(0212) 472.20.54", search: "bomberos antimano caracas" },
    { type: "bomberos", name: "🚒 Bomberos Catia la Mar", tel: "02123519966", formatted: "(0212) 351.99.66", search: "bomberos catia la mar vargas la guaira" },
    { type: "bomberos", name: "🚒 Bomberos Chacao", tel: "02122653261", formatted: "(0212) 265.32.61", search: "bomberos chacao caracas miranda" },
    { type: "bomberos", name: "🚒 Bomberos del Este: (Cafetal)", tel: "02129874334", formatted: "(0212) 987.43.34 - 985.50.60", search: "bomberos del este cafetal baruta miranda" },
    { type: "bomberos", name: "🚒 Bomberos Sucre", tel: "02129853640", formatted: "(0212) 985.36.40", search: "bomberos sucre petare miranda" },
    { type: "bomberos", name: "🚒 Bomberos El Cafetal", tel: "02129853640", formatted: "(0212) 985.36.40 - 985.29.77", search: "bomberos el cafetal baruta miranda" },
    { type: "bomberos", name: "🚒 Bomberos El Paraíso", tel: "02124810961", formatted: "(0212) 481.09.61", search: "bomberos el paraiso caracas libertador" },
    { type: "bomberos", name: "🚒 Bomberos El Valle", tel: "02126720175", formatted: "(0212) 672.01.75 - 672.06.36", search: "bomberos el valle caracas" },
    { type: "bomberos", name: "🚒 Bomberos La Guaira", tel: "02123327620", formatted: "(0212) 332.76.20 - 331.04.45", search: "bomberos la guaira" },
    { type: "bomberos", name: "🚒 Bomberos La Trinidad", tel: "02129434361", formatted: "(0212) 943.43.61", search: "bomberos la trinidad baruta" },
    { type: "bomberos", name: "🚒 Bomberos La Urbina", tel: "02122416641", formatted: "(0212) 241.66.41", search: "bomberos la urbina sucre petare" },
    { type: "bomberos", name: "🚒 Bomberos Metropolitanos", tel: "02125454545", formatted: "(0212) 545.45.45", search: "bomberos metropolitanos caracas" },
    { type: "bomberos", name: "🚒 Bomberos Miranda", tel: "02122356967", formatted: "(0212) 235.69.67", search: "bomberos miranda los teques" },
    { type: "bomberos", name: "🚒 Bomberos Plaza Venezuela", tel: "02127930039", formatted: "(0212) 793.00.39 - 793.64.57", search: "bomberos plaza venezuela libertador caracas" },
    { type: "bomberos", name: "🚒 Bomberos San Bernardino", tel: "02125779209", formatted: "(0212) 577.92.09", search: "bomberos san bernardino caracas" },
    { type: "rescate", name: "🛡️ Protección Civil", tel: "08005588427", formatted: "0800-5588427 / 0800-2668446 / 0800-2624368", search: "proteccion civil pc 0800" },
    { type: "rescate", name: "🛡️ Instituto de Protección Civil", tel: "02126318662", formatted: "(0212) 631.86.62 - 631.90.58 662.84.76 - 662.32.05 - 545.93.91", search: "instituto de proteccion civil ipc caracas miranda" },
    { type: "rescate", name: "🛡️ Defensa Civil Alcaldía Mavor", tel: "02126626759", formatted: "(0212) 662.67.59 - 662.32.05", search: "defensa civil alcaldia mavor mayor caracas" },
    { type: "rescate", name: "🛡️ Defensa Civil Nacional", tel: "080028326", formatted: "0800.28326 - 0800.24845 (0212) 483.98.05 - 662.22.52 - 662.66.19", search: "defensa civil nacional 0800" }
];

function initEmergencyPhones() {
    const listContainer = document.getElementById('emergencyPhonesList');
    if (!listContainer) return;

    // Renderizar la lista completa dinámicamente
    listContainer.innerHTML = emergencyPhonesDb.map(phone => {
        // Enlazar el primer número telefónico como href principal
        const firstNum = phone.tel;
        return `
            <div class="phone-item" data-type="${phone.type}" data-search="${escapeHTML(phone.search)}" style="background: var(--surface-muted); border: 1px solid var(--border-color); border-radius: 6px; padding: 0.5rem 0.6rem; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; font-size: 0.75rem;">
                <span style="font-weight: 600; color: var(--text-primary);">${escapeHTML(phone.name)}</span>
                <a href="tel:${firstNum}" style="color: ${phone.type === 'bomberos' ? 'var(--color-critical)' : 'var(--color-info)'}; font-weight: 700; text-decoration: none; white-space: nowrap;">
                    ${escapeHTML(phone.formatted)}
                </a>
            </div>
        `;
    }).join('');

    const searchInput = document.getElementById('emergencyPhoneSearch');
    const filterButtons = document.querySelectorAll('.phone-filter-btn');
    const phoneItems = listContainer.querySelectorAll('.phone-item');

    function filterPhones() {
        if (!searchInput) return;
        const query = searchInput.value.toLowerCase().trim();
        const activeBtn = document.querySelector('.phone-filter-btn.active');
        const activeFilter = activeBtn ? activeBtn.getAttribute('data-type') : 'all';

        phoneItems.forEach(item => {
            const itemType = item.getAttribute('data-type');
            const searchTag = item.getAttribute('data-search') || '';
            
            const matchesSearch = searchTag.includes(query);
            const matchesType = activeFilter === 'all' || itemType === activeFilter;

            if (matchesSearch && matchesType) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', filterPhones);
    }

    if (filterButtons.length > 0) {
        filterButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                filterButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                filterPhones();
            });
        });
    }
}

// Inicializar teléfonos al cargar
initEmergencyPhones();

// ========================================================================
// AI CHAT & VOICE ASSISTANT FOR COLLECTION CENTERS
// ========================================================================
const aiChatHistory = document.getElementById('aiChatHistory');
const aiChatInput = document.getElementById('aiChatInput');
const btnSendAiText = document.getElementById('btnSendAiText');
const btnRecordVoice = document.getElementById('btnRecordVoice');
const chkAttachGPS = document.getElementById('chkAttachGPS');
const recordingStatus = document.getElementById('recordingStatus');
const recordingTimer = document.getElementById('recordingTimer');

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let timerInterval = null;
let recordingSeconds = 0;

function appendChatMsg(sender, text, isHtml = false) {
    if (!aiChatHistory) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${sender}`;
    msgDiv.style.padding = '0.75rem';
    msgDiv.style.borderRadius = '8px';
    msgDiv.style.fontSize = '0.85rem';
    msgDiv.style.maxWidth = '85%';
    msgDiv.style.lineHeight = '1.4';
    msgDiv.style.border = '1px solid var(--border-color)';
    
    if (sender === 'user') {
        msgDiv.style.background = 'rgba(59, 130, 246, 0.08)';
        msgDiv.style.alignSelf = 'flex-end';
    } else {
        msgDiv.style.background = 'var(--surface-default)';
        msgDiv.style.alignSelf = 'flex-start';
    }

    if (isHtml) {
        msgDiv.innerHTML = text;
    } else {
        msgDiv.textContent = text;
    }
    
    aiChatHistory.appendChild(msgDiv);
    aiChatHistory.scrollTop = aiChatHistory.scrollHeight;
}

async function sendTextMsg() {
    if (!aiChatInput) return;
    const text = aiChatInput.value.trim();
    if (!text) return;

    aiChatInput.value = '';
    appendChatMsg('user', text);

    let lat = null, lng = null;
    if (chkAttachGPS && chkAttachGPS.checked) {
        try {
            const pos = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
            });
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
        } catch (e) {
            console.warn('No se pudo obtener ubicación GPS:', e.message);
        }
    }

    appendChatMsg('bot', '🤖 Procesando tu reporte de acopio con Gemini...');
    const botPendingMsg = aiChatHistory.lastChild;

    try {
        const res = await fetch(`${API_BASE}/api/acopio-chat/text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, lat, lng })
        });
        const data = await res.json();
        if (data.success) {
            const reply = formatWebAcopioReply(data);
            botPendingMsg.innerHTML = reply;
            showToast('Reporte procesado e indexado en el mapa.', 'success');
            if (typeof loadCollectionCenters === 'function') {
                loadCollectionCenters();
            }
        } else {
            botPendingMsg.textContent = `❌ Error: ${data.error}`;
        }
    } catch (err) {
        console.error(err);
        botPendingMsg.textContent = '❌ Error de conexión con el servidor de IA.';
    }
}

async function toggleVoiceRecording() {
    if (isRecording) {
        if (mediaRecorder) {
            mediaRecorder.stop();
        }
        if (btnRecordVoice) {
            btnRecordVoice.textContent = '🎙️';
            btnRecordVoice.style.background = 'rgba(239, 68, 68, 0.05)';
            btnRecordVoice.style.borderColor = 'rgba(239, 68, 68, 0.2)';
        }
        clearInterval(timerInterval);
        if (recordingStatus) recordingStatus.style.display = 'none';
        isRecording = false;
    } else {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showToast('Tu dispositivo o navegador no soporta grabación de audio.', 'error');
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream);
            
            mediaRecorder.addEventListener('dataavailable', event => {
                audioChunks.push(event.data);
            });

            mediaRecorder.addEventListener('stop', async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/ogg; codecs=opus' });
                stream.getTracks().forEach(track => track.stop());

                appendChatMsg('user', '🎙️ Nota de voz enviada (Procesando...)');

                let lat = null, lng = null;
                if (chkAttachGPS && chkAttachGPS.checked) {
                    try {
                        const pos = await new Promise((resolve, reject) => {
                            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
                        });
                        lat = pos.coords.latitude;
                        lng = pos.coords.longitude;
                    } catch (e) {
                        console.warn('No se pudo obtener ubicación GPS:', e.message);
                    }
                }

                appendChatMsg('bot', '🤖 Procesando nota de voz con Gemini...');
                const botPendingMsg = aiChatHistory.lastChild;

                try {
                    const url = new URL(`${API_BASE}/api/acopio-chat/audio`);
                    if (lat) url.searchParams.set('lat', lat);
                    if (lng) url.searchParams.set('lng', lng);

                    const res = await fetch(url.toString(), {
                        method: 'POST',
                        headers: { 'Content-Type': 'audio/ogg' },
                        body: audioBlob
                    });
                    const data = await res.json();
                    if (data.success) {
                        const reply = formatWebAcopioReply(data);
                        botPendingMsg.innerHTML = reply;
                        showToast('Mensaje de voz procesado y registrado con éxito.', 'success');
                        if (typeof loadCollectionCenters === 'function') {
                            loadCollectionCenters();
                        }
                    } else {
                        botPendingMsg.textContent = `❌ Error: ${data.error}`;
                    }
                } catch (err) {
                    console.error(err);
                    botPendingMsg.textContent = '❌ Error al procesar audio en el servidor de IA.';
                }
            });

            mediaRecorder.start();
            isRecording = true;
            if (btnRecordVoice) {
                btnRecordVoice.textContent = '⏹️';
                btnRecordVoice.style.background = 'rgba(239, 68, 68, 0.2)';
                btnRecordVoice.style.borderColor = 'rgba(239, 68, 68, 0.5)';
            }
            
            recordingSeconds = 0;
            if (recordingTimer) recordingTimer.textContent = '0s';
            if (recordingStatus) recordingStatus.style.display = 'inline-flex';
            
            timerInterval = setInterval(() => {
                recordingSeconds++;
                if (recordingTimer) recordingTimer.textContent = `${recordingSeconds}s`;
                if (recordingSeconds >= 60) {
                    toggleVoiceRecording();
                    showToast('Límite de 1 minuto de grabación alcanzado.', 'info');
                }
            }, 1000);

        } catch (err) {
            console.error(err);
            showToast('Permiso de micrófono denegado o no disponible.', 'error');
        }
    }
}

function formatWebAcopioReply(result) {
    const { action, center, extracted } = result;
    const supplies = center.supplies || 'Ninguno reportado';
    const schedule = center.schedule || 'No especificado';
    const contact = center.contact_info || 'No especificado';
    
    let emoji = '🟢';
    let statusText = 'OPERATIVO';
    if (center.capacity_status === 'alta_demanda') {
        emoji = '🟡';
        statusText = 'ALTA DEMANDA';
    } else if (center.capacity_status === 'sin_capacidad') {
        emoji = '🔴';
        statusText = 'SIN CAPACIDAD';
    }

    const transText = extracted.transcription 
        ? `<div style="margin-top: 0.5rem; padding: 0.5rem; background: var(--surface-muted); border-radius: 6px; font-style: italic; border-left: 3px solid var(--border-color); color: var(--text-secondary);">"${extracted.transcription}"</div>`
        : '';

    if (action === 'UPDATE') {
        return `✅ <strong>¡Centro Actualizado por IA!</strong><br><br>
                <strong>📍 Centro:</strong> ${center.name}<br>
                <strong>📍 Dirección:</strong> ${center.location_text}<br>
                <strong>📦 Insumos:</strong> ${supplies}<br>
                <strong>⏰ Horario:</strong> ${schedule}<br>
                <strong>📞 Contacto:</strong> ${contact}<br>
                <strong>📊 Estado:</strong> ${emoji} ${statusText}
                ${transText}`;
    } else {
        return `🆕 <strong>¡Nuevo Centro Registrado por IA!</strong><br><br>
                <strong>📍 Centro:</strong> ${center.name}<br>
                <strong>📍 Dirección:</strong> ${center.location_text}<br>
                <strong>📦 Insumos:</strong> ${supplies}<br>
                <strong>⏰ Horario:</strong> ${schedule}<br>
                <strong>📞 Contacto:</strong> ${contact}<br>
                <strong>📊 Estado:</strong> ${emoji} ${statusText}
                ${transText}`;
    }
}

if (btnSendAiText) {
    btnSendAiText.addEventListener('click', sendTextMsg);
}
if (aiChatInput) {
    aiChatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendTextMsg();
    });
}
if (btnRecordVoice) {
    btnRecordVoice.addEventListener('click', toggleVoiceRecording);
}

// ========================================================================
// WEBMCP TOOL REGISTRATION (AI Agent Web Tools Integration)
// ========================================================================
if (navigator.modelContext && typeof navigator.modelContext.provideContext === 'function') {
    try {
        navigator.modelContext.provideContext({
            tools: [
                {
                    name: "report_emergency",
                    description: "Submit a new humanitarian emergency or incident report.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            title: { type: "string", description: "Short title of the emergency" },
                            description: { type: "string", description: "Detailed description of the emergency" },
                            type: { type: "string", enum: ["desaparecido", "emergencia_medica", "rescate_estructural", "suministros"], description: "Category of emergency" },
                            location_text: { type: "string", description: "Location name or text details" },
                            state: { type: "string", description: "Venezuelan state name" }
                        },
                        required: ["title", "description", "type", "location_text"]
                    },
                    execute: async (args) => {
                        console.log("WebMCP Tool report_emergency invoked with args:", args);
                        return { success: true, message: "Use the emergency report form on screen or POST to /api/reports." };
                    }
                },
                {
                    name: "search_emergency_phones",
                    description: "Search for Venezuelan emergency phone numbers by keyword.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "Search term (e.g. bomberos, chacao, caracas)" }
                        },
                        required: ["query"]
                    },
                    execute: async (args) => {
                        const results = [];
                        const q = args.query.toLowerCase();
                        const list = document.querySelectorAll('.sidebar .card div[data-search]');
                        list.forEach(el => {
                            const cardText = el.innerText.toLowerCase();
                            if (cardText.includes(q)) {
                                results.push(el.innerText.trim().replace(/\n/g, ' '));
                            }
                        });
                        return { query: args.query, results };
                    }
                }
            ]
        });
        console.log("WebMCP Tools registered successfully.");
    } catch (err) {
        console.error("Failed to register WebMCP Context:", err);
    }
}
