// services/googleCalendarService.js
import { google } from 'googleapis';

class GoogleCalendarService {
  constructor() {
    this.calendar = google.calendar('v3');
    this.auth = null;
    this.calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    this.initialized = false;
  }

  /**
   * Khởi tạo authentication
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Sử dụng Service Account nếu có key file
      if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        this.auth = new google.auth.GoogleAuth({
          keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
          scopes: ['https://www.googleapis.com/auth/calendar'],
        });
      } else if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        // Hoặc sử dụng OAuth2 nếu có client credentials
        this.auth = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        
        // Nếu có refresh token
        if (process.env.GOOGLE_REFRESH_TOKEN) {
          this.auth.setCredentials({
            refresh_token: process.env.GOOGLE_REFRESH_TOKEN
          });
        }
      } else {
        console.warn('⚠️ Google Calendar credentials not configured. Calendar integration will be disabled.');
        return;
      }

      this.initialized = true;
      console.log('✅ Google Calendar Service initialized');
    } catch (error) {
      console.error('❌ Error initializing Google Calendar Service:', error);
      throw error;
    }
  }

  /**
   * Tạo event booking trong Google Calendar
   * @param {Object} bookingData - Thông tin booking
   * @param {String} bookingData.roomName - Tên phòng
   * @param {String} bookingData.customerName - Tên khách hàng
   * @param {Date|String} bookingData.checkIn - Ngày check-in
   * @param {Date|String} bookingData.checkOut - Ngày check-out
   * @param {String} bookingData.bookingId - ID booking
   * @param {String} bookingData.roomNumber - Số phòng
   * @param {Number} bookingData.totalPrice - Tổng giá
   * @param {Number} bookingData.guests - Số khách
   * @returns {Promise<Object>} Event data từ Google Calendar
   */
  async createBookingEvent(bookingData) {
    try {
      await this.initialize();
      
      if (!this.auth) {
        console.warn('⚠️ Google Calendar not configured, skipping calendar event creation');
        return null;
      }

      const checkInDate = new Date(bookingData.checkIn);
      const checkOutDate = new Date(bookingData.checkOut);
      
      // Set time: Check-in 14:00, Check-out 12:00
      checkInDate.setHours(14, 0, 0, 0);
      checkOutDate.setHours(12, 0, 0, 0);

      const event = {
        summary: `📅 Booking - ${bookingData.roomName} - ${bookingData.customerName}`,
        description: `Booking ID: ${bookingData.bookingId}\n` +
                     `Phòng: ${bookingData.roomName}${bookingData.roomNumber ? ` (${bookingData.roomNumber})` : ''}\n` +
                     `Khách: ${bookingData.customerName}\n` +
                     `Số khách: ${bookingData.guests || 'N/A'}\n` +
                     `Tổng giá: ${bookingData.totalPrice?.toLocaleString('vi-VN') || 'N/A'} VNĐ\n` +
                     `Check-in: ${checkInDate.toLocaleString('vi-VN')}\n` +
                     `Check-out: ${checkOutDate.toLocaleString('vi-VN')}`,
        start: {
          dateTime: checkInDate.toISOString(),
          timeZone: 'Asia/Ho_Chi_Minh',
        },
        end: {
          dateTime: checkOutDate.toISOString(),
          timeZone: 'Asia/Ho_Chi_Minh',
        },
        location: bookingData.roomNumber || bookingData.roomName,
        colorId: '10', // Green color
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 }, // Email 1 ngày trước
            { method: 'popup', minutes: 60 }, // Popup 1 giờ trước check-in
          ],
        },
      };

      const response = await this.calendar.events.insert({
        auth: this.auth,
        calendarId: this.calendarId,
        resource: event,
      });

      console.log('✅ Created Google Calendar event:', response.data.id);
      return response.data;
    } catch (error) {
      console.error('❌ Error creating Google Calendar event:', error.message);
      // Không throw error để không làm fail booking
      return null;
    }
  }

  /**
   * Xóa event từ Google Calendar (khi hủy booking)
   * @param {String} eventId - ID của event trong Google Calendar
   */
  async deleteBookingEvent(eventId) {
    try {
      await this.initialize();
      
      if (!this.auth || !eventId) {
        return;
      }

      await this.calendar.events.delete({
        auth: this.auth,
        calendarId: this.calendarId,
        eventId: eventId,
      });

      console.log('✅ Deleted Google Calendar event:', eventId);
    } catch (error) {
      console.error('❌ Error deleting Google Calendar event:', error.message);
    }
  }

  /**
   * Cập nhật event trong Google Calendar (khi chỉnh sửa booking)
   * @param {String} eventId - ID của event
   * @param {Object} bookingData - Thông tin booking mới
   */
  async updateBookingEvent(eventId, bookingData) {
    try {
      await this.initialize();
      
      if (!this.auth || !eventId) {
        return null;
      }

      const checkInDate = new Date(bookingData.checkIn);
      const checkOutDate = new Date(bookingData.checkOut);
      checkInDate.setHours(14, 0, 0, 0);
      checkOutDate.setHours(12, 0, 0, 0);

      const event = {
        summary: `📅 Booking - ${bookingData.roomName} - ${bookingData.customerName}`,
        description: `Booking ID: ${bookingData.bookingId}\n` +
                     `Phòng: ${bookingData.roomName}${bookingData.roomNumber ? ` (${bookingData.roomNumber})` : ''}\n` +
                     `Khách: ${bookingData.customerName}\n` +
                     `Số khách: ${bookingData.guests || 'N/A'}\n` +
                     `Tổng giá: ${bookingData.totalPrice?.toLocaleString('vi-VN') || 'N/A'} VNĐ`,
        start: {
          dateTime: checkInDate.toISOString(),
          timeZone: 'Asia/Ho_Chi_Minh',
        },
        end: {
          dateTime: checkOutDate.toISOString(),
          timeZone: 'Asia/Ho_Chi_Minh',
        },
        location: bookingData.roomNumber || bookingData.roomName,
      };

      const response = await this.calendar.events.update({
        auth: this.auth,
        calendarId: this.calendarId,
        eventId: eventId,
        resource: event,
      });

      console.log('✅ Updated Google Calendar event:', eventId);
      return response.data;
    } catch (error) {
      console.error('❌ Error updating Google Calendar event:', error.message);
      return null;
    }
  }

  /**
   * Kiểm tra xem có event nào trong Calendar trùng với khoảng thời gian không
   * @param {Date|String} checkIn - Ngày check-in
   * @param {Date|String} checkOut - Ngày check-out
   * @param {String} roomNumber - Số phòng (optional, để filter chính xác hơn)
   * @returns {Promise<Boolean>} true nếu có conflict, false nếu không có
   */
  async checkBookingConflict(checkIn, checkOut, roomNumber = null) {
    try {
      await this.initialize();
      
      if (!this.auth) {
        // Nếu Calendar chưa config, return false (không có conflict)
        return false;
      }

      const checkInDate = new Date(checkIn);
      const checkOutDate = new Date(checkOut);
      
      // Set time: Check-in 14:00, Check-out 12:00 (giống như khi tạo event)
      checkInDate.setHours(14, 0, 0, 0);
      checkOutDate.setHours(12, 0, 0, 0);

      const timeMin = checkInDate.toISOString();
      const timeMax = checkOutDate.toISOString();

      // Query events trong khoảng thời gian
      const response = await this.calendar.events.list({
        auth: this.auth,
        calendarId: this.calendarId,
        timeMin: timeMin,
        timeMax: timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];

      // Nếu có roomNumber, filter events theo location
      if (roomNumber && events.length > 0) {
        const conflictingEvents = events.filter(event => {
          // Check overlap
          const eventStart = new Date(event.start.dateTime || event.start.date);
          const eventEnd = new Date(event.end.dateTime || event.end.date);
          
          const hasOverlap = eventStart < checkOutDate && eventEnd > checkInDate;
          
          // Nếu có roomNumber, check location
          if (hasOverlap && roomNumber) {
            const eventLocation = event.location || '';
            return eventLocation.includes(roomNumber);
          }
          
          return hasOverlap;
        });

        return conflictingEvents.length > 0;
      }

      // Nếu không có roomNumber, chỉ check overlap
      return events.length > 0;
    } catch (error) {
      console.error('❌ Error checking booking conflict in Calendar:', error.message);
      // Nếu có lỗi, return false (không có conflict) để không block booking
      return false;
    }
  }
}

export default new GoogleCalendarService();

