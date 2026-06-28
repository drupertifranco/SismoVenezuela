import express from 'express';
import compression from 'compression';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { spawn } from 'child_process';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '2mb' }));

// Middleware de CORS nativo para permitir peticiones desde entornos locales y descentralizados
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const port = process.env.PORT || 8080;
const MISSING_PERSONS_SOURCE_NAME = process.env.MISSING_PERSONS_SOURCE_NAME || 'desaparecidosterremotovenezuela.com';
const MISSING_PERSONS_SYNC_URL = normalizeEnvUrl(process.env.MISSING_PERSONS_SYNC_URL);
const MISSING_PERSONS_SYNC_INTERVAL_MS = Math.max(
  parseInt(process.env.MISSING_PERSONS_SYNC_INTERVAL_MS, 10) || 6 * 60 * 60 * 1000,
  10 * 60 * 1000
);
const MISSING_PERSONS_SYNC_PAGE_SIZE = Math.min(
  Math.max(parseInt(process.env.MISSING_PERSONS_SYNC_PAGE_SIZE, 10) || 100, 1),
  200
);
const MISSING_PERSONS_SYNC_MAX_RECORDS = Math.min(
  Math.max(parseInt(process.env.MISSING_PERSONS_SYNC_MAX_RECORDS, 10) || 500, 1),
  1000
);
const MISSING_PERSONS_SYNC_TOKEN = process.env.MISSING_PERSONS_SYNC_TOKEN || '';
const MISSING_PERSONS_SYNC_API_KEY = process.env.MISSING_PERSONS_SYNC_API_KEY || '';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,                       // Conexiones máximas por instancia de contenedor
  idleTimeoutMillis: 10000,     // Cerrar conexiones inactivas tras 10 segundos
  connectionTimeoutMillis: 2000 // Abortar consulta si tarda más de 2 segundos en conectar
});

const missingPersonsSyncState = {
  enabled: true,
  in_progress: false,
  last_run_at: null,
  next_run_at: new Date(Date.now() + 15000).toISOString(),
  last_status: 'scheduled',
  last_error: null,
  last_summary: null,
  etag: null,
  last_modified: null,
  consecutive_failures: 0
};

// Servir archivos estáticos del frontend (como support.js y assets)
app.use(express.static(path.join(__dirname, 'frontend'), {
  etag: true,
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

async function generateHomepageMarkdown() {
  let activeReportsCount = 0;
  let missingCount = 0;
  let recentReports = [];

  try {
    const reportsRes = await pool.query("SELECT COUNT(*) FROM public.reports WHERE is_resolved = false;");
    activeReportsCount = parseInt(reportsRes.rows[0].count, 10);
  } catch (err) {
    console.error('Error counting reports for markdown:', err.message);
  }

  try {
    const missingRes = await pool.query(
      `SELECT COUNT(*) FROM public.missing_persons mp 
       JOIN public.reports r ON mp.report_id = r.id 
       WHERE r.is_resolved = false;`
    );
    missingCount = parseInt(missingRes.rows[0].count, 10);
  } catch (err) {
    console.error('Error counting missing persons for markdown:', err.message);
  }

  try {
    const recentRes = await pool.query(
      `SELECT type, title, location_text, state, created_at 
       FROM public.reports 
       WHERE is_resolved = false 
       ORDER BY created_at DESC LIMIT 5;`
    );
    recentReports = recentRes.rows;
  } catch (err) {
    console.error('Error fetching recent reports for markdown:', err.message);
  }

  let md = `# 🇻🇪 SismoVenezuela | Plataforma Humanitaria y Emergencias\n\n`;
  md += `Plataforma humanitaria centralizada para el reporte de incidentes, localización de personas desaparecidas y monitoreo de conectividad de red tras el sismo en Venezuela.\n\n`;
  md += `## 📊 Resumen de la Emergencia Actual\n`;
  md += `*   **Incidentes Activos**: ${activeReportsCount} reportados en la plataforma.\n`;
  md += `*   **Personas Desactivas/Desaparecidas**: ${missingCount} personas reportadas en búsqueda activa.\n\n`;

  if (recentReports.length > 0) {
    md += `## 🚨 Últimos Reportes Recibidos\n`;
    recentReports.forEach(r => {
      const typeLabel = r.type.replace('_', ' ').toUpperCase();
      md += `*   **[${typeLabel}]** ${r.title} - *Lugar:* ${r.location_text || 'Área afectada'} (${r.state || 'N/A'}) - *Fecha:* ${new Date(r.created_at).toLocaleString('es-VE')}\n`;
    });
    md += `\n`;
  }

  md += `## 📞 Números de Emergencia Principales\n`;
  md += `*   **Bomberos Metropolitanos**: (0212) 545.45.45\n`;
  md += `*   **Protección Civil Nacional**: 0800-5588427 / 0800-2668446 / 0800-2624368\n`;
  md += `*   **Defensa Civil Alcaldía Mayor**: (0212) 662.67.59\n\n`;

  md += `## 🌐 Alianzas e Iniciativas Tecnológicas (Red Quipu)\n`;
  md += `*   **Plataforma Central**: [Red Quipu](https://redquipu.com)\n`;
  md += `*   **Reporte de Desaparecidos**: [venezuelareporta.org](https://venezuelareporta.org) | [venezuelatebusca.com](https://venezuelatebusca.com)\n`;
  md += `*   **Inspección Habitacional**: [habitable.lovable.app](https://habitable.lovable.app)\n`;
  md += `*   **Centros de Acopio**: [ayudaparavenezuela.com](https://ayudaparavenezuela.com) | [zonasegura.up.railway.app](https://zonasegura.up.railway.app)\n\n`;

  md += `---  \n`;
  md += `*Para consumir la API de esta plataforma en formato estructurado, accede a:*\n`;
  md += `*   **Catálogo de APIs**: [https://ayudavenezuela.technolink.tech/.well-known/api-catalog](https://ayudavenezuela.technolink.tech/.well-known/api-catalog)\n`;
  md += `*   **Feed PFIF 1.4**: [https://ayudavenezuela.technolink.tech/pfif](https://ayudavenezuela.technolink.tech/pfif)\n`;

  return md;
}

// Ruta raíz para servir el HTML principal del frontend o versión Markdown
app.get('/', async (req, res) => {
  const acceptHeader = req.headers.accept || '';
  const wantsMarkdown = acceptHeader.includes('text/markdown') || req.query.format === 'markdown';

  res.setHeader('Link', '</.well-known/api-catalog>; rel="api-catalog", </pfif>; rel="service-desc"');

  if (wantsMarkdown) {
    res.header('Content-Type', 'text/markdown; charset=utf-8');
    const md = await generateHomepageMarkdown();
    return res.send(md);
  }

  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'frontend', 'Reporte Desaparecidos Venezuela.dc.html'));
});

// Endpoint de Health Check requerido por Google Cloud Run
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1;');
    res.status(200).json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', database: error.message });
  }
});

function normalizeEnvUrl(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).toString();
  } catch {
    return '';
  }
}

