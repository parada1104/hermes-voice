# 004 · focus-voz · Diseño de producción (OpenPencil)

Artefacto de diseño de la variante ganadora **focus-voz 004** de Hermes Voice,
listo para llevar la UI de mockup HTML a un diseño de producción editable (tipo Figma).

> **Estado del MCP:** el bridge `openpencil-mcp` (stdio) está registrado y expone ~106 tools,
> pero la **app de escritorio OpenPencil NO estaba conectada** en el momento de generar esto.
> El propio tool devuelve un error explícito: *"OpenPencil app is not connected… Do NOT attempt
> to start the app yourself"*. Por eso se generó un **artefacto de diseño alternativo** (el caso
> previsto por la tarea), no un documento vivo.

---

## Contenido del artefacto

| Archivo | Qué es | Cómo se usa |
|---|---|---|
| `004-focus-voz-formal.jsx` | Documento de diseño en **JSX declarativo nativo de OpenPencil** (un `<Frame>` por componente). Es el equivalente a un lienzo Figma con capas y autolayout. | Rendear con `mcp__open_pencil__render(jsx=…)` una vez abierta la app, o cargo manual en OpenPencil. |
| `004-focus-voz-spec.json` | **Spec de capas / tokens JSON** — la fuente de verdad estructurada del diseño (colores, tipografía, iconos, estructura, componentes, estados). | Leerlo para conocer la especificación exacta de producción. |
| `004-focus-voz-formal.jsx` (render estático opcional) | Previsualización en PNG/SVG del canvas completo. | Sólo si la app está conectada; vía `export_image`. |

---

## Qué representa cada capa / componente

Estructura raíz (canvas `1440 × 900`, fondo `#0B0C0E`):

- **`app/root`** — contenedor del split-panel.
- **`header`** (y=0, h=58) — barra superior fija. Contiene:
  - `logo` — marca (mark + nombre + sub `codex-lite`).
  - `mode-seg` — control segmentado de modo (`Voz` activo, `Chat`, `Agentes`).
  - `agent-btn` — selector de agente activo (`Orca`, dot verde online).
  - `status-pill` — píldora de estado (`Escuchando`, dot accent pulsando).
- **`vpane`** (x=0, w=384) — panel de voz (izquierda):
  - `vpane/orb` — núcleo de voz con icono de micrófono **line**.
  - `vpane/live` — transcripción en vivo + transcript (user / hermes).
  - `vpane/steps` — stepper de fases: `01 Escuchando` (activo), `02 Transcribiendo`, `03 Hablando`.
- **`cpane`** (x=384, flex 1) — panel de chat (derecha):
  - `cpane/msg-user` — mensaje del usuario (burbuja derecha).
  - `cpane/deleg` — **card de delegación** (header colapsable + body: brief, flujo, mini-terminal).
  - `cpane/msg-orca` — respuesta del agente (burbuja izquierda).
  - `cpane/composer` — composer flotante (textarea + adjuntar + acción rápida + **mic**).

### Paneles adicionales (fuera del lienzo principal, para especificación de producción)

- **`icons/mic-set`** — set de iconos de micrófono (idle / listening / mute), en **line, stroke 1.5**.
- **`voice-states`** — estados del orb (idle / listening / speaking) con halos.

---

## El icono de micrófono (Paso 1)

En el **mockup HTML** el icono del mic quedó como **SVG line minimalista**:
trazo `1.5`, `fill:none`, `stroke:currentColor`, `stroke-linecap/linejoin:round`,
viewBox `0 0 24 24`. Geométrico (cápsula + arco + base), sin emoji, coherente con el resto
del set de iconos `line` del archivo. Se aplicó en **3 lugares**:
logo-mark, voice-orb y botón principal de micrófono.

En el **artefacto OpenPencil** el mismo icono se modeló con primitivas nativas
(`<Ellipse>` cápsula + `<Ellipse>` arco + `<Rectangle>` base), igualmente en stroke 1.5.
Estados del mic (idle / listening / mute) documentados en `mic-states` del spec.

---

## Cómo llevar esto a producción

1. Abrir OpenPencil **con un documento creado** (la app debe estar corriendo y con un doc).
2. Rendar el `004-focus-voz-formal.jsx` dentro del documento:
   - `mcp__open_pencil__render(jsx=<contenido del .jsx>)` → crea los nodos.
   - Para no duplicar: usar `replace_id` (vía `find_nodes`) en re-renders.
3. Ajustar con herramientas vectoriales (set_fill, set_stroke, set_radius, set_layout…).
4. Exportar: `export_image` (sin `path`, devuelve base64 y se escribe bajo el repo)
   o `export_svg`.

> Gotcha conocido: `save_file` / `new_document` con `path` pueden devolver `forbidden path`
> aunque `OPENPENCIL_MCP_ROOT` esté seteado. La vía fiable es `render` + `export_image` sin
> path y escribir el binario uno mismo.

---

## Notas de producción ("más serio" / formal)

- Paleta **oscura neutra** (`#0B0C0E`/`#14161A`) con **un solo acento cálido** (`#D97A3F`/`#F0905C`)
  reservado para acciones y estado de voz. Sin colorido múltiple.
- Tipografía de interfaz **Inter**; monoespaciada **JetBrains Mono** solo para código/metadata.
- **Iconografía 100% line** (stroke 1.5, sin emoji), geométrica, consistente.
- Estados claros y sutiles por componente (idle / hover / focus / active / mute).
- Sombra suave y radios pequeños-moderados (7–16px); nada de glows agresivos.
- Jerarquía por peso tipográfico + tamaño de capa, no por color.
