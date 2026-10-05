import json


def tellraw_command(delivery, users, color="gray", chat_image=True):
    """Display [client] <sender> content; JSON encoding keeps one fixed command."""
    parts = [{"text": "", "color": color}]
    source = delivery.get("sourceGroupName")
    if source:
        parts.append({"text": f"[{source}] "})
    author = delivery.get("authorName")
    if author:
        parts.append({"text": f"<{author}> "})
    for segment in delivery["segments"]:
        kind = segment["type"]
        if kind == "text":
            parts.append({"text": str(segment["text"])})
        elif kind == "mention":
            key = str(segment["userId"])
            name = "所有玩家" if key == "all" else users.get(key, key)
            parts.append({"text": f"@{name} ", "color": "yellow"})
        elif kind == "image":
            url = str(segment["url"])
            if not url.startswith(("http://", "https://")):
                raise ValueError("Only http(s) images are supported")
            # Keep each v1-compatible CICode intact in one text component.
            # Delimiters are percent encoded to avoid
            # injecting additional ChatImage attributes.
            safe = url.replace(",", "%2C").replace("[", "%5B").replace("]", "%5D")
            text = f"[[CICode,url={safe},name=图片]]" if chat_image else "[图片]"
            parts.append({"text": text, "underlined": True,
                          "clickEvent": {"action": "open_url", "value": url}})
        else:
            raise ValueError(f"Unsupported native segment: {kind}")
    return "tellraw @a " + json.dumps(parts, ensure_ascii=False)
