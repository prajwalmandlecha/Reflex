"""Slug helpers for deriving stable, URL-safe IDs from human-readable names."""

import re
import unicodedata


def slugify(value: str, fallback: str = "item") -> str:
    """Convert a display name into a lowercase, dash-separated, URL-safe slug.

    Examples:
        "Bank of Anthos Payments" -> "bank-of-anthos-payments"
        "Analytics & Reporting Bot" -> "analytics-reporting-bot"
        "  Stripe  " -> "stripe"
    """
    if not value:
        return fallback
    # Normalize unicode (é -> e), drop combining marks.
    normalized = unicodedata.normalize("NFKD", value)
    normalized = "".join(c for c in normalized if not unicodedata.combining(c))
    # Lowercase, replace any run of non-alphanumerics with a single dash.
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower())
    slug = slug.strip("-")
    return slug or fallback
