import enum
import json
from dataclasses import asdict
from typing import Any


class EnumEncoder(json.JSONEncoder):
    """
    Custom JSON encoder that properly handles enum values.
    """

    def default(self, obj):
        if isinstance(obj, enum.Enum):
            return obj.value
        return super().default(obj)


def to_json_serializable(obj: Any) -> Any:
    """
    Convert an object to a JSON serializable format.
    Handles enum values, dataclasses, and other common types.

    Args:
        obj: The object to convert

    Returns:
        A JSON serializable representation of the object
    """
    if obj is None:
        return None
    elif isinstance(obj, (str, int, float, bool)):
        return obj
    elif isinstance(obj, enum.Enum):
        return obj.value
    elif isinstance(obj, list):
        return [to_json_serializable(item) for item in obj]
    elif isinstance(obj, dict):
        return {k: to_json_serializable(v) for k, v in obj.items()}
    elif hasattr(obj, "__dataclass_fields__"):
        # It's a dataclass, convert to dict first
        return to_json_serializable(asdict(obj))
    else:
        # Try to convert to dict if it has a __dict__ attribute
        try:
            return to_json_serializable(obj.__dict__)
        except (AttributeError, TypeError):
            # Last resort: try string representation
            return str(obj)
