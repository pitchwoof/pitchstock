# pitchstock — Ink Inventory Management

A small web app for tracking ink SKU inventory: receiving new stock (inflow), issuing
stock to customers (outflow), and monitoring expiration dates across batches.

## Features

- **Products** — catalog of ink SKUs (brand, color, unit, reorder level).
- **Batches** — every delivery received is its own batch with its own expiration date.
- **Receive Stock** — record inflow: creates a new batch.
- **Issue Stock** — record outflow to a customer. Automatically allocates from the
  batch with the **earliest expiration date first (FEFO)** so older ink gets used up
  before newer ink, unless you pick a specific batch manually.
- **Dashboard** — low stock alerts, batches expiring within 30 days, expired batches.
- **History** — full transaction log, filterable, exportable to CSV.
- **Staff accounts** — admin can create staff logins; every transaction records who did it.

## Running locally

```
npm install
npm run seed     # creates the database, seeds ink SKUs, creates admin login
npm start
```

Open http://localhost:3300. Default login: `admin` / `changeme123` — **change this
password immediately** via the "Change password" link in the top-right of the app.

(Port 3300 is used instead of the more common 3000 because another program on this
PC already occupies port 3000. If 3300 is ever taken too, set a different `PORT`
environment variable before running `npm start`.)

## Importing a stock-snapshot spreadsheet

If you have an Excel file shaped like `Brand | ITEM | คงเหลือ | <month usage columns> |
จำนวนหมึกหมดอายุ` (the monthly stock-count format), you can load it directly instead of
entering everything by hand:

```
npm run import-stock -- "C:\path\to\stock file.xlsx"          # add to existing catalog
npm run import-stock -- "C:\path\to\stock file.xlsx" --wipe   # replace catalog + stock entirely
```

What it does:
- Reads the snapshot date from the filename (e.g. `22.7.69` = 22 July 2569 BE = 2026-07-22).
- Creates any products that don't already exist (SKU code derived from brand + item name).
- Sets each product's reorder level to its average monthly usage from the file, so the
  low-stock alert defaults to "about 1 month of stock left" — adjust per-product on the
  Products page if you want a different buffer.
- Loads the current quantity as an opening-stock batch dated to the snapshot date, with
  no expiration date (unknown — edit the batch/receive a real one once you know it).
- If the file reports some quantity as already expired, that portion becomes a separate
  batch dated as expired, so it shows up immediately on the Dashboard instead of being
  silently included in "good" stock.

This is meant to be re-run each time you get a fresh monthly snapshot from your own
tracking spreadsheet — without `--wipe` it just adds new products/batches on top of
what's already there (existing SKUs are matched by their generated code, not duplicated).

## Data model notes

- Every unit of stock lives in a **batch** (a specific delivery/lot with its own
  expiration date). A product's "on hand" quantity is the sum of its batches.
- Outflow always tries to use up the batch expiring soonest first (FEFO), which is
  the standard approach for shelf-life-limited stock like ink.
- All history is kept — nothing is deleted, so you always have an audit trail of who
  received/issued what and when.

## Deploying so staff can access it from anywhere

This app is a single Node process with a SQLite database file on disk — it needs a
host that keeps a **persistent disk/volume** (not just ephemeral container storage,
or your data disappears on every redeploy).

Two straightforward options:

### Option A — Railway (recommended, simplest)

1. Push this folder to a GitHub repo (private is fine).
2. Create a new Railway project → Deploy from GitHub repo.
3. Add a **Volume**, mount it at `/app/data`.
4. Set environment variables in Railway's dashboard:
   - `SESSION_SECRET` — any long random string
   - `COOKIE_SECURE=1`
   - `NODE_ENV=production`
5. Railway will detect the Dockerfile and build/run it automatically. It gives you a
   public HTTPS URL your staff can open from any device.
6. SSH into the Railway container (or run a one-off command) to run `node
   seed/seed.js` once, to create the initial products and admin login.

### Option B — Fly.io

1. `fly launch` in this folder (it will detect the Dockerfile).
2. `fly volumes create pitchstock_data --size 1` and mount it at `/app/data` in
   `fly.toml`.
3. `fly secrets set SESSION_SECRET=... COOKIE_SECURE=1`
4. `fly deploy`

### After deploying

- Log in as `admin`, immediately create a real admin account for yourself with a
  strong password, then disable the default `admin` account.
- Create one staff account per employee (Users page) so transaction history shows
  who did what.
- Bookmark the URL on staff phones/computers — no app install needed, it's just a
  website.

## Project structure

```
server.js            Express app entry point
db.js                 SQLite schema (products, batches, stock_transactions, users)
routes/               REST API (auth, products, inventory, batches, outflow, transactions)
public/               Frontend (plain HTML/CSS/JS, no build step)
seed/seed.js          One-time seed script (ink SKUs + admin user)
seed/import_stock.js  Re-runnable importer for monthly stock-snapshot spreadsheets
```
