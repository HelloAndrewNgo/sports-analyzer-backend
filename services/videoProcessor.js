const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const claudeService = require('./claudeService');

// Set ffmpeg and ffprobe paths
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

class VideoProcessor {
  constructor() {
    this.tempDir = path.join(__dirname, '../temp');
    fs.ensureDirSync(this.tempDir);
  }

  async processVideo(videoPath, prompt, fps = 1) {
    try {
      console.log('Starting video processing...');
      
      // Extract video info
      const videoInfo = await this.getVideoInfo(videoPath);
      console.log('Video info:', videoInfo);

      // Calculate max frames to prevent infinite processing
      const duration = videoInfo.format.duration || 60; // Default 60 seconds
      const maxFrames = Math.min(Math.ceil(duration * fps), 30); // Max 30 frames
      console.log(`Video duration: ${duration}s, Max frames to process: ${maxFrames}`);

      // Extract frames at specified FPS
      const framesDir = path.join(this.tempDir, uuidv4());
      await fs.ensureDir(framesDir);
      
      await this.extractFrames(videoPath, framesDir, fps, maxFrames);
      console.log('Frames extracted');

      // Get frame files
      const frameFiles = await fs.readdir(framesDir);
      const sortedFrames = frameFiles
        .filter(file => file.endsWith('.jpg'))
        .sort()
        .slice(0, maxFrames); // Limit to max frames

      console.log(`Processing ${sortedFrames.length} frames (limited from ${frameFiles.length} total)`);

      // Analyze each frame with Claude (with timeout)
      const frameAnalyses = [];
      for (let i = 0; i < sortedFrames.length; i++) {
        const framePath = path.join(framesDir, sortedFrames[i]);
        const frameBase64 = await this.imageToBase64(framePath);
        
        // Skip the first frame to avoid showing feedback at 0.00s
        if (i === 0) {
          frameAnalyses.push({
            frame: sortedFrames[i],
            timestamp: (i / fps).toFixed(2),
            analysis: "" // Empty analysis for first frame
          });
          continue;
        }
        
        const framePrompt = `${prompt}\n\nAnalyze this specific frame (${i + 1}/${sortedFrames.length}) and provide feedback that can be overlaid on the video.`;
        
        try {
          console.log(`\n--- Processing Frame ${i + 1}/${sortedFrames.length} ---`);
          
          // Use development mode to save API costs and prevent hanging
          const analysis = config.DEV_MODE 
            ? await this.withTimeout(claudeService.analyzeFrameDev(frameBase64, framePrompt), 10000) // 10 second timeout
            : await this.withTimeout(claudeService.analyzeFrame(frameBase64, framePrompt), 30000); // 30 second timeout
          
          frameAnalyses.push({
            frame: sortedFrames[i],
            timestamp: (i / fps).toFixed(2),
            analysis: analysis
          });
          console.log(`✅ Frame ${i + 1}/${sortedFrames.length} processed successfully`);
        } catch (error) {
          console.error(`❌ Error analyzing frame ${i + 1}:`, error.message);
          frameAnalyses.push({
            frame: sortedFrames[i],
            timestamp: (i / fps).toFixed(2),
            analysis: "Analysis failed for this frame"
          });
        }
      }

      // Create video with text overlay using FFmpeg
      console.log('\n--- Creating Video with Overlay ---');
      const outputVideoPath = path.join(config.PROCESSED_DIR, `processed-${uuidv4()}.mp4`);
      
      // First create a clean copy of the video without any overlays
      const cleanVideoPath = path.join(config.PROCESSED_DIR, `clean-${uuidv4()}.mp4`);
      await this.createCleanVideo(videoPath, cleanVideoPath);
      
      // Then add our feedback overlays to the clean video
      await this.createVideoWithOverlay(cleanVideoPath, outputVideoPath, frameAnalyses, fps);
      console.log('✅ Final video created with overlay');
      
      // Clean up the temporary clean video
      await fs.remove(cleanVideoPath);

      // Cleanup temp files
      await fs.remove(framesDir);

      return {
        processedVideoPath: outputVideoPath,
        analysis: frameAnalyses,
        feedback: this.summarizeFeedback(frameAnalyses)
      };

    } catch (error) {
      console.error('Error in video processing:', error);
      throw error;
    }
  }

