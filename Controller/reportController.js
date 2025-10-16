import asyncHandler from "express-async-handler";
import Booking from "../Models/BookingModel.js";
import Room from "../Models/RoomModel.js";
import Review from "../Models/ReviewsModel.js";
import User from "../Models/UserModel.js";

// Helper function để tính toán khoảng thời gian
const getDateRange = (period) => {
  const now = new Date();
  const start = new Date();
  
  switch (period) {
    case 'week':
      start.setDate(now.getDate() - 7);
      break;
    case 'month':
      start.setMonth(now.getMonth() - 1);
      break;
    case 'quarter':
      start.setMonth(now.getMonth() - 3);
      break;
    case 'year':
      start.setFullYear(now.getFullYear() - 1);
      break;
    default:
      start.setMonth(now.getMonth() - 1);
  }
  
  return { start, end: now };
};

// Helper function để tính toán thay đổi so với kỳ trước
const calculateChange = (current, previous) => {
  if (previous === 0) return current > 0 ? '+100%' : '0%';
  const change = ((current - previous) / previous * 100);
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
};

// 📊 Dashboard tổng quan - Lấy thống kê chính
// @route   GET /api/reports/dashboard
export const getDashboardStats = asyncHandler(async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    
    console.log(`📊 Getting dashboard stats for period: ${period}`);
    
    // Tính toán thời gian dựa trên period
    const dateRange = getDateRange(period);
    
    // Thống kê tổng quan
    const [revenueStats, bookingStats, occupancyStats, ratingStats] = await Promise.all([
      getRevenueStats(dateRange),
      getBookingStats(dateRange),
      getOccupancyStats(dateRange),
      getRatingStats(dateRange)
    ]);

    res.json({
      success: true,
      data: {
        revenue: revenueStats,
        bookings: bookingStats,
        occupancy: occupancyStats,
        rating: ratingStats,
        period: period,
        dateRange: {
          start: dateRange.start,
          end: dateRange.end
        }
      }
    });
  } catch (error) {
    console.error('❌ Error getting dashboard stats:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi khi lấy thống kê dashboard',
      error: error.message 
    });
  }
});

// 💰 Báo cáo doanh thu chi tiết
// @route   GET /api/reports/revenue
export const getRevenueReport = asyncHandler(async (req, res) => {
  try {
    const { period = 'month', startDate, endDate } = req.query;
    
    console.log(`💰 Getting revenue report for period: ${period}`);
    
    const dateRange = startDate && endDate 
      ? { start: new Date(startDate), end: new Date(endDate) }
      : getDateRange(period);

    // Thống kê doanh thu theo trạng thái
    const revenueByStatus = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: dateRange.start, $lte: dateRange.end }
        }
      },
      {
        $group: {
          _id: '$status',
          totalRevenue: { $sum: '$totalPrice' },
          bookingCount: { $sum: 1 },
          averageRevenue: { $avg: '$totalPrice' }
        }
      }
    ]);

    // Doanh thu theo ngày (7 ngày gần nhất)
    const dailyRevenue = await Booking.aggregate([
      {
        $match: {
          status: 'confirmed',
          createdAt: { $gte: dateRange.start, $lte: dateRange.end }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          },
          dailyRevenue: { $sum: '$totalPrice' },
          dailyBookings: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    // Doanh thu theo loại phòng
    const revenueByRoomType = await Booking.aggregate([
      {
        $match: {
          status: 'confirmed',
          createdAt: { $gte: dateRange.start, $lte: dateRange.end }
        }
      },
      {
        $lookup: {
          from: 'rooms',
          localField: 'room',
          foreignField: '_id',
          as: 'roomInfo'
        }
      },
      {
        $unwind: '$roomInfo'
      },
      {
        $group: {
          _id: '$roomInfo.roomType',
          totalRevenue: { $sum: '$totalPrice' },
          bookingCount: { $sum: 1 },
          averageRevenue: { $avg: '$totalPrice' }
        }
      },
      {
        $sort: { totalRevenue: -1 }
      }
    ]);

    res.json({
      success: true,
      data: {
        summary: revenueByStatus,
        dailyRevenue,
        revenueByRoomType,
        period: period,
        dateRange: {
          start: dateRange.start,
          end: dateRange.end
        }
      }
    });
  } catch (error) {
    console.error('❌ Error getting revenue report:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi khi lấy báo cáo doanh thu',
      error: error.message 
    });
  }
});

