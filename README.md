# Asp Perfume

LINK: https://asp-perfume.onrender.com

# Asp Perfume — Backend Setup Guide

Node.js + Express + MongoDB backend for the existing Asp Perfume storefront.
Your frontend design is unchanged — this adds a real database and API behind it.

---

## 1. Prerequisites

| Tool | Version | Check with |
|---|---|---|
| Node.js | 18 or newer | `node -v` |
| npm | 9 or newer | `npm -v` |
| MongoDB | 6 or newer, **or** an Atlas account | `mongod --version` |

Node 18+ is a hard requirement — the payment controller uses the global `fetch`, which
does not exist in Node 16.

---

## 2. Database setup

Pick **one** of these two.

### Option A — Local MongoDB (recommended while developing)

**Windows**
1. Download MongoDB Community Server: <https://www.mongodb.com/try/download/community>
2. Run the installer, tick **Install MongoDB as a Service**.
3. Verify it is running: open Services (`Win+R` → `services.msc`) and look for **MongoDB Server**.

Your connection string is:
```
mongodb://127.0.0.1:27017/asp_perfume
```

**macOS**
```bash
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community
```

**Linux (Ubuntu/Debian)**
```bash
sudo apt install -y mongodb
sudo systemctl start mongodb
sudo systemctl enable mongodb
```

You do **not** need to create the database or any collections by hand. Mongoose creates
`asp_perfume` and all six collections the first time the seed script writes to it.

### Option B — MongoDB Atlas (free cloud tier)

1. Sign up at <https://www.mongodb.com/cloud/atlas> and create a free **M0** cluster.
2. **Database Access** → *Add New Database User*. Save the username and password.
3. **Network Access** → *Add IP Address* → `0.0.0.0/0` for development.
   Restrict this to your real server IP before going live.
4. **Connect** → *Drivers* → copy the connection string, then insert your password and
   the database name:

```
mongodb+srv://<user>:<password>@<cluster>.mongodb.net/asp_perfume?retryWrites=true&w=majority
```

> If your password contains `@ : / ? # [ ] %`, URL-encode it or the URI will not parse.
> `@` becomes `%40`, `#` becomes `%23`.

---

## 3. Installation

```bash
cd asp-perfume/backend
npm install
```

Installs: `express`, `mongoose`, `bcryptjs`, `jsonwebtoken`, `dotenv`, `cors`,
`morgan`, `express-rate-limit`, and `nodemon` as a dev dependency.

---

## 4. Environment configuration

Copy the template:

```bash
# macOS / Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

Generate a real JWT secret — **do not invent one by hand**, and do not reuse the example:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Then edit `.env`:

```ini
PORT=5000
NODE_ENV=development

MONGO_URI=mongodb://127.0.0.1:27017/asp_perfume

JWT_SECRET=<paste the 96-character string you just generated>
JWT_EXPIRES_IN=7d

CLIENT_URLS=http://localhost:5500,http://127.0.0.1:5500,http://localhost:5000,http://127.0.0.1:5000

SEED_ADMIN_EMAIL=admin@aspperfume.com
SEED_ADMIN_PASSWORD=<a strong password you choose>
SEED_DEMO_PASSWORD=<another password>

# Optional — leave blank to use the built-in simulated payment flow
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
```

**`.env` is already in `.gitignore`. Never commit it.** If you ever push it by accident,
rotate the JWT secret and every password in it — deleting the file from a later commit
does not remove it from git history.

---

## 5. Seed the database

```bash
npm run seed
```

Expected output:

```
[db] MongoDB connected: 127.0.0.1/asp_perfume
[seed] Clearing existing data...
[seed] Inserting products...
[seed] 6 products inserted.
[seed] Admin created: admin@aspperfume.com
[seed] Demo user created: demo@aspperfume.com (600 points)
[seed] Done.
```

This inserts your three original fragrances (Midnight Noir, Rose Bloom, Citrus Dawn) with
their exact prices, notes and image URLs, plus three new ones using the images you
uploaded (Black Element, Moonkissed Drama, Violet Hour).

> `npm run seed` **wipes all six collections first**. It is for development only.
> Never run it against a database holding real orders. To empty everything without
> re-inserting, use `npm run seed:destroy`.

The demo user starts with 600 points so you can test redemption immediately (the minimum
is 500).

---

## 6. Start the backend

```bash
npm run dev     # auto-restarts on file changes
# or
npm start       # plain node, for production
```

```
  Asp Perfume API
  Mode:       development
  API:        http://localhost:5000/api
  Storefront: http://localhost:5000
  CORS allow: http://localhost:5500, http://127.0.0.1:5500, ...
