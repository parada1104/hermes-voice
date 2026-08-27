# Conector de agente — Hermes Voice (diseño técnico)

> Diseño del "Codex lite" centrado en chats: una capa de voz con chat híbrido,
> unida por un *conector de agente* que asocia una **sesión de chat** con una
> **sesión de voz**. Inspirado en cómo Codex Desktop ata su voz a la
> conversación.

## La idea en una frase

**Cada sesión de voz ES un thread de agente; su sesión de voz va "attachada" a
una sesión de chat activa — se conocen por id.**

## Componentes

```
┌──── Capa de voz (nuestra) ────────────────┐
│  [Mic → VAD → STT(oMLX)]                  │   → transcripción
│  [Capa conversacional (Cerebras, cortito)] │   → decide responder o delegar
│  [TTS(oMLX, voz fija robert.wav)]          │   → habla
└───────────────────────────────────────────┘
          │
          ▼
┌──── Conector de agente ───────────────────┐
│  tema: la sesión de voz + la sesión chat  │
│  (persistente, multi-contexto)            │
└───────────────────────────────────────────┘
          │
          ▼
┌──── Agente (Hermes) ──────────────────────┐
│  API server :8642 → /v1/runs  ← corner    │
└───────────────────────────────────────────┘
```

## Cómo el conector ataca la sesión de voz al chat

1. **Sesión de chat activa** (Hermes/Desktop): el conector lee la sesión
   actual (la que está abierta en la UI).
2. **Crea/vincula** un *thread de voz* identificado por el mismo id de sesión
   (`session_id`). La voz y el chat **comparten contexto** (el historial).
3. Cuando hablas:
   - STT transcribe → se encola como mensaje "voz" en el thread de voz.
   - La capa conversacional responde O decide delegar:
     - **Responde** → TTS → habla (y a veces escribe al chat).
     - **Delega** → POST `/v1/runs` al API server de Hermes con el pedido,
       espera el resultado, lo sintetiza y lo dice con la voz (resumen).
4. Si cambias de conversación, el conector cambia de sesión de voz vinculada
   (multi-contexto) → la voz **sabe** que cambiaste de contexto.

## ¿Qué expone Hermes (API server)? — verificado hoy

- `/v1/runs` con `{"input": "..."}` → devuelve `run_id` + `status: started`.
  **Es el endpoint de delegación async** (el conector lo usa para que Hermes
  haga el trabajo pesado).
- `/v1/chat/completions` (sync) → para la capa conversacional directa (si hace
  falta).
- Health `:8642/health` → `{platform: hermes-agent, version: 0.20.5}`.

## Voz real-time (la meta)

- **Por ahora**: cada frase = VAD corta (silencio) → STT → responde → TTS.
  Secuencial por turno, estable.
- **Real-time**: cortar en chunks y transcribir en vivo (streaming) para que
  la respuesta llegue mientras terminas de hablar. Uso futuro; el conector
  está diseñado para no depender del modo.

## Lo que esto resuelve (vs el plugin verde de hoy)

| Problema          | Solución en el proyecto |
|-------------------|-------------------------|
| Spamea el thread  | 1 thread/sesión de voz por chat (attach) |
| Voz inconsistente | Voz fija `robert.wav` (config oMLX) |
| Cuelgues          | Capas probadas por pieza + runs async |
| Sin multi-context | Sesión de voz switch por sesión chat |

## MVP (primer hit)

1. Conector que lee la sesión activa del Desktop → crea el thread de voz.
2. Vocal: VAD → STT → capa conversacional → resumen TTS fijo.
3. Delegación: `/v1/runs` con el contexto (para preguntas sobre pantalla/archivos).
4. Soporte multi-sesión (cambio de contexto) después.

## Estado (2026-08-23, noche)

- **Daemon conector**: `daemon/connector.js` + `daemon/server.js` — CORRIENDO,
  validado de punta a punta (`POST /v1/turn` responde texto + audio_base64).
  Capa de voz (STT oMLX / Cerebras / TTS oMLX) + thread + delegación a Hermes
  vía API server :8642. Port: 8471.
- **App Electron**: `app/main.js` + `app/ui/index.html` (tabs + chat + botón
  voz). Requiere `npm install electron` en `app/` para abrir nativa.
- **UI como Orca**: tabs son PTYs (modelo Orca/Codex); MVP: 1 tab (Hermes voice)
  + chat + voz al daemon.

## Archivo

- Esbozo en `~/proyectos/personal/hermes-voice/IDEA.md`
- Código: raíz del repo (git ya).
- Root: `cliente personal/` en el vault.