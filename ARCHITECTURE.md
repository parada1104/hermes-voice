# Conector de agente — Hermes Voice (diseño técnico)

> Este documento describe **el objetivo**: cómo debe estar construido el sistema.
> No es una foto del avance. El estado vive en git y en `openspec/`; si acá
> aparece una fecha o un "ya corre", es un error a corregir.

## La idea en una frase

**Una capa conversacional liviana sostiene el diálogo y delega el trabajo real a
un agente pesado. Cada sesión de voz posee su propio hilo; las conversaciones del
agente no son ese hilo, son sus tareas delegadas.**

## Componentes

Dos, no tres.

```
┌── app/ ──────────────────────────────────────────┐
│  Electron + HTML/JS vanilla (app/ui)             │
│  Captura de mic, VAD por silencio, reproducción  │
│  Único cliente del daemon                        │
└──────────────────┬───────────────────────────────┘
                   │  WS + REST · localhost:8471
┌──────────────────▼───────────────────────────────┐
│  daemon/ — Node CommonJS                          │
│                                                   │
│   STT (oMLX whisper)                              │
│        ↓                                          │
│   Capa conversacional  ──→ responde  → TTS (oMLX) │
│   (daemon/capa.js)     ──→ delega               │
│        ↓                                          │
│   Cascada de delegación (abajo)                   │
│                                                   │
│   Sesiones, hilos, jobs, timeouts, eventos vivos  │
└───────────────────────────────────────────────────┘
```

## La capa conversacional

Vive en `daemon/capa.js` y **debe seguir siendo portable entre proveedores**. El
proveedor, el modelo y la key son configurables; la elección de modelo se **mide**,
no se supone, y la tabla de mediciones se mantiene en ese archivo.

Dos reglas que no se negocian:

- **La disciplina de ruteo (responder vs delegar) vive en el código y en una sola
  tool call nativa**, no en prosa del prompt. Una iteración previa puso la
  disciplina en el system prompt y un modelo de 7B confabuló igual.
- **El toolset se mantiene mínimo** — idealmente una herramienta de delegación más
  stop/cancel. Los modelos chicos se degradan rápido a medida que las tools crecen.

Los campos específicos de un proveedor (por ejemplo apagar el razonamiento) se
resuelven en `capa.js` a partir del proveedor elegido, **nunca hardcodeados en el
cuerpo de la petición**: un campo que un proveedor acepta, otro lo rechaza con 400.

## Cascada de delegación

Delegar al agente `hermes` recorre tres caminos, en este orden:

| # | Camino | Cuándo | Dónde |
|---|--------|--------|-------|
| 1 | **Worker de Orca con REPL vivo** — es el camino principal | Orca disponible, la sesión tiene perfil y el turno no trae adjunto | `daemon/worker.js`, `daemon/orca.js` |
| 2 | **CLI headless de Hermes** | Sin Orca, o el turno trae un adjunto (necesita el one-shot `chat --image`) | `daemon/connector.js` |
| 3 | **`POST /v1/runs`** en el API server `:8642` | Solo sesiones **sin perfil**. Último recurso | `daemon/connector.js` |

El camino 1 mantiene el hilo del agente caliente, evita el arranque en frío y lo
deja visible para el usuario. **La respuesta del agente se lee del `state.db`
SQLite de Hermes** (`daemon/store-hermes.js`), no raspando el TTY: Hermes persiste
cada mensaje del turno —el del usuario, cada petición de herramienta, cada
resultado y la respuesta final— antes de devolver el prompt. El TTY es un TUI que
repinta, y reconstruir una respuesta de ahí es frágil por diseño.

No diseñar contra el camino 3.

Otros agentes: **`pi`** (harness propio, acotado a un working dir). **`orca` es
infraestructura** que corre workers, no un agente conversacional.

## Sesiones y los dos hilos

Cada sesión de voz posee su hilo. El hilo de voz y el del chat son **dos historias
distintas y no se aplanan en una**. Las delegaciones se rinden como **runs
anidados colapsables** dentro del turno de voz, colapsados por defecto.

Que el run anidado sea visible no es cosmético: **es la única forma de cazar el
modo de fallo conocido**, donde el modelo chico confabula una respuesta sin haber
llamado nunca a la herramienta de delegación. Si solo se muestra la síntesis, ese
bug es invisible.

## Voz en tiempo real (el norte)

El diseño no debe depender del modo. Tres pasos:

1. **Captura por silencio** — el VAD corta cuando dejas de hablar, en vez de un
   corte ciego por reloj. *Hecho.*
2. **STT incremental** — transcribir en streaming mientras hablas, para que la
   respuesta empiece a formarse antes de que termines.
3. **Estado rico en la GUI** — que la interfaz refleje honestamente en qué fase
   está cada pieza.

## Documentos relacionados

- `REQUIREMENTS.md` — el contrato de producto (R1..R8). Es lo que hay que cumplir.
- `IDEA.md` — el norte y el porqué.
- `BRIEF.md` — **histórico**. Describe un encuadre anterior (plugin de Hermes
  Desktop) que quedó superado; su sección de decisiones de diseño sigue siendo
  válida y está recogida acá.
