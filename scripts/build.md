# Scripts — Cancion

## build-catalog.js

Escanea `songs/` buscando subcarpetas que contengan `data.js` y regenera `songs/catalog.js`.

```bash
node scripts/build-catalog.js
```

Ejecutar cada vez que se agregue, elimine o renombre una carpeta de canción.

---

## Agregar una canción nueva

1. Crear carpeta en `songs/` (nombre sin espacios ni acentos, usar underscore):
   ```
   songs/Nombre_Cancion/
   ```

2. Dentro colocar:
   - `data.js` — exporta default con: `title`, `artist`, `icon`, `file`, `subtitles[]`
   - El archivo de audio/video referenciado en `file`

3. Regenerar catálogo:
   ```bash
   node scripts/build-catalog.js
   ```

---

## Estructura de data.js

```js
export default {
  title: 'Nombre visible',
  artist: 'Artista',
  icon: '🎵',
  file: 'archivo.mp4',
  subtitles: [
    { start: 0.0, end: 3.5, original: "Línea original", translation: "Traducción" },
    // ...
  ]
};
```

---

## Scripts de QA

| Script | Uso |
|--------|-----|
| `qa-subtitle-sync.js` | Verificar sincronización de subtítulos |
| `qa-verify-structure.js` | Validar estructura de carpetas de canciones |
