# Hermes Voice — Requerimientos de producto (source of truth para UI y backend)

> Este documento define QUÉ debe ser el producto: es el contrato. La UI y el
> backend (daemon :8471) son las dos caras que deben cumplirlo.
>
> Acá NO va el avance. Qué está hecho y qué falta vive en git y en `openspec/`;
> una lista de pendientes escrita en prosa se pudre y termina mintiendo.

## Visión (una frase)

Una capa de voz híbrida (chat + voz) tipo "Codex lite" sobre agentes: hablas o
escribes, una capa conversacional liviana decide responder o delegar a un agente
pesado (Hermes, luego Pi/OpenCode), y todo vive en **sesiones** con su thread de
voz attachado al chat.

## Requisitos de producto (R..)

### R1 · Sesión = chat + voz, unidas por conector de agente
- Cada **sesión** (chat) tiene su **thread de voz** attachado (mismo id). Se conocen.
- La voz **sabe** cuándo cambias de contexto (multi-sesión): al cambiar de chat,
  cambia la sesión de voz vinculada.
- El thread de voz (transcript de voz) y el thread de chat son **dos historias
  distintas**, no se aplanan en una.

### R2 · Selector de sesiones
- La UI debe exponer la **lista de sesiones** activas para cambiar entre
  ellas (multi-contexto). No es solo "voz en vivo": es un panel de sesiones.
- Cada sesión muestra su estado (idle / escuchando / transcribiendo / hablando /
  daemon-off).

### R3 · Elección de agente al delegar
- Antes/ al delegar, el usuario indica a **qué agente** va la tarea:
  - **Hermes** (por defecto) — el transporte lo elige el daemon; ver la cascada
    de delegación en ARCHITECTURE.md
  - **Pi** (harness propio)
  - (futuro: OpenCode, Codex)
- Es parte del brief "el conector es genérico: luego puede apuntar a otros harness".

### R4 · Delegaciones visibles como runs colapsables
- La conversación del agente pesado es una **tarea delegada**, no el hilo de voz.
- Cada delegación = **run anidado colapsable** dentro del turno:
  - estado: agente · N tools · Ns
  - body: brief / flujo / mini-terminal (output real)
- Collapsed por defecto; expandible. Es la única forma de ver si el modelo
  chico "confabuló" sin delegar.

### R5 · Thread híbrido con transcripción en vivo
- El thread muestra **transcripción en vivo** del habla (user y agente) en
  paralelo, y el flujo de texto (burbujas + delegaciones).
- Live = el usuario ve su habla y la del agente mientras ocurren.

### R6 · Estados de voz del micrófono (UI honesta)
- Mic con **3 estados visibles**: idle (gris), listo para escuchar (hover),
  mute (tachado) — y el orb refleja listening (halo) / speaking (halo accent).
- Iconos reales (SVG line), NO globos raros ni cajas grises vacías.

### R7 · Escenas de estado (consistencia visual)
- La app tiene **5 escenas** de estado, con contenido real y distinto:
  1. **idle** — sin conversación, "Esperando tu mensaje…", composer vacío, mic idle.
  2. **escuchando** — transcripción en vivo (user), stepper 01 on, orb listening.
  3. **transcribiendo** — fase 02, mostra resultado STT (user) confirmado.
  4. **hablando** — fase 03, respuesta del agente + delegación (si hubo), orb speaking.
  5. **daemon-off** — estado de error: daemon no responde, señalar al user reconexión.
- Cada escena debe mostrar el **contenido real** correspondiente (transcript,
  delegación colapsable, logs, etc.), NO una derecha vacía.

### R8 · Composer / input real
- Composer con: textarea, botón adjuntar (clip), accion rápida (bolt), mic primario.
- Los 3 botones con iconos reales (SVG line), no cajas oscuras sin símbolo.

## Qué debe cubrir el kit de UI

> Brief para el kit de diseño, no un estado.
- Que cada requisito R1-R8 tenga su componente(s) y su escena representada en el
  documento OpenPencil, con nombres semánticos, tokens (colores/tipografía) del
  spec 004, y estados/variant el componentes.
- No placeholders: iconos reales, texto real, contenido de escena real.