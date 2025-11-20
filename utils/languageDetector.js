// BE-HOTEL/utils/languageDetector.js

/**
 * Detect language từ user message
 * @param {string} text - User message
 * @returns {'vi' | 'en'} - Detected language
 */
export const detectLanguage = (text) => {
  if (!text || text.trim().length === 0) {
    return 'vi'; // Default to Vietnamese
  }

  const lowerText = text.toLowerCase();
  
  // Common English words/phrases (ưu tiên các từ phổ biến)
  const englishIndicators = [
    'hello', 'hi', 'hey', 'thanks', 'thank you', 'please', 'yes', 'no',
    'what', 'where', 'when', 'who', 'why', 'how',
    'can', 'could', 'would', 'should', 'will', 'is', 'are', 'was', 'were',
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'room', 'hotel', 'booking', 'reservation', 'check', 'price', 'cost',
    'service', 'spa', 'breakfast', 'wifi', 'pool', 'gym', 'swimming',
    'available', 'availability', 'cancel', 'cancellation', 'policy',
    'do', 'does', 'did', 'have', 'has', 'had'
  ];

  // Common Vietnamese words/phrases
  const vietnameseIndicators = [
    'phòng', 'khách sạn', 'đặt phòng', 'giá', 'giá phòng',
    'dịch vụ', 'spa', 'bữa sáng', 'wifi', 'bể bơi', 'phòng gym',
    'chào', 'xin chào', 'cảm ơn', 'vui lòng', 'có', 'không',
    'bao nhiêu', 'như thế nào', 'ở đâu', 'khi nào', 'tại sao',
    'có thể', 'được không', 'làm sao', 'thế nào', 'trẻ em',
    'check-in', 'check-out', 'hủy phòng', 'chính sách'
  ];

  // Count English indicators
  let englishCount = 0;
  englishIndicators.forEach(word => {
    if (lowerText.includes(word)) {
      englishCount++;
    }
  });

  // Count Vietnamese indicators
  let vietnameseCount = 0;
  vietnameseIndicators.forEach(word => {
    if (lowerText.includes(word)) {
      vietnameseCount++;
    }
  });

  // Check for English patterns (common English sentence structure)
  const englishPatterns = [
    /\b(what|where|when|who|why|how)\b/i,
    /\b(can|could|would|should|will)\s+(you|i|we|they)\b/i,
    /\b(is|are|was|were)\s+(there|this|that)\b/i,
    /\b(do|does|did)\s+(you|i|we|they)\b/i,
    /\b(hello|hi|thanks|thank you|please)\b/i,
    /\b(what is|what are|how much|how many)\b/i
  ];

  let englishPatternMatches = 0;
  englishPatterns.forEach(pattern => {
    if (pattern.test(text)) {
      englishPatternMatches++;
    }
  });

  // Check for Vietnamese patterns
  const vietnamesePatterns = [
    /\b(phòng|khách sạn|đặt phòng|giá)\b/i,
    /\b(có thể|được không|như thế nào|bao nhiêu)\b/i,
    /\b(chào|xin chào|cảm ơn|vui lòng)\b/i,
    /\b(dịch vụ|spa|bữa sáng|wifi)\b/i,
    /\b(trẻ em|check-in|check-out|hủy phòng)\b/i
  ];

  let vietnamesePatternMatches = 0;
  vietnamesePatterns.forEach(pattern => {
    if (pattern.test(text)) {
      vietnamesePatternMatches++;
    }
  });

  // Decision logic
  // Priority: Check for common English greetings first (single words)
  if (lowerText === 'hello' || lowerText === 'hi' || lowerText === 'hey') {
    return 'en';
  }
  
  // If strong English indicators, return 'en'
  if (englishPatternMatches >= 2 || (englishCount >= 2 && englishCount > vietnameseCount)) {
    return 'en';
  }

  // If strong Vietnamese indicators, return 'vi'
  if (vietnamesePatternMatches >= 2 || (vietnameseCount >= 2 && vietnameseCount > englishCount)) {
    return 'vi';
  }
  
  // If English count > 0 and no Vietnamese, likely English
  if (englishCount > 0 && vietnameseCount === 0) {
    return 'en';
  }

  // Default: check character set (Vietnamese has special characters)
  const vietnameseChars = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
  if (vietnameseChars.test(text)) {
    return 'vi';
  }

  // Default to Vietnamese if unclear
  return 'vi';
};

/**
 * Get language từ context hoặc detect từ message
 * @param {object} context - Session context
 * @param {string} userMessage - User message
 * @returns {'vi' | 'en'} - Language to use
 */
export const getLanguage = (context = {}, userMessage = '') => {
  // Priority 1: Language từ context (user đã chọn)
  if (context.language && (context.language === 'vi' || context.language === 'en')) {
    return context.language;
  }

  // Priority 2: Auto-detect từ user message
  if (userMessage && userMessage.trim().length > 0) {
    return detectLanguage(userMessage);
  }

  // Default: Vietnamese
  return 'vi';
};

