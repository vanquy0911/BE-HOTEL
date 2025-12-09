import asyncHandler from "express-async-handler";
import Payment from "../Models/PaymentModel.js";
import Booking from "../Models/BookingModel.js";
import User from "../Models/UserModel.js";
import crypto from "crypto";
import axios from "axios";

export const createPayment = asyncHandler(async (req, res) => {
  try {
    const { bookingId, amount, method, notes } = req.body;
    const userId = req.user.id;

    if (!bookingId || !amount || !method) {
      return res.status(400).json({
        success: false,
        message: "Thiếu thông tin bắt buộc"
      });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Không tìm thấy đơn đặt phòng" });
    }

    if (booking.user.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Bạn không có quyền truy cập" });
    }

    const existingPayment = await Payment.findOne({ bookingId });
    if (existingPayment) {
      return res.status(400).json({
        success: false,
        message: "Đơn đặt phòng này đã có thanh toán"
      });
    }

    const payment = await Payment.create({
      bookingId,
      amount,
      method,
      notes,
      status: 'pending'
    });

    await payment.populate("bookingId");

    res.status(201).json({
      success: true,
      message: "Tạo thanh toán thành công",
      payment
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
});


export const createMomoPayment = asyncHandler(async (req, res) => {
  try {
    const { bookingId, amount } = req.body;
    const userId = req.user.id;

    if (!bookingId || !amount) {
      return res.status(400).json({ success: false, message: "Thiếu thông tin (bookingId hoặc amount)" });
    }

    // ==== KIỂM TRA BOOKING ====
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ success: false, message: "Không tìm thấy booking" });
    if (booking.user.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Không có quyền thực hiện thanh toán này" });
    }

    // ==== MoMo Config (theo sample MoMo) ====
    const partnerCode = process.env.MOMO_PARTNER_CODE || "MOMO";
    const accessKey = process.env.MOMO_ACCESS_KEY || "F8BBA842ECF85";
    const secretKey = process.env.MOMO_SECRET_KEY || "K951B6PE1waDMi640xX08PD3vg6EkVlz";
    const endpoint = "https://test-payment.momo.vn/v2/gateway/api/create";

    const redirectUrl =
      process.env.MOMO_RETURN_URL || "https://webhook.site/b3088a6a-2d17-4f8d-a383-71389a6c600b";
    const ipnUrl =
      process.env.MOMO_NOTIFY_URL || "https://webhook.site/b3088a6a-2d17-4f8d-a383-71389a6c600b";

    const requestType = "payWithMethod"; // theo code mẫu của MoMo
    const orderInfo = "Thanh toán booking qua MoMo";

    const orderId = partnerCode + Date.now();
    const requestId = orderId;
    const extraData = "";
    const autoCapture = true;
    const amountStr = String(Number(amount));

    // === Tạo rawSignature đúng thứ tự ===
    const rawSignature =
      `accessKey=${accessKey}&amount=${amountStr}&extraData=${extraData}` +
      `&ipnUrl=${ipnUrl}&orderId=${orderId}&orderInfo=${orderInfo}` +
      `&partnerCode=${partnerCode}&redirectUrl=${redirectUrl}` +
      `&requestId=${requestId}&requestType=${requestType}`;

    console.log("RAW SIGNATURE:", rawSignature);

    const signature = crypto
      .createHmac("sha256", secretKey)
      .update(rawSignature)
      .digest("hex");

    console.log("SIGNATURE:", signature);

    // === BODY GỬI LÊN MOMO ===
    const requestBody = {
      partnerCode: partnerCode,
      partnerName: "TestStore",
      storeId: "MomoTestStore",
      requestId: requestId,
      amount: amountStr,
      orderId: orderId,
      orderInfo: orderInfo,
      redirectUrl: redirectUrl,
      ipnUrl: ipnUrl,
      lang: "vi",
      requestType: requestType,
      autoCapture: autoCapture,
      extraData: extraData,
      signature: signature,
    };

    console.log("REQUEST BODY:", requestBody);

    // === GỌI MOMO ===
    const momoRes = await axios.post(endpoint, requestBody, {
      headers: { "Content-Type": "application/json" },
    });

    console.log("MOMO RESPONSE:", momoRes.data);

    if (!momoRes.data || momoRes.data.resultCode !== 0) {
      return res.status(400).json({
        success: false,
        message: "MoMo trả về lỗi",
        momoData: momoRes.data,
      });
    }

    // === LƯU PAYMENT PENDING (nếu cần) ===
    await Payment.create({
      bookingId,
      amount: Number(amountStr),
      method: "momo",
      status: "pending",
      momoOrderId: orderId,
      momoRequestId: requestId,
    });

    // === TRẢ PAYURL VỀ FE ===
    return res.json({
      success: true,
      payUrl: momoRes.data.payUrl,
    });

  } catch (error) {
    console.error("MoMo Payment Error:", error);
    return res.status(500).json({
      success: false,
      message: "Lỗi tạo thanh toán MoMo",
      error: error.message,
    });
  }
});

export const momoIPN = async (req, res) => {
  try {
    console.log("🔔 ========== MoMo IPN Received ==========");
    console.log("🔔 IPN Body:", JSON.stringify(req.body, null, 2));
    console.log("🔔 IPN Headers:", JSON.stringify(req.headers, null, 2));
    
    const data = req.body;

    const {
      partnerCode,
      orderId,
      requestId,
      amount,
      orderInfo,
      orderType,
      transId,
      resultCode,
      message,
      payType,
      responseTime,
      extraData,
      signature,
    } = data;

    console.log("🔔 IPN Data extracted:", {
      orderId,
      resultCode,
      message,
      transId,
      amount
    });

    // === VERIFY SIGNATURE ===
    const accessKey = process.env.MOMO_ACCESS_KEY;
    const secretKey = process.env.MOMO_SECRET_KEY;

    if (!accessKey || !secretKey) {
      console.error("❌ Missing MOMO_ACCESS_KEY or MOMO_SECRET_KEY in environment");
      return res.status(500).json({ message: "Server configuration error" });
    }

    const rawSignature =
      `accessKey=${accessKey}&amount=${amount}&extraData=${extraData}` +
      `&message=${message}&orderId=${orderId}&orderInfo=${orderInfo}` +
      `&orderType=${orderType}&partnerCode=${partnerCode}&payType=${payType}` +
      `&requestId=${requestId}&responseTime=${responseTime}` +
      `&resultCode=${resultCode}&transId=${transId}`;

    const checkSignature = crypto
      .createHmac("sha256", secretKey)
      .update(rawSignature)
      .digest("hex");

    console.log("🔔 Signature check:", {
      received: signature?.substring(0, 20) + "...",
      calculated: checkSignature?.substring(0, 20) + "...",
      match: signature === checkSignature
    });

    if (signature !== checkSignature) {
      console.log("❌ Sai chữ ký MoMo → từ chối IPN");
      console.log("❌ Expected:", checkSignature);
      console.log("❌ Received:", signature);
      return res.status(403).json({ message: "Invalid signature" });
    }

    // === PAYMENT FAILED ===
    if (resultCode !== 0) {
      console.log("⚠️ Payment failed with resultCode:", resultCode, "Message:", message);
      return res.status(200).json({ message: "Payment failed" });
    }

    console.log("✅ Payment successful, updating database...");

    // ==== UPDATE PAYMENT ====
    const payment = await Payment.findOneAndUpdate(
      { momoOrderId: orderId },
      {
        status: "paid",
        momoTransactionId: transId,
        momoResultCode: resultCode,
        momoMessage: message,
        paidAt: new Date()
      },
      { new: true }
    );

    if (!payment) {
      console.log("❌ Payment not found with momoOrderId:", orderId);
      console.log("❌ Searching for payment with orderId:", orderId);
      const allPayments = await Payment.find({ method: "momo" }).limit(5);
      console.log("❌ Recent MoMo payments:", allPayments.map(p => ({
        id: p._id,
        momoOrderId: p.momoOrderId,
        status: p.status
      })));
      return res.status(404).json({ message: "Payment not found" });
    }

    console.log("✅ Payment updated:", {
      paymentId: payment._id,
      bookingId: payment.bookingId,
      status: payment.status,
      amount: payment.amount
    });

    // ==== UPDATE BOOKING STATUS ====
    // Cập nhật status của booking thành confirmed khi thanh toán thành công
    const booking = await Booking.findByIdAndUpdate(
      payment.bookingId,
      { status: "confirmed" },
      { new: true }
    );

    if (!booking) {
      console.log("⚠️ Booking not found:", payment.bookingId);
    } else {
      console.log("✅ Booking updated:", {
        bookingId: booking._id,
        status: booking.status
      });
    }

    console.log("🎉 ========== IPN Processed Successfully ==========");
    console.log("🎉 OrderId:", orderId);
    console.log("🎉 TransactionId:", transId);

    return res.status(200).json({ 
      message: "IPN processed",
      orderId,
      transId
    });
  } catch (err) {
    console.error("❌ ========== IPN Error ==========");
    console.error("❌ Error:", err);
    console.error("❌ Stack:", err.stack);
    return res.status(500).json({ 
      message: "IPN Error",
      error: err.message 
    });
  }
};



export const getAllPayments = asyncHandler(async (req, res) => {
  try {
    const { status, method } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (method) filter.method = method;

    const payments = await Payment.find(filter)
      .populate({
        path: "bookingId",
        select: "checkInDate checkOutDate totalPrice status",
        populate: [
          { path: "user", select: "firstName lastName email phone" },
          { path: "room", select: "name roomNumber type price" }
        ]
      })
      .populate("cashierId", "firstName lastName")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      payments
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
});


export const getPaymentById = asyncHandler(async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate("bookingId")
      .populate("cashierId", "firstName lastName");

    if (!payment)
      return res.status(404).json({ success: false, message: "Không tìm thấy thanh toán" });

    const userId = req.user.id;
    const isAdmin = req.user.role === "admin";

    if (!isAdmin && payment.bookingId.user.toString() !== userId)
      return res.status(403).json({ success: false, message: "Không có quyền truy cập" });

    res.json({ success: true, payment });

  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
});


export const confirmPayment = asyncHandler(async (req, res) => {
  try {
    const { receiptNumber, notes } = req.body;
    const cashierId = req.user.id;

    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: "Không tìm thấy thanh toán" });

    if (payment.status !== "pending")
      return res.status(400).json({ success: false, message: "Thanh toán đã xử lý" });

    await payment.markAsPaid(cashierId, receiptNumber, notes);

    await Booking.findByIdAndUpdate(payment.bookingId, { status: "confirmed" });

    await payment.populate("bookingId");
    await payment.populate("cashierId", "firstName lastName");

    res.json({ success: true, message: "Xác nhận thanh toán thành công", payment });

  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
});


