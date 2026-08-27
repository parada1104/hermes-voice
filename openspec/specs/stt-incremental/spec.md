# stt-incremental Specification

## Purpose

Live partial speech transcription during a voice turn: the client may send the
accumulated audio blob while recording, the daemon transcribes it with the same
`sttOmlx` contract as the final blob and echoes the text back as
`transcripcion` with `parcial: true` for the live bubble, and the final
`audio-end` turn keeps its existing behaviour untouched.

Roadmap context: this is realtime step 2 (step 1, silence-based cut, is done;
step 3, richer GUI state, is a separate change).

## Requirements

### Requirement: Transcripción parcial emitida mientras se graba

Mientras una captura de voz está en curso, el servidor SHALL poder recibir un
mensaje `audio` marcado como parcial (`parcial: true`) y emitir una
`transcripcion` con `parcial: true` con el texto transcrito de ese audio, sin
cambiar el flujo del turno final.

- El mensaje parcial SHALL ser un blob de audio autocontenido (con cabecera
  EBML si es webm), igual que el final.
- La transcripción parcial SHALL reemplazar, no acumular: cada parcial muestra
  el texto transcrito de la ventana acumulada hasta ese momento.
- La transcripción parcial SHALL NOT iniciar un turno, delegar, sintetizar ni
  tocar `st.processing`.
- El texto parcial SHALL ser transcrito por `sttOmlx` con el mismo contrato que
  el final (transcodificación webm→wav, mismo modelo y lenguaje).

#### Scenario: Llega un audio parcial durante la captura

- **GIVEN** una sesión de voz activa en el servidor (`st` existe) y sin turno
  en curso (`st.processing === false`), aunque el buffer aún esté vacío
- **WHEN** el cliente envía `{type:'audio', data:<b64>, mime, parcial:true}`
- **THEN** el servidor transcribe el blob
- **AND** emite `{type:'transcripcion', payload:{sesionId, text, parcial:true}}`
- **AND** no inicia ningún turno, ni toca `st.processing`, ni acumula en el buffer

#### Scenario: El parcial es un blob webm sin cabecera válida

- **GIVEN** un mensaje `audio` con `parcial:true` cuyo blob no empieza con la
  cabecera EBML `1A 45 DF A3`
- **WHEN** el servidor procesa el mensaje
- **THEN** el servidor SHALL descartarlo (mismo filtro que el final)
- **AND** no emitir ninguna `transcripcion` parcial por ese mensaje

#### Scenario: El parcial llega sin sesión activa o con turno en curso

- **GIVEN** un mensaje `audio` con `parcial:true` sin sesión activa (`st`
  ausente) o con un turno en curso (`st.processing === true`)
- **WHEN** el servidor lo procesa
- **THEN** el servidor SHALL ignorarlo sin error ni efecto visible

### Requirement: La transcripción final no cambia su contrato

El flujo de `audio-end` SHALL permanecer idéntico al actual: concatena el
buffer, transcribe con `sttOmlx`, emite `transcripcion` con `parcial:false` y
arranca el turno. Los parciales recibidos antes NO alteran el buffer ni el
resultado final.

#### Scenario: Turno de voz normal con y sin parciales previos

- **GIVEN** una captura que generó uno o más parciales y luego `audio-end`
- **WHEN** el servidor procesa `audio-end`
- **THEN** el texto final es el de la transcripción del blob completo
- **AND** el turno arranca exactamente como hoy
- **AND** el buffer usado es el de los chunks acumulados, sin mezclarse con
  parciales

#### Scenario: Parcial y audio-end se cruzan en el wire

- **GIVEN** un parcial en vuelo mientras llega `audio-end`
- **WHEN** el servidor procesa el `audio-end`
- **THEN** el turno final resuelve con la transcripción del blob completo
- **AND** el parcial (previo o posterior) no interfiere con el resultado

### Requirement: La UI envía parciales durante la captura

El cliente SHALL enviar el blob acumulado de la captura en curso cada ~2
segundos (intervalo mínimo configurable) mientras el recorder está activo y hay
voz acumulada, marcado como `parcial:true`, reutilizando la concatenación de
chunks existente.

- El envío parcial SHALL NO usar timeslice de MediaRecorder (evita fragmentos
  sin cabecera EBML).
- El cliente SHALL NO enviar parciales si no hay voz acumulada o si la captura
  es de texto.
- El cliente SHALL continuar enviando parciales hasta que el VAD corte por
  silencio (el flujo final no cambia).
- Si el parcial falla (daemon caído), el cliente SHALL callar el error parcial y
  dejar que el flujo final reporte como hoy.

#### Scenario: Captura con voz acumulada genera parciales periódicos

- **GIVEN** una captura de voz en curso con audio acumulado
- **WHEN** transcurre el intervalo de parcial (~2s)
- **THEN** el cliente envía `{type:'audio', data:<b64>, mime, parcial:true}`
  con el blob acumulado completo (autocontenido)
- **AND** repite mientras siga grabando con voz

#### Scenario: Captura sin voz no genera parciales

- **GIVEN** una captura en curso sin voz acumulada (silencio, ruido bajo)
- **WHEN** transcurre el intervalo de parcial
- **THEN** el cliente SHALL NOT enviar ningún parcial

#### Scenario: Frase corta sin llegar al primer intervalo

- **GIVEN** una captura que el VAD corta antes del primer intervalo de parcial
- **WHEN** el usuario deja de hablar
- **THEN** el flujo es idéntico a hoy (solo `audio` + `audio-end`, sin parciales)

### Requirement: La burbuja de transcripción se actualiza en vivo

La UI SHALL mostrar el texto parcial reemplazando el contenido de la burbuja de
transcripción en curso, y SHALL reemplazarlo por el texto final cuando llegue la
`transcripcion` con `parcial:false` (o al iniciarse el turno hablado).

#### Scenario: Parcial llega mientras la burbuja está activa

- **GIVEN** una burbuja de transcripción activa durante una captura
- **WHEN** llega una `transcripcion` con `parcial:true`
- **THEN** la burbuja muestra el texto parcial en lugar del anterior
- **AND** no se crea una burbuja nueva ni se acumula texto

#### Scenario: La transcripción final reemplaza al último parcial

- **GIVEN** una burbuja con texto parcial visible
- **WHEN** llega la `transcripcion` con `parcial:false` del mismo turno
- **THEN** la burbuja muestra el texto final
- **AND** el flujo posterior (turno, TTS) es el de hoy