```

Confirm it is alive:

```bash
curl http://localhost:5000/api/health
```

---

## 7. Running the complete website

### The simple way (one process)

`server.js` already serves the `frontend/` folder as static files. So with the backend
running, just open:

- Storefront → <http://localhost:5000>
- Admin → <http://localhost:5000/admin.html>

Nothing else to start. `api.js` detects it is on port 5000 and uses the relative path
`/api`, so there is no cross-origin request at all.

### The two-process way (VS Code Live Server)

If you prefer Live Server for the frontend:

1. Keep the backend running on port 5000.
2. Right-click `frontend/index.html` → **Open with Live Server** (port 5500).

`api.js` sees it is not on port 5000 and switches to `http://localhost:5000/api`.
Port 5500 is already in the default `CLIENT_URLS`, so CORS will allow it.

> **Do not open `index.html` by double-clicking it.** That gives you a `file://` URL, and
> browsers block `fetch` from `file://` regardless of CORS settings. The page will load
> but no products will appear. Use one of the two methods above.

---

## 8. How the frontend talks to the backend

```
┌────────────────────────┐         ┌─────────────────────────┐        ┌──────────┐
│  index.html            │         │  Express :5000          │        │ MongoDB  │
│  (your original UI)    │         │                         │        │          │
│                        │  fetch  │  /api/auth/*            │        │ users    │
│  js/api.js ────────────┼────────▶│  /api/products/*        │───────▶│ products │
│   • JWT in localStorage│  JSON   │  /api/cart/*            │Mongoose│ carts    │
│   • overrides 21 fns   │◀────────┤  /api/orders/*          │◀───────│ orders   │
│   • renders the cards  │         │  /api/admin/*  (guarded)│        │ wishlists│
└────────────────────────┘         └─────────────────────────┘        └──────────┘
```

**Authentication.** Login returns a JWT. `api.js` stores it in `localStorage` under
`asp_token` and sends it as `Authorization: Bearer <token>` on every protected call.
On page load it calls `GET /api/auth/me` to restore the session.

**Why the product cards still work.** `api.js` renders each card with the *same*
`data-*` attributes your original hardcoded cards had — `data-name`, `data-price`,
`data-top`, `data-heart` and so on. Your `openQuickView()` reads `card.dataset`, so it
never notices the cards now come from a database. One extra attribute was added,
`data-id`, holding the Mongo `_id`.

**Guest browsing.** Add to Cart works without logging in — items go to `localStorage`.
On login, `api.js` POSTs them to `/api/cart/merge` and clears the local copy. Checkout
requires an account, because an order needs an owner.

**What the client is trusted with.** Only the delivery address and the payment method.
Prices, line items and totals are all read server-side from the cart in MongoDB. The
browser cannot tell the server what it owes.

---

## 9. API reference

Base URL: `http://localhost:5000/api`
🔒 = requires `Authorization: Bearer <token>` · 👑 = requires an admin account

### Auth
| Method | Endpoint | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `{name, email, password, phone?}` | Password min 8 chars. A `role` field in the body is ignored. |
| POST | `/auth/login` | `{email, password}` | Returns `{token, user}` |
| GET | `/auth/me` 🔒 | — | Restores the session |
| PUT | `/auth/me` 🔒 | `{name?, phone?}` | |
| PUT | `/auth/me/password` 🔒 | `{currentPassword, newPassword}` | Returns a fresh token |

### Products (all public)
| Method | Endpoint | Notes |
|---|---|---|
| GET | `/products` | `?search= &category= &minPrice= &maxPrice= &sort= &page= &limit=` |
| GET | `/products/categories` | Category list with live counts |
| GET | `/products/:id` | Accepts a Mongo `_id` **or** a slug. Also returns 3 related items. |

`sort` accepts: `featured` (default), `newest`, `price_asc`, `price_desc`, `name`.

### Cart 🔒
| Method | Endpoint | Body |
|---|---|---|
| GET | `/cart` | — |
| POST | `/cart` | `{productId, quantity?}` |
| PUT | `/cart/:productId` | `{quantity}` — `0` removes the line |
| DELETE | `/cart/:productId` | — |
| DELETE | `/cart` | Empties the cart |
| POST | `/cart/merge` | `{items:[{productId, quantity}]}` |

Max 10 units per item. Totals are recomputed from live product prices on every request.

### Wishlist 🔒
| Method | Endpoint | Body |
|---|---|---|
| GET | `/wishlist` | — |
| POST | `/wishlist` | `{productId}` — idempotent |
| DELETE | `/wishlist/:productId` | — |
| POST | `/wishlist/merge` | `{productIds:[]}` |

