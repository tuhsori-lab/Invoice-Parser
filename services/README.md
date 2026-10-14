# Invoice OCR service

An optional, self-hosted backend that reads invoices (PDFs, scans, photos) and
returns every field with the words it was read from, and whether it checked
out. The frontend stays on GitHub Pages; this runs on your own machine. No
cloud OCR, no external AI API, no data leaves your infrastructure.

Without it, Invoice Hub works exactly as before, entirely in the browser.

It does two jobs:

- **Reading scanned pages for Split.** Split renders a scanned page in the
  browser and sends the picture to `POST /api/ocr`. A worker reads it with
  PaddleOCR and returns the lines and words with their positions, in the same
  form Split already handles from Tesseract. Splitting, naming each PDF by its
  invoice number, and downloading all stay in the browser. The picture waits in
  Redis for at most two minutes and is never written to disk. Pictures someone
  is waiting on are read before queued documents.
- **Full extraction for the Extract tab**, described below.

## What it does

1. **Ingestion.** The file's own bytes decide its type (PDF, PNG, JPEG), not its
   name. Size, page count and pixels per page are capped; encrypted, damaged and
   oversized files are refused before anything renders them.
2. **Native text.** PyMuPDF reads the PDF's own words and positions, and checks
   the text can be trusted (not empty, not garbled, not a scanner's thin layer).
3. **OCR.** Untrustworthy pages are rendered and read by PaddleOCR (PP-OCRv6,
   pinned). The page's orientation is detected and corrected; boxes are mapped
   back onto the page as stored, so evidence points at the right place.
4. **Layout.** Words become lines and cells by geometry; the line-item table is
   found by its headings and its columns kept aligned.
5. **Extraction.** Every field is found next to a label, under a table heading,
   or not at all. Each carries its normalized value, the raw text, page, box,
   OCR confidence and status. Uncertain values are `null`, never guessed.
6. **Validation.** Decimal arithmetic throughout. Totals are reconciled from
   their parts (subtotal, discount, shipping, fees, tax added or included,
   withholding); lines are checked qty × price and against the subtotal; dates
   for ambiguity and order; currencies for consistency; duplicates by vendor,
   number and total.
7. **Targeted retries.** A low-confidence page is re-rendered at a higher DPI; a
   page whose own text lacks a required field is read with OCR; a table that does
   not add up is rebuilt another way; of several labelled totals, the one that
   reconciles is taken; missing fields get a label-free search whose finds always
   go to review. Each retry is bounded and recorded in the result.

A document is **accepted** only when every required field is present and every
field in `must_verify` is confirmed by a check. Otherwise it **needs review**,
with its best reading kept for the reviewer. **Failed** means it could not be
processed at all.

The vendor is confirmed by a label ("From:", "Supplier:") or by matching a
vendor that user has approved before. So the first invoice from each vendor is
reviewed, and later ones can be accepted on their own.

## Run it locally (no Docker)

Needs Python 3.12 and Redis.

```sh
cd services
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
export DATA_DIR=./data REDIS_URL=redis://localhost:6379/0 ALLOWED_ORIGINS=http://localhost:5173

uvicorn invoice_service.api:app --port 8000      # one terminal
python -m invoice_service.worker                  # another; downloads the models (~200 MB) once
python -m invoice_service.admin add-user you      # prints your access token, once
```

Then the frontend, pointed at it:

```sh
VITE_INVOICE_API_URL=http://127.0.0.1:8000/api npm run dev
```

Open the **Extract** tab and sign in with the token.

## Deploy the backend on your own machine

```sh
cp services/.env.example services/.env     # set API_DOMAIN and ALLOWED_ORIGINS
docker compose up -d --build
docker compose exec api python -m invoice_service.admin add-user you
```

- `API_DOMAIN` must point (DNS A/AAAA record) at the machine, with ports 80 and
  443 open. Caddy gets and renews the HTTPS certificate.
- `ALLOWED_ORIGINS` is exactly your Pages origin, e.g. `https://tuhsori-lab.github.io`
  (no path). The browser will refuse any other site.
- Only Caddy publishes ports. Redis, the API and the worker share a private
  network. Nothing else is reachable from outside.
- Data lives in Docker volumes: `documents` (SQLite database and uploads, mode
  0600), `models` (PaddleOCR models), `redis-data`, `caddy-data`. Back up
  `documents`.
- Uploads older than `RETENTION_DAYS` are deleted by the worker, files and records.
- More throughput: `docker compose up -d --scale worker=2`. Each worker loads its
  own models (allow ~7 GB of memory per CPU worker).

### CPU or GPU

CPU is the default: about 10 s per scanned page at 200 DPI on a modern CPU,
and near-instant for PDFs with real text. For a GPU worker (NVIDIA driver and
NVIDIA Container Toolkit on the host):

```sh
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```

Pick the PaddlePaddle wheel index for your CUDA version in `docker-compose.gpu.yml`.

## Point the GitHub Pages site at it

In the repository: **Settings → Secrets and variables → Actions → Variables**, add

```
VITE_INVOICE_API_URL = https://YOUR_API_DOMAIN/api
```

and re-run the **Deploy to GitHub Pages** workflow. The site then shows an
**Extract** tab. Once you sign in there, Split's **Read scanned pages** button
uses your server, and the header note changes to "Files go only to your own
server". Remove the variable and redeploy to go back to browser-only.

The address is public by nature; it is not a secret. Access is by per-user
token, entered in the browser and kept in session storage (or local storage if
"Remember on this computer" is ticked). Never put a token in a `VITE_` variable.

## Settings

All in `services/.env` (see `services/.env.example`):

| Variable                                                  | Default                                   |                                                       |
| --------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------- |
| `API_DOMAIN`                                              | —                                         | Domain Caddy serves HTTPS for                         |
| `ALLOWED_ORIGINS`                                         | `http://localhost:5173`                   | Comma-separated exact origins for CORS                |
| `DATA_DIR`                                                | `./data` (`/data` in Docker)              | SQLite database and uploaded files                    |
| `REDIS_URL`                                               | `redis://localhost:6379/0`                | Job queue and rate limits                             |
| `MAX_UPLOAD_MB`                                           | 20                                        | Largest upload                                        |
| `MAX_PAGES`                                               | 30                                        | Most pages per document                               |
| `MAX_PAGE_PIXELS`                                         | 40000000                                  | Rendering budget per page (also the image-bomb guard) |
| `JOB_SECONDS`                                             | 300                                       | Time limit per document                               |
| `MAX_ATTEMPTS`                                            | 3                                         | Tries after technical failures                        |
| `REQUESTS_PER_MINUTE`                                     | 600                                       | Per user                                              |
| `UPLOADS_PER_HOUR`                                        | 200                                       | Per user                                              |
| `RETENTION_DAYS`                                          | 30                                        | Documents are deleted after this                      |
| `OCR_LANG`                                                | `en`                                      | PaddleOCR language                                    |
| `OCR_DPI_LADDER`                                          | `200,300`                                 | First render, then the retry resolutions              |
| `OCR_DET_MODEL`, `OCR_REC_MODEL`, `OCR_ORIENTATION_MODEL` | PP-OCRv6 medium, PP-LCNet doc orientation | Pinned models                                         |
| `POLICY_FILE`                                             | —                                         | Acceptance policy JSON written by calibration         |

The policy (`invoice_service/config.py`, `Policy`) also sets which fields are
required, which must be verified, the rounding tolerance, `date_order`
(`DMY`/`MDY`, when every supplier writes dates one way) and `dollar_currency`
(what a bare `$` means for you; unset, `$`-only invoices go to review).

## API

All routes but `/api/health` need `Authorization: Bearer <token>`. Another
user's document is a 404.

|                                        |                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `POST /api/invoices`                   | Multipart `file`. 202 `{id, status: "queued"}`; 413/415/422 for bad files       |
| `GET /api/invoices`                    | Your documents, newest first                                                    |
| `GET /api/invoices/{id}`               | One document's record                                                           |
| `GET /api/invoices/{id}/status`        | `queued`, `processing`, `accepted`, `needs_review`, `failed`                    |
| `GET /api/invoices/{id}/result`        | The reading, with corrections applied                                           |
| `GET /api/invoices/{id}/file`          | The original upload                                                             |
| `PATCH /api/invoices/{id}/corrections` | `{corrections: {"total_due": "108.25", "line_items.0.quantity": "3"}, approve}` |
| `POST /api/invoices/{id}/retry`        | Re-queue a failed document                                                      |

The result's shape is `invoice_service/schema.py`, mirrored for the browser in
`packages/invoice-schema/index.ts` (Zod). A contract test keeps them in step.

## Tests

```sh
cd services
python -m pytest -m "not slow"   # ~1 s: parsing, validation, ingestion, retries, API, ownership, limits
python -m pytest                 # also runs real PaddleOCR on a straight and a sideways scan (~30 s)
```

## Measuring accuracy

```sh
# Made-up invoices with known answers (the pipeline works; says little about yours):
python -m invoice_service.synth bench-data --count 60

# Your own: a folder of invoices and a labels.json, see benchmark.py for the format.
python -m invoice_service.benchmark bench-data --calibrate   # tunes on the "tune" split
python -m invoice_service.benchmark bench-data               # scores the held-out "test" split
```

The benchmark reports exact-match accuracy per field, line-item precision and
recall, reconciliation rate, auto-accept precision **with its 95% lower
bound**, review and failure rates, latency, memory and retry recovery. It
treats the reviewer as approving each invoice after processing, as in real use.

Calibration only writes a policy when the auto-accept precision's lower bound
reaches the target (default 0.99). That takes several hundred correct
acceptances: 40 out of 40 only shows 91%.

### Results so far

On 60 synthetic invoices (one template, 40% scanned, some sideways), held-out
test split of 20: every field exact on 20/20, line items 100% precision and
recall, all totals reconciled, 12 accepted automatically (all correct), 8 sent
to review as first invoices from their vendor. Median 0.01 s for text PDFs,
about 12 s per scanned page on an Apple M5 CPU.

This shows the pipeline works end to end. **It is not evidence of accuracy on
real invoices**: the synthetic set uses one layout. Before trusting automatic
acceptance, label a few hundred of your own invoices and calibrate on them.

## Known limitations

- Layouts are read by labels and geometry. Invoices whose labels are not in
  `extraction.py`'s lists, or whose values are far from their labels, go to
  review rather than being guessed.
- PaddleOCR's layout and table-recognition pipeline (PP-StructureV3) and a local
  extraction model were **not** added: neither has been shown to beat the
  current approach on labelled data. The benchmark is where to show it first.
- Skewed text is read as-is (PaddleOCR copes with a few degrees); there is no
  dewarping of photographed, curled pages.
- One language model at a time (`OCR_LANG`).
- SQLite suits one machine. Several worker machines need a shared database.
- Docker images were written but not built in this repository's CI.
