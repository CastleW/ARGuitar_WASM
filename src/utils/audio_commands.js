/**
 * Voice Commands Listener using Browser Web Speech API
 * Port of voice commands from `audio_commands.py`
 */

export class AudioCommandsListener {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.recognition = null;
    this.shouldBeListening = false;
    this.restartTimer = null;
  }

  /**
   * Start listening for voice commands
   * Requires microphone permissions
   */
  start() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Web Speech API is not supported in this browser.");
      if (this.callbacks.onError) {
        this.callbacks.onError("Web Speech API not supported in this browser.");
      }
      return false;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = false;
    this.recognition.lang = 'en-US';
    this.shouldBeListening = true;

    this.recognition.onstart = () => {
      console.log("Speech recognition started.");
      if (this.callbacks.onStartListening) {
        this.callbacks.onStartListening();
      }
    };

    this.recognition.onend = () => {
      console.log("Speech recognition ended.");
      if (this.shouldBeListening) {
        // Debounce restart using a timeout to prevent an infinite synchronous restart loop
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
          if (this.shouldBeListening) {
            try {
              this.recognition.start();
            } catch (e) {
              console.error("Auto-restart of speech recognition failed:", e);
            }
          }
        }, 2000);
      } else {
        if (this.callbacks.onStopListening) {
          this.callbacks.onStopListening();
        }
      }
    };

    this.recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      if (event.error === 'not-allowed') {
        this.shouldBeListening = false;
      }
      if (this.callbacks.onError) {
        this.callbacks.onError(event.error);
      }
    };

    this.recognition.onresult = (event) => {
      const resultIndex = event.resultIndex;
      const transcript = event.results[resultIndex][0].transcript.trim().toLowerCase();
      console.log("Voice command transcript:", transcript);

      if (this.callbacks.onCommandReceived) {
        this.callbacks.onCommandReceived(transcript);
      }

      // Check for command matches
      if (transcript.includes("take a snapshot") || transcript.includes("take snapshot")) {
        if (this.callbacks.onTakeSnapshot) this.callbacks.onTakeSnapshot();
      } else if (transcript.includes("show finger position")) {
        if (this.callbacks.onShowFingerPositions) this.callbacks.onShowFingerPositions(true);
      } else if (transcript.includes("hide finger position")) {
        if (this.callbacks.onShowFingerPositions) this.callbacks.onShowFingerPositions(false);
      } else if (transcript.includes("start recording video")) {
        if (this.callbacks.onRecordVideo) this.callbacks.onRecordVideo(true);
      } else if (transcript.includes("stop recording video")) {
        if (this.callbacks.onRecordVideo) this.callbacks.onRecordVideo(false);
      } else if (transcript.includes("start recording strumming")) {
        if (this.callbacks.onRecordStrumming) this.callbacks.onRecordStrumming(true);
      } else if (transcript.includes("stop recording strumming")) {
        if (this.callbacks.onRecordStrumming) this.callbacks.onRecordStrumming(false);
      }
    };

    try {
      this.recognition.start();
      return true;
    } catch (e) {
      console.error("Failed to start speech recognition:", e);
      return false;
    }
  }

  /**
   * Stop listening for voice commands
   */
  stop() {
    this.shouldBeListening = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {
        console.error("Failed to stop speech recognition:", e);
      }
    }
  }
}
