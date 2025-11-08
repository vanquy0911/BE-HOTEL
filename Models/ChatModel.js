import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: false
  },
  message: {
    type: String,
    required: true
  },
  sender: {
    type: String,
    enum: ["user", "bot", "admin"],
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

const ChatSessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: false
  },
  messages: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "ChatMessage"
  }],
  context: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // Hybrid Chat fields
  chatType: {
    type: String,
    enum: ["bot", "human"],
    default: "bot"
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: false
  },
  status: {
    type: String,
    enum: ["active", "waiting", "resolved"],
    default: "active"
  },
  transferredAt: {
    type: Date,
    required: false
  }
}, {
  timestamps: true
});

// Indexes for better performance
ChatSessionSchema.index({ sessionId: 1 });
ChatSessionSchema.index({ userId: 1 });
ChatSessionSchema.index({ createdAt: -1 });
ChatSessionSchema.index({ chatType: 1, status: 1 }); // For admin queries
ChatSessionSchema.index({ assignedTo: 1 }); // For admin assignment

const ChatMessage = mongoose.model("ChatMessage", chatMessageSchema);
const ChatSession = mongoose.model("ChatSession", ChatSessionSchema);

export { ChatMessage, ChatSession };
export default ChatSession;

