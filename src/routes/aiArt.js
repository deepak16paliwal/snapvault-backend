const express = require('express');
const router = express.Router();
const axios = require('axios');
const { authenticate } = require('../middleware/authMiddleware');
const AiArtJob = require('../models/AiArtJob');
const { getUploadUrl, getDownloadUrl, uploadBuffer, deleteFile } = require('../services/s3Service');

const COMFYUI_URL = process.env.COMFYUI_URL || 'http://localhost:8188';

// ── Model configs ─────────────────────────────────────────────────────────────
const MODEL_CONFIGS = {
  JuggernautXL_v9: {
    file: 'JuggernautXL_v9.safetensors',
    is_sdxl: true,
    default_width: 832, default_height: 1216,
    steps: 25, cfg: 7.0,
    sampler: 'euler', scheduler: 'normal',
    quality_prefix: 'masterpiece, best quality, ultra-detailed, photorealistic, 8k, ',
    default_neg: 'worst quality, low quality, normal quality, jpeg artifacts, blurry, watermark, deformed, ugly, bad anatomy, bad hands, extra limbs, missing limbs',
    ipadapter_file: 'ip-adapter-faceid-plusv2_sdxl.bin',
    ipadapter_lora: 'ip-adapter-faceid-plusv2_sdxl_lora.safetensors',
  },
  RealisticVisionV60: {
    file: 'RealisticVisionV60.safetensors',
    is_sdxl: false,
    default_width: 512, default_height: 768,
    steps: 20, cfg: 7.0,
    sampler: 'euler_ancestral', scheduler: 'normal',
    quality_prefix: 'RAW photo, best quality, ultra-detailed, photorealistic, sharp focus, ',
    default_neg: '(worst quality:2), (low quality:2), (normal quality:2), blurry, lowres, bad anatomy, bad hands, watermark, signature, text, deformed, extra limbs',
    ipadapter_file: 'ip-adapter-faceid-plusv2_sd15.bin',
    ipadapter_lora: 'ip-adapter-faceid-plusv2_sd15_lora.safetensors',
  },
  DreamshaperXL_Turbo: {
    file: 'DreamshaperXL_Turbo.safetensors',
    is_sdxl: true,
    default_width: 1024, default_height: 1024,
    steps: 6, cfg: 2.0,
    sampler: 'dpmpp_sde', scheduler: 'karras',
    quality_prefix: 'masterpiece, best quality, highly detailed, ',
    default_neg: 'worst quality, low quality, blurry, watermark, deformed',
    ipadapter_file: 'ip-adapter-faceid-plusv2_sdxl.bin',
    ipadapter_lora: 'ip-adapter-faceid-plusv2_sdxl_lora.safetensors',
  },
  // Flux1_Schnell disabled — fp8 dtype not supported on Apple MPS (M-series chips)
};

// ── ComfyUI workflow builders ─────────────────────────────────────────────────
function buildT2IWorkflow({ modelFile, prompt, negPrompt, width, height, steps, cfg, sampler, scheduler, seed, denoise = 1.0 }) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: modelFile } },
    "2": { class_type: "CLIPTextEncode",  inputs: { text: prompt,    clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode",  inputs: { text: negPrompt, clip: ["1", 1] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "5": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], positive: ["2", 0], negative: ["3", 0],
        latent_image: ["4", 0],
        seed, steps, cfg, sampler_name: sampler, scheduler, denoise,
      },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "aiart" } },
  };
}

