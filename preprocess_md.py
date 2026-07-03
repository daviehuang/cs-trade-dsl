#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import re

REPLACE_MAP = {
    "✅": "[推荐]",
    "✔": "[OK]",
    "✓": "[OK]",
    "❌": "[错误]",
    "⚠": "[注意]",
    "⚠️": "[注意]",
    "📌": "[提示]",
    "💡": "[建议]",
    "🚀": "[优化]",

    "→": "->",
    "←": "<-",
    "⇒": "=>",
    "⇐": "<=",
    "➜": "->",
    "➔": "->",

    "…": "...",
}

REMOVE_CHARS = [
    "\uFE0F",   # Variation Selector-16
    "\u200B",   # Zero Width Space
    "\u200C",
    "\u200D",
    "\u2060",
    "\uFEFF",   # BOM
]


def preprocess(text: str):

    for src, dst in REPLACE_MAP.items():
        text = text.replace(src, dst)

    for c in REMOVE_CHARS:
        text = text.replace(c, "")

    # 删除其它 Emoji（保留中文）
    emoji_pattern = re.compile(
        "["
        "\U0001F300-\U0001FAFF"
        "\U00002700-\U000027BF"
        "]",
        flags=re.UNICODE,
    )

    text = emoji_pattern.sub("", text)

    return text


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        text = f.read()

    text = preprocess(text)

    with open(args.output, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)

    print(f"Preprocessed: {args.input}")
    print(f"Output      : {args.output}")


if __name__ == "__main__":
    main()