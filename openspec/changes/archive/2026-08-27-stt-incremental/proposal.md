# Proposal: STT incremental en el turno de voz

## Why

Hoy el usuario habla, calla, y espera en silencio a que aparezca el texto. El
flujo completo es batch: la captura se acumula en el browser, recién al cortar
por silencio se manda el blob entero al daemon, el daemon lo transcodifica y lo
manda a oMLX whisper, y solo entonces llega `transcripcion` — una sola vez, al
final.

Ese silencio de espera es el cuello de botella percibido del turno. Cada
milisegundo ahí se siente porque **no hay nada que mirar**. Es el paso 2 del
roadmap de realtime (`ARCHITECTURE.md`), marcado como pendiente de prioridad
alta en el vault (`2026-08-26-stt-incremental`).

## Users / situations

- **Robert (el único usuario real de hermes-voice), en dictado normal**: habla
  una frase u orden, y quiere ver el texto apareciendo mientras habla, como en
  cualquier dictado moderno — no una espera ciega.
- **Dictados largos (>10s)**: son donde el batch duele más. Hoy la espera es
  proporcional al largo del turno; con parciales, el primer texto aparece en
  ~2s y se refina mientras sigue hablando.

## Business rules

- La transcripción parcial es **solo visual/feedback**: nunca alimenta el turno
  ni la capa conversacional. El turno sigue decidiéndose con la transcripción
  final (la misma de hoy).
- Emitir parciales no puede dejar un estado colgando: si el daemon o el STT
  falla a mitad de captura, el flujo debe caer al comportamiento de hoy (turno
  final con error o silencio), sin burbujas parciales huérfanas.
- La captura por silencio existente (paso 1) no cambia: sigue dictando CUÁNDO
  se cierra la frase y cuándo se manda la transcripción definitiva.

## Product outcome

Mientras Robert habla, ve su transcripción apareciendo en vivo en la burbuja del
turno (como `transcripcion parcial`), actualizada cada ~2s y reemplazándose a sí
misma. Al callar, el texto parcial se reemplaza por la transcripción definitiva
y el turno sigue exactamente como hoy. Percepción: el turno "arrancó", hay
feedback inmediato, cero espera ciega.

## Current-state gap

- `parcial` ya existe en el contrato (`server.js:12`) pero **nunca se emite**.
- La UI ya pinta cualquier `transcripcion` que reciba → el contrato de mostrar
  parciales ya está del lado del cliente.
- Falta: quién emite el audio parcial (UI), quién lo transcribe y lo vuelve a
  emitir como `parcial:true` (server), y las protecciones de concurrencia
  (cabecera EBML, guard de `processing`, techo de frecuencia).

## Implications / impact

- **Daemon**: el handler de `audio` pasa de "acumular y esperar" a poder
  resolver parciales. Es la pieza que más se toca, pero con contrato nuevo
  mínimo (`parcial:true`), no reescritura.
- **UI**: timer de envío parcial mientras el recorder está activo; reutiliza la
  concatenación de chunks que ya existe. Sin timeslice de MediaRecorder
  (evita el riesgo del filtro EBML).
- **Test suite**: daemon 378/378 y app 12/12 hoy. Los tests de streaming
  existentes (`test-streaming.test.js`) son del TTS/SSE, no del STT; hace falta
  cobertura nueva para el envío parcial y el turno final.

## Edge cases

- **Frase corta (< techo de parcial)**: si el usuario calla antes del primer
  parcial, no se emite ningún parcial — el flujo final es idéntico a hoy.
- **Parcial en vuelo cuando corta el silencio**: el envío del parcial y el
  `audio-end` pueden cruzarse en el wire. El server debe serializar: los
  parciales previos se descartan, el final manda y resuelve el turno.
- **Daemon/STT caído a mitad**: parcial falla → silencio (la UI no pinta nada
  nuevo); al final el error se reporta como hoy (`daemon-off`).
- **Blob parcial vacío o sin voz detectada**: el VAD ya descarta capturas sin
  frase en `onstop`; los parciales no deben mandarse si no hay voz acumulada.

## First-slice scope

1. UI: enviar el blob acumulado cada ~2s mientras el recorder graba, marcado
   como parcial, solo si hay voz y hay un turno de voz activo.
2. Server: en `audio`, si llega `parcial:true`, transcribir y emitir
   `transcripcion parcial:true` (sin tocar `processing` ni `st.buffer`).
3. Server: en `audio-end`, el flujo actual sin cambios (transcripción final
   con `parcial:false`).
4. Tests: parcial se emite y no interfiere con el turno final; turno final no
   cambia su contrato.

## Non-goals

- NO streaming real de whisper (oMLX no lo soporta; re-transcripción es la vía).
- NO alimentar la capa conversacional con texto parcial.
- NO cambiar la decisión de corte por silencio (paso 1).
- NO tocar TTS ni la GUI de estado rico (paso 3, pendiente separado).

## Product constraints

- oMLX whisper es local (`:8000`) pero batch; la re-transcripción tiene costo
  de CPU → intervalo mínimo razonable (~2s) y sin parciales en turnos de texto.
- El contrato del WS es estable: `transcripcion` con `parcial` ya documentado.
- TDD estricto habilitado (`openspec/config.yaml`): test primero.