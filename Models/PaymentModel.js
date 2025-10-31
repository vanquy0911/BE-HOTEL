import mongoose from 'mongoose';

const PaymentSchema = new mongoose.Schema({
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'VND'
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'cancelled', 'refunded'],
    default: 'pending'
  },
  method: {
    type: String,
    enum: ['cash', 'card', 'bank_transfer', 'vnpay'],
    required: true
  },
  paidAt: {
    type: Date
  },
  notes: {
    type: String
  },
  // Thông tin thanh toán tại quầy
  cashierId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  receiptNumber: {
    type: String
  },
  // Thông tin VNPay (nếu có)
  vnpayTransactionId: {
    type: String
  },
  vnpayResponseCode: {
    type: String
  },
  // Thông tin hoàn tiền
  refundAmount: {
    type: Number,
    default: 0
  },
  refundReason: {
    type: String
  },
  refundedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Index để tìm kiếm nhanh
PaymentSchema.index({ bookingId: 1 });
PaymentSchema.index({ status: 1 });
PaymentSchema.index({ method: 1 });
PaymentSchema.index({ createdAt: -1 });

// Virtual để tính số ngày từ khi tạo
PaymentSchema.virtual('daysSinceCreated').get(function() {
  return Math.floor((Date.now() - this.createdAt.getTime()) / (1000 * 60 * 60 * 24));
});

// Method để cập nhật trạng thái thanh toán
PaymentSchema.methods.markAsPaid = function(cashierId, receiptNumber, notes) {
  this.status = 'paid';
  this.paidAt = new Date();
  this.cashierId = cashierId;
  this.receiptNumber = receiptNumber;
  if (notes) this.notes = notes;
  return this.save();
};

// Method để hủy thanh toán
PaymentSchema.methods.cancel = function(reason) {
  this.status = 'cancelled';
  if (reason) this.notes = reason;
  return this.save();
};

// Method để hoàn tiền
PaymentSchema.methods.refund = function(amount, reason) {
  this.status = 'refunded';
  this.refundAmount = amount;
  this.refundReason = reason;
  this.refundedAt = new Date();
  return this.save();
};

const Payment = mongoose.model('Payment', PaymentSchema);

export default Payment;


