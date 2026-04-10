const ACTIVE_ORDER_STATUSES = [
  'pending',
  'confirmed',
  'assigned',
  'picked',
  'packed',
  'out_for_delivery',
];

const PREVIOUS_ORDER_STATUSES = ['delivered', 'cancelled', 'failed'];

const DRIVER_UPDATABLE_STATUSES = new Set([
  'picked',
  'out_for_delivery',
  'delivered',
  'cancelled',
]);

module.exports = {
  ACTIVE_ORDER_STATUSES,
  PREVIOUS_ORDER_STATUSES,
  DRIVER_UPDATABLE_STATUSES,
};
