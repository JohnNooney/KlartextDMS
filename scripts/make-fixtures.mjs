/**
 * Regenerates the fixture Documents in scripts/fixtures/ (issue #52): realistic
 * multi-page PDFs whose text actually contains the clauses the fixture
 * Extractions quote on the referenced pages — the Mietvertrag's Kündigung on
 * page 3, Kaution/Miete/Nebenkosten on page 2, Kleinreparaturen on page 4.
 *
 * Deterministic and dependency-free: emits raw PDF 1.4 with the built-in
 * Helvetica faces under WinAnsiEncoding (covers umlauts, », „…“, €). Re-run
 * `node scripts/make-fixtures.mjs` after editing the document text, then
 * `pnpm seed` so emulator-data/ picks up the new bytes.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 68;
const TOP_Y = 712;
const BOTTOM_Y = 70;

// Bytes for characters outside Latin-1 under WinAnsiEncoding; the encoded
// strings are written out with Node's 'latin1' encoding (byte == char code).
const CP1252 = {
  '€': '\x80', '„': '\x84', '…': '\x85', '‘': '\x91', '’': '\x92',
  '“': '\x93', '”': '\x94', '•': '\x95', '–': '\x96', '—': '\x97',
};

const enc = (s) => s.replace(/[€„…‘’“”•–—]/g, (ch) => CP1252[ch]);
const esc = (s) => s.replace(/[\\()]/g, '\\$&');

/** Rough Helvetica width guess (≈0.5 em/char) for wrapping and centering. */
const estWidth = (text, size) => text.length * size * 0.5;

