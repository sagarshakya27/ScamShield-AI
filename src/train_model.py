"""Train, compare, evaluate, and save SMS spam-classification pipelines."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import matplotlib

# Use a non-interactive backend so report images can be generated on servers.
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    ConfusionMatrixDisplay,
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sklearn.calibration import CalibratedClassifierCV
from sklearn.svm import LinearSVC

from src.text_preprocessing import normalize_sms


RANDOM_STATE = 42
LABEL_ORDER = ["ham", "spam"]


def build_pipeline(classifier: object) -> Pipeline:
    """Create one complete, serializable preprocessing-and-model pipeline."""
    return Pipeline(
        steps=[
            (
                "tfidf",
                TfidfVectorizer(
                    preprocessor=normalize_sms,
                    token_pattern=r"(?u)\b\w+\b",
                    ngram_range=(1, 2),
                    min_df=2,
                    sublinear_tf=True,
                    strip_accents="unicode",
                ),
            ),
            ("classifier", classifier),
        ]
    )


def save_confusion_matrix(
    y_true: pd.Series, y_pred: object, model_name: str, output_path: Path
) -> None:
    """Save a labelled confusion-matrix image for one model."""
    figure, axis = plt.subplots(figsize=(5, 4))
    ConfusionMatrixDisplay.from_predictions(
        y_true,
        y_pred,
        labels=LABEL_ORDER,
        display_labels=LABEL_ORDER,
        cmap="Blues",
        colorbar=False,
        ax=axis,
    )
    axis.set_title(f"{model_name} confusion matrix")
    figure.tight_layout()
    figure.savefig(output_path, dpi=150)
    plt.close(figure)


def main() -> None:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data",
        type=Path,
        default=project_root / "data" / "cleaned_sms.csv",
        help="Path to the cleaned CSV dataset.",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.20,
        help="Proportion reserved for the stratified test set (default: 0.20).",
    )
    args = parser.parse_args()

    if not 0 < args.test_size < 1:
        raise ValueError("--test-size must be greater than 0 and less than 1.")

    dataset = pd.read_csv(args.data, usecols=["label", "message"])
    if dataset[["label", "message"]].isna().any().any():
        raise ValueError("The cleaned dataset contains missing labels or messages.")
    if set(dataset["label"].unique()) != set(LABEL_ORDER):
        raise ValueError("Expected exactly two labels: 'ham' and 'spam'.")

    # Split before fitting any vectorizer or classifier to prevent data leakage.
    x_train, x_test, y_train, y_test = train_test_split(
        dataset["message"],
        dataset["label"],
        test_size=args.test_size,
        stratify=dataset["label"],
        random_state=RANDOM_STATE,
    )

    models = {
        "Multinomial Naive Bayes": MultinomialNB(),
        "Logistic Regression": LogisticRegression(max_iter=3000, random_state=RANDOM_STATE),
        # Calibration provides usable probabilities for the prediction API.
        "Linear SVM": CalibratedClassifierCV(
            estimator=LinearSVC(random_state=RANDOM_STATE), method="sigmoid", cv=5
        ),
    }
    reports_dir = project_root / "reports"
    models_dir = project_root / "models"
    reports_dir.mkdir(parents=True, exist_ok=True)
    models_dir.mkdir(parents=True, exist_ok=True)

    results: list[dict[str, float | str]] = []
    trained_pipelines: dict[str, Pipeline] = {}
    for model_name, classifier in models.items():
        pipeline = build_pipeline(classifier)
        pipeline.fit(x_train, y_train)
        predictions = pipeline.predict(x_test)

        results.append(
            {
                "model": model_name,
                "accuracy": accuracy_score(y_test, predictions),
                "precision": precision_score(y_test, predictions, pos_label="spam", zero_division=0),
                "recall": recall_score(y_test, predictions, pos_label="spam", zero_division=0),
                "f1_score": f1_score(y_test, predictions, pos_label="spam", zero_division=0),
            }
        )
        trained_pipelines[model_name] = pipeline
        filename = model_name.lower().replace(" ", "_") + "_confusion_matrix.png"
        save_confusion_matrix(y_test, predictions, model_name, reports_dir / filename)

    comparison = pd.DataFrame(results).sort_values(
        ["f1_score", "accuracy"], ascending=False
    ).reset_index(drop=True)
    best_model_name = str(comparison.loc[0, "model"])
    best_pipeline = trained_pipelines[best_model_name]

    model_path = models_dir / "scamshield_sms_pipeline.joblib"
    joblib.dump(best_pipeline, model_path)
    comparison.to_csv(reports_dir / "model_comparison.csv", index=False)

    report = {
        "dataset": str(args.data),
        "split": {
            "training_records": int(len(x_train)),
            "test_records": int(len(x_test)),
            "test_size": args.test_size,
            "stratified_by": "label",
            "random_state": RANDOM_STATE,
        },
        "positive_class": "spam",
        "best_model": best_model_name,
        "metrics": comparison.to_dict(orient="records"),
        "saved_pipeline": str(model_path),
    }
    (reports_dir / "training_report.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )

    display_table = comparison.copy()
    for metric in ["accuracy", "precision", "recall", "f1_score"]:
        display_table[metric] = display_table[metric].map(lambda value: f"{value:.4f}")

    print(f"Training records: {len(x_train)} | Test records: {len(x_test)}")
    print("Test split is stratified by label; TF-IDF is fitted only on training records.\n")
    print("Model comparison (spam is the positive class):")
    print(display_table.to_string(index=False))
    print(f"\nSelected model: {best_model_name} (highest spam F1-score)")
    print(f"Saved complete pipeline: {model_path}")
    print(f"Confusion matrices and reports: {reports_dir}")


if __name__ == "__main__":
    main()
