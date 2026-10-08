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

Anything the engine is unsure about is flagged for review rather than quietly guessed. The checks
are listed under [Checking every invoice](#checking-every-invoice).

## Checking every invoice

The rule is simple: **an invoice goes out without a second look only when nothing gives any reason
to doubt it.** When something does, it goes on the list of things to check, with a sentence saying
what and on which pages — "S0-80155 on page 2 is not in your invoice list, but SO-80155 is - they
differ only by letters and digits that look alike." Where there is an obvious right answer it is
offered as a button (**Use SO-80155**), and never put in without that click.

| Check                     | What it means                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No number                 | No invoice number was found on these pages.                                                                                                                                                              |
| Scans not read yet        | Some pages are scans that have not been read yet. Until they are, a number from words typed on top of them is not trusted — click **Read scanned pages**.                                                |
| Number may be cut short   | The number found is followed straight on by more of one — `2031` then `/HM/00217` — so it may be only part of the invoice number.                                                                        |
| Two different numbers     | The page gives two numbers — say the box you drew and the "Invoice No." label disagree — and both are shown.                                                                                             |
| Not in your invoice list  | With a list loaded, the number is not in it (see below).                                                                                                                                                 |
| Close to one in your list | Not in the list, but exactly one entry is one character away, or differs only by look-alikes (O/0, I/1, S/5, B/8, Z/2, G/6). That entry is offered.                                                      |
| Doesn't look like theirs  | The number is not the shape of this client's other numbers — "2 letters, a hyphen, then 5 digits". If one look-alike swap would make it fit, that is offered.                                            |
| Far out of sequence       | The number is far from this client's other numbers in the batch: 864127 among 664120 to 664133.                                                                                                          |
| Pages out of order        | A page says "Page 1 of" in the middle of an invoice (two invoices may have been joined), or the marks run out of order.                                                                                  |
| Page count doesn't match  | The pages say "of 3" but only two are here.                                                                                                                                                              |
| Number on a page not read | A scanned page seems to have a number of its own — a label for one, or print in the client's box — but it could not be read, so it was kept with the invoice before. Check it is not a separate invoice. |
| Blank page                | A page with nothing on it.                                                                                                                                                                               |
| Page from no client       | In a batch where you have drawn a box, a page no client you have shown the app claims, that no label read and that does not name the invoice it sits in.                                                 |
| Same file name            | Two invoices want the same file name; the second gets `(2)`.                                                                                                                                             |
| "Invoice" on its own      | The number came from the bare word "Invoice" with no label after it.                                                                                                                                     |
| Read from a scan          | The number came from text recognition and nothing backs it up (see below).                                                                                                                               |

**A number read from a scan** goes out without review only when something double-checks it: your
invoice list has it, or text recognition was at least 75% sure of it _and_ a second reading agrees —
the box and a label on the same page read the same number, or the same number is read on two of the
invoice's pages. A number you typed in yourself needs no check. Everything else read from a scan is
flagged, saying how sure the reading was.

**Two readings of one page.** When a box is saved for a client, the label rules still read the page
alongside it. The box is always the answer; a label that reads the same number counts as a second
opinion, and a label that reads a different one is shown next to it.

**A client's own kind of number.** The shape of the number in a client's box is remembered when the
box is saved. Numbers your invoice list confirms add to it, and so do numbers you type in or put
right yourself — a correction is the clearest word there is on what a client's numbers look like —
and so does a prefix they all share, such as `INV-`. Only the shape is kept — "6 digits" — never a number. Invoices found by a label rather than
a box are grouped by the file they came in, and a shape is only worked out for a file once two of
its numbers are confirmed. The one change the app makes by itself: when a number does not fit, a
single look-alike swap makes it fit, **and** the result is in your invoice list, it is put right and
the table says so ("Read as S0-80155; put right from your invoice list").

### Your invoice list

**Load invoice list**, above the page strip, takes a CSV or Excel (.xlsx) file of your invoice numbers.
It is read in this browser tab, used for this session, and never saved or sent anywhere.

To make one, export your open (or recent) invoices from your accounting system as CSV or Excel — most
have an "Export" or "Download" button on their invoice or receivables list. One column must hold the
invoice numbers; a column of client names is optional. Older `.xls` files need saving as `.xlsx` or
`.csv` first.

When the file is loaded, the app guesses which column is which from the headings and asks you to
confirm. Your choice is remembered by heading, so the next list exported the same way is used
straight away. Then:

- a number in the list is marked **In your invoice list**;
- a number one character from exactly one entry, or a look-alike of it, is flagged and the entry
  offered;
- a number not in the list is flagged **Not in your invoice list**;
- entries in the list that no invoice in the batch carries are listed under **Expected but not
  found**.

**Only let invoices that are in the list go out without a second look** is on whenever a list is
loaded. Turned off, a number missing from the list is only noted beside it.

## Advanced controls

Most batches split correctly as they are, so every setting — how pages are split, what happens to
pages with no number, how the number is found, and what the files are called — sits behind one
**Advanced controls** button above the results, closed to begin with. Closed, the invoices get the
whole width. A setting changed and then put away is never out of mind: the button says how many are
not as they started ("2 settings changed"). Leave the controls open and they are open the next time
too; that one yes or no is the only thing remembered about them, in this browser.

### How each client has gone

At the bottom of Advanced controls is a short list, one line per client with a saved box, counting
their invoices as they are saved — downloaded on their own, in the ZIP, or into a folder:

| Count          | Invoices that                                                      |
| -------------- | ------------------------------------------------------------------ |
| Accepted       | went out with nothing flagged and nothing changed                  |
| Corrected      | had their number typed in or put right — by you, or from your list |
| Sent to review | went out with something still flagged                              |

Each invoice counts once a batch, however many times it is saved. Invoices found by a label rather
than a box are counted together on a last line. A client whose invoices keep needing a look stands
out, and their box may want drawing again. Only the counts are kept, in this browser — never an
invoice number or a file — and **Clear these counts** starts them again.

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
without losing what has already been read. Checking which pages are pictures takes a moment on a
long scan; clicked before that has finished, the button waits for it, so one click reads every
scanned page. **Not now** puts the offer away for the batch. Anything read this way carries an `ocr`
flag, because recognition is never certain — and where it gets the number wrong, you type over it.

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
- **A number split at a slash is joined back up.** Reading a page as scattered text, recognition
  sometimes sees a small gap before a slash and makes `2026 /FX/00940` two words. A slash never
  starts or ends a word on an invoice, so the two are joined again when they sit close together.
- **A label misread by one letter still counts.** On text read from a scan, `Inveice Nr.` or
  `lnvoice No` is taken as the label it plainly is. Only label words of five letters or more, and
  never anything with a digit in it.
- **A box works on a scan.** What recognition reads comes with where each word sat, in the same form
  as a PDF's own text, so a box drawn on a scanned page reads the number from that spot on every
  page of the client — which sidesteps the label altogether. Many scanners already lay their own
  reading over the picture as invisible text (a "searchable PDF"); a box can be drawn on that
  straight away, with nothing to read first, and the pages it reads drop out of the offer to read
  scans. On a scan with no such text under the box, the app says so and points to **Read scanned
  pages**.

**Straightened, and read as scattered text.** A page scanned a little crooked is straightened before
it is read, and a whole page is read as text scattered about the page rather than as one block — an
invoice is a letterhead, some boxes and a table, not a paragraph. On the sample scans these two
together read more invoice numbers right and none wrong; straightening costs some time, which the
quicker reading below wins back.

**The box is read close up, three ways.** On a page from a client with a saved box, the box is also
cut out and read on its own: drawn large enough that capital letters are about 30 pixels tall,
read as a single line using only the letters, digits and `- / _ .` an invoice number is made of,
and cleaned up first — turned to pure black and white at the level that best separates that
picture's ink from its paper, with coloured marks such as a red PAID stamp washed out. It is read
at two sizes in black and white and once in plain grey. When those readings agree with each other
and with the page, that counts as the second opinion a scanned number needs. When they disagree,
every reading is shown and none is picked — unless your invoice list has exactly one of them, in
which case that one is used and the table says it was put right. A box reading that recognition is less than 50% sure of is treated as not read at all: at that
score it is guessing at specks, and a guess shown beside the real number only gets in the way. A
box with nothing printed in it —
a later page of an invoice — reads as empty paper, not as specks to be guessed at.

### Reading scans faster

- **Several pages at once.** Pages are read side by side, one on each of up to four copies of the
  recognition engine — one for each of the computer's processors, less one so the app stays
  responsive. While those are reading, the next page is being drawn.
- **Ready before you click.** The engine starts loading the moment scanned pages turn up, while the
  offer to read them is on screen.
- **Only what matters, for a client with a box.** Once a client has a saved box, their scanned pages
  are read in three parts instead of whole: the top quarter, to tell whose invoice it is; the box,
  for the number; and the foot of the page, for "Page 2 of 3". If the top of a page does not say
  which client it is, the whole page is read as before; if the number in the box is unsure, or two
  readings of it disagree, the whole page gets a second look at another size. One thing is lost: a
  PO number in the middle of such a page is not read, and the PO list says **not read (scan)** for
  it rather than "none found".

On the sample scans with a box saved, a page now takes well under a third of the time it did.

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
before anything is saved; **Save this spot** remembers the box for that client. The same **Point to
the invoice number** button is on every page's preview, for pointing at any time.

A client is recognised from then on by up to three lines near the top of the page the box was drawn
on that are also on at least half of their other invoices in the batch — the pages where the box
finds a number of the same shape. That picks their name, their address and the headings their
software prints, and leaves out what changes from invoice to invoice:

- the time a page was printed, which a browser puts on the first line of every printout;
- a scan's logo, read as nonsense that never comes out the same twice;
- the customer the invoice is addressed to, and that customer's order number, which repeat only on
  invoices to the same customer;
- any line with the boxed invoice number in it, so what is remembered never holds one.

Measuring against the client's own invoices, not the whole batch, matters in a batch from several
clients: a table heading every supplier prints, like `Description Qty Amount`, is on more pages
than any one client's letterhead, and would otherwise be taken for it.

A page is theirs when the first of those lines is on it — nearly always the letterhead — or when
most of them are. A line counts as there when all of its words are, whatever stray marks a scanner
put between them, or all but one when the one that differs has a digit in it: a letterhead can carry
a VAT or account number that changes from one invoice to another. On a page this app read itself,
most of a line's words are enough, each allowed a letter wrong.

Every page matched to that client is then read from inside the box, in this batch and in their next
one, which is not asked about again. In a batch from several clients the card moves on to the first
page of the next client nobody has pointed at, so they can be taught one after another. It never
asks about a page printed word for word more than once in the batch — terms of sale after every
invoice, the same remittance slip — since an invoice has a number of its own and is never the same
twice.

**Pages with nothing in the box.** On many invoices only the first page carries the number; the
pages after it are continuations. A page with no number in the box has no number, and pages with no
number stay with the invoice before them (_Pages with no number on them → Keep with the invoice
before_, the default). So the first page starts an invoice and the pages after it join it, until the
next page with a number in the box starts the next one.

**Something else in the box.** A continuation page sometimes prints a subtotal or a line of the table
where the number goes on the first page. Read blindly, that would start an invoice of its own. So
along with the box the app keeps the _shape_ of the number that was boxed — `50621` is five
digits, `KLMN2231_4` is four letters, four digits, an underscore and a digit — and only a number of
that shape counts, give or take one character in each run because numbering grows. A number in parts
— `7730051-1107`, `2031/TB/00412` — may have each part up to half as long again or half as short, so
one client's orders numbered `7730051-1107` and `9902114705-0031` are both read from the same box;
the parts and the marks between them still have to match. Anything else in the box is ignored and
the page is treated as a continuation. Only the shape is kept, never the
number: what is remembered describes what a client's invoices look like, not what is on one.

The box is kept as fractions of the page — `x0`/`x1` across, `y0`/`y1` up from the bottom — so it
means the same place on a page of a different size, with about a line of slack so a number that sits
slightly differently is still found while the column beside it is not swept in. A saved box answers
before any label does; when it finds nothing, the label tiers are tried as usual.

One box per client: **Draw the box again** on any of their pages replaces it, **Forget this
client's box** on the same page removes it, and **Forget them all** under _Advanced
controls → Finding the number_ clears every one. Boxes are kept in this browser's storage and nowhere else.

## PO numbers

Collections work runs on purchase orders as much as on invoice numbers — a customer's payables team
files by their own order number, so that is what a remittance or a dispute refers to. Every
invoice's PO is listed in its own section under the table, with the label it was found after, and
**Copy list** puts it on the clipboard as two tab-separated columns with a heading row, so it pastes
straight into a spreadsheet as `Invoice` and `PO`. The list follows the search box, and copies
exactly what it shows. It can be switched off under _Advanced controls → Finding the number_. On a scan read the quick way
(see _Reading scans faster_), the PO column says **not read (scan)**: only the top, the box and the
foot of those pages were read.

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
npm run bench     # how often invoices come out wrong, and how fast scans are read
npm run lint      # ESLint
npm run build     # production build into dist/
```

Node 20 or newer. The end-to-end tests need a browser once: `npx playwright install chromium`.

`npm run dev` and `npm run build` first copy what pdf.js and tesseract.js would otherwise fetch from
a CDN into `public/`. They are served from the app itself, so that opening a PDF — or reading a
scan — makes no request to anybody else.

## Measuring it: `npm run bench`

The app's promise is that no invoice is exported with the wrong number or the wrong pages without
something saying so. `npm run bench` checks that against every sample PDF, including nine harder
scans made to go wrong in the ways real ones do:

| Sample                    | What makes it hard                                                    |
| ------------------------- | --------------------------------------------------------------------- |
| `26-scan-tilted.pdf`      | fed into the scanner crooked: 1°, −2° and 3°                          |
| `27-scan-150dpi.pdf`      | scanned at 150 dots per inch, half the usual detail                   |
| `28-scan-faint.pdf`       | faint grey print, as from a printer low on toner                      |
| `29-scan-colored.pdf`     | dark blue print on yellowed paper                                     |
| `30-scan-speckled.pdf`    | dust and dropouts all over the page                                   |
| `31-scan-stamp.pdf`       | a red PAID stamp across the invoice number                            |
| `32-scan-lookalikes.pdf`  | numbers mixing letters and digits that look alike: S/5, O/0, I/1, B/8 |
| `33-scan-page-x-of-y.pdf` | invoices of one, two and three pages, each marked "Page X of Y"       |
| `34-scan-suffix.pdf`      | invoices told apart only by a suffix: `40017822`, `40017822_2`, `_3`  |

Each scan is read twice: once by its labels, as a new client's would be, and once with a box saved
for that client. The benchmark runs in a real browser with the app's own code — the same pdf.js, the
same text recognition, the same detection — and reports, for each sample and overall: invoices that
came out right, invoices that came out wrong, **wrong ones nothing flagged** (the number that has to
be zero), invoices sent for review, page splits that came out right, and seconds per scanned page.
It also fails if the browser asks for anything from anywhere but this machine.

`npm run bench -- --only 26,31` runs just those samples; `--mode box` only the runs with a box.
`bench/baseline.json` holds the run every change is compared against, and the report ends with the
difference.

## No real invoice data, ever

Nothing in this repository has ever contained a real invoice. Every sample PDF, screenshot and test
fixture is generated by `scripts/make-fixtures.js` using invented companies and made-up numbers. The
harder scans are drawn in DejaVu Sans, a freely licensed typeface, and then tilted, faded, speckled
and stamped by the same script, with every random choice seeded so they come out the same each time.
The
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
  verify.js        the checks every invoice goes through before it can go out unreviewed
  knownList.js     reading your invoice list, and checking numbers against it
  image.js         cleaning up the picture of a box before it is read
  quickRead.js     which parts of a scanned page to read, and how many pages at once
  tally.js         counting how each client's invoices have gone
  errors.js        plain-language messages for everything that can go wrong
src/lib/           the browser side: pdf.js setup, reading a batch, text recognition,
                   thumbnails, downloads, saving to a folder, and where boxes are kept
src/ui/            the interface (React) and its one stylesheet
scripts/           the fixture generator, the benchmark runner, and their small helpers
bench/             the benchmark page and the baseline it is compared against
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