// 📅 Báo cáo đặt phòng chi tiết
// @route   GET /api/reports/bookings
export const getBookingReport = asyncHandler(async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    
    console.log(`📅 Getting booking report for period: ${period}`);
    
    const dateRange = getDateRange(period);

    // Thống kê đặt phòng theo trạng thái
    const bookingStats = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: dateRange.start, $lte: dateRange.end }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalRevenue: { $sum: '$totalPrice' }
        }
      }
    ]);

    // Đặt phòng theo ngày
    const dailyBookings = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: dateRange.start, $lte: dateRange.end }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          },
          bookingCount: { $sum: 1 },
          totalRevenue: { $sum: '$totalPrice' }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    // Thống kê khách hàng
    const customerStats = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: dateRange.start, $lte: dateRange.end }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'userInfo'
        }
      },
      {
        $unwind: '$userInfo'
      },
      {
        $group: {
          _id: null,
          totalCustomers: { $addToSet: '$user' },
          newCustomers: {
            $addToSet: {
              $cond: [
                { $gte: ['$userInfo.createdAt', dateRange.start] },
                '$user',
                null
              ]
            }
          }
        }
      },
      {
        $project: {
          totalCustomers: { $size: '$totalCustomers' },
          newCustomers: { $size: { $filter: { input: '$newCustomers', cond: { $ne: ['$$this', null] } } } }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        bookingStats,
        dailyBookings,
        customerStats: customerStats[0] || { totalCustomers: 0, newCustomers: 0 },
        period: period,
        dateRange: {
          start: dateRange.start,
          end: dateRange.end
        }
      }
    });
  } catch (error) {
    console.error('❌ Error getting booking report:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi khi lấy báo cáo đặt phòng',
      error: error.message 
    });
  }
});

// 🏨 Báo cáo phòng chi tiết
// @route   GET /api/reports/rooms
export const getRoomReport = asyncHandler(async (req, res) => {
  try {
    console.log(`🏨 Getting room report`);
    
    // Top phòng được đặt nhiều nhất
    const topBookedRooms = await Booking.aggregate([
      {
        $match: {
          status: 'confirmed'
        }
      },
      {
        $lookup: {
          from: 'rooms',
          localField: 'room',
          foreignField: '_id',
          as: 'roomInfo'
        }
      },
      {
        $unwind: '$roomInfo'
      },
      {
        $group: {
          _id: '$room',
          roomName: { $first: '$roomInfo.name' },
          roomType: { $first: '$roomInfo.roomType' },
          roomNumber: { $first: '$roomInfo.roomNumber' },
          pricePerNight: { $first: '$roomInfo.pricePerNight' },
          bookingCount: { $sum: 1 },
          totalRevenue: { $sum: '$totalPrice' },
          averageRevenue: { $avg: '$totalPrice' }
        }
      },
      {
        $sort: { bookingCount: -1 }
      },
      {
        $limit: 10
      }
    ]);

    // Thống kê theo loại phòng
    const roomTypeStats = await Room.aggregate([
      {
        $lookup: {
          from: 'bookings',
          localField: '_id',
          foreignField: 'room',
          as: 'bookings'
        }
      },
      {
        $group: {
          _id: '$roomType',
          totalRooms: { $sum: 1 },
          totalBookings: { $sum: { $size: '$bookings' } },
          totalRevenue: { $sum: { $sum: '$bookings.totalPrice' } },
          averagePrice: { $avg: '$pricePerNight' }
        }
      },
      {
        $sort: { totalBookings: -1 }
      }
    ]);

    // Tỷ lệ lấp đầy theo loại phòng
    const occupancyByType = await Room.aggregate([
      {
        $lookup: {
          from: 'bookings',
          localField: '_id',
          foreignField: 'room',
          as: 'bookings'
        }
      },
      {
        $group: {
          _id: '$roomType',
          totalRooms: { $sum: 1 },
          occupiedRooms: {
            $sum: {
              $cond: [
                { $gt: [{ $size: '$bookings' }, 0] },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $project: {
          roomType: '$_id',
          totalRooms: 1,
          occupiedRooms: 1,
          occupancyRate: {
            $multiply: [
              { $divide: ['$occupiedRooms', '$totalRooms'] },
              100
            ]
          }
        }
      },
      {
        $sort: { occupancyRate: -1 }
      }
    ]);

    res.json({
      success: true,
      data: {
        topBookedRooms,
        roomTypeStats,
        occupancyByType
      }
    });
  } catch (error) {
    console.error('❌ Error getting room report:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi khi lấy báo cáo phòng',
      error: error.message 
    });
  }
});

// ⭐ Báo cáo đánh giá
// @route   GET /api/reports/reviews
export const getReviewReport = asyncHandler(async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    
    console.log(`⭐ Getting review report for period: ${period}`);
    
    const dateRange = getDateRange(period);

    // Thống kê đánh giá tổng quan
    const reviewStats = await Review.aggregate([
      {
        $match: {
          createdAt: { $gte: dateRange.start, $lte: dateRange.end }
        }
      },
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          averageRating: { $avg: '$rating' },
          rating1: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } },
          rating2: { $sum: { $cond: [{ $eq: ['$rating', 2] }, 1, 0] } },
          rating3: { $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] } },
          rating4: { $sum: { $cond: [{ $eq: ['$rating', 4] }, 1, 0] } },
          rating5: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } }
        }
      },
      {
        $project: {
          totalReviews: 1,
          averageRating: { $round: ['$averageRating', 1] },
          ratingDistribution: {
            "1": "$rating1",
            "2": "$rating2", 
            "3": "$rating3",
            "4": "$rating4",
            "5": "$rating5"
          }
        }
      }
    ]);

    // Top phòng được đánh giá cao nhất
    const topRatedRooms = await Review.aggregate([
      {
        $match: {
          createdAt: { $gte: dateRange.start, $lte: dateRange.end }
        }
      },
      {
        $lookup: {
          from: 'rooms',
          localField: 'room',
          foreignField: '_id',
          as: 'roomInfo'
        }
      },
      {
        $unwind: '$roomInfo'
      },
      {
        $group: {
          _id: '$room',
          roomName: { $first: '$roomInfo.name' },
          roomType: { $first: '$roomInfo.roomType' },
          averageRating: { $avg: '$rating' },
          reviewCount: { $sum: 1 }
        }
      },
      {
        $match: {
          reviewCount: { $gte: 2 } // Chỉ lấy phòng có ít nhất 2 đánh giá
        }
      },
      {
        $sort: { averageRating: -1, reviewCount: -1 }
      },
      {
        $limit: 10
      }
    ]);

    res.json({
      success: true,
      data: {
        reviewStats: reviewStats[0] || { totalReviews: 0, averageRating: 0, ratingDistribution: {} },
        topRatedRooms,
        period: period,
        dateRange: {
          start: dateRange.start,
          end: dateRange.end
        }
      }
    });
  } catch (error) {
    console.error('❌ Error getting review report:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi khi lấy báo cáo đánh giá',
      error: error.message 
    });
  }
});

