import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Tạo transporter
const createTransporter = () => {
  // Nếu có SMTP config
  if (process.env.SMTP_HOST && process.env.SMTP_PORT) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  
  // Fallback: Gmail (cần app password)
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  
  // Fallback: EMAIL_USER và EMAIL_PASS (tương thích với code cũ)
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }
  
  // Development: Log email instead of sending
  console.warn('⚠️ No email config found, emails will be logged only');
  return null;
};

// Email templates
const emailTemplates = {
  bookingConfirmation: (booking, user, room, payment = null) => {
    const checkIn = new Date(booking.checkInDate).toLocaleDateString('vi-VN');
    const checkOut = new Date(booking.checkOutDate).toLocaleDateString('vi-VN');
    const nights = Math.ceil((new Date(booking.checkOutDate) - new Date(booking.checkInDate)) / (1000 * 60 * 60 * 24));
    const baseUrl = process.env.API_BASE_URL || process.env.BACKEND_URL || 'http://localhost:5000';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    // Tính toán giá chi tiết
    const subtotal = booking.totalPrice - (booking.discountAmount || 0);
    const tax = subtotal * 0.1;
    const priceBeforeTax = subtotal - tax;
    const pricePerNight = room.pricePerNight || Math.round(priceBeforeTax / nights / (booking.roomQuantity || 1));
    
    // Xử lý payment info
    let paymentSection = '';
    let receiptImageSection = '';
    
    if (payment) {
      const paymentMethodText = {
        'vnpay': 'Thanh toán trực tuyến (VNPay)',
        'bank_transfer': 'Chuyển khoản ngân hàng',
        'cash': 'Tiền mặt',
        'credit_card': 'Thẻ tín dụng'
      };
      
      const paymentStatusText = {
        'pending': 'Chờ xác nhận',
        'paid': 'Đã thanh toán',
        'cancelled': 'Đã hủy',
        'refunded': 'Đã hoàn tiền'
      };
      
      const paymentStatusColor = {
        'pending': '#f59e0b',
        'paid': '#10b981',
        'cancelled': '#ef4444',
        'refunded': '#6b7280'
      };
      
      paymentSection = `
        <div class="booking-info" style="margin-top: 20px;">
          <h3>Thông tin thanh toán</h3>
          <div class="info-row">
            <span>Phương thức thanh toán:</span>
            <strong>${paymentMethodText[payment.method] || payment.method}</strong>
          </div>
          <div class="info-row">
            <span>Số tiền:</span>
            <strong>${payment.amount.toLocaleString('vi-VN')} VND</strong>
          </div>
          <div class="info-row">
            <span>Trạng thái:</span>
            <strong style="color: ${paymentStatusColor[payment.status] || '#6b7280'}">
              ${paymentStatusText[payment.status] || payment.status}
            </strong>
          </div>
          ${payment.receiptNumber ? `
            <div class="info-row">
              <span>Số biên lai:</span>
              <strong>${payment.receiptNumber}</strong>
            </div>
          ` : ''}
          ${payment.paidAt ? `
            <div class="info-row">
              <span>Ngày thanh toán:</span>
              <strong>${new Date(payment.paidAt).toLocaleDateString('vi-VN')}</strong>
            </div>
          ` : ''}
        </div>
      `;
      
      // Hiển thị ảnh bill nếu có
      if (payment.receiptImage) {
        const receiptImageUrl = payment.receiptImage.startsWith('http') 
          ? payment.receiptImage 
          : `${baseUrl}${payment.receiptImage}`;
        
        receiptImageSection = `
          <div class="booking-info" style="margin-top: 20px;">
            <h3>Ảnh biên lai chuyển khoản</h3>
            <div style="text-align: center; margin: 20px 0;">
              <img src="${receiptImageUrl}" alt="Biên lai chuyển khoản" style="max-width: 100%; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
            </div>
            <p style="text-align: center; color: #6b7280; font-size: 14px;">Vui lòng lưu ảnh này để làm bằng chứng thanh toán</p>
          </div>
        `;
      }
    }
    
    return {
      subject: `Xác nhận đặt phòng #${booking._id.toString().slice(-8)} - Rayal Park Hotel`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #ec4899, #f43f5e); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .booking-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
            .info-row:last-child { border-bottom: none; }
            .invoice-section { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .invoice-title { border-bottom: 2px solid #ec4899; padding-bottom: 10px; margin-bottom: 15px; }
            .invoice-row { display: flex; justify-content: space-between; padding: 8px 0; }
            .invoice-total { border-top: 2px solid #e5e7eb; margin-top: 10px; padding-top: 10px; font-size: 18px; font-weight: bold; color: #ec4899; }
            .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
            .button { display: inline-block; padding: 12px 24px; background: #ec4899; color: white; text-decoration: none; border-radius: 6px; margin-top: 20px; }
            .note-box { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Đặt Phòng Thành Công!</h1>
              <p>Rayal Park Hotel</p>
            </div>
            <div class="content">
              <p>Xin chào <strong>${user.fullName}</strong>,</p>
              <p>Cảm ơn bạn đã đặt phòng tại Rayal Park Hotel. Chúng tôi đã nhận được yêu cầu đặt phòng của bạn.</p>
              
              <div class="booking-info">
                <h3>Thông tin đặt phòng</h3>
                <div class="info-row">
                  <span>Mã đặt phòng:</span>
                  <strong>#${booking._id.toString().slice(-8)}</strong>
                </div>
                <div class="info-row">
                  <span>Phòng:</span>
                  <strong>${room.name}</strong>
                </div>
                ${room.roomNumber ? `
                  <div class="info-row">
                    <span>Số phòng:</span>
                    <strong>${room.roomNumber}</strong>
                  </div>
                ` : ''}
                <div class="info-row">
                  <span>Check-in:</span>
                  <strong>${checkIn}</strong>
                </div>
                <div class="info-row">
                  <span>Check-out:</span>
                  <strong>${checkOut}</strong>
                </div>
                <div class="info-row">
                  <span>Số đêm:</span>
                  <strong>${nights} đêm</strong>
                </div>
                ${booking.roomQuantity ? `
                  <div class="info-row">
                    <span>Số lượng phòng:</span>
                    <strong>${booking.roomQuantity} phòng</strong>
                  </div>
                ` : ''}
                <div class="info-row">
                  <span>Trạng thái:</span>
                  <strong style="color: ${booking.status === 'confirmed' ? '#10b981' : '#f59e0b'}">
                    ${booking.status === 'confirmed' ? 'Đã xác nhận' : 'Chờ xác nhận'}
                  </strong>
                </div>
              </div>
              
              <div class="invoice-section">
                <div class="invoice-title">
                  <h3>Hóa đơn chi tiết</h3>
                </div>
                <div class="invoice-row">
                  <span>Giá phòng/đêm:</span>
                  <strong>${pricePerNight.toLocaleString('vi-VN')} VND</strong>
                </div>
                <div class="invoice-row">
                  <span>Số đêm:</span>
                  <strong>${nights} đêm</strong>
                </div>
                ${booking.roomQuantity ? `
                  <div class="invoice-row">
                    <span>Số lượng phòng:</span>
                    <strong>${booking.roomQuantity} phòng</strong>
                  </div>
                ` : ''}
                <div class="invoice-row">
                  <span>Tạm tính:</span>
                  <strong>${priceBeforeTax.toLocaleString('vi-VN')} VND</strong>
                </div>
                <div class="invoice-row">
                  <span>Thuế (10%):</span>
                  <strong>${tax.toLocaleString('vi-VN')} VND</strong>
                </div>
                ${booking.discountAmount ? `
                  <div class="invoice-row" style="color: #10b981;">
                    <span>Giảm giá:</span>
                    <strong>-${booking.discountAmount.toLocaleString('vi-VN')} VND</strong>
                  </div>
                ` : ''}
                <div class="invoice-row invoice-total">
                  <span>Tổng cộng:</span>
                  <strong>${booking.totalPrice.toLocaleString('vi-VN')} VND</strong>
                </div>
              </div>
              
              ${paymentSection}
              ${receiptImageSection}
              
              ${booking.status === 'pending' ? `
                <div class="note-box">
                  <p><strong>Lưu ý:</strong> Đơn đặt phòng của bạn đang chờ xác nhận. Chúng tôi sẽ liên hệ với bạn sớm nhất.</p>
                </div>
              ` : ''}
              
              ${payment && payment.status === 'pending' ? `
                <div class="note-box">
                  <p><strong>Lưu ý về thanh toán:</strong> Thanh toán của bạn đang chờ xác nhận. Vui lòng chờ admin xác nhận thanh toán.</p>
                </div>
              ` : ''}
              
              <div style="text-align: center;">
                <a href="${frontendUrl}/my-bookings" class="button">Xem chi tiết đặt phòng</a>
              </div>
            </div>
            <div class="footer">
              <p>Rayal Park Hotel | Hotline: 1900-xxxx | Email: info@rayalpark.com</p>
              <p>© ${new Date().getFullYear()} Rayal Park Hotel. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };
  },
  
  paymentConfirmed: (booking, user, room, payment) => {
    const checkIn = new Date(booking.checkInDate).toLocaleDateString('vi-VN');
    const checkOut = new Date(booking.checkOutDate).toLocaleDateString('vi-VN');
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    return {
      subject: `Xác nhận thanh toán thành công #${booking._id.toString().slice(-8)} - Rayal Park Hotel`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .success-box { background: #d1fae5; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .booking-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
            .info-row:last-child { border-bottom: none; }
            .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
            .button { display: inline-block; padding: 12px 24px; background: #10b981; color: white; text-decoration: none; border-radius: 6px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✅ Thanh Toán Đã Được Xác Nhận!</h1>
              <p>Rayal Park Hotel</p>
            </div>
            <div class="content">
              <p>Xin chào <strong>${user.fullName}</strong>,</p>
              
              <div class="success-box">
                <p><strong>🎉 Chúc mừng!</strong> Thanh toán của bạn đã được xác nhận thành công.</p>
              </div>
              
              <div class="booking-info">
                <h3>Thông tin đặt phòng</h3>
                <div class="info-row">
                  <span>Mã đặt phòng:</span>
                  <strong>#${booking._id.toString().slice(-8)}</strong>
                </div>
                <div class="info-row">
                  <span>Phòng:</span>
                  <strong>${room.name}</strong>
                </div>
                <div class="info-row">
                  <span>Check-in:</span>
                  <strong>${checkIn}</strong>
                </div>
                <div class="info-row">
                  <span>Check-out:</span>
                  <strong>${checkOut}</strong>
                </div>
                <div class="info-row">
                  <span>Số tiền đã thanh toán:</span>
                  <strong style="color: #10b981;">${payment.amount.toLocaleString('vi-VN')} VND</strong>
                </div>
                ${payment.receiptNumber ? `
                  <div class="info-row">
                    <span>Số biên lai:</span>
                    <strong>${payment.receiptNumber}</strong>
                  </div>
                ` : ''}
                <div class="info-row">
                  <span>Ngày xác nhận:</span>
                  <strong>${new Date(payment.paidAt || new Date()).toLocaleDateString('vi-VN')}</strong>
                </div>
              </div>
              
              <p>Đơn đặt phòng của bạn đã được xác nhận. Chúng tôi rất mong được đón tiếp bạn tại Rayal Park Hotel!</p>
              
              <div style="text-align: center;">
                <a href="${frontendUrl}/my-bookings" class="button">Xem chi tiết đặt phòng</a>
              </div>
            </div>
            <div class="footer">
              <p>Rayal Park Hotel | Hotline: 1900-xxxx | Email: info@rayalpark.com</p>
              <p>© ${new Date().getFullYear()} Rayal Park Hotel. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };
  },
  
  bookingCancelled: (booking, user, room, payment = null, reason = null) => {
    const checkIn = new Date(booking.checkInDate).toLocaleDateString('vi-VN');
    const checkOut = new Date(booking.checkOutDate).toLocaleDateString('vi-VN');
    const nights = Math.ceil((new Date(booking.checkOutDate) - new Date(booking.checkInDate)) / (1000 * 60 * 60 * 24));
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    // Kiểm tra xem có hoàn tiền không
    let refundInfo = '';
    if (payment && payment.status === 'paid') {
      refundInfo = `
        <div class="warning-box" style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <p><strong>💰 Thông tin hoàn tiền:</strong></p>
          <p>Số tiền đã thanh toán: <strong>${payment.amount.toLocaleString('vi-VN')} VND</strong></p>
          <p>Chúng tôi sẽ xử lý hoàn tiền trong vòng 5-7 ngày làm việc. Tiền sẽ được hoàn về tài khoản/ngân hàng bạn đã sử dụng để thanh toán.</p>
          ${payment.refundAmount ? `
            <p>Số tiền hoàn: <strong style="color: #10b981;">${payment.refundAmount.toLocaleString('vi-VN')} VND</strong></p>
          ` : ''}
        </div>
      `;
    }
    
    return {
      subject: `Hủy đặt phòng #${booking._id.toString().slice(-8)} - Rayal Park Hotel`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .info-box { background: #fee2e2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .booking-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
            .info-row:last-child { border-bottom: none; }
            .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
            .button { display: inline-block; padding: 12px 24px; background: #ef4444; color: white; text-decoration: none; border-radius: 6px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>❌ Đặt Phòng Đã Bị Hủy</h1>
              <p>Rayal Park Hotel</p>
            </div>
            <div class="content">
              <p>Xin chào <strong>${user.fullName}</strong>,</p>
              
              <div class="info-box">
                <p><strong>Thông báo quan trọng:</strong> Đặt phòng của bạn đã được hủy.</p>
              </div>
              
              <div class="booking-info">
                <h3>Thông tin đặt phòng đã hủy</h3>
                <div class="info-row">
                  <span>Mã đặt phòng:</span>
                  <strong>#${booking._id.toString().slice(-8)}</strong>
                </div>
                <div class="info-row">
                  <span>Phòng:</span>
                  <strong>${room.name}</strong>
                </div>
                ${room.roomNumber ? `
                  <div class="info-row">
                    <span>Số phòng:</span>
                    <strong>${room.roomNumber}</strong>
                  </div>
                ` : ''}
                <div class="info-row">
                  <span>Check-in:</span>
                  <strong>${checkIn}</strong>
                </div>
                <div class="info-row">
                  <span>Check-out:</span>
                  <strong>${checkOut}</strong>
                </div>
                <div class="info-row">
                  <span>Số đêm:</span>
                  <strong>${nights} đêm</strong>
                </div>
                <div class="info-row">
                  <span>Tổng tiền:</span>
                  <strong>${booking.totalPrice.toLocaleString('vi-VN')} VND</strong>
                </div>
                ${reason ? `
                  <div class="info-row">
                    <span>Lý do hủy:</span>
                    <strong>${reason}</strong>
                  </div>
                ` : ''}
                <div class="info-row">
                  <span>Ngày hủy:</span>
                  <strong>${new Date().toLocaleDateString('vi-VN')}</strong>
                </div>
              </div>
              
              ${refundInfo}
              
              <p>Nếu bạn có bất kỳ câu hỏi nào về việc hủy đặt phòng, vui lòng liên hệ với chúng tôi qua email hoặc hotline.</p>
              
              <div style="text-align: center;">
                <a href="${frontendUrl}/my-bookings" class="button">Xem danh sách đặt phòng</a>
              </div>
            </div>
            <div class="footer">
              <p>Rayal Park Hotel | Hotline: 1900-xxxx | Email: info@rayalpark.com</p>
              <p>© ${new Date().getFullYear()} Rayal Park Hotel. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };
  },
  
  paymentRefunded: (booking, user, room, payment, refundAmount, reason = null) => {
    const checkIn = new Date(booking.checkInDate).toLocaleDateString('vi-VN');
    const checkOut = new Date(booking.checkOutDate).toLocaleDateString('vi-VN');
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    return {
      subject: `Hoàn tiền thành công #${booking._id.toString().slice(-8)} - Rayal Park Hotel`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .success-box { background: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .booking-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .refund-box { background: #f0fdf4; border: 2px solid #10b981; padding: 20px; margin: 20px 0; border-radius: 8px; text-align: center; }
            .refund-amount { font-size: 32px; font-weight: bold; color: #10b981; margin: 10px 0; }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
            .info-row:last-child { border-bottom: none; }
            .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
            .button { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>💰 Hoàn Tiền Thành Công!</h1>
              <p>Rayal Park Hotel</p>
            </div>
            <div class="content">
              <p>Xin chào <strong>${user.fullName}</strong>,</p>
              
              <div class="success-box">
                <p><strong>✅ Thông báo:</strong> Yêu cầu hoàn tiền của bạn đã được xử lý thành công.</p>
              </div>
              
              <div class="refund-box">
                <p style="margin: 0; font-size: 14px; color: #6b7280;">Số tiền hoàn</p>
                <div class="refund-amount">${refundAmount.toLocaleString('vi-VN')} VND</div>
                <p style="margin: 0; font-size: 14px; color: #6b7280;">Tiền sẽ được hoàn trong vòng 5-7 ngày làm việc</p>
              </div>
              
              <div class="booking-info">
                <h3>Thông tin đặt phòng</h3>
                <div class="info-row">
                  <span>Mã đặt phòng:</span>
                  <strong>#${booking._id.toString().slice(-8)}</strong>
                </div>
                <div class="info-row">
                  <span>Phòng:</span>
                  <strong>${room.name}</strong>
                </div>
                <div class="info-row">
                  <span>Check-in:</span>
                  <strong>${checkIn}</strong>
                </div>
                <div class="info-row">
                  <span>Check-out:</span>
                  <strong>${checkOut}</strong>
                </div>
                <div class="info-row">
                  <span>Số tiền đã thanh toán:</span>
                  <strong>${payment.amount.toLocaleString('vi-VN')} VND</strong>
                </div>
                <div class="info-row">
                  <span>Phương thức thanh toán:</span>
                  <strong>${payment.method === 'vnpay' ? 'Thanh toán trực tuyến (VNPay)' : payment.method === 'bank_transfer' ? 'Chuyển khoản ngân hàng' : payment.method}</strong>
                </div>
                ${reason ? `
                  <div class="info-row">
                    <span>Lý do hoàn tiền:</span>
                    <strong>${reason}</strong>
                  </div>
                ` : ''}
                <div class="info-row">
                  <span>Ngày hoàn tiền:</span>
                  <strong>${new Date().toLocaleDateString('vi-VN')}</strong>
                </div>
              </div>
              
              <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px;">
                <p><strong>📌 Lưu ý:</strong></p>
                <ul style="margin: 10px 0; padding-left: 20px;">
                  <li>Tiền sẽ được hoàn về tài khoản/ngân hàng bạn đã sử dụng để thanh toán</li>
                  <li>Thời gian xử lý: 5-7 ngày làm việc (không tính thứ 7, chủ nhật và ngày lễ)</li>
                  <li>Nếu sau 7 ngày làm việc bạn chưa nhận được tiền, vui lòng liên hệ với chúng tôi</li>
                </ul>
              </div>
              
              <p>Nếu bạn có bất kỳ câu hỏi nào về việc hoàn tiền, vui lòng liên hệ với chúng tôi qua email hoặc hotline.</p>
              
              <div style="text-align: center;">
                <a href="${frontendUrl}/my-bookings" class="button">Xem chi tiết đặt phòng</a>
              </div>
            </div>
            <div class="footer">
              <p>Rayal Park Hotel | Hotline: 1900-xxxx | Email: info@rayalpark.com</p>
              <p>© ${new Date().getFullYear()} Rayal Park Hotel. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };
  },
  
  userRegistered: (user) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    return {
      subject: 'Chào mừng đến với Rayal Park Hotel! 🎉',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #ec4899, #f43f5e); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .welcome-box { background: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .user-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
            .info-row:last-child { border-bottom: none; }
            .features { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .feature-item { padding: 10px 0; display: flex; align-items: center; }
            .feature-item i { margin-right: 10px; color: #ec4899; font-size: 20px; }
            .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
            .button { display: inline-block; padding: 12px 24px; background: #ec4899; color: white; text-decoration: none; border-radius: 6px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Chào Mừng!</h1>
              <p>Rayal Park Hotel</p>
            </div>
            <div class="content">
              <p>Xin chào <strong>${user.fullName}</strong>,</p>
              
              <div class="welcome-box">
                <p><strong>🎊 Cảm ơn bạn đã đăng ký tài khoản tại Rayal Park Hotel!</strong></p>
                <p>Chúng tôi rất vui mừng được chào đón bạn trở thành thành viên của gia đình Rayal Park Hotel.</p>
              </div>
              
              <div class="user-info">
                <h3>Thông tin tài khoản của bạn</h3>
                <div class="info-row">
                  <span>Họ và tên:</span>
                  <strong>${user.fullName}</strong>
                </div>
                <div class="info-row">
                  <span>Email:</span>
                  <strong>${user.email}</strong>
                </div>
                ${user.phone ? `
                  <div class="info-row">
                    <span>Số điện thoại:</span>
                    <strong>${user.phone}</strong>
                  </div>
                ` : ''}
                <div class="info-row">
                  <span>Ngày đăng ký:</span>
                  <strong>${new Date().toLocaleDateString('vi-VN')}</strong>
                </div>
              </div>
              
              <div class="features">
                <h3>✨ Bạn có thể làm gì với tài khoản?</h3>
                <div class="feature-item">
                  <i>🏨</i>
                  <span><strong>Đặt phòng trực tuyến:</strong> Dễ dàng đặt phòng với vài cú click</span>
                </div>
                <div class="feature-item">
                  <i>📋</i>
                  <span><strong>Quản lý đặt phòng:</strong> Xem và quản lý tất cả đặt phòng của bạn</span>
                </div>
                <div class="feature-item">
                  <i>💳</i>
                  <span><strong>Thanh toán an toàn:</strong> Nhiều phương thức thanh toán tiện lợi</span>
                </div>
                <div class="feature-item">
                  <i>🎁</i>
                  <span><strong>Nhận ưu đãi:</strong> Nhận các mã khuyến mãi độc quyền</span>
                </div>
                <div class="feature-item">
                  <i>💬</i>
                  <span><strong>Hỗ trợ 24/7:</strong> Chat trực tiếp với chúng tôi bất cứ lúc nào</span>
                </div>
              </div>
              
              <p>Bắt đầu khám phá và đặt phòng ngay hôm nay để trải nghiệm dịch vụ tuyệt vời tại Rayal Park Hotel!</p>
              
              <div style="text-align: center;">
                <a href="${frontendUrl}/rooms" class="button">Xem danh sách phòng</a>
              </div>
              
              <p style="margin-top: 30px; font-size: 14px; color: #6b7280;">
                <strong>Lưu ý:</strong> Nếu bạn không phải là người tạo tài khoản này, vui lòng liên hệ với chúng tôi ngay lập tức.
              </p>
            </div>
            <div class="footer">
              <p>Rayal Park Hotel | Hotline: 1900-xxxx | Email: info@rayalpark.com</p>
              <p>© ${new Date().getFullYear()} Rayal Park Hotel. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };
  },
  
  paymentCancelled: (booking, user, room, payment, reason = null) => {
    const checkIn = new Date(booking.checkInDate).toLocaleDateString('vi-VN');
    const checkOut = new Date(booking.checkOutDate).toLocaleDateString('vi-VN');
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    return {
      subject: `Hủy thanh toán #${booking._id.toString().slice(-8)} - Rayal Park Hotel`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .warning-box { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .booking-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
            .info-row:last-child { border-bottom: none; }
            .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
            .button { display: inline-block; padding: 12px 24px; background: #f59e0b; color: white; text-decoration: none; border-radius: 6px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>⚠️ Thanh Toán Đã Bị Hủy</h1>
              <p>Rayal Park Hotel</p>
            </div>
            <div class="content">
              <p>Xin chào <strong>${user.fullName}</strong>,</p>
              
              <div class="warning-box">
                <p><strong>Thông báo:</strong> Thanh toán của bạn đã được hủy.</p>
              </div>
              
              <div class="booking-info">
                <h3>Thông tin thanh toán đã hủy</h3>
                <div class="info-row">
                  <span>Mã đặt phòng:</span>
                  <strong>#${booking._id.toString().slice(-8)}</strong>
                </div>
                <div class="info-row">
                  <span>Phòng:</span>
                  <strong>${room.name}</strong>
                </div>
                <div class="info-row">
                  <span>Check-in:</span>
                  <strong>${checkIn}</strong>
                </div>
                <div class="info-row">
                  <span>Check-out:</span>
                  <strong>${checkOut}</strong>
                </div>
                <div class="info-row">
                  <span>Số tiền:</span>
                  <strong>${payment.amount.toLocaleString('vi-VN')} VND</strong>
                </div>
                <div class="info-row">
                  <span>Phương thức thanh toán:</span>
                  <strong>${payment.method === 'vnpay' ? 'Thanh toán trực tuyến (VNPay)' : payment.method === 'bank_transfer' ? 'Chuyển khoản ngân hàng' : payment.method}</strong>
                </div>
                <div class="info-row">
                  <span>Trạng thái:</span>
                  <strong style="color: #f59e0b;">Đã hủy</strong>
                </div>
                ${reason ? `
                  <div class="info-row">
                    <span>Lý do hủy:</span>
                    <strong>${reason}</strong>
                  </div>
                ` : ''}
                <div class="info-row">
                  <span>Ngày hủy:</span>
                  <strong>${new Date().toLocaleDateString('vi-VN')}</strong>
                </div>
              </div>
              
              <div style="background: #fee2e2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 4px;">
                <p><strong>📌 Lưu ý:</strong></p>
                <ul style="margin: 10px 0; padding-left: 20px;">
                  <li>Đặt phòng của bạn vẫn còn hiệu lực nhưng chưa được thanh toán</li>
                  <li>Vui lòng thanh toán lại để đảm bảo đặt phòng của bạn được xác nhận</li>
                  <li>Nếu bạn có bất kỳ câu hỏi nào, vui lòng liên hệ với chúng tôi</li>
                </ul>
              </div>
              
              <p>Nếu bạn muốn tiếp tục với đặt phòng này, vui lòng thực hiện thanh toán lại.</p>
              
              <div style="text-align: center;">
                <a href="${frontendUrl}/my-bookings" class="button">Xem chi tiết đặt phòng</a>
              </div>
            </div>
            <div class="footer">
              <p>Rayal Park Hotel | Hotline: 1900-xxxx | Email: info@rayalpark.com</p>
              <p>© ${new Date().getFullYear()} Rayal Park Hotel. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };
  },
  
  reminderCheckIn: (booking, user, room) => {
    const checkIn = new Date(booking.checkInDate);
    const checkOut = new Date(booking.checkOutDate);
    const checkInFormatted = checkIn.toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const checkOutFormatted = checkOut.toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    return {
      subject: `📅 Nhắc nhở: Check-in ngày mai - ${checkInFormatted} - Rayal Park Hotel`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .reminder-box { background: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .booking-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
            .info-row:last-child { border-bottom: none; }
            .tips-box { background: #f0fdf4; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
            .button { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📅 Nhắc Nhở Check-In</h1>
              <p>Rayal Park Hotel</p>
            </div>
            <div class="content">
              <p>Xin chào <strong>${user.fullName}</strong>,</p>
              
              <div class="reminder-box">
                <p><strong>⏰ Thông báo quan trọng:</strong> Bạn có đặt phòng check-in vào ngày mai!</p>
                <p style="margin: 10px 0 0 0; font-size: 18px; font-weight: bold;">
                  Check-in: ${checkInFormatted}
                </p>
              </div>
              
              <div class="booking-info">
                <h3>Thông tin đặt phòng</h3>
                <div class="info-row">
                  <span>Mã đặt phòng:</span>
                  <strong>#${booking._id.toString().slice(-8)}</strong>
                </div>
                <div class="info-row">
                  <span>Phòng:</span>
                  <strong>${room.name}</strong>
                </div>
                ${room.roomNumber ? `
                  <div class="info-row">
                    <span>Số phòng:</span>
                    <strong>${room.roomNumber}</strong>
                  </div>
                ` : ''}
                <div class="info-row">
                  <span>Check-in:</span>
                  <strong>${checkInFormatted}</strong>
                </div>
                <div class="info-row">
                  <span>Check-out:</span>
                  <strong>${checkOutFormatted}</strong>
                </div>
                <div class="info-row">
                  <span>Số đêm:</span>
                  <strong>${nights} đêm</strong>
                </div>
                <div class="info-row">
                  <span>Trạng thái:</span>
                  <strong style="color: ${booking.status === 'confirmed' ? '#10b981' : '#f59e0b'}">
                    ${booking.status === 'confirmed' ? 'Đã xác nhận' : 'Chờ xác nhận'}
                  </strong>
                </div>
              </div>
              
              <div class="tips-box">
                <p><strong>💡 Mẹo hữu ích:</strong></p>
                <ul style="margin: 10px 0; padding-left: 20px;">
                  <li>Check-in từ 14:00 - Vui lòng đến đúng giờ để nhận phòng</li>
                  <li>Mang theo CMND/CCCD hoặc hộ chiếu để làm thủ tục</li>
                  <li>Nếu có thay đổi, vui lòng liên hệ với chúng tôi sớm nhất</li>
                  <li>Chúng tôi có dịch vụ đưa đón sân bay (cần đặt trước)</li>
                </ul>
              </div>
              
              <p>Chúng tôi rất mong được đón tiếp bạn tại Rayal Park Hotel!</p>
              
              <div style="text-align: center;">
                <a href="${frontendUrl}/my-bookings" class="button">Xem chi tiết đặt phòng</a>
              </div>
            </div>
            <div class="footer">
              <p>Rayal Park Hotel | Hotline: 1900-xxxx | Email: info@rayalpark.com</p>
              <p>© ${new Date().getFullYear()} Rayal Park Hotel. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };
  },
  
  thankYouAfterCheckout: (booking, user, room) => {
    const checkIn = new Date(booking.checkInDate).toLocaleDateString('vi-VN');
    const checkOut = new Date(booking.checkOutDate).toLocaleDateString('vi-VN');
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    return {
      subject: `Cảm ơn bạn đã lưu trú tại Rayal Park Hotel! 🙏`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #ec4899, #f43f5e); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .thank-box { background: #fce7f3; border-left: 4px solid #ec4899; padding: 15px; margin: 20px 0; border-radius: 4px; text-align: center; }
            .booking-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
            .info-row:last-child { border-bottom: none; }
            .review-box { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
            .button { display: inline-block; padding: 12px 24px; background: #ec4899; color: white; text-decoration: none; border-radius: 6px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🙏 Cảm Ơn Bạn!</h1>
              <p>Rayal Park Hotel</p>
            </div>
            <div class="content">
              <p>Xin chào <strong>${user.fullName}</strong>,</p>
              
              <div class="thank-box">
                <p style="font-size: 18px; margin: 0;"><strong>Cảm ơn bạn đã lưu trú tại Rayal Park Hotel!</strong></p>
                <p style="margin: 10px 0 0 0;">Chúng tôi hy vọng bạn đã có một trải nghiệm tuyệt vời.</p>
              </div>
              
              <div class="booking-info">
                <h3>Thông tin lưu trú</h3>
                <div class="info-row">
                  <span>Mã đặt phòng:</span>
                  <strong>#${booking._id.toString().slice(-8)}</strong>
                </div>
                <div class="info-row">
                  <span>Phòng:</span>
                  <strong>${room.name}</strong>
                </div>
                <div class="info-row">
                  <span>Check-in:</span>
                  <strong>${checkIn}</strong>
                </div>
                <div class="info-row">
                  <span>Check-out:</span>
                  <strong>${checkOut}</strong>
                </div>
              </div>
              
              <div class="review-box">
                <p><strong>⭐ Chia sẻ trải nghiệm của bạn:</strong></p>
                <p>Đánh giá của bạn rất quan trọng với chúng tôi! Hãy chia sẻ trải nghiệm của bạn để chúng tôi có thể cải thiện dịch vụ tốt hơn.</p>
                <div style="text-align: center; margin-top: 15px;">
                  <a href="${frontendUrl}/my-bookings" class="button" style="background: #f59e0b;">Đánh giá ngay</a>
                </div>
              </div>
              
              <p>Chúng tôi rất mong được đón tiếp bạn trở lại trong tương lai!</p>
              
              <p><strong>🎁 Ưu đãi đặc biệt:</strong> Đặt phòng lần tiếp theo và nhận ưu đãi 10% cho khách hàng thân thiết!</p>
              
              <div style="text-align: center;">
                <a href="${frontendUrl}/rooms" class="button">Đặt phòng ngay</a>
              </div>
            </div>
            <div class="footer">
              <p>Rayal Park Hotel | Hotline: 1900-xxxx | Email: info@rayalpark.com</p>
              <p>© ${new Date().getFullYear()} Rayal Park Hotel. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };
  },
  
  paymentReminder: (booking, user, room, payment) => {
    const checkIn = new Date(booking.checkInDate).toLocaleDateString('vi-VN');
    const checkOut = new Date(booking.checkOutDate).toLocaleDateString('vi-VN');
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    return {
      subject: `⏰ Nhắc nhở: Thanh toán đặt phòng #${booking._id.toString().slice(-8)} - Rayal Park Hotel`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .reminder-box { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .booking-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
            .info-row:last-child { border-bottom: none; }
            .amount-box { background: #fee2e2; border: 2px solid #ef4444; padding: 20px; margin: 20px 0; border-radius: 8px; text-align: center; }
            .amount { font-size: 28px; font-weight: bold; color: #ef4444; margin: 10px 0; }
            .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
            .button { display: inline-block; padding: 12px 24px; background: #f59e0b; color: white; text-decoration: none; border-radius: 6px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>⏰ Nhắc Nhở Thanh Toán</h1>
              <p>Rayal Park Hotel</p>
            </div>
            <div class="content">
              <p>Xin chào <strong>${user.fullName}</strong>,</p>
              
              <div class="reminder-box">
                <p><strong>⚠️ Thông báo quan trọng:</strong> Đặt phòng của bạn chưa được thanh toán.</p>
                <p style="margin: 10px 0 0 0;">Vui lòng hoàn tất thanh toán để đảm bảo đặt phòng của bạn được xác nhận.</p>
              </div>
              
              <div class="booking-info">
                <h3>Thông tin đặt phòng</h3>
                <div class="info-row">
                  <span>Mã đặt phòng:</span>
                  <strong>#${booking._id.toString().slice(-8)}</strong>
                </div>
                <div class="info-row">
                  <span>Phòng:</span>
                  <strong>${room.name}</strong>
                </div>
                <div class="info-row">
                  <span>Check-in:</span>
                  <strong>${checkIn}</strong>
                </div>
                <div class="info-row">
                  <span>Check-out:</span>
                  <strong>${checkOut}</strong>
                </div>
                <div class="info-row">
                  <span>Trạng thái:</span>
                  <strong style="color: #f59e0b;">Chờ thanh toán</strong>
                </div>
              </div>
              
              <div class="amount-box">
                <p style="margin: 0; font-size: 14px; color: #6b7280;">Số tiền cần thanh toán</p>
                <div class="amount">${payment.amount.toLocaleString('vi-VN')} VND</div>
                <p style="margin: 10px 0 0 0; font-size: 14px; color: #6b7280;">
                  Phương thức: ${payment.method === 'vnpay' ? 'Thanh toán trực tuyến (VNPay)' : payment.method === 'bank_transfer' ? 'Chuyển khoản ngân hàng' : payment.method}
                </p>
              </div>
              
              <div style="background: #fee2e2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 4px;">
                <p><strong>📌 Lưu ý:</strong></p>
                <ul style="margin: 10px 0; padding-left: 20px;">
                  <li>Đặt phòng sẽ tự động hủy nếu không thanh toán trong vòng 24 giờ</li>
                  <li>Vui lòng hoàn tất thanh toán sớm để đảm bảo phòng của bạn</li>
                  <li>Nếu đã thanh toán, vui lòng bỏ qua email này</li>
                </ul>
              </div>
              
              <div style="text-align: center;">
                <a href="${frontendUrl}/my-bookings" class="button">Thanh toán ngay</a>
              </div>
            </div>
            <div class="footer">
              <p>Rayal Park Hotel | Hotline: 1900-xxxx | Email: info@rayalpark.com</p>
              <p>© ${new Date().getFullYear()} Rayal Park Hotel. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };
  },
  
  passwordReset: (user, resetToken) => {
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${resetToken}`;
    
    return {
      subject: 'Đặt lại mật khẩu - Rayal Park Hotel',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #ec4899, #f43f5e); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; padding: 12px 24px; background: #ec4899; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
            .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 Đặt lại mật khẩu</h1>
            </div>
            <div class="content">
              <p>Xin chào <strong>${user.fullName}</strong>,</p>
              <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.</p>
              
              <div style="text-align: center;">
                <a href="${resetUrl}" class="button">Đặt lại mật khẩu</a>
              </div>
              
              <div class="warning">
                <p><strong>Lưu ý:</strong></p>
                <ul>
                  <li>Link này chỉ có hiệu lực trong 1 giờ</li>
                  <li>Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này</li>
                  <li>Nếu link không hoạt động, copy và paste vào trình duyệt: ${resetUrl}</li>
                </ul>
              </div>
            </div>
            <div class="footer">
              <p>Rayal Park Hotel | © ${new Date().getFullYear()} All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };
  },
};

// Send email function
const sendEmail = async (to, subject, html, text = '') => {
  try {
    const transporter = createTransporter();
    
    if (!transporter) {
      // Development: Log email instead of sending
      console.log('📧 [EMAIL PREVIEW]');
      console.log('To:', to);
      console.log('Subject:', subject);
      console.log('Preview:', html.substring(0, 200) + '...');
      return { success: true, preview: true };
    }
    
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER || process.env.GMAIL_USER || process.env.EMAIL_USER || `"Rayal Park Hotel" <noreply@rayalpark.com>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
    });
    
    console.log('✅ Email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Error sending email:', error);
    return { success: false, error: error.message };
  }
};

// Export functions
export const emailService = {
  sendBookingConfirmation: async (booking, user, room, payment = null) => {
    const template = emailTemplates.bookingConfirmation(booking, user, room, payment);
    return await sendEmail(user.email, template.subject, template.html);
  },
  
  sendPaymentConfirmed: async (booking, user, room, payment) => {
    const template = emailTemplates.paymentConfirmed(booking, user, room, payment);
    return await sendEmail(user.email, template.subject, template.html);
  },
  
  sendBookingCancelled: async (booking, user, room, payment = null, reason = null) => {
    const template = emailTemplates.bookingCancelled(booking, user, room, payment, reason);
    return await sendEmail(user.email, template.subject, template.html);
  },
  
  sendPaymentRefunded: async (booking, user, room, payment, refundAmount, reason = null) => {
    const template = emailTemplates.paymentRefunded(booking, user, room, payment, refundAmount, reason);
    return await sendEmail(user.email, template.subject, template.html);
  },
  
  sendUserRegistered: async (user) => {
    const template = emailTemplates.userRegistered(user);
    return await sendEmail(user.email, template.subject, template.html);
  },
  
  sendPaymentCancelled: async (booking, user, room, payment, reason = null) => {
    const template = emailTemplates.paymentCancelled(booking, user, room, payment, reason);
    return await sendEmail(user.email, template.subject, template.html);
  },
  
  sendReminderCheckIn: async (booking, user, room) => {
    const template = emailTemplates.reminderCheckIn(booking, user, room);
    return await sendEmail(user.email, template.subject, template.html);
  },
  
  sendThankYouAfterCheckout: async (booking, user, room) => {
    const template = emailTemplates.thankYouAfterCheckout(booking, user, room);
    return await sendEmail(user.email, template.subject, template.html);
  },
  
  sendPaymentReminder: async (booking, user, room, payment) => {
    const template = emailTemplates.paymentReminder(booking, user, room, payment);
    return await sendEmail(user.email, template.subject, template.html);
  },
  
  sendPasswordReset: async (user, resetToken) => {
    const template = emailTemplates.passwordReset(user, resetToken);
    return await sendEmail(user.email, template.subject, template.html);
  },
  
  sendCustomEmail: async (to, subject, html, text) => {
    return await sendEmail(to, subject, html, text);
  },
};

export default emailService;


