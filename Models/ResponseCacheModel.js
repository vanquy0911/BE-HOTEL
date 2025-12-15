import mongoose from "mongoose";

const responseCacheSchema = new mongoose.Schema({
  queryKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  queryText: {
    type: String,
    required: true
  },
  response: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  hitCount: {
    type: Number,
    default: 0
  },
  lastUsed: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index để query nhanh
responseCacheSchema.index({ lastUsed: -1 });

const ResponseCache = mongoose.model("ResponseCache", responseCacheSchema);

export default ResponseCache;