  // Helper function to add timeout to promises
  async withTimeout(promise, timeoutMs) {
    return Promise.race([
      promise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
      )
    ]);
  }

  async getVideoInfo(videoPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) reject(err);
        else resolve(metadata);
      });
    });
  }

  async extractFrames(videoPath, outputDir, fps, maxFrames) {
    return new Promise((resolve, reject) => {
      const command = ffmpeg(videoPath)
        .fps(fps)
        .on('end', resolve)
        .on('error', reject)
        .screenshots({
          count: maxFrames, // Limit the number of frames
          folder: outputDir,
          filename: 'frame-%d.jpg',
          size: '1280x720'
        })
        .outputOptions([
          '-an', // Remove audio
          '-vn', // Remove video metadata that might cause overlays
          '-map_metadata -1' // Remove all metadata
        ]);
      
      // Add timeout to prevent infinite processing
      setTimeout(() => {
        command.kill('SIGKILL');
        reject(new Error('Frame extraction timed out'));
      }, 60000); // 60 second timeout
    });
  }

  async imageToBase64(imagePath) {
    const imageBuffer = await fs.readFile(imagePath);
    return imageBuffer.toString('base64');
  }

  async createCleanVideo(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      console.log('Creating clean video copy...');
      
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-crf 23',
          '-preset fast',
          '-map_metadata -1', // Remove all metadata
          '-an', // Remove audio
          '-vf', 'metadata=mode=delete' // Remove all metadata that might cause overlays
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('Clean video creation started:', commandLine);
        })
        .on('progress', (progress) => {
          console.log(`Clean video progress: ${progress.percent}% done`);
        })
        .on('end', () => {
          console.log('Clean video created successfully');
          resolve();
        })
        .on('error', (err) => {
          console.error('Clean video error:', err);
          reject(err);
        })
        .run();
    });
  }

  async createVideoWithOverlay(inputPath, outputPath, frameAnalyses, fps) {
    return new Promise((resolve, reject) => {
      console.log(`Creating video overlay with ${frameAnalyses.length} frame analyses...`);
      
      let command = ffmpeg(inputPath);

      // Build a complex filter chain to remove any existing overlays and add only our feedback
      let filterChain = [];
      
      // Add text overlay for each frame with improved styling
      frameAnalyses.forEach((analysis, index) => {
        const timestamp = parseFloat(analysis.timestamp);
        const text = this.escapeText(analysis.analysis);
        
        console.log(`Adding overlay for frame ${index + 1} at ${timestamp}s`);
        
        // Only show feedback if there's meaningful content and not at the very beginning
        if (text && text.length > 10 && timestamp > 0.5) {
          // Filter out generic or failed analysis responses
          const meaningfulText = this.isMeaningfulFeedback(text);
          if (meaningfulText) {
            // Add drawtext filter to the chain
            filterChain.push({
              filter: 'drawtext',
              options: {
                text: meaningfulText,
                fontsize: 18,
                fontcolor: 'white',
                x: 25,
                y: 'h-th-35',
                enable: `between(t,${timestamp},${timestamp + 2})`, // Show for 2 seconds
                shadowcolor: 'black',
                shadowx: 2,
                shadowy: 2
              }
            });
          }
        }
      });

      // Apply the filter chain if we have any overlays to add
      if (filterChain.length > 0) {
        command = command.videoFilters(filterChain);
      }

      command
        .outputOptions([
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-crf 23',
          '-preset fast'
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('FFmpeg command started:', commandLine);
        })
        .on('progress', (progress) => {
          console.log(`FFmpeg progress: ${progress.percent}% done`);
        })
        .on('end', () => {
          console.log('FFmpeg processing completed successfully');
          resolve();
        })
        .on('error', (err) => {
          console.error('FFmpeg error:', err);
          reject(err);
        })
        .run();
    });
  }

  escapeText(text) {
    // Escape special characters for FFmpeg and format text for better readability
    return text
      .replace(/:/g, '\\:')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, ' ')
      .substring(0, 150) // Limit text length for better fit
      .trim();
  }

  isMeaningfulFeedback(text) {
    // Filter out generic or failed responses
    const genericPhrases = [
      'analysis failed',
      'unable to analyze',
      'no clear action',
      'frame appears static',
      'no significant movement',
      'unclear what is happening'
    ];
    
    const lowerText = text.toLowerCase();
    
    // Check if text contains generic phrases
    for (const phrase of genericPhrases) {
      if (lowerText.includes(phrase)) {
        return null;
      }
    }
    
    // Check if text is too short or too generic
    if (text.length < 20) {
      return null;
    }
    
    // Check if text contains actual feedback keywords
    const feedbackKeywords = [
      'good', 'great', 'excellent', 'improve', 'better', 'technique',
      'form', 'stance', 'movement', 'shot', 'pass', 'dribble',
      'defense', 'offense', 'position', 'balance', 'timing'
    ];
    
    const hasFeedbackKeywords = feedbackKeywords.some(keyword => 
      lowerText.includes(keyword)
    );
    
    return hasFeedbackKeywords ? text : null;
  }

  summarizeFeedback(frameAnalyses) {
    const allAnalysis = frameAnalyses.map(f => f.analysis).join(' ');
    
    // Extract key metrics
    const shotCount = (allAnalysis.match(/shot/gi) || []).length;
    const madeCount = (allAnalysis.match(/made/gi) || []).length;
    const missedCount = (allAnalysis.match(/missed/gi) || []).length;
    
    return {
      totalFrames: frameAnalyses.length,
      shotCount,
      madeCount,
      missedCount,
      accuracy: shotCount > 0 ? (madeCount / shotCount * 100).toFixed(1) + '%' : 'N/A'
    };
  }
}

module.exports = new VideoProcessor(); 