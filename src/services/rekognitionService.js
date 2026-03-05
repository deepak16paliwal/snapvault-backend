const {
  CreateCollectionCommand,
  IndexFacesCommand,
  SearchFacesByImageCommand,
  DeleteFacesCommand,
} = require('@aws-sdk/client-rekognition');
const { rekognitionClient, COLLECTION_ID } = require('../config/rekognition');

async function ensureCollection() {
  try {
    await rekognitionClient.send(
      new CreateCollectionCommand({ CollectionId: COLLECTION_ID })
    );
    console.log(`[Rekognition] Collection '${COLLECTION_ID}' created`);
  } catch (err) {
    if (err.name === 'ResourceAlreadyExistsException') {
      console.log(`[Rekognition] Collection '${COLLECTION_ID}' already exists`);
    } else {
      console.error('[Rekognition] Failed to ensure collection:', err.message);
      throw err;
    }
  }
}

/**
 * Index faces in a photo stored in S3.
 * Returns array of { faceId, confidence } for each detected face.
 */
async function indexFaces(s3Bucket, s3Key, externalImageId) {
  const command = new IndexFacesCommand({
    CollectionId: COLLECTION_ID,
    Image: {
      S3Object: { Bucket: s3Bucket, Name: s3Key },
    },
    ExternalImageId: externalImageId,
    DetectionAttributes: [],
    QualityFilter: 'AUTO',
  });

  const response = await rekognitionClient.send(command);
  return (response.FaceRecords || []).map((r) => ({
    faceId: r.Face.FaceId,
    confidence: r.Face.Confidence,
  }));
}

/**
 * Search collection for faces matching the given image buffer.
 * Returns array of { faceId, similarity } sorted by similarity desc.
 */
async function searchFacesByImage(imageBuffer) {
  const command = new SearchFacesByImageCommand({
    CollectionId: COLLECTION_ID,
    Image: { Bytes: imageBuffer },
    FaceMatchThreshold: 80,
    MaxFaces: 100,
  });

  let response;
  try {
    response = await rekognitionClient.send(command);
  } catch (err) {
    // InvalidParameterException means no face was detected in the query image
    if (err.name === 'InvalidParameterException') {
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
 * Delete indexed faces from the collection.
 * faceIds: string[]
 */
async function deleteFaces(faceIds) {
  if (!faceIds || faceIds.length === 0) return;
  const command = new DeleteFacesCommand({
    CollectionId: COLLECTION_ID,
    FaceIds: faceIds,
  });
  await rekognitionClient.send(command);
}

module.exports = { ensureCollection, indexFaces, searchFacesByImage, deleteFaces };
