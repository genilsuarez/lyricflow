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

## Fill-in-the-Blanks — Sistema de dificultad

El algoritmo de blanks es **pedagógico, no mecánico**. No blanquea palabras al azar ni
1 por línea — selecciona las palabras más relevantes de toda la canción con un cap global.

### Principios

1. **Vocab-first**: las palabras del `vocab.js` de la canción tienen prioridad absoluta
   (boost de score 200/150/100 según nivel). Si hay 12 vocab words y el cap es 8,
   se eligen las 8 que aparecen en mejores posiciones.
2. **Cap global por canción**: no importa si tiene 15 o 50 líneas, el total de blanks
   está acotado. Nunca satura.
3. **Ajuste por CEFR**: el `level` de `data.js` modifica el cap. A1 reduce 40%, A2 25%.
   Principiantes ven menos blanks pero todos son vocabulario clave.
4. **maxPerLine**: nunca más de 1-2 blanks en la misma línea. Evita líneas ilegibles.
5. **Spread natural**: el greedy pick distribuye blanks a lo largo de la canción
   (no se acumulan arriba).

### Configuración actual (`DIFFICULTY` en player.js)

| Nivel | totalCap | vocabBoost | minWordLen | maxPerLine |
|-------|----------|------------|------------|------------|
| easy | 8 | 200 | 3 | 1 |
| normal | 16 | 150 | 2 | 1 |
| hard | 30 | 100 | 1 | 2 |

### LEVEL_FACTOR (multiplicador CEFR)

| Level | Factor | Resultado easy/normal/hard |
|-------|--------|---------------------------|
| A1 | 0.6 | 5 / 10 / 18 |
| A2 | 0.75 | 6 / 12 / 22 |
| B1+ | 1.0 | 8 / 16 / 30 |
| C1 | 1.1 | 9 / 18 / 33 |

### Reglas (no negociables)

- **Nunca volver a "1 blank por línea en toda la canción"** — eso es testing, no learning.
- **Vocab words siempre priorizadas** — si no hay vocab.js, funciona con content words
  pero el resultado pedagógico es inferior.
- **El cap es ceiling, no floor** — si la canción tiene pocas palabras elegibles, habrá
  menos blanks que el cap. Nunca se fuerzan blanks en palabras cortas/stop-words.
- **Listening mode usa la misma lógica** — `buildListeningBlanks()` comparte DIFFICULTY
  y LEVEL_FACTOR.

## Button system — NO migrar a .lp-btn

Los botones de LyricFlow usan clases propias (`play-btn`, `back-btn`, `volume-btn`,
`speed-btn`, `loop-btn`, `toggle-*-btn`, `blanks-check-btn`, `blanks-reveal-btn`).
**No son candidatos a migración** al sistema `.lp-btn` / `.lp-icon-btn` canónico.

Razones:
- **Tamaños custom**: toggles de estudio a 34px, loop/speed a 36px, play a 42px, back a 32px.
  La spec canónica exige 44px mínimo o hit-area extendida vía `::after`, pero estos
  toggles ya usan `::after` para sus tooltips — hay conflicto directo.
- **Estilos custom**: play-btn tiene gradient, blanks-*-btn tienen border-radius 18px y
  padding no estándar, volume-btn es transparente sin dimensiones fijas.
- **Layout denso**: el player acomoda 5-6 toggles + controles de audio en espacio reducido.
  Subir a 44px rompe la composición.

Están visualmente alineados con la identidad (usan tokens `--lp-*`, transitions, hover
states), pero mantienen naming y sizing propios. Esta decisión es intencional y permanente
salvo rediseño completo de la zona del player.

## Notas

- `.player-wrapper` tiene `overflow: hidden` — tooltips/popovers con `position: absolute` se clippean si salen del contenedor. Usar `position: fixed` para elementos que necesitan salir del wrapper.
