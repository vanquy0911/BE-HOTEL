import asyncHandler from "express-async-handler";
import Payment from "../Models/PaymentModel.js";
import Booking from "../Models/BookingModel.js";
import User from "../Models/UserModel.js";
import Room from "../Models/RoomModel.js";
import vnpayService from "../services/vnpayService.js";
import uploadPaymentReceipt from "../Middlewares/uploadPayment.js";
import emailService from "../services/emailService.js";

// @desc    Tạo thanh toán mới
// @route   POST /api/payments
// @access  Private
export const createPayment = asyncHandler(async (req, res) => {
  try {
    console.log('🔍 createPayment - Request received');
    console.log('🔍 createPayment - Body:', req.body);
    console.log('🔍 createPayment - Files:', req.file);
    console.log('🔍 createPayment - User:', req.user);
    
    const { bookingId, amount, method, notes } = req.body;
    const userId = req.user.id;
    
    // Lấy đường dẫn ảnh bill nếu có
    let receiptImage = null;
    if (req.file) {
      // Tạo URL để truy cập ảnh
      receiptImage = `/uploads/payments/${req.file.filename}`;
      console.log('✅ Receipt image uploaded:', receiptImage);
      console.log('✅ File info:', {
        filename: req.file.filename,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      });
    } else {
      console.warn('⚠️ No receipt image file in request');
    }

    console.log('🔍 createPayment - Parsed data:', { bookingId, amount, method, notes, userId });

    // Validation
    if (!bookingId || !amount || !method) {
      console.log('❌ createPayment - Missing required fields');
      return res.status(400).json({
        success: false,
        message: "Thiếu thông tin bắt buộc",
        required: ["bookingId", "amount", "method"]
      });
    }

    // Kiểm tra booking có tồn tại không
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn đặt phòng"
      });
    }

    // Kiểm tra booking có thuộc về user không
    if (booking.user.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền truy cập đơn đặt phòng này"
      });
    }

    // Kiểm tra đã có thanh toán chưa
    const existingPayment = await Payment.findOne({ bookingId });
    if (existingPayment) {
      return res.status(400).json({
        success: false,
        message: "Đơn đặt phòng này đã có thanh toán",
        payment: existingPayment
      });
    }

    // Tạo thanh toán mới
    console.log('🔍 createPayment - Creating payment with data:', {
      bookingId,
      amount,
      method,
      notes,
      status: 'pending'
    });

    const paymentData = {
      bookingId,
      amount,
      method,
      notes,
      status: 'pending'
    };
    
    // Chỉ thêm receiptImage nếu có
    if (receiptImage) {
      paymentData.receiptImage = receiptImage;
    }
    
    console.log('🔍 createPayment - Payment data to create:', paymentData);

    const payment = await Payment.create(paymentData);

    console.log('✅ createPayment - Payment created successfully:', payment._id);
    console.log('✅ Payment data after creation:', {
      id: payment._id,
      bookingId: payment.bookingId,
      method: payment.method,
      status: payment.status,
      amount: payment.amount,
      receiptImage: payment.receiptImage || null
    });
    
    // Verify receiptImage was saved
    const savedPayment = await Payment.findById(payment._id);
    console.log('🔍 createPayment - Verified saved payment receiptImage:', savedPayment?.receiptImage || 'NOT FOUND');

    // Populate thông tin booking
    await payment.populate('bookingId');
    console.log('✅ createPayment - Payment populated with booking info');

    res.status(201).json({
      success: true,
      message: "Tạo thanh toán thành công",
      payment
    });

  } catch (error) {
    console.error('❌ Create payment error:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi tạo thanh toán",
      error: error.message
    });
  }
});

