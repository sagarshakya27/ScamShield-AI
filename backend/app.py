"""Flask REST API for ScamShield AI SMS predictions."""

from __future__ import annotations

import re
import threading
from pathlib import Path
from typing import Any

import joblib
from flask import Flask, jsonify, request
from flask_cors import CORS


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_PATH = PROJECT_ROOT / "models" / "scamshield_sms_pipeline.joblib"
TRAINING_REPORT_PATH = PROJECT_ROOT / "reports" / "training_report.json"
MAX_MESSAGE_LENGTH = 1000
_TRANSLATION_MODEL_NAME = "Helsinki-NLP/opus-mt-en-hi"
_translation_lock = threading.Lock()
_translation_pipeline: tuple[Any, Any] | None = None
_PROTECTED_PATTERN = re.compile(
    r"https?://\S+|www\.\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|"
    r"(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)|"
    r"(?:₹|Rs\.?|INR|\$|€|£)\s?\d[\d,]*(?:\.\d+)?|"
    r"\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b|"
    r"\b(?:ATM\s+PIN|OTP|PIN|KYC)\b",
    re.IGNORECASE,
)


def load_pipeline(model_path: Path = DEFAULT_MODEL_PATH) -> Any:
    """Load the pre-trained prediction pipeline; never fit a model here."""
    if not model_path.is_file():
        raise FileNotFoundError(
            f"Model not found at {model_path}. Run 'python -m src.train_model' first."
        )
    pipeline = joblib.load(model_path)
    if not hasattr(pipeline, "predict_proba"):
        raise RuntimeError("The saved model must support probability predictions.")
    return pipeline


def _translate(message: str) -> str:
    global _translation_pipeline

    if _translation_pipeline is None:
        with _translation_lock:
            if _translation_pipeline is None:
                from transformers import MarianMTModel, MarianTokenizer

                tokenizer = MarianTokenizer.from_pretrained(_TRANSLATION_MODEL_NAME)
                model = MarianMTModel.from_pretrained(_TRANSLATION_MODEL_NAME)
                model.eval()
                _translation_pipeline = (tokenizer, model)

    tokenizer, model = _translation_pipeline

    def translate_segment(segment: str) -> str:
        leading_whitespace = segment[: len(segment) - len(segment.lstrip())]
        trailing_whitespace = segment[len(segment.rstrip()) :]
        text = segment.strip()
        if not text or not re.search(r"[A-Za-z]", text):
            return segment

        encoded = tokenizer(text, return_tensors="pt", truncation=True, max_length=512)
        translated_tokens = model.generate(**encoded)
        translated = tokenizer.decode(translated_tokens[0], skip_special_tokens=True)
        return f"{leading_whitespace}{translated.strip()}{trailing_whitespace}"

    translated_parts: list[str] = []
    cursor = 0
    for protected_value in _PROTECTED_PATTERN.finditer(message):
        translated_parts.append(translate_segment(message[cursor:protected_value.start()]))
        translated_parts.append(protected_value.group())
        cursor = protected_value.end()
    translated_parts.append(translate_segment(message[cursor:]))
    return "".join(translated_parts).strip()


def _explain(message: str, prediction: str) -> list[str]:
    """Return only rule-based cues that are directly present in the message."""
    cues: list[tuple[str, str, re.Pattern[str]]] = [
        ("unexpected prize or reward language", "अचानक इनाम या पुरस्कार का दावा", re.compile(
            r"\b(congratulations|congrats|won|winner|prize|lottery|reward|gift)\b", re.I
        )),
        ("urgency or pressure to act", "जल्दी कार्रवाई करने का दबाव", re.compile(
            r"\b(urgent|immediately|act now|limited time|expires today|right now)\b", re.I
        )),
        ("a request to click a link", "लिंक पर क्लिक करने का अनुरोध", re.compile(
            r"\b(click|tap|visit|open)\b.{0,45}\b(link|url|website|here)\b|\b(link|url)\b", re.I
        )),
        ("a request for sensitive account or payment information", "खाते या भुगतान की संवेदनशील जानकारी का अनुरोध", re.compile(
            r"\b(password|pin|otp|one.time password|bank details|card number|account details)\b", re.I
        )),
        ("a threat that an account will be blocked or suspended", "खाता बंद या निलंबित करने की धमकी", re.compile(
            r"\b(blocked|suspended|deactivated|will be closed)\b", re.I
        )),
    ]
    found = [english for english, _, pattern in cues if pattern.search(message)]
    if not found:
        if prediction == "SCAM":
            return [
                "The model classified this message as a potential scam, but no specific rule-based cue was identified.",
                "मॉडल ने इस संदेश को संभावित स्कैम बताया, लेकिन नियम-आधारित जाँच में कोई खास संकेत नहीं मिला।",
            ]
        return [
            "No specific scam cue was identified by the explanation rules.",
            "नियम-आधारित जाँच में स्कैम का कोई खास संकेत नहीं मिला।",
        ]
    english = ", and ".join(found)
    hindi = ", और ".join(hindi for _, hindi, pattern in cues if pattern.search(message))
    return [
        f"This message may be suspicious because it contains {english}.",
        f"यह संदेश संदिग्ध हो सकता है क्योंकि इसमें {hindi}।",
    ]


