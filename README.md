# Invoice Splitter

Split a bulk PDF full of invoices into one correctly named PDF per invoice — entirely in your browser.

**[Try it](https://tuhsori-lab.github.io/Invoice-Parser/)** — it runs entirely in the page; nothing
you open is uploaded.

Accounts receivable and collections teams get invoice batches from dozens of clients, each with its
own layout, arriving as one 400-page PDF. Splitting that by hand is an afternoon. This does it in a
few seconds, shows its working, and lets you fix anything it got wrong before you export.

![A four-page batch is dropped in. Nothing recognises the heading its invoice number sits
under, so all four pages run together as one invoice and the app asks to be shown the number. A
box is drawn around it on the first page, like a screenshot, and the batch splits into its two
invoices, each keeping its continuation page. Both are then saved straight into a folder.](docs/demo.gif)

Every invoice in that recording is made up. It was recorded from the real app by `npm run demo`,
using the sample PDFs this repository generates.

## Your files never leave your browser

Invoices contain confidential client data, so this app has no server to send them to. Everything —
reading the PDF, finding the numbers, building the new files — happens in the browser tab, on your
own machine. There is no upload, no account, no analytics, and no third-party request that carries
any part of your files.

You do not have to take that on trust:

1. Open your browser's developer tools (F12) and go to the **Network** tab.
2. Load a batch, split it, and export.
3. Every request you see is for this app's own files, from this app's own address. Some of it
   arrives late — the code that builds PDFs is fetched the first time you export, and the text
   recognition engine the first time you turn it on — and all of it is `GET`. Nothing is ever sent.

You can also disconnect from the network entirely after the page has loaded, and everything except
turning text recognition on for the first time still works.

There is a test that holds this to account: it watches every request the browser makes while a
batch is loaded, searched, previewed and exported, and fails if any of them leaves this origin or is
anything other than a `GET`.

## How the invoice number is found

Detection tries these in order and stops at the first hit. The app always shows **which tier
answered** and **the exact words the number was found after**, so you can see why a number was
picked rather than guessing.

| Tier        | What it looks for                                                                                                                                       | Example                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1. `zone`   | The box you drew around this client's number, read before any wording is looked at                                                                      | (wherever you drew)         |
| 2. `common` | An everyday label: invoice/inv/bill/billing/document/doc/credit memo/debit memo/credit note/debit note, then `#`, N°, N. or number/num/nbr/nr/no/id/ref | `Invoice Nr. 2031/TB/00412` |
| 3. `bare`   | The word "Invoice" followed by a number **on the same line**                                                                                            | `INVOICE 445566`            |
| 4. `custom` | A regular expression you type, which replaces the other three                                                                                           | `Job code ([0-9-]+)`        |

A few rules do most of the work of not being confidently wrong:

- **Whole words only.** "no" has to be a whole word, which is what stops `Invoice Notes: 100 units`
  being read as invoice 100.
- **Never mid-word.** A label cannot start inside another word, so `Reinvoice No 12345` is ignored.
- **The bare tier never crosses a line.** An `INVOICE` title with a street address underneath does
  not turn `1234 Maple Street` into the invoice number.
- **A suffix belongs to the number.** Hyphens and underscores are part of a value rather than a
  break in it, so `40017822_2` is kept whole. Accounting software often prints a revision or print
  count that way, and two invoices can differ by nothing else. A dangling `-` or `_` on the end is
  trimmed, and a value still has to contain a digit — `DRAFT_COPY` is not an invoice number.
- **So do slashes between characters.** A lot of European invoicing numbers by year and ledger, and
  `2031/TB/00412` is one number, saved as `2031-TB-00412.pdf` because a file name cannot hold a
  slash. Only letters and digits count towards a number's length, so a page count such as `1/2` is
  never taken for one.
- **A credit note is read by its own number.** `Cred. Note N. 2031/TB/00587` is a label, so a credit
  note that says `REF. INVOICE 2031/TB/00412` further down is filed under its own number, not the
  invoice it credits.
- **Dates are not invoice numbers.** Anything shaped like `09-01-2026`, `09/04/26` or `Sep 4, 2026`
  is skipped when looking for a value.
- **Heading words are stepped over.** With `Invoice No.  Date  Terms` on one line and the values on
  the next, the search walks past "Date" and "Terms" — they contain no digits — and takes `104501`.
- **Text runs are joined by geometry.** A PDF may draw `778812` as `7788` then `12`. Joining runs
  naively gives "7788 12"; the engine inserts a space only when the gap between two runs is wider
  than 0.15× the font size, so the number stays whole.
- **Lines come from the page, not the file.** Accounting software draws the blank form first —
  every label in one pass — and drops the values into their boxes afterwards. Read in file order
  such a page is a list of headings with all the numbers underneath, and `Invoice No.` is followed
  by `Date` rather than by the number sitting next to it. Every run is placed by its coordinates,
  gathered into bands by how far down the page it is, and read left to right, which is what a
  person looking at the page does.
- **A value has to stand in its label's column.** A label is often a column heading with its number
  printed underneath rather than beside it, and something unrelated — a company's own postcode, say
  — can sit at that same height on the far side of the page. On the label's own line reading order
  decides; on a later line only what stands in the label's column counts, so the postcode is passed
  over and the number below the heading is taken.

Anything the engine is unsure about is flagged for review rather than quietly guessed:
`no-number`, `fallback` (the bare tier answered), `conflict` (two labels, two different numbers),
`duplicate-name` (two invoices want the same file name), and `ocr` (the text came from a scan).

## The page strip

The strip along the top of the results is the one place this app uses colour to say something. One
tile per page, coloured by invoice, with a visible gap wherever a new invoice starts and a bracket
over each invoice's pages with its number above it. An invoice's first page is solid and every page
after it is striped, whether or not the number is printed on it again, so where each invoice starts
reads at a glance. An invoice nothing could be worked out about is marker yellow, bracket and all —
the only thing that colour ever means here. Hover a tile to see the page itself; click to open it
full size with its text beside it.

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

## Scanned pages

A scanned invoice is a photograph of a piece of paper. Some scans have no text in them at all.
Others have a few words typed on top — a stamp, a customs note, a table somebody pasted in — so the
page has text, just not the text printed on the paper, and the invoice number is nowhere in it. The
app tells those apart by asking pdf.js how much of the page is an image, which it only asks about
pages that came out with no number. Either way it says so and offers to read them:

> 3 pages look like scans, so their invoice numbers could not be read. **[Read scanned pages (slower)]**

It is offered rather than done automatically because it is slow, and it can be stopped part way
without losing what has already been read. Anything read this way carries an `ocr` flag, because
recognition is never certain — and where it gets the number wrong, you type over it.

Recognition is also not steady, and the app is built around that:

- **Each scan is read at the size it was made**, which pdf.js reports along with the picture — a
  300 dpi scan is read at about 2,480 pixels across — within 1,500 and 2,600. Shrinking a scan to a
  smaller picture blurs exactly the small print invoice numbers are set in.
- **An unsure reading gets a second look.** Recognition says how sure it was of every word. When a
  page gives no invoice number, or gives one it was less than 75% sure of, it is read again a quarter
  smaller and the surer reading is kept. On a real scanned batch the same two ledger letters in the
  middle of an invoice number came out as a letter and a `%` on some pages at one size and as the
  wrong letter on others at another, each time with a low score, and the second look read every one
  of them correctly.
- **A label misread by one letter still counts.** On text read from a scan, `Inveice Nr.` or
  `lnvoice No` is taken as the label it plainly is. Only label words of five letters or more, and
  never anything with a digit in it.
- **A box works on a scan.** What recognition reads comes with where each word sat, in the same form
  as a PDF's own text, so a box drawn on a scanned page reads the number from that spot on every
  page of the client — which sidesteps the label altogether. Until a scan has been read the app does
  not ask for a box, since there would be nothing inside it to read.

The recognition engine, its WebAssembly and the English language data are all served by this app
(copied out of `node_modules` by `npm run assets`, about 14 MB). They are fetched the first time
somebody turns recognition on, from this app's own address, so an ordinary batch never downloads a
byte of them and a scanned one still never talks to anybody else.

## Long batches

A batch of a thousand pages has to stay as quick as a batch of ten:

- **Detection re-runs in about 15 ms over a thousand pages**, so changing a setting is instant. The
  PDF is read once; everything after that works on text already in memory. There is a unit test
  holding this to a budget.
- **Reading the PDF happens a chunk at a time**, with a progress bar and a Cancel button, so the
  page never freezes and a batch opened by mistake can be stopped.
- **The page strip draws each tile as its own memoised component**, so hovering one tile in a
  thousand-page batch redraws one tile.
- **Past 200 invoices the table draws only the rows in view.** An empty row above and below holds
  the scrollbar at the right size.
- **Thumbnails are drawn when a page is first hovered, and kept**, so nothing is rendered that
  nobody looked at.
- **Each source file is loaded into pdf-lib once** and reused for every export.
- **The code that builds PDFs and ZIPs is fetched when you first export**, not on the way in.

## Drawing a box around the invoice number

Every client prints invoices differently, and some cannot be taught by their wording at all: the
label is drawn over other text, or is part of a picture, or is worded differently on every invoice.
But the number is still printed in the same place on every invoice they send, so the app asks to be
shown that place once.

When a batch has pages no saved spot covers, a card above the page strip says so and names the first
of them. **Point to it on page 1** opens that page with the page dimmed, and you drag a box around
the invoice number — like taking a screenshot. The bar above the page shows what is inside the box
before anything is saved; **Save this spot** remembers the box for that client, recognised from
then on by the first line of their page — nearly always the letterhead. The same **Point to the
invoice number** button is on every page's preview, for pointing at any time.

On a scan the first line is as likely to be a logo read as nonsense, and any one line can be run
together with the next or missing from another page's reading. So a client first seen on a scan is
known by up to three lines near the top of the page that turn up on at least half of the batch's
other scanned pages — their name and address, not the customer's. On a scanned page, a line counts
as there when most of its words are, each allowed a letter wrong, and the client counts as there when
most of their lines are: an address shared with a neighbour in the same town is not enough.

Every page matched to that client is then read from inside the box, in this batch and in their next
one, which is not asked about again. In a batch from several clients the card moves on to the first
page of the next client nobody has pointed at, so they can be taught one after another.

**Pages with nothing in the box.** On many invoices only the first page carries the number; the
pages after it are continuations. A page with no number in the box has no number, and pages with no
number stay with the invoice before them (_Pages with no number on them → Keep with the invoice
before_, the default). So the first page starts an invoice and the pages after it join it, until the
next page with a number in the box starts the next one.

**Something else in the box.** A continuation page sometimes prints a subtotal or a line of the table
where the number goes on the first page. Read blindly, that would start an invoice of its own. So
along with the box the app keeps the _shape_ of the number that was boxed — `50621` is five
digits, `KLMN2231_4` is four letters, four digits, an underscore and a digit — and only a number of
that shape counts, give or take one character in each run because numbering grows. Anything else in
the box is ignored and the page is treated as a continuation. Only the shape is kept, never the
number: what is remembered describes what a client's invoices look like, not what is on one.

The box is kept as fractions of the page — `x0`/`x1` across, `y0`/`y1` up from the bottom — so it
means the same place on a page of a different size, with about a line of slack so a number that sits
slightly differently is still found while the column beside it is not swept in. A saved box answers
before any label does; when it finds nothing, the label tiers are tried as usual.

One box per client: **Draw the box again** on any of their pages replaces it, **Forget this
client's box** on the same page removes it, and **Forget them all** under _Finding the number_
clears every one. Boxes are kept in this browser's storage and nowhere else.

## PO numbers

Collections work runs on purchase orders as much as on invoice numbers — a customer's payables team
files by their own order number, so that is what a remittance or a dispute refers to. Every
invoice's PO is listed in its own section under the table, with the label it was found after, and
**Copy list** puts it on the clipboard as two tab-separated columns with a heading row, so it pastes
straight into a spreadsheet as `Invoice` and `PO`. The list follows the search box, and copies
exactly what it shows. It can be switched off under _Finding the number_.

A PO is found the way an invoice number is — after a label, and in its column when the label is a
heading — using `PO #`, `P.O. No.`, `PO Number`, `Purchase Order`, and `Customer PO` or `Your PO`.
Plain `PO` counts only with the number straight after it, which is what keeps `PO Box 2623` from ever
being read as a purchase order: `Box` is not shaped like a value. `Order #` is deliberately not a PO
label, because on many invoices it is the seller's own order number, printed right beside the
buyer's PO.

## Saving the invoices

- **Download all as ZIP** puts every invoice in one ZIP, saved wherever the browser saves downloads.
- **Save to a folder…** asks which folder, then writes every invoice into it as its own PDF — no ZIP
  to unpack. If a file of the same name is already there, it asks before replacing it, and nothing
  else in the folder is touched. This uses the browser's File System Access feature, which Chrome
  and Edge have and Firefox and Safari do not; where it is missing the button is not shown and the
  ZIP is the way out. The folder picker opens where the last batch was saved.
- **Download** on a row saves one invoice, and **Download page map** saves the CSV of which pages
  went where.

Every one of these writes files on this computer only. Choosing a folder gives this page permission
to save into it, and nothing more.

## File names

Names come from a template with these tokens:

| Token       | Becomes                                             |
| ----------- | --------------------------------------------------- |
| `{prefix}`  | Text you type in front of every name                |
| `{invoice}` | The invoice number                                  |
| `{extra}`   | The extra field, e.g. a PO or store number          |
| `{client}`  | The client whose box read the pages                 |
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
npm run test:e2e  # end-to-end tests in a real browser, including an accessibility audit
npm run demo      # re-record the GIF above (needs the app built and served)
npm run lint      # ESLint
npm run build     # production build into dist/
```

Node 20 or newer. The end-to-end tests need a browser once: `npx playwright install chromium`.

`npm run dev` and `npm run build` first copy what pdf.js and tesseract.js would otherwise fetch from
a CDN into `public/`. They are served from the app itself, so that opening a PDF — or reading a
scan — makes no request to anybody else.

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
  profiles.js      what the app remembers about a client, and matching it to pages
  scans.js         telling a scan from a typed page, and how large to read it
  errors.js        plain-language messages for everything that can go wrong
src/lib/           the browser side: pdf.js setup, reading a batch, text recognition,
                   thumbnails, downloads, saving to a folder, and where boxes are kept
src/ui/            the interface (React) and its one stylesheet
scripts/           the fixture generator and its small helpers
tests/unit/        unit tests, including every layout in tests/fixtures/expected.js
tests/e2e/         the whole flow in a real browser, from dropped file to saved file
docs/              the walkthrough GIF, recorded from the app by scripts/make-demo.js
```

The engine imports nothing from the interface. That is enforced by an ESLint rule, and it is why the
detection rules can be tested on their own — most of the test suite never opens a PDF at all.

## Getting on with it without a mouse

Every part of this can be worked from the keyboard, and the whole thing is checked against the
WCAG 2.1 AA rules by an automated audit on every push — the empty page, a split batch in both
themes, the page preview, and the preview while a box is being drawn.

| Key            | Does                                    |
| -------------- | --------------------------------------- |
| `/`            | Jump to the search box                  |
| `N`            | Open the next thing to review           |
| `Ctrl+Z`       | Undo the last fix                       |
| `Ctrl+Shift+Z` | Redo                                    |
| `←` `→`        | Step through pages in the preview       |
| `Esc`          | Close whatever is open                  |
| `Tab`          | Stays inside a dialog while one is open |

Dialogs give focus back to whatever opened them, there is a skip link past the settings, the
summary sentence is announced when it changes, and the whole thing works down to a 380-pixel-wide
screen. Colours are checked against the paper they sit on: nothing is below 4.5:1.

## Light and dark

There is a light theme, a dark theme, and "System", which follows whatever this computer is set to
and changes with it. The choice is remembered in this browser and settled before the first paint,
so the page never flashes the wrong colours on the way in.

## What it cannot do

- **OCR is only as good as the scan.** Text recognition is slower and much less certain than
  reading a real text layer — about five to ten seconds a page. Of the two sample scans in this
  repository, both drawn with a dot-matrix font built into the fixture script, it reads every number
  on the second (some only on a second look) but still stumbles on the number on the first, which is
  drawn larger and blurrier. Anything read this way is flagged, and the number can be typed over.
- **Some PDFs have a scrambled text layer.** Text is laid out by position rather than by the order
  the file stores it in, which handles the usual culprits — form templates especially. What it
  cannot fix is a file whose coordinates are themselves wrong, or text drawn as pictures of letters.
  If a page looks right and the text panel looks like nonsense, this is why.
- **Password-protected files cannot be opened.** Save a copy without the password first.
- **A PO under an unusual label is not found.** A client who prints their order reference after
  something like `Our order + Ref` has a PO the everyday labels do not cover. It shows as
  "none found" rather than as a wrong guess.

## Build phases

1. **Engine** — the core, the fixture generator, unit tests, CI. ✅
2. **Core UI** — drop zone, page strip, invoice table, preview, and the three exports. ✅
3. **Review and fixing** — the review queue, manual split/join/move, inline edits, undo and redo. ✅
4. **Profiles** — client profiles and teaching a label by highlighting it. ✅ Later replaced by
   drawing a box around the number, which does the same job with one gesture.
5. **Scale and scanned files** — OCR, 1,000-page batches, virtualised table, lazy thumbnails. ✅
6. **Polish and ship** — dark theme, accessibility pass, empty and error states, README GIF,
   GitHub Pages. ✅

## Deploying it

Every push runs lint, formatting, the unit tests, a build, and the browser tests. A push to `main`
also deploys to GitHub Pages. That last part needs the repository set up for it once: **Settings →
Pages → Source: GitHub Actions**. Until then the workflow runs and the link above will not answer.

## License

MIT — see [LICENSE](LICENSE).
