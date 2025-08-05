const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');

class ClaudeService {
  constructor() {
    this.apiKey = config.CLAUDE_API_KEY;
    this.apiUrl = config.CLAUDE_API_URL;
    this.cacheDir = path.join(__dirname, '../cache');
    fs.ensureDirSync(this.cacheDir);
  }

  async analyzeVideo(videoBase64, prompt, fps = 1) {
    try {
      const systemPrompt = `You are an expert sports analyst and coach. Analyze the provided video and give detailed feedback on performance, technique, and areas for improvement. 

Your analysis should include:
- Shot analysis (made/missed shots, types of shots)
- Technique evaluation
- Performance metrics
- Specific feedback for improvement
- Step-by-step breakdown of key moments

Format your response as structured feedback that can be overlaid on video frames.`;

      const userPrompt = `${prompt}

Please analyze this video at ${fps} fps and provide detailed feedback that can be overlaid on the video frames.`;

      const requestBody = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 4000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: userPrompt
              },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "video/mp4",
                  data: videoBase64
                }
              }
            ]
          }
        ],
        system: systemPrompt
      };

      console.log('Sending request to Claude API...');
      const response = await axios.post(this.apiUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        }
      });

      const result = response.data.content[0].text;
      console.log('Claude API response received successfully');
      console.log('Response length:', result.length, 'characters');
      
      return result;
    } catch (error) {
      console.error('Claude API Error:', error.response?.data || error.message);
      throw new Error(`Claude API Error: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  async analyzeFrame(frameBase64, prompt) {
    try {
      // Create cache key based on frame content and prompt
      const cacheKey = this.createCacheKey(frameBase64, prompt);
      const cacheFile = path.join(this.cacheDir, `${cacheKey}.json`);
      
      // Check if we have a cached response
      if (await fs.pathExists(cacheFile)) {
        console.log(`Using cached response for frame analysis`);
        const cached = await fs.readJson(cacheFile);
        return cached.response;
      }

      const requestBody = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt
              },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: frameBase64
                }
              }
            ]
          }
        ]
      };

      console.log('Sending frame to Claude API...');
      const response = await axios.post(this.apiUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        }
      });

      const result = response.data.content[0].text;
      console.log('Frame analysis completed successfully');
      
      // Cache the response
      await fs.writeJson(cacheFile, {
        prompt: prompt,
        response: result,
        timestamp: new Date().toISOString()
      });

      return result;
    } catch (error) {
      console.error('Claude API Error for frame:', error.response?.data || error.message);
      throw new Error(`Claude API Error: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  createCacheKey(frameBase64, prompt) {
    // Create a hash based on frame content and prompt
    const crypto = require('crypto');
    const hash = crypto.createHash('md5');
    hash.update(frameBase64.substring(0, 1000) + prompt.substring(0, 200));
    return hash.digest('hex');
  }

  // Development mode: return mock responses to save API costs
  async analyzeFrameDev(frameBase64, prompt) {
    console.log('DEV MODE: Using mock response for frame analysis');
    
    const mockResponses = [
      "Great basketball form! Your shooting technique shows proper elbow alignment and follow-through. Keep your eyes on the target.",
      "Excellent footwork on this play. You're maintaining good balance and positioning. Consider adding more explosive movement.",
      "Good defensive stance. You're staying low and ready to react. Work on lateral quickness for better coverage.",
      "Nice shot selection! You're taking high-percentage shots within your range. Keep practicing from different angles.",
      "Solid passing technique. You're seeing the court well and making smart decisions. Continue working on timing."
    ];
    
    const randomResponse = mockResponses[Math.floor(Math.random() * mockResponses.length)];
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return randomResponse;
  }
}

module.exports = new ClaudeService(); 