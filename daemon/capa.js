/**
 * Endpoint de la capa conversacional.
 *
 * `HV_CAPA_PROVIDER` solo cambiaba una etiqueta: la URL y la key estaban
 * clavadas a Cerebras, así que no se podía probar la capa con otro proveedor —
 * y sin eso es imposible saber si los fallos de tool call son del modelo o del
 * diseño. Aquí el proveedor, el modelo y la key son de verdad configurables.
 */

// `sinThinking` es por PROVEEDOR, no por modelo: describe qué acepta la API, no
// qué sabe hacer el modelo. nan-builders acepta `chat_template_kwargs`; cerebras
// responde 400 ("property 'chat_template_kwargs' is unsupported"), así que
// mandarlo a ciegas rompería la capa entera con ese proveedor.
const PROVEEDORES_CAPA = {
  cerebras:      { base: 'https://api.cerebras.ai/v1',   keyEnv: 'CEREBRAS_API_KEY',      modelo: 'gpt-oss-120b',    sinThinking: false },
  'nan-builders':{ base: 'https://api.nan.builders/v1',  keyEnv: 'NAN_BUILDERS_API_KEY',  modelo: 'qwen3.8-flash',   sinThinking: true },
  llmgateway:    { base: 'https://api.llmgateway.io/v1', keyEnv: 'LLMGATEWAY_API_KEY',    modelo: 'gemini-3.5-flash', sinThinking: false },
  groq:          { base: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY',        modelo: 'llama-3.1-8b-instant', sinThinking: false },
}

// Medido con 10 turnos por modelo, contando delegaciones y reparaciones:
//   cerebras/gemma-4-31b  → 4/5  · 5028ms · 10 reparaciones (todas las llamadas
//                                            salieron como texto)
//   nan-builders/qwen3.6  → 2/5  · 3282ms · 0 reparaciones (formato perfecto,
//                                            pero decide no delegar)
//   nan-builders/gemma4   → 10/10 · 1867ms · 0 reparaciones · continuidad 2/3
//   cerebras/gpt-oss-120b →  3/8  ·  600ms · 0 reparaciones · continuidad 3/3
// Tras REFORZAR las reglas de delegación en el prompt, se remidió:
//   nan-builders/gemma4   → 7/7 delegación · 3/3 continuidad · 1867ms
//   cerebras/gpt-oss-120b → 5/8 delegación · 2/3 continuidad ·  700ms
// La falta de continuidad de gemma4 era del PROMPT, no del modelo: con las
// reglas nuevas gana en las dos dimensiones. gpt-oss-120b es 2.5x más rápido
// pero delega de menos y esconde respuestas en `reasoning`.
//
// Remedición contra el modelo nuevo `qwen3.8-flash` (mismo VOICE_PROMPT y misma
// ORCA_TOOL; 11 turnos sueltos + 3 secuencias; TTFB de streaming con n=8):
//   nan-builders/gemma4            → 5/7 delegación · 3/3 continuidad · TTFB p50 1416ms / p90 1661ms
//   nan-builders/qwen3.8-flash     → 6/7 delegación · 3/3 continuidad · TTFB p50 3579ms / p90 5580ms
//   nan-builders/qwen3.8-flash·NT  → 7/7 delegación · 3/3 continuidad · TTFB p50 2566ms / p90 3189ms
// (NT = con el thinking apagado. Los tres: 4/4 no-delegación, cero reparaciones.)
//
// Gana qwen3.8-flash sin thinking, y el segundo extra de TTFB se paga por dos
// razones medidas. La primera: las dos fallas de gemma4 son "registrá en el
// vault…" y "anotá en mis notas…", donde contesta "lo tengo anotado, señor" y no
// delega — el registro se pierde EN SILENCIO. Perder un dato es un defecto de
// corrección; un segundo de más es una molestia. La segunda: gemma4 devuelve
// contenido VACÍO en 5 de 7 delegaciones, así que su TTFB bajo no sirve de nada
// (no hay nada que hablar y Robert escucha silencio hasta que vuelve el agente);
// qwen habla el preámbulo en 5 de 7.
const POR_DEFECTO = 'nan-builders'

function resolverCapa(env = process.env) {
  const pedido = env.HV_CAPA_PROVIDER || POR_DEFECTO
  const provider = PROVEEDORES_CAPA[pedido] ? pedido : POR_DEFECTO
  const cfg = PROVEEDORES_CAPA[provider]

  const keyEnv = env.HV_CAPA_KEY_ENV || cfg.keyEnv
  // Un `HV_CAPA_URL` propio hereda el flag del proveedor por defecto, que puede
  // no corresponder a ese endpoint: `HV_CAPA_SIN_THINKING=0` es la salida.
  const forzado = env.HV_CAPA_SIN_THINKING
  return {
    provider,
    modelo: env.HV_CAPA_MODELO || cfg.modelo,
    sinThinking: forzado == null || forzado === ''
      ? !!cfg.sinThinking
      : !/^(0|false|no)$/i.test(forzado),
    // Una URL explícita gana: sirve para un endpoint local o uno no catalogado.
    url: env.HV_CAPA_URL || `${cfg.base}/chat/completions`,
    keyEnv,
    key: env[keyEnv] || '',
  }
}

module.exports = { resolverCapa, PROVEEDORES_CAPA, POR_DEFECTO }
