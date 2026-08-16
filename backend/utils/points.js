/**
 * Loyalty points rules, kept in one place so backend and frontend agree.
 * These values mirror the copy already on your newsletter section:
 *   "1 point = Rs.0.10 off - Min 500 points to redeem"
 */
const POINT_VALUE_RUPEES = 0.1;   // 1 point = Rs.0.10
const MIN_REDEEM_POINTS = 500;    // cannot redeem below this
const SIGNUP_BONUS = 200;         // "Earn 200 points just for subscribing"
const POINTS_PER_RUPEE = 0.02;    // Rs.100 spent -> 2 points

/** Rupee value of a given number of points. */
function pointsToRupees(points) {
  return Math.round(points * POINT_VALUE_RUPEES * 100) / 100;
}

/**
 * Works out how many points may actually be redeemed against a given
 * order subtotal. Guards against three things at once:
 *   - redeeming more points than the user owns
 *   - redeeming below the minimum threshold
 *   - a discount larger than the order itself (which would be negative billing)
 */
function calculateRedemption(requestedPoints, userPoints, itemsTotal) {
  const requested = Math.max(0, Math.floor(Number(requestedPoints) || 0));

  if (requested === 0) return { pointsUsed: 0, discount: 0 };
  if (requested < MIN_REDEEM_POINTS) {
    return { pointsUsed: 0, discount: 0, reason: `Minimum ${MIN_REDEEM_POINTS} points required to redeem` };
  }
  if (requested > userPoints) {
    return { pointsUsed: 0, discount: 0, reason: 'You do not have enough points' };
  }

  let discount = pointsToRupees(requested);
  let pointsUsed = requested;

  // Never let the discount exceed the order value.
  if (discount > itemsTotal) {
    discount = itemsTotal;
    pointsUsed = Math.ceil(discount / POINT_VALUE_RUPEES);
  }

  return { pointsUsed, discount: Math.round(discount * 100) / 100 };
}

/** Points earned from a completed purchase. */
function pointsEarnedFor(amountPaid) {
  return Math.floor(amountPaid * POINTS_PER_RUPEE);
}

module.exports = {
  POINT_VALUE_RUPEES,
  MIN_REDEEM_POINTS,
  SIGNUP_BONUS,
  POINTS_PER_RUPEE,
  pointsToRupees,
  calculateRedemption,
  pointsEarnedFor,
};
