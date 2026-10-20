import mongoose from 'mongoose';

export const MAIN_CATEGORIES = [
  { name: 'Arts', slug: 'arts' },
  { name: 'Sports', slug: 'sports' },
];

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, enum: MAIN_CATEGORIES.map((c) => c.slug) },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'categories' },
);

export const Category = mongoose.model('Category', categorySchema);