function buildI2IWorkflow({ modelFile, prompt, negPrompt, width, height, steps, cfg, sampler, scheduler, seed, uploadedFilename, denoise = 0.5 }) {
  return {
    "1":  { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: modelFile } },
    "2":  { class_type: "CLIPTextEncode",  inputs: { text: prompt,    clip: ["1", 1] } },
    "3":  { class_type: "CLIPTextEncode",  inputs: { text: negPrompt, clip: ["1", 1] } },
    "8":  { class_type: "LoadImage", inputs: { image: uploadedFilename } },
    "9":  { class_type: "ImageScale", inputs: { image: ["8", 0], width, height, upscale_method: "bicubic", crop: "disabled" } },
    "10": { class_type: "VAEEncode",  inputs: { pixels: ["9", 0], vae: ["1", 2] } },
    "5": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], positive: ["2", 0], negative: ["3", 0],
        latent_image: ["10", 0],
        seed, steps, cfg, sampler_name: sampler, scheduler, denoise,
      },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "aiart" } },
  };
}

// IP-Adapter FaceID workflow — preserves face identity from reference image
// Requires CLIP Vision + InsightFace (buffalo_l auto-downloads on first run)
function buildIPAdapterWorkflow({ modelFile, ipadapterFile, ipadapterLora,
  prompt, negPrompt, width, height, steps, cfg, sampler, scheduler, seed,
  uploadedFilename, faceStrength = 0.85 }) {
  return {
    "1":  { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: modelFile } },
    "2":  { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 1] } },
    "3":  { class_type: "CLIPTextEncode", inputs: { text: negPrompt, clip: ["1", 1] } },
    "4":  { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "8":  { class_type: "LoadImage", inputs: { image: uploadedFilename } },
    // CLIP Vision encoder
    "9":  { class_type: "CLIPVisionLoader", inputs: { clip_name: "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors" } },
    // InsightFace for face identity extraction
    "10": { class_type: "IPAdapterInsightFaceLoader", inputs: { provider: "CPU", model_name: "buffalo_l" } },
    "11": { class_type: "IPAdapterModelLoader", inputs: { ipadapter_file: ipadapterFile } },
    // LoRA MUST be applied BEFORE IPAdapter so it modifies the correct UNet layers
    "13": {
      class_type: "LoraLoader",
      inputs: {
        model: ["1", 0], clip: ["1", 1],
        lora_name: ipadapterLora,
        strength_model: 0.6, strength_clip: 0.6,
      },
    },
    "12": {
      class_type: "IPAdapterFaceID",
      inputs: {
        model: ["13", 0], ipadapter: ["11", 0],
        image: ["8", 0], clip_vision: ["9", 0], insightface: ["10", 0],
        weight: faceStrength, weight_faceidv2: 1.0,
        weight_type: "linear",
        combine_embeds: "concat", start_at: 0.0, end_at: 1.0,
        embeds_scaling: "V only",
      },
    },
    "5": {
      class_type: "KSampler",
      inputs: {
        model: ["12", 0], positive: ["2", 0], negative: ["3", 0],
        latent_image: ["4", 0],
        seed, steps, cfg, sampler_name: sampler, scheduler, denoise: 1.0,
      },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "aiart_faceid" } },
  };
}


async function uploadImageToComfyUI(imageBuffer) {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('image', imageBuffer, { filename: `input_${Date.now()}.jpg`, contentType: 'image/jpeg' });
  const res = await axios.post(`${COMFYUI_URL}/upload/image`, form, {
    headers: form.getHeaders(),
    timeout: 30000,
  });
  return res.data.name; // ComfyUI returns the stored filename
}

async function submitToComfyUI(workflow) {
  const seed = Math.floor(Math.random() * 2 ** 32);
  // KSampler (standard workflows) uses node "5"
  if (workflow["5"]?.class_type === 'KSampler') workflow["5"].inputs.seed = seed;
  // Flux uses RandomNoise node "6"
  if (workflow["6"]?.class_type === 'RandomNoise') workflow["6"].inputs.noise_seed = seed;
  const res = await axios.post(`${COMFYUI_URL}/prompt`, { prompt: workflow }, { timeout: 15000 });
  return res.data.prompt_id;
}

