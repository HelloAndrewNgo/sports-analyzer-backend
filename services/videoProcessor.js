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

  async processVideo(videoPath, prompt, fps = 1, testMode = false) {
    try {
      console.log('Starting video processing...');
      console.log(`Test mode: ${testMode ? 'ON' : 'OFF'}`);
      
      if (testMode) {
        // Test mode: return the original video file without any processing
        console.log('🧪 Test mode: Returning original video file without processing');
        
        // Copy the original file to the processed directory
        const outputVideoPath = path.join(config.PROCESSED_DIR, `original-${uuidv4()}.mp4`);
        await fs.copy(videoPath, outputVideoPath);
        console.log('✅ Original video copied for test mode');
        
        return {
          processedVideoPath: outputVideoPath,
          analysis: [],
          feedback: "Test mode - original video returned without processing"
        };
      }
      
      // Check if this is a no-overlay test
      const noOverlayTest = prompt.includes('NO_OVERLAY_TEST');
      if (noOverlayTest) {
        console.log('🧪 NO OVERLAY TEST: Creating video with absolutely no overlays');
        const outputVideoPath = path.join(config.PROCESSED_DIR, `no-overlay-test-${uuidv4()}.mp4`);
        await this.createVideoWithNoOverlays(videoPath, outputVideoPath);
        
        return {
          processedVideoPath: outputVideoPath,
          analysis: [],
          feedback: "No overlay test - video created with absolutely no overlays"
        };
      }
      
      // Normal mode: proceed with frame extraction and analysis
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

      let frameAnalyses = [];
      
      // Normal mode: analyze frames
      // Analyze each frame with Claude (with timeout)
      frameAnalyses = [];
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
      
      if (testMode) {
        // Test mode: just create a clean copy without any overlays
        console.log('🧪 Test mode: Creating clean video without overlays');
        await this.createCleanVideo(videoPath, outputVideoPath);
        console.log('✅ Clean video created for test mode');
      } else {
        // Normal mode: create video with overlays
        // First create a clean copy of the video without any overlays
        const cleanVideoPath = path.join(config.PROCESSED_DIR, `clean-${uuidv4()}.mp4`);
        await this.createCleanVideo(videoPath, cleanVideoPath);
        
        // Then add our feedback overlays to the clean video
        await this.createVideoWithOverlay(cleanVideoPath, outputVideoPath, frameAnalyses, fps);
        console.log('✅ Final video created with overlay');
        
        // Clean up the temporary clean video
        await fs.remove(cleanVideoPath);
      }

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
          '-an' // Remove audio
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
      console.log('🔄 REWRITTEN: Creating video overlay with single filter approach...');
      console.log(`Input: ${inputPath}`);
      console.log(`Output: ${outputPath}`);
      console.log(`Frame analyses: ${frameAnalyses.length}`);
      
      // Start with a clean FFmpeg command
      let command = ffmpeg(inputPath);
      
      // Filter out meaningful analyses only
      const meaningfulAnalyses = frameAnalyses.filter(analysis => {
        const text = analysis.analysis || '';
        const timestamp = parseFloat(analysis.timestamp);
        
        // Only include if:
        // 1. Has meaningful text (not empty, not error messages)
        // 2. Not at the very beginning (timestamp > 0.5)
        // 3. Text is long enough to be meaningful
        const isValid = text.length > 20 && 
                       timestamp > 0.5 && 
                       !text.toLowerCase().includes('analysis failed') &&
                       !text.toLowerCase().includes('unable to analyze');
        
        if (isValid) {
          console.log(`✅ Including analysis at ${timestamp}s: "${text.substring(0, 50)}..."`);
        } else {
          console.log(`❌ Skipping analysis at ${timestamp}s: "${text.substring(0, 30)}..."`);
        }
        
        return isValid;
      });
      
      console.log(`📊 Filtered to ${meaningfulAnalyses.length} meaningful analyses out of ${frameAnalyses.length} total`);
      
      // If no meaningful analyses, just copy the video without any overlays
      if (meaningfulAnalyses.length === 0) {
        console.log('⚠️ No meaningful analyses found - creating clean video copy');
        command
          .outputOptions([
            '-c:v libx264',
            '-pix_fmt yuv420p',
            '-crf 23',
            '-preset fast'
          ])
          .output(outputPath)
          .on('start', (commandLine) => {
            console.log('🔄 Clean video command:', commandLine);
          })
          .on('end', () => {
            console.log('✅ Clean video created successfully');
            resolve();
          })
          .on('error', (err) => {
            console.error('❌ Clean video error:', err);
            reject(err);
          })
          .run();
        return;
      }
      
      // Create a single drawtext filter with dynamic text based on timestamps
      // This avoids multiple filter conflicts
      const textExpression = this.createDynamicTextExpression(meaningfulAnalyses);
      
      console.log(`🎬 Creating single drawtext filter with dynamic text`);
      console.log(`📝 Text expression length: ${textExpression.length} characters`);
      
      // Apply single filter with dynamic text
      command = command.videoFilters([{
        filter: 'drawtext',
        options: {
          text: textExpression,
          fontsize: 18,
          fontcolor: 'white',
          x: 20,
          y: 'h-th-20', // BOTTOM ONLY - NO TOP OVERLAYS
          shadowcolor: 'black',
          shadowx: 2,
          shadowy: 2,
          box: 1,
          boxcolor: 'black@0.8',
          boxborderw: 3
        }
      }]);
      
      // Set output options
      command
        .outputOptions([
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-crf 23',
          '-preset fast'
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('🔄 FFmpeg command with single overlay filter:');
          console.log(commandLine);
          
          // Verify no top overlays in command
          if (commandLine.includes('y=0') || commandLine.includes('y=10') || commandLine.includes('y=20')) {
            console.error('🚨 WARNING: Found top positioning in FFmpeg command!');
          } else {
            console.log('✅ Confirmed: No top positioning found in command');
          }
          
          // Verify single filter approach
          const drawtextCount = (commandLine.match(/drawtext/g) || []).length;
          console.log(`🔍 Drawtext filters found: ${drawtextCount} (should be 1)`);
        })
        .on('progress', (progress) => {
          console.log(`📊 Progress: ${progress.percent}% done`);
        })
        .on('end', () => {
          console.log('✅ Video with single overlay filter created successfully');
          console.log(`📁 Output file: ${outputPath}`);
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ FFmpeg error:', err);
          reject(err);
        })
        .run();
    });
  }

  // Create a dynamic text expression that changes based on timestamps
  createDynamicTextExpression(analyses) {
    if (analyses.length === 0) {
      return '';
    }
    
    // Sort analyses by timestamp
    const sortedAnalyses = analyses.sort((a, b) => parseFloat(a.timestamp) - parseFloat(b.timestamp));
    
    console.log(`📝 Creating dynamic text for ${sortedAnalyses.length} analyses:`);
    sortedAnalyses.forEach((analysis, index) => {
      const timestamp = parseFloat(analysis.timestamp);
      const text = this.escapeText(analysis.analysis);
      console.log(`   ${index + 1}. ${timestamp}s: "${text.substring(0, 50)}..."`);
    });
    
    // Build a simpler conditional expression
    let expression = '';
    
    // Start with empty text
    expression = `''`;
    
    // Add each analysis as a conditional
    sortedAnalyses.forEach((analysis, index) => {
      const timestamp = parseFloat(analysis.timestamp);
      const endTime = timestamp + 2; // Show for 2 seconds
      const text = this.escapeText(analysis.analysis);
      
      // Replace the current expression with a new conditional
      expression = `if(between(t,${timestamp},${endTime}),'${text}',${expression})`;
    });
    
    console.log(`📝 Final expression preview: ${expression.substring(0, 100)}...`);
    
    return expression;
  }

  // Test method: Create video with NO overlays at all
  async createVideoWithNoOverlays(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      console.log('🧪 TEST: Creating video with NO overlays at all...');
      
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-crf 23',
          '-preset fast',
          '-map_metadata -1' // Remove all metadata
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('🧪 TEST: FFmpeg command (no overlays):', commandLine);
        })
        .on('progress', (progress) => {
          console.log(`🧪 TEST: FFmpeg progress: ${progress.percent}% done`);
        })
        .on('end', () => {
          console.log('🧪 TEST: Video created with NO overlays');
          resolve();
        })
        .on('error', (err) => {
          console.error('🧪 TEST: FFmpeg error:', err);
          reject(err);
        })
        .run();
    });
  }

  escapeText(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }
    
    // Clean and escape text for FFmpeg drawtext filter
    return text
      .replace(/:/g, '\\:')           // Escape colons
      .replace(/'/g, "\\'")           // Escape single quotes
      .replace(/"/g, '\\"')           // Escape double quotes
      .replace(/\n/g, ' ')            // Replace newlines with spaces
      .replace(/\r/g, ' ')            // Replace carriage returns with spaces
      .replace(/\t/g, ' ')            // Replace tabs with spaces
      .replace(/\s+/g, ' ')           // Replace multiple spaces with single space
      .substring(0, 120)              // Limit length for better fit
      .trim();
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