function wrap(text, size, maxWidth = PAGE_W - MARGIN_X * 2) {
  const maxChars = Math.floor(maxWidth / (size * 0.5));
  const lines = [];
  let cur = '';
  for (const word of text.split(' ')) {
    if (cur && cur.length + 1 + word.length > maxChars) {
      lines.push(cur);
      cur = word;
    } else {
      cur = cur ? `${cur} ${word}` : word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Block kinds: title (16 bold, centered), sub (10 italic, centered),
 * h (11 bold § heading), p (10 wrapped body), small (9 italic, grey),
 * right (10 right-aligned), hr (hairline rule), sig (signature row), gap.
 */
function render(blocks, pageNo, pageCount) {
  const ops = [];
  let y = TOP_Y;
  const line = (font, size, x, text, grey) => {
    ops.push(`BT ${grey ? '0.45 g ' : ''}/F${font} ${size} Tf ${x} ${y.toFixed(1)} Td (${esc(enc(text))}) Tj ET`);
  };
  const centerX = (text, size) => (PAGE_W - estWidth(text, size)) / 2;
  const para = (text, size, leading = 13.5, gapAfter = 7) => {
    for (const l of wrap(text, size)) {
      line(1, size, MARGIN_X, l);
      y -= leading;
    }
    y -= gapAfter;
  };
  for (const b of blocks) {
    switch (b.k) {
      case 'title':
        line(2, 16, centerX(b.t, 16), b.t);
        y -= 20;
        break;
      case 'sub':
        line(3, 10, centerX(b.t, 10), b.t, true);
        y -= 26;
        break;
      case 'h':
        y -= 8;
        line(2, 11, MARGIN_X, b.t);
        y -= 17;
        break;
      case 'p':
        para(b.t, 10);
        break;
      case 'small':
        for (const l of wrap(b.t, 9)) {
          line(3, 9, MARGIN_X, l, true);
          y -= 12;
        }
        y -= 4;
        break;
      case 'right':
        line(1, 10, PAGE_W - MARGIN_X - estWidth(b.t, 10), b.t);
        y -= 15;
        break;
      case 'hr':
        ops.push(`0.75 g 0.6 w ${MARGIN_X} ${y.toFixed(1)} m ${PAGE_W - MARGIN_X} ${y.toFixed(1)} l S`);
        y -= 14;
        break;
      case 'sig':
        y -= 24;
        line(1, 10, MARGIN_X, '________________________');
        line(1, 10, PAGE_W / 2 + 20, '________________________');
        y -= 14;
        line(1, 10, MARGIN_X, b.left);
        line(1, 10, PAGE_W / 2 + 20, b.right);
        y -= 16;
        break;
      case 'gap':
        y -= b.h;
        break;
      default:
        throw new Error(`unknown block ${b.k}`);
    }
    if (y < BOTTOM_Y) throw new Error(`page ${pageNo} overflows — split it`);
  }
  // "Seite X von N" footer.
  const footer = `Seite ${pageNo} von ${pageCount}`;
  ops.push(
    `BT 0.45 g /F1 8 Tf ${((PAGE_W - estWidth(footer, 8)) / 2).toFixed(1)} 40 Td (${esc(footer)}) Tj ET`,
  );
  return `${ops.join('\n')}\n`;
}

function buildPdf(pageBodies) {
  const fontIds = [3, 4, 5];
  const pageIds = pageBodies.map((_, i) => 6 + i * 2);
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const faces = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique'];
  fontIds.forEach((id, i) => {
    objects[id] = `<< /Type /Font /Subtype /Type1 /BaseFont /${faces[i]} /Encoding /WinAnsiEncoding >>`;
  });
  pageBodies.forEach((body, i) => {
    const resources = `<< /Font << ${fontIds.map((id, f) => `/F${f + 1} ${id} 0 R`).join(' ')} >> >>`;
    objects[pageIds[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${resources} /Contents ${pageIds[i] + 1} 0 R >>`;
    objects[pageIds[i] + 1] = `<< /Length ${body.length} >>\nstream\n${body}endstream`;
  });
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// -- Documents --------------------------------------------------------------
// The clause text the Extractions quote must stay on the page the fixture
// cites (mietvertrag: pp. 2–4; versicherungsschein: pp. 1–2; finanzamt: p. 1).

const MIETVERTRAG = [
  [
    { k: 'title', t: 'MIETVERTRAG' },
    { k: 'sub', t: 'Wohnraummietvertrag nach §§ 535 ff. BGB' },
    { k: 'gap', h: 8 },
    { k: 'p', t: 'zwischen' },
    { k: 'p', t: 'Frau Ingrid Berger, Tucholskystraße 14, 10557 Berlin — nachfolgend »Vermieterin« genannt —' },
    { k: 'p', t: 'und' },
    { k: 'p', t: 'Herrn Daniel Okafor, geboren am 12. Mai 1990, wohnhaft Boxhagener Straße 21, 10245 Berlin — nachfolgend »Mieter« genannt —' },
    { k: 'p', t: 'wird folgender Mietvertrag geschlossen:' },
    { k: 'h', t: '§ 1 Mietgegenstand' },
    { k: 'p', t: 'Die Vermieterin vermietet dem Mieter die Wohnung in der Sonnenallee 88, 12045 Berlin-Neukölln, im dritten Obergeschoss links, bestehend aus zwei Zimmern, Küche, Bad mit Wanne, Flur und einem Balkon zur Hofseite. Die Wohnfläche beträgt ca. 58 m².' },
    { k: 'p', t: 'Zum Mietobjekt gehören der Kellerraum Nr. 12 sowie die Mitbenutzung von Fahrradkeller, Waschküche und Hof.' },
    { k: 'h', t: '§ 2 Mietbeginn und Mietdauer' },
    { k: 'p', t: 'Das Mietverhältnis beginnt am 1. April 2024 und wird auf unbestimmte Zeit geschlossen. Eine Befristung oder ein beiderseitiger Kündigungsverzicht wird nicht vereinbart.' },
    { k: 'p', t: 'Die Wohnung wird besenrein und mit sämtlichen Schlüsseln (drei Haustür-, zwei Wohnungs- und ein Kellerschlüssel) übergeben. Über Zustand und Zählerstände wird ein Übergabeprotokoll angefertigt, das Vertragsbestandteil ist.' },
  ],
  [
    { k: 'h', t: '§ 3 Miete und Nebenkosten' },
    { k: 'p', t: 'Die monatliche Grundmiete beträgt 890,00 € (Nettokaltmiete). Hinzu kommen monatliche Vorauszahlungen auf die Betriebskosten in Höhe von 210,00 €. Die Gesamtmiete beläuft sich damit auf 1.100,00 € monatlich.' },
    { k: 'p', t: 'Die Miete ist spätestens am dritten Werktag eines jeden Monats zu zahlen. Sie ist auf das Konto der Vermieterin bei der Spree-Bank Berlin, IBAN DE12 1234 5678 9012 3456 78, im Voraus zu entrichten. Gerät der Mieter mit einem Betrag von zwei Monatsmieten in Verzug, ist die Vermieterin zur fristlosen Kündigung berechtigt.' },
    { k: 'p', t: 'Über die Vorauszahlungen wird jährlich abgerechnet. Nachforderungen sind innerhalb von 30 Tagen nach Zugang der Abrechnung zu begleichen; ein Guthaben wird dem Mieter binnen desselben Zeitraums erstattet.' },
    { k: 'h', t: '§ 4 Kaution' },
    { k: 'p', t: 'Der Mieter leistet eine Kaution in Höhe von 2.670 €, zahlbar in drei Raten. Die erste Rate wird bei Übergabe der Wohnung fällig, die beiden weiteren Raten jeweils mit der ersten und zweiten Monatsmiete.' },
    { k: 'p', t: 'Die Kaution ist auf einem insolvenzsicheren Mietkautionskonto anzulegen. Nach Beendigung des Mietverhältnisses wird sie nach Prüfung aller gegenseitigen Ansprüche abgerechnet, längstens jedoch sechs Monate nach Rückgabe der Wohnung.' },
    { k: 'h', t: '§ 5 Betriebskosten' },
    { k: 'p', t: 'Zu den Betriebskosten zählen insbesondere: Heizung und Warmwasser, Wasser und Abwasser, Müllbeseitigung, Straßenreinigung, Hausreinigung, Gartenpflege, Beleuchtung, Schornsteinfeger, Grundsteuer sowie die Versicherungen des Gebäudes.' },
    { k: 'p', t: 'Eine Mieterhöhung aufgrund umlagefähiger Modernisierungsmaßnahmen nach § 555b BGB bleibt vorbehalten.' },
  ],
  [
    { k: 'h', t: '§ 6 Kündigung' },
    { k: 'p', t: 'Das Mietverhältnis kann von beiden Seiten unter Einhaltung der gesetzlichen Frist ordentlich gekündigt werden. Die Kündigung bedarf der Schriftform. Die Kündigungsfrist beträgt drei Monate.' },
    { k: 'p', t: 'Die ordentliche Kündigung ist spätestens am dritten Werktag eines Kalendermonats zum Ablauf des übernächsten Monats zulässig; maßgeblich ist der Zugang der Kündigungserklärung beim Vertragspartner.' },
    { k: 'p', t: 'Das Recht zur außerordentlichen fristlosen Kündigung aus wichtigem Grund (§§ 543, 569 BGB) sowie das Sonderkündigungsrecht des Mieters bei Mieterhöhungen (§ 561 BGB) bleiben unberührt.' },
    { k: 'h', t: '§ 7 Schönheitsreparaturen' },
    { k: 'p', t: 'Der Mieter übernimmt die Schönheitsreparaturen während des Mietverhältnisses. Dazu gehören das Tapezieren, Anstreichen oder Kalken der Wände und Decken sowie das Streichen der Heizkörper, Innentüren und der Fenster und Außentüren von innen.' },
    { k: 'p', t: 'Die Arbeiten sind fachgerecht auszuführen und grundsätzlich in folgenden Fristen vorzunehmen: in Küchen, Bädern und Duschen alle drei Jahre, in Wohn- und Schlafräumen, Fluren und Toiletten alle fünf Jahre, in Neben- und Kellerräumen alle sieben Jahre.' },
    { k: 'h', t: '§ 8 Tierhaltung' },
    { k: 'p', t: 'Die Haltung von Kleintieren ist gestattet, soweit sie nicht zur Belästigung der Hausbewohner oder zur Beschädigung der Mietsache führt. Die Haltung von Hunden oder Katzen bedarf der vorherigen schriftlichen Zustimmung der Vermieterin.' },
  ],
  [
    { k: 'h', t: '§ 9 Instandhaltung und Kleinreparaturen' },
    { k: 'p', t: 'Die Vermieterin trägt die Kosten der Instandhaltung und Instandsetzung des Mietobjekts. Kleinreparaturen bis zu 100 € im Einzelfall, höchstens 300 € jährlich, trägt der Mieter.' },
    { k: 'p', t: 'Kleinreparaturen umfassen nur die Behebung kleinerer Schäden an den Installationsgegenständen, die dem direkten und häufigen Zugriff des Mieters unterliegen — insbesondere Armaturen für Wasser, Gas und Elektrizität, Heiz- und Kocheinrichtungen, Fenster- und Türverschlüsse sowie Rollläden und Jalousien.' },
    { k: 'h', t: '§ 10 Untervermietung und Gebrauchsüberlassung' },
    { k: 'p', t: 'Die Überlassung der Wohnung oder von Teilen davon an Dritte bedarf der vorherigen schriftlichen Zustimmung der Vermieterin. Der Mieter haftet für das Verhalten von Untermietern, Besuchern und Beauftragten wie für eigenes Verschulden.' },
    { k: 'h', t: '§ 11 Schlussbestimmungen' },
    { k: 'p', t: 'Änderungen und Ergänzungen dieses Vertrages bedürfen der Schriftform. Dies gilt auch für eine etwaige Aufhebung des Schriftformerfordernisses.' },
    { k: 'p', t: 'Sollten einzelne Bestimmungen dieses Vertrages unwirksam oder undurchführbar sein oder werden, so wird hierdurch die Wirksamkeit des Vertrages im Übrigen nicht berührt.' },
    { k: 'gap', h: 22 },
    { k: 'p', t: 'Berlin, den 15. März 2024' },
    { k: 'sig', left: 'Ingrid Berger (Vermieterin)', right: 'Daniel Okafor (Mieter)' },
  ],
];

const VERSICHERUNGSSCHEIN = [
  [
    { k: 'title', t: 'MUSTERKASSE' },
    { k: 'sub', t: 'gesetzliche Krankenversicherung · Bramfelder Straße 140 · 22305 Hamburg' },
    { k: 'hr' },
    { k: 'right', t: 'Mitgliedsnummer MK-2024-88731' },
    { k: 'right', t: 'Hamburg, 10. Oktober 2025' },
    { k: 'gap', h: 10 },
    { k: 'h', t: 'Versicherungsschein und Beitragsinformation' },
    { k: 'p', t: 'Sehr geehrter Herr Okafor,' },
    { k: 'p', t: 'wir bestätigen Ihre Mitgliedschaft in der Musterkasse seit dem 1. April 2024. Mit diesem Schreiben erhalten Sie Ihren Versicherungsschein sowie die gesetzlich vorgeschriebene Information über eine Änderung des Zusatzbeitrags.' },
    { k: 'p', t: 'Der allgemeine Beitragssatz zur gesetzlichen Krankenversicherung bleibt unverändert bei 14,6 Prozent. Der kassenindividuelle Zusatzbeitrag der Musterkasse steigt zum 1. Januar um 0,4 Prozentpunkte auf 2,9 Prozent. Arbeitgeber und Versicherter tragen den Beitrag je zur Hälfte.' },
    { k: 'h', t: 'Ihr Sonderkündigungsrecht bis zum 31. Januar' },
    { k: 'p', t: 'Wegen der Erhöhung des Zusatzbeitrags können Sie Ihre Mitgliedschaft außerordentlich bis zum 31. Januar kündigen. Die Kündigung wirkt zum Ablauf des übernächsten Kalendermonats nach Zugang bei uns. Eine Kündigung ist auch dann möglich, wenn Ihr Arbeitgeber den Beitrag übernimmt.' },
    { k: 'p', t: 'Bitte denken Sie daran, rechtzeitig eine Anschlusversicherung abzuschließen — erst mit der Mitgliedsbescheinigung der neuen Kasse wird die Kündigung wirksam.' },
  ],
  [
    { k: 'h', t: 'Leistungen im Überblick (Auszug)' },
    { k: 'p', t: '• Ärztliche und zahnärztliche Behandlung, Krankenhausbehandlung sowie Arznei-, Verband- und Heilmittel im Rahmen der gesetzlichen Leistungen.' },
    { k: 'p', t: '• Professionelle Zahnreinigung bis zu 80 € jährlich, nach Rechnungsvorlage über das Leistungsportal erstattungsfähig.' },
    { k: 'p', t: '• Vorsorgeuntersuchungen und Hautkrebs-Screening nach den gesetzlichen Vorgaben; Bonusprogramm mit jährlicher Prämie bis 60 €.' },
    { k: 'p', t: '• Zuschuss zu Gesundheitskursen (Bewegung, Ernährung, Stressbewältigung) bis zu 150 € pro Kalenderjahr.' },
    { k: 'h', t: 'Beitragsnachweise und Bescheinigungen' },
    { k: 'p', t: 'Ihren aktuellen Beitragssatz und die Bescheinigung für Ihren Arbeitgeber finden Sie jederzeit im Mitgliederportal unter musterkasse.example. Für steuerliche Zwecke wird die Beitragsbescheinigung jeweils im ersten Quartal des Folgejahres bereitgestellt.' },
    { k: 'h', t: 'Hinweise' },
    { k: 'p', t: 'Dieses Schreiben gibt einen vereinfachten Überblick; maßgeblich sind die Satzung der Musterkasse und die Vorschriften des Fünften Sozialgesetzbuchs (SGB V).' },
  ],
];

const FINANZAMT = [
  [
    { k: 'title', t: 'FINANZAMT BERLIN-NEUKÖLLN' },
    { k: 'sub', t: 'Schlesische Straße 27 · 10997 Berlin · Tel. (030) 9024-0' },
    { k: 'hr' },
    { k: 'right', t: 'Steuernummer 14/123/45678' },
    { k: 'right', t: 'Aktenzeichen 2024-ESt-0817' },
    { k: 'right', t: 'Berlin, 12. Juni 2024' },
    { k: 'gap', h: 12 },
    { k: 'p', t: 'Herrn Daniel Okafor, Boxhagener Straße 21, 10245 Berlin' },
    { k: 'gap', h: 10 },
    { k: 'h', t: 'Einkommensteuererklärung 2023 — Erinnerung zur Abgabe' },
    { k: 'p', t: 'Sehr geehrter Herr Okafor,' },
    { k: 'p', t: 'nach unseren Unterlagen haben Sie für das Jahr 2023 bislang keine Einkommensteuererklärung eingereicht. Sie sind zur Abgabe verpflichtet, da bezogene Nebeneinkünfte sowie Werbungskosten eine Veranlagung erwarten lassen.' },
    { k: 'p', t: 'Ich fordere Sie daher auf, Ihre Einkommensteuererklärung 2023 bis zum 31.07.2024 elektronisch über ELSTER oder beim Finanzamt in Papierform einzureichen.' },
    { k: 'p', t: 'Bei verspäteter Abgabe kann ein Verspätungszuschlag nach § 152 Abgabenordnung festgesetzt werden. Der Zuschlag beträgt je angefangenen Monat der Verspätung mindestens 25 €; bei längerer Verspätung erhöht er sich entsprechend.' },
    { k: 'p', t: 'Sollte die Erklärung bereits eingereicht worden sein, betrachten Sie dieses Schreiben bitte als gegenstandslos. Rückfragen beantwortet Ihnen die Servicestelle unter der oben genannten Rufnummer.' },
    { k: 'gap', h: 16 },
    { k: 'p', t: 'Mit freundlichen Grüßen' },
    { k: 'p', t: 'Im Auftrag' },
    { k: 'p', t: 'M. Schulze, Sachbearbeiterin' },
    { k: 'small', t: 'Dieses Schreiben wurde maschinell erstellt und ist ohne Unterschrift gültig.' },
  ],
];

const DOCS = {
  'mietvertrag-2024.pdf': MIETVERTRAG,
  'versicherungsschein-tk.pdf': VERSICHERUNGSSCHEIN,
  'brief-finanzamt.pdf': FINANZAMT,
};

for (const [name, doc] of Object.entries(DOCS)) {
  const out = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  writeFileSync(out, buildPdf(doc.map((blocks, i) => render(blocks, i + 1, doc.length))));
  console.log(`wrote scripts/fixtures/${name} (${doc.length} page${doc.length > 1 ? 's' : ''})`);
}
