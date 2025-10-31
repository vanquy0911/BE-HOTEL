// Simple test script
console.log('🔍 Testing backend connection...');

// Test 1: Check if we can import modules
try {
  const mongoose = require('mongoose');
  console.log('✅ Mongoose imported successfully');
} catch (error) {
  console.error('❌ Error importing mongoose:', error.message);
}

// Test 2: Check environment variables
try {
  require('dotenv').config();
  console.log('✅ Dotenv loaded');
  console.log('🔍 MONGO_URI:', process.env.MONGO_URI ? 'Found' : 'Not found');
  console.log('🔍 JWT_SECRET:', process.env.JWT_SECRET ? 'Found' : 'Not found');
} catch (error) {
  console.error('❌ Error loading dotenv:', error.message);
}

console.log('✅ Simple test completed');


