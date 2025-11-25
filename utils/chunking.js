// BE-HOTEL/utils/chunking.js

/**
 * Chia text thành các chunks nhỏ hơn
 * @param {string} text - Text cần chunk
 * @param {number} chunkSize - Kích thước chunk (số ký tự)
 * @param {number} overlap - Số ký tự overlap giữa các chunks
 * @returns {string[]} - Array of chunks
 */
export const chunkText = (text, chunkSize = 500, overlap = 50) => {
    if (!text || text.length === 0) {
      return [];
    }
  
    const chunks = [];
    let start = 0;
  
    // Chia theo câu (ưu tiên)
    const sentences = text.split(/(?<=[.!?])\s+/);
    let currentChunk = '';
  
    for (const sentence of sentences) {
      // Nếu thêm sentence này vượt quá chunkSize
      if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        
        // Overlap: lấy phần cuối của chunk trước
        const words = currentChunk.split(/\s+/);
        const overlapText = words.slice(-Math.floor(overlap / 10)).join(' ');
        currentChunk = overlapText + ' ' + sentence;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      }
    }
  
    // Thêm chunk cuối cùng
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
  
    // Nếu không có câu, chia đơn giản theo ký tự
    if (chunks.length === 0) {
      while (start < text.length) {
        const end = Math.min(start + chunkSize, text.length);
        chunks.push(text.slice(start, end).trim());
        start = end - overlap;
      }
    }
  
    return chunks.filter(chunk => chunk.length > 0);
  };
  
  /**
   * Chunk document với metadata
   * @param {object} document - { id, text, source, metadata }
   * @param {number} chunkSize 
   * @param {number} overlap 
   * @returns {Array} - [{ id, text, metadata }]
   */
  export const chunkDocument = (document, chunkSize = 500, overlap = 50) => {
    const chunks = chunkText(document.text, chunkSize, overlap);
    
    return chunks.map((chunk, index) => ({
      id: `${document.id}_chunk_${index}`,
      text: chunk,
      metadata: {
        documentId: document.id,
        source: document.source || 'unknown',
        type: document.metadata?.type || 'general',
        chunkIndex: index,
        ...document.metadata
      }
    }));
  };