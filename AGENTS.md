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

## Detección de navegador embebido (Cursor IDE, preview de dispositivo)

`lp-cursor-detect.js` detecta si la app corre dentro del preview de dispositivo móvil de Cursor IDE (via `navigator.userAgent` matcheando `Cursor/`) y agrega la clase `.browser-cursor-embedded` a `<html>`. Se carga en `<head>` de `index.html`, junto a `lp-theme.js`.

**Por qué existe**: el preview móvil de Cursor dibuja su propio marco/bisel de dispositivo alrededor de la página. Se verificó EN VIVO dentro de Cursor (2026-07-23) que ese bisel corta la fila de controles del reproductor (play/volumen/velocidad/loop) dentro de `.bottom-bar` — el usuario confirmó que los controles no se veían completos.

**El valor (52px)**: vive en un solo lugar — `html.browser-cursor-embedded { --cursor-preview-chrome-bottom: 52px; }` cerca de la definición base de `.bottom-bar` en `styles.css`. El uso real (`padding-bottom: var(--cursor-preview-chrome-bottom);`) está dentro de `@media (max-width: 580px)` — el mismo breakpoint mobile-first del resto del proyecto — porque el bisel de Cursor es una feature del preview móvil; una pestaña de Cursor a ancho de escritorio no lo tiene, así que el padding no debe aplicar ahí. Verificado con DOM real: sin el fix, `.controls-row` terminaba a 801px de un viewport de 812px (11px de margen); con el fix, sube a 749px (~63px de margen). A los 900px de ancho, con la clase igual presente, el padding-bottom computado es `0px` — confirma que el scoping funciona.

**Precedente y por qué NO se asumió el valor a ciegas**: esta misma detección existe en FluentFlow (`src/utils/cursorBrowserDetection.ts`), donde el mismo tipo de hardcode (también 52px, para otro elemento) resultó estar basado en una suposición nunca verificada — no había overlay real ahí, y el hardcode solo dejaba un hueco vacío. Ese error se corrigió ahí bajando el valor a 0 tras probar en vivo. Este caso de LyricFlow es distinto: el corte SÍ se confirmó en vivo en Cursor por el usuario antes de implementar el fix, no se asumió por un comentario heredado. Regla para el futuro: cualquier hardcode ligado a un navegador/host embebido específico debe verificarse en vivo en ese entorno antes de confiarlo — ni asumir que hace falta, ni asumir que no hace falta.

**No extendido a Claude Code**: el Browser pane de Claude Code (`mcp__Claude_Browser__*`) no tiene este problema (ver documentación equivalente en FluentFlow) — no agregar `Claude/` a la detección sin un overlay real confirmado ahí primero.

**Otros elementos `position:fixed` anclados al borde inferior que NO se tocaron** (sin problema reportado, no asumir que lo necesitan): `.unified-nav` (sidebar, `inset: 0 auto 0 0` — su borde inferior también podría verse afectado por el mismo bisel, pero no fue verificado en vivo). Si aparece un reporte similar ahí, aplicar el mismo patrón (`html.browser-cursor-embedded .unified-nav { padding-bottom: var(--cursor-preview-chrome-bottom); }` dentro del breakpoint mobile) solo después de confirmarlo en vivo en Cursor.

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

## Recortar canción (trim MP3 + ajustar subtítulos)

Procedimiento para eliminar un segmento de audio (ej: solo instrumental) y mantener
los subtítulos sincronizados. Se conserva siempre la versión original como respaldo.

### Pasos

1. **Respaldar originales**:
   ```bash
   cd songs/<Carpeta>/
   cp <archivo>.mp3 <archivo>.original.mp3
   cp data.js data.original.js
   ```

2. **Cortar el MP3** con ffmpeg (concatenar antes y después del corte):
   ```bash
   ffmpeg -y -i <archivo>.original.mp3 \
     -filter_complex "[0:a]atrim=0:<inicio_corte>,asetpts=PTS-STARTPTS[a1];[0:a]atrim=<fin_corte>,asetpts=PTS-STARTPTS[a2];[a1][a2]concat=n=2:v=0:a=1[out]" \
     -map "[out]" -b:a 192k <archivo>.mp3
   ```
   - `<inicio_corte>`: segundo donde empieza el segmento a eliminar
   - `<fin_corte>`: segundo donde termina el segmento a eliminar

3. **Identificar índice de corte** en subtítulos:
   ```bash
   node scripts/shift-subtitles.js <Carpeta> --list
   ```
   Buscar el primer subtítulo cuyo `start` sea >= `<fin_corte>`. Ese es el `<desde-índice>`.

4. **Calcular delta**: `-(fin_corte - inicio_corte)`
   Ejemplo: corte de 90s a 133s → delta = -43

5. **Desplazar subtítulos**:
   ```bash
   node scripts/shift-subtitles.js <Carpeta> <desde-índice> <delta>
   ```

### Ejemplo completo (Let It Be, cortar solo de 90s a 133s):

```bash
cd songs/Let_It_Be/
cp let_it_be.mp3 let_it_be.original.mp3
cp data.js data.original.js

ffmpeg -y -i let_it_be.original.mp3 \
  -filter_complex "[0:a]atrim=0:90,asetpts=PTS-STARTPTS[a1];[0:a]atrim=133,asetpts=PTS-STARTPTS[a2];[a1][a2]concat=n=2:v=0:a=1[out]" \
  -map "[out]" -b:a 192k let_it_be.mp3

# Ver índices:
node scripts/shift-subtitles.js Let_It_Be --list
# Índice 28 es el primero con start >= 133

node scripts/shift-subtitles.js Let_It_Be 28 -43
```

### Notas

- El archivo `data.js` no debe tener líneas dentro del rango cortado (si las tiene,
  eliminarlas manualmente antes del shift).
- Verificar con `--list` después del shift que los timestamps son coherentes.
- Los archivos `.original.*` no se commitean (están en `.gitignore`).

## Notas

- `.player-wrapper` tiene `overflow: hidden` — tooltips/popovers con `position: absolute` se clippean si salen del contenedor. Usar `position: fixed` para elementos que necesitan salir del wrapper.
