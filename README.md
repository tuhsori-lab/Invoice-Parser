# Invoice Splitter

Split a bulk PDF full of invoices into one correctly named PDF per invoice — entirely in your browser.

Accounts receivable and collections teams get invoice batches from dozens of clients, each with its
own layout, arriving as one 400-page PDF. Splitting that by hand is an afternoon. This does it in a
few seconds, shows its working, and lets you fix anything it got wrong before you export.

> **Status:** phase 3 of 6. The engine, the interface and the fixing tools work end to end: drop a
> batch in, see how it was split and why, put right anything it got wrong, and export. Client
> profiles, OCR and the live demo are still to come.

## Your files never leave your browser

Invoices contain confidential client data, so this app has no server to send them to. Everything —
reading the PDF, finding the numbers, building the new files — happens in the browser tab, on your
own machine. There is no upload, no account, no analytics, and no third-party request that carries
any part of your files.

You do not have to take that on trust:

1. Open your browser's developer tools (F12) and go to the **Network** tab.
2. Load a batch, split it, and export.
3. The only requests you will see are the app's own files, loaded once when the page opens. Nothing
   is sent while you work.

You can also disconnect from the network entirely after the page loads and everything still works.

## How the invoice number is found

Detection tries four tiers in order and stops at the first hit. The app always shows **which tier
answered** and **the exact words the number was found after**, so you can see why a number was
picked rather than guessing.

| Tier         | What it looks for                                                                                                     | Example              |
| ------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1. `profile` | A label from one of your saved client profiles, in your order                                                         | `Our Ref 889900`     |
| 2. `common`  | An everyday label: invoice/inv/bill/billing/document/doc/credit memo/debit memo, then `#` or number/num/nbr/no/id/ref | `Invoice No. 104501` |
| 3. `bare`    | The word "Invoice" followed by a number **on the same line**                                                          | `INVOICE 445566`     |
| 4. `custom`  | A regular expression you type, which replaces tiers 1–3                                                               | `Job code ([0-9-]+)` |

A few rules do most of the work of not being confidently wrong:

- **Whole words only.** "no" has to be a whole word, which is what stops `Invoice Notes: 100 units`
  being read as invoice 100.
- **Never mid-word.** A label cannot start inside another word, so `Reinvoice No 12345` is ignored.
- **The bare tier never crosses a line.** An `INVOICE` title with a street address underneath does
  not turn `1234 Maple Street` into the invoice number.
- **Dates are not invoice numbers.** Anything shaped like `09-01-2026`, `09/04/26` or `Sep 4, 2026`
  is skipped when looking for a value.
- **Heading words are stepped over.** With `Invoice No.  Date  Terms` on one line and the values on
  the next, the search walks past "Date" and "Terms" — they contain no digits — and takes `104501`.
- **Text runs are joined by geometry.** A PDF may draw `778812` as `7788` then `12`. Joining runs
  naively gives "7788 12"; the engine inserts a space only when the gap between two runs is wider
  than 0.15× the font size, so the number stays whole.

Anything the engine is unsure about is flagged for review rather than quietly guessed:
`no-number`, `fallback` (the bare tier answered), `conflict` (two labels, two different numbers),
`duplicate-name` (two invoices want the same file name), and `ocr` (the text came from a scan).

## The page strip

The strip along the top of the results is the one place this app uses colour to say something. One
tile per page, coloured by invoice, with a visible gap wherever a new invoice starts. A page that
carries no number of its own and was kept with the invoice before it is striped. A page nothing
could be worked out about is marker yellow — the only thing that colour ever means here. Hover a
tile to see the page itself; click to open it full size with its text beside it.

## Fixing what detection got wrong

Detection is a first guess, so every part of it can be corrected, and nothing is corrected silently.

- **Click the gap between two tiles** on the strip to start a new invoice there, or to join a page
  back to the one before it. A boundary you set keeps a mark of its own.
- **Drag a tile onto another invoice** to move that page. The invoice you drop onto keeps its own
  number — the page joins it, rather than renaming it.
- **Click an invoice number** in the table to correct it. It is marked `edited` afterwards.
- **Undo and redo** with Ctrl+Z and Ctrl+Shift+Z, or the buttons above the strip.

Every fix is stored against page numbers rather than against the current grouping, so changing a
detection setting re-runs detection **without throwing away a single thing you decided**.

The review queue lists anything worth a look before you export, each in a sentence naming the pages:
"No invoice number was found on pages 5 to 6." `N` jumps to the next one. Exporting while problems
remain is allowed — it just asks first, and says how many are left.

### Keyboard

| Key            | Does                          |
| -------------- | ----------------------------- |
| `/`            | Jump to the search box        |
| `N`            | Open the next thing to review |
| `Ctrl+Z`       | Undo the last fix             |
| `Ctrl+Shift+Z` | Redo                          |
| `←` `→`        | Step through pages in preview |
| `Esc`          | Close the preview             |

