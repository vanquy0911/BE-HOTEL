// BE-HOTEL/scripts/ingestKnowledgeBase.js
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import connectDB from '../config/configdb.js';
import { loadDocumentsFromFolder, ingestDocuments } from '../utils/documentProcessor.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  try {
    console.log('🚀 Starting Knowledge Base Ingestion Pipeline...\n');

    // Step 1: Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ MongoDB connected\n');

    // Step 2: Load documents
    const docsPath = path.join(__dirname, '../data/knowledge-base');
    console.log(`📚 Loading documents from: ${docsPath}`);
    const documents = loadDocumentsFromFolder(docsPath);

    if (documents.length === 0) {
      console.log('⚠️  No documents found!');
      console.log('💡 Please create documents in: data/knowledge-base/');
      console.log('   Example files: faq.md, policies.md, services.md');
      process.exit(0);
    }

    console.log(`✅ Found ${documents.length} documents:`);
    documents.forEach(doc => {
      console.log(`   - ${doc.source} (${doc.text.length} characters)`);
    });
    console.log('');

    // Step 3: Ingest documents
    await ingestDocuments(documents);

    console.log('\n✅ Ingestion Pipeline completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Ingestion Pipeline failed:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  }
}

main();