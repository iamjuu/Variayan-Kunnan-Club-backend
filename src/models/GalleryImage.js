import mongoose from 'mongoose';

/** @type {['club', 'keralotsavam', 'arts', 'sports']} */
export const GALLERY_ALBUMS = ['club', 'keralotsavam', 'arts', 'sports'];

const galleryImageSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, maxlength: 140, default: '' },
    caption: { type: String, trim: true, maxlength: 400, default: '' },
    album: { type: String, enum: GALLERY_ALBUMS, default: 'club', index: true },
    featured: { type: Boolean, default: false, index: true },
    hero: { type: Boolean, default: false, index: true },
    isPublished: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    image: {
      storedName: { type: String, required: true },
      mimeType: { type: String, required: true },
      size: { type: Number, required: true },
    },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  },
  { timestamps: true, collection: 'galleryImages' },
);

galleryImageSchema.index({ isPublished: 1, hero: 1, featured: 1, sortOrder: 1, createdAt: -1 });

galleryImageSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v;
    delete ret.image?.storedName;
    ret.imageUrl = `/api/gallery/${ret._id}/image`;
    return ret;
  },
});

export const GalleryImage = mongoose.model('GalleryImage', galleryImageSchema);
