const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const videoProcessor = require('./services/videoProcessor');
const claudeService = require('./services/claudeService');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure directories exist
fs.ensureDirSync(config.UPLOAD_DIR);
fs.ensureDirSync(config.PROCESSED_DIR);

// Serve static files
app.use('/processed', express.static(config.PROCESSED_DIR));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: config.MAX_FILE_SIZE
  },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = /\.(mp4|avi|mov|mkv|webm)$/i;
    const allowedMimeTypes = /^video\//;
    
    const hasValidExtension = allowedExtensions.test(file.originalname);
    const hasValidMimeType = allowedMimeTypes.test(file.mimetype);
    
    console.log(`File: ${file.originalname}, MimeType: ${file.mimetype}, Extension: ${hasValidExtension}, MimeType: ${hasValidMimeType}`);
    
    if (hasValidExtension || hasValidMimeType) {
      return cb(null, true);
    } else {
      cb(new Error('Only video files are allowed!'));
    }
  }
});

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Sport Analyzer Backend API' });
});

// Upload and process video
app.post('/api/analyze-video', upload.single('video'), async (req, res) => {
  // Set a timeout for the entire request
  const requestTimeout = setTimeout(() => {
    console.error('Request timeout - processing took too long');
    if (!res.headersSent) {
      res.status(408).json({ error: 'Request timeout - processing took too long' });
    }
  }, 300000); // 5 minute timeout

  try {
    console.log('Received upload request');
    console.log('Request body:', req.body);
    console.log('Request file:', req.file);
    
    if (!req.file) {
      clearTimeout(requestTimeout);
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const videoPath = req.file.path;
    const prompt = req.body.prompt || 'Analyze this sports video and provide feedback on performance, technique, and areas for improvement.';
    const fps = parseInt(req.body.fps) || 1;
    const testMode = req.body.testMode === 'true' || req.body.testMode === true;

    console.log(`Processing video: ${req.file.originalname}`);
    console.log(`Prompt: ${prompt}`);
    console.log(`FPS: ${fps}`);
    console.log(`Test mode: ${testMode}`);

    // Process the video and get analysis
    const result = await videoProcessor.processVideo(videoPath, prompt, fps, testMode);

    clearTimeout(requestTimeout);
    
    // Convert the file path to a URL
    const processedVideoUrl = `http://localhost:${config.PORT}/${result.processedVideoPath}`;
    
    res.json({
      success: true,
      originalVideo: req.file.originalname,
      processedVideo: processedVideoUrl,
      analysis: result.analysis,
      feedback: result.feedback
    });

  } catch (error) {
    clearTimeout(requestTimeout);
    console.error('Error processing video:', error);
    res.status(500).json({ 
      error: 'Error processing video',
      details: error.message 
    });
  }
});

// Get processing status
app.get('/api/status/:jobId', (req, res) => {
  // TODO: Implement job status tracking
  res.json({ status: 'completed' });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: error.message });
});

const PORT = config.PORT;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Upload directory: ${config.UPLOAD_DIR}`);
  console.log(`Processed directory: ${config.PROCESSED_DIR}`);
}); 