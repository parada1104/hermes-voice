# Variant: Command Center (three-pane)

## Design stance
Mucha evidencia en la conversación y en el control — un "centro de comando" de escritorio donde el chat es protagonista pero el contexto de sesiones y agentes vive a la vista. Es la variante más cercana a un IDE/desktop app (Hermes Desktop vibe) con estética dark tipo Linear/Supabase.

## Key choices
- **Layout:** header + tab bar + sidebar (proyectos/agentes) + chat central. Tres zonas nítidas.
- **Typography:** Inter (300–700), mono JetBrains para código y metadata.
- **Color:** fondo `#08090a` casi negro, superficies `#14151a`/`#191b21`, acento indigo-violeta `#6f6cf1`. Los colores cromáticos solo en acentos y estados.
- **Interaction:** selector de agente desplegable, tab bar clicable con cierre por tab, delegaciones colapsables, fases de voz clicables que ciclan escuchando→transcribiendo→hablando con anillo en el mic.

## Trade-offs
- **Strong at:** densidad informativa alta, contexto de sesión visible, sensación de "app de escritorio" real. Muy scan-able.
- **Weak at:** la densidad puede resultar abrumadora si solo quieres charlar; el centro de atención (chat) compite con el sidebar.

## Best for
- El usuario que quiere **todo el contexto a la vista**: varios agentes/sesiones en paralelo, delegaciones en curso, y una conversación como columna vertebral. Es la variante para "trabajo real en curso".
