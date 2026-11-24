"""Predict whether a new SMS is safe (ham) or a scam (spam).

Examples:
    python predict.py "Congratulations! You won a prize. Click this link now."
    python predict.py --examples
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib


PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL_PATH = PROJECT_ROOT / "models" / "scamshield_sms_pipeline.joblib"


@dataclass(frozen=True)
class PredictionResult:
    """A reusable prediction response for a CLI, API, or web interface."""

    label: str
    display_label: str
    probability: float | None


def load_model(model_path: Path = DEFAULT_MODEL_PATH) -> Any:
    """Load the already trained pipeline without fitting or retraining it."""
    if not model_path.is_file():
        raise FileNotFoundError(
            f"Saved model not found at: {model_path}. Run 'python -m src.train_model' first."
        )
    return joblib.load(model_path)


def predict_sms(message: str, model: Any) -> PredictionResult:
    """Classify one SMS message with a preloaded trained pipeline."""
    if not isinstance(message, str) or not message.strip():
        raise ValueError("SMS message must contain non-empty text.")

    label = str(model.predict([message])[0])
    display_label = "SCAM / SPAM" if label == "spam" else "SAFE / HAM"

    probability: float | None = None
    classifier = model.named_steps.get("classifier")
    if hasattr(classifier, "predict_proba"):
        probabilities = model.predict_proba([message])[0]
        class_index = list(model.classes_).index(label)
        probability = float(probabilities[class_index])

    return PredictionResult(
        label=label,
        display_label=display_label,
        probability=probability,
    )


def print_prediction(message: str, model: Any) -> None:
    """Print a concise, user-friendly CLI result."""
    result = predict_sms(message, model)
    print(f"Prediction: {result.display_label}")
    if result.probability is not None:
        print(f"Confidence: {result.probability:.2%}")
    else:
        print("Confidence: Not available (the saved Linear SVM has no probability estimator)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("message", nargs="?", help="SMS message to classify.")
    parser.add_argument(
        "--model",
        type=Path,
        default=DEFAULT_MODEL_PATH,
        help="Path to a saved ScamShield pipeline.",
    )
    parser.add_argument(
        "--examples",
        action="store_true",
        help="Run several built-in example messages.",
    )
    args = parser.parse_args()

    if not args.examples and not args.message:
        parser.error("provide an SMS message or use --examples")

    model = load_model(args.model)
    if args.examples:
        examples = [
            "Hey, are we still meeting at the library after class?",
            "Congratulations! You won a prize. Click this link now.",
            "URGENT! Your account will be suspended. Call this number immediately.",
        ]
        for index, message in enumerate(examples, start=1):
            print(f"Example {index}: {message}")
            print_prediction(message, model)
            print()
    else:
        print_prediction(args.message, model)


if __name__ == "__main__":
    main()
