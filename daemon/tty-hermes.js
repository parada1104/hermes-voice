/**
 * ¿El REPL de Hermes está libre? Nada más.
 *
 * Este módulo llegó a extraer la RESPUESTA del agente raspando el TTY. Ya no:
 * la respuesta sale del store (`store-hermes.js`), estructurada y sin repintados.
 * Lo único que el terminal sigue sabiendo mejor que nadie es si el proceso está
 * ocupado, y eso se usa para dos cosas: saber que el worker terminó de arrancar
 * y acotar la espera si un turno muriera sin cerrarse en el store.
 *
 * Medido contra Orca 1.4.188 y el CLI real:
 *  · `terminal wait --for tui-idle` devuelve `satisfied:true` MIENTRAS el agente
 *    sigue trabajando. No es señal de fin de tarea y no se usa para eso.
 *  · La señal fiable es el prompt: mientras trabaja muestra
 *    `⚕ ❯ msg=interrupt · /queue · …`; al terminar vuelve a `<perfil> ❯`.
 */

// El prompt de entrada NO siempre lleva el perfil: capturado en vivo aparece
// como `entrenador ❯ <sugerencia>` y también como `❯ Ask anything, or type /
// for commands…`. Lo que lo define es que lleva `❯` y NO es el de trabajo.
const PROMPT_CUALQUIERA = /❯/
const PROMPT_TRABAJO = /^\s*⚕\s*❯/

function promptDeEntrada(_perfil) { return PROMPT_CUALQUIERA }

// Libre = el prompt de ENTRADA reaparece DESPUÉS del último prompt de trabajo.
// Mirar solo la última línea no sirve: el TUI deja separadores debajo.
function tareaTerminada(tail, perfil) {
  const lineas = (tail || []).map(String)
  let ultimoEntrada = -1, ultimoTrabajo = -1
  lineas.forEach((l, i) => {
    if (PROMPT_TRABAJO.test(l)) ultimoTrabajo = i
    else if (PROMPT_CUALQUIERA.test(l)) ultimoEntrada = i
  })
  return ultimoEntrada >= 0 && ultimoEntrada > ultimoTrabajo
}

module.exports = { tareaTerminada, promptDeEntrada, PROMPT_TRABAJO, PROMPT_CUALQUIERA }