### Orders 🔒
| Method | Endpoint | Body |
|---|---|---|
| POST | `/orders` | `{shipping{...}, payment{method, upiId\|last4\|bank}, pointsToRedeem?}` |
| GET | `/orders` | `?page= &limit=` |
| GET | `/orders/:id` | `_id` or the `ASP-...` id |
| PUT | `/orders/:id/cancel` | `{reason?}` |
| GET | `/orders/summary/points` | Feeds the points dashboard |

`payment.method` is `upi`, `card`, `netbank` or `cod`.
For `card`, send **`last4` only**. The API rejects a full card number.

Statuses: `Order Placed` → `Payment Verified` → `Being Packed` → `Shipped` →
`Out for Delivery` → `Delivered`, plus `Cancelled`. These match the `trackerSteps` array
already in your `index.html`.

### Contact
| Method | Endpoint | Body |
|---|---|---|
| POST | `/contact` | `{email, name?, phone?, subject?, message?, type?}` |

`type` is `contact`, `feedback` or `newsletter`. A logged-in user subscribing to the
newsletter earns 200 points, once.

### Admin 👑
| Method | Endpoint | Notes |
|---|---|---|
| GET | `/admin/stats` | Dashboard tiles |
| GET | `/admin/products` | Includes archived products |
| POST | `/admin/products` | Create |
| PUT | `/admin/products/:id` | Update (whitelisted fields only) |
| DELETE | `/admin/products/:id` | Archives. `?hard=true` deletes, but refuses if the product appears in any order. |
| GET | `/admin/orders` | `?status= &search= &page=` |
| PUT | `/admin/orders/:id/status` | `{status, note?}` |
| GET | `/admin/contacts` | `?type= &status=` |
| PUT | `/admin/contacts/:id` | `{status?, adminNote?}` |
| GET | `/admin/users` | Never returns password hashes |

### Payments (optional Razorpay)
| Method | Endpoint | Notes |
|---|---|---|
| GET | `/payments/config` | Public. Returns `{razorpayEnabled, keyId}` — the public key only. |
| POST | `/payments/create-order` 🔒 | Amount is computed server-side from your cart |
| POST | `/payments/verify` 🔒 | HMAC-SHA256 signature check |

Legacy aliases `/api/create-order` and `/api/verify-payment` also work — these are the
paths your original `index.html` was already calling.

---

## 10. Testing every endpoint

### Automated (recommended)

With the server running, in a second terminal:

```bash
cd backend
node seed/test-api.js
```

Roughly 55 assertions covering the whole customer journey and the admin surface. It also
tests things that **should fail**, which is the part that matters:

- registering with `"role":"admin"` in the body (privilege escalation)
- reading another user's order by changing the id in the URL (IDOR)
- a normal user calling `/admin/*`
- submitting a full card number
- ordering with an empty cart, negative quantities, quantity 99, a 2-digit pincode
- farming points by subscribing to the newsletter twice
- hard-deleting a product that appears in a past order

Run it right after `npm run seed` for a clean slate. Exit code is `0` if everything passes.

### Manual (curl)

```bash
# 1 — health
curl http://localhost:5000/api/health

# 2 — products
curl http://localhost:5000/api/products
curl "http://localhost:5000/api/products?search=oud"
curl "http://localhost:5000/api/products?category=Floral&sort=price_asc"

# 3 — register, capture the token
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","password":"TestPass123","phone":"9876543210"}'

TOKEN="paste_the_token_from_the_response"

# 4 — add to cart (use a real _id from step 2)
curl -X POST http://localhost:5000/api/cart \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"productId":"PASTE_PRODUCT_ID","quantity":2}'

curl http://localhost:5000/api/cart -H "Authorization: Bearer $TOKEN"

# 5 — checkout
curl -X POST http://localhost:5000/api/orders \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"shipping":{"name":"Test User","phone":"9876543210","email":"test@example.com",
       "address":"12 Anna Salai","city":"Chennai","state":"Tamil Nadu","pincode":"600002"},
       "payment":{"method":"upi","upiId":"test@upi"}}'

# 6 — order history
curl http://localhost:5000/api/orders -H "Authorization: Bearer $TOKEN"

# 7 — contact form
curl -X POST http://localhost:5000/api/contact \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","subject":"Hello","message":"Nice site","type":"feedback"}'

# 8 — admin
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@aspperfume.com","password":"YOUR_SEED_ADMIN_PASSWORD"}'

ADMIN="paste_the_admin_token"
curl http://localhost:5000/api/admin/stats  -H "Authorization: Bearer $ADMIN"
curl http://localhost:5000/api/admin/orders -H "Authorization: Bearer $ADMIN"
```