function normalizeOptionalText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseCoordinate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidLatLng(lat, lng) {
  return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function normalizeImportedMissingPerson(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const sourceId = normalizeOptionalText(item.id);
  const fullName = normalizeOptionalText(item.nombre || item.full_name || item.name);
  const locationText = normalizeOptionalText(item.ubicacion || item.location_text || item.location || item.last_seen_location);
  const description = normalizeOptionalText(item.descripcion || item.description);
  const contactInfo = normalizeOptionalText(item.contacto || item.contact_info || item.contact);
  const status = normalizeOptionalText(item.estado || item.status) || 'sin-contacto';
  const dateText = normalizeOptionalText(item.fecha || item.last_seen_date);
  const age = item.edad ?? item.age;

  const sourceUrl = sourceId
    ? `https://desaparecidosterremotovenezuela.com/personas/${encodeURIComponent(sourceId)}`
    : 'https://desaparecidosterremotovenezuela.com/';

  const details = [
    description,
    age !== undefined && age !== null && age !== '' ? `Edad reportada: ${age}` : null,
    dateText ? `Fecha reportada: ${dateText}` : null,
    status ? `Estado en fuente externa: ${status}` : null
  ].filter(Boolean).join('\n');

  return {
    sourceId,
    fullName,
    locationText,
    description: details || `Reporte importado desde base externa para ${fullName || 'persona sin nombre'}.`,
    contactInfo,
    status,
    sourceUrl,
    payload: {
      type: 'desaparecido',
      urgency: 'alto',
      title: fullName ? `Persona desaparecida: ${fullName}` : 'Persona desaparecida importada',
      source_url: sourceUrl,
      description: details || 'Reporte importado desde base externa.',
      location_text: locationText,
      contact_info: contactInfo,
      missing_person: {
        full_name: fullName,
        physical_description: description,
        last_seen_location: locationText
      }
    }
  };
}

async function findExistingMissingPerson(client, person) {
  const result = await client.query(
    `SELECT r.id, r.source_url, mp.full_name, r.location_text,
            similarity(mp.full_name, $1::text) AS name_score,
            similarity(r.location_text, $2::text) AS location_score
     FROM public.missing_persons mp
     JOIN public.reports r ON r.id = mp.report_id
     WHERE r.type = 'desaparecido'
       AND r.is_resolved = false
       AND (
         similarity(mp.full_name, $1::text) > 0.72
         OR (
           similarity(mp.full_name, $1::text) > 0.58
           AND similarity(r.location_text, $2::text) > 0.42
         )
       )
     ORDER BY GREATEST(similarity(mp.full_name, $1::text), similarity(r.location_text, $2::text)) DESC,
              r.created_at DESC
     LIMIT 1;`,
    [person.fullName, person.locationText]
  );

  return result.rows[0] || null;
}

async function mergeImportedMissingPersonSource(client, existing, person) {
  await client.query(
    `UPDATE public.reports
     SET source_url = CASE
           WHEN $2::text IS NOT NULL AND $2::text != '' AND COALESCE(source_url, '') NOT LIKE '%' || $2::text || '%' THEN
             CASE WHEN source_url IS NOT NULL AND source_url != '' THEN source_url || ' | ' || $2::text ELSE $2::text END
           ELSE source_url
         END,
         contact_info = CASE
           WHEN $3::text IS NOT NULL AND $3::text != '' AND COALESCE(contact_info, '') NOT LIKE '%' || $3::text || '%' THEN
             CASE WHEN contact_info IS NOT NULL AND contact_info != '' THEN contact_info || ' | ' || $3::text ELSE $3::text END
           ELSE contact_info
         END
     WHERE id = $1;`,
    [existing.id, person.sourceUrl, person.contactInfo]
  );
}

function createImportSummary(received) {
  return {
    received,
    created: 0,
    merged_duplicates: 0,
    skipped_resolved: 0,
    skipped_invalid: 0,
    errors: 0,
    details: []
  };
}

async function importMissingPersonsBatch(rawItems, options = {}) {
  const includeResolved = options.includeResolved === true;
  const source = options.source || MISSING_PERSONS_SOURCE_NAME;
  const summary = createImportSummary(rawItems.length);
  let client;

  try {
    client = await pool.connect();
    for (const rawItem of rawItems) {
      const person = normalizeImportedMissingPerson(rawItem);

      if (!person.fullName || !person.locationText) {
        summary.skipped_invalid += 1;
        summary.details.push({
          status: 'skipped_invalid',
          source_id: person.sourceId,
          reason: 'Falta nombre o ubicación.'
        });
        continue;
      }

      if (!includeResolved && person.status === 'localizado') {
        summary.skipped_resolved += 1;
        summary.details.push({
          status: 'skipped_resolved',
          source_id: person.sourceId,
          name: person.fullName
        });
        continue;
      }

      try {
        await client.query('BEGIN;');

        const existing = await findExistingMissingPerson(client, person);
        if (existing) {
          await mergeImportedMissingPersonSource(client, existing, person);
          await client.query('COMMIT;');
          summary.merged_duplicates += 1;
          summary.details.push({
            status: 'merged_duplicate',
            source_id: person.sourceId,
            name: person.fullName,
            existing_report_id: existing.id,
            name_score: Number(existing.name_score).toFixed(2),
            location_score: Number(existing.location_score).toFixed(2)
          });
          continue;
        }

        const insertResult = await client.query(
          'SELECT submit_emergency_report($1::jsonb) AS data;',
          [JSON.stringify(person.payload)]
        );
        await client.query('COMMIT;');

        const dbStatus = insertResult.rows[0].data;
        if (dbStatus.status === 'merged') {
          summary.merged_duplicates += 1;
        } else {
          summary.created += 1;
        }
        summary.details.push({
          status: dbStatus.status,
          source_id: person.sourceId,
          name: person.fullName,
          report_id: dbStatus.report_id
        });
      } catch (error) {
        await client.query('ROLLBACK;');
        summary.errors += 1;
        summary.details.push({
          status: 'error',
          source_id: person.sourceId,
          name: person.fullName,
          error: error.message
        });
      }
    }

    return { source, ...summary };
  } finally {
    if (client) {
      client.release();
    }
  }
}

function extractExternalMissingPersons(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.personas)) return payload.personas;
  if (Array.isArray(payload.results)) return payload.results;
  return [];
}

function buildSyncHeaders() {
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'SismoVenezuela humanitarian sync/1.0'
  };

  if (MISSING_PERSONS_SYNC_TOKEN) {
    headers.Authorization = `Bearer ${MISSING_PERSONS_SYNC_TOKEN}`;
  }
  if (MISSING_PERSONS_SYNC_API_KEY) {
    headers['x-api-key'] = MISSING_PERSONS_SYNC_API_KEY;
  }
  if (missingPersonsSyncState.etag) {
    headers['If-None-Match'] = missingPersonsSyncState.etag;
  }
  if (missingPersonsSyncState.last_modified) {
    headers['If-Modified-Since'] = missingPersonsSyncState.last_modified;
  }

  return headers;
}

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function setPagedQuery(url, page, pageSize) {
  const parsed = new URL(url);
  if (!parsed.searchParams.has('page')) parsed.searchParams.set('page', String(page));
  if (!parsed.searchParams.has('pageSize')) parsed.searchParams.set('pageSize', String(pageSize));
  return parsed.toString();
}

