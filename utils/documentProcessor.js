// BE-HOTEL/utils/documentProcessor.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chunkDocument } from './chunking.js';
import embeddingService from '../services/embeddingService.js';
import vectorStore from '../services/vectorStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load documents từ folder
 * @param {string} folderPath - Path to documents folder
 * @returns {Array} - [{ id, text, source, metadata }]
 */
export const loadDocumentsFromFolder = (folderPath) => {
  const documents = [];

  if (!fs.existsSync(folderPath)) {
    console.warn(`⚠️  Folder not found: ${folderPath}`);
    return documents;
  }

  const files = fs.readdirSync(folderPath);

  for (const file of files) {
    if (file.endsWith('.md') || file.endsWith('.txt')) {
      const filePath = path.join(folderPath, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      
      // Detect document type từ filename
      let docType = 'general';
      if (file.toLowerCase().includes('faq')) docType = 'faq';
      else if (file.toLowerCase().includes('policy')) docType = 'policy';
      else if (file.toLowerCase().includes('service')) docType = 'service';
      else if (file.toLowerCase().includes('room')) docType = 'room';

      documents.push({
        id: file.replace(/\.(md|txt)$/, ''),
        text: content,
        source: file,
        metadata: {
          type: docType
        }
      });
    }
  }

  return documents;
};

/**
 * Process và ingest documents vào vector store
 * @param {Array} documents - [{ id, text, source, metadata }]
 */
export const ingestDocuments = async (documents) => {
  await vectorStore.initialize();

  const allChunks = [];

  console.log(`📚 Processing ${documents.length} documents...`);

  // Step 1: Chunking
  for (const doc of documents) {
    console.log(`   → Chunking: ${doc.source}`);
    const chunks = chunkDocument(doc);
    allChunks.push(...chunks);
  }

  console.log(`✅ Created ${allChunks.length} chunks`);

  // Step 2: Generate embeddings
  console.log(`📊 Generating embeddings...`);
  const texts = allChunks.map(chunk => chunk.text);
  
  // Generate embeddings in batches (Gemini có thể handle batch)
  const batchSize = 10; // Process 10 chunks at a time
  const embeddings = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(texts.length / batchSize);

    console.log(`   → Processing batch ${batchNumber}/${totalBatches}`);
    try {
      const batchEmbeddings = await embeddingService.generateBatchEmbeddings(
        batch,
        'RETRIEVAL_DOCUMENT'
      );
      embeddings.push(...batchEmbeddings);
    } catch (error) {
      console.error(`   ❌ Error in batch ${i / batchSize + 1}:`, error.message);
      // Thêm empty embeddings cho batch này để giữ index đúng
      for (let j = 0; j < batch.length; j++) {
        embeddings.push(null); // Mark as failed
      }
    }
  }

  // Step 3: Add embeddings vào chunks
  const documentsWithEmbeddings = allChunks
  .map((chunk, index) => ({
    ...chunk,
    embedding: embeddings[index]
  }))
  .filter(doc => doc.embedding && Array.isArray(doc.embedding) && doc.embedding.length > 0);

  if (documentsWithEmbeddings.length === 0) {
    console.error('❌ No documents with valid embeddings to save!');
    console.error('💡 Please check your GEMINI_API_KEY in .env file');
    throw new Error('No valid embeddings generated. Check API key.');
  }

  console.log(`   ✅ Generated ${documentsWithEmbeddings.length} valid embeddings (${allChunks.length - documentsWithEmbeddings.length} failed)`);

  // Step 4: Save to vector store
  console.log(`💾 Saving to vector store...`);
  await vectorStore.addDocuments(documentsWithEmbeddings);

  console.log(`✅ Ingested ${documentsWithEmbeddings.length} chunks successfully!`);
};