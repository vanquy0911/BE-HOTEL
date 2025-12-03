// services/googleSheetsService.js
import { google } from 'googleapis';

class GoogleSheetsService {
  constructor() {
    this.sheets = google.sheets('v4');
    this.auth = null;
    this.spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    this.sheetName = process.env.GOOGLE_SHEETS_NAME || 'Sheet1';
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
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
      } else if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        // Hoặc sử dụng OAuth2
        this.auth = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        
        if (process.env.GOOGLE_REFRESH_TOKEN) {
          this.auth.setCredentials({
            refresh_token: process.env.GOOGLE_REFRESH_TOKEN
          });
        }
      } else {
        console.warn('⚠️ Google Sheets credentials not configured. Sheets integration will be disabled.');
        return;
      }

      if (!this.spreadsheetId) {
        console.warn('⚠️ GOOGLE_SHEETS_ID not configured. Sheets integration will be disabled.');
        return;
      }

      // Tự động lấy tên sheet đầu tiên nếu chưa có tên cụ thể
      if (!process.env.GOOGLE_SHEETS_NAME) {
        try {
          const spreadsheet = await this.sheets.spreadsheets.get({
            auth: this.auth,
            spreadsheetId: this.spreadsheetId,
          });
          
          if (spreadsheet.data.sheets && spreadsheet.data.sheets.length > 0) {
            this.sheetName = spreadsheet.data.sheets[0].properties.title;
            console.log(`✅ Auto-detected sheet name: "${this.sheetName}"`);
          }
        } catch (error) {
          console.warn('⚠️ Could not auto-detect sheet name, using default:', error.message);
        }
      }

      this.initialized = true;
      console.log('✅ Google Sheets Service initialized');
    } catch (error) {
      console.error('❌ Error initializing Google Sheets Service:', error);
      throw error;
    }
  }

  /**
   * Tạo header row nếu chưa có
   */
  async ensureHeaders() {
    try {
      await this.initialize();
      
      if (!this.auth || !this.spreadsheetId) {
        return;
      }

      // Kiểm tra xem đã có header chưa
      const response = await this.sheets.spreadsheets.values.get({
        auth: this.auth,
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A1:J1`,
      });

      // Nếu chưa có header, tạo mới
      if (!response.data.values || response.data.values.length === 0) {
        const headers = [
          'Booking ID',
          'Tên khách hàng',
          'Email',
          'Số điện thoại',
          'Tên phòng',
          'Số phòng',
          'Check-in',
          'Check-out',
          'Số đêm',
          'Số khách',
          'Tổng giá (VNĐ)',
          'Trạng thái',
          'Ngày tạo',
          'Ghi chú'
        ];

        await this.sheets.spreadsheets.values.update({
          auth: this.auth,
          spreadsheetId: this.spreadsheetId,
          range: `${this.sheetName}!A1:N1`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [headers] },
        });

        // Format header row (bold, background color)
        await this.sheets.spreadsheets.batchUpdate({
          auth: this.auth,
          spreadsheetId: this.spreadsheetId,
          resource: {
            requests: [
              {
                repeatCell: {
                  range: {
                    sheetId: 0, // Assuming first sheet
                    startRowIndex: 0,
                    endRowIndex: 1,
                    startColumnIndex: 0,
                    endColumnIndex: 14,
                  },
                  cell: {
                    userEnteredFormat: {
                      backgroundColor: { red: 0.2, green: 0.6, blue: 0.9 },
                      textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
                    },
                  },
                  fields: 'userEnteredFormat(backgroundColor,textFormat)',
                },
              },
            ],
          },
        });

        console.log('✅ Created headers in Google Sheets');
      }
    } catch (error) {
      console.error('❌ Error ensuring headers in Google Sheets:', error.message);
    }
  }

  /**
   * Thêm booking vào Google Sheets
   * @param {Object} bookingData - Thông tin booking
   * @param {String} bookingData.bookingId - ID booking
   * @param {String} bookingData.customerName - Tên khách hàng
   * @param {String} bookingData.email - Email
   * @param {String} bookingData.phone - Số điện thoại
   * @param {String} bookingData.roomName - Tên phòng
   * @param {String} bookingData.roomNumber - Số phòng
   * @param {Date|String} bookingData.checkIn - Ngày check-in
   * @param {Date|String} bookingData.checkOut - Ngày check-out
   * @param {Number} bookingData.nights - Số đêm
   * @param {Number} bookingData.guests - Số khách
   * @param {Number} bookingData.totalPrice - Tổng giá
   * @param {String} bookingData.status - Trạng thái
   * @param {String} bookingData.note - Ghi chú
   */
  async addBookingRow(bookingData) {
    try {
      await this.initialize();
      
      if (!this.auth || !this.spreadsheetId) {
        console.warn('⚠️ Google Sheets not configured, skipping sheet update');
        return;
      }

      // Đảm bảo có header
      await this.ensureHeaders();

      const checkInDate = new Date(bookingData.checkIn);
      const checkOutDate = new Date(bookingData.checkOut);
      const nights = bookingData.nights || Math.ceil(
        (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      const values = [[
        bookingData.bookingId || '',
        bookingData.customerName || '',
        bookingData.email || '',
        bookingData.phone || '',
        bookingData.roomName || '',
        bookingData.roomNumber || '',
        checkInDate.toLocaleDateString('vi-VN'),
        checkOutDate.toLocaleDateString('vi-VN'),
        nights,
        bookingData.guests || '',
        bookingData.totalPrice?.toLocaleString('vi-VN') || '0',
        bookingData.status || 'pending',
        new Date().toLocaleString('vi-VN'),
        bookingData.note || '',
      ]];

      await this.sheets.spreadsheets.values.append({
        auth: this.auth,
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:N`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: { values },
      });

      console.log('✅ Added booking to Google Sheets:', bookingData.bookingId);
    } catch (error) {
      console.error('❌ Error adding booking to Google Sheets:', error.message);
      // Không throw error để không làm fail booking
    }
  }

  /**
   * Cập nhật dòng booking trong Google Sheets (khi chỉnh sửa booking)
   * @param {String} bookingId - ID booking
   * @param {Object} bookingData - Thông tin booking mới
   */
  async updateBookingRow(bookingId, bookingData) {
    try {
      await this.initialize();
      
      if (!this.auth || !this.spreadsheetId) {
        return;
      }

      // Tìm row chứa bookingId
      const response = await this.sheets.spreadsheets.values.get({
        auth: this.auth,
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:A`, // Cột Booking ID
      });

      const rows = response.data.values || [];
      let rowIndex = -1;

      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === bookingId) {
          rowIndex = i + 1; // +1 vì Google Sheets bắt đầu từ 1
          break;
        }
      }

      if (rowIndex === -1) {
        console.warn(`⚠️ Booking ID ${bookingId} not found in Google Sheets`);
        return;
      }

      const checkInDate = new Date(bookingData.checkIn);
      const checkOutDate = new Date(bookingData.checkOut);
      const nights = bookingData.nights || Math.ceil(
        (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      const values = [[
        bookingData.bookingId || bookingId,
        bookingData.customerName || '',
        bookingData.email || '',
        bookingData.phone || '',
        bookingData.roomName || '',
        bookingData.roomNumber || '',
        checkInDate.toLocaleDateString('vi-VN'),
        checkOutDate.toLocaleDateString('vi-VN'),
        nights,
        bookingData.guests || '',
        bookingData.totalPrice?.toLocaleString('vi-VN') || '0',
        bookingData.status || 'pending',
        bookingData.createdAt ? new Date(bookingData.createdAt).toLocaleString('vi-VN') : '',
        bookingData.note || '',
      ]];

      await this.sheets.spreadsheets.values.update({
        auth: this.auth,
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A${rowIndex}:N${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values },
      });

      console.log('✅ Updated booking in Google Sheets:', bookingId);
    } catch (error) {
      console.error('❌ Error updating booking in Google Sheets:', error.message);
    }
  }
}

export default new GoogleSheetsService();

