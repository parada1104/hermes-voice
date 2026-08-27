# Parrotfy — Design System

A brand & UI design system distilled from the official **Parrotfy “Guía de estilo”** (style guide). It packages Parrotfy’s colors, typography, logo assets, foundation tokens, and a set of reusable React UI primitives so designers and agents can produce on-brand interfaces, mocks, and assets.

> **Language note:** Parrotfy’s guide is authored in **Spanish** (“Guía de estilo”, “Colores”, “Tipografía”, “Párrafos”). Sample UI copy in this system is written in Spanish to match.

---

## Sources

- `uploads/Guia de Estilo - Parrotfy.jpg` — the single source of truth for this system: a one-page brand guide covering **Logo**, **Favicon**, **Tipografía**, **Colores**, and **Párrafos**.

No codebase, Figma file, or product screens were provided. Everything here is derived from that guide. Logo/icon assets in `assets/` were **cropped directly from the provided guide image** (not redrawn).

---

## Product context

Parrotfy is presented purely as a **brand** in the source material — the guide does not describe the product’s screens or features, so no product surface is documented here. The mark is a **line-drawn parrot** paired with the **“Parrotfy”** wordmark; the parrot motif and the playful coral→blue palette read as a friendly consumer app (the name evokes “parroting” / repetition, e.g. language or practice). **This is inference, not fact** — see *Caveats* and confirm with the user before building product UI kits.

---

## Content fundamentals

The guide contains little running copy, so tone is inferred from the brand’s voice cues and locale. Guidance:

- **Language:** Spanish (neutral/LatAm). Use natural, warm, encouraging phrasing.
- **Person:** Address the user directly as **tú** (informal “you”), e.g. *“Empieza ahora”*, *“Guarda tu progreso”*. Avoid the formal *usted*.
- **Tone:** Friendly, motivating, light. Short sentences. Verbs first on CTAs (*“Empezar”*, *“Continuar”*, *“Aprende jugando”*).
- **Casing:** Sentence case for headings and body. **Buttons render UPPERCASE** via the type system (letter-spacing 10%) — write button labels in normal case; the component/`.p-button` style uppercases them.
- **Emoji:** Not part of the formal guide. Use *sparingly* for playful accents (streaks, achievements) only if the surface is casual — never in headings or formal UI. Default to none.
- **Numbers:** Ubuntu Mono for counts, timers, and stats.

Examples: *“Aprende jugando cada día.”* · *“Racha de 7 días.”* · *“12 palabras nuevas en esta lección.”*

---

## Visual foundations

- **Colors.** Two brand primaries: **coral `#FF7676`** (warm, primary action) and **royal blue `#2743B1`** (secondary/depth). The signature device is the **diagonal coral→blue gradient** (`--gradient-brand`, ~135°) used on app icons and hero accents. Soft secondary tints (coral/blue/pink/lavender) support backgrounds and chips. Neutrals run from ink `#232323` to a **warm off-white `#FCF8F7`** page background. Status: red `#E11F20`, green `#2DD25A`, amber `#F8C102`.
- **Typography.** A single family — **Ubuntu** — across the whole scale (Bold for H1–H3, Semibold/“Semi bold” = weight 500 for H4–H6 and subtitles, Regular for body). **Ubuntu Mono** for numerics/code. Line-heights are generous (130–155%); smaller styles add positive letter-spacing (kerning 2–10%). Full scale in `tokens/typography.css` and the *Type* cards.
- **Spacing & layout.** 4px base scale. Generous whitespace, calm density.
- **Corner radii.** Friendly and rounded: cards `~20px`, controls `~12px`, and **fully pill-shaped buttons** (`--radius-pill`). App icon uses a large squircle-ish radius (~22px).
- **Borders.** Thin hairlines (`#DFDFDF`); the parrot mark itself is a clean ~1.5px line drawing.
- **Shadows.** Soft, low-opacity neutral drops (`--shadow-xs…lg`) plus optional **colored glows** (`--shadow-coral`, `--shadow-blue`) for emphasis. No harsh or dark shadows.
- **Backgrounds.** Flat warm off-white or white surfaces; the gradient is the one expressive background, used deliberately (icon, hero, switch track) — not everywhere. No textures, no photography defined in the guide.
- **Motion.** Not specified by the guide. This system defaults to quick, gentle transitions (120–360ms) with an ease-out curve; press states shrink slightly (`scale .97`).
- **Hover / press.** Hover = subtle brightness drop (`brightness .94`) or a pale-lavender wash on ghost controls; press = brief `scale(.97)`. Focus = blue ring (`0 0 0 3px` blue @14%).
- **Transparency & blur.** Used lightly: dialog scrim is ink @45% with a small backdrop blur. Otherwise surfaces are opaque.
- **Imagery vibe.** None defined. If adding imagery, keep it warm and bright to sit with coral/off-white.
- **Cards.** White surface, 1px hairline border, `~20px` radius, soft `--shadow-sm`. Optional flat variant (border only).

