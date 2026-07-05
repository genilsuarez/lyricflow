---
inclusion: manual
---

# Skill: Download Video (yt-dlp)

Download videos from YouTube u otras plataformas soportadas por yt-dlp.

## Requisitos

- `yt-dlp` instalado globalmente
- `ffmpeg` en `/usr/local/bin/ffmpeg`

## Uso

El usuario proporciona:
1. **URL** del video (obligatorio)
2. **Directorio destino** (opcional — por defecto: directorio actual del workspace)
3. **Formato** (opcional — por defecto: mejor video+audio en mp4)

## Comando base

```bash
yt-dlp --ffmpeg-location /usr/local/bin/ffmpeg \
  -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" \
  --merge-output-format mp4 \
  "<URL>" \
  -o "<DESTINO>/%(title)s.%(ext)s"
```

## Variantes

### Solo audio (mp3)

```bash
yt-dlp --ffmpeg-location /usr/local/bin/ffmpeg \
  -x --audio-format mp3 --audio-quality 0 \
  "<URL>" \
  -o "<DESTINO>/%(title)s.%(ext)s"
```

### Playlist completa

```bash
yt-dlp --ffmpeg-location /usr/local/bin/ffmpeg \
  -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" \
  --merge-output-format mp4 \
  --yes-playlist \
  "<URL>" \
  -o "<DESTINO>/%(playlist_title)s/%(playlist_index)03d - %(title)s.%(ext)s"
```

### Con subtítulos

Agregar flags: `--write-subs --sub-langs es,en --embed-subs`

## Reglas

- Ejecutar directamente sin pedir confirmación.
- Si el directorio destino no existe, crearlo.
- Si hay error de permisos, intentar en `/tmp/` y luego mover con `mv`.
- Timeout del comando: 300 segundos (videos largos pueden tardar).
- Reportar nombre del archivo descargado y tamaño al terminar.
