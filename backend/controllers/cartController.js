const Cart = require('../models/Cart');
const Product = require('../models/Product');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { toCardShape } = require('./productController');

const MAX_QTY = 10;

/** Fetch (or lazily create) this user's cart, with products populated. */
async function loadCart(userId) {
  let cart = await Cart.findOne({ user: userId }).populate('items.product');
  if (!cart) cart = await Cart.create({ user: userId, items: [] });
  return cart;
}

/**
 * Builds the response body. Totals are recomputed here from the LIVE product
 * price on every request — never from `priceAtAdd`. That is what stops a stale
 * or tampered client price from being billed.
 *
 * It also quietly drops line items whose product has been deleted or
 * deactivated by an admin, and reports them so the UI can tell the user.
 */
function serialiseCart(cart) {
  const items = [];
  const removed = [];
  let itemsTotal = 0;
  let totalQuantity = 0;

  for (const item of cart.items) {
    const p = item.product;
    if (!p || !p.isActive) {
      removed.push(item.product ? item.product.name : 'An item');
      continue;
    }
    const subtotal = p.price * item.quantity;
    itemsTotal += subtotal;
    totalQuantity += item.quantity;

    items.push({
      product: toCardShape(p),
      quantity: item.quantity,
      priceAtAdd: item.priceAtAdd,
      // true when the shelf price moved since it was added
      priceChanged: item.priceAtAdd !== p.price,
      subtotal,
      inStock: p.stock >= item.quantity,
    });
  }

  return {
    items,
    totalQuantity,
    itemsTotal,
    removedItems: removed,
    count: items.length,
  };
}

/**
 * GET /api/cart
 * Private
 */
const getCart = asyncHandler(async (req, res) => {
  const cart = await loadCart(req.user._id);
  res.json({ success: true, cart: serialiseCart(cart) });
});

/**
 * POST /api/cart
 * Private
 * Body: { productId, quantity? }
 */
const addToCart = asyncHandler(async (req, res) => {
  const { productId, quantity = 1 } = req.body;

  if (!productId) throw new ApiError(400, 'productId is required.');

  const qty = parseInt(quantity, 10);
  if (!Number.isInteger(qty) || qty < 1) {
    throw new ApiError(400, 'Quantity must be a whole number of at least 1.');
  }

  const product = await Product.findById(productId);
  if (!product || !product.isActive) {
    throw new ApiError(404, 'That fragrance is not available.');
  }

  const cart = await loadCart(req.user._id);
  const line = cart.items.find((i) => {
    const id = i.product?._id || i.product;
    return id.toString() === productId.toString();
  });

  const newQty = (line ? line.quantity : 0) + qty;

  if (newQty > MAX_QTY) {
    throw new ApiError(400, `You can order at most ${MAX_QTY} units of ${product.name}.`);
  }
  if (product.stock < newQty) {
    throw new ApiError(
      400,
      product.stock === 0
        ? `${product.name} is out of stock.`
        : `Only ${product.stock} units of ${product.name} remain.`
    );
  }

  if (line) {
    line.quantity = newQty;
  } else {
    cart.items.push({ product: product._id, quantity: qty, priceAtAdd: product.price });
  }

  await cart.save();
  const fresh = await loadCart(req.user._id);

  res.status(201).json({
    success: true,
    message: `${product.name} added to your cart.`,
    cart: serialiseCart(fresh),
  });
});

/**
 * PUT /api/cart/:productId
 * Private
 * Body: { quantity }   — quantity 0 removes the line
 */
const updateCartItem = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const qty = parseInt(req.body.quantity, 10);

  if (!Number.isInteger(qty) || qty < 0) {
    throw new ApiError(400, 'Quantity must be 0 or a positive whole number.');
  }
  if (qty > MAX_QTY) {
    throw new ApiError(400, `Maximum ${MAX_QTY} units per item.`);
  }

  const cart = await loadCart(req.user._id);
  const line = cart.items.find((i) => {
    const id = i.product?._id || i.product;
    return id.toString() === productId.toString();
  });

  if (!line) throw new ApiError(404, 'That item is not in your cart.');

  if (qty === 0) {
    cart.items = cart.items.filter((i) => {
      const id = i.product?._id || i.product;
      return id.toString() !== productId.toString();
    });
  } else {
    const product = await Product.findById(productId);
    if (!product) throw new ApiError(404, 'Product not found.');
    if (product.stock < qty) {
      throw new ApiError(400, `Only ${product.stock} units of ${product.name} remain.`);
    }
    line.quantity = qty;
  }

  await cart.save();
  const fresh = await loadCart(req.user._id);
  res.json({ success: true, message: 'Cart updated.', cart: serialiseCart(fresh) });
});

/**
 * DELETE /api/cart/:productId
 * Private
 */
const removeFromCart = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const cart = await loadCart(req.user._id);

  const before = cart.items.length;
  cart.items = cart.items.filter((i) => {
    const id = i.product?._id || i.product;
    return id.toString() !== productId.toString();
  });

  if (cart.items.length === before) {
    throw new ApiError(404, 'That item is not in your cart.');
  }

  await cart.save();
  const fresh = await loadCart(req.user._id);
  res.json({ success: true, message: 'Item removed.', cart: serialiseCart(fresh) });
});

/**
 * DELETE /api/cart
 * Private — empties the cart.
 */
const clearCart = asyncHandler(async (req, res) => {
  const cart = await loadCart(req.user._id);
  cart.items = [];
  await cart.save();
  res.json({ success: true, message: 'Cart cleared.', cart: serialiseCart(cart) });
});

/**
 * POST /api/cart/merge
 * Private
 * Body: { items: [{ productId, quantity }] }
 *
 * Called once immediately after login. Takes whatever the visitor added
 * while browsing as a guest and folds it into their server cart.
 * Quantities are ADDED, then clamped to stock and MAX_QTY.
 * Invalid entries are skipped rather than failing the whole merge — a
 * guest cart containing one deleted product should not block login.
 */
const mergeCart = asyncHandler(async (req, res) => {
  const { items } = req.body;

  if (!Array.isArray(items)) {
    throw new ApiError(400, 'items must be an array.');
  }

  const cart = await loadCart(req.user._id);
  const skipped = [];

  for (const entry of items) {
    const pid = entry?.productId;
    const qty = parseInt(entry?.quantity, 10) || 0;
    if (!pid || qty < 1) continue;

    const product = await Product.findById(pid).catch(() => null);
    if (!product || !product.isActive) {
      skipped.push(pid);
      continue;
    }

    const line = cart.items.find((i) => {
      const id = i.product?._id || i.product;
      return id.toString() === pid.toString();
    });

    const desired = (line ? line.quantity : 0) + qty;
    const allowed = Math.min(desired, MAX_QTY, product.stock);
    if (allowed < 1) {
      skipped.push(product.name);
      continue;
    }

    if (line) line.quantity = allowed;
    else cart.items.push({ product: product._id, quantity: allowed, priceAtAdd: product.price });
  }

  await cart.save();
  const fresh = await loadCart(req.user._id);

  res.json({
    success: true,
    message: 'Your guest cart has been merged.',
    skipped,
    cart: serialiseCart(fresh),
  });
});

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  mergeCart,
  loadCart,
  serialiseCart,
};
