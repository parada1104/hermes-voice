# Explore: STT incremental (paso 2 del realtime)

Fecha: 2026-08-26
Estado: completado
Origen: `pendientes/2026-08-26-stt-incremental` (vault) · `ARCHITECTURE.md` paso 2

## Pregunta

`sttOmlx()` es batch puro: arma el blob entero, lo manda a `/v1/audio/transcriptions`
y espera la respuesta completa. Mientras el usuario habla no ve nada. ¿Cómo se
transcribe en streaming para que la transcripción aparezca en vivo?

## Hallazgos

### 1. El pipeline hoy es batch de punta a punta

- **Browser (app/ui/index.html)**: `MediaRecorder` graba `webm/opus` (o `mp4`).
  - Modo continuo: `recorder.start()` **sin timeslice** → acumula chunks en memoria
    y manda el blob SOLO en `onstop` (cuando el VAD corta por silencio).
  - `vigilarSilencio()` usa `DetectorVoz` (`app/ui/lib/vad.js`): cierra por silencio
    sostenido (900ms) con techo de 25s — paso 1 del roadmap, ya hecho.
  - Envío: `flushContinuo(blob,mime)` → `{type:'audio',data:b64}` +
    `{type:'audio-end',...}`.
- **Server (daemon/server.js:321-370)**: acumula chunks en `st.buffer`; en
  `audio-end` concatena TODO el buffer, llama `sttOmlx(audio, mime)` y recién ahí
  emite `{type:'transcripcion', payload:{sesionId,text,parcial:false}}`.
- **STT (daemon/connector.js:372 `sttOmlx`)**: transcodifica webm→wav 16kHz mono
  con ffmpeg, POST multipart a `${OMLX_BASE}/v1/audio/transcriptions`
  (oMLX whisper, local `127.0.0.1:8000`), espera la respuesta completa.
- **UI**: `transcripcion` → `inicioTransc(); pushTransc(text)` (pinta la burbuja).

### 2. El protocolo YA tiene `parcial`, pero nadie lo emite

- `server.js:12` documenta `{type:'transcripcion', payload:{sesionId, text, parcial}}`.
- Solo existe el envío final con `parcial:false`; **nunca** se emite `parcial:true`.
- La UI ya pinta cualquier `transcripcion` que llegue → emitir parciales desde el
  server es compatible con la UI actual sin cambios de contrato.

### 3. oMLX whisper NO tiene streaming real

- El endpoint `v1/audio/transcriptions` es batch por diseño (OpenAI-compatible).
- "Incremental" entonces significa **re-transcribir ventanas del audio acumulado**
  periódicamente mientras se habla, emitiendo `parcial:true`, y la transcripción
  definitiva al cortar.

### 4. Restricciones técnicas que condicionan el diseño

- `tieneCabeceraWebm()` (`server.js:204`) descarta cualquier chunk cuyo blob no
  empiece con la cabecera EBML `1A 45 DF A3`. Para parciales, **cada envío debe
  ser un blob autocontenido** (concatenar los chunks acumulados, como ya hace
  `new Blob(chunks)` en el UI) — nunca un fragmento timeslice suelto.
- `st.processing` guard: mientras hay turno en curso se descartan nuevos `audio`/
  `audio-end`. Los parciales no deben colisionar con ese guard.
- El blob parcial se transcodifica con ffmpeg igual que el final → el costo es
  CPU local (whisper-large-v3-turbo en oMLX :8000). Re-transcribir a ~2s en un
  dictado de 25s son ~12 transcripciones del mismo audio creciente.
- La transcripción parcial de una ventana puede diferir del texto final
  (whisper "corrige" con más contexto). La UI debe **reemplazar** el texto de la
  burbuja, no acumular — `pushTransc` ya reemplaza `textContent`.

## Opciones de diseño (se resuelven en design)

| Opción | Dónde | Cómo | Costo/riesgo |
|---|---|---|---|
| A. Parciales client-side | UI emite el blob acumulado cada N ms con `parcial:true` | El server lo transcribe y emite `transcripcion parcial:true`; al `audio-end` el flujo normal con `parcial:false` | Mínimo toque en server; el UI manda varias veces el audio creciente. El parcial nunca se usa para el turno, solo se muestra. |
| B. Parciales server-side por timer | Server re-transcribe `st.buffer` cada N ms | Timer por cliente activo; emite parciales; el final sigue igual | Toca el accumulation del server; necesita marcar "en captura" para no pisar `processing`. |
| C. Timeslice en MediaRecorder | `recorder.start(2000)` emite chunks cada 2s | UI acumula y manda blob parcial periódico; mismo contrato que A | El filtro de cabecera EBML fuerza blob autocontenido por envío — concat igual que hoy. |

Costo mínimo viable: opción A con intervalo ~1.5–2.5s y techo de ventana.

## Relacionado

- `openspec/config.yaml` — contexto del proyecto (pipeline, TDD estricto).
- `pendientes/2026-08-26-estado-rico-gui` (vault) — el paso 3 depende de que el
  paso 2 emita estado; dejar `parcial` bien expuesto allana ese camino.
- `ARCHITECTURE.md` "Voz en tiempo real" — pasos 1 (hecho) → 2 (este) → 3.
