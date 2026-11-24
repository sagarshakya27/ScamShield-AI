# ScamShield AI 2.0

ScamShield AI is an educational SMS safety dashboard that combines the project's existing trained scam classifier with English-to-Hindi neural translation, transparent text-cue explanations, and browser text-to-speech.

> This project is for awareness and educational use, not a substitute for independently verifying unexpected messages. A "safe" prediction is not proof that a message is legitimate.

## Features

- **Scam detection:** Reuses `models/scamshield_sms_pipeline.joblib` (TF-IDF + calibrated Linear SVM). The backend loads it at startup and does not train a model during requests.
- **Confidence and metrics:** Prediction confidence is returned only when the loaded classifier supports probabilities. Test-set metrics are read from `reports/training_report.json`; they describe the stored evaluation, not guaranteed real-world performance.
- **English-to-Hindi:** Uses the pretrained Hugging Face `Helsinki-NLP/opus-mt-en-hi` Transformer model locally; no Google Translate API key is required. It downloads on the first translation request and is reused for subsequent requests. Inference runs on CPU. URLs, phone-like numbers, and monetary values are preserved during translation when recognized.
- **Explanation:** A clearly labeled rule-based fallback identifies a small set of message cues (such as prize, urgency, or sensitive-information language). It is not a generative model and does not establish whether a message is fraudulent.
- **Voice assistant:** Uses the browser Web Speech API. English and Hindi voices depend on those installed and exposed by the browser/operating system; Hindi voice playback is not guaranteed.
- **Automatic live demonstration:** The dashboard's **Auto Demo** button narrates a guided tour, types fictional scam and ordinary examples, and waits for the existing local prediction, explanation, and translation APIs. Predictions and translations displayed are their real responses, not sample results. The microphone is never activated by the demo.
- **Responsive dashboard:** Includes detection, translation, voice controls, explanation, and project information.

Messages are sent from the browser to the Flask API running in this project. Translation requires a one-time download of the pretrained model from Hugging Face; translation text is not sent to a hosted inference API. Prediction and explanation run in the local backend.

### Automatic project demonstration

Click **Auto Demo** in the dashboard's top bar to start the narrated, live walkthrough. Subtitles and progress appear in a slim inline caption beneath the top bar; playback controls and voice selection stay in the top bar rather than opening a floating player. Each guided step scrolls to and highlights its target, waits for narration to finish, then performs any typing or API action. Scam-prediction and translation results are shown only after the local API responds, and the pointer moves to the returned result before describing it. The tour covers the dashboard workflow, message entry, microphone dictation, scam-check and translation results, English/Hindi speaker buttons, their Stop buttons, and the explanation panel. It does not narrate project architecture or the About Project section. Pause holds narration and typing; Stop aborts the active request and restores the prior message/results. During playback, manual message editing and actions are temporarily locked to keep actual API responses associated with the message being demonstrated. If narration or an API action fails, the demo pauses with an error rather than advancing out of sync.

The narration uses the browser's installed English speech voices. The player prefers an Indian English voice and uses voice-name clues only as a best-effort preference; browsers do not expose reliable voice-gender metadata, so the selected voice is never guaranteed or represented as male. Choose and verify a male-sounding voice in the selector if one is available. If Hindi audio is demonstrated, it uses an actual installed Hindi voice; the demo does not substitute an English voice for Hindi. The microphone is not started and microphone permission is never requested by Auto Demo.

## Requirements

- Python 3.10 or newer
- Node.js 18 or newer and npm
- Internet access for the first download of the translation model (approximately hundreds of MB; cached by Transformers afterward)
- A Hindi system/browser speech voice for Hindi audio playback

PyTorch CPU wheels are sufficient; a GPU is not required. On Windows, install the CPU build first to avoid installing CUDA libraries:

```powershell
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
python -m pip install -r requirements.txt
```

## Install and run on Windows

Open PowerShell in the project root:

```powershell
cd C:\Users\ADMIN\Downloads\ScamShield-AI
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
python -m pip install -r requirements.txt
```

