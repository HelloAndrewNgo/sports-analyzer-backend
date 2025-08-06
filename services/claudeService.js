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
      {
        "shots": [
          {
            "timestamp_of_outcome": "0:07.5",
            "result": "missed",
            "shot_type": "Jump shot (around free-throw line)",
            "total_shots_made_so_far": 0,
            "total_shots_missed_so_far": 1,
            "total_layups_made_so_far": 0,
            "feedback": "You're pushing that ball, not shooting it; get your elbow under, extend fully, and follow through."
          },
          {
            "timestamp_of_outcome": "0:13.0",
            "result": "made",
            "shot_type": "Three-pointer",
            "total_shots_made_so_far": 1,
            "total_shots_missed_so_far": 1,
            "total_layups_made_so_far": 0,
            "feedback": "It went in, but watch that slight fade keep your shoulders square to the hoop through the whole motion."
          },
          {
            "timestamp_of_outcome": "0:21.5",
            "result": "made",
            "shot_type": "Layup",
            "total_shots_made_so_far": 2,
            "total_shots_missed_so_far": 1,
            "total_layups_made_so_far": 1,
            "feedback": "Drive that knee on the layup, protect the ball higher with your off-hand, and finish decisively."
          },
          {
            "timestamp_of_outcome": "0:28.5",
            "result": "made",
            "shot_type": "Jump shot (free-throw line)",
            "total_shots_made_so_far": 3,
            "total_shots_missed_so_far": 1,
            "total_layups_made_so_far": 1,
            "feedback": "Better balance, but that shot pocket and release point must be identical every single time for real consistency."
          }
        ]
      },
      {
        "shots": [
          {
            "timestamp_of_outcome": "0:05.2",
            "result": "made",
            "shot_type": "Layup",
            "total_shots_made_so_far": 1,
            "total_shots_missed_so_far": 0,
            "total_layups_made_so_far": 1,
            "feedback": "Excellent drive to the basket! Keep your head up and eyes on the rim throughout the motion."
          },
          {
            "timestamp_of_outcome": "0:12.8",
            "result": "missed",
            "shot_type": "Three-pointer",
            "total_shots_made_so_far": 1,
            "total_shots_missed_so_far": 1,
            "total_layups_made_so_far": 1,
            "feedback": "Good shot selection, but you're rushing. Take your time, set your feet, and follow through completely."
          },
          {
            "timestamp_of_outcome": "0:19.3",
            "result": "made",
            "shot_type": "Jump shot (mid-range)",
            "total_shots_made_so_far": 2,
            "total_shots_missed_so_far": 1,
            "total_layups_made_so_far": 1,
            "feedback": "Perfect form! Your elbow is aligned, wrist is straight, and follow-through is consistent."
          }
        ]
      },
      {
        "shots": [
          {
            "timestamp_of_outcome": "0:08.1",
            "result": "missed",
            "shot_type": "Free throw",
            "total_shots_made_so_far": 0,
            "total_shots_missed_so_far": 1,
            "total_layups_made_so_far": 0,
            "feedback": "Stay focused on the rim, not the ball. Your routine looks good, just need more consistency."
          },
          {
            "timestamp_of_outcome": "0:15.7",
            "result": "made",
            "shot_type": "Dunk",
            "total_shots_made_so_far": 1,
            "total_shots_missed_so_far": 1,
            "total_layups_made_so_far": 0,
            "feedback": "Explosive finish! Great elevation and power. Keep working on your vertical jump for more dunks."
          },
          {
            "timestamp_of_outcome": "0:24.2",
            "result": "made",
            "shot_type": "Jump shot (corner three)",
            "total_shots_made_so_far": 2,
            "total_shots_missed_so_far": 1,
            "total_layups_made_so_far": 0,
            "feedback": "Excellent corner three! Your footwork and balance are spot on. Keep practicing from different angles."
          }
        ]
      },
      {
        "shots": [
          {
            "timestamp_of_outcome": "0:06.4",
            "result": "made",
            "shot_type": "Hook shot",
            "total_shots_made_so_far": 1,
            "total_shots_missed_so_far": 0,
            "total_layups_made_so_far": 0,
            "feedback": "Great use of the hook shot! Keep your body between the ball and defender, and use your off-hand for protection."
          },
          {
            "timestamp_of_outcome": "0:14.9",
            "result": "missed",
            "shot_type": "Jump shot (top of key)",
            "total_shots_made_so_far": 1,
            "total_shots_missed_so_far": 1,
            "total_layups_made_so_far": 0,
            "feedback": "You're fading away on the shot. Stay square to the basket and jump straight up, not back."
          },
          {
            "timestamp_of_outcome": "0:22.6",
            "result": "made",
            "shot_type": "Floater",
            "total_shots_made_so_far": 2,
            "total_shots_missed_so_far": 1,
            "total_layups_made_so_far": 0,
            "feedback": "Perfect floater! Great touch and timing. This is a valuable shot to have in your arsenal."
          }
        ]
      },
      {
        "shots": [
          {
            "timestamp_of_outcome": "0:09.3",
            "result": "made",
            "shot_type": "Pull-up jumper",
            "total_shots_made_so_far": 1,
            "total_shots_missed_so_far": 0,
            "total_layups_made_so_far": 0,
            "feedback": "Excellent pull-up! You stopped on a dime and got good elevation. Keep working on this mid-range game."
          },
          {
            "timestamp_of_outcome": "0:17.8",
            "result": "missed",
            "shot_type": "Three-pointer",
            "total_shots_made_so_far": 1,
            "total_shots_missed_so_far": 1,
            "total_layups_made_so_far": 0,
            "feedback": "Good range, but you're not getting enough arc on the shot. Aim higher and follow through longer."
          },
          {
            "timestamp_of_outcome": "0:26.1",
            "result": "made",
            "shot_type": "Reverse layup",
            "total_shots_made_so_far": 2,
            "total_shots_missed_so_far": 1,
            "total_layups_made_so_far": 1,
            "feedback": "Beautiful reverse layup! Great body control and finishing with the off-hand. Keep practicing this move."
          }
        ]
      }
    ];
    
    const randomResponse = mockResponses[Math.floor(Math.random() * mockResponses.length)];
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return JSON.stringify(randomResponse);
  }
}

module.exports = new ClaudeService(); 