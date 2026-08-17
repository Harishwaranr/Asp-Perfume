/**
 * Local validation for the Razorpay Standard Checkout flow.
 * Run: node test-payment-flow.js
 */

const API_BASE = 'http://localhost:5000/api';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!res.ok) {
    const message = typeof data === 'string' ? data : data?.message || 'Request failed';
    throw new Error(`${res.status} ${path}: ${message}`);
  }

  return data;
}

async function testPaymentFlow() {
  console.log('\n=== ASP Perfume Razorpay Payment Flow Test ===\n');

  try {
    console.log('1. Checking Razorpay configuration...');
    const config = await request('/payments/config');
    console.log('   ✓ Razorpay config:', {
      enabled: config.razorpayEnabled,
      keyId: config.keyId ? config.keyId.slice(0, 8) + '...' : null,
    });

    if (!config.razorpayEnabled) {
      throw new Error('Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to backend/.env');
    }

    const email = `rzpcheck_${Date.now()}@example.com`;
    const password = 'TestPass123';
    const phone = '9876543210';

    console.log('\n2. Registering a test user...');
    const user = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Razorpay Check',
        email,
        password,
        phone,
      }),
    });
    const token = user.token;
    console.log('   ✓ User registered:', { email, userId: user.user?._id ? user.user._id.slice(-6) : 'unknown' });

    console.log('\n3. Loading a product and adding it to cart...');
    const products = await request('/products');
    const product = products.products && products.products[0];
    if (!product) throw new Error('No products available in the catalog.');

    const addCart = await request('/cart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ productId: product._id, quantity: 1 }),
    });
    console.log('   ✓ Cart updated:', { totalQuantity: addCart.cart?.totalQuantity ?? 0, itemCount: addCart.cart?.items?.length ?? 0 });

    console.log('\n4. Creating a Razorpay order through the backend...');
    const orderRes = await request('/payments/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        shipping: {
          name: 'Razorpay Check',
          phone,
          email,
          address: '12 Test Street',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '600001',
        },
        pointsToRedeem: 0,
      }),
    });

    console.log('   ✓ Razorpay order created:', {
      success: orderRes.success,
      amount: orderRes.amount,
      currency: orderRes.currency,
      aspOrderId: orderRes.aspOrderId,
      razorpayOrderId: orderRes.order_id ? orderRes.order_id.slice(0, 12) + '...' : null,
      keyId: orderRes.key_id ? orderRes.key_id.slice(0, 8) + '...' : null,
    });

    console.log('\n✓ Complete local payment-flow validation passed.\n');
  } catch (err) {
    console.error('\n✗ Payment-flow test failed:', err.message);
    process.exit(1);
  }
}

testPaymentFlow();
