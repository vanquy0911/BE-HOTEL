// BE-HOTEL/services/embeddingService.js
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

class EmbeddingService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.genAI = null;
    this.embeddingModel = null;
    this.initialized = false;
    
    // ✅ THÊM: Cache cho query embeddings
    this.queryCache = new Map(); // Cache query embeddings
    this.maxCacheSize = 100; // Giới hạn cache size

    // Prefer newer embedding model for better retrieval quality
    const embedModel = (process.env.GEMINI_EMBED_MODEL || 'text-embedding-004').trim();

    if (this.apiKey) {
      this.genAI = new GoogleGenerativeAI(this.apiKey);
      this.embeddingModel = this.genAI.getGenerativeModel({ 
        model: embedModel
      });
      this.initialized = true;
      console.log(`✅ Gemini Embedding Service initialized (model: ${embedModel})`);
    } else {
      console.warn('⚠️  GEMINI_API_KEY not found, embedding service unavailable');
    }
  }

  /**
   * Generate embedding cho một text
   * @param {string} text - Text cần embed
   * @param {string} taskType - 'RETRIEVAL_DOCUMENT' (cho documents) hoặc 'RETRIEVAL_QUERY' (cho queries)
   * @returns {Promise<number[]>} - Embedding vector (768 dimensions)
   */
  async generateEmbedding(text, taskType = 'RETRIEVAL_DOCUMENT') {
    if (!this.initialized) {
      throw new Error('Embedding service not initialized. Check GEMINI_API_KEY.');
    }

    // ✅ THÊM: Cache cho queries (không cache documents)
    if (taskType === 'RETRIEVAL_QUERY') {
      const cacheKey = text.toLowerCase().trim();
      
      // Kiểm tra cache
      if (this.queryCache.has(cacheKey)) {
        console.log('✅ Using cached query embedding');
        return this.queryCache.get(cacheKey);
      }
    }

    try {
      const result = await this.embeddingModel.embedContent({
        content: { parts: [{ text }] },
        taskType: taskType,
      });

      const embedding = result.embedding.values;

      // ✅ THÊM: Cache query embedding
      if (taskType === 'RETRIEVAL_QUERY') {
        const cacheKey = text.toLowerCase().trim();
        this.queryCache.set(cacheKey, embedding);
        
        // Giới hạn cache size (FIFO - First In First Out)
        if (this.queryCache.size > this.maxCacheSize) {
          const firstKey = this.queryCache.keys().next().value;
          this.queryCache.delete(firstKey);
          console.log(`🗑️  Removed oldest cache entry (cache size: ${this.queryCache.size})`);
        }
        
        console.log(`💾 Cached query embedding (cache size: ${this.queryCache.size})`);
      }

      return embedding;
    } catch (error) {
      console.error('❌ Error generating Gemini embedding:', error);
      throw error;
    }
  }

  /**
   * Generate embeddings cho nhiều texts (batch)
   * @param {string[]} texts - Array of texts
   * @param {string} taskType - 'RETRIEVAL_DOCUMENT' hoặc 'RETRIEVAL_QUERY'
   * @returns {Promise<number[][]>} - Array of embedding vectors
   */
  async generateBatchEmbeddings(texts, taskType = 'RETRIEVAL_DOCUMENT') {
    if (!this.initialized) {
      throw new Error('Embedding service not initialized. Check GEMINI_API_KEY.');
    }

    try {
      const requests = texts.map(text => ({
        content: { parts: [{ text }] },
        taskType: taskType
      }));

      const result = await this.embeddingModel.batchEmbedContents({
        requests: requests
      });

      return result.embeddings.map(emb => emb.values);
    } catch (error) {
      console.error('❌ Error generating batch embeddings:', error);
      throw error;
    }
  }

  /**
   * Tính cosine similarity giữa 2 vectors
   * @param {number[]} vec1 
   * @param {number[]} vec2 
   * @returns {number} - Similarity score (0-1)
   */
  cosineSimilarity(vec1, vec2) {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * ✅ THÊM: Clear cache (cho testing hoặc khi cần)
   */
  clearCache() {
    this.queryCache.clear();
    console.log('🗑️  Query embedding cache cleared');
  }

  /**
   * ✅ THÊM: Get cache stats
   */
  getCacheStats() {
    return {
      size: this.queryCache.size,
      maxSize: this.maxCacheSize
    };
  }
}

export default new EmbeddingService();