---

## Iconography

The source guide **does not define an icon set** — only the parrot logo/mark line-art.

- **Brand mark:** the parrot is a clean, single-weight (~1.5px) line drawing. Available as PNG in `assets/` (`mark-black.png`, `mark-coral.png`).
- **UI icons (substitution — FLAGGED):** because no icon library ships with the brand, this system recommends **[Lucide](https://lucide.dev)** via CDN for UI glyphs — its thin, rounded single-weight stroke matches the parrot mark’s line style. This is a **substitution**; if Parrotfy has an official icon set, please provide it and it will replace Lucide. Load: `<script src="https://unpkg.com/lucide@latest"></script>`.
- **Emoji / unicode:** not used as a system icon language. A few unicode glyphs appear only inside specimen cards for convenience.

---

## Fonts

- **Ubuntu** and **Ubuntu Mono** are the real, specified typefaces (no substitution of the family). They are loaded from the **Google Fonts CDN** via `tokens/fonts.css` — the binaries are **not self-hosted** in this project. If you need offline/self-hosted webfonts, provide the `.woff2` files and they’ll be added with local `@font-face` rules. (Because fonts load via a remote `@import`, the compiler reports “0 fonts” — that’s expected here.)

---

## Components

Reusable React primitives (namespace `window.DesignSystem_ed2cc2`). No component inventory was provided by the source, so a **standard set** was authored, sized to the brand. Grouped by concern:

**Forms** (`components/forms/`)
- **Button** — pill CTA; variants primary/secondary/gradient/outline/ghost, sizes sm/md/lg.
- **IconButton** — circular icon-only button.
- **Input** — labelled text field with blue focus ring, hint & error.
- **Select** — styled native dropdown.
- **Checkbox** — coral fill + tick.
- **Radio** — coral dot, grouped by name.
- **Switch** — pill toggle, gradient track when on.

**Display** (`components/display/`)
- **Card** — white rounded surface with soft shadow.
- **Badge** — small uppercase status pill.
- **Tag** — chip / filter token, optionally removable.

**Navigation** (`components/navigation/`)
- **Tabs** — underline tab bar with coral indicator.

**Feedback** (`components/feedback/`)
- **Dialog** — centered modal with blurred scrim.
- **Toast** — notification with colored left accent.
- **Tooltip** — dark hover/focus bubble.

Each component directory has `<Name>.jsx`, `<Name>.d.ts`, `<Name>.prompt.md`, and one `@dsCard` HTML specimen.

### Intentional additions
- **Lucide icons** (CDN) — recommended UI glyph set, since the brand defines none. Substitution; replace if an official set exists.

---

## Repository index

- `styles.css` — global entry point (import this one file). `@import`s all tokens + fonts.
- `tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css` (custom properties).
- `components/{forms,display,navigation,feedback}/` — React primitives + specimen cards.
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Brand) for the Design System tab.
- `assets/` — logo lockups, parrot mark, and app icon, **cropped from the provided guide**:
  - `logo-coral.png`, `logo-blue.png`, `logo-black.png`, `logo-white-on-black.png`, `logo-white-on-coral.png`
  - `mark-black.png`, `mark-coral.png`, `appicon-gradient.png`
- `SKILL.md` — Agent-Skill wrapper so this system can be used in Claude Code.
- `readme.md` — this file.

---

## Caveats

1. **Single-source system.** Everything derives from one JPG style guide — no codebase, Figma, or product screens. Component inventory is a sensible standard set, **not** a mirror of a real Parrotfy component library.
2. **No product UI kits** were built, because no product screens were provided. Product context (what Parrotfy *is*) is inferred.
3. **Fonts load from Google Fonts CDN**, not self-hosted.
4. **Icon set is a substitution** (Lucide) — the brand defines none.
5. **Logo assets are raster crops** from the guide image; no vector (SVG) logo was provided.
