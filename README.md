# Moodle Fragen-Designer

Ein kleines Web-Tool, mit dem du Moodle-Fragen und Tests in einem einfachen Editor gestaltest und als
**Moodle-XML** (oder **GIFT**) exportierst. Läuft komplett im Browser – ohne Server, ohne Konto.
Alles wird automatisch im Browser-Speicher abgelegt und ist beim nächsten Öffnen wieder da.

## Funktionen

- Fragetypen: Multiple Choice, Wahr/Falsch, Kurzantwort, Numerisch, Zuordnung, Freitext, Lückentext (Cloze), Beschreibung
- Autospeichern im Browser (`localStorage`), mehrere Kataloge (z. B. je Kurs)
- Export als Moodle-XML, GIFT oder als Sicherungsdatei (JSON) – wahlweise alle oder nur ausgewählte Fragen
- Import bestehender Moodle-XML-Dateien und eigener Sicherungen
- Live-Prüfung, ob eine Frage vollständig ist, und Vorschau, wie sie ungefähr in Moodle aussieht
- Fragen per Drag & Drop sortieren, duplizieren, durchsuchen, Löschen mit „Rückgängig“
- **Tests** als gespeicherte Fragen-Sets: Fragen auswählen und ordnen, als Moodle-XML in eine eigene
  Unterkategorie exportieren oder als **Papierversion drucken** (optional mit Lösungsblatt)

## Nutzung

1. **Fragen anlegen** – „Neue Frage“, Typ wählen, ausfüllen.
2. **Exportieren** – „Exportieren“ → Moodle-XML herunterladen.
3. **In Moodle importieren** – im Kurs *Mehr → Fragensammlung → Import*, Format *Moodle-XML-Format*, Datei hochladen.
4. **Test erstellen** – Aktivität *Test* anlegen, *Fragen → Hinzufügen → aus der Fragensammlung*.

Ein Moodle-Test selbst (Zeitlimit, Bewertung usw.) lässt sich nicht über eine Fragen-Datei importieren;
er wird in Moodle aus den importierten Fragen zusammengestellt. Im Reiter **Tests** stellst du dafür
gespeicherte Fragen-Sets zusammen: Der Export legt die Fragen in einer eigenen Unterkategorie ab, und
über „Drucken“ gibt es eine Papierversion mit Lösungsblatt.

## Bereitstellung über GitHub Pages

Die Seite wird über den Workflow `.github/workflows/deploy.yml` bei jedem Push auf `main`
automatisch veröffentlicht (auf anderen Branches laufen nur die Tests).
Einmalig in den Repository-Einstellungen aktivieren:

**Settings → Pages → Build and deployment → Source: „GitHub Actions“**

Danach ist die App unter `https://<benutzer>.github.io/<repository>/` erreichbar.
Der Workflow kann auch manuell über *Actions → Deploy to GitHub Pages → Run workflow* gestartet werden.

## Lokal ausführen

Es gibt keinen Build-Schritt. Weil die App ES-Module nutzt, braucht sie einen kleinen Webserver:

```bash
npx serve .
# oder
python3 -m http.server 8000
```

Tests (Node 18+):

```bash
npm test
```

## Aufbau

```
index.html              Oberfläche
assets/app.js           UI-Logik (Liste, Editor, Modale, Vorschau)
assets/types.js         Fragetypen, Standardwerte, Validierung
assets/store.js         Speichern/Laden im Browser, Sicherungen
assets/export-xml.js    Export Moodle-XML
assets/export-gift.js   Export GIFT
assets/import-xml.js    Import Moodle-XML
assets/util.js          Hilfsfunktionen
tests/                  Node-Tests für Export
```

## Hinweis zum Speicher

Der Browser-Speicher ist an Gerät und Browser gebunden und kann beim Löschen der Website-Daten verloren gehen.
Regelmäßig eine Sicherung herunterladen (Exportieren → Sicherung) – sie lässt sich über „Importieren“
jederzeit und auf jedem Gerät wieder einspielen.