// @desc    Lấy tất cả thanh toán (Admin)
// @route   GET /api/payments
// @access  Private/Admin
export const getAllPayments = asyncHandler(async (req, res) => {
  try {
    console.log('🔍 getAllPayments - Request received');
    console.log('🔍 getAllPayments - User:', req.user);
    console.log('🔍 getAllPayments - Query:', req.query);
    
    const { status, method, page = 1, limit = 10 } = req.query;
    
    // Build filter
    const filter = {};
    if (status) filter.status = status;
    if (method) filter.method = method;

    console.log('🔍 getAllPayments - Filter:', filter);

    // Pagination
    const skip = (page - 1) * limit;

    // Debug: Kiểm tra tất cả payments trước khi filter
    const allPayments = await Payment.find({});
    console.log('🔍 getAllPayments - All payments in DB:', allPayments.length);
    if (allPayments.length > 0) {
      console.log('🔍 getAllPayments - Sample payment:', allPayments[0]);
    }

    const payments = await Payment.find(filter)
      .populate({
        path: 'bookingId',
        select: 'checkInDate checkOutDate totalPrice status',
        populate: [
          {
            path: 'user',
            select: 'firstName lastName email phone'
          },
          {
            path: 'room',
            select: 'name roomNumber type price'
          }
        ]
      })
      .populate('cashierId', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Payment.countDocuments(filter);

    console.log('🔍 getAllPayments - Found payments:', payments.length);
    console.log('🔍 getAllPayments - Total:', total);
    console.log('🔍 getAllPayments - Payments data:', payments);
    
    // Debug chi tiết từng payment
    if (payments.length > 0) {
      payments.forEach((payment, index) => {
        console.log(`🔍 Payment ${index + 1}:`, {
          id: payment._id,
          amount: payment.amount,
          method: payment.method,
          status: payment.status,
          bookingId: payment.bookingId?._id,
          user: payment.bookingId?.user,
          room: payment.bookingId?.room
        });
      });
    }

    res.json({
      success: true,
      count: payments.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      payments
    });

  } catch (error) {
    console.error('❌ Get payments error:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi lấy danh sách thanh toán",
      error: error.message
    });
  }
});

// @desc    Lấy thanh toán theo ID
// @route   GET /api/payments/:id
// @access  Private
export const getPaymentById = asyncHandler(async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('bookingId')
      .populate('cashierId', 'firstName lastName');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thanh toán"
      });
    }

    // Kiểm tra quyền truy cập
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    
    if (!isAdmin && payment.bookingId.user.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền truy cập thanh toán này"
      });
    }

    // Đảm bảo receiptImage luôn có giá trị (null nếu không có)
    const paymentObj = payment.toObject();
    if (!paymentObj.hasOwnProperty('receiptImage')) {
      paymentObj.receiptImage = null;
    }

    res.json({
      success: true,
      payment: paymentObj
    });

  } catch (error) {
    console.error('❌ Get payment error:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi lấy thông tin thanh toán",
      error: error.message
    });
  }
});

// @desc    Xác nhận thanh toán (Admin)
// @route   PUT /api/payments/:id/confirm
// @access  Private/Admin
export const confirmPayment = asyncHandler(async (req, res) => {
  try {
    const { receiptNumber, notes } = req.body;
    const cashierId = req.user.id;

    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thanh toán"
      });
    }

    if (payment.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: "Thanh toán đã được xử lý"
      });
    }

    // Cập nhật trạng thái thanh toán
    await payment.markAsPaid(cashierId, receiptNumber, notes);

    // Cập nhật trạng thái booking
    const booking = await Booking.findByIdAndUpdate(payment.bookingId, {
      status: 'confirmed'
    }, { new: true });

    // Populate thông tin
    await payment.populate('bookingId');
    await payment.populate('cashierId', 'firstName lastName');

    // ✅ Gửi email xác nhận thanh toán cho khách hàng
    try {
      if (booking) {
        const user = await User.findById(booking.user);
        const room = await Room.findById(booking.room);
        
        if (user && user.email && room) {
          await emailService.sendPaymentConfirmed(booking, user, room, payment);
          console.log('✅ Payment confirmation email sent to:', user.email);
        } else {
          console.warn('⚠️ Cannot send payment confirmation email: user or room not found');
        }
      }
    } catch (emailError) {
      console.error('⚠️ Failed to send payment confirmation email:', emailError);
      // Don't fail the request if email fails
    }

    res.json({
      success: true,
      message: "Xác nhận thanh toán thành công",
      payment
    });

  } catch (error) {
    console.error('❌ Confirm payment error:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi xác nhận thanh toán",
      error: error.message
    });
  }
});

// @desc    Hủy thanh toán
// @route   PUT /api/payments/:id/cancel
// @access  Private
export const cancelPayment = asyncHandler(async (req, res) => {
  try {
    const { reason } = req.body;
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';

    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thanh toán"
      });
    }

    // Kiểm tra quyền
    if (!isAdmin && payment.bookingId.user.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền hủy thanh toán này"
      });
    }

    if (payment.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: "Không thể hủy thanh toán đã được xử lý"
      });
    }

    // Hủy thanh toán
    await payment.cancel(reason);

    // Cập nhật trạng thái booking
    const booking = await Booking.findByIdAndUpdate(payment.bookingId, {
      status: 'cancelled'
    }, { new: true });

    // ✅ Gửi email thông báo hủy thanh toán cho khách hàng
    try {
      if (booking) {
        const user = await User.findById(booking.user);
        const room = await Room.findById(booking.room);
        
        if (user && user.email && room) {
          await emailService.sendPaymentCancelled(booking, user, room, payment, reason);
          console.log('✅ Payment cancellation email sent to:', user.email);
        } else {
          console.warn('⚠️ Cannot send payment cancellation email: user or room not found');
        }
      }
    } catch (emailError) {
      console.error('⚠️ Failed to send payment cancellation email:', emailError);
      // Don't fail the request if email fails
    }

    res.json({
      success: true,
      message: "Hủy thanh toán thành công",
      payment
    });

  } catch (error) {
    console.error('❌ Cancel payment error:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi hủy thanh toán",
      error: error.message
    });
  }
});