On Windows PowerShell use `Invoke-RestMethod` instead, or run these in Git Bash / WSL —
`curl` in PowerShell is an alias for `Invoke-WebRequest` and takes different flags.

### Through the browser

1. Open <http://localhost:5000> — six product cards should load from the database.
2. Click **Add to Cart** while logged out → the counter increments (guest cart).
3. Click **Account** → *Create Account* → register. Your guest cart carries over.
4. Click the ♡ on a card → it turns red and persists across a refresh.
5. **Cart** → fill in delivery → pay → an `ASP-...` order id appears.
6. **Orders** → your order is listed → **Track** shows the real status.
7. Open <http://localhost:5000/admin.html>, log in as admin, change that order to
   *Shipped*, then reload the storefront and check the tracker — it moves.

---

## 11. Admin dashboard

<http://localhost:5000/admin.html> — log in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

Five tabs: Dashboard (revenue, pending orders, low stock), Products (full add/edit/archive),
Orders (search, filter, change status), Messages (contact + feedback + newsletter),
Customers.

The login gate on that page is **convenience, not security**. Every request it makes goes
through `protect` + `adminOnly` on the server, so opening the URL directly or editing the
DOM gets you nothing without an admin token.

To promote an existing user to admin:

```bash
mongosh
use asp_perfume
db.users.updateOne({ email: "someone@example.com" }, { $set: { role: "admin" } })
```

---

## 12. Enabling real Razorpay payments (optional)

Your `index.html` already contained client-side Razorpay code. It was calling
`/api/create-order` and `/api/verify-payment`, which did not exist, so it silently fell
into its own demo mode. Those endpoints now exist and work properly.

To turn it on:

1. Sign up at <https://dashboard.razorpay.com>, go to **Settings → API Keys**.
2. Generate **test** keys (`rzp_test_...`) while developing.
3. Put both in `.env`:
   ```ini
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
   ```
4. Restart the server. `GET /api/payments/config` will now report `razorpayEnabled: true`.

With the keys blank, the simulated flow runs instead and the payment endpoints return a
clear 503 rather than half-working.

**Two bugs in the original client code were fixed server-side, and you should understand
both before shipping this.**

The old verification handler did:

```js
} catch(e){
  onSuccess(response); // allow if verify endpoint unreachable
}
```

If verification failed or the request errored, the order completed as paid anyway. Anyone
could block that one request in DevTools and take product for free. Verification now
happens server-side and an order is only marked paid on a valid HMAC signature, compared
with `crypto.timingSafeEqual`.

The old code also sent `amount` from the browser. The amount is now computed from your
cart in MongoDB; the client cannot influence what it is charged.

---

## 13. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `MONGO_URI is missing` | No `.env`. Copy `.env.example` to `.env`. |
| `Connection failed: ECONNREFUSED 127.0.0.1:27017` | MongoDB is not running. Start the service. |
| `Connection failed: bad auth` | Wrong Atlas password, or a special character that needs URL-encoding. |
| `JWT_SECRET is not set` | Fill it in and restart. Nodemon does not reload `.env` on its own. |
| Products never load, console shows a CORS error | The frontend origin is not in `CLIENT_URLS`. Add it and restart. |
| Products never load, console shows `file://` | Do not double-click `index.html`. Use `localhost:5000` or Live Server. |
| `Cannot reach the server` toast | Backend is not running, or is on a different port than 5000. |
| Everything 401s after working fine | Token expired (7 days by default). Log in again. |
| `EADDRINUSE :5000` | Something else has the port. Change `PORT` in `.env`, or kill it: `npx kill-port 5000`. |
| Admin login says "not an administrator" | You seeded without `SEED_ADMIN_PASSWORD`. Set it and re-run `npm run seed`. |
| `fetch is not defined` | Node 16 or older. Upgrade to Node 18+. |

---

## 14. Before you deploy

This is a working development build, not a hardened production one. At minimum:

- [ ] Set `NODE_ENV=production` — this stops stack traces being returned in errors
- [ ] Generate a **new** `JWT_SECRET` (never reuse the development one)
- [ ] Replace `0.0.0.0/0` in Atlas Network Access with your server's real IP
- [ ] Set `CLIENT_URLS` to your actual domain only
- [ ] Serve over HTTPS — a JWT sent over plain HTTP can be read in transit
- [ ] Switch Razorpay from `rzp_test_` to live keys
- [ ] Add `helmet` for security headers
- [ ] Set up scheduled database backups