async function fetchMissingPersonsFromConfiguredSource() {
  const allItems = [];
  let page = 1;
  let totalPages = 1;
  let notModified = false;

  while (allItems.length < MISSING_PERSONS_SYNC_MAX_RECORDS && page <= totalPages) {
    const url = setPagedQuery(MISSING_PERSONS_SYNC_URL, page, MISSING_PERSONS_SYNC_PAGE_SIZE);
    const response = await fetchJsonWithTimeout(url, { headers: buildSyncHeaders() });

    if (response.status === 304) {
      notModified = true;
      break;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Fuente externa respondió ${response.status}: ${text.slice(0, 180)}`);
    }

    const etag = response.headers.get('etag');
    const lastModified = response.headers.get('last-modified');
    if (etag) missingPersonsSyncState.etag = etag;
    if (lastModified) missingPersonsSyncState.last_modified = lastModified;

    const payload = await response.json();
    const items = extractExternalMissingPersons(payload);
    allItems.push(...items);

    totalPages = Number(payload?.totalPages) || (items.length < MISSING_PERSONS_SYNC_PAGE_SIZE ? page : page + 1);
    page += 1;

    if (items.length === 0 || !payload?.totalPages) break;
  }

  return {
    notModified,
    items: allItems.slice(0, MISSING_PERSONS_SYNC_MAX_RECORDS)
  };
}

function computeNextSyncDelay() {
  if (missingPersonsSyncState.consecutive_failures === 0) {
    return MISSING_PERSONS_SYNC_INTERVAL_MS;
  }

  const multiplier = Math.min(6, missingPersonsSyncState.consecutive_failures + 1);
  return MISSING_PERSONS_SYNC_INTERVAL_MS * multiplier;
}

async function runPythonScraperHelper() {
  console.log('Iniciando raspado nativo de desaparecidos con Gemini...');

  if (!process.env.GEMINI_API_KEY && !process.env.GCP_PROJECT_ID) {
    throw new Error('GEMINI_API_KEY no está configurada. Configura el secret en el servidor.');
  }

  let ai;
  if (process.env.GEMINI_API_KEY) {
    delete process.env.GOOGLE_GENAI_USE_ENTERPRISE;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  } else if (process.env.GCP_PROJECT_ID) {
    process.env.GOOGLE_GENAI_USE_ENTERPRISE = 'true';
    process.env.GOOGLE_CLOUD_PROJECT = process.env.GCP_PROJECT_ID || 'praxis-ia-498305';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    ai = new GoogleGenAI({});
  }

  const targetUrl = 'https://desaparecidosterremotovenezuela.com/';
  let htmlText = '';

  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'curl/8.5.0'
  ];

  let fetchOk = false;
  for (const ua of userAgents) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const resp = await fetch(targetUrl, {
        headers: { 'User-Agent': ua, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-VE,es;q=0.9' },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (resp.ok) {
        htmlText = await resp.text();
        fetchOk = true;
        console.log(`Página descargada con UA: ${ua.slice(0, 40)}... (${htmlText.length} bytes)`);
        break;
      }
    } catch (e) {
      console.warn(`Fetch fallido con UA: ${ua.slice(0, 40)}: ${e.message}`);
    }
  }

  if (!fetchOk || htmlText.length < 500) {
    throw new Error(`No se pudo descargar el contenido de ${targetUrl}. El sitio puede estar caído o protegido.`);
  }

  const hasContent = /(desaparec|nombre|persona|ubicaci|location|contact)/i.test(htmlText);
  if (!hasContent) {
    console.warn('El HTML descargado no parece contener datos de desaparecidos. Posible CAPTCHA o bloqueo.');
    throw new Error('El sitio externo no devolvió datos de personas desaparecidas. Puede estar protegido por CAPTCHA.');
  }

  const truncatedHtml = htmlText.length > 60000 ? htmlText.slice(0, 60000) + '\n...[contenido truncado]' : htmlText;

  console.log('Paso 1: Extrayendo texto de personas desaparecidas del HTML...');
  const extractPrompt = `Analiza el siguiente HTML de una página web sobre personas desaparecidas en Venezuela tras el terremoto de 2024.
Lista TODAS las personas desaparecidas que encuentres. Para cada una escribe una línea con:
NOMBRE: [nombre completo] | UBICACION: [último lugar visto] | DESCRIPCION: [detalles físicos/ropa/edad] | CONTACTO: [teléfono o info de contacto]

Si no encuentras personas desaparecidas, responde exactamente: "SIN_DATOS"

HTML:
${truncatedHtml}`;

  const aiResponse = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: extractPrompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          success: { type: 'BOOLEAN' },
          results: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                full_name: { type: 'STRING' },
                last_seen_location: { type: 'STRING' },
                description: { type: 'STRING' },
                contact_info: { type: 'STRING' }
              },
              required: ['full_name', 'last_seen_location']
            }
          }
        },
        required: ['success', 'results']
      }
    }
  });

  const parsed = JSON.parse(aiResponse.text);
  console.log(`Gemini extrajo ${parsed.results?.length || 0} personas desaparecidas del sitio.`);

  return parsed.results || [];
}

async function runMissingPersonsSync(reason = 'scheduled') {
  if (missingPersonsSyncState.in_progress) {
    return { skipped: true, reason: 'sync_in_progress' };
  }

  missingPersonsSyncState.in_progress = true;
  missingPersonsSyncState.last_run_at = new Date().toISOString();
  missingPersonsSyncState.last_status = 'running';
  missingPersonsSyncState.last_error = null;

  try {
    let items = [];
    if (MISSING_PERSONS_SYNC_URL) {
      const external = await fetchMissingPersonsFromConfiguredSource();
      if (external.notModified) {
        missingPersonsSyncState.last_status = 'not_modified';
        missingPersonsSyncState.last_summary = {
          reason,
          received: 0,
          created: 0,
          merged_duplicates: 0,
          skipped_resolved: 0,
          skipped_invalid: 0,
          errors: 0
        };
        missingPersonsSyncState.consecutive_failures = 0;
        return missingPersonsSyncState.last_summary;
      }
      items = external.items;
    } else {
      console.log('Ejecutando scraper de Python para sincronización automática...');
      items = await runPythonScraperHelper();
    }

    const summary = await importMissingPersonsBatch(items, {
      source: MISSING_PERSONS_SOURCE_NAME
    });

    missingPersonsSyncState.last_status = 'ok';
    missingPersonsSyncState.last_summary = {
      reason,
      received: summary.received,
      created: summary.created,
      merged_duplicates: summary.merged_duplicates,
      skipped_resolved: summary.skipped_resolved,
      skipped_invalid: summary.skipped_invalid,
      errors: summary.errors
    };
    missingPersonsSyncState.consecutive_failures = summary.errors > 0 ? 1 : 0;
    return missingPersonsSyncState.last_summary;
  } catch (error) {
    missingPersonsSyncState.last_status = 'error';
    missingPersonsSyncState.last_error = error.message;
    missingPersonsSyncState.consecutive_failures += 1;
    console.error('Error en sincronización de personas desaparecidas:', error.message);
    return { success: false, error: error.message };
  } finally {
    missingPersonsSyncState.in_progress = false;
    const nextDelay = computeNextSyncDelay();
    missingPersonsSyncState.next_run_at = new Date(Date.now() + nextDelay).toISOString();
  }
}

function startMissingPersonsSyncScheduler() {
  const tick = async () => {
    await runMissingPersonsSync('scheduled');
    setTimeout(tick, computeNextSyncDelay()).unref();
  };

  setTimeout(tick, 15000).unref();
  
  if (MISSING_PERSONS_SYNC_URL) {
    console.log(`Sincronización externa de desaparecidos activa cada ${Math.round(MISSING_PERSONS_SYNC_INTERVAL_MS / 60000)} min vía URL.`);
  } else {
    console.log(`Sincronización externa activa cada ${Math.round(MISSING_PERSONS_SYNC_INTERVAL_MS / 3600000)} horas vía ScrapeGraphAI.`);
  }
}

// Endpoint: Listar centros de acopio activos para el mapa comunitario (Acceso Público)
app.get('/api/collection-centers', async (req, res) => {
  const { active = 'true', limit = 100, offset = 0 } = req.query;

  const values = [];
  const conditions = [];
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  let queryText = `
    SELECT id, name, location_text, lat, lng, supplies, schedule, contact_info,
           capacity_status, is_active, created_at
    FROM public.collection_centers
  `;

  if (active !== 'all') {
    values.push(active !== 'false');
    conditions.push(`is_active = $${values.length}`);
  }

  if (conditions.length > 0) {
    queryText += ' WHERE ' + conditions.join(' AND ');
  }

  values.push(parsedLimit, parsedOffset);
  queryText += ` ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length};`;

  try {
    const result = await pool.query(queryText, values);
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error al listar centros de acopio:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint: Crear un centro de acopio con coordenadas para ubicarlo en el mapa (Acceso Público)
app.post('/api/collection-centers', async (req, res) => {
  try {
    const {
      name,
      location_text,
      supplies,
      schedule,
      contact_info,
      capacity_status = 'operativo'
    } = req.body;

    const lat = parseCoordinate(req.body.lat);
    const lng = parseCoordinate(req.body.lng);
    const centerName = normalizeOptionalText(name);
    const centerLocation = normalizeOptionalText(location_text);
    const allowedStatuses = new Set(['operativo', 'alta_demanda', 'sin_capacidad']);

    if (!centerName) {
      return res.status(400).json({ success: false, error: 'El nombre del centro de acopio es requerido.' });
    }

    if (!centerLocation) {
      return res.status(400).json({ success: false, error: 'La referencia de ubicación es requerida.' });
    }

    if (!isValidLatLng(lat, lng)) {
      return res.status(400).json({ success: false, error: 'Las coordenadas GPS del centro de acopio no son válidas.' });
    }

    if (!allowedStatuses.has(capacity_status)) {
      return res.status(400).json({ success: false, error: 'El estado de capacidad del centro no es válido.' });
    }

    const result = await pool.query(
      `INSERT INTO public.collection_centers (
         name, location_text, lat, lng, supplies, schedule, contact_info, capacity_status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, location_text, lat, lng, supplies, schedule, contact_info,
                 capacity_status, is_active, created_at;`,
      [
        centerName,
        centerLocation,
        lat,
        lng,
        normalizeOptionalText(supplies),
        normalizeOptionalText(schedule),
        normalizeOptionalText(contact_info),
        capacity_status
      ]
    );

    return res.status(201).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al crear centro de acopio:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint: Importar personas desaparecidas desde un export autorizado y eliminar duplicados locales
app.post('/api/import/missing-persons', async (req, res) => {
  const body = req.body || {};
  const rawItems = Array.isArray(body) ? body : body.items;
  const includeResolved = body.includeResolved === true;

  if (!Array.isArray(rawItems)) {
    return res.status(400).json({
      success: false,
      error: 'Envía un arreglo JSON o un objeto con la propiedad "items".'
    });
  }

  if (rawItems.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'El archivo no contiene registros para importar.'
    });
  }

  if (rawItems.length > 500) {
    return res.status(400).json({
      success: false,
      error: 'Importa máximo 500 registros por lote para proteger la base de datos.'
    });
  }

  try {
    const summary = await importMissingPersonsBatch(rawItems, {
      includeResolved,
      source: body.source || MISSING_PERSONS_SOURCE_NAME
    });

    return res.status(200).json({
      success: true,
      ...summary
    });
  } catch (error) {
    console.error('Error al importar personas desaparecidas:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/import/missing-persons/status', (req, res) => {
  res.json({
    success: true,
    sync: missingPersonsSyncState,
    interval_minutes: Math.round(MISSING_PERSONS_SYNC_INTERVAL_MS / 60000),
    source: MISSING_PERSONS_SOURCE_NAME
  });
});

app.post('/api/import/missing-persons/sync', async (req, res) => {
  const summary = await runMissingPersonsSync('manual');
  res.json({
    success: !summary?.error,
    summary,
    sync: missingPersonsSyncState
  });
});

// Endpoint: Scrapear personas desaparecidas vía ScrapeGraphAI + Gemini (Mantenido para compatibilidad)
app.post('/api/scrape-missing', async (req, res) => {
  console.log('Iniciando raspado con ScrapeGraphAI via endpoint...');
  try {
    const rawItems = await runPythonScraperHelper();
    if (!rawItems || rawItems.length === 0) {
      return res.status(200).json({
        success: true,
        received: 0,
        created: 0,
        merged_duplicates: 0,
        skipped_resolved: 0,
        skipped_invalid: 0,
        errors: 0,
        details: [],
        message: 'No se encontraron personas desaparecidas nuevas que procesar en la página.'
      });
    }
    
    const summary = await importMissingPersonsBatch(rawItems, {
      includeResolved: false,
      source: 'desaparecidosterremotovenezuela.com'
    });
    
    return res.status(200).json({
      success: true,
      ...summary
    });
  } catch (error) {
    console.error('Error al ejecutar el scraper por API:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint: Registrar telemetría de conectividad (Acceso Público en background)
app.post('/api/telemetry', async (req, res) => {
  try {
    const { state, latency_ms } = req.body;
    
    if (!state || latency_ms === undefined) {
      return res.status(400).json({ success: false, error: 'Los campos state y latency_ms son requeridos.' });
    }

    const stateNormalize = normalizeOptionalText(state);
    const latencyInt = parseInt(latency_ms, 10);

    if (isNaN(latencyInt) || latencyInt < 0) {
      return res.status(400).json({ success: false, error: 'El valor de latencia no es válido.' });
    }

    // Insertar telemetría
    await pool.query(
      `INSERT INTO public.connectivity_telemetry (state, latency_ms) VALUES ($1, $2);`,
      [stateNormalize, latencyInt]
    );

    // Limpieza pasiva automática de telemetría de más de 1 hora
    pool.query(`DELETE FROM public.connectivity_telemetry WHERE created_at < now() - interval '1 hour';`)
      .catch(err => console.error('Error al limpiar telemetría antigua:', err.message));

    return res.status(201).json({ success: true });
  } catch (error) {
    console.error('Error al procesar telemetría:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint: Obtener estado consolidado de conectividad nacional (Acceso Público)
app.get('/api/connectivity-status', async (req, res) => {
  try {
    // Consulta para agrupar latencias promedio de la última hora por estado
    const query = `
      SELECT state, 
             ROUND(AVG(latency_ms))::integer as avg_latency,
             COUNT(*)::integer as report_count
      FROM public.connectivity_telemetry
      WHERE created_at > now() - interval '1 hour'
      GROUP BY state;
    `;
    const result = await pool.query(query);
    
    // Lista de los 24 estados de Venezuela
    const venezuelaStates = [
      "Distrito Capital", "Amazonas", "Anzoátegui", "Apure", "Aragua", "Barinas", 
      "Bolívar", "Carabobo", "Cojedes", "Delta Amacuro", "Falcón", "Guárico", 
      "Lara", "Mérida", "Miranda", "Monagas", "Nueva Esparta", "Portuguesa", 
      "Sucre", "Táchira", "Trujillo", "La Guaira", "Yaracuy", "Zulia"
    ];

    const telemetryMap = {};
    result.rows.forEach(row => {
      telemetryMap[row.state] = {
        avg_latency: row.avg_latency,
        report_count: row.report_count
      };
    });

    // Mapear cada estado a su estatus final
    const statusData = venezuelaStates.map(stateName => {
      const data = telemetryMap[stateName];
      let status = 'sin_datos';
      let avgLatency = null;
      
      if (data) {
        avgLatency = data.avg_latency;
        if (avgLatency < 500) {
          status = 'estable';
        } else if (avgLatency < 2000) {
          status = 'degradado';
        } else {
          status = 'caido';
        }
      }

      return {
        state: stateName,
        status: status,
        avg_latency: avgLatency,
        report_count: data ? data.report_count : 0
      };
    });

    res.json({
      success: true,
      data: statusData
    });
  } catch (err) {
    console.error('Error al obtener estado de conectividad:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint 1: Enviar reporte de emergencia atómico y de-duplicado (Acceso Público)
app.post('/api/reports', async (req, res) => {
  try {
    const payload = req.body;

    // Llamada al procedimiento almacenado SECURITY DEFINER en Postgres
    const result = await pool.query(
      'SELECT submit_emergency_report($1::jsonb) AS data;',
      [JSON.stringify(payload)]
    );

    const reportResponse = result.rows[0].data;

    if (reportResponse.success) {
      return res.status(201).json(reportResponse);
    } else {
      return res.status(400).json(reportResponse);
    }
  } catch (error) {
    console.error('Error al procesar reporte de emergencia:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint 2: Listar reportes con filtros y agregación de personas desaparecidas (Acceso Público)
app.get('/api/reports', async (req, res) => {
  const { type, urgency, is_resolved, state, limit = 50, offset = 0 } = req.query;
  
  let queryText = `
    SELECT r.*, 
           COALESCE(
             json_agg(mp.*) FILTER (WHERE mp.id IS NOT NULL), 
             '[]'::json
           ) AS missing_persons
    FROM public.reports r
    LEFT JOIN public.missing_persons mp ON r.id = mp.report_id
  `;
  
  const values = [];
  const conditions = [];

  if (type) {
    values.push(type);
    conditions.push(`r.type = $${values.length}`);
  }
  if (urgency) {
    values.push(urgency);
    conditions.push(`r.urgency = $${values.length}`);
  }
  if (is_resolved !== undefined) {
    values.push(is_resolved === 'true');
    conditions.push(`r.is_resolved = $${values.length}`);
  }
  if (state) {
    values.push(state);
    conditions.push(`r.state = $${values.length}`);
  }

  if (conditions.length > 0) {
    queryText += ' WHERE ' + conditions.join(' AND ');
  }

  queryText += ' GROUP BY r.id';
  queryText += ` ORDER BY r.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)};`;

  try {
    const result = await pool.query(queryText, values);
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error al listar reportes:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint 3: Marcar reporte como resuelto (Acceso Protegido por RLS de sesión)
app.patch('/api/reports/:id/resolve', async (req, res) => {
  const { id } = req.params;
  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN;');
    await client.query("SET LOCAL app.role = 'authenticated';");

    const updateResult = await client.query(
      `UPDATE public.reports 
       SET is_resolved = true 
       WHERE id = $1 
       RETURNING id, type, urgency, is_resolved;`,
      [id]
    );

    if (updateResult.rows.length === 0) {
      throw new Error('Reporte no encontrado o no tiene permisos de modificación.');
    }

    await client.query('COMMIT;');

    return res.status(200).json({
      success: true,
      message: 'El reporte de emergencia ha sido marcado como resuelto.',
      data: updateResult.rows[0]
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK;');
      } catch (rollbackErr) {
        console.error('Error al realizar rollback:', rollbackErr.message);
      }
    }
    console.error('Error al marcar reporte como resuelto:', error.message);
    return res.status(403).json({
      success: false,
      error: error.message
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Endpoint 4: Sincronizar alertas externas usando Google Gemini + Search Grounding
app.post('/api/sync-external', async (req, res) => {
  try {
    let ai;
    // Autenticación inteligente: Usa API Key local o Vertex AI en GCP (Enterprise)
    if (process.env.GEMINI_API_KEY) {
      // Limpiar variables de Vertex AI que pueden interferir con el modo API Key
      delete process.env.GOOGLE_GENAI_USE_ENTERPRISE;
      delete process.env.GOOGLE_CLOUD_PROJECT;
      delete process.env.GOOGLE_CLOUD_LOCATION;
      ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } else if (process.env.GCP_PROJECT_ID) {
      // Configurar variables necesarias para que el SDK de GenAI active el modo Vertex Enterprise
      process.env.GOOGLE_GENAI_USE_ENTERPRISE = 'true';
      process.env.GOOGLE_CLOUD_PROJECT = process.env.GCP_PROJECT_ID || 'praxis-ia-498305';
      process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
      ai = new GoogleGenAI({}); // Inicialización vacía para cargar de forma automática Vertex AI
    } else {
      console.error('sync-external: ni GEMINI_API_KEY ni GCP_PROJECT_ID están configurados.');
      return res.status(503).json({
        success: false,
        error: 'El servicio de IA no está configurado. Contacta al administrador para agregar GEMINI_API_KEY en la configuración del servidor.'
      });
    }

    console.log('Paso 1: Rastreo web con Google Search Grounding (Texto libre)...');

    const searchPrompt = `Busca reportes recientes en noticias y redes sociales sobre emergencias médicas,
solicitudes de suministros, colapsos de estructuras, fallas de conectividad o personas desaparecidas
causadas por el terremoto de magnitud 7.2 en Venezuela.
Para cada incidente encontrado indica: título descriptivo, ubicación en Venezuela, descripción detallada y URL de la fuente.
Escribe un reporte de texto con todos los incidentes encontrados.`;

    let rawContent = '';
    try {
      const searchResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: searchPrompt,
        config: {
          tools: [{ googleSearch: {} }]
        }
      });
      rawContent = searchResponse.text || '';
    } catch (searchErr) {
      console.error('Error en búsqueda con Google Grounding:', searchErr.message);
      // Fallback: intentar sin grounding
      try {
        const fallbackResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: searchPrompt
        });
        rawContent = fallbackResponse.text || '';
      } catch (fallbackErr) {
        console.error('Error en búsqueda fallback:', fallbackErr.message);
        return res.json({ success: true, synchronized_records: 0, details: [], message: 'El servicio de búsqueda no está disponible temporalmente.' });
      }
    }

    if (!rawContent.trim()) {
      console.warn('La búsqueda web no devolvió contenido. Retornando sin sincronizar.');
      return res.json({ success: true, synchronized_records: 0, details: [] });
    }
    console.log(`Paso 1 completado (${rawContent.length} chars). Paso 2: Conversión a JSON estructurado...`);

    // Truncar rawContent para evitar exceder tokens de Gemini en la segunda llamada
    const truncatedContent = rawContent.length > 12000 ? rawContent.slice(0, 12000) + '\n...[truncado]' : rawContent;

    const structurePrompt = `Analiza el siguiente texto con reportes de emergencia del terremoto de Venezuela y extrae los incidentes.
Devuelve SOLO un arreglo JSON con los incidentes reales encontrados. Si no hay incidentes válidos, devuelve [].

Reglas:
- Solo incidentes en estados venezolanos reales.
- source_url: solo URLs reales del texto (no inventes). Si no hay URL, deja null.
- Clasifica el tipo: desaparecido, emergencia_medica, rescate_estructural, suministros, o sin_comunicacion.
- Urgencia: critico, alto, o moderado.

Texto:
${truncatedContent}`;

    let parsedReports = [];
    try {
      const structureResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: structurePrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                type: {
                  type: 'STRING',
                  enum: ['desaparecido', 'emergencia_medica', 'rescate_estructural', 'suministros', 'sin_comunicacion']
                },
                urgency: { type: 'STRING', enum: ['critico', 'alto', 'moderado'] },
                title: { type: 'STRING' },
                source_url: { type: 'STRING' },
                description: { type: 'STRING' },
                location_text: { type: 'STRING' },
                state: {
                  type: 'STRING',
                  enum: [
                    'Distrito Capital', 'Amazonas', 'Anzoátegui', 'Apure', 'Aragua', 'Barinas',
                    'Bolívar', 'Carabobo', 'Cojedes', 'Delta Amacuro', 'Falcón', 'Guárico',
                    'Lara', 'Mérida', 'Miranda', 'Monagas', 'Nueva Esparta', 'Portuguesa',
                    'Sucre', 'Táchira', 'Trujillo', 'La Guaira', 'Yaracuy', 'Zulia'
                  ]
                },
                lat: { type: 'NUMBER' },
                lng: { type: 'NUMBER' },
                contact_info: { type: 'STRING' },
                missing_person: {
                  type: 'OBJECT',
                  properties: {
                    full_name: { type: 'STRING' },
                    physical_description: { type: 'STRING' },
                    last_seen_location: { type: 'STRING' }
                  },
                  required: ['full_name']
                }
              },
              required: ['type', 'urgency', 'description', 'location_text', 'state']
            }
          }
        }
      });
      const responseText = structureResponse.text || '[]';
      parsedReports = JSON.parse(responseText);
      if (!Array.isArray(parsedReports)) parsedReports = [];
    } catch (structErr) {
      console.error('Error en estructuración JSON de sync-external:', structErr.message);
      parsedReports = [];
    }
    console.log(`Gemini estructuró ${parsedReports.length} reportes de la web. Iniciando de-duplicación...`);

    const results = [];
    for (const r of parsedReports) {
      try {
        if (r.type === 'desaparecido' && !r.missing_person) {
          r.missing_person = {
            full_name: r.title || 'Persona no identificada',
            physical_description: r.description || '',
            last_seen_location: r.location_text || ''
          };
        }
        const dbResult = await pool.query(
          'SELECT submit_emergency_report($1::jsonb) AS data;',
          [JSON.stringify(r)]
        );
        results.push({
          report: { type: r.type, title: r.title, location_text: r.location_text },
          status: dbResult.rows[0].data
        });
      } catch (insertErr) {
        console.error('Error al insertar reporte sincronizado:', insertErr.message);
        results.push({
          report: { type: r.type, title: r.title, location_text: r.location_text },
          error: insertErr.message
        });
      }
    }

    res.json({
      success: true,
      synchronized_records: parsedReports.length,
      details: results
    });

  } catch (error) {
    console.error('Error crítico en sync-external:', error.message, error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});

function escapeXml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeValue(val) {
  if (val === null || val === undefined || String(val).toLowerCase() === 'null') {
    return '';
  }
  return String(val);
}

function formatRowToPfifObj(row, hostname) {
  const full_name = sanitizeValue(row.full_name);
  const names = full_name.trim().split(/\s+/);
  const first_name = names[0] || '';
  const last_name = names.slice(1).join(' ') || '';
  const domain = hostname || 'ayuda-venezuela-backend-291864207498.us-central1.run.app';

  return {
    person_record_id: `${domain}/person/${row.id}`,
    entry_date: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    author_name: 'SismoVenezuela',
    author_email: '',
    author_phone: sanitizeValue(row.contact_info),
    source_name: 'SismoVenezuela',
    source_date: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    source_url: sanitizeValue(row.source_url) || `https://${domain}/personas/${row.id}`,
    first_name: first_name,
    last_name: last_name,
    full_name: full_name,
    alternate_names: '',
    sex: '',
    age: '',
    home_street: '',
    home_neighborhood: sanitizeValue(row.last_seen_location),
    home_city: '',
    home_state: sanitizeValue(row.state),
    home_postal_code: '',
    home_country: 'VE',
    photo_url: '',
    other: sanitizeValue(row.physical_description)
  };
}

