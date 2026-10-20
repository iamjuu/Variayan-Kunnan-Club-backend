import mongoose from 'mongoose';

export const PARTICIPATION_MODES = ['individual', 'group'];
export const GENDERS = ['male', 'female', 'any'];

const legacySchema = new mongoose.Schema(
  {
    source: String,
    categoryId: mongoose.Schema.Types.Mixed,
    subCategoryId: mongoose.Schema.Types.Mixed,
    subCategoryName: String,
    gender: mongoose.Schema.Types.Mixed,
    subGender: mongoose.Schema.Types.Mixed,
    isGroupEvent: mongoose.Schema.Types.Mixed,
    raw: mongoose.Schema.Types.Mixed,
  },
  { _id: false },
);

const competitionItemSchema = new mongoose.Schema(
  {
    legacyEventId: { type: mongoose.Schema.Types.Mixed },
    eventCode: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    participationMode: { type: String, enum: PARTICIPATION_MODES, required: true, index: true },
    isGroupEvent: { type: Boolean, required: true },
    description: { type: String, trim: true, default: '', maxlength: 2000 },
    gender: { type: String, enum: GENDERS, default: 'any' },
    ageDivision: { type: String, trim: true, default: '', maxlength: 100 },
    minAge: { type: Number, min: 0, max: 120, default: null },
    maxAge: { type: Number, min: 0, max: 120, default: null },
    minParticipants: { type: Number, min: 1, default: 1 },
    maxParticipants: { type: Number, min: 1, default: 1 },
    isRelay: { type: Boolean, default: false },
    rules: { type: String, trim: true, default: '', maxlength: 5000 },
    eventLevels: { type: [mongoose.Schema.Types.Mixed], default: [] },
    startsFrom: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true, index: true },
    archivedAt: { type: Date, default: null },
    legacy: { type: legacySchema, default: undefined },
  },
  { timestamps: true, collection: 'competitionItems' },
);

competitionItemSchema.index(
  { legacyEventId: 1, 'legacy.source': 1 },
  { unique: true, partialFilterExpression: { legacyEventId: { $exists: true } } },
);
competitionItemSchema.index({ categoryId: 1, participationMode: 1, isActive: 1 });

competitionItemSchema.virtual('status').get(function status() {
  if (this.archivedAt) return 'archived';
  return this.isActive ? 'active' : 'inactive';
});

competitionItemSchema.virtual('displayEventId').get(function displayEventId() {
  return this.legacyEventId !== null && this.legacyEventId !== undefined ? String(this.legacyEventId) : this.eventCode;
});

competitionItemSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    delete ret.id;
    if (ret.legacy) delete ret.legacy.raw;
    return ret;
  },
});

export const CompetitionItem = mongoose.model('CompetitionItem', competitionItemSchema);
