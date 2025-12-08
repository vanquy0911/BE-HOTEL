// services/emailReminderService.js
import Booking from '../Models/BookingModel.js';
import User from '../Models/UserModel.js';
import Room from '../Models/RoomModel.js';
import Payment from '../Models/PaymentModel.js';
import emailService from './emailService.js';

/**
 * Gửi email nhắc nhở check-in cho các booking có check-in vào ngày mai
 */
export const sendCheckInReminders = async () => {
  try {
    console.log('📧 [Email Reminder] Checking for check-in reminders...');
    
    // Tính ngày mai
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(23, 59, 59, 999);
    
    //  Tìm các booking có check-in vào ngày mai, status = 'confirmed' và CHƯA gửi reminder
    const bookings = await Booking.find({
      checkInDate: {
        $gte: tomorrow,
        $lte: tomorrowEnd
      },
      status: 'confirmed',
      checkInReminderSent: false // ✅ CHỈ lấy bookings chưa gửi reminder
    })
      .populate('user', 'fullName email')
      .populate('room', 'name roomNumber');
    
    console.log(`📧 [Email Reminder] Found ${bookings.length} bookings with check-in tomorrow (not sent yet)`);
    
    let sentCount = 0;
    let errorCount = 0;
    
    for (const booking of bookings) {
      try {
        if (booking.user && booking.user.email && booking.room) {
          await emailService.sendReminderCheckIn(booking, booking.user, booking.room);
          
          // ✅ ĐÁNH DẤU ĐÃ GỬI để tránh gửi lại
          booking.checkInReminderSent = true;
          booking.checkInReminderSentAt = new Date();
          await booking.save();
          
          sentCount++;
          console.log(`✅ [Email Reminder] Check-in reminder sent to ${booking.user.email} for booking ${booking._id}`);
        }
      } catch (error) {
        errorCount++;
        console.error(`❌ [Email Reminder] Error sending check-in reminder for booking ${booking._id}:`, error.message);
      }
    }
    
    console.log(`📧 [Email Reminder] Check-in reminders: ${sentCount} sent, ${errorCount} errors`);
    return { sent: sentCount, errors: errorCount };
  } catch (error) {
    console.error('❌ [Email Reminder] Error in sendCheckInReminders:', error);
    return { sent: 0, errors: 1 };
  }
};

/**
 * Gửi email cảm ơn cho các booking đã checkout hôm nay
 */
export const sendThankYouAfterCheckout = async () => {
  try {
    console.log('📧 [Email Reminder] Checking for checkout thank you emails...');
    
    // Tính hôm nay
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);
    
    // ✅ Tìm các booking có check-out hôm nay, status = 'confirmed' và CHƯA gửi thank you email
    const bookings = await Booking.find({
      checkOutDate: {
        $gte: today,
        $lte: todayEnd
      },
      status: 'confirmed',
      thankYouEmailSent: false // ✅ CHỈ lấy bookings chưa gửi thank you email
    })
      .populate('user', 'fullName email')
      .populate('room', 'name roomNumber');
    
    console.log(`📧 [Email Reminder] Found ${bookings.length} bookings checked out today (not sent yet)`);
    
    let sentCount = 0;
    let errorCount = 0;
    
    for (const booking of bookings) {
      try {
        if (booking.user && booking.user.email && booking.room) {
          await emailService.sendThankYouAfterCheckout(booking, booking.user, booking.room);
          
          // ✅ ĐÁNH DẤU ĐÃ GỬI để tránh gửi lại
          booking.thankYouEmailSent = true;
          booking.thankYouEmailSentAt = new Date();
          await booking.save();
          
          sentCount++;
          console.log(`✅ [Email Reminder] Thank you email sent to ${booking.user.email} for booking ${booking._id}`);
        }
      } catch (error) {
        errorCount++;
        console.error(`❌ [Email Reminder] Error sending thank you email for booking ${booking._id}:`, error.message);
      }
    }
    
    console.log(`📧 [Email Reminder] Thank you emails: ${sentCount} sent, ${errorCount} errors`);
    return { sent: sentCount, errors: errorCount };
  } catch (error) {
    console.error('❌ [Email Reminder] Error in sendThankYouAfterCheckout:', error);
    return { sent: 0, errors: 1 };
  }
};

/**
 * Gửi email nhắc nhở thanh toán cho các booking pending và chưa thanh toán sau 24 giờ
 */
export const sendPaymentReminders = async () => {
  try {
    console.log('📧 [Email Reminder] Checking for payment reminders...');
    
    // Tính thời điểm 24 giờ trước
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
    
    // ✅ Tìm các booking có status = 'pending', tạo hơn 24 giờ trước và CHƯA gửi payment reminder
    const bookings = await Booking.find({
      status: 'pending',
      createdAt: {
        $lte: twentyFourHoursAgo
      },
      paymentReminderSent: false // ✅ CHỈ lấy bookings chưa gửi payment reminder
    })
      .populate('user', 'fullName email')
      .populate('room', 'name roomNumber');
    
    console.log(`📧 [Email Reminder] Found ${bookings.length} pending bookings older than 24 hours (not sent yet)`);
    
    let sentCount = 0;
    let errorCount = 0;
    
    for (const booking of bookings) {
      try {
        // Kiểm tra xem có payment chưa
        const payment = await Payment.findOne({ 
          bookingId: booking._id,
          status: 'pending'
        });
        
        if (payment && booking.user && booking.user.email && booking.room) {
          // Chỉ gửi nếu payment vẫn pending
          await emailService.sendPaymentReminder(booking, booking.user, booking.room, payment);
          
          // ✅ ĐÁNH DẤU ĐÃ GỬI để tránh gửi lại
          booking.paymentReminderSent = true;
          booking.paymentReminderSentAt = new Date();
          await booking.save();
          
          sentCount++;
          console.log(`✅ [Email Reminder] Payment reminder sent to ${booking.user.email} for booking ${booking._id}`);
        }
      } catch (error) {
        errorCount++;
        console.error(`❌ [Email Reminder] Error sending payment reminder for booking ${booking._id}:`, error.message);
      }
    }
    
    console.log(`📧 [Email Reminder] Payment reminders: ${sentCount} sent, ${errorCount} errors`);
    return { sent: sentCount, errors: errorCount };
  } catch (error) {
    console.error('❌ [Email Reminder] Error in sendPaymentReminders:', error);
    return { sent: 0, errors: 1 };
  }
};

/**
 * Chạy tất cả các email nhắc nhở
 */
export const runAllReminders = async () => {
  console.log('📧 [Email Reminder] ===== Starting email reminders job =====');
  const startTime = Date.now();
  
  const results = {
    checkIn: await sendCheckInReminders(),
    thankYou: await sendThankYouAfterCheckout(),
    payment: await sendPaymentReminders()
  };
  
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  
  console.log('📧 [Email Reminder] ===== Email reminders job completed =====');
  console.log(`📧 [Email Reminder] Total time: ${duration}s`);
  console.log(`📧 [Email Reminder] Results:`, results);
  
  return results;
};

export default {
  sendCheckInReminders,
  sendThankYouAfterCheckout,
  sendPaymentReminders,
  runAllReminders
};

