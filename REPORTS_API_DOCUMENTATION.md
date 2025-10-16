# 📊 Reports API Documentation

## Tổng quan
API Reports cung cấp các endpoint để lấy thống kê và báo cáo cho admin dashboard.

## Authentication
Tất cả endpoints đều yêu cầu:
- **Authentication**: Bearer token trong header
- **Authorization**: Chỉ admin mới có quyền truy cập

```javascript
headers: {
  'Authorization': 'Bearer <admin-token>',
  'Content-Type': 'application/json'
}
```

## Endpoints

### 1. 📊 Dashboard Stats
**GET** `/api/reports/dashboard`

Lấy thống kê tổng quan cho dashboard.

**Query Parameters:**
- `period` (optional): `week` | `month` | `quarter` | `year` (default: `month`)

**Response:**
```json
{
  "success": true,
  "data": {
    "revenue": {
      "revenue": 125000000,
      "change": "+12.5%"
    },
    "bookings": {
      "bookings": 180,
      "change": "+8.3%"
    },
    "occupancy": {
      "occupancy": 78.5,
      "change": "+5.2%"
    },
    "rating": {
      "rating": 4.7,
      "change": "+0.3"
    },
    "period": "month",
    "dateRange": {
      "start": "2024-01-01T00:00:00.000Z",
      "end": "2024-02-01T00:00:00.000Z"
    }
  }
}
```

### 2. 💰 Revenue Report
**GET** `/api/reports/revenue`

Lấy báo cáo doanh thu chi tiết.

**Query Parameters:**
- `period` (optional): `week` | `month` | `quarter` | `year` (default: `month`)
- `startDate` (optional): Ngày bắt đầu (YYYY-MM-DD)
- `endDate` (optional): Ngày kết thúc (YYYY-MM-DD)

**Response:**
```json
{
  "success": true,
  "data": {
    "summary": [
      {
        "_id": "confirmed",
        "totalRevenue": 125000000,
        "bookingCount": 150,
        "averageRevenue": 833333
      }
    ],
    "dailyRevenue": [
      {
        "_id": "2024-01-15",
        "dailyRevenue": 5000000,
        "dailyBookings": 8
      }
    ],
    "revenueByRoomType": [
      {
        "_id": "VIP",
        "totalRevenue": 50000000,
        "bookingCount": 25,
        "averageRevenue": 2000000
      }
    ]
  }
}
```

### 3. 📅 Booking Report
**GET** `/api/reports/bookings`

Lấy báo cáo đặt phòng chi tiết.

**Query Parameters:**
- `period` (optional): `week` | `month` | `quarter` | `year` (default: `month`)

**Response:**
```json
{
  "success": true,
  "data": {
    "bookingStats": [
      {
        "_id": "confirmed",
        "count": 150,
        "totalRevenue": 125000000
      },
      {
        "_id": "pending",
        "count": 20,
        "totalRevenue": 15000000
      }
    ],
    "dailyBookings": [
      {
        "_id": "2024-01-15",
        "bookingCount": 8,
        "totalRevenue": 5000000
      }
    ],
    "customerStats": {
      "totalCustomers": 120,
      "newCustomers": 25
    }
  }
}
```

### 4. 🏨 Room Report
**GET** `/api/reports/rooms`

Lấy báo cáo phòng chi tiết.

**Response:**
```json
{
  "success": true,
  "data": {
    "topBookedRooms": [
      {
        "_id": "room-id",
        "roomName": "Phòng Deluxe Hướng Biển",
        "roomType": "VIP",
        "roomNumber": "101",
        "pricePerNight": 2000000,
        "bookingCount": 45,
        "totalRevenue": 112500000,
        "averageRevenue": 2500000
      }
    ],
    "roomTypeStats": [
      {
        "_id": "VIP",
        "totalRooms": 20,
        "totalBookings": 150,
        "totalRevenue": 50000000,
        "averagePrice": 2000000
      }
    ],
    "occupancyByType": [
      {
        "roomType": "VIP",
        "totalRooms": 20,
        "occupiedRooms": 15,
        "occupancyRate": 75
      }
    ]
  }
}
```

### 5. ⭐ Review Report
**GET** `/api/reports/reviews`

Lấy báo cáo đánh giá chi tiết.

**Query Parameters:**
- `period` (optional): `week` | `month` | `quarter` | `year` (default: `month`)

**Response:**
```json
{
  "success": true,
  "data": {
    "reviewStats": {
      "totalReviews": 85,
      "averageRating": 4.7,
      "ratingDistribution": {
        "1": 2,
        "2": 3,
        "3": 8,
        "4": 25,
        "5": 47
      }
    },
    "topRatedRooms": [
      {
        "_id": "room-id",
        "roomName": "Phòng Deluxe Hướng Biển",
        "roomType": "VIP",
        "averageRating": 4.9,
        "reviewCount": 15
      }
    ]
  }
}
```

## Error Responses

### 401 Unauthorized
```json
{
  "message": "Không có token!"
}
```

### 403 Forbidden
```json
{
  "message": "Không có quyền truy cập"
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Lỗi khi lấy thống kê dashboard",
  "error": "Chi tiết lỗi"
}
```

## Usage Examples

### JavaScript/Fetch
```javascript
// Lấy dashboard stats
const response = await fetch('/api/reports/dashboard?period=month', {
  headers: {
    'Authorization': 'Bearer your-admin-token',
    'Content-Type': 'application/json'
  }
});
const data = await response.json();
```

### Axios
```javascript
import axios from 'axios';

const api = axios.create({
  baseURL: '/api/reports',
  headers: {
    'Authorization': 'Bearer your-admin-token'
  }
});

// Lấy revenue report
const revenueData = await api.get('/revenue?period=month');
```

## Notes
- Tất cả thời gian đều sử dụng UTC
- Period mặc định là `month` nếu không được chỉ định
- Các thống kê thay đổi (%) được tính so với kỳ trước cùng độ dài
- Chỉ admin mới có quyền truy cập các endpoints này
