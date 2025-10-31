// Test script để kiểm tra thêm phòng
import fetch from 'node-fetch';

const testRoomData = {
  name: "Phòng Deluxe Hướng Biển",
  roomNumber: "D201",
  roomType: "đôi",
  bedType: "king",
  maxOccupancy: 2,
  size: 35,
  pricePerNight: 2500000,
  fee: 200000,
  description: "Phòng deluxe cao cấp với view biển tuyệt đẹp, không gian rộng rãi 35m². Được trang bị đầy đủ tiện nghi hiện đại bao gồm giường King size, bồn tắm jacuzzi, minibar và ban công riêng hướng biển.",
  view: "Hướng biển",
  available: true,
  isAvailable: 1,
  amenities: ["Wi-Fi miễn phí", "TV 55 inch", "Minibar", "Bồn tắm jacuzzi", "View biển"],
  image: "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800&h=600&fit=crop"
};

async function testAddRoom() {
  try {
    console.log('🔍 Testing add room...');
    console.log('📊 Room data size:', JSON.stringify(testRoomData).length, 'bytes');
    
    const response = await fetch('http://localhost:5000/api/rooms/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_ADMIN_TOKEN_HERE' // Thay bằng token admin thực tế
      },
      body: JSON.stringify(testRoomData)
    });

    console.log('📡 Response status:', response.status);
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Success:', data);
    } else {
      const errorData = await response.text();
      console.log('❌ Error:', errorData);
    }
  } catch (error) {
    console.error('❌ Test error:', error);
  }
}

testAddRoom();
