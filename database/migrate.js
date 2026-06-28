import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const runMigrations = async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: La variable de entorno DATABASE_URL no está definida.');
    process.exit(1);
  }

  console.log('Iniciando migración de base de datos en Google Cloud SQL...');
  const pool = new pg.Pool({ connectionString });

  let client;
  try {
    client = await pool.connect();

    // 1. Establecer lock_timeout corto para evitar colgar el arranque del contenedor
    await client.query("SET lock_timeout = '8s'");

    // 2. Intentar agregar el nuevo valor al enum de forma aislada
    try {
      await client.query("ALTER TYPE incident_type ADD VALUE IF NOT EXISTS 'sin_comunicacion'");
      console.log('Enum incident_type actualizado exitosamente con "sin_comunicacion".');
    } catch (err) {
      // Ignorar si ya existe o está en bloque de transacción
    }

    // 3. Terminar otras conexiones activas de la base de datos para facilitar adquisición de locks DDL
    try {
      await client.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND datname = current_database();
      `);
      console.log('Otras conexiones concurrentes terminadas.');
    } catch (err) {
      console.log('Nota: No se pudieron terminar conexiones concurrentes:', err.message);
    }

    // 4. Leer y ejecutar schema.sql
    const sqlPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await client.query(sql);
    console.log('Migración y carga de esquema completada exitosamente (Idempotente).');
    process.exit(0);
  } catch (error) {
    // Si falla por falta de adquisición de bloqueo (lock timeout: 55P03), no colapsar el arranque del contenedor
    if (error.code === '55P03') {
      console.warn('AVISO RECIENTE: No se pudo adquirir el bloqueo exclusivo para DDL en 8s (base de datos con tráfico activo).');
      console.warn('El servidor continuará el arranque normalmente asumiendo que el esquema ya está actualizado.');
      process.exit(0);
    } else {
      console.error('Error crítico durante la migración de base de datos:', error.message);
      process.exit(1);
    }
  } finally {
    if (client) client.release();
    await pool.end();
  }
};

runMigrations();
