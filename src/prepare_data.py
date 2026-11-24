"""Load, inspect, clean, and save the SMS Spam Collection dataset."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


EXPECTED_LABELS = {"ham", "spam"}


def load_sms_dataset(input_path: Path) -> pd.DataFrame:
    """Load the headerless tab-separated SMS Spam Collection file.

    The dataset format is one label and one message per row, separated by a tab.
    We split each line at its first tab instead of using CSV quote parsing. This
    is important because the source messages can contain unmatched quote marks.
    """
    records: list[dict[str, str | None]] = []
    with input_path.open(encoding="utf-8", errors="replace") as dataset_file:
        for line_number, raw_line in enumerate(dataset_file, start=1):
            line = raw_line.rstrip("\r\n")
            if "\t" not in line:
                raise ValueError(
                    f"Malformed row {line_number}: expected a tab between label and message."
                )
            label, message = line.split("\t", maxsplit=1)
            records.append({"label": label, "message": message})

    dataset = pd.DataFrame(records, columns=["label", "message"]).astype("string")

    unexpected_labels = set(dataset["label"].dropna().unique()) - EXPECTED_LABELS
    if unexpected_labels:
        found = ", ".join(sorted(map(str, unexpected_labels)))
        raise ValueError(
            "Expected a headerless tab-separated dataset with 'ham' and 'spam' "
            f"labels. Unexpected labels found: {found}"
        )

    return dataset


def inspect_dataset(dataset: pd.DataFrame) -> dict[str, object]:
    """Return the requested data-quality summary before cleaning."""
    return {
        "total_records": int(len(dataset)),
        "ham_messages": int((dataset["label"] == "ham").sum()),
        "spam_messages": int((dataset["label"] == "spam").sum()),
        "missing_values": {column: int(count) for column, count in dataset.isna().sum().items()},
        "duplicate_messages": int(dataset["message"].duplicated().sum()),
        "class_distribution": {
            str(label): int(count)
            for label, count in dataset["label"].value_counts(dropna=False).items()
        },
    }


def clean_dataset(dataset: pd.DataFrame) -> pd.DataFrame:
    """Remove empty records, normalize excess whitespace, and deduplicate rows."""
    cleaned = dataset.copy()

    for column in ["label", "message"]:
        cleaned[column] = cleaned[column].str.strip()

    # Internal whitespace is reduced to one space; wording and punctuation stay intact.
    cleaned["message"] = cleaned["message"].str.replace(r"\s+", " ", regex=True)
    cleaned = cleaned.dropna(subset=["label", "message"])
    cleaned = cleaned[(cleaned["label"] != "") & (cleaned["message"] != "")]
    cleaned = cleaned.drop_duplicates().reset_index(drop=True)

    return cleaned


def print_summary(summary: dict[str, object], cleaned_count: int) -> None:
    """Print a readable report for a terminal user."""
    print("Dataset format: headerless TSV with columns: label, message")
    print(f"Total records: {summary['total_records']}")
    print(f"Ham messages: {summary['ham_messages']}")
    print(f"Spam messages: {summary['spam_messages']}")
    print(f"Missing values: {summary['missing_values']}")
    print(f"Duplicate messages: {summary['duplicate_messages']}")
    print(f"Class distribution: {summary['class_distribution']}")
    print(f"Records after cleaning: {cleaned_count}")


def main() -> None:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        required=True,
        help="Path to the original SMSSpamCollection dataset file.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=project_root / "data" / "cleaned_sms.csv",
        help="Destination for the cleaned CSV file.",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=project_root / "data" / "data_quality_report.json",
        help="Destination for the data-quality JSON report.",
    )
    args = parser.parse_args()

    dataset = load_sms_dataset(args.input)
    summary = inspect_dataset(dataset)
    cleaned = clean_dataset(dataset)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    cleaned.to_csv(args.output, index=False, encoding="utf-8")

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print_summary(summary, len(cleaned))
    print(f"Cleaned dataset saved to: {args.output}")
    print(f"Data-quality report saved to: {args.report}")


if __name__ == "__main__":
    main()