function pfifObjToXml(obj) {
  return `  <pfif:person>
    <pfif:person_record_id>${escapeXml(obj.person_record_id)}</pfif:person_record_id>
    <pfif:entry_date>${escapeXml(obj.entry_date)}</pfif:entry_date>
    <pfif:author_name>${escapeXml(obj.author_name)}</pfif:author_name>
    <pfif:author_email>${escapeXml(obj.author_email)}</pfif:author_email>
    <pfif:author_phone>${escapeXml(obj.author_phone)}</pfif:author_phone>
    <pfif:source_name>${escapeXml(obj.source_name)}</pfif:source_name>
    <pfif:source_date>${escapeXml(obj.source_date)}</pfif:source_date>
    <pfif:source_url>${escapeXml(obj.source_url)}</pfif:source_url>
    <pfif:first_name>${escapeXml(obj.first_name)}</pfif:first_name>
    <pfif:last_name>${escapeXml(obj.last_name)}</pfif:last_name>
    <pfif:full_name>${escapeXml(obj.full_name)}</pfif:full_name>
    <pfif:alternate_names>${escapeXml(obj.alternate_names)}</pfif:alternate_names>
    <pfif:sex>${escapeXml(obj.sex)}</pfif:sex>
    <pfif:age>${escapeXml(obj.age)}</pfif:age>
    <pfif:home_street>${escapeXml(obj.home_street)}</pfif:home_street>
    <pfif:home_neighborhood>${escapeXml(obj.home_neighborhood)}</pfif:home_neighborhood>
    <pfif:home_city>${escapeXml(obj.home_city)}</pfif:home_city>
    <pfif:home_state>${escapeXml(obj.home_state)}</pfif:home_state>
    <pfif:home_postal_code>${escapeXml(obj.home_postal_code)}</pfif:home_postal_code>
    <pfif:home_country>${escapeXml(obj.home_country)}</pfif:home_country>
    <pfif:photo_url>${escapeXml(obj.photo_url)}</pfif:photo_url>
    <pfif:other>${escapeXml(obj.other)}</pfif:other>
  </pfif:person>`;
}