Two known limitations worth being honest about:

**JWT in `localStorage` is readable by any JavaScript on the page.** That means an XSS
bug becomes a full account takeover. It is the standard approach for a project at this
stage and fine for now, but `httpOnly` cookies plus CSRF protection is the stronger
pattern once you have real customers.

**Stock decrements are not fully transactional.** `createOrder` decrements each product
with a conditional `$inc` and manually rolls back if a later one fails. That closes the
common race, but a crash mid-loop could still leave stock slightly off. Proper MongoDB
transactions need a replica set — Atlas gives you one by default, a standalone local
`mongod` does not.

---

## 15. Project structure

```
asp-perfume/
├── backend/
│   ├── server.js                 Express app, CORS, static hosting, route mounting
│   ├── package.json
│   ├── .env.example              Copy to .env — never commit the real one
│   ├── .gitignore
│   ├── config/
│   │   └── db.js                 MongoDB connection
│   ├── models/
│   │   ├── User.js               bcrypt hashing, points, addresses
│   │   ├── Product.js            Fields map 1:1 onto your data-* attributes
│   │   ├── Cart.js               One per user
│   │   ├── Wishlist.js           One per user
│   │   ├── Order.js              Denormalised line items, status history
│   │   └── Contact.js            Contact + feedback + newsletter
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── productController.js  toCardShape() — the frontend data contract
│   │   ├── cartController.js
│   │   ├── wishlistController.js
│   │   ├── orderController.js    Checkout, stock handling, points
│   │   ├── contactController.js
│   │   ├── adminController.js
│   │   └── paymentController.js  Optional Razorpay
│   ├── routes/                   One file per resource
│   ├── middleware/
│   │   ├── authMiddleware.js     protect · optionalAuth · adminOnly
│   │   └── errorHandler.js       Consistent JSON errors
│   ├── utils/
│   │   ├── asyncHandler.js
│   │   ├── generateToken.js
│   │   ├── ApiError.js
│   │   └── points.js             Loyalty rules in one place
│   └── seed/
│       ├── seed.js               npm run seed
│       └── test-api.js           node seed/test-api.js
└── frontend/
    ├── index.html                YOUR original file — 6 surgical edits
    ├── admin.html                New
    ├── js/
    │   └── api.js                New — all backend logic lives here
    └── images/                   Your uploads, wired to 3 new products
```

---

## 16. Exactly what changed in `index.html`

Six edits. **Your CSS was not touched — not one selector was modified.**

1. **Products grid emptied.** The three hardcoded `.product-card` divs were replaced with
   `<div class="products-grid" id="products-grid">`. `api.js` fills it with identical
   markup from the database.
2. **`const products` → `var products = {}`.** Was a hardcoded 3-entry price map.
3. **`const allProducts = [...]` → `var allProducts = []`.** Was a duplicate of the card
   data used only by search.
4. **Account link added** to `.nav-icons`.
5. **Feedback form added** inside `#contact`, styled to match the newsletter block.
6. **`<script src="js/api.js">`** added before `</body>`.

Plus one fix you should understand, because it will bite you again:

**Eleven globals were changed from `let`/`const` to `var`.** Top-level `let` and `const`
create *script-scoped* bindings — they do **not** become properties of `window`. So
`window.trackerSteps`, `window.currentQVCard` and `window.wishlist` were all `undefined`
when read from a separate file, and order tracking and the quick-view heart would have
failed silently with no console error. `var` does create window properties. The affected
declarations were `cartCount`, `products`, `cartItems`, `placedOrders`, `trackerSteps`,
`wishlist`, `currentQVCard`, `allProducts`, `memberEmail`, `memberPoints`, `pointsHistory`.

The legacy Razorpay `placeOrder` wrapper was renamed to `_legacyRazorpayPlaceOrder` and
left in place for reference. It is no longer called.

`api.js` overrides 21 of your existing functions rather than editing them, so all your
animations, overlays, parallax, particles, sparkles and heart bursts run exactly as before.

---

## 17. Seeded accounts

| Role | Email | Password |
|---|---|---|
| Admin | `SEED_ADMIN_EMAIL` from `.env` | `SEED_ADMIN_PASSWORD` from `.env` |
| Demo shopper | `demo@aspperfume.com` | `SEED_DEMO_PASSWORD` from `.env` |

The demo user starts with 600 points, enough to test redemption immediately.
Delete both before deploying anywhere public.
