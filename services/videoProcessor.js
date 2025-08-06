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
          
          // Parse structured JSON response if in dev mode
          let processedAnalysis = analysis;
          if (config.DEV_MODE) {
            try {
              const parsedAnalysis = JSON.parse(analysis);
              if (parsedAnalysis.shots && parsedAnalysis.shots.length > 0) {
                // Extract the most relevant shot feedback for this frame
                const relevantShot = parsedAnalysis.shots[parsedAnalysis.shots.length - 1]; // Get the latest shot
                processedAnalysis = relevantShot.feedback || "No specific feedback available";
                
                // Store the full structured data for potential future use
                frameAnalyses.push({
                  frame: sortedFrames[i],
                  timestamp: (i / fps).toFixed(2),
                  analysis: processedAnalysis,
                  structuredData: parsedAnalysis // Store the full JSON data
                });
              } else {
                processedAnalysis = "No shot data available";
                frameAnalyses.push({
                  frame: sortedFrames[i],
                  timestamp: (i / fps).toFixed(2),
                  analysis: processedAnalysis
                });
              }
            } catch (parseError) {
              console.log('Failed to parse JSON response, using as plain text');
              frameAnalyses.push({
                frame: sortedFrames[i],
                timestamp: (i / fps).toFixed(2),
                analysis: analysis
              });
            }
          } else {
            // Normal mode: use plain text response
            frameAnalyses.push({
              frame: sortedFrames[i],
              timestamp: (i / fps).toFixed(2),
              analysis: analysis
            });
          }
          
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
      console.log('🔄 Creating video with dynamic timestamp-based overlays...');
      console.log(`Input: ${inputPath}`);
      console.log(`Output: ${outputPath}`);
      console.log(`Frame analyses: ${frameAnalyses.length}`);
      
      // Start with a clean FFmpeg command
      let command = ffmpeg(inputPath);
      
      // Filter out meaningful analyses only
      const meaningfulAnalyses = frameAnalyses.filter(analysis => {
        const text = analysis.analysis || '';
        const timestamp = parseFloat(analysis.timestamp);
        
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
          .outputOptions(['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-preset', 'fast'])
          .output(outputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
        return;
      }
      
      // Create dynamic overlays based on timestamps
      const overlayFilters = [];
      
      // Add stats overlay (always visible)
      const statsText = this.createStatsText(meaningfulAnalyses);
      overlayFilters.push(`drawtext=text='${statsText}':fontsize=18:fontcolor=white:x=20:y=20:shadowcolor=black:shadowx=2:shadowy=2:box=1:boxcolor=black@0.7:boxborderw=5`);
      
      // Add dynamic feedback overlays for each meaningful analysis
      meaningfulAnalyses.forEach((analysis, index) => {
        const timestamp = parseFloat(analysis.timestamp);
        const feedbackText = this.escapeText(analysis.analysis);
        
        // Create overlay that appears at specific timestamp and stays for 3 seconds
        const startTime = timestamp;
        const endTime = timestamp + 3; // Show for 3 seconds
        
        const dynamicOverlay = `drawtext=text='${feedbackText}':fontsize=16:fontcolor=white:x=w/2-tw/2:y=h*0.7:shadowcolor=black:shadowx=2:shadowy=2:box=1:boxcolor=black@0.8:boxborderw=5:enable='between(t,${startTime},${endTime})'`;
        
        overlayFilters.push(dynamicOverlay);
        
        console.log(`📝 Added dynamic overlay ${index + 1}: "${feedbackText.substring(0, 50)}..." at ${startTime}s-${endTime}s`);
      });
      
      // Combine all filters
      const filterString = overlayFilters.join(',');
      
      console.log(`🎬 Created ${overlayFilters.length} dynamic overlays`);
      console.log(`🔍 Filter preview: ${filterString.substring(0, 200)}...`);
      
      // Apply the video filter
      command = command.videoFilter(filterString);
      
      // Set output options
      command
        .outputOptions(['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-preset', 'fast'])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('🔄 FFmpeg command with dynamic overlays:');
          console.log(commandLine);
          
          // Verify dynamic approach
          const drawtextCount = (commandLine.match(/drawtext/g) || []).length;
          console.log(`🔍 Drawtext filters found: ${drawtextCount} (should be ${overlayFilters.length})`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`📊 Progress: ${progress.percent.toFixed(1)}% done`);
          }
        })
        .on('end', () => {
          console.log('✅ Video with dynamic overlays created successfully');
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
    // Check if we have structured data available
    const structuredData = frameAnalyses.filter(f => f.structuredData).map(f => f.structuredData);
    
    if (structuredData.length > 0) {
      // Use structured data for more accurate statistics
      let totalShotsMade = 0;
      let totalShotsMissed = 0;
      let totalLayupsMade = 0;
      let shotTypes = [];
      
      structuredData.forEach(data => {
        if (data.shots) {
          data.shots.forEach(shot => {
            if (shot.result === 'made') {
              totalShotsMade++;
              if (shot.shot_type.toLowerCase().includes('layup')) {
                totalLayupsMade++;
              }
            } else if (shot.result === 'missed') {
              totalShotsMissed++;
            }
            shotTypes.push(shot.shot_type);
          });
        }
      });
      
      const totalShots = totalShotsMade + totalShotsMissed;
      const accuracy = totalShots > 0 ? (totalShotsMade / totalShots * 100).toFixed(1) + '%' : 'N/A';
      
      return {
        totalFrames: frameAnalyses.length,
        totalShots,
        totalShotsMade,
        totalShotsMissed,
        totalLayupsMade,
        accuracy,
        shotTypes: [...new Set(shotTypes)], // Unique shot types
        hasStructuredData: true
      };
    } else {
      // Fallback to text-based analysis for non-dev mode
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
        accuracy: shotCount > 0 ? (madeCount / shotCount * 100).toFixed(1) + '%' : 'N/A',
        hasStructuredData: false
      };
    }
  }

  // Create concatenated text from all analyses
  createConcatenatedText(analyses) {
    if (analyses.length === 0) {
      return '';
    }
    
    // Sort analyses by timestamp
    const sortedAnalyses = analyses.sort((a, b) => parseFloat(a.timestamp) - parseFloat(b.timestamp));
    
    console.log(`📝 Creating concatenated text from ${sortedAnalyses.length} analyses:`);
    
    // Extract and clean text from each analysis
    const textParts = sortedAnalyses.map((analysis, index) => {
      const text = this.escapeText(analysis.analysis);
      const timestamp = parseFloat(analysis.timestamp);
      
      console.log(`   ${index + 1}. ${timestamp}s: "${text.substring(0, 50)}..."`);
      
      return text;
    });
    
    // Join all text parts with separators
    const concatenatedText = textParts.join(' | ');
    
    console.log(`📝 Concatenated text created with ${sortedAnalyses.length} parts`);
    
    return concatenatedText;
  }

  // Create stats text for top-left overlay
  createStatsText(analyses) {
    // Check if we have structured data available
    const structuredData = analyses.filter(a => a.structuredData).map(a => a.structuredData);
    
    if (structuredData.length > 0) {
      // Use structured data for accurate statistics
      let totalShotsMade = 0;
      let totalShotsMissed = 0;
      let totalLayupsMade = 0;
      let totalThreePointers = 0;
      
      structuredData.forEach(data => {
        if (data.shots) {
          data.shots.forEach(shot => {
            if (shot.result === 'made') {
              totalShotsMade++;
              if (shot.shot_type.toLowerCase().includes('layup')) {
                totalLayupsMade++;
              }
              if (shot.shot_type.toLowerCase().includes('three') || shot.shot_type.toLowerCase().includes('3')) {
                totalThreePointers++;
              }
            } else if (shot.result === 'missed') {
              totalShotsMissed++;
            }
          });
        }
      });
      
      const totalShots = totalShotsMade + totalShotsMissed;
      const accuracy = totalShots > 0 ? Math.round((totalShotsMade / totalShots) * 100) : 0;
      
      // Use escaped text for FFmpeg
      return `Shots Made\\: ${totalShotsMade}\\nShots Missed\\: ${totalShotsMissed}\\nAccuracy\\: ${accuracy}%\\nLayups\\: ${totalLayupsMade}\\n3-Pointers\\: ${totalThreePointers}`;
    } else {
      // Fallback to text-based analysis
      const madeCount = analyses.filter(a => 
        a.analysis.toLowerCase().includes('made') || 
        a.analysis.toLowerCase().includes('good') ||
        a.analysis.toLowerCase().includes('great') ||
        a.analysis.toLowerCase().includes('nice') ||
        a.analysis.toLowerCase().includes('perfect')
      ).length;
      
      const missedCount = analyses.filter(a => 
        a.analysis.toLowerCase().includes('missed') || 
        a.analysis.toLowerCase().includes('miss') ||
        a.analysis.toLowerCase().includes('off') ||
        a.analysis.toLowerCase().includes('wrong')
      ).length;
      
      const totalShots = madeCount + missedCount;
      const accuracy = totalShots > 0 ? Math.round((madeCount / totalShots) * 100) : 0;
      
      // Use escaped text for FFmpeg
      return `Shots Made\\: ${madeCount}\\nShots Missed\\: ${missedCount}\\nAccuracy\\: ${accuracy}%`;
    }
  }

  // Create rotating feedback text that changes every 3 seconds
  createRotatingFeedback(analyses) {
    if (analyses.length === 0) {
      return 'No feedback available';
    }
    
    // Check if we have structured data available
    const structuredData = analyses.filter(a => a.structuredData).map(a => a.structuredData);
    
    if (structuredData.length > 0) {
      // Extract feedback from structured data
      const allFeedback = [];
      
      structuredData.forEach(data => {
        if (data.shots) {
          data.shots.forEach(shot => {
            if (shot.feedback && shot.feedback.trim()) {
              allFeedback.push(shot.feedback);
            }
          });
        }
      });
      
      if (allFeedback.length > 0) {
        // Take the first few feedback items and combine them
        const selectedFeedback = allFeedback.slice(0, 3); // Only use first 3 to keep it simple
        
        const feedbackParts = selectedFeedback.map((feedback, index) => {
          const cleanText = this.escapeText(feedback);
          return cleanText;
        });
        
        // Join with separators for a rotating effect
        const rotatingText = feedbackParts.join(' | ');
        
        console.log(`📝 Created rotating feedback with ${selectedFeedback.length} structured feedback items`);
        
        return rotatingText;
      }
    }
    
    // Fallback to text-based analysis
    // Take the first few meaningful analyses and combine them
    const selectedAnalyses = analyses.slice(0, 3); // Only use first 3 to keep it simple
    
    const feedbackParts = selectedAnalyses.map((analysis, index) => {
      const cleanText = this.escapeText(analysis.analysis);
      return cleanText;
    });
    
    // Join with separators for a rotating effect
    const rotatingText = feedbackParts.join(' | ');
    
    console.log(`📝 Created rotating feedback with ${selectedAnalyses.length} parts`);
    
    return rotatingText;
  }
}

module.exports = new VideoProcessor(); 