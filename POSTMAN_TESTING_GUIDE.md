# 🧪 Hướng dẫn Test API Reports bằng Postman

## 📋 Chuẩn bị

### 1. Khởi động Backend Server
```bash
cd "D:\Đồ Án Chuyên Ngành\BE-HOTEL"
npm start
```
Server sẽ chạy tại: `http://localhost:5000`

### 2. Lấy Admin Token
Trước khi test Reports API, bạn cần có admin token. Có 2 cách:

#### Cách 1: Tạo Admin User mới
```bash
# Chạy script tạo admin
node createAdmin.js
```

#### Cách 2: Login với admin có sẵn
- Email: `admin@hotel.com`
- Password: `admin123`

**Endpoint Login:**
```
POST http://localhost:5000/api/users/login
Content-Type: application/json

{
  "email": "admin@hotel.com",
  "password": "admin123"
}
```

**Response sẽ chứa token:**
```json
{
  "success": true,
  "data": {
    "user": { ... },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

## 🔧 Cấu hình Postman

### 1. Tạo Environment
1. Mở Postman
2. Click **Environments** → **Create Environment**
3. Tên: `Hotel API`
4. Thêm variables:
   - `base_url`: `http://localhost:5000`
   - `admin_token`: `{{token_from_login}}`

### 2. Tạo Collection
1. Click **Collections** → **Create Collection**
2. Tên: `Hotel Reports API`
3. Thêm vào collection này tất cả requests

## 📡 Test Cases

### 1. 📊 Dashboard Stats

**Request:**
```
GET {{base_url}}/api/reports/dashboard?period=month
```

**Headers:**
```
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Expected Response:**
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

**Test Cases:**
- ✅ `period=week`
- ✅ `period=month`
- ✅ `period=quarter`
- ✅ `period=year`
- ❌ Không có token (401)
- ❌ Token không hợp lệ (401)
- ❌ User không phải admin (403)

### 2. 💰 Revenue Report

**Request:**
```
GET {{base_url}}/api/reports/revenue?period=month
```

**Headers:**
```
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Test Cases:**
- ✅ `period=month`
- ✅ `period=quarter`
- ✅ Custom date range: `startDate=2024-01-01&endDate=2024-01-31`

**Expected Response:**
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

**Request:**
```
GET {{base_url}}/api/reports/bookings?period=month
```

**Headers:**
```
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Expected Response:**
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

**Request:**
```
GET {{base_url}}/api/reports/rooms
```

**Headers:**
```
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Expected Response:**
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

**Request:**
```
GET {{base_url}}/api/reports/reviews?period=month
```

**Headers:**
```
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Expected Response:**
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

## 🚨 Error Testing

### 1. Test Authentication Errors

**Request không có token:**
```
GET {{base_url}}/api/reports/dashboard
# Không có Authorization header
```

**Expected Response:**
```json
{
  "message": "Không có token!"
}
```

**Request với token sai:**
```
GET {{base_url}}/api/reports/dashboard
Authorization: Bearer invalid-token
```

**Expected Response:**
```json
{
  "message": "Token hết hạn hoặc lỗi!"
}
```

### 2. Test Authorization Errors

**Request với user thường (không phải admin):**
```
GET {{base_url}}/api/reports/dashboard
Authorization: Bearer {{regular_user_token}}
```

**Expected Response:**
```json
{
  "message": "Không có quyền truy cập"
}
```

## 📊 Postman Collection JSON

Tạo file `Hotel_Reports_API.postman_collection.json`:

```json
{
  "info": {
    "name": "Hotel Reports API",
    "description": "API testing for Hotel Reports system",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    {
      "key": "base_url",
      "value": "http://localhost:5000"
    },
    {
      "key": "admin_token",
      "value": ""
    }
  ],
  "item": [
    {
      "name": "Login Admin",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Content-Type",
            "value": "application/json"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"email\": \"admin@hotel.com\",\n  \"password\": \"admin123\"\n}"
        },
        "url": {
          "raw": "{{base_url}}/api/users/login",
          "host": ["{{base_url}}"],
          "path": ["api", "users", "login"]
        }
      }
    },
    {
      "name": "Dashboard Stats",
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{admin_token}}"
          }
        ],
        "url": {
          "raw": "{{base_url}}/api/reports/dashboard?period=month",
          "host": ["{{base_url}}"],
          "path": ["api", "reports", "dashboard"],
          "query": [
            {
              "key": "period",
              "value": "month"
            }
          ]
        }
      }
    },
    {
      "name": "Revenue Report",
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{admin_token}}"
          }
        ],
        "url": {
          "raw": "{{base_url}}/api/reports/revenue?period=month",
          "host": ["{{base_url}}"],
          "path": ["api", "reports", "revenue"],
          "query": [
            {
              "key": "period",
              "value": "month"
            }
          ]
        }
      }
    },
    {
      "name": "Booking Report",
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{admin_token}}"
          }
        ],
        "url": {
          "raw": "{{base_url}}/api/reports/bookings?period=month",
          "host": ["{{base_url}}"],
          "path": ["api", "reports", "bookings"],
          "query": [
            {
              "key": "period",
              "value": "month"
            }
          ]
        }
      }
    },
    {
      "name": "Room Report",
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{admin_token}}"
          }
        ],
        "url": {
          "raw": "{{base_url}}/api/reports/rooms",
          "host": ["{{base_url}}"],
          "path": ["api", "reports", "rooms"]
        }
      }
    },
    {
      "name": "Review Report",
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{admin_token}}"
          }
        ],
        "url": {
          "raw": "{{base_url}}/api/reports/reviews?period=month",
          "host": ["{{base_url}}"],
          "path": ["api", "reports", "reviews"],
          "query": [
            {
              "key": "period",
              "value": "month"
            }
          ]
        }
      }
    }
  ]
}
```

## 🎯 Testing Checklist

### ✅ Functional Testing
- [ ] Dashboard stats với các period khác nhau
- [ ] Revenue report với custom date range
- [ ] Booking report với các period
- [ ] Room report (không cần period)
- [ ] Review report với các period

### ✅ Security Testing
- [ ] Không có token → 401
- [ ] Token sai → 401
- [ ] User thường → 403
- [ ] Admin token hợp lệ → 200

### ✅ Data Validation
- [ ] Response format đúng
- [ ] Data types chính xác
- [ ] Required fields có đầy đủ
- [ ] Error messages rõ ràng

## 🚀 Quick Start

1. **Import Collection** vào Postman
2. **Set Environment** với base_url
3. **Login Admin** để lấy token
4. **Set admin_token** trong environment
5. **Test tất cả endpoints**

## 📝 Notes

- Server phải chạy tại `http://localhost:5000`
- Cần có dữ liệu trong database để test
- Token có thể hết hạn, cần login lại
- Kiểm tra console log để debug