app.get('/pfif', async (req, res) => {
  const { updated_after, offset = '0', limit = '100' } = req.query;

  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);

  let queryText = `
    SELECT mp.id, mp.full_name, mp.physical_description, mp.last_seen_location,
           r.id as report_id, r.created_at, r.source_url, r.state, r.contact_info
    FROM public.missing_persons mp
    JOIN public.reports r ON mp.report_id = r.id
    WHERE r.type = 'desaparecido' AND r.is_resolved = false
  `;
  const values = [];

  if (updated_after) {
    try {
      const date = new Date(updated_after);
      if (!isNaN(date.getTime())) {
        values.push(date.toISOString());
        queryText += ` AND r.created_at >= $${values.length}`;
      }
    } catch (e) {
      console.warn('updated_after invalido:', updated_after);
    }
  }

  values.push(parsedLimit, parsedOffset);
  queryText += ` ORDER BY r.created_at ASC, mp.id ASC LIMIT $${values.length - 1} OFFSET $${values.length};`;

  try {
    const result = await pool.query(queryText, values);
    const hostname = req.hostname || 'ayuda-venezuela-backend-291864207498.us-central1.run.app';
    const pfifData = result.rows.map(row => formatRowToPfifObj(row, hostname));

    // Content negotiation: Check query param format=xml or XML Content-Type accept headers
    const acceptHeader = req.headers.accept || '';
    const isXml = req.query.format === 'xml' || acceptHeader.includes('application/xml') || acceptHeader.includes('text/xml');

    if (isXml) {
      res.header('Content-Type', 'application/xml; charset=utf-8');
      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<pfif:pfif xmlns:pfif="http://zesty.ca/pfif/1.4">\n`;
      xml += pfifData.map(pfifObjToXml).join('\n');
      xml += `\n</pfif:pfif>`;
      return res.send(xml);
    }

    res.json(pfifData);
  } catch (error) {
    console.error('Error en endpoint /pfif:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint dinámico para el mapa de sitio (Sitemap.xml)
app.get('/sitemap.xml', async (req, res) => {
  res.header('Content-Type', 'application/xml');
  
  // Enlaces estáticos principales
  const urls = [
    'https://ayudavenezuela.technolink.tech/'
  ];

  try {
    // Buscar personas desaparecidas activas de la base de datos para agregarlas al sitemap
    const result = await pool.query(
      `SELECT id FROM public.missing_persons LIMIT 200;`
    );
    
    result.rows.forEach(row => {
      urls.push(`https://ayudavenezuela.technolink.tech/personas/${row.id}`);
    });
  } catch (err) {
    console.error('Error al generar sitemap dinámico:', err.message);
  }

  // Construir el XML de sitemap estándar
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
  
  urls.forEach(url => {
    xml += `  <url>\n`;
    xml += `    <loc>${url}</loc>\n`;
    xml += `    <changefreq>hourly</changefreq>\n`;
    xml += `    <priority>${url.endsWith('/') ? '1.0' : '0.8'}</priority>\n`;
    xml += `  </url>\n`;
  });
  
  xml += `</urlset>`;
  res.send(xml);
});

