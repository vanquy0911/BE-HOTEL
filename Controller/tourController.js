// BE-HOTEL/Controller/tourController.js
import asyncHandler from "express-async-handler";
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function để extract section từ markdown
function extractSection(content, headerText) {
  let headerIndex = content.indexOf(`## ${headerText}`);
  if (headerIndex === -1) {
    headerIndex = content.indexOf(`### ${headerText}`);
  }
  
  if (headerIndex === -1) {
    return null;
  }
  
  const start = content.indexOf('\n', headerIndex) + 1;
  const firstNewlineAfterStart = content.indexOf('\n', start);
  const searchStart = firstNewlineAfterStart !== -1 ? firstNewlineAfterStart + 1 : start;
  const nextSection = content.indexOf('\n##', searchStart);
  const nextDivider = content.indexOf('\n---', searchStart);
  let end = content.length;
  if (nextSection !== -1 && nextSection < end) end = nextSection;
  if (nextDivider !== -1 && nextDivider < end) end = nextDivider;
  return content.substring(start, end).trim();
}

// Helper function để extract value từ section
function extractValue(section, label) {
  if (!section) return null;
  const regex = new RegExp(`###+\\s*${label}[\\s\\S]*?\\n(.+?)(?=\\n###+|\\n---|$)`, 'i');
  const match = section.match(regex);
  return match ? match[1].trim() : null;
}

// GET /api/tours - Lấy thông tin tours và vị trí khách sạn
export const getToursAndLocation = asyncHandler(async (req, res) => {
  try {
    const kbPath = path.join(__dirname, '../data/knowledge-base');
    
    // Parse nearby-attractions.md để lấy tours
    const attractionsPath = path.join(kbPath, 'nearby-attractions.md');
    let tours = [];
    
    if (fs.existsSync(attractionsPath)) {
      const content = fs.readFileSync(attractionsPath, 'utf-8');
      
      // Helper function để parse tour section
      const parseTour = (section, id, name, icon) => {
        if (!section) return null;
        const lines = section.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
        const activities = [];
        let suitable = '';
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('-')) {
            // Remove markdown bold if present
            const activity = trimmed.replace(/^-\s*/, '').replace(/\*\*/g, '').trim();
            if (activity && !activity.toLowerCase().includes('phù hợp')) {
              activities.push(activity);
            }
          } else if (trimmed.toLowerCase().includes('phù hợp')) {
            suitable = trimmed.replace(/^phù hợp\s*:?\s*/i, '').trim();
          }
        }
        
        return {
          id,
          name,
          icon,
          activities: activities.length > 0 ? activities : [],
          suitable: suitable || ''
        };
      };
      
      // Parse Tour nửa ngày biển
      const beachTourSection = extractSection(content, 'Tour nửa ngày biển');
      const beachTour = parseTour(beachTourSection, 'beach-half-day', 'Tour nửa ngày biển', '🌊');
      if (beachTour) tours.push(beachTour);
      
      // Parse Tour nửa ngày núi
      const mountainTourSection = extractSection(content, 'Tour nửa ngày núi');
      const mountainTour = parseTour(mountainTourSection, 'mountain-half-day', 'Tour nửa ngày núi', '⛰️');
      if (mountainTour) tours.push(mountainTour);
      
      // Parse Tour ẩm thực
      const foodTourSection = extractSection(content, 'Tour ẩm thực');
      const foodTour = parseTour(foodTourSection, 'food-tour', 'Tour ẩm thực', '🍽️');
      if (foodTour) tours.push(foodTour);
      
      // Parse Tour kết hợp
      const combinedTourSection = extractSection(content, 'Tour kết hợp');
      const combinedTour = parseTour(combinedTourSection, 'combined-tour', 'Tour kết hợp (1 ngày)', '🗺️');
      if (combinedTour) tours.push(combinedTour);
      
      // Parse Dịch vụ khách sạn
      const servicesSection = extractSection(content, 'Dịch vụ khách sạn');
      const services = [];
      if (servicesSection) {
        const tuvanTour = extractValue(servicesSection, 'Tư vấn & sắp xếp tour');
        const duaDon = extractValue(servicesSection, 'Đưa đón');
        const huongDanVien = extractValue(servicesSection, 'Hướng dẫn viên địa phương');
        const phuongTien = extractValue(servicesSection, 'Phương tiện di chuyển');
        
        if (tuvanTour) services.push({ name: 'Tư vấn & sắp xếp tour', description: tuvanTour });
        if (duaDon) services.push({ name: 'Đưa đón', description: duaDon });
        if (huongDanVien) services.push({ name: 'Hướng dẫn viên địa phương', description: huongDanVien });
        if (phuongTien) services.push({ name: 'Phương tiện di chuyển', description: phuongTien });
      }
      
      // Parse hotel-location.md để lấy thông tin vị trí
      const locationPath = path.join(kbPath, 'hotel-location.md');
      let locationInfo = null;
      
      if (fs.existsSync(locationPath)) {
        const locationContent = fs.readFileSync(locationPath, 'utf-8');
        const viTriSection = extractSection(locationContent, 'Vị trí địa lý');
        const loiTheSection = extractSection(locationContent, 'Lợi thế vị trí');
        const diaChiSection = extractSection(locationContent, 'Địa chỉ');
        
        // Parse description từ vị trí địa lý
        let description = '';
        if (viTriSection) {
          const lines = viTriSection.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
          description = lines.join(' ').trim();
        }
        
        const advantages = [];
        if (loiTheSection) {
          const ganBien = extractValue(loiTheSection, 'Gần biển');
          const ganNui = extractValue(loiTheSection, 'Gần núi');
          const ganTrungTam = extractValue(loiTheSection, 'Gần trung tâm du lịch');
          const giaoThong = extractValue(loiTheSection, 'Giao thông thuận tiện');
          
          if (ganBien) advantages.push({ title: 'Gần biển', description: ganBien, icon: '🌊' });
          if (ganNui) advantages.push({ title: 'Gần núi', description: ganNui, icon: '⛰️' });
          if (ganTrungTam) advantages.push({ title: 'Gần trung tâm du lịch', description: ganTrungTam, icon: '🏙️' });
          if (giaoThong) advantages.push({ title: 'Giao thông thuận tiện', description: giaoThong, icon: '🚗' });
        }
        
        let address = '';
        let hotline = '';
        let email = '';
        
        if (diaChiSection) {
          const lines = diaChiSection.split('\n');
          for (const line of lines) {
            if (line.includes('Địa chỉ:')) {
              address = line.replace(/.*Địa chỉ:\s*/, '').replace(/\*\*/g, '').trim();
            } else if (line.includes('Hotline:')) {
              hotline = line.replace(/.*Hotline:\s*/, '').trim();
            } else if (line.includes('Email:')) {
              email = line.replace(/.*Email:\s*/, '').trim();
            }
          }
        }
        
        locationInfo = {
          description: viTriSection ? viTriSection.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).join(' ') : '',
          advantages,
          address,
          hotline,
          email
        };
      }
      
      res.json({
        data: {
          tours,
          services,
          location: locationInfo
        }
      });
    } else {
      res.json({
        data: {
          tours: [],
          services: [],
          location: null
        }
      });
    }
  } catch (error) {
    console.error('Error loading tours and location:', error);
    res.status(500).json({ message: 'Lỗi khi tải thông tin tour và vị trí' });
  }
});

