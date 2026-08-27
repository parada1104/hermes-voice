/**
 * Aviso hablado durante una delegación larga.
 *
 * El latido visual solo sirve si Robert está mirando la pantalla, y con voz no
 * suele estarlo. Cuando la espera se alarga conviene decir algo — pero no cada
 * cinco segundos: se avisa en umbrales espaciados y sin repetir la frase.
 */

// Segundos a los que se avisa. Espaciados a propósito: molestar es peor que callar.
const UMBRALES = [30, 90, 180, 300, 480]

const FRASES_ESPERA = [
  'Sigo en ello, señor.',
  'El agente continúa trabajando, señor.',
  'Esto está llevando un par de minutos, señor; sigo atento.',
  'Ya vamos por varios minutos, señor. Aviso en cuanto tenga algo.',
  'La consulta se está alargando bastante, señor. ¿Prefiere que la corte?',
]

function avisoDeEspera(segundos, ultimoUmbral) {
  const s = Number(segundos)
  const previo = Number(ultimoUmbral) || 0
  if (!Number.isFinite(s) || s < 0) return null

  // El umbral más alto ya alcanzado que todavía no se anunció.
  let elegido = null
  for (const u of UMBRALES) { if (s >= u && u > previo) elegido = u }
  if (elegido === null) return null

  const i = UMBRALES.indexOf(elegido)
  return { desde: elegido, frase: FRASES_ESPERA[Math.min(i, FRASES_ESPERA.length - 1)] }
}

module.exports = { avisoDeEspera, UMBRALES, FRASES_ESPERA }
