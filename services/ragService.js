// BE-HOTEL/services/ragService.js
import embeddingService from './embeddingService.js';
import vectorStore from './vectorStore.js';

class RAGService {
  constructor() {
    this.initialized = false;
    
    // ✅ THÊM: Rate limiting
    this.dailyQueryCount = 0;
    this.maxQueriesPerDay = 50; // Giới hạn 50 queries/ngày cho RAG
    this.lastResetDate = new Date().toDateString();
    
    // ✅ THÊM: Simple questions không cần RAG
    this.simpleQuestions = [
      'xin chào', 'hello', 'hi', 'chào', 'hey',
      'cảm ơn', 'thanks', 'thank you', 'cám ơn',
      'tạm biệt', 'bye', 'goodbye', 'see you',
      'ok', 'okay', 'được', 'vâng', 'yes', 'no', 'không'
    ];
  }

  async initialize() {
    if (!this.initialized) {
      await vectorStore.initialize();
      this.initialized = true;
    }
  }

  /**
   * ✅ THÊM: Kiểm tra xem có nên dùng RAG không
   */
  shouldUseRAG(query) {
    const lowerQuery = query.toLowerCase().trim();
    
    // Skip RAG cho câu hỏi đơn giản
    if (this.simpleQuestions.some(q => lowerQuery === q || lowerQuery.startsWith(q + ' '))) {
      console.log('⏭️  Skipping RAG for simple question');
      return false;
    }
    
    // Reset daily counter nếu sang ngày mới
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.dailyQueryCount = 0;
      this.lastResetDate = today;
      console.log('🔄 RAG daily counter reset');
    }
    
    // Check rate limit
    if (this.dailyQueryCount >= this.maxQueriesPerDay) {
      console.warn(`⚠️  RAG daily limit reached (${this.maxQueriesPerDay}), skipping embedding`);
      return false;
    }
    
    return true;
  }

  /**
   * Retrieve relevant documents từ knowledge base
   * @param {string} query - User query
   * @param {number} topK - Number of documents to retrieve
   * @param {object} filters - Optional filters
   * @returns {Promise<Array>} - [{ text, metadata, score }]
   */
  async retrieve(query, topK = 3, filters = {}) {
    await this.initialize();

    // ✅ THÊM: Kiểm tra có nên dùng RAG không
    if (!this.shouldUseRAG(query)) {
      return []; // Return empty, chatbot vẫn hoạt động nhưng không có RAG
    }

    try {
      // Generate query embedding
      const queryEmbedding = await embeddingService.generateEmbedding(
        query,
        'RETRIEVAL_QUERY' // Dùng RETRIEVAL_QUERY cho queries
      );

      // ✅ THÊM: Tăng counter sau khi generate embedding thành công
      this.dailyQueryCount++;
      console.log(`📊 RAG query count: ${this.dailyQueryCount}/${this.maxQueriesPerDay}`);

      // Search trong vector store
      const results = await vectorStore.search(queryEmbedding, topK, filters);

      return results;
    } catch (error) {
      console.error('❌ RAG retrieval error:', error);
      // Return empty array nếu có lỗi (fallback)
      return [];
    }
  }

  /**
   * Build prompt với retrieved context
   * @param {string} userMessage - User message
   * @param {Array} retrievedDocs - Retrieved documents
   * @param {string} systemPrompt - Base system prompt
   * @param {string} language - 'vi' hoặc 'en'
   * @returns {string} - Complete prompt
   */
  buildPromptWithContext(userMessage, retrievedDocs, systemPrompt, language = 'vi') {
    let prompt = systemPrompt + "\n\n";

    if (retrievedDocs && retrievedDocs.length > 0) {
      const langLabel = language === 'vi' ? 'THÔNG TIN THAM KHẢO' : 'REFERENCE INFORMATION';
      const langNote = language === 'vi' 
        ? 'LƯU Ý: Sử dụng thông tin trên để trả lời câu hỏi. Nếu thông tin không có trong knowledge base, hãy nói rõ và hướng dẫn khách liên hệ hotline.'
        : 'NOTE: Use the information above to answer the question. If the information is not in the knowledge base, please clarify and guide the customer to contact the hotline.';

      prompt += `${langLabel} TỪ KNOWLEDGE BASE:\n`;
      prompt += "=".repeat(50) + "\n";

      retrievedDocs.forEach((doc, index) => {
        prompt += `\n[Document ${index + 1}]\n`;
        prompt += `${doc.text}\n`;
        if (doc.metadata?.source) {
          prompt += `Nguồn: ${doc.metadata.source}\n`;
        }
        prompt += "\n";
      });

      prompt += "=".repeat(50) + "\n\n";
      prompt += `${langNote}\n\n`;
    }

    const userLabel = language === 'vi' ? 'Khách hàng' : 'Customer';
    const botLabel = language === 'vi' ? 'Bạn' : 'You';
    
    prompt += `${userLabel}: ${userMessage}\n${botLabel}:`;

    return prompt;
  }

  /**
   * Format retrieved documents để hiển thị (cho debugging)
   * @param {Array} retrievedDocs 
   * @returns {string}
   */
  formatRetrievedDocs(retrievedDocs) {
    if (!retrievedDocs || retrievedDocs.length === 0) {
      return 'No documents retrieved';
    }

    return retrievedDocs.map((doc, idx) => {
      return `[${idx + 1}] Score: ${doc.score.toFixed(3)}\nSource: ${doc.metadata?.source}\nText: ${doc.text.substring(0, 100)}...`;
    }).join('\n\n');
  }

  /**
   * ✅ THÊM: Get RAG stats
   */
  getStats() {
    return {
      dailyQueryCount: this.dailyQueryCount,
      maxQueriesPerDay: this.maxQueriesPerDay,
      lastResetDate: this.lastResetDate
    };
  }
}

export default new RAGService();