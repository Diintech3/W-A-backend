const PhotoshareFolder = require('../models/PhotoshareFolder');
const PhotosharePhoto = require('../models/PhotosharePhoto');
const { success, fail } = require('../utils/apiResponse');
const geminiService = require('../services/gemini.service');
const crypto = require('crypto');

// Helpers to format YYYY-MM-DD
function getTodayString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Client: Create a photoshare folder
 */
exports.createFolder = async (req, res) => {
  try {
    const { name, startTime, endTime, isActive } = req.body;
    
    // Generate fallback name if missing
    const folderName = (name || '').trim() || getTodayString();
    
    // Generate unique link slug
    const rand = crypto.randomBytes(4).toString('hex'); // 8 char random hex
    const linkCode = `event_${rand}`;

    const folder = await PhotoshareFolder.create({
      userId: req.user._id,
      name: folderName,
      startTime: startTime ? new Date(startTime) : null,
      endTime: endTime ? new Date(endTime) : null,
      isActive: isActive !== false,
      linkCode,
    });

    return success(res, { folder }, 'Photoshare folder created successfully');
  } catch (err) {
    return fail(res, err.message || 'Failed to create photoshare folder', 500);
  }
};

/**
 * Client: List all folders owned by the client
 */
exports.listFolders = async (req, res) => {
  try {
    const folders = await PhotoshareFolder.find({ userId: req.user._id }).sort({ createdAt: -1 });
    return success(res, { folders }, 'Photoshare folders fetched');
  } catch (err) {
    return fail(res, err.message || 'Failed to fetch folders', 500);
  }
};

/**
 * Client: Get details of a single folder including analytics
 */