// Ruta para cargar una persona específica con SEO dinámico para WhatsApp/Buscadores
app.get('/personas/:id', async (req, res) => {
  const { id } = req.params;
  const htmlPath = path.join(__dirname, 'frontend', 'Reporte Desaparecidos Venezuela.dc.html');
  
  try {
    // 1. Validar UUID para proteger contra inyecciones
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).send('ID de persona inválido.');
    }

    // 2. Buscar los datos de la persona de la base de datos
    const result = await pool.query(
      `SELECT mp.full_name, mp.physical_description, r.location_text, r.state 
       FROM public.missing_persons mp
       JOIN public.reports r ON mp.report_id = r.id
       WHERE mp.id = $1 LIMIT 1;`,
      [id]
    );

    // Si no se encuentra, servir el HTML base normalmente
    if (result.rows.length === 0) {
      return res.sendFile(htmlPath);
    }

    const p = result.rows[0];
    const fullName = (!p.full_name || p.full_name === 'null') ? 'Persona no identificada' : p.full_name;
    const locationText = (!p.location_text || p.location_text === 'null') ? 'Área afectada' : p.location_text;
    const stateText = (!p.state || p.state === 'null') ? 'Venezuela' : p.state;

    const acceptHeader = req.headers.accept || '';
    const wantsMarkdown = acceptHeader.includes('text/markdown') || req.query.format === 'markdown';

    if (wantsMarkdown) {
      res.header('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Link', '</.well-known/api-catalog>; rel="api-catalog", </pfif>; rel="service-desc"');
      
      let pMd = `# 🚨 BÚSQUEDA ACTIVA: Localizar a ${fullName}\n\n`;
      pMd += `*   **ID de Búsqueda**: \`${id}\`\n`;
      pMd += `*   **Estado**: Desaparecido/a (Activo)\n`;
      pMd += `*   **Última ubicación reportada**: ${locationText}, Estado ${stateText}\n\n`;
      pMd += `## 📝 Descripción Física y Detalles\n`;
      pMd += `${p.physical_description || 'Sin descripción física detallada disponible.'}\n\n`;
      pMd += `---\n`;
      pMd += `*Si tienes cualquier información sobre el paradero de esta persona, por favor repórtala de inmediato en la plataforma SismoVenezuela o comunícate con las autoridades locales.*\n`;
      
      return res.send(pMd);
    }

    const title = `🚨 BUSQUEDA ACTIVA: Localizar a ${fullName} | SismoVenezuela`;
    const description = `Ayúdanos a localizar a ${fullName}. Visto por última vez en: ${locationText}, Estado ${stateText}. Comparte cualquier información para ayudar.`;
    const canonicalUrl = `https://ayudavenezuela.technolink.tech/personas/${id}`;

    // 3. Leer el archivo HTML base
    let html = fs.readFileSync(htmlPath, 'utf8');

    // 4. Reemplazar las etiquetas básicas y de Open Graph dinámicamente antes de servir el archivo
    html = html
      .replace(/<title>.*?<\/title>/g, `<title>${title}</title>`)
      .replace(/<meta name="description" content=".*?">/g, `<meta name="description" content="${description}">`)
      .replace(/<link rel="canonical" href=".*?">/g, `<link rel="canonical" href="${canonicalUrl}">`)
      .replace(/<meta property="og:title" content=".*?">/g, `<meta property="og:title" content="${title}">`)
      .replace(/<meta property="og:description" content=".*?">/g, `<meta property="og:description" content="${description}">`)
      .replace(/<meta property="og:url" content=".*?">/g, `<meta property="og:url" content="${canonicalUrl}">`)
      .replace(/<meta name="twitter:title" content=".*?">/g, `<meta name="twitter:title" content="${title}">`)
      .replace(/<meta name="twitter:description" content=".*?">/g, `<meta name="twitter:description" content="${description}">`);

    // 5. Enviar el HTML modificado e indexable al vuelo
    res.send(html);

  } catch (error) {
    console.error('Error al inyectar SEO dinámico:', error.message);
    res.sendFile(htmlPath); // Fallback: servir archivo estático base
  }
});


