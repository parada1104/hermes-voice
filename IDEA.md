# Hermes Voice — Chat + Voice híbrido (proyecto propio)

> **Norte**: un "Codex lite" centrado en chats, con una interfaz de voz híbrida
> (chat + voz) y un *conector de agente* que une una sesión de chat con una
> sesión de voz attachada. Idea inspirada en Orca, pero inyectando nuestro
> propio flujo de voz sobre Hermes (o cualquier agente/harness).

## Por qué

El modo voice nativo de Hermes y el plugin que probamos hoy son frágiles:
spamean el thread, la voz cambia, se cuelgan. En vez de parchear cosas, lo
convertimos en un **proyecto propio** con una arquitectura clara y extensible.

## Arquitectura — el conector de agente

El punto: **una sesión de chat ↔ una sesión de voz, conectadas por un
conector de agente**. Cuando iniciamos una sesión de voz (chat), arrancamos
un thread de agente con una sesión de voz (real-time si la pedimos) **attachada**
a la sesión de chat. Se conocen entre sí.

```
[ Sesión de Chat ]                    [ Sesión de Voz ]
      │                                      │
      │         Conector de agente           │
      │    (arma el thread, conecta capas)   │
      └──────────────────────────────────────┘
            │
            ▼
   [ Agente (Hermes) ]  ← capa conversacional ligera
```

- **Chat**: la conversación vive en el thread del agente (persistente).
- **Voz**: captura (mic) → STT → capa conversacional → TTS → reproduce.
- **Conector de agente**: une el thread del chat con el flujo de voz, avisa a
  la sesión de voz de la sesión de chat activa (multi-contexto).

## Decisiones (lo que me dices hoy)

1. **Proyecto propio bajo `~/proyectos/personal/hermes-voice/`** — con git, ya.
2. **No más parches sobre el modo voice nativo ni plugins verdes** — ahora es
   un proyecto con plano.
3. **Empieza con Hermes** (como agente) pero el conector es genérico: luego
   puede apuntar a Claude Code, OpenCode, Pi (harness distintos).
4. **Real-time es la meta** (voz continua mientras hablas); MVP primero
   encadenamos las capas estables.

## Lo que arregla (vs el plugin de hoy)

| Problema                 | Antes                | Ahora (proyecto)         |
|--------------------------|----------------------|--------------------------|
| Spam del thread          | VAD disparaba turnos | Un thread/sesión por chat |
| Voz inconsistente        | TTS variaba          | Voz fija por sesión (`robert.wav`) |
| Cuelgues                 | Capas frágiles       | Test por pieza (STT/TTS/LLM) |
| Sin multi-contexto       | Un thread global     | Sesión de voz ↔ sesión de chat activo |