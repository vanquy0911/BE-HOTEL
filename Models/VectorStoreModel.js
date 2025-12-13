// BE-HOTEL/Models/VectorStoreModel.js
import mongoose from "mongoose";

const vectorStoreSchema = new mongoose.Schema({
  chunkId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  documentId: {
    type: String,
    required: true,
    index: true
  },
  text: {
    type: String,
    required: true
  },
  embedding: {
    type: [Number], // Array of numbers (vector)
    required: true
  },
  metadata: {
    source: { type: String },       // File name
    type: { type: String },         // 'faq', 'policy', 'service', etc.
    chunkIndex: { type: Number },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }
}, {
  timestamps: true
});

// Indexes
vectorStoreSchema.index({ 'metadata.type': 1 });
vectorStoreSchema.index({ createdAt: -1 });

const VectorStore = mongoose.model("VectorStore", vectorStoreSchema);

export default VectorStore;