Moving a page can also be done without a mouse: open the page and use the move links under its
heading.

## Client profiles

A profile is one client's way of printing invoices:

```json
{
  "name": "Northwind Traders",
  "labels": ["Our Ref"],
  "extraLabel": "Store #",
  "filenameTemplate": "{prefix}{invoice}_{extra}",
  "identifyingText": ["Northwind Traders"]
}
```

`identifyingText` is what makes a mixed batch work: each page is matched to a profile on its own, so
one file can hold invoices from several clients and each one gets its own labels tried first.

Profiles are saved in your browser's local storage, and can be exported to a JSON file and imported
on another computer. Teaching a label by highlighting it in the page preview arrives in phase 4.

## File names

Names come from a template with these tokens:

| Token       | Becomes                                             |
| ----------- | --------------------------------------------------- |
| `{prefix}`  | Text you type in front of every name                |
| `{invoice}` | The invoice number                                  |
| `{extra}`   | The extra field, e.g. a PO or store number          |
| `{client}`  | The client profile that recognised the pages        |
| `{pages}`   | The pages this invoice came from, e.g. `5-6`        |
| `{index}`   | Its position in the batch, padded so a folder sorts |

The default is `{prefix}{invoice}_{extra}`. When a token has nothing to put in it, the separator
next to it disappears too, so you get `104233.pdf` and not `104233_.pdf`. Characters Windows refuses
are replaced, names are capped at 150 characters, duplicates become `(2)`, `(3)`, and an invoice with
no number is named after its pages: `NO-NUMBER_p5-6.pdf`.

The CSV page map writes ranges as `1 to 3, 7` rather than `1-3`, because Excel reads `1-3` as a date
and shows `3-Jan`. It also starts with a UTF-8 byte order mark so Excel opens it in the right
encoding.

## Local development

```bash
npm install       # install dependencies
npm run dev       # start the dev server
npm run fixtures  # build the sample PDFs in tests/fixtures/pdf
npm test          # unit tests (builds the fixtures first if they are missing)
npm run test:e2e  # end-to-end tests in a real browser
npm run lint      # ESLint
npm run build     # production build into dist/
```

Node 20 or newer. The end-to-end tests need a browser once: `npx playwright install chromium`.

`npm run dev` and `npm run build` first copy the pdf.js font metrics into `public/pdfjs/`. They are
served from the app rather than from a CDN, so that opening a PDF makes no network request.

## No real invoice data, ever

Nothing in this repository has ever contained a real invoice. Every sample PDF, screenshot and test
fixture is generated by `scripts/make-fixtures.js` using invented companies and made-up numbers. The
generated PDFs are not committed — they are built on demand — so there is no way for a real document
to arrive here by accident.

## Project structure

```
src/core/          the engine — plain JavaScript, no framework, no browser APIs
  extractText.js   turning pdf.js text runs back into readable lines
  detect.js        finding the invoice number, and saying where it came from
  analyze.js       running detection over a whole batch
  group.js         deciding which pages belong to which invoice
  naming.js        building file names from a template
  export.js        the output PDFs, the ZIP, and the CSV page map
  review.js        what needs a person's eye, said in plain words
  profiles.js      client profiles: matching, import and export
  errors.js        plain-language messages for everything that can go wrong
src/lib/           the browser side: pdf.js setup, reading a batch, thumbnails, downloads
src/ui/            the interface (React) and its one stylesheet
scripts/           the fixture generator and its small helpers
tests/unit/        unit tests, including every layout in tests/fixtures/expected.js
tests/e2e/         the whole flow in a real browser, from dropped file to saved file
```

The engine imports nothing from the interface. That is enforced by an ESLint rule, and it is why the
detection rules can be tested on their own — most of the test suite never opens a PDF at all.

## What it cannot do

- **OCR is only as good as the scan.** Text recognition on a scanned page is slower and less
  accurate than reading a real text layer. Anything read this way is flagged so you check it.
- **Some PDFs have a scrambled text layer.** A few generators write text in an order that has
  nothing to do with reading order. The geometry rules cope with most of this, but not all of it; if
  a page looks right and the text panel looks like nonsense, this is why.
- **Password-protected files cannot be opened.** Save a copy without the password first.

## Build phases

1. **Engine** — the core, the fixture generator, unit tests, CI. ✅
2. **Core UI** — drop zone, page strip, invoice table, preview, and the three exports. ✅
3. **Review and fixing** — the review queue, manual split/join/move, inline edits, undo and redo. ✅
4. **Profiles** — client profiles and teaching a label by highlighting it.
5. **Scale and scanned files** — OCR, 1,000-page batches, virtualised table, lazy thumbnails.
6. **Polish and ship** — dark theme, accessibility pass, README GIF, GitHub Pages.

## License

MIT — see [LICENSE](LICENSE).
