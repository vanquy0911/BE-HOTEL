// BE-HOTEL/services/vectorStore.js
import VectorStore from '../Models/VectorStoreModel.js';
import embeddingService from './embeddingService.js';

class VectorStoreService {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    // MongoDB đã connect, không cần init gì thêm
    this.initialized = true;
    console.log('✅ Vector Store Service initialized (MongoDB-based)');
  }

  /**
   * Add documents vào vector store
   * @param {Array} documents - [{ id, text, embedding, metadata }]
   */
  async addDocuments(documents) {
    try {
      // Filter out documents without embeddings
      const validDocs = documents.filter(doc => 
        doc.embedding && 
        Array.isArray(doc.embedding) && 
        doc.embedding.length > 0
      );

      if (validDocs.length === 0) {
        throw new Error('No valid documents to insert (all missing embeddings)');
      }

      // ✅ SỬA: Dùng validDocs thay vì documents
      const docsToInsert = validDocs.map(doc => ({
        chunkId: doc.id,
        documentId: doc.metadata?.documentId || doc.id,
        text: doc.text,
        embedding: doc.embedding,
        metadata: {
          source: doc.metadata?.source || doc.source || 'unknown',
          type: doc.metadata?.type || 'general',
          chunkIndex: doc.metadata?.chunkIndex || 0,
          createdAt: doc.metadata?.createdAt || new Date()
        }
      }));

      // ✅ SỬA: Xóa documents cũ trước (nếu cần update)
      const chunkIds = docsToInsert.map(doc => doc.chunkId);
      await VectorStore.deleteMany({ chunkId: { $in: chunkIds } });

      // ✅ SỬA: Dùng insertMany thay vì bulkWrite để tránh lỗi casting
      await VectorStore.insertMany(docsToInsert, { ordered: false });

      console.log(`✅ Added ${docsToInsert.length} chunks to vector store`);
    } catch (error) {
      console.error('❌ Error adding documents to vector store:', error);
      throw error;
    }
  }

  /**
   * Search similar documents
   * @param {number[]} queryEmbedding - Query embedding vector
   * @param {number} topK - Number of results
   * @param {object} filters - Optional filters { type, documentId }
   * @returns {Promise<Array>} - [{ text, metadata, score }]
   */
  async search(queryEmbedding, topK = 3, filters = {}) {
    try {
      // Build query filter
      let query = {};
      if (filters.type) {
        query['metadata.type'] = filters.type;
      }
      if (filters.documentId) {
        query.documentId = filters.documentId;
      }

      // ✅ THÊM LOGGING
      console.log(`🔍 VectorStore.search: Query filter:`, JSON.stringify(query));

      // Lấy tất cả documents (hoặc filtered)
      // Note: MongoDB local không có vector search built-in
      // Nên phải tính similarity manually
      const allDocs = await VectorStore.find(query).lean();

      // ✅ THÊM LOGGING
      console.log(`📊 VectorStore.search: Found ${allDocs.length} documents in database`);

      if (allDocs.length === 0) {
        console.warn('⚠️  VectorStore is empty! Run: npm run ingest-kb');
        return [];
      }

      // Tính similarity cho mỗi document
      const results = allDocs.map(doc => {
        const similarity = embeddingService.cosineSimilarity(
          queryEmbedding,
          doc.embedding
        );
        return {
          text: doc.text,
          metadata: doc.metadata,
          score: similarity,
          chunkId: doc.chunkId,
          documentId: doc.documentId
        };
      });

      // Sort by similarity và lấy topK
      results.sort((a, b) => b.score - a.score);
      const topResults = results.slice(0, topK);

      // ✅ THÊM LOGGING
      console.log(`✅ VectorStore.search: Returning ${topResults.length} top results`);
      if (topResults.length > 0) {
        console.log(`   Top score: ${topResults[0].score.toFixed(3)}`);
        console.log(`   Top source: ${topResults[0].metadata?.source || 'unknown'}`);
      }

      return topResults;
    } catch (error) {
      console.error('❌ Error searching vector store:', error);
      throw error;
    }
  }

  /**
   * Delete documents by documentId (khi update document)
   * @param {string} documentId 
   */
  async deleteByDocumentId(documentId) {
    try {
      await VectorStore.deleteMany({ documentId });
      console.log(`✅ Deleted all chunks for document: ${documentId}`);
    } catch (error) {
      console.error('❌ Error deleting documents:', error);
      throw error;
    }
  }

  /**
   * Get stats về vector store
   */
  async getStats() {
    try {
      const total = await VectorStore.countDocuments();
      const byType = await VectorStore.aggregate([
        {
          $group: {
            _id: '$metadata.type',
            count: { $sum: 1 }
          }
        }
      ]);

      return {
        total,
        byType: byType.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      };
    } catch (error) {
      console.error('❌ Error getting stats:', error);
      return { total: 0, byType: {} };
    }
  }
}

export default new VectorStoreService();