import mongoose from 'mongoose';

const fileRefSchema = new mongoose.Schema(
  {
    storedName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    encrypted: { type: Boolean, default: false },
  },
  { _id: false },
);

const eventSnapshotSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'CompetitionItem', required: true },
    displayEventId: { type: String, required: true },
    name: { type: String, required: true },
    gender: String,
    ageDivision: String,
    isRelay: Boolean,
  },
  { _id: false },
);

const participantSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    contactNumber: { type: String, required: true },
    gender: { type: String, enum: ['male', 'female', 'other'], required: true },
    dateOfBirth: { type: Date, default: null },
    aadhaarLast4: { type: String, default: null },
    aadhaarHash: { type: String, default: null, select: false },
    photo: { type: fileRefSchema, required: true },
    aadhaarDocument: { type: fileRefSchema, default: null },
  },
  { _id: false },
);

const memberSchema = new mongoose.Schema(
  {
    memberNumber: { type: Number, required: true },
    fullName: { type: String, required: true, trim: true },
    gender: { type: String, enum: ['male', 'female', 'other'], required: true },
    dateOfBirth: { type: Date, default: null },
    contactNumber: { type: String, default: null },
    photo: { type: fileRefSchema, required: true },
  },
  { _id: false },
);

const teamSchema = new mongoose.Schema(
  {
    teamName: { type: String, required: true, trim: true },
    teamLeaderName: { type: String, required: true, trim: true },
    contactNumber: { type: String, required: true },
    members: { type: [memberSchema], default: [] },
  },
  { _id: false },
);

const registrationSchema = new mongoose.Schema(
  {
    registrationId: { type: String, required: true, unique: true },
    mode: { type: String, enum: ['individual', 'group'], required: true, index: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    selectedEventIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CompetitionItem', index: true }],
    events: { type: [eventSnapshotSchema], default: [] },
    participant: { type: participantSchema, default: undefined },
    team: { type: teamSchema, default: undefined },
    identityKey: { type: String, index: true, select: false },
    submissionKey: { type: String, required: true, unique: true, select: false },
    consentAcceptedAt: { type: Date, required: true },
    consentVersion: { type: String, required: true },
  },
  { timestamps: true, collection: 'registrations' },
);

registrationSchema.index({ createdAt: -1 });

registrationSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v;
    delete ret.identityKey;
    delete ret.submissionKey;
    if (ret.participant) delete ret.participant.aadhaarHash;
    return ret;
  },
});

export const Registration = mongoose.model('Registration', registrationSchema);