// @desc    Hoàn tiền
// @desc    Cập nhật ảnh bill chuyển khoản cho payment
// @route   PUT /api/payments/:id/receipt-image
// @access  Private
export const updateReceiptImage = asyncHandler(async (req, res) => {
  try {
    console.log('🔍 updateReceiptImage - Request received');
    console.log('🔍 updateReceiptImage - Payment ID:', req.params.id);
    console.log('🔍 updateReceiptImage - File:', req.file);
    
    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thanh toán"
      });
    }

    // Kiểm tra quyền truy cập
    const userId = req.user.id;
    const booking = await Booking.findById(payment.bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn đặt phòng"
      });
    }

    // Chỉ cho phép user sở hữu booking hoặc admin
    if (req.user.role !== 'admin' && booking.user.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền cập nhật thanh toán này"
      });
    }

    // Cập nhật receiptImage nếu có file upload
    if (req.file) {
      payment.receiptImage = `/uploads/payments/${req.file.filename}`;
      await payment.save();
      
      console.log('✅ Receipt image updated:', payment.receiptImage);
      
      res.json({
        success: true,
        message: "Cập nhật ảnh bill thành công",
        payment
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Không có file ảnh được upload"
      });
    }

  } catch (error) {
    console.error('❌ Update receipt image error:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi cập nhật ảnh bill",
      error: error.message
    });
  }
});

// @route   PUT /api/payments/:id/refund
// @access  Private/Admin
export const refundPayment = asyncHandler(async (req, res) => {
  try {
    const { amount, reason } = req.body;

    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thanh toán"
      });
    }

    if (payment.status !== 'paid') {
      return res.status(400).json({
        success: false,
        message: "Chỉ có thể hoàn tiền thanh toán đã thanh toán"
      });
    }

    const refundAmount = amount || payment.amount;

    // Thực hiện hoàn tiền
    await payment.refund(refundAmount, reason);

    // Cập nhật trạng thái booking
    const booking = await Booking.findByIdAndUpdate(payment.bookingId, {
      status: 'cancelled'
    }, { new: true });

    // ✅ Gửi email thông báo hoàn tiền cho khách hàng
    try {
      if (booking) {
        const user = await User.findById(booking.user);
        const room = await Room.findById(booking.room);
        
        if (user && user.email && room) {
          await emailService.sendPaymentRefunded(booking, user, room, payment, refundAmount, reason);
          console.log('✅ Payment refund email sent to:', user.email);
        } else {
          console.warn('⚠️ Cannot send refund email: user or room not found');
        }
      }
    } catch (emailError) {
      console.error('⚠️ Failed to send payment refund email:', emailError);
      // Don't fail the request if email fails
    }

    res.json({
      success: true,
      message: "Hoàn tiền thành công",
      payment
    });

  } catch (error) {
    console.error('❌ Refund payment error:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi hoàn tiền",
      error: error.message
    });
  }
});

// @desc    Lấy thống kê thanh toán
// @route   GET /api/payments/stats
// @access  Private/Admin
export const getPaymentStats = asyncHandler(async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Build date filter
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // Thống kê tổng quan
    const totalPayments = await Payment.countDocuments(dateFilter);
    const paidPayments = await Payment.countDocuments({ ...dateFilter, status: 'paid' });
    const pendingPayments = await Payment.countDocuments({ ...dateFilter, status: 'pending' });
    const cancelledPayments = await Payment.countDocuments({ ...dateFilter, status: 'cancelled' });

    // Tổng doanh thu
    const revenueResult = await Payment.aggregate([
      { $match: { ...dateFilter, status: 'paid' } },
      { $group: { _id: null, totalRevenue: { $sum: '$amount' } } }
    ]);
    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

    // Thống kê theo phương thức thanh toán
    const methodStats = await Payment.aggregate([
      { $match: dateFilter },
      { $group: { _id: '$method', count: { $sum: 1 }, total: { $sum: '$amount' } } }
    ]);

    // Thống kê theo ngày (7 ngày gần nhất)
    const dailyStats = await Payment.aggregate([
      { $match: { ...dateFilter, status: 'paid' } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
          revenue: { $sum: '$amount' }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 7 }
    ]);

    res.json({
      success: true,
      stats: {
        totalPayments,
        paidPayments,
        pendingPayments,
        cancelledPayments,
        totalRevenue,
        methodStats,
        dailyStats
      }
    });

  } catch (error) {
    console.error('❌ Get payment stats error:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi lấy thống kê thanh toán",
      error: error.message
    });
  }
});

