import crypto from 'crypto';
import querystring from 'querystring';
import dotenv from 'dotenv';

dotenv.config();

const VNPAY_TMN_CODE = process.env.VNPAY_TMN_CODE || '';
const VNPAY_HASH_SECRET = process.env.VNPAY_HASH_SECRET || '';
const VNPAY_URL = process.env.VNPAY_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
const VNPAY_RETURN_URL = process.env.VNPAY_RETURN_URL || 'http://localhost:5000/api/payments/vnpay/callback';

/**
 * Tạo URL thanh toán VNPay
 */
export const createPaymentUrl = (orderInfo, amount, orderId, ipAddr) => {
  // Kiểm tra config
  if (!VNPAY_TMN_CODE || !VNPAY_HASH_SECRET) {
    throw new Error('VNPay configuration is missing. Please check VNPAY_TMN_CODE and VNPAY_HASH_SECRET in .env file');
  }

  const date = new Date();
  const createDate = date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const expireDate = new Date(date.getTime() + 15 * 60 * 1000) // 15 phút
    .toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  // VNPay yêu cầu vnp_TxnRef phải là số (tối đa 8 ký tự)
  // Tạo số từ orderId hoặc timestamp + random
  let txnRef;
  if (typeof orderId === 'string' && /^[0-9]+$/.test(orderId)) {
    // Nếu orderId là số, dùng trực tiếp (cắt tối đa 8 ký tự)
    txnRef = orderId.slice(-8).padStart(8, '0');
  } else {
    // Tạo số từ timestamp + random (8 ký tự)
    const timestamp = Date.now().toString();
    const random = Math.floor(Math.random() * 1000).toString();
    txnRef = (timestamp.slice(-5) + random.padStart(3, '0')).slice(-8);
  }

  // Giới hạn orderInfo tối đa 255 ký tự và loại bỏ ký tự đặc biệt
  const cleanOrderInfo = orderInfo
    .substring(0, 255)
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim();

  const vnp_Params = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: VNPAY_TMN_CODE,
    vnp_Locale: 'vn',
    vnp_CurrCode: 'VND',
    vnp_TxnRef: txnRef,
    vnp_OrderInfo: cleanOrderInfo || 'Thanh toan don hang',
    vnp_OrderType: 'other',
    vnp_Amount: Math.round(amount * 100), // VNPay yêu cầu số tiền nhân 100, phải là số nguyên
    vnp_ReturnUrl: VNPAY_RETURN_URL,
    vnp_IpAddr: ipAddr || '127.0.0.1',
    vnp_CreateDate: createDate,
    vnp_ExpireDate: expireDate,
  };

  // Sắp xếp params theo thứ tự alphabet
  const sortedParams = Object.keys(vnp_Params)
    .sort()
    .reduce((result, key) => {
      result[key] = vnp_Params[key];
      return result;
    }, {});

  // Tạo query string (không encode)
  const signData = querystring.stringify(sortedParams, { encode: false });
  
  // Tạo chữ ký
  const hmac = crypto.createHmac('sha512', VNPAY_HASH_SECRET);
  const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
  
  // Thêm chữ ký vào params
  vnp_Params['vnp_SecureHash'] = signed;

  // Tạo URL thanh toán
  const paymentUrl = VNPAY_URL + '?' + querystring.stringify(vnp_Params, { encode: false });
  
  console.log('🔍 VNPay Payment URL created:', {
    txnRef,
    amount: vnp_Params.vnp_Amount,
    orderInfo: cleanOrderInfo,
    hasTmnCode: !!VNPAY_TMN_CODE,
    hasHashSecret: !!VNPAY_HASH_SECRET
  });
  
  return paymentUrl;
};

/**
 * Xác thực callback từ VNPay
 */
export const verifyPaymentCallback = (vnp_Params) => {
  const secureHash = vnp_Params['vnp_SecureHash'];
  delete vnp_Params['vnp_SecureHash'];
  delete vnp_Params['vnp_SecureHashType'];

  // Sắp xếp params
  const sortedParams = Object.keys(vnp_Params)
    .sort()
    .reduce((result, key) => {
      if (vnp_Params[key]) {
        result[key] = vnp_Params[key];
      }
      return result;
    }, {});

  // Tạo query string
  const signData = querystring.stringify(sortedParams, { encode: false });
  
  // Tạo chữ ký
  const hmac = crypto.createHmac('sha512', VNPAY_HASH_SECRET);
  const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

  // So sánh chữ ký
  if (secureHash === signed) {
    return {
      isValid: true,
      orderId: vnp_Params['vnp_TxnRef'],
      transactionId: vnp_Params['vnp_TransactionNo'],
      amount: parseInt(vnp_Params['vnp_Amount']) / 100,
      responseCode: vnp_Params['vnp_ResponseCode'],
      orderInfo: vnp_Params['vnp_OrderInfo'],
    };
  }

  return { isValid: false };
};

export default {
  createPaymentUrl,
  verifyPaymentCallback,
};

