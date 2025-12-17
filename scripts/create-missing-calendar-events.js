// scripts/create-missing-calendar-events.js
// Script để tạo Google Calendar events cho các booking đã tồn tại nhưng chưa có calendarEventId

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Booking from '../Models/BookingModel.js';
import Room from '../Models/RoomModel.js';
import User from '../Models/UserModel.js';
import googleCalendarService from '../services/googleCalendarService.js';

// Đảm bảo load .env từ root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is required in .env file');
  console.error('💡 You can also set it as environment variable:');
  console.error('   Windows PowerShell: $env:MONGODB_URI="your-uri"; npm run create-calendar-events');
  console.error('   Windows CMD: set MONGODB_URI=your-uri && npm run create-calendar-events');
  console.error('   Linux/Mac: MONGODB_URI=your-uri npm run create-calendar-events');
  process.exit(1);
}

async function createMissingCalendarEvents() {
  try {
    // Kết nối MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Khởi tạo Google Calendar Service
    await googleCalendarService.initialize();
    console.log('✅ Google Calendar Service initialized');

    // Tìm tất cả booking chưa có calendarEventId và chưa bị hủy
    const bookings = await Booking.find({
      calendarEventId: { $exists: false },
      status: { $in: ['pending', 'confirmed'] }
    })
      .populate('user', 'fullName email')
      .populate('room', 'name roomNumber');

    console.log(`\n📋 Found ${bookings.length} bookings without calendar events`);

    if (bookings.length === 0) {
      console.log('✅ All bookings already have calendar events');
      await mongoose.disconnect();
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const booking of bookings) {
      try {
        console.log(`\n🔄 Processing booking ${booking._id}...`);
        console.log(`   Room: ${booking.room?.name || 'N/A'}`);
        console.log(`   Customer: ${booking.user?.fullName || 'N/A'}`);
        console.log(`   Dates: ${new Date(booking.checkInDate).toLocaleDateString('vi-VN')} - ${new Date(booking.checkOutDate).toLocaleDateString('vi-VN')}`);

        const calendarEvent = await googleCalendarService.createBookingEvent({
          roomName: booking.room?.name || 'N/A',
          customerName: booking.user?.fullName || 'Khách vãng lai',
          checkIn: booking.checkInDate,
          checkOut: booking.checkOutDate,
          bookingId: booking._id.toString(),
          roomNumber: booking.room?.roomNumber || '',
          totalPrice: booking.totalPrice,
          guests: booking.roomQuantity || 1
        });

        if (calendarEvent) {
          booking.calendarEventId = calendarEvent.id;
          await booking.save();
          console.log(`   ✅ Created calendar event: ${calendarEvent.id}`);
          successCount++;
        } else {
          console.log(`   ⚠️ Failed to create calendar event (service returned null)`);
          errorCount++;
        }
      } catch (error) {
        console.error(`   ❌ Error creating calendar event for booking ${booking._id}:`, error.message);
        errorCount++;
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📋 Total: ${bookings.length}`);

    await mongoose.disconnect();
    console.log('\n✅ Done!');
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Chạy script
createMissingCalendarEvents();

