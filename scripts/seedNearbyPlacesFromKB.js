// BE-HOTEL/scripts/seedNearbyPlacesFromKB.js
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import connectDB from '../config/configdb.js';
import NearbyPlace from '../Models/NearbyPlaceModel.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function để extract value từ một section
function extractValue(section, label) {
  if (!section) return null;
  // Tìm ### hoặc #### header với label
  const regex = new RegExp(`###+\\s*${label}[\\s\\S]*?\\n(.+?)(?=\\n###+|\\n---|$)`, 'i');
  const match = section.match(regex);
  return match ? match[1].trim() : null;
}

// Helper function để parse distance (300–500 m → "300-500m")
// Hỗ trợ dấu phẩy làm dấu thập phân: "1,5–2 km" → "1.5-2km"
function parseDistance(text) {
  if (!text) return null;
  const match = text.match(/([\d\.,\–-]+)\s*(m|km)/i);
  if (match) {
    let numericPart = match[1]
      .replace(/–/g, '-')    // normalize dash
      .replace(/\s+/g, '')   // remove spaces
      .replace(/,/g, '.');   // treat comma as decimal separator
    // tránh chuỗi kết thúc bằng dấu chấm/gạch
    numericPart = numericPart.replace(/\.+/g, '.').replace(/[\.-]+$/, '');
    return `${numericPart}${match[2].toLowerCase()}`;
  }
  return null;
}

// Helper function để parse time (5–10 phút đi bộ → "5-10 phút đi bộ")
function parseTime(text) {
  if (!text) return text;
  return text.replace(/–/g, '-').trim();
}

// Helper function để extract section từ content
function extractSection(content, headerText) {
  // Tìm header bằng indexOf (nhanh hơn và đáng tin cậy hơn)
  let headerIndex = content.indexOf(`## ${headerText}`);
  if (headerIndex === -1) {
    headerIndex = content.indexOf(`### ${headerText}`);
  }
  
  if (headerIndex === -1) {
    return null;
  }
  
  const start = content.indexOf('\n', headerIndex) + 1;
  // Tìm section tiếp theo (phải bỏ qua section hiện tại)
  const firstNewlineAfterStart = content.indexOf('\n', start);
  const searchStart = firstNewlineAfterStart !== -1 ? firstNewlineAfterStart + 1 : start;
  const nextSection = content.indexOf('\n##', searchStart);
  const nextDivider = content.indexOf('\n---', searchStart);
  let end = content.length;
  if (nextSection !== -1 && nextSection < end) end = nextSection;
  if (nextDivider !== -1 && nextDivider < end) end = nextDivider;
  return content.substring(start, end).trim();
}