export const cancelPayment = asyncHandler(async (req, res) => {
  try {
    const { reason } = req.body;

    const payment = await Payment.findById(req.params.id);

    if (!payment) return res.status(404).json({ success: false, message: "Không tìm thấy thanh toán" });

    if (payment.status !== "pending")
      return res.status(400).json({ success: false, message: "Không thể hủy thanh toán" });

    await payment.cancel(reason);

    await Booking.findByIdAndUpdate(payment.bookingId, { status: "cancelled" });

    res.json({ success: true, message: "Hủy thanh toán thành công", payment });

  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
});


export const refundPayment = asyncHandler(async (req, res) => {
  try {
    const { amount, reason } = req.body;

    const payment = await Payment.findById(req.params.id);

    if (!payment)
      return res.status(404).json({ success: false, message: "Không tìm thấy thanh toán" });

    if (payment.status !== "paid")
      return res.status(400).json({ success: false, message: "Chỉ hoàn tiền thanh toán đã trả" });

    const refundAmount = amount || payment.amount;

    await payment.refund(refundAmount, reason);

    await Booking.findByIdAndUpdate(payment.bookingId, { status: "cancelled" });

    res.json({ success: true, message: "Hoàn tiền thành công", payment });

  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
});


export const getPaymentStats = asyncHandler(async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    const totalPayments = await Payment.countDocuments(dateFilter);
    const paidPayments = await Payment.countDocuments({ ...dateFilter, status: "paid" });
    const pendingPayments = await Payment.countDocuments({ ...dateFilter, status: "pending" });
    const cancelledPayments = await Payment.countDocuments({ ...dateFilter, status: "cancelled" });

    const revenueResult = await Payment.aggregate([
      { $match: { ...dateFilter, status: "paid" } },
      { $group: { _id: null, totalRevenue: { $sum: "$amount" } } }
    ]);

    const totalRevenue = revenueResult[0]?.totalRevenue || 0;

    res.json({
      success: true,
      stats: {
        totalPayments,
        paidPayments,
        pendingPayments,
        cancelledPayments,
        totalRevenue
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
});
