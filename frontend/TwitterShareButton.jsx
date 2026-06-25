import React from 'react';

/**
 * TwitterShareButton Component
 * 
 * Genera un botón optimizado y ligero para compartir reportes de emergencia 
 * en la plataforma X (anteriormente Twitter) utilizando Web Intents.
 * 
 * @param {Object} props
 * @param {string} props.reportType - Tipo de incidente (ej. "emergencia_medica", "desaparecido")
 * @param {string} props.location - Dirección o punto de referencia
 * @param {string} props.description - Descripción detallada del reporte
 * @param {string} props.reportUrl - URL del reporte para adjuntar
 */
export default function TwitterShareButton({ 
  reportType, 
  location, 
  description, 
  reportUrl 
}) {
  // Traducir o formatear el tipo de reporte para que sea legible
  const formattedType = reportType ? reportType.replace(/_/g, ' ').toUpperCase() : 'INCIDENTE';

  // 1. Construir la cabecera dinámica de la alerta
  const alertHeader = `🚨 URGENTE: Reporte de ${formattedType} en ${location}\n\n`;

  // 2. Construir el bloque de menciones a entes de rescate y hashtags locales
  const alertFooter = `\n\nRescate: @PCivil_Ve @paramedicosmtt @bomberos_dc @MirandaPCivil\n#SismoCaracas #EmergenciaVzla`;

  // 3. Controlar inteligentemente el límite de 280 caracteres de X (Twitter).
  // La URL adjunta mediante el parámetro 'url' no cuenta para los 280 caracteres del texto base
  // porque X acorta los enlaces automáticamente a 23 caracteres. Sin embargo, el texto base sí se limita.
  const maxTextLimit = 280;
  const availableLength = maxTextLimit - alertHeader.length - alertFooter.length;

  let cleanDescription = description || '';
  if (cleanDescription.length > availableLength && availableLength > 10) {
    cleanDescription = cleanDescription.substring(0, availableLength - 3) + '...';
  }

  // 4. Armar el mensaje completo y realizar codificación URL estricta
  const fullText = `${alertHeader}${cleanDescription}${alertFooter}`;
  const encodedText = encodeURIComponent(fullText);
  const encodedUrl = encodeURIComponent(reportUrl || '');

  // 5. Construir el enlace final de Twitter Web Intent
  const twitterIntentUrl = `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`;

  return (
    <a
      href={twitterIntentUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center justify-center gap-3 w-full p-4 bg-black text-white hover:bg-neutral-900 border border-neutral-800 rounded-lg font-semibold tracking-wide transition-all duration-200 shadow-md hover:shadow-lg active:scale-[0.98] select-none text-sm md:text-base focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-black"
      aria-label="Difundir reporte de emergencia en X"
    >
      {/* Icono vectorial (SVG) de X / Twitter Rebranded */}
      <svg
        className="w-5 h-5 fill-current"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
      <span>Difundir Alerta en X</span>
    </a>
  );
}
