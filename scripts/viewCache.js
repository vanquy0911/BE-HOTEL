// BE-HOTEL/scripts/viewCache.js
import dotenv from 'dotenv';
import connectDB from '../config/configdb.js';
import ResponseCache from '../Models/ResponseCacheModel.js';

dotenv.config();

async function viewCache() {
  try {
    console.log('📡 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ MongoDB connected\n');

    // Lấy tất cả cache entries
    const caches = await ResponseCache.find({})
      .sort({ lastUsed: -1 }) // Sắp xếp theo lastUsed mới nhất
      .select('queryText queryKey hitCount lastUsed createdAt')
      .lean();

    if (caches.length === 0) {
      console.log('⚠️  No cache entries found!');
      process.exit(0);
    }

    console.log(`📊 Found ${caches.length} cached responses:\n`);
    console.log('='.repeat(80));
    
    caches.forEach((cache, index) => {
      console.log(`\n${index + 1}. Query: "${cache.queryText}"`);
      console.log(`   Key: ${cache.queryKey}`);
      console.log(`   Hit Count: ${cache.hitCount}`);
      console.log(`   Last Used: ${cache.lastUsed ? new Date(cache.lastUsed).toLocaleString('vi-VN') : 'N/A'}`);
      console.log(`   Created: ${cache.createdAt ? new Date(cache.createdAt).toLocaleString('vi-VN') : 'N/A'}`);
      console.log('-'.repeat(80));
    });

    console.log(`\n✅ Total: ${caches.length} cached responses`);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error viewing cache:', error);
    process.exit(1);
  }
}

viewCache();