// Endpoint de administración para ejecutar migraciones bajo demanda sin colgar el arranque
app.get('/api/admin/migrate', async (req, res) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return res.status(500).send('DATABASE_URL no definida.');
  }

  const pgPool = new pg.Pool({ connectionString });
  let client;
  try {
    client = await pgPool.connect();
    await client.query("SET lock_timeout = '20s'");

    // Terminar otras conexiones activas de la base de datos para liberar bloqueos
    await client.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND datname = current_database();
    `);

    const sqlPath = path.join(__dirname, 'database', 'schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await client.query(sql);

    return res.status(200).send('Migración completada exitosamente.');
  } catch (err) {
    return res.status(500).send(`Error en migración: ${err.message}`);
  } finally {
    if (client) client.release();
    await pgPool.end();
  }
});


// Endpoint para limpiar registros viejos y duplicados de este lote
app.get('/api/admin/cleanup-reimport', async (req, res) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return res.status(500).send('DATABASE_URL no definida.');
  }

  const pgPool = new pg.Pool({ connectionString });
  let client;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN;');

    // 1. Borrar todas las personas desaparecidas viejas asociadas a los reportes importados
    await client.query(`
      DELETE FROM public.missing_persons 
      WHERE report_id IN (
        SELECT id FROM public.reports 
        WHERE description LIKE '%Hospitalizado tras ser trasladado desde La Guaira%'
      );
    `);

    // 2. Borrar los reportes maestros
    await client.query(`
      DELETE FROM public.reports 
      WHERE description LIKE '%Hospitalizado tras ser trasladado desde La Guaira%';
    `);

    await client.query('COMMIT;');
    return res.status(200).send('Limpieza realizada. Los registros viejos han sido eliminados.');
  } catch (err) {
    if (client) await client.query('ROLLBACK;');
    return res.status(500).send(`Error en limpieza: ${err.message}`);
  } finally {
    if (client) client.release();
    await pgPool.end();
  }
});


app.get('/api/admin/deploy-function', async (req, res) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return res.status(500).send('DATABASE_URL no definida.');
  const pgPool = new pg.Pool({ connectionString });
  let client;
  try {
    client = await pgPool.connect();
    
    const funcSql = `
CREATE OR REPLACE FUNCTION public.submit_emergency_report(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
    v_report_id UUID;
    v_duplicate_id UUID;
    v_type TEXT;
    v_urgency TEXT;
    v_title TEXT;
    v_source_url TEXT;
    v_description TEXT;
    v_location_text TEXT;
    v_lat DOUBLE PRECISION;
    v_lng DOUBLE PRECISION;
    v_contact_info TEXT;
    v_missing_person JSONB;
    v_mp_name TEXT;
    v_mp_description TEXT;
    v_mp_last_seen TEXT;
    v_mp_existing_id UUID;
    v_status TEXT;
    v_state TEXT;
BEGIN
    -- 1. Extracción de variables
    v_type := payload->>'type';
    v_urgency := payload->>'urgency';
    v_title := payload->>'title';
    v_source_url := payload->>'source_url';
    v_description := payload->>'description';
    v_location_text := payload->>'location_text';
    v_lat := (payload->>'lat')::DOUBLE PRECISION;
    v_lng := (payload->>'lng')::DOUBLE PRECISION;
    v_contact_info := payload->>'contact_info';
    v_state := payload->>'state';
    v_missing_person := payload->'missing_person';

    -- 2. Validaciones básicas obligatorias
    IF v_type IS NULL OR v_type = '' THEN
        RAISE EXCEPTION 'El campo "type" es requerido.';
    END IF;
    IF v_urgency IS NULL OR v_urgency = '' THEN
        RAISE EXCEPTION 'El campo "urgency" es requerido.';
    END IF;
    IF v_description IS NULL OR v_description = '' THEN
        RAISE EXCEPTION 'El campo "description" es requerido.';
    END IF;
    IF v_location_text IS NULL OR v_location_text = '' THEN
        RAISE EXCEPTION 'El campo "location_text" es requerido.';
    END IF;

    -- Validaciones de enums
    IF NOT (v_type IN ('desaparecido', 'emergencia_medica', 'rescate_estructural', 'suministros', 'sin_comunicacion')) THEN
        RAISE EXCEPTION 'Tipo de incidente inválido: %', v_type;
    END IF;
    IF NOT (v_urgency IN ('critico', 'alto', 'moderado')) THEN
        RAISE EXCEPTION 'Nivel de urgencia inválido: %', v_urgency;
    END IF;

    -- 3. Búsqueda de Duplicados en Reportes Activos (No Resueltos)
    SELECT id INTO v_duplicate_id
    FROM public.reports r
    WHERE type = v_type::incident_type
      AND is_resolved = false
      AND (
        (v_type != 'desaparecido' AND (
            (v_lat IS NOT NULL AND v_lng IS NOT NULL AND lat IS NOT NULL AND lng IS NOT NULL AND
             (6371 * acos(LEAST(1.0, GREATEST(-1.0, cos(radians(v_lat)) * cos(radians(lat)) * cos(radians(lng) - radians(v_lng)) + sin(radians(v_lat)) * sin(radians(lat))))) < 0.5)
            OR (similarity(description, v_description) > 0.4)
            OR (similarity(location_text, v_location_text) > 0.4)
        ))
        OR
        (v_type = 'desaparecido' AND v_mp_name IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.missing_persons mp
            WHERE mp.report_id = r.id
              AND similarity(mp.full_name, v_mp_name) > 0.72
        ))
      )
    ORDER BY r.created_at DESC
    LIMIT 1;

    -- 4. Bifurcación: Fusión o Inserción
    IF v_duplicate_id IS NOT NULL THEN
        v_report_id := v_duplicate_id;
        v_status := 'merged';

        UPDATE public.reports
        SET description = description || E'\\n\\n[Actualización ' || to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS') || ' UTC]: ' || v_description,
            contact_info = CASE 
                WHEN v_contact_info IS NOT NULL AND v_contact_info != '' THEN 
                    COALESCE(contact_info, '') || ' | ' || v_contact_info
                ELSE contact_info 
            END,
            source_url = CASE 
                WHEN v_source_url IS NOT NULL AND v_source_url != '' AND COALESCE(source_url, '') NOT LIKE '%' || v_source_url || '%' THEN 
                    CASE WHEN source_url IS NOT NULL AND source_url != '' THEN source_url || ' | ' || v_source_url ELSE v_source_url END
                ELSE source_url
            END
        WHERE id = v_duplicate_id;

    ELSE
        v_status := 'created';
        EXECUTE '
            INSERT INTO public.reports (
                type,
                urgency,
                title,
                source_url,
                description,
                location_text,
                lat,
                lng,
                contact_info,
                state
            ) VALUES (
                $1::incident_type,
                $2::urgency_level,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10
            ) RETURNING id
        ' INTO v_report_id USING v_type, v_urgency, v_title, v_source_url, v_description, v_location_text, v_lat, v_lng, v_contact_info, v_state;
    END IF;

    -- 5. Procesamiento de Persona Desaparecida
    IF v_type = 'desaparecido' OR v_missing_person IS NOT NULL THEN
        IF v_missing_person IS NULL THEN
            RAISE EXCEPTION 'Se requiere el nodo "missing_person" para incidentes de tipo desaparecido.';
        END IF;

        v_mp_name := v_missing_person->>'full_name';
        v_mp_description := v_missing_person->>'physical_description';
        v_mp_last_seen := v_missing_person->>'last_seen_location';

        IF v_mp_name IS NULL OR v_mp_name = '' THEN
            RAISE EXCEPTION 'El campo "missing_person.full_name" es obligatorio.';
        END IF;

        IF v_status = 'merged' THEN
            SELECT id INTO v_mp_existing_id
            FROM public.missing_persons
            WHERE report_id = v_report_id
              AND similarity(full_name, v_mp_name) > 0.6;
        END IF;

        IF v_mp_existing_id IS NULL THEN
            INSERT INTO public.missing_persons (
                report_id,
                full_name,
                physical_description,
                last_seen_location
            ) VALUES (
                v_report_id,
                v_mp_name,
                v_mp_description,
                v_mp_last_seen
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'report_id', v_report_id,
        'status', v_status
    );
END;
$func$;
    `;
    
    await client.query(funcSql);
    return res.send('Función creada/actualizada exitosamente.');
  } catch (err) {
    return res.status(500).send(`Error: ${err.message}`);
  } finally {
    if (client) client.release();
    await pgPool.end();
  }
});

// Endpoint para forzar la limpieza de registros importados con prefijo hosp_mpc
app.get('/api/admin/debug-db', async (req, res) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return res.status(500).send('DATABASE_URL no definida.');
  const pgPool = new pg.Pool({ connectionString });
  let client;
  try {
    client = await pgPool.connect();
    const reports = await client.query('SELECT id, type, title, source_url, location_text, is_resolved FROM public.reports;');
    const persons = await client.query('SELECT id, report_id, full_name FROM public.missing_persons;');
    const func = await client.query("SELECT pg_get_functiondef('public.submit_emergency_report'::regproc) AS def;");
    return res.json({
      reports: reports.rows,
      persons: persons.rows,
      funcDef: func.rows[0] ? func.rows[0].def : null
    });
  } catch (err) {
    return res.status(500).send(err.message);
  } finally {
    if (client) client.release();
    await pgPool.end();
  }
});

app.get('/api/admin/force-cleanup', async (req, res) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return res.status(500).send('DATABASE_URL no definida.');
  }

  const pgPool = new pg.Pool({ connectionString });
  let client;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN;');
    await client.query("SET LOCAL app.role = 'authenticated';");

    // 1. Borrar todas las personas asociadas a los reportes a limpiar
    const delMP = await client.query(`
      DELETE FROM public.missing_persons 
      WHERE report_id IN (
        SELECT id FROM public.reports 
        WHERE source_url LIKE '%hosp_mpc%'
           OR location_text = 'Hospital Miguel Pérez Carreño (La Yaguara)'
           OR title LIKE '%Adriana Vastidas%'
      );
    `);
    console.log(`[Limpieza] Personas desaparecidas eliminadas: ${delMP.rowCount}`);

    // 2. Borrar los reportes maestros
    const delR = await client.query(`
      DELETE FROM public.reports 
      WHERE source_url LIKE '%hosp_mpc%'
         OR location_text = 'Hospital Miguel Pérez Carreño (La Yaguara)'
         OR title LIKE '%Adriana Vastidas%';
    `);
    console.log(`[Limpieza] Reportes eliminados: ${delR.rowCount}`);

    await client.query('COMMIT;');
    return res.status(200).send(`Limpieza forzada completada. Reportes eliminados: ${delR.rowCount}, Personas eliminadas: ${delMP.rowCount}`);
  } catch (err) {
    if (client) await client.query('ROLLBACK;');
    console.error(`Error en limpieza forzada: ${err.message}`);
    return res.status(500).send(`Error en limpieza forzada: ${err.message}`);
  } finally {
    if (client) client.release();
    await pgPool.end();
  }
});


// ============================================================================
// AI AGENT READY & DISCOVERY ENDPOINTS (RFC 8288, RFC 9727, RFC 9728, WebMCP)
// ============================================================================

// 1. API Catalog (RFC 9727)
app.get('/.well-known/api-catalog', (req, res) => {
  res.header('Content-Type', 'application/linkset+json; charset=utf-8');
  res.json({
    linkset: [
      {
        anchor: "https://ayudavenezuela.technolink.tech/",
        rel: "api-catalog",
        href: "https://ayudavenezuela.technolink.tech/.well-known/api-catalog"
      },
      {
        anchor: "https://ayudavenezuela.technolink.tech/api/reports",
        rel: "service-desc",
        type: "application/json",
        href: "https://ayudavenezuela.technolink.tech/api/reports"
      },
      {
        anchor: "https://ayudavenezuela.technolink.tech/pfif",
        rel: "service-desc",
        type: "application/xml",
        href: "https://ayudavenezuela.technolink.tech/pfif"
      },
      {
        anchor: "https://ayudavenezuela.technolink.tech/health",
        rel: "status",
        type: "application/json",
        href: "https://ayudavenezuela.technolink.tech/health"
      }
    ]
  });
});

// 2. OpenID Connect Discovery Configuration
app.get('/.well-known/openid-configuration', (req, res) => {
  res.json({
    issuer: "https://ayudavenezuela.technolink.tech",
    authorization_endpoint: "https://ayudavenezuela.technolink.tech/auth/login",
    token_endpoint: "https://ayudavenezuela.technolink.tech/auth/token",
    jwks_uri: "https://ayudavenezuela.technolink.tech/.well-known/jwks.json",
    grant_types_supported: ["authorization_code", "client_credentials"],
    response_types_supported: ["code", "token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"]
  });
});

// 3. OAuth 2.0 Authorization Server Metadata (RFC 8414)
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  res.json({
    issuer: "https://ayudavenezuela.technolink.tech",
    authorization_endpoint: "https://ayudavenezuela.technolink.tech/auth/login",
    token_endpoint: "https://ayudavenezuela.technolink.tech/auth/token",
    jwks_uri: "https://ayudavenezuela.technolink.tech/.well-known/jwks.json",
    grant_types_supported: ["authorization_code", "client_credentials"],
    response_types_supported: ["code", "token"],
    agent_auth: {
      register_uri: "https://ayudavenezuela.technolink.tech/auth/register",
      supported_identity_types: ["organization", "agent_runner"],
      supported_credential_types: ["private_key_jwt"]
    }
  });
});

// 4. OAuth Protected Resource Metadata (RFC 9728)
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  res.json({
    resource: "https://ayudavenezuela.technolink.tech/api/reports",
    authorization_servers: [
      "https://ayudavenezuela.technolink.tech"
    ],
    scopes_supported: ["read:reports", "write:reports", "resolve:reports"]
  });
});

// 5. MCP Server Card (SEP-1649)
app.get('/.well-known/mcp/server-card.json', (req, res) => {
  res.json({
    serverInfo: {
      name: "SismoVenezuela Emergency Server",
      version: "1.0.0",
      description: "Exposes emergency response data, missing persons, and connectivity telemetry in Venezuela."
    },
    transport: {
      type: "sse",
      endpoint: "https://ayudavenezuela.technolink.tech/api/mcp/sse"
    },
    capabilities: {
      resources: {
        subscribe: true,
        list: true
      },
      tools: {
        list: true
      }
    }
  });
});

// 6. Agent Skills Discovery Index (Agent Skills RFC v0.2.0)
app.get('/.well-known/agent-skills/index.json', (req, res) => {
  res.json({
    $schema: "https://agentskills.io/schema/v0.2.0/discovery.json",
    skills: [
      {
        name: "link-headers",
        type: "link-headers",
        description: "Link response headers pointing agents to catalog resources.",
        url: "https://ayudavenezuela.technolink.tech/.well-known/agent-skills/link-headers/SKILL.md",
        sha256: "4fa6e3b8a3e0c010a30b30ef2d36a18d10e0c90c177f2e7e71076c2c7311fdbb"
      },
      {
        name: "markdown-negotiation",
        type: "markdown-negotiation",
        description: "Content negotiation returning clean Markdown formatting.",
        url: "https://ayudavenezuela.technolink.tech/.well-known/agent-skills/markdown-negotiation/SKILL.md",
        sha256: "8b64e0add41743f5bf40fbca0236a18d10e0c90c177f2e7e71076c2c7311fdbb"
      },
      {
        name: "api-catalog",
        type: "api-catalog",
        description: "RFC 9727 API Catalog for automated endpoint discovery.",
        url: "https://ayudavenezuela.technolink.tech/.well-known/agent-skills/api-catalog/SKILL.md",
        sha256: "cb6bf133450c8f9c068136b7608c86d2775957c0098b4722d36c2c7311fdbbc0"
      }
    ]
  });
});


app.listen(port, () => {
  console.log(`Servidor de emergencia escuchando en el puerto ${port}`);
  startMissingPersonsSyncScheduler();
});