async function pollComfyUI(promptId) {
  const res = await axios.get(`${COMFYUI_URL}/history/${promptId}`, { timeout: 10000 });
  const entry = res.data[promptId];
  if (!entry) return { status: 'queued' };
  if (entry.status?.completed) {
    // Find the SaveImage output
    const outputs = entry.outputs;
    const saveNode = Object.values(outputs).find(o => o.images?.length > 0);
    const img = saveNode?.images?.[0];
    return { status: 'done', filename: img?.filename, subfolder: img?.subfolder || '', type: img?.type || 'output' };
  }
  if (entry.status?.status_str === 'error') {
    return { status: 'failed', error: 'ComfyUI generation error' };
  }
  return { status: 'processing' };
}

async function downloadFromComfyUI(filename, subfolder, type) {
  const res = await axios.get(`${COMFYUI_URL}/view`, {
    params: { filename, subfolder, type },
    responseType: 'arraybuffer',
    timeout: 30000,
  });
  return Buffer.from(res.data);
}

// ── SVD Image-to-Video workflow ───────────────────────────────────────────────
function buildSVDWorkflow({ uploadedFilename, motionBucketId = 127, fps = 7, frames = 25, seed }) {
  return {
    "1":  { class_type: "LoadImage", inputs: { image: uploadedFilename } },
    "2":  { class_type: "ImageScale", inputs: { image: ["1", 0], width: 1024, height: 576, upscale_method: "bicubic", crop: "disabled" } },
    "3":  { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "svd_xt.safetensors" } },
    "4":  { class_type: "SVD_img2vid_Conditioning", inputs: { clip_vision: ["3", 1], init_image: ["2", 0], vae: ["3", 2], width: 1024, height: 576, video_frames: frames, motion_bucket_id: motionBucketId, fps: fps, augmentation_level: 0 } },
    "5":  { class_type: "KSampler", inputs: { model: ["3", 0], positive: ["4", 0], negative: ["4", 1], latent_image: ["4", 2], seed: seed || Math.floor(Math.random() * 2 ** 32), steps: 20, cfg: 2.5, sampler_name: "euler", scheduler: "karras", denoise: 1.0 } },
    "6":  { class_type: "VAEDecodeTiled", inputs: { samples: ["5", 0], vae: ["3", 2], tile_size: 512 } },
    "7":  { class_type: "VHS_VideoCombine", inputs: { images: ["6", 0], frame_rate: fps, loop_count: 0, filename_prefix: "aiart_video", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /ai-art/models — list available models
router.get('/models', authenticate, (req, res) => {
  res.json({
    models: Object.entries(MODEL_CONFIGS).map(([key, cfg]) => ({
      key,
      label: key.replace(/([A-Z])/g, ' $1').trim(),
      is_sdxl: cfg.is_sdxl,
      default_width: cfg.default_width,
      default_height: cfg.default_height,
    })),
  });
});

// POST /ai-art/input-url — presigned URL to upload a reference image (img2img)
router.post('/input-url', authenticate, async (req, res) => {
  try {
    const key = `ai-art/inputs/${req.user.id}/${Date.now()}.jpg`;
    const upload_url = await getUploadUrl(key, 'image/jpeg');
    res.json({ upload_url, storage_key: key });
  } catch (err) {
    console.error('[ai-art/input-url]', err.message);
    res.status(500).json({ error: 'Failed to get upload URL' });
  }
});

// Helper: build the right workflow for a single model+params combination
async function buildWorkflow({ cfg, modelName, finalPrompt, finalNeg, w, h, finalSteps, finalCfg, finalDenoise, uploadedFilename, faceMode, faceStrength }) {
  if (cfg.is_flux) {
    // Flux: T2I only, ignores reference image
    return buildFluxWorkflow({ prompt: finalPrompt, width: w, height: h, steps: finalSteps, seed: 0 });
  }
  if (faceMode && uploadedFilename && cfg.ipadapter_file) {
    return buildIPAdapterWorkflow({
      modelFile: cfg.file,
      ipadapterFile: cfg.ipadapter_file,
      ipadapterLora: cfg.ipadapter_lora,
      prompt: finalPrompt, negPrompt: finalNeg,
      width: w, height: h, steps: finalSteps, cfg: finalCfg,
      sampler: cfg.sampler, scheduler: cfg.scheduler,
      seed: 0, uploadedFilename, faceStrength,
    });
  }
  if (uploadedFilename) {
    return buildI2IWorkflow({
      modelFile: cfg.file, prompt: finalPrompt, negPrompt: finalNeg,
      width: w, height: h, steps: finalSteps, cfg: finalCfg,
      sampler: cfg.sampler, scheduler: cfg.scheduler,
      seed: 0, uploadedFilename, denoise: finalDenoise,
    });
  }
  return buildT2IWorkflow({
    modelFile: cfg.file, prompt: finalPrompt, negPrompt: finalNeg,
    width: w, height: h, steps: finalSteps, cfg: finalCfg,
    sampler: cfg.sampler, scheduler: cfg.scheduler, seed: 0, denoise: finalDenoise,
  });
}

// POST /ai-art/generate
router.post('/generate', authenticate, async (req, res) => {
  const {
    prompt,
    negative_prompt,
    model_name = 'JuggernautXL_v9',
    width,
    height,
    input_storage_key,
    denoise,
    steps: stepsOverride,
    cfg_scale: cfgOverride,
    face_mode = false,
    face_strength = 0.85,
  } = req.body;

  if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' });

  const cfg = MODEL_CONFIGS[model_name];
  if (!cfg) return res.status(400).json({ error: 'Unknown model' });

  const finalPrompt = (cfg.prompt_prefix || cfg.quality_prefix || '') + prompt;
  const userNeg = negative_prompt ?? '';
  const baseNeg = cfg.default_neg || '';
  const finalNeg = (cfg.neg_prefix || '') + (userNeg ? `${userNeg}, ${baseNeg}` : baseNeg);
  const w = width  || cfg.default_width;
  const h = height || cfg.default_height;
  const finalSteps = stepsOverride || cfg.steps;
  const finalCfg   = cfgOverride   || cfg.cfg;
  const finalDenoise = denoise != null ? denoise : (input_storage_key ? 0.5 : 1.0);

  const job = await AiArtJob.create({
    user_id: req.user.id,
    prompt, negative_prompt: userNeg, model_name,
    width: w, height: h, steps: finalSteps, cfg: finalCfg,
    input_storage_key: input_storage_key || null,
    status: 'pending',
  });

  try {
    let uploadedFilename = null;
    if (input_storage_key) {
      const downloadUrl = await getDownloadUrl(input_storage_key, 300);
      const imgRes = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
      uploadedFilename = await uploadImageToComfyUI(Buffer.from(imgRes.data));
    }

    const workflow = await buildWorkflow({ cfg, modelName: model_name, finalPrompt, finalNeg, w, h, finalSteps, finalCfg, finalDenoise, uploadedFilename, faceMode: face_mode, faceStrength: face_strength });
    const promptId = await submitToComfyUI(workflow);
    await job.update({ comfyui_prompt_id: promptId, status: 'processing' });

    res.json({ job_id: job.id });
  } catch (err) {
    console.error('[ai-art/generate] error:', err.message);
    await job.update({ status: 'failed', error_message: err.message });
    res.status(500).json({ error: 'Failed to start generation. Is ComfyUI running?' });
  }
});

// POST /ai-art/generate-multi — run same prompt on multiple models in parallel
router.post('/generate-multi', authenticate, async (req, res) => {
  const {
    prompt, negative_prompt, model_names = [], width, height, input_storage_key,
    denoise, steps: stepsOverride, cfg_scale: cfgOverride,
    face_mode = false, face_strength = 0.85,
  } = req.body;

  if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' });
  if (!Array.isArray(model_names) || model_names.length === 0) return res.status(400).json({ error: 'model_names array is required' });

  const validModels = model_names.filter(n => MODEL_CONFIGS[n]);
  if (validModels.length === 0) return res.status(400).json({ error: 'No valid models specified' });

  const userNeg = negative_prompt ?? '';
  const finalDenoise = denoise != null ? denoise : (input_storage_key ? 0.5 : 1.0);

  // Download + upload input image once (shared across all models)
  let uploadedFilename = null;
  if (input_storage_key) {
    try {
      const downloadUrl = await getDownloadUrl(input_storage_key, 300);
      const imgRes = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
      uploadedFilename = await uploadImageToComfyUI(Buffer.from(imgRes.data));
    } catch (err) {
      return res.status(500).json({ error: 'Failed to download reference image' });
    }
  }

  // Submit all models to ComfyUI in parallel
  const results = await Promise.all(validModels.map(async (model_name) => {
    const cfg = MODEL_CONFIGS[model_name];
    const finalPrompt = (cfg.prompt_prefix || cfg.quality_prefix || '') + prompt;
    const baseNeg = cfg.default_neg || '';
    const finalNeg = (cfg.neg_prefix || '') + (userNeg ? `${userNeg}, ${baseNeg}` : baseNeg);
    const w = width  || cfg.default_width;
    const h = height || cfg.default_height;
    const finalSteps = stepsOverride || cfg.steps;
    const finalCfg   = cfgOverride   || cfg.cfg;

    const job = await AiArtJob.create({
      user_id: req.user.id,
      prompt, negative_prompt: userNeg, model_name,
      width: w, height: h,
      steps: finalSteps, cfg: finalCfg,
      input_storage_key: input_storage_key || null,
      status: 'pending',
    });

    try {
      const workflow = await buildWorkflow({ cfg, modelName: model_name, finalPrompt, finalNeg, w, h, finalSteps, finalCfg, finalDenoise, uploadedFilename, faceMode: face_mode, faceStrength: face_strength });
      const promptId = await submitToComfyUI(workflow);
      await job.update({ comfyui_prompt_id: promptId, status: 'processing' });
      return { job_id: job.id, model_name };
    } catch (err) {
      await job.update({ status: 'failed', error_message: err.message });
      return { job_id: job.id, model_name, error: err.message };
    }
  }));

  res.json({ jobs: results });
});

// POST /ai-art/cancel — cancel pending/processing jobs and clear ComfyUI queue
router.post('/cancel', authenticate, async (req, res) => {
  const { job_ids } = req.body; // array of DB job IDs

  if (!Array.isArray(job_ids) || job_ids.length === 0) {
    return res.status(400).json({ error: 'job_ids array required' });
  }

  // Fetch only the user's jobs that are still active
  const { Op } = require('sequelize');
  const jobs = await AiArtJob.findAll({
    where: {
      id: { [Op.in]: job_ids },
      user_id: req.user.id,
      status: { [Op.in]: ['pending', 'processing'] },
    },
  });

  const promptIds = jobs.map(j => j.comfyui_prompt_id).filter(Boolean);

  // 1. Remove queued items from ComfyUI
  if (promptIds.length > 0) {
    try {
      await axios.post(`${COMFYUI_URL}/queue`, { delete: promptIds }, { timeout: 5000 });
    } catch (err) {
      console.warn('[ai-art/cancel] queue delete failed:', err.message);
    }
  }

  // 2. Interrupt the currently running generation (if any of these jobs is running)
  try {
    await axios.post(`${COMFYUI_URL}/interrupt`, {}, { timeout: 5000 });
  } catch (err) {
    console.warn('[ai-art/cancel] interrupt failed:', err.message);
  }

  // 3. Mark all as cancelled in DB
  await AiArtJob.update(
    { status: 'failed', error_message: 'Cancelled by user' },
    { where: { id: { [Op.in]: jobs.map(j => j.id) } } }
  );

  res.json({ cancelled: jobs.length });
});

// GET /ai-art/status/:job_id — poll job status
router.get('/status/:job_id', authenticate, async (req, res) => {
  const job = await AiArtJob.findOne({ where: { id: req.params.job_id, user_id: req.user.id } });
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (job.status === 'done') {
    let url = null;
    if (job.result_storage_key) {
      try { url = await getDownloadUrl(job.result_storage_key, 3600); } catch (_) {}
    }
    return res.json({ status: 'done', result_url: url, job_id: job.id });
  }

  if (job.status === 'failed') {
    return res.json({ status: 'failed', error: job.error_message });
  }

  if (!job.comfyui_prompt_id) {
    return res.json({ status: 'processing', progress: 5 });
  }

  // Poll ComfyUI for queue status
  let result;
  try {
    console.log('[ai-art/status] polling job', job.id, 'prompt_id:', job.comfyui_prompt_id);
    result = await pollComfyUI(job.comfyui_prompt_id);
    console.log('[ai-art/status] poll result:', JSON.stringify(result));
  } catch (err) {
    console.error('[ai-art/status] ComfyUI poll error:', err.message);
    return res.json({ status: 'processing', progress: 10 });
  }

  if (result.status === 'failed') {
    await job.update({ status: 'failed', error_message: result.error });
    return res.json({ status: 'failed', error: result.error });
  }

  if (result.status !== 'done') {
    const progress = result.status === 'processing' ? 60 : 20;
    return res.json({ status: 'processing', progress });
  }

  // ComfyUI is done — download image and upload to R2
  // This is done separately so any R2/download failure marks job as failed (not stuck at "processing")
  console.log('[ai-art/status] ComfyUI done, downloading filename:', result.filename);
  try {
    const isVideo = job.model_name === 'SVD_XT';
    const ext = isVideo ? 'mp4' : 'jpg';
    const mime = isVideo ? 'video/mp4' : 'image/jpeg';
    const folder = isVideo ? 'videos' : 'results';

    const buf = await downloadFromComfyUI(result.filename, result.subfolder, result.type);
    console.log('[ai-art/status] downloaded', buf.length, 'bytes, uploading to R2...');
    const storageKey = `ai-art/${folder}/${req.user.id}/${job.id}.${ext}`;
    await uploadBuffer(storageKey, buf, mime);
    console.log('[ai-art/status] R2 upload done, key:', storageKey);
    const resultUrl = await getDownloadUrl(storageKey, 3600);
    await job.update({ status: 'done', result_storage_key: storageKey });
    return res.json({ status: 'done', result_url: resultUrl, job_id: job.id, is_video: isVideo });
  } catch (err) {
    console.error('[ai-art/status] download/upload error:', err.message, err.stack);
    await job.update({ status: 'failed', error_message: `Post-process failed: ${err.message}` });
    return res.json({ status: 'failed', error: `Failed to save result: ${err.message}` });
  }
});

// POST /ai-art/generate-video — image to video via SVD
router.post('/generate-video', authenticate, async (req, res) => {
  const { input_storage_key, motion_bucket_id = 127, fps = 7 } = req.body;
  if (!input_storage_key) return res.status(400).json({ error: 'input_storage_key is required (upload an image first)' });

  const job = await AiArtJob.create({
    user_id: req.user.id,
    prompt: `img2vid fps=${fps} motion=${motion_bucket_id}`,
    model_name: 'SVD_XT',
    width: 1024, height: 576,
    steps: 20, cfg: 2.5,
    input_storage_key,
    status: 'pending',
  });

  try {
    const downloadUrl = await getDownloadUrl(input_storage_key, 300);
    const imgRes = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
    const imgBuffer = Buffer.from(imgRes.data);
    const uploadedFilename = await uploadImageToComfyUI(imgBuffer);

    const workflow = buildSVDWorkflow({ uploadedFilename, motionBucketId: motion_bucket_id, fps, frames: 25 });
    const promptId = await submitToComfyUI(workflow);
    await job.update({ comfyui_prompt_id: promptId, status: 'processing' });

    res.json({ job_id: job.id, type: 'video' });
  } catch (err) {
    console.error('[ai-art/generate-video] error:', err.message);
    await job.update({ status: 'failed', error_message: err.message });
    res.status(500).json({ error: 'Failed to start video generation. Is ComfyUI with VideoHelperSuite running?' });
  }
});

// GET /ai-art/status/:job_id — same endpoint handles both image + video
// (video jobs poll the same way; result is an mp4 stored in ai-art/videos/)
// The download logic below detects video by model_name === 'SVD_XT'

// POST /ai-art/restore — sync all completed ComfyUI jobs to backend for logged-in user
router.post('/restore', authenticate, async (req, res) => {
  try {
    const { data } = await axios.get(`${COMFYUI_URL}/history`, { timeout: 10000 });
    const restored = [];

    for (const [pid, entry] of Object.entries(data)) {
      if (!entry.status?.completed) continue;
      const outputs = entry.outputs || {};
      const saveNode = Object.values(outputs).find(o => o.images?.length > 0);
      const img = saveNode?.images?.[0];
      if (!img) continue;

      // Skip if already saved as done
      const existing = await AiArtJob.findOne({ where: { comfyui_prompt_id: pid, user_id: req.user.id } });
      if (existing?.status === 'done') continue;

      // Download image from ComfyUI
      const imgRes = await axios.get(`${COMFYUI_URL}/view`, {
        params: { filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' },
        responseType: 'arraybuffer', timeout: 30000,
      });
      const buf = Buffer.from(imgRes.data);

      let job = existing;
      if (!job) {
        job = await AiArtJob.create({
          user_id: req.user.id, prompt: '(restored)', model_name: 'Unknown',
          width: 512, height: 512, steps: 0, cfg: 0,
          comfyui_prompt_id: pid, status: 'pending',
        });
      }
      const storageKey = `ai-art/results/${req.user.id}/${job.id}.jpg`;
      await uploadBuffer(storageKey, buf, 'image/png');
      const url = await getDownloadUrl(storageKey, 3600);
      await job.update({ status: 'done', result_storage_key: storageKey });
      restored.push({ job_id: job.id, filename: img.filename, result_url: url });
    }

    res.json({ restored: restored.length, jobs: restored });
  } catch (err) {
    res.status(500).json({ error: `Restore failed: ${err.message}` });
  }
});

// DELETE /ai-art/history/:job_id — delete a job + R2 file + ComfyUI history
router.delete('/history/:job_id', authenticate, async (req, res) => {
  const job = await AiArtJob.findOne({ where: { id: req.params.job_id, user_id: req.user.id } });
  if (!job) return res.status(404).json({ error: 'Job not found' });

  // Delete from R2
  if (job.result_storage_key) {
    try { await deleteFile(job.result_storage_key); } catch (_) {}
  }

  // Delete from ComfyUI history
  if (job.comfyui_prompt_id) {
    try {
      await axios.post(`${COMFYUI_URL}/history`, { delete: [job.comfyui_prompt_id] }, { timeout: 5000 });
    } catch (_) {}
  }

  await job.destroy();
  res.json({ success: true });
});

// GET /ai-art/history — past generations (done only)
router.get('/history', authenticate, async (req, res) => {
  const jobs = await AiArtJob.findAll({
    where: { user_id: req.user.id, status: 'done' },
    order: [['created_at', 'DESC']],
    limit: 30,
  });

  const withUrls = await Promise.all(jobs.map(async (j) => {
    let url = null;
    if (j.result_storage_key) {
      try { url = await getDownloadUrl(j.result_storage_key, 3600); } catch (_) {}
    }
    return {
      id: j.id,
      prompt: j.prompt,
      model_name: j.model_name,
      width: j.width,
      height: j.height,
      result_url: url,
      created_at: j.created_at,
    };
  }));

  res.json({ jobs: withUrls });
});

module.exports = router;
