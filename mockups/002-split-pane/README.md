# Variant: Split Pane (chat + terminal de agente)

## Design stance
Conversación a la izquierda, terminal del agente a la derecha en tiempo real. Comunica que hablas con Hermes *y* ves qué está haciendo el agente — la transparencia de ejecución como valor central. Estética Warp/IDE, acento violeta `#9b6cf5`.

## Key choices
- **Layout:** rail de navegación vertical + panel de sesiones + columna de chat + columna de terminal del agente (split pane real).
- **Typography:** Inter + JetBrains Mono (terminal y metadata muy presentes).
- **Color:** `#0a0b0d` fondo, terminal `#0d0e11` separado, acento `#9b6cf5`.
- **Interaction:** rail con estados activos, pills de agente, terminal con cursor parpadeante y log de ejecución (colas de ComfyUI), delegaciones colapsables, ciclado de fases de voz.

## Trade-offs
- **Strong at:** transparencia total — ves la conversación *y* el trabajo del agente a la vez. Ideal para delegaciones largas (ComfyUI).
- **Weak at:** ocupa mucho ancho; el terminal puede distraer si solo quieres una respuesta corta. Más pesado de leer.

## Best for
- El usuario que quiere **ver la ejecución del agente** mientras conversa — el caso de uso delegación/ComfyUI donde hay que monitorear el progreso. Es la variante "power user / dev".