// Parse nearby-beaches.md
function parseBeaches() {
  const filePath = path.join(__dirname, '../data/knowledge-base/nearby-beaches.md');
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  File not found: ${filePath}`);
    return [];
  }
  
  let content = fs.readFileSync(filePath, 'utf-8');
  // Remove BOM if present
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  const beaches = [];

  // Parse Bãi Sau - tìm trực tiếp bằng indexOf
  let baiSauSection = null;
  const baiSauIndex = content.indexOf('## Bãi Sau');
  if (baiSauIndex !== -1) {
    const start = content.indexOf('\n', baiSauIndex) + 1;
    // Tìm section tiếp theo (phải bỏ qua section hiện tại)
    // Tìm từ vị trí sau dòng đầu tiên của section hiện tại
    const firstNewlineAfterStart = content.indexOf('\n', start);
    const searchStart = firstNewlineAfterStart !== -1 ? firstNewlineAfterStart + 1 : start;
    const nextSection = content.indexOf('\n##', searchStart);
    const nextDivider = content.indexOf('\n---', searchStart);
    let end = content.length;
    if (nextSection !== -1 && nextSection < end) end = nextSection;
    if (nextDivider !== -1 && nextDivider < end) end = nextDivider;
    baiSauSection = content.substring(start, end).trim();
  }
  
  if (baiSauSection && baiSauSection.length > 0) {
    const distance = parseDistance(extractValue(baiSauSection, 'Khoảng cách'));
    const timeText = extractValue(baiSauSection, 'Thời gian di chuyển');
    const features = extractValue(baiSauSection, 'Đặc điểm');
    const activities = extractValue(baiSauSection, 'Hoạt động');
    const bestTime = extractValue(baiSauSection, 'Thời gian tốt nhất');
    const notes = extractValue(baiSauSection, 'Lưu ý');

    let description = '';
    if (features) description += `**Đặc điểm:** ${features}\n\n`;
    if (activities) description += `**Hoạt động:** ${activities}\n\n`;
    if (bestTime) description += `**Thời gian tốt nhất:** ${bestTime}\n\n`;
    if (notes) description += `**Lưu ý:** ${notes}`;

    const walkingTime = timeText && timeText.includes('đi bộ') ? parseTime(timeText.split('hoặc')[0].trim()) : null;
    const drivingTime = timeText && timeText.includes('xe') ? parseTime(timeText.split('hoặc')[1]?.trim() || timeText) : null;

    beaches.push({
      name: 'Bãi Sau (Bãi Thùy Vân)',
      category: 'attraction',
      distance: distance || '300-500m',
      walkingTime: walkingTime || '5-10 phút đi bộ',
      drivingTime: drivingTime || '2-3 phút đi xe',
      description: description.trim(),
      address: 'Bãi Sau, Phường Thắng Tam, TP. Vũng Tàu',
      isActive: true
    });
  }

  // Parse Bãi Trước - tìm trực tiếp
  let baiTruocSection = null;
  const baiTruocIndex = content.indexOf('## Bãi Trước');
  if (baiTruocIndex !== -1) {
    const start = content.indexOf('\n', baiTruocIndex) + 1;
    const firstNewlineAfterStart = content.indexOf('\n', start);
    const searchStart = firstNewlineAfterStart !== -1 ? firstNewlineAfterStart + 1 : start;
    const nextSection = content.indexOf('\n##', searchStart);
    const nextDivider = content.indexOf('\n---', searchStart);
    let end = content.length;
    if (nextSection !== -1 && nextSection < end) end = nextSection;
    if (nextDivider !== -1 && nextDivider < end) end = nextDivider;
    baiTruocSection = content.substring(start, end).trim();
  }
  if (baiTruocSection) {
    const distance = parseDistance(extractValue(baiTruocSection, 'Khoảng cách'));
    const timeText = extractValue(baiTruocSection, 'Thời gian di chuyển');
    const features = extractValue(baiTruocSection, 'Đặc điểm');
    const activities = extractValue(baiTruocSection, 'Hoạt động');

    let description = '';
    if (features) description += `**Đặc điểm:** ${features}\n\n`;
    if (activities) description += `**Hoạt động:** ${activities}`;

    const drivingTime = timeText ? parseTime(timeText) : null;

    beaches.push({
      name: 'Bãi Trước (Bãi Tầm Dương)',
      category: 'attraction',
      distance: distance || '2-3km',
      drivingTime: drivingTime || '7-10 phút đi xe',
      description: description.trim(),
      address: 'Bãi Trước, TP. Vũng Tàu',
      isActive: true
    });
  }

  // Parse Bãi Dứa - tìm trực tiếp
  let baiDuaSection = null;
  const baiDuaIndex = content.indexOf('## Bãi Dứa');
  if (baiDuaIndex !== -1) {
    const start = content.indexOf('\n', baiDuaIndex) + 1;
    const firstNewlineAfterStart = content.indexOf('\n', start);
    const searchStart = firstNewlineAfterStart !== -1 ? firstNewlineAfterStart + 1 : start;
    const nextSection = content.indexOf('\n##', searchStart);
    const nextDivider = content.indexOf('\n---', searchStart);
    let end = content.length;
    if (nextSection !== -1 && nextSection < end) end = nextSection;
    if (nextDivider !== -1 && nextDivider < end) end = nextDivider;
    baiDuaSection = content.substring(start, end).trim();
  }
  if (baiDuaSection) {
    const distance = parseDistance(extractValue(baiDuaSection, 'Khoảng cách'));
    const timeText = extractValue(baiDuaSection, 'Thời gian di chuyển');
    const features = extractValue(baiDuaSection, 'Đặc điểm');
    const activities = extractValue(baiDuaSection, 'Hoạt động');

    let description = '';
    if (features) description += `**Đặc điểm:** ${features}\n\n`;
    if (activities) description += `**Hoạt động:** ${activities}`;

    const drivingTime = timeText ? parseTime(timeText) : null;

    beaches.push({
      name: 'Bãi Dứa (Bãi Ô Quắn)',
      category: 'attraction',
      distance: distance || '2km',
      drivingTime: drivingTime || '5-7 phút đi xe',
      description: description.trim(),
      address: 'Bãi Dứa, TP. Vũng Tàu',
      isActive: true
    });
  }

  return beaches;
}

// Parse nearby-mountains.md
function parseMountains() {
  const filePath = path.join(__dirname, '../data/knowledge-base/nearby-mountains.md');
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  File not found: ${filePath}`);
    return [];
  }
  
  let content = fs.readFileSync(filePath, 'utf-8');
  // Remove BOM if present
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  const mountains = [];

  // Parse Núi Nhỏ
  const nuiNhoSection = extractSection(content, 'Núi Nhỏ');
  if (nuiNhoSection) {
    const distance = parseDistance(extractValue(nuiNhoSection, 'Khoảng cách'));
    const timeText = extractValue(nuiNhoSection, 'Thời gian di chuyển');
    const height = extractValue(nuiNhoSection, 'Độ cao');
    const difficulty = extractValue(nuiNhoSection, 'Độ khó');
    const activities = extractValue(nuiNhoSection, 'Hoạt động');
    const bestTime = extractValue(nuiNhoSection, 'Thời gian tốt nhất');
    const notes = extractValue(nuiNhoSection, 'Lưu ý');

    let description = '';
    if (height) description += `**Độ cao:** ${height}\n\n`;
    if (difficulty) description += `**Độ khó:** ${difficulty}\n\n`;
    if (activities) description += `**Hoạt động:** ${activities}\n\n`;
    if (bestTime) description += `**Thời gian tốt nhất:** ${bestTime}\n\n`;
    if (notes) description += `**Lưu ý:** ${notes}`;

    const drivingTime = timeText ? parseTime(timeText) : null;

    mountains.push({
      name: 'Núi Nhỏ (Tao Phùng)',
      category: 'attraction',
      distance: distance || '1.5-2km',
      drivingTime: drivingTime || '5-10 phút đi xe',
      description: description.trim(),
      address: 'Núi Nhỏ, TP. Vũng Tàu',
      isActive: true
    });
  }

  // Parse Núi Lớn
  const nuiLonSection = extractSection(content, 'Núi Lớn');
  if (nuiLonSection) {
    const distance = parseDistance(extractValue(nuiLonSection, 'Khoảng cách'));
    const timeText = extractValue(nuiLonSection, 'Thời gian di chuyển');
    const height = extractValue(nuiLonSection, 'Độ cao');
    const difficulty = extractValue(nuiLonSection, 'Độ khó');
    const features = extractValue(nuiLonSection, 'Đặc điểm');
    const activities = extractValue(nuiLonSection, 'Hoạt động');

    let description = '';
    if (height) description += `**Độ cao:** ${height}\n\n`;
    if (difficulty) description += `**Độ khó:** ${difficulty}\n\n`;
    if (features) description += `**Đặc điểm:** ${features}\n\n`;
    if (activities) description += `**Hoạt động:** ${activities}`;

    const drivingTime = timeText ? parseTime(timeText) : null;

    mountains.push({
      name: 'Núi Lớn',
      category: 'attraction',
      distance: distance || '3-4km',
      drivingTime: drivingTime || '10-15 phút đi xe',
      description: description.trim(),
      address: 'Núi Lớn, TP. Vũng Tàu',
      isActive: true
    });
  }

  // Parse Hải đăng
  const haiDangSection = extractSection(content, 'Hải đăng Vũng Tàu');
  if (haiDangSection) {
    const distance = parseDistance(extractValue(haiDangSection, 'Khoảng cách'));
    const timeText = extractValue(haiDangSection, 'Thời gian di chuyển');
    const features = extractValue(haiDangSection, 'Đặc điểm');
    const activities = extractValue(haiDangSection, 'Hoạt động');

    let description = '';
    if (features) description += `**Đặc điểm:** ${features}\n\n`;
    if (activities) description += `**Hoạt động:** ${activities}`;

    const drivingTime = timeText ? parseTime(timeText) : null;

    mountains.push({
      name: 'Hải đăng Vũng Tàu',
      category: 'attraction',
      distance: distance || '2km',
      drivingTime: drivingTime || '5-7 phút đi xe',
      description: description.trim(),
      address: 'Hải đăng Vũng Tàu, khu vực Núi Nhỏ, TP. Vũng Tàu',
      isActive: true
    });
  }

  return mountains;
}