If PowerShell blocks activation, either allow activation for this terminal with `Set-ExecutionPolicy -Scope Process Bypass`, or run Python directly as `.\.venv\Scripts\python.exe`.

Install the frontend dependencies (the repository may already have them installed):

```powershell
cd frontend
npm install
cd ..
```

### Start the Flask API

In terminal 1, from the project root:

```powershell
python -m backend.app
```

The API listens on `http://127.0.0.1:5000`. It loads the existing scam model at startup. Translation model loading is deferred until you first request a translation; first use needs internet access and may take a few minutes.

### Start the frontend

In terminal 2:

```powershell
cd C:\Users\ADMIN\Downloads\ScamShield-AI\frontend
npm run dev
```

Open the Vite URL, usually `http://localhost:5173`. Vite proxies `/api` requests to the Flask API on port 5000. Keep both terminals running.

## API endpoints

- `GET /api/health` — backend/model availability, reported training metrics, translation model name and whether it has loaded.
- `POST /api/predict` — JSON `{"message":"..."}`; returns `prediction` and confidence when supported.
- `POST /api/translate` — JSON `{"message":"..."}`; returns the Hindi `translation`. Responds with HTTP 503 and a meaningful error if the model/dependencies cannot be loaded.
- `POST /api/explain` — JSON `{"message":"...","prediction":"SCAM"}`; returns rule-based explanation strings and `"method":"rule-based"`.

All message endpoints require a non-empty string of at most 1,000 characters and return HTTP 400 for invalid input.

Example from PowerShell:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:5000/api/predict" `
  -ContentType "application/json" `
  -Body '{"message":"Congratulations! You won a prize. Click this link now."}'
```

## Demonstration messages

**Potential scam example**

```text
Congratulations! You won ₹50,000. Click here to claim your prize now.
```

**Ordinary/legitimate-style example**

```text
Hi, are we still meeting at the library after class today?
```

Predictions depend on the existing model and its training data; these examples are not guaranteed outcomes.

## Model and AI modules (presentation notes)

1. **SMS classification:** The saved scikit-learn pipeline applies the project's text normalization and TF-IDF word features, then the calibrated Linear SVM classifies spam versus ham. It is pre-trained, loaded once by Flask, and is never retrained by a prediction request. The test metrics in `reports/training_report.json` use a held-out dataset split.
2. **Translation:** Transformers loads Helsinki OPUS-MT English-to-Hindi at first use, on CPU. A Transformers cache prevents reloading it for each request. No translation API key is needed. The first run requires a model download; if dependencies or network access are unavailable, the endpoint returns an error rather than pretending to translate.
3. **Explanation:** A deterministic rule-based fallback reports text patterns actually found in the message. It is labeled as rule-based, not as a generative AI result; it is not a causal explanation of the classifier's internal decision.
4. **Speech:** The browser's Web Speech API speaks the source or translated text using available local voices. Voice inventory varies by browser and operating system.

## Existing data preparation / training

The original ML workflow is retained. To train a new model from the original dataset:

```powershell
python -m src.prepare_data --input "C:\path\to\SMSSpamCollection"
python -m src.train_model
```

To run a command-line prediction with the saved model:

```powershell
python predict.py "Congratulations! You won a prize. Click this link now."
```

## Project structure

```text
ScamShield-AI/
├── backend/
│   └── app.py                       # Flask prediction, translation, explanation, health APIs
├── data/                            # Prepared SMS data and quality report
├── frontend/
│   ├── src/App.jsx                  # ScamShield AI 2.0 dashboard and voice tools
│   ├── src/styles.css               # Responsive cybersecurity theme
│   ├── package.json
│   └── vite.config.js               # Local API proxy
├── models/
│   └── scamshield_sms_pipeline.joblib
├── reports/
│   └── training_report.json         # Existing held-out ML metrics
├── src/                             # Existing preprocessing and training workflow
├── predict.py
├── requirements.txt
└── README.md
```

## Build check

```powershell
cd frontend
npm run build
```