exports.getFolderDetails = async (req, res) => {
  try {
    const folder = await PhotoshareFolder.findOne({ _id: req.params.id, userId: req.user._id });
    if (!folder) {
      return fail(res, 'Folder not found', 404);
    }

    // Analytics: total uploads, approved count, flagged count
    const totalCount = await PhotosharePhoto.countDocuments({ folderId: folder._id });
    const approvedCount = await PhotosharePhoto.countDocuments({ folderId: folder._id, isValid: true });
    const flaggedCount = totalCount - approvedCount;

    // Top Contributors
    const contributors = await PhotosharePhoto.aggregate([
      { $match: { folderId: folder._id } },
      {
        $group: {
          _id: '$senderPhone',
          name: { $first: '$senderName' },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    return success(
      res,
      {
        folder,
        analytics: {
          totalCount,
          approvedCount,
          flaggedCount,
          contributors,
        },
      },
      'Folder details and analytics fetched'
    );
  } catch (err) {
    return fail(res, err.message || 'Failed to fetch folder details', 500);
  }
};

/**
 * Client: Get all photos inside a folder (includes invalid/flagged ones for moderation)
 */
exports.getFolderPhotos = async (req, res) => {
  try {
    const folder = await PhotoshareFolder.findOne({ _id: req.params.id, userId: req.user._id });
    if (!folder) {
      return fail(res, 'Folder not found or unauthorized', 404);
    }

    const photos = await PhotosharePhoto.find({ folderId: folder._id }).sort({ createdAt: -1 });
    return success(res, { photos }, 'Photos fetched for client review');
  } catch (err) {
    return fail(res, err.message || 'Failed to fetch photos', 500);
  }
};

/**
 * Client: Update folder configurations (Active/Inactive, name, time window)
 */
exports.updateFolder = async (req, res) => {
  try {
    const { name, startTime, endTime, isActive } = req.body;
    
    const folder = await PhotoshareFolder.findOne({ _id: req.params.id, userId: req.user._id });
    if (!folder) {
      return fail(res, 'Folder not found', 404);
    }

    if (name !== undefined) folder.name = name.trim() || getTodayString();
    if (startTime !== undefined) folder.startTime = startTime ? new Date(startTime) : null;
    if (endTime !== undefined) folder.endTime = endTime ? new Date(endTime) : null;
    if (isActive !== undefined) folder.isActive = Boolean(isActive);

    await folder.save();
    return success(res, { folder }, 'Folder updated successfully');
  } catch (err) {
    return fail(res, err.message || 'Failed to update folder', 500);
  }
};

/**
 * Client: Delete a folder and its photo entries
 */
exports.deleteFolder = async (req, res) => {
  try {
    const folder = await PhotoshareFolder.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!folder) {
      return fail(res, 'Folder not found', 404);
    }

    // Delete associated photos from DB
    await PhotosharePhoto.deleteMany({ folderId: folder._id });

    return success(res, null, 'Folder and its photos deleted successfully');
  } catch (err) {
    return fail(res, err.message || 'Failed to delete folder', 500);
  }
};

// ==========================================
// PUBLIC ENDPOINTS (GUESTS/CONSTITUENTS)
// ==========================================

/**
 * Public: Get folder details using linkCode
 */
exports.getPublicFolderDetails = async (req, res) => {
  try {
    const folder = await PhotoshareFolder.findOne({ linkCode: req.params.linkCode });
    if (!folder) {
      return fail(res, 'Invalid link code. Event not found.', 404);
    }
    return success(res, { folder }, 'Public folder details fetched');
  } catch (err) {
    return fail(res, err.message || 'Failed to fetch public folder details', 500);
  }
};

/**
 * Public: Get only approved photos for public viewing
 */
exports.getPublicFolderPhotos = async (req, res) => {
  try {
    const folder = await PhotoshareFolder.findOne({ linkCode: req.params.linkCode });
    if (!folder) {
      return fail(res, 'Event not found', 404);
    }

    // Only return approved/valid photos to public
    const photos = await PhotosharePhoto.find({ folderId: folder._id, isValid: true }).sort({ createdAt: -1 });
    return success(res, { photos }, 'Public photos fetched');
  } catch (err) {
    return fail(res, err.message || 'Failed to fetch public photos', 500);
  }
};

/**
 * Public: Search photos in the folder using a guest's selfie
 * Returns array of photos where the guest's face matches
 */
exports.searchPhotosBySelfie = async (req, res) => {
  try {
    const { linkCode } = req.params;
    if (!req.file || !req.file.buffer) {
      return fail(res, 'Selfie image file is required');
    }

    const folder = await PhotoshareFolder.findOne({ linkCode });
    if (!folder) {
      return fail(res, 'Event not found', 404);
    }

    // Fetch all approved photos in the event
    const photos = await PhotosharePhoto.find({ folderId: folder._id, isValid: true });
    if (!photos.length) {
      return success(res, { matches: [] }, 'No photos found in this event to match');
    }

    const selfieBuffer = req.file.buffer;
    const selfieMime = req.file.mimetype;

    console.log(`[Selfie Search] Matching selfie against ${photos.length} photos in folder: ${folder.name}`);

    // Call Gemini Face Matcher concurrently for photos
    // To handle rate limits or performance, we do a Promise.all
    const matchPromises = photos.map(async (photo) => {
      try {
        const result = await geminiService.matchFaces(selfieBuffer, selfieMime, photo.photoUrl);
        return {
          photo,
          match: result.match,
          confidence: result.confidence
        };
      } catch (e) {
        console.error(`[Selfie Search] Failed matching photo ${photo._id}:`, e.message);
        return { photo, match: false, confidence: 0 };
      }
    });

    const results = await Promise.all(matchPromises);
    
    // Filter photos where match is true
    const matchingPhotos = results
      .filter((r) => r.match)
      .map((r) => r.photo);

    return success(res, { matches: matchingPhotos }, `Face matching completed. Found ${matchingPhotos.length} matches.`);
  } catch (err) {
    console.error('[Selfie Search] Error:', err);
    return fail(res, err.message || 'Failed during selfie face matching search', 500);
  }
};