// Parse nearby-restaurants.md
function parseRestaurants() {
  const filePath = path.join(__dirname, '../data/knowledge-base/nearby-restaurants.md');
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  File not found: ${filePath}`);
    return [];
  }
  
  let content = fs.readFileSync(filePath, 'utf-8');
  // Remove BOM if present
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  const restaurants = [];

  // Parse Nhà hàng Gành Hào
  const ganhHaoSection = extractSection(content, 'Nhà hàng Gành Hào');
  if (ganhHaoSection) {
    const distance = parseDistance(extractValue(ganhHaoSection, 'Khoảng cách'));
    const timeText = extractValue(ganhHaoSection, 'Thời gian di chuyển');
    const cuisine = extractValue(ganhHaoSection, 'Loại ẩm thực');
    const price = extractValue(ganhHaoSection, 'Giá cả');
    const hours = extractValue(ganhHaoSection, 'Giờ mở cửa');
    const specialties = extractValue(ganhHaoSection, 'Đặc sản');
    const notes = extractValue(ganhHaoSection, 'Lưu ý');

    let description = '';
    if (cuisine) description += `**Loại ẩm thực:** ${cuisine}\n\n`;
    if (price) description += `**Giá cả:** ${price}\n\n`;
    if (hours) description += `**Giờ mở cửa:** ${hours}\n\n`;
    if (specialties) description += `**Đặc sản:** ${specialties}\n\n`;
    if (notes) description += `**Lưu ý:** ${notes}`;

    const drivingTime = timeText ? parseTime(timeText) : null;

    restaurants.push({
      name: 'Nhà hàng Gành Hào',
      category: 'restaurant',
      distance: distance || '1.5-2km',
      drivingTime: drivingTime || '5-7 phút đi xe',
      description: description.trim(),
      address: 'Gành Hào, TP. Vũng Tàu',
      isActive: true
    });
  }

  // Parse Nhà hàng Vạn Chài
  const vanChaiSection = extractSection(content, 'Nhà hàng Vạn Chài');
  if (vanChaiSection) {
    const distance = parseDistance(extractValue(vanChaiSection, 'Khoảng cách'));
    const timeText = extractValue(vanChaiSection, 'Thời gian di chuyển');
    const cuisine = extractValue(vanChaiSection, 'Loại ẩm thực');
    const price = extractValue(vanChaiSection, 'Giá cả');
    const specialties = extractValue(vanChaiSection, 'Đặc sản');
    const notes = extractValue(vanChaiSection, 'Lưu ý');

    let description = '';
    if (cuisine) description += `**Loại ẩm thực:** ${cuisine}\n\n`;
    if (price) description += `**Giá cả:** ${price}\n\n`;
    if (specialties) description += `**Đặc sản:** ${specialties}\n\n`;
    if (notes) description += `**Lưu ý:** ${notes}`;

    const drivingTime = timeText ? parseTime(timeText) : null;

    restaurants.push({
      name: 'Nhà hàng Vạn Chài',
      category: 'restaurant',
      distance: distance || '2km',
      drivingTime: drivingTime || '6-8 phút đi xe',
      description: description.trim(),
      address: 'Vạn Chài, TP. Vũng Tàu',
      isActive: true
    });
  }

  // Parse Nhà hàng La Sirena
  const laSirenaSection = extractSection(content, 'Nhà hàng La Sirena');
  if (laSirenaSection) {
    const distance = parseDistance(extractValue(laSirenaSection, 'Khoảng cách'));
    const timeText = extractValue(laSirenaSection, 'Thời gian di chuyển');
    const cuisine = extractValue(laSirenaSection, 'Loại ẩm thực');
    const price = extractValue(laSirenaSection, 'Giá cả');
    const specialties = extractValue(laSirenaSection, 'Đặc sản');
    const notes = extractValue(laSirenaSection, 'Lưu ý');

    let description = '';
    if (cuisine) description += `**Loại ẩm thực:** ${cuisine}\n\n`;
    if (price) description += `**Giá cả:** ${price}\n\n`;
    if (specialties) description += `**Đặc sản:** ${specialties}\n\n`;
    if (notes) description += `**Lưu ý:** ${notes}`;

    const drivingTime = timeText ? parseTime(timeText) : null;

    restaurants.push({
      name: 'Nhà hàng La Sirena',
      category: 'restaurant',
      distance: distance || '1km',
      drivingTime: drivingTime || '3-5 phút đi xe',
      description: description.trim(),
      address: 'Khu vực ven biển, TP. Vũng Tàu',
      isActive: true
    });
  }

  // Parse Bánh khọt Gốc Vú Sữa
  const banhKhotSection = extractSection(content, 'Bánh khọt Gốc Vú Sữa');
  if (banhKhotSection) {
    const distance = parseDistance(extractValue(banhKhotSection, 'Khoảng cách'));
    const specialties = extractValue(banhKhotSection, 'Đặc sản');
    const price = extractValue(banhKhotSection, 'Giá cả');
    const notes = extractValue(banhKhotSection, 'Lưu ý');

    let description = '';
    if (specialties) description += `**Đặc sản:** ${specialties}\n\n`;
    if (price) description += `**Giá cả:** ${price}\n\n`;
    if (notes) description += `**Lưu ý:** ${notes}`;

    restaurants.push({
      name: 'Bánh khọt Gốc Vú Sữa',
      category: 'restaurant',
      distance: distance || '2-3km',
      description: description.trim(),
      address: 'Gốc Vú Sữa, TP. Vũng Tàu',
      isActive: true
    });
  }

  // Parse Lẩu cá đuối Trương Công Định
  const lauCaDuoiSection = extractSection(content, 'Lẩu cá đuối Trương Công Định');
  if (lauCaDuoiSection) {
    const distance = parseDistance(extractValue(lauCaDuoiSection, 'Khoảng cách'));
    const specialties = extractValue(lauCaDuoiSection, 'Đặc sản');
    const price = extractValue(lauCaDuoiSection, 'Giá cả');
    const notes = extractValue(lauCaDuoiSection, 'Lưu ý');

    let description = '';
    if (specialties) description += `**Đặc sản:** ${specialties}\n\n`;
    if (price) description += `**Giá cả:** ${price}\n\n`;
    if (notes) description += `**Lưu ý:** ${notes}`;

    restaurants.push({
      name: 'Lẩu cá đuối Trương Công Định',
      category: 'restaurant',
      distance: distance || '2km',
      description: description.trim(),
      address: 'Trương Công Định, TP. Vũng Tàu',
      isActive: true
    });
  }

  // Parse Ốc Tự Nhiên
  const ocTuNhienSection = extractSection(content, 'Ốc Tự Nhiên');
  if (ocTuNhienSection) {
    const distance = parseDistance(extractValue(ocTuNhienSection, 'Khoảng cách'));
    const specialties = extractValue(ocTuNhienSection, 'Đặc sản');
    const price = extractValue(ocTuNhienSection, 'Giá cả');
    const notes = extractValue(ocTuNhienSection, 'Lưu ý');

    let description = '';
    if (specialties) description += `**Đặc sản:** ${specialties}\n\n`;
    if (price) description += `**Giá cả:** ${price}\n\n`;
    if (notes) description += `**Lưu ý:** ${notes}`;

    restaurants.push({
      name: 'Ốc Tự Nhiên',
      category: 'restaurant',
      distance: distance || '2km',
      description: description.trim(),
      address: 'TP. Vũng Tàu',
      isActive: true
    });
  }

  return restaurants;
}

// Main function
async function seedNearbyPlaces() {
  try {
    console.log('🚀 Starting Nearby Places Seeding from Knowledge Base...\n');

    // Connect to database
    console.log('📡 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ MongoDB connected\n');

    // Parse all knowledge base files
    console.log('📚 Parsing knowledge base files...');
    const beaches = parseBeaches();
    const mountains = parseMountains();
    const restaurants = parseRestaurants();

    const allPlaces = [...beaches, ...mountains, ...restaurants];

    console.log(`✅ Parsed ${allPlaces.length} places:`);
    console.log(`   - Beaches: ${beaches.length}`);
    console.log(`   - Mountains: ${mountains.length}`);
    console.log(`   - Restaurants: ${restaurants.length}\n`);

    if (allPlaces.length === 0) {
      console.warn('⚠️  No places found to seed!');
      console.log('💡 Please check that knowledge base files exist:');
      console.log('   - data/knowledge-base/nearby-beaches.md');
      console.log('   - data/knowledge-base/nearby-mountains.md');
      console.log('   - data/knowledge-base/nearby-restaurants.md');
      process.exit(0);
    }

    // Upsert to database (update if exists, insert if not)
    console.log('💾 Seeding to database...');
    let created = 0;
    let updated = 0;

    for (const place of allPlaces) {
      const existing = await NearbyPlace.findOne({ name: place.name });
      if (existing) {
        await NearbyPlace.findOneAndUpdate(
          { name: place.name },
          place,
          { new: true }
        );
        updated++;
        console.log(`   ✅ Updated: ${place.name}`);
      } else {
        await NearbyPlace.create(place);
        created++;
        console.log(`   ✅ Created: ${place.name}`);
      }
    }

    console.log(`\n✅ Seeding completed!`);
    console.log(`   - Created: ${created}`);
    console.log(`   - Updated: ${updated}`);
    console.log(`   - Total: ${allPlaces.length}`);
    console.log(`\n💡 Now you can check ExploreModal to see the places!`);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    console.error('Error details:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

seedNearbyPlaces();
