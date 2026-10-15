# ARGuitar_WASM
Welcome to ARGuitar!  Play guitar with your webcam using real guitar neck markers and AI-powered chord detection.

## 🎯 Project Goals
I used to travel a lot and couldn't take my guitar with me, so I got to wondering about how I could keep practising some of the basics without spending a lot, and surely, just surely it must be possible in this day and age to do something with a webcam + computer, or even just a mobile phone, insteaed of carting around a full size guitar.
So, AR Guitar was born, and it's been a long journey from hand-crafting Python code, and making the 'AR Guitar' from different materials, to really accelerating progress with the help of Google AntiGravity.  It's amazing to have reached this point.  I hope other people find it to be a useful and fun app.

What it does is allows you to play a guitar-like neck. It doesn't have any strings, it's pretty small and lightweight. It tracks your fingers over the guitar neck (using Aruco markers on the frets to know where the frets are. The best way to use it is with the song mode.  A song will play in the background, and depending on the 'level' you've chosen, it will show you which frets to play and which strings to strum. 
Level 1 - you only need to strum, and it will play the chords for you.
Level 2 - your fretting hand does need to be close to playing the right chord shapes.
Level 3 - as with a real guitar, you need to make the real fret shapes.  The tracking is not perfect here, so levels 1 & 2 are better to use right now.

You'll need to print out the PDF file and make your own AR Guitar to use with the app.

The App is deployed to: https://ar-guitar-wasm.vercel.app/


- **True AR Experience**: Place augmented reality guitar fret markers directly on your physical guitar neck using your webcam
- **Marker-Based Detection**: Use ArUco markers on the fretboard and headstock for precise positioning and tracking
- **AI Chord Recognition**: AI analyzes marker positions to identify chord shapes and finger placements
- **Real-Time Feedback**: Get instant visual feedback on correct/incorrect finger positions and strumming
- **Integrated Lesson**: Combines guitar tracking, chord detection, and lesson content into a single AR interface

## 🚀 Key Features

### 🎸 Guitar Tracking System
- **ArUco Marker Tracking**: Detects specially designed ArUco markers placed on each fret of the guitar neck
- **Fretboard Mapping**: Accurately maps 12 frets plus headstock markers to virtual 3D guitar neck coordinates
- **Pose Estimation**: Computes 3D position and orientation of the guitar in space for realistic AR overlay
- **Multi-Marker Support**: Detects all 23 markers (12 frets + 11 headstock) for complete tracking
- **HD Camera Support**: Optimized for 1080p video capture with real-time processing

### 🤖 AI Chord Detection Engine
- **Multi-Finger Analysis**: Tracks all 5 fretting fingers (thumb, index, middle, ring, pinky)
- **Chord Recognition**: Identifies 20+ common chords with high accuracy
- **Finger Placement Validation**: Checks if fingers are on the correct frets and strings
- **Ghost Note Suppression**: Filters out accidental finger touches and false positives
- **Confidence Scoring**: Assigns confidence levels to each finger detection
- **Real-Time Audio Feedback**: Integrated with `guitar_audio.js` for immediate sound feedback

### 🎓 AR Guitar Lessons
- **Integrated Lesson View**: Display lessons directly alongside AR guitar view (optional side-by-side)
- **SongHighway Integration**: Display scrolling song tabs and chord diagrams in AR overlay
- **Visual Guidance**: Highlight correct/incorrect finger positions with color-coded feedback
- **Performance Metrics**: Track accuracy and lesson progress
- **Dual-View Support**: View both AR guitar and lesson content simultaneously

### 📱 Mobile-Optimized Experience
- **Responsive Design**: Adapts to various screen sizes (desktops, tablets, phones)
- **Mobile Camera Support**: Automatic detection of front/back cameras on mobile devices
- **Touch-Friendly UI**: Large buttons and controls for touch interfaces
- **Full-Screen Mode**: Immersive AR experience with full-screen toggle
- **Hardware Acceleration**: Utilizes WebGL for efficient rendering

## 🛠️ Technical Architecture

### Core Technologies
- **WebRTC**: Video capture from webcam
- **OpenCV.js**: Marker detection and image processing
- **MediaPipe**: Hand tracking and pose estimation
- **React**: UI components and state management
- **Three.js**: 3D AR overlay rendering
- **HTML5 Canvas**: Video processing and drawing

### Performance Features
- **Hardware Acceleration**: WebGL-based rendering and MediaPipe GPU delegation
- **Optimized Processing**: Adaptive thresholding and multi-strategy detection
- **Frame Skipping**: Intelligent frame processing to maintain 60 FPS
- **Memory Management**: Efficient canvas and mat management
- **Performance Profiling**: Built-in FPS counter and performance diagnostics

### File Organization
```
src/
├── components/
│   ├── ARCamera.jsx            # Main AR camera component
│   ├── Guitar3D.jsx           # 3D guitar neck visualization
│   ├── PracticeHUD.jsx          # Performance HUD with chords/progress
│   ├── SongStudio.jsx         # Lesson interface and song management
│   ├── ARMusicPlayer.jsx        # Media player with AR visualization
│   ├── ControlsOverlay.jsx    # Control panel and settings
│   └── LessonSidebar.jsx      # Lesson content sidebar
├── utils/
│   ├── aruco_detector.js    # ArUco marker detection algorithms
│   ├── guitar_math.js         # Guitar geometry and pose calculation
│   ├── chord_detector.js      # AI chord recognition logic
│   ├── guitar_audio.js        # Audio synthesis and feedback
│   ├── song_engine.js         # Song playback engine
│   └── marker_visualizer.js   # Marker debugging tools
├── assets/
│   ├── aruco_dictionary.json  # Custom ArUco marker definitions
│   └── marker_image_20.png    # Reference marker images for testing
└── App.jsx                     # Main application entry point
```

## 🔧 Installation & Setup

### Prerequisites
- Node.js 14 or higher
- npm or yarn
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Webcam access enabled

### Installation Steps

1. **Clone the repository**
```bash
git clone <repository-url>
cd ARGuitar_WASM
```

2. **Install dependencies**
```bash
npm install
# or
yarn install
```

3. **Start the development server**
```bash
npm run dev
# or
yarn dev
```

4. **Open in browser**
Access the application at `http://localhost:5173` (or specified port)

## 📦 Build for Production

To create a production build:
```bash
npm run build
# or
yarn build
```

To serve the production build locally:
```bash
npm run preview
# or
yarn preview
```

## 🎓 How to Use

### Initial Setup
1. **Print ArUco Markers**: Print the custom marker images provided in `src/assets/` at the specified size (70x70mm)
2. **Attach Markers**: Affix the markers to your guitar:
   - One marker on each fret (1-12) on the fretboard (in front of the fret wire, toward the bridge)
   - One marker on the headstock for orientation reference
   - Ensure markers are flat, clean, and undamaged
3. **Enable Camera**: When prompted, allow camera access in your browser
4. **Select Camera**: Choose the correct camera (back camera recommended for best results)
5. **Tune Resolution**: Start with 640x480 resolution for better performance, upgrade to 1280x720 for HD quality

### Playing the Guitar
1. **Position Your Guitar**: Place the guitar in front of you with the neck roughly horizontal and facing the camera
2. **Camera Alignment**: Ensure the camera can see all marker frets clearly
3. **Strum**: Strum the strings normally with your picking hand
4. **Fret Chords**: Press down on the frets with your fretting hand
5. **Watch Feedback**: Look for:
   - Green indicators when fingers are correctly placed
   - Red indicators when fingers are misplaced
   - White dots for finger position suggestions
   - Chord diagrams showing the current shape

### Using Lesson Mode
1. **Enable AR Guitar**: Make sure the AR guitar view is active
2. **Toggle Song Studio**: Click the "Song Studio" button to open the lesson interface
3. **Select Lesson**: Choose from available song lessons
4. **Play Along**: Follow the scrolling tabs and chord diagrams
5. **Monitor Progress**: Track your accuracy and lesson completion

## 🛠️ Configuration Options

### Camera Settings
- **Resolution**: 480p (640x480) or 720p (1280x720)
- **Camera**: Primary or Secondary (front/back)
- **Stabilization**: Enable/disable video stabilization

### Performance Settings
- **FPS Cap**: 60 or 120 FPS
- **Quality Preset**: Low (faster) or High (smoother)
- **Rendering Mode**: Performance (faster) or Quality (more accurate)

### UI Settings
- **Theme**: Light or Dark
- **Font Size**: Adjust text size
- **Layout**: Compact or Expanded

### Audio Settings
- **Volume**: Adjust master volume
- **Instrument**: Guitar, Ukulele, or Bass
- **Tuning**: Standard or Drop D

## 🔮 Advanced Features

### Performance Profiler
Access the performance profiler to monitor:
- Frames per second (FPS)
- Video processing time
- Marker detection time
- Pose estimation time
- Rendering time
- Hardware acceleration status
