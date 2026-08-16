/**
 * End-to-end API smoke test.
 *
 *   1. npm run seed          (fresh database)
 *   2. npm run dev           (server on :5000, leave running)
 *   3. node seed/test-api.js (in a second terminal)
 *
 * Walks the entire customer journey plus the admin surface and asserts
 * on every response. It also tries several things that SHOULD fail —
 * price tampering, reading another user's order, non-admin access to
 * admin routes — because a test suite that only tests the happy path
 * tells you nothing about whether your authorisation actually works.
 */

require('dotenv').config();

const BASE = `http://localhost:${process.env.PORT || 5000}/api`;

let pass = 0, fail = 0;
const ctx = {};

const c = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  d: (s) => `\x1b[2m${s}\x1b[0m`,
};

async function call(method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

async function test(label, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ${c.g('PASS')}  ${label}`);
  } catch (err) {
    fail++;
    console.log(`  ${c.r('FAIL')}  ${label}`);
    console.log(`        ${c.d(err.message)}`);
  }
}

function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

function section(name) {
  console.log(`\n${c.y('── ' + name + ' ' + '─'.repeat(Math.max(0, 52 - name.length)))}`);
}

(async function run() {
  console.log(`\n  Asp Perfume API test suite\n  Target: ${BASE}\n`);

  /* ── HEALTH & PRODUCTS ── */
  section('Health & Products');

  await test('GET /health responds', async () => {
    const r = await call('GET', '/health');
    expect(r.status === 200 && r.data.success, `got ${r.status}`);
  });

  await test('GET /products returns the seeded catalogue', async () => {
    const r = await call('GET', '/products');
    expect(r.status === 200, `got ${r.status}`);
    expect(r.data.products.length >= 3, `only ${r.data.products.length} products`);
    ctx.product = r.data.products[0];
    ctx.product2 = r.data.products[1];
  });

  await test('Product shape matches the frontend data-* contract', async () => {
    const p = ctx.product;
    for (const k of ['_id','name','size','price','img','desc','tag','top','heart','base',
                     'longevity','sillage','occasion','season','category']) {
      expect(k in p, `missing key: ${k}`);
    }
  });

  await test('GET /products/categories returns counts', async () => {
    const r = await call('GET', '/products/categories');
    expect(r.status === 200 && Array.isArray(r.data.categories), 'bad shape');
    expect(r.data.categories[0].name === 'All', 'first category should be All');
  });

  await test('GET /products?search= filters results', async () => {
    const r = await call('GET', '/products?search=rose');
    expect(r.status === 200, `got ${r.status}`);
    expect(r.data.products.every(p => JSON.stringify(p).toLowerCase().includes('rose')),
      'search returned an unrelated product');
  });

  await test('GET /products/:id works by id AND by slug', async () => {
    const byId = await call('GET', `/products/${ctx.product._id}`);
    const bySlug = await call('GET', `/products/${ctx.product.slug || ctx.product.name.toLowerCase().replace(/\s+/g,'-')}`);
    expect(byId.status === 200, `id lookup got ${byId.status}`);
    expect(bySlug.status === 200, `slug lookup got ${bySlug.status}`);
  });

  await test('GET /products/:id with a bad id returns 400, not 500', async () => {
    const r = await call('GET', '/products/not-a-real-id');
    expect(r.status === 400 || r.status === 404, `got ${r.status}`);
  });

  /* ── AUTH ── */
  section('Authentication');

  const email = `test${Date.now()}@example.com`;
  const password = 'TestPass123!';

  await test('POST /auth/register creates an account', async () => {
    const r = await call('POST', '/auth/register', {
      body: { name: 'Test Shopper', email, password, phone: '9876543210' },
    });
    expect(r.status === 201, `got ${r.status}: ${r.data.message}`);
    expect(r.data.token, 'no token returned');
    ctx.token = r.data.token;
    ctx.userId = r.data.user._id;
  });

  await test('Register never returns the password hash', async () => {
    const r = await call('GET', '/auth/me', { token: ctx.token });
    expect(!('password' in r.data.user), 'password field leaked');
  });

  await test('Duplicate email is rejected with 409', async () => {
    const r = await call('POST', '/auth/register', { body: { name: 'X', email, password } });
    expect(r.status === 409, `got ${r.status}`);
  });

  await test('Short password is rejected', async () => {
    const r = await call('POST', '/auth/register', {
      body: { name: 'X', email: `s${Date.now()}@e.com`, password: 'abc' },
    });
    expect(r.status === 400, `got ${r.status}`);
  });

  await test('Self-assigned admin role is IGNORED (privilege escalation)', async () => {
    const e2 = `esc${Date.now()}@example.com`;
    const r = await call('POST', '/auth/register', {
      body: { name: 'Sneaky', email: e2, password, role: 'admin' },
    });
    expect(r.status === 201, `got ${r.status}`);
    expect(r.data.user.role === 'user', `role became "${r.data.user.role}"`);
  });

  await test('Wrong password is rejected with 401', async () => {
    const r = await call('POST', '/auth/login', { body: { email, password: 'wrong-password' } });
    expect(r.status === 401, `got ${r.status}`);
  });

  await test('Login and unknown-email errors are indistinguishable', async () => {
    const a = await call('POST', '/auth/login', { body: { email, password: 'wrong' } });
    const b = await call('POST', '/auth/login', { body: { email: 'nobody@nowhere.com', password: 'wrong' } });
    expect(a.data.message === b.data.message, 'error messages differ — allows email enumeration');
  });

  await test('POST /auth/login returns a working token', async () => {
    const r = await call('POST', '/auth/login', { body: { email, password } });
    expect(r.status === 200 && r.data.token, `got ${r.status}`);
    ctx.token = r.data.token;
  });

  await test('Protected route without a token returns 401', async () => {
    const r = await call('GET', '/cart');
    expect(r.status === 401, `got ${r.status}`);
  });

  await test('Protected route with a garbage token returns 401', async () => {
    const r = await call('GET', '/cart', { token: 'obviously.not.a.jwt' });
    expect(r.status === 401, `got ${r.status}`);
  });

  /* ── CART ── */
  section('Cart');

  await test('GET /cart starts empty', async () => {
    const r = await call('GET', '/cart', { token: ctx.token });
    expect(r.status === 200 && r.data.cart.items.length === 0, 'cart not empty');
  });

  await test('POST /cart adds an item', async () => {
    const r = await call('POST', '/cart', {
      token: ctx.token, body: { productId: ctx.product._id, quantity: 2 },
    });
    expect(r.status === 201, `got ${r.status}: ${r.data.message}`);
    expect(r.data.cart.totalQuantity === 2, `qty is ${r.data.cart.totalQuantity}`);
  });

  await test('Adding the same product again increments, not duplicates', async () => {
    const r = await call('POST', '/cart', {
      token: ctx.token, body: { productId: ctx.product._id, quantity: 1 },
    });
    expect(r.data.cart.items.length === 1, `${r.data.cart.items.length} lines`);
    expect(r.data.cart.totalQuantity === 3, `qty is ${r.data.cart.totalQuantity}`);
  });

  await test('Cart total is computed server-side and is correct', async () => {
    const r = await call('GET', '/cart', { token: ctx.token });
    expect(r.data.cart.itemsTotal === ctx.product.price * 3,
      `${r.data.cart.itemsTotal} != ${ctx.product.price * 3}`);
  });

  await test('PUT /cart/:id changes quantity', async () => {
    const r = await call('PUT', `/cart/${ctx.product._id}`, {
      token: ctx.token, body: { quantity: 1 },
    });
    expect(r.data.cart.totalQuantity === 1, `qty is ${r.data.cart.totalQuantity}`);
  });

  await test('Quantity over the 10-unit cap is rejected', async () => {
    const r = await call('PUT', `/cart/${ctx.product._id}`, {
      token: ctx.token, body: { quantity: 99 },
    });
    expect(r.status === 400, `got ${r.status}`);
  });

  await test('Negative quantity is rejected', async () => {
    const r = await call('PUT', `/cart/${ctx.product._id}`, {
      token: ctx.token, body: { quantity: -5 },
    });
    expect(r.status === 400, `got ${r.status}`);
  });

  await test('DELETE /cart/:id removes a line', async () => {
    await call('POST', '/cart', { token: ctx.token, body: { productId: ctx.product2._id } });
    const r = await call('DELETE', `/cart/${ctx.product2._id}`, { token: ctx.token });
    expect(r.status === 200, `got ${r.status}`);
    expect(r.data.cart.items.length === 1, `${r.data.cart.items.length} lines left`);
  });

  await test('POST /cart/merge folds in a guest cart', async () => {
    const r = await call('POST', '/cart/merge', {
      token: ctx.token, body: { items: [{ productId: ctx.product2._id, quantity: 2 }] },
    });
    expect(r.status === 200 && r.data.cart.items.length === 2, 'merge did not add the item');
  });

  await test('Merge tolerates an invalid product id without failing', async () => {
    const r = await call('POST', '/cart/merge', {
      token: ctx.token, body: { items: [{ productId: '507f1f77bcf86cd799439011', quantity: 1 }] },
    });
    expect(r.status === 200, `got ${r.status} — a dead guest item should not break login`);
  });

  /* ── WISHLIST ── */
  section('Wishlist');

  await test('POST /wishlist saves a product', async () => {
    const r = await call('POST', '/wishlist', {
      token: ctx.token, body: { productId: ctx.product._id },
    });
    expect(r.status === 201 && r.data.wishlist.count === 1, `got ${r.status}`);
  });

  await test('Adding twice is idempotent, not an error', async () => {
    const r = await call('POST', '/wishlist', {
      token: ctx.token, body: { productId: ctx.product._id },
    });
    expect(r.status === 200 && r.data.wishlist.count === 1, `count is ${r.data.wishlist.count}`);
  });

  await test('DELETE /wishlist/:id removes it', async () => {
    const r = await call('DELETE', `/wishlist/${ctx.product._id}`, { token: ctx.token });
    expect(r.status === 200 && r.data.wishlist.count === 0, `count is ${r.data.wishlist.count}`);
  });

  /* ── ORDERS ── */
  section('Orders & Checkout');

  const shipping = {
    name: 'Test Shopper', phone: '9876543210', email,
    address: '12 Anna Salai', city: 'Chennai', state: 'Tamil Nadu', pincode: '600002',
  };

  await test('Order with an invalid pincode is rejected', async () => {
    const r = await call('POST', '/orders', {
      token: ctx.token,
      body: { shipping: { ...shipping, pincode: '12' }, payment: { method: 'upi', upiId: 'test@upi' } },
    });
    expect(r.status === 400, `got ${r.status}`);
  });

  await test('Order with a full card number is REJECTED (PCI)', async () => {
    const r = await call('POST', '/orders', {
      token: ctx.token,
      body: { shipping, payment: { method: 'card', last4: '4111111111111111' } },
    });
    expect(r.status === 400, `got ${r.status} — the API accepted a full PAN`);
  });

  await test('POST /orders creates an order from the SERVER-side cart', async () => {
    const r = await call('POST', '/orders', {
      token: ctx.token,
      body: { shipping, payment: { method: 'upi', upiId: 'test@upi' } },
    });
    expect(r.status === 201, `got ${r.status}: ${r.data.message}`);
    expect(/^ASP-/.test(r.data.order.orderId), `bad order id ${r.data.order.orderId}`);
    ctx.order = r.data.order;
  });

  await test('Order total = items − points + shipping', async () => {
    const o = ctx.order;
    expect(o.grandTotal === o.itemsTotal - o.pointsDiscount + o.shippingFee,
      `${o.grandTotal} != ${o.itemsTotal} - ${o.pointsDiscount} + ${o.shippingFee}`);
  });

  await test('Cart is emptied after a successful order', async () => {
    const r = await call('GET', '/cart', { token: ctx.token });
    expect(r.data.cart.items.length === 0, `${r.data.cart.items.length} items remain`);
  });

  await test('Stock was decremented by the ordered quantity', async () => {
    const r = await call('GET', `/products/${ctx.product._id}`);
    const ordered = ctx.order.items.find(i => i.name === ctx.product.name);
    expect(r.data.product.stock === ctx.product.stock - ordered.quantity,
      `stock ${r.data.product.stock}, expected ${ctx.product.stock - ordered.quantity}`);
  });

  await test('Ordering with an empty cart is rejected', async () => {
    const r = await call('POST', '/orders', {
      token: ctx.token, body: { shipping, payment: { method: 'upi', upiId: 'test@upi' } },
    });
    expect(r.status === 400, `got ${r.status}`);
  });

  await test('GET /orders returns the history', async () => {
    const r = await call('GET', '/orders', { token: ctx.token });
    expect(r.status === 200 && r.data.orders.length >= 1, 'no orders returned');
  });

  await test('GET /orders/:orderId works with the ASP- id', async () => {
    const r = await call('GET', `/orders/${ctx.order.orderId}`, { token: ctx.token });
    expect(r.status === 200, `got ${r.status}`);
  });

  await test("Another user CANNOT read this user's order", async () => {
    const other = `other${Date.now()}@example.com`;
    const reg = await call('POST', '/auth/register', {
      body: { name: 'Other Person', email: other, password },
    });
    ctx.otherToken = reg.data.token;
    const r = await call('GET', `/orders/${ctx.order.orderId}`, { token: ctx.otherToken });
    expect(r.status === 403, `got ${r.status} — IDOR: order data leaked to another account`);
  });

  await test('PUT /orders/:id/cancel cancels and restores stock', async () => {
    const before = await call('GET', `/products/${ctx.product._id}`);
    const r = await call('PUT', `/orders/${ctx.order.orderId}/cancel`, { token: ctx.token });
    expect(r.status === 200 && r.data.order.status === 'Cancelled', `got ${r.status}`);
    const after = await call('GET', `/products/${ctx.product._id}`);
    expect(after.data.product.stock > before.data.product.stock, 'stock was not restored');
  });

  await test('Cancelling an already-cancelled order is rejected', async () => {
    const r = await call('PUT', `/orders/${ctx.order.orderId}/cancel`, { token: ctx.token });
    expect(r.status === 400, `got ${r.status}`);
  });

  /* ── CONTACT ── */
  section('Contact & Feedback');

  await test('POST /contact accepts feedback', async () => {
    const r = await call('POST', '/contact', {
      body: { name: 'Test', email, subject: 'Great site', message: 'Loved the packaging.', type: 'feedback' },
    });
    expect(r.status === 201, `got ${r.status}`);
  });

  await test('Feedback without a message is rejected', async () => {
    const r = await call('POST', '/contact', { body: { email, type: 'feedback' } });
    expect(r.status === 400, `got ${r.status}`);
  });

  await test('Newsletter signup awards 200 points once', async () => {
    const a = await call('POST', '/contact', {
      token: ctx.token, body: { email, type: 'newsletter' },
    });
    expect(a.data.pointsAwarded === 200, `awarded ${a.data.pointsAwarded}`);
    const b = await call('POST', '/contact', {
      token: ctx.token, body: { email, type: 'newsletter' },
    });
    expect(b.data.pointsAwarded === 0, 'points can be farmed by re-subscribing');
  });

  /* ── ADMIN ── */
  section('Admin');

  await test('Non-admin is blocked from /admin/* with 403', async () => {
    const r = await call('GET', '/admin/stats', { token: ctx.token });
    expect(r.status === 403, `got ${r.status} — a normal user reached an admin route`);
  });

  await test('Admin can log in', async () => {
    const r = await call('POST', '/auth/login', {
      body: { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD },
    });
    expect(r.status === 200, `got ${r.status} — check SEED_ADMIN_* in .env and re-run the seed`);
    expect(r.data.user.role === 'admin', `role is ${r.data.user.role}`);
    ctx.adminToken = r.data.token;
  });

  await test('GET /admin/stats returns the dashboard figures', async () => {
    const r = await call('GET', '/admin/stats', { token: ctx.adminToken });
    expect(r.status === 200 && typeof r.data.stats.revenue === 'number', 'bad shape');
  });

  await test('POST /admin/products creates a product', async () => {
    const r = await call('POST', '/admin/products', {
      token: ctx.adminToken,
      body: {
        name: `Test Fragrance ${Date.now()}`, description: 'A test scent.',
        price: 999, image: 'https://example.com/x.jpg', category: 'Fresh', stock: 5,
      },
    });
    expect(r.status === 201, `got ${r.status}: ${r.data.message}`);
    ctx.newProductId = r.data.product._id;
  });

  await test('PUT /admin/products/:id updates it', async () => {
    const r = await call('PUT', `/admin/products/${ctx.newProductId}`, {
      token: ctx.adminToken, body: { price: 1299, stock: 20 },
    });
    expect(r.status === 200 && r.data.product.price === 1299, `price is ${r.data.product?.price}`);
  });

  await test('DELETE archives (soft delete) by default', async () => {
    const r = await call('DELETE', `/admin/products/${ctx.newProductId}`, { token: ctx.adminToken });
    expect(r.status === 200 && r.data.product.isActive === false, 'not archived');
  });

  await test('An archived product disappears from the public catalogue', async () => {
    const r = await call('GET', '/products');
    expect(!r.data.products.some(p => p._id === ctx.newProductId), 'archived product still public');
  });

  await test('Hard-delete is blocked for a product with order history', async () => {
    const ordered = ctx.order.items[0].product;
    const r = await call('DELETE', `/admin/products/${ordered}?hard=true`, { token: ctx.adminToken });
    expect(r.status === 409, `got ${r.status} — hard delete would orphan past orders`);
  });

  await test('GET /admin/orders lists all orders', async () => {
    const r = await call('GET', '/admin/orders', { token: ctx.adminToken });
    expect(r.status === 200 && Array.isArray(r.data.orders), 'bad shape');
    ctx.adminOrderId = r.data.orders[0]?._id;
  });

  await test('PUT /admin/orders/:id/status advances an order', async () => {
    const r = await call('PUT', `/admin/orders/${ctx.adminOrderId}/status`, {
      token: ctx.adminToken, body: { status: 'Shipped', note: 'Handed to courier' },
    });
    expect(r.status === 200 && r.data.order.status === 'Shipped', `status is ${r.data.order?.status}`);
  });

  await test('An invalid status value is rejected', async () => {
    const r = await call('PUT', `/admin/orders/${ctx.adminOrderId}/status`, {
      token: ctx.adminToken, body: { status: 'Teleported' },
    });
    expect(r.status === 400, `got ${r.status}`);
  });

  await test('GET /admin/contacts lists submissions', async () => {
    const r = await call('GET', '/admin/contacts', { token: ctx.adminToken });
    expect(r.status === 200 && r.data.contacts.length >= 1, 'no contacts');
  });

  await test('GET /admin/users lists customers without password hashes', async () => {
    const r = await call('GET', '/admin/users', { token: ctx.adminToken });
    expect(r.status === 200, `got ${r.status}`);
    expect(r.data.users.every(u => !('password' in u)), 'password hash leaked in user list');
  });

  /* ── SUMMARY ── */
  console.log(`\n${'─'.repeat(58)}`);
  console.log(`  ${c.g(pass + ' passed')}   ${fail ? c.r(fail + ' failed') : c.d('0 failed')}   of ${pass + fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(`\n  ${c.r('Suite crashed:')} ${err.message}`);
  console.error(`  ${c.d('Is the server running?  npm run dev')}\n`);
  process.exit(1);
});