def create_app(model_path: Path = DEFAULT_MODEL_PATH) -> Flask:
    """Create the Flask app and load the model once during server startup."""
    app = Flask(__name__)
    CORS(app, resources={r"/api/*": {"origins": "*"}})
    pipeline = load_pipeline(model_path)

    @app.get("/api/health")
    def health() -> tuple[Any, int]:
        import json

        metrics: dict[str, Any] = {}
        if TRAINING_REPORT_PATH.is_file():
            with TRAINING_REPORT_PATH.open(encoding="utf-8") as report_file:
                metrics = json.load(report_file)
        return jsonify(
            {
                "status": "ok",
                "model_loaded": True,
                "translation_provider": _TRANSLATION_MODEL_NAME,
                "translation_configured": True,
                "translation_model_loaded": _translation_pipeline is not None,
                "metrics": metrics.get("metrics", []),
            }
        ), 200

    @app.post("/api/predict")
    def predict() -> tuple[Any, int]:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "Request body must be valid JSON."}), 400

        message = payload.get("message")
        if not isinstance(message, str) or not message.strip():
            return jsonify({"error": "'message' must be a non-empty string."}), 400
        if len(message) > MAX_MESSAGE_LENGTH:
            return jsonify({"error": f"'message' must be {MAX_MESSAGE_LENGTH} characters or fewer."}), 400

        try:
            label = str(pipeline.predict([message])[0])
            probabilities = pipeline.predict_proba([message])[0]
            class_index = list(pipeline.classes_).index(label)
            confidence = round(float(probabilities[class_index]) * 100, 2)
            return jsonify(
                {
                    "prediction": "SCAM" if label == "spam" else "SAFE",
                    "confidence": confidence,
                }
            ), 200
        except Exception:
            app.logger.exception("Prediction failed")
            return jsonify({"error": "Unable to process this message."}), 500

    @app.post("/api/translate")
    def translate() -> tuple[Any, int]:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "Request body must be valid JSON."}), 400
        message = payload.get("message")
        if not isinstance(message, str) or not message.strip():
            return jsonify({"error": "'message' must be a non-empty string."}), 400
        if len(message) > MAX_MESSAGE_LENGTH:
            return jsonify({"error": f"'message' must be {MAX_MESSAGE_LENGTH} characters or fewer."}), 400

        try:
            return jsonify({"translation": _translate(message.strip())}), 200
        except RuntimeError as error:
            app.logger.warning("Translation unavailable: %s", error)
            return jsonify({"error": str(error)}), 503
        except Exception:
            app.logger.exception("Translation failed")
            return jsonify({"error": "Translation failed. Check the model download/network and try again."}), 503

    @app.post("/api/explain")
    def explain() -> tuple[Any, int]:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "Request body must be valid JSON."}), 400
        message = payload.get("message")
        prediction = payload.get("prediction")
        if not isinstance(message, str) or not message.strip():
            return jsonify({"error": "'message' must be a non-empty string."}), 400
        if len(message) > MAX_MESSAGE_LENGTH:
            return jsonify({"error": f"'message' must be {MAX_MESSAGE_LENGTH} characters or fewer."}), 400
        if prediction not in {"SCAM", "SAFE"}:
            return jsonify({"error": "'prediction' must be SCAM or SAFE."}), 400
        return jsonify({"explanation": _explain(message, prediction), "method": "rule-based"}), 200

    @app.errorhandler(404)
    def not_found(_: Exception) -> tuple[Any, int]:
        return jsonify({"error": "Endpoint not found."}), 404

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
