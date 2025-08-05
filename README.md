# Sport Analyzer - AI-Powered Video Analysis

A fullstack application that takes sports videos and returns them with AI-powered feedback overlays, similar to the basketball analysis example you referenced.

## 🏀 Features

- **Video Upload & Processing**: Upload sports videos and get AI analysis
- **Frame-by-Frame Analysis**: Detailed feedback on each frame using Claude AI
- **Custom Prompts**: Configure analysis prompts for different sports and feedback styles
- **Video Overlay**: Text feedback overlaid on video frames
- **Real-time Processing**: Live progress tracking during analysis
- **Side-by-side Comparison**: View original and processed videos
- **Modern UI**: Beautiful dark theme with smooth animations
- **Responsive Design**: Works on desktop and mobile

## 📁 Project Structure

```
sport-analyzer/
├── sport-analyzer-backend/     # Node.js backend API
│   ├── server.js               # Express server
│   ├── services/
│   │   ├── claudeService.js    # Claude API integration
│   │   └── videoProcessor.js   # Video processing logic
│   └── README.md
├── sport-analyzer-frontend/    # React frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── VideoUpload.js
│   │   │   ├── VideoPlayer.js
│   │   │   └── AnalysisResults.js
│   │   └── App.js
│   └── README.md
└── README.md                   # This file
```

## 🚀 Quick Start

### Prerequisites

- Node.js (v16 or higher)
- Claude API key (already configured)

### 1. Start the Backend

```bash
cd sport-analyzer-backend
npm install
npm start
```

The backend will start on `http://localhost:3001`

### 2. Start the Frontend

```bash
cd sport-analyzer-frontend
npm install
npm start
```

The frontend will start on `http://localhost:3000`

### 3. Use the Application

1. Open `http://localhost:3000` in your browser
2. Drag and drop a sports video
3. Configure your analysis prompt (or use the example)
4. Set FPS (1 FPS recommended for faster processing)
5. Click "Analyze Video"
6. View the processed video with feedback overlay

## 🎯 Example Usage

### Basketball Analysis Prompt
```
This is me playing basketball slowed down.
Tell me how many shots I made tell me how many lay ups I made tell me how many three-pointers I made
tell me how many shots I missed and tell me from where I made shots as well and tell me the steps on
which made the shot and missed the shot
On every shot. Give me feedback like you're Michael Jordan.
go at 1 fps
```

### Supported Video Formats
- MP4
- AVI
- MOV
- MKV
- WebM

## 🔧 How It Works

### Backend Process
1. **Video Upload**: Receives video file via multipart form data
2. **Frame Extraction**: Uses FFmpeg to extract frames at specified FPS
3. **AI Analysis**: Sends each frame to Claude API for analysis
4. **Overlay Generation**: Creates text overlays on frames using Canvas
5. **Video Reconstruction**: Combines overlay frames back into video
6. **Response**: Returns processed video URL and analysis data

### Frontend Features
- **Drag & Drop Upload**: Easy video file upload
- **Real-time Progress**: Live upload and processing progress
- **Side-by-side View**: Compare original and processed videos
- **Detailed Analytics**: Frame-by-frame analysis breakdown
- **Custom Controls**: Full video player with custom controls

## 🛠️ Technology Stack

### Backend
- **Node.js**: Runtime environment
- **Express**: Web framework
- **FFmpeg**: Video processing
- **Canvas**: Image manipulation
- **Claude API**: AI analysis
- **Multer**: File upload handling

### Frontend
- **React**: Frontend framework
- **Tailwind CSS**: Styling
- **Framer Motion**: Animations
- **React Dropzone**: File upload
- **React Player**: Video playback
- **Axios**: API communication

## 📊 API Endpoints

### POST /api/analyze-video
Upload and analyze a video with AI feedback overlay.

**Request:**
- `video`: Video file (multipart/form-data)
- `prompt`: Analysis prompt (optional)
- `fps`: Frames per second (optional, default: 1)

**Response:**
```json
{
  "success": true,
  "originalVideo": "video.mp4",
  "processedVideo": "/processed/processed-uuid.mp4",
  "analysis": [...],
  "feedback": {
    "totalFrames": 10,
    "shotCount": 5,
    "madeCount": 3,
    "missedCount": 2,
    "accuracy": "60.0%"
  }
}
```

## ⚙️ Configuration

### Backend Environment Variables
```bash
CLAUDE_API_KEY=your_claude_api_key
PORT=3001
UPLOAD_DIR=uploads
PROCESSED_DIR=processed
MAX_FILE_SIZE=100000000
```

### Frontend Configuration
The frontend automatically proxies API requests to `http://localhost:3001`.

## 🎨 Features in Detail

### Video Processing
- Frame extraction at configurable FPS
- AI analysis of each frame
- Text overlay generation
- Video reconstruction with overlays

### Analysis Results
- Shot statistics (attempted, made, missed)
- Accuracy calculations
- Frame-by-frame feedback
- Performance metrics

### User Interface
- Modern dark theme
- Smooth animations
- Responsive design
- Real-time progress tracking

## 🔍 Troubleshooting

### Common Issues

1. **Backend Won't Start**
   - Check if port 3001 is available
   - Verify Node.js version (v16+)
   - Check Claude API key configuration

2. **Video Upload Fails**
   - Verify file format (MP4, AVI, MOV, MKV, WebM)
   - Check file size (max 100MB)
   - Ensure backend is running

3. **Processing Takes Too Long**
   - Reduce FPS setting (try 0.5 or 1)
   - Compress video before upload
   - Check Claude API rate limits

4. **Video Won't Play**
   - Check browser compatibility
   - Verify video format
   - Clear browser cache

## 🚀 Deployment

### Backend Deployment
1. Set environment variables
2. Install dependencies: `npm install`
3. Start server: `npm start`

### Frontend Deployment
1. Build for production: `npm run build`
2. Serve static files from `build/` directory
3. Configure proxy to backend API

## 📝 License

MIT License - see individual README files for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

For issues and questions:
1. Check the troubleshooting section
2. Review the individual README files
3. Check the backend logs for errors
4. Verify Claude API key and rate limits

---

**Note**: This application uses the Claude API for video analysis. Ensure you have sufficient API credits and are aware of rate limits for production use. 