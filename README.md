
# H5P.ColumnConnector — „Connect with Lines” (Ühenda joontega)

H5P sisutüüp, kus õppija ühendab joontega naabertulpade (või -ridade) lahtreid.
Kuvatakse 2–7 pealkirjastatud tulpa/rida lahtritega; üks lahter võib olla
ühendatud mitme naaberlahtriga. Toetab õigete ühenduste (vastusevõtme)
määramist, vastuse kontrolli ja punktiarvestust.

## Võimalused

- **Paigutus:** lahtrirühmad kas vertikaalsete tulpadena või horisontaalsete
  ridadena (`layoutMode`).
- **Tulbad/read loendina:** 2–7 tulpa/rida, igaüht saab eraldi lisada,
  kustutada ja ümber järjestada.
- **Lahtrid:** tekst ja/või pilt (üleslaadituna või URL-iga), pildi paigutus
  (teksti kohal / tekstist vasakul), suurus (100 % / 50 % / 25 %) ja joondus.
- **Vastusevõti:** iga lahtri jaoks saab valida õiged ühendused eelmise
  tulba/reaga.
- **Kontroll ja tagasiside:** õiged/valed/puuduvad ühendused eristatakse
  värviga (õige roheline, vale punktiirpunane, puuduv kollakas-pruun),
  punktiarvestus on seadistatav.
- **xAPI** tulemuste raporteerimine.

## Sõltuvused

Redaktoris on vaja kaaslasteeki
[H5PEditor.ColumnConnectorAnswerKey](https://github.com/urmasv/H5PEditor.ColumnConnectorAnswerKey)
(vastusevõtme vidin). Vt `library.json` → `editorDependencies`.

- `coreApi`: 1.24
