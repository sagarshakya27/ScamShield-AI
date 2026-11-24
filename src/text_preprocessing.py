"""Reusable text-normalization functions for ScamShield AI."""


def normalize_sms(text: str) -> str:
    """Lowercase and normalize whitespace while preserving SMS scam signals.

    Phone numbers, URLs, punctuation, and words such as ``FREE`` remain
    available to the TF-IDF tokenizer. This module-level function can be
    reliably restored when the trained joblib pipeline is loaded.
    """
    return " ".join(str(text).lower().split())
