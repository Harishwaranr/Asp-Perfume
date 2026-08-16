/* ══════════════════════════════════════════════════════════════════════
   ASP PERFUME — BACKEND INTEGRATION LAYER
   ══════════════════════════════════════════════════════════════════════

   This file is loaded LAST, after all the original inline scripts. That
   ordering is what makes the whole approach work: the original file
   declares its functions with `function foo(){}`, which puts them on
   `window`. Reassigning `window.foo` here replaces the demo behaviour
   with a server-backed version, while leaving every piece of markup,
   CSS and animation in index.html completely untouched.

   Functions overridden below:
     updateCartDisplay, openCart, renderOrderSummary, showPage,
     goToPayment, placeOrder, openOrders, renderOrdersList, openTracker,
     toggleWishlist, updateWishlistLink, renderWishlist,
     addToCartFromWishlist, removeFromWishlist, openWishlist,
     runSearch, openQuickViewByName, toggleWishlistFromQV,
     handleSubscribe, openPointsDashboard, updatePointsToggleDisplay

   Functions added:
     openAuth, submitFeedback
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ─────────────────────────  CONFIG  ───────────────────────── */

  // If the page is served by the Express server itself, use a relative
  // path. Otherwise (Live Server on :5500) point at the API's own port.
  const API_BASE =
    window.location.port === '5000' || window.location.port === ''
      ? '/api'
      : 'http://localhost:5000/api';

  const TOKEN_KEY = 'asp_token';
  const GUEST_CART_KEY = 'asp_guest_cart';
  const GUEST_WISH_KEY = 'asp_guest_wishlist';

  const MIN_REDEEM_POINTS = 500;
  const POINT_VALUE = 0.1;

  /* ─────────────────────────  STATE  ───────────────────────── */

  const state = {
    user: null,
    catalogue: [],      // full product list from the API
    cart: { items: [], itemsTotal: 0, totalQuantity: 0 },
    orders: [],
    pointsRedeeming: 0,
  };

  const rupee = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const token = {
    get: () => localStorage.getItem(TOKEN_KEY),
    set: (t) => localStorage.setItem(TOKEN_KEY, t),
    clear: () => localStorage.removeItem(TOKEN_KEY),
  };
  const isLoggedIn = () => Boolean(state.user);

  /* ─────────────────────────  HTTP  ───────────────────────── */

  /**
   * Thin fetch wrapper. Attaches the JWT, parses JSON, and turns any
   * non-2xx response into a thrown Error carrying the server's message
   * so every caller can just try/catch and show err.message.
   */
  async function api(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const t = token.get();
    if (auth && t) headers.Authorization = `Bearer ${t}`;

    let res;
    try {
      res = await fetch(API_BASE + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
      throw new Error('Cannot reach the server. Is the backend running on port 5000?');
    }

    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      /* empty or non-JSON body */
    }

    if (!res.ok) {
      // A 401 means the token is dead — clear it so the UI drops back
      // to the logged-out state instead of retrying forever.
      if (res.status === 401 && auth) {
        token.clear();
        state.user = null;
        renderAccountLink();
      }
      const err = new Error(data.message || `Request failed (${res.status})`);
      err.status = res.status;
      err.errors = data.errors;
      throw err;
    }

    return data;
  }

  /* ─────────────────────────  TOAST  ───────────────────────── */

  function toast(message, type = 'info') {
    let host = document.getElementById('asp-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'asp-toast-host';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'asp-toast asp-toast-' + type;
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 3600);
  }

  /* ═══════════════════  GUEST CART / WISHLIST  ═══════════════════

     Browsing visitors are not forced to log in. Their picks live in
     localStorage as [{productId, quantity}] and are POSTed to
     /api/cart/merge the moment they authenticate. Checkout still
     requires an account, because an order needs an owner.
     ═══════════════════════════════════════════════════════════════ */

  const guest = {
    cart: {
      read() {
        try { return JSON.parse(localStorage.getItem(GUEST_CART_KEY)) || []; }
        catch (_) { return []; }
      },
      write(items) { localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items)); },
      add(productId, qty = 1) {
        const items = guest.cart.read();
        const line = items.find((i) => i.productId === productId);
        if (line) line.quantity = Math.min(10, line.quantity + qty);
        else items.push({ productId, quantity: qty });
        guest.cart.write(items);
      },
      set(productId, qty) {
        let items = guest.cart.read();
        if (qty <= 0) items = items.filter((i) => i.productId !== productId);
        else {
          const line = items.find((i) => i.productId === productId);
          if (line) line.quantity = qty;
        }
        guest.cart.write(items);
      },
      clear() { localStorage.removeItem(GUEST_CART_KEY); },
    },
    wish: {
      read() {
        try { return JSON.parse(localStorage.getItem(GUEST_WISH_KEY)) || []; }
        catch (_) { return []; }
      },
      write(ids) { localStorage.setItem(GUEST_WISH_KEY, JSON.stringify(ids)); },
      toggle(productId) {
        const ids = guest.wish.read();
        const i = ids.indexOf(productId);
        if (i >= 0) ids.splice(i, 1); else ids.push(productId);
        guest.wish.write(ids);
        return i < 0; // true when it was added
      },
      clear() { localStorage.removeItem(GUEST_WISH_KEY); },
    },
  };

  /** Rebuilds state.cart from localStorage using the loaded catalogue. */
  function buildGuestCartState() {
    const lines = guest.cart.read();
    const items = [];
    let itemsTotal = 0;
    let totalQuantity = 0;

    for (const line of lines) {
      const p = state.catalogue.find((c) => c._id === line.productId);
      if (!p) continue;
      const subtotal = p.price * line.quantity;
      itemsTotal += subtotal;
      totalQuantity += line.quantity;
      items.push({ product: p, quantity: line.quantity, subtotal, inStock: p.stock >= line.quantity });
    }
    state.cart = { items, itemsTotal, totalQuantity, count: items.length };
  }

  /* ═══════════════════════  PRODUCTS  ═══════════════════════ */

  /**
   * Renders one product card. The markup here is a faithful copy of the
   * original hardcoded card, including every data-* attribute — which is
   * precisely why openQuickView() and toggleWishlist() keep working
   * without a single change to them.
   */
  function productCardHTML(p, index) {
    const delay = index > 0 ? ` style="transition-delay:.${index}s"` : '';
    const tagBadge = p.tag ? `<span class="product-tag">${escapeHTML(p.tag)}</span>` : '';
    const soldOut = !p.inStock;

    return `
  <div class="product-card reveal"${delay}
       data-id="${p._id}"
       data-name="${escapeHTML(p.name)}"
       data-size="${escapeHTML(p.size)}"
       data-price="${p.price}"
       data-tag="${escapeHTML(p.tag || '')}"
       data-img="${escapeHTML(p.img)}"
       data-top="${escapeHTML(p.top)}"
       data-heart="${escapeHTML(p.heart)}"
       data-base="${escapeHTML(p.base)}"
       data-desc="${escapeHTML(p.desc)}"
       data-longevity="${escapeHTML(p.longevity)}"
       data-sillage="${escapeHTML(p.sillage)}"
       data-occasion="${escapeHTML(p.occasion)}"
       data-season="${escapeHTML(p.season)}">
    <div class="product-img">
      ${tagBadge}
      <img src="${escapeHTML(p.img)}" alt="${escapeHTML(p.name)}" loading="lazy"/>
      <div class="product-overlay"></div>
      <button class="quick-view" onclick="openQuickView(this.closest('.product-card'))">Quick View</button>
      <button class="wish-heart" onclick="toggleWishlist(this)" aria-label="Add to wishlist">♡</button>
    </div>
    <div class="product-body">
      <div class="product-meta">
        <div class="product-name">${escapeHTML(p.name)}</div>
        <div class="product-size">${escapeHTML(p.size)}</div>
      </div>
      <p class="product-desc">${escapeHTML(p.desc)}</p>
      <div class="product-footer">
        <div class="product-price">${rupee(p.price)}</div>
        <button class="add-btn"${soldOut ? ' disabled style="opacity:.45;cursor:not-allowed"' : ''}>
          ${soldOut ? 'Sold Out' : 'Add to Cart'}
        </button>
      </div>
    </div>
  </div>`;
  }

  function escapeHTML(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async function loadProducts() {
    const grid = document.getElementById('products-grid');
    try {
      const data = await api('/products?limit=50', { auth: false });
      state.catalogue = data.products;

      // Keep the original globals in sync so any code still referencing
      // them (search, quick view fallbacks) continues to work.
      window.allProducts = data.products;
      window.products = {};
      data.products.forEach((p) => {
        window.products[p.name] = { price: p.price, size: p.size, _id: p._id };
      });

      if (!data.products.length) {
        grid.innerHTML = '<div class="asp-grid-loading">No fragrances available yet.</div>';
        return;
      }

      grid.innerHTML = data.products.map(productCardHTML).join('');

      // The original IntersectionObserver only saw elements present at
      // load. These cards arrived later, so reveal them explicitly.
      requestAnimationFrame(() => {
        grid.querySelectorAll('.reveal').forEach((el) => el.classList.add('active'));
      });

      paintWishHearts();
    } catch (err) {
      grid.innerHTML =
        `<div class="asp-grid-loading">Could not load the collection.<br>
         <small>${escapeHTML(err.message)}</small></div>`;
    }
  }

  /* ═══════════════════════  CART  ═══════════════════════ */

  async function refreshCart() {
    if (isLoggedIn()) {
      const data = await api('/cart');
      state.cart = data.cart;
      if (data.cart.removedItems && data.cart.removedItems.length) {
        toast(`${data.cart.removedItems.join(', ')} is no longer available and was removed.`, 'warn');
      }
    } else {
      buildGuestCartState();
    }
    window.updateCartDisplay();
  }

  async function addToCart(productId, name) {
    if (isLoggedIn()) {
      const data = await api('/cart', { method: 'POST', body: { productId, quantity: 1 } });
      state.cart = data.cart;
    } else {
      guest.cart.add(productId, 1);
      buildGuestCartState();
    }
    window.updateCartDisplay();
    toast(`${name} added to your cart.`, 'success');
  }

  async function setCartQty(productId, quantity) {
    if (isLoggedIn()) {
      const data = await api(`/cart/${productId}`, { method: 'PUT', body: { quantity } });
      state.cart = data.cart;
    } else {
      guest.cart.set(productId, quantity);
      buildGuestCartState();
    }
    window.updateCartDisplay();
    window.renderOrderSummary();
  }

  // Event delegation — the original code bound listeners to .add-btn at
  // parse time, but our cards are injected later, so those bindings
  // would never fire. Delegating from document catches every future card.
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.add-btn');
    if (!btn || btn.disabled) return;

    const card = btn.closest('.product-card');
    if (!card) return;

    const productId = card.dataset.id;
    const name = card.dataset.name;
    const original = btn.textContent;

    btn.disabled = true;
    try {
      await addToCart(productId, name);
      btn.textContent = 'Added ✓';
      btn.style.background = 'var(--purple)';
      btn.style.color = '#fff';
      setTimeout(() => {
        btn.textContent = original.trim();
        btn.style.background = '';
        btn.style.color = '';
        btn.disabled = false;
      }, 1600);
    } catch (err) {
      toast(err.message, 'error');
      btn.textContent = original.trim();
      btn.disabled = false;
    }
  });

  window.updateCartDisplay = function () {
    const link = document.getElementById('cart-link');
    if (link) link.textContent = `Cart (${state.cart.totalQuantity || 0})`;
  };

  window.openCart = function (e) {
    if (e) e.preventDefault();
    if (!state.cart.totalQuantity) {
      toast('Your cart is empty — add some fragrances first.', 'info');
      return;
    }
    window.showPage('delivery-page');
    window.renderOrderSummary();
    prefillDelivery();
  };

  /**
   * Renders the order summary into BOTH summary containers, with
   * quantity steppers. Totals mirror the server's rules exactly
   * (free shipping over ₹1,500, else ₹99) so the figure the customer
   * sees matches the figure the server bills.
   */
  window.renderOrderSummary = function () {
    let html = '';
    let itemsTotal = 0;

    for (const line of state.cart.items) {
      const p = line.product;
      itemsTotal += line.subtotal;
      html += `
        <div class="co-item">
          <span>${escapeHTML(p.name)} (${escapeHTML(p.size)})</span>
          <span class="asp-qty">
            <button onclick="aspSetQty('${p._id}',${line.quantity - 1})" aria-label="Decrease">−</button>
            <b>${line.quantity}</b>
            <button onclick="aspSetQty('${p._id}',${line.quantity + 1})" aria-label="Increase">+</button>
            <span class="asp-line-total">${rupee(line.subtotal)}</span>
          </span>
        </div>`;
    }

    const shippingFee = itemsTotal >= 1500 ? 0 : 99;
    const discount = state.pointsRedeeming
      ? Math.min(state.pointsRedeeming * POINT_VALUE, itemsTotal)
      : 0;
    const grand = Math.max(0, itemsTotal - discount + shippingFee);

    html += `<div class="co-item"><span>Subtotal</span><span>${rupee(itemsTotal)}</span></div>`;
    html += `<div class="co-item"><span>Shipping</span><span>${
      shippingFee === 0 ? 'FREE' : rupee(shippingFee)
    }</span></div>`;
    if (discount > 0) {
      html += `<div class="co-item" style="color:#27ae60"><span>Points discount (${
        state.pointsRedeeming
      } pts)</span><span>− ${rupee(discount)}</span></div>`;
    }
    html += `<div class="co-total"><span>Total</span><span>${rupee(grand)}</span></div>`;

    const a = document.getElementById('order-summary');
    const b = document.getElementById('order-summary-pay');
    if (a) a.innerHTML = html;
    if (b) b.innerHTML = html;
  };

  window.aspSetQty = async function (productId, quantity) {
    try {
      await setCartQty(productId, Math.max(0, quantity));
      if (!state.cart.totalQuantity) {
        window.closeCo();
        toast('Your cart is now empty.', 'info');
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  /** Pre-fills delivery fields from the logged-in profile. */
  function prefillDelivery() {
    if (!state.user) return;
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el && !el.value && val) el.value = val;
    };
    set('co-name', state.user.name);
    set('co-email', state.user.email);
    set('co-phone', state.user.phone);
  }

  /* ═══════════════════════  CHECKOUT  ═══════════════════════ */

  /**
   * Full replacement for showPage. The original had two stacked wrappers:
   * one generated a fake order on the success page, the other refreshed
   * the points toggle. Order creation now happens server-side in
   * placeOrder(), so this version only handles titles and effects.
   */
  window.showPage = function (id) {
    document.querySelectorAll('.co-page').forEach((p) => (p.style.display = 'none'));
    document.getElementById('co-overlay').style.display = 'flex';
    const page = document.getElementById(id);
    if (page) page.style.display = 'block';

    const title = document.getElementById('co-title');
    const step = document.getElementById('co-step-label');

    if (id === 'delivery-page') {
      title.textContent = 'Delivery Details';
      step.textContent = 'Step 1 of 2';
    } else if (id === 'payment-page') {
      title.textContent = 'Payment';
      step.textContent = 'Step 2 of 2';
      if (typeof window.injectPointsToggle === 'function') window.injectPointsToggle();
      setTimeout(window.updatePointsToggleDisplay, 50);
    } else if (id === 'success-page') {
      title.textContent = 'Order Confirmed';
      step.textContent = 'Done!';
      if (typeof window.launchSparkles === 'function') setTimeout(window.launchSparkles, 100);
    }
  };

  window.goToPayment = function () {
    const fields = ['co-name', 'co-phone', 'co-email', 'co-addr', 'co-city', 'co-pin', 'co-state'];
    for (const id of fields) {
      const el = document.getElementById(id);
      if (!el.value.trim()) {
        el.focus();
        el.style.borderColor = '#e74c3c';
        toast('Please fill in all delivery fields.', 'warn');
        return;
      }
      el.style.borderColor = '';
    }
    if (!/^[6-9]\d{9}$/.test(document.getElementById('co-phone').value.trim())) {
      toast('Please enter a valid 10-digit Indian mobile number.', 'warn');
      document.getElementById('co-phone').focus();
      return;
    }
    if (!/\S+@\S+\.\S+/.test(document.getElementById('co-email').value.trim())) {
      toast('Please enter a valid email address.', 'warn');
      document.getElementById('co-email').focus();
      return;
    }
    if (!/^\d{6}$/.test(document.getElementById('co-pin').value.trim())) {
      toast('Please enter a valid 6-digit pincode.', 'warn');
      document.getElementById('co-pin').focus();
      return;
    }

    window.showPage('payment-page');
    window.renderOrderSummary();
    window.switchPayTab('upi');
  };

  /**
   * Creates a real order via POST /api/orders.
   *
   * Note what is NOT sent: no prices, no line items, no totals. The server
   * reads all of that from the user's cart in the database. The client only
   * supplies the address and the payment method. Only the card's last four
   * digits ever leave the browser — the full number and CVV are validated
   * locally and then discarded.
   */
  window.placeOrder = async function () {
    if (!isLoggedIn()) {
      toast('Please log in to complete your order.', 'warn');
      window.closeCo();
      openAuthModal('login');
      return;
    }

    const tab = document.querySelector('.pay-tab.active').dataset.tab;
    const payment = { method: tab };

    if (tab === 'upi') {
      const upi = document.getElementById('upi-id').value.trim();
      if (!upi || !upi.includes('@')) { toast('Enter a valid UPI ID, e.g. name@upi', 'warn'); return; }
      payment.upiId = upi;
    } else if (tab === 'card') {
      const num = document.getElementById('card-num').value.replace(/\s/g, '');
      const exp = document.getElementById('card-exp').value.trim();
      const cvv = document.getElementById('card-cvv').value.trim();
      const nm = document.getElementById('card-name').value.trim();
      if (num.length < 16) { toast('Enter a valid 16-digit card number', 'warn'); return; }
      if (!/^\d{2}\/\d{2}$/.test(exp)) { toast('Enter expiry as MM/YY', 'warn'); return; }
      if (cvv.length < 3) { toast('Enter a valid CVV', 'warn'); return; }
      if (!nm) { toast('Enter the name on the card', 'warn'); return; }
      payment.last4 = num.slice(-4); // only this is transmitted
    } else if (tab === 'netbank') {
      const bank = document.getElementById('nb-bank').value;
      if (!bank) { toast('Please select a bank', 'warn'); return; }
      payment.bank = bank;
    }

    const btn = document.querySelector('#payment-page .co-btn, #payment-page button[onclick*="placeOrder"]');
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Processing…'; }

    try {
      const data = await api('/orders', {
        method: 'POST',
        body: {
          shipping: {
            name: document.getElementById('co-name').value.trim(),
            phone: document.getElementById('co-phone').value.trim(),
            email: document.getElementById('co-email').value.trim(),
            address: document.getElementById('co-addr').value.trim(),
            landmark: (document.getElementById('co-landmark') || {}).value || '',
            city: document.getElementById('co-city').value.trim(),
            state: document.getElementById('co-state').value.trim(),
            pincode: document.getElementById('co-pin').value.trim(),
          },
          payment,
          pointsToRedeem: state.pointsRedeeming || 0,
        },
      });

      document.getElementById('order-id').textContent = 'Order ID: ' + data.order.orderId;
      state.user.points = data.pointsBalance;
      state.pointsRedeeming = 0;
      state.cart = { items: [], itemsTotal: 0, totalQuantity: 0 };
      window.updateCartDisplay();
      window.showPage('success-page');

      if (data.order.pointsEarned) {
        setTimeout(() => toast(`You earned ${data.order.pointsEarned} points on this order.`, 'success'), 1200);
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || 'Place Order'; }
    }
  };

  /* ═══════════════════════  ORDERS  ═══════════════════════ */

  window.openOrders = async function (e) {
    if (e) e.preventDefault();
    if (!isLoggedIn()) {
      toast('Please log in to see your orders.', 'warn');
      openAuthModal('login');
      return;
    }
    try {
      const data = await api('/orders');
      state.orders = data.orders;
      if (!data.orders.length) { toast('You have no orders yet.', 'info'); return; }
      window.renderOrdersList();
      document.getElementById('orders-overlay').style.display = 'flex';
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  window.renderOrdersList = function () {
    const list = document.getElementById('orders-list');
    list.innerHTML = state.orders
      .map((o, i) => {
        const date = new Date(o.createdAt).toLocaleDateString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric',
        });
        const names = o.items.map((it) => it.name + (it.quantity > 1 ? ' ×' + it.quantity : '')).join(', ');
        const cancellable = ['Order Placed', 'Payment Verified', 'Being Packed'].includes(o.status);
        return `
    <div class="ord-row">
      <div class="ord-row-left" onclick="openTracker(${i})">
        <div class="ord-id">${o.orderId}</div>
        <div class="ord-meta">${escapeHTML(names)}</div>
        <div class="ord-date">${date}</div>
      </div>
      <div class="ord-row-right">
        <div class="ord-amount">${rupee(o.grandTotal)}</div>
        <div class="ord-status-badge">${o.status}</div>
        <div class="ord-track-btn" onclick="openTracker(${i})">Track →</div>
        ${cancellable ? `<div class="asp-cancel-btn" onclick="aspCancelOrder('${o.orderId}')">Cancel</div>` : ''}
      </div>
    </div>`;
      })
      .join('');
  };

  window.aspCancelOrder = async function (orderId) {
    if (!confirm(`Cancel order ${orderId}? Any points used will be returned.`)) return;
    try {
      await api(`/orders/${orderId}/cancel`, { method: 'PUT', body: { reason: 'Cancelled by customer' } });
      toast('Order cancelled.', 'success');
      const data = await api('/orders');
      state.orders = data.orders;
      window.renderOrdersList();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  /**
   * Drives the existing #tracker-overlay. The key change from the demo:
   * the active step is derived from the order's REAL status rather than
   * being hardcoded to 0, so admin status updates show up here.
   */
  window.openTracker = function (idx) {
    const o = state.orders[idx];
    if (!o) return;

    const steps = window.trackerSteps || [];
    let active = steps.findIndex((s) => s.label === o.status);
    if (o.status === 'Cancelled') active = -1;
    if (active < 0 && o.status !== 'Cancelled') active = 0;

    const date = new Date(o.createdAt).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });

    document.getElementById('tracker-oid').textContent = o.orderId;
    document.getElementById('tracker-name').textContent = o.shipping.name;
    document.getElementById('tracker-date').textContent = date;
    document.getElementById('tracker-items').textContent = o.items
      .map((it) => it.name + (it.quantity > 1 ? ' ×' + it.quantity : ''))
      .join(', ');
    document.getElementById('tracker-total').textContent = rupee(o.grandTotal);

    const stepsEl = document.getElementById('tracker-steps');
    if (o.status === 'Cancelled') {
      stepsEl.innerHTML = `
        <div class="trk-step active">
          <div class="trk-icon">✕</div>
          <div class="trk-line last"></div>
          <div class="trk-info">
            <div class="trk-label">Cancelled</div>
            <div class="trk-desc">This order was cancelled${
              o.cancelledAt ? ' on ' + new Date(o.cancelledAt).toLocaleDateString('en-IN') : ''
            }. Any points used have been returned.</div>
          </div>
        </div>`;
    } else {
      stepsEl.innerHTML = steps
        .map((s, i) => `
      <div class="trk-step ${i === active ? 'active' : i < active ? 'done' : ''}">
        <div class="trk-icon">${s.icon}</div>
        <div class="trk-line ${i === steps.length - 1 ? 'last' : ''}"></div>
        <div class="trk-info">
          <div class="trk-label">${s.label}</div>
          <div class="trk-desc">${i <= active ? s.desc : 'Pending'}</div>
        </div>
      </div>`)
        .join('');
    }

    document.getElementById('tracker-overlay').style.display = 'flex';
  };

  /* ═══════════════════════  WISHLIST  ═══════════════════════ */

  async function refreshWishlist() {
    window.wishlist = window.wishlist || {};
    if (isLoggedIn()) {
      const data = await api('/wishlist');
      window.wishlist = {};
      data.wishlist.products.forEach((p) => {
        window.wishlist[p.name] = { _id: p._id, name: p.name, size: p.size, price: p.price, img: p.img, tag: p.tag };
      });
    } else {
      const ids = guest.wish.read();
      window.wishlist = {};
      state.catalogue
        .filter((p) => ids.includes(p._id))
        .forEach((p) => {
          window.wishlist[p.name] = { _id: p._id, name: p.name, size: p.size, price: p.price, img: p.img, tag: p.tag };
        });
    }
    window.updateWishlistLink();
    paintWishHearts();
  }

  /** Syncs every visible heart icon with the wishlist state. */
  function paintWishHearts() {
    const wished = new Set(Object.values(window.wishlist || {}).map((p) => p._id));
    document.querySelectorAll('.product-card').forEach((card) => {
      const heart = card.querySelector('.wish-heart');
      if (!heart) return;
      const on = wished.has(card.dataset.id);
      heart.classList.toggle('wished', on);
      heart.textContent = on ? '♥' : '♡';
    });
  }

  window.toggleWishlist = async function (heartBtn) {
    const card = heartBtn.closest('.product-card');
    if (!card) return;
    const productId = card.dataset.id;
    const name = card.dataset.name;
    const wasWished = heartBtn.classList.contains('wished');

    // Optimistic UI: flip immediately so the heart feels instant, then
    // revert if the server rejects it.
    heartBtn.classList.toggle('wished', !wasWished);
    heartBtn.textContent = !wasWished ? '♥' : '♡';
    if (!wasWished && typeof window.burstHearts === 'function') window.burstHearts(heartBtn);

    try {
      if (isLoggedIn()) {
        if (wasWished) await api(`/wishlist/${productId}`, { method: 'DELETE' });
        else await api('/wishlist', { method: 'POST', body: { productId } });
      } else {
        guest.wish.toggle(productId);
      }
      await refreshWishlist();
      toast(wasWished ? `${name} removed from wishlist.` : `${name} saved to your wishlist.`, 'success');
    } catch (err) {
      heartBtn.classList.toggle('wished', wasWished);
      heartBtn.textContent = wasWished ? '♥' : '♡';
      toast(err.message, 'error');
    }
  };

  window.updateWishlistLink = function () {
    const count = Object.keys(window.wishlist || {}).length;
    const link = document.getElementById('wishlist-link');
    if (!link) return;
    link.textContent = count > 0 ? `Wishlist ♥ (${count})` : 'Wishlist ♡';
    link.style.color = count > 0 ? '#e74c3c' : '';
  };

  window.openWishlist = async function (e) {
    if (e) e.preventDefault();
    try { await refreshWishlist(); } catch (_) {}
    window.renderWishlist();
    const ov = document.getElementById('wishlist-overlay');
    ov.style.display = 'flex';
    ov.classList.add('open');
  };

  window.renderWishlist = function () {
    const body = document.getElementById('wl-body');
    const items = Object.values(window.wishlist || {});
    if (!items.length) {
      body.innerHTML = `<div class="wl-empty"><span class="wl-empty-icon">🤍</span><p>Your wishlist is empty.<br>Tap the ♡ on any fragrance to save it here.</p></div>`;
      return;
    }
    body.innerHTML = items
      .map((p) => `
    <div class="wl-item" id="wl-item-${p.name.replace(/\s+/g, '-')}">
      <img src="${escapeHTML(p.img)}" alt="${escapeHTML(p.name)}"/>
      <div class="wl-item-info">
        <div class="wl-item-name">${escapeHTML(p.name)}</div>
        <div class="wl-item-price">${rupee(p.price)} · ${escapeHTML(p.size)}</div>
        <div class="wl-item-actions">
          <button class="wl-add-cart" onclick="addToCartFromWishlist('${escapeHTML(p.name)}')">Add to Cart</button>
          <button class="wl-remove" onclick="removeFromWishlist('${escapeHTML(p.name)}')">Remove</button>
        </div>
      </div>
    </div>`)
      .join('');
  };

  window.addToCartFromWishlist = async function (name) {
    const p = window.wishlist[name];
    if (!p) return;
    const btn = document.querySelector(`#wl-item-${name.replace(/\s+/g, '-')} .wl-add-cart`);
    try {
      await addToCart(p._id, name);
      if (btn) {
        btn.textContent = 'Added ✓';
        btn.style.background = '#27ae60';
        setTimeout(() => { btn.textContent = 'Add to Cart'; btn.style.background = ''; }, 1600);
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  window.removeFromWishlist = async function (name) {
    const p = window.wishlist[name];
    if (!p) return;
    try {
      if (isLoggedIn()) await api(`/wishlist/${p._id}`, { method: 'DELETE' });
      else guest.wish.toggle(p._id);
      await refreshWishlist();
      window.renderWishlist();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  window.toggleWishlistFromQV = function () {
    const card = window.currentQVCard;
    if (!card) return;
    const heart = card.querySelector('.wish-heart');
    const qvBtn = document.getElementById('qv-wish-btn');
    if (!heart) return;
    window.toggleWishlist(heart).then(() => {
      const on = heart.classList.contains('wished');
      qvBtn.classList.toggle('wished', on);
      qvBtn.textContent = on ? '♥' : '♡';
    });
  };

  /* ═══════════════════════  SEARCH  ═══════════════════════ */

  // Server-side search, debounced so we don't fire a request per keystroke.
  let searchTimer = null;

  window.runSearch = function (q) {
    const box = document.getElementById('search-results');
    const query = (q || '').trim();

    if (!query) {
      box.innerHTML = '<p class="sr-hint">Start typing to search our collection…</p>';
      return;
    }

    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      try {
        const data = await api(`/products?search=${encodeURIComponent(query)}&limit=10`, { auth: false });
        if (!data.products.length) {
          box.innerHTML = `<p class="sr-hint">No fragrances match “${escapeHTML(query)}”.</p>`;
          return;
        }
        box.innerHTML = data.products
          .map((p) => `
      <div class="sr-item" onclick="openQuickViewByName('${escapeHTML(p.name)}')">
        <img src="${escapeHTML(p.img)}" alt="${escapeHTML(p.name)}"/>
        <div class="sr-info">
          <div class="sr-name">${escapeHTML(p.name)}</div>
          <div class="sr-desc">${escapeHTML(p.desc)}</div>
          <div class="sr-price">${rupee(p.price)} · ${escapeHTML(p.size)} · ${escapeHTML(p.category)}</div>
        </div>
      </div>`)
          .join('');
      } catch (err) {
        box.innerHTML = `<p class="sr-hint">${escapeHTML(err.message)}</p>`;
      }
    }, 220);
  };

  window.openQuickViewByName = function (name) {
    if (typeof window.closeSearch === 'function') window.closeSearch();
    setTimeout(() => {
      const card = [...document.querySelectorAll('.product-card')].find((c) => c.dataset.name === name);
      if (card) {
        window.openQuickView(card);
      } else {
        document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
      }
    }, 260);
  };

  /* ═══════════════════════  POINTS  ═══════════════════════ */

  window.handleSubscribe = async function () {
    const emailEl = document.getElementById('nl-email-input');
    const email = emailEl.value.trim();
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      emailEl.style.borderColor = '#e74c3c';
      emailEl.focus();
      return;
    }
    emailEl.style.borderColor = '';
    const btn = emailEl.nextElementSibling;

    try {
      const data = await api('/contact', {
        method: 'POST',
        body: { email, type: 'newsletter', subject: 'Newsletter signup' },
      });
      btn.textContent = 'Joined! ✓';
      btn.style.background = '#27ae60';
      emailEl.value = '';
      setTimeout(() => { btn.textContent = 'Subscribe'; btn.style.background = ''; }, 2000);

      if (data.pointsAwarded) {
        state.user.points = data.totalPoints;
        toast(`${data.pointsAwarded} points added to your account.`, 'success');
        setTimeout(window.openPointsDashboard, 700);
      } else if (!isLoggedIn()) {
        toast('Subscribed. Create an account to collect your 200 bonus points.', 'info');
      } else {
        toast(data.message, 'success');
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  window.openPointsDashboard = async function () {
    if (!isLoggedIn()) {
      toast('Please log in to view your points.', 'warn');
      openAuthModal('login');
      return;
    }
    try {
      const data = await api('/orders/summary/points');

      document.getElementById('pp-pts-num').textContent = data.points.toLocaleString('en-IN');
      document.getElementById('pp-member-email').textContent = state.user.email;
      document.getElementById('pp-pts-worth').textContent = rupee(data.worth);

      const signup = document.getElementById('pp-signup-date');
      if (signup) {
        signup.textContent = new Date(data.memberSince).toLocaleDateString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric',
        });
      }

      const tbl = document.getElementById('pp-history-table');
      const header = tbl.querySelector('.pp-history-row.header');
      tbl.innerHTML = '';
      if (header) tbl.appendChild(header);

      if (!data.history.length) {
        const row = document.createElement('div');
        row.className = 'pp-history-row';
        row.innerHTML = '<span>No activity yet</span><span class="pp-hist-date">—</span><span class="pp-hist-pts">0</span>';
        tbl.appendChild(row);
      } else {
        data.history.forEach((h) => {
          const row = document.createElement('div');
          row.className = 'pp-history-row';
          const cls = h.type === 'earned' ? 'earn' : 'spend';
          const sign = h.points >= 0 ? '+' : '−';
          row.innerHTML = `<span>${escapeHTML(h.reason)}</span>
            <span class="pp-hist-date">${new Date(h.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            <span class="pp-hist-pts ${cls}">${sign}${Math.abs(h.points)}</span>`;
          tbl.appendChild(row);
        });
      }

      document.getElementById('points-page').style.display = 'block';
      document.body.style.overflow = 'hidden';
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  window.updatePointsToggleDisplay = function () {
    const info = document.getElementById('pts-toggle-info');
    const check = document.getElementById('use-points-check');
    if (!info) return;

    if (!isLoggedIn()) {
      info.textContent = 'Log in to earn and redeem points';
      if (check) { check.disabled = true; check.checked = false; }
      state.pointsRedeeming = 0;
      return;
    }

    const pts = state.user.points || 0;
    if (pts < MIN_REDEEM_POINTS) {
      info.textContent = `You have ${pts} pts (need ${MIN_REDEEM_POINTS} to redeem)`;
      if (check) { check.disabled = true; check.checked = false; }
      state.pointsRedeeming = 0;
      return;
    }

    if (check) check.disabled = false;
    const maxDiscount = Math.min(pts * POINT_VALUE, state.cart.itemsTotal);
    info.textContent = `Apply ${pts} pts — save up to ${rupee(maxDiscount)}`;

    if (check && !check.dataset.bound) {
      check.dataset.bound = '1';
      check.addEventListener('change', () => {
        state.pointsRedeeming = check.checked ? state.user.points : 0;
        window.renderOrderSummary();
      });
    }
  };

  /* ═══════════════════════  FEEDBACK  ═══════════════════════ */

  window.submitFeedback = async function () {
    const name = document.getElementById('fb-name').value.trim();
    const email = document.getElementById('fb-email').value.trim();
    const subject = document.getElementById('fb-subject').value.trim();
    const message = document.getElementById('fb-message').value.trim();
    const status = document.getElementById('fb-status');

    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      status.textContent = 'Please enter a valid email address.';
      status.className = 'asp-feedback-status err';
      return;
    }
    if (!message) {
      status.textContent = 'Please write a message.';
      status.className = 'asp-feedback-status err';
      return;
    }

    status.textContent = 'Sending…';
    status.className = 'asp-feedback-status';

    try {
      const data = await api('/contact', {
        method: 'POST',
        body: { name, email, subject: subject || 'Website Feedback', message, type: 'feedback' },
      });
      status.textContent = data.message;
      status.className = 'asp-feedback-status ok';
      ['fb-name', 'fb-email', 'fb-subject', 'fb-message'].forEach((id) => {
        document.getElementById(id).value = '';
      });
    } catch (err) {
      status.textContent = err.message;
      status.className = 'asp-feedback-status err';
    }
  };

  /* ═══════════════════════  AUTH UI  ═══════════════════════ */

  function buildAuthModal() {
    if (document.getElementById('asp-auth-overlay')) return;
    const el = document.createElement('div');
    el.id = 'asp-auth-overlay';
    el.innerHTML = `
  <div class="asp-auth-modal">
    <div class="asp-auth-head">
      <h2 id="asp-auth-title">Welcome Back</h2>
      <button class="asp-auth-close" onclick="aspCloseAuth()" aria-label="Close">×</button>
    </div>
    <div class="asp-auth-tabs">
      <button class="asp-auth-tab active" data-mode="login" onclick="aspSwitchAuth('login')">Log In</button>
      <button class="asp-auth-tab" data-mode="register" onclick="aspSwitchAuth('register')">Create Account</button>
    </div>
    <div class="asp-auth-body">
      <div class="asp-auth-field" id="asp-f-name">
        <label>Full Name</label><input type="text" id="asp-name" placeholder="Your name" autocomplete="name"/>
      </div>
      <div class="asp-auth-field" id="asp-f-phone">
        <label>Mobile Number</label><input type="tel" id="asp-phone" placeholder="10-digit mobile" autocomplete="tel"/>
      </div>
      <div class="asp-auth-field">
        <label>Email</label><input type="email" id="asp-email" placeholder="you@example.com" autocomplete="email"/>
      </div>
      <div class="asp-auth-field">
        <label>Password</label><input type="password" id="asp-password" placeholder="At least 8 characters" autocomplete="current-password"/>
      </div>
      <p class="asp-auth-error" id="asp-auth-error"></p>
      <button class="asp-auth-submit" id="asp-auth-submit" onclick="aspSubmitAuth()">Log In</button>
      <p class="asp-auth-note">Your cart and wishlist will carry over once you sign in.</p>
    </div>
    <div class="asp-auth-profile" id="asp-auth-profile"></div>
  </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) window.aspCloseAuth(); });
    el.querySelectorAll('input').forEach((i) =>
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') window.aspSubmitAuth(); })
    );
  }

  let authMode = 'login';

  function openAuthModal(mode) {
    buildAuthModal();
    const ov = document.getElementById('asp-auth-overlay');
    const profile = document.getElementById('asp-auth-profile');
    const body = ov.querySelector('.asp-auth-body');
    const tabs = ov.querySelector('.asp-auth-tabs');

    if (isLoggedIn()) {
      // Logged in: show a small profile panel instead of the form.
      tabs.style.display = 'none';
      body.style.display = 'none';
      profile.style.display = 'block';
      document.getElementById('asp-auth-title').textContent = 'Your Account';
      profile.innerHTML = `
      <div class="asp-profile-row"><span>Name</span><b>${escapeHTML(state.user.name)}</b></div>
      <div class="asp-profile-row"><span>Email</span><b>${escapeHTML(state.user.email)}</b></div>
      ${state.user.phone ? `<div class="asp-profile-row"><span>Mobile</span><b>${escapeHTML(state.user.phone)}</b></div>` : ''}
      <div class="asp-profile-row"><span>Points</span><b>${state.user.points} · worth ${rupee(state.user.points * POINT_VALUE)}</b></div>
      <div class="asp-profile-row"><span>Role</span><b>${state.user.role}</b></div>
      ${state.user.role === 'admin' ? `<a class="asp-admin-link" href="admin.html">Open Admin Dashboard →</a>` : ''}
      <button class="asp-auth-submit" onclick="aspLogout()">Log Out</button>`;
    } else {
      tabs.style.display = 'flex';
      body.style.display = 'block';
      profile.style.display = 'none';
      aspSwitchAuth(mode || 'login');
    }

    ov.style.display = 'flex';
  }

  window.openAuth = function (e) {
    if (e) e.preventDefault();
    openAuthModal('login');
  };

  window.aspCloseAuth = function () {
    const ov = document.getElementById('asp-auth-overlay');
    if (ov) ov.style.display = 'none';
  };

  window.aspSwitchAuth = function (mode) {
    authMode = mode;
    document.querySelectorAll('.asp-auth-tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.mode === mode)
    );
    const isReg = mode === 'register';
    document.getElementById('asp-f-name').style.display = isReg ? 'block' : 'none';
    document.getElementById('asp-f-phone').style.display = isReg ? 'block' : 'none';
    document.getElementById('asp-auth-title').textContent = isReg ? 'Join Asp Perfume' : 'Welcome Back';
    document.getElementById('asp-auth-submit').textContent = isReg ? 'Create Account' : 'Log In';
    document.getElementById('asp-password').setAttribute(
      'autocomplete', isReg ? 'new-password' : 'current-password'
    );
    document.getElementById('asp-auth-error').textContent = '';
  };

  window.aspSubmitAuth = async function () {
    const errEl = document.getElementById('asp-auth-error');
    const btn = document.getElementById('asp-auth-submit');
    const email = document.getElementById('asp-email').value.trim();
    const password = document.getElementById('asp-password').value;
    const name = document.getElementById('asp-name').value.trim();
    const phone = document.getElementById('asp-phone').value.trim();

    errEl.textContent = '';

    if (!email || !password) { errEl.textContent = 'Email and password are required.'; return; }
    if (authMode === 'register') {
      if (!name) { errEl.textContent = 'Please enter your name.'; return; }
      if (password.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }
      if (phone && !/^[6-9]\d{9}$/.test(phone)) {
        errEl.textContent = 'Please enter a valid 10-digit Indian mobile number.'; return;
      }
    }

    btn.disabled = true;
    btn.textContent = authMode === 'register' ? 'Creating…' : 'Logging in…';

    try {
      const path = authMode === 'register' ? '/auth/register' : '/auth/login';
      const body = authMode === 'register'
        ? { name, email, password, phone: phone || undefined }
        : { email, password };

      const data = await api(path, { method: 'POST', body, auth: false });

      token.set(data.token);
      state.user = data.user;

      await mergeGuestData();
      await Promise.all([refreshCart(), refreshWishlist()]);
      renderAccountLink();

      window.aspCloseAuth();
      toast(data.message, 'success');

      ['asp-name', 'asp-phone', 'asp-email', 'asp-password'].forEach((id) => {
        document.getElementById(id).value = '';
      });
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = authMode === 'register' ? 'Create Account' : 'Log In';
    }
  };

  window.aspLogout = function () {
    token.clear();
    state.user = null;
    state.cart = { items: [], itemsTotal: 0, totalQuantity: 0 };
    state.orders = [];
    window.wishlist = {};
    guest.cart.clear();
    guest.wish.clear();
    window.updateCartDisplay();
    window.updateWishlistLink();
    paintWishHearts();
    renderAccountLink();
    window.aspCloseAuth();
    toast('You have been logged out.', 'info');
  };

  /** Pushes anything collected while browsing as a guest to the server. */
  async function mergeGuestData() {
    const cartItems = guest.cart.read();
    const wishIds = guest.wish.read();

    try {
      if (cartItems.length) {
        await api('/cart/merge', { method: 'POST', body: { items: cartItems } });
        guest.cart.clear();
      }
      if (wishIds.length) {
        await api('/wishlist/merge', { method: 'POST', body: { productIds: wishIds } });
        guest.wish.clear();
      }
    } catch (err) {
      // A failed merge must never block a successful login.
      console.warn('[asp] guest data merge failed:', err.message);
    }
  }

  function renderAccountLink() {
    const link = document.getElementById('account-link');
    if (!link) return;
    if (isLoggedIn()) {
      const first = state.user.name.split(' ')[0];
      link.textContent = state.user.role === 'admin' ? `${first} ★` : first;
      link.style.color = 'var(--purple2)';
    } else {
      link.textContent = 'Account';
      link.style.color = '';
    }
  }

  /* ═══════════════════════  STYLES  ═══════════════════════

     Scoped to new elements only (asp-* prefix). Nothing here touches
     an existing selector, so the original design is unaffected.
     ═══════════════════════════════════════════════════════ */

  function injectStyles() {
    const css = `
.asp-grid-loading{grid-column:1/-1;text-align:center;padding:60px 20px;font-family:'Jost',sans-serif;color:var(--gray);font-size:.9rem;letter-spacing:.05em}

/* Toasts */
#asp-toast-host{position:fixed;bottom:24px;right:24px;z-index:99999;display:flex;flex-direction:column;gap:10px;pointer-events:none}
.asp-toast{background:var(--dark);color:#fff;padding:13px 20px;font-family:'Jost',sans-serif;font-size:.83rem;letter-spacing:.02em;max-width:330px;box-shadow:0 12px 40px rgba(0,0,0,.28);opacity:0;transform:translateY(14px);transition:all .3s cubic-bezier(.4,0,.2,1);border-left:3px solid var(--purple2)}
.asp-toast.show{opacity:1;transform:translateY(0)}
.asp-toast-success{border-left-color:#27ae60}
.asp-toast-error{border-left-color:#e74c3c}
.asp-toast-warn{border-left-color:#f39c12}

/* Cart quantity stepper */
.asp-qty{display:inline-flex;align-items:center;gap:8px}
.asp-qty button{width:22px;height:22px;border:1px solid rgba(107,63,160,.35);background:#fff;color:var(--purple);cursor:pointer;font-size:.9rem;line-height:1;font-family:'Jost',sans-serif;transition:all .2s}
.asp-qty button:hover{background:var(--purple);color:#fff}
.asp-qty b{min-width:18px;text-align:center;font-weight:500}
.asp-line-total{margin-left:10px;min-width:64px;text-align:right;display:inline-block}

/* Cancel button in order history */
.asp-cancel-btn{font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#e74c3c;cursor:pointer;margin-top:6px}
.asp-cancel-btn:hover{text-decoration:underline}

/* Feedback form */
.asp-feedback{margin-top:26px;padding-top:22px;border-top:1px solid rgba(255,255,255,.14)}
.asp-feedback-label{font-family:'Jost',sans-serif;font-size:.76rem;letter-spacing:.14em;text-transform:uppercase;opacity:.75;margin-bottom:12px}
.asp-feedback input,.asp-feedback textarea{width:100%;padding:12px 14px;margin-bottom:9px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.07);color:inherit;font-family:'Jost',sans-serif;font-size:.86rem;outline:none;transition:border-color .25s}
.asp-feedback input::placeholder,.asp-feedback textarea::placeholder{color:rgba(255,255,255,.5)}
.asp-feedback input:focus,.asp-feedback textarea:focus{border-color:var(--purple3)}
.asp-feedback textarea{resize:vertical;min-height:78px}
.asp-feedback-btn{padding:12px 30px;background:var(--purple);color:#fff;border:none;cursor:pointer;font-family:'Jost',sans-serif;font-size:.76rem;letter-spacing:.16em;text-transform:uppercase;transition:background .25s}
.asp-feedback-btn:hover{background:var(--purple2)}
.asp-feedback-status{margin-top:10px;font-family:'Jost',sans-serif;font-size:.8rem;min-height:18px}
.asp-feedback-status.ok{color:#6ee7a8}
.asp-feedback-status.err{color:#ff8f8f}

/* Auth modal */
#asp-auth-overlay{display:none;position:fixed;inset:0;background:rgba(14,10,24,.74);backdrop-filter:blur(5px);z-index:9500;align-items:center;justify-content:center;padding:20px}
.asp-auth-modal{background:#fff;width:100%;max-width:430px;max-height:92vh;overflow-y:auto;font-family:'Jost',sans-serif;box-shadow:0 30px 80px rgba(0,0,0,.4)}
.asp-auth-head{background:var(--dark);color:#fff;padding:22px 28px;display:flex;justify-content:space-between;align-items:center}
.asp-auth-head h2{font-family:'Cormorant Garamond',serif;font-size:1.5rem;font-weight:300;letter-spacing:.05em}
.asp-auth-close{background:none;border:none;color:#fff;font-size:1.7rem;line-height:1;cursor:pointer;opacity:.7;transition:opacity .2s}
.asp-auth-close:hover{opacity:1}
.asp-auth-tabs{display:flex;border-bottom:1px solid #eee}
.asp-auth-tab{flex:1;padding:15px;background:none;border:none;cursor:pointer;font-family:'Jost',sans-serif;font-size:.74rem;letter-spacing:.15em;text-transform:uppercase;color:var(--gray);border-bottom:2px solid transparent;transition:all .25s}
.asp-auth-tab.active{color:var(--purple);border-bottom-color:var(--purple)}
.asp-auth-body{padding:26px 28px 30px}
.asp-auth-field{margin-bottom:15px}
.asp-auth-field label{display:block;font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:var(--gray);margin-bottom:6px}
.asp-auth-field input{width:100%;padding:12px 14px;border:1px solid #ddd;font-family:'Jost',sans-serif;font-size:.92rem;outline:none;transition:border-color .25s}
.asp-auth-field input:focus{border-color:var(--purple)}
.asp-auth-error{color:#e74c3c;font-size:.82rem;min-height:18px;margin-bottom:6px}
.asp-auth-submit{width:100%;padding:14px;background:var(--purple);color:#fff;border:none;cursor:pointer;font-size:.78rem;letter-spacing:.18em;text-transform:uppercase;transition:background .25s;margin-top:4px}
.asp-auth-submit:hover:not(:disabled){background:var(--dark)}
.asp-auth-submit:disabled{opacity:.6;cursor:not-allowed}
.asp-auth-note{margin-top:14px;font-size:.76rem;color:var(--gray);text-align:center;line-height:1.6}
.asp-auth-profile{display:none;padding:26px 28px 30px}
.asp-profile-row{display:flex;justify-content:space-between;gap:14px;padding:11px 0;border-bottom:1px solid #f2f2f2;font-size:.87rem}
.asp-profile-row span{color:var(--gray);letter-spacing:.06em}
.asp-profile-row b{font-weight:500;text-align:right;color:var(--text)}
.asp-admin-link{display:block;margin:18px 0 4px;padding:13px;text-align:center;background:var(--dark);color:#fff;text-decoration:none;font-size:.74rem;letter-spacing:.15em;text-transform:uppercase;transition:background .25s}
.asp-admin-link:hover{background:var(--purple)}

@media(max-width:520px){
  #asp-toast-host{left:16px;right:16px;bottom:16px}
  .asp-toast{max-width:100%}
}`;
    const tag = document.createElement('style');
    tag.id = 'asp-backend-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  /* ═══════════════════════  BOOTSTRAP  ═══════════════════════ */

  async function init() {
    injectStyles();
    buildAuthModal();
    window.wishlist = window.wishlist || {};

    // Restore the session BEFORE loading products, so hearts and the
    // cart badge are correct on first paint rather than flickering.
    if (token.get()) {
      try {
        const data = await api('/auth/me');
        state.user = data.user;
      } catch (_) {
        token.clear();
      }
    }
    renderAccountLink();

    await loadProducts();

    try {
      await refreshCart();
      await refreshWishlist();
    } catch (err) {
      console.warn('[asp] cart/wishlist load failed:', err.message);
    }

    console.log(
      `%c Asp Perfume %c connected to ${API_BASE} `,
      'background:#6b3fa0;color:#fff;padding:3px 6px',
      'background:#0e0a18;color:#c9a8f0;padding:3px 6px'
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