// @desc    Tạo URL thanh toán VNPay
// @route   POST /api/payments/vnpay/create
// @access  Private
export const createVnpayPayment = asyncHandler(async (req, res) => {
  try {
    const { bookingId } = req.body;
    const userId = req.user.id;

    // Kiểm tra booking
    const booking = await Booking.findById(bookingId)
      .populate('user')
      .populate('room');
    
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn đặt phòng"
      });
    }

    if (booking.user._id.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền thanh toán đơn này"
      });
    }

    // Kiểm tra đã có payment chưa
    let payment = await Payment.findOne({ bookingId });
    
    if (!payment) {
      // Tạo payment mới
      payment = await Payment.create({
        bookingId,
        amount: booking.totalPrice,
        method: 'vnpay',
        status: 'pending'
      });
    } else if (payment.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: "Đơn đặt phòng này đã được thanh toán"
      });
    }

    // Tạo VNPay payment URL
    // VNPay yêu cầu vnp_TxnRef là số, nên dùng payment._id hoặc tạo số mới
    const orderInfo = `Thanh toan don dat phong ${booking._id.toString().slice(-8)}`;
    const ipAddr = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || '127.0.0.1';
    
    // Tạo số từ payment ID (chỉ lấy phần số) hoặc dùng timestamp
    let txnRefId = payment._id.toString().replace(/[^0-9]/g, '');
    if (!txnRefId || txnRefId.length === 0) {
      // Nếu không có số, dùng timestamp
      txnRefId = Date.now().toString();
    }
    // Đảm bảo txnRef là 8 ký tự số
    txnRefId = txnRefId.slice(-8).padStart(8, '0');
    
    // Lưu txnRef vào payment để tìm lại sau
    payment.vnpayTxnRef = txnRefId;
    await payment.save();
    
    console.log('🔍 Creating VNPay URL:', {
      bookingId: booking._id,
      paymentId: payment._id,
      txnRefId,
      amount: booking.totalPrice,
      ipAddr
    });
    
    const paymentUrl = vnpayService.createPaymentUrl(
      orderInfo,
      booking.totalPrice,
      txnRefId,
      ipAddr
    );

    // Lưu payment ID để tracking
    res.json({
      success: true,
      paymentUrl,
      paymentId: payment._id,
      message: "Tạo URL thanh toán thành công"
    });

  } catch (error) {
    console.error('❌ Create VNPay payment error:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi tạo thanh toán VNPay",
      error: error.message
    });
  }
});

// @desc    VNPay callback
// @route   GET /api/payments/vnpay/callback
// @access  Public
export const vnpayCallback = asyncHandler(async (req, res) => {
  try {
    const vnp_Params = req.query;
    const result = vnpayService.verifyPaymentCallback(vnp_Params);

    if (!result.isValid) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment?status=failed&message=Invalid signature`);
    }

    // Tìm payment bằng vnpayTxnRef (vnp_TxnRef từ VNPay)
    const payment = await Payment.findOne({ vnpayTxnRef: result.orderId });
    if (!payment) {
      console.error('❌ Payment not found for txnRef:', result.orderId);
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment?status=failed&message=Payment not found`);
    }

    // Kiểm tra response code
    // 00 = Success
    if (result.responseCode === '00') {
      // Cập nhật payment
      payment.status = 'paid';
      payment.paidAt = new Date();
      payment.vnpayTransactionId = result.transactionId;
      payment.vnpayResponseCode = result.responseCode;
      await payment.save();

      // Cập nhật booking
      await Booking.findByIdAndUpdate(payment.bookingId, {
        status: 'confirmed'
      });

      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-success?paymentId=${payment._id}`);
    } else {
      // Payment failed
      payment.status = 'cancelled';
      payment.vnpayResponseCode = result.responseCode;
      await payment.save();

      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment?status=failed&code=${result.responseCode}`);
    }

  } catch (error) {
    console.error('❌ VNPay callback error:', error);
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment?status=error`);
  }
});
