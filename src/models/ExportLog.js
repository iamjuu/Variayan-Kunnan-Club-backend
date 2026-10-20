import mongoose from 'mongoose';

const exportLogSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', required: true },
    adminEmail: { type: String, required: true },
    format: { type: String, enum: ['xlsx', 'pdf'], required: true },
    filters: { type: mongoose.Schema.Types.Mixed, default: {} },
    recordCount: { type: Number, required: true },
    ipAddress: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'exportAuditLogs' },
);

exportLogSchema.index({ createdAt: -1 });

export const ExportLog = mongoose.model('ExportLog', exportLogSchema);
