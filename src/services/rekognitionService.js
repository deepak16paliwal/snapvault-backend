const {
  CreateCollectionCommand,
  DeleteCollectionCommand,
  IndexFacesCommand,
  SearchFacesByImageCommand,
  DeleteFacesCommand,
} = require('@aws-sdk/client-rekognition');
const { rekognitionClient } = require('../config/rekognition');

/**
 * Create a Rekognition collection for an event.
 * Called when a new event is created.
 * collection_id = event_{event_id}
 */
async function createEventCollection(eventId) {
  const collectionId = `event_${eventId}`;
  try {
    await rekognitionClient.send(
      new CreateCollectionCommand({ CollectionId: collectionId })
    );
    console.log(`[Rekognition] Collection '${collectionId}' created`);
  } catch (err) {
    if (err.name === 'ResourceAlreadyExistsException') {
      console.log(`[Rekognition] Collection '${collectionId}' already exists`);
    } else {
      console.error(`[Rekognition] Failed to create collection '${collectionId}':`, err.message);
      throw err;
    }
  }
}

/**
 * Delete a Rekognition collection for an event.
 * Called on permanent event deletion (>60 days after soft delete).
 */
async function deleteEventCollection(eventId) {
  const collectionId = `event_${eventId}`;
  try {
    await rekognitionClient.send(
      new DeleteCollectionCommand({ CollectionId: collectionId })
    );
    console.log(`[Rekognition] Collection '${collectionId}' deleted`);
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      console.log(`[Rekognition] Collection '${collectionId}' not found (already deleted)`);
    } else {
      console.error(`[Rekognition] Failed to delete collection '${collectionId}':`, err.message);
    }
  }
}

/**
 * Index faces in a photo stored in R2.
 * @param {string} collectionId - e.g. 'event_42'
 * @param {string} s3Bucket - R2 bucket name
 * @param {string} s3Key - R2 object key
 * @param {string} externalImageId - usually String(photo_id)
 * @returns {Array<{ faceId, confidence, boundingBox }>}
 */
async function indexFaces(collectionId, s3Bucket, s3Key, externalImageId) {
  const command = new IndexFacesCommand({
    CollectionId: collectionId,
    Image: {
      S3Object: { Bucket: s3Bucket, Name: s3Key },
    },
    ExternalImageId: externalImageId,
    DetectionAttributes: [],
    QualityFilter: 'NONE',
  });

  const response = await rekognitionClient.send(command);
  return (response.FaceRecords || []).map((r) => ({
    faceId: r.Face.FaceId,
    confidence: r.Face.Confidence,
    boundingBox: r.Face.BoundingBox || null,
  }));
}

/**
 * Search a per-event collection for faces matching the given image buffer.
 * @param {string} collectionId - e.g. 'event_42'
 * @param {Buffer} imageBuffer - selfie image bytes
 * @returns {Array<{ faceId, similarity }>} sorted by similarity desc
 */
async function searchFacesByImage(collectionId, imageBuffer) {
  const command = new SearchFacesByImageCommand({
    CollectionId: collectionId,
    Image: { Bytes: imageBuffer },
    FaceMatchThreshold: 50,
    MaxFaces: 100,
  });

  let response;
  try {
    response = await rekognitionClient.send(command);
  } catch (err) {
    // InvalidParameterException — no face detected in the query image
    // ResourceNotFoundException — collection doesn't exist yet (no photos indexed)
    if (err.name === 'InvalidParameterException' || err.name === 'ResourceNotFoundException') {
      return [];
    }
    throw err;
  }

  return (response.FaceMatches || []).map((m) => ({
    faceId: m.Face.FaceId,
    similarity: m.Similarity,
  }));
}

/**
 * Delete indexed faces from a per-event collection.
 * @param {string} collectionId - e.g. 'event_42'
 * @param {string[]} faceIds
 */
async function deleteFaces(collectionId, faceIds) {
  if (!faceIds || faceIds.length === 0) return;
  const command = new DeleteFacesCommand({
    CollectionId: collectionId,
    FaceIds: faceIds,
  });
  await rekognitionClient.send(command);
}

module.exports = { createEventCollection, deleteEventCollection, indexFaces, searchFacesByImage, deleteFaces };
