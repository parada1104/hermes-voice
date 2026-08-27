# Design: STT incremental en el turno de voz

> Change slug: `stt-incremental`
> Status: planning (no production edits)
> Branch / worktree: `feat/stt-incremental` / `.worktrees/stt-incremental/`

## Goals

1. Que el usuario vea su transcripción apareciendo en vivo mientras habla,
   reemplazándose a sí misma, sin tocar el flujo del turno final.
2. Emitir `transcripcion parcial:true` desde el server y parciales desde el UI,
   reutilizando el contrato `parcial` ya documentado en `server.js:12`.
3. Cero regresión en captura por silencio (paso 1), turno final, TTS y tests
   existentes (daemon 378/378, app 12/12).

## Non-Goals

- No streaming real de whisper (oMLX no lo soporta).
- No alimentar la capa conversacional con texto parcial.
- No cambiar la decisión de corte por silencio ni el contrato de `audio-end`.
- No tocar TTS ni el estado rico de la GUI (paso 3, pendiente separado).

## Architecture Decisions

### D1: Parciales client-side con intervalo fijo, sin timeslice

**Decisión**: el cliente (UI) envía el blob acumulado cada ~2s marcado
`parcial:true`, reutilizando `new Blob(chunks)` que ya usa en `onstop`. El
server lo resuelve y emite `transcripcion parcial:true`. El `audio-end` sigue
idéntico (opción A del explore).

**Racional**:
- El timeslice de MediaRecorder produce fragmentos sin cabecera EBML que el
  filtro `tieneCabeceraWebm` (`server.js:204`) descartaría. Mandando el blob
  autocontenido concatenado, cada envío pasa el filtro sin cambio.
- Es el menor toque posible en server: el handler de `audio` gana una rama
  `parcial`, `st.buffer` y `processing` quedan intactos para el final.
- El parcial es solo feedback; nunca participa del turno, así que el riesgo de
  inconsistencia parcial/final se absorbe reemplazando la burbuja.
- Timer server-side (opción B) se descarta: tocaría el guard `processing` y el
  accumulation, riesgo alto sin ganancia frente a A.

**Alternativa descartada**: B (server-side timer) y C (timeslice) por el filtro
EBML y por complejidad en el accumulation.

### D2: El parcial se serializa contra el `audio-end`

**Decisión**: el server procesa los mensajes en orden de llegada; cuando llega
`audio-end`, ese es el que resuelve el turno. Un parcial previo o posterior al
`audio-end` no altera ni el buffer ni el resultado final.

**Racional**:
- El WS es single-threaded por cliente (`ws.on('message')` async encadenado), así
  que no hay carrera real en el server: los mensajes se procesan en orden.
- El parcial no toca `st.buffer` ni `processing`, así que nunca pisa el final.
- La UI no bloquea entre parciales: manda el blob acumulado en ese instante; el
  cortar por silencio dispara el `audio-end` normal.

### D3: Umbral de frecuencia con techo de coste local

**Decisión**: intervalo de parcial ~2s (no recortado por debajo), solo durante
captura de voz con voz acumulada. El costo CPU de re-transcribir en oMLX local
se acota por el intervalo y por "no parciales sin voz".

**Racional**:
- oMLX whisper es local y batch; cada parcial es una transcripción del blob
  creciente. A 2s en un dictado de 25s son ~12 transcripciones del mismo audio —
  el costo se paga en CPU local, no en red.
- Intervalo menor (1s) duplicaría transcripciones sin feedback perceptible.

## Solution Overview

### Protocolo (sin cambio de esquema, usa `parcial` existente)

- **cliente → server**: `{type:'audio', data:<b64>, mime, parcial:true}`
- **server → cliente**: `{type:'transcripcion', payload:{sesionId, text, parcial:true}}`
- **cliente → server**: `{type:'audio-end', ...}` (idéntico a hoy) →
  `transcripcion parcial:false` + turno.

### Lado del cliente (`app/ui/index.html`)

- En la captura (modo continuo y push-to-talk), un timer de ~2s mientras el
  recorder está activo (`recorder.state==='recording'`) y hay chunks de audio:
  - arma `new Blob(chunks)` (autocontenido),
  - si `ab.length >= 1024` y `ws` OPEN, envía `{type:'audio', parcial:true}`,
  - reinicia el timer.
- No usa timeslice: el recorder sigue produciendo un webm autocontenido al
  `onstop`, y los parciales son copias del blob acumulado hasta cada tick.
- `pararContinuo()` / `pararMic()` limpian el timer de parciales.

### Lado del servidor (`daemon/server.js`)

- En `ws.on('message')`, rama `audio`:
  - si `msg.parcial === true` → si hay captura activa y el blob pasa
    `tieneCabeceraWebm` (si webm), transcribir con `sttOmlx` y emitir
    `transcripcion parcial:true`; NO tocar `st.buffer` ni `processing`; si no
    hay captura activa, ignorar.
  - si no es parcial → comportamiento actual (acumular en `st.buffer`).
- El `audio-end` queda sin cambios.

### Función de transcripción (`daemon/connector.js`)

- `sttOmlx(audioBytes, mime)` se reutiliza tal cual para parciales: ya hace la
  transcodificación webm→wav, el POST a oMLX y devuelve `.text`. No se le exige
  cambio. (Opcional, no en scope: refactor a una variante con timeout corto.)

## Concurrency / failure model

- **Parcial falla (STT caído)**: se captura el error, se loguea y se descarta el
  parcial (la UI no pinta nada nuevo). El `audio-end` reporta el fallo como hoy.
- **Parcial y `audio-end` cruzados**: el server procesa en orden; el `audio-end`
  resuelve el turno con el blob completo. El parcial no interfiere.
- **Sin captura activa**: el parcial se ignora silenciosamente.
- **Daemon caído a mitad de captura**: el cliente simplemente no recibe
  parciales; el flujo final cae en el error de hoy.

## Files to change

| File | Change |
|---|---|
| `app/ui/index.html` | Timer de parciales →2s en captura; envío `parcial:true`; limpieza del timer en `pararContinuo`/`pararMic`; manejo del reemplazo de burbuja (ya existe en `pushTransc`) |
| `daemon/server.js` | Rama `parcial:true` en handler de `audio` (si hay captura activa → transcribir → emitir `transcripcion parcial:true`) |
| `daemon/connector.js` | Sin cambios obligatorios (reusa `sttOmlx`) |
| Tests | Nuevo: parcial se emite y no interfiere con el turno final; UI envío parcial |

## Verification plan

- **TDD estricto** (`openspec/config.yaml`): test primero.
  - `daemon`: test de `parcial:true` en el handler de `audio` (emite
    `transcripcion` parcial, no toca `processing`, no inicia turno; parcial
    ignorado sin captura activa o sin cabecera EBML válida; `audio-end` final
    idéntico).
  - `app`: test del envío de parcial ~2s con voz y su ausencia sin voz.
- **Suites**: `test-backend.js` (daemon) y `test-ui-e2e.js` verdes tras el
  cambio.