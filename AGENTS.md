# LyricFlow — Agent Guide

## Qué es

Player de canciones con subtítulos sincronizados, vocabulario interactivo, y modos de estudio (fill-in-the-blanks, listening challenge). Enfocado en aprendizaje de idiomas a través de música.

## Stack

- HTML5 + CSS3 + Vanilla JS (ES modules)
- Sin build step — se sirve directo (necesita HTTP server por ES modules, no funciona desde `file://`)
- Google Fonts: Fraunces (lyrics/display) + Manrope (UI)
- Audio nativo del browser

## Estructura

```
index.html          — Entry point
player.js           — Toda la lógica del player (single file)
styles.css          — Todos los estilos (single file)
songs/              — Carpeta de canciones
  catalog.js        — Lista de folders disponibles
  <Nombre>/
    data.js         — Metadata + subtítulos sincronizados
    vocab.js        — Vocabulario de la canción
    *.mp4           — Archivo de audio/video
scripts/            — Scripts de build y QA
```

## Para servir en desarrollo

```bash
npx serve . -p 3000
# o
python3 -m http.server 3000
```

## QA Scripts

Los scripts de QA usan Playwright (instalado globalmente). Se escriben y mantienen en `scripts/qa-*.js` dentro del proyecto (NO en `/tmp/`). Ejecutar desde la raíz del proyecto:

```bash
./scripts/qa <nombre>
```

Ejemplo: `./scripts/qa tooltips`, `./scripts/qa subtitle-sync`

Al crear nuevos scripts de QA, guardarlos en `scripts/qa-<nombre>.js`.

## Convenciones de diseño

- Dark cinematic theme (indigo-black, violet accent, blue warm)
- CSS custom properties en `:root`
- Tipografía: Fraunces para contenido lírico, Manrope para UI
- Border-radius generoso (8-30px)
- Glassmorphism sutil (backdrop-filter, borders translúcidos)
- Animaciones con `cubic-bezier` custom (`--ease-out`, `--ease-spring`)
- Mobile-first responsive (breakpoint 580px)

## Bugs conocidos

- (ninguno documentado)

## Notas

- `.player-wrapper` tiene `overflow: hidden` — tooltips/popovers con `position: absolute` se clippean si salen del contenedor. Usar `position: fixed` para elementos que necesitan salir del wrapper.