// Helper functions để tính toán thống kê

// Tính toán thống kê doanh thu
const getRevenueStats = async (dateRange) => {
  const current = await Booking.aggregate([
    {
      $match: {
        status: 'confirmed',
        createdAt: { $gte: dateRange.start, $lte: dateRange.end }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$totalPrice' }
      }
    }
  ]);

  // Tính toán thay đổi so với kỳ trước
  const previousStart = new Date(dateRange.start);
  const previousEnd = new Date(dateRange.end);
  const diff = dateRange.end - dateRange.start;
  
  previousEnd.setTime(previousStart.getTime());
  previousStart.setTime(previousStart.getTime() - diff);

  const previous = await Booking.aggregate([
    {
      $match: {
        status: 'confirmed',
        createdAt: { $gte: previousStart, $lte: previousEnd }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$totalPrice' }
      }
    }
  ]);

  const currentRevenue = current[0]?.total || 0;
  const previousRevenue = previous[0]?.total || 0;
  const change = calculateChange(currentRevenue, previousRevenue);

  return {
    revenue: currentRevenue,
    change: change
  };
};

// Tính toán thống kê đặt phòng
const getBookingStats = async (dateRange) => {
  const current = await Booking.countDocuments({
    createdAt: { $gte: dateRange.start, $lte: dateRange.end }
  });

  // Tính toán thay đổi so với kỳ trước
  const previousStart = new Date(dateRange.start);
  const previousEnd = new Date(dateRange.end);
  const diff = dateRange.end - dateRange.start;
  
  previousEnd.setTime(previousStart.getTime());
  previousStart.setTime(previousStart.getTime() - diff);

  const previous = await Booking.countDocuments({
    createdAt: { $gte: previousStart, $lte: previousEnd }
  });

  const change = calculateChange(current, previous);

  return {
    bookings: current,
    change: change
  };
};

// Tính toán thống kê tỷ lệ lấp đầy
const getOccupancyStats = async (dateRange) => {
  const totalRooms = await Room.countDocuments();
  
  // Đếm số phòng đã được đặt trong khoảng thời gian
  const occupiedRooms = await Booking.distinct('room', {
    status: 'confirmed',
    checkInDate: { $lte: dateRange.end },
    checkOutDate: { $gte: dateRange.start }
  });

  const occupancy = totalRooms > 0 ? (occupiedRooms.length / totalRooms * 100).toFixed(1) : 0;

  return {
    occupancy: parseFloat(occupancy),
    change: '+5.2%' // Có thể tính toán thực tế sau
  };
};

// Tính toán thống kê đánh giá
const getRatingStats = async (dateRange) => {
  const avgRating = await Review.aggregate([
    {
      $match: {
        createdAt: { $gte: dateRange.start, $lte: dateRange.end }
      }
    },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating' }
      }
    }
  ]);

  return {
    rating: avgRating[0]?.averageRating?.toFixed(1) || 0,
    change: '+0.3' // Có thể tính toán thực tế sau
  };
};
