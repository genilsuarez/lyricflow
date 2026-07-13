import re
import os

base = '/Users/gsuarez/Documents/Code/Learn/LyricFlow'

songs = {
    "Wonderwall": {
        "artist": "Banda británica de rock alternativo, formada en Manchester (1991) por los hermanos Gallagher. Íconos del Britpop.",
        "song": "Del álbum \"(What's the Story) Morning Glory?\" (1995). Noel la escribió sobre \"un amigo imaginario que te salva\".",
        "language": "Metáforas accesibles (road, light, wall), condicionales y futuro con going to. Repetitiva y clara — ideal A2.",
        "funFacts": [
            "La canción más tocada en guitarra acústica en pubs del mundo anglosajón.",
            "Noel la compuso en una sola noche durante una gira.",
            "El término viene de un álbum de George Harrison (1968).",
            "Más de 1.6 mil millones de reproducciones en Spotify."
        ]
    },
    "Stand_By_Me": {
        "artist": "Cantante estadounidense de soul y R&B (1938–2015). Vocalista de The Drifters antes de triunfar como solista.",
        "song": "Inspirada en un espiritual gospel (1961). Una de las más reproducidas del siglo XX, con 400+ versiones.",
        "language": "Vocabulario emocional básico, condicionales simples (if/when) y verbos cotidianos. Nivel A2.",
        "funFacts": [
            "Compuesta en solo 15 minutos en el estudio.",
            "Volvió al Top 10 en 1986 por la película homónima.",
            "Su línea de bajo es de las más reconocidas del pop.",
            "Usada en más de 100 películas y series."
        ]
    },
    "Let_It_Be": {
        "artist": "Banda británica formada en Liverpool (1960). La más influyente de la música popular.",
        "song": "McCartney la escribió tras soñar con su madre Mary (1970). Una de las últimas antes de la separación.",
        "language": "Condicionales simples, vocabulario de consuelo y mezcla de presente con futuro (will). Nivel A2-B1.",
        "funFacts": [
            "McCartney soñó que su madre le decía \"Let it be\" en plena crisis de la banda.",
            "Última canción de The Beatles en llegar al #1 en EE.UU.",
            "Billy Preston tocó el órgano en la grabación.",
            "Existen dos versiones muy distintas: single y álbum."
        ]
    },
    "Imagine": {
        "artist": "Cofundador de The Beatles (1940–1980). Su obra solista exploró paz, amor y crítica social.",
        "song": "Himno utópico (1971) escrito en su piano blanco. Invita a imaginar un mundo sin divisiones.",
        "language": "Vocabulario básico (imagine, heaven, people) con condicionales y subjuntivos. Nivel intermedio.",
        "funFacts": [
            "Lennon la escribió en una sola sesión matutina.",
            "Inspirada en \"Grapefruit\" (1964) de Yoko Ono.",
            "El piano Steinway se vendió por £1.67 millones en 2000.",
            "Es la canción solista más vendida de un ex-Beatle."
        ]
    },
    "Bohemian_Rhapsody": {
        "artist": "Banda británica de rock (1970). Con Freddie Mercury, fusionaron rock, ópera y pop progresivo.",
        "song": "Composición de 6 min (1975) con 6 secciones: a capella, balada, guitarra, ópera, hard rock y outro.",
        "language": "Vocabulario dramático con referencias operísticas (Scaramouche, Bismillah). Nivel B2.",
        "funFacts": [
            "Mercury la compuso durante años; la grabación tomó 3 semanas.",
            "Las harmonías se sobregrabaron más de 180 veces.",
            "Su video es considerado uno de los primeros videoclips modernos.",
            "Volvió al #1 en 1991 y otra vez en 2018 con el biopic."
        ]
    },
    "Losing_My_Religion": {
        "artist": "Banda estadounidense de alt-rock (Athens, Georgia, 1980). Pioneros del indie de los 90.",
        "song": "Mayor éxito de R.E.M. (1991). El título es expresión sureña: \"perder la paciencia\". Habla de obsesión no correspondida.",
        "language": "Vocabulario idiomático avanzado, metáforas sostenidas y registro poético. Nivel B2.",
        "funFacts": [
            "El riff es de mandolina, no de guitarra.",
            "Stipe dijo que trata sobre obsesión, no religión.",
            "El video se inspiró en la iconografía de Caravaggio.",
            "Nominada a 6 Grammy, ganó 2 MTV VMAs."
        ]
    },
    "Hotel_California": {
        "artist": "Banda estadounidense de rock (L.A., 1971). Su Greatest Hits es de los álbumes más vendidos de la historia.",
        "song": "Alegoría del exceso y el lado oscuro del sueño americano (1977). El solo final de 2 min es legendario.",
        "language": "Vocabulario literario con imágenes sensoriales (shimmering, colitas). Narrativa en pasado. Nivel B1-B2.",
        "funFacts": [
            "Felder compuso la música y la llamaba \"Mexican Reggae\".",
            "Tardó meses — Henley y Frey reescribieron la letra varias veces.",
            "El solo final fue grabado nota por nota, no improvisado.",
            "\"You can never leave\" es una de las frases más citadas del rock."
        ]
    },
    "Derniere_Danse": {
        "artist": "Cantante francesa (Adila Sedraïa) de raíces multiculturales. Fusiona pop, chanson française y world music.",
        "song": "Single debut (2013), éxito masivo en Europa. Habla de soledad y resiliencia en las calles de París.",
        "language": "Francés poético pero accesible. Vocabulario emocional y verbos reflexivos comunes.",
        "funFacts": [
            "El videoclip supera los 1.000 millones de views en YouTube.",
            "Indila es muy reservada: rara vez da entrevistas.",
            "Usada frecuentemente en clases de francés por su dicción clara.",
            "Su estilo vocal recuerda a Edith Piaf."
        ]
    },
    "Hello_Goodbye": {
        "artist": "Banda británica (Liverpool, 1960). La más influyente de la música popular, 600M+ discos vendidos.",
        "song": "Single de Magical Mystery Tour (1967). Un juego de opuestos sobre la comunicación.",
        "language": "Vocabulario extremadamente simple: hello, goodbye, yes, no, stop, go. Repetitivo — ideal A1.",
        "funFacts": [
            "McCartney la improvisó jugando con opuestos junto a Alistair Taylor.",
            "#1 en UK y US Billboard Hot 100.",
            "Lennon la consideraba menor, pero fue un éxito masivo.",
            "El video se filmó en el Saville Theatre de Brian Epstein."
        ]
    }
}

pattern = re.compile(r"culture:\s*\{[\s\S]*?funFacts:\s*\[[\s\S]*?\]\s*\}")

def escape_js(s):
    return s.replace("\\", "\\\\").replace("'", "\\'")

def build_replacement(data):
    facts = ",\n".join(f"      '{escape_js(f)}'" for f in data["funFacts"])
    return (
        f"culture: {{\n"
        f"    artist: '{escape_js(data['artist'])}',\n"
        f"    song: '{escape_js(data['song'])}',\n"
        f"    language: '{escape_js(data['language'])}',\n"
        f"    funFacts: [\n{facts}\n    ]\n"
        f" }}"
    )

updated = 0
for song, data in songs.items():
    path = os.path.join(base, "songs", song, "data.js")
    if not os.path.exists(path):
        print(f"NOT FOUND: {path}")
        continue

    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    replacement = build_replacement(data)
    new_content, count = pattern.subn(replacement, content, count=1)

    if count == 0:
        print(f"NO MATCH: {song}")
        continue

    with open(path, "w", encoding="utf-8") as f:
        f.write(new_content)

    updated += 1
    print(f"OK: {song}")

print(f"\n{updated}/9 files updated.")
